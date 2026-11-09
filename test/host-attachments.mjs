/**
 * Host attachment API smoke test: upload a pasted image into the vault and read
 * it back through the file route, including the rejection paths.
 *
 * Run: node test/host-attachments.mjs
 */
import { createServer } from 'node:http'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { apply } from '../index.js'

const here = dirname(fileURLToPath(import.meta.url))
const vault = join(here, '.tmp-attach-vault')
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

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

await rm(vault, { recursive: true, force: true })
await mkdir(join(vault, '笔记'), { recursive: true })
await writeFile(join(vault, '笔记', 'a.md'), '# a\n')
await mkdir(join(vault, '.obsidian'), { recursive: true })
await writeFile(join(vault, '.obsidian', 'app.json'), '{}')

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

apply(ctx, { vaultPath: vault, attachmentDir: '附件', maxAttachmentBytes: 4096 })

async function post(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  return { status: response.status, json: await response.json().catch(() => null) }
}
async function get(path) {
  const response = await fetch(`${base}${path}`)
  return { status: response.status, json: await response.json().catch(() => null) }
}
async function getRaw(path) {
  const response = await fetch(`${base}${path}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  return { status: response.status, type: response.headers.get('content-type'), buffer }
}

try {
  let upload = null
  await check('POST /api/upload stores an image in the attachment folder', async () => {
    const result = await post('/api/upload', { name: 'shot.png', data: PNG.toString('base64') })
    assert(result.status === 200, `status ${result.status}`)
    assert(result.json.ok === true, JSON.stringify(result.json))
    assert(result.json.path === '附件/shot.png', `path was ${String(result.json.path)}`)
    assert(result.json.bytes === PNG.length, `bytes was ${String(result.json.bytes)}`)
    upload = result.json
    return result.json.path
  })

  await check('GET /api/file serves the exact bytes with the image type', async () => {
    const result = await getRaw(`/api/file?path=${encodeURIComponent(upload.path)}`)
    assert(result.status === 200, `status ${result.status}`)
    assert(result.type === 'image/png', `content-type was ${String(result.type)}`)
    assert(result.buffer.equals(PNG), 'served bytes differ from the uploaded bytes')
    return `${result.buffer.length} bytes`
  })

  await check('uploading the same name twice keeps both files', async () => {
    const again = await post('/api/upload', { name: 'shot.png', data: PNG.toString('base64') })
    assert(again.status === 200, `status ${again.status}`)
    assert(again.json.path !== upload.path, 'the second upload overwrote the first')
    const stored = await readFile(join(vault, again.json.path))
    assert(stored.equals(PNG), 'the second file was not written')
    return again.json.path
  })

  await check('a traversal name is stored inside the attachment folder', async () => {
    const result = await post('/api/upload', { name: '../../escape.png', data: PNG.toString('base64') })
    assert(result.status === 200, `status ${result.status}`)
    assert(result.json.path.startsWith('附件/'), `path was ${String(result.json.path)}`)
    assert(!result.json.path.includes('..'), 'the stored path contains a traversal segment')
    return result.json.path
  })

  await check('unsupported attachment types are refused', async () => {
    const result = await post('/api/upload', { name: 'note.txt', data: 'aGVsbG8=' })
    assert(result.status === 400, `status ${result.status}`)
    assert(result.json.ok === false, JSON.stringify(result.json))
    return result.json.code
  })

  await check('oversized attachments are refused', async () => {
    const big = Buffer.alloc(5000, 1)
    const result = await post('/api/upload', { name: 'big.png', data: big.toString('base64') })
    assert(result.status === 400, `status ${result.status}`)
    assert(result.json.code === 'attachment_too_large', JSON.stringify(result.json))
    return result.json.code
  })

  await check('GET /api/config exposes the template and attachment folders', async () => {
    const result = await get('/api/config')
    assert(result.status === 200, `status ${result.status}`)
    assert(result.json.ok === true, JSON.stringify(result.json))
    assert(result.json.templateDir === '模板', JSON.stringify(result.json))
    assert(result.json.attachmentDir === '附件', JSON.stringify(result.json))
    return 'config route'
  })

  await check('GET /api/file rejects a traversal path', async () => {
    const result = await getRaw('/api/file?path=../../etc/passwd')
    assert(result.status === 400, `status ${result.status}`)
    return 'rejected'
  })

  await check('GET /api/file refuses a Markdown note', async () => {
    const result = await getRaw(`/api/file?path=${encodeURIComponent('笔记/a.md')}`)
    assert(result.status === 400, `status ${result.status}`)
    return 'rejected'
  })

  await check('GET /api/file refuses internal folders', async () => {
    const response = await fetch(`${base}/api/file?path=${encodeURIComponent('.obsidian/app.json')}`)
    assert(response.status === 400, `status ${response.status}`)
    return 'rejected'
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
