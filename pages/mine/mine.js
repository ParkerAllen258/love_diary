const {
  callRelationship,
  bootstrapRelationship,
  errorMessage
} = require('../../utils/relationship')

function displayRequest(request) {
  return {
    ...request,
    from: request.fromInviteCode || '',
    to: request.toInviteCode || ''
  }
}

Page({
  data: {
    hasCouple: false,
    myCode: '',
    inputCode: '',
    requestList: [],
    mySentRequests: [],
    myAvatar: '',
    myName: '',
    partnerAvatar: '',
    partnerName: '',
    partnerCode: '',
    defaultAvatar: 'https://dummyimage.com/200x200/ffb6c1/ffffff'
  },

  onLoad() {
    this.initUser()
    this.startTimer()
  },

  onShow() {
    this.refreshStatus()
    if (!this.timer) this.startTimer()
  },

  onHide() {
    this.stopTimer()
  },

  onUnload() {
    this.stopTimer()
  },

  startTimer() {
    this.stopTimer()
    this.timer = setInterval(() => this.refreshStatus(), 8000)
  },

  stopTimer() {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  },

  async initUser() {
    await this.refreshStatus()
  },

  applySnapshot(snapshot, requests = []) {
    const active = snapshot.relationshipStatus === 'active' && Boolean(snapshot.coupleId)
    const couple = snapshot.couple || {}
    const myRole = snapshot.myRole === 'user2' ? 'user2' : 'user1'
    const isUser1 = myRole === 'user1'
    const pending = requests.filter(request => request.status === 'pending')
    const openid = snapshot._id || ''

    this.setData({
      hasCouple: active,
      myCode: snapshot.inviteCode || '',
      requestList: active ? [] : pending.filter(request => request.toOpenid === openid).map(displayRequest),
      mySentRequests: active ? [] : pending.filter(request => request.fromOpenid === openid).map(displayRequest),
      myAvatar: active ? (isUser1 ? couple.boyAvatar : couple.girlAvatar) || '' : '',
      myName: active ? (isUser1 ? couple.user1Name || 'Boy' : couple.user2Name || 'Girl') : '',
      partnerAvatar: active ? (isUser1 ? couple.girlAvatar : couple.boyAvatar) || '' : '',
      partnerName: active ? (isUser1 ? couple.user2Name || 'Girl' : couple.user1Name || 'Boy') : '',
      partnerCode: active && snapshot.partner ? snapshot.partner.inviteCode || '' : ''
    })

    const app = getApp()
    if (app) {
      app.globalData.openid = openid
      app.globalData.coupleId = active ? snapshot.coupleId : ''
      app.globalData.hasCouple = active
      app.globalData.myCode = snapshot.inviteCode || ''
    }
  },

  async refreshStatus() {
    if (this.refreshing) return
    this.refreshing = true
    try {
      const snapshot = await bootstrapRelationship()
      const requests = snapshot.relationshipStatus === 'active'
        ? []
        : await callRelationship('listRequests')
      this.applySnapshot(snapshot, requests)
    } catch (error) {
      console.error('refresh relationship status failed:', error)
    } finally {
      this.refreshing = false
    }
  },

  onInput(e) {
    this.setData({ inputCode: e.detail.value })
  },

  copyCode() {
    wx.setClipboardData({ data: this.data.myCode })
    wx.showToast({ title: '已复制', icon: 'success' })
  },

  async sendRequest() {
    const targetCode = String(this.data.inputCode || '').trim().toUpperCase()
    if (!targetCode) {
      wx.showToast({ title: '请输入邀请码', icon: 'none' })
      return
    }

    wx.showLoading({ title: '发送中...' })
    try {
      await callRelationship('sendRequest', { inviteCode: targetCode })
      this.setData({ inputCode: '' })
      wx.showToast({ title: '请求已发送，请等待对方回应', icon: 'none' })
      await this.refreshStatus()
    } catch (error) {
      wx.showToast({ title: errorMessage(error), icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  agreeRequest(e) {
    const item = e.currentTarget.dataset.item
    wx.showActionSheet({
      itemList: ['我是 Boy', '我是 Girl'],
      title: '请选择你的身份',
      success: result => this.acceptRequest(item, result.tapIndex === 0 ? 'user1' : 'user2')
    })
  },

  async acceptRequest(item, role) {
    wx.showLoading({ title: '绑定中...' })
    try {
      await callRelationship('acceptRequest', {
        requestId: item._id,
        generation: item.generation,
        role
      })
      await bootstrapRelationship()
      wx.showToast({ title: '绑定成功', icon: 'success' })
      await this.refreshStatus()
    } catch (error) {
      wx.showToast({ title: errorMessage(error), icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  rejectRequest(e) {
    const item = e.currentTarget.dataset.item
    wx.showModal({
      title: '提示',
      content: '确定拒绝对方的绑定请求吗？',
      success: result => {
        if (result.confirm) this.resolveRequest('rejectRequest', item, '已拒绝')
      }
    })
  },

  cancelMyRequest(e) {
    const item = e.currentTarget.dataset.item
    wx.showModal({
      title: '提示',
      content: '确定取消绑定请求吗？',
      success: result => {
        if (result.confirm) this.resolveRequest('cancelRequest', item, '已取消')
      }
    })
  },

  async resolveRequest(action, item, successText) {
    try {
      await callRelationship(action, { requestId: item._id, generation: item.generation })
      wx.showToast({ title: successText, icon: 'none' })
      await this.refreshStatus()
    } catch (error) {
      wx.showToast({ title: errorMessage(error), icon: 'none' })
    }
  },

  unbind() {
    wx.showModal({
      title: '提示',
      content: '解绑后双方将立即停止共享；共同数据保留30天，期间重新绑定可恢复，之后永久删除。',
      success: result => {
        if (result.confirm) this.confirmUnbind()
      }
    })
  },

  async confirmUnbind() {
    wx.showLoading({ title: '解绑中...' })
    try {
      await callRelationship('unbind')
      await bootstrapRelationship()
      wx.showToast({ title: '已解绑', icon: 'success' })
      await this.refreshStatus()
    } catch (error) {
      wx.showToast({ title: errorMessage(error), icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  }
})
