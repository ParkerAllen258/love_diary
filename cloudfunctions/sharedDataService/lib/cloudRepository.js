const { codedError } = require('./service')

function withoutId(document) {
  const copy = { ...document }
  delete copy._id
  delete copy.collection
  return copy
}

async function readDoc(scope, collection, id) {
  try {
    const result = await scope.collection(collection).doc(id).get()
    const value = result && (Array.isArray(result.data) ? result.data[0] : result.data)
    return value ? { ...value, _id: value._id || id } : null
  } catch (error) {
    if (error && (error.errCode === -1 || /not\s*found|does not exist/i.test(error.message || ''))) return null
    throw error
  }
}

async function requireActive(scope, openid, coupleId) {
  const user = await readDoc(scope, 'users', openid)
  const couple = await readDoc(scope, 'couple', coupleId)
  if (!user || user.relationshipStatus !== 'active' || user.coupleId !== coupleId ||
      !couple || couple.status !== 'active' || !Array.isArray(couple.memberOpenids) ||
      !couple.memberOpenids.includes(openid)) {
    throw codedError('RELATIONSHIP_NOT_FOUND')
  }
}

async function writeDoc(scope, collection, id, document) {
  await scope.collection(collection).doc(id).set({ data: withoutId(document) })
}

function emptyTree(coupleId) {
  return {
    _id: coupleId,
    coupleId,
    totalGrowth: 0,
    streak: 0,
    lastGrowDate: '',
    grownDates: [],
    wateredByOpenids: []
  }
}

class CloudRepository {
  constructor(cloudApi, database = cloudApi.database()) {
    this.cloud = cloudApi
    this.db = database
  }

  async getUser(openid) { return readDoc(this.db, 'users', openid) }
  async getCouple(id) { return readDoc(this.db, 'couple', id) }
  async getRecord(collection, id) { return readDoc(this.db, collection, id) }

  async removeOwnedRecord({ collection, id, openid, coupleId }) {
    return this.db.runTransaction(async transaction => {
      await requireActive(transaction, openid, coupleId)
      const document = await readDoc(transaction, collection, id)
      if (!document || document.coupleId !== coupleId || document.authorOpenid !== openid) {
        throw codedError('FORBIDDEN')
      }
      await transaction.collection(collection).doc(id).remove()
      return document
    })
  }

  async updateSharedRecord({ collection, id, openid, coupleId, fields, updatedAt }) {
    return this.db.runTransaction(async transaction => {
      await requireActive(transaction, openid, coupleId)
      const document = await readDoc(transaction, collection, id)
      if (!document || document.coupleId !== coupleId) throw codedError('FORBIDDEN')
      const saved = { ...document, ...fields, updateTime: updatedAt }
      await transaction.collection(collection).doc(id).set({ data: withoutId(saved) })
      return saved
    })
  }

  async listAlbumPhotos(coupleId, albumId) {
    const photos = []
    for (let offset = 0; ; offset += 100) {
      const result = await this.db.collection('album').where({ coupleId, albumId })
        .skip(offset).limit(100).get()
      const page = result.data || []
      photos.push(...page)
      if (page.length < 100) return photos
    }
  }

  async removeAlbumFolder({ openid, coupleId, folderId }) {
    return this.db.runTransaction(async transaction => {
      await requireActive(transaction, openid, coupleId)
      const folder = await readDoc(transaction, 'album_folders', folderId)
      if (!folder || folder.coupleId !== coupleId || folder.authorOpenid !== openid) {
        throw codedError('FORBIDDEN')
      }
      await transaction.collection('album_folders').doc(folderId).remove()
    })
  }

  async saveCheckin({ openid, coupleId, checkinId, partnerCheckinId, record }) {
    return this.db.runTransaction(async transaction => {
      await requireActive(transaction, openid, coupleId)
      if (record.coupleId !== coupleId || record.authorOpenid !== openid) throw codedError('FORBIDDEN')
      await writeDoc(transaction, 'companion_records', checkinId, { ...record, _id: checkinId })
      const partner = await readDoc(transaction, 'companion_records', partnerCheckinId)
      let tree = await readDoc(transaction, 'couple_tree', coupleId) || emptyTree(coupleId)
      let grew = false

      if (partner && partner.coupleId === coupleId && partner.date === record.date) {
        const grownDates = Array.isArray(tree.grownDates) ? tree.grownDates.slice() : []
        if (!grownDates.includes(record.date)) {
          grownDates.push(record.date)
          const advancesLatest = !tree.lastGrowDate || record.date > tree.lastGrowDate
          let streak = Number(tree.streak) || 0
          if (!tree.lastGrowDate) {
            streak = 1
          } else if (record.date > tree.lastGrowDate) {
            const days = Math.round((new Date(record.date) - new Date(tree.lastGrowDate)) / 86400000)
            streak = days === 1 ? streak + 1 : 1
          }
          const growth = 15 + (streak > 0 && streak % 7 === 0 ? 5 : 0)
          tree = {
            ...tree,
            totalGrowth: (Number(tree.totalGrowth) || 0) + growth,
            streak,
            lastGrowDate: record.date > (tree.lastGrowDate || '') ? record.date : tree.lastGrowDate,
            grownDates,
            wateredByOpenids: advancesLatest ? [] : (tree.wateredByOpenids || [])
          }
          grew = true
        }
      }
      await writeDoc(transaction, 'couple_tree', coupleId, tree)
      return { record: { ...record, _id: checkinId }, tree, grew }
    })
  }

  async mutateGoalTask({ openid, coupleId, id, operation, taskId, text, newTaskId, updatedAt }) {
    return this.db.runTransaction(async transaction => {
      await requireActive(transaction, openid, coupleId)
      const goal = await readDoc(transaction, 'goals', id)
      if (!goal || goal.coupleId !== coupleId) throw codedError('FORBIDDEN')
      const tasks = Array.isArray(goal.tasks) ? goal.tasks.map(task => ({ ...task })) : []
      if (operation === 'add') tasks.push({ id: newTaskId, text, done: false })
      if (operation === 'toggle') {
        const task = tasks.find(item => item.id === taskId)
        if (!task) throw codedError('INVALID_PAYLOAD')
        task.done = !task.done
      }
      if (operation === 'delete') {
        const index = tasks.findIndex(item => item.id === taskId)
        if (index < 0) throw codedError('INVALID_PAYLOAD')
        tasks.splice(index, 1)
      }
      const saved = { ...goal, tasks, updateTime: updatedAt }
      await writeDoc(transaction, 'goals', id, saved)
      return saved
    })
  }

  async toggleMomentLike({ openid, coupleId, id, updatedAt }) {
    return this.db.runTransaction(async transaction => {
      await requireActive(transaction, openid, coupleId)
      const moment = await readDoc(transaction, 'moment', id)
      if (!moment || moment.coupleId !== coupleId) throw codedError('FORBIDDEN')
      const likedByOpenids = Array.isArray(moment.likedByOpenids) ? moment.likedByOpenids.filter(Boolean) : []
      const index = likedByOpenids.indexOf(openid)
      if (index >= 0) likedByOpenids.splice(index, 1)
      else likedByOpenids.push(openid)
      const saved = { ...moment, likedByOpenids, likes: likedByOpenids.length, updateTime: updatedAt }
      await writeDoc(transaction, 'moment', id, saved)
      return saved
    })
  }

  async addMomentComment({ openid, coupleId, id, comment, updatedAt }) {
    return this.db.runTransaction(async transaction => {
      await requireActive(transaction, openid, coupleId)
      const moment = await readDoc(transaction, 'moment', id)
      if (!moment || moment.coupleId !== coupleId || comment.authorOpenid !== openid) throw codedError('FORBIDDEN')
      const saved = {
        ...moment,
        comments: [...(Array.isArray(moment.comments) ? moment.comments : []), comment],
        updateTime: updatedAt
      }
      await writeDoc(transaction, 'moment', id, saved)
      return comment
    })
  }

  async deleteMomentComment({ openid, coupleId, id, commentId, updatedAt }) {
    return this.db.runTransaction(async transaction => {
      await requireActive(transaction, openid, coupleId)
      const moment = await readDoc(transaction, 'moment', id)
      if (!moment || moment.coupleId !== coupleId) throw codedError('FORBIDDEN')
      const comments = Array.isArray(moment.comments) ? moment.comments : []
      const comment = comments.find(item => item.id === commentId)
      if (!comment || comment.authorOpenid !== openid) throw codedError('FORBIDDEN')
      await writeDoc(transaction, 'moment', id, {
        ...moment,
        comments: comments.filter(item => item.id !== commentId),
        updateTime: updatedAt
      })
      return { deleted: true, commentId }
    })
  }

  async waterTree({ openid, coupleId, updatedAt }) {
    return this.db.runTransaction(async transaction => {
      await requireActive(transaction, openid, coupleId)
      let tree = await readDoc(transaction, 'couple_tree', coupleId) || emptyTree(coupleId)
      const wateredByOpenids = Array.isArray(tree.wateredByOpenids) ? tree.wateredByOpenids.slice() : []
      if (!wateredByOpenids.includes(openid)) {
        wateredByOpenids.push(openid)
        tree = {
          ...tree,
          totalGrowth: (Number(tree.totalGrowth) || 0) + 5,
          wateredByOpenids,
          updateTime: updatedAt
        }
        await writeDoc(transaction, 'couple_tree', coupleId, tree)
      }
      return tree
    })
  }

  async getTempFileUrls(fileIDs) {
    const result = await this.cloud.getTempFileURL({ fileList: fileIDs })
    return (result.fileList || []).map(item => ({
      fileID: item.fileID,
      tempFileURL: item.tempFileURL || '',
      ok: (item.status === 0 || item.status === '0') && Boolean(item.tempFileURL)
    }))
  }

  async deleteFiles(fileIDs) {
    const result = await this.cloud.deleteFile({ fileList: fileIDs })
    return (result.fileList || []).map(item => ({
      fileID: item.fileID,
      ok: item.status === 0 || item.status === '0'
    }))
  }
}

module.exports = { CloudRepository, readDoc, requireActive }
