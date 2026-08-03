wx.cloud.init({
  env: 'cloud1-d0g9qamm1ffcc26ca',
  traceUser: true
})

const { initAuth } = require('./utils/auth')

App({
  globalData: {
    hasCouple: false,
    coupleId: '',
    myCode: '',
    openid: ''
  },

  onLaunch() {
    initAuth().catch(error => {
      console.error('relationship bootstrap failed:', error)
    })
  }
})
