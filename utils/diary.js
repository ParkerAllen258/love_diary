const db = wx.cloud.database()
const { getCoupleId } = require('./relationship')

// 发布日志
function publishDiary(

  content,

  imageUrl,

  authorOpenid,

  partnerOpenid

) {

  const coupleId = getCoupleId()

  // 未绑定情侣
  if (!coupleId) {

    return Promise.reject({

      message: '请先绑定情侣'

    })

  }

  // 内容和图片都没有
  if (!content && !imageUrl) {

    return Promise.reject({

      message: '请输入内容或上传图片'

    })

  }

  return db.collection('diaries')
    .add({

      data: {

        content: content,

        imageUrl: imageUrl,

        coupleId: coupleId,

        authorOpenid: authorOpenid,

        partnerOpenid: partnerOpenid,

        createTime: new Date()

      }

    })

}

// 获取日志（按情侣关系查询双方日记）
function getDiaryList() {

  const coupleId = getCoupleId()
  if (!coupleId) {
    return Promise.resolve({ data: [] })
  }

  return db.collection('diaries')
    .where({ coupleId })
    .orderBy('createTime', 'desc')
    .limit(100)
    .get()

}

module.exports = {

  publishDiary,

  getDiaryList

}