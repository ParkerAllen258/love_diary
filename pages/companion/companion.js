const db = wx.cloud.database()
const { callRelationship, getCoupleId } = require('../../utils/relationship')
const { callSharedData, resolveFileUrls } = require('../../utils/sharedData')
const { waitForAuth } = require('../../utils/auth')

// ========== 状态配置 ==========
var STATUS_CONFIG = [
  { key: 'together', emoji: '🏠', label: '见面了', desc: '平淡日常的陪伴', color: '#ff6b8a', bg: 'rgba(255,107,138,0.08)' },
  { key: 'apart', emoji: '💔', label: '异地', desc: '想念但心在一起', color: '#8b9dc3', bg: 'rgba(139,157,195,0.08)' },
  { key: 'date', emoji: '💕', label: '约会', desc: '甜蜜的二人时光', color: '#ff4081', bg: 'rgba(255,64,129,0.08)' },
  { key: 'dinner', emoji: '🍽️', label: '一起吃饭', desc: '美食与爱不可辜负', color: '#ff6d3a', bg: 'rgba(255,109,58,0.08)' },
  { key: 'movie', emoji: '🎬', label: '看电影', desc: '属于我们的光影时刻', color: '#7c4dff', bg: 'rgba(124,77,255,0.08)' },
  { key: 'travel', emoji: '✈️', label: '一起旅行', desc: '陪你走遍世界', color: '#00bcd4', bg: 'rgba(0,188,212,0.08)' },
  { key: 'shopping', emoji: '🛍️', label: '逛街', desc: '手牵手逛遍大街小巷', color: '#ff9800', bg: 'rgba(255,152,0,0.08)' },
  { key: 'sport', emoji: '🏃', label: '一起运动', desc: '陪你流汗的日子', color: '#4caf50', bg: 'rgba(76,175,80,0.08)' }
]

var EMOTION_CONFIG = [
  { key: 'love', emoji: '🥰', label: '幸福' },
  { key: 'happy', emoji: '😊', label: '开心' },
  { key: 'miss_you', emoji: '💭', label: '想你' },
  { key: 'grateful', emoji: '🙏', label: '感恩' },
  { key: 'excited', emoji: '🤩', label: '兴奋' },
  { key: 'calm', emoji: '😌', label: '平静' },
  { key: 'touched', emoji: '🥺', label: '感动' },
  { key: 'sweet', emoji: '🍬', label: '超甜' }
]

var MONTH_NAMES = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月']

// ========== 工具函数 ==========
function formatDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0')
}
function todayStr() { return formatDate(new Date()) }

Page({
  data: {
    hasCouple: false,
    myCode: '',
    myOpenid: '',
    partnerCode: '',
    myName: '我',
    partnerName: 'TA',
    boyAvatar: '',
    girlAvatar: '',
    defaultAvatar: 'https://dummyimage.com/200x200/ffb6c1/ffffff',

    // 恋爱天数
    loveDate: '',
    loveDays: 0,
    loveDateSet: false,
    showDatePicker: false,
    pickerYear: new Date().getFullYear(),
    pickerMonth: new Date().getMonth() + 1,
    pickerDay: new Date().getDate(),

    // 今日签到状态
    todayMySigned: false,
    todayPartnerSigned: false,
    todayBothSigned: false,
    heartClass: 'heart-none',
    heartTip: '今天还没人签到哦～',

    // 统计数据
    stats: { togetherDays: 0, apartDays: 0, togetherRate: 0, longestTogether: 0, longestApart: 0 },
    statAdjustment: { togetherOffset: 0, apartOffset: 0 },

    // 统计修改弹窗
    showStatEditor: false,
    editingStat: '',
    editStatBase: 0,
    editStatValue: '',

    // 热力图 - 当前月
    currentMonth: new Date().getMonth(),
    currentYear: new Date().getFullYear(),
    monthLabel: MONTH_NAMES[new Date().getMonth()],
    monthCells: [],
    weekLabels: ['一','二','三','四','五','六','日'],
    showMonthPicker: false,
    monthPickerYear: new Date().getFullYear(),
    monthPickerOptions: [0,1,2,3,4,5,6,7,8,9,10,11],
    yearRange: [2020,2021,2022,2023,2024,2025,2026,2027,2028,2029,2030],
    monthRange: [1,2,3,4,5,6,7,8,9,10,11,12],
    dayRange: ['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','25','26','27','28','29','30','31'],

    // 签到弹窗
    showForm: false,
    selectedStatus: '',
    selectedEmotion: '',
    checkinNote: '',
    checkinPlace: '',
    checkinPhoto: '',
    statusConfig: STATUS_CONFIG,
    emotionConfig: EMOTION_CONFIG,

    // 最近记录
    recentRecords: [],

    // 年度报告
    showAnnualReport: false,
    annualData: null,

    // 游戏区
    gameModules: [
      { key: 'tree', emoji: '🌳', title: '共同种树', desc: '每天签到浇灌爱情树', active: true },
      { key: 'quiz', emoji: '❓', title: '情侣问答', desc: '测测你们有多了解彼此', coming: true },
      { key: 'tacit', emoji: '🤝', title: '默契测试', desc: '看看你们有多默契', coming: true },
      { key: 'fortune', emoji: '🎋', title: '抽签小游戏', desc: '每日一签，甜蜜运势', coming: true },
      { key: 'wheel', emoji: '🎡', title: '情侣转盘', desc: '今天做什么？转一转', coming: true },
      { key: 'challenge', emoji: '🎯', title: '约会挑战', desc: '随机生成约会任务', coming: true }
    ],

    // 共同种树
    tree: {
      exists: false,
      stage: 0,
      growth: 0,
      streak: 0,
      totalGrowth: 0,
      wateredByMe: false,
      stageName: '🌰 种子',
      stageEmoji: '🌰',
      stageDesc: '埋下一颗爱的种子',
      growthPercent: 0
    },
    treeStages: [
      { name: '🌰 种子', emoji: '🌰', desc: '埋下一颗爱的种子', minGrowth: 0 },
      { name: '🌱 发芽', emoji: '🌱', desc: '感情在悄悄发芽', minGrowth: 100 },
      { name: '🪴 小树苗', emoji: '🪴', desc: '小树苗需要共同呵护', minGrowth: 200 },
      { name: '🌿 茂盛生长', emoji: '🌿', desc: '感情越来越茂盛', minGrowth: 300 },
      { name: '🌸 开花', emoji: '🌸', desc: '爱情开出美丽的花朵', minGrowth: 400 },
      { name: '🍎 结果', emoji: '🍎', desc: '收获甜蜜的果实', minGrowth: 500 }
    ],

    // 日期详情弹窗
    showDayDetail: false,
    dayDetailDate: '',
    dayDetailRecords: [],
    canRetroSign: false,
    retroSignTip: '',

    // 补签弹窗
    showRetroForm: false,
    retroDate: '',
    retroStatus: '',
    retroEmotion: '',
    retroNote: '',
    retroPlace: '',
    retroPhoto: ''
  },

  // ==================== 生命周期 ====================
  async onLoad() {
    await waitForAuth()
    var mc = wx.getStorageSync('myCode') || ''
    var pc = wx.getStorageSync('partnerCode') || ''
    var has = !!wx.getStorageSync('hasCouple')
    var now = new Date()
    this.setData({
      hasCouple: has,
      myCode: mc,
      myOpenid: wx.getStorageSync('openid') || '',
      partnerCode: pc,
      myName: wx.getStorageSync('myName') || '我',
      partnerName: wx.getStorageSync('partnerName') || 'TA',
      currentYear: now.getFullYear(),
      currentMonth: now.getMonth(),
      monthLabel: MONTH_NAMES[now.getMonth()]
    })
    if (has) {
      this.loadCoupleInfo()
      this.loadTodayStatus()
      this.loadStats()
      this.loadMonthHeatmap()
      this.loadRecentRecords()
      this.loadTree()
    }
  },

  async onShow() {
    await waitForAuth()
    var has = !!wx.getStorageSync('hasCouple')
    this.setData({ hasCouple: has })
    if (has) {
      this.loadCoupleInfo()
      this.loadTodayStatus()
      this.loadStats()
      this.loadMonthHeatmap()
      this.loadRecentRecords()
      this.loadTree()
    }
    // 启动统计轮询（检测伴侣签到后自动刷新）
    this.startStatsTimer()
  },

  onHide() {
    this.stopStatsTimer()
  },

  onUnload() {
    this.stopStatsTimer()
  },

  startStatsTimer() {
    this.stopStatsTimer()
    var that = this
    this._statsTimer = setInterval(function () {
      var has = !!wx.getStorageSync('hasCouple')
      if (!has) return
      that.loadTodayStatus()
      that.loadStats()
      that.loadMonthHeatmap()   // 伴侣补签后热力图同步更新
      that.loadRecentRecords()  // 最近记录同步刷新
      that.loadTree()           // 伴侣签到后树状态同步更新
    }, 3000)  // 每3秒刷新一次（快速检测伴侣签到/补签）
  },

  stopStatsTimer() {
    if (this._statsTimer) {
      clearInterval(this._statsTimer)
      this._statsTimer = null
    }
  },

  // ==================== 情侣信息 & 恋爱日期 ====================
  loadCoupleInfo() {
    if (!getCoupleId()) return
    var ba = wx.getStorageSync('boyAvatar') || ''
    var ga = wx.getStorageSync('girlAvatar') || ''
    var loveDate = wx.getStorageSync('loveDate') || ''
    var bn = wx.getStorageSync('boyName') || 'Boy'
    var gn = wx.getStorageSync('girlName') || 'Girl'
      var loveDays = 0
      if (loveDate) {
        var ld = new Date(loveDate)
        if (!isNaN(ld.getTime())) {
          loveDays = Math.floor((new Date() - ld) / (1000 * 60 * 60 * 24))
          if (loveDays < 0) loveDays = 0
        }
      }

      var adj = wx.getStorageSync('statAdjustment') || {}
      if (adj.togetherOffset === undefined) adj.togetherOffset = 0
      if (adj.apartOffset === undefined) adj.apartOffset = 0

      this.setData({
        boyAvatar: ba, girlAvatar: ga,
        boyName: bn, girlName: gn,
        myName: wx.getStorageSync('myName') || '我',
        partnerName: wx.getStorageSync('partnerName') || 'TA',
        loveDate: loveDate,
        loveDays: loveDays,
        loveDateSet: !!loveDate,
        statAdjustment: adj
      })
  },

  // ==================== 设置恋爱日期 ====================
  openDatePicker() {
    var ld = this.data.loveDate
    var y = new Date().getFullYear()
    var m = new Date().getMonth() + 1
    var d = new Date().getDate()
    if (ld) {
      var parts = ld.split('-')
      if (parts.length === 3) {
        y = parseInt(parts[0])
        m = parseInt(parts[1])
        d = parseInt(parts[2])
        if (isNaN(y) || isNaN(m) || isNaN(d)) {
          y = new Date().getFullYear()
          m = new Date().getMonth() + 1
          d = new Date().getDate()
        }
      }
    }
    this.setData({ showDatePicker: true, pickerYear: y, pickerMonth: m, pickerDay: d })
  },

  closeDatePicker() { this.setData({ showDatePicker: false }) },

  onYearChange(e) { this.setData({ pickerYear: this.data.yearRange[e.detail.value] }) },
onMonthChange(e) { this.setData({ pickerMonth: parseInt(e.detail.value) + 1 }) },
onDayChange(e) { this.setData({ pickerDay: parseInt(e.detail.value) + 1 }) },

  saveLoveDate() {
    var y = this.data.pickerYear
    var m = this.data.pickerMonth
    var d = this.data.pickerDay
    var dateStr = y + '-' + String(m).padStart(2,'0') + '-' + String(d).padStart(2,'0')

    // 日期格式校验（与 index.js chooseDate 一致）
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      wx.showToast({ title: '日期格式错误', icon: 'none' }); return
    }
    var parsed = new Date(dateStr)
    if (isNaN(parsed.getTime())) {
      wx.showToast({ title: '无效日期', icon: 'none' }); return
    }
    // 日期部分一致性检查（杜绝 2024-02-30 等无效日期）
    if (parsed.getFullYear() !== y || (parsed.getMonth() + 1) !== m || parsed.getDate() !== d) {
      wx.showToast({ title: '无效日期', icon: 'none' }); return
    }

    var loveDays = Math.floor((new Date() - parsed) / (1000 * 60 * 60 * 24))
    if (loveDays < 0) { wx.showToast({ title: '日期不能在未来', icon: 'none' }); return }

    var that = this
    wx.showLoading({ title: '保存中...' })
    if (!getCoupleId()) { wx.hideLoading(); return }
    callRelationship('updateCoupleFields', { fields: { loveDate: dateStr } }).then(function () {
        wx.hideLoading()
        wx.setStorageSync('loveDate', dateStr)
        that.setData({ loveDate: dateStr, loveDays: loveDays, loveDateSet: true, showDatePicker: false })
        wx.showToast({ title: '设置成功 ❤️', icon: 'success' })
      }).catch(function () { wx.hideLoading(); wx.showToast({ title: '保存失败', icon: 'none' }) })
  },

  // ==================== 今日签到状态 ====================
  loadTodayStatus() {
    var cp = getCoupleId()
    if (!cp) return
    var today = todayStr()
    var myOpenid = this.data.myOpenid || wx.getStorageSync('openid') || ''
    var that = this
    db.collection('companion_records').where({ coupleId: cp, date: today }).limit(20).get().then(function (res) {
      var records = res.data || []
      var authors = {}
      records.forEach(function (r) { authors[r.authorOpenid] = true })
      var mySigned = !!authors[myOpenid]
      var partnerSigned = Object.keys(authors).some(function (k) { return k !== myOpenid })
      var both = mySigned && partnerSigned

      var heartClass = 'heart-none'
      var tip = '今天还没人签到哦～'
      if (both) { heartClass = 'heart-both'; tip = '今日双方已签到 ❤️' }
      else if (mySigned && !partnerSigned) { heartClass = 'heart-half'; tip = '你已签到，等TA来～' }
      else if (!mySigned && partnerSigned) { heartClass = 'heart-half'; tip = 'TA已签到，你还没签哦～' }

      // 取最新记录显示状态
      var latest = records.sort(function (a, b) { return b.createTime - a.createTime })[0]
      var todayStatusText = '今天还没记录哦'
      var todayEmoji = '📝'
      if (latest) {
        var sc = STATUS_CONFIG.find(function (s) { return s.key === latest.status })
        if (sc) { todayEmoji = sc.emoji; todayStatusText = sc.label }
      }

      that.setData({
        todayMySigned: mySigned,
        todayPartnerSigned: partnerSigned,
        todayBothSigned: both,
        heartClass: heartClass,
        heartTip: tip,
        todayStatusText: todayStatusText,
        todayEmoji: todayEmoji,
        todayRecordId: latest ? latest._id : ''
      })
    }).catch(function () {
      that.setData({ todayMySigned: false, todayPartnerSigned: false, todayBothSigned: false, heartClass: 'heart-none', heartTip: '今天还没人签到哦～' })
    })
  },

  // ==================== 统计 ====================
  loadStats() {
    var cp = getCoupleId()
    if (!cp) return
    var today = todayStr()
    var that = this

    // skip 分页拉取全部记录（避免 gte 游标死循环 + 重复数据）
    var allRecords = []
    var BATCH = 100
    var MAX_BATCHES = 500  // safe limit: 500 * 100 = 50000 records (25+ years)
    var batchCount = 0
    var skipCount = 0

    function fetchBatch() {
      batchCount++
      if (batchCount > MAX_BATCHES) {
        console.warn('loadStats: 达到安全上限，使用已拉取数据计算')
        that.calcStats(allRecords, today)
        return
      }

      db.collection('companion_records')
        .where({ coupleId: cp })
        .field({ date: true, status: true, authorOpenid: true })
        .orderBy('date', 'asc')
        .skip(skipCount)
        .limit(BATCH)
        .get()
        .then(function (res) {
          var data = res.data || []
          allRecords = allRecords.concat(data)

          if (data.length === BATCH) {
            skipCount += BATCH
            fetchBatch()
          } else {
            // 全部拉完
            that.calcStats(allRecords, today)
          }
        })
        .catch(function () {
          // 出错时用已拉取的数据计算
          if (allRecords.length > 0) that.calcStats(allRecords, today)
        })
    }

    fetchBatch()
  },

  // 计算统计：遍历从 loveDate 到今天的每一天，逐日判定异地/见面
  calcStats(records, today) {
    var that = this
    // 按日期聚合：dayMap[date] = { statuses: ['apart','together',...], authorCount: N }
    var dayMap = {}
    var dates = []
    records.forEach(function (r) {
      if (!dayMap[r.date]) { dayMap[r.date] = { statuses: [], authorCount: 0 }; dates.push(r.date) }
      dayMap[r.date].statuses.push(r.status)
      dayMap[r.date].authorCount++
    })

    // 起始日期：优先恋爱纪念日，否则用最早记录日期
    var loveDate = wx.getStorageSync('loveDate')
    if (!loveDate && dates.length > 0) {
      dates.sort()
      loveDate = dates[0]
    }
    if (!loveDate) loveDate = today

    var startDate = new Date(loveDate)
    if (isNaN(startDate.getTime())) startDate = new Date(today)

    var totalDays = Math.floor((new Date(today) - startDate) / (1000 * 60 * 60 * 24)) + 1
    if (totalDays < 1 || isNaN(totalDays)) totalDays = 0

    var togetherDays = 0   // 见面天数（至少一条非 apart 状态）
    var apartDays = 0      // 异地天数（全部都是 apart）
    var longestTogether = 0
    var longestApart = 0
    var curTogether = 0
    var curApart = 0

    for (var i = 0; i < totalDays; i++) {
      var d = new Date(startDate)
      d.setDate(d.getDate() + i)
      var ds = formatDate(d)
      if (ds > today) break
      var dm = dayMap[ds]

      // 当天无任何签到记录 → 连续中断
      if (!dm || dm.statuses.length === 0) {
        curTogether = 0
        curApart = 0
        continue
      }

      // 判定逻辑：只要有一条不是 apart，就算见面日
      var allApart = dm.statuses.every(function (s) { return s === 'apart' })

      if (allApart) {
        apartDays++
        curApart++
        curTogether = 0
        if (curApart > longestApart) longestApart = curApart
      } else {
        togetherDays++
        curTogether++
        curApart = 0
        if (curTogether > longestTogether) longestTogether = curTogether
      }
    }

    // 保存原始计算值（供修改弹窗使用）
    that._computedTogether = togetherDays
    that._computedApart = apartDays

    // 应用手动调整偏移量（同一偏移量同时影响天数和最长连续）
    var adj = that.data.statAdjustment || wx.getStorageSync('statAdjustment') || { togetherOffset: 0, apartOffset: 0 }
    var adjTogether = togetherDays + (adj.togetherOffset || 0)
    var adjApart = apartDays + (adj.apartOffset || 0)
    var adjLongestTogether = longestTogether + (adj.togetherOffset || 0)
    var adjLongestApart = longestApart + (adj.apartOffset || 0)
    if (adjTogether < 0) adjTogether = 0
    if (adjApart < 0) adjApart = 0
    if (adjLongestTogether < 0) adjLongestTogether = 0
    if (adjLongestApart < 0) adjLongestApart = 0

    var totalRecorded = adjTogether + adjApart
    var rate = totalRecorded > 0 ? Math.round(adjTogether / totalRecorded * 100) : 0

    that.setData({
      statAdjustment: adj,
      stats: {
        togetherDays: adjTogether,
        apartDays: adjApart,
        togetherRate: rate,
        longestTogether: adjLongestTogether,
        longestApart: adjLongestApart
      }
    })
  },

  // ==================== 月热力图 ====================
  loadMonthHeatmap() {
    var cp = getCoupleId()
    if (!cp) return
    var year = this.data.currentYear
    var month = this.data.currentMonth
    var startDate = year + '-' + String(month + 1).padStart(2, '0') + '-01'
    var daysInMonth = new Date(year, month + 1, 0).getDate()
    var endDate = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(daysInMonth).padStart(2, '0')
    var that = this
    db.collection('companion_records').where({
      coupleId: cp,
      date: db.command.gte(startDate).and(db.command.lte(endDate))
    }).field({ date: true, status: true, authorOpenid: true }).limit(1000).get().then(function (res) {
      var records = res.data || []
      var dayMap = {}
      records.forEach(function (r) {
        if (!dayMap[r.date]) dayMap[r.date] = { statuses: [], authors: {} }
        dayMap[r.date].statuses.push(r.status)
        dayMap[r.date].authors[r.authorOpenid] = true
      })
      that.buildMonthHeatmap(dayMap)
    }).catch(function () {})
  },

  buildMonthHeatmap(dayMap) {
    var year = this.data.currentYear
    var month = this.data.currentMonth
    var today = todayStr()
    var daysInMonth = new Date(year, month + 1, 0).getDate()
    var firstDayOfWeek = new Date(year, month, 1).getDay()
    var startOffset = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1

    var cells = []
    for (var p = 0; p < startOffset; p++) { cells.push({ day: '', empty: true }) }
    for (var d = 1; d <= daysInMonth; d++) {
      var ds = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0')
      var dm = dayMap[ds]
      var isFuture = ds > today
      var isToday = ds === today

      var cellType = 'none' // none / half / together / apart
      if (dm && dm.statuses.length > 0) {
        var allApart = dm.statuses.every(function (s) { return s === 'apart' })
        var authorCount = Object.keys(dm.authors).length
        if (authorCount >= 2) {
          if (allApart) { cellType = 'apart' }
          else { cellType = 'together' }
        } else {
          cellType = 'half'
        }
      }

      cells.push({
        day: d, dateStr: ds, empty: false,
        isFuture: isFuture, isToday: isToday,
        cellType: cellType
      })
    }

    this.setData({
      monthCells: cells,
      monthLabel: MONTH_NAMES[month],
      monthRows: Math.ceil((startOffset + daysInMonth) / 7)
    })
  },

  // ==================== 年月选择器 ====================
  prevMonthQuick() {
    var m = this.data.currentMonth - 1
    var y = this.data.currentYear
    if (m < 0) { m = 11; y-- }
    if (y < 2020) return
    this.setData({ currentMonth: m, currentYear: y, monthLabel: MONTH_NAMES[m] })
    this.loadMonthHeatmap()
    this.loadStats()
  },
  nextMonthQuick() {
    var m = this.data.currentMonth + 1
    var y = this.data.currentYear
    if (m > 11) { m = 0; y++ }
    var today = new Date()
    if (y > today.getFullYear() || (y === today.getFullYear() && m > today.getMonth())) return
    this.setData({ currentMonth: m, currentYear: y, monthLabel: MONTH_NAMES[m] })
    this.loadMonthHeatmap()
    this.loadStats()
  },
  openMonthPicker() {
    this.setData({ showMonthPicker: true, monthPickerYear: this.data.currentYear })
  },
  closeMonthPicker() { this.setData({ showMonthPicker: false }) },
  mpPrevYear() {
    var y = this.data.monthPickerYear - 1
    if (y < 2020) return
    this.setData({ monthPickerYear: y })
  },
  mpNextYear() {
    var y = this.data.monthPickerYear + 1
    if (y > new Date().getFullYear()) return
    this.setData({ monthPickerYear: y })
  },
  selectMonth(e) {
    var m = parseInt(e.currentTarget.dataset.month)
    var y = this.data.monthPickerYear
    var today = new Date()
    if (y > today.getFullYear() || (y === today.getFullYear() && m > today.getMonth())) return
    this.setData({
      currentMonth: m,
      currentYear: y,
      monthLabel: MONTH_NAMES[m],
      showMonthPicker: false
    })
    this.loadMonthHeatmap()
    this.loadStats()
  },

  // ==================== 签到弹窗 ====================
  openCheckin() {
    this.setData({ showForm: true, selectedStatus: '', selectedEmotion: '', checkinNote: '', checkinPlace: '', checkinPhoto: '' })
  },
  closeForm() { this.setData({ showForm: false }) },
  pickStatus(e) { this.setData({ selectedStatus: e.currentTarget.dataset.key }) },
  pickEmotion(e) { this.setData({ selectedEmotion: e.currentTarget.dataset.key }) },
  onNoteInput(e) { this.setData({ checkinNote: e.detail.value }) },
  onPlaceInput(e) { this.setData({ checkinPlace: e.detail.value }) },

  choosePhoto() {
    if (!getCoupleId()) { wx.showToast({ title: '请先绑定情侣', icon: 'none' }); return }
    var that = this
    wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], success: function (res) {
      wx.showLoading({ title: '上传中...' })
      var cloudPath = 'couples/' + getCoupleId() + '/companion/' + Date.now() + '_' + Math.random().toString(36).substr(2, 6) + '.png'
      wx.cloud.uploadFile({ cloudPath: cloudPath, filePath: res.tempFiles[0].tempFilePath,
        success: function (ur) { wx.hideLoading(); that.setData({ checkinPhoto: ur.fileID }) },
        fail: function () { wx.hideLoading(); wx.showToast({ title: '上传失败', icon: 'none' }) }
      })
    }})
  },
  removePhoto() { this.setData({ checkinPhoto: '' }) },
  previewCheckinPhoto() {
    if (this.data.checkinPhoto) wx.previewImage({ urls: [this.data.checkinPhoto], current: this.data.checkinPhoto })
  },

  // ==================== 保存签到 ====================
  saveCheckin() {
    var status = this.data.selectedStatus
    if (!status) { wx.showToast({ title: '请选择陪伴状态', icon: 'none' }); return }
    if (!getCoupleId()) { wx.showToast({ title: '请先绑定情侣', icon: 'none' }); return }

    var today = todayStr()
    var data = {
      date: today, status: status,
      emotion: this.data.selectedEmotion || '', note: (this.data.checkinNote || '').trim(),
      place: (this.data.checkinPlace || '').trim(), photo: this.data.checkinPhoto || ''
    }

    var that = this
    wx.showLoading({ title: '签到中...' })
    callSharedData('saveCheckin', data).then(function () {
        wx.hideLoading()
        wx.showToast({ title: '签到成功 ✨', icon: 'success' })
        that.closeForm()
        setTimeout(function () {
          that.loadTodayStatus()
          that.loadStats()
          that.loadMonthHeatmap()
          that.loadRecentRecords()
          that.loadTree()
        }, 300)
      }).catch(function (err) {
        wx.hideLoading()
        console.error('签到失败:', err)
        var msg = '签到失败'
        if (err && err.message) msg = err.message
        wx.showToast({ title: msg, icon: 'none', duration: 3000 })
      })
  },

  // ==================== 删除记录 ====================
  deleteRecord(e) {
    var id = e.currentTarget.dataset.id
    var that = this
    wx.showModal({ title: '删除记录', content: '确定删除这条陪伴记录吗？', confirmColor: '#ff6b8a', success: function (r) {
      if (!r.confirm) return
      callSharedData('deleteOwnedRecord', { collection: 'companion_records', id: id }).then(function () {
        wx.showToast({ title: '已删除' })
        that.loadTodayStatus(); that.loadStats(); that.loadMonthHeatmap(); that.loadRecentRecords()
      }).catch(function (err) { wx.showToast({ title: err.message || '只能删除自己的记录', icon: 'none' }) })
    }})
  },

  // ==================== 最近记录 ====================
  loadRecentRecords() {
    var cp = getCoupleId()
    if (!cp) return
    var that = this
    db.collection('companion_records').where({ coupleId: cp }).orderBy('date', 'desc').limit(20).get().then(async function (res) {
      var rows = res.data || []
      var urls = await resolveFileUrls(rows.map(function (record) { return record.photo }))
      var myOpenid = wx.getStorageSync('openid') || ''
      that.setData({ recentRecords: rows.map(function (record) {
        return Object.assign({}, record, {
          photoFileID: record.photo,
          photo: urls[record.photo] || '',
          isMine: record.authorOpenid === myOpenid
        })
      }) })
    })
  },

  // ==================== 年度报告 ====================
  openAnnualReport() {
    var s = this.data.stats
    var rate = s.togetherRate || 0
    this.setData({ showAnnualReport: true, annualData: Object.assign({}, s, { rateStyle: 'width: ' + rate + '%;' }) })
  },
  closeAnnualReport() { this.setData({ showAnnualReport: false }) },

  // ==================== 游戏入口 ====================
  onGameTap(e) {
    var key = e.currentTarget.dataset.key
    // 仅处理已上线的游戏
    var module = this.data.gameModules.find(function (m) { return m.key === key })
    if (!module || !module.active) return

    if (key === 'tree') {
      // 滚动到共同种树卡片
      wx.pageScrollTo({ selector: '#treeCard', duration: 300 })
    }
  },

  // ==================== 图片预览 ====================
  previewPhoto(e) {
    var url = e.currentTarget.dataset.url
    if (url) wx.previewImage({ urls: [url], current: url })
  },

  // ==================== 日期详情弹窗 ====================
  onDayTap(e) {
    var dateStr = e.currentTarget.dataset.date
    var day = e.currentTarget.dataset.day
    if (!dateStr || !day) return

    var now = new Date()
    var ds = new Date(dateStr)
    if (ds > now) return

    var cp = getCoupleId()
    if (!cp) return
    var that = this
    var myOpenid = this.data.myOpenid || wx.getStorageSync('openid') || ''

    db.collection('companion_records').where({
      coupleId: cp,
      date: dateStr
    }).limit(20).get().then(async function (res) {
      var rows = res.data || []
      var urls = await resolveFileUrls(rows.map(function (record) { return record.photo }))
      var records = rows.map(function (r) {
        var sc = STATUS_CONFIG.find(function (s) { return s.key === r.status })
        var ec = EMOTION_CONFIG.find(function (e) { return e.key === r.emotion })
        return {
          _id: r._id,
          authorOpenid: r.authorOpenid,
          authorName: r.authorName || 'TA',
          status: r.status,
          statusLabel: sc ? sc.emoji + ' ' + sc.label : r.status,
          emotion: r.emotion,
          emotionLabel: ec ? ec.label : '',
          emotionEmoji: ec ? ec.emoji : '',
          place: r.place || '',
          note: r.note || '',
          photo: urls[r.photo] || '',
          photoFileID: r.photo || ''
        }
      })

      var authorOpenids = {}
      records.forEach(function (r) { authorOpenids[r.authorOpenid] = true })
      var canRetroSign = false
      var retroSignTip = ''

      if (dateStr === todayStr()) {
        if (!authorOpenids[myOpenid]) {
          canRetroSign = true
          retroSignTip = '你今天还没签到，可以补签'
        } else {
          retroSignTip = '你今天已经签到过了'
        }
      } else {
        if (!authorOpenids[myOpenid]) {
          canRetroSign = true
          retroSignTip = '你当天忘记签到了，可以补签'
        }
      }

      that.setData({
        showDayDetail: true,
        dayDetailDate: dateStr,
        dayDetailRecords: records,
        canRetroSign: canRetroSign,
        retroSignTip: retroSignTip
      })
    }).catch(function () {
      wx.showToast({ title: '加载失败', icon: 'none' })
    })
  },

  closeDayDetail() {
    this.setData({ showDayDetail: false, dayDetailRecords: [], canRetroSign: false })
  },

  previewDayPhoto(e) {
    var url = e.currentTarget.dataset.url
    if (url) wx.previewImage({ urls: [url], current: url })
  },

  // ==================== 补签弹窗 ====================
  retroSign() {
    this.setData({
      showDayDetail: false,
      showRetroForm: true,
      retroDate: this.data.dayDetailDate,
      retroStatus: '',
      retroEmotion: '',
      retroNote: '',
      retroPlace: '',
      retroPhoto: ''
    })
  },

  closeRetroForm() { this.setData({ showRetroForm: false }) },

  pickRetroStatus(e) { this.setData({ retroStatus: e.currentTarget.dataset.key }) },
  pickRetroEmotion(e) { this.setData({ retroEmotion: e.currentTarget.dataset.key }) },
  onRetroNoteInput(e) { this.setData({ retroNote: e.detail.value }) },
  onRetroPlaceInput(e) { this.setData({ retroPlace: e.detail.value }) },

  chooseRetroPhoto() {
    if (!getCoupleId()) { wx.showToast({ title: '请先绑定情侣', icon: 'none' }); return }
    var that = this
    wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], success: function (res) {
      wx.showLoading({ title: '上传中...' })
      var cloudPath = 'couples/' + getCoupleId() + '/companion/' + Date.now() + '_' + Math.random().toString(36).substr(2, 6) + '.png'
      wx.cloud.uploadFile({ cloudPath: cloudPath, filePath: res.tempFiles[0].tempFilePath,
        success: function (ur) { wx.hideLoading(); that.setData({ retroPhoto: ur.fileID }) },
        fail: function () { wx.hideLoading(); wx.showToast({ title: '上传失败', icon: 'none' }) }
      })
    }})
  },

  removeRetroPhoto() { this.setData({ retroPhoto: '' }) },

  previewRetroPhoto() {
    if (this.data.retroPhoto) wx.previewImage({ urls: [this.data.retroPhoto], current: this.data.retroPhoto })
  },

  saveRetroSign() {
    var status = this.data.retroStatus
    if (!status) { wx.showToast({ title: '请选择陪伴状态', icon: 'none' }); return }
    if (!getCoupleId()) { wx.showToast({ title: '请先绑定情侣', icon: 'none' }); return }

    var retroDate = this.data.retroDate
    var data = {
      date: retroDate, status: status,
      emotion: this.data.retroEmotion || '', note: (this.data.retroNote || '').trim(),
      place: (this.data.retroPlace || '').trim(), photo: this.data.retroPhoto || ''
    }

    var that = this

    wx.showLoading({ title: '补签中...' })

    callSharedData('saveCheckin', data).then(function () {
      wx.hideLoading()
      wx.showToast({ title: '补签成功 ✨', icon: 'success' })
      that.setData({ showRetroForm: false, retroStatus: '', retroEmotion: '', retroNote: '', retroPlace: '', retroPhoto: '' })
      setTimeout(function () {
        that.loadTodayStatus()
        that.loadStats()
        that.loadMonthHeatmap()
        that.loadRecentRecords()
        that.loadTree()
      }, 600)
    }).catch(function (err) {
      wx.hideLoading()
      var msg = '补签失败'
      if (err && err.message) msg = err.message
      wx.showToast({ title: msg, icon: 'none', duration: 3000 })
    })
  },

  // ==================== 共同种树 ====================
  loadTree() {
    var cp = getCoupleId()
    if (!cp) return
    var that = this
    db.collection('couple_tree').doc(cp).get().then(function (res) {
      var tree = res.data
      if (!tree || !tree.coupleId) {
        that.setData({ 'tree.exists': false })
        return
      }
      that.updateTreeDisplay(tree)
    }).catch(function (err) {
      console.error('loadTree query failed:', err)
      that.setData({ 'tree.exists': false })
    })
  },

  updateTreeDisplay(tree) {
    var stages = this.data.treeStages
    var totalGrowth = tree.totalGrowth || 0
    var stage = Math.min(Math.floor(totalGrowth / 100), 5)
    var growthInStage = totalGrowth % 100
    var myOpenid = this.data.myOpenid || wx.getStorageSync('openid') || ''
    var wateredBy = tree.wateredByOpenids || []

    this.setData({
      'tree.exists': true,
      'tree.stage': stage,
      'tree.growth': growthInStage,
      'tree.streak': tree.streak || 0,
      'tree.totalGrowth': totalGrowth,
      'tree.wateredByMe': wateredBy.indexOf(myOpenid) !== -1,
      'tree.stageName': stages[stage].name,
      'tree.stageEmoji': stages[stage].emoji,
      'tree.stageDesc': stages[stage].desc,
      'tree.growthPercent': growthInStage
    })
  },

  checkTreeGrowth() {
    this.loadTree()
  },

  waterTree() {
    var cp = getCoupleId()
    if (!cp) { wx.showToast({ title: '请先绑定情侣', icon: 'none' }); return }
    var that = this
    callSharedData('waterTree').then(function () {
        that.loadTree()
        wx.showToast({ title: '浇水成功 🌧️ +5成长', icon: 'none' })
      }).catch(function (err) { wx.showToast({ title: err.message || '浇水失败', icon: 'none' }) })
  },

  // ==================== 统计天数修改 ====================
  onStatTap(e) {
    var type = e.currentTarget.dataset.type
    if (type !== 'together' && type !== 'apart') return

    var adj = this.data.statAdjustment || { togetherOffset: 0, apartOffset: 0 }
    var raw = type === 'together' ? (this._computedTogether || 0) : (this._computedApart || 0)
    var offset = type === 'together' ? (adj.togetherOffset || 0) : (adj.apartOffset || 0)
    var displayed = raw + offset
    if (displayed < 0) displayed = 0

    this.setData({
      showStatEditor: true,
      editingStat: type,
      editStatBase: raw,
      editStatValue: String(displayed)
    })
  },

  closeStatEditor() {
    this.setData({ showStatEditor: false, editingStat: '', editStatBase: 0, editStatValue: '' })
  },

  onStatValueInput(e) {
    this.setData({ editStatValue: e.detail.value })
  },

  saveStatValue() {
    var type = this.data.editingStat
    var newTotal = parseInt(this.data.editStatValue)
    if (isNaN(newTotal) || newTotal < 0) {
      wx.showToast({ title: '请输入有效的数字（≥0）', icon: 'none' })
      return
    }
    if (newTotal > 99999) {
      wx.showToast({ title: '天数不能超过99999', icon: 'none' })
      return
    }

    var base = this.data.editStatBase
    var offset = newTotal - base

    var adj = this.data.statAdjustment || { togetherOffset: 0, apartOffset: 0 }
    if (type === 'together') {
      adj.togetherOffset = offset
    } else {
      adj.apartOffset = offset
    }

    var that = this

    wx.showLoading({ title: '保存中...' })
    if (!getCoupleId()) { wx.hideLoading(); wx.showToast({ title: '未找到绑定记录', icon: 'none' }); return }
    callRelationship('updateCoupleFields', { fields: { statAdjustment: adj } }).then(function () {
      wx.hideLoading()
      wx.setStorageSync('statAdjustment', adj)
      that.setData({ statAdjustment: adj, showStatEditor: false })
      // 用新偏移量重新计算显示值
      that.loadStats()
      wx.showToast({ title: '修改成功 ✨', icon: 'success' })
    }).catch(function (err) {
      wx.hideLoading()
      console.error('保存统计偏移失败:', err)
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
    })
  }
})
