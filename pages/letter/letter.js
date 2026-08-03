const db = wx.cloud.database()
const { getCoupleId } = require('../../utils/relationship')

Page({

  data: {

    title: '',

    content: '',

    list: [],

    myCode: '',

    myName: '恋人'

  },

  onLoad() {

    if (!wx.getStorageSync('hasCouple')) {

      wx.showToast({ title: '请先绑定情侣', icon: 'none' })

      setTimeout(() => wx.navigateBack(), 1500)

      return

    }

    const myCode = wx.getStorageSync('myCode') || ''
    const myName = wx.getStorageSync('myName') || '恋人'

    this.setData({ myCode, myName })

    this.getList()

  },

  onShow() {

    if (wx.getStorageSync('hasCouple')) {

      this.getList()

    }

  },

  checkCouple() {

    if (!wx.getStorageSync('hasCouple')) {

      wx.showToast({ title: '请先绑定情侣', icon: 'none' })

      return false

    }

    return true

  },

  onTitleInput(e) {

    this.setData({ title: e.detail.value })

  },

  onContentInput(e) {

    this.setData({ content: e.detail.value })

  },

  publishLetter() {

    if (!this.checkCouple()) return

    const { title, content, myCode, myName } = this.data

    if (!title) {

      wx.showToast({ title: '请输入标题', icon: 'none' })

      return

    }

    if (!content) {

      wx.showToast({ title: '请输入情书内容', icon: 'none' })

      return

    }

    wx.showLoading({ title: '寄出中...' })

    db.collection('letter')
      .add({

        data: {

          title,

          content,

          coupleId: getCoupleId(),

          authorOpenid: wx.getStorageSync('openid') || '',

          authorCode: myCode,

          authorName: myName,

          time: this.formatTime(new Date()),

          createTime: Date.now()

        }

      })
      .then(() => {

        wx.hideLoading()

        wx.showToast({ title: '情书已寄出 💌' })

        this.setData({ title: '', content: '' })

        this.getList()

      })
      .catch(() => {

        wx.hideLoading()

        wx.showToast({ title: '发送失败', icon: 'none' })

      })

  },

  getList() {

    if (!wx.getStorageSync('hasCouple')) {

      this.setData({ list: [] })

      return

    }

    const coupleId = getCoupleId()
    if (!coupleId) {
      this.setData({ list: [] })
      return
    }

    db.collection('letter')
      .where({ coupleId })
      .orderBy('createTime', 'desc')
      .limit(100)
      .get()
      .then(res => {

        const myCode = this.data.myCode

        const list = res.data.map(item => {

          item.isMine = item.authorCode === myCode

          return item

        })

        this.setData({ list })

      })
      .catch(() => {
        wx.showToast({ title: '加载失败', icon: 'none' })
      })

  },

  deleteItem(e) {

    const id = e.currentTarget.dataset.id

    const item = this.data.list.find(i => i._id === id)

    if (!item || !item.isMine) {

      wx.showToast({ title: '只能删除自己的情书', icon: 'none' })

      return

    }

    wx.showModal({

      title: '提示',

      content: '确定删除这封情书吗？',

      success: res => {

        if (!res.confirm) return

        db.collection('letter')
          .doc(id)
          .remove()
          .then(() => {

            wx.showToast({ title: '已删除' })

            this.getList()

          })
          .catch(() => {
            wx.showToast({ title: '删除失败', icon: 'none' })
          })

      }

    })

  },

  formatTime(date) {

    const month = date.getMonth() + 1

    const day = date.getDate()

    const hour = String(date.getHours()).padStart(2, '0')

    const minute = String(date.getMinutes()).padStart(2, '0')

    return month + '月' + day + '日 ' + hour + ':' + minute

  }

})
