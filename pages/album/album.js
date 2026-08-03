const db = wx.cloud.database()
const { getCoupleId } = require('../../utils/relationship')
const { callSharedData, resolveFileUrls } = require('../../utils/sharedData')
const { waitForAuth } = require('../../utils/auth')

function normalizeAlbum(album, urls) {
  const displayId = album.localId || album._id
  return {
    ...album,
    _id: displayId,
    _docId: album._id,
    _coverUrl: (urls && urls[album.coverFileID]) || '',
    isMine: album.authorOpenid === (wx.getStorageSync('openid') || ''),
    _photoCount: 0,
    _dateText: formatDate(album.createTime)
  }
}

function formatDate(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return m + '月' + day + '日'
}

function isThisMonth(ts) {
  if (!ts) return false
  const d = new Date(ts)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}

Page({

  data: {
    currentView: 'list',
    hasCouple: false,
    myCode: '',
    myName: '我',
    albumCount: 0,
    totalPhotos: 0,
    monthPhotos: 0,
    albumList: [],
    currentAlbum: {},
    photoList: [],
    showAlbumModal: false,
    editingAlbumId: '',
    albumFormName: '',
    albumFormDesc: '',
    albumCoverUrl: '',
    albumCoverFileID: ''
  },

  allPhotosCache: [],

  async onLoad() {
    await waitForAuth()
    const myCode = wx.getStorageSync('myCode') || ''
    const myName = wx.getStorageSync('myName') || '我'
    const hasCouple = !!wx.getStorageSync('hasCouple')
    this.setData({ myCode, myName, hasCouple })
    this.loadAllData()
  },

  async onShow() {
    await waitForAuth()
    if (wx.getStorageSync('hasCouple')) {
      this.setData({ hasCouple: true })
    }
    this.loadAllData()
  },

  loadAllData() {
    this.loadAlbums()
    this.loadAllPhotos()
  },

  // 从云端加载相册列表
  loadAlbums() {
    db.collection('album_folders')
          .where({ coupleId: getCoupleId() })
          .orderBy('createTime', 'desc')
          .limit(100)
          .get()
      .then(async res => {
        const rows = res.data || []
        const urls = await resolveFileUrls(rows.map(album => album.coverFileID))
        const albums = rows.map(album => normalizeAlbum(album, urls))
        this.setData({ albumList: albums, albumCount: albums.length }, () => {
          this.countPhotosPerAlbum()
        })
      })
      .catch(() => {
        this.setData({ albumList: [], albumCount: 0 })
      })
  },

  loadAllPhotos() {
    const coupleId = getCoupleId()
    if (!coupleId) {
      this.allPhotosCache = []
      this.refreshStats()
      return
    }
    db.collection('album').where({ coupleId }).orderBy('createTime', 'desc').limit(100).get()
      .then(async res => {
        const rows = res.data || []
        const urls = await resolveFileUrls(rows.map(photo => photo.fileID))
        this.allPhotosCache = rows.map(photo => ({
          ...photo,
          _fileID: photo.fileID,
          fileID: urls[photo.fileID] || '',
          isMine: photo.authorOpenid === (wx.getStorageSync('openid') || '')
        }))
        this.refreshStats()
      })
      .catch(() => {
        this.allPhotosCache = []
        this.refreshStats()
      })
  },

  countPhotosPerAlbum() {
    const photos = this.allPhotosCache
    const folderIds = new Set(this.data.albumList.map(album => album._id))
    const albumList = this.data.albumList.map(album => {
      const count = photos.filter(p => p.albumId === album._id).length
      return { ...album, _photoCount: count }
    })
    const uncategorized = photos.filter(p => !p.albumId || !folderIds.has(p.albumId)).length
    if (uncategorized > 0) {
      const hasDefault = albumList.some(a => a.name === '默认相册')
      if (!hasDefault) {
        albumList.unshift({
          _id: '__default__',
          name: '默认相册',
          description: '快速上传和旧照片',
          _coverUrl: '',
          _photoCount: uncategorized,
          _dateText: '',
          _isDefault: true
        })
      } else {
        const idx = albumList.findIndex(a => a.name === '默认相册')
        if (idx >= 0) {
          albumList[idx] = { ...albumList[idx], _photoCount: uncategorized }
        }
      }
    }
    this.setData({ albumList })
  },

  refreshStats() {
    const photos = this.allPhotosCache
    let monthPhotos = 0
    photos.forEach(p => {
      if (isThisMonth(p.createTime)) monthPhotos++
    })
    this.setData({ totalPhotos: photos.length, monthPhotos })
    this.countPhotosPerAlbum()
  },

  openAlbum(e) {
    const id = e.currentTarget.dataset.id
    const name = e.currentTarget.dataset.name
    const album = this.data.albumList.find(a => a._id === id)
    const description = album ? (album.description || '') : ''
    let photos
    if (id === '__default__') {
      const folderIds = new Set(this.data.albumList.map(item => item._id))
      photos = this.allPhotosCache.filter(p => !p.albumId || !folderIds.has(p.albumId))
    } else {
      photos = this.allPhotosCache.filter(p => p.albumId === id)
    }
    const allUrls = photos.map(p => p.fileID)
    const photoList = photos.map((p, i) => ({ ...p, _urlsForPreview: allUrls }))
    this.setData({
      currentView: 'detail',
      currentAlbum: { _id: id, name, description, _dateText: id === '__default__' ? '' : this.getAlbumDate(id) },
      photoList
    })
  },

  getAlbumDate(id) {
    const album = this.data.albumList.find(a => a._id === id)
    return album ? album._dateText : ''
  },

  goBackToList() {
    this.setData({ currentView: 'list', currentAlbum: {}, photoList: [] })
    this.loadAllData()
  },

  uploadToAlbum() {
    const albumId = this.data.currentAlbum._id
    if (albumId === '__default__') {
      wx.showToast({ title: '默认相册不支持上传，请先创建新相册', icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: 9, mediaType: ['image'],
      success: res => {
        res.tempFiles.forEach(file => { this.doUploadPhoto(file.tempFilePath, albumId) })
      }
    })
  },

  quickUpload() {
    wx.chooseMedia({
      count: 9, mediaType: ['image'],
      success: res => {
        res.tempFiles.forEach(file => { this.doUploadPhoto(file.tempFilePath, '') })
      }
    })
  },

  doUploadPhoto(filePath, albumId) {
    const coupleId = getCoupleId()
    if (!coupleId) { wx.showToast({ title: '请先绑定情侣', icon: 'none' }); return }
    wx.showLoading({ title: '上传中...' })
    const cloudPath = 'couples/' + coupleId + '/albums/' + Date.now() + '_' + Math.random().toString(36).substr(2, 6) + '.png'
    wx.cloud.uploadFile({
      cloudPath, filePath,
      success: res => {
        const data = {
          fileID: res.fileID,
          albumId: albumId || '',
          albumName: albumId ? this.data.currentAlbum.name || '' : '',
          coupleId: coupleId,
          authorOpenid: wx.getStorageSync('openid') || '',
          authorCode: this.data.myCode,
          authorName: this.data.myName,
          createTime: Date.now()
        }
        db.collection('album').add({ data })
          .then(() => {
            wx.hideLoading()
            wx.showToast({ title: '上传成功 📸' })
            this.loadAllData()
            if (this.data.currentView === 'detail') this.refreshCurrentAlbum()
          })
          .catch(() => { wx.hideLoading(); wx.showToast({ title: '保存失败', icon: 'none' }) })
      },
      fail: () => { wx.hideLoading(); wx.showToast({ title: '上传失败', icon: 'none' }) }
    })
  },

  refreshCurrentAlbum() {
    const id = this.data.currentAlbum._id
    if (!id) return
    const photos = id === '__default__'
      ? this.allPhotosCache.filter(p => !p.albumId || !this.data.albumList.some(album => album._id === p.albumId))
      : this.allPhotosCache.filter(p => p.albumId === id)
    const allUrls = photos.map(p => p.fileID)
    const photoList = photos.map((p, i) => ({ ...p, _urlsForPreview: allUrls }))
    this.setData({ photoList })
  },

  previewPhoto(e) {
    wx.previewImage({
      current: e.currentTarget.dataset.url,
      urls: e.currentTarget.dataset.urls
    })
  },

  deletePhoto(e) {
    const id = e.currentTarget.dataset.id
    const photo = this.data.photoList.find(p => p._id === id)
    wx.showModal({
      title: '删除照片', content: '确定要删除这张照片吗？', confirmColor: '#ef4444',
      success: res => {
        if (!res.confirm) return
        callSharedData('deleteOwnedRecord', { collection: 'album', id })
            .then(() => {
              wx.showToast({ title: '已删除' })
              this.loadAllData()
              this.refreshCurrentAlbum()
            })
            .catch(err => wx.showToast({ title: err.message || '删除失败', icon: 'none' }))
      }
    })
  },

  showCreateAlbum() {
    this.setData({
      showAlbumModal: true, editingAlbumId: '',
      albumFormName: '', albumFormDesc: '', albumCoverUrl: '', albumCoverFileID: ''
    })
  },

  showEditAlbum(e) {
    const id = e.currentTarget.dataset.id
    const name = e.currentTarget.dataset.name
    const desc = e.currentTarget.dataset.desc
    const album = this.data.albumList.find(a => a._id === id)
    this.setData({
      showAlbumModal: true, editingAlbumId: id,
      albumFormName: name || '', albumFormDesc: desc || '',
      albumCoverUrl: album ? album._coverUrl : '',
      albumCoverFileID: album ? (album.coverFileID || '') : ''
    })
  },

  hideAlbumModal() {
    this.setData({
      showAlbumModal: false, editingAlbumId: '',
      albumFormName: '', albumFormDesc: '', albumCoverUrl: '', albumCoverFileID: ''
    })
  },

  chooseAlbumCover() {
    wx.chooseMedia({
      count: 1, mediaType: ['image'],
      success: res => {
        const filePath = res.tempFiles[0].tempFilePath
        const coupleId = getCoupleId()
        if (!coupleId) { wx.showToast({ title: '请先绑定情侣', icon: 'none' }); return }
        wx.showLoading({ title: '上传封面...' })
        wx.cloud.uploadFile({
          cloudPath: 'couples/' + coupleId + '/albums/' + Date.now() + '_cover.png', filePath,
          success: upRes => {
            wx.hideLoading()
            this.setData({ albumCoverUrl: upRes.fileID, albumCoverFileID: upRes.fileID })
          },
          fail: () => { wx.hideLoading(); wx.showToast({ title: '上传失败', icon: 'none' }) }
        })
      }
    })
  },

  onAlbumNameInput(e) { this.setData({ albumFormName: e.detail.value }) },
  onAlbumDescInput(e) { this.setData({ albumFormDesc: e.detail.value }) },

  // ========== 创建相册（云端存储） ==========
  createAlbum() {
    const { albumFormName, albumFormDesc, albumCoverFileID, myCode, myName } = this.data
    if (!albumFormName.trim()) {
      wx.showToast({ title: '请输入相册名称', icon: 'none' })
      return
    }
    wx.showLoading({ title: '创建中...' })
    db.collection('album_folders').add({
      data: {
        name: albumFormName.trim(),
        description: (albumFormDesc || '').trim(),
        coverFileID: albumCoverFileID || '',
        authorCode: myCode,
        authorName: myName,
        coupleId: getCoupleId(),
        authorOpenid: wx.getStorageSync('openid') || '',
        createTime: Date.now(),
        updateTime: Date.now()
      }
    }).then(() => {
      wx.hideLoading()
      wx.showToast({ title: '相册创建成功 📁' })
      this.hideAlbumModal()
      this.loadAllData()
    }).catch(() => {
      wx.hideLoading()
      wx.showToast({ title: '创建失败', icon: 'none' })
    })
  },

  // ========== 更新相册（云端存储） ==========
  updateAlbum() {
    const { editingAlbumId, albumFormName, albumFormDesc, albumCoverFileID } = this.data
    if (!albumFormName.trim()) {
      wx.showToast({ title: '请输入相册名称', icon: 'none' })
      return
    }
    const album = this.data.albumList.find(a => a._id === editingAlbumId)
    const docId = album && album._docId ? album._docId : editingAlbumId
    const updates = {
      name: albumFormName.trim(),
      description: (albumFormDesc || '').trim()
    }
    if (albumCoverFileID) updates.coverFileID = albumCoverFileID
    wx.showLoading({ title: '保存中...' })
    callSharedData('updateSharedRecord', { collection: 'album_folders', id: docId, fields: updates })
      .then(() => {
        wx.hideLoading()
        wx.showToast({ title: '已更新 ✨' })
        this.hideAlbumModal()
        this.loadAllData()
      })
      .catch(() => {
        wx.hideLoading()
        wx.showToast({ title: '保存失败', icon: 'none' })
      })
  },

  // ========== 删除相册（云端目录 + 云照片清理） ==========
  deleteAlbum(e) {
    const id = e.currentTarget.dataset.id
    const name = e.currentTarget.dataset.name || '该相册'
    if (id === '__default__') {
      wx.showToast({ title: '默认相册不能删除', icon: 'none' })
      return
    }
    wx.showModal({
      title: '删除整个相册',
      content: '只能删除空相册。请先由照片创建者清空其中照片，再删除「' + name + '」。',
      confirmColor: '#ef4444',
      success: res => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中...' })
        const album = this.data.albumList.find(a => a._id === id)
        const docId = album && album._docId ? album._docId : id
        callSharedData('deleteAlbumFolder', { id: docId }).then(() => {
          if (this.data.currentAlbum._id === id) {
            this.setData({ currentView: 'list', currentAlbum: {}, photoList: [] })
          }
          wx.hideLoading()
          wx.showToast({ title: '相册已删除' })
          this.loadAllData()
        }).catch(err => {
          wx.hideLoading()
          wx.showToast({ title: err.message || '只能删除自己创建的空相册', icon: 'none' })
        })
      }
    })
  }

})
