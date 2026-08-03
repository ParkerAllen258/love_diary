const test = require('node:test')
const assert = require('node:assert/strict')
const {
  makeCoupleId,
  makeRequestId,
  makeInviteCode,
  normalizeInviteCode,
  purgeAfter,
  isRecoverable,
  sameMembers,
  publicError,
  validateCoupleFields
} = require('../../cloudfunctions/relationshipService/lib/domain')

test('request id is stable for the same two openids regardless of direction', () => {
  assert.equal(makeRequestId('openid-b', 'openid-a'), makeRequestId('openid-a', 'openid-b'))
  assert.match(makeRequestId('openid-a', 'openid-b'), /^rq_[a-f0-9]{32}$/)
  assert.notEqual(makeRequestId('openid-a', 'openid-b'), makeRequestId('openid-a', 'openid-c'))
})

test('couple id is stable for the same two openids regardless of order', () => {
  assert.equal(makeCoupleId('openid-b', 'openid-a'), makeCoupleId('openid-a', 'openid-b'))
  assert.match(makeCoupleId('openid-a', 'openid-b'), /^cp_[a-f0-9]{32}$/)
  assert.notEqual(makeCoupleId('openid-a', 'openid-b'), makeCoupleId('openid-a', 'openid-c'))
})

test('couple id entropy creates a new opaque id without changing member order semantics', () => {
  assert.equal(
    makeCoupleId('openid-b', 'openid-a', 'generation-2'),
    makeCoupleId('openid-a', 'openid-b', 'generation-2')
  )
  assert.notEqual(
    makeCoupleId('openid-a', 'openid-b', 'generation-1'),
    makeCoupleId('openid-a', 'openid-b', 'generation-2')
  )
})

test('invite codes contain six unambiguous uppercase characters', () => {
  let requestedBytes
  const code = makeInviteCode(length => {
    requestedBytes = length
    return Buffer.from([0, 31, 32, 33, 254, 255])
  })

  assert.equal(requestedBytes, 6)
  assert.equal(code, 'A9AB89')
  assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/)
  assert.equal(normalizeInviteCode(' ab-12 '), 'AB12')
})

test('purge deadline is exactly thirty days after archive time', () => {
  const archived = new Date('2026-06-27T00:00:00.000Z')
  assert.equal(purgeAfter(archived).toISOString(), '2026-07-27T00:00:00.000Z')
})

test('archived relationship is recoverable only before the deadline', () => {
  const relation = { status: 'archived', purgeAfter: new Date('2026-07-27T00:00:00.000Z') }
  assert.equal(isRecoverable(relation, new Date('2026-07-26T23:59:59.999Z')), true)
  assert.equal(isRecoverable(relation, new Date('2026-07-27T00:00:00.000Z')), false)
})

test('member comparison is order independent and exact', () => {
  assert.equal(sameMembers(['a', 'b'], ['b', 'a']), true)
  assert.equal(sameMembers(['a', 'b'], ['a', 'c']), false)
  assert.equal(sameMembers(['a', 'b'], ['a']), false)
})

test('public errors expose a stable code without internal details', () => {
  assert.deepEqual(publicError('ALREADY_BOUND'), {
    ok: false,
    error: 'ALREADY_BOUND',
    message: '你或对方已经绑定情侣'
  })
  assert.deepEqual(publicError('DB_ERROR_OR_SECRET'), {
    ok: false,
    error: 'INTERNAL_ERROR',
    message: '操作失败，请稍后重试'
  })
  assert.deepEqual(publicError('INVALID_PAYLOAD'), {
    ok: false,
    error: 'INVALID_PAYLOAD',
    message: '请求参数不正确'
  })
})

test('couple field validation accepts every supported value shape', () => {
  assert.equal(validateCoupleFields({
    user1Name: '',
    user2Name: '小鱼',
    boyAvatar: '',
    girlAvatar: 'cloud://avatar',
    loveDate: '2026-06-27',
    metDate: '',
    metCalendar: 'solar',
    metLeap: false,
    user1Birthday: '2000-01-01',
    user1BirthdayCalendar: 'lunar',
    user1BirthdayLeap: true,
    user2Birthday: '',
    user2BirthdayCalendar: 'solar',
    user2BirthdayLeap: false,
    nextMeetDate: '2026-07-01',
    nextMeetCalendar: 'lunar',
    nextMeetLeap: false,
    user1Status: 'online',
    user1StatusTime: 0,
    user2Status: 'game',
    user2StatusTime: 123,
    statAdjustment: { togetherOffset: -2, apartOffset: 3.5 }
  }), true)
})

test('couple field validation rejects malformed values', () => {
  const invalidFields = [
    { user1Name: 1 },
    { user2Name: 'x'.repeat(51) },
    { boyAvatar: null },
    { girlAvatar: 'x'.repeat(2049) },
    { loveDate: '2026/06/27' },
    { metDate: '2026-6-27' },
    { nextMeetDate: null },
    { metCalendar: 'gregorian' },
    { user1BirthdayCalendar: '' },
    { user2BirthdayLeap: 0 },
    { user1Status: 'away' },
    { user2StatusTime: -1 },
    { user1StatusTime: Infinity },
    { statAdjustment: [] },
    { statAdjustment: { unknown: 1 } },
    { statAdjustment: { togetherOffset: '1' } },
    { statAdjustment: { apartOffset: NaN } }
  ]

  for (const fields of invalidFields) assert.equal(validateCoupleFields(fields), false)
})
