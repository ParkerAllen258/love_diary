const { isRecoverable, purgeAfter, sameMembers } = require('./domain')
const { codedError } = require('./service')

function withoutId(document) {
  const copy = { ...document }
  delete copy._id
  return copy
}

function isBound(user) {
  return user && (user.relationshipStatus === 'active' || Boolean(user.coupleId))
}

async function readDoc(scope, collection, id) {
  try {
    const result = await scope.collection(collection).doc(id).get()
    if (!result || !result.data) return null
    const data = Array.isArray(result.data) ? result.data[0] : result.data
    return data ? { ...data, _id: data._id || id } : null
  } catch (error) {
    if (error && (error.errCode === -1 || /not\s*found|does not exist/i.test(error.message || ''))) {
      return null
    }
    throw error
  }
}

async function writeDoc(scope, collection, document) {
  await scope.collection(collection).doc(document._id).set({ data: withoutId(document) })
}

function sharedArchiveId(leftUser, rightUser) {
  const candidateId = leftUser && leftUser.lastArchivedCoupleId
  return candidateId && rightUser && rightUser.lastArchivedCoupleId === candidateId
    ? candidateId
    : null
}

function isArchivedForMembers(couple, memberOpenids) {
  return Boolean(couple && couple.status === 'archived' &&
    Array.isArray(couple.memberOpenids) && sameMembers(couple.memberOpenids, memberOpenids))
}

function singleUser(user, now, coupleId) {
  return {
    ...user,
    coupleId: null,
    relationshipStatus: 'single',
    partnerOpenid: null,
    lastArchivedCoupleId: coupleId,
    lastUnboundAt: now,
    lastPurgeAfter: purgeAfter(now),
    updatedAt: now
  }
}

class CloudRepository {
  constructor(db) {
    this.db = db
  }

  async getUser(openid) {
    return readDoc(this.db, 'users', openid)
  }

  async createUserWithInvite(user) {
    return this.db.runTransaction(async transaction => {
      const existingUser = await readDoc(transaction, 'users', user._id)
      if (existingUser) return existingUser
      const reservation = await readDoc(transaction, 'invite', user.inviteCode)
      if (reservation) throw codedError('INVITE_COLLISION')
      await writeDoc(transaction, 'invite', {
        _id: user.inviteCode,
        openid: user._id,
        createdAt: user.createdAt
      })
      await writeDoc(transaction, 'users', user)
      return user
    })
  }

  async findUserByInvite(inviteCode) {
    const result = await this.db.collection('users').where({ inviteCode }).get()
    return result.data && result.data[0] ? result.data[0] : null
  }

  async reserveRequest(request) {
    return this.db.runTransaction(async transaction => {
      const sender = await readDoc(transaction, 'users', request.fromOpenid)
      const recipient = await readDoc(transaction, 'users', request.toOpenid)
      if (!sender || !recipient) throw codedError('USER_NOT_FOUND')
      if (isBound(sender) || isBound(recipient)) throw codedError('ALREADY_BOUND')
      const existing = await readDoc(transaction, 'coupleRequest', request._id)
      if (existing && existing.status === 'pending' &&
          new Date(existing.expiresAt).getTime() > new Date(request.createdAt).getTime()) {
        throw codedError('REQUEST_EXISTS')
      }
      await writeDoc(transaction, 'coupleRequest', request)
      return request
    })
  }

  async listRequests(openid) {
    const collection = this.db.collection('coupleRequest')
    const [sent, received] = await Promise.all([
      collection.where({ fromOpenid: openid }).get(),
      collection.where({ toOpenid: openid }).get()
    ])
    const requests = new Map()
    for (const request of [...(sent.data || []), ...(received.data || [])]) requests.set(request._id, request)
    return [...requests.values()]
  }

  async getRequest(requestId) {
    return readDoc(this.db, 'coupleRequest', requestId)
  }

  async resolveRequest({ requestId, openid, action, generation, now }) {
    return this.db.runTransaction(async transaction => {
      const request = await readDoc(transaction, 'coupleRequest', requestId)
      if (!request || request.status !== 'pending' || request.generation !== generation) {
        throw codedError('REQUEST_NOT_FOUND')
      }
      if (action === 'rejected' && request.toOpenid !== openid) throw codedError('FORBIDDEN')
      if (action === 'cancelled' && request.fromOpenid !== openid) throw codedError('FORBIDDEN')
      if (action !== 'rejected' && action !== 'cancelled') throw codedError('FORBIDDEN')
      const resolved = { ...request, status: action, resolvedAt: now, updatedAt: now }
      await writeDoc(transaction, 'coupleRequest', resolved)
      return resolved
    })
  }

  async getCouple(coupleId) {
    return readDoc(this.db, 'couple', coupleId)
  }

  async findArchivedCouple(memberOpenids) {
    if (!Array.isArray(memberOpenids) || memberOpenids.length !== 2) return null
    const [leftUser, rightUser] = await Promise.all(memberOpenids.map(openid => this.getUser(openid)))
    const candidateId = sharedArchiveId(leftUser, rightUser)
    if (!candidateId) return null
    const candidate = await this.getCouple(candidateId)
    return isArchivedForMembers(candidate, memberOpenids) ? candidate : null
  }

  async saveAcceptedRelationship({ requestId, generation, acceptedBy, role, fromUser, toUser, couple, now }) {
    return this.db.runTransaction(async transaction => {
      const request = await readDoc(transaction, 'coupleRequest', requestId)
      if (!request || request.generation !== generation) throw codedError('REQUEST_NOT_FOUND')
      if (request.status === 'accepted') {
        if (request.acceptedBy !== acceptedBy || !request.result) throw codedError('FORBIDDEN')
        return request.result
      }
      if (request.status !== 'pending') throw codedError('REQUEST_NOT_FOUND')
      if (request.toOpenid !== acceptedBy) throw codedError('FORBIDDEN')
      if (new Date(request.expiresAt).getTime() <= new Date(now).getTime()) throw codedError('REQUEST_EXPIRED')

      const currentFrom = await readDoc(transaction, 'users', request.fromOpenid)
      const currentTo = await readDoc(transaction, 'users', request.toOpenid)
      if (!currentFrom || !currentTo) throw codedError('USER_NOT_FOUND')
      if (isBound(currentFrom) || isBound(currentTo)) throw codedError('ALREADY_BOUND')
      if (fromUser._id !== request.fromOpenid || toUser._id !== request.toOpenid) throw codedError('FORBIDDEN')

      const memberOpenids = [request.fromOpenid, request.toOpenid]
      const candidateId = sharedArchiveId(currentFrom, currentTo)
      const candidate = candidateId && await readDoc(transaction, 'couple', candidateId)
      const archived = isArchivedForMembers(candidate, memberOpenids) ? candidate : null
      if (couple.restoredFromArchive) {
        if (!archived || archived._id !== couple._id || !isRecoverable(archived, now)) {
          throw codedError('RELATIONSHIP_NOT_FOUND')
        }
      } else if (archived && isRecoverable(archived, now)) {
        throw codedError('RELATIONSHIP_NOT_FOUND')
      }

      const savedCouple = { ...couple }
      delete savedCouple.restoredFromArchive
      const myRole = savedCouple.user1Openid === acceptedBy ? 'user1' : 'user2'
      const result = { coupleId: savedCouple._id, myRole, couple: savedCouple }
      const acceptedRequest = {
        ...request,
        status: 'accepted',
        acceptedBy,
        acceptedAt: now,
        updatedAt: now,
        coupleId: savedCouple._id,
        requestedRole: role,
        myRole,
        result
      }
      await writeDoc(transaction, 'users', fromUser)
      await writeDoc(transaction, 'users', toUser)
      await writeDoc(transaction, 'couple', savedCouple)
      await writeDoc(transaction, 'coupleRequest', acceptedRequest)
      return result
    })
  }

  async archiveRelationship({ callerOpenid, coupleId, now }) {
    return this.db.runTransaction(async transaction => {
      const caller = await readDoc(transaction, 'users', callerOpenid)
      const couple = await readDoc(transaction, 'couple', coupleId)
      if (!caller || !couple || caller.relationshipStatus !== 'active' ||
          caller.coupleId !== coupleId || couple.status !== 'active' ||
          !Array.isArray(couple.memberOpenids) || couple.memberOpenids.length !== 2 ||
          !couple.memberOpenids.includes(callerOpenid)) {
        throw codedError('RELATIONSHIP_NOT_FOUND')
      }
      const partnerOpenid = couple.memberOpenids.find(member => member !== callerOpenid)
      const partner = partnerOpenid && await readDoc(transaction, 'users', partnerOpenid)
      if (!partner || partner.relationshipStatus !== 'active' || partner.coupleId !== coupleId ||
          caller.partnerOpenid !== partnerOpenid || partner.partnerOpenid !== callerOpenid) {
        throw codedError('RELATIONSHIP_NOT_FOUND')
      }
      const archived = {
        ...couple,
        status: 'archived',
        archivedAt: now,
        purgeAfter: purgeAfter(now),
        updatedAt: now
      }
      await writeDoc(transaction, 'users', singleUser(caller, now, coupleId))
      await writeDoc(transaction, 'users', singleUser(partner, now, coupleId))
      await writeDoc(transaction, 'couple', archived)
      return archived
    })
  }

  async updateCoupleFields({ openid, coupleId, fields, updatedAt }) {
    return this.db.runTransaction(async transaction => {
      const user = await readDoc(transaction, 'users', openid)
      const couple = await readDoc(transaction, 'couple', coupleId)
      if (!user || user.relationshipStatus !== 'active' || user.coupleId !== coupleId ||
          !couple || couple.status !== 'active' || !Array.isArray(couple.memberOpenids) ||
          !couple.memberOpenids.includes(openid)) {
        throw codedError('RELATIONSHIP_NOT_FOUND')
      }
      const saved = { ...couple, ...fields, updatedAt }
      await writeDoc(transaction, 'couple', saved)
      return saved
    })
  }
}

module.exports = { CloudRepository }
