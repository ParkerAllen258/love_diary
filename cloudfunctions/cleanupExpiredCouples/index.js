const { cleanupExpired } = require('./lib/cleanup')

const PAGE_SIZE = 100

function removedCount(result) {
  if (result && result.stats && Number.isFinite(result.stats.removed)) return result.stats.removed
  if (result && Number.isFinite(result.deleted)) return result.deleted
  return 0
}

function storageError(entry) {
  const error = new Error(entry.errMsg || entry.message || 'cloud file deletion failed')
  error.code = entry.errCode || entry.code || entry.status || 'STORAGE_ERROR'
  return error
}

class CloudCleanupRepository {
  constructor(cloudApi, database = cloudApi.database()) {
    this.cloud = cloudApi
    this.db = database
  }

  async listExpiredArchived(now, limit) {
    const result = await this.db.collection('couple').where({
      status: 'archived',
      purgeAfter: this.db.command.lte(now)
    }).limit(Math.min(limit, 20)).get()
    return result.data || []
  }

  async listSharedRecords(collection, coupleId) {
    const records = []
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const result = await this.db.collection(collection).where({ coupleId })
        .skip(offset).limit(PAGE_SIZE).get()
      const page = result.data || []
      records.push(...page)
      if (page.length < PAGE_SIZE) return records
    }
  }

  async deleteFile(fileID) {
    const result = await this.cloud.deleteFile({ fileList: [fileID] })
    const entry = result && result.fileList && result.fileList[0]
    if (!entry) throw storageError({})
    if (entry.status === 0 || entry.status === '0') return true
    throw storageError(entry)
  }

  async removeSharedRecords(collection, coupleId) {
    const result = await this.db.collection(collection).where({ coupleId }).remove()
    return removedCount(result)
  }

  async removeRelationship(coupleId) {
    return this.db.collection('couple').doc(coupleId).remove()
  }
}

function isAuthorized(event, cleanupToken, callerOpenid) {
  const hasValidToken = Boolean(cleanupToken && event.token === cleanupToken)
  const isTimer = event.Type === 'Timer' || event.type === 'timer'
  return hasValidToken || (isTimer && !callerOpenid)
}

function createMain({
  repository,
  cleanup = cleanupExpired,
  clock = () => new Date(),
  cleanupToken,
  getCallerOpenid = () => '',
  logger = console
}) {
  return async function main(event = {}) {
    if (!isAuthorized(event, cleanupToken, getCallerOpenid())) {
      return { ok: false, error: 'FORBIDDEN' }
    }
    try {
      const result = await cleanup(repository, clock())
      return {
        ok: true,
        data: {
          relationshipsPurged: result.relationshipsPurged,
          recordsDeleted: result.recordsDeleted,
          filesDeleted: result.filesDeleted
        }
      }
    } catch (error) {
      logger.error({
        code: error && (error.code || error.errCode) || 'INTERNAL_ERROR',
        message: error && error.message ? error.message : String(error)
      })
      return { ok: false, error: 'INTERNAL_ERROR' }
    }
  }
}

let defaultMain

function getDefaultMain() {
  if (!defaultMain) {
    const cloud = require('wx-server-sdk')
    cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
    const database = cloud.database({ env: cloud.DYNAMIC_CURRENT_ENV })
    defaultMain = createMain({
      repository: new CloudCleanupRepository(cloud, database),
      cleanupToken: process.env.CLEANUP_TOKEN,
      getCallerOpenid: () => cloud.getWXContext().OPENID
    })
  }
  return defaultMain
}

exports.CloudCleanupRepository = CloudCleanupRepository
exports.createMain = createMain
exports.main = async (event, context) => getDefaultMain()(event, context)
