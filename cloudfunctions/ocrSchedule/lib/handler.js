function publicResult(courses) {
  if (courses.length) return { ok: true, courses }
  return { ok: false, msg: '未能从图片中识别出课程信息，请确保图片清晰且包含课程表内容', courses: [] }
}

async function handleOcr({ fileID, openid, recognize, parse, deleteFile }) {
  if (typeof fileID !== 'string' || !openid || !fileID.includes('/ocr/' + openid + '/')) {
    return { ok: false, msg: '文件无效，请重新选择图片', courses: [] }
  }
  try {
    const result = await recognize(fileID)
    const items = result && Array.isArray(result.items) ? result.items : []
    if (!items.length) return { ok: false, msg: 'OCR未识别到文字，请确保图片清晰', courses: [] }
    const text = items.map(item => typeof item === 'string'
      ? item
      : item.text || item.content || item.value || item.itemstring || '').join('\n')
    return publicResult(parse(items, text))
  } catch (error) {
    return {
      ok: false,
      msg: 'OCR服务暂不可用，请稍后重试或手动添加课程',
      courses: []
    }
  } finally {
    try {
      await deleteFile(fileID)
    } catch (error) {}
  }
}

module.exports = { handleOcr }
