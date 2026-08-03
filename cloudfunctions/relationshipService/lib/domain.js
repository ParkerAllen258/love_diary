const crypto = require('node:crypto')

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const CALENDARS = new Set(['solar', 'lunar'])
const STATUSES = new Set(['online', 'busy', 'class', 'sleep', 'eat', 'sport', 'miss', 'movie', 'game'])
const NAME_FIELDS = new Set(['user1Name', 'user2Name'])
const AVATAR_FIELDS = new Set(['boyAvatar', 'girlAvatar'])
const DATE_FIELDS = new Set(['loveDate', 'metDate', 'user1Birthday', 'user2Birthday', 'nextMeetDate'])
const CALENDAR_FIELDS = new Set(['metCalendar', 'user1BirthdayCalendar', 'user2BirthdayCalendar', 'nextMeetCalendar'])
const LEAP_FIELDS = new Set(['metLeap', 'user1BirthdayLeap', 'user2BirthdayLeap', 'nextMeetLeap'])
const STATUS_FIELDS = new Set(['user1Status', 'user2Status'])
const STATUS_TIME_FIELDS = new Set(['user1StatusTime', 'user2StatusTime'])

const ERROR_MESSAGES = Object.freeze({
  NOT_AUTHENTICATED: '登录状态失效，请重新进入小程序',
  USER_NOT_FOUND: '用户信息不存在',
  INVITE_NOT_FOUND: '邀请码不存在',
  CANNOT_BIND_SELF: '不能绑定自己',
  ALREADY_BOUND: '你或对方已经绑定情侣',
  REQUEST_EXISTS: '绑定请求已发送，请等待对方回应',
  REQUEST_NOT_FOUND: '绑定请求不存在或已处理',
  REQUEST_EXPIRED: '绑定请求已过期，请重新发送',
  FORBIDDEN: '没有权限执行此操作',
  RELATIONSHIP_NOT_FOUND: '情侣关系不存在',
  INVALID_PAYLOAD: '请求参数不正确',
  INVALID_ACTION: '不支持的操作',
  INTERNAL_ERROR: '操作失败，请稍后重试'
})

function makeCoupleId(openidA, openidB, entropy = '') {
  const members = [openidA, openidB].sort()
  const source = entropy ? `${members.join('\0')}\0${entropy}` : members.join('\0')
  const digest = crypto.createHash('sha256').update(source).digest('hex')
  return `cp_${digest.slice(0, 32)}`
}

function makeRequestId(openidA, openidB) {
  const source = [openidA, openidB].sort().join('\0')
  const digest = crypto.createHash('sha256').update(source).digest('hex')
  return `rq_${digest.slice(0, 32)}`
}

function makeRequestGeneration(randomBytes) {
  return randomBytes(16).toString('hex')
}

function makeInviteCode(randomBytes) {
  return Array.from(randomBytes(6), byte => INVITE_ALPHABET[byte % INVITE_ALPHABET.length]).join('')
}

function normalizeInviteCode(value) {
  return String(value).toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function purgeAfter(archivedAt) {
  return new Date(new Date(archivedAt).getTime() + RETENTION_MS)
}

function isRecoverable(relation, now) {
  return relation.status === 'archived' && new Date(relation.purgeAfter).getTime() > new Date(now).getTime()
}

function sameMembers(left, right) {
  return left.length === right.length && [...left].sort().every((member, index) => member === [...right].sort()[index])
}

function publicError(code) {
  const publicCode = Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, code) ? code : 'INTERNAL_ERROR'
  return {
    ok: false,
    error: publicCode,
    message: ERROR_MESSAGES[publicCode]
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function validDate(value) {
  return value === '' || (typeof value === 'string' && DATE_PATTERN.test(value))
}

function validateAdjustment(value) {
  if (!isPlainObject(value)) return false
  return Object.entries(value).every(([key, offset]) =>
    (key === 'togetherOffset' || key === 'apartOffset') &&
    typeof offset === 'number' && Number.isFinite(offset))
}

function validateCoupleFields(fields) {
  if (!isPlainObject(fields)) return false
  return Object.entries(fields).every(([key, value]) => {
    if (NAME_FIELDS.has(key)) return typeof value === 'string' && value.length <= 50
    if (AVATAR_FIELDS.has(key)) return typeof value === 'string' && value.length <= 2048
    if (DATE_FIELDS.has(key)) return validDate(value)
    if (CALENDAR_FIELDS.has(key)) return CALENDARS.has(value)
    if (LEAP_FIELDS.has(key)) return typeof value === 'boolean'
    if (STATUS_FIELDS.has(key)) return STATUSES.has(value)
    if (STATUS_TIME_FIELDS.has(key)) {
      return typeof value === 'number' && Number.isFinite(value) && value >= 0
    }
    if (key === 'statAdjustment') return validateAdjustment(value)
    return true
  })
}

module.exports = {
  makeCoupleId,
  makeRequestId,
  makeRequestGeneration,
  makeInviteCode,
  normalizeInviteCode,
  purgeAfter,
  isRecoverable,
  sameMembers,
  publicError,
  validateCoupleFields
}
