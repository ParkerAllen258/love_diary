// 选择图片
function chooseImage() {

  return new Promise((resolve, reject) => {

    wx.chooseMedia({

      count: 1,

      mediaType: ['image'],

      sourceType: ['album', 'camera'],

      success: res => {

        resolve(

          res.tempFiles[0].tempFilePath

        )

      },

      fail: err => {

        reject(err)

      }

    })

  })

}

// 上传图片
const { getCoupleId } = require('./relationship')

function uploadImage(filePath) {

  const coupleId = getCoupleId()

  if (!coupleId) {

    return Promise.reject(new Error('请先绑定情侣'))

  }

  return wx.cloud.uploadFile({

    cloudPath:

      'couples/' + coupleId + '/diaries/' +

      Date.now() + '_' +

      Math.random().toString(36).substr(2, 8) +

      '.png',

    filePath: filePath

  })

}

module.exports = {

  chooseImage,

  uploadImage

}