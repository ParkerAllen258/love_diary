var WEEK_LIST = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

var SECTIONS = [
  { section: 1, label: '第1节', time: '08:00-08:45', start: '08:00', end: '08:45' },
  { section: 2, label: '第2节', time: '08:55-09:40', start: '08:55', end: '09:40' },
  { section: 3, label: '第3节', time: '10:00-10:45', start: '10:00', end: '10:45' },
  { section: 4, label: '第4节', time: '10:55-11:40', start: '10:55', end: '11:40' },
  { section: 5, label: '第5节', time: '14:00-14:45', start: '14:00', end: '14:45' },
  { section: 6, label: '第6节', time: '14:55-15:40', start: '14:55', end: '15:40' },
  { section: 7, label: '第7节', time: '16:00-16:45', start: '16:00', end: '16:45' },
  { section: 8, label: '第8节', time: '16:55-17:40', start: '16:55', end: '17:40' },
  { section: 9, label: '第9节', time: '19:00-19:45', start: '19:00', end: '19:45' },
  { section: 10, label: '第10节', time: '19:55-20:40', start: '19:55', end: '20:40' },
  { section: 11, label: '第11节', time: '20:50-21:35', start: '20:50', end: '21:35' }
]

var COURSE_COLORS = ['#8BC34A', '#4dabf7', '#ff6b9d', '#ffa94d', '#da77f2', '#69db7c', '#fcc419', '#74c0fc', '#ff8787', '#a29bfe', '#fd79a8', '#00b894']

function pickColor(idx) {
  return COURSE_COLORS[idx % COURSE_COLORS.length]
}

function buildGridCells(courses) {
  var cells = {}
  courses.forEach(function (course, idx) {
    var start = course.startSection || 1
    var end = course.endSection || start
    var wi = course.weekIndex != null ? course.weekIndex : 0
    for (var s = start; s <= end; s++) {
      var key = wi + '_' + s
      cells[key] = Object.assign({}, course, {
        startSection: start,
        endSection: end,
        span: end - start + 1,
        color: course.color || pickColor(idx)
      })
    }
  })
  return cells
}

// ==================== 时间工具 ====================

function timeToMinutes(timeStr) {
  var parts = timeStr.split(':')
  return parseInt(parts[0]) * 60 + parseInt(parts[1])
}

function getNow() {
  var now = new Date()
  return { hour: now.getHours(), minute: now.getMinutes(), day: now.getDay() }
}

// 获取今天是周几（0=周一...6=周日）
function getTodayWeekIndex() {
  var d = new Date().getDay() // 0=周日
  return d === 0 ? 6 : d - 1
}

// 获取当前是第几节课（基于时间）
function getCurrentSection(now) {
  if (!now) now = getNow()
  var totalMins = now.hour * 60 + now.minute
  for (var i = 0; i < SECTIONS.length; i++) {
    var startMins = timeToMinutes(SECTIONS[i].start)
    var endMins = timeToMinutes(SECTIONS[i].end)
    if (totalMins >= startMins && totalMins <= endMins) {
      return { index: i, section: SECTIONS[i], status: 'in_class' }
    }
    if (totalMins < startMins && (i === 0 || totalMins > timeToMinutes(SECTIONS[i - 1].end))) {
      return { index: i, section: SECTIONS[i], status: 'before_class' }
    }
  }
  return { index: -1, section: null, status: 'after_all' }
}

// ==================== 课程状态分析 ====================

// 获取今天的课程列表
function getTodayCourses(courses) {
  var todayIdx = getTodayWeekIndex()
  var result = []
  courses.forEach(function (c) {
    if (c.weekIndex === todayIdx) result.push(c)
  })
  result.sort(function (a, b) { return (a.startSection || 1) - (b.startSection || 1) })
  return result
}

// 获取当前正在上的课
function getCurrentCourse(courses) {
  var now = getNow()
  var todayIdx = getTodayWeekIndex()
  var currentSec = getCurrentSection(now)
  
  if (currentSec.status !== 'in_class') return null
  
  var secIdx = currentSec.section.section
  for (var i = 0; i < courses.length; i++) {
    var c = courses[i]
    if (c.weekIndex === todayIdx && c.startSection <= secIdx && c.endSection >= secIdx) {
      return { course: c, section: currentSec.section, remaining: calcRemainingMinutes(c.endSection, now) }
    }
  }
  return null
}

function calcRemainingMinutes(endSectionIdx, now) {
  if (!now) now = getNow()
  var sec = SECTIONS[endSectionIdx - 1]
  if (!sec) return 0
  var endMins = timeToMinutes(sec.end)
  var currentMins = now.hour * 60 + now.minute
  return Math.max(0, endMins - currentMins)
}

// 获取下一节课
function getNextCourse(courses) {
  var now = getNow()
  var todayIdx = getTodayWeekIndex()
  var currentSec = getCurrentSection(now)
  var totalMins = now.hour * 60 + now.minute
  
  var next = null
  var minGap = Infinity
  
  courses.forEach(function (c) {
    if (c.weekIndex !== todayIdx) return
    var startSec = SECTIONS[c.startSection - 1]
    if (!startSec) return
    var startMins = timeToMinutes(startSec.start)
    var gap = startMins - totalMins
    if (gap > 0 && gap < minGap) {
      minGap = gap
      next = { course: c, gapMinutes: gap, startTime: startSec.time }
    }
  })
  return next
}

// 获取今天的课程状态文字
function getTodayStatusText(courses) {
  var today = getTodayCourses(courses)
  if (today.length === 0) return { status: 'no_class', text: '今天没有课哦~ 自由安排时间吧 💕', emoji: '🎉' }
  
  var current = getCurrentCourse(courses)
  if (current) {
    return {
      status: 'in_class',
      text: '正在上「' + current.course.name + '」',
      emoji: '📖',
      course: current.course,
      remaining: current.remaining
    }
  }
  
  var next = getNextCourse(courses)
  if (next) {
    return {
      status: 'before_class',
      text: '下一节「' + next.course.name + '」',
      emoji: '⏰',
      course: next.course,
      gapMinutes: next.gapMinutes
    }
  }
  
  return { status: 'finished', text: '今天课程已全部结束~ 辛苦啦 🌸', emoji: '✨' }
}

// ==================== 情侣互动分析 ====================

// 生成情侣互动提示
function getCoupleTip(myCourses, partnerCourses, partnerName) {
  if (!partnerName) partnerName = 'TA'
  var myToday = getTodayCourses(myCourses)
  var partnerToday = getTodayCourses(partnerCourses)
  
  var tips = []
  
  // 对方课程数量提醒
  if (partnerToday.length >= 4) {
    tips.push(partnerName + '今天连续上了' + partnerToday.length + '节课，记得提醒' + partnerName + '休息哦 💕')
  }
  
  // 对方正在上课
  var partnerCurrent = getCurrentCourse(partnerCourses)
  if (partnerCurrent && partnerCurrent.remaining > 0) {
    var tip = partnerName + '还在上「' + partnerCurrent.course.name + '」'
    if (partnerCurrent.course.teacher) tip += '（' + partnerCurrent.course.teacher + '）'
    tip += '，还有' + partnerCurrent.remaining + '分钟下课~'
    tips.push(tip)
  }
  
  // 共同空闲时间
  var freeTime = findCommonFreeTime(myCourses, partnerCourses)
  if (freeTime.length > 0) {
    tips.push('你们今天有' + freeTime.length + '段共同空闲时间~ 可以一起做点什么哦 🥰')
  }
  
  if (tips.length === 0) {
    tips.push('今天和' + partnerName + '都要加油哦~ 想' + partnerName + '了就发个消息吧 💌')
  }
  
  return tips
}

// 找共同空闲时间
function findCommonFreeTime(myCourses, partnerCourses) {
  var todayIdx = getTodayWeekIndex()
  var myToday = getTodayCourses(myCourses)
  var partnerToday = getTodayCourses(partnerCourses)
  
  var allBusy = []
  myToday.forEach(function (c) {
    allBusy.push({ start: c.startSection, end: c.endSection })
  })
  partnerToday.forEach(function (c) {
    allBusy.push({ start: c.startSection, end: c.endSection })
  })
  
  if (allBusy.length === 0) {
    // 都没课，整天都空闲
    return [{ start: SECTIONS[0].label, end: SECTIONS[SECTIONS.length - 1].label, startSec: 1, endSec: SECTIONS.length }]
  }
  
  allBusy.sort(function (a, b) { return a.start - b.start })
  
  // 合并重叠区间
  var merged = [allBusy[0]]
  for (var i = 1; i < allBusy.length; i++) {
    var last = merged[merged.length - 1]
    if (allBusy[i].start <= last.end) {
      last.end = Math.max(last.end, allBusy[i].end)
    } else {
      merged.push(allBusy[i])
    }
  }
  
  // 找空闲间隙
  var freeSlots = []
  var dayStart = 1
  var dayEnd = SECTIONS.length
  
  merged.forEach(function (busy, idx) {
    if (busy.start > dayStart) {
      var startSec = SECTIONS[dayStart - 1]
      var endSec = SECTIONS[Math.min(busy.start - 1, SECTIONS.length) - 1]
      freeSlots.push({ start: startSec.label + '(' + startSec.time + ')', end: endSec.label + '(' + endSec.time + ')', startSec: dayStart, endSec: busy.start - 1 })
    }
    dayStart = Math.max(dayStart, busy.end + 1)
  })
  
  if (dayStart <= dayEnd) {
    var startSec = SECTIONS[dayStart - 1]
    var endSec = SECTIONS[dayEnd - 1]
    freeSlots.push({ start: startSec.label + '(' + startSec.time + ')', end: endSec.label + '(' + endSec.time + ')', startSec: dayStart, endSec: dayEnd })
  }
  
  return freeSlots
}

// 获取课程计数倒计时（距离某课程还有多少分钟）
function getCountdownText(gapMinutes) {
  if (gapMinutes <= 0) return '正在上课'
  if (gapMinutes < 60) return gapMinutes + '分钟后上课'
  var h = Math.floor(gapMinutes / 60)
  var m = gapMinutes % 60
  return m > 0 ? h + '小时' + m + '分钟后上课' : h + '小时后上课'
}

// 按周汇总课程数量
function getWeeklySummary(courses) {
  var summary = {}
  WEEK_LIST.forEach(function (w, i) {
    summary[i] = { day: w, count: 0, totalSections: 0 }
  })
  courses.forEach(function (c) {
    var wi = c.weekIndex != null ? c.weekIndex : 0
    if (summary[wi]) {
      summary[wi].count++
      summary[wi].totalSections += ((c.endSection || 1) - (c.startSection || 1) + 1)
    }
  })
  return summary
}

module.exports = {
  WEEK_LIST: WEEK_LIST,
  SECTIONS: SECTIONS,
  COURSE_COLORS: COURSE_COLORS,
  pickColor: pickColor,
  buildGridCells: buildGridCells,
  timeToMinutes: timeToMinutes,
  getNow: getNow,
  getTodayWeekIndex: getTodayWeekIndex,
  getCurrentSection: getCurrentSection,
  getTodayCourses: getTodayCourses,
  getCurrentCourse: getCurrentCourse,
  getNextCourse: getNextCourse,
  getTodayStatusText: getTodayStatusText,
  getCoupleTip: getCoupleTip,
  findCommonFreeTime: findCommonFreeTime,
  getCountdownText: getCountdownText,
  getWeeklySummary: getWeeklySummary,
  calcRemainingMinutes: calcRemainingMinutes
}