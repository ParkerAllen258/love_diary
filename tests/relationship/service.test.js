const test = require('node:test')
const assert = require('node:assert/strict')
const { RelationshipService } = require('../../cloudfunctions/relationshipService/lib/service')
const { makeCoupleId, makeRequestId, purgeAfter, isRecoverable } = require('../../cloudfunctions/relationshipService/lib/domain')

const NOW = new Date('2026-06-27T00:00:00.000Z')

class MemoryRepository {
  constructor() {
    this.users = new Map()
    this.requests = new Map()
    this.couples = new Map()
    this.beforeReserveRequest = null
    this.beforeSaveAcceptedRelationship = null
    this.beforeUpdateCoupleFields = null
    this.beforeArchiveRelationship = null
    this.beforeResolveRequest = null
  }

  async getUser(openid) {
    return this.users.get(openid) || null
  }

  async createUserWithInvite(user) {
    if ([...this.users.values()].some(existing => existing.inviteCode === user.inviteCode)) {
      const error = new Error('invite collision')
      error.code = 'INVITE_COLLISION'
      throw error
    }
    if (!this.users.has(user._id)) this.users.set(user._id, { ...user })
    return this.users.get(user._id)
  }

  async findUserByInvite(inviteCode) {
    return [...this.users.values()].find(user => user.inviteCode === inviteCode) || null
  }

  async reserveRequest(request) {
    if (this.beforeReserveRequest) await this.beforeReserveRequest(request)
    const sender = this.users.get(request.fromOpenid)
    const recipient = this.users.get(request.toOpenid)
    if (!sender || !recipient) throw Object.assign(new Error('USER_NOT_FOUND'), { code: 'USER_NOT_FOUND' })
    if (sender.relationshipStatus === 'active' || sender.coupleId ||
        recipient.relationshipStatus === 'active' || recipient.coupleId) {
      throw Object.assign(new Error('ALREADY_BOUND'), { code: 'ALREADY_BOUND' })
    }
    const existing = this.requests.get(request._id)
    if (existing && existing.status === 'pending' &&
        new Date(existing.expiresAt).getTime() > new Date(request.createdAt).getTime()) {
      throw Object.assign(new Error('REQUEST_EXISTS'), { code: 'REQUEST_EXISTS' })
    }
    if (typeof request.generation !== 'string' || !request.generation) {
      throw Object.assign(new Error('INVALID_PAYLOAD'), { code: 'INVALID_PAYLOAD' })
    }
    const saved = { ...request }
    this.requests.set(saved._id, saved)
    return saved
  }

  async listRequests(openid) {
    return [...this.requests.values()].filter(request =>
      request.fromOpenid === openid || request.toOpenid === openid)
  }

  async getRequest(requestId) {
    return this.requests.get(requestId) || null
  }

  async resolveRequest({ requestId, openid, action, generation, now }) {
    if (this.beforeResolveRequest) await this.beforeResolveRequest({ requestId, openid, action, generation })
    const request = this.requests.get(requestId)
    if (!request || request.status !== 'pending' || request.generation !== generation) {
      throw Object.assign(new Error('REQUEST_NOT_FOUND'), { code: 'REQUEST_NOT_FOUND' })
    }
    if (action === 'rejected' && request.toOpenid !== openid) {
      throw Object.assign(new Error('FORBIDDEN'), { code: 'FORBIDDEN' })
    }
    if (action === 'cancelled' && request.fromOpenid !== openid) {
      throw Object.assign(new Error('FORBIDDEN'), { code: 'FORBIDDEN' })
    }
    const saved = { ...request, status: action, resolvedAt: now, updatedAt: now }
    this.requests.set(requestId, saved)
    return saved
  }

  async getCouple(coupleId) {
    return this.couples.get(coupleId) || null
  }

  async findArchivedCouple(memberOpenids) {
    const wanted = [...memberOpenids].sort().join('\0')
    return [...this.couples.values()]
      .filter(couple => couple.status === 'archived' &&
        [...couple.memberOpenids].sort().join('\0') === wanted)
      .sort((left, right) => new Date(right.archivedAt) - new Date(left.archivedAt))[0] || null
  }

  async saveAcceptedRelationship({ requestId, generation, acceptedBy, role, fromUser, toUser, couple, now }) {
    if (this.beforeSaveAcceptedRelationship) await this.beforeSaveAcceptedRelationship({ requestId, generation, couple })
    const request = this.requests.get(requestId)
    if (!request || request.generation !== generation) {
      throw Object.assign(new Error('REQUEST_NOT_FOUND'), { code: 'REQUEST_NOT_FOUND' })
    }
    if (request.status === 'accepted') {
      if (request.acceptedBy !== acceptedBy) throw Object.assign(new Error('FORBIDDEN'), { code: 'FORBIDDEN' })
      return request.result
    }
    if (request.status !== 'pending') throw Object.assign(new Error('REQUEST_NOT_FOUND'), { code: 'REQUEST_NOT_FOUND' })
    if (request.toOpenid !== acceptedBy) throw Object.assign(new Error('FORBIDDEN'), { code: 'FORBIDDEN' })
    if (new Date(request.expiresAt).getTime() <= new Date(now).getTime()) {
      throw Object.assign(new Error('REQUEST_EXPIRED'), { code: 'REQUEST_EXPIRED' })
    }
    const currentFrom = this.users.get(request.fromOpenid)
    const currentTo = this.users.get(request.toOpenid)
    if (!currentFrom || !currentTo) throw Object.assign(new Error('USER_NOT_FOUND'), { code: 'USER_NOT_FOUND' })
    if (currentFrom.relationshipStatus === 'active' || currentFrom.coupleId ||
        currentTo.relationshipStatus === 'active' || currentTo.coupleId) {
      throw Object.assign(new Error('ALREADY_BOUND'), { code: 'ALREADY_BOUND' })
    }
    const archived = this.findArchivedCouple([request.fromOpenid, request.toOpenid])
    const currentArchived = await archived
    if (couple.restoredFromArchive) {
      if (!currentArchived || currentArchived._id !== couple._id || !isRecoverable(currentArchived, now)) {
        throw Object.assign(new Error('RELATIONSHIP_NOT_FOUND'), { code: 'RELATIONSHIP_NOT_FOUND' })
      }
    } else if (currentArchived && isRecoverable(currentArchived, now)) {
      throw Object.assign(new Error('RELATIONSHIP_NOT_FOUND'), { code: 'RELATIONSHIP_NOT_FOUND' })
    }
    this.users.set(fromUser._id, { ...fromUser })
    this.users.set(toUser._id, { ...toUser })
    const savedCouple = { ...couple }
    delete savedCouple.restoredFromArchive
    this.couples.set(couple._id, savedCouple)
    const myRole = savedCouple.user1Openid === acceptedBy ? 'user1' : 'user2'
    const result = { coupleId: couple._id, myRole, couple: savedCouple }
    this.requests.set(requestId, {
      ...request,
      status: 'accepted',
      acceptedBy,
      acceptedAt: now,
      coupleId: couple._id,
      requestedRole: role,
      myRole,
      result
    })
    return result
  }

  async archiveRelationship({ callerOpenid, coupleId, now }) {
    if (this.beforeArchiveRelationship) await this.beforeArchiveRelationship({ callerOpenid, coupleId })
    const caller = this.users.get(callerOpenid)
    const couple = this.couples.get(coupleId)
    if (!caller || caller.relationshipStatus !== 'active' || caller.coupleId !== coupleId ||
        !couple || couple.status !== 'active' || !couple.memberOpenids.includes(callerOpenid)) {
      throw Object.assign(new Error('RELATIONSHIP_NOT_FOUND'), { code: 'RELATIONSHIP_NOT_FOUND' })
    }
    const partnerOpenid = couple.memberOpenids.find(member => member !== callerOpenid)
    const partner = this.users.get(partnerOpenid)
    if (!partner || partner.relationshipStatus !== 'active' || partner.coupleId !== coupleId ||
        partner.partnerOpenid !== callerOpenid || caller.partnerOpenid !== partnerOpenid) {
      throw Object.assign(new Error('RELATIONSHIP_NOT_FOUND'), { code: 'RELATIONSHIP_NOT_FOUND' })
    }
    const archived = { ...couple, status: 'archived', archivedAt: now, purgeAfter: purgeAfter(now), updatedAt: now }
    this.users.set(callerOpenid, singleUserForTest(caller, now))
    this.users.set(partnerOpenid, singleUserForTest(partner, now))
    this.couples.set(coupleId, archived)
    return archived
  }

  async updateCoupleFields({ openid, coupleId, fields, updatedAt }) {
    if (this.beforeUpdateCoupleFields) await this.beforeUpdateCoupleFields({ openid, coupleId })
    const user = this.users.get(openid)
    const couple = this.couples.get(coupleId)
    if (!user || user.relationshipStatus !== 'active' || user.coupleId !== coupleId ||
        !couple || couple.status !== 'active' || !couple.memberOpenids.includes(openid)) {
      throw Object.assign(new Error('RELATIONSHIP_NOT_FOUND'), { code: 'RELATIONSHIP_NOT_FOUND' })
    }
    const saved = { ...couple, ...fields, updatedAt }
    this.couples.set(coupleId, saved)
    return saved
  }
}

function harness() {
  const repository = new MemoryRepository()
  let byte = 0
  const service = new RelationshipService({
    repository,
    now: () => new Date(NOW),
    randomBytes: length => Buffer.alloc(length, byte++)
  })
  return { repository, service }
}

function seedUser(repository, openid, inviteCode, fields = {}) {
  const user = {
    _id: openid,
    inviteCode,
    coupleId: null,
    relationshipStatus: 'single',
    partnerOpenid: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...fields
  }
  repository.users.set(openid, user)
  return user
}

function singleUserForTest(user, updatedAt) {
  return {
    ...user,
    coupleId: null,
    relationshipStatus: 'single',
    partnerOpenid: null,
    lastArchivedCoupleId: user.coupleId,
    lastUnboundAt: updatedAt,
    lastPurgeAfter: purgeAfter(updatedAt),
    updatedAt
  }
}

async function expectCode(operation, code) {
  await assert.rejects(operation, error => {
    assert.equal(error.code, code)
    return true
  })
}

async function requestBetween(service, repository, from = 'alice', to = 'bob') {
  if (!repository.users.has(from)) seedUser(repository, from, 'ALICE1')
  if (!repository.users.has(to)) seedUser(repository, to, 'BOB222')
  return service.execute('sendRequest', from, { inviteCode: repository.users.get(to).inviteCode })
}

test('bootstrap creates one user and is idempotent', async () => {
  const { repository, service } = harness()
  const first = await service.execute('bootstrap', 'alice')
  const second = await service.execute('bootstrap', 'alice')

  assert.equal(repository.users.size, 1)
  assert.deepEqual(second, first)
  assert.match(first.inviteCode, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/)
  assert.equal(first.relationshipStatus, 'single')
})

test('sendRequest rejects self binding', async () => {
  const { repository, service } = harness()
  seedUser(repository, 'alice', 'ALICE1')
  await expectCode(() => service.execute('sendRequest', 'alice', { inviteCode: 'alice-1' }), 'CANNOT_BIND_SELF')
})

test('sendRequest rejects an already bound sender or recipient', async () => {
  const { repository, service } = harness()
  seedUser(repository, 'alice', 'ALICE1', { relationshipStatus: 'active', coupleId: 'cp_a' })
  seedUser(repository, 'bob', 'BOB222')
  await expectCode(() => service.execute('sendRequest', 'alice', { inviteCode: 'BOB222' }), 'ALREADY_BOUND')

  repository.users.get('alice').relationshipStatus = 'single'
  repository.users.get('alice').coupleId = null
  repository.users.get('bob').relationshipStatus = 'active'
  repository.users.get('bob').coupleId = 'cp_b'
  await expectCode(() => service.execute('sendRequest', 'alice', { inviteCode: 'BOB222' }), 'ALREADY_BOUND')
})

test('sendRequest prevents duplicate pending requests in either direction', async () => {
  const { repository, service } = harness()
  await requestBetween(service, repository)
  await expectCode(() => service.execute('sendRequest', 'alice', { inviteCode: 'BOB222' }), 'REQUEST_EXISTS')
  await expectCode(() => service.execute('sendRequest', 'bob', { inviteCode: 'ALICE1' }), 'REQUEST_EXISTS')
})

test('sendRequest reserves one deterministic request across service instances', async () => {
  const { repository, service } = harness()
  seedUser(repository, 'alice', 'ALICE1')
  seedUser(repository, 'bob', 'BOB222')
  const otherService = new RelationshipService({
    repository,
    now: () => new Date(NOW),
    randomBytes: length => Buffer.alloc(length, 7)
  })

  const results = await Promise.allSettled([
    service.execute('sendRequest', 'alice', { inviteCode: 'BOB222' }),
    otherService.execute('sendRequest', 'bob', { inviteCode: 'ALICE1' })
  ])

  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  const rejected = results.find(result => result.status === 'rejected')
  assert.equal(rejected.reason.code, 'REQUEST_EXISTS')
  assert.deepEqual([...repository.requests.keys()], [makeRequestId('alice', 'bob')])
})

test('listRequests returns only requests involving the caller', async () => {
  const { repository, service } = harness()
  const involved = await requestBetween(service, repository)
  seedUser(repository, 'carol', 'CAROL3')
  seedUser(repository, 'dave', 'DAVE44')
  await service.execute('sendRequest', 'carol', { inviteCode: 'DAVE44' })

  assert.deepEqual(await service.execute('listRequests', 'alice'), [involved])
  assert.deepEqual(await service.execute('listRequests', 'bob'), [involved])
})

test('only the recipient can accept or reject a request', async () => {
  const { repository, service } = harness()
  const request = await requestBetween(service, repository)
  seedUser(repository, 'mallory', 'MALLR5')

  await expectCode(() => service.execute('acceptRequest', 'alice', { requestId: request._id, generation: request.generation, role: 'user1' }), 'FORBIDDEN')
  await expectCode(() => service.execute('acceptRequest', 'mallory', { requestId: request._id, generation: request.generation, role: 'user1' }), 'FORBIDDEN')
  await expectCode(() => service.execute('acceptRequest', 'bob', { requestId: request._id, generation: request.generation, role: 'boy' }), 'FORBIDDEN')
  await expectCode(() => service.execute('rejectRequest', 'alice', { requestId: request._id, generation: request.generation }), 'FORBIDDEN')
  await service.execute('rejectRequest', 'bob', { requestId: request._id, generation: request.generation })
  assert.equal(repository.requests.get(request._id).status, 'rejected')
})

test('only the sender can cancel a request', async () => {
  const { repository, service } = harness()
  const request = await requestBetween(service, repository)
  seedUser(repository, 'mallory', 'MALLR5')

  await expectCode(() => service.execute('cancelRequest', 'bob', { requestId: request._id, generation: request.generation }), 'FORBIDDEN')
  await expectCode(() => service.execute('cancelRequest', 'mallory', { requestId: request._id, generation: request.generation }), 'FORBIDDEN')
  await service.execute('cancelRequest', 'alice', { requestId: request._id, generation: request.generation })
  assert.equal(repository.requests.get(request._id).status, 'cancelled')
})

test('an old reject cannot resolve a newer generation with the same request id', async () => {
  const { repository, service } = harness()
  const oldRequest = await requestBetween(service, repository)
  await service.execute('cancelRequest', 'alice', { requestId: oldRequest._id, generation: oldRequest.generation })
  const newer = await service.execute('sendRequest', 'alice', { inviteCode: 'BOB222' })

  await expectCode(
    () => service.execute('rejectRequest', 'bob', { requestId: oldRequest._id, generation: oldRequest.generation }),
    'REQUEST_NOT_FOUND'
  )
  assert.equal(repository.requests.get(newer._id).generation, newer.generation)
  assert.equal(repository.requests.get(newer._id).status, 'pending')
})

test('resolveRequest rechecks the generation at commit time', async () => {
  const { repository, service } = harness()
  const request = await requestBetween(service, repository)
  repository.beforeResolveRequest = ({ requestId }) => {
    repository.requests.set(requestId, {
      ...repository.requests.get(requestId),
      generation: 'new-generation',
      createdAt: new Date('2026-06-28T00:00:00.000Z')
    })
  }

  await expectCode(
    () => service.execute('rejectRequest', 'bob', { requestId: request._id, generation: request.generation }),
    'REQUEST_NOT_FOUND'
  )
  assert.equal(repository.requests.get(request._id).status, 'pending')
  assert.equal(repository.requests.get(request._id).generation, 'new-generation')
})

test('sendRequest atomically replaces expired and terminal request generations', async () => {
  const { repository, service } = harness()
  const first = await requestBetween(service, repository)
  repository.requests.get(first._id).expiresAt = new Date('2026-06-26T00:00:00.000Z')
  const afterExpiry = await service.execute('sendRequest', 'alice', { inviteCode: 'BOB222' })
  assert.notEqual(afterExpiry.generation, first.generation)
  assert.equal(afterExpiry.createdAt.toISOString(), NOW.toISOString())

  await service.execute('cancelRequest', 'alice', {
    requestId: afterExpiry._id,
    generation: afterExpiry.generation
  })
  const afterTerminal = await service.execute('sendRequest', 'alice', { inviteCode: 'BOB222' })
  assert.notEqual(afterTerminal.generation, afterExpiry.generation)
  assert.equal(afterTerminal.status, 'pending')
})

test('an old accept cannot bind a newer generation with the same request id', async t => {
  for (const resolution of ['cancelled', 'rejected', 'expired']) {
    await t.test(resolution, async () => {
      const { repository, service } = harness()
      const oldRequest = await requestBetween(service, repository)
      if (resolution === 'cancelled') {
        await service.execute('cancelRequest', 'alice', {
          requestId: oldRequest._id,
          generation: oldRequest.generation
        })
      } else if (resolution === 'rejected') {
        await service.execute('rejectRequest', 'bob', {
          requestId: oldRequest._id,
          generation: oldRequest.generation
        })
      } else {
        repository.requests.get(oldRequest._id).expiresAt = new Date('2026-06-26T00:00:00.000Z')
      }
      const newer = await service.execute('sendRequest', 'alice', { inviteCode: 'BOB222' })

      await expectCode(
        () => service.execute('acceptRequest', 'bob', {
          requestId: oldRequest._id,
          generation: oldRequest.generation,
          role: 'user2'
        }),
        'REQUEST_NOT_FOUND'
      )
      assert.equal(repository.requests.get(newer._id).generation, newer.generation)
      assert.equal(repository.requests.get(newer._id).status, 'pending')
      assert.equal(repository.users.get('alice').relationshipStatus, 'single')
      assert.equal(repository.users.get('bob').relationshipStatus, 'single')
    })
  }
})

test('acceptRequest gives both users the same active coupleId', async () => {
  const { repository, service } = harness()
  const request = await requestBetween(service, repository)
  const result = await service.execute('acceptRequest', 'bob', { requestId: request._id, generation: request.generation, role: 'user1' })

  const alice = repository.users.get('alice')
  const bob = repository.users.get('bob')
  assert.equal(alice.coupleId, bob.coupleId)
  assert.match(alice.coupleId, /^cp_[a-f0-9]{32}$/)
  assert.equal(alice.relationshipStatus, 'active')
  assert.equal(bob.relationshipStatus, 'active')
  assert.equal(repository.couples.get(alice.coupleId).user1Openid, 'bob')
  assert.equal(repository.couples.get(alice.coupleId).user2Openid, 'alice')
  assert.equal(result.myRole, 'user1')
  assert.equal((await service.execute('bootstrap', 'alice')).myRole, 'user2')
})

test('acceptRequest restores the archived coupleId inside thirty days', async () => {
  const { repository, service } = harness()
  const coupleId = makeCoupleId('alice', 'bob')
  const request = await requestBetween(service, repository)
  repository.couples.set(coupleId, {
    _id: coupleId,
    memberOpenids: ['alice', 'bob'],
    status: 'archived',
    archivedAt: new Date('2026-06-01T00:00:00.000Z'),
    purgeAfter: new Date('2026-07-01T00:00:00.000Z'),
    keepsake: 'preserved',
    user1Openid: 'alice',
    user2Openid: 'bob',
    user1: 'ALICE1',
    user2: 'BOB222'
  })

  await service.execute('acceptRequest', 'bob', { requestId: request._id, generation: request.generation, role: 'user2' })
  const restored = repository.couples.get(coupleId)
  assert.equal(restored._id, coupleId)
  assert.equal(restored.keepsake, 'preserved')
  assert.equal(restored.status, 'active')
  assert.equal(restored.archivedAt, null)
  assert.equal(restored.purgeAfter, null)
  assert.equal(restored.user1Openid, 'alice')
  assert.equal(restored.user2Openid, 'bob')
})

test('acceptRequest preserves archived role indexes and returns the callers actual role', async () => {
  const { repository, service } = harness()
  const coupleId = makeCoupleId('alice', 'bob')
  const request = await requestBetween(service, repository)
  repository.couples.set(coupleId, {
    _id: coupleId,
    memberOpenids: ['alice', 'bob'],
    status: 'archived',
    archivedAt: new Date('2026-06-01T00:00:00.000Z'),
    purgeAfter: new Date('2026-07-01T00:00:00.000Z'),
    user1Openid: 'alice', user2Openid: 'bob', user1: 'ARCHIVED_USER1', user2: 'ARCHIVED_USER2'
  })

  const result = await service.execute('acceptRequest', 'bob', { requestId: request._id, generation: request.generation, role: 'user1' })

  assert.equal(result.myRole, 'user2')
  assert.equal(result.couple.user1Openid, 'alice')
  assert.equal(result.couple.user2Openid, 'bob')
  assert.equal(result.couple.user1, 'ARCHIVED_USER1')
  assert.equal(result.couple.user2, 'ARCHIVED_USER2')
})

test('acceptRequest commit rejects users bound after the service pre-read', async () => {
  const { repository, service } = harness()
  const request = await requestBetween(service, repository)
  repository.beforeSaveAcceptedRelationship = () => {
    repository.users.get('alice').relationshipStatus = 'active'
    repository.users.get('alice').coupleId = 'cp_third_party'
  }

  await expectCode(
    () => service.execute('acceptRequest', 'bob', { requestId: request._id, generation: request.generation, role: 'user2' }),
    'ALREADY_BOUND'
  )
  assert.equal(repository.requests.get(request._id).status, 'pending')
})

test('acceptRequest commit rechecks the request generation before binding', async () => {
  const { repository, service } = harness()
  const request = await requestBetween(service, repository)
  repository.beforeSaveAcceptedRelationship = ({ requestId }) => {
    repository.requests.set(requestId, {
      ...repository.requests.get(requestId),
      generation: 'new-generation',
      createdAt: new Date('2026-06-28T00:00:00.000Z')
    })
  }

  await expectCode(
    () => service.execute('acceptRequest', 'bob', {
      requestId: request._id,
      generation: request.generation,
      role: 'user2'
    }),
    'REQUEST_NOT_FOUND'
  )
  assert.equal(repository.requests.get(request._id).status, 'pending')
  assert.equal(repository.requests.get(request._id).generation, 'new-generation')
  assert.equal(repository.users.get('alice').relationshipStatus, 'single')
  assert.equal(repository.users.get('bob').relationshipStatus, 'single')
  assert.equal(repository.couples.size, 0)
})

test('acceptRequest commit rejects an archived relation that expires after pre-read', async () => {
  const { repository, service } = harness()
  const coupleId = makeCoupleId('alice', 'bob')
  const request = await requestBetween(service, repository)
  repository.couples.set(coupleId, {
    _id: coupleId,
    memberOpenids: ['alice', 'bob'],
    status: 'archived',
    archivedAt: new Date('2026-06-01T00:00:00.000Z'),
    purgeAfter: new Date('2026-07-01T00:00:00.000Z'),
    user1Openid: 'alice', user2Openid: 'bob', user1: 'ALICE1', user2: 'BOB222'
  })
  repository.beforeSaveAcceptedRelationship = () => {
    repository.couples.get(coupleId).purgeAfter = new Date('2026-06-26T00:00:00.000Z')
  }

  await expectCode(
    () => service.execute('acceptRequest', 'bob', { requestId: request._id, generation: request.generation, role: 'user2' }),
    'RELATIONSHIP_NOT_FOUND'
  )
  assert.equal(repository.requests.get(request._id).status, 'pending')
})

test('acceptRequest creates a clean relation after the old relation expires', async () => {
  const { repository, service } = harness()
  const oldCoupleId = makeCoupleId('alice', 'bob')
  const request = await requestBetween(service, repository)
  repository.couples.set(oldCoupleId, {
    _id: oldCoupleId,
    memberOpenids: ['alice', 'bob'],
    status: 'archived',
    archivedAt: new Date('2026-05-01T00:00:00.000Z'),
    purgeAfter: new Date('2026-05-31T00:00:00.000Z'),
    keepsake: 'must-not-return'
  })
  for (const openid of ['alice', 'bob']) {
    Object.assign(repository.users.get(openid), {
      lastArchivedCoupleId: oldCoupleId,
      lastUnboundAt: new Date('2026-05-01T00:00:00.000Z'),
      lastPurgeAfter: new Date('2026-05-31T00:00:00.000Z')
    })
  }

  await service.execute('acceptRequest', 'bob', { requestId: request._id, generation: request.generation, role: 'user2' })
  const newCoupleId = repository.users.get('alice').coupleId
  const active = repository.couples.get(newCoupleId)
  assert.notEqual(newCoupleId, oldCoupleId)
  assert.equal(active.status, 'active')
  assert.equal(active.keepsake, undefined)
  assert.deepEqual(active.memberOpenids, ['alice', 'bob'])
  assert.equal(repository.couples.get(oldCoupleId).status, 'archived')
  for (const openid of ['alice', 'bob']) {
    const user = repository.users.get(openid)
    assert.equal(user.lastArchivedCoupleId, undefined)
    assert.equal(user.lastUnboundAt, undefined)
    assert.equal(user.lastPurgeAfter, undefined)
  }
})

test('unbind archives the relation and clears both users immediately', async () => {
  const { repository, service } = harness()
  const request = await requestBetween(service, repository)
  await service.execute('acceptRequest', 'bob', { requestId: request._id, generation: request.generation, role: 'user2' })
  const coupleId = repository.users.get('alice').coupleId

  await service.execute('unbind', 'alice')
  for (const openid of ['alice', 'bob']) {
    assert.equal(repository.users.get(openid).coupleId, null)
    assert.equal(repository.users.get(openid).partnerOpenid, null)
    assert.equal(repository.users.get(openid).relationshipStatus, 'single')
    assert.equal(repository.users.get(openid).lastArchivedCoupleId, coupleId)
    assert.equal(repository.users.get(openid).lastUnboundAt.toISOString(), NOW.toISOString())
    assert.equal(repository.users.get(openid).lastPurgeAfter.toISOString(), purgeAfter(NOW).toISOString())
  }
  const archived = repository.couples.get(coupleId)
  assert.equal(archived.status, 'archived')
  assert.equal(archived.archivedAt.toISOString(), NOW.toISOString())
  assert.equal(archived.purgeAfter.toISOString(), purgeAfter(NOW).toISOString())
})

test('unbind commit rejects a caller rebound after the service pre-read without overwriting it', async () => {
  const { repository, service } = harness()
  const request = await requestBetween(service, repository)
  await service.execute('acceptRequest', 'bob', { requestId: request._id, generation: request.generation, role: 'user2' })
  const oldCoupleId = repository.users.get('alice').coupleId
  repository.beforeArchiveRelationship = () => {
    repository.users.set('alice', {
      ...repository.users.get('alice'),
      relationshipStatus: 'active',
      coupleId: 'cp_new',
      partnerOpenid: 'carol'
    })
  }

  await expectCode(() => service.execute('unbind', 'alice'), 'RELATIONSHIP_NOT_FOUND')
  assert.equal(repository.users.get('alice').coupleId, 'cp_new')
  assert.equal(repository.users.get('alice').partnerOpenid, 'carol')
  assert.equal(repository.users.get('bob').coupleId, oldCoupleId)
  assert.equal(repository.couples.get(oldCoupleId).status, 'active')
})

test('repeating accept and unbind is idempotent', async () => {
  const { repository, service } = harness()
  const request = await requestBetween(service, repository)
  const firstAccept = await service.execute('acceptRequest', 'bob', { requestId: request._id, generation: request.generation, role: 'user2' })
  const freshService = new RelationshipService({ repository, now: () => new Date(NOW), randomBytes: length => Buffer.alloc(length, 9) })
  const secondAccept = await freshService.execute('acceptRequest', 'bob', { requestId: request._id, generation: request.generation, role: 'user2' })
  assert.deepEqual(secondAccept, firstAccept)
  assert.equal(repository.couples.size, 1)

  const firstUnbind = await service.execute('unbind', 'alice')
  const secondUnbind = await freshService.execute('unbind', 'alice')
  assert.deepEqual(secondUnbind, firstUnbind)
  assert.equal(repository.couples.size, 1)
})

test('updateCoupleFields commit rejects an unbind race', async () => {
  const { repository, service } = harness()
  const request = await requestBetween(service, repository)
  await service.execute('acceptRequest', 'bob', { requestId: request._id, generation: request.generation, role: 'user2' })
  repository.beforeUpdateCoupleFields = ({ openid, coupleId }) => {
    repository.users.get(openid).relationshipStatus = 'single'
    repository.users.get(openid).coupleId = null
    repository.couples.get(coupleId).status = 'archived'
  }

  await expectCode(
    () => service.execute('updateCoupleFields', 'alice', { fields: { loveDate: '2026-01-01' } }),
    'RELATIONSHIP_NOT_FOUND'
  )
})

test('execute rejects invalid payload shapes with a stable code', async () => {
  const { repository, service } = harness()
  seedUser(repository, 'alice', 'ALICE1')
  for (const payload of [null, [], 'bad']) {
    await expectCode(() => service.execute('sendRequest', 'alice', payload), 'INVALID_PAYLOAD')
  }
  await expectCode(() => service.execute('sendRequest', 'alice', {}), 'INVALID_PAYLOAD')
  await expectCode(() => service.execute('acceptRequest', 'alice', { requestId: [], role: 'user1' }), 'INVALID_PAYLOAD')
  await expectCode(() => service.execute('acceptRequest', 'alice', { requestId: 'rq_valid', role: 'user1' }), 'INVALID_PAYLOAD')
  await expectCode(() => service.execute('updateCoupleFields', 'alice', { fields: [] }), 'INVALID_PAYLOAD')
  await expectCode(() => service.execute('updateCoupleFields', 'alice', { fields: {} }), 'INVALID_PAYLOAD')
})

test('updateCoupleFields rejects invalid allowed-field values before repository access', async () => {
  const { repository, service } = harness()
  seedUser(repository, 'alice', 'ALICE1', { relationshipStatus: 'active', coupleId: 'cp_a' })
  const invalid = [
    { user1Name: 'x'.repeat(51) },
    { boyAvatar: 7 },
    { loveDate: '27-06-2026' },
    { metCalendar: 'gregorian' },
    { metLeap: 'false' },
    { user1Status: 'away' },
    { user1StatusTime: -1 },
    { statAdjustment: { togetherOffset: 1, extra: 2 } }
  ]
  for (const fields of invalid) {
    await expectCode(() => service.execute('updateCoupleFields', 'alice', { fields }), 'INVALID_PAYLOAD')
  }
})

test('updateCoupleFields limits personal fields to the callers relationship role', async () => {
  const { repository, service } = harness()
  seedUser(repository, 'alice', 'ALICE1', {
    relationshipStatus: 'active', coupleId: 'cp_active', partnerOpenid: 'bob'
  })
  seedUser(repository, 'bob', 'BOB222', {
    relationshipStatus: 'active', coupleId: 'cp_active', partnerOpenid: 'alice'
  })
  repository.couples.set('cp_active', {
    _id: 'cp_active', status: 'active', memberOpenids: ['alice', 'bob'],
    user1Openid: 'alice', user2Openid: 'bob'
  })

  await expectCode(
    () => service.execute('updateCoupleFields', 'alice', { fields: { user2Name: '伪造昵称' } }),
    'FORBIDDEN'
  )
  await expectCode(
    () => service.execute('updateCoupleFields', 'bob', { fields: { boyAvatar: 'cloud://forged' } }),
    'FORBIDDEN'
  )

  await service.execute('updateCoupleFields', 'alice', { fields: { user1Name: 'Alice', loveDate: '2026-01-01' } })
  await service.execute('updateCoupleFields', 'bob', { fields: { girlAvatar: 'cloud://bob' } })
  assert.equal(repository.couples.get('cp_active').user1Name, 'Alice')
  assert.equal(repository.couples.get('cp_active').girlAvatar, 'cloud://bob')
})
