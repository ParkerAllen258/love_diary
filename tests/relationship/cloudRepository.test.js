const test = require('node:test')
const assert = require('node:assert/strict')

const { CloudRepository } = require('../../cloudfunctions/relationshipService/lib/cloudRepository')
const { purgeAfter } = require('../../cloudfunctions/relationshipService/lib/domain')

const NOW = new Date('2026-06-27T00:00:00.000Z')

function clone(value) {
  return value == null ? value : structuredClone(value)
}

class FakeDoc {
  constructor(store, id) {
    this.store = store
    this.id = id
  }

  async get() {
    return { data: clone(this.store.get(this.id) || null) }
  }

  async set(data) {
    assert.equal(Object.prototype.hasOwnProperty.call(data, '_id'), false)
    this.store.set(this.id, { ...clone(data), _id: this.id })
    return { _id: this.id }
  }

  async update({ data }) {
    if (!this.store.has(this.id)) throw new Error('document not found')
    this.store.set(this.id, { ...this.store.get(this.id), ...clone(data), _id: this.id })
    return { updated: 1 }
  }
}

class FakeQuery {
  constructor(store, conditions = {}) {
    this.store = store
    this.conditions = conditions
  }

  where(conditions) {
    return new FakeQuery(this.store, { ...this.conditions, ...conditions })
  }

  async get() {
    const data = [...this.store.values()].filter(document =>
      Object.entries(this.conditions).every(([key, value]) => document[key] === value))
    return { data: clone(data) }
  }
}

class FakeDatabase {
  constructor(seed = {}) {
    this.stores = new Map(Object.entries(seed).map(([name, documents]) => [
      name,
      new Map(documents.map(document => [document._id, clone(document)]))
    ]))
    this.transactionCount = 0
    this.transactionWhereCount = 0
  }

  collection(name, stores = this.stores) {
    if (!stores.has(name)) stores.set(name, new Map())
    const store = stores.get(name)
    const query = new FakeQuery(store)
    query.doc = id => new FakeDoc(store, id)
    return query
  }

  async runTransaction(callback) {
    this.transactionCount += 1
    const working = new Map([...this.stores].map(([name, store]) => [
      name,
      new Map([...store].map(([id, document]) => [id, clone(document)]))
    ]))
    const transaction = {
      collection: name => {
        const collection = this.collection(name, working)
        collection.where = () => {
          this.transactionWhereCount += 1
          throw new Error('where is not supported inside CloudBase transactions')
        }
        return collection
      }
    }
    const result = await callback(transaction)
    this.stores = working
    return result
  }

  document(collection, id) {
    return clone(this.stores.get(collection)?.get(id) || null)
  }
}

function expectCode(operation, code) {
  return assert.rejects(operation, error => error.code === code)
}

function singleUser(openid, inviteCode, fields = {}) {
  return {
    _id: openid,
    inviteCode,
    relationshipStatus: 'single',
    coupleId: null,
    partnerOpenid: null,
    ...fields
  }
}

function pendingRequest(fields = {}) {
  return {
    _id: 'rq_pair',
    fromOpenid: 'alice',
    toOpenid: 'bob',
    generation: 'generation-1',
    status: 'pending',
    createdAt: NOW,
    expiresAt: new Date('2026-07-04T00:00:00.000Z'),
    ...fields
  }
}

test('createUserWithInvite reserves invite and user in one transaction', async () => {
  const db = new FakeDatabase()
  const repository = new CloudRepository(db)
  const user = singleUser('alice', 'ALICE1')

  assert.deepEqual(await repository.createUserWithInvite(user), user)
  assert.equal(db.transactionCount, 1)
  assert.deepEqual(db.document('invite', 'ALICE1'), {
    _id: 'ALICE1', openid: 'alice', createdAt: undefined
  })
  assert.deepEqual(db.document('users', 'alice'), user)

  await expectCode(
    () => repository.createUserWithInvite(singleUser('mallory', 'ALICE1')),
    'INVITE_COLLISION'
  )
  assert.equal(db.document('users', 'mallory'), null)
})

test('reserveRequest replaces expired and terminal generations but rejects an active request', async () => {
  const db = new FakeDatabase({
    users: [singleUser('alice', 'ALICE1'), singleUser('bob', 'BOB222')],
    coupleRequest: [pendingRequest()]
  })
  const repository = new CloudRepository(db)

  await expectCode(() => repository.reserveRequest(pendingRequest({ generation: 'generation-2' })), 'REQUEST_EXISTS')
  db.stores.get('coupleRequest').get('rq_pair').expiresAt = new Date('2026-06-26T00:00:00.000Z')
  assert.equal((await repository.reserveRequest(pendingRequest({ generation: 'generation-2' }))).generation, 'generation-2')
  db.stores.get('coupleRequest').get('rq_pair').status = 'cancelled'
  assert.equal((await repository.reserveRequest(pendingRequest({ generation: 'generation-3' }))).generation, 'generation-3')
})

test('resolveRequest checks generation and actor role inside its transaction', async () => {
  const db = new FakeDatabase({ coupleRequest: [pendingRequest()] })
  const repository = new CloudRepository(db)

  await expectCode(() => repository.resolveRequest({
    requestId: 'rq_pair', openid: 'alice', action: 'rejected', generation: 'generation-1', now: NOW
  }), 'FORBIDDEN')
  await expectCode(() => repository.resolveRequest({
    requestId: 'rq_pair', openid: 'bob', action: 'rejected', generation: 'stale', now: NOW
  }), 'REQUEST_NOT_FOUND')
  const resolved = await repository.resolveRequest({
    requestId: 'rq_pair', openid: 'bob', action: 'rejected', generation: 'generation-1', now: NOW
  })
  assert.equal(resolved.status, 'rejected')
})

test('saveAcceptedRelationship re-reads request users and archive then persists an idempotent result', async () => {
  const archived = {
    _id: 'cp_archived', status: 'archived', memberOpenids: ['bob', 'alice'],
    purgeAfter: new Date('2026-07-01T00:00:00.000Z'), archivedAt: new Date('2026-06-01T00:00:00.000Z')
  }
  const db = new FakeDatabase({
    users: [
      singleUser('alice', 'ALICE1', { lastArchivedCoupleId: 'cp_archived' }),
      singleUser('bob', 'BOB222', { lastArchivedCoupleId: 'cp_archived' })
    ],
    coupleRequest: [pendingRequest()],
    couple: [archived]
  })
  const repository = new CloudRepository(db)
  const couple = {
    ...archived, status: 'active', user1Openid: 'alice', user2Openid: 'bob',
    archivedAt: null, purgeAfter: null, restoredFromArchive: true
  }
  const fromUser = singleUser('alice', 'ALICE1', { relationshipStatus: 'active', coupleId: 'cp_archived', partnerOpenid: 'bob' })
  const toUser = singleUser('bob', 'BOB222', { relationshipStatus: 'active', coupleId: 'cp_archived', partnerOpenid: 'alice' })
  const input = {
    requestId: 'rq_pair', generation: 'generation-1', acceptedBy: 'bob', role: 'user2',
    fromUser, toUser, couple, now: NOW
  }

  const result = await repository.saveAcceptedRelationship(input)
  assert.equal(result.coupleId, 'cp_archived')
  assert.equal(result.myRole, 'user2')
  assert.equal(db.document('users', 'alice').coupleId, 'cp_archived')
  assert.equal(db.document('couple', 'cp_archived').restoredFromArchive, undefined)
  assert.deepEqual(db.document('coupleRequest', 'rq_pair').result, result)
  assert.deepEqual(await repository.saveAcceptedRelationship(input), result)
  assert.equal(db.transactionWhereCount, 0)
})

test('saveAcceptedRelationship restores by shared archive pointer without transaction queries', async () => {
  const archived = {
    _id: 'cp_archived', status: 'archived', memberOpenids: ['alice', 'bob'],
    purgeAfter: new Date('2026-07-01T00:00:00.000Z')
  }
  const db = new FakeDatabase({
    users: [
      singleUser('alice', 'ALICE1', { lastArchivedCoupleId: archived._id }),
      singleUser('bob', 'BOB222', { lastArchivedCoupleId: archived._id })
    ],
    coupleRequest: [pendingRequest()],
    couple: [archived]
  })

  const result = await new CloudRepository(db).saveAcceptedRelationship({
    requestId: 'rq_pair', generation: 'generation-1', acceptedBy: 'bob', role: 'user2', now: NOW,
    fromUser: singleUser('alice', 'ALICE1', {
      relationshipStatus: 'active', coupleId: archived._id, partnerOpenid: 'bob'
    }),
    toUser: singleUser('bob', 'BOB222', {
      relationshipStatus: 'active', coupleId: archived._id, partnerOpenid: 'alice'
    }),
    couple: {
      ...archived, status: 'active', user1Openid: 'alice', user2Openid: 'bob',
      restoredFromArchive: true
    }
  })

  assert.equal(result.coupleId, archived._id)
  assert.equal(db.transactionWhereCount, 0)
})

test('saveAcceptedRelationship rejects commit-time request, user, and archive races', async t => {
  async function attempt(mutator, expectedCode) {
    const db = new FakeDatabase({
      users: [
        singleUser('alice', 'ALICE1', { lastArchivedCoupleId: 'cp_archived' }),
        singleUser('bob', 'BOB222', { lastArchivedCoupleId: 'cp_archived' })
      ],
      coupleRequest: [pendingRequest()],
      couple: [{
        _id: 'cp_archived', status: 'archived', memberOpenids: ['alice', 'bob'],
        purgeAfter: new Date('2026-07-01T00:00:00.000Z')
      }]
    })
    mutator(db)
    const repository = new CloudRepository(db)
    await expectCode(() => repository.saveAcceptedRelationship({
      requestId: 'rq_pair', generation: 'generation-1', acceptedBy: 'bob', role: 'user2', now: NOW,
      fromUser: singleUser('alice', 'ALICE1', { relationshipStatus: 'active', coupleId: 'cp_archived', partnerOpenid: 'bob' }),
      toUser: singleUser('bob', 'BOB222', { relationshipStatus: 'active', coupleId: 'cp_archived', partnerOpenid: 'alice' }),
      couple: { _id: 'cp_archived', status: 'active', memberOpenids: ['alice', 'bob'], restoredFromArchive: true }
    }), expectedCode)
  }

  await t.test('request generation changed', () => attempt(db => {
    db.stores.get('coupleRequest').get('rq_pair').generation = 'new-generation'
  }, 'REQUEST_NOT_FOUND'))
  await t.test('user became bound', () => attempt(db => {
    db.stores.get('users').get('alice').coupleId = 'cp_other'
  }, 'ALREADY_BOUND'))
  await t.test('archive became unrecoverable', () => attempt(db => {
    db.stores.get('couple').get('cp_archived').purgeAfter = new Date('2026-06-26T00:00:00.000Z')
  }, 'RELATIONSHIP_NOT_FOUND'))
})

test('saveAcceptedRelationship does not restore when archive pointers disagree', async () => {
  const db = new FakeDatabase({
    users: [
      singleUser('alice', 'ALICE1', { lastArchivedCoupleId: 'cp_alice' }),
      singleUser('bob', 'BOB222', { lastArchivedCoupleId: 'cp_bob' })
    ],
    coupleRequest: [pendingRequest()],
    couple: [{
      _id: 'cp_alice', status: 'archived', memberOpenids: ['alice', 'bob'],
      purgeAfter: new Date('2026-07-01T00:00:00.000Z')
    }]
  })

  const result = await new CloudRepository(db).saveAcceptedRelationship({
    requestId: 'rq_pair', generation: 'generation-1', acceptedBy: 'bob', role: 'user2', now: NOW,
    fromUser: singleUser('alice', 'ALICE1', {
      relationshipStatus: 'active', coupleId: 'cp_new', partnerOpenid: 'bob'
    }),
    toUser: singleUser('bob', 'BOB222', {
      relationshipStatus: 'active', coupleId: 'cp_new', partnerOpenid: 'alice'
    }),
    couple: {
      _id: 'cp_new', status: 'active', memberOpenids: ['alice', 'bob'],
      user1Openid: 'alice', user2Openid: 'bob'
    }
  })

  assert.equal(result.coupleId, 'cp_new')
  assert.equal(db.transactionWhereCount, 0)
})

test('saveAcceptedRelationship creates a new relation when the pointed archive expired', async () => {
  const db = new FakeDatabase({
    users: [
      singleUser('alice', 'ALICE1', { lastArchivedCoupleId: 'cp_expired' }),
      singleUser('bob', 'BOB222', { lastArchivedCoupleId: 'cp_expired' })
    ],
    coupleRequest: [pendingRequest()],
    couple: [{
      _id: 'cp_expired', status: 'archived', memberOpenids: ['alice', 'bob'],
      purgeAfter: new Date('2026-06-26T00:00:00.000Z')
    }]
  })

  const result = await new CloudRepository(db).saveAcceptedRelationship({
    requestId: 'rq_pair', generation: 'generation-1', acceptedBy: 'bob', role: 'user2', now: NOW,
    fromUser: singleUser('alice', 'ALICE1', {
      relationshipStatus: 'active', coupleId: 'cp_new', partnerOpenid: 'bob'
    }),
    toUser: singleUser('bob', 'BOB222', {
      relationshipStatus: 'active', coupleId: 'cp_new', partnerOpenid: 'alice'
    }),
    couple: {
      _id: 'cp_new', status: 'active', memberOpenids: ['alice', 'bob'],
      user1Openid: 'alice', user2Openid: 'bob'
    }
  })

  assert.equal(result.coupleId, 'cp_new')
  assert.equal(db.document('couple', 'cp_expired').status, 'archived')
  assert.equal(db.transactionWhereCount, 0)
})

test('archiveRelationship revalidates both active members before clearing them', async () => {
  const activeCouple = { _id: 'cp_active', status: 'active', memberOpenids: ['alice', 'bob'] }
  const db = new FakeDatabase({
    users: [
      singleUser('alice', 'ALICE1', { relationshipStatus: 'active', coupleId: 'cp_active', partnerOpenid: 'bob' }),
      singleUser('bob', 'BOB222', { relationshipStatus: 'active', coupleId: 'cp_active', partnerOpenid: 'alice' })
    ],
    couple: [activeCouple]
  })
  const repository = new CloudRepository(db)
  const archived = await repository.archiveRelationship({ callerOpenid: 'alice', coupleId: 'cp_active', now: NOW })
  assert.equal(archived.status, 'archived')
  assert.equal(archived.purgeAfter.toISOString(), purgeAfter(NOW).toISOString())
  assert.equal(db.document('users', 'alice').coupleId, null)
  assert.equal(db.document('users', 'bob').coupleId, null)

  const raced = new FakeDatabase({
    users: [
      singleUser('alice', 'ALICE1', { relationshipStatus: 'active', coupleId: 'cp_active', partnerOpenid: 'bob' }),
      singleUser('bob', 'BOB222', { relationshipStatus: 'active', coupleId: 'cp_other', partnerOpenid: 'carol' })
    ],
    couple: [activeCouple]
  })
  await expectCode(
    () => new CloudRepository(raced).archiveRelationship({ callerOpenid: 'alice', coupleId: 'cp_active', now: NOW }),
    'RELATIONSHIP_NOT_FOUND'
  )
})

test('updateCoupleFields authorizes active membership atomically', async () => {
  const db = new FakeDatabase({
    users: [singleUser('alice', 'ALICE1', { relationshipStatus: 'active', coupleId: 'cp_active', partnerOpenid: 'bob' })],
    couple: [{ _id: 'cp_active', status: 'active', memberOpenids: ['alice', 'bob'], loveDate: '' }]
  })
  const repository = new CloudRepository(db)
  const saved = await repository.updateCoupleFields({
    openid: 'alice', coupleId: 'cp_active', fields: { loveDate: '2026-01-01' }, updatedAt: NOW
  })
  assert.equal(saved.loveDate, '2026-01-01')

  db.stores.get('users').get('alice').coupleId = 'cp_other'
  await expectCode(() => repository.updateCoupleFields({
    openid: 'alice', coupleId: 'cp_active', fields: { loveDate: '2026-02-02' }, updatedAt: NOW
  }), 'RELATIONSHIP_NOT_FOUND')
})

test('findArchivedCouple follows only a shared pointer and validates exact members and status', async () => {
  const db = new FakeDatabase({
    users: [
      singleUser('alice', 'ALICE1', { lastArchivedCoupleId: 'shared' }),
      singleUser('bob', 'BOB222', { lastArchivedCoupleId: 'shared' })
    ],
    couple: [
      { _id: 'shared', status: 'archived', memberOpenids: ['bob', 'alice'] }
    ]
  })
  const found = await new CloudRepository(db).findArchivedCouple(['alice', 'bob'])
  assert.equal(found._id, 'shared')

  db.stores.get('users').get('bob').lastArchivedCoupleId = 'different'
  assert.equal(await new CloudRepository(db).findArchivedCouple(['alice', 'bob']), null)

  db.stores.get('users').get('bob').lastArchivedCoupleId = 'shared'
  db.stores.get('couple').get('shared').memberOpenids = ['alice', 'carol']
  assert.equal(await new CloudRepository(db).findArchivedCouple(['alice', 'bob']), null)
})
