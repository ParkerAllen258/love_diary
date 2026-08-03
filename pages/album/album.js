const db = wx.cloud.database()
const { getCoupleId } = require('../../utils/relationship')

const ALBUMS_STORAGE_KEY = 'my_album_folders'
const ALBUMS_MIGRATED_PREFIX = 'my_album_folders_migrated_'

function loadLocalAlbums() {
  try {
    const coupleId = getCoupleId()
    const raw = wx.getStorageSync(ALBUMS_STORAGE_KEY) || '[]'
    const all = JSON.parse(raw)
    return all.filter(a => a.coupleId === coupleId)
  } catch (e) {
    return []
  }
}

function saveLocalAlbums(albums) {
  try {
    const coupleId = getCoupleId()
    const raw = wx.getStorageSync(ALBUMS_STORAGE_KEY) || '[]'
    const all = JSON.parse(raw)
    const others = all.filter(a => a.coupleId !== coupleId)
    const merged = others.concat(albums)
    wx.setStorageSync(ALBUMS_STORAGE_KEY, JSON.stringify(merged))
  } catch (e) {}
}

function deleteLocalAlbum(id) {
  const albums = loadLocalAlbums()
  saveLocalAlbums(albums.filter(a => a._id !== id))
}

function getMigrationKey() {
  return ALBUMS_MIGRATED_PREFIX + getCoupleId()
}

function normalizeAlbum(album) {
  const displayId = album.localId || album._id
  return {
    ...album,
    _id: displayId,
    _docId: album._id,
    _coverUrl: album.coverFileID || '',
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

  onLoad() {
    const myCode = wx.getStorageSync('myCode') || ''
    const myName = wx.getStorageSync('myName') || '我'
    const hasCouple = !!wx.getStorageSync('hasCouple')
    this.setData({ myCode, myName, hasCouple })
    this.loadAllData()
  },

  onShow() {
    if (wx.getStorageSync('hasCouple')) {
      this.setData({ hasCouple: true })
    }
    this.loadAllData()
  },

  loadAllData() {
    this.loadAlbums()
    this.loadAllPhotos()
  },

  // 从云端加载相册列表，并兼容迁移旧版本的本地相册
  loadAlbums() {
    this.migrateLocalAlbums()
      .then(() => {
        return db.collection('album_folders')
          .where({ coupleId: getCoupleId() })
          .orderBy('createTime', 'desc')
          .limit(100)
          .get()
      })
      .then(res => {
        const albums = (res.data || []).map(normalizeAlbum)
        this.setData({ albumList: albums, albumCount: albums.length }, () => {
          this.countPhotosPerAlbum()
        })
      })
      .catch(() => {
        const albums = loadLocalAlbums().map(a => normalizeAlbum({ ...a, localId: a._id }))
        albums.sort((a, b) => (b.createTime || 0) - (a.createTime || 0))
        this.setData({ albumList: albums, albumCount: albums.length }, () => {
          this.countPhotosPerAlbum()
        })
      })
  },

  migrateLocalAlbums() {
    const migrationKey = getMigrationKey()
    if (wx.getStorageSync(migrationKey)) return Promise.resolve()

    const localAlbums = loadLocalAlbums()
    if (localAlbums.length === 0) {
      wx.setStorageSync(migrationKey, true)
      return Promise.resolve()
    }

    return db.collection('album_folders')
      .where({ coupleId: getCoupleId() })
      .limit(100)
      .get()
      .then(res => {
        const existing = {}
        ;(res.data || []).forEach(a => {
          if (a.localId) existing[a.localId] = true
        })
        const tasks = localAlbums
          .filter(a => !existing[a._id])
          .map(a => {
            return db.collection('album_folders').add({
              data: {
                localId: a._id,
                name: a.name,
                description: a.description || '',
                coverFileID: a.coverFileID || '',
                authorCode: a.authorCode || this.data.myCode,
                authorName: a.authorName || this.data.myName,
                coupleId: getCoupleId(),
                authorOpenid: wx.getStorageSync('openid') || '',
                createTime: a.createTime || Date.now(),
                updateTime: Date.now()
              }
            })
          })
        return Promise.all(tasks)
      })
      .then(() => {
        wx.setStorageSync(migrationKey, true)
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
      .then(res => {
        this.allPhotosCache = res.data || []
        this.refreshStats()
      })
      .catch(() => {
        this.allPhotosCache = []
        this.refreshStats()
      })
  },

  countPhotosPerAlbum() {
    const photos = this.allPhotosCache
    const albumList = this.data.albumList.map(album => {
      const count = photos.filter(p => p.albumId === album._id).length
      return { ...album, _photoCount: count }
    })
    const uncategorized = photos.filter(p => !p.albumId).length
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
      photos = this.allPhotosCache.filter(p => !p.albumId)
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
      ? this.allPhotosCache.filter(p => !p.albumId)
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
        const removeFromDb = () => {
          db.collection('album').doc(id).remove()
            .then(() => {
              wx.showToast({ title: '已删除' })
              this.loadAllData()
              this.refreshCurrentAlbum()
            })
        }
        if (photo && photo.fileID) {
          wx.cloud.deleteFile({ fileList: [photo.fileID] }).then(removeFromDb).catch(removeFromDb)
        } else {
          removeFromDb()
        }
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
      description: (albumFormDesc || '').trim(),
      updateTime: Date.now()
    }
    if (albumCoverFileID) updates.coverFileID = albumCoverFileID
    wx.showLoading({ title: '保存中...' })
    db.collection('album_folders').doc(docId).update({ data: updates })
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
      content: '确定要删除「' + name + '」吗？相册内的所有照片也会被删除，此操作不可恢复！',
      confirmColor: '#ef4444',
      success: res => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中...' })
        const album = this.data.albumList.find(a => a._id === id)
        const docId = album && album._docId ? album._docId : id
        // 删除云存储中的照片文件
        const photos = this.allPhotosCache.filter(p => p.albumId === id)
        const fileIDs = photos.map(p => p.fileID).filter(Boolean)
        const deleteFiles = fileIDs.length > 0
          ? wx.cloud.deleteFile({ fileList: fileIDs }).catch(() => {})
          : Promise.resolve()

        deleteFiles.then(() => {
          // 删除云数据库中的照片记录
          const delPromises = photos.length > 0
            ? photos.map(p => db.collection('album').doc(p._id).remove().catch(() => {}))
            : []
          return Promise.all(delPromises)
        }).then(() => {
          return db.collection('album_folders').doc(docId).remove()
        }).then(() => {
          deleteLocalAlbum(id)
          if (this.data.currentAlbum._id === id) {
            this.setData({ currentView: 'list', currentAlbum: {}, photoList: [] })
          }
          wx.hideLoading()
          wx.showToast({ title: '相册已删除' })
          this.loadAllData()
        }).catch(() => {
          wx.hideLoading()
          wx.showToast({ title: '删除失败', icon: 'none' })
        })
      }
    })
  }

})
