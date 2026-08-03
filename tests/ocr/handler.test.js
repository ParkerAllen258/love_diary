const test = require('node:test')
const assert = require('node:assert/strict')
const { handleOcr } = require('../../cloudfunctions/ocrSchedule/lib/handler')

test('OCR returns only parsed courses and always deletes its temporary image', async () => {
  const deleted = []
  const fileID = 'cloud://env/ocr/alice/table.png'
  const result = await handleOcr({
    fileID,
    openid: 'alice',
    async recognize() { return { items: [{ text: '数学 周一 08:00-08:45', secret: 'raw' }] } },
    parse() { return [{ name: '数学', weekIndex: 0, startSection: 1, endSection: 1 }] },
    async deleteFile(id) { deleted.push(id) }
  })

  assert.deepEqual(result, {
    ok: true,
    courses: [{ name: '数学', weekIndex: 0, startSection: 1, endSection: 1 }]
  })
  assert.deepEqual(deleted, [fileID])
  assert.equal(JSON.stringify(result).includes('raw'), false)
})

test('OCR hides provider errors and still deletes the temporary image', async () => {
  const deleted = []
  const result = await handleOcr({
    fileID: 'cloud://env/ocr/alice/table.png',
    openid: 'alice',
    async recognize() { throw new Error('provider secret') },
    parse() { return [] },
    async deleteFile(id) { deleted.push(id) }
  })

  assert.equal(result.ok, false)
  assert.equal(JSON.stringify(result).includes('provider secret'), false)
  assert.equal(deleted.length, 1)
})
