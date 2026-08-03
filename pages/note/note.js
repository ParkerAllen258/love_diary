const db = wx.cloud.database()
const { getCoupleId } = require('../../utils/relationship')
const { callSharedData } = require('../../utils/sharedData')
const { waitForAuth } = require('../../utils/auth')

const CATEGORY_LIST = [
  { name: '重要事项', icon: '⭐', color: '#f59e0b' },
  { name: '工作', icon: '💼', color: '#3b82f6' },
  { name: '学习', icon: '📚', color: '#8b5cf6' },
  { name: '生活', icon: '🏡', color: '#10b981' },
  { name: '纪念日', icon: '💝', color: '#ec4899' },
  { name: '旅行', icon: '✈️', color: '#06b6d4' },
  { name: '灵感', icon: '💡', color: '#f97316' },
  { name: '待办', icon: '✅', color: '#6366f1' },
  { name: '其它', icon: '📌', color: '#6b7280' }
]

function formatDate(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return m + '月' + day + '日 ' + h + ':' + min
}

function isThisMonth(ts) {
  if (!ts) return false
  const d = new Date(ts)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}

function getPreview(content, maxLen) {
  if (!content) return ''
  const cleaned = content.replace(/\s+/g, ' ').trim()
  if (cleaned.length <= maxLen) return cleaned
  return cleaned.substring(0, maxLen) + '...'
}

const PAGE_SIZE = 20

Page({

  data: {
    // 用户信息
    hasCouple: false,
    myCode: '',
    myName: '我',

    // 表单
    showForm: false,
    editingId: '',
    title: '',
    content: '',
    categoryIndex: 0,
    isPinned: false,
    categoryList: CATEGORY_LIST,

    // 筛选
    activeFilter: 'all',

    // 统计
    totalCount: 0,
    pinnedCount: 0,
    monthCount: 0,

    // 列表
    displayList: [],
    hasMore: false
  },

  allListCache: [],

  async onLoad() {
    await waitForAuth()
    const myCode = wx.getStorageSync('myCode') || ''
    const myName = wx.getStorageSync('myName') || '我'
    const hasCouple = !!wx.getStorageSync('hasCouple')
    this.setData({ myCode, myName, hasCouple })
    this.loadList()
  },

  async onShow() {
    await waitForAuth()
    if (wx.getStorageSync('hasCouple')) {
      this.setData({ hasCouple: true })
    }
    this.loadList()
  },

  // ========== 加载列表 ==========
  loadList() {
    const coupleId = getCoupleId()
    if (!coupleId) {
      wx.showToast({ title: '请先绑定情侣', icon: 'none' })
      this.allListCache = []
      this.applyList()
      return
    }
    db.collection('note').where({ coupleId }).orderBy('createTime', 'desc').limit(100).get()
      .then(res => {
        this.allListCache = res.data || []
        this.applyList()
      })
      .catch(() => {
        this.allListCache = []
        this.applyList()
      })
  },

  applyList() {
    const allList = this.allListCache
    const decorated = allList.map(item => this.decorateItem(item))

    // 统计
    const now = new Date()
    let pinnedCount = 0
    let monthCount = 0
    decorated.forEach(item => {
      if (item._isPinned) pinnedCount++
      if (isThisMonth(item.createTime)) monthCount++
    })

    // 筛选
    let filtered = decorated
    const filter = this.data.activeFilter
    if (filter === 'pinned') {
      filtered = decorated.filter(item => item._isPinned)
    } else if (filter !== 'all') {
      filtered = decorated.filter(item => item._categoryName === filter)
    }

    this.setData({
      displayList: filtered,
      totalCount: decorated.length,
      pinnedCount,
      monthCount,
      hasMore: decorated.length >= PAGE_SIZE
    })
  },

  decorateItem(item) {
    const cat = CATEGORY_LIST.find(c => c.name === item.category) || CATEGORY_LIST[8]
    const preview = getPreview(item.content, 120)
    return Object.assign({}, item, {
      _categoryName: item.category || '其它',
      _categoryIcon: item.categoryIcon || cat.icon,
      _categoryColor: item.categoryColor || cat.color,
      _isPinned: !!item.isPinned,
      _preview: preview,
      _dateText: formatDate(item.createTime),
      _updatedText: item.updateTime && item.updateTime > item.createTime ? '（已编辑）' : ''
    })
  },

  // ========== 筛选切换 ==========
  switchFilter(e) {
    const filter = e.currentTarget.dataset.filter
    this.setData({ activeFilter: filter }, () => this.applyList())
  },

  // ========== 展开/收起表单 ==========
  toggleForm() {
    if (this.data.showForm) {
      // 收起：重置表单
      this.resetForm()
    }
    this.setData({ showForm: !this.data.showForm })
  },

  resetForm() {
    this.setData({
      editingId: '',
      title: '',
      content: '',
      categoryIndex: 0,
      isPinned: false
    })
  },

  // ========== 输入处理 ==========
  onTitleInput(e) {
    this.setData({ title: e.detail.value })
  },

  onContentInput(e) {
    this.setData({ content: e.detail.value })
  },

  onCategoryChange(e) {
    this.setData({ categoryIndex: Number(e.detail.value) })
  },

  togglePinned() {
    this.setData({ isPinned: !this.data.isPinned })
  },

  // ========== 保存笔记 ==========
  saveNote() {
    const { title, content, categoryIndex, isPinned, myCode, myName } = this.data

    if (!title.trim()) {
      wx.showToast({ title: '请输入笔记标题', icon: 'none' })
      return
    }
    if (!content.trim()) {
      wx.showToast({ title: '请输入笔记内容', icon: 'none' })
      return
    }

    const cat = CATEGORY_LIST[categoryIndex] || CATEGORY_LIST[8]
    const now = Date.now()

    wx.showLoading({ title: '保存中...' })

    db.collection('note')
      .add({
        data: {
          title: title.trim(),
          content: content.trim(),
          category: cat.name,
          categoryIcon: cat.icon,
          categoryColor: cat.color,
          isPinned,
          coupleId: getCoupleId(),
          authorOpenid: wx.getStorageSync('openid') || '',
          authorCode: myCode,
          authorName: myName,
          time: new Date(now).toLocaleString(),
          createTime: now
        }
      })
      .then(() => {
        wx.hideLoading()
        wx.showToast({ title: '笔记已保存 📝' })
        this.resetForm()
        this.setData({ showForm: false })
        this.loadList()
      })
      .catch(() => {
        wx.hideLoading()
        wx.showToast({ title: '保存失败，请重试', icon: 'none' })
      })
  },

  // ========== 编辑笔记 ==========
  editNote(e) {
    const id = e.currentTarget.dataset.id
    const item = this.allListCache.find(i => i._id === id)
    if (!item) return

    const catIndex = CATEGORY_LIST.findIndex(c => c.name === (item.category || '其它'))
    this.setData({
      showForm: true,
      editingId: id,
      title: item.title || '',
      content: item.content || '',
      categoryIndex: catIndex >= 0 ? catIndex : 8,
      isPinned: !!item.isPinned
    })

    // 滚动到顶部
    wx.pageScrollTo({ scrollTop: 0, duration: 300 })
  },

  updateNote() {
    const { editingId, title, content, categoryIndex, isPinned } = this.data

    if (!editingId) return
    if (!title.trim()) {
      wx.showToast({ title: '请输入笔记标题', icon: 'none' })
      return
    }
    if (!content.trim()) {
      wx.showToast({ title: '请输入笔记内容', icon: 'none' })
      return
    }

    const cat = CATEGORY_LIST[categoryIndex] || CATEGORY_LIST[8]

    wx.showLoading({ title: '更新中...' })

    callSharedData('updateSharedRecord', {
      collection: 'note',
      id: editingId,
      fields: {
          title: title.trim(),
          content: content.trim(),
          category: cat.name,
          categoryIcon: cat.icon,
          categoryColor: cat.color,
          isPinned
      }
    })
      .then(() => {
        wx.hideLoading()
        wx.showToast({ title: '笔记已更新 ✨' })
        this.resetForm()
        this.setData({ showForm: false })
        this.loadList()
      })
      .catch(() => {
        wx.hideLoading()
        wx.showToast({ title: '更新失败，请重试', icon: 'none' })
      })
  },

  // ========== 标记/取消重要 ==========
  toggleNotePinned(e) {
    const id = e.currentTarget.dataset.id
    const pinned = e.currentTarget.dataset.pinned
    const newPinned = !pinned

    callSharedData('updateSharedRecord', {
      collection: 'note', id, fields: { isPinned: newPinned }
    })
      .then(() => {
        wx.showToast({ title: newPinned ? '已标记为重要 ⭐' : '已取消重要标记', icon: 'none' })
        this.loadList()
      })
      .catch(() => {
        wx.showToast({ title: '操作失败', icon: 'none' })
      })
  },

  // ========== 删除 ==========
  deleteItem(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '确认删除',
      content: '删除后不可恢复，确定要删除这条笔记吗？',
      confirmColor: '#ef4444',
      success: res => {
        if (!res.confirm) return
        callSharedData('deleteOwnedRecord', { collection: 'note', id })
          .then(() => {
            wx.showToast({ title: '已删除' })
            this.loadList()
          })
          .catch(() => {
            wx.showToast({ title: '删除失败', icon: 'none' })
          })
      }
    })
  }

})
