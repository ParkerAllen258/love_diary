const test = require('node:test')
const assert = require('node:assert/strict')

const { createMain } = require('../../cloudfunctions/relationshipService/index')

test('entry point trusts only getWXContext OPENID and ignores event identities', async () => {
  let executed
  const service = {
    async execute(action, openid, payload) {
      executed = { action, openid, payload }
      return { openid }
    }
  }
  const main = createMain({
    cloudApi: { getWXContext: () => ({ OPENID: 'trusted-openid' }) },
    relationshipService: service,
    logger: { error() {} }
  })
  const result = await main({
    action: 'bootstrap', OPENID: 'forged', openid: 'forged', payload: { openid: 'forged' }
  })

  assert.deepEqual(executed, {
    action: 'bootstrap', openid: 'trusted-openid', payload: { openid: 'forged' }
  })
  assert.deepEqual(result, { ok: true, data: { openid: 'trusted-openid' } })
})

test('entry point maps errors publicly without returning internal message or stack', async () => {
  const logs = []
  const main = createMain({
    cloudApi: { getWXContext: () => ({ OPENID: 'alice' }) },
    relationshipService: { execute: async () => { throw Object.assign(new Error('database secret'), { code: 'UNKNOWN_DB_ERROR' }) } },
    logger: { error(details) { logs.push(details) } }
  })

  const result = await main({ action: 'bootstrap' })
  assert.deepEqual(result, { ok: false, error: 'INTERNAL_ERROR', message: '操作失败，请稍后重试' })
  assert.equal(JSON.stringify(result).includes('database secret'), false)
  assert.equal(JSON.stringify(result).includes('stack'), false)
  assert.deepEqual(logs[0], {
    action: 'bootstrap', openid: 'alice', code: 'UNKNOWN_DB_ERROR', message: 'database secret'
  })
})
