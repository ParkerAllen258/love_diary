const db = wx.cloud.database()
const calendar = require('../../utils/calendar')
const solarLunar = (require('../../utils/solarlunar').default || require('../../utils/solarlunar'))
const { callRelationship, getCoupleId } = require('../../utils/relationship')
const { callSharedData } = require('../../utils/sharedData')
const { waitForAuth } = require('../../utils/auth')

// 注意：SOLAR_HOLIDAYS 需每年更新。建议每年年初补充新年份的节假日数据。
const SOLAR_HOLIDAYS = {
  '2026-01-01': '元旦',
  '2026-02-14': '情人节',
  '2026-04-05': '清明',
  '2026-05-01': '劳动节',
  '2026-10-01': '国庆',
  '2026-12-25': '圣诞',
  '2025-01-01': '元旦',
  '2025-02-14': '情人节',
  '2025-04-04': '清明',
  '2025-05-01': '劳动节',
  '2025-10-01': '国庆',
  '2025-12-25': '圣诞',
}

function getHolidayLabel(year, month, day) {
  const dateStr = formatDateStr(new Date(year, month, day))
  if (SOLAR_HOLIDAYS[dateStr]) return SOLAR_HOLIDAYS[dateStr]
  try {
    const festivals = solarLunar.getFestivals ? solarLunar.getFestivals(year, month + 1, day) : []
    if (festivals && festivals.length > 0) return festivals[0]
  } catch (e) {}
  return ''
}

const STATUS_OPTIONS = [
  { key: 'online', emoji: '🟢', text: '在线', color: '#4ade80' },
  { key: 'busy', emoji: '💼', text: '忙碌中', color: '#f59e0b' },
  { key: 'class', emoji: '📚', text: '上课中', color: '#6366f1' },
  { key: 'sleep', emoji: '😴', text: '睡觉中', color: '#8b5cf6' },
  { key: 'eat', emoji: '🍽️', text: '吃饭中', color: '#f97316' },
  { key: 'sport', emoji: '🏃', text: '运动中', color: '#22c55e' },
  { key: 'miss', emoji: '💭', text: '想你', color: '#ec4899' },
  { key: 'movie', emoji: '🎬', text: '看剧中', color: '#06b6d4' },
  { key: 'game', emoji: '🎮', text: '游戏中', color: '#a855f7' }
]

const EMOJI_TAGS = ['💑', '🎂', '🎁', '🍽️', '🎬', '✈️', '🏡', '💝', '📅', '🎪', '💼', '📌', '🎯', '🌸', '🌟']

const EVENT_COLORS = ['#ff6b8a', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#6366f1', '#a855f7', '#ec4899']

function formatDateStr(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return y + '-' + m + '-' + d
}

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstDayOfWeek(year, month) {
  return new Date(year, month, 1).getDay()
}

Page({

  data: {
    // 日历
    currentYear: new Date().getFullYear(),
    currentMonth: new Date().getMonth(),
    todayStr: formatDateStr(new Date()),
    selectedDate: formatDateStr(new Date()),
    selectedDateLabel: '',
    monthTitle: '',
    weekDays: ['日', '一', '二', '三', '四', '五', '六'],
    monthCells: [],
    defaultAvatar: '',

    // 事件
    events: [],
    todayEvents: [],
    selectedDateEvents: [],

    // 纪念日倒计时
    countdowns: [],

    // 情侣计划
    plans: [],
    completedPlans: [],

    // 状态
    partnerStatus: null,
    myStatus: null,
    partnerName: '恋人',
    myName: '我',
    hasCouple: false,
    statusOptions: STATUS_OPTIONS,
    showStatusPicker: false,

    // 添加/编辑事件弹窗
    showEventForm: false,
    editingEventId: '',
    eventForm: {
      date: '',
      title: '',
      emoji: '📅',
      time: '',
      color: EVENT_COLORS[0]
    },
    emojiTags: EMOJI_TAGS,
    eventColors: EVENT_COLORS,

    // 计划弹窗
    showPlanForm: false,
    planText: '',

    // 情侣信息
    myAvatar: '',
    partnerAvatar: ''
  },

  async onLoad() {
    await waitForAuth()
    this.initData()
  },

  async onShow() {
    await waitForAuth()
    this.initData()
  },

  initData() {
    const hasCouple = !!wx.getStorageSync('hasCouple')
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth()
    const todayStr = formatDateStr(now)

    // 读取用户信息
    const myRole = wx.getStorageSync('myRole') || ''
    const boyAvatar = wx.getStorageSync('boyAvatar') || ''
    const girlAvatar = wx.getStorageSync('girlAvatar') || ''
    const myName = wx.getStorageSync('myName') || '我'
    const partnerName = wx.getStorageSync('partnerName') || '恋人'
    const myAvatar = myRole === 'user2' ? girlAvatar : boyAvatar
    const partnerAvatar = myRole === 'user2' ? boyAvatar : girlAvatar

    this.setData({
      currentYear: year,
      currentMonth: month,
      todayStr,
      selectedDate: todayStr,
      hasCouple,
      myName,
      partnerName,
      myAvatar,
      partnerAvatar
    })
    this.buildSelectedDateLabel(todayStr)

    this.buildMonthGrid(year, month)
    this.loadEvents(year, month)
    this.loadTodayEvents(todayStr)
    if (hasCouple) {
      this.loadCountdowns()
      this.loadStatus()
    }
    this.loadPlans()
  },

  // ==================== 月历构建 ====================

  buildMonthGrid(year, month) {
    const daysInMonth = getDaysInMonth(year, month)
    const firstDay = getFirstDayOfWeek(year, month)
    const cells = []
    const monthNames = ['一月', '二月', '三月', '四月', '五月', '六月',
      '七月', '八月', '九月', '十月', '十一月', '十二月']

    // 上月填充
    const prevMonth = month === 0 ? 11 : month - 1
    const prevYear = month === 0 ? year - 1 : year
    const prevDays = getDaysInMonth(prevYear, prevMonth)
    for (let i = firstDay - 1; i >= 0; i--) {
      const d = prevDays - i
      const pd = new Date(prevYear, prevMonth, d)
      cells.push({
        day: d,
        month: 'prev',
        dateStr: formatDateStr(pd),
        isToday: false,
        isSelected: false,
        hasEvent: false,
        isWeekend: pd.getDay() === 0 || pd.getDay() === 6,
        holiday: ''
      })
    }

    // 当月
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = formatDateStr(new Date(year, month, d))
      const dow = new Date(year, month, d).getDay()
      cells.push({
        day: d,
        month: 'current',
        dateStr,
        isToday: dateStr === this.data.todayStr,
        isSelected: dateStr === this.data.selectedDate,
        hasEvent: false,
        isWeekend: dow === 0 || dow === 6,
        holiday: getHolidayLabel(year, month, d)
      })
    }

    // 下月填充
    const totalCells = cells.length
    const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7)
    for (let d = 1; d <= remaining; d++) {
      const nextMonth = month === 11 ? 0 : month + 1
      const nextYear = month === 11 ? year + 1 : year
      const nd = new Date(nextYear, nextMonth, d)
      cells.push({
        day: d,
        month: 'next',
        dateStr: formatDateStr(nd),
        isToday: false,
        isSelected: false,
        hasEvent: false,
        isWeekend: nd.getDay() === 0 || nd.getDay() === 6,
        holiday: ''
      })
    }

    this.setData({
      monthTitle: year + '年 ' + monthNames[month],
      monthCells: cells
    })
  },

  // 刷新月历事件标记
  refreshEventDots() {
    const cells = this.data.monthCells.map(cell => {
      const hasEvent = this.data.events.some(e => e.date === cell.dateStr)
      return Object.assign({}, cell, { hasEvent })
    })
    this.setData({ monthCells: cells })
  },

  prevMonth() {
    let { currentYear, currentMonth } = this.data
    currentMonth--
    if (currentMonth < 0) {
      currentMonth = 11
      currentYear--
    }
    this.setData({ currentYear, currentMonth })
    this.buildMonthGrid(currentYear, currentMonth)
    this.loadEvents(currentYear, currentMonth)
  },

  nextMonth() {
    let { currentYear, currentMonth } = this.data
    currentMonth++
    if (currentMonth > 11) {
      currentMonth = 0
      currentYear++
    }
    this.setData({ currentYear, currentMonth })
    this.buildMonthGrid(currentYear, currentMonth)
    this.loadEvents(currentYear, currentMonth)
  },

  onDayTap(e) {
    const dateStr = e.currentTarget.dataset.date
    const month = e.currentTarget.dataset.month
    if (month !== 'current') return

    this.setData({ selectedDate: dateStr })
    this.buildSelectedDateLabel(dateStr)
    this.buildMonthGrid(this.data.currentYear, this.data.currentMonth)
    this.refreshEventDots()
    this.loadSelectedDateEvents(dateStr)
  },

  // ==================== 事件CRUD ====================

  loadEvents(year, month) {
    const coupleId = getCoupleId()
    const startDate = formatDateStr(new Date(year, month, 1))
    const endDate = formatDateStr(new Date(year, month + 1, 0))

    if (!coupleId) {
      this.setData({ events: [] })
      return
    }

    const query = db.collection('schedule').where({
      coupleId,
      date: db.command.gte(startDate).and(db.command.lte(endDate))
    })

    query.orderBy('createTime', 'asc').limit(100).get()
      .then(res => {
        const events = (res.data || []).filter(e => e.type !== 'plan')
        this.setData({ events })
        this.refreshEventDots()
        this.loadSelectedDateEvents(this.data.selectedDate)
      })
      .catch(() => {
        this.setData({ events: [] })
      })
  },

  loadTodayEvents(todayStr) {
    const coupleId = getCoupleId()
    if (!coupleId) {
      this.setData({ todayEvents: [] })
      return
    }
    const query = db.collection('schedule').where({ coupleId, date: todayStr })

    query.orderBy('createTime', 'asc').limit(50).get()
      .then(res => {
        const todayEvents = (res.data || []).filter(e => e.type !== 'plan')
        this.setData({ todayEvents })
      })
      .catch(() => {
        this.setData({ todayEvents: [] })
      })
  },

  loadSelectedDateEvents(dateStr) {
    const events = this.data.events.filter(e => e.date === dateStr)
    this.setData({ selectedDateEvents: events })
  },

  // 打开添加事件弹窗
  openAddEvent() {
    this.setData({
      showEventForm: true,
      editingEventId: '',
      eventForm: {
        date: this.data.selectedDate,
        title: '',
        emoji: '📅',
        time: '',
        color: EVENT_COLORS[0]
      }
    })
  },

  // 编辑事件
  editEvent(e) {
    const id = e.currentTarget.dataset.id
    const event = [...this.data.events, ...this.data.todayEvents]
      .find(ev => ev._id === id)
    if (!event) return
    this.setData({
      showEventForm: true,
      editingEventId: id,
      eventForm: {
        date: event.date,
        title: event.title || '',
        emoji: event.emoji || '📅',
        time: event.time || '',
        color: event.color || EVENT_COLORS[0]
      }
    })
  },

  closeEventForm() {
    this.setData({ showEventForm: false, editingEventId: '' })
  },

  onEventFormInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ ['eventForm.' + field]: e.detail.value })
  },

  onEventDateChange(e) {
    this.setData({ 'eventForm.date': e.detail.value })
  },

  pickEmoji(e) {
    this.setData({ 'eventForm.emoji': e.currentTarget.dataset.emoji })
  },

  pickColor(e) {
    this.setData({ 'eventForm.color': e.currentTarget.dataset.color })
  },

  saveEvent() {
    const { eventForm, editingEventId } = this.data
    if (!eventForm.title.trim()) {
      wx.showToast({ title: '请输入事件名称', icon: 'none' })
      return
    }
    if (!getCoupleId()) {
      wx.showToast({ title: '请先绑定情侣', icon: 'none' })
      return
    }

    const fields = {
      date: eventForm.date,
      title: eventForm.title.trim(),
      emoji: eventForm.emoji,
      time: eventForm.time.trim(),
      color: eventForm.color
    }
    const data = Object.assign({}, fields, {
      type: 'event',
      coupleId: getCoupleId(),
      authorCode: wx.getStorageSync('myCode') || '',
      authorOpenid: wx.getStorageSync('openid') || ''
    })

    wx.showLoading({ title: '保存中...' })
    const p = editingEventId
      ? callSharedData('updateSharedRecord', { collection: 'schedule', id: editingEventId, fields })
      : db.collection('schedule').add({ data: Object.assign({ createTime: Date.now() }, data) })

    p.then(() => {
      wx.hideLoading()
      wx.showToast({ title: editingEventId ? '已更新' : '已添加' })
      this.closeEventForm()
      this.loadEvents(this.data.currentYear, this.data.currentMonth)
      this.loadTodayEvents(this.data.todayStr)
    }).catch(() => {
      wx.hideLoading()
      wx.showToast({ title: '保存失败', icon: 'none' })
    })
  },

  deleteEvent() {
    const id = this.data.editingEventId
    if (!id) return
    wx.showModal({
      title: '删除日程',
      content: '确定删除这个日程吗？',
      success: res => {
        if (!res.confirm) return
        callSharedData('deleteOwnedRecord', { collection: 'schedule', id }).then(() => {
          wx.showToast({ title: '已删除' })
          this.closeEventForm()
          this.loadEvents(this.data.currentYear, this.data.currentMonth)
          this.loadTodayEvents(this.data.todayStr)
        }).catch(() => wx.showToast({ title: '删除失败', icon: 'none' }))
      }
    })
  },

  // ==================== 情侣计划清单 ====================

  loadPlans() {
    const coupleId = getCoupleId()
    if (!coupleId) {
      this.setData({ plans: [], completedPlans: [] })
      return
    }
    const query = db.collection('schedule').where({ coupleId, type: 'plan' })

    query.orderBy('createTime', 'asc').limit(100).get()
      .then(res => {
        const all = res.data || []
        const plans = all.filter(p => !p.completed)
        const completedPlans = all.filter(p => p.completed)
        this.setData({ plans, completedPlans })
      })
      .catch(() => {
        this.setData({ plans: [], completedPlans: [] })
      })
  },

  openAddPlan() {
    this.setData({ showPlanForm: true, planText: '' })
  },

  closePlanForm() {
    this.setData({ showPlanForm: false, planText: '' })
  },

  onPlanInput(e) {
    this.setData({ planText: e.detail.value })
  },

  savePlan() {
    const text = this.data.planText.trim()
    if (!text) {
      wx.showToast({ title: '请输入计划内容', icon: 'none' })
      return
    }
    if (!getCoupleId()) {
      wx.showToast({ title: '请先绑定情侣', icon: 'none' })
      return
    }

    db.collection('schedule').add({
      data: {
        title: text,
        type: 'plan',
        completed: false,
        coupleId: getCoupleId(),
        authorCode: wx.getStorageSync('myCode') || '',
        authorOpenid: wx.getStorageSync('openid') || '',
        createTime: Date.now()
      }
    }).then(() => {
      wx.showToast({ title: '计划已添加' })
      this.closePlanForm()
      this.loadPlans()
    }).catch(() => wx.showToast({ title: '添加失败', icon: 'none' }))
  },

  togglePlan(e) {
    const id = e.currentTarget.dataset.id
    const completed = e.currentTarget.dataset.completed
    callSharedData('updateSharedRecord', {
      collection: 'schedule', id, fields: { completed: !completed }
    }).then(() => {
      this.loadPlans()
    }).catch(() => wx.showToast({ title: '操作失败', icon: 'none' }))
  },

  deletePlan(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '删除计划',
      content: '确定删除这个计划吗？',
      success: res => {
        if (!res.confirm) return
        callSharedData('deleteOwnedRecord', { collection: 'schedule', id }).then(() => {
          wx.showToast({ title: '已删除' })
          this.loadPlans()
        }).catch(() => wx.showToast({ title: '删除失败', icon: 'none' }))
      }
    })
  },

  // ==================== 纪念日倒计时 ====================

  loadCountdowns() {
    const coupleId = getCoupleId()
    if (!coupleId) return

    db.collection('couple')
      .doc(coupleId)
      .get()
      .then(res => {
        if (!res.data) return
        const couple = res.data
        const isUser1 = couple.user1Openid === wx.getStorageSync('openid')
        const result = []

        // 在一起天数
        const metDate = couple.metDate || wx.getStorageSync('loveDate') || ''
        if (metDate) {
          const elapsed = calendar.calcElapsed(metDate, couple.metCalendar || 'solar', !!couple.metLeap)
          if (elapsed.isToday) {
            result.push({ key: 'met', emoji: '💑', title: '今天是在一起纪念日', days: 0, sub: '就是今天啦！', color: '#ff6b8a', type: 'today' })
          } else {
            result.push({
              key: 'met', emoji: '💑', title: '已经在一起',
              days: elapsed.years * 365 + elapsed.months * 30 + elapsed.days,
              sub: elapsed.years + '年' + elapsed.months + '月' + elapsed.days + '天',
              color: '#ff6b8a', type: 'past'
            })
          }
        }

        // 对方生日
        const partnerBirthday = isUser1 ? couple.user2Birthday : couple.user1Birthday
        const partnerBdayCal = isUser1 ? couple.user2BirthdayCalendar : couple.user1BirthdayCalendar
        const partnerBdayLeap = isUser1 ? couple.user2BirthdayLeap : couple.user1BirthdayLeap
        if (partnerBirthday) {
          const cd = calendar.calcBirthdayCountdown(partnerBirthday, partnerBdayCal || 'solar', !!partnerBdayLeap)
          if (cd.isToday) {
            result.push({ key: 'pbday', emoji: '🎂', title: '今天是TA的生日！', days: 0, sub: '生日快乐！🎉', color: '#f97316', type: 'today' })
          } else {
            result.push({ key: 'pbday', emoji: '🎂', title: '距离TA的生日', days: cd.days, sub: '还有' + cd.days + '天', color: '#f97316', type: 'future' })
          }
        }

        // 下次见面
        const nextMeet = couple.nextMeetDate || ''
        if (nextMeet) {
          const cd = calendar.calcFutureCountdown(nextMeet, couple.nextMeetCalendar || 'solar', !!couple.nextMeetLeap)
          if (cd.isToday) {
            result.push({ key: 'meet', emoji: '🧳', title: '今天见面！', days: 0, sub: '期待已久的见面日', color: '#22c55e', type: 'today' })
          } else if (!cd.isPast) {
            result.push({ key: 'meet', emoji: '🧳', title: '距离下次见面', days: cd.days, sub: '还有' + cd.days + '天', color: '#22c55e', type: 'future' })
          }
        }

        // 我的生日
        const myBirthday = isUser1 ? couple.user1Birthday : couple.user2Birthday
        const myBdayCal = isUser1 ? couple.user1BirthdayCalendar : couple.user2BirthdayCalendar
        const myBdayLeap = isUser1 ? couple.user1BirthdayLeap : couple.user2BirthdayLeap
        if (myBirthday) {
          const cd = calendar.calcBirthdayCountdown(myBirthday, myBdayCal || 'solar', !!myBdayLeap)
          if (cd.isToday) {
            result.push({ key: 'mbday', emoji: '🎁', title: '今天是我的生日！', days: 0, sub: '祝我生日快乐~', color: '#eab308', type: 'today' })
          } else {
            result.push({ key: 'mbday', emoji: '🎁', title: '距离我的生日', days: cd.days, sub: '还有' + cd.days + '天', color: '#eab308', type: 'future' })
          }
        }

        this.setData({ countdowns: result })
      })
      .catch(() => {})
  },

  // ==================== 状态 ====================

  loadStatus() {
    const coupleId = getCoupleId()
    if (!coupleId) return

    db.collection('couple')
      .doc(coupleId)
      .get()
      .then(res => {
        if (!res.data) return
        const couple = res.data
        const isUser1 = couple.user1Openid === wx.getStorageSync('openid')
        const partnerStatusKey = isUser1 ? couple.user2Status : couple.user1Status
        const myStatusKey = isUser1 ? couple.user1Status : couple.user2Status

        const partnerStatus = STATUS_OPTIONS.find(s => s.key === partnerStatusKey) || null
        const myStatus = STATUS_OPTIONS.find(s => s.key === myStatusKey) || null

        this.setData({ partnerStatus, myStatus })
      })
      .catch(() => {})
  },

  openStatusPicker() {
    if (!this.data.hasCouple) {
      wx.showToast({ title: '请先绑定情侣', icon: 'none' })
      return
    }
    this.setData({ showStatusPicker: true })
  },

  closeStatusPicker() {
    this.setData({ showStatusPicker: false })
  },

  changeStatus(e) {
    const key = e.currentTarget.dataset.key
    if (!getCoupleId()) return
    const isUser1 = wx.getStorageSync('myRole') !== 'user2'
    const fields = isUser1
      ? { user1Status: key, user1StatusTime: Date.now() }
      : { user2Status: key, user2StatusTime: Date.now() }

    callRelationship('updateCoupleFields', { fields })
      .then(() => {
        const myStatus = STATUS_OPTIONS.find(s => s.key === key) || null
        this.setData({ myStatus, showStatusPicker: false })
        wx.showToast({ title: '状态已更新', icon: 'success' })
      })
      .catch(() => wx.showToast({ title: '更新失败', icon: 'none' }))
  },

  // ==================== 辅助 ====================

  goAnniversary() {
    wx.navigateTo({ url: '/pages/anniversary/anniversary' })
  },

  buildSelectedDateLabel(dateStr) {
    if (!dateStr) {
      this.setData({ selectedDateLabel: '' })
      return
    }
    const parts = dateStr.split('-')
    if (parts.length !== 3) {
      this.setData({ selectedDateLabel: dateStr })
      return
    }
    const y = parseInt(parts[0])
    const m = parseInt(parts[1])
    const d = parseInt(parts[2])
    const weekDays = ['日', '一', '二', '三', '四', '五', '六']
    const date = new Date(y, m - 1, d)
    const week = weekDays[date.getDay()]
    let label = m + '月' + d + '日 星期' + week
    try {
      const lunar = solarLunar.solar2lunar(y, m, d)
      if (lunar && lunar !== -1) {
        label += ' · ' + lunar.monthCn + lunar.dayCn
      }
    } catch (e) {}
    this.setData({ selectedDateLabel: label })
  },

})
