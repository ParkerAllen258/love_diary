const db = wx.cloud.database()
const { getCoupleId } = require('../../utils/relationship')

var EXPENSE_CATS = [
  { name: '餐饮', icon: '🍜', color: '#ffa94d' },
  { name: '购物', icon: '🛍️', color: '#fcc419' },
  { name: '约会', icon: '💑', color: '#ff6b8a' },
  { name: '礼物', icon: '🎁', color: '#da77f2' },
  { name: '交通', icon: '🚕', color: '#69db7c' },
  { name: '奶茶', icon: '🧋', color: '#4dabf7' },
  { name: '娱乐', icon: '🎮', color: '#ff8787' },
  { name: '日用', icon: '🏠', color: '#20c997' },
  { name: '其他', icon: '📌', color: '#adb5bd' }
]

var INCOME_CATS = [
  { name: '工资', icon: '💼', color: '#69db7c' },
  { name: '红包', icon: '🧧', color: '#ff8787' },
  { name: '兼职', icon: '💻', color: '#4dabf7' },
  { name: '理财', icon: '📈', color: '#ffa94d' },
  { name: '转账', icon: '💳', color: '#da77f2' },
  { name: '礼物', icon: '🎁', color: '#fcc419' },
  { name: '其他', icon: '📌', color: '#adb5bd' }
]

var PAY_METHODS = ['微信', '支付宝', '现金', '银行卡', '其他']

function todayStr() {
  var d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

function fmt(n) {
  var num = Number(n) || 0
  return num % 1 === 0 ? String(num) : num.toFixed(2)
}

function monthKey(ts) {
  var d = new Date(ts)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
}

Page({
  data: {
    hasCouple: false,
    myCode: '', myName: '我', partnerName: 'Ta',
    tab: 'all',           // all / mine / partner
    viewMode: 'list',     // list / report
    showForm: false,
    formType: 'expense',  // expense / income
    title: '', money: '',
    categoryIndex: 0, payIndex: 0,
    note: '', expenseDate: todayStr(),
    expenseCats: EXPENSE_CATS,
    incomeCats: INCOME_CATS,
    payMethods: PAY_METHODS,
    list: [],
    stats: { totalExpense: '0', totalIncome: '0', balance: '0', myExpense: '0', myIncome: '0', partnerExpense: '0', partnerIncome: '0' },
    monthStats: [],
    catStats: [],
    reportMode: 'all',
    yearStats: { totalExpense: '0', totalIncome: '0', balance: '0' },
    pieStyle: 'background: conic-gradient(#eee 0deg 360deg);',
    pieLegend: [],
    ratioMyPct: 50,
    ratioPartnerPct: 50,
    ratioMyStyle: 'width: 50%;',
    ratioPartnerStyle: 'width: 50%;',
    selectedYear: new Date().getFullYear(),
    selectedMonth: -1,          // -1 = 全年, 0-11 = 指定月
    monthLabel: '全年',
    budget: '',                 // 月度预算
    budgetUsed: 0,
    budgetLeft: 0,
    budgetPercent: 0,
    budgetStyle: 'width: 0%;',
    showBudgetInput: false,
    budgetInput: ''
  },

  allCache: [],

  onLoad() {
    var mc = wx.getStorageSync('myCode') || ''
    var has = !!wx.getStorageSync('hasCouple')
    var mn = wx.getStorageSync('myName') || wx.getStorageSync('boyName') || wx.getStorageSync('girlName') || '我'
    var pn = wx.getStorageSync('partnerName') || 'Ta'
    // 从 Storage 恢复预算
    var savedBudget = wx.getStorageSync('money_budget') || ''
    this.setData({
      myCode: mc,
      myName: mn,
      partnerName: pn,
      hasCouple: has,
      expenseDate: todayStr(),
      budget: savedBudget
    })
    if (has) this.loadData()
  },

  onShow() {
    if (wx.getStorageSync('hasCouple')) {
      var mn = wx.getStorageSync('myName') || '我'
      var pn = wx.getStorageSync('partnerName') || 'Ta'
      this.setData({ hasCouple: true, myName: mn, partnerName: pn })
      this.loadData()
    }
  },

  loadData() {
    var cp = getCoupleId()
    if (!cp) { this.applyData([]); return }
    var that = this
    db.collection('money').where({ coupleId: cp }).orderBy('createTime', 'desc').limit(100).get().then(function (res) {
      that.allCache = res.data || []
      that.applyData(that.allCache)
    }).catch(function () { that.applyData([]) })
  },

  applyData(all) {
    var mc = this.data.myCode
    var tab = this.data.tab
    var reportMode = this.data.reportMode
    var selYear = this.data.selectedYear
    var selMonth = this.data.selectedMonth

    // 年度 + 月度筛选
    var yearData = all.filter(function (i) {
      var d = new Date(i.createTime || Date.now())
      if (d.getFullYear() !== selYear) return false
      if (selMonth >= 0 && d.getMonth() !== selMonth) return false
      return true
    })

    // 筛选列表
    var filtered = all
    if (tab === 'mine') filtered = all.filter(function (i) { return i.authorCode === mc })
    else if (tab === 'partner') filtered = all.filter(function (i) { return i.authorCode && i.authorCode !== mc })

    // 统计（基于筛选后）
    var stats = this.calcStats(tab === 'all' ? all : filtered)
    var monthStats = this.buildMonthStats(tab === 'all' ? all : filtered)
    var catStats = this.buildCatStats(tab === 'all' ? all : filtered)
    // 列表模式：yearStats 跟随 tab 筛选；报表模式：yearStats 也跟随报表筛选
    var yearStatsForDisplay = tab === 'all' ? this.calcStats(yearData) : this.calcStats(yearData.filter(function (i) {
      return tab === 'mine' ? i.authorCode === mc : (i.authorCode && i.authorCode !== mc)
    }))
    var yearStats = this.calcStats(yearData)

    // 饼图数据（支出）—— 列表模式默认值
    var pieData = this.buildPieData(yearData.filter(function (i) { return i.type === 'expense' }))
    // 双方消费占比 —— 列表模式默认值
    var ratioData = this.buildRatioData(yearData)

    // 报表模式：覆盖饼图/占比/统计，全部跟随 reportMode 筛选
    if (this.data.viewMode === 'report') {
      var reportData = reportMode === 'all' ? all : (reportMode === 'mine' ? all.filter(function (i) { return i.authorCode === mc }) : all.filter(function (i) { return i.authorCode && i.authorCode !== mc }))
      stats = this.calcStats(reportData)
      monthStats = this.buildMonthStats(reportData)
      catStats = this.buildCatStats(reportData)
      // 按年/月筛选后的 reportData（用于饼图、占比、顶部结余）
      var reportYearData = reportData.filter(function (i) {
        var d = new Date(i.createTime || Date.now())
        if (d.getFullYear() !== selYear) return false
        if (selMonth >= 0 && d.getMonth() !== selMonth) return false
        return true
      })
      yearStatsForDisplay = this.calcStats(reportYearData)
      pieData = this.buildPieData(reportYearData.filter(function (i) { return i.type === 'expense' }))
      ratioData = this.buildRatioData(reportYearData)
    }

    // 预算计算（仅当月且有预算时）
    var budgetData = this.calcBudget(yearData)

    var list = filtered.map(function (item) { return decorateItem(item, mc, this.data.partnerName) }.bind(this))
    this.setData({
      list: list, stats: stats, monthStats: monthStats, catStats: catStats,
      yearStats: yearStatsForDisplay, pieStyle: pieData.style,
      pieLegend: pieData.legend, ratioMyPct: ratioData.myPct, ratioPartnerPct: ratioData.partnerPct,
      ratioMyStyle: ratioData.myStyle, ratioPartnerStyle: ratioData.partnerStyle,
      budgetUsed: budgetData.used, budgetLeft: budgetData.left,
      budgetPercent: budgetData.percent, budgetStyle: budgetData.style
    })
  },

  calcStats(list) {
    var te = 0, ti = 0, me = 0, mi = 0, pe = 0, pi = 0
    var mc = this.data.myCode
    list.forEach(function (item) {
      var m = Number(item.money) || 0
      if (item.type === 'income') {
        ti += m
        if (item.authorCode === mc) mi += m; else pi += m
      } else {
        te += m
        if (item.authorCode === mc) me += m; else pe += m
      }
    })
    return {
      totalExpense: fmt(te), totalIncome: fmt(ti), balance: fmt(ti - te),
      myExpense: fmt(me), myIncome: fmt(mi),
      partnerExpense: fmt(pe), partnerIncome: fmt(pi)
    }
  },

  buildMonthStats(list) {
    var map = {}
    list.forEach(function (item) {
      var mk = monthKey(item.createTime || Date.now())
      if (!map[mk]) map[mk] = { expense: 0, income: 0, month: mk }
      if (item.type === 'income') map[mk].income += Number(item.money) || 0
      else map[mk].expense += Number(item.money) || 0
    })
    var keys = Object.keys(map).sort(function (a, b) { return b.localeCompare(a) })
    return keys.slice(0, 12).map(function (k) {
      var m = map[k]
      var total = m.expense + m.income
      var ew = total > 0 ? Math.round(m.expense / total * 100) : 0
      var iw = total > 0 ? Math.round(m.income / total * 100) : 0
      return {
        month: k, expense: fmt(m.expense), income: fmt(m.income),
        expenseW: ew, incomeW: iw,
        expenseStyle: 'width: ' + ew + '%;', incomeStyle: 'width: ' + iw + '%;'
      }
    }).reverse()
  },

  buildCatStats(list) {
    var map = {}
    var total = 0
    list.forEach(function (item) {
      var cat = item.category || '其他'
      var m = Number(item.money) || 0
      map[cat] = (map[cat] || 0) + m
      total += m
    })
    var cats = EXPENSE_CATS.concat(INCOME_CATS)
    var seen = {}
    var items = []
    cats.forEach(function (c) {
      if (seen[c.name]) return; seen[c.name] = true
      var amt = map[c.name] || 0
      var pct = total > 0 ? Math.round(amt / total * 100) : 0
      if (amt > 0) items.push({
        name: c.name, icon: c.icon, color: c.color,
        amount: fmt(amt), amountNum: amt,
        percent: pct,
        iconStyle: 'background: ' + c.color + ';',
        barStyle: 'width: ' + pct + '%; background: ' + c.color + ';'
      })
    })
    return items.sort(function (a, b) { return b.amountNum - a.amountNum })
  },

  buildPieData(list) {
    var map = {}
    var total = 0
    list.forEach(function (item) {
      var cat = item.category || '其他'
      var m = Number(item.money) || 0
      map[cat] = (map[cat] || 0) + m
      total += m
    })
    var keys = Object.keys(map).sort(function (a, b) { return map[b] - map[a] })
    var colors = ['#ff6b8a', '#4ecdc4', '#ffa94d', '#da77f2', '#4dabf7', '#69db7c', '#ff8787', '#fcc419', '#20c997', '#adb5bd']
    var gradient = ''
    var legend = []
    if (total === 0) {
      gradient = 'conic-gradient(#eee 0deg 360deg)'
    } else {
      var deg = 0
      var parts = []
      keys.forEach(function (k, i) {
        var pct = map[k] / total * 360
        var color = colors[i % colors.length]
        parts.push(color + ' ' + deg.toFixed(1) + 'deg ' + (deg + pct).toFixed(1) + 'deg')
        legend.push({ name: k, color: color, dotStyle: 'background: ' + color + ';', percent: Math.round(map[k] / total * 100), amount: fmt(map[k]) })
        deg += pct
      })
      gradient = 'conic-gradient(' + parts.join(', ') + ')'
    }
    return { gradient: gradient, style: 'background: ' + gradient + ';', legend: legend.slice(0, 6) }
  },

  buildRatioData(list) {
    var me = 0, partner = 0
    var mc = this.data.myCode
    list.forEach(function (item) {
      var m = Number(item.money) || 0
      if (item.authorCode === mc) me += m
      else partner += m
    })
    var total = me + partner
    var myPct = total > 0 ? Math.round(me / total * 100) : 50
    var partnerPct = total > 0 ? Math.round(partner / total * 100) : 50
    return {
      myPct: myPct, partnerPct: partnerPct,
      myStyle: 'width: ' + myPct + '%;', partnerStyle: 'width: ' + partnerPct + '%;'
    }
  },

  prevYear() {
    var y = this.data.selectedYear - 1
    if (y < 2020) return
    this.setData({ selectedYear: y }, function () { this.applyData(this.allCache || []) }.bind(this))
  },
  nextYear() {
    var y = this.data.selectedYear + 1
    if (y > 2099) return
    this.setData({ selectedYear: y }, function () { this.applyData(this.allCache || []) }.bind(this))
  },

  // 月份选择器
  prevMonth() {
    var m = this.data.selectedMonth
    var y = this.data.selectedYear
    if (m === -1) { m = 11; y-- } else { m-- }
    if (y < 2020) return
    var labels = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月']
    this.setData({ selectedMonth: m, selectedYear: y, monthLabel: m >= 0 ? labels[m] : '全年' }, function () { this.applyData(this.allCache || []) }.bind(this))
  },
  nextMonth() {
    var m = this.data.selectedMonth
    var y = this.data.selectedYear
    var now = new Date()
    if (m === -1) { m = 0; y++ } else if (m === 11) { m = -1 } else { m++ }
    if (y > now.getFullYear()) return
    if (m >= 0 && y === now.getFullYear() && m > now.getMonth()) { m = -1 }
    var labels = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月']
    this.setData({ selectedMonth: m, selectedYear: y, monthLabel: m >= 0 ? labels[m] : '全年' }, function () { this.applyData(this.allCache || []) }.bind(this))
  },

  // 预算计算
  calcBudget(list) {
    var budget = parseFloat(this.data.budget) || 0
    if (budget <= 0 || this.data.selectedMonth < 0) {
      return { used: 0, left: 0, percent: 0, style: 'width: 0%;' }
    }
    var used = 0
    list.forEach(function (i) {
      if (i.type === 'expense') used += Number(i.money) || 0
    })
    var pct = Math.min(Math.round(used / budget * 100), 100)
    var barColor = pct >= 90 ? '#ff6b8a' : pct >= 70 ? '#ffa94d' : '#4ecdc4'
    return {
      used: used, left: Math.max(budget - used, 0),
      percent: pct, style: 'width: ' + pct + '%; background: ' + barColor + ';'
    }
  },

  showBudgetInput() {
    this.setData({ showBudgetInput: true, budgetInput: this.data.budget })
  },
  onBudgetInput(e) { this.setData({ budgetInput: e.detail.value }) },
  saveBudget() {
    var val = parseFloat(this.data.budgetInput) || 0
    if (val <= 0) { wx.showToast({ title: '请输入有效预算', icon: 'none' }); return }
    var budgetStr = String(val)
    this.setData({ budget: budgetStr, showBudgetInput: false, budgetInput: '' }, function () { this.applyData(this.allCache || []) }.bind(this))
    // 持久化到本地存储，避免页面卸载后丢失
    wx.setStorageSync('money_budget', budgetStr)
    wx.showToast({ title: '预算已设置 ✨', icon: 'success' })
  },
  cancelBudget() { this.setData({ showBudgetInput: false, budgetInput: '' }) },

  switchTab(e) {
    var tab = e.currentTarget.dataset.tab
    this.setData({ tab: tab }, function () { this.applyData(this.allCache || []) }.bind(this))
  },

  toggleReport() {
    var v = this.data.viewMode === 'report' ? 'list' : 'report'
    this.setData({ viewMode: v }, function () { this.applyData(this.allCache || []) }.bind(this))
  },

  reportFilter(e) {
    var mode = e.currentTarget.dataset.mode
    this.setData({ reportMode: mode }, function () { this.applyData(this.allCache || []) }.bind(this))
  },

  toggleForm() {
    if (!wx.getStorageSync('hasCouple')) { wx.showToast({ title: '请先绑定情侣', icon: 'none' }); return }
    this.setData({ showForm: !this.data.showForm, formType: 'expense', categoryIndex: 0 })
  },

  setFormType(e) {
    this.setData({ formType: e.currentTarget.dataset.type, categoryIndex: 0 })
  },

  onTitleInput(e) { this.setData({ title: e.detail.value }) },
  onMoneyInput(e) { this.setData({ money: e.detail.value }) },
  onNoteInput(e) { this.setData({ note: e.detail.value }) },
  onCategoryChange(e) { this.setData({ categoryIndex: Number(e.detail.value) }) },
  onPayChange(e) { this.setData({ payIndex: Number(e.detail.value) }) },
  onDateChange(e) { this.setData({ expenseDate: e.detail.value }) },

  addRecord() {
    var title = this.data.title, money = this.data.money
    var type = this.data.formType, ci = this.data.categoryIndex
    if (!title.trim()) { wx.showToast({ title: '请输入用途', icon: 'none' }); return }
    var amt = Number(money)
    if (!amt || amt <= 0) { wx.showToast({ title: '请输入有效金额', icon: 'none' }); return }

    // 确保 myCode 有效
    var mc = this.data.myCode || wx.getStorageSync('myCode') || ''
    if (!mc) { wx.showToast({ title: '用户信息异常，请重新进入', icon: 'none' }); return }
    this.setData({ myCode: mc })

    var cp = getCoupleId()
    if (!cp) { wx.showToast({ title: '请先绑定情侣', icon: 'none' }); return }

    var cats = type === 'income' ? INCOME_CATS : EXPENSE_CATS
    var cat = cats[ci] || cats[cats.length - 1]
    var authorName = wx.getStorageSync('myName') || wx.getStorageSync('boyName') || wx.getStorageSync('girlName') || '我'
    var that = this
    wx.showLoading({ title: '保存中...' })
    db.collection('money').add({ data: {
      type: type, title: title.trim(), money: amt,
      category: cat.name, categoryColor: cat.color,
      payMethod: PAY_METHODS[this.data.payIndex] || '其他',
      note: (this.data.note || '').trim(),
      expenseDate: this.data.expenseDate || todayStr(),
      authorCode: mc,
      authorName: authorName,
      coupleId: cp,
      authorOpenid: wx.getStorageSync('openid') || '',
      createTime: Date.now()
    }}).then(function (res) {
      wx.hideLoading()
      wx.showToast({ title: '已记录 ✨', icon: 'success' })
      // 构造本地记录并立即插入缓存，避免 DB 查询延迟导致页面不刷新
      var newRecord = {
        _id: res._id,
        type: type, title: title.trim(), money: amt,
        category: cat.name, categoryColor: cat.color,
        payMethod: PAY_METHODS[that.data.payIndex] || '其他',
        note: (that.data.note || '').trim(),
        expenseDate: that.data.expenseDate || todayStr(),
        authorCode: mc,
        authorName: authorName,
        coupleId: cp,
        createTime: Date.now()
      }
      that.allCache.unshift(newRecord)
      that.setData({ title: '', money: '', note: '', categoryIndex: 0, payIndex: 0, expenseDate: todayStr(), showForm: false })
      that.applyData(that.allCache)
    }).catch(function (err) {
      wx.hideLoading()
      console.error('记账保存失败:', err)
      var msg = '保存失败'
      if (err && err.errMsg) {
        if (err.errMsg.indexOf('permission') > -1) msg = '权限不足，请检查数据库权限设置'
        else if (err.errMsg.indexOf('timeout') > -1) msg = '网络超时，请重试'
        else msg = err.errMsg
      }
      wx.showToast({ title: msg, icon: 'none', duration: 3000 })
    })
  },

  deleteItem(e) {
    var id = e.currentTarget.dataset.id
    var item = this.data.list.find(function (i) { return i._id === id })
    if (!item) return
    if (!item.isMine) { wx.showToast({ title: '只能删除自己的记录', icon: 'none' }); return }
    var that = this
    wx.showModal({
      title: '提示', content: '确定删除这条记录吗？',
      success: function (res) {
        if (!res.confirm) return
        db.collection('money').doc(id).remove().then(function () {
          wx.showToast({ title: '已删除' }); that.loadData()
        })
      }
    })
  }
})

function decorateItem(item, myCode, partnerName) {
  var isMine = item.authorCode === myCode
  var cats = item.type === 'income' ? INCOME_CATS : EXPENSE_CATS
  var cat = cats.find(function (c) { return c.name === item.category }) || cats[cats.length - 1]
  var sign = item.type === 'income' ? '+' : '-'
  var myName = wx.getStorageSync('myName') || '我'
  var label = item.authorName || (isMine ? myName : (partnerName || 'Ta'))
  return Object.assign({}, item, {
    isMine: isMine,
    ownerLabel: label,
    ownerClass: isMine ? 'mine' : 'partner',
    moneyText: fmt(item.money),
    sign: sign,
    categoryIcon: cat.icon,
    categoryColor: item.categoryColor || cat.color,
    typeLabel: item.type === 'income' ? '收入' : '支出'
  })
}
