const test = require('node:test')
const assert = require('node:assert/strict')
const { createMain } = require('../../cloudfunctions/sharedDataService/index')

test('entry point trusts getWXContext and ignores forged identities', async () => {
  let received
  const main = createMain({
    cloudApi: { getWXContext: () => ({ OPENID: 'trusted-openid' }) },
    sharedDataService: {
      execute: async (action, openid, payload) => {
        received = { action, openid, payload }
        return { deleted: true }
      }
    },
    logger: { error() {} }
  })

  const result = await main({
    action: 'deleteOwnedRecord', openid: 'forged', OPENID: 'forged', coupleId: 'cp_forged',
    payload: { collection: 'moment', id: 'm1', openid: 'forged', coupleId: 'cp_forged' }
  })

  assert.deepEqual(received, {
    action: 'deleteOwnedRecord',
    openid: 'trusted-openid',
    payload: { collection: 'moment', id: 'm1', openid: 'forged', coupleId: 'cp_forged' }
  })
  assert.deepEqual(result, { ok: true, data: { deleted: true } })
})

test('entry point returns stable public errors without internal details', async () => {
  const logs = []
  const main = createMain({
    cloudApi: { getWXContext: () => ({ OPENID: 'alice' }) },
    sharedDataService: { execute: async () => { throw Object.assign(new Error('database secret'), { code: 'UNKNOWN' }) } },
    logger: { error: value => logs.push(value) }
  })

  const result = await main({ action: 'deleteOwnedRecord', payload: {} })
  assert.deepEqual(result, { ok: false, error: 'INTERNAL_ERROR', message: '操作失败，请稍后重试' })
  assert.equal(JSON.stringify(result).includes('database secret'), false)
  assert.equal(logs.length, 1)
})
