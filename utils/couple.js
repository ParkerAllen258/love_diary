const { callRelationship } = require('./relationship')

function bindCouple(myOpenid, myInviteCode, targetCode) {
  return callRelationship('sendRequest', { inviteCode: targetCode })
}

module.exports = { bindCouple }
