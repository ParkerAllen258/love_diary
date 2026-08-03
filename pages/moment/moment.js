const db = wx.cloud.database()
const { callRelationship, getCoupleId } = require('../../utils/relationship')
const { callSharedData, resolveFileUrls } = require('../../utils/sharedData')
const { waitForAuth } = require('../../utils/auth')

Page({

  data: {

    content: '',

    images: [],       // 待发布的图片 fileID 列表

    list: [],

    myAvatar: '',
    myAvatarFileID: '',

    defaultAvatar: 'https://dummyimage.com/200x200/ffb6c1/ffffff',

    myName: '',

    myCode: '',

    // 评论相关
    showCommentModal: false,
    commentContent: '',
    commentTargetId: '',
    canSubmitComment: false

  },

  async onLoad() {
    await waitForAuth()

    // 加载当前用户信息
    const myCode = wx.getStorageSync('myCode') || ''
    const myName = wx.getStorageSync('myName') || '恋人'
    const myAvatarFileID = wx.getStorageSync('myAvatarFileID') || wx.getStorageSync('boyAvatarFileID') || wx.getStorageSync('girlAvatarFileID') || wx.getStorageSync('myAvatar') || ''
    const myAvatar = wx.getStorageSync('myAvatar') || myAvatarFileID

    this.setData({ myCode, myName, myAvatar, myAvatarFileID })

    this.getList()

  },

  async onShow() {
    await waitForAuth()

    if (this.data.myCode) {

      this.getList()

    }

  },

  // ==================== 输入 ====================

  onInput(e) {

    this.setData({

      content: e.detail.value

    })

  },

  // ==================== 选择头像 ====================

  chooseMyAvatar() {
    const hasCouple = wx.getStorageSync('hasCouple')
    if (!hasCouple) {
      wx.showToast({ title: '请先绑定情侣', icon: 'none' })
      return
    }
    wx.showActionSheet({
      itemList: ['从相册选择', '拍照'],
      success: res => {
        const sourceType = res.tapIndex === 0 ? ['album'] : ['camera']
        wx.chooseMedia({
          count: 1,
          mediaType: ['image'],
          sourceType: sourceType,
          success: res => {
            const filePath = res.tempFiles[0].tempFilePath
            this.uploadAvatar(filePath)
          }
        })
      }
    })
  },

  uploadAvatar(filePath) {
    wx.showLoading({ title: '上传中...' })
    const coupleId = getCoupleId()
    if (!coupleId) { wx.hideLoading(); wx.showToast({ title: '请先绑定情侣', icon: 'none' }); return }
    const cloudPath = 'couples/' + coupleId + '/avatars/moment_' + Date.now() + '.png'
    wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success: res => {
        const fileID = res.fileID
        this.setData({ myAvatar: fileID, myAvatarFileID: fileID })
        wx.setStorageSync('myAvatar', fileID)
        wx.setStorageSync('myAvatarFileID', fileID)
        // 同步到云数据库 couple 集合，让伴侣也能看到
        this.syncAvatarToCloud(fileID)
        wx.hideLoading()
        wx.showToast({ title: '头像更换成功', icon: 'success' })
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '上传失败', icon: 'none' })
      }
    })
  },

  // 同步头像到云端 couple 集合
  syncAvatarToCloud(fileID) {
    if (!getCoupleId()) return
    const key = wx.getStorageSync('myRole') === 'user2' ? 'girlAvatar' : 'boyAvatar'
    const fields = {}
    fields[key] = fileID
    callRelationship('updateCoupleFields', { fields }).catch(() => {})
  },

  // ==================== 图片选择（多选） ====================

  chooseImage() {

    const hasCouple = wx.getStorageSync('hasCouple')
    if (!hasCouple) {
      wx.showToast({ title: '请先绑定情侣', icon: 'none' })
      return
    }

    const remain = 9 - this.data.images.length

    if (remain <= 0) {

      wx.showToast({ title: '最多9张图片', icon: 'none' })

      return

    }

    wx.chooseMedia({

      count: remain,

      mediaType: ['image'],

      success: res => {

        res.tempFiles.forEach(file => {

          this.uploadImage(file.tempFilePath)

        })

      }

    })

  },

  // 上传单张图片
  uploadImage(filePath) {

    wx.showLoading({ title: '上传中...' })

    const coupleId = getCoupleId()

    if (!coupleId) { wx.hideLoading(); wx.showToast({ title: '请先绑定情侣', icon: 'none' }); return }

    const cloudPath = 'couples/' + coupleId + '/moments/' + Date.now() + '_' + Math.random().toString(36).substr(2, 4) + '.png'

    wx.cloud.uploadFile({

      cloudPath,

      filePath,

      success: res => {

        const images = this.data.images.concat(res.fileID)

        this.setData({ images })

        wx.hideLoading()

      },

      fail: err => {

        wx.hideLoading()

        console.error('上传失败:', err)

        wx.showToast({ title: '上传失败', icon: 'none' })

      }

    })

  },

  // 移除预览图片
  removeImage(e) {

    const index = e.currentTarget.dataset.index

    const images = this.data.images

    images.splice(index, 1)

    this.setData({ images })

  },

  // ==================== 发布 ====================

  publish() {

    const hasCouple = wx.getStorageSync('hasCouple')
    if (!hasCouple) {
      wx.showToast({ title: '请先绑定情侣', icon: 'none' })
      return
    }

    const { content, images, myCode, myName, myAvatar, myAvatarFileID } = this.data

    if (!content && images.length === 0) {

      wx.showToast({ title: '请输入内容或添加图片', icon: 'none' })

      return

    }

    wx.showLoading({ title: '发布中...' })

    db.collection('moment')
      .add({

        data: {

          content: content,

          images: images,          // 多图数组

          authorCode: myCode,      // 发布者标识

          authorName: myName,      // 发布者昵称

          authorAvatar: myAvatarFileID || myAvatar,

          coupleId: getCoupleId(),

          authorOpenid: wx.getStorageSync('openid') || '',

          likes: 0,

          likedByOpenids: [],

          comments: [],

          time: this.formatTime(new Date()),

          createTime: Date.now()

        }

      })
      .then(() => {

        wx.hideLoading()

        wx.showToast({ title: '发布成功 ❤️' })

        this.setData({

          content: '',

          images: []

        })

        this.getList()

      })

      .catch(() => {

        wx.hideLoading()

        wx.showToast({ title: '发布失败', icon: 'none' })

      })

  },

  // ==================== 获取列表 ====================

  getList() {

    const hasCouple = wx.getStorageSync('hasCouple')
    if (!hasCouple) {
      this.setData({ list: [] })
      return
    }

    const coupleId = getCoupleId()
    if (!coupleId) { this.setData({ list: [] }); return }

    db.collection('moment')
      .where({ coupleId })
      .orderBy('createTime', 'desc')
      .limit(100)
      .get()
      .then(async res => {

        const myOpenid = wx.getStorageSync('openid') || ''
        const rows = res.data || []
        const fileIDs = rows.flatMap(item => (Array.isArray(item.images) ? item.images : []).concat(item.authorAvatar || []))
        const urls = await resolveFileUrls(fileIDs)

        const list = rows.map(item => {

          const imageFileIDs = Array.isArray(item.images) ? item.images : []
          const images = imageFileIDs.map(fileID => urls[fileID]).filter(Boolean)

          const comments = (Array.isArray(item.comments) ? item.comments : []).map(comment => ({
            ...comment,
            isMine: comment.authorOpenid === myOpenid
          }))

          const imageCount = Math.min(images.length, 9)
          const isMine = item.authorOpenid === myOpenid

          return {
            ...item,
            images,
            imageFileIDs,
            authorAvatar: urls[item.authorAvatar] || '',
            comments,
            imageCount,
            isLiked: Array.isArray(item.likedByOpenids) && item.likedByOpenids.includes(myOpenid),
            isMine: isMine,
            authorLabel: isMine ? '我' : 'TA'
          }

        })

        this.setData({ list })

      })
      .catch(() => {
        wx.showToast({ title: '加载失败', icon: 'none' })
      })

  },

  // ==================== 点赞（防重复） ====================

  likeMoment(e) {

    const id = e.currentTarget.dataset.id

    const item = this.data.list.find(i => i._id === id)

    if (!item) return

    callSharedData('toggleMomentLike', { id })
      .then(() => this.getList())
      .catch(err => wx.showToast({ title: err.message || '操作失败', icon: 'none' }))

  },

  // ==================== 删除 ====================

  deleteItem(e) {

    const id = e.currentTarget.dataset.id

    const item = this.data.list.find(i => i._id === id)

    if (!item || !item.isMine) {
      wx.showToast({ title: '只能删除自己的动态', icon: 'none' })
      return
    }

    wx.showModal({

      title: '提示',

      content: '确定删除这条动态吗？',

      success: res => {

        if (res.confirm) {

          callSharedData('deleteOwnedRecord', { collection: 'moment', id })
              .then(() => {

                wx.showToast({ title: '已删除' })

                this.getList()

              })
              .catch(err => wx.showToast({ title: err.message || '删除失败', icon: 'none' }))

        }

      }

    })

  },

  // ==================== 预览图片 ====================

  previewImage(e) {

    const current = e.currentTarget.dataset.current

    const urls = e.currentTarget.dataset.urls

    wx.previewImage({

      current: current,

      urls: urls

    })

  },

  // ==================== 评论功能 ====================

  // 显示评论输入框
  showCommentInput(e) {
    const id = e.currentTarget.dataset.id
    this.setData({
      showCommentModal: true,
      commentTargetId: id,
      commentContent: '',
      canSubmitComment: false
    })
  },

  // 隐藏评论输入框
  hideCommentInput() {
    this.setData({
      showCommentModal: false,
      commentTargetId: '',
      commentContent: '',
      canSubmitComment: false
    })
  },

  // 评论输入
  onCommentInput(e) {
    this.setData({
      commentContent: e.detail.value,
      canSubmitComment: !!(e.detail.value && e.detail.value.trim())
    })
  },

  // 提交评论
  submitComment() {
    const { commentContent, commentTargetId } = this.data

    if (!commentContent.trim()) {
      wx.showToast({ title: '请输入评论内容', icon: 'none' })
      return
    }

    wx.showLoading({ title: '发送中...' })

    callSharedData('addMomentComment', {
      id: commentTargetId,
      content: commentContent.trim()
    })
      .then(() => {
        wx.hideLoading()
        wx.showToast({ title: '评论成功', icon: 'success' })
        this.hideCommentInput()
        this.getList()
      })
      .catch(() => {

        wx.hideLoading()

        wx.showToast({ title: '评论失败', icon: 'none' })
      })
  },

  deleteComment(e) {
    const id = e.currentTarget.dataset.id
    const commentId = e.currentTarget.dataset.commentId
    callSharedData('deleteMomentComment', { id, commentId })
      .then(() => this.getList())
      .catch(err => wx.showToast({ title: err.message || '删除失败', icon: 'none' }))
  },

  // ==================== 时间格式化 ====================

  formatTime(date) {

    const month = date.getMonth() + 1

    const day = date.getDate()

    const hour = String(date.getHours()).padStart(2, '0')

    const minute = String(date.getMinutes()).padStart(2, '0')

    return month + '月' + day + '日 ' + hour + ':' + minute

  },

  noop() {}

})
