#!/usr/bin/env node
/**
 * Host-half smoke test for index.js.
 *
 * Boots the plugin against a throwaway vault, mounts its captured `/notebook`
 * HTTP handler on a real loopback server, exercises every route with `fetch`,
 * then calls the four registered agent tools directly. Prints PASS/FAIL per
 * check and exits non-zero when anything fails.
 *
 * Run: node test/host-smoke.mjs
 */

import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import { createServer } from 'node:http'
import { basename, dirname, join, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const WORKSPACE = dirname(TEST_DIR)
const VAULT = join(TEST_DIR, '.tmp-vault')
const SIDECAR = join(TEST_DIR, '.tmp-outside-secret.md')

// ---------------------------------------------------------------------------
// Tiny check harness
// ---------------------------------------------------------------------------

let passed = 0
let failed = 0
const failures = []
const observations = []

async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`PASS  ${name}`)
  } catch (error) {
    failed += 1
    const detail = error instanceof Error ? (error.message || error.stack) : String(error)
    failures.push({ name, detail })
    console.log(`FAIL  ${name}`)
    console.log(`      ${detail.replace(/\n/g, '\n      ')}`)
  }
}

function observe(message) {
  observations.push(message)
  console.log(`INFO  ${message}`)
}

function expectOk(response, label) {
  if (response.body === null || typeof response.body !== 'object' || response.body.ok !== true) {
    throw new Error(`${label}: expected { ok: true }, got HTTP ${response.status} ${response.text.slice(0, 800)}`)
  }
  return response.body
}

function expectReject(response, label) {
  if (response.body === null || typeof response.body !== 'object' || response.body.ok !== false) {
    throw new Error(`${label}: expected { ok: false }, got HTTP ${response.status} ${response.text.slice(0, 800)}`)
  }
  return response.body
}

async function exists(path) {
  try {
    await fsp.stat(path)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WELCOME = `# 欢迎

这是第一行，含关键字 needle-alpha。 🚀

- 列表项
`
const DESIGN = `# 设计

needle-beta 出现在这里。

尾行
`
const DAILY = `# 日常

随手记。
`
const HIDDEN = `# 隐藏

needle-hidden 只应出现在被排除的目录里。
`

// ---------------------------------------------------------------------------
// HTTP helpers (baseUrl is assigned once the server listens)
// ---------------------------------------------------------------------------

let baseUrl = ''

async function request(pathname, init) {
  assert.ok(baseUrl.length > 0, 'the test server is not listening')
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

function get(pathname, params) {
  const url = new URL(pathname, baseUrl)
  for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, String(value))
  return request(url.pathname + url.search)
}

function post(pathname, payload, extraHeaders = {}) {
  return request(pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body: JSON.stringify(payload),
  })
}

// ---------------------------------------------------------------------------
// Plugin mount
// ---------------------------------------------------------------------------

const disposers = []
const routes = []
const tools = new Map()

const promptContexts = new Map()
const commandDefs = new Map()

const ctx = {
  effect(callback, label) {
    const dispose = callback()
    disposers.push({ label: String(label ?? ''), dispose })
    return () => {}
  },
  systemPrompt: {
    context(definition) {
      promptContexts.set(definition.name, definition)
      return () => {
        promptContexts.delete(definition.name)
      }
    },
  },
  commands: {
    register(definition) {
      commandDefs.set(definition.name, definition)
      return () => {
        commandDefs.delete(definition.name)
      }
    },
  },
  webServer: {
    register(route) {
      routes.push(route)
      return () => {
        route.disposed = true
      }
    },
  },
  tools: {
    register(definition) {
      tools.set(definition.name, definition)
      return () => {
        tools.delete(definition.name)
      }
    },
  },
  // The Harness owns model configuration; the test route must be visible through
  // the same `llm` service the real Host uses.
  llm: {
    listProviders: () => [{ id: 'mock', name: 'Mock' }],
    listModels: async () => [{ provider: 'mock', id: 'mock-model', name: 'Mock model' }],
    async *stream(options) {
      aiCalls.push(options)
      if (String(options.system ?? '').includes('写作 Agent')) {
        const step = aiCalls.filter((call) => String(call.system ?? '').includes('写作 Agent')).length
        // Two actions in one reply must still take just the first object.
        yield {
          type: 'text-delta',
          index: 0,
          text: step === 1 ? '{"tool":"list"}\n{"tool":"list"}' : '{"done":"整理完成"}',
        }
      } else {
        yield { type: 'text-delta', index: 0, text: 'AI: ' }
        yield { type: 'text-delta', index: 0, text: `(${options.system.slice(0, 4)})` }
      }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  },
  get(name) {
    if (name === 'agentDefaultModel') {
      return { currentSelection: () => ({ provider: 'mock', model: 'mock-model' }) }
    }
    if (name === 'sessions') {
      return {
        get: () => ({
          deriveMessages: () => [
            { role: 'user', content: [{ type: 'text', text: '你好' }] },
            { role: 'assistant', content: [{ type: 'text', text: '在的，需要我改笔记吗？' }] },
          ],
        }),
      }
    }
    return undefined
  },
}

const aiCalls = []

let plugin = null
let server = null

async function startServer() {
  const route = routes[0]
  server = createServer((req, res) => {
    Promise.resolve(route.handler(req, res)).catch((error) => {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: String(error), code: 'test_harness' }))
      } else {
        res.destroy(error)
      }
    })
  })
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectListen)
      resolveListen()
    })
  })
  baseUrl = `http://127.0.0.1:${server.address().port}`
}

async function fullCleanup() {
  if (server !== null) {
    const current = server
    server = null
    await new Promise((resolveClose) => current.close(() => resolveClose()))
  }
  while (disposers.length > 0) {
    const entry = disposers.pop()
    try {
      if (typeof entry.dispose === 'function') entry.dispose()
    } catch {
      /* already gone */
    }
  }
  for (const target of [VAULT, SIDECAR]) {
    if (!target.startsWith(TEST_DIR + sep)) {
      throw new Error(`refusing to remove a path outside the test directory: ${target}`)
    }
    await fsp.rm(target, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function main() {
  for (const target of [VAULT, SIDECAR]) {
    if (!target.startsWith(TEST_DIR + sep)) throw new Error(`unsafe temp path: ${target}`)
  }
  await fsp.rm(VAULT, { recursive: true, force: true })
  await fsp.rm(SIDECAR, { force: true })

  await fsp.mkdir(join(VAULT, '笔记', '项目'), { recursive: true })
  await fsp.mkdir(join(VAULT, '.obsidian'), { recursive: true })
  await fsp.writeFile(join(VAULT, '笔记', '欢迎.md'), WELCOME, 'utf8')
  await fsp.writeFile(join(VAULT, '笔记', '项目', '设计.md'), DESIGN, 'utf8')
  await fsp.writeFile(join(VAULT, '日常.md'), DAILY, 'utf8')
  await fsp.writeFile(join(VAULT, '.obsidian', 'app.json'), '{"dummy":true}\n', 'utf8')
  await fsp.writeFile(join(VAULT, '.obsidian', 'hidden.md'), HIDDEN, 'utf8')

  plugin = await import(pathToFileURL(join(WORKSPACE, 'index.js')).href)
  const apply = plugin.apply

  await check('plugin exports apply() and the Host services it consumes', () => {
    assert.equal(typeof apply, 'function', 'apply must be exported as a function')
    assert.deepEqual(plugin.inject, ['tools', 'webServer', 'llm', 'systemPrompt', 'commands', 'sessions'])
  })

  assert.equal(typeof apply, 'function', 'cannot continue without apply()')
  apply(ctx, { vaultPath: VAULT, maxNoteBytes: 1048576, maxIndexFiles: 100 })
  const route = routes[0]
  const signal = new AbortController().signal

  await check('apply() registers one prefix route /notebook and its effects', () => {
    assert.equal(routes.length, 1, `expected 1 web route, got ${routes.length}`)
    assert.equal(route.kind, 'prefix')
    assert.equal(route.path, '/notebook')
    assert.equal(typeof route.handler, 'function')
    // HTTP routes, agent tools, the /note command, and the prompt context.
    assert.equal(disposers.length, 4, `expected 4 ctx.effect calls, got ${disposers.length}`)
  })

  await check('apply() registers the four notebook tools with complete definitions', () => {
    assert.deepEqual(
      [...tools.keys()].sort(),
      ['notebook_list', 'notebook_read', 'notebook_search', 'notebook_write'],
    )
    for (const definition of tools.values()) {
      assert.equal(typeof definition.description, 'string')
      assert.ok(definition.description.length > 0, `${definition.name} has an empty description`)
      assert.equal(typeof definition.parameters, 'object')
      assert.equal(typeof definition.execute, 'function')
      assert.equal(definition.output?.schema?.type, 'string')
    }
  })

  await startServer()

  // -------------------------------------------------------------------------
  // Read-only HTTP routes
  // -------------------------------------------------------------------------

  await check('GET /api/status reports the configured vault', async () => {
    const status = expectOk(await get('/notebook/api/status'), 'status')
    assert.equal(status.exists, true)
    assert.equal(status.path, VAULT)
    assert.equal(status.name, basename(VAULT))
    assert.equal(status.configuredBy, 'config')
    assert.equal(status.noteCount, 3, `expected 3 notes, got ${status.noteCount}`)
    assert.equal(status.maxNoteBytes, 1048576)
    assert.equal(status.error, null)
  })

  await check('GET /api/list finds all notes and skips .obsidian', async () => {
    const list = expectOk(await get('/notebook/api/list'), 'list')
    const paths = list.notes.map((note) => note.path).sort()
    assert.deepEqual(paths, ['日常.md', '笔记/欢迎.md', '笔记/项目/设计.md'].sort())
    assert.equal(list.truncated, false)
    assert.equal(list.limit, 100)
    assert.equal(list.folder, '')
    assert.ok(list.notes.every((note) => typeof note.mtimeMs === 'number' && note.size > 0))
    assert.ok(
      !list.notes.some((note) => note.path.split('/').includes('.obsidian')),
      `list leaked .obsidian: ${JSON.stringify(paths)}`,
    )
  })

  await check('GET /api/list?folder=笔记 lists only that subtree', async () => {
    const list = expectOk(await get('/notebook/api/list', { folder: '笔记' }), 'list folder')
    const paths = list.notes.map((note) => note.path).sort()
    assert.deepEqual(paths, ['笔记/欢迎.md', '笔记/项目/设计.md'].sort())
    assert.equal(list.folder, '笔记')
  })

  await check('GET /api/read returns the exact note content and mtimeMs', async () => {
    const note = expectOk(await get('/notebook/api/read', { path: '笔记/欢迎.md' }), 'read')
    assert.equal(note.path, '笔记/欢迎.md')
    assert.equal(note.content, WELCOME)
    assert.equal(note.size, Buffer.byteLength(WELCOME, 'utf8'))
    assert.equal(typeof note.mtimeMs, 'number')
    assert.ok(note.mtimeMs > 0)
  })

  await check('GET /api/read on a missing note returns { ok:false }', async () => {
    const response = await get('/notebook/api/read', { path: '不存在.md' })
    const body = expectReject(response, 'read missing note')
    assert.ok(!('content' in body), 'a failed read must not return content')
  })

  await check('GET /api/search finds text with the correct line number', async () => {
    const result = expectOk(await get('/notebook/api/search', { q: 'needle-alpha' }), 'search')
    assert.equal(result.matches.length, 1, JSON.stringify(result))
    assert.equal(result.matches[0].path, '笔记/欢迎.md')
    assert.equal(result.matches[0].line, 3)
    assert.match(result.matches[0].text, /needle-alpha/)
    assert.ok(result.scanned >= 3, `expected at least 3 scanned notes, got ${result.scanned}`)
  })

  await check('GET /api/search does not search inside .obsidian', async () => {
    const result = expectOk(await get('/notebook/api/search', { q: 'needle-hidden' }), 'search hidden')
    assert.deepEqual(result.matches, [], JSON.stringify(result))
  })

  // -------------------------------------------------------------------------
  // Path/security rejections on the HTTP surface
  // -------------------------------------------------------------------------

  const rejectionCases = [
    ['traversal path ../../etc/passwd', { path: '../../etc/passwd' }, 'outside_vault'],
    ['absolute path /etc/passwd', { path: '/etc/passwd' }, 'outside_vault'],
    ['vault-internal .obsidian/x.md', { path: '.obsidian/x.md' }, 'excluded_path'],
    ['non-markdown a.txt', { path: 'a.txt' }, 'not_markdown'],
    ['missing path parameter', {}, 'missing_path'],
  ]
  for (const [label, params, expectedCode] of rejectionCases) {
    await check(`GET /api/read rejects ${label}`, async () => {
      const response = await get('/notebook/api/read', params)
      const body = expectReject(response, label)
      assert.ok(response.status >= 400, `expected HTTP >= 400, got ${response.status}`)
      assert.ok(!('content' in body), 'rejected read must not return content')
      if (body.code !== expectedCode) {
        observe(`${label} returned code "${body.code}" (expected "${expectedCode}")`)
      }
    })
  }

  await check('POST /api/write rejects a traversal path and writes nothing', async () => {
    const response = await post('/notebook/api/write', { path: '../escape.md', content: 'escaped' })
    expectReject(response, 'write traversal')
    assert.equal(await exists(join(TEST_DIR, 'escape.md')), false, 'traversal write created a file')
  })

  await check('cross-origin request is rejected with 403', async () => {
    const response = await request('/notebook/api/status', { headers: { origin: 'http://evil.example' } })
    assert.equal(response.status, 403)
    const body = expectReject(response, 'cross-origin')
    assert.equal(body.code, 'cross_origin')
  })

  await check('unknown notebook route returns 404 { ok:false }', async () => {
    const response = await get('/notebook/api/nope')
    assert.equal(response.status, 404)
    const body = expectReject(response, 'unknown route')
    assert.equal(body.code, 'no_route')
  })

  // -------------------------------------------------------------------------
  // Mutating HTTP routes
  // -------------------------------------------------------------------------

  await check('POST /api/write creates a nested note and returns mtimeMs', async () => {
    const body = expectOk(
      await post('/notebook/api/write', { path: '新建/新笔记.md', content: '第一版' }),
      'write create',
    )
    assert.equal(body.path, '新建/新笔记.md')
    assert.equal(body.mode, 'replace')
    assert.equal(body.size, Buffer.byteLength('第一版', 'utf8'))
    assert.equal(typeof body.mtimeMs, 'number')
    assert.ok(body.mtimeMs > 0)
    assert.equal(await fsp.readFile(join(VAULT, '新建', '新笔记.md'), 'utf8'), '第一版')
  })

  let overwritten = null
  await check('POST /api/write overwrites an existing note exactly', async () => {
    overwritten = expectOk(
      await post('/notebook/api/write', { path: '新建/新笔记.md', content: '第二版 🚀' }),
      'write overwrite',
    )
    assert.equal(overwritten.path, '新建/新笔记.md')
    assert.equal(typeof overwritten.mtimeMs, 'number')
    assert.equal(await fsp.readFile(join(VAULT, '新建', '新笔记.md'), 'utf8'), '第二版 🚀')
  })

  await check('POST /api/write with a stale expectedMtimeMs is rejected as a conflict', async () => {
    const response = await post('/notebook/api/write', {
      path: '新建/新笔记.md',
      content: 'stale write',
      expectedMtimeMs: 1,
    })
    const body = expectReject(response, 'stale write')
    assert.equal(body.code, 'conflict', JSON.stringify(body))
    assert.equal(await fsp.readFile(join(VAULT, '新建', '新笔记.md'), 'utf8'), '第二版 🚀')
  })

  await check('POST /api/write accepts a matching expectedMtimeMs', async () => {
    const body = expectOk(
      await post('/notebook/api/write', {
        path: '新建/新笔记.md',
        content: '第三版',
        expectedMtimeMs: overwritten.mtimeMs,
      }),
      'matching expectedMtimeMs',
    )
    assert.equal(body.mode, 'replace')
    assert.equal(await fsp.readFile(join(VAULT, '新建', '新笔记.md'), 'utf8'), '第三版')
  })

  await check('POST /api/create refuses an existing note and leaves it intact', async () => {
    const response = await post('/notebook/api/create', { path: '新建/新笔记.md', content: '不应写入' })
    const body = expectReject(response, 'create existing')
    assert.equal(body.code, 'note_exists', JSON.stringify(body))
    assert.equal(await fsp.readFile(join(VAULT, '新建', '新笔记.md'), 'utf8'), '第三版')
  })

  await check('POST /api/create creates a new note', async () => {
    const body = expectOk(
      await post('/notebook/api/create', { path: '新建/再一篇.md', content: '再一篇' }),
      'create new',
    )
    assert.equal(body.path, '新建/再一篇.md')
    assert.equal(body.mode, 'create')
    assert.equal(await fsp.readFile(join(VAULT, '新建', '再一篇.md'), 'utf8'), '再一篇')
  })

  await check('POST /api/current records the note the panel is editing', async () => {
    const empty = expectOk(await get('/notebook/api/current'), 'current before')
    assert.equal(empty.path, null, JSON.stringify(empty))
    const set = expectOk(await post('/notebook/api/current', { path: '笔记/01 工作/第三版.md' }), 'set current')
    assert.equal(set.path, '笔记/01 工作/第三版.md', JSON.stringify(set))
    const read = expectOk(await get('/notebook/api/current'), 'current after')
    assert.equal(read.path, '笔记/01 工作/第三版.md', JSON.stringify(read))
  })

  await check('the current note context includes the title and outline', async () => {
    expectOk(
      await post('/notebook/api/create', {
        path: '大纲/含大纲.md',
        content: '# 总标题\n\n## 小节一\n\n正文\n\n## 小节二\n',
      }),
      'create outline note',
    )
    const set = expectOk(await post('/notebook/api/current', { path: '大纲/含大纲.md' }), 'set outline note')
    assert.equal(set.title, '总标题', JSON.stringify(set))
    assert(set.outline.length >= 3, JSON.stringify(set.outline))
    const definition = promptContexts.get('dsh-notebook:current-note')
    assert.notEqual(definition, undefined, 'prompt context not registered')
    const text = definition.text()
    assert(text.includes('大纲/含大纲.md'), JSON.stringify(text))
    assert(text.includes('总标题'), JSON.stringify(text))
    assert(text.includes('小节一'), JSON.stringify(text))
    assert(text.includes('notebook_read'), JSON.stringify(text))
    expectOk(await post('/notebook/api/current', { path: '笔记/01 工作/第三版.md' }), 'restore current')
  })

  await check('/note shows and switches the current note', async () => {
    const definition = commandDefs.get('note')
    assert.notEqual(definition, undefined, 'note command not registered')
    const current = await definition.handler({ rawInput: '', agent: { id: 'test' } })
    assert.equal(current.kind, 'success', JSON.stringify(current))
    assert(current.text.includes('第三版'), JSON.stringify(current))
    const switched = await definition.handler({ rawInput: '再一篇', agent: { id: 'test' } })
    assert.equal(switched.kind, 'success', JSON.stringify(switched))
    const after = expectOk(await get('/notebook/api/current'), 'current switched')
    assert(after.path.includes('再一篇'), JSON.stringify(after))
    const missing = await definition.handler({ rawInput: '不存在的笔记名', agent: { id: 'test' } })
    assert.equal(missing.kind, 'error', JSON.stringify(missing))
    // restore the current note for later checks
    expectOk(await post('/notebook/api/current', { path: '笔记/01 工作/第三版.md' }), 'restore current')
  })

  await check('/note save writes the conversation into a note', async () => {
    const definition = commandDefs.get('note')
    const result = await definition.handler({ rawInput: 'save 会话存档', agent: { id: 'test' } })
    assert.equal(result.kind, 'success', JSON.stringify(result))
    assert(result.text.includes('会话存档'), JSON.stringify(result))
    const content = await fsp.readFile(join(VAULT, '会话存档.md'), 'utf8')
    assert(content.includes('**我：**'), content)
    assert(content.includes('在的，需要我改笔记吗？'), content)
    assert(content.includes('source: conversation'), content)
    assert(content.includes('session: test'), content)
  })

  await check('/note new creates an empty note', async () => {
    const definition = commandDefs.get('note')
    const result = await definition.handler({ rawInput: 'new 命令新建', agent: { id: 'test' } })
    assert.equal(result.kind, 'success', JSON.stringify(result))
    const stat = await fsp.stat(join(VAULT, '命令新建.md'))
    assert.equal(stat.isFile(), true)
  })

  await check('POST /api/ai/agent runs a tool loop through the Harness model', async () => {
    aiCalls.length = 0
    const body = expectOk(
      await post('/notebook/api/ai/agent', { instruction: '整理一下笔记' }),
      'ai agent',
    )
    assert.equal(body.text, '整理完成', JSON.stringify(body))
    assert.equal(body.steps.length, 1, JSON.stringify(body.steps))
    assert.equal(body.steps[0].tool, 'list', JSON.stringify(body.steps))
    assert.equal(body.steps[0].ok, true, JSON.stringify(body.steps))
    assert(aiCalls.length === 2, `expected two model calls, got ${aiCalls.length}`)
    assert.equal(aiCalls[0].messages[0].content[0].text, '整理一下笔记')
    aiCalls.length = 0
  })

  await check('POST /api/ai/agent rejects an empty instruction', async () => {
    const empty = expectReject(await post('/notebook/api/ai/agent', { instruction: '   ' }), 'empty instruction')
    assert.equal(empty.code, 'empty_instruction', JSON.stringify(empty))
  })

  await check('POST /api/ai streams through the Harness model route', async () => {
    const response = await post('/notebook/api/ai', { task: 'rewrite', text: '原文内容', locale: 'zh' })
    const body = expectOk(response, 'ai rewrite')
    assert.equal(body.task, 'rewrite', JSON.stringify(body))
    assert.equal(body.provider, 'mock', JSON.stringify(body))
    assert(body.text.startsWith('AI: '), JSON.stringify(body))
    assert.equal(aiCalls.length, 1, 'the model must be called once')
    const call = aiCalls[0]
    assert.equal(call.provider, 'mock')
    assert.equal(call.model, 'mock-model')
    assert.equal(call.messages[0].content[0].text, '原文内容')
    assert(call.system.length > 10, 'system prompt missing')
    aiCalls.length = 0
  })

  await check('POST /api/ai rejects unknown tasks and empty text', async () => {
    const unknown = expectReject(await post('/notebook/api/ai', { task: 'nope', text: 'x' }), 'unknown task')
    assert.equal(unknown.code, 'unknown_ai_task', JSON.stringify(unknown))
    const empty = expectReject(await post('/notebook/api/ai', { task: 'rewrite', text: '   ' }), 'empty text')
    assert.equal(empty.code, 'empty_text', JSON.stringify(empty))
    const long = expectReject(
      await post('/notebook/api/ai', { task: 'rewrite', text: 'x'.repeat(9000) }),
      'long text',
    )
    assert.equal(long.code, 'text_too_long', JSON.stringify(long))
  })

  await check('POST /api/mkdir creates a folder inside the vault', async () => {
    const body = expectOk(await post('/notebook/api/mkdir', { path: '项目/2026' }), 'mkdir')
    assert.equal(body.path, '项目/2026')
    const stat = await fsp.stat(join(VAULT, '项目', '2026'))
    assert.equal(stat.isDirectory(), true)
  })

  await check('POST /api/mkdir refuses escaping and hidden folders', async () => {
    const escaping = expectReject(await post('/notebook/api/mkdir', { path: '../outside' }), 'mkdir escape')
    assert.equal(escaping.code, 'outside_vault')
    const hidden = expectReject(await post('/notebook/api/mkdir', { path: '.obsidian/x' }), 'mkdir hidden')
    assert.equal(hidden.code, 'excluded_path')
  })

  await check('GET /api/fields returns frontmatter fields per note', async () => {
    expectOk(
      await post('/notebook/api/create', {
        path: '集合/条目A.md',
        content: '---\nstatus: 进行中\npriority: 高\n---\n\n内容\n',
      }),
      'create A',
    )
    expectOk(await post('/notebook/api/create', { path: '集合/条目B.md', content: '---\nstatus: 完成\n---\n' }), 'create B')
    const body = expectOk(await get('/notebook/api/fields', { folder: '集合' }), 'fields')
    assert.equal(body.rows.length, 2, JSON.stringify(body).slice(0, 300))
    const first = body.rows.find((row) => row.name === '条目A')
    assert(first !== undefined, JSON.stringify(body.rows))
    assert.equal(first.fields.status, '进行中', JSON.stringify(first))
    assert.equal(first.fields.priority, '高', JSON.stringify(first))
    assert.equal(body.rows.find((row) => row.name === '条目B').fields.status, '完成')
  })

  await check('GET /api/parents returns frontmatter parent links', async () => {
    expectOk(
      await post('/notebook/api/create', {
        path: '树/子页.md',
        content: '---\nparent: 树/父页\n---\n子页内容\n',
      }),
      'create child',
    )
    const body = expectOk(await get('/notebook/api/parents'), 'parents')
    assert.equal(body.parents['树/子页.md'], '树/父页', JSON.stringify(body))
  })

  await check('GET /api/backlinks finds notes that link to a page', async () => {
    expectOk(await post('/notebook/api/create', { path: '链接/A.md', content: '参考 [[B]] 与 ![[B]]\n' }), 'create A')
    expectOk(await post('/notebook/api/create', { path: '链接/B.md', content: 'B 的内容\n' }), 'create B')
    const body = expectOk(await get('/notebook/api/backlinks', { path: '链接/B.md' }), 'backlinks')
    assert.equal(body.name, 'B', JSON.stringify(body))
    assert.equal(body.backlinks.length, 1, JSON.stringify(body))
    assert.equal(body.backlinks[0].path, '链接/A.md', JSON.stringify(body.backlinks))
    assert.equal(body.backlinks[0].lines[0].number, 1)
  })

  await check('GET /api/backlinks ignores self-links', async () => {
    expectOk(await post('/notebook/api/create', { path: '链接/C.md', content: '自引用 [[C]]\n' }), 'create C')
    const body = expectOk(await get('/notebook/api/backlinks', { path: '链接/C.md' }), 'backlinks C')
    assert.equal(body.backlinks.length, 0, JSON.stringify(body))
  })

  await check('POST /api/rename moves the note and keeps its content', async () => {
    const body = expectOk(
      await post('/notebook/api/rename', { from: '新建/再一篇.md', to: '归档/改名后.md' }),
      'rename',
    )
    assert.equal(body.from, '新建/再一篇.md')
    assert.equal(body.to, '归档/改名后.md')
    assert.equal(await exists(join(VAULT, '新建', '再一篇.md')), false)
    assert.equal(await fsp.readFile(join(VAULT, '归档', '改名后.md'), 'utf8'), '再一篇')
  })

  await check('POST /api/rename refuses to overwrite an existing note', async () => {
    const response = await post('/notebook/api/rename', {
      from: '新建/新笔记.md',
      to: '归档/改名后.md',
    })
    const body = expectReject(response, 'rename collision')
    assert.equal(body.code, 'note_exists', JSON.stringify(body))
    assert.equal(await exists(join(VAULT, '新建', '新笔记.md')), true)
  })

  await check('POST /api/delete moves the note to .trash and removes the original', async () => {
    const body = expectOk(await post('/notebook/api/delete', { path: '新建/新笔记.md' }), 'delete')
    assert.equal(body.path, '新建/新笔记.md')
    assert.match(body.trashedTo, /^\.trash\//)
    assert.equal(await exists(join(VAULT, '新建', '新笔记.md')), false)
    assert.equal(await exists(join(VAULT, ...body.trashedTo.split('/'))), true)
    assert.equal(await fsp.readFile(join(VAULT, ...body.trashedTo.split('/')), 'utf8'), '第三版')
  })

  await check('POST /api/delete on a missing note returns { ok:false }', async () => {
    const response = await post('/notebook/api/delete', { path: '不存在.md' })
    expectReject(response, 'delete missing')
  })

  // -------------------------------------------------------------------------
  // Agent tools (called directly, same vault service)
  // -------------------------------------------------------------------------

  await check('tool notebook_list returns a non-empty string with note paths', async () => {
    const output = await tools.get('notebook_list').execute({}, { signal })
    assert.equal(typeof output, 'string')
    assert.ok(output.length > 0)
    assert.match(output, /Vault:/)
    assert.match(output, /笔记\/欢迎\.md/)
    assert.match(output, /笔记\/项目\/设计\.md/)
    assert.doesNotMatch(output, /\.obsidian/)
  })

  await check('tool notebook_list honors the folder argument', async () => {
    const output = await tools.get('notebook_list').execute({ folder: '笔记' }, { signal })
    assert.equal(typeof output, 'string')
    assert.match(output, /欢迎\.md/)
    assert.match(output, /设计\.md/)
    assert.doesNotMatch(output, /日常\.md/)
  })

  await check('tool notebook_read returns the note content', async () => {
    const output = await tools.get('notebook_read').execute({ path: '笔记/欢迎.md' }, { signal })
    assert.equal(typeof output, 'string')
    assert.ok(output.length > 0)
    assert.match(output, /# 笔记\/欢迎\.md/)
    assert.match(output, /needle-alpha/)
    assert.match(output, /🚀/)
  })

  await check('tool notebook_search returns path:line matches', async () => {
    const output = await tools.get('notebook_search').execute({ query: 'needle-alpha' }, { signal })
    assert.equal(typeof output, 'string')
    assert.ok(output.length > 0)
    assert.match(output, /笔记\/欢迎\.md:3:/)
  })

  await check('tool notebook_search reports zero matches for excluded content', async () => {
    const output = await tools.get('notebook_search').execute({ query: 'needle-hidden' }, { signal })
    assert.equal(typeof output, 'string')
    assert.match(output, /No matches/)
  })

  await check('tool notebook_write mode=replace writes the file', async () => {
    const output = await tools.get('notebook_write').execute(
      { path: '工具/替换.md', content: '# 替换\n\nreplace body\n', mode: 'replace' },
      { signal },
    )
    assert.equal(typeof output, 'string')
    assert.match(output, /replace 工具\/替换\.md/)
    assert.equal(await fsp.readFile(join(VAULT, '工具', '替换.md'), 'utf8'), '# 替换\n\nreplace body\n')
  })

  await check('tool notebook_write mode=append appends to an existing note', async () => {
    const write = tools.get('notebook_write')
    expectOk(await post('/notebook/api/write', { path: '工具/追加.md', content: 'A\n' }), 'seed append note')
    const output = await write.execute({ path: '工具/追加.md', content: 'B', mode: 'append' }, { signal })
    assert.equal(typeof output, 'string')
    assert.match(output, /append 工具\/追加\.md/)
    assert.equal(await fsp.readFile(join(VAULT, '工具', '追加.md'), 'utf8'), 'A\nB')
  })

  await check('tool notebook_write mode=create creates and then refuses', async () => {
    const write = tools.get('notebook_write')
    const output = await write.execute(
      { path: '工具/创建.md', content: 'created', mode: 'create' },
      { signal },
    )
    assert.equal(typeof output, 'string')
    assert.match(output, /create 工具\/创建\.md/)
    assert.equal(await fsp.readFile(join(VAULT, '工具', '创建.md'), 'utf8'), 'created')
    await assert.rejects(
      () => write.execute({ path: '工具/创建.md', content: 'again', mode: 'create' }, { signal }),
      (error) => error?.code === 'note_exists' || /already exists/.test(error?.message ?? ''),
      'create mode must refuse an existing note',
    )
  })

  await check('tool notebook_write rejects a traversal path', async () => {
    await assert.rejects(
      () => tools.get('notebook_write').execute({ path: '../tool-escape.md', content: 'x' }, { signal }),
      (error) => error?.code === 'outside_vault' || /escape/i.test(error?.message ?? ''),
      'tool write must refuse a path outside the vault',
    )
    assert.equal(await exists(join(TEST_DIR, 'tool-escape.md')), false)
  })

  // -------------------------------------------------------------------------
  // Robustness probes (diagnostics, not spec failures)
  // -------------------------------------------------------------------------

  try {
    const hidden = await get('/notebook/api/list', { folder: '.obsidian' })
    if (hidden.body?.ok === true) {
      const leaked = (hidden.body.notes ?? []).map((note) => note.path)
      observe(`GET /api/list?folder=.obsidian bypasses the exclusion and returns ${JSON.stringify(leaked)}`)
    } else {
      observe(`GET /api/list?folder=.obsidian is rejected (code=${hidden.body?.code})`)
    }
  } catch (error) {
    observe(`could not probe folder=.obsidian: ${error?.message ?? error}`)
  }

  try {
    const same = await post('/notebook/api/rename', {
      from: '不存在的笔记.md',
      to: '不存在的笔记.md',
    })
    if (same.body?.ok === true) {
      observe(`POST /api/rename of a missing note to the same path returns ok:true (mtimeMs=${same.body.mtimeMs})`)
    } else {
      observe(`POST /api/rename of a missing note to the same path is rejected (code=${same.body?.code})`)
    }
  } catch (error) {
    observe(`could not probe rename-same-missing: ${error?.message ?? error}`)
  }

  try {
    await fsp.writeFile(SIDECAR, 'SYMLINK-SECRET\n', 'utf8')
    await fsp.symlink(SIDECAR, join(VAULT, '逃逸.md'))
    const leaked = await get('/notebook/api/read', { path: '逃逸.md' })
    if (leaked.body?.ok === true && leaked.body.content === 'SYMLINK-SECRET\n') {
      observe('GET /api/read follows a symlink out of the vault: "逃逸.md" returned a file outside the vault')
    } else {
      observe(`symlink escape blocked (HTTP ${leaked.status} ${JSON.stringify(leaked.body)})`)
    }
  } catch (error) {
    observe(`symlink probe skipped: ${error?.code ?? error?.message ?? error}`)
  }

  try {
    await fsp.writeFile(join(VAULT, '.hidden.md'), '# hidden\n', 'utf8')
    const leaked = await get('/notebook/api/read', { path: '.hidden.md' })
    if (leaked.body?.ok === true) {
      observe('a dotfile note (.hidden.md) is readable by exact path even though listing/search skip it')
    }
  } catch (error) {
    observe(`dotfile probe skipped: ${error?.message ?? error}`)
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  await check('cleanup: server closed, registrations disposed, temp vault removed', async () => {
    await fullCleanup()
    assert.equal(server, null)
    assert.equal(route.disposed, true, 'the web route disposer did not run')
    assert.equal(tools.size, 0, `tool definitions still registered: ${[...tools.keys()].join(', ')}`)
    assert.equal(await exists(VAULT), false, 'the temp vault still exists')
    assert.equal(await exists(SIDECAR), false, 'the sidecar file still exists')
  })
}

try {
  await main()
} catch (error) {
  failed += 1
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
  failures.push({ name: 'unexpected harness error', detail })
  console.log(`FAIL  unexpected harness error\n      ${detail.replace(/\n/g, '\n      ')}`)
} finally {
  try {
    await fullCleanup()
  } catch (error) {
    console.log(`FAIL  cleanup after the run: ${error?.message ?? error}`)
    failed += 1
  }
}

console.log('')
if (observations.length > 0) {
  console.log('Robustness observations:')
  for (const observation of observations) console.log(`  - ${observation}`)
  console.log('')
}
console.log(`SUMMARY: ${passed} passed, ${failed} failed`)
if (failures.length > 0) {
  console.log('Failures:')
  for (const failure of failures) console.log(`  - ${failure.name}: ${failure.detail.split('\n')[0]}`)
}
process.exitCode = failed === 0 ? 0 : 1
