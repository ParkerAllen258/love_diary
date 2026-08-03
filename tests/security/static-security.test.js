const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const RELATIONSHIP_PAGES = [
  'pages/mine/mine.js',
  'pages/index/index.js',
  'pages/anniversary/anniversary.js',
  'pages/companion/companion.js',
  'pages/moment/moment.js',
  'pages/schedule/schedule.js'
]
const RELATIONSHIP_COLLECTION_WRITE = /collection\(['"](?:users|couple|coupleRequest)['"]\)[\s\S]{0,300}?\.(?:add|update|remove)\(/

test('runtime pages do not write relationship collections directly', () => {
  const offenders = RELATIONSHIP_PAGES.filter(file => {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8')
    return RELATIONSHIP_COLLECTION_WRITE.test(source)
  })
  assert.deepEqual(offenders, [])
})

test('feature pages that mutate couple metadata use the relationship API', () => {
  for (const file of RELATIONSHIP_PAGES.slice(1)) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8')
    assert.match(source, /callRelationship/, file)
    assert.match(source, /getCoupleId/, file)
  }
})

// ==================== Task 7: legacy couplePair access-key removal ====================

// Scan all runtime *.js files recursively under pages/ and utils/.
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

const RUNTIME_FILES = listRuntimeJs(path.join(ROOT, 'pages'))
  .concat(listRuntimeJs(path.join(ROOT, 'utils')))
  .filter(f => !f.includes(path.join('tests')))

const SHARED_COLLECTIONS = [
  'moment', 'diaries', 'letter', 'album', 'album_folders',
  'money', 'cost', 'note', 'schedule', 'goals',
  'companion_records', 'couple_tree'
]

test('runtime code under pages/ and utils/ contains no couplePair literal', () => {
  const offenders = RUNTIME_FILES.filter(f => {
    const src = fs.readFileSync(f, 'utf8')
    return src.includes('couplePair')
  }).map(f => path.relative(ROOT, f))
  assert.deepEqual(offenders, [], 'files still referencing couplePair: ' + offenders.join(', '))
})

test('runtime code does not sort myCode/partnerCode to build an access key', () => {
  const patterns = [
    /\[myCode,\s*partnerCode\]\.sort\(\)\.join/,
    /\[mc,\s*pc\]\.sort\(\)\.join/,
    /myCode && partnerCode\s*\?\s*\[myCode,\s*partnerCode\]\.sort\(\)\.join/
  ]
  const offenders = RUNTIME_FILES.filter(f => {
    const src = fs.readFileSync(f, 'utf8')
    return patterns.some(re => re.test(src))
  }).map(f => path.relative(ROOT, f))
  assert.deepEqual(offenders, [], 'files still constructing access keys: ' + offenders.join(', '))
})

test('every shared-collection .add( in runtime code references coupleId', () => {
  const offenders = []
  for (const f of RUNTIME_FILES) {
    const src = fs.readFileSync(f, 'utf8')
    for (const coll of SHARED_COLLECTIONS) {
      const re = new RegExp("collection\\(['\"]" + coll + "['\"]\\)[\\s\\S]{0,80}?\\.add\\(", 'g')
      let m
      while ((m = re.exec(src)) !== null) {
        const start = Math.max(0, m.index - 800)
        const end = Math.min(src.length, m.index + m[0].length + 1200)
        const block = src.slice(start, end)
        if (!/coupleId/.test(block)) {
          offenders.push(path.relative(ROOT, f) + ' (' + coll + ')')
        }
      }
    }
  }
  assert.deepEqual(offenders, [], 'shared-collection add() blocks missing coupleId: ' + offenders.join(', '))
})

test('runtime pages do not directly update or delete protected shared records', () => {
  const offenders = []
  for (const file of listRuntimeJs(path.join(ROOT, 'pages'))) {
    const source = fs.readFileSync(file, 'utf8')
    for (const collection of SHARED_COLLECTIONS) {
      const pattern = new RegExp(
        "collection\\(['\"]" + collection + "['\"]\\)[\\s\\S]{0,180}?\\.(?:update|remove)\\(",
        'g'
      )
      if (pattern.test(source)) offenders.push(path.relative(ROOT, file) + ' (' + collection + ')')
    }
  }
  assert.deepEqual(offenders, [], 'dangerous shared writes must use sharedDataService: ' + offenders.join(', '))
})

test('runtime ownership checks do not trust authorCode', () => {
  const patterns = [
    /authorCode\s*===/,
    /===\s*[^\n;]*authorCode/,
    /likedBy[^\n;]*myCode/,
    /wateredBy[^\n;]*myCode/
  ]
  const offenders = RUNTIME_FILES.filter(file => {
    const source = fs.readFileSync(file, 'utf8')
    return patterns.some(pattern => pattern.test(source))
  }).map(file => path.relative(ROOT, file))
  assert.deepEqual(offenders, [], 'ownership must use authorOpenid: ' + offenders.join(', '))
})

test('shared image pages resolve partner files through sharedDataService', () => {
  for (const file of [
    'pages/album/album.js', 'pages/companion/companion.js',
    'pages/diary/diary.js', 'pages/moment/moment.js'
  ]) {
    assert.match(fs.readFileSync(path.join(ROOT, file), 'utf8'), /resolveFileUrls/, file)
  }
})

test('data pages wait for authentication before reading relationship state', () => {
  for (const page of [
    'index', 'mine', 'album', 'anniversary', 'companion', 'cost', 'course',
    'diary', 'goals', 'letter', 'moment', 'money', 'note', 'schedule'
  ]) {
    const file = `pages/${page}/${page}.js`
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8')
    assert.match(source, /waitForAuth/, file)
    assert.match(source, /async onLoad\(\)[\s\S]{0,100}?await waitForAuth\(\)/, file)
    assert.match(source, /async onShow\(\)[\s\S]{0,100}?await waitForAuth\(\)/, file)
  }
})

test('local sprite chat never stores or transmits API keys', () => {
  const source = fs.readFileSync(path.join(ROOT, 'pages/sprite/sprite.js'), 'utf8')
  assert.doesNotMatch(source, /apiKey|deepseek|chatAI/i)
  assert.equal(fs.existsSync(path.join(ROOT, 'cloudfunctions/chatAI')), false)
})

test('OCR client does not display raw provider output or debug payloads', () => {
  const source = fs.readFileSync(path.join(ROOT, 'pages/course/course.js'), 'utf8')
  assert.doesNotMatch(source, /rawText|sampleJson|ocrKeys|result\.debug/)
  assert.match(source, /cloudPath:\s*'ocr\/'\s*\+\s*openid/)
})

// ==================== Task 8: documentation and deployment assertions ====================

const DOCS_DIR = path.join(ROOT, 'docs', 'cloudbase')
const SECURITY_RULES_PATH = path.join(DOCS_DIR, 'security-rules.md')
const DEPLOYMENT_CHECKLIST_PATH = path.join(DOCS_DIR, 'deployment-checklist.md')

test('security-rules.md exists and covers all required collections', () => {
  assert.ok(fs.existsSync(SECURITY_RULES_PATH), 'docs/cloudbase/security-rules.md must exist')
  const content = fs.readFileSync(SECURITY_RULES_PATH, 'utf8')

  // Core collections must be documented with rule templates
  const coreCollections = ['users', 'couple', 'coupleRequest', 'invite']
  for (const coll of coreCollections) {
    assert.match(content, new RegExp('### ' + coll), `security-rules.md must document ${coll}`)
  }

  // All 12 shared collections must have rule templates
  for (const coll of SHARED_COLLECTIONS) {
    assert.match(content, new RegExp('### ' + coll), `security-rules.md must document ${coll}`)
  }

  // Each rule must contain the essential pattern: coupleId matching against users
  const rulePattern = /doc\.coupleId\s*==\s*get\(`database\.users\.\$\{auth\.openid\}`\)\.coupleId/
  assert.ok(rulePattern.test(content), 'security-rules.md must include the coupleId access-control pattern')

  // Must document the create rule with authorOpenid check
  assert.match(content, /authorOpenid\s*==\s*auth\.openid/, 'security-rules.md must include authorOpenid creation check')

  assert.doesNotMatch(content, /"update":\s*"doc\.coupleId/, 'shared records must not be updated directly')
  assert.match(content, /"read":\s*"resource\.openid == auth\.openid"/, 'storage must be creator-readable only')
  assert.doesNotMatch(content, /resource\.path\.indexOf/, 'storage rules do not support indexOf')

  // Must warn about frontend queries requiring rule fields
  assert.match(content, /查询.*必须.*包含|coupleId.*查询条件|where.*coupleId/, 'security-rules.md must warn about query field requirements')
})

test('deployment-checklist.md exists and covers deployment steps', () => {
  assert.ok(fs.existsSync(DEPLOYMENT_CHECKLIST_PATH), 'docs/cloudbase/deployment-checklist.md must exist')
  const content = fs.readFileSync(DEPLOYMENT_CHECKLIST_PATH, 'utf8')

  // Must mention function deployment
  assert.match(content, /relationshipService/, 'deployment-checklist.md must cover relationshipService deployment')
  assert.match(content, /sharedDataService/, 'deployment-checklist.md must cover sharedDataService deployment')
  assert.match(content, /ocrSchedule/, 'deployment-checklist.md must cover ocrSchedule deployment')
  assert.match(content, /cleanupExpiredCouples/, 'deployment-checklist.md must cover cleanupExpiredCouples deployment')

  // Must cover indexes
  assert.match(content, /索引|index/, 'deployment-checklist.md must cover index creation')

  // Must cover timer setup
  assert.match(content, /定时|timer|Timer|trigger/, 'deployment-checklist.md must cover timer setup')

  // Must cover third-user denial testing
  assert.match(content, /第三人|第三个|third|账号 C|account C/i, 'deployment-checklist.md must cover third-user denial')

  // Must cover unbind verification
  assert.match(content, /解绑.*验证|unbind.*(verify|test|check)/i, 'deployment-checklist.md must cover unbind verification')

  // Must cover 30-day restore
  assert.match(content, /恢复.*30|30.*恢复|restore.*30|30.*restore/, 'deployment-checklist.md must cover 30-day restore')

  // Must cover purge/cleanup verification
  assert.match(content, /清理.*验证|purge.*(verify|test|check)|cleanup.*(verify|test|check)/i, 'deployment-checklist.md must cover purge verification')

  // Must cover all 12 shared collections in the collection list
  for (const coll of SHARED_COLLECTIONS) {
    assert.match(content, new RegExp(coll), `deployment-checklist.md must mention ${coll}`)
  }
})

test('regression checks cover relationship security invariants', () => {
  const regContent = fs.readFileSync(path.join(ROOT, 'scripts', 'regression_checks.js'), 'utf8')

  // Must check that relationshipService obtains OPENID from getWXContext
  assert.match(regContent, /relationshipService|getWXContext/,
    'regression checks must verify relationshipService OPENID sourcing')

  // Must verify Mine page has no direct relationship collection writes
  assert.match(regContent, /mine.*callRelationship|callRelationship.*mine/,
    'regression checks must verify Mine page routes through relationship service')

  // Must assert no couplePair in shared runtime code
  assert.match(regContent, /couplePair/,
    'regression checks must verify no couplePair legacy access key remains')

  // Must verify cleanup configuration includes all shared collections
  assert.match(regContent, /cleanup|SHARED_COLLECTIONS|shared.*collection/,
    'regression checks must verify cleanup configuration')
})
