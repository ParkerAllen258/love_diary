const solarLunar = require('./solarlunar').default || require('./solarlunar')

const CALENDAR_SOLAR = 'solar'
const CALENDAR_LUNAR = 'lunar'

const LUNAR_YEAR_START = 1950
const LUNAR_YEAR_END = 2030

function parseDateParts(dateStr) {
  const parts = (dateStr || '').split('-').map(Number)
  return { year: parts[0] || 0, month: parts[1] || 0, day: parts[2] || 0 }
}

function padDateParts(year, month, day) {
  const m = String(month).padStart(2, '0')
  const d = String(day).padStart(2, '0')
  return year + '-' + m + '-' + d
}

function formatSolarText(dateStr) {
  const p = parseDateParts(dateStr)
  if (!p.year) return ''
  return p.year + '年' + p.month + '月' + p.day + '日（阳历）'
}

function formatLunarText(dateStr, isLeap) {
  const p = parseDateParts(dateStr)
  if (!p.year) return ''
  const monthCn = (isLeap ? '闰' : '') + solarLunar.toChinaMonth(p.month)
  const dayCn = solarLunar.toChinaDay(p.day)
  return p.year + '年' + monthCn + dayCn + '（农历）'
}

function formatDateText(dateStr, calendar, isLeap) {
  if (!dateStr) return ''
  if (calendar === CALENDAR_LUNAR) return formatLunarText(dateStr, isLeap)
  return formatSolarText(dateStr)
}

function toSolarDate(dateStr, calendar, isLeap) {
  const p = parseDateParts(dateStr)
  if (!p.year) return null
  if (calendar === CALENDAR_LUNAR) {
    const solar = solarLunar.lunar2solar(p.year, p.month, p.day, !!isLeap)
    return new Date(solar.cYear, solar.cMonth - 1, solar.cDay)
  }
  return new Date(p.year, p.month - 1, p.day)
}

function isSameSolarDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

function calcElapsed(dateStr, calendar, isLeap) {
  const start = toSolarDate(dateStr, calendar, isLeap)
  const now = new Date()
  if (!start || isNaN(start.getTime())) {
    return { years: 0, months: 0, days: 0, isToday: false }
  }
  if (isSameSolarDay(start, now)) {
    return { years: 0, months: 0, days: 0, isToday: true }
  }
  let years = now.getFullYear() - start.getFullYear()
  let months = now.getMonth() - start.getMonth()
  let days = now.getDate() - start.getDate()
  if (days < 0) {
    months -= 1
    days += new Date(now.getFullYear(), now.getMonth(), 0).getDate()
  }
  if (months < 0) {
    years -= 1
    months += 12
  }
  return { years, months, days, isToday: false }
}

function getNextBirthdaySolarDate(dateStr, calendar, isLeap) {
  const p = parseDateParts(dateStr)
  const now = new Date()
  now.setHours(0, 0, 0, 0)

  if (calendar === CALENDAR_LUNAR) {
    const todayLunar = solarLunar.solar2lunar(
      now.getFullYear(),
      now.getMonth() + 1,
      now.getDate()
    )
    for (let ly = todayLunar.lYear; ly <= todayLunar.lYear + 1; ly++) {
      const solar = solarLunar.lunar2solar(ly, p.month, p.day, !!isLeap)
      const next = new Date(solar.cYear, solar.cMonth - 1, solar.cDay)
      next.setHours(0, 0, 0, 0)
      if (next >= now) return next
    }
    const fallback = solarLunar.lunar2solar(todayLunar.lYear + 1, p.month, p.day, !!isLeap)
    return new Date(fallback.cYear, fallback.cMonth - 1, fallback.cDay)
  }

  let next = new Date(now.getFullYear(), p.month - 1, p.day)
  next.setHours(0, 0, 0, 0)
  if (next < now) {
    next = new Date(now.getFullYear() + 1, p.month - 1, p.day)
    next.setHours(0, 0, 0, 0)
  }
  return next
}

function calcBirthdayCountdown(dateStr, calendar, isLeap) {
  const next = getNextBirthdaySolarDate(dateStr, calendar, isLeap)
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  next.setHours(0, 0, 0, 0)
  if (isSameSolarDay(next, now)) return { days: 0, isToday: true }
  const days = Math.round((next - now) / 86400000)
  return { days, isToday: false }
}

function calcFutureCountdown(dateStr, calendar, isLeap) {
  const target = toSolarDate(dateStr, calendar, isLeap)
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  target.setHours(0, 0, 0, 0)
  const diff = Math.round((target - now) / 86400000)
  if (diff === 0) return { days: 0, isToday: true }
  if (diff > 0) return { days: diff, isToday: false, isPast: false }
  return { days: Math.abs(diff), isToday: false, isPast: true }
}

function buildLunarMonthOptions(year) {
  const leap = solarLunar.leapMonth(year)
  const options = []
  for (let m = 1; m <= 12; m++) {
    options.push({ month: m, isLeap: false, label: solarLunar.toChinaMonth(m) })
    if (leap === m) {
      options.push({ month: m, isLeap: true, label: '闰' + solarLunar.toChinaMonth(m) })
    }
  }
  return options
}

function buildLunarDayLabels(year, month, isLeap) {
  const total = isLeap ? solarLunar.leapDays(year) : solarLunar.monthDays(year, month)
  const labels = []
  for (let d = 1; d <= total; d++) {
    labels.push(solarLunar.toChinaDay(d))
  }
  return labels
}

function buildLunarPickerRange(year, month, isLeap) {
  const years = []
  for (let y = LUNAR_YEAR_START; y <= LUNAR_YEAR_END; y++) {
    years.push(y + '年')
  }
  const monthOptions = buildLunarMonthOptions(year)
  const monthLabels = monthOptions.map(item => item.label)
  const dayLabels = buildLunarDayLabels(year, month, isLeap)
  return { years, monthOptions, monthLabels, dayLabels }
}

function getLunarPickerValue(dateStr, isLeap) {
  const p = parseDateParts(dateStr)
  const year = p.year || 2000
  const { monthOptions } = buildLunarPickerRange(year, p.month || 1, isLeap)
  const yearIndex = Math.max(0, year - LUNAR_YEAR_START)
  let monthIndex = monthOptions.findIndex(
    item => item.month === (p.month || 1) && item.isLeap === !!isLeap
  )
  if (monthIndex < 0) monthIndex = 0
  const dayIndex = Math.max(0, (p.day || 1) - 1)
  return [yearIndex, monthIndex, dayIndex]
}

function getLunarDateFromPicker(pickerValue, monthOptions) {
  const year = LUNAR_YEAR_START + pickerValue[0]
  const monthItem = monthOptions[pickerValue[1]] || monthOptions[0]
  const day = pickerValue[2] + 1
  return {
    date: padDateParts(year, monthItem.month, day),
    isLeap: monthItem.isLeap
  }
}

function getEditorPreview(dateStr, calendar, isLeap) {
  if (!dateStr) return '请选择日期'
  return formatDateText(dateStr, calendar, isLeap)
}

module.exports = {
  CALENDAR_SOLAR,
  CALENDAR_LUNAR,
  LUNAR_YEAR_START,
  LUNAR_YEAR_END,
  parseDateParts,
  padDateParts,
  formatDateText,
  calcElapsed,
  calcBirthdayCountdown,
  calcFutureCountdown,
  buildLunarPickerRange,
  getLunarPickerValue,
  getLunarDateFromPicker,
  getEditorPreview
}
