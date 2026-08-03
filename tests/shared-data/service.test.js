const test = require('node:test')
const assert = require('node:assert/strict')
const { SharedDataService } = require('../../cloudfunctions/sharedDataService/lib/service')

class MemoryRepository {
  constructor() {
    this.users = new Map()
    this.couples = new Map()
    this.documents = new Map()
    this.calls = []
  }

  key(collection, id) { return collection + '/' + id }
  async getUser(openid) { return this.users.get(openid) || null }
  async getCouple(id) { return this.couples.get(id) || null }
  async getRecord(collection, id) { return this.documents.get(this.key(collection, id)) || null }
  async listAlbumPhotos(coupleId, albumId) {
    return [...this.documents.values()].filter(item => item.collection === 'album' && item.coupleId === coupleId && item.albumId === albumId)
  }

  async removeOwnedRecord({ collection, id }) {
    this.calls.push(['remove', collection, id])
    const key = this.key(collection, id)
    const document = this.documents.get(key)
    this.documents.delete(key)
    return document
  }

  async deleteFiles(fileIDs) {
    this.calls.push(['files', fileIDs.slice()])
    return fileIDs.map(fileID => ({ fileID, ok: true }))
  }

  async updateSharedRecord({ collection, id, fields }) {
    this.calls.push(['update', collection, id, fields])
    const key = this.key(collection, id)
    const saved = { ...this.documents.get(key), ...fields }
    this.documents.set(key, saved)
    return saved
  }

  async removeAlbumFolder({ folderId }) {
    this.calls.push(['folder', folderId])
    this.documents.delete(this.key('album_folders', folderId))
  }

  async saveCheckin({ record, checkinId, partnerCheckinId, coupleId }) {
    this.calls.push(['checkin', checkinId])
    this.documents.set(this.key('companion_records', checkinId), { ...record, _id: checkinId })
    const partner = this.documents.get(this.key('companion_records', partnerCheckinId))
    const treeKey = this.key('couple_tree', coupleId)
    const tree = this.documents.get(treeKey) || {
      _id: coupleId, collection: 'couple_tree', coupleId,
      totalGrowth: 0, streak: 0, lastGrowDate: '', wateredByOpenids: []
    }
    let grew = false
    if (partner && tree.lastGrowDate !== record.date) {
      tree.totalGrowth += 15
      tree.streak += 1
      tree.lastGrowDate = record.date
      tree.wateredByOpenids = []
      grew = true
    }
    this.documents.set(treeKey, tree)
    return { record: this.documents.get(this.key('companion_records', checkinId)), tree, grew }
  }

  async mutateGoalTask({ id, operation, taskId, text, newTaskId }) {
    const key = this.key('goals', id)
    const goal = this.documents.get(key)
    const tasks = (goal.tasks || []).map(task => ({ ...task }))
    if (operation === 'add') tasks.push({ id: newTaskId, text, done: false })
    if (operation === 'toggle') {
      const task = tasks.find(item => item.id === taskId)
      if (!task) throw Object.assign(new Error('INVALID_PAYLOAD'), { code: 'INVALID_PAYLOAD' })
      task.done = !task.done
    }
    if (operation === 'delete') {
      const index = tasks.findIndex(item => item.id === taskId)
      if (index < 0) throw Object.assign(new Error('INVALID_PAYLOAD'), { code: 'INVALID_PAYLOAD' })
      tasks.splice(index, 1)
    }
    const saved = { ...goal, tasks }
    this.documents.set(key, saved)
    return saved
  }

  async toggleMomentLike({ id, openid }) {
    const key = this.key('moment', id)
    const moment = this.documents.get(key)
    const likedByOpenids = (moment.likedByOpenids || []).filter(Boolean)
    const index = likedByOpenids.indexOf(openid)
    if (index >= 0) likedByOpenids.splice(index, 1)
    else likedByOpenids.push(openid)
    const saved = { ...moment, likedByOpenids, likes: likedByOpenids.length }
    this.documents.set(key, saved)
    return saved
  }

  async addMomentComment({ id, comment }) {
    const key = this.key('moment', id)
    const moment = this.documents.get(key)
    const saved = { ...moment, comments: [...(moment.comments || []), comment] }
    this.documents.set(key, saved)
    return comment
  }

  async deleteMomentComment({ id, commentId, openid }) {
    const key = this.key('moment', id)
    const moment = this.documents.get(key)
    const comment = (moment.comments || []).find(item => item.id === commentId)
    if (!comment || comment.authorOpenid !== openid) {
      throw Object.assign(new Error('FORBIDDEN'), { code: 'FORBIDDEN' })
    }
    const saved = { ...moment, comments: moment.comments.filter(item => item.id !== commentId) }
    this.documents.set(key, saved)
    return { deleted: true }
  }

  async waterTree({ coupleId, openid }) {
    const key = this.key('couple_tree', coupleId)
    const tree = this.documents.get(key) || {
      _id: coupleId, collection: 'couple_tree', coupleId,
      totalGrowth: 0, streak: 0, lastGrowDate: '', wateredByOpenids: []
    }
    if (!tree.wateredByOpenids.includes(openid)) {
      tree.wateredByOpenids.push(openid)
      tree.totalGrowth += 5
    }
    this.documents.set(key, tree)
    return tree
  }

  async getTempFileUrls(fileIDs) {
    this.calls.push(['urls', fileIDs.slice()])
    return fileIDs.map(fileID => ({ fileID, tempFileURL: 'https://temp.example/' + encodeURIComponent(fileID) }))
  }
}

function harness() {
  const repository = new MemoryRepository()
  repository.users.set('alice', { _id: 'alice', relationshipStatus: 'active', coupleId: 'cp_1' })
  repository.users.set('bob', { _id: 'bob', relationshipStatus: 'active', coupleId: 'cp_1' })
  repository.couples.set('cp_1', {
    _id: 'cp_1', status: 'active', memberOpenids: ['alice', 'bob'],
    user1Openid: 'alice', user2Openid: 'bob'
  })
  return { repository, service: new SharedDataService({ repository, now: () => new Date('2026-08-03T00:00:00.000Z') }) }
}

async function expectCode(operation, code) {
  await assert.rejects(operation, error => {
    assert.equal(error.code, code)
    return true
  })
}

test('deleteOwnedRecord rejects a partner and preserves the record', async () => {
  const { repository, service } = harness()
  repository.documents.set('moment/m1', {
    _id: 'm1', collection: 'moment', coupleId: 'cp_1', authorOpenid: 'alice', images: []
  })

  await expectCode(
    () => service.execute('deleteOwnedRecord', 'bob', { collection: 'moment', id: 'm1' }),
    'FORBIDDEN'
  )
  assert.equal(repository.documents.has('moment/m1'), true)
})

test('deleteOwnedRecord removes the database record before deleting its files', async () => {
  const { repository, service } = harness()
  repository.documents.set('moment/m1', {
    _id: 'm1', collection: 'moment', coupleId: 'cp_1', authorOpenid: 'alice',
    images: ['cloud://env/couples/cp_1/moment/a.png']
  })

  const result = await service.execute('deleteOwnedRecord', 'alice', {
    collection: 'moment', id: 'm1', fileIDs: ['cloud://forged']
  })
  assert.equal(result.deleted, true)
  assert.deepEqual(repository.calls, [
    ['remove', 'moment', 'm1'],
    ['files', ['cloud://env/couples/cp_1/moment/a.png']]
  ])
})

test('updateSharedRecord allows both members but only allowlisted fields', async () => {
  const { repository, service } = harness()
  repository.documents.set('note/n1', {
    _id: 'n1', collection: 'note', coupleId: 'cp_1', authorOpenid: 'alice', title: '旧标题', content: '内容'
  })

  const saved = await service.execute('updateSharedRecord', 'bob', {
    collection: 'note', id: 'n1', fields: { title: '共同修改', isPinned: true }
  })
  assert.equal(saved.title, '共同修改')
  await expectCode(
    () => service.execute('updateSharedRecord', 'bob', {
      collection: 'note', id: 'n1', fields: { authorOpenid: 'bob' }
    }),
    'FORBIDDEN'
  )
})

test('deleteAlbumFolder rejects folders containing partner photos', async () => {
  const { repository, service } = harness()
  repository.documents.set('album_folders/f1', {
    _id: 'f1', collection: 'album_folders', coupleId: 'cp_1', authorOpenid: 'alice'
  })
  repository.documents.set('album/p1', {
    _id: 'p1', collection: 'album', albumId: 'f1', coupleId: 'cp_1', authorOpenid: 'bob', fileID: 'cloud://partner'
  })

  await expectCode(() => service.execute('deleteAlbumFolder', 'alice', { id: 'f1' }), 'FORBIDDEN')
  assert.equal(repository.documents.has('album_folders/f1'), true)
  assert.equal(repository.documents.has('album/p1'), true)
})

test('deleteAlbumFolder requires the creator to empty it first', async () => {
  const { repository, service } = harness()
  repository.documents.set('album_folders/f1', {
    _id: 'f1', collection: 'album_folders', coupleId: 'cp_1', authorOpenid: 'alice'
  })
  repository.documents.set('album/p1', {
    _id: 'p1', collection: 'album', albumId: 'f1', coupleId: 'cp_1', authorOpenid: 'alice'
  })

  await expectCode(() => service.execute('deleteAlbumFolder', 'alice', { id: 'f1' }), 'FORBIDDEN')
  assert.equal(repository.documents.has('album_folders/f1'), true)
})

test('inactive users cannot read or mutate shared data through the service', async () => {
  const { repository, service } = harness()
  repository.users.set('carol', { _id: 'carol', relationshipStatus: 'single', coupleId: null })
  await expectCode(
    () => service.execute('deleteOwnedRecord', 'carol', { collection: 'moment', id: 'm1' }),
    'RELATIONSHIP_NOT_FOUND'
  )
})

test('saveCheckin overwrites one deterministic record and grows the tree once', async () => {
  const { repository, service } = harness()
  const alice = { date: '2026-08-03', status: 'together', emotion: 'happy', note: '第一次', place: '', photo: '' }
  const bob = { date: '2026-08-03', status: 'date', emotion: 'love', note: '', place: '', photo: '' }

  const first = await service.execute('saveCheckin', 'alice', alice)
  const replacement = await service.execute('saveCheckin', 'alice', { ...alice, note: '修改后' })
  assert.equal(first.record._id, replacement.record._id)
  assert.equal(replacement.record.note, '修改后')
  assert.equal([...repository.documents.keys()].filter(key => key.startsWith('companion_records/')).length, 1)

  const completed = await service.execute('saveCheckin', 'bob', bob)
  assert.equal(completed.grew, true)
  assert.equal(completed.tree.totalGrowth, 15)
  const repeated = await service.execute('saveCheckin', 'bob', { ...bob, note: '再次修改' })
  assert.equal(repeated.grew, false)
  assert.equal(repeated.tree.totalGrowth, 15)
})

test('waterTree records each trusted openid once', async () => {
  const { service } = harness()
  const first = await service.execute('waterTree', 'alice', {})
  const second = await service.execute('waterTree', 'alice', {})
  assert.equal(first.totalGrowth, 5)
  assert.equal(second.totalGrowth, 5)
  assert.deepEqual(second.wateredByOpenids, ['alice'])
})

test('goal task mutations use server-generated task identities', async () => {
  const { repository, service } = harness()
  repository.documents.set('goals/g1', {
    _id: 'g1', collection: 'goals', coupleId: 'cp_1', authorOpenid: 'alice', tasks: []
  })

  const added = await service.execute('mutateGoalTask', 'bob', { id: 'g1', operation: 'add', text: '共同完成' })
  const taskId = added.tasks[0].id
  assert.match(taskId, /^task_[a-f0-9]{16}$/)
  const toggled = await service.execute('mutateGoalTask', 'alice', { id: 'g1', operation: 'toggle', taskId })
  assert.equal(toggled.tasks[0].done, true)
  const removed = await service.execute('mutateGoalTask', 'bob', { id: 'g1', operation: 'delete', taskId })
  assert.deepEqual(removed.tasks, [])
})

test('moment likes and comments use trusted openid identities', async () => {
  const { repository, service } = harness()
  repository.documents.set('moment/m1', {
    _id: 'm1', collection: 'moment', coupleId: 'cp_1', authorOpenid: 'alice',
    likedByOpenids: [], comments: []
  })

  const liked = await service.execute('toggleMomentLike', 'bob', { id: 'm1', openid: 'forged' })
  assert.deepEqual(liked.likedByOpenids, ['bob'])
  const comment = await service.execute('addMomentComment', 'bob', { id: 'm1', content: '真好', authorOpenid: 'forged' })
  assert.equal(comment.authorOpenid, 'bob')
  await expectCode(
    () => service.execute('deleteMomentComment', 'alice', { id: 'm1', commentId: comment.id }),
    'FORBIDDEN'
  )
  const deleted = await service.execute('deleteMomentComment', 'bob', { id: 'm1', commentId: comment.id })
  assert.equal(deleted.deleted, true)
})

test('getFileUrls accepts only files under the active couple path', async () => {
  const { service } = harness()
  const own = 'cloud://env/couples/cp_1/moment/a.png'
  const result = await service.execute('getFileUrls', 'bob', { fileIDs: [own] })
  assert.equal(result[0].fileID, own)
  await expectCode(
    () => service.execute('getFileUrls', 'bob', { fileIDs: ['cloud://env/couples/cp_other/moment/a.png'] }),
    'FORBIDDEN'
  )
})
