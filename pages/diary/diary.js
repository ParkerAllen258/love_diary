const { publishDiary, getDiaryList } = require('../../utils/diary')
const { chooseImage, uploadImage } = require('../../utils/upload')
const { loadPartnerOpenid, waitForAuth } = require('../../utils/auth')
const { callSharedData, resolveFileUrls } = require('../../utils/sharedData')

Page({

  data: {

    content: '',

    imageUrl: '',

    list: []

  },

  async onLoad() {
    await waitForAuth()

    if (!wx.getStorageSync('hasCouple')) {

      wx.showToast({ title: '请先绑定情侣', icon: 'none' })

      setTimeout(() => wx.navigateBack(), 1500)

      return

    }

    this.refreshList()

  },

  async onShow() {
    await waitForAuth()

    this.refreshList()

  },

  checkCouple() {

    if (!wx.getStorageSync('hasCouple')) {

      wx.showToast({ title: '请先绑定情侣', icon: 'none' })

      return false

    }

    return true

  },

  onContentInput(e) {

    this.setData({ content: e.detail.value })

  },

  chooseImage() {

    if (!this.checkCouple()) return

    chooseImage()
      .then(filePath => {

        wx.showLoading({ title: '上传中...' })

        return uploadImage(filePath)

      })
      .then(res => {

        wx.hideLoading()

        this.setData({ imageUrl: res.fileID })

        wx.showToast({ title: '图片已添加', icon: 'success' })

      })
      .catch(err => {

        wx.hideLoading()

        if (err && err.errMsg && err.errMsg.includes('cancel')) return

        wx.showToast({ title: '上传失败', icon: 'none' })

      })

  },

  removeImage() {

    this.setData({ imageUrl: '' })

  },

  publish() {

    if (!this.checkCouple()) return

    const { content, imageUrl } = this.data
    const authorOpenid = wx.getStorageSync('openid')
    let partnerOpenid = wx.getStorageSync('partnerOpenid')

    const doPublish = () => {

      publishDiary(content, imageUrl, authorOpenid, partnerOpenid)
        .then(() => {

          wx.showToast({ title: '发布成功' })

          this.setData({ content: '', imageUrl: '' })

          this.refreshList()

        })
        .catch(err => {

          wx.showToast({

            title: (err && err.message) || '发布失败',

            icon: 'none'

          })

        })

    }

    if (partnerOpenid) {

      doPublish()

      return

    }

    const partnerCode = wx.getStorageSync('partnerCode')

    loadPartnerOpenid(partnerCode).then(() => {

      partnerOpenid = wx.getStorageSync('partnerOpenid')

      if (!partnerOpenid) {

        wx.showToast({ title: '请先绑定情侣', icon: 'none' })

        return

      }

      doPublish()

    })

  },

  refreshList() {

    if (!wx.getStorageSync('hasCouple')) {

      this.setData({ list: [] })

      return

    }

    const myOpenid = wx.getStorageSync('openid')
    const partnerOpenid = wx.getStorageSync('partnerOpenid')

    if (!myOpenid) {

      this.setData({ list: [] })

      return

    }

    getDiaryList()
      .then(async res => {

        const rows = res.data || []
        const urls = await resolveFileUrls(rows.map(item => item.imageUrl))

        const list = rows.map(item => {

          item.isMine = item.authorOpenid === myOpenid

          item.time = this.formatTime(item.createTime)

          item.imageFileID = item.imageUrl

          item.imageUrl = urls[item.imageUrl] || ''

          return item

        })

        this.setData({ list })

      })
      .catch(() => {})

  },

  deleteItem(e) {

    const id = e.currentTarget.dataset.id
    const item = this.data.list.find(i => i._id === id)

    if (!item || !item.isMine) {

      wx.showToast({ title: '只能删除自己的日记', icon: 'none' })

      return

    }

    wx.showModal({

      title: '提示',

      content: '确定删除这条日记吗？',

      success: res => {

        if (!res.confirm) return

        callSharedData('deleteOwnedRecord', { collection: 'diaries', id })
            .then(() => {

              wx.showToast({ title: '已删除' })

              this.refreshList()

            })
            .catch(err => wx.showToast({ title: err.message || '删除失败', icon: 'none' }))

      }

    })

  },

  previewImage(e) {

    const url = e.currentTarget.dataset.url

    wx.previewImage({ urls: [url], current: url })

  },

  formatTime(value) {

    const date = value instanceof Date ? value : new Date(value)

    const month = date.getMonth() + 1

    const day = date.getDate()

    const hour = String(date.getHours()).padStart(2, '0')

    const minute = String(date.getMinutes()).padStart(2, '0')

    return month + '月' + day + '日 ' + hour + ':' + minute

  }

})
