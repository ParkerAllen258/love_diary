const test = require('node:test')
const assert = require('node:assert/strict')

const {
  SHARED_COLLECTIONS,
  FILE_FIELDS,
  cleanupExpired
} = require('../../cloudfunctions/cleanupExpiredCouples/lib/cleanup')
const { createMain, CloudCleanupRepository } = require('../../cloudfunctions/cleanupExpiredCouples/index')

const NOW = new Date('2026-06-27T00:00:00.000Z')

class MemoryCleanupRepository {
  constructor({ couples = [], records = {}, files = [], failures = {} } = {}) {
    this.couples = new Map(couples.map(couple => [couple._id, structuredClone(couple)]))
    this.records = new Map(SHARED_COLLECTIONS.map(name => [
      name,
      (records[name] || []).map(record => structuredClone(record))
    ]))
    this.files = new Set(files)
    this.failures = failures
    this.calls = []
  }

  async listExpiredArchived(now, limit) {
    this.calls.push(['listExpiredArchived', now, limit])
    return [...this.couples.values()]
      .filter(couple => couple.status === 'archived' && new Date(couple.purgeAfter) <= now)
      .slice(0, limit)
      .map(couple => structuredClone(couple))
  }

  async listSharedRecords(collection, coupleId) {
    this.calls.push(['listSharedRecords', collection, coupleId])
    return this.records.get(collection).filter(record => record.coupleId === coupleId)
      .map(record => structuredClone(record))
  }

  async deleteFile(fileID) {
    this.calls.push(['deleteFile', fileID])
    if (this.failures.file === fileID) throw Object.assign(new Error('storage unavailable'), { code: 'STORAGE_ERROR' })
    if (!this.files.has(fileID)) throw Object.assign(new Error('file not found'), { code: 'FILE_NOT_FOUND' })
    this.files.delete(fileID)
    return true
  }

  async removeSharedRecords(collection, coupleId) {
    this.calls.push(['removeSharedRecords', collection, coupleId])
    if (this.failures.collection === collection) throw new Error('collection delete failed')
    const records = this.records.get(collection)
    const kept = records.filter(record => record.coupleId !== coupleId)
    this.records.set(collection, kept)
    return records.length - kept.length
  }

  async removeRelationship(coupleId) {
    this.calls.push(['removeRelationship', coupleId])
    this.couples.delete(coupleId)
    return true
  }
}

function archived(_id, purgeAfter = '2026-06-26T00:00:00.000Z') {
  return { _id, status: 'archived', purgeAfter }
}

test('cleanup ignores active and not-yet-expired relationships and asks for at most 20', async () => {
  const repository = new MemoryCleanupRepository({
    couples: [
      { _id: 'active', status: 'active', purgeAfter: '2026-06-01T00:00:00.000Z' },
      archived('future', '2026-06-28T00:00:00.000Z')
    ]
  })

  assert.deepEqual(await cleanupExpired(repository, NOW), {
    relationshipsPurged: 0, recordsDeleted: 0, filesDeleted: 0
  })
  assert.deepEqual(repository.calls, [['listExpiredArchived', NOW, 20]])
})

test('cleanup enforces the 20 relationship cap even if a repository returns too many', async () => {
  const repository = new MemoryCleanupRepository({
    couples: Array.from({ length: 21 }, (_, index) => archived(`expired-${index}`))
  })
  repository.listExpiredArchived = async () => [...repository.couples.values()]

  const result = await cleanupExpired(repository, NOW)

  assert.equal(result.relationshipsPurged, 20)
  assert.equal(repository.couples.size, 1)
})

test('cleanup removes every configured shared collection by coupleId', async () => {
  assert.deepEqual(SHARED_COLLECTIONS, [
    'moment', 'diaries', 'letter', 'album', 'album_folders',
    'money', 'cost', 'note', 'schedule', 'goals',
    'companion_records', 'couple_tree'
  ])
  const records = Object.fromEntries(SHARED_COLLECTIONS.map((name, index) => [name, [
    { _id: `${name}-mine`, coupleId: 'expired' },
    { _id: `${name}-other`, coupleId: 'other' },
    ...(index === 0 ? [{ _id: 'extra', coupleId: 'expired' }] : [])
  ]]))
  const repository = new MemoryCleanupRepository({ couples: [archived('expired')], records })

  const result = await cleanupExpired(repository, NOW)

  assert.deepEqual(result, { relationshipsPurged: 1, recordsDeleted: 13, filesDeleted: 0 })
  for (const collection of SHARED_COLLECTIONS) {
    assert.deepEqual(repository.records.get(collection), [{ _id: `${collection}-other`, coupleId: 'other' }])
  }
  assert.equal(repository.couples.has('expired'), false)
})

test('cleanup collects every configured file field and deletes duplicate file ids once', async () => {
  assert.deepEqual(FILE_FIELDS, {
    moment: ['images'],
    diaries: ['imageUrl'],
    album: ['fileID'],
    album_folders: ['coverFileID'],
    companion_records: ['photo']
  })
  const records = {
    moment: [{ coupleId: 'expired', images: ['cloud://a', 'cloud://shared', '', null] }],
    diaries: [{ coupleId: 'expired', imageUrl: 'cloud://b' }],
    album: [{ coupleId: 'expired', fileID: 'cloud://shared' }],
    album_folders: [{ coupleId: 'expired', coverFileID: 'cloud://c' }],
    companion_records: [{ coupleId: 'expired', photo: ['cloud://d', 'cloud://a'] }]
  }
  const fileIDs = ['cloud://a', 'cloud://shared', 'cloud://b', 'cloud://c', 'cloud://d']
  const repository = new MemoryCleanupRepository({ couples: [archived('expired')], records, files: fileIDs })

  const result = await cleanupExpired(repository, NOW)

  assert.equal(result.filesDeleted, 5)
  assert.deepEqual(
    repository.calls.filter(([method]) => method === 'deleteFile').map(([, fileID]) => fileID).sort(),
    [...fileIDs].sort()
  )
})

test('cleanup deletes the relationship only after record and file cleanup succeeds', async t => {
  await t.test('storage errors other than not-found preserve records and relationship', async () => {
    const repository = new MemoryCleanupRepository({
      couples: [archived('expired')],
      records: { album: [{ _id: 'photo', coupleId: 'expired', fileID: 'cloud://blocked' }] },
      files: ['cloud://blocked'],
      failures: { file: 'cloud://blocked' }
    })

    await assert.rejects(() => cleanupExpired(repository, NOW), /storage unavailable/)
    assert.equal(repository.couples.has('expired'), true)
    assert.equal(repository.records.get('album').length, 1)
    assert.equal(repository.calls.some(([method]) => method === 'removeRelationship'), false)
  })

  await t.test('generic cloud deletion failures with status -1 preserve records and relationship', async () => {
    const cloudRepository = new CloudCleanupRepository({
      database() { return {} },
      async deleteFile() {
        return { fileList: [{ status: -1, errMsg: 'permission denied' }] }
      }
    })
    const repository = new MemoryCleanupRepository({
      couples: [archived('expired')],
      records: { album: [{ _id: 'photo', coupleId: 'expired', fileID: 'cloud://blocked' }] },
      files: ['cloud://blocked']
    })
    repository.deleteFile = fileID => cloudRepository.deleteFile(fileID)

    await assert.rejects(() => cleanupExpired(repository, NOW), /permission denied/)
    assert.equal(repository.couples.has('expired'), true)
    assert.equal(repository.records.get('album').length, 1)
    assert.equal(repository.calls.some(([method]) => method === 'removeSharedRecords'), false)
    assert.equal(repository.calls.some(([method]) => method === 'removeRelationship'), false)
  })

  await t.test('record deletion errors preserve the relationship', async () => {
    const repository = new MemoryCleanupRepository({
      couples: [archived('expired')],
      records: { money: [{ _id: 'money', coupleId: 'expired' }] },
      failures: { collection: 'money' }
    })

    await assert.rejects(() => cleanupExpired(repository, NOW), /collection delete failed/)
    assert.equal(repository.couples.has('expired'), true)
    assert.equal(repository.calls.some(([method]) => method === 'removeRelationship'), false)
  })
})

test('cleanup remains successful when records or files are already absent and on repeat runs', async () => {
  const repository = new MemoryCleanupRepository({
    couples: [archived('expired')],
    records: { album: [{ _id: 'gone-file', coupleId: 'expired', fileID: 'cloud://already-gone' }] }
  })

  assert.deepEqual(await cleanupExpired(repository, NOW), {
    relationshipsPurged: 1, recordsDeleted: 1, filesDeleted: 0
  })
  assert.deepEqual(await cleanupExpired(repository, NOW), {
    relationshipsPurged: 0, recordsDeleted: 0, filesDeleted: 0
  })
})

test('entry point accepts only timer events or a matching deployment token and ignores coupleId', async () => {
  const invocations = []
  const cleanup = async (repository, now) => {
    invocations.push({ repository, now })
    return { relationshipsPurged: 1, recordsDeleted: 2, filesDeleted: 3, secret: 'not returned' }
  }
  const repository = { marker: 'repo' }
  const clock = () => NOW
  const main = createMain({ repository, cleanup, clock, cleanupToken: 'deploy-secret', logger: { error() {} } })

  assert.deepEqual(await main({}), { ok: false, error: 'FORBIDDEN' })
  assert.deepEqual(await main({ type: 'client', token: 'wrong' }), { ok: false, error: 'FORBIDDEN' })
  assert.deepEqual(await main({ Type: 'Timer', coupleId: 'attacker-choice' }), {
    ok: true, data: { relationshipsPurged: 1, recordsDeleted: 2, filesDeleted: 3 }
  })
  assert.deepEqual(await main({ type: 'timer', coupleId: 'another-choice' }), {
    ok: true, data: { relationshipsPurged: 1, recordsDeleted: 2, filesDeleted: 3 }
  })
  assert.deepEqual(await main({ token: 'deploy-secret', coupleId: 'third-choice' }), {
    ok: true, data: { relationshipsPurged: 1, recordsDeleted: 2, filesDeleted: 3 }
  })
  assert.equal(invocations.length, 3)
  assert.deepEqual(invocations.map(({ repository: calledRepository }) => calledRepository), [repository, repository, repository])
  assert.deepEqual(invocations.map(({ now }) => now), [NOW, NOW, NOW])
})

test('entry point rejects a client caller that forges a timer event', async () => {
  let cleanupCalls = 0
  const main = createMain({
    repository: {},
    cleanup: async () => {
      cleanupCalls += 1
      return { relationshipsPurged: 0, recordsDeleted: 0, filesDeleted: 0 }
    },
    getCallerOpenid: () => 'attacker-openid',
    logger: { error() {} }
  })

  assert.deepEqual(await main({ Type: 'Timer' }), { ok: false, error: 'FORBIDDEN' })
  assert.equal(cleanupCalls, 0)
})

test('cloud repository queries only archived relationships due by now with a limit of 20', async () => {
  const observed = {}
  const query = {
    where(conditions) { observed.conditions = conditions; return this },
    limit(limit) { observed.limit = limit; return this },
    async get() { return { data: [archived('expired')] } }
  }
  const db = {
    command: { lte(value) { return { operator: 'lte', value } } },
    collection(name) { observed.collection = name; return query }
  }
  const repository = new CloudCleanupRepository({ database: () => db })

  assert.deepEqual(await repository.listExpiredArchived(NOW, 20), [archived('expired')])
  assert.equal(observed.collection, 'couple')
  assert.deepEqual(observed.conditions, {
    status: 'archived', purgeAfter: { operator: 'lte', value: NOW }
  })
  assert.equal(observed.limit, 20)
})
