const { bootstrapRelationship } = require('./relationship')

let authPromise = null
let retryPromptPromise = null

function applySnapshot(snapshot) {
  const app = typeof getApp === 'function' ? getApp() : null
  if (app) {
    app.globalData.openid = snapshot._id || ''
    app.globalData.coupleId = snapshot.coupleId || ''
    app.globalData.hasCouple = snapshot.relationshipStatus === 'active' && Boolean(snapshot.coupleId)
    app.globalData.myCode = snapshot.inviteCode || ''
  }
  return snapshot
}

function initAuth(force = false) {
  if (authPromise && !force) return authPromise
  let bootstrap
  try {
    bootstrap = bootstrapRelationship()
  } catch (error) {
    bootstrap = Promise.reject(error)
  }
  authPromise = Promise.resolve(bootstrap)
    .then(applySnapshot)
    .catch(error => {
      authPromise = null
      throw error
    })
  const app = typeof getApp === 'function' ? getApp() : null
  if (app) app.globalData.authReady = authPromise
  return authPromise
}

function waitForAuth() {
  return initAuth().catch(error => {
    if (retryPromptPromise) return retryPromptPromise
    retryPromptPromise = new Promise((resolve, reject) => {
      wx.showModal({
        title: '初始化失败',
        content: '登录信息加载失败，请检查网络后重试。',
        confirmText: '重试',
        showCancel: false,
        success: result => {
          if (!result.confirm) {
            retryPromptPromise = null
            reject(error)
            return
          }
          initAuth(true).then(resolve, reject).finally(() => { retryPromptPromise = null })
        },
        fail: () => {
          retryPromptPromise = null
          reject(error)
        }
      })
    })
    return retryPromptPromise
  })
}

module.exports = { initAuth, waitForAuth }
