const db = wx.cloud.database()
const helper = require('../../utils/scheduleHelper')
const { getCoupleId } = require('../../utils/relationship')

const WEEK_LIST = helper.WEEK_LIST
const SECTIONS = helper.SECTIONS
const COURSE_COLORS = helper.COURSE_COLORS

function getEmptyForm() {
  return {
    name: '',
    weekIndex: 0,
    startSection: 1,
    endSection: 1,
    place: '',
    teacher: '',
    className: '',
    color: COURSE_COLORS[0]
  }
}

Page({
  data: {
    courses: [],
    partnerCourses: [],
    todayCourses: [],
    weeklySummary: {},

    myStatus: { status: 'loading', text: '加载中...', emoji: '⏳' },
    partnerStatus: null,
    nextCourse: null,
    currentCourseId: '',
    coupleTips: [],

    commonFreeTime: [],

    weekDays: WEEK_LIST,
    sections: SECTIONS,
    gridCells: {},

    activeDay: helper.getTodayWeekIndex(),
    activeDayLabel: WEEK_LIST[helper.getTodayWeekIndex()],

    activeDayCourses: [],

    showForm: false,
    editingId: '',
    form: getEmptyForm(),
    courseColors: COURSE_COLORS,

    countdownText: '',
    countdownTimer: null,

    showWeekTable: false,

    showOcrReview: false,
    ocrCourses: [],
    ocrReviewIndex: 0,

    isSaving: false,

    todayIdx: helper.getTodayWeekIndex()
  },

  onLoad() {
    this.loadAllCourses()
  },

  onShow() {
    this.loadAllCourses()
    this.startCountdown()
  },

  onHide() {
    this.stopCountdown()
  },

  onUnload() {
    this.stopCountdown()
  },

  loadAllCourses() {
    const coupleId = getCoupleId()
    const myCode = wx.getStorageSync('myCode')
    const partnerCode = wx.getStorageSync('partnerCode')

    if (!coupleId) {
      wx.showToast({ title: '请先绑定情侣', icon: 'none' })
      this.setData({ courses: [] })
      this.refreshAll([], [])
      return
    }

    const myQuery = db.collection('schedule').where({
      type: 'course',
      coupleId: coupleId,
      authorCode: myCode
    })

    myQuery.limit(100).get().then(res => {
      const courses = res.data || []
      this.setData({ courses })

      if (partnerCode) {
        this.loadPartnerCourses(coupleId, myCode, partnerCode, courses)
      } else {
        this.refreshAll(courses, [])
      }
    }).catch(() => {
      this.setData({ courses: [] })
      this.refreshAll([], [])
    })
  },

  loadPartnerCourses(coupleId, myCode, partnerCode, myCourses) {
    db.collection('schedule').where({
      coupleId: coupleId,
      type: 'course',
      authorCode: partnerCode
    }).get().then(res => {
      const partnerCourses = res.data || []
      this.setData({ partnerCourses })
      this.refreshAll(myCourses, partnerCourses)
    }).catch(() => {
      this.refreshAll(myCourses, [])
    })
  },

  refreshAll(myCourses, partnerCourses) {
    const todayIdx = helper.getTodayWeekIndex()
    const todayCourses = helper.getTodayCourses(myCourses)
    const myStatus = helper.getTodayStatusText(myCourses)
    const nextCourse = helper.getNextCourse(myCourses)
    const weeklySummary = helper.getWeeklySummary(myCourses)
    const gridCells = helper.buildGridCells(myCourses)

    const activeDayCourses = myCourses.filter(c => c.weekIndex === this.data.activeDay)
      .sort((a, b) => (a.startSection || 1) - (b.startSection || 1))

    const partnerName = this.getPartnerName()
    const coupleTips = helper.getCoupleTip(myCourses, partnerCourses || [], partnerName)

    const commonFreeTime = partnerCourses && partnerCourses.length > 0
      ? helper.findCommonFreeTime(myCourses, partnerCourses)
      : []

    const current = helper.getCurrentCourse(myCourses)
    const currentCourseId = current ? current.course._id : ''

    let countdownText = ''
    if (myStatus.status === 'in_class' && myStatus.remaining) {
      countdownText = '还有' + myStatus.remaining + '分钟下课'
    } else if (myStatus.status === 'before_class' && myStatus.gapMinutes) {
      countdownText = helper.getCountdownText(myStatus.gapMinutes)
    }

    this.setData({
      todayCourses,
      activeDayCourses,
      myStatus,
      nextCourse,
      currentCourseId,
      coupleTips,
      commonFreeTime,
      weeklySummary,
      gridCells,
      countdownText,
      activeDay: todayIdx,
      activeDayLabel: WEEK_LIST[todayIdx],
      todayIdx: todayIdx
    })
  },

  getPartnerName() {
    const myRole = wx.getStorageSync('myRole')
    const boyName = wx.getStorageSync('boyName') || ''
    const girlName = wx.getStorageSync('girlName') || ''
    if (myRole === 'user1') return girlName || '她'
    return boyName || '他'
  },

  startCountdown() {
    this.stopCountdown()
    this.updateCountdown()
    this.countdownTimer = setInterval(() => {
      this.updateCountdown()
    }, 30000)
  },

  stopCountdown() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer)
      this.countdownTimer = null
    }
  },

  updateCountdown() {
    const myStatus = helper.getTodayStatusText(this.data.courses)
    let countdownText = ''
    if (myStatus.status === 'in_class' && myStatus.remaining != null) {
      countdownText = '还有' + myStatus.remaining + '分钟下课'
    } else if (myStatus.status === 'before_class' && myStatus.gapMinutes != null) {
      countdownText = helper.getCountdownText(myStatus.gapMinutes)
    }
    this.setData({
      myStatus,
      countdownText,
      nextCourse: helper.getNextCourse(this.data.courses)
    })
  },

  switchDay(e) {
    const idx = parseInt(e.currentTarget.dataset.idx)
    const todayIdx = helper.getTodayWeekIndex()
    const activeDayCourses = this.data.courses.filter(c => c.weekIndex === idx)
      .sort((a, b) => (a.startSection || 1) - (b.startSection || 1))
    this.setData({
      activeDay: idx,
      activeDayLabel: WEEK_LIST[idx],
      activeDayCourses,
      todayIdx: todayIdx
    })
  },

  toggleWeekTable() {
    this.setData({ showWeekTable: !this.data.showWeekTable })
  },

  openAddForm() {
    const form = getEmptyForm()
    form.weekIndex = this.data.activeDay
    this.setData({
      showForm: true,
      editingId: '',
      form
    })
  },

  tapCourse(e) {
    const id = e.currentTarget.dataset.id
    const course = this.data.courses.find(c => c._id === id)
    if (!course) return
    this.setData({
      showForm: true,
      editingId: id,
      form: {
        name: course.name || '',
        weekIndex: course.weekIndex != null ? course.weekIndex : 0,
        startSection: course.startSection || 1,
        endSection: course.endSection || 1,
        place: course.place || '',
        teacher: course.teacher || '',
        className: course.className || '',
        color: course.color || COURSE_COLORS[0]
      }
    })
  },

  tapTodayCourse(e) {
    const id = e.currentTarget.dataset.id
    this.tapCourse({ currentTarget: { dataset: { id } } })
  },

  tapActiveDayCourse(e) {
    const id = e.currentTarget.dataset.id
    this.tapCourse({ currentTarget: { dataset: { id } } })
  },

  closeForm() {
    this.setData({ showForm: false, editingId: '' })
  },

  onFormInput(e) {
    const field = e.currentTarget.dataset.field
    if (field === 'startSection' || field === 'endSection') {
      const val = parseInt(e.detail.value)
      this.setData({ ['form.' + field]: isNaN(val) ? 1 : val + 1 })
    } else if (field === 'weekIndex') {
      this.setData({ ['form.' + field]: parseInt(e.detail.value) || 0 })
    } else {
      this.setData({ ['form.' + field]: e.detail.value })
    }
  },

  pickColor(e) {
    this.setData({ 'form.color': e.currentTarget.dataset.color })
  },

  validateForm(form) {
    const errors = []
    if (!form.name || !form.name.trim()) {
      errors.push('课程名称不能为空')
    }
    if (form.startSection > form.endSection) {
      errors.push('开始节次不能大于结束节次')
    }
    if (form.startSection < 1 || form.startSection > SECTIONS.length) {
      errors.push('开始节次超出范围')
    }
    if (form.endSection < 1 || form.endSection > SECTIONS.length) {
      errors.push('结束节次超出范围')
    }
    return errors
  },

  saveCourse() {
    if (this.data.isSaving) return

    const { form, editingId } = this.data
    const errors = this.validateForm(form)

    if (errors.length > 0) {
      wx.showToast({ title: errors[0], icon: 'none', duration: 2500 })
      return
    }
    if (!getCoupleId()) {
      wx.showToast({ title: '请先绑定情侣', icon: 'none' })
      return
    }

    const data = {
      name: form.name.trim(),
      weekIndex: form.weekIndex,
      week: WEEK_LIST[form.weekIndex],
      startSection: form.startSection,
      endSection: form.endSection,
      place: form.place.trim(),
      teacher: form.teacher.trim(),
      className: (form.className || '').trim(),
      color: form.color,
      type: 'course',
      coupleId: getCoupleId(),
      authorOpenid: wx.getStorageSync('openid') || '',
      authorCode: wx.getStorageSync('myCode') || ''
    }

    this.setData({ isSaving: true })
    wx.showLoading({ title: '保存中...' })

    const p = editingId
      ? db.collection('schedule').doc(editingId).update({ data })
      : db.collection('schedule').add({ data: Object.assign({ createTime: Date.now() }, data) })

    p.then(() => {
      wx.hideLoading()
      this.setData({ isSaving: false })
      wx.showToast({ title: editingId ? '已更新' : '已添加' })
      this.closeForm()
      this.loadAllCourses()
    }).catch(() => {
      wx.hideLoading()
      this.setData({ isSaving: false })
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
    })
  },

  deleteCourse() {
    const id = this.data.editingId
    if (!id) return
    wx.showModal({
      title: '删除课程',
      content: '确定删除这个课程吗？删除后不可恢复。',
      confirmColor: '#ff6b8a',
      success: res => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中...' })
        db.collection('schedule').doc(id).remove().then(() => {
          wx.hideLoading()
          wx.showToast({ title: '已删除' })
          this.closeForm()
          this.loadAllCourses()
        }).catch(() => {
          wx.hideLoading()
          wx.showToast({ title: '删除失败', icon: 'none' })
        })
      }
    })
  },

  selectOcrImage() {
    wx.chooseImage({
      count: 1,
      sourceType: ['album', 'camera'],
      success: res => {
        this.doOcr(res.tempFilePaths[0])
      }
    })
  },

  doOcr(filePath) {
    wx.showLoading({ title: 'AI识别中...', mask: true })

    wx.cloud.uploadFile({
      cloudPath: 'ocr/' + Date.now() + '.png',
      filePath
    }).then(uploadRes => {
      return wx.cloud.callFunction({
        name: 'ocrSchedule',
        data: { fileID: uploadRes.fileID }
      })
    }).then(ocrRes => {
      wx.hideLoading()
      const result = ocrRes.result || {}
      const courses = result.courses || []
      const rawText = result.rawText || ''

      if (!courses || courses.length === 0) {
        const debug = result.debug || {}
        const hasPos = debug.hasPosData ? '有' : (debug.hasPosData === false ? '无' : '未知')
        const itemCount = debug.itemCount != null ? debug.itemCount : '?'
        const firstItemTexts = debug.firstItems ? debug.firstItems.map(function(it) {
          return (it.hasPos ? '[坐标] ' : '[文本] ') + it.text
        }).join('\n') : ''
        
        // 无论如何都要显示 rawText
        var rawDisplay = ''
        if (debug.ocrKeys) rawDisplay += '\n[OCR字段：' + debug.ocrKeys + ']'
        if (debug.sampleJson) rawDisplay += '\n[原始数据：' + debug.sampleJson + ']'
        if (rawText && rawText.trim()) {
          rawDisplay += '\n---识别原文(前300字)---\n' + rawText.substring(0, 300) + (rawText.length > 300 ? '...' : '')
        }
        if (firstItemTexts) {
          rawDisplay += '\n---前5个文字块---\n' + firstItemTexts
        }

        var diagInfo = '识别到 ' + itemCount + ' 个文字块，坐标数据：' + hasPos
        if (result.version) diagInfo += '\n[云函数版本：' + result.version + ']'
        if (!result.debug) diagInfo += '\n[提示：云函数可能未部署最新版，请重新上传部署]'
        if (!rawText || !rawText.trim()) diagInfo += '\n[rawText为空，请检查云函数]'

        wx.showModal({
          title: '未识别到课程',
          content: '自动识别未能提取到课程信息。\n\n' + diagInfo + rawDisplay + '\n\n你可以：\n1. 重新拍摄更清晰的图片\n2. 手动添加课程',
          confirmText: '手动添加',
          cancelText: '重新拍照',
          success: r => {
            if (r.confirm) this.openAddForm()
          }
        })
        return
      }

      this.setData({
        showOcrReview: true,
        ocrCourses: courses.map((c, i) => ({
          ...c,
          _key: 'ocr_' + i,
          name: c.name || '未命名课程',
          weekIndex: c.weekIndex != null ? c.weekIndex : 0,
          startSection: c.startSection || 1,
          endSection: c.endSection || c.startSection || 1,
          place: c.place || '',
          teacher: c.teacher || '',
          className: c.className || '',
          color: c.color || helper.pickColor(i)
        })),
        ocrReviewIndex: 0
      })
    }).catch(err => {
      wx.hideLoading()
      wx.showModal({
        title: 'OCR识别失败',
        content: '识别服务暂不可用。\n\n请在微信云开发控制台开通「图像识别-印刷文字识别」能力。\n\n你也可以手动添加课程。',
        confirmText: '手动添加',
        cancelText: '我知道了',
        success: r => {
          if (r.confirm) this.openAddForm()
        }
      })
    })
  },

  confirmOcrCourse(e) {
    const idx = e.currentTarget.dataset.idx
    const updated = this.data.ocrCourses
    if (idx >= 0 && idx < updated.length) {
      this.setData({ ocrReviewIndex: idx })
    }
  },

  editOcrCourse(e) {
    const idx = e.currentTarget.dataset.idx
    const course = this.data.ocrCourses[idx]
    if (!course) return

    this.setData({
      showOcrReview: false,
      showForm: true,
      editingId: '',
      form: {
        name: course.name || '',
        weekIndex: course.weekIndex != null ? course.weekIndex : 0,
        startSection: course.startSection || 1,
        endSection: course.endSection || 1,
        place: course.place || '',
        teacher: course.teacher || '',
        className: course.className || '',
        color: course.color || COURSE_COLORS[0]
      }
    })
  },

  deleteOcrCourse(e) {
    const idx = e.currentTarget.dataset.idx
    const courses = this.data.ocrCourses.slice()
    if (idx < 0 || idx >= courses.length) return
    courses.splice(idx, 1)
    if (courses.length === 0) {
      this.setData({ showOcrReview: false, ocrCourses: [] })
    } else {
      this.setData({
        ocrCourses: courses,
        ocrReviewIndex: Math.min(this.data.ocrReviewIndex, courses.length - 1)
      })
    }
  },

  updateOcrField(e) {
    const { idx, field } = e.currentTarget.dataset
    const courses = this.data.ocrCourses.slice()
    if (idx < 0 || idx >= courses.length) return

    if (field === 'startSection' || field === 'endSection') {
      const val = parseInt(e.detail.value)
      courses[idx][field] = isNaN(val) ? 1 : val + 1
    } else if (field === 'weekIndex') {
      courses[idx][field] = parseInt(e.detail.value) || 0
    } else {
      courses[idx][field] = e.detail.value
    }
    this.setData({ ocrCourses: courses })
  },

  pickOcrColor(e) {
    const { idx, color } = e.currentTarget.dataset
    const courses = this.data.ocrCourses.slice()
    if (idx >= 0 && idx < courses.length) {
      courses[idx].color = color
      this.setData({ ocrCourses: courses })
    }
  },

  closeOcrReview() {
    wx.showModal({
      title: '放弃识别结果？',
      content: '识别的课程列表尚未保存，确定要放弃吗？',
      confirmText: '放弃',
      cancelText: '继续编辑',
      success: r => {
        if (r.confirm) {
          this.setData({ showOcrReview: false, ocrCourses: [] })
        }
      }
    })
  },

  saveOcrCourses() {
    const { ocrCourses } = this.data
    if (ocrCourses.length === 0) return
    if (!getCoupleId()) {
      wx.showToast({ title: '请先绑定情侣', icon: 'none' })
      return
    }

    wx.showLoading({ title: '导入中...', mask: true })
    const coupleId = getCoupleId()
    const authorCode = wx.getStorageSync('myCode') || ''

    const tasks = ocrCourses.map(c => {
      return db.collection('schedule').add({
        data: {
          name: c.name || '未命名',
          weekIndex: c.weekIndex != null ? c.weekIndex : 0,
          week: WEEK_LIST[c.weekIndex || 0],
          startSection: c.startSection || 1,
          endSection: c.endSection || 1,
          place: c.place || '',
          teacher: c.teacher || '',
          className: c.className || '',
          color: c.color || helper.pickColor(0),
          type: 'course',
          coupleId,
          authorOpenid: wx.getStorageSync('openid') || '',
          authorCode,
          createTime: Date.now()
        }
      })
    })

    Promise.all(tasks).then(() => {
      wx.hideLoading()
      wx.showToast({ title: '已导入 ' + ocrCourses.length + ' 门课' })
      this.setData({ showOcrReview: false, ocrCourses: [] })
      this.loadAllCourses()
    }).catch(() => {
      wx.hideLoading()
      wx.showToast({ title: '部分导入失败', icon: 'none' })
    })
  },

  getSectionLabel(index) {
    return SECTIONS[index] ? SECTIONS[index].label : String(index + 1)
  },

  getSectionTime(index) {
    return SECTIONS[index] ? SECTIONS[index].time : ''
  }
})
