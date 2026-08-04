const test = require('node:test')
const assert = require('node:assert/strict')
const { CloudRepository } = require('../../cloudfunctions/sharedDataService/lib/cloudRepository')

function clone(value) { return value == null ? value : structuredClone(value) }

class FakeDoc {
  constructor(store, id) { this.store = store; this.id = id }
  async get() { return { data: clone(this.store.get(this.id) || null) } }
  async set({ data }) {
    assert.equal(Object.prototype.hasOwnProperty.call(data, '_id'), false)
    this.store.set(this.id, { ...clone(data), _id: this.id })
  }
  async remove() { this.store.delete(this.id); return { stats: { removed: 1 } } }
}

class FakeQuery {
  constructor(store, conditions = {}, offset = 0, size = Infinity) {
    this.store = store; this.conditions = conditions; this.offset = offset; this.size = size
  }
  where(conditions) { return new FakeQuery(this.store, { ...this.conditions, ...conditions }, this.offset, this.size) }
  skip(offset) { return new FakeQuery(this.store, this.conditions, offset, this.size) }
  limit(size) { return new FakeQuery(this.store, this.conditions, this.offset, size) }
  async get() {
    const rows = [...this.store.values()].filter(document =>
      Object.entries(this.conditions).every(([key, value]) => document[key] === value))
    return { data: clone(rows.slice(this.offset, this.offset + this.size)) }
  }
}

class FakeDatabase {
  constructor(seed = {}) {
    this.stores = new Map(Object.entries(seed).map(([name, rows]) => [
      name, new Map(rows.map(row => [row._id, clone(row)]))
    ]))
    this.transactionCount = 0
  }
  collection(name, stores = this.stores) {
    if (!stores.has(name)) stores.set(name, new Map())
    const query = new FakeQuery(stores.get(name))
    query.doc = id => new FakeDoc(stores.get(name), id)
    return query
  }
  async runTransaction(callback) {
    this.transactionCount += 1
    const working = new Map([...this.stores].map(([name, store]) => [
      name, new Map([...store].map(([id, row]) => [id, clone(row)]))
    ]))
    const transaction = {
      collection: name => {
        const collection = this.collection(name, working)
        collection.where = () => { throw new Error('where is not supported inside transactions') }
        return collection
      }
    }
    const result = await callback(transaction)
    this.stores = working
    return result
  }
  document(collection, id) { return clone(this.stores.get(collection)?.get(id) || null) }
}

class FakeCloud {
  constructor(db) { this.db = db; this.deleted = [] }
  database() { return this.db }
  async deleteFile({ fileList }) {
    this.deleted.push(...fileList)
    return { fileList: fileList.map(fileID => ({ fileID, status: 0 })) }
  }
  async getTempFileURL({ fileList }) {
    return { fileList: fileList.map(fileID => ({ fileID, status: 0, tempFileURL: 'https://temp/' + fileID.split('/').pop() })) }
  }
}

function seed() {
  const db = new FakeDatabase({
    users: [
      { _id: 'alice', relationshipStatus: 'active', coupleId: 'cp_1' },
      { _id: 'bob', relationshipStatus: 'active', coupleId: 'cp_1' }
    ],
    couple: [{
      _id: 'cp_1', status: 'active', memberOpenids: ['alice', 'bob'],
      user1Openid: 'alice', user2Openid: 'bob'
    }]
  })
  return { db, repository: new CloudRepository(new FakeCloud(db)) }
}

test('saveCheckin overwrites deterministic documents and grows the tree once', async () => {
  const { db, repository } = seed()
  const common = { coupleId: 'cp_1', date: '2026-08-03', status: 'together', emotion: '', note: '', place: '', photo: '' }

  await repository.saveCheckin({
    openid: 'alice', partnerOpenid: 'bob', coupleId: 'cp_1',
    checkinId: 'ck_alice', partnerCheckinId: 'ck_bob', record: { ...common, authorOpenid: 'alice' }
  })
  await repository.saveCheckin({
    openid: 'bob', partnerOpenid: 'alice', coupleId: 'cp_1',
    checkinId: 'ck_bob', partnerCheckinId: 'ck_alice', record: { ...common, authorOpenid: 'bob' }
  })
  const repeated = await repository.saveCheckin({
    openid: 'bob', partnerOpenid: 'alice', coupleId: 'cp_1',
    checkinId: 'ck_bob', partnerCheckinId: 'ck_alice', record: { ...common, authorOpenid: 'bob', note: '修改' }
  })

  assert.equal(db.document('companion_records', 'ck_bob').note, '修改')
  assert.equal(repeated.tree.totalGrowth, 15)
  assert.equal(repeated.grew, false)
  assert.equal(db.document('couple_tree', 'cp_1').lastGrowDate, '2026-08-03')
})

test('waterTree and moment likes are idempotent per trusted openid', async () => {
  const { db, repository } = seed()
  db.stores.set('moment', new Map([['m1', {
    _id: 'm1', coupleId: 'cp_1', authorOpenid: 'alice', likedByOpenids: [], comments: []
  }]]))

  await repository.waterTree({ openid: 'alice', coupleId: 'cp_1' })
  const tree = await repository.waterTree({ openid: 'alice', coupleId: 'cp_1' })
  assert.equal(tree.totalGrowth, 5)
  assert.deepEqual(tree.wateredByOpenids, ['alice'])

  const liked = await repository.toggleMomentLike({ openid: 'bob', coupleId: 'cp_1', id: 'm1' })
  const unliked = await repository.toggleMomentLike({ openid: 'bob', coupleId: 'cp_1', id: 'm1' })
  assert.equal(liked.likes, 1)
  assert.equal(unliked.likes, 0)
})

test('retroactive check-ins do not reset watering for the current tree day', async () => {
  const { db, repository } = seed()
  const save = (openid, partnerOpenid, date) => repository.saveCheckin({
    openid, partnerOpenid, coupleId: 'cp_1',
    checkinId: openid + '_' + date, partnerCheckinId: partnerOpenid + '_' + date,
    record: { coupleId: 'cp_1', authorOpenid: openid, date, status: 'together' }
  })

  await save('alice', 'bob', '2026-08-03')
  await save('bob', 'alice', '2026-08-03')
  await repository.waterTree({ openid: 'alice', coupleId: 'cp_1' })
  await save('alice', 'bob', '2026-08-01')
  await save('bob', 'alice', '2026-08-01')

  assert.deepEqual(db.document('couple_tree', 'cp_1').wateredByOpenids, ['alice'])
})

test('goal and comment mutations re-read the protected document in a transaction', async () => {
  const { db, repository } = seed()
  db.stores.set('goals', new Map([['g1', { _id: 'g1', coupleId: 'cp_1', authorOpenid: 'alice', tasks: [] }]]))
  db.stores.set('moment', new Map([['m1', { _id: 'm1', coupleId: 'cp_1', authorOpenid: 'alice', comments: [] }]]))

  const goal = await repository.mutateGoalTask({
    openid: 'bob', coupleId: 'cp_1', id: 'g1', operation: 'add',
    newTaskId: 'task_1', text: '共同完成'
  })
  assert.deepEqual(goal.tasks, [{ id: 'task_1', text: '共同完成', done: false }])

  const comment = { id: 'comment_1', authorOpenid: 'bob', authorName: 'Bob', content: '好', createTime: 1 }
  await repository.addMomentComment({ openid: 'bob', coupleId: 'cp_1', id: 'm1', comment })
  await assert.rejects(
    () => repository.deleteMomentComment({ openid: 'alice', coupleId: 'cp_1', id: 'm1', commentId: 'comment_1' }),
    error => error.code === 'FORBIDDEN'
  )
  await repository.deleteMomentComment({ openid: 'bob', coupleId: 'cp_1', id: 'm1', commentId: 'comment_1' })
  assert.deepEqual(db.document('moment', 'm1').comments, [])
})

test('temporary URL adapter returns only stable public fields', async () => {
  const { repository } = seed()
  const fileID = 'cloud://env/couples/cp_1/moment/a.png'
  assert.deepEqual(await repository.getTempFileUrls([fileID]), [
    { fileID, tempFileURL: 'https://temp/a.png', ok: true }
  ])
})
