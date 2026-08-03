const test = require('node:test')
const assert = require('node:assert/strict')

const MODULE_PATH = require.resolve('../../utils/relationship')

function loadClient({ response } = {}) {
  const storage = new Map()
  const calls = []
  global.wx = {
    getStorageSync(key) { return storage.get(key) },
    setStorageSync(key, value) { storage.set(key, value) },
    removeStorageSync(key) { storage.delete(key) },
    cloud: {
      async callFunction(options) {
        calls.push(options)
        return { result: response }
      }
    }
  }
  delete require.cache[MODULE_PATH]
  return { client: require(MODULE_PATH), storage, calls }
}

test.afterEach(() => {
  delete global.wx
  delete global.getApp
  delete require.cache[MODULE_PATH]
})

test('bootstrap stores openid invite code coupleId and partner state', async () => {
  const snapshot = {
    _id: 'alice',
    inviteCode: 'ABC234',
    coupleId: 'cp_active',
    relationshipStatus: 'active',
    partnerOpenid: 'bob',
    myRole: 'user1',
    partner: { _id: 'bob', inviteCode: 'XYZ789' },
    couple: { user1Name: 'Alice', user2Name: 'Bob', boyAvatar: 'a.png', girlAvatar: 'b.png' }
  }
  const { client, storage } = loadClient({ response: { ok: true, data: snapshot } })

  assert.deepEqual(await client.bootstrapRelationship(), snapshot)
  assert.equal(storage.get('openid'), 'alice')
  assert.equal(storage.get('myCode'), 'ABC234')
  assert.equal(storage.get('coupleId'), 'cp_active')
  assert.equal(storage.get('partnerOpenid'), 'bob')
  assert.equal(storage.get('partnerCode'), 'XYZ789')
  assert.equal(storage.get('hasCouple'), true)
  assert.equal(storage.get('myRole'), 'user1')
  assert.equal(storage.get('myName'), 'Alice')
  assert.equal(storage.get('partnerName'), 'Bob')
})

test('bootstrap clears stale couple cache for a single user', async () => {
  const { client, storage } = loadClient({
    response: {
      ok: true,
      data: { _id: 'alice', inviteCode: 'ABC234', coupleId: null, relationshipStatus: 'single' }
    }
  })
  storage.set('coupleId', 'stale')
  storage.set('partnerOpenid', 'stale-bob')
  storage.set('partnerCode', 'STALE1')
  storage.set('hasCouple', true)

  await client.bootstrapRelationship()

  assert.equal(storage.get('openid'), 'alice')
  assert.equal(storage.get('myCode'), 'ABC234')
  assert.equal(storage.has('coupleId'), false)
  assert.equal(storage.has('partnerOpenid'), false)
  assert.equal(storage.has('partnerCode'), false)
  assert.equal(storage.get('hasCouple'), false)
})

test('callRelationship sends action and payload without openid or coupleId authority fields', async () => {
  const { client, calls } = loadClient({ response: { ok: true, data: { sent: true } } })

  assert.deepEqual(await client.callRelationship('sendRequest', { inviteCode: 'ABC234' }), { sent: true })
  assert.deepEqual(calls, [{
    name: 'relationshipService',
    data: { action: 'sendRequest', payload: { inviteCode: 'ABC234' } }
  }])
  assert.equal(JSON.stringify(calls).includes('openid'), false)
  assert.equal(JSON.stringify(calls).includes('coupleId'), false)
})

test('clearRelationshipCache removes every relationship-derived key', () => {
  const { client, storage } = loadClient()
  for (const key of client.RELATIONSHIP_CACHE_KEYS) storage.set(key, 'stale')

  client.clearRelationshipCache()

  assert.deepEqual([...storage.keys()], [])
})

test('errorMessage maps stable cloud errors and falls back safely', () => {
  const { client } = loadClient()

  assert.equal(client.errorMessage({ code: 'ALREADY_BOUND' }), '你或对方已经绑定情侣')
  assert.equal(client.errorMessage({ code: 'UNKNOWN' }), '操作失败，请稍后重试')
  assert.equal(client.errorMessage(), '操作失败，请稍后重试')
})
