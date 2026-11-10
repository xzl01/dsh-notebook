#!/usr/bin/env node
/**
 * Flash (闪念) service test.
 *
 * Boots the plugin against a throwaway vault, mounts its `/notebook` handler on
 * a real loopback server, and drives the capture/triage routes plus the agent
 * tool: zero-decision capture, frontmatter round-trip, filters, flags, random
 * resurfacing, and refusing paths outside the flash folder.
 *
 * Run: node test/host-flash.mjs
 */

import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const WORKSPACE = dirname(TEST_DIR)
const VAULT = join(TEST_DIR, '.tmp-flash-vault')
const FLASH_DIR = '碎片'

let passed = 0
let failed = 0
const failures = []

async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`PASS  ${name}`)
  } catch (error) {
    failed += 1
    failures.push({ name, error })
    const detail = error instanceof Error ? (error.message || error.stack) : String(error)
    console.log(`FAIL  ${name}\n      ${detail.split('\n').join('\n      ')}`)
  }
}

/* ------------------------------------------------------------------------- */
/* Plugin harness                                                            */
/* ------------------------------------------------------------------------- */

const disposers = []
const routes = []
const tools = new Map()
const promptContexts = new Map()
const commandDefs = new Map()

const ctx = {
  fiber: { entry: { id: 'include:dsh-notebook' } },
  effect(callback, label) {
    const dispose = callback()
    disposers.push({ label: String(label ?? ''), dispose })
    return () => {}
  },
  systemPrompt: {
    context(definition) {
      promptContexts.set(definition.name, definition)
      return () => promptContexts.delete(definition.name)
    },
  },
  commands: {
    register(definition) {
      commandDefs.set(definition.name, definition)
      return () => commandDefs.delete(definition.name)
    },
  },
  webServer: {
    register(route) {
      routes.push(route)
      return () => {
        route.disposed = true
      }
    },
    // No getOrigin: the gate then accepts the loopback test server whatever
    // port it lands on. The real Host pins its own origin.
  },
  tools: {
    register(definition) {
      tools.set(definition.name, definition)
      return () => {
        tools.delete(definition.name)
      }
    },
  },
  get() {
    return undefined
  },
}

let baseUrl = ''

async function request(pathname, init) {
  const response = await fetch(baseUrl + pathname, init)
  const text = await response.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  return { status: response.status, body, text }
}

const get = (pathname, params) => {
  const url = new URL(pathname, baseUrl)
  for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, String(value))
  return request(url.pathname + url.search)
}

const post = (pathname, payload) =>
  request(pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  })

function expectOk(response, label) {
  assert.equal(response.body?.ok, true, `${label}: ${response.status} ${response.text}`)
  return response.body
}

/* ------------------------------------------------------------------------- */
/* Run                                                                       */
/* ------------------------------------------------------------------------- */

await fsp.rm(VAULT, { recursive: true, force: true })
await fsp.mkdir(join(VAULT, '笔记'), { recursive: true })
await fsp.writeFile(join(VAULT, '笔记', '普通笔记.md'), '# 普通笔记\n', 'utf8')

const plugin = await import(pathToFileURL(join(WORKSPACE, 'index.js')).href)
plugin.apply(ctx, { vaultPath: VAULT, maxIndexFiles: 100, flashDir: FLASH_DIR })

const server = createServer((req, res) => {
  Promise.resolve(routes[0].handler(req, res)).catch((error) => {
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: String(error) }))
    } else {
      res.destroy(error)
    }
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
baseUrl = `http://127.0.0.1:${server.address().port}`

await check('an empty flash folder reports zero and names its folder', async () => {
  const summary = expectOk(await get('/notebook/api/flash/summary'), 'summary')
  assert.equal(summary.dir, FLASH_DIR)
  assert.deepEqual(summary.counts, { inbox: 0, done: 0, total: 0 })
  assert.ok(summary.categories.includes('随记'))
})

let firstPath = null
await check('capture writes one Markdown note with flash frontmatter', async () => {
  const created = expectOk(
    await post('/notebook/api/flash/create', { text: '想到一个主意：把同步做成可插拔的', category: '想法' }),
    'create',
  )
  const flash = created.flash
  assert.match(flash.path, new RegExp(`^${FLASH_DIR}/\\d{4}-\\d{2}-\\d{2} \\d{2}-\\d{2}-\\d{2}`))
  assert.equal(flash.category, '想法')
  assert.equal(flash.done, false)
  assert.equal(flash.pinned, false)
  firstPath = flash.path
  const raw = await fsp.readFile(join(VAULT, flash.path), 'utf8')
  assert.match(raw, /^---\ntype: flash\ncreated: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}\n/)
  assert.match(raw, /\ncategory: 想法\n/)
  assert.match(raw, /\ntags: \[\]\n/)
  assert.match(raw, /\npinned: false\n/)
  assert.match(raw, /\ndone: false\n---\n/)
  assert.match(raw, /想到一个主意：把同步做成可插拔的/)
})

await check('the flash is also an ordinary note in the vault index', async () => {
  const list = expectOk(await get('/notebook/api/list', { folder: FLASH_DIR }), 'vault list')
  assert.equal(list.notes.length, 1)
  assert.equal(list.notes[0].path, firstPath)
})

await check('capture needs text and defaults the category', async () => {
  const empty = await post('/notebook/api/flash/create', { text: '   ' })
  assert.equal(empty.status, 400)
  assert.equal(empty.body.code, 'flash_empty')
  const created = expectOk(await post('/notebook/api/flash/create', { text: '随手记一笔' }), 'create default')
  assert.equal(created.flash.category, '随记')
})

await check('the file name keeps CJK text but drops path separators', async () => {
  const created = expectOk(
    await post('/notebook/api/flash/create', { text: '读/写 分离：先存下来再整理' }),
    'create titled',
  )
  const name = created.flash.path.split('/').pop()
  assert.ok(!name.includes('/'), name)
  assert.match(name, /读 写 分离/)
})

await check('list filters by inbox, category and text and reports counts', async () => {
  const inbox = expectOk(await get('/notebook/api/flash/list'), 'inbox')
  assert.equal(inbox.counts.inbox, 3)
  assert.equal(inbox.counts.done, 0)
  assert.equal(inbox.items.length, 3)
  const ideas = expectOk(await get('/notebook/api/flash/list', { category: '想法' }), 'category filter')
  assert.equal(ideas.items.length, 1)
  assert.equal(ideas.items[0].category, '想法')
  const searched = expectOk(await get('/notebook/api/flash/list', { q: '可插拔' }), 'text filter')
  assert.equal(searched.items.length, 1)
  assert.equal(searched.items[0].path, firstPath)
})

await check('pinning and completing rewrite the frontmatter', async () => {
  const flags = expectOk(
    await post('/notebook/api/flash/flags', { path: firstPath, pinned: true, done: true }),
    'flags',
  )
  assert.equal(flags.pinned, true)
  assert.equal(flags.done, true)
  const raw = await fsp.readFile(join(VAULT, firstPath), 'utf8')
  assert.match(raw, /\npinned: true\n/)
  assert.match(raw, /\ndone: true\n/)
  const done = expectOk(await get('/notebook/api/flash/list', { status: 'done' }), 'done list')
  assert.equal(done.items.length, 1)
  const inbox = expectOk(await get('/notebook/api/flash/list', { status: 'inbox' }), 'inbox list')
  assert.equal(inbox.counts.inbox, 2)
  assert.equal(inbox.counts.done, 1)
  const all = expectOk(await get('/notebook/api/flash/list', { status: 'all' }), 'all list')
  assert.equal(all.items.length, 3)
})

await check('editing keeps the created stamp and updates category and tags', async () => {
  const before = await fsp.readFile(join(VAULT, firstPath), 'utf8')
  const createdBefore = /created: (.+)/.exec(before)[1]
  const updated = expectOk(
    await post('/notebook/api/flash/update', {
      path: firstPath,
      text: '改过的正文：同步也可以插件化',
      category: '灵感',
      tags: ['同步', '插件'],
    }),
    'update',
  )
  assert.equal(updated.flash.category, '灵感')
  assert.deepEqual(updated.flash.tags, ['同步', '插件'])
  const raw = await fsp.readFile(join(VAULT, firstPath), 'utf8')
  assert.equal(/created: (.+)/.exec(raw)[1], createdBefore)
  assert.match(raw, /\ncategory: 灵感\n/)
  assert.match(raw, /\ntags: \[同步, 插件\]\n/)
  assert.match(raw, /改过的正文/)
  assert.match(raw, /\ndone: true\n/, 'flags must survive an edit')
})

await check('paths outside the flash folder are refused', async () => {
  const outside = await post('/notebook/api/flash/update', { path: '笔记/普通笔记.md', text: 'x' })
  assert.equal(outside.status, 400)
  assert.equal(outside.body.code, 'invalid_flash_path')
  const traversal = await post('/notebook/api/flash/flags', { path: `${FLASH_DIR}/../笔记/普通笔记.md`, done: true })
  assert.equal(traversal.status, 400)
  const unchanged = await fsp.readFile(join(VAULT, '笔记', '普通笔记.md'), 'utf8')
  assert.equal(unchanged, '# 普通笔记\n')
})

await check('random prefers an untouched, unpinned flash', async () => {
  const found = expectOk(await get('/notebook/api/flash/random'), 'random')
  assert.equal(found.ok, true)
  // The pinned+done flash is the only one excluded from the preferred pool.
  assert.notEqual(found.flash.path, firstPath)
  assert.equal(found.flash.done, false)
})

await check('the agent tool captures and lists flashes', async () => {
  const tool = tools.get('notebook_flash')
  assert.ok(tool, 'notebook_flash was not registered')
  const captured = await tool.execute({ action: 'capture', text: 'AI 记下的一条闪念', category: '待办' })
  assert.match(captured, /闪念已记下/)
  assert.ok(captured.includes(`${FLASH_DIR}/`), captured)
  const recent = await tool.execute({ action: 'recent', limit: 5 })
  assert.match(recent, /AI 记下的一条闪念/)
  assert.match(recent, /待办/)
  const toolsText = await tool.execute({ action: 'random' })
  assert.match(toolsText, /闪念/)
})

await check('the /flash command captures with an optional category', async () => {
  const command = commandDefs.get('flash')
  assert.ok(command, '/flash was not registered')
  const captured = await command.handler({ rawInput: '想法 聊天里冒出来的一条' })
  assert.equal(captured.kind, 'success', JSON.stringify(captured))
  assert.match(captured.text, /已记下闪念 → 碎片\//)
  assert.match(captured.text, /想法/)
  const filed = expectOk(await get('/notebook/api/flash/list', { q: '聊天里冒出来的一条' }), 'list after command')
  assert.equal(filed.items.length, 1)
  assert.equal(filed.items[0].category, '想法')
})

await check('/flash without text shows the inbox and the usage hint', async () => {
  const command = commandDefs.get('flash')
  const listed = await command.handler({ rawInput: '' })
  assert.equal(listed.kind, 'success')
  assert.match(listed.text, /闪念收件箱/)
  assert.match(listed.text, /聊天里冒出来的一条/)
  const empty = await command.handler({ rawInput: '   ' })
  assert.equal(empty.kind, 'success')
})

await check('the flash prompt context points the model at notebook_flash', () => {
  const context = promptContexts.get('dsh-notebook:flash')
  assert.ok(context, 'the flash prompt context is missing')
  const text = typeof context.text === 'function' ? context.text() : context.text
  assert.match(text, /notebook_flash/)
  assert.match(text, /碎片/)
  assert.match(text, /不要为普通问答/)
})

await check('delete goes through the vault trash', async () => {
  const created = expectOk(await post('/notebook/api/flash/create', { text: '待删除的闪念' }), 'create delete')
  const removed = expectOk(await post('/notebook/api/delete', { path: created.flash.path }), 'delete')
  assert.match(removed.trashedTo, /^\.trash\//)
  const inbox = expectOk(await get('/notebook/api/flash/list', { q: '待删除' }), 'list after delete')
  assert.equal(inbox.items.length, 0)
})

await new Promise((resolve) => server.close(resolve))
while (disposers.length > 0) {
  const entry = disposers.pop()
  try {
    await entry.dispose?.()
  } catch {
    /* already gone */
  }
}
await fsp.rm(VAULT, { recursive: true, force: true })

console.log(`\nSUMMARY: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  for (const failure of failures) console.log(`  - ${failure.name}`)
  process.exitCode = 1
}
