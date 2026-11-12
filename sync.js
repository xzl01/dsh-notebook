/**
 * Sync engine for the notebook bundle.
 *
 * Two providers mirror the vault on disk to somewhere else:
 *
 *   webdav — a WebDAV folder (Nextcloud, Alist, Synology, nginx-dav, ...), using
 *            PROPFIND / MKCOL / PUT / GET / DELETE. A JSON manifest records the
 *            content hash and remote ETag that both sides agreed on last time,
 *            so a three-way comparison finds local edits, remote edits, and the
 *            cases where both sides changed.
 *   git    — the vault as a working tree: commit local changes, replay the
 *            remote branch, push. Credentials come from the user's own git
 *            configuration (ssh key, credential helper), never from this file.
 *
 * The manifest and settings live in `<vault>/.dsh-notebook/`, which is hidden
 * from the notebook index, excluded from WebDAV sync by the dot-folder rule, and
 * added to the repository's `.git/info/exclude` so it is never committed.
 *
 * Node built-ins only: the bundle is linked into a profile and cannot resolve
 * packages from the DSH installation.
 */

import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { promises as fsp } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Hidden folder inside the vault that holds settings, the manifest, and backups. */
export const SYNC_DIR = '.dsh-notebook'
const SETTINGS_FILE = 'sync.json'
const STATE_FILE = 'sync-state.json'

/** Directories never mirrored, on either side. Dot folders are skipped everywhere. */
const SKIP_DIRS = new Set(['node_modules'])

const MAX_FILES = 20000
const MAX_FILE_BYTES = 64 * 1024 * 1024
const MAX_DELETES_PER_RUN = 200
const DELETE_RATIO = 0.25
const CONCURRENCY = 4
const META_TIMEOUT_MS = 30000
const TRANSFER_TIMEOUT_MS = 120000
const GIT_LOCAL_TIMEOUT_MS = 30000
const GIT_REMOTE_TIMEOUT_MS = 60000
/** Test hook: cap every git command at one value (see test/host-sync-git.mjs). */
const GIT_TIMEOUT_OVERRIDE = (() => {
  const raw = Number(process.env.DSH_NOTEBOOK_GIT_TIMEOUT_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : 0
})()
const GIT_TIMEOUT_MS = GIT_TIMEOUT_OVERRIDE || GIT_LOCAL_TIMEOUT_MS
const SAVE_DEBOUNCE_MS = 4000

const PROVIDERS = new Set(['off', 'webdav', 'git'])
const DELETE_POLICIES = new Set(['trash', 'keep'])

const PROPFIND_BODY =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<d:propfind xmlns:d="DAV:"><d:prop>' +
  '<d:getetag/><d:getcontentlength/><d:getlastmodified/><d:resourcetype/>' +
  '</d:prop></d:propfind>'

export const DEFAULT_SETTINGS = {
  version: 1,
  provider: 'off',
  webdav: { url: '', username: '', password: '', remotePath: '' },
  git: { remote: '', branch: '', message: '', username: '', password: '', useSystemSsh: false },
  auto: { onSave: false, intervalMinutes: 0 },
  /** 'trash' keeps a recoverable copy of anything a sync would delete; 'keep' never deletes. */
  deletes: 'trash',
}

/** A failure the panel can localize from `code`; `detail` is raw server or git output. */
export class SyncError extends Error {
  constructor(code, message, detail) {
    super(message)
    this.name = 'SyncError'
    this.code = code
    this.detail = typeof detail === 'string' ? detail.slice(0, 4000) : undefined
  }
}

/* ------------------------------------------------------------------------- */
/* Settings                                                                  */
/* ------------------------------------------------------------------------- */

function text(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback
}

function normalizeSettings(raw) {
  const input = raw !== null && typeof raw === 'object' ? raw : {}
  const webdav = input.webdav !== null && typeof input.webdav === 'object' ? input.webdav : {}
  const git = input.git !== null && typeof input.git === 'object' ? input.git : {}
  const auto = input.auto !== null && typeof input.auto === 'object' ? input.auto : {}
  const provider = PROVIDERS.has(input.provider) ? input.provider : DEFAULT_SETTINGS.provider
  const minutes = Number(auto.intervalMinutes)
  return {
    version: 1,
    provider,
    webdav: {
      url: text(webdav.url),
      username: text(webdav.username),
      // A password is opaque: keep its exact bytes, only drop accidental padding.
      password: typeof webdav.password === 'string' ? webdav.password.replace(/^\s+|\s+$/g, '') : '',
      remotePath: text(webdav.remotePath).replace(/^\/+|\/+$/g, ''),
    },
    git: {
      remote: text(git.remote).replace(/\/+$/, ''),
      branch: text(git.branch),
      message: text(git.message),
      username: text(git.username),
      // Keep the exact token bytes; only trim accidental padding.
      password: typeof git.password === 'string' ? git.password.replace(/^\s+|\s+$/g, '') : '',
      /** Leave ssh exactly as the user configured it (BatchMode blocks passphrase keys). */
      useSystemSsh: git.useSystemSsh === true,
    },
    auto: {
      onSave: auto.onSave === true,
      intervalMinutes: Number.isFinite(minutes) && minutes > 0 ? Math.min(1440, Math.round(minutes)) : 0,
    },
    deletes: DELETE_POLICIES.has(input.deletes) ? input.deletes : DEFAULT_SETTINGS.deletes,
  }
}

/** Merge a partial settings patch into the current settings and validate it. */
function applyPatch(current, patch) {
  const input = patch !== null && typeof patch === 'object' ? patch : {}
  const isObject = (value) => value !== null && typeof value === 'object'
  if (input.provider !== undefined && !PROVIDERS.has(input.provider)) {
    throw new SyncError('sync_invalid_settings', 'Sync provider must be one of: off, webdav, git.')
  }
  if (input.deletes !== undefined && !DELETE_POLICIES.has(input.deletes)) {
    throw new SyncError('sync_invalid_settings', 'Delete handling must be one of: trash, keep.')
  }
  const next = normalizeSettings({
    ...current,
    provider: input.provider === undefined ? current.provider : input.provider,
    deletes: input.deletes === undefined ? current.deletes : input.deletes,
    webdav: { ...current.webdav, ...(isObject(input.webdav) ? input.webdav : {}) },
    git: { ...current.git, ...(isObject(input.git) ? input.git : {}) },
    auto: { ...current.auto, ...(isObject(input.auto) ? input.auto : {}) },
  })
  if (next.provider === 'webdav' && next.webdav.url.length === 0) {
    throw new SyncError('sync_incomplete', 'A WebDAV URL is required before WebDAV sync can be turned on.')
  }
  if (next.provider === 'git' && next.git.branch.length > 0 && /[\s~^:?*[\\]/.test(next.git.branch)) {
    throw new SyncError('sync_invalid_settings', `That is not a valid git branch name: ${next.git.branch}`)
  }
  return next
}

/* ------------------------------------------------------------------------- */
/* Small helpers                                                             */
/* ------------------------------------------------------------------------- */

function slashPath(path) {
  return path.split(sep).join('/')
}

function sha1Buffer(buffer) {
  return createHash('sha1').update(buffer).digest('hex')
}

async function statOrNull(path) {
  try {
    return await fsp.stat(path)
  } catch {
    return null
  }
}

async function readJson(path) {
  try {
    return JSON.parse(await fsp.readFile(path, 'utf8'))
  } catch {
    return null
  }
}

async function writeJsonAtomic(path, value, mode = 0o600) {
  await fsp.mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const body = `${JSON.stringify(value, null, 2)}\n`
  const temp = `${path}.${process.pid}.tmp`
  await fsp.writeFile(temp, body, { encoding: 'utf8', mode })
  await fsp.rename(temp, path)
  await fsp.chmod(path, mode).catch(() => {})
}

function stampForDate(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  )
}

function isInside(base, abs) {
  const rel = relative(base, abs)
  return rel.length > 0 && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

/** Run `worker` over `items` with a fixed number of parallel slots. */
async function mapLimit(items, limit, worker) {
  let cursor = 0
  const width = Math.max(1, Math.min(limit, Math.max(1, items.length)))
  const runners = []
  for (let index = 0; index < width; index += 1) {
    runners.push(
      (async () => {
        for (;;) {
          const current = cursor
          cursor += 1
          if (current >= items.length) return
          await worker(items[current], current)
        }
      })(),
    )
  }
  await Promise.all(runners)
}

/* ------------------------------------------------------------------------- */
/* WebDAV                                                                     */
/* ------------------------------------------------------------------------- */

function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

function stripEtag(value) {
  return String(value ?? '')
    .trim()
    .replace(/^W\//i, '')
}

/**
 * A small WebDAV client. Each instance targets one collection (`basePath`); every
 * method takes a vault-relative path and encodes it per segment, so spaces and
 * CJK filenames work on servers that are strict about percent-encoding.
 */
function createDav(options) {
  const raw = text(options.url)
  if (raw.length === 0) {
    throw new SyncError('sync_incomplete', 'A WebDAV URL is required, for example https://dav.example.com/remote.php/dav/files/me.')
  }
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    throw new SyncError('webdav_url_invalid', `That WebDAV address is not a valid URL: ${raw}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SyncError('webdav_url_invalid', 'The WebDAV address must start with http:// or https://.')
  }
  const baseSegments = parsed.pathname
    .split('/')
    .filter((segment) => segment.length > 0)
    .map(decodeSegment)
  const extraSegments = text(options.remotePath)
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
  const segments = [...baseSegments, ...extraSegments]
  const origin = parsed.origin
  /** Decoded collection path without a trailing slash; '/' at the server root. */
  const basePath = segments.length === 0 ? '' : `/${segments.join('/')}`
  const baseRaw = segments.map((segment) => encodeURIComponent(segment)).join('/')
  const auth =
    text(options.username).length > 0 || text(options.password).length > 0
      ? `Basic ${Buffer.from(`${options.username ?? ''}:${options.password ?? ''}`, 'utf8').toString('base64')}`
      : null

  function urlFor(relPath, { collection = false } = {}) {
    const rel = String(relPath ?? '')
      .split('/')
      .filter((segment) => segment.length > 0)
      .map((segment) => encodeURIComponent(segment))
      .join('/')
    const path = rel.length > 0 ? `${baseRaw}/${rel}` : baseRaw
    const suffix = collection && path.length > 0 ? '/' : ''
    return `${origin}/${path}${suffix}`
  }

  function relFromHref(href) {
    let url
    try {
      url = new URL(String(href), origin)
    } catch {
      return null
    }
    const decoded = url.pathname.split('/').map(decodeSegment).join('/')
    if (basePath.length === 0) {
      const rest = decoded.replace(/^\/+/, '').replace(/\/+$/, '')
      return rest
    }
    if (decoded === basePath) return ''
    if (!decoded.startsWith(`${basePath}/`)) return null
    return decoded.slice(basePath.length + 1).replace(/\/+$/, '')
  }

  const RETRYABLE_METHODS = new Set(['GET', 'PROPFIND', 'MKCOL', 'DELETE'])
  const delay = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))

  async function request(method, url, { body, headers = {}, timeoutMs = META_TIMEOUT_MS, allowed }) {
    // Reads and directory probes are safe to repeat; a transient 5xx or a
    // dropped connection should not fail the whole sync.
    const attempts = RETRYABLE_METHODS.has(method) ? 3 : 1
    let lastError = null
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      let response
      try {
        response = await fetch(url, {
          method,
          headers: {
            ...(auth === null ? {} : { Authorization: auth }),
            'User-Agent': 'dsh-notebook/0.2 webdav-sync',
            ...headers,
          },
          body,
          redirect: 'follow',
          signal: controller.signal,
        })
      } catch (error) {
        const reason = controller.signal.aborted
          ? 'the request timed out'
          : String(error?.cause?.message ?? error?.message ?? error)
        lastError = new SyncError(
          controller.signal.aborted ? 'webdav_timeout' : 'webdav_unreachable',
          `Could not reach the WebDAV server at ${origin}: ${reason}`,
          reason,
        )
        if (attempt < attempts) {
          await delay(300 * attempt * attempt)
          continue
        }
        throw lastError
      } finally {
        clearTimeout(timer)
      }
      if (Array.isArray(allowed) && allowed.includes(response.status)) return response
      const detail = await response.text().catch(() => '')
      if ((response.status === 429 || response.status >= 500) && attempt < attempts) {
        await delay(300 * attempt * attempt)
        continue
      }
      throw davStatusError(method, url, response, detail)
    }
    throw lastError ??
      new SyncError('webdav_error', `The WebDAV request failed: ${method} ${url.replace(origin, '') || '/'}`)
  }

  function davStatusError(method, url, response, detail) {
    const status = response.status
    const hint = response.headers.get('www-authenticate') ?? ''
    const where = `${method} ${url.replace(origin, '') || '/'}`
    const clean = detail.replace(/\s+/g, ' ').trim().slice(0, 300)
    if (status === 401) {
      return new SyncError(
        'webdav_unauthorized',
        `The WebDAV server rejected the credentials (401) on ${where}.${hint.length > 0 ? ` It asked for ${hint}.` : ''}`,
        clean,
      )
    }
    if (status === 403) {
      return new SyncError(
        'webdav_forbidden',
        `The WebDAV server refused this write (403) on ${where}. The account may be read-only, or the folder may not allow PUT/MKCOL.`,
        clean,
      )
    }
    if (status === 404) {
      return new SyncError('webdav_not_found', `The WebDAV path does not exist (404) on ${where}.`, clean)
    }
    if (status === 405) {
      return new SyncError('webdav_method_rejected', `The WebDAV server does not accept ${method} on ${where} (405).`, clean)
    }
    if (status === 409) {
      return new SyncError('webdav_not_found', `A parent folder is missing on the WebDAV server (409) for ${where}.`, clean)
    }
    if (status === 423) {
      return new SyncError('webdav_locked', `The WebDAV resource is locked (423) on ${where}.`, clean)
    }
    if (status === 507) {
      return new SyncError('webdav_quota', `The WebDAV account has no space left (507) on ${where}.`, clean)
    }
    return new SyncError(
      'webdav_error',
      `The WebDAV server answered HTTP ${status} on ${where}${clean.length > 0 ? `: ${clean}` : ''}.`,
      clean,
    )
  }

  function firstTag(block, tag) {
    const match = new RegExp(`<(?:[A-Za-z0-9_-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_-]+:)?${tag}>`, 'i').exec(block)
    if (match === null) return null
    return match[1]
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')
      .trim()
  }

  function parseEntries(xml, relDir) {
    const blocks = xml.match(/<(?:[A-Za-z0-9_-]+:)?response\b[\s\S]*?<\/(?:[A-Za-z0-9_-]+:)?response>/gi) ?? []
    const entries = new Map()
    for (const block of blocks) {
      const href = firstTag(block, 'href')
      if (href === null) continue
      const rel = relFromHref(href)
      if (rel === null || rel.length === 0) continue
      const parent = relDir.length > 0 ? `${relDir}/` : ''
      if (!rel.startsWith(parent)) continue
      const rest = rel.slice(parent.length)
      if (rest.length === 0 || rest.includes('/')) continue
      entries.set(rest, {
        name: rest,
        isDir: /<(?:[A-Za-z0-9_-]+:)?collection\b/i.test(block),
        etag: stripEtag(firstTag(block, 'getetag') ?? ''),
        size: Number(firstTag(block, 'getcontentlength') ?? 0) || 0,
        mtimeMs: Date.parse(firstTag(block, 'getlastmodified') ?? '') || 0,
      })
    }
    return entries
  }

  /** One PROPFIND level; returns a Map of direct children keyed by name. */
  async function list(relDir) {
    const response = await request('PROPFIND', urlFor(relDir, { collection: true }), {
      allowed: [207, 200, 404],
      headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
      body: PROPFIND_BODY,
    })
    if (response.status === 404) return new Map()
    return parseEntries(await response.text(), relDir)
  }

  /** Every file below the base collection, keyed by vault-relative path. */
  async function listAll(onProgress) {
    const files = new Map()
    const queue = ['']
    const seen = new Set()
    while (queue.length > 0 && files.size < MAX_FILES) {
      const dir = queue.shift()
      if (seen.has(dir)) continue
      seen.add(dir)
      const entries = await list(dir)
      for (const [name, info] of entries) {
        const rel = dir.length > 0 ? `${dir}/${name}` : name
        if (info.isDir) queue.push(rel)
        else files.set(rel, info)
      }
      if (typeof onProgress === 'function') onProgress(files.size)
    }
    return files
  }

  /** Create the base collection when it is missing; a no-op when it exists. */
  async function ensureBase() {
    const response = await request('PROPFIND', urlFor('', { collection: true }), {
      allowed: [207, 200, 404],
      headers: { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' },
      body: PROPFIND_BODY,
    })
    if (response.status !== 404) return false
    await request('MKCOL', urlFor('', { collection: true }), { allowed: [200, 201, 405] })
    return true
  }

  async function ensureDir(relDir) {
    const parts = String(relDir ?? '')
      .split('/')
      .filter((segment) => segment.length > 0)
    let prefix = ''
    for (const segment of parts) {
      prefix = prefix.length === 0 ? segment : `${prefix}/${segment}`
      await request('MKCOL', urlFor(prefix, { collection: true }), { allowed: [200, 201, 204, 405] })
    }
  }

  async function stat(relPath) {
    const response = await request('PROPFIND', urlFor(relPath), {
      allowed: [207, 200],
      headers: { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' },
      body: PROPFIND_BODY,
    })
    const xml = await response.text()
    return {
      etag: stripEtag(firstTag(xml, 'getetag') ?? ''),
      size: Number(firstTag(xml, 'getcontentlength') ?? 0) || 0,
      mtimeMs: Date.parse(firstTag(xml, 'getlastmodified') ?? '') || 0,
    }
  }

  async function put(relPath, buffer) {
    const dir = slashPath(dirname(relPath))
    await ensureDir(dir === '.' ? '' : dir)
    const response = await request('PUT', urlFor(relPath), {
      allowed: [200, 201, 204],
      body: buffer,
      timeoutMs: TRANSFER_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/octet-stream' },
    })
    const headerTag = stripEtag(response.headers.get('etag') ?? '')
    if (headerTag.length > 0) {
      return { etag: headerTag, size: buffer.length, mtimeMs: 0 }
    }
    return stat(relPath).catch(() => ({ etag: '', size: buffer.length, mtimeMs: 0 }))
  }

  async function get(relPath) {
    const response = await request('GET', urlFor(relPath), {
      allowed: [200],
      timeoutMs: TRANSFER_TIMEOUT_MS,
    })
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > MAX_FILE_BYTES) {
      throw new SyncError('webdav_file_too_large', `The remote file is larger than 64 MB: ${relPath}`)
    }
    return buffer
  }

  async function remove(relPath) {
    await request('DELETE', urlFor(relPath), { allowed: [200, 204, 404] })
  }

  /** Verify credentials and write access. Creates the folder if needed, writes and removes one probe file. */
  async function probe() {
    const created = await ensureBase()
    const probeName = `.dsh-notebook-probe-${Date.now().toString(36)}.txt`
    await request('PUT', urlFor(probeName), { allowed: [200, 201, 204], body: Buffer.from('ok\n') })
    await remove(probeName).catch(() => {})
    return { ok: true, created, path: basePath }
  }

  /** A stable identity for this server+folder, so switching servers starts a fresh manifest. */
  const stateKey = `webdav:${origin}${basePath}`

  return { list, listAll, ensureBase, ensureDir, put, get, remove, stat, probe, stateKey, basePath }
}

/* ------------------------------------------------------------------------- */
/* git                                                                        */
/* ------------------------------------------------------------------------- */

/**
 * Run one git command inside the vault. Output is captured; a non-zero exit
 * becomes a SyncError carrying stderr so the panel can show the real reason.
 */
function runGit(args, { cwd, timeoutMs = GIT_TIMEOUT_MS, allowFailure = false, auth = null, systemSsh = false } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    let child
    const credential = auth === null ? { args: [], env: {} } : gitCredentialPrefix(auth.username, auth.password)
    try {
      child = spawn('git', [...credential.args, ...args], {
        cwd,
        // Own process group: killing git must also kill the ssh/curl children it
        // started, otherwise they hold the pipes and a timeout never settles.
        detached: process.platform !== 'win32',
        env: {
          ...process.env,
          // Never block on an interactive credential prompt: fail and report instead.
          GIT_TERMINAL_PROMPT: '0',
          GIT_ASKPASS: process.env.GIT_ASKPASS ?? 'echo',
          LC_ALL: process.env.LC_ALL ?? 'C',
          ...credential.env,
          // An unreachable ssh host otherwise waits for the TCP timeout and can
          // ask for a passphrase; BatchMode + ConnectTimeout makes it fail fast.
          // Users who need the Keychain/passphrase prompt can opt out.
          ...(systemSsh === true
            ? {}
            : {
                GIT_SSH_COMMAND:
                  process.env.GIT_SSH_COMMAND ??
                  'ssh -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=5 -o ServerAliveCountMax=3',
              }),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      rejectPromise(new SyncError('git_missing', 'The git executable could not be started. Install git and try again.', String(error)))
      return
    }
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    const killTree = () => {
      if (child.pid === undefined) return
      try {
        if (process.platform === 'win32') child.kill('SIGKILL')
        else process.kill(-child.pid, 'SIGKILL')
      } catch {
        try {
          child.kill('SIGKILL')
        } catch {
          /* already gone */
        }
      }
      for (const stream of [child.stdout, child.stderr]) {
        try {
          if (stream !== null && typeof stream.destroy === 'function') stream.destroy()
        } catch {
          /* pipes are best-effort while killing */
        }
      }
    }

    const finish = (fn) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }

    const timer = setTimeout(() => {
      timedOut = true
      killTree()
      // Settle even if 'close' never arrives because a grandchild kept a pipe.
      finish(() => {
        rejectPromise(
          new SyncError(
            'git_timeout',
            `git ${args[0]} did not finish within ${Math.round(timeoutMs / 1000)}s. The remote is likely unreachable or waiting for credentials.`,
            stderr,
          ),
        )
      })
    }, timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()

    child.stdout.on('data', (chunk) => {
      stdout += chunk
      if (stdout.length > 4 * 1024 * 1024) stdout = stdout.slice(-1024 * 1024)
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
      if (stderr.length > 4 * 1024 * 1024) stderr = stderr.slice(-1024 * 1024)
    })
    child.on('error', (error) => {
      finish(() =>
        rejectPromise(new SyncError('git_missing', `git ${args[0]} could not run: ${error.message}`, String(error))),
      )
    })
    // 'exit' fires before 'close'; using it means a lingering grandchild pipe
    // cannot keep the promise pending.
    const settle = (code) => {
      if (timedOut) {
        finish(() =>
          rejectPromise(
            new SyncError(
              'git_timeout',
              `git ${args[0]} timed out after ${Math.round(timeoutMs / 1000)}s and was stopped. Check the remote URL and the network.`,
              stderr,
            ),
          ),
        )
        return
      }
      if (code === 0 || allowFailure) {
        finish(() => resolvePromise({ code, stdout, stderr }))
        return
      }
      finish(() => rejectPromise(classifyGitFailure(args, code, stdout, stderr)))
    }
    child.on('exit', settle)
    child.on('close', settle)
  })
}

/**
 * Credentials for an HTTP(S) git remote. A background sync has no terminal, so
 * the only options are a stored helper or these settings; the helper reads the
 * secret from the environment, keeping it out of `ps` output.
 */
export const GIT_CREDENTIAL_HELPER =
  '!f() { test "$1" = get || exit 0; printf "username=%s\\npassword=%s\\n" "$DSH_GIT_USERNAME" "$DSH_GIT_PASSWORD"; }; f'

export function gitCredentialPrefix(username, password) {
  const user = typeof username === 'string' ? username : ''
  const secret = typeof password === 'string' ? password : ''
  if (user.length === 0 && secret.length === 0) return { args: [], env: {} }
  return {
    args: ['-c', 'credential.helper=', '-c', `credential.helper=${GIT_CREDENTIAL_HELPER}`],
    env: { DSH_GIT_USERNAME: user, DSH_GIT_PASSWORD: secret },
  }
}

function classifyGitFailure(args, code, stdout, stderr) {
  const text = `${stderr}\n${stdout}`.trim()
  if (/Authentication failed|could not read Username|terminal prompts disabled|Permission denied \(publickey\)|Invalid username or password|403 Forbidden/i.test(text)) {
    return new SyncError(
      'git_auth',
      'The git remote rejected the credentials. For an HTTP(S) remote, fill in the git username and password/token in the sync settings; for SSH, make sure the ssh key or credential helper is available.',
      text,
    )
  }
  if (
    /Could not resolve host|unable to access|Connection (refused|timed out|reset)|Network is unreachable|No route to host|Operation timed out|ssh: connect to host|Connection timed out|Temporary failure in name resolution/i.test(
      text,
    )
  ) {
    return new SyncError('git_unreachable', 'The git remote could not be reached. Check the network and the remote URL.', text)
  }
  if (/CONFLICT|could not apply|Resolve all conflicts|needs merge/i.test(text)) {
    return new SyncError('git_conflict', 'The remote branch conflicts with local changes. Resolve the marked files in git, then sync again.', text)
  }
  const summary = text.split('\n').filter(Boolean).slice(-3).join(' | ')
  return new SyncError('git_error', `git ${args[0]} failed (exit ${code})${summary.length > 0 ? `: ${summary}` : '.'}`, text)
}

/* ------------------------------------------------------------------------- */
/* The service                                                                */
/* ------------------------------------------------------------------------- */

/**
 * @param {object} options
 * @param {string|null} options.root absolute vault path, or null when there is none
 * @param {() => number} [options.now] clock, injectable for tests
 */
export function createSyncService({ root, now = () => Date.now() }) {
  const settingsPath = root === null ? null : join(root, SYNC_DIR, SETTINGS_FILE)
  const statePath = root === null ? null : join(root, SYNC_DIR, STATE_FILE)

  let cache = null
  /** In-flight eager load, so a save that lands during startup cannot lose to it. */
  let loading = null
  /** @type {{phase: string, done: number, total: number, path: string|null}} */
  let progress = { phase: 'idle', done: 0, total: 0, path: null }
  let active = null
  let intervalTimer = null
  let saveTimer = null
  let lastResult = null
  let disposed = false
  const runs = []

  const stamp = () => stampForDate(new Date(now()))

  function requireRoot() {
    if (root === null) {
      throw new SyncError('no_vault', 'No notebook vault is configured, so there is nothing to sync.')
    }
    return root
  }

  function settings() {
    if (cache !== null) return Promise.resolve(cache)
    if (loading === null) {
      loading = (async () => {
        if (settingsPath === null) return normalizeSettings(DEFAULT_SETTINGS)
        const saved = await readJson(settingsPath)
        return normalizeSettings(saved ?? DEFAULT_SETTINGS)
      })().then((value) => {
        // A save may have landed while the read was in flight: never undo it.
        if (cache === null) cache = value
        return cache
      })
    }
    return loading
  }

  async function persistSettings(next) {
    cache = next
    loading = Promise.resolve(next)
    if (settingsPath !== null) await writeJsonAtomic(settingsPath, next)
    reschedule()
    return next
  }

  function reschedule() {
    if (intervalTimer !== null) {
      clearInterval(intervalTimer)
      intervalTimer = null
    }
    if (disposed || cache === null || cache.provider === 'off' || cache.auto.intervalMinutes <= 0) return
    intervalTimer = setInterval(() => {
      run({ trigger: 'interval' }).catch(() => {})
    }, cache.auto.intervalMinutes * 60 * 1000)
    if (typeof intervalTimer.unref === 'function') intervalTimer.unref()
  }

  async function loadState(stateKey) {
    if (statePath === null) return { version: 1, key: stateKey, files: {}, lastSyncAt: null }
    const saved = await readJson(statePath)
    const usable =
      saved !== null &&
      typeof saved === 'object' &&
      saved.key === stateKey &&
      saved.files !== null &&
      typeof saved.files === 'object' &&
      !Array.isArray(saved.files)
    if (!usable) return { version: 1, key: stateKey, files: {}, lastSyncAt: null }
    return saved
  }

  async function saveState(state) {
    if (statePath === null) return
    await writeJsonAtomic(statePath, state).catch(() => {})
  }

  /** Files in the vault that take part in sync: everything except hidden folders. */
  async function scanLocal() {
    const base = requireRoot()
    const files = new Map()
    let truncated = false
    async function walk(dir) {
      if (files.size >= MAX_FILES) {
        truncated = true
        return
      }
      const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])
      entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        if (SKIP_DIRS.has(entry.name)) continue
        const abs = join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(abs)
          continue
        }
        if (!entry.isFile()) continue
        const stats = await statOrNull(abs)
        if (stats === null) continue
        if (!isInside(base, abs)) continue
        files.set(slashPath(relative(base, abs)), { size: stats.size, mtimeMs: Math.round(stats.mtimeMs) })
        if (files.size >= MAX_FILES) {
          truncated = true
          return
        }
      }
    }
    await walk(base)
    return { files, truncated }
  }

  function remoteTag(entry) {
    if (entry.etag.length > 0) return `e:${entry.etag}`
    return `m:${entry.size}:${entry.mtimeMs}`
  }

  /** Hash a local file, reusing the manifest's hash while size and mtime still match. */
  async function localHash(rel, entry, state) {
    const known = state.files[rel]
    if (
      known !== undefined &&
      known.mtimeMs === entry.mtimeMs &&
      known.size === entry.size &&
      typeof known.hash === 'string' &&
      known.hash.length > 0
    ) {
      return known.hash
    }
    return sha1Buffer(await fsp.readFile(join(requireRoot(), rel)))
  }

  async function writeLocalAtomic(rel, buffer, expectedMtimeMs) {
    const base = requireRoot()
    const abs = resolve(base, rel)
    if (!isInside(base, abs)) throw new SyncError('invalid_path', `Refusing to write outside the vault: ${rel}`)
    const current = await statOrNull(abs)
    if (
      current !== null &&
      Number.isFinite(Number(expectedMtimeMs)) &&
      Number(expectedMtimeMs) > 0 &&
      Math.abs(current.mtimeMs - Number(expectedMtimeMs)) > 2
    ) {
      throw new SyncError('local_changed', 'The local file changed while the sync was running; it was left alone.', rel)
    }
    await fsp.mkdir(dirname(abs), { recursive: true })
    const temp = `${abs}.${process.pid}.sync.tmp`
    try {
      await fsp.writeFile(temp, buffer)
      await fsp.rename(temp, abs)
    } catch (error) {
      await fsp.rm(temp, { force: true }).catch(() => {})
      throw error
    }
    const stats = await fsp.stat(abs)
    return { size: stats.size, mtimeMs: Math.round(stats.mtimeMs) }
  }

  /** Write a recoverable copy under the vault trash instead of deleting outright. */
  async function trashCopy(rel, buffer, prefix) {
    const base = requireRoot()
    const target = `${prefix}${rel}`.replace(/^\/+/, '')
    if (!isInside(base, resolve(base, target))) {
      throw new SyncError('invalid_path', `Refusing to write outside the vault: ${target}`)
    }
    await writeLocalAtomic(target, buffer, 0)
    return target
  }

  async function conflictCopy(rel, buffer) {
    const base = requireRoot()
    const ext = extname(rel)
    const stem = ext.length > 0 ? rel.slice(0, rel.length - ext.length) : rel
    let candidate = `${stem} (冲突 ${stamp()})${ext}`
    let attempt = 1
    while ((await statOrNull(join(base, candidate))) !== null) {
      attempt += 1
      candidate = `${stem} (冲突 ${stamp()}-${attempt})${ext}`
    }
    await writeLocalAtomic(candidate, buffer, 0)
    return candidate
  }

  function newResult(provider, trigger) {
    return {
      id: `sync-${now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      provider,
      trigger,
      startedAt: now(),
      endedAt: null,
      ok: false,
      uploaded: 0,
      downloaded: 0,
      deletedLocal: 0,
      deletedRemote: 0,
      conflicts: 0,
      merged: 0,
      committed: 0,
      pulled: 0,
      pushed: 0,
      skipped: 0,
      bytesUp: 0,
      bytesDown: 0,
      truncated: false,
      errors: [],
      notes: [],
      error: null,
    }
  }

  function record(result) {
    lastResult = result
    runs.unshift(result)
    if (runs.length > 20) runs.length = 20
  }

  async function testConnection() {
    const config = await settings()
    if (config.provider === 'off') {
      return { ok: true, provider: 'off', message: 'Sync is off.', stateKey: null }
    }
    if (config.provider === 'webdav') {
      const dav = createDav(config.webdav)
      const probe = await dav.probe()
      const files = await dav.listAll()
      return {
        ok: true,
        provider: 'webdav',
        message: `WebDAV OK — ${dav.basePath || '/'}${probe.created ? ' (folder created)' : ''}, ${files.size} file(s) remote`,
        remoteFiles: files.size,
        stateKey: dav.stateKey,
      }
    }
    const base = requireRoot()
    await runGit(['--version'], { cwd: base })
    const repo = (await statOrNull(join(base, '.git'))) !== null
    const remote = config.git.remote
    if (remote.length === 0) {
      return {
        ok: true,
        provider: 'git',
        message: repo
          ? 'git OK — local repository; commits stay on this machine until a remote URL is set.'
          : 'git OK — the vault will be initialized as a repository on the first sync.',
        repository: repo,
      }
    }
    const branch = config.git.branch.length > 0 ? config.git.branch : 'main'
    const result = await runGit(['-c', 'http.lowSpeedLimit=1000', '-c', 'http.lowSpeedTime=20', 'ls-remote', '--heads', remote, branch], {
      cwd: base,
      timeoutMs: GIT_TIMEOUT_OVERRIDE || GIT_REMOTE_TIMEOUT_MS,
      auth: { username: config.git.username, password: config.git.password },
      systemSsh: config.git.useSystemSsh === true,
    })
    const hasBranch = result.stdout.trim().length > 0
    return {
      ok: true,
      provider: 'git',
      message: `git OK — ${remote}${hasBranch ? ` has branch ${branch}` : ` has no branch ${branch} yet (the first sync creates it)`}`,
      repository: repo,
      branch,
      remoteBranch: hasBranch,
    }
  }

  /** Collect the vault, the remote listing, and the manifest a run works from. */
  async function prepareWebdav(trigger) {
    const config = await settings()
    const dav = createDav(config.webdav)
    await dav.ensureBase()
    const state = await loadState(dav.stateKey)
    const firstSync = Object.keys(state.files).length === 0
    const localScan = await scanLocal()
    progress = { phase: 'listing', done: 0, total: 0, path: null }
    const remote = await dav.listAll((count) => {
      progress = { phase: 'listing', done: count, total: 0, path: null }
    })
    const result = newResult('webdav', trigger)
    result.truncated = localScan.truncated || remote.size >= MAX_FILES
    return { config, dav, state, firstSync, local: localScan.files, remote, result }
  }

  /**
   * The three-way decision for every path, expressed as jobs. Kept separate from
   * execution so the delete guard can inspect the whole plan before anything is
   * removed.
   */
  async function planWebdav({ state, local, remote, firstSync, config }) {
    const uploads = []
    const downloads = []
    const collisions = []
    const agreements = []
    const deletesLocal = []
    const deletesRemote = []
    const conflicts = []
    const forget = []
    let unchanged = 0

    for (const rel of new Set([...local.keys(), ...remote.keys(), ...Object.keys(state.files)])) {
      const localEntry = local.get(rel)
      const remoteEntry = remote.get(rel)
      const known = state.files[rel]

      if (localEntry !== undefined && remoteEntry !== undefined) {
        if (known === undefined) {
          // Never synced before: the two sides may hold different content. The
          // executor downloads and compares before deciding a winner.
          collisions.push({ rel, remote: remoteEntry, localMtime: localEntry.mtimeMs })
          continue
        }
        const hash = await localHash(rel, localEntry, state)
        const localChanged = hash !== known.hash
        const remoteChanged = remoteTag(remoteEntry) !== known.remoteTag
        if (!localChanged && !remoteChanged) {
          unchanged += 1
          continue
        }
        if (localChanged && !remoteChanged) {
          uploads.push({ rel, hash })
        } else if (!localChanged && remoteChanged) {
          downloads.push({ rel, remote: remoteEntry, localMtime: localEntry.mtimeMs })
        } else {
          conflicts.push({ rel, hash, remote: remoteEntry, localMtime: localEntry.mtimeMs })
        }
        continue
      }

      if (localEntry !== undefined) {
        if (known === undefined) {
          uploads.push({ rel, hash: await localHash(rel, localEntry, state) })
          continue
        }
        const hash = await localHash(rel, localEntry, state)
        if (hash !== known.hash || config.deletes === 'keep') {
          // Edited locally after the remote copy vanished: keep the local work.
          uploads.push({ rel, hash })
        } else {
          deletesLocal.push({ rel })
        }
        continue
      }

      if (remoteEntry !== undefined) {
        if (known === undefined || config.deletes === 'keep') {
          downloads.push({ rel, remote: remoteEntry, localMtime: 0 })
        } else {
          deletesRemote.push({ rel, remote: remoteEntry })
        }
        continue
      }

      forget.push(rel)
    }

    if (!firstSync) {
      const planned = deletesLocal.length + deletesRemote.length
      const tracked = Object.keys(state.files).length
      if (planned > MAX_DELETES_PER_RUN || (tracked > 24 && planned > tracked * DELETE_RATIO)) {
        throw new SyncError(
          'too_many_deletes',
          `This run would delete ${planned} of ${tracked} synced files, so it was stopped before anything was removed. ` +
            'Check the remote folder and the vault path, then sync again.',
        )
      }
    }

    progress = {
      phase: 'transfer',
      done: 0,
      total: uploads.length + downloads.length + collisions.length + conflicts.length + deletesLocal.length + deletesRemote.length,
      path: null,
    }
    return { uploads, downloads, collisions, agreements, deletesLocal, deletesRemote, conflicts, forget, unchanged }
  }

  async function runWebdav(trigger) {
    const { config, dav, state, firstSync, local, remote, result } = await prepareWebdav(trigger)
    const plan = await planWebdav({ config, state, local, remote, firstSync })
    const failures = []
    let done = 0
    const step = (rel) => {
      done += 1
      progress = { phase: 'transfer', done, total: progress.total, path: rel }
    }
    const guard = async (rel, work) => {
      try {
        await work()
      } catch (error) {
        failures.push({
          path: rel,
          code: error?.code ?? 'sync_error',
          message: String(error?.message ?? error),
          detail: error?.detail,
        })
      } finally {
        step(rel)
      }
    }

    await mapLimit(plan.uploads, CONCURRENCY, (job) =>
      guard(job.rel, async () => {
        const abs = join(requireRoot(), job.rel)
        const stats = await statOrNull(abs)
        if (stats === null) {
          result.notes.push(`skipped ${job.rel}: it disappeared during the sync`)
          return
        }
        if (stats.size > MAX_FILE_BYTES) {
          throw new SyncError('file_too_large', `Skipped ${job.rel}: it is larger than 64 MB.`)
        }
        const buffer = await fsp.readFile(abs)
        const meta = await dav.put(job.rel, buffer)
        state.files[job.rel] = {
          hash: sha1Buffer(buffer),
          size: buffer.length,
          mtimeMs: Math.round(stats.mtimeMs),
          remoteTag: remoteTag(meta),
          syncedAt: now(),
        }
        result.uploaded += 1
        result.bytesUp += buffer.length
      }),
    )

    await mapLimit(plan.downloads, CONCURRENCY, (job) =>
      guard(job.rel, async () => {
        const buffer = await dav.get(job.rel)
        const saved = await writeLocalAtomic(job.rel, buffer, job.localMtime)
        state.files[job.rel] = {
          hash: sha1Buffer(buffer),
          size: buffer.length,
          mtimeMs: saved.mtimeMs,
          remoteTag: remoteTag(job.remote),
          syncedAt: now(),
        }
        result.downloaded += 1
        result.bytesDown += buffer.length
      }),
    )

    await mapLimit(plan.collisions, CONCURRENCY, (job) =>
      guard(job.rel, async () => {
        const remoteBuffer = await dav.get(job.rel)
        const remoteHash = sha1Buffer(remoteBuffer)
        const localBuffer = await fsp.readFile(join(requireRoot(), job.rel))
        const localEntry = local.get(job.rel)
        if (remoteHash === sha1Buffer(localBuffer)) {
          state.files[job.rel] = {
            hash: remoteHash,
            size: remoteBuffer.length,
            mtimeMs: localEntry.mtimeMs,
            remoteTag: remoteTag(job.remote),
            syncedAt: now(),
          }
          return
        }
        const backupDir = `.trash/first-sync-${stamp().replace(/[:\s]/g, '-')}/`
        const remoteWins = job.remote.mtimeMs > 0 && job.remote.mtimeMs > localEntry.mtimeMs + 2000
        if (remoteWins) {
          await trashCopy(job.rel, localBuffer, backupDir)
          const saved = await writeLocalAtomic(job.rel, remoteBuffer, job.localMtime)
          state.files[job.rel] = {
            hash: remoteHash,
            size: remoteBuffer.length,
            mtimeMs: saved.mtimeMs,
            remoteTag: remoteTag(job.remote),
            syncedAt: now(),
          }
          result.downloaded += 1
          result.bytesDown += remoteBuffer.length
        } else {
          await trashCopy(job.rel, remoteBuffer, backupDir)
          const meta = await dav.put(job.rel, localBuffer)
          state.files[job.rel] = {
            hash: sha1Buffer(localBuffer),
            size: localBuffer.length,
            mtimeMs: localEntry.mtimeMs,
            remoteTag: remoteTag(meta),
            syncedAt: now(),
          }
          result.uploaded += 1
          result.bytesUp += localBuffer.length
        }
        result.merged += 1
        result.notes.push(`first sync: ${job.rel} exists on both sides — kept the newer copy, saved the other under ${backupDir}`)
      }),
    )

    await mapLimit(plan.conflicts, CONCURRENCY, (job) =>
      guard(job.rel, async () => {
        const buffer = await dav.get(job.rel)
        if (sha1Buffer(buffer) === job.hash) {
          // Both sides ended up with identical content: just agree on the tags.
          const stats = await statOrNull(join(requireRoot(), job.rel))
          state.files[job.rel] = {
            hash: job.hash,
            size: stats === null ? 0 : stats.size,
            mtimeMs: stats === null ? 0 : Math.round(stats.mtimeMs),
            remoteTag: remoteTag(job.remote),
            syncedAt: now(),
          }
          return
        }
        const copyRel = await conflictCopy(job.rel, buffer)
        const localBuffer = await fsp.readFile(join(requireRoot(), job.rel))
        const stats = await fsp.stat(join(requireRoot(), job.rel))
        const copyMeta = await dav.put(copyRel, buffer)
        const localMeta = await dav.put(job.rel, localBuffer)
        state.files[copyRel] = {
          hash: sha1Buffer(buffer),
          size: buffer.length,
          mtimeMs: (await fsp.stat(join(requireRoot(), copyRel))).mtimeMs,
          remoteTag: remoteTag(copyMeta),
          syncedAt: now(),
        }
        state.files[job.rel] = {
          hash: sha1Buffer(localBuffer),
          size: localBuffer.length,
          mtimeMs: Math.round(stats.mtimeMs),
          remoteTag: remoteTag(localMeta),
          syncedAt: now(),
        }
        result.conflicts += 1
        result.bytesUp += localBuffer.length
        result.notes.push(`conflict: ${job.rel} → kept local, remote copy saved as ${copyRel}`)
      }),
    )

    await mapLimit(plan.deletesLocal, 1, (job) =>
      guard(job.rel, async () => {
        const abs = join(requireRoot(), job.rel)
        const buffer = await fsp.readFile(abs)
        const trashed = await trashCopy(job.rel, buffer, `.trash/sync-remote-delete-${stamp().replace(/[:\s]/g, '-')}-`)
        await fsp.rm(abs, { force: true })
        delete state.files[job.rel]
        result.deletedLocal += 1
        result.notes.push(`remote delete: ${job.rel} → moved to ${trashed}`)
      }),
    )

    await mapLimit(plan.deletesRemote, 1, (job) =>
      guard(job.rel, async () => {
        const buffer = await dav.get(job.rel)
        const backup = await trashCopy(job.rel, buffer, `.trash/sync-local-delete-${stamp().replace(/[:\s]/g, '-')}-`)
        await dav.remove(job.rel)
        delete state.files[job.rel]
        result.deletedRemote += 1
        result.notes.push(`local delete: remote ${job.rel} removed, copy at ${backup}`)
      }),
    )

    for (const rel of plan.forget) delete state.files[rel]
    result.skipped = plan.unchanged
    result.errors = failures
    result.endedAt = now()
    result.ok = failures.length === 0
    state.provider = 'webdav'
    state.lastSyncAt = now()
    state.lastResult = result
    await saveState(state)
    return result
  }

  async function ensureGitRepo(config) {
    const base = requireRoot()
    const gitDir = await statOrNull(join(base, '.git'))
    if (gitDir === null) {
      await runGit(['init'], { cwd: base })
    }
    // A first commit needs an identity even on machines with no global one.
    const email = await runGit(['config', 'user.email'], { cwd: base, allowFailure: true })
    if (email.stdout.trim().length === 0) await runGit(['config', 'user.email', 'dsh-notebook@localhost'], { cwd: base })
    const name = await runGit(['config', 'user.name'], { cwd: base, allowFailure: true })
    if (name.stdout.trim().length === 0) await runGit(['config', 'user.name', 'DSH Notebook'], { cwd: base })
    await excludeSyncDir(base)
    if (config.git.remote.length > 0) {
      const current = await runGit(['remote', 'get-url', 'origin'], { cwd: base, allowFailure: true })
      const url = current.code === 0 ? current.stdout.trim() : ''
      if (url.length === 0) await runGit(['remote', 'add', 'origin', config.git.remote], { cwd: base })
      else if (url !== config.git.remote) await runGit(['remote', 'set-url', 'origin', config.git.remote], { cwd: base })
    }
    return gitDir === null
  }

  /**
   * Local state must never reach the remote: settings/manifest, the trash that
   * every delete moves a note into, version snapshots, and macOS metadata.
   * `.git/info/exclude` is local-only, so the user's .gitignore is untouched.
   */
  const SYNC_EXCLUDES = [`${SYNC_DIR}/`, '.trash/', '.dsh-notebook-history/', '.DS_Store']

  async function excludeSyncDir(base) {
    const excludePath = join(base, '.git', 'info', 'exclude')
    const current = await fsp.readFile(excludePath, 'utf8').catch(() => '')
    const missing = SYNC_EXCLUDES.filter((entry) => !current.includes(entry))
    if (missing.length === 0) return
    await fsp.mkdir(dirname(excludePath), { recursive: true })
    const prefix = current.length === 0 || current.endsWith('\n') ? current : `${current}\n`
    await fsp.writeFile(excludePath, `${prefix}${missing.join('\n')}\n`, 'utf8')
  }

  async function currentBranch(base) {
    const head = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: base, allowFailure: true })
    const name = head.stdout.trim()
    return name.length === 0 || name === 'HEAD' ? '' : name
  }

  async function runGitSync(trigger) {
    const config = await settings()
    const base = requireRoot()
    const result = newResult('git', trigger)
    const initialized = await ensureGitRepo(config)
    result.notes.push(initialized ? 'initialized a git repository in the vault' : 'repository already present')

    const configuredBranch = config.git.branch
    let branch = configuredBranch.length > 0 ? configuredBranch : await currentBranch(base)
    if (branch.length === 0) branch = 'main'

    progress = { phase: 'commit', done: 0, total: 3, path: null }
    const status = await runGit(['-c', 'core.quotepath=false', 'status', '--porcelain'], { cwd: base })
    const changed = status.stdout.split('\n').filter((line) => line.trim().length > 0)
    if (changed.length > 0) {
      await runGit(['add', '-A'], { cwd: base })
      const message = config.git.message.length > 0 ? config.git.message : `notebook sync ${stamp()}`
      await runGit(['commit', '-m', message], { cwd: base })
      result.committed = changed.length
      result.notes.push(`committed ${changed.length} change(s): ${message}`)
    }
    progress = { phase: 'remote', done: 1, total: 3, path: null }

    if (config.git.remote.length > 0) {
      await runGit(['-c', 'http.lowSpeedLimit=1000', '-c', 'http.lowSpeedTime=20', 'fetch', '--prune', 'origin', branch], {
        cwd: base,
        allowFailure: true,
        timeoutMs: GIT_TIMEOUT_OVERRIDE || GIT_REMOTE_TIMEOUT_MS,
        auth: { username: config.git.username, password: config.git.password },
        systemSsh: config.git.useSystemSsh === true,
      })
      const ref = await runGit(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`], {
        cwd: base,
        allowFailure: true,
      })
      const remoteExists = ref.code === 0 && ref.stdout.trim().length > 0
      if (remoteExists) {
        const behind = await runGit(['rev-list', '--count', `HEAD..origin/${branch}`], { cwd: base, allowFailure: true })
        const count = Number(behind.stdout.trim()) || 0
        if (count > 0) {
          progress = { phase: 'merge', done: 2, total: 3, path: null }
          try {
            await runGit(['rebase', `origin/${branch}`], { cwd: base })
          } catch (error) {
            const conflicts = await runGit(['-c', 'core.quotepath=false', 'diff', '--name-only', '--diff-filter=U'], {
              cwd: base,
              allowFailure: true,
            })
            await runGit(['rebase', '--abort'], { cwd: base, allowFailure: true })
            const files = conflicts.stdout.trim().split('\n').filter(Boolean).slice(0, 10).join(', ')
            throw new SyncError(
              'git_conflict',
              `The remote branch has changes that conflict with local ones${files.length > 0 ? `: ${files}` : ''}. ` +
                'Resolve them in git, then sync again.',
              error?.detail,
            )
          }
          result.pulled = count
          result.notes.push(`replayed ${count} remote commit(s)`)
        }
      }
      const ahead = await runGit(['rev-list', '--count', `origin/${branch}..HEAD`], { cwd: base, allowFailure: true })
      const toPush = remoteExists ? Number(ahead.stdout.trim()) || 0 : 1
      if (toPush > 0) {
        await runGit(['-c', 'http.lowSpeedLimit=1000', '-c', 'http.lowSpeedTime=20', 'push', 'origin', `HEAD:refs/heads/${branch}`], {
          cwd: base,
          timeoutMs: GIT_TIMEOUT_OVERRIDE || GIT_REMOTE_TIMEOUT_MS,
          auth: { username: config.git.username, password: config.git.password },
          systemSsh: config.git.useSystemSsh === true,
        })
        result.pushed = toPush
        result.notes.push(`pushed to origin/${branch}`)
      }
    } else {
      result.notes.push('no git remote configured: committed locally only')
    }

    result.endedAt = now()
    result.ok = true
    progress = { phase: 'idle', done: 0, total: 0, path: null }
    return result
  }

  async function saveGitState(result) {
    if (statePath === null) return
    const state = await loadState('git')
    state.provider = 'git'
    state.lastSyncAt = now()
    state.lastResult = result
    await saveState(state)
  }

  async function doRun(trigger) {
    const config = await settings()
    if (config.provider === 'off') {
      throw new SyncError('sync_not_configured', 'Sync is off. Choose WebDAV or a git repository first.')
    }
    const result = config.provider === 'webdav' ? await runWebdav(trigger) : await runGitSync(trigger)
    record(result)
    if (config.provider === 'git') await saveGitState(result)
    return result
  }

  /**
   * Run one sync. Concurrent callers share the run already in flight, so an
   * auto-sync timer and a manual click cannot interleave.
   */
  function run({ trigger = 'manual' } = {}) {
    if (disposed) return Promise.reject(new SyncError('sync_disposed', 'The sync service is shutting down.'))
    if (active !== null) return active
    active = doRun(trigger)
      .catch((error) => {
        record({
          ...newResult(cache?.provider ?? 'off', trigger),
          endedAt: now(),
          error: { code: error?.code ?? 'sync_error', message: String(error?.message ?? error), detail: error?.detail },
        })
        throw error
      })
      .finally(() => {
        active = null
        progress = { phase: 'idle', done: 0, total: 0, path: null }
      })
    return active
  }

  async function status() {
    const config = await settings().catch(() => normalizeSettings(DEFAULT_SETTINGS))
    let stateSummary = null
    if (statePath !== null) {
      const state = await readJson(statePath)
      if (state !== null && typeof state === 'object') {
        stateSummary = {
          lastSyncAt: state.lastSyncAt ?? null,
          files: state.files !== null && typeof state.files === 'object' ? Object.keys(state.files).length : 0,
          key: state.key ?? null,
        }
      }
    }
    return {
      vault: root,
      provider: config.provider,
      settings: { ...config, webdav: { ...config.webdav } },
      busy: active !== null,
      progress,
      lastResult,
      state: stateSummary,
      runs: runs.slice(0, 10),
    }
  }

  async function saveSettings(patch) {
    const current = await settings()
    const next = applyPatch(current, patch)
    await persistSettings(next)
    return { settings: { ...next, webdav: { ...next.webdav } } }
  }

  /** An editor write happened: sync after a quiet moment when auto-sync is on. */
  function notifyWrite() {
    if (disposed) return
    if (cache === null) {
      settings()
        .then(() => notifyWrite())
        .catch(() => {})
      return
    }
    if (cache.provider === 'off' || cache.auto.onSave !== true) return
    if (saveTimer !== null) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      run({ trigger: 'save' }).catch(() => {})
    }, SAVE_DEBOUNCE_MS)
    if (typeof saveTimer.unref === 'function') saveTimer.unref()
  }

  async function dispose() {
    disposed = true
    if (intervalTimer !== null) clearInterval(intervalTimer)
    if (saveTimer !== null) clearTimeout(saveTimer)
    intervalTimer = null
    saveTimer = null
  }

  // Load settings eagerly so timers start with the plugin, not on first use.
  settings()
    .then(() => reschedule())
    .catch(() => {})

  return {
    status,
    settings,
    saveSettings,
    testConnection,
    run,
    notifyWrite,
    dispose,
    get settingsPath() {
      return settingsPath
    },
    get statePath() {
      return statePath
    },
  }
}
