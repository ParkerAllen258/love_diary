const RELATIONSHIP_CACHE_KEYS = Object.freeze([
  'partnerOpenid', 'partnerCode', 'coupleId', 'hasCouple',
  'boyAvatar', 'girlAvatar', 'boyName', 'girlName',
  'loveDate', 'myRole', 'myGender', 'myName', 'partnerName',
  'statAdjustment'
])

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
  INVALID_ACTION: '不支持的操作',
  INVALID_PAYLOAD: '请求参数不正确',
  INTERNAL_ERROR: '操作失败，请稍后重试'
})

function errorMessage(error) {
  return ERROR_MESSAGES[error && error.code] || ERROR_MESSAGES.INTERNAL_ERROR
}

function clearRelationshipCache() {
  for (const key of RELATIONSHIP_CACHE_KEYS) wx.removeStorageSync(key)
}

function applyRelationshipSnapshot(snapshot = {}) {
  clearRelationshipCache()

  const openid = snapshot._id || snapshot.openid || ''
  const inviteCode = String(snapshot.inviteCode || '').toUpperCase()
  if (openid) wx.setStorageSync('openid', openid)
  if (inviteCode) wx.setStorageSync('myCode', inviteCode)

  const active = snapshot.relationshipStatus === 'active' && Boolean(snapshot.coupleId)
  wx.setStorageSync('hasCouple', active)
  if (!active) return snapshot

  const couple = snapshot.couple || {}
  const partner = snapshot.partner || {}
  const myRole = snapshot.myRole === 'user2' ? 'user2' : 'user1'
  const partnerRole = myRole === 'user1' ? 'user2' : 'user1'
  const myName = couple[myRole + 'Name'] || (myRole === 'user1' ? 'Boy' : 'Girl')
  const partnerName = couple[partnerRole + 'Name'] || (partnerRole === 'user1' ? 'Boy' : 'Girl')

  wx.setStorageSync('coupleId', snapshot.coupleId)
  wx.setStorageSync('partnerOpenid', snapshot.partnerOpenid || partner._id || '')
  wx.setStorageSync('partnerCode', partner.inviteCode || '')
  wx.setStorageSync('myRole', myRole)
  wx.setStorageSync('myGender', myRole === 'user1' ? 'boy' : 'girl')
  wx.setStorageSync('myName', myName)
  wx.setStorageSync('partnerName', partnerName)
  wx.setStorageSync('boyName', couple.user1Name || 'Boy')
  wx.setStorageSync('girlName', couple.user2Name || 'Girl')
  wx.setStorageSync('boyAvatar', couple.boyAvatar || '')
  wx.setStorageSync('girlAvatar', couple.girlAvatar || '')
  wx.setStorageSync('loveDate', couple.loveDate || '')
  if (couple.statAdjustment !== undefined) {
    wx.setStorageSync('statAdjustment', couple.statAdjustment)
  }
  return snapshot
}

async function callRelationship(action, payload = {}) {
  const safePayload = { ...payload }
  delete safePayload.openid
  delete safePayload.OPENID
  delete safePayload.coupleId
  const response = await wx.cloud.callFunction({
    name: 'relationshipService',
    data: { action, payload: safePayload }
  })
  const result = response && response.result
  if (!result || !result.ok) {
    const error = new Error(result && result.message ? result.message : ERROR_MESSAGES.INTERNAL_ERROR)
    error.code = result && result.error ? result.error : 'INTERNAL_ERROR'
    throw error
  }
  return result.data
}

async function bootstrapRelationship() {
  const snapshot = await callRelationship('bootstrap')
  return applyRelationshipSnapshot(snapshot)
}

function getCoupleId() {
  return wx.getStorageSync('coupleId') || ''
}

function hasActiveCouple() {
  return Boolean(wx.getStorageSync('hasCouple') && getCoupleId())
}

module.exports = {
  RELATIONSHIP_CACHE_KEYS,
  callRelationship,
  bootstrapRelationship,
  applyRelationshipSnapshot,
  getCoupleId,
  hasActiveCouple,
  clearRelationshipCache,
  errorMessage
}
