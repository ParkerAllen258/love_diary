const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

const moment = read('pages/moment/moment.js')
assert(/coupleId:\s*getCoupleId\(\)/.test(moment), 'moment publish should save coupleId')
const publishBlock = moment.slice(moment.indexOf('  publish()'), moment.indexOf('  // ==================== 获取列表'))
assert(/wx\.showToast\(\{\s*title:\s*'发布失败'/.test(publishBlock), 'moment publish failure toast should say publish failed')

const course = read('pages/course/course.js')
assert(/authorOpenid\s*===\s*myOpenid/.test(course), 'course page should filter own courses by trusted openid')

const index = read('pages/index/index.js')
assert(/authorOpenid:\s*myOpenid/.test(index), 'home course widget should filter own courses by trusted openid')

const mine = read('pages/mine/mine.js')
assert(/callRelationship\('acceptRequest'/.test(mine), 'agreeRequest should route through relationship service')

const sprite = read('pages/sprite/sprite.js')
assert(!/messages\.push\(\{\s*role:\s*'user',\s*content:\s*userText\s*\}\)/.test(sprite), 'sprite AI should not duplicate the latest user message')

const auth = read('utils/auth.js')
assert(/bootstrapRelationship/.test(auth), 'auth should bootstrap through relationship service')

const album = read('pages/album/album.js')
assert(/collection\('album_folders'\)/.test(album), 'album folders should use cloud collection')
assert(/resolveFileUrls/.test(album), 'album page should resolve protected cloud files')

const gitignore = read('.gitignore')
assert(/node_modules/.test(gitignore), '.gitignore should ignore node_modules')
assert(/cloudfunctions\/\*\*\/node_modules/.test(gitignore), '.gitignore should ignore cloudfunction node_modules')

// ==================== Task 8: relationship security invariants ====================

// relationshipService obtains OPENID from getWXContext, not from client event
const relationshipServiceIndex = read('cloudfunctions/relationshipService/index.js')
assert(/getWXContext/.test(relationshipServiceIndex), 'relationshipService must use getWXContext for OPENID')
assert(!/event\.openid|event\.OPENID/.test(relationshipServiceIndex), 'relationshipService must not accept openid from event payload')

// cleanupExpiredCouples rejects client invocations
const cleanupIndex = read('cloudfunctions/cleanupExpiredCouples/index.js')
assert(/FORBIDDEN/.test(cleanupIndex), 'cleanupExpiredCouples must reject unauthorized calls')
assert(/Timer|timer|CLEANUP_TOKEN/.test(cleanupIndex), 'cleanupExpiredCouples must check timer context or token')

// No couplePair remains in any runtime code under pages/ or utils/
function listRuntimeJs(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...listRuntimeJs(full))
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(full)
    }
  }
  return out
}
const allRuntimeFiles = listRuntimeJs(path.join(root, 'pages'))
  .concat(listRuntimeJs(path.join(root, 'utils')))
for (const f of allRuntimeFiles) {
  const src = read(path.relative(root, f))
  assert(!src.includes('couplePair'), `${path.relative(root, f)} must not contain couplePair`)
}

// Cleanup module covers all 12 shared collections
const cleanup = read('cloudfunctions/cleanupExpiredCouples/lib/cleanup.js')
const SHARED_COLLECTIONS = [
  'moment', 'diaries', 'letter', 'album', 'album_folders',
  'money', 'cost', 'note', 'schedule', 'goals',
  'companion_records', 'couple_tree'
]
for (const coll of SHARED_COLLECTIONS) {
  assert(cleanup.includes(`'${coll}'`) || cleanup.includes(`"${coll}"`),
    `cleanup.js must include shared collection: ${coll}`)
}

// Security rules document exists and references all collections
const rulesDoc = read('docs/cloudbase/security-rules.md')
assert(rulesDoc.length > 500, 'security-rules.md must exist with substantive content')
for (const coll of SHARED_COLLECTIONS) {
  assert(rulesDoc.includes(coll), `security-rules.md must reference ${coll}`)
}
for (const coll of ['users', 'couple', 'coupleRequest', 'invite']) {
  assert(rulesDoc.includes(coll), `security-rules.md must reference ${coll}`)
}

// Deployment checklist exists and references both functions
const deployDoc = read('docs/cloudbase/deployment-checklist.md')
assert(deployDoc.length > 500, 'deployment-checklist.md must exist with substantive content')
assert(deployDoc.includes('relationshipService'), 'deployment-checklist.md must reference relationshipService')
assert(deployDoc.includes('sharedDataService'), 'deployment-checklist.md must reference sharedDataService')
assert(deployDoc.includes('ocrSchedule'), 'deployment-checklist.md must reference ocrSchedule')
assert(deployDoc.includes('cleanupExpiredCouples'), 'deployment-checklist.md must reference cleanupExpiredCouples')

// All shared page .add calls include authorOpenid (already enforced by static test,
// verify key pages explicitly)
const sharedPages = ['pages/moment/moment.js', 'pages/diary/diary.js', 'pages/letter/letter.js']
for (const pageFile of sharedPages) {
  let pageSrc
  try { pageSrc = read(pageFile) } catch (_) { continue }
  if (/\.add\(/.test(pageSrc)) {
    assert(/authorOpenid/.test(pageSrc), `${pageFile} .add() must include authorOpenid`)
  }
}

console.log('Regression checks passed')
