const db = wx.cloud.database()
const { callRelationship, bootstrapRelationship, getCoupleId } = require('../../utils/relationship')
const { waitForAuth } = require('../../utils/auth')

Page({

  data: {

    year: '',
    month: '',
    day: '',
    week: '',
    time: '',
    loveDays: 0,
    loveDate: '',

    defaultAvatar: 'https://dummyimage.com/200x200/ffb6c1/ffffff',

    boyAvatar: '',
    girlAvatar: '',
    boyName: 'Boy',
    girlName: 'Girl',

    // 当前用户身份：'user1' 或 'user2'
    myRole: '',

    // 爱心落下动画数据
    hearts: [],

    // 绑定状态（控制 UI 显示）
    hasCouple: false,

    // 课程小组件
    courseWidget: {
      show: false,
      status: '',
      emoji: '📝',
      statusText: '',
      nextCourse: null
    },

    // 陪伴小组件
    compWidget: {
      show: false,
      heartStatus: 'none',
      emoji: '🤍',
      statusText: '今日未记录',
      isApart: false,
      loveDays: 0,
      loveDateSet: false
    },

  },

  async onLoad() {
    await waitForAuth()

    // 加载头像
    this.loadAvatars()

    // 更新时间
    this.updateTime()
    this.getLoveDays()

    this._clockTimer = setInterval(() => {
      this.updateTime()
    }, 1000)

    // 启动爱心落下动画
    this.initHearts()

  },

  async onShow() {
    await waitForAuth()
    // 恢复时钟（onHide 中已清除）
    if (!this._clockTimer) {
      this.updateTime()
      this._clockTimer = setInterval(() => {
        this.updateTime()
      }, 1000)
    }
    // 同步绑定状态
    const hasCouple = !!wx.getStorageSync('hasCouple')
    this.setData({ hasCouple })
    if (hasCouple) {
      this.syncAvatarsFromCloud()
      this.loadCourseWidget()
      this.loadCompWidget()
      // 启动定时同步头像（每5秒）
      if (!this.avatarTimer) {
        this.avatarTimer = setInterval(() => {
          this.syncAvatarsFromCloud()
        }, 5000)
      }
      // 启动课程小组件定时刷新
      if (!this.courseWidgetTimer) {
        this.courseWidgetTimer = setInterval(() => {
          this.loadCourseWidget()
        }, 30000)
      }
      // 启动陪伴小组件定时刷新
      if (!this.compWidgetTimer) {
        this.compWidgetTimer = setInterval(() => {
          this.loadCompWidget()
        }, 8000)
      }
    } else {
      this.setData({ boyAvatar: '', girlAvatar: '', boyName: 'Boy', girlName: 'Girl' })
      this.stopAvatarTimer()
      this.stopCourseWidgetTimer()
      this.stopCompWidgetTimer()
      this.setData({ courseWidget: { show: false, status: '', emoji: '📝', statusText: '', nextCourse: null } })
    }
  },

  onHide() {
    if (this._clockTimer) {
      clearInterval(this._clockTimer)
      this._clockTimer = null
    }
    this.stopAvatarTimer()
    this.stopCourseWidgetTimer()
    this.stopCompWidgetTimer()
    if (this.heartTimer) {
      clearInterval(this.heartTimer)
      this.heartTimer = null
    }
  },

  stopAvatarTimer() {
    if (this.avatarTimer) {
      clearInterval(this.avatarTimer)
      this.avatarTimer = null
    }
  },

  stopCourseWidgetTimer() {
    if (this.courseWidgetTimer) {
      clearInterval(this.courseWidgetTimer)
      this.courseWidgetTimer = null
    }
  },

  stopCompWidgetTimer() {
    if (this.compWidgetTimer) {
      clearInterval(this.compWidgetTimer)
      this.compWidgetTimer = null
    }
  },

  // ==================== 陪伴小组件 ====================

  loadCompWidget() {
    var myOpenid = wx.getStorageSync('openid') || ''
    const coupleId = getCoupleId()
    if (!myOpenid || !coupleId) {
      if (!coupleId) wx.showToast({ title: '请先绑定情侣', icon: 'none' })
      this.setData({ 'compWidget.show': false })
      return
    }
    var today = this.getTodayStr()
    var that = this

    // 同时查今日签到 + 恋爱日期
    db.collection('companion_records')
      .where({ coupleId, date: today })
      .field({ authorOpenid: true, status: true })
      .limit(20)
      .get()
      .then(function (res) {
        var records = res.data || []
        var authors = {}
        var statuses = {}
        records.forEach(function (r) { authors[r.authorOpenid] = true; statuses[r.status] = true })
        var mySigned = !!authors[myOpenid]
        var partnerSigned = Object.keys(authors).some(function (k) { return k !== myOpenid })
        var bothSigned = mySigned && partnerSigned
        var isApart = Object.keys(statuses).length === 1 && statuses['apart']

        var heartStatus = 'none'
        var emoji = '🤍'
        var statusText = '今日未记录'
        if (bothSigned) { heartStatus = 'both'; emoji = '❤️'; statusText = '双方已签到' }
        else if (mySigned && !partnerSigned) { heartStatus = 'half'; emoji = '💗'; statusText = '已签到，等TA' }
        else if (!mySigned && partnerSigned) { heartStatus = 'half'; emoji = '💗'; statusText = 'TA已签到，等你' }

        // 读恋爱日期
        var loveDays = 0
        var loveDate = wx.getStorageSync('loveDate') || ''
        if (loveDate) {
          loveDays = Math.floor((new Date() - new Date(loveDate)) / (1000 * 60 * 60 * 24))
          if (loveDays < 0) loveDays = 0
        }

        that.setData({
          compWidget: {
            show: true,
            heartStatus: heartStatus,
            emoji: emoji,
            statusText: statusText,
            isApart: isApart,
            loveDays: loveDays,
            loveDateSet: !!loveDate
          }
        })
      })
      .catch(function () {
        that.setData({ 'compWidget.show': false })
      })
  },

  getTodayStr() {
    var d = new Date()
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  },

  goCompanion() {
    wx.switchTab({ url: '/pages/companion/companion' })
  },

  onUnload() {
    if (this._clockTimer) {
      clearInterval(this._clockTimer)
      this._clockTimer = null
    }
    this.stopAvatarTimer()
    this.stopCourseWidgetTimer()
    this.stopCompWidgetTimer()
    if (this.heartTimer) {
      clearInterval(this.heartTimer)
      this.heartTimer = null
    }
  },

  // ==================== 爱心落下动画 ====================

  initHearts() {
    // 爱心 emoji 列表
    const emojis = ['❤️', '💕', '💖', '💗', '💝', '🩷', '♥️', '💘']
    // 初始生成一批爱心
    const hearts = []
    for (let i = 0; i < 15; i++) {
      hearts.push(this.createHeart(emojis, i))
    }
    this.setData({ hearts })

    // 每隔一段时间刷新一批新爱心
    this.heartTimer = setInterval(() => {
      const newHearts = []
      for (let i = 0; i < 15; i++) {
        newHearts.push(this.createHeart(emojis, i))
      }
      this.setData({ hearts: newHearts })
    }, 8000)
  },

  createHeart(emojis, index) {
    return {
      id: Date.now() + index + Math.random(),
      emoji: emojis[Math.floor(Math.random() * emojis.length)]
    }
  },

  // ==================== 头像系统 ====================

  // 页面加载时从本地缓存加载头像
  loadAvatars() {
    const boyAvatar = wx.getStorageSync('boyAvatar') || ''
    const girlAvatar = wx.getStorageSync('girlAvatar') || ''

    this.setData({ boyAvatar, girlAvatar })

    // 再从云端拉最新的（覆盖本地缓存）
    this.syncAvatarsFromCloud()
  },

  // 从云端同步头像（双方都能看到对方的更换）
  syncAvatarsFromCloud() {
    if (!getCoupleId()) return
    bootstrapRelationship().then(() => {
        const myRole = wx.getStorageSync('myRole') || 'user1'
        const boyAvatar = wx.getStorageSync('boyAvatar') || ''
        const girlAvatar = wx.getStorageSync('girlAvatar') || ''
        const boyName = wx.getStorageSync('boyName') || 'Boy'
        const girlName = wx.getStorageSync('girlName') || 'Girl'
        const loveDate = wx.getStorageSync('loveDate') || ''

        var loveDays = 0
        if (loveDate) {
          loveDays = Math.floor((new Date() - new Date(loveDate)) / (1000 * 60 * 60 * 24))
          if (loveDays < 0) loveDays = 0
        }

        // 使用关系初始化时生成的临时显示地址
        this.setData({ boyAvatar, girlAvatar, boyName, girlName, myRole, loveDays, loveDate })

        // 同步到本地缓存，供其他页面使用
        wx.setStorageSync('myRole', myRole)
        wx.setStorageSync('myAvatar', myRole === 'user1' ? boyAvatar : girlAvatar)
        wx.setStorageSync('boyAvatar', boyAvatar)
        wx.setStorageSync('girlAvatar', girlAvatar)
        wx.setStorageSync('boyName', boyName)
        wx.setStorageSync('girlName', girlName)
        wx.setStorageSync('loveDate', loveDate)
        wx.setStorageSync('myName', myRole === 'user1' ? boyName : girlName)
        wx.setStorageSync('partnerName', myRole === 'user1' ? girlName : boyName)
      }).catch(() => {})
  },

  // ========== 点击头像 → 弹出选择面板 ==========

  onBoyAvatarTap() {
    if (!this.checkCouple()) return
    // 只有 user1 才能改 boyAvatar
    if (this.data.myRole !== 'user1') {
      wx.showToast({ title: '只能修改自己的头像哦', icon: 'none' })
      return
    }
    this.showAvatarPicker('boyAvatar')
  },

  onGirlAvatarTap() {
    if (!this.checkCouple()) return
    // 只有 user2 才能改 girlAvatar
    if (this.data.myRole !== 'user2') {
      wx.showToast({ title: '只能修改自己的头像哦', icon: 'none' })
      return
    }
    this.showAvatarPicker('girlAvatar')
  },

  showAvatarPicker(key) {
    wx.showActionSheet({
      itemList: ['从相册选择', '拍照'],
      success: res => {
        const sourceType = res.tapIndex === 0 ? ['album'] : ['camera']
        this.pickFromDevice(key, sourceType)
      }
    })
  },

  // ========== 微信头像按钮回调 ==========

  onBoyWxAvatar(e) {
    if (!this.checkCouple()) return
    if (this.data.myRole !== 'user1') {
      wx.showToast({ title: '只能修改自己的头像哦', icon: 'none' })
      return
    }
    const avatarUrl = e.detail.avatarUrl
    if (avatarUrl) {
      this.uploadAndSave(avatarUrl, 'boyAvatar', true)
    }
  },

  onGirlWxAvatar(e) {
    if (!this.checkCouple()) return
    if (this.data.myRole !== 'user2') {
      wx.showToast({ title: '只能修改自己的头像哦', icon: 'none' })
      return
    }
    const avatarUrl = e.detail.avatarUrl
    if (avatarUrl) {
      this.uploadAndSave(avatarUrl, 'girlAvatar', true)
    }
  },

  // ========== 从相册 / 拍照 ==========

  pickFromDevice(key, sourceType) {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: sourceType,
      success: res => {
        const filePath = res.tempFiles[0].tempFilePath
        this.uploadAndSave(filePath, key, false)
      },
      fail: err => {
        if (err.errMsg && err.errMsg.includes('cancel')) return
        console.error('选择图片失败:', err)
      }
    })
  },

  // ========== 上传 + 本地存储 + 云端同步 ==========

  uploadAndSave(filePath, key, isWxAvatar) {
    if (!getCoupleId()) {
      wx.showToast({ title: '请先绑定情侣', icon: 'none' })
      return
    }
    wx.showLoading({ title: '上传中...' })

    // 微信头像 chooseAvatar 返回的是临时路径，也需要上传到云存储
    const cloudPath = 'couples/' + getCoupleId() + '/avatars/' + key + '_' + Date.now() + '.png'

    wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success: res => {
        const fileID = res.fileID

        // 1. 更新页面显示
        this.setData({ [key]: fileID })

        // 2. 保存到本地缓存
        wx.setStorageSync(key, fileID)
        wx.setStorageSync(key + 'FileID', fileID)
        wx.setStorageSync('myAvatarFileID', fileID)

        // 3. 同步到云数据库（双方可见）
        this.syncToCloudDB(key, fileID)

        wx.hideLoading()
        wx.showToast({
          title: isWxAvatar ? '已使用微信头像' : '头像更换成功',
          icon: 'success'
        })
      },
      fail: err => {
        wx.hideLoading()
        console.error('头像上传失败:', err)
        wx.showToast({
          title: '上传失败，请重试',
          icon: 'none'
        })
      }
    })
  },

  // 写入 couple 集合，使双方同步
  syncToCloudDB(key, fileID) {
    if (!getCoupleId()) return
    const fields = {}
    fields[key] = fileID
    callRelationship('updateCoupleFields', { fields })
      .catch(() => {})
  },

  // ==================== 时间更新 ====================

  updateTime() {

    const now = new Date()

    const weeks = [
      '星期日', '星期一', '星期二', '星期三',
      '星期四', '星期五', '星期六'
    ]

    this.setData({
      year: now.getFullYear(),
      month: String(now.getMonth() + 1).padStart(2, '0'),
      day: String(now.getDate()).padStart(2, '0'),
      week: weeks[now.getDay()],
      time: now.toLocaleTimeString()
    })

  },

  // ==================== 纪念日 ====================

  chooseDate() {
    if (!this.checkCouple()) return
    wx.showModal({
      title: '输入在一起日期',
      editable: true,
      placeholderText: '例如：2024-01-01',
      success: res => {
        if (res.confirm) {
          var dateStr = (res.content || '').trim()
          // Validate format
          if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            wx.showToast({ title: '日期格式不正确，请使用 YYYY-MM-DD', icon: 'none' })
            return
          }
          var d = new Date(dateStr)
          if (isNaN(d.getTime())) {
            wx.showToast({ title: '无效的日期，请重新输入', icon: 'none' })
            return
          }
          // Verify date parts match (catches Feb 30, etc.)
          var parts = dateStr.split('-')
          if (d.getFullYear() !== parseInt(parts[0]) ||
              d.getMonth() + 1 !== parseInt(parts[1]) ||
              d.getDate() !== parseInt(parts[2])) {
            wx.showToast({ title: '无效的日期，请重新输入', icon: 'none' })
            return
          }
          if (d > new Date()) {
            wx.showToast({ title: '日期不能在未来', icon: 'none' })
            return
          }
          // 1. 写入本地缓存
          wx.setStorageSync('loveDate', dateStr)
          this.getLoveDays()
          // 2. 写入云端 couple 文档（双方同步）
          if (getCoupleId()) {
            callRelationship('updateCoupleFields', { fields: { loveDate: dateStr } }).catch(() => {})
          }
        }
      }
    })
  },

  getLoveDays() {

    let loveDate = wx.getStorageSync('loveDate')

    if (!loveDate) {
      this.setData({ loveDays: 0, loveDate: '' })
      return
    }

    const start = new Date(loveDate)
    // Guard against invalid date stored in cache
    if (isNaN(start.getTime())) {
      this.setData({ loveDays: 0, loveDate: '' })
      return
    }
    const now = new Date()
    const diff = now - start
    const days = Math.floor(diff / 1000 / 60 / 60 / 24)

    this.setData({ loveDays: Math.max(0, days), loveDate })

  },

  // ==================== 九宫格跳转 ====================

  // 检查是否已绑定
  checkCouple() {
    const hasCouple = wx.getStorageSync('hasCouple')
    if (!hasCouple) {
      wx.showToast({ title: '请先绑定情侣', icon: 'none' })
      return false
    }
    return true
  },

  goAnniversary() {
    if (!this.checkCouple()) return
    wx.navigateTo({ url: '/pages/anniversary/anniversary' })
  },

  goMoney() {
    if (!this.checkCouple()) return
    wx.navigateTo({ url: '/pages/money/money' })
  },

  goCourse() {
    if (!this.checkCouple()) return
    wx.navigateTo({ url: '/pages/course/course' })
  },

  goGoals() {
    if (!this.checkCouple()) return
    wx.navigateTo({ url: '/pages/goals/goals' })
  },

  goCost() {
    if (!this.checkCouple()) return
    wx.navigateTo({ url: '/pages/cost/cost' })
  },

  goNote() {
    if (!this.checkCouple()) return
    wx.navigateTo({ url: '/pages/note/note' })
  },

  goPet() {
    if (!this.checkCouple()) return
    wx.navigateTo({ url: '/pages/sprite/sprite' })
  },

  goSchedule() {
    if (!this.checkCouple()) return
    wx.navigateTo({ url: '/pages/schedule/schedule' })
  },

  goAlbum() {
    if (!this.checkCouple()) return
    wx.navigateTo({ url: '/pages/album/album' })
  },

  // ==================== 课程小组件 ====================

  loadCourseWidget() {
    const helper = require('../../utils/scheduleHelper')
    const myOpenid = wx.getStorageSync('openid') || ''
    const coupleId = getCoupleId()
    if (!coupleId) {
      wx.showToast({ title: '请先绑定情侣', icon: 'none' })
      this.setData({ courseWidget: { show: false } })
      return
    }

    db.collection('schedule')
      .where({
        type: 'course',
        coupleId,
        authorOpenid: myOpenid
      })
      .limit(100)
      .get()
      .then(res => {
        const courses = res.data || []
        if (courses.length === 0) {
          this.setData({ courseWidget: { show: false } })
          return
        }
        const statusInfo = helper.getTodayStatusText(courses)
        const nextCourse = helper.getNextCourse(courses)
        const widget = {
          show: true,
          status: statusInfo.status,
          emoji: statusInfo.emoji,
          statusText: statusInfo.text,
          nextCourse: nextCourse ? {
            name: nextCourse.course.name,
            time: helper.getCountdownText(nextCourse.gapMinutes)
          } : null
        }
        this.setData({ courseWidget: widget })
      })
      .catch(() => {
        this.setData({ courseWidget: { show: false } })
      })
  },

  // 未绑定状态下点击中间区域
  onCenterTap() {
    wx.showModal({
      title: '提示',
      content: '请先绑定情侣才能设置纪念日哦~\n前往「我的」页面绑定另一半吧 💕',
      showCancel: false,
      confirmText: '知道了'
    })
  }

})
