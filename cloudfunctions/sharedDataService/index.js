const { publicError } = require('../relationshipService/lib/domain')

function createMain({ cloudApi, sharedDataService, logger = console }) {
  return async function main(event = {}) {
    const openid = cloudApi.getWXContext().OPENID
    try {
      const data = await sharedDataService.execute(event.action, openid, event.payload || {})
      return { ok: true, data }
    } catch (error) {
      logger.error({
        action: event.action,
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
    const { SharedDataService } = require('./lib/service')
    const { CloudRepository } = require('./lib/cloudRepository')
    cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
    const database = cloud.database({ env: cloud.DYNAMIC_CURRENT_ENV })
    defaultMain = createMain({
      cloudApi: cloud,
      sharedDataService: new SharedDataService({ repository: new CloudRepository(cloud, database) })
    })
  }
  return defaultMain
}

exports.createMain = createMain
exports.main = async (event, context) => getDefaultMain()(event, context)
