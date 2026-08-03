const SHARED_COLLECTIONS = Object.freeze([
  'moment', 'diaries', 'letter', 'album', 'album_folders',
  'money', 'cost', 'note', 'schedule', 'goals',
  'companion_records', 'couple_tree'
])

const FILE_FIELDS = Object.freeze({
  moment: ['images'],
  diaries: ['imageUrl'],
  album: ['fileID'],
  album_folders: ['coverFileID'],
  companion_records: ['photo']
})

function addFileIDs(target, value) {
  if (Array.isArray(value)) {
    for (const item of value) addFileIDs(target, item)
    return
  }
  if (typeof value === 'string' && value) target.add(value)
}

function isFileNotFound(error) {
  const code = error && (error.code || error.errCode || error.status)
  return code === 'FILE_NOT_FOUND' || code === 'STORAGE_FILE_NOT_FOUND' ||
    /file\s*(not\s*found|does\s*not\s*exist)|文件不存在/i.test(error && error.message ? error.message : '')
}

async function cleanupRelationship(repository, coupleId) {
  const fileIDs = new Set()

  for (const collection of SHARED_COLLECTIONS) {
    const records = await repository.listSharedRecords(collection, coupleId)
    for (const record of records) {
      for (const field of FILE_FIELDS[collection] || []) addFileIDs(fileIDs, record[field])
    }
  }

  let filesDeleted = 0
  for (const fileID of fileIDs) {
    try {
      await repository.deleteFile(fileID)
      filesDeleted += 1
    } catch (error) {
      if (!isFileNotFound(error)) throw error
    }
  }

  let recordsDeleted = 0
  for (const collection of SHARED_COLLECTIONS) {
    recordsDeleted += Number(await repository.removeSharedRecords(collection, coupleId)) || 0
  }

  await repository.removeRelationship(coupleId)
  return { recordsDeleted, filesDeleted }
}

async function cleanupExpired(repository, now) {
  const relationships = (await repository.listExpiredArchived(now, 20)).slice(0, 20)
  const counts = { relationshipsPurged: 0, recordsDeleted: 0, filesDeleted: 0 }

  for (const relationship of relationships) {
    const result = await cleanupRelationship(repository, relationship._id)
    counts.relationshipsPurged += 1
    counts.recordsDeleted += result.recordsDeleted
    counts.filesDeleted += result.filesDeleted
  }

  return counts
}

module.exports = {
  SHARED_COLLECTIONS,
  FILE_FIELDS,
  cleanupExpired
}
