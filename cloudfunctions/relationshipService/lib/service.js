const {
  makeCoupleId,
  makeRequestId,
  makeRequestGeneration,
  makeInviteCode,
  normalizeInviteCode,
  isRecoverable,
  validateCoupleFields
} = require('./domain')

const REQUEST_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000
const MAX_INVITE_ATTEMPTS = 12
const COUPLE_MUTABLE_FIELDS = new Set([
  'boyAvatar', 'girlAvatar', 'user1Name', 'user2Name',
  'loveDate', 'metDate', 'metCalendar', 'metLeap',
  'user1Birthday', 'user1BirthdayCalendar', 'user1BirthdayLeap',
  'user2Birthday', 'user2BirthdayCalendar', 'user2BirthdayLeap',
  'nextMeetDate', 'nextMeetCalendar', 'nextMeetLeap',
  'user1Status', 'user1StatusTime', 'user2Status', 'user2StatusTime',
  'statAdjustment'
])

function codedError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

function isBound(user) {
  return user.relationshipStatus === 'active' || Boolean(user.coupleId)
}

function activeUser(user, coupleId, partnerOpenid, updatedAt) {
  const active = {
    ...user,
    coupleId,
    relationshipStatus: 'active',
    partnerOpenid,
    updatedAt
  }
  delete active.lastArchivedCoupleId
  delete active.lastUnboundAt
  delete active.lastPurgeAfter
  return active
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requireString(value) {
  if (typeof value !== 'string' || value.trim() === '') throw codedError('INVALID_PAYLOAD')
  return value
}

class RelationshipService {
  constructor({ repository, now = () => new Date(), randomBytes }) {
    this.repository = repository
    this.now = now
    this.randomBytes = randomBytes
  }

  async execute(action, openid, payload = {}) {
    if (!openid) throw codedError('NOT_AUTHENTICATED')
    if (!isPlainObject(payload)) throw codedError('INVALID_PAYLOAD')
    const handlers = {
      bootstrap: () => this.bootstrap(openid),
      sendRequest: () => this.sendRequest(openid, requireString(payload.inviteCode)),
      listRequests: () => this.listRequests(openid),
      acceptRequest: () => this.acceptRequest(
        openid,
        requireString(payload.requestId),
        requireString(payload.generation),
        requireString(payload.role)
      ),
      rejectRequest: () => this.rejectRequest(
        openid,
        requireString(payload.requestId),
        requireString(payload.generation)
      ),
      cancelRequest: () => this.cancelRequest(
        openid,
        requireString(payload.requestId),
        requireString(payload.generation)
      ),
      unbind: () => this.unbind(openid),
      updateCoupleFields: () => this.updateCoupleFields(openid, payload.fields)
    }
    if (!handlers[action]) throw codedError('INVALID_ACTION')
    return handlers[action]()
  }

  async bootstrap(openid) {
    let user = await this.repository.getUser(openid)
    if (!user) {
      for (let attempt = 0; attempt < MAX_INVITE_ATTEMPTS; attempt += 1) {
        const now = this.now()
        try {
          user = await this.repository.createUserWithInvite({
            _id: openid,
            inviteCode: makeInviteCode(this.randomBytes),
            coupleId: null,
            relationshipStatus: 'single',
            partnerOpenid: null,
            createdAt: now,
            updatedAt: now
          })
          break
        } catch (error) {
          if (error.code !== 'INVITE_COLLISION') throw error
        }
      }
      if (!user) throw codedError('INTERNAL_ERROR')
    }

    const result = { ...user }
    if (!isBound(user)) return result

    const couple = await this.repository.getCouple(user.coupleId)
    if (!couple || couple.status !== 'active') return result
    result.couple = couple
    result.myRole = couple.user1Openid === openid ? 'user1' : 'user2'
    result.partner = await this.repository.getUser(user.partnerOpenid)
    return result
  }

  async sendRequest(openid, rawInviteCode) {
    const sender = await this.requireUser(openid)
    const inviteCode = normalizeInviteCode(rawInviteCode)
    const recipient = await this.repository.findUserByInvite(inviteCode)
    if (!recipient) throw codedError('INVITE_NOT_FOUND')
    if (recipient._id === openid) throw codedError('CANNOT_BIND_SELF')
    if (isBound(sender) || isBound(recipient)) throw codedError('ALREADY_BOUND')
    const createdAt = this.now()
    return this.repository.reserveRequest({
      _id: makeRequestId(openid, recipient._id),
      fromOpenid: openid,
      toOpenid: recipient._id,
      fromInviteCode: sender.inviteCode,
      toInviteCode: recipient.inviteCode,
      generation: makeRequestGeneration(this.randomBytes),
      status: 'pending',
      createdAt,
      updatedAt: createdAt,
      expiresAt: new Date(createdAt.getTime() + REQUEST_LIFETIME_MS)
    })
  }

  async listRequests(openid) {
    await this.requireUser(openid)
    const requests = await this.repository.listRequests(openid)
    return requests.filter(request => request.fromOpenid === openid || request.toOpenid === openid)
  }

  async acceptRequest(openid, requestId, generation, role) {
    if (role !== 'user1' && role !== 'user2') throw codedError('FORBIDDEN')
    const request = await this.repository.getRequest(requestId)
    if (!request || request.generation !== generation) {
      throw codedError('REQUEST_NOT_FOUND')
    }
    if (request.toOpenid !== openid) throw codedError('FORBIDDEN')
    if (request.status === 'accepted') {
      if (request.acceptedBy !== openid || !request.result) throw codedError('FORBIDDEN')
      return request.result
    }
    if (request.status !== 'pending') throw codedError('REQUEST_NOT_FOUND')
    if (new Date(request.expiresAt).getTime() <= this.now().getTime()) {
      throw codedError('REQUEST_EXPIRED')
    }

    const fromUser = await this.requireUser(request.fromOpenid)
    const toUser = await this.requireUser(request.toOpenid)
    if (isBound(fromUser) || isBound(toUser)) throw codedError('ALREADY_BOUND')

    const now = this.now()
    const oldCouple = await this.repository.findArchivedCouple([request.fromOpenid, request.toOpenid])
    const restoring = oldCouple && isRecoverable(oldCouple, now)
    const coupleId = restoring
      ? oldCouple._id
      : makeCoupleId(request.fromOpenid, request.toOpenid, this.randomBytes(16).toString('hex'))
    const preserveRoles = restoring &&
      [oldCouple.user1Openid, oldCouple.user2Openid].includes(fromUser._id) &&
      [oldCouple.user1Openid, oldCouple.user2Openid].includes(toUser._id) &&
      oldCouple.user1Openid !== oldCouple.user2Openid
    const user1 = preserveRoles
      ? (oldCouple.user1Openid === fromUser._id ? fromUser : toUser)
      : (role === 'user1' ? toUser : fromUser)
    const user2 = preserveRoles
      ? (oldCouple.user2Openid === fromUser._id ? fromUser : toUser)
      : (role === 'user2' ? toUser : fromUser)
    const couple = {
      ...(restoring ? oldCouple : {}),
      _id: coupleId,
      memberOpenids: [fromUser._id, toUser._id],
      memberInviteCodes: [fromUser.inviteCode, toUser.inviteCode],
      status: 'active',
      archivedAt: null,
      purgeAfter: null,
      createdAt: restoring && oldCouple.createdAt ? oldCouple.createdAt : now,
      updatedAt: now,
      user1Openid: user1._id,
      user2Openid: user2._id,
      user1: preserveRoles && oldCouple.user1 !== undefined ? oldCouple.user1 : user1.inviteCode,
      user2: preserveRoles && oldCouple.user2 !== undefined ? oldCouple.user2 : user2.inviteCode
    }
    if (restoring) couple.restoredFromArchive = true
    const activeFrom = activeUser(fromUser, coupleId, toUser._id, now)
    const activeTo = activeUser(toUser, coupleId, fromUser._id, now)

    const result = await this.repository.saveAcceptedRelationship({
      requestId,
      generation,
      acceptedBy: openid,
      role,
      fromUser: activeFrom,
      toUser: activeTo,
      couple,
      now
    })
    return result
  }

  async rejectRequest(openid, requestId, generation) {
    const request = await this.repository.resolveRequest({
      requestId,
      openid,
      action: 'rejected',
      generation,
      now: this.now()
    })
    return { requestId, generation: request.generation, status: request.status }
  }

  async cancelRequest(openid, requestId, generation) {
    const request = await this.repository.resolveRequest({
      requestId,
      openid,
      action: 'cancelled',
      generation,
      now: this.now()
    })
    return { requestId, generation: request.generation, status: request.status }
  }

  async unbind(openid) {
    const user = await this.requireUser(openid)
    if (!isBound(user)) {
      if (user.lastArchivedCoupleId) {
        const archived = await this.repository.getCouple(user.lastArchivedCoupleId)
        if (archived && archived.status === 'archived' && archived.memberOpenids.includes(openid)) {
          return {
            coupleId: archived._id,
            archivedAt: archived.archivedAt,
            purgeAfter: archived.purgeAfter
          }
        }
      }
      throw codedError('RELATIONSHIP_NOT_FOUND')
    }
    const couple = await this.repository.getCouple(user.coupleId)
    if (!couple || couple.status !== 'active' || !couple.memberOpenids.includes(openid)) {
      throw codedError('RELATIONSHIP_NOT_FOUND')
    }
    const now = this.now()
    const archived = await this.repository.archiveRelationship({
      callerOpenid: openid,
      coupleId: couple._id,
      now
    })
    const result = {
      coupleId: archived._id,
      archivedAt: archived.archivedAt,
      purgeAfter: archived.purgeAfter
    }
    return result
  }

  async updateCoupleFields(openid, fields) {
    if (!isPlainObject(fields) || Object.keys(fields).length === 0) {
      throw codedError('INVALID_PAYLOAD')
    }
    if (Object.keys(fields).some(key => !COUPLE_MUTABLE_FIELDS.has(key))) {
      throw codedError('FORBIDDEN')
    }
    if (!validateCoupleFields(fields)) throw codedError('INVALID_PAYLOAD')
    const user = await this.requireUser(openid)
    if (!isBound(user)) throw codedError('RELATIONSHIP_NOT_FOUND')
    if (typeof this.repository.updateCoupleFields !== 'function') throw codedError('INTERNAL_ERROR')
    return this.repository.updateCoupleFields({
      openid,
      coupleId: user.coupleId,
      fields,
      updatedAt: this.now()
    })
  }

  async requireUser(openid) {
    const user = await this.repository.getUser(openid)
    if (!user) throw codedError('USER_NOT_FOUND')
    return user
  }
}

module.exports = { RelationshipService, COUPLE_MUTABLE_FIELDS, codedError }
