const db = wx.cloud.database()
const _ = db.command
const { callRelationship, getCoupleId } = require('../../utils/relationship')

Page({

  data: {

    content: '',

    images: [],       // 待发布的图片 fileID 列表

    list: [],

    myAvatar: '',

    defaultAvatar: 'https://dummyimage.com/200x200/ffb6c1/ffffff',

    myName: '',

    myCode: '',

    // 评论相关
    showCommentModal: false,
    commentContent: '',
    commentTargetId: '',
    canSubmitComment: false

  },

  onLoad() {

    // 加载当前用户信息
    const myCode = wx.getStorageSync('myCode') || ''
    const myName = wx.getStorageSync('myName') || '恋人'
    const myAvatar = wx.getStorageSync('myAvatar') || wx.getStorageSync('boyAvatar') || wx.getStorageSync('girlAvatar') || ''

    this.setData({ myCode, myName, myAvatar })

    this.getList()

  },

  onShow() {

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
        this.setData({ myAvatar: fileID })
        wx.setStorageSync('myAvatar', fileID)
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

    const { content, images, myCode, myName, myAvatar } = this.data

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

          authorAvatar: myAvatar,  // 发布者头像

          coupleId: getCoupleId(),

          authorOpenid: wx.getStorageSync('openid') || '',

          likes: 0,

          likedBy: [],

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
      .then(res => {

        const myCode = this.data.myCode

        const list = (res.data || []).map(item => {

          const images = Array.isArray(item.images) ? item.images : []

          const comments = Array.isArray(item.comments) ? item.comments : []

          const imageCount = Math.min(images.length, 9)
          const isMine = item.authorCode === myCode

          return {
            ...item,
            images,
            comments,
            imageCount,
            isLiked: item.likedBy && item.likedBy.indexOf(myCode) !== -1,
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

    const myCode = this.data.myCode

    const likedBy = item.likedBy || []

    const isLiked = likedBy.indexOf(myCode) !== -1

    if (isLiked) {

      // 取消点赞
      db.collection('moment')
        .doc(id)
        .update({

          data: {

            likes: _.inc(-1),

            likedBy: _.pull(myCode)

          }

        })
        .then(() => this.getList())
        .catch(() => {})

    } else {

      // 点赞
      db.collection('moment')
        .doc(id)
        .update({

          data: {

            likes: _.inc(1),

            likedBy: _.push(myCode)

          }

        })
        .then(() => this.getList())
        .catch(() => {})

    }

  },

  // ==================== 删除 ====================

  deleteItem(e) {

    const id = e.currentTarget.dataset.id

    const item = this.data.list.find(i => i._id === id)

    wx.showModal({

      title: '提示',

      content: '确定删除这条动态吗？',

      success: res => {

        if (res.confirm) {

          const removeFromDb = () => {

            db.collection('moment')
              .doc(id)
              .remove()
              .then(() => {

                wx.showToast({ title: '已删除' })

                this.getList()

              })

          }

          // 删除云存储中的所有图片
          if (item && item.images && item.images.length > 0) {

            wx.cloud.deleteFile({ fileList: item.images })
              .then(removeFromDb)
              .catch(removeFromDb)

          } else {

            removeFromDb()

          }

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
    const { commentContent, commentTargetId, myName, myCode } = this.data

    if (!commentContent.trim()) {
      wx.showToast({ title: '请输入评论内容', icon: 'none' })
      return
    }

    wx.showLoading({ title: '发送中...' })

    const comment = {
      authorName: myName || '匿名',
      authorCode: myCode,
      content: commentContent.trim(),
      time: this.formatTime(new Date())
    }

    db.collection('moment')
      .doc(commentTargetId)
      .update({
        data: {
          comments: _.push(comment)
        }
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
