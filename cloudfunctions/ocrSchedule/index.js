const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const { handleOcr } = require('./lib/handler')

const WEEK_KEYWORDS = [
  '周一', '周二', '周三', '周四', '周五', '周六', '周日',
  '星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'
]

const SECTION_TIMES = [
  { section: 1, start: '08:00', end: '08:45' },
  { section: 2, start: '08:55', end: '09:40' },
  { section: 3, start: '10:00', end: '10:45' },
  { section: 4, start: '10:55', end: '11:40' },
  { section: 5, start: '14:00', end: '14:45' },
  { section: 6, start: '14:55', end: '15:40' },
  { section: 7, start: '16:00', end: '16:45' },
  { section: 8, start: '16:55', end: '17:40' },
  { section: 9, start: '19:00', end: '19:45' },
  { section: 10, start: '19:55', end: '20:40' },
  { section: 11, start: '20:50', end: '21:35' }
]

const PLACE_KEYWORDS = [
  '教学楼', '教室', '实验室', '一教', '二教', '三教', '四教', '五教', '六教',
  '公教', '主楼', '综合楼', '实训楼', '逸夫楼', '图书馆', '体育馆', '机房',
  '楼A', '楼B', '楼C', '楼D', '楼E'
]

const TEACHER_KEYWORDS = [
  '教授', '副教授', '讲师', '助教', '教师', '老师', '导师'
]

const COMMON_SURNAMES = '王李张刘陈杨赵黄周吴徐孙胡朱高林何郭马罗梁宋郑谢韩唐冯于董萧曹袁邓许傅沈曾彭吕苏卢蒋蔡贾丁魏薛叶阎余潘杜戴夏钟汪田任姜范方石姚谭廖邹熊金陆郝孔白崔康毛邱秦江史顾侯邵孟龙万段雷钱汤尹易常武乔贺赖龚文'

// 同一行文本的Y坐标容差（像素）
const ROW_Y_TOLERANCE = 25

// ========== 表格型课表解析（基于OCR坐标） ==========

// 按Y坐标将OCR条目分组为行
function groupItemsByRow(items) {
  var sorted = items.slice().sort(function (a, b) {
    return getItemY(a) - getItemY(b)
  })

  var rows = []
  var currentRow = []
  var currentY = -1

  for (var i = 0; i < sorted.length; i++) {
    var item = sorted[i]
    var y = getItemY(item)

    if (currentY < 0 || Math.abs(y - currentY) <= ROW_Y_TOLERANCE) {
      if (currentY < 0) currentY = y
      currentRow.push(item)
    } else {
      if (currentRow.length > 0) rows.push(sortRowByX(currentRow))
      currentRow = [item]
      currentY = y
    }
  }
  if (currentRow.length > 0) rows.push(sortRowByX(currentRow))
  return rows
}

function getItemY(item) {
  if (item.pos && item.pos.left_top) return item.pos.left_top.y
  return 0
}

function sortRowByX(row) {
  return row.sort(function (a, b) {
    var ax = (a.pos && a.pos.left_top) ? a.pos.left_top.x : 0
    var bx = (b.pos && b.pos.left_top) ? b.pos.left_top.x : 0
    return ax - bx
  })
}

// 在行列表中检测表头行（包含2个以上周关键词的行）
function detectHeaderRow(rows) {
  for (var r = 0; r < Math.min(rows.length, 6); r++) {
    var row = rows[r]
    var weekCols = []
    for (var c = 0; c < row.length; c++) {
      var text = row[c].text || ''
      for (var w = 0; w < WEEK_KEYWORDS.length; w++) {
        if (text.indexOf(WEEK_KEYWORDS[w]) >= 0) {
          weekCols.push({ colIndex: c, weekIndex: w % 7 })
          break
        }
      }
    }
    if (weekCols.length >= 2) {
      // 按列顺序（左到右）自然排列
      weekCols.sort(function (a, b) { return a.colIndex - b.colIndex })
      return { headerRowIndex: r, columns: weekCols }
    }
  }
  return null
}

// 基于OCR坐标解析表格型课表
function parseTableByPosition(items) {
  if (!items || items.length < 3) return null

  var rows = groupItemsByRow(items)
  if (rows.length < 2) return null

  var headerInfo = detectHeaderRow(rows)
  if (!headerInfo) return null

  var columns = headerInfo.columns
  var courses = []

  for (var r = headerInfo.headerRowIndex + 1; r < rows.length; r++) {
    var row = rows[r]
    if (row.length === 0) continue

    // 尝试从行首提取节次信息
    var startSection = 1
    var endSection = 1
    var colOffset = 0

    if (row.length > 0) {
      var ft = (row[0].text || '').trim()
      var secInfo = extractSectionFromCell(ft)
      if (secInfo) {
        startSection = secInfo.start
        endSection = secInfo.end
        colOffset = 1
      }
    }

    // 将各单元格映射到对应的星期列
    for (var c = 0; c < columns.length; c++) {
      var cellIdx = columns[c].colIndex + colOffset
      if (cellIdx < 0 || cellIdx >= row.length) continue

      var cellText = (row[cellIdx].text || '').trim()
      if (!cellText) continue

      // 跳过纯数字、纯时间等非课程文本
      if (/^(\d{3,}|\d{2}:\d{2}|[,，.。;；:：、\-—])$/.test(cellText)) continue
      if (cellText.length < 1) continue

      var name = cellText
      var place = ''

      // 尝试从文本中分离地点
      for (var p = 0; p < PLACE_KEYWORDS.length; p++) {
        var kw = PLACE_KEYWORDS[p]
        var idx = name.indexOf(kw)
        if (idx > 0) {
          place = name.substring(idx).trim()
          name = name.substring(0, idx).trim()
          break
        }
      }

      if (!name) continue

      courses.push({
        name: name.length > 30 ? name.substring(0, 30) : name,
        weekIndex: columns[c].weekIndex,
        startSection: startSection,
        endSection: endSection,
        place: place,
        teacher: '',
        className: ''
      })
    }
  }

  return courses.length > 0 ? courses : null
}

// 从单元格文本中提取节次信息
function extractSectionFromCell(text) {
  if (!text) return null
  // 匹配 "1-2", "第1-2节", "第1节", "1-2节"
  var m1 = text.match(/^第?\s*(\d{1,2})\s*[-~至到]\s*(\d{1,2})\s*节?$/)
  if (m1) return { start: parseInt(m1[1]), end: parseInt(m1[2]) }
  var m2 = text.match(/^(\d{1,2})\s*[-~至到]\s*(\d{1,2})\s*$/) 
  if (m2) return { start: parseInt(m2[1]), end: parseInt(m2[2]) }
  var m3 = text.match(/^第?\s*(\d{1,2})\s*节\s*$/)
  if (m3) return { start: parseInt(m3[1]), end: parseInt(m3[1]) }
  return null
}

// ========== 基于文本的表格解析（兜底） ==========

// 从一行文本中提取所有周关键词及其位置
function extractWeekColumns(line) {
  var cols = []
  for (var w = 0; w < WEEK_KEYWORDS.length; w++) {
    var kw = WEEK_KEYWORDS[w]
    var idx = -1
    var searchFrom = 0
    while ((idx = line.indexOf(kw, searchFrom)) >= 0) {
      // 避免同一个关键词重复匹配（如"周一"匹配到"星期一"）
      cols.push({ position: idx, weekIndex: w % 7 })
      searchFrom = idx + kw.length
    }
  }
  cols.sort(function (a, b) { return a.position - b.position })
  // 去重：同一位置只保留一个
  var unique = []
  for (var i = 0; i < cols.length; i++) {
    if (i === 0 || cols[i].position - cols[i - 1].position > 3) {
      unique.push(cols[i])
    }
  }
  return unique
}

// 按空格将一行拆分为单元格
function splitRowCells(text, expectedCols) {
  // 先尝试按2个以上空格拆分
  var parts = text.split(/\s{2,}/)
  if (parts.length >= Math.min(expectedCols || 2, 2)) {
    return parts.filter(function (p) { return p.trim() })
  }
  // 按单个空格拆分
  parts = text.split(/\s+/)
  return parts.filter(function (p) { return p.trim() })
}

// 基于纯文本解析表格型课表
function parseTableByText(lines) {
  var headerLineIdx = -1
  var weekCols = []

  for (var i = 0; i < Math.min(lines.length, 6); i++) {
    weekCols = extractWeekColumns(lines[i])
    if (weekCols.length >= 2) {
      headerLineIdx = i
      break
    }
  }

  if (headerLineIdx < 0) return null

  var courses = []

  for (var r = headerLineIdx + 1; r < lines.length; r++) {
    var line = lines[r].trim()
    if (!line) continue

    // 跳过也是表头的行
    if (extractWeekColumns(line).length >= 2) continue

    var startSection = 1
    var endSection = 1
    var remaining = line

    var secInfo = extractSectionFromCell(line)
    if (secInfo) {
      startSection = secInfo.start
      endSection = secInfo.end
      // 去掉节次前缀
      var prefixMatch = line.match(/^第?\s*\d{1,2}\s*[-~至到]?\s*\d{0,2}\s*节?\s*/)
      if (prefixMatch) remaining = line.substring(prefixMatch[0].length).trim()
    }

    var cells = splitRowCells(remaining, weekCols.length)

    for (var c = 0; c < Math.min(cells.length, weekCols.length); c++) {
      var cellText = cells[c].trim()
      if (!cellText || cellText.length < 1) continue
      if (/^\d{3,}$/.test(cellText)) continue
      if (/^\d{2}:\d{2}$/.test(cellText)) continue

      var name = cellText
      var place = ''
      for (var p = 0; p < PLACE_KEYWORDS.length; p++) {
        var kw = PLACE_KEYWORDS[p]
        var idx = name.indexOf(kw)
        if (idx > 0) {
          place = name.substring(idx).trim()
          name = name.substring(0, idx).trim()
          break
        }
      }

      if (name) {
        courses.push({
          name: name.length > 30 ? name.substring(0, 30) : name,
          weekIndex: weekCols[c].weekIndex,
          startSection: startSection,
          endSection: endSection,
          place: place,
          teacher: '',
          className: ''
        })
      }
    }
  }

  return courses.length > 0 ? courses : null
}

// ========== 多行表头解析 ==========

// 检测连续多行每行只含一个周关键词（表头分散在多行的情况）
function detectMultiLineHeader(lines) {
  var headerWeeks = []
  var seenWeeks = {}
  for (var i = 0; i < Math.min(lines.length, 10); i++) {
    var line = lines[i].trim()
    if (!line) continue
    var weekFound = -1
    for (var w = 0; w < WEEK_KEYWORDS.length; w++) {
      if (line.indexOf(WEEK_KEYWORDS[w]) >= 0) {
        weekFound = w % 7
        break
      }
    }
    if (weekFound >= 0 && !seenWeeks[weekFound]) {
      // 这一行只有一个周关键词（没有多余的其他内容）
      var withoutWeek = line
      for (var w2 = 0; w2 < WEEK_KEYWORDS.length; w2++) {
        withoutWeek = withoutWeek.replace(WEEK_KEYWORDS[w2], '')
      }
      withoutWeek = withoutWeek.trim()
      // 如果去掉周关键词后几乎没有其他内容，认为是纯表头行
      if (withoutWeek.length <= 3) {
        headerWeeks.push({ weekIndex: weekFound, lineIndex: i })
        seenWeeks[weekFound] = true
      }
    }
  }
  // 至少找到2个不重复的周关键词
  if (headerWeeks.length >= 2) {
    headerWeeks.sort(function (a, b) { return a.weekIndex - b.weekIndex })
    return headerWeeks
  }
  return null
}

// 多行表头方式的表格解析
function parseTableByMultilineHeader(lines) {
  var header = detectMultiLineHeader(lines)
  if (!header) return null

  var headerEndLine = header[header.length - 1].lineIndex
  var courses = []

  for (var i = headerEndLine + 1; i < lines.length; i++) {
    var line = lines[i].trim()
    if (!line) continue

    // 跳过也是表头的行
    var stillHeader = false
    for (var w = 0; w < WEEK_KEYWORDS.length; w++) {
      if (line.indexOf(WEEK_KEYWORDS[w]) >= 0) {
        var withoutWeek = line.replace(WEEK_KEYWORDS[w], '').trim()
        if (withoutWeek.length <= 3) { stillHeader = true; break }
      }
    }
    if (stillHeader) continue

    // 提取节次信息
    var startSection = 1
    var endSection = 1
    var remaining = line
    var secInfo = extractSectionFromCell(line)
    if (secInfo) {
      startSection = secInfo.start
      endSection = secInfo.end
      var prefixMatch = line.match(/^第?\s*\d{1,2}\s*[-~至到]?\s*\d{0,2}\s*节?\s*/)
      if (prefixMatch) remaining = line.substring(prefixMatch[0].length).trim()
    }

    var cells = splitRowCells(remaining, header.length)

    for (var c = 0; c < Math.min(cells.length, header.length); c++) {
      var cellText = cells[c].trim()
      if (!cellText || cellText.length < 1) continue
      if (/^\d{3,}$/.test(cellText)) continue
      if (/^\d{2}:\d{2}$/.test(cellText)) continue

      var name = cellText
      var place = ''
      for (var p = 0; p < PLACE_KEYWORDS.length; p++) {
        var kw = PLACE_KEYWORDS[p]
        var idx = name.indexOf(kw)
        if (idx > 0) {
          place = name.substring(idx).trim()
          name = name.substring(0, idx).trim()
          break
        }
      }

      if (name) {
        courses.push({
          name: name.length > 30 ? name.substring(0, 30) : name,
          weekIndex: header[c].weekIndex,
          startSection: startSection,
          endSection: endSection,
          place: place,
          teacher: '',
          className: ''
        })
      }
    }
  }

  return courses.length > 0 ? courses : null
}

function parseOcrText(items, text) {
  // 第一步：尝试基于OCR坐标的表格解析（最准确）
  if (items && items.length > 0) {
    var tableCourses = parseTableByPosition(items)
    if (tableCourses && tableCourses.length > 0) return tableCourses
  }

  // 第二步：尝试基于纯文本的表格解析（兜底）
  var lines = text.split('\n').filter(function (l) { return l.trim() })
  var textTableCourses = parseTableByText(lines)
  if (textTableCourses && textTableCourses.length > 0) return textTableCourses

  // 第二步半：尝试多行表头解析（表头分散在多行的情况）
  var multiHeaderCourses = parseTableByMultilineHeader(lines)
  if (multiHeaderCourses && multiHeaderCourses.length > 0) return multiHeaderCourses

  // 第三步：原有逐行解析（适用于每行含周关键词的场景）
  var courses = []
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim()
    var course = parseCourseLine(line)
    if (course) courses.push(course)
  }

  if (courses.length === 0 && lines.length >= 3) {
    return parseMultiLineCourses(lines)
  }

  return courses
}

function parseCourseLine(line) {
  var text = line.replace(/\s+/g, ' ').trim()
  if (!text || text.length < 2) return null

  var weekIndex = -1
  for (var i = 0; i < WEEK_KEYWORDS.length; i++) {
    var idx = text.indexOf(WEEK_KEYWORDS[i])
    if (idx >= 0) {
      weekIndex = i % 7
      text = text.replace(WEEK_KEYWORDS[i], ' ')
      break
    }
  }
  if (weekIndex < 0) return null

  var teacher = ''
  for (var t = 0; t < TEACHER_KEYWORDS.length; t++) {
    var kw = TEACHER_KEYWORDS[t]
    var tidx = text.indexOf(kw)
    if (tidx >= 0) {
      var before = text.substring(Math.max(0, tidx - 6), tidx).trim()
      var after = text.substring(tidx + kw.length, Math.min(text.length, tidx + kw.length + 10)).trim()
      var nameCandidate = (before + after).replace(/[,，。.\-—\s]/g, '').trim()
      if (nameCandidate.length >= 1 && nameCandidate.length <= 6) {
        teacher = nameCandidate
      } else {
        teacher = kw
      }
      text = text.substring(0, tidx) + ' ' + text.substring(tidx + kw.length)
      break
    }
  }

  if (!teacher) {
    var surnameMatch = text.match(new RegExp('([' + COMMON_SURNAMES + '])\\s*[' + COMMON_SURNAMES + '\\w]{1,3}'))
    if (surnameMatch) {
      var potentialName = surnameMatch[0].replace(/\s/g, '')
      var hasTimeOrPlace = /\d|教|楼|室|节|周/.test(potentialName)
      if (!hasTimeOrPlace && potentialName.length >= 2 && potentialName.length <= 4) {
        teacher = potentialName
        text = text.replace(surnameMatch[0], ' ')
      }
    }
  }

  var timeMatch = text.match(/(\d{1,2}):(\d{2})\s*[-~至到]\s*(\d{1,2}):(\d{2})/)
  var sectionMatch = text.match(/第\s*(\d{1,2})\s*[-~至到]?\s*第?\s*(\d{1,2})?\s*节/)

  var startSection = 1
  var endSection = 1

  if (timeMatch) {
    var startTime = timeMatch[1].padStart(2, '0') + ':' + timeMatch[2]
    var endTime = timeMatch[3].padStart(2, '0') + ':' + timeMatch[4]
    text = text.replace(timeMatch[0], ' ')

    for (var s = 0; s < SECTION_TIMES.length; s++) {
      if (SECTION_TIMES[s].start === startTime) startSection = s + 1
      if (SECTION_TIMES[s].end === endTime) endSection = s + 1
    }
    if (endSection < startSection) endSection = startSection
  } else if (sectionMatch) {
    startSection = parseInt(sectionMatch[1])
    endSection = sectionMatch[2] ? parseInt(sectionMatch[2]) : startSection
    text = text.replace(sectionMatch[0], ' ')
  }

  var place = ''
  for (var p = 0; p < PLACE_KEYWORDS.length; p++) {
    var pkw = PLACE_KEYWORDS[p]
    var pidx = text.indexOf(pkw)
    if (pidx >= 0) {
      var pStart = Math.max(0, pidx - 8)
      var pEnd = Math.min(text.length, pidx + pkw.length + 8)
      place = text.substring(pStart, pEnd).replace(/[,，。.\-—]/g, ' ').replace(/\s+/g, ' ').trim()
      text = text.substring(0, pidx) + ' ' + text.substring(pEnd)
      break
    }
  }

  var name = text.replace(/[,，。.\-—·]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!name || name.length < 1) name = '未识别课程'
  if (name.length > 30) name = name.substring(0, 30)

  return {
    name: name,
    weekIndex: weekIndex,
    startSection: startSection,
    endSection: endSection,
    place: place,
    teacher: teacher,
    className: ''
  }
}

function parseMultiLineCourses(lines) {
  var courses = []
  var fullText = lines.join('|')

  var regex = /([\u4e00-\u9fa5\w]+)\s*[,，]?\s*([\u4e00-\u9fa5]{1,3})(?:周|星期)\s*(\d{1,2}):(\d{2})\s*[-~至到]\s*(\d{1,2}):(\d{2})/g
  var match
  while ((match = regex.exec(fullText)) !== null) {
    var course = parseCourseLine(match[0])
    if (course) courses.push(course)
  }

  if (courses.length === 0) {
    var linesCopy = lines.slice()
    var merged = mergeOCRBlocks(linesCopy)
    for (var i = 0; i < merged.length; i++) {
      var course = parseCourseLine(merged[i])
      if (course) courses.push(course)
    }
  }

  return courses
}

function mergeOCRBlocks(lines) {
  var merged = []
  var current = ''

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim()
    if (!line) continue

    var hasWeekKey = false
    for (var w = 0; w < WEEK_KEYWORDS.length; w++) {
      if (line.indexOf(WEEK_KEYWORDS[w]) >= 0) {
        hasWeekKey = true
        break
      }
    }

    if (hasWeekKey && current) {
      merged.push(current)
      current = line
    } else if (hasWeekKey) {
      current = line
    } else {
      current += ' ' + line
    }
  }
  if (current) merged.push(current)

  return merged
}

exports.main = function (event) {
  var openid = cloud.getWXContext().OPENID
  return handleOcr({
    fileID: event && event.fileID,
    openid: openid,
    recognize: function (fileID) {
      return cloud.openapi.ocr.printedText({
        type: 'photo',
        imgUrl: fileID
      })
    },
    parse: parseOcrText,
    deleteFile: function (fileID) {
      return cloud.deleteFile({ fileList: [fileID] })
    }
  })
}
