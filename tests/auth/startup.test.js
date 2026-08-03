const test = require('node:test')
const assert = require('node:assert/strict')

const AUTH_PATH = require.resolve('../../utils/auth')
const RELATIONSHIP_PATH = require.resolve('../../utils/relationship')

function loadAuth(bootstrapRelationship, showModal = () => {}) {
  delete require.cache[AUTH_PATH]
  const previousRelationship = require.cache[RELATIONSHIP_PATH]
  require.cache[RELATIONSHIP_PATH] = {
    id: RELATIONSHIP_PATH,
    filename: RELATIONSHIP_PATH,
    loaded: true,
    exports: { bootstrapRelationship }
  }

  const app = { globalData: {} }
  global.getApp = () => app
  global.wx = { showModal }
  const auth = require(AUTH_PATH)

  if (previousRelationship) require.cache[RELATIONSHIP_PATH] = previousRelationship
  else delete require.cache[RELATIONSHIP_PATH]
  return { app, auth }
}

test.afterEach(() => {
  delete require.cache[AUTH_PATH]
  delete global.getApp
  delete global.wx
})

test('concurrent startup callers share one relationship bootstrap', async () => {
  let calls = 0
  let resolveBootstrap
  const bootstrap = new Promise(resolve => { resolveBootstrap = resolve })
  const { app, auth } = loadAuth(() => {
    calls += 1
    return bootstrap
  })

  const first = auth.initAuth()
  const second = auth.initAuth()
  assert.equal(first, second)
  assert.equal(calls, 1)

  resolveBootstrap({ _id: 'alice', inviteCode: 'ALICE1', relationshipStatus: 'single' })
  await first
  assert.equal(app.globalData.openid, 'alice')
  assert.equal(app.globalData.myCode, 'ALICE1')
  assert.equal(app.globalData.authReady, first)
})

test('failed startup can retry without reusing the rejected promise', async () => {
  let calls = 0
  let modalCalls = 0
  const { auth } = loadAuth(
    () => {
      calls += 1
      if (calls === 1) return Promise.reject(new Error('offline'))
      return Promise.resolve({ _id: 'alice', inviteCode: 'ALICE1', relationshipStatus: 'single' })
    },
    options => {
      modalCalls += 1
      options.success({ confirm: true })
    }
  )

  const snapshot = await auth.waitForAuth()
  assert.equal(snapshot._id, 'alice')
  assert.equal(calls, 2)
  assert.equal(modalCalls, 1)
})
