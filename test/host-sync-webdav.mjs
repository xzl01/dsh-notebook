#!/usr/bin/env node
/**
 * WebDAV sync engine test.
 *
 * Boots a real loopback HTTP WebDAV server with an in-memory filesystem, then
 * drives the shipped engine (sync.js) through the situations that matter:
 * first upload, local edit, remote edit, both sides edited, deletes in both
 * directions, a first-sync collision, CJK/space paths, a 401, and the
 * mass-delete guard.
 *
 * Run: node test/host-sync-webdav.mjs
 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const WORKSPACE = dirname(TEST_DIR)
const ROOT = join(TEST_DIR, '.tmp-sync-webdav')
const VAULT = join(ROOT, 'vault')
const BASE_PATH = '/dav/notes'
const USER = 'me'
const PASSWORD = 'secret'

const engine = await import(join(WORKSPACE, 'sync.js'))
const { createSyncService } = engine

/* ------------------------------------------------------------------------- */
/* Check harness                                                             */
/* ------------------------------------------------------------------------- */

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
/* Minimal WebDAV server                                                     */
/* ------------------------------------------------------------------------- */

function sha1(buffer) {
  return createHash('sha1').update(buffer).digest('hex')
}

function encodePath(path) {
  return path
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function xmlEscape(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function startMockDav() {
  /** rel path -> { body: Buffer, mtimeMs, etag } */
  const files = new Map()
  /** rel dirs, '' is the base collection */
  const dirs = new Set([''])
  const requests = []
  /** Injected transient failures: method -> remaining count. */
  const failures = []
  const state = { clockOffset: 0 }

  const href = (rel, isDir) => `http://127.0.0.1:${state.port}${BASE_PATH}${rel.length > 0 ? `/${encodePath(rel)}` : ''}${isDir ? '/' : ''}`

  function responseXml(rel, depth) {
    const rows = []
    const pushEntry = (path, isDir) => {
      const file = files.get(path)
      const mtime = isDir ? Date.now() : file.mtimeMs
      rows.push(
        '<d:response>' +
          `<d:href>${xmlEscape(href(path, isDir))}</d:href>` +
          '<d:propstat><d:prop>' +
          (isDir
            ? '<d:resourcetype><d:collection/></d:resourcetype>'
            : `<d:getetag>${xmlEscape(file.etag)}</d:getetag>` +
              `<d:getcontentlength>${file.body.length}</d:getcontentlength>` +
              `<d:getlastmodified>${new Date(mtime).toUTCString()}</d:getlastmodified>` +
              '<d:resourcetype/>') +
          '</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>' +
          '</d:response>',
      )
    }
    pushEntry(rel, true)
    if (depth !== '0') {
      const prefix = rel.length > 0 ? `${rel}/` : ''
      for (const [filePath] of files) {
        if (!filePath.startsWith(prefix)) continue
        const rest = filePath.slice(prefix.length)
        if (rest.length === 0 || rest.includes('/')) continue
        pushEntry(filePath, false)
      }
      for (const dir of dirs) {
        if (dir.length === 0 || dir === rel) continue
        if (!dir.startsWith(prefix)) continue
        const rest = dir.slice(prefix.length)
        if (rest.length === 0 || rest.includes('/')) continue
        pushEntry(dir, true)
      }
    }
    return `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${rows.join('')}</d:multistatus>`
  }

  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      void (async () => {
        const body = Buffer.concat(chunks)
        const url = new URL(req.url, 'http://127.0.0.1')
        const decoded = url.pathname.split('/').map((segment) => decodeURIComponent(segment)).join('/')
        let rel = null
        if (decoded === BASE_PATH) rel = ''
        else if (decoded.startsWith(`${BASE_PATH}/`)) rel = decoded.slice(BASE_PATH.length + 1).replace(/\/+$/, '')
        requests.push({ method: req.method, path: decoded, rel, auth: req.headers.authorization ?? null })

        if (rel === null) {
          res.writeHead(404, { 'Content-Type': 'text/plain' })
          res.end('Not Found\n')
          return
        }

        const auth = req.headers.authorization ?? ''
        const credentials = auth.startsWith('Basic ') ? Buffer.from(auth.slice(6), 'base64').toString('utf8') : ''
        if (credentials !== `${USER}:${PASSWORD}`) {
          res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Test"', 'Content-Type': 'text/plain' })
          res.end('Not Authorized\n')
          return
        }

        const failure = failures.find((entry) => entry.method === req.method && entry.remaining > 0)
        if (failure !== undefined) {
          failure.remaining -= 1
          res.writeHead(failure.status, { 'Content-Type': 'text/plain' })
          res.end('temporarily unavailable\n')
          return
        }

        if (req.method === 'PROPFIND') {
          if (rel !== '' && !dirs.has(rel)) {
            res.writeHead(404, { 'Content-Type': 'text/plain' })
            res.end('Not Found\n')
            return
          }
          const xml = responseXml(rel, req.headers.depth ?? '1')
          res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' })
          res.end(xml)
          return
        }

        if (req.method === 'MKCOL') {
          if (dirs.has(rel)) {
            res.writeHead(405, { Allow: 'PROPFIND' })
            res.end()
            return
          }
          const parent = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
          if (!dirs.has(parent)) {
            res.writeHead(409)
            res.end()
            return
          }
          dirs.add(rel)
          res.writeHead(201)
          res.end()
          return
        }

        if (req.method === 'PUT') {
          const parent = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
          if (!dirs.has(parent)) {
            res.writeHead(409)
            res.end()
            return
          }
          const exists = files.has(rel)
          files.set(rel, {
            body,
            mtimeMs: Date.now() + state.clockOffset,
            etag: `"${sha1(body)}"`,
          })
          res.writeHead(exists ? 204 : 201, { ETag: `"${sha1(body)}"` })
          res.end()
          return
        }

        if (req.method === 'GET') {
          const file = files.get(rel)
          if (file === undefined) {
            res.writeHead(404)
            res.end()
            return
          }
          res.writeHead(200, { 'Content-Type': 'application/octet-stream', ETag: file.etag, 'Content-Length': file.body.length })
          res.end(file.body)
          return
        }

        if (req.method === 'DELETE') {
          if (!files.has(rel)) {
            res.writeHead(404)
            res.end()
            return
          }
          files.delete(rel)
          res.writeHead(204)
          res.end()
          return
        }

        res.writeHead(405)
        res.end()
      })()
    })
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  state.port = server.address().port

  return {
    url: `http://127.0.0.1:${state.port}`,
    files,
    dirs,
    requests,
    setFile(rel, text, { mtimeMs } = {}) {
      const body = Buffer.from(text, 'utf8')
      let parent = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
      while (parent.length > 0 && !dirs.has(parent)) {
        dirs.add(parent)
        parent = parent.includes('/') ? parent.slice(0, parent.lastIndexOf('/')) : ''
      }
      files.set(rel, { body, mtimeMs: mtimeMs ?? Date.now() + state.clockOffset, etag: `"${sha1(body)}"` })
    },
    text(rel) {
      const file = files.get(rel)
      return file === undefined ? null : file.body.toString('utf8')
    },
    has(rel) {
      return files.has(rel)
    },
    failNext(method, times, status = 503) {
      failures.push({ method, remaining: times, status })
    },
    touch(rel, deltaMs) {
      const file = files.get(rel)
      if (file !== undefined) file.mtimeMs += deltaMs
    },
    async close() {
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

/* ------------------------------------------------------------------------- */
/* Setup                                                                     */
/* ------------------------------------------------------------------------- */

async function writeVault(rel, text) {
  const abs = join(VAULT, rel)
  await fsp.mkdir(dirname(abs), { recursive: true })
  await fsp.writeFile(abs, text, 'utf8')
}

async function readVault(rel) {
  return fsp.readFile(join(VAULT, rel), 'utf8')
}

async function vaultExists(rel) {
  try {
    await fsp.stat(join(VAULT, rel))
    return true
  } catch {
    return false
  }
}

async function listTrash() {
  const out = []
  async function walk(dir, prefix) {
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const abs = join(dir, entry.name)
      const rel = prefix.length > 0 ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) await walk(abs, rel)
      else out.push(rel)
    }
  }
  await walk(join(VAULT, '.trash'), '')
  return out.sort()
}

await fsp.rm(ROOT, { recursive: true, force: true })
await fsp.mkdir(VAULT, { recursive: true })

const dav = await startMockDav()
let service = null

function makeService() {
  return createSyncService({ root: VAULT })
}

/* ------------------------------------------------------------------------- */
/* Scenario                                                                  */
/* ------------------------------------------------------------------------- */

await check('webdav settings are written to <vault>/.dsh-notebook/sync.json and survive', async () => {
  service = makeService()
  await service.saveSettings({
    provider: 'webdav',
    webdav: { url: `${dav.url}${BASE_PATH}`, username: USER, password: PASSWORD },
    auto: { onSave: true, intervalMinutes: 0 },
  })
  const raw = JSON.parse(await fsp.readFile(service.settingsPath, 'utf8'))
  assert.equal(raw.provider, 'webdav')
  assert.equal(raw.webdav.url, `${dav.url}${BASE_PATH}`)
  const status = await service.status()
  assert.equal(status.provider, 'webdav')
  assert.equal(status.settings.webdav.password, PASSWORD)
  const mode = (await fsp.stat(service.settingsPath)).mode & 0o777
  assert.equal(mode, 0o600, `settings file mode should be 0600, got ${mode.toString(8)}`)
})

await check('test connection creates the base collection and reports the remote file count', async () => {
  const probe = await service.testConnection()
  assert.equal(probe.ok, true)
  assert.equal(probe.provider, 'webdav')
  assert.equal(dav.dirs.has(''), true)
  assert.equal(probe.remoteFiles, 0)
})

await check('first sync uploads new local notes and records the manifest', async () => {
  await writeVault('欢迎.md', '# 欢迎\n\n第一篇笔记。\n')
  await writeVault('笔记/项目/设计.md', '# 设计\n\n内容。\n')
  const result = await service.run({ trigger: 'manual' })
  assert.equal(result.ok, true, JSON.stringify(result.errors))
  assert.equal(result.uploaded, 2)
  assert.equal(dav.text('欢迎.md'), '# 欢迎\n\n第一篇笔记。\n')
  assert.equal(dav.text('笔记/项目/设计.md'), '# 设计\n\n内容。\n')
  const state = JSON.parse(await fsp.readFile(service.statePath, 'utf8'))
  assert.equal(Object.keys(state.files).length, 2)
  assert.equal(state.key, `webdav:${dav.url}${BASE_PATH}`)
  // The manifest and settings must never be mirrored.
  assert.equal(dav.has('.dsh-notebook/sync.json'), false)
})

await check('a second sync with no changes moves nothing', async () => {
  const before = dav.requests.length
  const result = await service.run({ trigger: 'manual' })
  assert.equal(result.uploaded, 0)
  assert.equal(result.downloaded, 0)
  assert.equal(result.skipped, 2)
  assert.ok(dav.requests.length - before < 10, 'an unchanged run should not transfer files')
})

await check('a transient WebDAV 503 is retried instead of failing the sync', async () => {
  await writeVault('重试.md', '# 重试\n\n503 之后仍然上传\n')
  dav.failNext('PROPFIND', 2, 503)
  const result = await service.run({ trigger: 'manual' })
  assert.equal(result.ok, true, JSON.stringify(result.errors))
  assert.equal(result.uploaded, 1, JSON.stringify(result.errors))
  assert.equal(dav.has('重试.md'), true)
})

await check('a local edit is uploaded', async () => {
  await writeVault('欢迎.md', '# 欢迎\n\n改过的内容。\n')
  const result = await service.run({ trigger: 'manual' })
  assert.equal(result.uploaded, 1)
  assert.equal(dav.text('欢迎.md'), '# 欢迎\n\n改过的内容。\n')
})

await check('a remote edit is downloaded', async () => {
  dav.setFile('笔记/项目/设计.md', '# 设计\n\n远程改的内容。\n', { mtimeMs: Date.now() + 5000 })
  const result = await service.run({ trigger: 'manual' })
  assert.equal(result.downloaded, 1, JSON.stringify(result.errors))
  assert.equal(await readVault('笔记/项目/设计.md'), '# 设计\n\n远程改的内容。\n')
})

await check('both sides edited: local wins, the remote copy is kept as a conflict note', async () => {
  await writeVault('欢迎.md', '# 欢迎\n\n本地新内容。\n')
  dav.setFile('欢迎.md', '# 欢迎\n\n远端新内容。\n', { mtimeMs: Date.now() + 5000 })
  const result = await service.run({ trigger: 'manual' })
  assert.equal(result.ok, true, JSON.stringify(result.errors))
  assert.equal(result.conflicts, 1)
  assert.equal(await readVault('欢迎.md'), '# 欢迎\n\n本地新内容。\n')
  assert.equal(dav.text('欢迎.md'), '# 欢迎\n\n本地新内容。\n')
  const copies = (await fsp.readdir(VAULT)).filter((name) => name.includes('冲突'))
  assert.equal(copies.length, 1, `expected one conflict copy, found ${copies.join(', ')}`)
  assert.equal(await readVault(copies[0]), '# 欢迎\n\n远端新内容。\n')
  // A conflict copy is itself uploaded on the next run.
  const next = await service.run({ trigger: 'manual' })
  assert.equal(dav.has(copies[0]), true, JSON.stringify(next.errors))
})

await check('deleting a note locally removes the remote copy and keeps a backup', async () => {
  await fsp.rm(join(VAULT, '欢迎.md'))
  const result = await service.run({ trigger: 'manual' })
  assert.equal(result.deletedRemote, 1, JSON.stringify(result.errors))
  assert.equal(dav.has('欢迎.md'), false)
  const trash = await listTrash()
  const backup = trash.find((rel) => rel.includes('sync-local-delete') && rel.endsWith('欢迎.md'))
  assert.ok(backup, `no local-delete backup in trash: ${trash.join(', ')}`)
  assert.match(await readVault(`.trash/${backup}`), /本地新内容/)
})

await check('deleting a note remotely removes the local copy and keeps a backup', async () => {
  dav.setFile('笔记/项目/设计.md', '# 设计\n\n远程删前内容。\n')
  await service.run({ trigger: 'manual' })
  dav.files.delete('笔记/项目/设计.md')
  const result = await service.run({ trigger: 'manual' })
  assert.equal(result.deletedLocal, 1, JSON.stringify(result.errors))
  assert.equal(await vaultExists('笔记/项目/设计.md'), false)
  const trash = await listTrash()
  const backup = trash.find((rel) => rel.includes('sync-remote-delete') && rel.endsWith('设计.md'))
  assert.ok(backup, `no remote-delete backup in trash: ${trash.join(', ')}`)
  assert.match(await readVault(`.trash/${backup}`), /远程删前内容/)
})

await check('a first sync with both sides holding a file keeps the newer copy and backs up the other', async () => {
  await fsp.rm(join(VAULT, '.dsh-notebook', 'sync-state.json'), { force: true })
  await writeVault('碰撞.md', '# 碰撞\n\n本地版本。\n')
  dav.setFile('碰撞.md', '# 碰撞\n\n远端版本，更新。\n', { mtimeMs: Date.now() + 60000 })
  const result = await service.run({ trigger: 'manual' })
  assert.equal(result.ok, true, JSON.stringify(result.errors))
  assert.equal(result.merged, 1)
  assert.equal(await readVault('碰撞.md'), '# 碰撞\n\n远端版本，更新。\n')
  const trash = await listTrash()
  const backup = trash.find((rel) => rel.startsWith('first-sync-') && rel.endsWith('碰撞.md'))
  assert.ok(backup, `no first-sync backup: ${trash.join(', ')}`)
  assert.match(await readVault(`.trash/${backup}`), /本地版本/)
})

await check('CJK names, spaces and nested folders survive a round trip', async () => {
  await writeVault('笔记/06 临时/一篇 笔记.md', '# 空格与中文\n\nok\n')
  const up = await service.run({ trigger: 'manual' })
  assert.equal(up.ok, true, JSON.stringify(up.errors))
  assert.ok(dav.has('笔记/06 临时/一篇 笔记.md'), 'remote path missing')
  dav.setFile('远程/新增 文件.md', '# 远端新建\n\n内容\n', { mtimeMs: Date.now() + 1000 })
  const down = await service.run({ trigger: 'manual' })
  assert.equal(down.ok, true, JSON.stringify(down.errors))
  assert.equal(down.downloaded, 1)
  assert.equal(await readVault('远程/新增 文件.md'), '# 远端新建\n\n内容\n')
})

await check('bad credentials fail with webdav_unauthorized and change nothing', async () => {
  await service.saveSettings({ webdav: { password: 'wrong-password' } })
  await assert.rejects(service.run({ trigger: 'manual' }), (error) => {
    assert.equal(error.code, 'webdav_unauthorized')
    assert.match(error.message, /401/)
    return true
  })
  const status = await service.status()
  assert.equal(status.lastResult.ok, false)
  assert.equal(status.lastResult.error.code, 'webdav_unauthorized')
  await service.saveSettings({ webdav: { password: PASSWORD } })
})

await check('the mass-delete guard stops a run that would remove a large share of synced files', async () => {
  for (let index = 0; index < 30; index += 1) {
    await writeVault(`批量/文件-${index}.md`, `# 文件 ${index}\n`)
  }
  const first = await service.run({ trigger: 'manual' })
  assert.equal(first.ok, true, JSON.stringify(first.errors))
  assert.equal(first.uploaded, 30)
  for (let index = 0; index < 12; index += 1) {
    await fsp.rm(join(VAULT, `批量/文件-${index}.md`))
  }
  await assert.rejects(service.run({ trigger: 'manual' }), (error) => {
    assert.equal(error.code, 'too_many_deletes', error.message)
    return true
  })
  assert.equal(dav.has('批量/文件-0.md'), true, 'nothing may be deleted when the guard trips')
  assert.equal(await vaultExists('批量/文件-0.md'), false)
})

await check('a missing parent on the server is reported as webdav, not as a generic 500', async () => {
  const isolated = createSyncService({ root: VAULT })
  await isolated.saveSettings({
    provider: 'webdav',
    webdav: { url: `${dav.url}/missing-parent/notes`, username: USER, password: PASSWORD },
  })
  await assert.rejects(isolated.testConnection(), (error) => {
    assert.equal(error.code, 'webdav_not_found', error.message)
    return true
  })
  await isolated.dispose()
})

await check('status reports provider, tracked files and the last run', async () => {
  const status = await service.status()
  assert.equal(status.provider, 'webdav')
  assert.equal(status.busy, false)
  assert.ok(status.state.files > 0)
  assert.equal(typeof status.state.lastSyncAt, 'number')
  assert.equal(status.lastResult.provider, 'webdav')
})

await service.dispose()
await dav.close()
await fsp.rm(ROOT, { recursive: true, force: true })

console.log(`\nSUMMARY: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  for (const failure of failures) console.log(`  - ${failure.name}`)
  process.exitCode = 1
}
