const db = wx.cloud.database()
const { getCoupleId } = require('../../utils/relationship')

const CATEGORY_LIST = [
  { name: '约会', icon: '💑', color: '#ff6b9d' },
  { name: '旅行', icon: '✈️', color: '#4dabf7' },
  { name: '礼物', icon: '🎁', color: '#da77f2' },
  { name: '美食', icon: '🍽️', color: '#ffa94d' },
  { name: '电影', icon: '🎬', color: '#ff8787' },
  { name: '购物', icon: '🛍️', color: '#fcc419' },
  { name: '交通', icon: '🚕', color: '#69db7c' },
  { name: '活动', icon: '🎪', color: '#ff922b' },
  { name: '房租', icon: '🏠', color: '#20c997' },
  { name: '其它', icon: '📌', color: '#adb5bd' }
]

function todayStr() {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return d.getFullYear() + '-' + m + '-' + day
}

function formatMoney(n) {
  const num = Number(n) || 0
  return num % 1 === 0 ? String(num) : num.toFixed(2)
}

function formatDate(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return d.getFullYear() + '-' + m + '-' + day
}

function isThisMonth(ts) {
  if (!ts) return false
  const d = new Date(ts)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}

Page({

  data: {
    // 用户信息
    hasCouple: false,
    myCode: '',
    myName: '我',
    partnerName: 'Ta',

    // 计算模式: aa / ratio / custom
    mode: 'aa',

    // 表单数据
    title: '',
    money: '',
    people: '2',
    ratioMine: '',
    ratioPartner: '',
    totalRatio: 0,
    customMine: '',
    customPartner: '',
    customDiff: '',
    customMatch: false,
    categoryIndex: 0,
    whoPaid: 'mine',
    expenseDate: todayStr(),
    note: '',
    categoryList: CATEGORY_LIST,

    // 计算结果
    showResult: false,
    resultTotal: '',
    resultAvg: '',
    resultMine: '',
    resultPartner: '',

    // 列表
    list: [],
    total: '0',
    monthTotal: '0',
    count: 0,
    myTotal: '0',
    partnerTotal: '0',
    categoryStats: []
  },

  allListCache: [],

  onLoad() {
    const myCode = wx.getStorageSync('myCode') || ''
    const myName = wx.getStorageSync('myName') || '我'
    const partnerName = wx.getStorageSync('partnerName') || 'Ta'
    const hasCouple = !!wx.getStorageSync('hasCouple')
    this.setData({
      myCode,
      myName,
      partnerName,
      hasCouple,
      expenseDate: todayStr()
    })
    this.loadList()
  },

  onShow() {
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
      this.applyList([])
      return
    }
    db.collection('cost').where({ coupleId }).orderBy('createTime', 'desc').limit(100).get()
      .then(res => {
        this.allListCache = res.data || []
        this.applyList(this.allListCache)
      })
      .catch(() => {
        this.allListCache = []
        this.applyList([])
      })
  },

  applyList(allList) {
    const myCode = this.data.myCode
    let total = 0
    let myTotal = 0
    let partnerTotal = 0
    let monthTotal = 0

    allList.forEach(item => {
      const m = Number(item.money) || 0
      total += m
      if (item.authorCode === myCode) myTotal += m
      else if (item.authorCode) partnerTotal += m
      if (isThisMonth(item.createTime)) monthTotal += m
    })

    const list = allList.map(item => this.decorateItem(item, myCode))
    const categoryStats = this.buildCategoryStats(allList)

    this.setData({
      list,
      total: formatMoney(total),
      myTotal: formatMoney(myTotal),
      partnerTotal: formatMoney(partnerTotal),
      monthTotal: formatMoney(monthTotal),
      count: allList.length,
      categoryStats
    })
  },

  decorateItem(item, myCode) {
    const cat = CATEGORY_LIST.find(c => c.name === item.category) || CATEGORY_LIST[9]
    const isMine = item.authorCode === myCode
    const avg = item.avg || ((Number(item.money) || 0) / (Number(item.people) || 2)).toFixed(2)
    return Object.assign({}, item, {
      _categoryName: item.category || '其它',
      _categoryIcon: item.categoryIcon || cat.icon,
      _categoryColor: item.categoryColor || cat.color,
      _iconStyle: 'background:' + (item.categoryColor || cat.color) + ';',
      _whoLabel: isMine ? '我' : (item.authorName || 'Ta'),
      _moneyText: formatMoney(item.money),
      _avgText: formatMoney(avg),
      _dateText: item.expenseDate || formatDate(item.createTime)
    })
  },

  buildCategoryStats(list) {
    const map = {}
    list.forEach(item => {
      const cat = item.category || '其它'
      map[cat] = (map[cat] || 0) + (Number(item.money) || 0)
    })
    const total = Object.values(map).reduce((s, v) => s + v, 0)
    const items = CATEGORY_LIST.map(cat => {
      const amount = map[cat.name] || 0
      const percent = total > 0 ? Math.round(amount / total * 100) : 0
      return {
        name: cat.name,
        icon: cat.icon,
        color: cat.color,
        amount: formatMoney(amount),
        amountNum: amount,
        percent,
        barStyle: 'width:' + percent + '%;background:' + cat.color + ';'
      }
    })
      .filter(i => i.amountNum > 0)
      .sort((a, b) => b.amountNum - a.amountNum)
    return items
  },

  // ========== 模式切换 ==========
  switchMode(e) {
    const mode = e.currentTarget.dataset.mode
    this.setData({
      mode,
      showResult: false
    })
  },

  // ========== 输入处理 ==========
  onTitleInput(e) {
    this.setData({ title: e.detail.value })
  },

  onMoneyInput(e) {
    this.setData({ money: e.detail.value, showResult: false })
  },

  onPeopleInput(e) {
    const val = parseInt(e.detail.value) || 2
    this.setData({ people: String(Math.max(1, Math.min(val, 99))), showResult: false })
  },

  decreasePeople() {
    const p = Math.max(1, (parseInt(this.data.people) || 2) - 1)
    this.setData({ people: String(p), showResult: false })
  },

  increasePeople() {
    const p = Math.min(99, (parseInt(this.data.people) || 2) + 1)
    this.setData({ people: String(p), showResult: false })
  },

  onRatioMineInput(e) {
    const val = parseInt(e.detail.value) || 0
    const mine = Math.min(100, Math.max(0, val))
    const partner = this.data.ratioPartner ? Number(this.data.ratioPartner) : 0
    this.setData({
      ratioMine: String(mine),
      totalRatio: mine + partner,
      showResult: false
    })
  },

  onRatioPartnerInput(e) {
    const val = parseInt(e.detail.value) || 0
    const partner = Math.min(100, Math.max(0, val))
    const mine = this.data.ratioMine ? Number(this.data.ratioMine) : 0
    this.setData({
      ratioPartner: String(partner),
      totalRatio: mine + partner,
      showResult: false
    })
  },

  onCustomMineInput(e) {
    const mineVal = Number(e.detail.value) || 0
    const partnerVal = this.data.customPartner ? Number(this.data.customPartner) : 0
    const total = Number(this.data.money) || 0
    const diff = total > 0 ? (total - mineVal - partnerVal).toFixed(2) : ''
    this.setData({
      customMine: e.detail.value,
      customDiff: diff,
      customMatch: diff !== '' && Number(diff) === 0,
      showResult: false
    })
  },

  onCustomPartnerInput(e) {
    const partnerVal = Number(e.detail.value) || 0
    const mineVal = this.data.customMine ? Number(this.data.customMine) : 0
    const total = Number(this.data.money) || 0
    const diff = total > 0 ? (total - mineVal - partnerVal).toFixed(2) : ''
    this.setData({
      customPartner: e.detail.value,
      customDiff: diff,
      customMatch: diff !== '' && Number(diff) === 0,
      showResult: false
    })
  },

  onCategoryChange(e) {
    this.setData({ categoryIndex: Number(e.detail.value) })
  },

  switchWhoPaid(e) {
    this.setData({ whoPaid: e.currentTarget.dataset.who })
  },

  onDateChange(e) {
    this.setData({ expenseDate: e.detail.value })
  },

  onNoteInput(e) {
    this.setData({ note: e.detail.value })
  },

  // ========== 计算 ==========
  calculate() {
    const { title, money, mode, people, ratioMine, ratioPartner, customMine, customPartner } = this.data

    if (!title.trim()) {
      wx.showToast({ title: '请输入项目名称', icon: 'none' })
      return
    }
    const totalAmount = Number(money)
    if (!totalAmount || totalAmount <= 0) {
      wx.showToast({ title: '请输入有效金额', icon: 'none' })
      return
    }

    let resultMine = '0'
    let resultPartner = '0'
    let resultAvg = '0'
    let valid = false

    if (mode === 'aa') {
      const p = parseInt(people) || 2
      if (p < 1) {
        wx.showToast({ title: '人数至少为1', icon: 'none' })
        return
      }
      resultAvg = (totalAmount / p).toFixed(2)
      resultMine = resultAvg
      resultPartner = resultAvg
      valid = true
    } else if (mode === 'ratio') {
      const rm = Number(ratioMine) || 0
      const rp = Number(ratioPartner) || 0
      if (rm + rp !== 100) {
        wx.showToast({ title: '比例合计必须等于100%', icon: 'none' })
        return
      }
      resultMine = (totalAmount * rm / 100).toFixed(2)
      resultPartner = (totalAmount * rp / 100).toFixed(2)
      valid = true
    } else if (mode === 'custom') {
      const cm = Number(customMine) || 0
      const cp = Number(customPartner) || 0
      if (Math.abs(totalAmount - cm - cp) > 0.01) {
        wx.showToast({ title: '两人金额合计需等于总金额', icon: 'none' })
        return
      }
      resultMine = cm.toFixed(2)
      resultPartner = cp.toFixed(2)
      valid = true
    }

    if (valid) {
      this.setData({
        showResult: true,
        resultTotal: formatMoney(totalAmount),
        resultAvg,
        resultMine,
        resultPartner
      })
    }
  },

  closeResult() {
    this.setData({ showResult: false })
  },

  // ========== 保存记录 ==========
  saveRecord() {
    const {
      title, money, mode, people, ratioMine, ratioPartner,
      resultAvg, resultMine, resultPartner,
      categoryIndex, whoPaid, expenseDate, note,
      myCode, myName
    } = this.data

    const cat = CATEGORY_LIST[categoryIndex] || CATEGORY_LIST[9]
    const totalAmount = Number(money) || 0

    let avgVal = resultAvg
    let detail = ''

    if (mode === 'ratio') {
      avgVal = ''
      detail = JSON.stringify({
        mode: 'ratio',
        mine: ratioMine + '%',
        partner: ratioPartner + '%',
        mineAmount: resultMine,
        partnerAmount: resultPartner
      })
    } else if (mode === 'custom') {
      avgVal = ''
      detail = JSON.stringify({
        mode: 'custom',
        mineAmount: resultMine,
        partnerAmount: resultPartner
      })
    } else {
      avgVal = resultAvg
      detail = JSON.stringify({ mode: 'aa', people: Number(people) })
    }

    wx.showLoading({ title: '保存中...' })

    const data = {
      title: title.trim(),
      money: totalAmount,
      people: mode === 'aa' ? Number(people) : 2,
      avg: avgVal ? Number(avgVal) : 0,
      mode,
      category: cat.name,
      categoryIcon: cat.icon,
      categoryColor: cat.color,
      whoPaid,
      detail,
      expenseDate: expenseDate || todayStr(),
      note: (note || '').trim(),
      authorCode: myCode,
      authorName: myName,
      coupleId: getCoupleId(),
      authorOpenid: wx.getStorageSync('openid') || '',
      createTime: Date.now()
    }

    db.collection('cost')
      .add({ data })
      .then(() => {
        wx.hideLoading()
        wx.showToast({ title: '保存成功 🎉' })
        this.setData({
          title: '',
          money: '',
          note: '',
          ratioMine: '',
          ratioPartner: '',
          customMine: '',
          customPartner: '',
          customDiff: '',
          customMatch: false,
          categoryIndex: 0,
          whoPaid: 'mine',
          expenseDate: todayStr(),
          showResult: false
        })
        this.loadList()
      })
      .catch(() => {
        wx.hideLoading()
        wx.showToast({ title: '保存失败，请重试', icon: 'none' })
      })
  },

  // ========== 删除 ==========
  deleteItem(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '确认删除',
      content: '删除后不可恢复，确定要删除这条记录吗？',
      success: res => {
        if (!res.confirm) return
        db.collection('cost')
          .doc(id)
          .remove()
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
