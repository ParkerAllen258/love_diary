const db = wx.cloud.database()
const calendar = require('../../utils/calendar')
const { callRelationship, getCoupleId } = require('../../utils/relationship')

Page({

  data: {

    greeting: '',

    myAvatar: '',

    myName: '恋人',

    defaultAvatar: 'https://dummyimage.com/200x200/ffb6c1/ffffff',

    milestones: [],

    editingKey: '',

    editingDate: '',

    editingCalendar: calendar.CALENDAR_SOLAR,

    editingLeap: false,

    editorPreview: '',

    lunarPickerRange: [[], [], []],

    lunarPickerValue: [50, 0, 0],

    lunarMonthOptions: []

  },

  onLoad() {

    this.setGreeting()

    this.loadMilestones()

  },

  onShow() {

    this.loadMilestones()

  },

  setGreeting() {

    const hour = new Date().getHours()

    let greeting = '你好'

    if (hour < 6) greeting = '夜深了，早点休息'

    else if (hour < 12) greeting = '早上好，新的一天'

    else if (hour < 14) greeting = '中午好，记得吃饭'

    else if (hour < 18) greeting = '下午好，继续加油'

    else greeting = '晚上好，今天辛苦了'

    const myName = wx.getStorageSync('myName') || '恋人'

    const boyAvatar = wx.getStorageSync('boyAvatar') || ''

    const girlAvatar = wx.getStorageSync('girlAvatar') || ''

    const myRole = wx.getStorageSync('myRole') || ''

    const myAvatar = myRole === 'user2' ? girlAvatar : boyAvatar

    this.setData({ greeting, myName, myAvatar: myAvatar || boyAvatar || girlAvatar })

  },

  loadMilestones() {

    if (!wx.getStorageSync('hasCouple')) {

      this.setData({ milestones: this.buildMilestones({}) })

      return

    }

    const coupleId = getCoupleId()
    if (!coupleId) return
    const myCode = wx.getStorageSync('myCode')

    db.collection('couple')
      .doc(coupleId)
      .get()
      .then(res => {

        const couple = res.data || {}

        const dates = {

          met: couple.metDate || '',
          loveDate: couple.loveDate || '',

          metCalendar: couple.metCalendar || calendar.CALENDAR_SOLAR,

          metLeap: !!couple.metLeap,

          user1Birthday: couple.user1Birthday || '',

          user1BirthdayCalendar: couple.user1BirthdayCalendar || calendar.CALENDAR_SOLAR,

          user1BirthdayLeap: !!couple.user1BirthdayLeap,

          user2Birthday: couple.user2Birthday || '',

          user2BirthdayCalendar: couple.user2BirthdayCalendar || calendar.CALENDAR_SOLAR,

          user2BirthdayLeap: !!couple.user2BirthdayLeap,

          nextMeet: couple.nextMeetDate || '',

          nextMeetCalendar: couple.nextMeetCalendar || calendar.CALENDAR_SOLAR,

          nextMeetLeap: !!couple.nextMeetLeap

        }

        if (dates.loveDate) {

          wx.setStorageSync('loveDate', dates.loveDate || '')

        }

        this.setData({

          milestones: this.buildMilestones(dates, myCode, couple)

        })

      })
      .catch(() => {

        this.setData({ milestones: this.buildMilestones({}) })

      })

  },

  buildMilestones(dates, myCode, couple) {

    const isUser1 = couple && couple.user1 === myCode

    const myBirthday = isUser1 ? dates.user1Birthday : dates.user2Birthday

    const myBirthdayCalendar = isUser1
      ? dates.user1BirthdayCalendar
      : dates.user2BirthdayCalendar

    const myBirthdayLeap = isUser1
      ? dates.user1BirthdayLeap
      : dates.user2BirthdayLeap

    const partnerBirthday = isUser1 ? dates.user2Birthday : dates.user1Birthday

    const partnerBirthdayCalendar = isUser1
      ? dates.user2BirthdayCalendar
      : dates.user1BirthdayCalendar

    const partnerBirthdayLeap = isUser1
      ? dates.user2BirthdayLeap
      : dates.user1BirthdayLeap

    const configs = [

      {

        key: 'together',

        title: '我们在一起',

        subtitle: '相爱的那一天起',

        emoji: '❤️',

        image: '/images/anniversary/anniversary-met.png',

        iconBg: 'linear-gradient(135deg, #ff6b8a 0%, #ff9a9e 100%)',

        date: dates.loveDate || '',

        calendar: calendar.CALENDAR_SOLAR,

        isLeap: false,

        mode: 'together'

      },

      {

        key: 'met',

        title: '我们认识',

        subtitle: '从那天起的故事',

        emoji: '💑',

        image: '/images/anniversary/anniversary-met.png',

        iconBg: 'linear-gradient(135deg, #ffeaa7 0%, #fdcb6e 100%)',

        date: dates.met || '',

        calendar: dates.metCalendar || calendar.CALENDAR_SOLAR,

        isLeap: dates.metLeap,

        mode: 'past'

      },

      {

        key: 'partnerBirthday',

        title: '对方的生日',

        subtitle: '别忘了准备惊喜',

        emoji: '🎂',

        image: '/images/anniversary/anniversary-partner-birthday.png',

        iconBg: 'linear-gradient(135deg, #ffe0f0 0%, #ff9a9e 100%)',

        date: partnerBirthday || '',

        calendar: partnerBirthdayCalendar || calendar.CALENDAR_SOLAR,

        isLeap: partnerBirthdayLeap,

        mode: 'birthday'

      },

      {

        key: 'nextMeet',

        title: '下次见面',

        subtitle: '倒计时见面日',

        emoji: '🧳',

        image: '/images/anniversary/anniversary-next-meet.png',

        iconBg: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',

        date: dates.nextMeet || '',

        calendar: dates.nextMeetCalendar || calendar.CALENDAR_SOLAR,

        isLeap: dates.nextMeetLeap,

        mode: 'future'

      },

      {

        key: 'myBirthday',

        title: '我的生日',

        subtitle: '每年最开心的一天',

        emoji: '🎁',

        image: '/images/anniversary/anniversary-my-birthday.png',

        iconBg: 'linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)',

        date: myBirthday || '',

        calendar: myBirthdayCalendar || calendar.CALENDAR_SOLAR,

        isLeap: myBirthdayLeap,

        mode: 'birthday'

      }

    ]

    return configs.map(item => this.decorateMilestone(item))

  },

  decorateMilestone(item) {

    if (!item.date) {

      return Object.assign({}, item, {

        dateText: '点击设置日期',

        statusIcon: '📅',

        statusText: '还未设置',

        statusType: 'empty'

      })

    }

    const dateText = calendar.formatDateText(item.date, item.calendar, item.isLeap)

    if (item.mode === 'together') {
      var d = new Date(item.date)
      if (isNaN(d.getTime())) {
        return Object.assign({}, item, {
          dateText: dateText,
          statusIcon: '⚠️',
          statusText: '日期无效，请重新设置',
          statusType: 'empty'
        })
      }
      var togetherDays = Math.floor((new Date() - d) / (1000 * 60 * 60 * 24))
      if (togetherDays < 0) togetherDays = 0
      return Object.assign({}, item, {
        dateText: dateText,
        statusIcon: '❤️',
        statusText: '已经' + togetherDays + '天啦',
        statusType: 'together'
      })
    }

    if (item.mode === 'past') {

      const elapsed = calendar.calcElapsed(item.date, item.calendar, item.isLeap)

      if (elapsed.isToday) {

        return Object.assign({}, item, {

          dateText,

          statusIcon: '✨',

          statusText: '就是今天啦',

          statusType: 'today'

        })

      }

      return Object.assign({}, item, {

        dateText,

        statusIcon: '✨',

        statusText: '已经' + elapsed.years + '年' + elapsed.months + '月' + elapsed.days + '天啦',

        statusType: 'past'

      })

    }

    if (item.mode === 'birthday') {

      const countdown = calendar.calcBirthdayCountdown(
        item.date,
        item.calendar,
        item.isLeap
      )

      if (countdown.isToday) {

        return Object.assign({}, item, {

          dateText,

          statusIcon: '✨',

          statusText: '就是今天啦',

          statusType: 'today'

        })

      }

      return Object.assign({}, item, {

        dateText,

        statusIcon: '🎯',

        statusText: '还有' + countdown.days + '天哦',

        statusType: 'future'

      })

    }

    const countdown = calendar.calcFutureCountdown(
      item.date,
      item.calendar,
      item.isLeap
    )

    if (countdown.isToday) {

      return Object.assign({}, item, {

        dateText,

        statusIcon: '✨',

        statusText: '就是今天啦',

        statusType: 'today'

      })

    }

    if (countdown.isPast) {

      return Object.assign({}, item, {

        dateText,

        statusIcon: '💫',

        statusText: '已过' + countdown.days + '天',

        statusType: 'past'

      })

    }

    return Object.assign({}, item, {

      dateText,

      statusIcon: '🎯',

      statusText: '还有' + countdown.days + '天哦',

      statusType: 'future'

    })

  },

  onCardTap(e) {

    const key = e.currentTarget.dataset.key

    const item = this.data.milestones.find(m => m.key === key)

    const editingCalendar = (item && item.calendar) || calendar.CALENDAR_SOLAR

    const editingLeap = !!(item && item.isLeap)

    const editingDate = (item && item.date) || ''

    this.setData({

      editingKey: key,

      editingDate,

      editingCalendar,

      editingLeap,

      editorPreview: calendar.getEditorPreview(editingDate, editingCalendar, editingLeap)

    })

    if (editingCalendar === calendar.CALENDAR_LUNAR) {

      this.refreshLunarPicker(editingDate, editingLeap)

    }

  },

  onCalendarSwitch(e) {

    const type = e.currentTarget.dataset.type

    if (type === this.data.editingCalendar) return

    const updates = {

      editingCalendar: type,

      editingLeap: false

    }

    if (type === calendar.CALENDAR_LUNAR) {

      if (!this.data.editingDate) {

        const solarLunar = require('../../utils/solarlunar').default

        const todayLunar = solarLunar.solar2lunar(
          new Date().getFullYear(),
          new Date().getMonth() + 1,
          new Date().getDate()
        )

        updates.editingDate = calendar.padDateParts(
          todayLunar.lYear,
          todayLunar.lMonth,
          todayLunar.lDay
        )

        updates.editingLeap = !!todayLunar.isLeap

      }

      this.setData(updates, () => {

        this.refreshLunarPicker(this.data.editingDate, this.data.editingLeap)

        this.updateEditorPreview()

      })

      return

    }

    if (!this.data.editingDate) {

      const now = new Date()

      updates.editingDate = calendar.padDateParts(
        now.getFullYear(),
        now.getMonth() + 1,
        now.getDate()
      )

    } else if (this.data.editingCalendar === calendar.CALENDAR_LUNAR) {

      const parts = calendar.parseDateParts(this.data.editingDate)

      const solarLunar = require('../../utils/solarlunar').default

      const solar = solarLunar.lunar2solar(
        parts.year,
        parts.month,
        parts.day,
        this.data.editingLeap
      )

      if (solar && solar.cYear) {

        updates.editingDate = calendar.padDateParts(solar.cYear, solar.cMonth, solar.cDay)

      }

    }

    this.setData(updates, () => this.updateEditorPreview())

  },

  refreshLunarPicker(dateStr, isLeap) {

    const parts = calendar.parseDateParts(dateStr)

    const year = parts.year || 2000

    const month = parts.month || 1

    const leap = !!isLeap

    const pickerData = calendar.buildLunarPickerRange(year, month, leap)

    const pickerValue = calendar.getLunarPickerValue(dateStr || calendar.padDateParts(year, month, 1), leap)

    this.setData({

      lunarPickerRange: [
        pickerData.years,
        pickerData.monthLabels,
        pickerData.dayLabels
      ],

      lunarPickerValue: pickerValue,

      lunarMonthOptions: pickerData.monthOptions

    })

  },

  onLunarPickerChange(e) {

    const pickerValue = e.detail.value

    const result = calendar.getLunarDateFromPicker(
      pickerValue,
      this.data.lunarMonthOptions
    )

    this.setData({

      lunarPickerValue: pickerValue,

      editingDate: result.date,

      editingLeap: result.isLeap

    }, () => {

      this.refreshLunarPicker(result.date, result.isLeap)

      this.updateEditorPreview()

    })

  },

  onLunarPickerColumnChange(e) {

    const column = e.detail.column

    const value = e.detail.value

    const parts = calendar.parseDateParts(this.data.editingDate)

    let year = parts.year || calendar.LUNAR_YEAR_START

    let month = parts.month || 1

    let isLeap = this.data.editingLeap

    let day = parts.day || 1

    if (column === 0) {

      year = calendar.LUNAR_YEAR_START + value

    } else if (column === 1) {

      const monthOptions = calendar.buildLunarPickerRange(year, 1, false).monthOptions

      const monthItem = monthOptions[value] || monthOptions[0]

      month = monthItem.month

      isLeap = monthItem.isLeap

    } else {

      day = value + 1

    }

    const pickerData = calendar.buildLunarPickerRange(year, month, isLeap)

    const maxDay = pickerData.dayLabels.length

    day = Math.min(day, maxDay)

    const dateStr = calendar.padDateParts(year, month, day)

    const pickerValue = calendar.getLunarPickerValue(dateStr, isLeap)

    this.setData({

      editingDate: dateStr,

      editingLeap: isLeap,

      lunarPickerRange: [
        pickerData.years,
        pickerData.monthLabels,
        pickerData.dayLabels
      ],

      lunarPickerValue: pickerValue,

      lunarMonthOptions: pickerData.monthOptions

    }, () => this.updateEditorPreview())

  },

  onSolarDateChange(e) {

    this.setData({ editingDate: e.detail.value }, () => this.updateEditorPreview())

  },

  updateEditorPreview() {

    const preview = calendar.getEditorPreview(
      this.data.editingDate,
      this.data.editingCalendar,
      this.data.editingLeap
    )

    this.setData({ editorPreview: preview })

  },

  closeEditor() {

    this.setData({

      editingKey: '',

      editingDate: '',

      editingCalendar: calendar.CALENDAR_SOLAR,

      editingLeap: false,

      editorPreview: ''

    })

  },

  getSaveFields(editingKey, editingDate, editingCalendar, editingLeap, isUser1) {

    const data = {}

    const cal = editingCalendar

    const leap = editingLeap

    if (editingKey === 'together') {
      data.loveDate = editingDate
      wx.setStorageSync('loveDate', editingDate)
      return data
    }

    if (editingKey === 'met') {

      data.metDate = editingDate

      data.metCalendar = cal

      data.metLeap = leap

      return data

    }

    if (editingKey === 'nextMeet') {

      data.nextMeetDate = editingDate

      data.nextMeetCalendar = cal

      data.nextMeetLeap = leap

      return data

    }

    if (editingKey === 'myBirthday') {

      if (isUser1) {

        data.user1Birthday = editingDate

        data.user1BirthdayCalendar = cal

        data.user1BirthdayLeap = leap

      } else {

        data.user2Birthday = editingDate

        data.user2BirthdayCalendar = cal

        data.user2BirthdayLeap = leap

      }

      return data

    }

    if (editingKey === 'partnerBirthday') {

      if (isUser1) {

        data.user2Birthday = editingDate

        data.user2BirthdayCalendar = cal

        data.user2BirthdayLeap = leap

      } else {

        data.user1Birthday = editingDate

        data.user1BirthdayCalendar = cal

        data.user1BirthdayLeap = leap

      }

    }

    return data

  },

  saveDate() {

    const { editingKey, editingDate, editingCalendar, editingLeap } = this.data

    if (!editingDate) {

      wx.showToast({ title: '请选择日期', icon: 'none' })

      return

    }

    if (!wx.getStorageSync('hasCouple')) {

      wx.showToast({ title: '请先绑定情侣', icon: 'none' })

      return

    }

    wx.showLoading({ title: '保存中...' })

    if (!getCoupleId()) {
      wx.hideLoading()
      wx.showToast({ title: '请先绑定情侣', icon: 'none' })
      return
    }

    const isUser1 = wx.getStorageSync('myRole') !== 'user2'
    const fields = this.getSaveFields(
      editingKey,
      editingDate,
      editingCalendar,
      editingLeap,
      isUser1
    )

    callRelationship('updateCoupleFields', { fields })
      .then(() => {

        wx.hideLoading()

        wx.showToast({ title: '已保存' })

        this.closeEditor()

        this.loadMilestones()

      })
      .catch(() => {

        wx.hideLoading()

        wx.showToast({ title: '保存失败', icon: 'none' })

      })

  }

})
