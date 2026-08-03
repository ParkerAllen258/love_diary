const { bootstrapRelationship } = require('./relationship')

async function initAuth() {
  const snapshot = await bootstrapRelationship()
  const app = typeof getApp === 'function' ? getApp() : null
  if (app) {
    app.globalData.openid = snapshot._id || ''
    app.globalData.coupleId = snapshot.coupleId || ''
    app.globalData.hasCouple = snapshot.relationshipStatus === 'active' && Boolean(snapshot.coupleId)
    app.globalData.myCode = snapshot.inviteCode || ''
  }
  return snapshot
}

module.exports = { initAuth }
