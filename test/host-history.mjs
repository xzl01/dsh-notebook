/**
 * Host history API smoke test: each write keeps the previous content as a
 * snapshot, the snapshots list/read back, and a restore is just a write.
 *
 * Run: node test/host-history.mjs
 */
import { createServer } from 'node:http'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { apply } from '../index.js'

const here = dirname(fileURLToPath(import.meta.url))
const vault = join(here, '.tmp-history-vault')

let passed = 0
let failed = 0
async function check(name, operation) {
  try {
    const detail = await operation()
    passed += 1
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL  ${name}`)
    console.log(`      ${(error && error.message) || error}`)
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message)
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

await rm(vault, { recursive: true, force: true })
await mkdir(join(vault, '笔记'), { recursive: true })
await writeFile(join(vault, '笔记', 'a.md'), '# v1\n')

const disposers = []
let route = null
const ctx = {
  effect(callback) {
    const dispose = callback()
    if (typeof dispose === 'function') disposers.push(dispose)
    return () => {}
  },
  webServer: {
    getOrigin() {
      return origin
    },
    register(spec) {
      route = spec
      return () => {}
    },
  },
  tools: {
    register() {
      return () => {}
    },
  },
}

const server = createServer((req, res) => {
  if (route === null) {
    res.writeHead(503).end()
    return
  }
  route.handler(req, res)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const base = `${origin}/notebook`
apply(ctx, { vaultPath: vault })

async function api(path, options) {
  const response = await fetch(`${base}${path}`, options)
  return { status: response.status, json: await response.json().catch(() => null) }
}
async function post(path, body) {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
}
async function get(path) {
  return api(path)
}

try {
  await check('the first write keeps no history (nothing existed)', async () => {
    const result = await post('/api/write', { path: '笔记/a.md', content: '# v2\n' })
    assert(result.status === 200, `status ${result.status}`)
    const history = await get(`/api/history?path=${encodeURIComponent('笔记/a.md')}`)
    assert(history.json.ok === true, JSON.stringify(history.json))
    assert(history.json.entries.length === 1, `entries: ${history.json.entries.length}`)
    return '1 snapshot'
  })

  let latest = null
  await check('a second write adds another snapshot', async () => {
    await sleep(5)
    const result = await post('/api/write', { path: '笔记/a.md', content: '# v3\n' })
    assert(result.status === 200, `status ${result.status}`)
    const history = await get(`/api/history?path=${encodeURIComponent('笔记/a.md')}`)
    assert(history.json.entries.length === 2, `entries: ${history.json.entries.length}`)
    latest = history.json.entries[0]
    return `${history.json.entries.length} snapshots`
  })

  await check('the newest snapshot holds the previous content', async () => {
    const result = await get(
      `/api/history/note?path=${encodeURIComponent('笔记/a.md')}&id=${encodeURIComponent(latest.id)}`,
    )
    assert(result.status === 200, `status ${result.status}`)
    assert(result.json.content === '# v2\n', JSON.stringify(result.json.content))
    return 'v2 snapshot'
  })

  await check('snapshots are hidden from the note listing', async () => {
    const result = await get('/api/list')
    const paths = result.json.notes.map((note) => note.path)
    assert(paths.includes('笔记/a.md'), 'the note itself is missing')
    assert(!paths.some((path) => path.includes('.dsh-notebook-history')), 'history leaked into the listing')
    return 'hidden'
  })

  await check('restoring is just writing the snapshot back', async () => {
    const snapshot = await get(
      `/api/history/note?path=${encodeURIComponent('笔记/a.md')}&id=${encodeURIComponent(latest.id)}`,
    )
    const restored = await post('/api/write', {
      path: '笔记/a.md',
      content: snapshot.json.content,
    })
    assert(restored.status === 200, `status ${restored.status}`)
    const read = await get(`/api/read?path=${encodeURIComponent('笔记/a.md')}`)
    assert(read.json.content === '# v2\n', JSON.stringify(read.json.content))
    return 'restored v2'
  })

  await check('deleting a note keeps a final snapshot', async () => {
    await sleep(5)
    const before = await get(`/api/history?path=${encodeURIComponent('笔记/a.md')}`)
    const removed = await post('/api/delete', { path: '笔记/a.md' })
    assert(removed.status === 200, `status ${removed.status}`)
    const after = await get(`/api/history?path=${encodeURIComponent('笔记/a.md')}`)
    assert(after.json.entries.length === before.json.entries.length + 1, 'no snapshot on delete')
    return `${after.json.entries.length} snapshots`
  })

  await check('an invalid history id is rejected', async () => {
    const result = await get(
      `/api/history/note?path=${encodeURIComponent('笔记/a.md')}&id=${encodeURIComponent('../escape.md')}`,
    )
    assert(result.status === 400, `status ${result.status}`)
    return result.json.code
  })

  await check('history of a missing note is empty', async () => {
    const result = await get(`/api/history?path=${encodeURIComponent('笔记/none.md')}`)
    assert(result.status === 200, `status ${result.status}`)
    assert(Array.isArray(result.json.entries) && result.json.entries.length === 0, JSON.stringify(result.json))
    return 'empty'
  })
} finally {
  for (const dispose of disposers) {
    try {
      dispose()
    } catch {
      /* already gone */
    }
  }
  await new Promise((resolve) => server.close(resolve))
  await rm(vault, { recursive: true, force: true })
}

console.log('')
console.log(`SUMMARY: ${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
