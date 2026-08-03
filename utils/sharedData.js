async function callSharedData(action, payload = {}) {
  const safePayload = { ...payload }
  delete safePayload.openid
  delete safePayload.OPENID
  delete safePayload.coupleId
  delete safePayload.authorOpenid
  const response = await wx.cloud.callFunction({
    name: 'sharedDataService',
    data: { action, payload: safePayload }
  })
  const result = response && response.result
  if (!result || !result.ok) {
    const error = new Error(result && result.message ? result.message : '操作失败，请稍后重试')
    error.code = result && result.error ? result.error : 'INTERNAL_ERROR'
    throw error
  }
  return result.data
}

async function resolveFileUrls(fileIDs) {
  const unique = [...new Set((fileIDs || []).filter(Boolean))]
  const resolved = {}
  for (let index = 0; index < unique.length; index += 50) {
    const rows = await callSharedData('getFileUrls', { fileIDs: unique.slice(index, index + 50) })
    for (const row of rows || []) {
      if (row && row.fileID && row.ok && row.tempFileURL) resolved[row.fileID] = row.tempFileURL
    }
  }
  return resolved
}

module.exports = { callSharedData, resolveFileUrls }
