const DELETE_COLLECTIONS = new Set([
  'moment', 'diaries', 'letter', 'album', 'money', 'cost',
  'note', 'schedule', 'goals', 'companion_records'
])

const UPDATE_FIELDS = Object.freeze({
  schedule: new Set([
    'name', 'weekIndex', 'week', 'startSection', 'endSection', 'place',
    'teacher', 'className', 'color', 'date', 'title', 'emoji', 'time', 'completed'
  ]),
  note: new Set(['title', 'content', 'category', 'categoryIcon', 'categoryColor', 'isPinned']),
  album_folders: new Set(['name', 'description', 'coverFileID'])
})

const FILE_FIELDS = Object.freeze({
  moment: ['images'],
  diaries: ['imageUrl'],
  album: ['fileID'],
  album_folders: ['coverFileID'],
  companion_records: ['photo']
})

function codedError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function requiredString(value, max = 128) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw codedError('INVALID_PAYLOAD')
  }
  return value
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(value + 'T00:00:00.000Z')
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function validUpdateValue(collection, key, value) {
  if (key === 'completed' || key === 'isPinned') return typeof value === 'boolean'
  if (key === 'weekIndex') return Number.isInteger(value) && value >= 0 && value <= 6
  if (key === 'startSection' || key === 'endSection') return Number.isInteger(value) && value >= 1 && value <= 20
  if (key === 'date') return validDate(value)
  if (typeof value !== 'string') return false
  const limits = {
    title: 100, name: 100, content: 5000, description: 500,
    place: 200, teacher: 100, className: 100, time: 20,
    emoji: 20, color: 50, week: 20, category: 50,
    categoryIcon: 20, categoryColor: 50, coverFileID: 2048
  }
  return value.length <= (limits[key] || (collection === 'note' ? 5000 : 200))
}

function extractFileIDs(document, collection) {
  const result = new Set()
  const add = value => {
    if (Array.isArray(value)) {
      value.forEach(add)
    } else if (typeof value === 'string' && value) {
      result.add(value)
    }
  }
  for (const field of FILE_FIELDS[collection] || []) add(document && document[field])
  return [...result]
}

class SharedDataService {
  constructor({ repository, now = () => new Date(), randomBytes = crypto.randomBytes }) {
    this.repository = repository
    this.now = now
    this.randomBytes = randomBytes
  }

  async execute(action, openid, payload = {}) {
    if (!openid) throw codedError('NOT_AUTHENTICATED')
    if (!isPlainObject(payload)) throw codedError('INVALID_PAYLOAD')
    const handlers = {
      deleteOwnedRecord: () => this.deleteOwnedRecord(openid, payload),
      updateSharedRecord: () => this.updateSharedRecord(openid, payload),
      deleteAlbumFolder: () => this.deleteAlbumFolder(openid, payload),
      saveCheckin: () => this.saveCheckin(openid, payload),
      mutateGoalTask: () => this.mutateGoalTask(openid, payload),
      toggleMomentLike: () => this.toggleMomentLike(openid, payload),
      addMomentComment: () => this.addMomentComment(openid, payload),
      deleteMomentComment: () => this.deleteMomentComment(openid, payload),
      waterTree: () => this.waterTree(openid),
      getFileUrls: () => this.getFileUrls(openid, payload)
    }
    if (!handlers[action]) throw codedError('INVALID_ACTION')
    return handlers[action]()
  }

  async requireActive(openid) {
    const user = await this.repository.getUser(openid)
    if (!user || user.relationshipStatus !== 'active' || !user.coupleId) {
      throw codedError('RELATIONSHIP_NOT_FOUND')
    }
    const couple = await this.repository.getCouple(user.coupleId)
    if (!couple || couple.status !== 'active' || !Array.isArray(couple.memberOpenids) ||
        !couple.memberOpenids.includes(openid)) {
      throw codedError('RELATIONSHIP_NOT_FOUND')
    }
    return { user, couple, coupleId: couple._id }
  }

  async requireRecord(collection, id, coupleId) {
    const document = await this.repository.getRecord(collection, id)
    if (!document || document.coupleId !== coupleId) throw codedError('FORBIDDEN')
    return document
  }

  async deleteOwnedRecord(openid, payload) {
    const collection = requiredString(payload.collection, 40)
    const id = requiredString(payload.id)
    if (!DELETE_COLLECTIONS.has(collection)) throw codedError('FORBIDDEN')
    const context = await this.requireActive(openid)
    const document = await this.requireRecord(collection, id, context.coupleId)
    if (document.authorOpenid !== openid) throw codedError('FORBIDDEN')

    const removed = await this.repository.removeOwnedRecord({
      collection, id, openid, coupleId: context.coupleId
    })
    const fileIDs = extractFileIDs(removed || document, collection)
    let files = []
    if (fileIDs.length) {
      try {
        files = await this.repository.deleteFiles(fileIDs)
      } catch (error) {
        files = fileIDs.map(fileID => ({ fileID, ok: false }))
      }
    }
    return { deleted: true, id, files }
  }

  async updateSharedRecord(openid, payload) {
    const collection = requiredString(payload.collection, 40)
    const id = requiredString(payload.id)
    const fields = payload.fields
    const allowlist = UPDATE_FIELDS[collection]
    if (!allowlist || !isPlainObject(fields) || Object.keys(fields).length === 0) {
      throw codedError('INVALID_PAYLOAD')
    }
    if (Object.keys(fields).some(key => !allowlist.has(key))) throw codedError('FORBIDDEN')
    if (Object.entries(fields).some(([key, value]) => !validUpdateValue(collection, key, value))) {
      throw codedError('INVALID_PAYLOAD')
    }

    const context = await this.requireActive(openid)
    await this.requireRecord(collection, id, context.coupleId)
    return this.repository.updateSharedRecord({
      collection, id, openid, coupleId: context.coupleId,
      fields, updatedAt: this.now()
    })
  }

  async deleteAlbumFolder(openid, payload) {
    const id = requiredString(payload.id)
    const context = await this.requireActive(openid)
    const folder = await this.requireRecord('album_folders', id, context.coupleId)
    if (folder.authorOpenid !== openid) throw codedError('FORBIDDEN')
    const photos = await this.repository.listAlbumPhotos(context.coupleId, id)
    if (photos.length) throw codedError('FORBIDDEN')

    await this.repository.removeAlbumFolder({
      openid, coupleId: context.coupleId, folderId: id
    })
    const fileIDs = extractFileIDs(folder, 'album_folders')
    const files = fileIDs.length ? await this.repository.deleteFiles([...new Set(fileIDs)]) : []
    return { deleted: true, id, files }
  }

  checkinId(coupleId, openid, date) {
    const digest = crypto.createHash('sha256').update(coupleId + '\0' + openid + '\0' + date).digest('hex')
    return 'ck_' + digest.slice(0, 32)
  }

  async saveCheckin(openid, payload) {
    const statuses = new Set(['together', 'apart', 'date', 'dinner', 'movie', 'travel', 'shopping', 'sport'])
    const emotions = new Set(['', 'love', 'happy', 'miss_you', 'grateful', 'excited', 'calm', 'touched', 'sweet'])
    const date = requiredString(payload.date, 10)
    const status = requiredString(payload.status, 20)
    const emotion = payload.emotion || ''
    const note = typeof payload.note === 'string' ? payload.note.trim() : ''
    const place = typeof payload.place === 'string' ? payload.place.trim() : ''
    const photo = typeof payload.photo === 'string' ? payload.photo : ''
    if (!validDate(date) || date > this.now().toISOString().slice(0, 10) || !statuses.has(status) ||
        !emotions.has(emotion) || note.length > 1000 || place.length > 200 || photo.length > 2048) {
      throw codedError('INVALID_PAYLOAD')
    }

    const context = await this.requireActive(openid)
    if (photo && !photo.includes('/couples/' + context.coupleId + '/')) throw codedError('FORBIDDEN')
    const partnerOpenid = context.couple.memberOpenids.find(member => member !== openid)
    if (!partnerOpenid) throw codedError('RELATIONSHIP_NOT_FOUND')
    const role = context.couple.user1Openid === openid ? 'user1' : 'user2'
    const now = this.now()
    const record = {
      coupleId: context.coupleId,
      date,
      status,
      emotion,
      note,
      place,
      photo,
      authorOpenid: openid,
      authorName: context.couple[role + 'Name'] || '我',
      createTime: now.getTime(),
      updateTime: now.getTime()
    }
    return this.repository.saveCheckin({
      openid,
      partnerOpenid,
      coupleId: context.coupleId,
      checkinId: this.checkinId(context.coupleId, openid, date),
      partnerCheckinId: this.checkinId(context.coupleId, partnerOpenid, date),
      record,
      now
    })
  }

  async mutateGoalTask(openid, payload) {
    const id = requiredString(payload.id)
    const operation = requiredString(payload.operation, 10)
    if (!['add', 'toggle', 'delete'].includes(operation)) throw codedError('INVALID_PAYLOAD')
    const context = await this.requireActive(openid)
    await this.requireRecord('goals', id, context.coupleId)
    const text = operation === 'add' ? requiredString(payload.text, 300).trim() : ''
    const taskId = operation === 'add' ? '' : requiredString(payload.taskId)
    return this.repository.mutateGoalTask({
      openid,
      coupleId: context.coupleId,
      id,
      operation,
      taskId,
      text,
      newTaskId: operation === 'add' ? 'task_' + this.randomBytes(8).toString('hex') : '',
      updatedAt: this.now()
    })
  }

  async toggleMomentLike(openid, payload) {
    const id = requiredString(payload.id)
    const context = await this.requireActive(openid)
    await this.requireRecord('moment', id, context.coupleId)
    return this.repository.toggleMomentLike({ openid, coupleId: context.coupleId, id, updatedAt: this.now() })
  }

  async addMomentComment(openid, payload) {
    const id = requiredString(payload.id)
    const content = requiredString(payload.content, 500).trim()
    const context = await this.requireActive(openid)
    await this.requireRecord('moment', id, context.coupleId)
    const role = context.couple.user1Openid === openid ? 'user1' : 'user2'
    const now = this.now()
    const comment = {
      id: 'comment_' + this.randomBytes(8).toString('hex'),
      authorOpenid: openid,
      authorName: context.couple[role + 'Name'] || '我',
      content,
      createTime: now.getTime()
    }
    return this.repository.addMomentComment({
      openid, coupleId: context.coupleId, id, comment, updatedAt: now
    })
  }

  async deleteMomentComment(openid, payload) {
    const id = requiredString(payload.id)
    const commentId = requiredString(payload.commentId)
    const context = await this.requireActive(openid)
    await this.requireRecord('moment', id, context.coupleId)
    return this.repository.deleteMomentComment({
      openid, coupleId: context.coupleId, id, commentId, updatedAt: this.now()
    })
  }

  async waterTree(openid) {
    const context = await this.requireActive(openid)
    return this.repository.waterTree({ openid, coupleId: context.coupleId, updatedAt: this.now() })
  }

  async getFileUrls(openid, payload) {
    if (!Array.isArray(payload.fileIDs) || payload.fileIDs.length === 0 || payload.fileIDs.length > 50) {
      throw codedError('INVALID_PAYLOAD')
    }
    const context = await this.requireActive(openid)
    const fileIDs = [...new Set(payload.fileIDs)]
    if (fileIDs.some(fileID => typeof fileID !== 'string' || fileID.length > 2048 ||
      !fileID.includes('/couples/' + context.coupleId + '/'))) {
      throw codedError('FORBIDDEN')
    }
    return this.repository.getTempFileUrls(fileIDs)
  }
}

module.exports = {
  SharedDataService,
  DELETE_COLLECTIONS,
  UPDATE_FIELDS,
  FILE_FIELDS,
  codedError,
  extractFileIDs
}
const crypto = require('node:crypto')
