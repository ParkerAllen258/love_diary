const crypto = require('node:crypto')
const { publicError } = require('./lib/domain')
const { RelationshipService } = require('./lib/service')
const { CloudRepository } = require('./lib/cloudRepository')

function createMain({ cloudApi, relationshipService, logger = console }) {
  return async function main(event = {}) {
    let openid = ''
    try {
      const context = cloudApi.getWXContext()
      openid = context && context.OPENID
      const data = await relationshipService.execute(event.action, openid, event.payload || {})
      return { ok: true, data }
    } catch (error) {
      logger.error({
        action: event && event.action,
        openid,
        code: error && error.code ? error.code : 'INTERNAL_ERROR',
        message: error && error.message ? error.message : String(error)
      })
      return publicError(error && error.code)
    }
  }
}

let defaultMain

function getDefaultMain() {
  if (!defaultMain) {
    const cloud = require('wx-server-sdk')
    cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
    const repository = new CloudRepository(cloud.database({ env: cloud.DYNAMIC_CURRENT_ENV }))
    const service = new RelationshipService({ repository, randomBytes: crypto.randomBytes })
    defaultMain = createMain({ cloudApi: cloud, relationshipService: service })
  }
  return defaultMain
}

exports.createMain = createMain
exports.main = async (event, context) => getDefaultMain()(event, context)
