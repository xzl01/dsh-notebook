/**
 * Host half of the @local/dsh-notebook bundle.
 *
 * Owns one Obsidian vault on disk: listing, reading, writing, searching and
 * trashing Markdown notes. The same operations serve two callers — the Web
 * workbench in client.js (through the `/notebook/api/*` routes this file
 * registers) and the agent tools below — so a note written from the panel and
 * one written by the model follow exactly one code path.
 *
 * No package imports: a linked bundle resolves modules from the workspace,
 * which cannot see the DSH installation, so this file uses Node built-ins only.
 */

import { promises as fsp, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createFlashService, FLASH_CATEGORIES } from './flash.js'
import { createSyncService } from './sync.js'

export const name = 'dsh-notebook'
export const inject = ['tools', 'webServer', 'llm', 'systemPrompt', 'commands', 'sessions']

const NS = 'dsh-notebook'

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd'])
/** Top-level vault folders that are Obsidian internal state, not notes. */
const EXCLUDED_SEGMENTS = new Set(['.obsidian', '.trash', '.git', '.github', 'node_modules', '.DS_Store'])

const DEFAULT_MAX_NOTE_BYTES = 2 * 1024 * 1024
const DEFAULT_MAX_INDEX_FILES = 5000
const MAX_SEARCH_RESULTS = 50
const MAX_BACKLINK_NOTES = 50
const MAX_BACKLINK_LINES = 3
const MAX_SEARCH_FILES = 2000
const MAX_HTTP_BODY_BYTES = 32 * 1024 * 1024
const DEFAULT_TEMPLATE_DIR = '模板'
const DEFAULT_ATTACHMENT_DIR = '附件'
const DEFAULT_FLASH_DIR = '闪念'
const DEFAULT_MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024
/** Optional AI actions, all routed through the Harness's own model configuration. */
const AI_MAX_INPUT = 8000
const AI_TIMEOUT_MS = 60000
const AI_TASKS = {
  rewrite: {
    systemZh:
      '你是中文写作助手。改写用户给出的文字：保留原意与事实，让表达更清晰、简洁、自然。只输出改写后的正文，不要解释、不要加引号。',
    systemEn:
      'You are a writing assistant. Rewrite the given text: keep its meaning and facts, but make it clearer and more concise. Output only the rewritten text.',
    maxTokens: 900,
  },
  continue: {
    systemZh:
      '你是中文写作助手。基于用户给出的上文自然续写一小段（不超过 150 字），风格保持一致。只输出续写内容，不要重复原文。',
    systemEn:
      'You are a writing assistant. Continue the given passage naturally in at most 120 words, matching its style. Output only the continuation.',
    maxTokens: 500,
  },
  polish: {
    systemZh:
      '你是中文校对助手。润色用户给出的文字：修正错别字、语法和标点，保持原意与语气。只输出润色后的正文。',
    systemEn:
      'You are a proofreading assistant. Polish the given text: fix typos, grammar and punctuation while keeping meaning and tone. Output only the polished text.',
    maxTokens: 900,
  },
  translate: {
    systemZh: '你是翻译助手。把用户给出的文字翻译成英文，保留 Markdown 格式与专有名词。只输出译文。',
    systemEn:
      'You are a translation assistant. Translate the given text into Simplified Chinese, keeping Markdown formatting. Output only the translation.',
    maxTokens: 1200,
  },
  summary: {
    systemZh:
      '你是摘要助手。用 3-5 条要点总结用户给出的内容，每条一行并以「- 」开头，不要标题、不要解释。',
    systemEn:
      'You are a summarization assistant. Summarize the given text as 3-5 bullet points, one per line starting with "- ". No title, no explanation.',
    maxTokens: 500,
  },
  tags: {
    systemZh: '你是标签助手。为内容生成 3-5 个简短标签，用逗号分隔，不带 #、不带解释。',
    systemEn:
      'You are a tagging assistant. Produce 3-5 short tags for the content, comma separated, no # and no explanation.',
    maxTokens: 120,
  },
}

const HISTORY_DIR_NAME = '.dsh-notebook-history'
const STATS_DIR_NAME = '.dsh-notebook'
const STATS_FILE_NAME = 'writing.json'
const STATS_VERSION = 1
const HISTORY_LIMIT = 20

/** Attachment extensions the workbench may store and serve. */
const ATTACHMENT_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
}

const TOOL_OUTPUT = {
  schema: { type: 'string' },
  render: (_args, result) => [{ type: 'text', text: result }],
}

const CONFIG_JSON_SCHEMA = {
  type: 'object',
  properties: {
    vaultPath: {
      type: 'string',
      default: '',
      title: 'Vault path',
      description:
        'Absolute path of the Obsidian vault folder. Empty detects the vault Obsidian last opened, from its per-platform config (macOS ~/Library/Application Support/obsidian, Windows %APPDATA%/obsidian, Linux ~/.config/obsidian).',
    },
    maxNoteBytes: {
      type: 'number',
      default: DEFAULT_MAX_NOTE_BYTES,
      title: 'Largest note (bytes)',
      description: 'Notes larger than this are refused by the editor and by the agent tools.',
    },
    maxIndexFiles: {
      type: 'number',
      default: DEFAULT_MAX_INDEX_FILES,
      title: 'Largest index',
      description: 'Stop enumerating a vault after this many Markdown files; the workbench reports truncation instead of hanging.',
    },
    templateDir: {
      type: 'string',
      default: DEFAULT_TEMPLATE_DIR,
      title: 'Template folder',
      description: 'Vault-relative folder whose notes are offered as new-note templates.',
    },
    attachmentDir: {
      type: 'string',
      default: DEFAULT_ATTACHMENT_DIR,
      title: 'Attachment folder',
      description: 'Vault-relative folder where pasted images are stored.',
    },
    flashDir: {
      type: 'string',
      default: DEFAULT_FLASH_DIR,
      title: 'Flash folder (闪念)',
      description:
        'Vault-relative folder that collects quick-captured flashes. Each flash is one Markdown note, so Obsidian, search and sync see it too.',
    },
    maxAttachmentBytes: {
      type: 'number',
      default: DEFAULT_MAX_ATTACHMENT_BYTES,
      title: 'Largest attachment (bytes)',
      description: 'Pasted images larger than this are refused.',
    },
  },
  additionalProperties: false,
}

/** Standard-Schema face of the row config, validated by the Loader on every write. */
export const Config = {
  '~standard': {
    version: 1,
    vendor: NS,
    validate(value) {
      const issues = []
      const config = normalizeConfig(value, issues)
      return issues.length > 0 ? { issues } : { value: config }
    },
    jsonSchema: { input: () => CONFIG_JSON_SCHEMA },
  },
}

function normalizeConfig(raw, issues = []) {
  const input = raw !== null && typeof raw === 'object' ? raw : {}
  if (raw !== null && raw !== undefined && typeof raw !== 'object') {
    issues.push({ message: 'The notebook row config must be an object.' })
  }
  const vaultPath = typeof input.vaultPath === 'string' ? input.vaultPath.trim() : ''
  if (input.vaultPath !== undefined && typeof input.vaultPath !== 'string') {
    issues.push({ message: 'vaultPath must be a string.', path: ['vaultPath'] })
  }
  const positive = (value, fallback) => {
    const number = Number(value)
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback
  }
  const config = {
    vaultPath,
    maxNoteBytes: positive(input.maxNoteBytes, DEFAULT_MAX_NOTE_BYTES),
    maxIndexFiles: positive(input.maxIndexFiles, DEFAULT_MAX_INDEX_FILES),
    templateDir:
      typeof input.templateDir === 'string' && input.templateDir.trim().length > 0
        ? input.templateDir.trim().replace(/^\/+|\/+$/g, '')
        : DEFAULT_TEMPLATE_DIR,
    attachmentDir:
      typeof input.attachmentDir === 'string' && input.attachmentDir.trim().length > 0
        ? input.attachmentDir.trim().replace(/^\/+|\/+$/g, '')
        : DEFAULT_ATTACHMENT_DIR,
    maxAttachmentBytes: positive(input.maxAttachmentBytes, DEFAULT_MAX_ATTACHMENT_BYTES),
    flashDir:
      typeof input.flashDir === 'string' && input.flashDir.trim().length > 0
        ? input.flashDir.trim().replace(/^\/+|\/+$/g, '')
        : DEFAULT_FLASH_DIR,
  }
  return config
}

/** A user-facing failure: the message is shown verbatim in the panel or tool result. */
class NotebookError extends Error {
  constructor(message, code = 'notebook_error') {
    super(message)
    this.name = 'NotebookError'
    this.code = code
  }
}

function expandHome(input) {
  if (input === '~') return homedir()
  if (input.startsWith('~/') || input.startsWith('~\\')) return join(homedir(), input.slice(2))
  return input
}

/**
 * Where Obsidian keeps its own configuration on each platform. macOS and Linux
 * differ by more than a leading dot; Windows has no HOME convention at all, so
 * APPDATA is used when present and a plain Roaming path otherwise.
 */
function obsidianConfigPaths() {
  const home = homedir()
  const paths = []
  if (process.platform === 'darwin') {
    paths.push(join(home, 'Library', 'Application Support', 'obsidian', 'obsidian.json'))
  } else if (process.platform === 'win32') {
    const roaming = process.env.APPDATA ?? join(home, 'AppData', 'Roaming')
    paths.push(join(roaming, 'obsidian', 'obsidian.json'))
  }
  // XDG/config-dir installs also appear on macOS (custom profiles) and are the
  // normal location on Linux, so they stay as a fallback on every platform.
  paths.push(join(home, '.config', 'obsidian', 'obsidian.json'))
  return [...new Set(paths)]
}

/**
 * The vault Obsidian currently has open, read from its own recent-vault list.
 * Returns null when Obsidian was never launched or every config is unreadable.
 * Exported so a test can point it at a temporary home directory.
 */
export function detectObsidianVault(configPaths = obsidianConfigPaths()) {
  for (const configPath of configPaths) {
    let record
    try {
      record = JSON.parse(readFileSync(configPath, 'utf8'))
    } catch {
      continue
    }
    const vaults = Object.entries(record?.vaults ?? {})
      .map(([id, value]) => ({
        id,
        path: typeof value?.path === 'string' ? value.path : '',
        open: value?.open === true,
        ts: Number(value?.ts) || 0,
      }))
      .filter((entry) => entry.path.length > 0)
    if (vaults.length === 0) continue
    const open = vaults.find((entry) => entry.open)
    if (open !== undefined) return open.path
    vaults.sort((a, b) => b.ts - a.ts)
    return vaults[0].path
  }
  return null
}

function isMarkdownFile(path) {
  return MARKDOWN_EXTENSIONS.has(extname(path).toLowerCase())
}

function slashPath(path) {
  return path.split(sep).join('/')
}

function statOrNull(path) {
  return fsp.stat(path).catch(() => null)
}

/**
 * Read flat `key: value` pairs from a note's frontmatter block. Nested or
 * multi-line YAML is skipped so a collection view only sees scalar fields.
 */
function parseFrontmatterFields(head) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(head ?? ''))
  if (block === null) return {}
  const fields = {}
  for (const line of block[1].split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.+)$/.exec(line.trim())
    if (match === null) continue
    fields[match[1]] = match[2].trim().replace(/^["']|["']$/g, '')
  }
  return fields
}

function parseDate(value) {
  const time = Number(value)
  return Number.isFinite(time) && time > 0 ? time : 0
}

/**
 * Resolve one user-supplied note path inside the vault. Every read and every
 * write goes through this function, so `..`, absolute paths, vault-internal
 * folders and non-Markdown files are refused before touching the filesystem.
 */
function resolveNotePath(root, input) {
  const raw = typeof input === 'string' ? input.trim() : ''
  if (raw.length === 0) throw new NotebookError('A note path is required.', 'missing_path')
  if (raw.includes('\0')) throw new NotebookError('The note path contains an invalid character.', 'invalid_path')
  const abs = resolve(root, raw.replace(/\\/g, '/'))
  const rel = relative(root, abs)
  if (rel.length === 0 || isAbsolute(rel)) {
    throw new NotebookError(`The note path must name a file inside the vault: ${raw}`, 'outside_vault')
  }
  if (rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new NotebookError(`The note path escapes the vault: ${raw}`, 'outside_vault')
  }
  const segments = rel.split(sep)
  for (const segment of segments) {
    if (segment.length === 0 || segment === '.' || segment === '..') {
      throw new NotebookError(`The note path is not valid: ${raw}`, 'invalid_path')
    }
    if (EXCLUDED_SEGMENTS.has(segment)) {
      throw new NotebookError(`The folder "${segment}" is Obsidian state, not a note folder.`, 'excluded_path')
    }
    if (segment.startsWith('.')) {
      throw new NotebookError(`Hidden files and folders are not notes: ${segment}`, 'excluded_path')
    }
  }
  if (!isMarkdownFile(rel)) {
    throw new NotebookError('Only Markdown notes (.md) are supported.', 'not_markdown')
  }
  return { abs, rel: slashPath(rel) }
}

/** Resolve a folder argument; the vault root itself is allowed. */
function resolveFolder(root, input) {
  const raw = typeof input === 'string' ? input.trim() : ''
  const cleaned = raw.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (cleaned.length === 0 || cleaned === '.') return { abs: root, rel: '' }
  const abs = resolve(root, cleaned)
  const rel = relative(root, abs)
  if (rel.length === 0) return { abs: root, rel: '' }
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new NotebookError(`The folder escapes the vault: ${raw}`, 'outside_vault')
  }
  for (const segment of rel.split(sep)) {
    if (segment.length === 0 || segment === '.' || segment === '..' || segment.startsWith('.')) {
      throw new NotebookError(`The folder "${segment}" is Obsidian state, not a note folder.`, 'excluded_path')
    }
    if (EXCLUDED_SEGMENTS.has(segment)) {
      throw new NotebookError(`The folder "${segment}" is Obsidian state, not a note folder.`, 'excluded_path')
    }
  }
  return { abs, rel: slashPath(rel) }
}

/** The snapshot folder for one note: .dsh-notebook-history/<note path>/ */
function historyDirFor(base, rel) {
  return join(base, HISTORY_DIR_NAME, ...rel.split('/'))
}

/**
 * Keep one snapshot of a note's previous content. Snapshots live under a hidden
 * folder inside the vault, so Obsidian and the note listing both ignore them.
 */
async function saveHistorySnapshot(base, rel, content) {
  const dir = historyDirFor(base, rel)
  await fsp.mkdir(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = join(dir, `${stamp}-${randomUUID().slice(0, 6)}.md`)
  await fsp.writeFile(file, content, 'utf8')
  const names = (await fsp.readdir(dir)).filter((name) => name.endsWith('.md')).sort()
  while (names.length > HISTORY_LIMIT) {
    const oldest = names.shift()
    await fsp.rm(join(dir, oldest), { force: true }).catch(() => {})
  }
}

/** Keep a pasted file name usable: no separators, no control characters, bounded length. */
function sanitizeFileName(input) {
  const base = String(input ?? '').split(/[\\/]/).pop() ?? ''
  const cleaned = base
    .replace(/[^A-Za-z0-9._\-\u4e00-\u9fff ]+/g, '_')
    .trim()
    .slice(0, 120)
  return cleaned.length === 0 ? 'image.png' : cleaned
}

/** Resolve one attachment path (any supported non-Markdown file) inside the vault. */
function resolveAttachmentPath(root, input) {
  const raw = typeof input === 'string' ? input.trim() : ''
  if (raw.length === 0) throw new NotebookError('An attachment path is required.', 'missing_path')
  const abs = resolve(root, raw.replace(/\\/g, '/'))
  const rel = relative(root, abs)
  if (rel.length === 0 || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new NotebookError(`The attachment path escapes the vault: ${raw}`, 'outside_vault')
  }
  for (const segment of rel.split(sep)) {
    if (segment.length === 0 || segment === '.' || segment === '..') {
      throw new NotebookError(`The attachment path is not valid: ${raw}`, 'invalid_path')
    }
    if (segment.startsWith('.') || EXCLUDED_SEGMENTS.has(segment)) {
      throw new NotebookError(`The folder "${segment}" is not an attachment folder.`, 'excluded_path')
    }
  }
  if (!Object.prototype.hasOwnProperty.call(ATTACHMENT_TYPES, extname(abs).toLowerCase())) {
    throw new NotebookError('That file type is not a supported attachment.', 'unsupported_attachment')
  }
  return { abs, rel: slashPath(rel) }
}

async function walkNotes(dir, root, out, limit) {
  let entries
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
  for (const entry of entries) {
    if (out.length >= limit) return
    if (entry.name.startsWith('.')) continue
    if (EXCLUDED_SEGMENTS.has(entry.name)) continue
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walkNotes(abs, root, out, limit)
      continue
    }
    if (!entry.isFile() || !isMarkdownFile(entry.name)) continue
    const stats = await fsp.stat(abs).catch(() => null)
    if (stats === null) continue
    const rel = slashPath(relative(root, abs))
    out.push({
      path: rel,
      name: entry.name.slice(0, entry.name.length - extname(entry.name).length),
      dir: slashPath(relative(root, dir)),
      size: stats.size,
      mtimeMs: Math.round(stats.mtimeMs),
    })
  }
}

/** Local calendar day (`YYYY-MM-DD`) — the heatmap follows the user's day, not UTC. */
function localDateKey(ms) {
  const date = new Date(Number(ms) || Date.now())
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '?'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * The vault service. One instance per plugin activation; every method is the
 * operation both callers share. `hooks.onWrite` lets the sync engine notice a
 * note the panel or the model just saved.
 */
function createVault(config, hooks = {}) {
  const configured = config.vaultPath.length > 0 ? expandHome(config.vaultPath) : detectObsidianVault()
  const root = configured !== null && configured !== undefined ? resolve(configured) : null
  let openError = null
  if (root === null) {
    openError = 'No Obsidian vault is configured and no open vault was found. Set vaultPath in the plugin config.'
  }

  const requireRoot = () => {
    if (root === null) throw new NotebookError(openError ?? 'No vault is configured.', 'no_vault')
    return root
  }

  /**
   * Resolve the vault's real path, then verify that a note path's real location
   * stays inside it. A symlink inside the vault can point anywhere, so path
   * normalization alone is not enough: realpath is taken on the deepest existing
   * ancestor of the target and the unresolved tail is appended back.
   */
  let realRootCache = null
  const realRoot = async () => {
    if (root === null) throw new NotebookError(openError ?? 'No vault is configured.', 'no_vault')
    if (realRootCache === null) {
      try {
        realRootCache = await fsp.realpath(root)
      } catch {
        throw new NotebookError(`The vault folder does not exist: ${root}`, 'no_vault')
      }
    }
    return realRootCache
  }

  async function assertInsideVault(abs, shownPath) {
    const base = await realRoot()
    let probe = abs
    const tail = []
    for (let depth = 0; depth < 64; depth += 1) {
      try {
        const real = await fsp.realpath(probe)
        const combined = tail.length === 0 ? real : join(real, ...[...tail].reverse())
        const rel = relative(base, combined)
        if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
          throw new NotebookError(`The note resolves outside the vault: ${shownPath}`, 'outside_vault')
        }
        return
      } catch (error) {
        if (error instanceof NotebookError) throw error
        const code = error && error.code
        if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error
        const parent = dirname(probe)
        if (parent === probe) {
          throw new NotebookError(`The note resolves outside the vault: ${shownPath}`, 'outside_vault')
        }
        tail.push(basename(probe))
        probe = parent
      }
    }
    throw new NotebookError(`The note path is too deep: ${shownPath}`, 'invalid_path')
  }

  const vaultInfo = () => ({
    path: root,
    name: root === null ? null : basename(root),
    configuredBy: config.vaultPath.length > 0 ? 'config' : 'obsidian',
    error: openError,
  })

  async function status() {
    const info = vaultInfo()
    if (root === null) return { ...info, exists: false, noteCount: 0 }
    const exists = await statOrNull(root)
    if (exists === null || !exists.isDirectory()) {
      openError = `The vault folder does not exist: ${root}`
      return { ...vaultInfo(), exists: false, noteCount: 0 }
    }
    let noteCount = 0
    try {
      const notes = []
      await walkNotes(root, root, notes, config.maxIndexFiles + 1)
      noteCount = Math.min(notes.length, config.maxIndexFiles)
    } catch {
      noteCount = 0
    }
    return {
      ...info,
      exists: true,
      noteCount,
      noteCountCapped: noteCount >= config.maxIndexFiles,
      maxNoteBytes: config.maxNoteBytes,
    }
  }

  async function list(folder) {
    const base = requireRoot()
    const target = resolveFolder(base, folder)
    await assertInsideVault(target.abs, target.rel.length > 0 ? target.rel : '(vault root)')
    const notes = []
    await walkNotes(target.abs, base, notes, config.maxIndexFiles + 1)
    let truncated = false
    if (notes.length > config.maxIndexFiles) {
      notes.length = config.maxIndexFiles
      truncated = true
    }
    return {
      vault: vaultInfo(),
      folder: target.rel,
      notes,
      truncated,
      limit: config.maxIndexFiles,
    }
  }

  // ---- Writing heatmap -------------------------------------------------
  // One small JSON file inside the vault records characters added per local
  // day. History cannot be reconstructed from file mtimes (a copied vault puts
  // every note on the same day), so the log starts the first time we count.
  const statsFile = () => join(root, STATS_DIR_NAME, STATS_FILE_NAME)
  let writingLog = null
  let writingQueue = Promise.resolve()

  async function loadWritingLog() {
    if (writingLog !== null) return writingLog
    const empty = { version: STATS_VERSION, days: {} }
    try {
      const parsed = JSON.parse(await fsp.readFile(statsFile(), 'utf8'))
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        parsed.version === STATS_VERSION &&
        parsed.days !== null &&
        typeof parsed.days === 'object'
      ) {
        writingLog = { version: STATS_VERSION, days: parsed.days }
      } else {
        writingLog = empty
      }
    } catch {
      writingLog = empty
    }
    // First run: seed today from notes saved today, so the widget is not blank
    // on the day the feature appears. Only notes touched today are read.
    if (writingLog === empty && Object.keys(writingLog.days).length === 0) {
      try {
        const notes = []
        await walkNotes(root, root, notes, config.maxIndexFiles)
        const startOfDay = new Date()
        startOfDay.setHours(0, 0, 0, 0)
        let todayChars = 0
        for (const note of notes) {
          if (note.mtimeMs < startOfDay.getTime()) continue
          const content = await fsp.readFile(join(root, note.path), 'utf8').catch(() => null)
          if (content !== null) todayChars += content.length
        }
        if (todayChars > 0) {
          writingLog.days[localDateKey(startOfDay.getTime())] = todayChars
          await saveWritingLog()
        }
      } catch {
        /* seeding is best effort */
      }
    }
    return writingLog
  }

  async function saveWritingLog() {
    if (writingLog === null) return
    try {
      await fsp.mkdir(dirname(statsFile()), { recursive: true })
      await fsp.writeFile(statsFile(), JSON.stringify(writingLog), 'utf8')
    } catch {
      /* statistics must never fail a save */
    }
  }

  /** Count characters added by one save; deleting text does not subtract. */
  function recordWriting(added) {
    const chars = Math.round(Number(added))
    if (!Number.isFinite(chars) || chars <= 0) return writingQueue
    writingQueue = writingQueue
      .then(async () => {
        const log = await loadWritingLog()
        const key = localDateKey(Date.now())
        log.days[key] = (log.days[key] ?? 0) + chars
        await saveWritingLog()
      })
      .catch(() => {})
    return writingQueue
  }

  async function writingStats() {
    if (root === null) {
      return { days: {}, total: 0, activeDays: 0, streak: 0, best: null, recordedSince: null }
    }
    const log = await loadWritingLog()
    const entries = Object.entries(log.days)
      .filter(([key, value]) => /^\d{4}-\d{2}-\d{2}$/.test(key) && Number.isFinite(Number(value)) && Number(value) > 0)
      .map(([date, chars]) => [date, Math.round(Number(chars))])
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    const total = entries.reduce((sum, [, chars]) => sum + chars, 0)
    const best = entries.reduce((top, [date, chars]) => (top === null || chars > top.chars ? { date, chars } : top), null)
    // A streak that includes today is current; otherwise start from yesterday,
    // so the number stays sensible until the day is over.
    const byDate = new Map(entries)
    let streak = 0
    let cursor = new Date()
    if (!byDate.has(localDateKey(cursor.getTime()))) cursor.setDate(cursor.getDate() - 1)
    while (byDate.has(localDateKey(cursor.getTime()))) {
      streak += 1
      cursor.setDate(cursor.getDate() - 1)
    }
    return {
      days: Object.fromEntries(entries),
      total,
      activeDays: entries.length,
      streak,
      best,
      recordedSince: entries.length > 0 ? entries[0][0] : null,
    }
  }

  async function read(path) {
    const base = requireRoot()
    const { abs, rel } = resolveNotePath(base, path)
    await assertInsideVault(abs, rel)
    const stats = await statOrNull(abs)
    if (stats === null || !stats.isFile()) throw new NotebookError(`The note does not exist: ${rel}`, 'missing_note')
    if (stats.size > config.maxNoteBytes) {
      throw new NotebookError(
        `The note is ${formatBytes(stats.size)}, larger than the ${formatBytes(config.maxNoteBytes)} limit.`,
        'note_too_large',
      )
    }
    const content = await fsp.readFile(abs, 'utf8')
    return { path: rel, content, size: stats.size, mtimeMs: Math.round(stats.mtimeMs) }
  }

  /**
   * Cheap existence + mtime probe for the open note, so the panel can notice
   * that the agent (or Obsidian) rewrote the file without fetching its body.
   */
  async function stat(path) {
    const base = requireRoot()
    const { abs, rel } = resolveNotePath(base, path)
    await assertInsideVault(abs, rel)
    const stats = await statOrNull(abs)
    if (stats === null || !stats.isFile()) return { path: rel, exists: false, size: 0, mtimeMs: 0 }
    return { path: rel, exists: true, size: stats.size, mtimeMs: Math.round(stats.mtimeMs) }
  }

  async function writeAtomic(abs, content) {
    const bytes = Buffer.byteLength(content, 'utf8')
    if (bytes > config.maxNoteBytes) {
      throw new NotebookError(
        `The note would be ${formatBytes(bytes)}, larger than the ${formatBytes(config.maxNoteBytes)} limit.`,
        'note_too_large',
      )
    }
    await fsp.mkdir(dirname(abs), { recursive: true })
    const temp = `${abs}.${process.pid}-${randomUUID()}.tmp`
    let handle = null
    try {
      handle = await fsp.open(temp, 'w')
      await handle.writeFile(content, 'utf8')
      // Durability: flush the temp file before the rename publishes it.
      await handle.sync().catch(() => {})
      await handle.close()
      handle = null
      await fsp.rename(temp, abs)
    } catch (error) {
      if (handle !== null) await handle.close().catch(() => {})
      await fsp.rm(temp, { force: true }).catch(() => {})
      throw error
    }
    const stats = await fsp.stat(abs)
    return { size: stats.size, mtimeMs: Math.round(stats.mtimeMs) }
  }

  /** mode: 'replace' overwrites (creating the note when absent), 'append' adds, 'create' refuses an existing note. */
  async function write(path, content, mode = 'replace', expectedMtimeMs) {
    const base = requireRoot()
    const { abs, rel } = resolveNotePath(base, path)
    await assertInsideVault(abs, rel)
    if (typeof content !== 'string') throw new NotebookError('content must be a string.', 'invalid_content')
    const existing = await statOrNull(abs)
    if (mode === 'create' && existing !== null) {
      throw new NotebookError(`A note already exists at ${rel}.`, 'note_exists')
    }
    if (mode !== 'create' && existing === null && mode === 'append') {
      throw new NotebookError(`The note does not exist: ${rel}`, 'missing_note')
    }
    if (
      mode === 'replace' &&
      existing !== null &&
      Number.isFinite(Number(expectedMtimeMs)) &&
      Number(expectedMtimeMs) > 0 &&
      Math.abs(existing.mtimeMs - Number(expectedMtimeMs)) > 2
    ) {
      throw new NotebookError(
        'The note changed on disk since it was opened. Reload it before saving, so the other change is not lost.',
        'conflict',
      )
    }
    let next = content
    if (mode === 'append') {
      const current = await fsp.readFile(abs, 'utf8')
      next = current.length === 0 || current.endsWith('\n') ? `${current}${content}` : `${current}\n${content}`
    }
    let previousChars = 0
    if (existing !== null) {
      const previous = await fsp.readFile(abs, 'utf8').catch(() => null)
      if (previous !== null) {
        previousChars = previous.length
        await saveHistorySnapshot(base, rel, previous).catch(() => {})
      }
    }
    const stats = await writeAtomic(abs, next)
    await recordWriting(next.length - previousChars)
    try {
      hooks.onWrite?.(rel)
    } catch {
      /* an auto-sync hook must never fail the save */
    }
    return { path: rel, mode, ...stats }
  }

  async function makeFolder(input) {
    const folder = resolveFolder(root, input)
    if (folder.rel.length === 0) throw new NotebookError('A folder name is required.', 'missing_folder')
    await assertInsideVault(folder.abs, folder.rel)
    await fsp.mkdir(folder.abs, { recursive: true })
    return { path: folder.rel }
  }

  async function rename(from, to) {
    const base = requireRoot()
    const source = resolveNotePath(base, from)
    const target = resolveNotePath(base, to)
    if (source.rel === target.rel) {
      const stats = await statOrNull(source.abs)
      if (stats === null || !stats.isFile()) {
        throw new NotebookError(`The note does not exist: ${source.rel}`, 'missing_note')
      }
      return { from: source.rel, to: target.rel, size: stats.size, mtimeMs: Math.round(stats.mtimeMs) }
    }
    await assertInsideVault(source.abs, source.rel)
    await assertInsideVault(target.abs, target.rel)
    const sourceStats = await statOrNull(source.abs)
    if (sourceStats === null || !sourceStats.isFile()) throw new NotebookError(`The note does not exist: ${source.rel}`, 'missing_note')
    const targetStats = await statOrNull(target.abs)
    if (targetStats !== null) throw new NotebookError(`A note already exists at ${target.rel}.`, 'note_exists')
    await fsp.mkdir(dirname(target.abs), { recursive: true })
    await fsp.rename(source.abs, target.abs)
    const stats = await fsp.stat(target.abs)
    return { from: source.rel, to: target.rel, size: stats.size, mtimeMs: Math.round(stats.mtimeMs) }
  }

  async function remove(path) {
    const base = requireRoot()
    const { abs, rel } = resolveNotePath(base, path)
    await assertInsideVault(abs, rel)
    const stats = await statOrNull(abs)
    if (stats === null || !stats.isFile()) throw new NotebookError(`The note does not exist: ${rel}`, 'missing_note')
    const previous = await fsp.readFile(abs, 'utf8').catch(() => null)
    if (previous !== null) await saveHistorySnapshot(base, rel, previous).catch(() => {})
    const trash = join(base, '.trash')
    await fsp.mkdir(trash, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const target = join(trash, `${stamp}-${randomUUID().slice(0, 8)}-${basename(abs)}`)
    await fsp.rename(abs, target)
    return { path: rel, trashedTo: slashPath(relative(base, target)) }
  }

  function publicConfig() {
    return {
      vaultPath: root,
      templateDir: config.templateDir,
      attachmentDir: config.attachmentDir,
      flashDir: config.flashDir,
      maxNoteBytes: config.maxNoteBytes,
      maxAttachmentBytes: config.maxAttachmentBytes,
      maxIndexFiles: config.maxIndexFiles,
    }
  }

  async function listHistory(path) {
    const base = requireRoot()
    const { rel } = resolveNotePath(base, path)
    const dir = historyDirFor(base, rel)
    const names = (await fsp.readdir(dir).catch(() => [])).filter((name) => name.endsWith('.md'))
    const entries = []
    for (const name of names) {
      const stats = await statOrNull(join(dir, name))
      if (stats === null) continue
      entries.push({ id: name, bytes: stats.size, mtimeMs: Math.round(stats.mtimeMs) })
    }
    entries.sort((a, b) => b.mtimeMs - a.mtimeMs)
    return { path: rel, entries }
  }

  async function readHistory(path, id) {
    const base = requireRoot()
    const { rel } = resolveNotePath(base, path)
    const name = String(id ?? '')
    if (!/^[A-Za-z0-9._-]+\.md$/.test(name)) {
      throw new NotebookError('The history entry id is not valid.', 'invalid_history_id')
    }
    const dir = historyDirFor(base, rel)
    const abs = join(dir, name)
    const stats = await statOrNull(abs)
    if (stats === null) throw new NotebookError('That history entry does not exist.', 'missing_history')
    return {
      path: rel,
      id: name,
      content: await fsp.readFile(abs, 'utf8'),
      bytes: stats.size,
      mtimeMs: Math.round(stats.mtimeMs),
    }
  }

  /**
   * Collection data: every note under a folder with its frontmatter fields, so
   * the workbench can render table / board views over plain Markdown files.
   */
  async function fields(folder) {
    const base = requireRoot()
    const target = resolveFolder(base, folder)
    await assertInsideVault(target.abs, target.rel.length > 0 ? target.rel : '(vault root)')
    const notes = []
    await walkNotes(target.abs, base, notes, config.maxIndexFiles + 1)
    let truncated = false
    if (notes.length > config.maxIndexFiles) {
      notes.length = config.maxIndexFiles
      truncated = true
    }
    const rows = []
    for (const note of notes) {
      if (note.size > config.maxNoteBytes) continue
      let head = ''
      try {
        const handle = await fsp.open(join(base, note.path), 'r')
        try {
          const length = Math.min(2048, note.size)
          const buffer = Buffer.alloc(length)
          await handle.read(buffer, 0, length, 0)
          head = buffer.toString('utf8')
        } finally {
          await handle.close()
        }
      } catch {
        head = ''
      }
      rows.push({
        path: note.path,
        name: note.name,
        dir: note.dir,
        mtimeMs: note.mtimeMs,
        size: note.size,
        fields: parseFrontmatterFields(head),
      })
    }
    return { folder: target.rel, rows, truncated, limit: config.maxIndexFiles }
  }

  /**
   * Frontmatter `parent` links written by "turn into sub-page". Reading only the
   * first bytes of each note keeps this cheap; the parent must be inside the
   * frontmatter block, not somewhere in the body.
   */
  async function parents() {
    const base = requireRoot()
    const notes = []
    await walkNotes(base, base, notes, Math.min(config.maxIndexFiles, MAX_SEARCH_FILES))
    const map = {}
    for (const note of notes) {
      if (note.size > config.maxNoteBytes) continue
      let head = ''
      try {
        const handle = await fsp.open(join(base, note.path), 'r')
        try {
          const length = Math.min(2048, note.size)
          const buffer = Buffer.alloc(length)
          await handle.read(buffer, 0, length, 0)
          head = buffer.toString('utf8')
        } finally {
          await handle.close()
        }
      } catch {
        continue
      }
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(head)
      if (frontmatter === null) continue
      const match = /^parent:\s*(.+)$/m.exec(frontmatter[1])
      if (match === null) continue
      const parentPath = match[1]
        .trim()
        .replace(/^["']|["']$/g, '')
        .replace(/\.md$/i, '')
      if (parentPath.length === 0) continue
      map[note.path] = parentPath
    }
    return { parents: map }
  }

  /**
   * Notes that link to `rawPath` with a wiki link (`[[name]]`, `[[name#heading]]`,
   * `![[name]]`). Scans vault notes like search does; the panel shows the result
   * under the page so the user can see incoming references.
   */
  async function backlinks(rawPath) {
    const base = requireRoot()
    const { rel } = resolveNotePath(base, rawPath)
    const name = rel.split('/').pop().replace(/\.md$/i, '')
    const full = rel.replace(/\.md$/i, '')
    const notes = []
    await walkNotes(base, base, notes, Math.min(config.maxIndexFiles, MAX_SEARCH_FILES))
    const links = []
    let scanned = 0
    for (const note of notes) {
      if (links.length >= MAX_BACKLINK_NOTES) break
      if (note.path === rel) continue
      if (note.size > config.maxNoteBytes) continue
      scanned += 1
      let text
      try {
        text = await fsp.readFile(join(base, note.path), 'utf8')
      } catch {
        continue
      }
      const lines = text.split(/\r\n|\r|\n/)
      const hits = []
      for (let index = 0; index < lines.length && hits.length < MAX_BACKLINK_LINES; index += 1) {
        const line = lines[index]
        if (!line.includes('[[')) continue
        for (const match of line.matchAll(/(!?)\[\[([^\]\n]+)\]\]/g)) {
          const rawTarget = match[2].split('|')[0].split('#')[0].trim().replace(/\.md$/i, '')
          if (rawTarget.length === 0) continue
          const matched =
            rawTarget === name ||
            rawTarget === full ||
            rawTarget.toLowerCase() === name.toLowerCase()
          if (!matched) continue
          hits.push({ number: index + 1, text: line.trim().slice(0, 160) })
          break
        }
      }
      if (hits.length > 0) links.push({ path: note.path, name: note.name, lines: hits })
    }
    return { path: rel, name, backlinks: links, scanned, truncated: notes.length >= config.maxIndexFiles }
  }

  async function search(query, limit = MAX_SEARCH_RESULTS) {
    const base = requireRoot()
    const needle = typeof query === 'string' ? query.trim() : ''
    if (needle.length === 0) throw new NotebookError('A search query is required.', 'missing_query')
    const max = Math.min(Math.max(1, Math.floor(Number(limit) || MAX_SEARCH_RESULTS)), 200)
    const lower = needle.toLowerCase()
    const notes = []
    await walkNotes(base, base, notes, Math.min(config.maxIndexFiles, MAX_SEARCH_FILES))
    const matches = []
    const titles = []
    const bodies = []
    let scanned = 0
    for (const note of notes) {
      if (note.size > config.maxNoteBytes) continue
      scanned += 1
      let text
      try {
        text = await fsp.readFile(join(base, note.path), 'utf8')
      } catch {
        continue
      }
      const lines = text.split(/\r\n|\r|\n/)
      const heading = /^#{1,6}\s+(.+)$/.exec((lines[0] ?? '').trim())
      const headingText = heading === null ? '' : heading[1].trim()
      const nameMatch = note.name.toLowerCase().includes(lower)
      const headingMatch = headingText.length > 0 && headingText.toLowerCase().includes(lower)
      if (nameMatch || headingMatch) {
        titles.push({
          path: note.path,
          name: note.name,
          dir: note.dir,
          heading: headingText,
          matchedIn: nameMatch ? 'name' : 'heading',
        })
      }
      const hits = []
      for (let index = 0; index < lines.length; index += 1) {
        if (!lines[index].toLowerCase().includes(lower)) continue
        const line = { path: note.path, line: index + 1, text: lines[index].slice(0, 240) }
        if (matches.length < max) matches.push(line)
        // The H1 line is the note's title, so it belongs to the title group
        // instead of repeating the name in a body hit.
        if (!(heading !== null && index === 0)) hits.push({ line: index + 1, text: lines[index].slice(0, 240) })
      }
      if (hits.length > 0) {
        bodies.push({ path: note.path, name: note.name, dir: note.dir, hits: hits.slice(0, 3), hitCount: hits.length })
      }
    }
    return {
      query: needle,
      matches,
      groups: { titles: titles.slice(0, 30), body: bodies.slice(0, 30) },
      scanned,
      truncated: matches.length >= max,
    }
  }

  async function saveAttachment(name, dataBase64) {
    const base = requireRoot()
    const dir = resolveFolder(base, config.attachmentDir)
    await assertInsideVault(dir.abs, config.attachmentDir)
    const buffer = Buffer.from(String(dataBase64 ?? ''), 'base64')
    if (buffer.length === 0) throw new NotebookError('The attachment data is empty.', 'empty_attachment')
    if (buffer.length > config.maxAttachmentBytes) {
      throw new NotebookError(
        `The attachment is ${formatBytes(buffer.length)}, larger than the ${formatBytes(config.maxAttachmentBytes)} limit.`,
        'attachment_too_large',
      )
    }
    const safe = sanitizeFileName(name)
    const ext = extname(safe).toLowerCase()
    if (!Object.prototype.hasOwnProperty.call(ATTACHMENT_TYPES, ext)) {
      throw new NotebookError('That file type is not a supported attachment.', 'unsupported_attachment')
    }
    await fsp.mkdir(dir.abs, { recursive: true })
    const stem = safe.slice(0, safe.length - ext.length)
    let fileName = safe
    let attempt = 1
    while ((await statOrNull(join(dir.abs, fileName))) !== null) {
      attempt += 1
      fileName = `${stem}-${attempt}${ext}`
    }
    const abs = join(dir.abs, fileName)
    await fsp.writeFile(abs, buffer)
    const rel = slashPath(relative(base, abs))
    return { path: rel, bytes: buffer.length, mime: ATTACHMENT_TYPES[ext] }
  }

  async function readAttachment(path) {
    const base = requireRoot()
    const target = resolveAttachmentPath(base, path)
    await assertInsideVault(target.abs, target.rel)
    const stats = await statOrNull(target.abs)
    if (stats === null || !stats.isFile()) {
      throw new NotebookError(`The attachment does not exist: ${target.rel}`, 'missing_attachment')
    }
    if (stats.size > config.maxAttachmentBytes) {
      throw new NotebookError('The attachment is larger than the configured limit.', 'attachment_too_large')
    }
    return {
      buffer: await fsp.readFile(target.abs),
      mime: ATTACHMENT_TYPES[extname(target.abs).toLowerCase()],
      path: target.rel,
    }
  }

  /** The first bytes of a note: enough for frontmatter and a preview. */
  async function head(path, bytes = 2048) {
    const base = requireRoot()
    const { abs, rel } = resolveNotePath(base, path)
    await assertInsideVault(abs, rel)
    const stats = await statOrNull(abs)
    if (stats === null || !stats.isFile()) {
      throw new NotebookError(`The note does not exist: ${rel}`, 'missing_note')
    }
    const length = Math.max(1, Math.min(Math.floor(Number(bytes) || 2048), stats.size))
    let handle = null
    try {
      handle = await fsp.open(abs, 'r')
      const buffer = Buffer.alloc(length)
      await handle.read(buffer, 0, length, 0)
      return { path: rel, head: buffer.toString('utf8'), size: stats.size, mtimeMs: Math.round(stats.mtimeMs) }
    } finally {
      if (handle !== null) await handle.close().catch(() => {})
    }
  }

  return {
    root,
    head,
    vaultInfo,
    status,
    list,
    read,
    stat,
    write,
    rename,
    remove,
    search,
    saveAttachment,
    readAttachment,
    listHistory,
    readHistory,
    publicConfig,
    makeFolder,
    fields,
    parents,
    backlinks,
    writingStats,
  }
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

/**
 * Refuse requests that did not come from this application's own origin.
 *
 * The listener only binds loopback, but loopback is reachable from any page in
 * the browser and from DNS-rebinding hosts. So two checks: the Host header must
 * name the origin this Host was composed with, and a present Origin must match
 * it. A request with no Origin (a same-origin GET from the page) passes the
 * second check only because the first already pinned the authority.
 */
function createRequestGate(origin) {
  let expectedHost = null
  try {
    expectedHost = new URL(origin).host
  } catch {
    expectedHost = null
  }
  return (req) => {
    const host = typeof req.headers.host === 'string' ? req.headers.host : ''
    if (expectedHost !== null && host !== expectedHost) return false
    const requestOrigin = req.headers.origin
    if (requestOrigin === undefined || requestOrigin === '') return true
    try {
      return new URL(requestOrigin).host === host
    } catch {
      return false
    }
  }
}

function readJsonBody(req, limit = MAX_HTTP_BODY_BYTES) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = []
    let bytes = 0
    let settled = false
    req.on('data', (chunk) => {
      if (settled) return
      bytes += chunk.length
      if (bytes > limit) {
        settled = true
        rejectBody(new NotebookError('The request body is too large.', 'body_too_large'))
        // Drain instead of destroying: the caller still needs a socket to
        // write its JSON failure on.
        chunks.length = 0
        req.resume()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      const text = Buffer.concat(chunks).toString('utf8')
      if (text.trim().length === 0) {
        settled = true
        resolveBody({})
        return
      }
      try {
        const parsed = JSON.parse(text)
        settled = true
        resolveBody(parsed)
      } catch {
        settled = true
        rejectBody(new NotebookError('The request body is not valid JSON.', 'invalid_json'))
      }
    })
    req.on('error', (error) => {
      if (settled) return
      settled = true
      rejectBody(error)
    })
  })
}

function failure(res, error) {
  if (error instanceof NotebookError || error?.name === 'SyncError' || error?.name === 'FlashError') {
    sendJson(res, error.code === 'missing_note' || error.code === 'no_vault' ? 404 : 400, {
      ok: false,
      error: error.message,
      code: error.code,
      ...(typeof error.detail === 'string' ? { detail: error.detail } : {}),
    })
    return
  }
  const message = error instanceof Error ? error.message : String(error)
  sendJson(res, 500, { ok: false, error: message, code: 'internal' })
}

export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  // The sync engine is created after the vault, but the vault's save hook only
  // fires later, so the late-bound reference is safe.
  let sync = null
  const vault = createVault(config, { onWrite: () => sync?.notifyWrite() })
  sync = createSyncService({ root: vault.root })
  const flash = createFlashService({ vault, dir: config.flashDir })
  /** Panel builds that asked for sync status, newest last; exposed for diagnosis. */
  const syncClients = Object.create(null)
  const label = (text) => `${NS}: ${text}`
  let gate = null
  try {
    gate = createRequestGate(ctx.webServer.getOrigin())
  } catch {
    gate = createRequestGate('')
  }

  /**
   * AI actions run through the Harness's own model services: the default route
   * comes from `agentDefaultModel` when present, otherwise the first provider
   * with models. The plugin ships no keys and no provider settings of its own.
   */
  function optionalService(name) {
    try {
      return typeof ctx.get === 'function' ? ctx.get(name) : undefined
    } catch {
      return undefined
    }
  }

  async function resolveModelRoute() {
    const selector = optionalService('agentDefaultModel')
    if (selector !== undefined && typeof selector.currentSelection === 'function') {
      try {
        const selection = selector.currentSelection()
        if (
          selection !== undefined &&
          typeof selection.provider === 'string' &&
          typeof selection.model === 'string' &&
          selection.model.length > 0
        ) {
          return { provider: selection.provider, model: selection.model }
        }
      } catch {
        /* fall through to the first available route */
      }
    }
    let providers = []
    try {
      providers = ctx.llm.listProviders()
    } catch {
      providers = []
    }
    for (const provider of providers) {
      const models = await ctx.llm.listModels(provider.id).catch(() => [])
      if (models.length > 0) return { provider: provider.id, model: models[0].id }
    }
    return null
  }

  /** Expand `@笔记名` mentions in an AI prompt into a short read-only excerpt. */
  async function expandNoteReferences(text) {
    const source = String(text ?? '')
    const names = new Set()
    for (const match of source.matchAll(/@([^\s@，。；、""()（）]+)/g)) {
      const name = String(match[1] ?? '').replace(/\.md$/i, '').trim()
      if (name.length > 0 && name.length <= 60) names.add(name)
    }
    if (names.size === 0) return { text: source, notes: 0 }
    let listed = []
    try {
      listed = (await vault.list('')).notes
    } catch {
      return { text: source, notes: 0 }
    }
    const excerpts = []
    for (const name of [...names].slice(0, 5)) {
      const needle = name.toLowerCase()
      const note =
        listed.find((item) => item.name.toLowerCase() === needle) ??
        listed.find((item) => item.name.toLowerCase().includes(needle))
      if (note === undefined) continue
      const content = await vault.read(note.path).catch(() => null)
      if (content === null) continue
      excerpts.push(`【引用笔记：${note.path}】\n${String(content.content ?? '').slice(0, 2000)}`)
    }
    if (excerpts.length === 0) return { text: source, notes: 0 }
    return { text: `${source}\n\n${excerpts.join('\n\n')}`, notes: excerpts.length }
  }

  /** Validate one AI-panel request before any streaming headers go out. */
  function aiInputSpec(input) {
    const task = typeof input === 'object' && input !== null ? String(input.task ?? '') : ''
    const spec = AI_TASKS[task]
    if (spec === undefined) throw new NotebookError('Unknown AI task.', 'unknown_ai_task')
    const text = typeof input.text === 'string' ? input.text.trim() : ''
    if (text.length === 0) throw new NotebookError('There is no text to send.', 'empty_text')
    if (text.length > AI_MAX_INPUT) {
      throw new NotebookError(`The text is longer than ${AI_MAX_INPUT} characters.`, 'text_too_long')
    }
    return { task, spec, text, locale: input.locale === 'en' ? 'en' : 'zh' }
  }

  /** Run one AI-panel task, optionally mirroring text deltas to a stream. */
  async function runAiGeneration(prepared, route, emit, signal) {
    const { task, spec, text, locale } = prepared
    const expanded = await expandNoteReferences(text)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS)
    const onAbort = () => controller.abort()
    if (signal !== undefined && signal !== null) {
      if (signal.aborted === true) controller.abort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
    let output = ''
    let failure = null
    try {
      const system = locale === 'en' ? spec.systemEn : spec.systemZh
      const messages = [{ role: 'user', content: [{ type: 'text', text: expanded.text }] }]
      for await (const chunk of ctx.llm.stream({
        provider: route.provider,
        model: route.model,
        system,
        messages,
        maxTokens: spec.maxTokens,
        temperature: 0.4,
        signal: controller.signal,
      })) {
        if (chunk.type === 'text-delta') {
          output += chunk.text
          if (typeof emit === 'function') emit({ type: 'delta', text: chunk.text })
        } else if (
          chunk.type === 'finish' &&
          (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')
        ) {
          failure = chunk.reason.failure
        }
      }
    } finally {
      clearTimeout(timer)
      if (signal !== undefined && signal !== null) signal.removeEventListener('abort', onAbort)
    }
    const result = output.trim()
    if (result.length === 0 && failure !== null) {
      throw new NotebookError(failure.message ?? 'The model call failed.', 'model_error')
    }
    return { task, text: result, provider: route.provider, model: route.model }
  }

  async function aiGenerate(input, emit, signal) {
    const prepared = aiInputSpec(input ?? {})
    const route = await resolveModelRoute()
    if (route === null) {
      throw new NotebookError('This Harness has no model configured yet.', 'no_model')
    }
    return runAiGeneration(prepared, route, emit, signal)
  }

  /** SSE variant for the block/page AI panel: meta, deltas, done. */
  async function aiStream(req, res, body) {
    const prepared = aiInputSpec(body ?? {})
    const route = await resolveModelRoute()
    if (route === null) throw new NotebookError('This Harness has no model configured yet.', 'no_model')
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    const send = (event) => {
      if (res.writableEnded === true || res.destroyed === true) return
      res.write(`data: ${JSON.stringify(event)}\n\n`)
    }
    send({ type: 'meta', provider: route.provider, model: route.model })
    const controller = new AbortController()
    const onClose = () => {
      if (res.writableEnded !== true) controller.abort()
    }
    res.on('close', onClose)
    try {
      const result = await runAiGeneration(prepared, route, send, controller.signal)
      send({ type: 'done', text: result.text })
    } catch (error) {
      send({ type: 'error', error: String(error?.message ?? '模型调用失败。') })
    } finally {
      res.off('close', onClose)
    }
    if (res.writableEnded !== true) res.end()
  }

  // ---- Live note, /note command, and agent-style AI (all via Host services) ----
  let currentNote = null
  /**
   * What the panel is looking at inside the open note: the block being edited
   * and the heading it sits under. The agent receives it as prompt context so
   * "this paragraph" / "这段" resolves without guessing.
   */
  let currentFocus = null

  /** Keep the focus hint to a size that is cheap to put in every prompt. */
  function setCurrentFocus(input) {
    if (currentNote === null || input === null || typeof input !== 'object') {
      currentFocus = null
      return
    }
    const path = typeof input.path === 'string' ? input.path.trim() : ''
    if (path.length === 0 || path !== currentNote.path) return
    const text = typeof input.text === 'string' ? input.text.replace(/\s+/g, ' ').trim().slice(0, 500) : ''
    if (text.length === 0) {
      currentFocus = null
      return
    }
    currentFocus = {
      text,
      heading: typeof input.heading === 'string' ? input.heading.replace(/\s+/g, ' ').trim().slice(0, 120) : '',
      kind: typeof input.kind === 'string' ? input.kind.slice(0, 20) : 'paragraph',
      updatedAt: Date.now(),
    }
  }

  /**
   * Remember the note the panel is editing and read enough of it to describe
   * itself in the prompt context (title + first headings).
   */
  async function setCurrentNote(path) {
    if (typeof path !== 'string' || path.length === 0) return
    currentFocus = null
    const entry = { path, updatedAt: Date.now(), title: '', outline: [] }
    currentNote = entry
    try {
      const note = await vault.read(path)
      const body = String(note.content ?? '')
      const lines = body.split(/\r\n|\r|\n/)
      const outline = []
      for (const line of lines) {
        const match = /^(#{1,4})\s+(.+)$/.exec(line.trim())
        if (match === null) continue
        outline.push(`${'  '.repeat(match[1].length - 1)}- ${match[2].trim().slice(0, 60)}`)
        if (outline.length >= 12) break
      }
      const heading = /^#\s+(.+)$/m.exec(body)
      entry.title =
        heading !== null
          ? heading[1].trim().slice(0, 80)
          : String(path).split('/').pop().replace(/\.md$/i, '')
      entry.outline = outline
    } catch {
      /* the note may be gone; the path alone is still useful */
    }
  }

  function focusKindName(kind) {
    switch (kind) {
      case 'heading1':
      case 'heading2':
      case 'heading3':
        return '标题'
      case 'bullet':
      case 'numbered':
        return '列表项'
      case 'todo':
        return '待办事项'
      case 'quote':
        return '引用'
      case 'code':
        return '代码块'
      case 'callout':
        return '提示块'
      case 'toggle':
        return '折叠列表'
      default:
        return '段落'
    }
  }

  function currentNotePromptText() {
    if (currentNote === null) return ''
    const age = Math.max(0, Math.round((Date.now() - currentNote.updatedAt) / 1000))
    const parts = [
      '## 当前笔记本（DSH Notebook）',
      currentNote.title.length > 0
        ? `用户正在 DSH 的笔记本面板中编辑笔记「${currentNote.path}」（标题：${currentNote.title}，${age} 秒前打开）。`
        : `用户正在 DSH 的笔记本面板中编辑笔记「${currentNote.path}」（${age} 秒前打开）。`,
    ]
    if (currentNote.outline.length > 0) {
      parts.push('这篇笔记的大纲：', ...currentNote.outline)
    }
    if (currentFocus !== null) {
      const where = currentFocus.heading.length > 0 ? `「${currentFocus.heading}」下` : ''
      parts.push(
        `用户当前${where ? '聚焦在' : '正在看'}${where}的${focusKindName(currentFocus.kind)}：`,
        `> ${currentFocus.text.slice(0, 300)}`,
        '用户说「这段 / 这里 / 当前块」时指的就是它。',
      )
    }
    parts.push(
      '需要读取或修改笔记时使用 notebook_read / notebook_write 工具；改动后简短说明改了什么。',
      '用户消息里的 `@[[路径]]` 表示引用了一篇笔记；需要内容时用 notebook_read 读取该路径。',
    )
    return parts.join('\n')
  }

  if (ctx.systemPrompt !== undefined && typeof ctx.systemPrompt.context === 'function') {
    ctx.effect(
      () =>
        ctx.systemPrompt.context({
          name: 'dsh-notebook:current-note',
          order: 45,
          text: () => currentNotePromptText(),
        }),
      label('current note prompt context'),
    )
  }

  /**
   * Tell the model about the flash inbox: it is the difference between a chat
   * that forgets an idea and one where the user finds it later.
   */
  const flashPromptText = () =>
    vault.root === null
      ? ''
      : `用户有一个「闪念」收件箱（笔记库里的 ${config.flashDir}/ 文件夹，用来收纳零散的想法片段）。` +
        '当他在聊天里冒出一个以后想继续发展的想法、待办或灵感——而不是在提问、排错或讨论实现细节——' +
        '你可以直接调用 notebook_flash（action: capture）记下来；用户说「记一下 / 帮我记 / 别忘了我刚说的」时同样处理。' +
        'text 用用户原话（可稍作整理），category 从 随记/想法/待办/灵感/摘录 中按语义选一个。' +
        '不要为普通问答、代码、命令输出或寒暄建闪念；每次回复最多记一条，记完用一句话说明，不要长篇解释。'

  if (ctx.systemPrompt !== undefined && typeof ctx.systemPrompt.context === 'function') {
    ctx.effect(
      () =>
        ctx.systemPrompt.context({
          name: 'dsh-notebook:flash',
          order: 46,
          text: flashPromptText,
        }),
      label('flash prompt context'),
    )
  }

  /** `/note save [标题]`: write the current conversation into a vault note. */
  async function saveConversationNote(invocation, title) {
    let session = null
    try {
      const store = typeof ctx.get === 'function' ? ctx.get('sessions') : undefined
      if (store !== undefined && typeof store.get === 'function' && invocation?.agent?.id !== undefined) {
        session = store.get(invocation.agent.id)
      }
    } catch {
      session = null
    }
    if (session === null || session === undefined) {
      return { kind: 'error', text: '读不到当前会话内容，暂时无法保存对话。' }
    }
    let messages = []
    try {
      messages = session.deriveMessages()
    } catch {
      messages = []
    }
    const turns = []
    for (const message of messages) {
      if (message.role !== 'user' && message.role !== 'assistant') continue
      const text = (Array.isArray(message.content) ? message.content : [])
        .filter((block) => block !== null && block.type === 'text')
        .map((block) => String(block.text ?? ''))
        .join('\n')
        .trim()
      if (text.length === 0) continue
      turns.push(message.role === 'user' ? `**我：**\n\n${text}` : `**助手：**\n\n${text}`)
    }
    if (turns.length === 0) {
      return { kind: 'error', text: '当前会话还没有可保存的对话。' }
    }
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
    const name = title.length > 0 ? title : `对话记录 ${stamp}`
    const body = turns.slice(-20).join('\n\n---\n\n')
    const content = `---\nsource: conversation\nsession: ${String(invocation.agent.id)}\n---\n\n# ${name}\n\n${body}\n`
    for (let attempt = 1; attempt <= 50; attempt += 1) {
      const path = attempt === 1 ? `${name}.md` : `${name} ${attempt}.md`
      try {
        const result = await vault.write(path, content, 'create')
        return { kind: 'success', text: `已把最近 ${Math.min(turns.length, 20)} 条对话保存成笔记：${result.path ?? path}` }
      } catch (error) {
        if (error.code !== 'note_exists') return { kind: 'error', text: error.message }
      }
    }
    return { kind: 'error', text: '同名笔记太多了，换一个标题再试。' }
  }

  /** `/note new [标题]`: create an empty note in the vault root. */
  async function createNoteFromCommand(title) {
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
    const name = title.length > 0 ? title : `新笔记 ${stamp}`
    for (let attempt = 1; attempt <= 50; attempt += 1) {
      const path = attempt === 1 ? `${name}.md` : `${name} ${attempt}.md`
      try {
        const result = await vault.write(path, '', 'create')
        return { kind: 'success', text: `已新建笔记：${result.path ?? path}` }
      } catch (error) {
        if (error.code !== 'note_exists') return { kind: 'error', text: error.message }
      }
    }
    return { kind: 'error', text: '同名笔记太多了，换一个标题再试。' }
  }

  /**
   * `/note agent <task>`: hand the task to a native Harness sub Agent (the same
   * fork provider the Agent tool uses). It inherits the parent's tools — so the
   * notebook tools are available — and its result is delivered to the parent
   * conversation via `delivery: 'parent'`.
   */
  async function runNotebookSubagent(invocation, task) {
    const subagents = optionalService('subagents')
    if (subagents === undefined || typeof subagents.startActivation !== 'function') {
      return { kind: 'error', text: '当前 Harness 没有可用的子 Agent 服务。' }
    }
    let providers = []
    try {
      providers = subagents.list()
    } catch {
      providers = []
    }
    if (!Array.isArray(providers) || providers.length === 0) {
      return { kind: 'error', text: '没有已注册的子 Agent provider，暂时无法启动子 Agent。' }
    }
    const provider =
      providers.find((name) => typeof name === 'string' && /fork|agent/i.test(name)) ?? providers[0]
    const controller = new AbortController()
    try {
      const activation = await subagents.startActivation({
        provider,
        label: `notebook: ${task.slice(0, 40)}`,
        request: {
          prompt: [{ type: 'text', text: task }],
          parent: invocation.agent,
          signal: controller.signal,
        },
        signal: controller.signal,
        delivery: 'parent',
      })
      return {
        kind: 'success',
        text: `已启动子 Agent（provider: ${provider}）。它会用 notebook 工具处理任务，结果会发回当前对话。`,
      }
    } catch (error) {
      return { kind: 'error', text: `子 Agent 启动失败：${error.message}` }
    }
  }

  if (ctx.commands !== undefined && typeof ctx.commands.register === 'function') {
    ctx.effect(
      () =>
        ctx.commands.register({
          definitionId: 'dsh-notebook:note',
          name: 'note',
          description:
            'Notebook: 显示当前笔记；/note <名字> 切换；/note save [标题] 保存对话；/note new [标题] 新建笔记；' +
            '/note ask <问题> 让笔记本的只读 Agent 回答；/note agent <任务> 起子 Agent 改写笔记',
          input: { hint: '<名字> | save [标题] | new [标题] | ask <问题> | agent <任务>' },
          handler: async (invocation) => {
            const raw = typeof invocation?.rawInput === 'string' ? invocation.rawInput.trim() : ''
            if (raw.length === 0) {
              if (currentNote === null) {
                return { kind: 'success', text: '笔记本还没有打开任何笔记，先在笔记面板里打开一篇。' }
              }
              const focusLine =
                currentFocus === null
                  ? ''
                  : `\n正在编辑：${currentFocus.heading.length > 0 ? `「${currentFocus.heading}」下` : ''}${
                      focusKindName(currentFocus.kind)
                    }「${currentFocus.text.slice(0, 80)}${currentFocus.text.length > 80 ? '…' : ''}」`
              return {
                kind: 'success',
                text: `当前笔记：${currentNote.path}${
                  currentNote.title.length > 0 ? `（${currentNote.title}）` : ''
                }${focusLine}`,
              }
            }
            const [verbRaw, ...restWords] = raw.split(/\s+/)
            const verb = String(verbRaw ?? '').toLowerCase()
            const rest = restWords.join(' ').trim()
            if (verb === 'save') return saveConversationNote(invocation, rest)
            if (verb === 'new') return createNoteFromCommand(rest)
            if (verb === 'agent') {
              if (rest.length === 0) {
                return { kind: 'error', text: '用法：/note agent <要做的事>，例如 /note agent 把当前笔记整理成小节' }
              }
              return runNotebookSubagent(invocation, rest)
            }
            if (verb === 'ask') {
              if (rest.length === 0) {
                return { kind: 'error', text: '用法：/note ask <问题>，例如 /note ask 这篇笔记的结论是什么' }
              }
              try {
                const result = await askAgentRun({
                  question: rest,
                  path: currentNote === null ? '' : currentNote.path,
                  locale: 'zh',
                })
                return { kind: 'success', text: result.text }
              } catch (error) {
                return { kind: 'error', text: `提问失败：${error.message}` }
              }
            }
            if (verb === 'open') {
              return currentNote === null
                ? { kind: 'error', text: '笔记本还没有打开任何笔记。' }
                : {
                    kind: 'success',
                    text: `当前笔记：${currentNote.path}。点侧栏的「笔记本」图标即可回到面板。`,
                  }
            }
            const listed = await vault.list('')
            const needle = verb === 'note' ? rest.toLowerCase() : raw.toLowerCase()
            const matches = listed.notes.filter(
              (note) =>
                note.name.toLowerCase().includes(needle) || note.path.toLowerCase().includes(needle),
            )
            if (matches.length === 0) {
              return { kind: 'error', text: `没有找到包含「${needle}」的笔记。` }
            }
            if (matches.length > 1) {
              return {
                kind: 'success',
                text: `匹配到多篇笔记，请用更完整的名字：\n${matches.slice(0, 8).map((note) => note.path).join('\n')}`,
              }
            }
            await setCurrentNote(matches[0].path)
            return {
              kind: 'success',
              text: `已切换当前笔记：${matches[0].path}。之后的对话里我会知道你在看这篇。`,
            }
          },
        }),
      label('note command'),
    )
  }

  /** `/flash <想法>`: capture from the chat without leaving the conversation. */
  async function recordFlashCommand(invocation) {
    const raw = typeof invocation?.rawInput === 'string' ? invocation.rawInput.trim() : ''
    try {
      if (raw.length === 0) {
        const summary = await flash.summary()
        const recent = await flash.list({ status: 'inbox', limit: 5 })
        const lines = [
          `闪念收件箱：${summary.counts.inbox} 条待整理（共 ${summary.counts.total} 条），位置 ${summary.dir}/`,
        ]
        for (const item of recent.items) {
          lines.push(
            `· ${new Date(item.createdMs).toLocaleString('zh-CN')} [${item.category}] ${item.preview.slice(0, 60)}`,
          )
        }
        if (recent.items.length === 0) {
          lines.push('用法：/flash <想法>，或 /flash <分类> <想法>（随记/想法/待办/灵感/摘录）')
        }
        return { kind: 'success', text: lines.join('\n') }
      }
      const words = raw.split(/\s+/)
      const category = FLASH_CATEGORIES.includes(words[0]) && words.length > 1 ? words.shift() : undefined
      const text = words.join(' ').trim()
      if (text.length === 0) {
        return { kind: 'error', text: '用法：/flash <想法>，或 /flash <分类> <想法>' }
      }
      const created = await flash.create({ text, category })
      return { kind: 'success', text: `已记下闪念 → ${created.path}（${created.category}）` }
    } catch (error) {
      return { kind: 'error', text: `记闪念失败：${(error && error.message) || error}` }
    }
  }

  if (ctx.commands !== undefined && typeof ctx.commands.register === 'function') {
    ctx.effect(
      () =>
        ctx.commands.register({
          definitionId: 'dsh-notebook:flash',
          name: 'flash',
          description: '闪念：/flash <想法> 记一条；/flash <分类> <想法> 指定分类；/flash 查看收件箱',
          input: { hint: '<想法> | <分类> <想法>' },
          handler: recordFlashCommand,
        }),
      label('flash command'),
    )
    // A Chinese alias is nice to type; if the Host rejects non-ASCII command
    // names, the English one still works.
    ctx.effect(() => {
      try {
        return ctx.commands.register({
          definitionId: 'dsh-notebook:闪念',
          name: '闪念',
          description: '闪念：/闪念 <想法> 记一条',
          input: { hint: '<想法>' },
          handler: recordFlashCommand,
        })
      } catch {
        return () => {}
      }
    }, label('flash alias command'))
  }

  const AI_AGENT_MAX_STEPS = 6
  const AI_AGENT_SYSTEM = [
    '你是 DSH 笔记本里的写作 Agent，可以读写用户的 Obsidian 笔记。',
    '每次只输出一个 JSON 对象，不要输出解释或 Markdown 代码块：',
    '{"tool":"list","folder":"可选目录"} 列出笔记',
    '{"tool":"read","path":"笔记路径"} 读取笔记全文',
    '{"tool":"search","query":"关键词"} 全文搜索',
    '{"tool":"write","path":"笔记路径","content":"完整的新内容"} 写回笔记（覆盖）',
    '{"done":"给用户的最终说明"} 任务完成时输出',
    '规则：先 read 再 write；只改用户提到的笔记；内容用 Markdown；最终说明用中文，简短列出改动。',
  ].join('\n')

  /**
   * Take the first complete JSON object from a model reply. Models sometimes
   * emit several actions at once, so the brace that closes depth 0 ends the
   * candidate (string literals inside `content` are skipped).
   */
  function parseAiAction(content) {
    const raw = String(content ?? '').trim()
    const start = raw.indexOf('{')
    if (start < 0) return null
    let depth = 0
    let inString = false
    let escaped = false
    for (let index = start; index < raw.length; index += 1) {
      const char = raw[index]
      if (inString) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') inString = false
        continue
      }
      if (char === '"') {
        inString = true
        continue
      }
      if (char === '{') depth += 1
      else if (char === '}') {
        depth -= 1
        if (depth === 0) {
          try {
            const parsed = JSON.parse(raw.slice(start, index + 1))
            return parsed !== null && typeof parsed === 'object' ? parsed : null
          } catch {
            return null
          }
        }
      }
    }
    return null
  }

  async function aiToolCall(call) {
    const name = String(call?.tool ?? '')
    if (name === 'list') {
      const result = await vault.list(typeof call.folder === 'string' ? call.folder : '')
      const lines = result.notes.slice(0, 80).map((note) => note.path)
      return lines.length > 0 ? lines.join('\n') : '(empty)'
    }
    if (name === 'read') {
      const note = await vault.read(String(call.path ?? ''))
      return String(note.content ?? '').slice(0, 6000)
    }
    if (name === 'search') {
      const result = await vault.search(String(call.query ?? ''), 20)
      return result.matches
        .map((match) => `${match.path}:${match.line}: ${match.text}`)
        .join('\n') || '(no matches)'
    }
    if (name === 'write') {
      const result = await vault.write(String(call.path ?? ''), String(call.content ?? ''), 'replace')
      return `wrote ${result.path ?? call.path}`
    }
    throw new NotebookError(`Unknown AI tool: ${name}`, 'unknown_ai_tool')
  }

  async function aiAgentRun(instruction) {
    const text = String(instruction ?? '').trim()
    if (text.length === 0) throw new NotebookError('There is no instruction to run.', 'empty_instruction')
    if (text.length > 4000) {
      throw new NotebookError('The instruction is longer than 4000 characters.', 'instruction_too_long')
    }
    const route = await resolveModelRoute()
    if (route === null) throw new NotebookError('This Harness has no model configured yet.', 'no_model')
    try {
      return await runAiAgentLoop(text, route)
    } catch (error) {
      console.error('[dsh-notebook] ai agent failed:', error && error.stack ? error.stack : error)
      throw error
    }
  }

  async function runAiAgentLoop(text, route) {
    const expanded = await expandNoteReferences(text)
    const taskText = expanded.text
    const steps = []
    const writes = []
    const history = []
    for (let step = 0; step < AI_AGENT_MAX_STEPS; step += 1) {
      // Each step is one self-contained user turn: the adapter replays history
      // from Session logs only, so a hand-built assistant/tool history is not
      // accepted here. The transcript is folded into the prompt instead.
      const prompt =
        step === 0
          ? taskText
          : [
              `原始任务：${taskText}`,
              '已执行步骤：',
              ...history.map((entry, index) => `${index + 1}. ${entry.tool} → ${entry.result}`),
              '请继续：输出下一个 JSON 动作，或 {"done":"给用户的最终说明"} 结束。',
            ].join('\n')
      const messages = [{ role: 'user', content: [{ type: 'text', text: prompt }] }]
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS)
      let reply = ''
      let failure = null
      try {
        for await (const chunk of ctx.llm.stream({
          provider: route.provider,
          model: route.model,
          system: AI_AGENT_SYSTEM,
          messages,
          maxTokens: 1200,
          temperature: 0.3,
          signal: controller.signal,
        })) {
          if (chunk.type === 'text-delta') reply += chunk.text
          else if (
            chunk.type === 'finish' &&
            (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')
          ) {
            failure = chunk.reason.failure
          }
        }
      } finally {
        clearTimeout(timer)
      }
      const content = reply.trim()
      if (content.length === 0 && failure !== null) {
        throw new NotebookError(failure.message ?? 'The model call failed.', 'model_error')
      }
      const action = parseAiAction(content)
      if (action === null) return { text: content, steps, writes, provider: route.provider, model: route.model }
      if (typeof action.done === 'string' && action.done.trim().length > 0) {
        return { text: action.done.trim(), steps, writes, provider: route.provider, model: route.model }
      }
      if (typeof action.tool === 'string') {
        let resultText = ''
        try {
          resultText = await aiToolCall(action)
          steps.push({ tool: action.tool, ok: true })
          if (action.tool === 'write') writes.push(String(action.path ?? ''))
        } catch (error) {
          resultText = `ERROR: ${error.message}`
          steps.push({ tool: action.tool, ok: false })
        }
        // Assistant turns need the provider metadata the adapter reads back.
        history.push({ tool: String(action.tool), result: String(resultText).slice(0, 800) })
        continue
      }
      return { text: content, steps, writes, provider: route.provider, model: route.model }
    }
    return { text: '已达到执行步数上限，请查看笔记确认结果。', steps, writes, provider: route.provider, model: route.model }
  }

  const ASK_MAX_QUESTION = 4000
  const ASK_MAX_CONTEXT = 16000
  const ASK_HISTORY_TURNS = 8
  const ASK_MAX_TOKENS = 2000
  const ASK_AGENT_MAX_STEPS = 5

  const ASK_AGENT_SYSTEM_ZH = [
    '你是 DSH 笔记本里的检索助手，可以读取和搜索用户的 Obsidian 笔记，但不能修改任何文件。',
    '每次只输出一个 JSON 对象，不要输出解释或 Markdown 代码块：',
    '{"tool":"list","folder":"可选目录"} 列出笔记',
    '{"tool":"read","path":"笔记路径"} 读取笔记全文',
    '{"tool":"search","query":"关键词"} 全文搜索',
    '{"done":"给用户的回答"} 能回答时结束',
    '规则：需要时先查再答；引用笔记时写明路径；回答用中文 Markdown，简洁直接；不要建议或执行写操作。',
  ].join('\n')

  const ASK_AGENT_SYSTEM_EN = [
    'You are the retrieval assistant inside the DSH notebook. You may read and search the user\'s Obsidian notes but must not modify any file.',
    'Emit exactly one JSON object per reply, no prose and no code fences:',
    '{"tool":"list","folder":"optional folder"} list notes',
    '{"tool":"read","path":"vault-relative path"} read a note',
    '{"tool":"search","query":"text"} full-text search',
    '{"done":"answer for the user"} finish when you can answer',
    'Rules: look things up when needed; name the note paths you quote; answer concisely in English Markdown; never write.',
  ].join('\n')

  /**
   * One read-only agent pass behind the ask panel's Agent mode: the model may
   * list/read/search notes across the vault, but a write action is refused no
   * matter what it emits.
   */
  async function askAgentRun(input, emit) {
    const question = typeof input?.question === 'string' ? input.question.trim() : ''
    if (question.length === 0) throw new NotebookError('请先输入问题。', 'empty_question')
    if (question.length > ASK_MAX_QUESTION) throw new NotebookError('问题太长了。', 'question_too_long')
    const route = await resolveModelRoute()
    if (route === null) throw new NotebookError('这个 Harness 还没有配置可用的模型。', 'no_model')
    const locale = input?.locale === 'en' ? 'en' : 'zh'
    const path = typeof input?.path === 'string' ? input.path.trim() : ''
    const focus = currentFocus !== null && currentNote !== null && currentNote.path === path ? currentFocus : null
    const selection =
      typeof input?.selection === 'string' ? input.selection.replace(/\s+/g, ' ').trim().slice(0, 1000) : ''
    const task = [
      path.length > 0 ? `当前笔记：${path}` : '',
      focus !== null
        ? `当前聚焦：${focus.heading.length > 0 ? `「${focus.heading}」下` : ''}${focusKindName(focus.kind)}：${focus.text.slice(0, 300)}`
        : '',
      selection.length > 0 ? `选中的文字：${selection}` : '',
      `问题：${question}`,
    ]
      .filter(Boolean)
      .join('\n')
    const system = locale === 'en' ? ASK_AGENT_SYSTEM_EN : ASK_AGENT_SYSTEM_ZH
    const outerSignal = input?.signal
    const history = []
    const steps = []
    for (let step = 0; step < ASK_AGENT_MAX_STEPS; step += 1) {
      const prompt =
        step === 0
          ? task
          : [
              task,
              '已执行步骤：',
              ...history.map((entry, index) => `${index + 1}. ${entry.tool} → ${entry.result}`),
              '请继续：输出下一个 JSON 动作，或 {"done":"给用户的回答"} 结束。',
            ].join('\n')
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS)
      const onAbort = () => controller.abort()
      if (outerSignal !== undefined && outerSignal !== null) {
        if (outerSignal.aborted === true) controller.abort()
        else outerSignal.addEventListener('abort', onAbort, { once: true })
      }
      let reply = ''
      let failure = null
      try {
        for await (const chunk of ctx.llm.stream({
          provider: route.provider,
          model: route.model,
          system,
          messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
          maxTokens: 1200,
          temperature: 0.2,
          signal: controller.signal,
        })) {
          if (chunk.type === 'text-delta') reply += chunk.text
          else if (
            chunk.type === 'finish' &&
            (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')
          ) {
            failure = chunk.reason.failure
          }
        }
      } finally {
        clearTimeout(timer)
        if (outerSignal !== undefined && outerSignal !== null) outerSignal.removeEventListener('abort', onAbort)
      }
      if (outerSignal !== undefined && outerSignal !== null && outerSignal.aborted === true) {
        throw new NotebookError('已取消。', 'aborted')
      }
      const content = reply.trim()
      if (content.length === 0 && failure !== null) {
        throw new NotebookError(failure.message ?? 'The model call failed.', 'model_error')
      }
      const action = parseAiAction(content)
      if (action === null) return { text: content, steps, provider: route.provider, model: route.model }
      if (typeof action.done === 'string' && action.done.trim().length > 0) {
        return { text: action.done.trim(), steps, provider: route.provider, model: route.model }
      }
      if (typeof action.tool === 'string') {
        const tool = String(action.tool)
        let resultText = ''
        try {
          if (tool === 'write') throw new NotebookError('只读模式不能修改笔记。', 'read_only')
          resultText = await aiToolCall(action)
          steps.push({ tool, ok: true })
          if (typeof emit === 'function') emit({ type: 'step', tool, ok: true })
        } catch (error) {
          resultText = `ERROR: ${error.message}`
          steps.push({ tool, ok: false })
          if (typeof emit === 'function') emit({ type: 'step', tool, ok: false })
        }
        history.push({ tool, result: String(resultText).slice(0, 800) })
        continue
      }
      return { text: content, steps, provider: route.provider, model: route.model }
    }
    return { text: '已达到执行步数上限，请把问题问得更具体一些。', steps, provider: route.provider, model: route.model }
  }

  /** The system prompt for the notebook's ask panel: the note, focus and rules. */
  function askPromptText(locale, notePath, noteTitle, noteContent, focus, selection) {
    const lines = []
    if (locale === 'en') {
      lines.push(
        'You are the Q&A assistant inside the DSH notebook panel. The user is reading a Markdown note; answer from it, explain, point out gaps or contradictions, and suggest next steps.',
      )
      lines.push(`Note path: ${notePath}`)
      if (noteTitle.length > 0) lines.push(`Note title: ${noteTitle}`)
      if (selection.length > 0) {
        lines.push('The user selected this text in the note:', `> ${selection.slice(0, 800)}`)
        lines.push('When the user says "this text", "this part" or "here", that is what they mean.')
      }
      if (focus !== null) {
        lines.push(
          `The user is looking at the ${focusKindName(focus.kind)}${
            focus.heading.length > 0 ? ` under "${focus.heading}"` : ''
          }:`,
        )
        lines.push(`> ${focus.text.slice(0, 300)}`)
        lines.push('When the user says "this paragraph" or "here", that is what they mean.')
      }
      if (noteContent.length > 0) lines.push('Note content (may be truncated):', '<<<', noteContent, '>>>')
      lines.push(
        'Answer in English Markdown, concise. Quote the note as written. Do not invent facts the note does not contain.',
      )
    } else {
      lines.push(
        '你是 DSH 笔记本面板里的问答助手。用户在阅读一篇 Markdown 笔记：可以基于它回答问题、解释概念、指出没写清楚或前后矛盾的地方，并给出下一步建议。',
      )
      lines.push(`笔记路径：${notePath}`)
      if (noteTitle.length > 0) lines.push(`笔记标题：${noteTitle}`)
      if (selection.length > 0) {
        lines.push('用户在笔记里选中了这段文字：', `> ${selection.slice(0, 800)}`)
        lines.push('用户说「这段 / 这里 / 选中的」时指的就是它。')
      }
      if (focus !== null) {
        lines.push(
          `用户当前看着${focus.heading.length > 0 ? `「${focus.heading}」下的` : ''}${focusKindName(focus.kind)}：`,
        )
        lines.push(`> ${focus.text.slice(0, 300)}`)
        lines.push('用户说「这段 / 这里」时指的就是它。')
      }
      if (noteContent.length > 0) lines.push('笔记内容如下（可能被截断）：', '<<<', noteContent, '>>>')
      lines.push('用中文 Markdown 简洁回答；引用笔记原文时保持原样；不要编造笔记里没有的事实。')
    }
    return lines.join('\n')
  }

  /**
   * Stream one answer to the right-panel ask UI as server-sent events. Headers
   * go out only after every failure that can still become a JSON error; after
   * that the stream reports its own `error`/`done` events.
   */
  async function askStream(req, res, body) {
    const question = typeof body?.question === 'string' ? body.question.trim() : ''
    if (question.length === 0) throw new NotebookError('请先输入问题。', 'empty_question')
    if (question.length > ASK_MAX_QUESTION) throw new NotebookError('问题太长了。', 'question_too_long')
    const requested = typeof body?.path === 'string' ? body.path.trim() : ''
    const path = requested.length > 0 ? requested : (currentNote?.path ?? '')
    let note = null
    if (path.length > 0) {
      try {
        note = await vault.read(path)
      } catch {
        note = null
      }
    }
    const route = await resolveModelRoute()
    if (route === null) throw new NotebookError('这个 Harness 还没有配置可用的模型。', 'no_model')
    const locale = body?.locale === 'en' ? 'en' : 'zh'
    const messages = []
    for (const turn of (Array.isArray(body?.history) ? body.history : []).slice(-ASK_HISTORY_TURNS)) {
      const text = typeof turn?.text === 'string' ? turn.text.trim().slice(0, ASK_MAX_QUESTION) : ''
      if (text.length === 0) continue
      messages.push({
        role: turn.role === 'assistant' ? 'assistant' : 'user',
        content: [{ type: 'text', text }],
      })
    }
    messages.push({ role: 'user', content: [{ type: 'text', text: question }] })
    const focus = currentFocus !== null && currentNote !== null && currentNote.path === path ? currentFocus : null
    const title = currentNote !== null && currentNote.path === path ? currentNote.title : ''
    const selection =
      typeof body?.selection === 'string' ? body.selection.replace(/\s+/g, ' ').trim().slice(0, 1000) : ''
    const system = askPromptText(locale, path, title, (note?.content ?? '').slice(0, ASK_MAX_CONTEXT), focus, selection)

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    const send = (event) => {
      if (res.writableEnded === true || res.destroyed === true) return
      res.write(`data: ${JSON.stringify(event)}\n\n`)
    }
    send({ type: 'meta', provider: route.provider, model: route.model })
    const controller = new AbortController()
    // 'request close' fires once the body is consumed; the response closing is
    // the signal that the browser really went away, so abort on that only.
    const onClose = () => {
      if (res.writableEnded !== true) controller.abort()
    }
    res.on('close', onClose)
    const timer = setTimeout(() => controller.abort(), 120000)
    let failure = null
    try {
      for await (const chunk of ctx.llm.stream({
        provider: route.provider,
        model: route.model,
        system,
        messages,
        maxTokens: ASK_MAX_TOKENS,
        temperature: 0.3,
        signal: controller.signal,
      })) {
        if (chunk.type === 'text-delta') send({ type: 'delta', text: chunk.text })
        else if (
          chunk.type === 'finish' &&
          (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')
        ) {
          failure = chunk.reason.failure ?? { message: '模型调用失败。' }
        }
      }
    } catch (error) {
      failure = error
    } finally {
      clearTimeout(timer)
      res.off('close', onClose)
    }
    if (failure !== null) send({ type: 'error', error: String(failure.message ?? '模型调用失败。') })
    send({ type: 'done' })
    if (res.writableEnded !== true) res.end()
  }

  /**
   * Stream one read-only agent run: a meta event, one step event per tool call,
   * the final answer, then done. Validation failures stay JSON errors because
   * they happen before the headers go out.
   */
  async function askAgentStream(req, res, body) {
    const question = typeof body?.question === 'string' ? body.question.trim() : ''
    if (question.length === 0) throw new NotebookError('请先输入问题。', 'empty_question')
    if (question.length > ASK_MAX_QUESTION) throw new NotebookError('问题太长了。', 'question_too_long')
    const route = await resolveModelRoute()
    if (route === null) throw new NotebookError('这个 Harness 还没有配置可用的模型。', 'no_model')
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    const send = (event) => {
      if (res.writableEnded === true || res.destroyed === true) return
      res.write(`data: ${JSON.stringify(event)}\n\n`)
    }
    send({ type: 'meta', provider: route.provider, model: route.model })
    const controller = new AbortController()
    const onClose = () => {
      if (res.writableEnded !== true) controller.abort()
    }
    res.on('close', onClose)
    try {
      const result = await askAgentRun({ ...body, signal: controller.signal }, send)
      send({ type: 'answer', text: result.text, steps: result.steps.length })
    } catch (error) {
      send({ type: 'error', error: String(error?.message ?? '检索失败。') })
    } finally {
      res.off('close', onClose)
    }
    send({ type: 'done' })
    if (res.writableEnded !== true) res.end()
  }

  /* ---------------- semantic recall (local ranking + model expansion) ---------------- */

  /**
   * Character bigrams for Chinese plus latin words. Used both to index note
   * heads and to break a query into searchable pieces: "系统升级坏了" still
   * matches a note that only says "升级" and "回滚".
   */
  function recallTokens(text) {
    const lower = String(text ?? '').toLowerCase()
    const tokens = new Set()
    for (const match of lower.matchAll(/[a-z0-9][a-z0-9_-]{1,}/g)) tokens.add(match[0])
    for (const run of lower.replace(/[^\u3400-\u9fff]+/g, ' ').split(' ')) {
      if (run.length === 1) tokens.add(run)
      for (let index = 0; index + 2 <= run.length; index += 1) tokens.add(run.slice(index, index + 2))
    }
    return [...tokens]
  }

  function countHits(haystack, needle) {
    if (needle.length === 0) return 0
    let count = 0
    let at = 0
    while ((at = haystack.indexOf(needle, at)) !== -1) {
      count += 1
      at += needle.length
      if (count >= 4) break
    }
    return count
  }

  function recallSnippet(text, terms) {
    const lower = text.toLowerCase()
    for (const term of terms) {
      const at = lower.indexOf(term.toLowerCase())
      if (at < 0) continue
      const start = Math.max(0, at - 40)
      return text.slice(start, start + 160).replace(/\s+/g, ' ').trim()
    }
    return text.replace(/\s+/g, ' ').trim().slice(0, 140)
  }

  /** Note heads (8 KB) cached until the vault's file list or mtimes change. */
  const recallCache = { signature: '', docs: [] }

  async function recallDocs() {
    if (vault.root === null) return []
    const notes = []
    await walkNotes(vault.root, vault.root, notes, Math.min(config.maxIndexFiles, 1200))
    const signature = `${notes.length}:${notes.reduce((max, note) => Math.max(max, note.mtimeMs), 0)}`
    if (recallCache.signature === signature && recallCache.docs.length > 0) return recallCache.docs
    const docs = []
    for (const note of notes) {
      const head = await vault.head(note.path, 8192).catch(() => null)
      if (head === null) continue
      const body = head.head.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
      if (body.trim().length === 0) continue
      docs.push({ path: note.path, text: body, lower: body.toLowerCase() })
    }
    recallCache.signature = signature
    recallCache.docs = docs
    return docs
  }

  /** One expansion attempt; returns terms plus why it produced none. */
  async function expandOnce(route, query, attempt) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    let reply = ''
    let finish = null
    try {
      for await (const chunk of ctx.llm.stream({
        provider: route.provider,
        model: route.model,
        system:
          attempt === 0
            ? '你是检索助手。把用户的查询改写成 6-10 个语义相关的检索词：同义词、近义词、上位词、常见别称、相关概念。' +
              '只输出这些词，用中文逗号分隔，不要编号、不要解释、不要引号。'
            : '只输出 6 个与用户查询意思相关的检索词，用中文逗号分隔。不要任何其他文字。',
        messages: [{ role: 'user', content: [{ type: 'text', text: query }] }],
        maxTokens: 600,
        temperature: attempt === 0 ? 0.2 : 0.1,
        signal: controller.signal,
      })) {
        if (chunk.type === 'text-delta') reply += chunk.text
        else if (chunk.type === 'finish') finish = chunk.reason.kind
      }
    } catch (error) {
      return { terms: [], error: String((error && error.message) || error) }
    } finally {
      clearTimeout(timer)
    }
    const seen = new Set()
    const terms = []
    for (const raw of reply.split(/[,，、\n]/)) {
      const term = raw
        .trim()
        .replace(/^[\s"'「」【】\[\]()\d.、-]+/, '')
        .replace(/[\s"'「」【】\[\]()]+$/, '')
      if (term.length < 2 || term.length > 20 || seen.has(term)) continue
      seen.add(term)
      terms.push(term)
      if (terms.length >= 12) break
    }
    return {
      terms,
      error: terms.length > 0 ? null : `empty expansion (finish=${finish ?? 'none'}, reply=${reply.trim().slice(0, 60)})`,
    }
  }

  /** Ask the configured model for synonyms and related terms; [] when unavailable. */
  async function expandRecallQuery(route, query) {
    if (route === null || ctx.llm === undefined) {
      return { terms: [], error: route === null ? 'no model route' : 'no llm service' }
    }
    let lastError = null
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await expandOnce(route, query, attempt)
      if (result.terms.length > 0) return result
      lastError = result.error
    }
    return { terms: [], error: lastError }
  }

  /** Pull the first JSON array out of a model reply. */
  function firstJsonArray(text) {
    const raw = String(text ?? '')
    const start = raw.indexOf('[')
    const end = raw.lastIndexOf(']')
    if (start < 0 || end <= start) return null
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1))
      return Array.isArray(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  /**
   * Second pass: let the model judge the shortlist. Term matching alone cannot
   * tell "系统升级坏了" from a note that merely repeats 系统 and 故障; the model
   * can, and returns the few that actually answer the query.
   */
  async function rerankRecall(route, query, candidates) {
    if (candidates.length < 2 || ctx.llm === undefined) return null
    const rows = candidates
      .slice(0, 10)
      .map((entry, index) => `${index + 1}. ${entry.path}\n${entry.snippet.slice(0, 180)}`)
      .join('\n\n')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    let reply = ''
    try {
      for await (const chunk of ctx.llm.stream({
        provider: route.provider,
        model: route.model,
        system:
          '你是检索重排器。根据用户查询，从候选笔记里挑出真正相关的最多 5 条。' +
          '只输出 JSON 数组，例如 [{"i":2,"why":"讲的就是这个"}]；没有相关笔记时输出 []。' +
          'i 是候选编号，why 不超过 20 字。不要输出其他内容。',
        messages: [{ role: 'user', content: [{ type: 'text', text: `查询：${query}\n\n候选：\n${rows}` }] }],
        maxTokens: 500,
        temperature: 0.1,
        signal: controller.signal,
      })) {
        if (chunk.type === 'text-delta') reply += chunk.text
      }
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
    const parsed = firstJsonArray(reply)
    if (parsed === null) return null
    const picked = []
    for (const row of parsed) {
      const index = Number(row?.i)
      if (!Number.isInteger(index) || index < 1 || index > candidates.length) continue
      const candidate = candidates[index - 1]
      if (candidate === undefined || picked.some((entry) => entry.path === candidate.path)) continue
      picked.push({
        ...candidate,
        why: typeof row?.why === 'string' ? row.why.slice(0, 40) : '',
      })
      if (picked.length >= 5) break
    }
    return picked.length > 0 ? picked : null
  }

  /**
   * Rank notes by meaning as far as this stack allows: the model widens the
   * query with related terms, then a local weighted match ranks note heads.
   * No embedding model is available in the Host, so this is described honestly
   * as term expansion + fuzzy ranking rather than vector search.
   */
  async function semanticSearch(rawQuery, limit = 8, options = {}) {
    const query = String(rawQuery ?? '').trim()
    if (query.length === 0) throw new NotebookError('A search query is required.', 'missing_query')
    if (query.length > 300) throw new NotebookError('The query is too long.', 'query_too_long')
    if (vault.root === null) throw new NotebookError('No vault is configured.', 'no_vault')
    const route = options.expand === false ? null : await resolveModelRoute().catch(() => null)
    const expansion = route === null ? { terms: [], error: 'expansion disabled' } : await expandRecallQuery(route, query)
    const expansions = expansion.terms
    const terms = []
    const weights = new Map()
    const addTerm = (term, weight) => {
      const key = String(term ?? '').toLowerCase()
      if (key.length === 0 || weights.has(key)) return
      weights.set(key, weight)
      terms.push({ term, weight })
    }
    addTerm(query, 4)
    for (const expansion of expansions) addTerm(expansion, 2)
    // A related phrase rarely appears verbatim: its pieces are what match.
    for (const expansion of expansions) {
      for (const token of recallTokens(expansion)) addTerm(token, 1.2)
    }
    for (const token of recallTokens(query)) addTerm(token, 1)
    const docs = await recallDocs()
    // A term that appears in most notes ("系统", "问题") says little. One
    // document-frequency pass over the candidates makes rare terms win.
    const docFreq = new Map()
    for (const { term } of terms) {
      const key = term.toLowerCase()
      let count = 0
      for (const doc of docs) if (doc.lower.includes(key)) count += 1
      docFreq.set(key, count)
    }
    const scored = []
    for (const doc of docs) {
      let score = 0
      for (const { term, weight } of terms) {
        const key = term.toLowerCase()
        const hits = countHits(doc.lower, key)
        if (hits === 0) continue
        const idf = Math.log(1 + docs.length / (1 + docFreq.get(key)))
        score += weight * idf * Math.min(3, hits)
      }
      if (score === 0) continue
      const queryTokens = recallTokens(query).filter((token) => token.length >= 2)
      const covered = queryTokens.filter((token) => doc.lower.includes(token)).length
      if (covered > 1) score *= 1 + Math.min(1.5, covered / Math.max(4, queryTokens.length))
      const damping = Math.sqrt(Math.max(1, doc.lower.length / 1200))
      scored.push({ path: doc.path, score: score / damping, snippet: recallSnippet(doc.text, [query, ...expansions]) })
    }
    scored.sort((a, b) => b.score - a.score)
    const max = Math.max(1, Math.min(30, Number(limit) || 8))
    const lexical = scored.slice(0, Math.max(max, 10)).map((entry) => ({
      ...entry,
      score: Math.round(entry.score * 10) / 10,
    }))
    const reranked = route === null ? null : await rerankRecall(route, query, lexical)
    return {
      query,
      expanded: expansions,
      expansionError: expansion.error,
      terms: terms.map((entry) => entry.term),
      reranked: reranked !== null,
      results: (reranked ?? lexical).slice(0, max),
      scanned: docs.length,
    }
  }

  /**
   * The config editor plus this row's Loader entry, or null when the profile
   * cannot persist plugin configuration. `ctx.fiber.entry` is the normal path;
   * `entries()` is the fallback for contexts that do not expose it.
   */
  function configWriter() {
    const editor = typeof ctx.get === 'function' ? ctx.get('configEditor') : undefined
    if (editor === undefined || editor === null || typeof editor.edit !== 'function') return null
    let entry = ctx.fiber === undefined || ctx.fiber === null ? undefined : ctx.fiber.entry
    if (entry === undefined && typeof editor.entries === 'function') {
      try {
        const list = editor.entries()
        entry = (Array.isArray(list) ? list : []).find(
          (item) => item?.name === '@local/dsh-notebook' || item?.id === 'include:dsh-notebook',
        )
      } catch {
        entry = undefined
      }
    }
    if (entry === undefined) return null
    return { editor, entry }
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: '/notebook',
        handler: async (req, res) => {
          if (!gate(req)) {
            sendJson(res, 403, { ok: false, error: 'cross-origin request rejected', code: 'cross_origin' })
            return
          }
          const url = new URL(req.url ?? '/', 'http://localhost')
          const path = url.pathname.replace(/^\/notebook/, '')
          try {
            if (req.method === 'GET' && path === '/api/status') {
              sendJson(res, 200, {
                ok: true,
                configWritable: configWriter() !== null,
                ...(await vault.status()),
              })
              return
            }
            if (req.method === 'POST' && path === '/api/vault') {
              const body = await readJsonBody(req)
              const raw = typeof body?.path === 'string' ? body.path.trim() : ''
              const target = raw.length === 0 ? '' : expandHome(raw)
              if (target.length > 0) {
                const stats = await statOrNull(target)
                if (stats === null || !stats.isDirectory()) {
                  throw new NotebookError(`这个目录不存在或不是文件夹：${target}`, 'no_vault')
                }
              }
              const writer = configWriter()
              if (writer === null) {
                throw new NotebookError(
                  '当前 profile 没有可用的配置编辑器，请到插件页把 vaultPath 改成笔记库路径。',
                  'config_unavailable',
                )
              }
              sendJson(res, 200, { ok: true, path: target, restarting: true })
              // Apply after the response flushes: a config change restarts this
              // plugin row, which would dispose the route mid-request.
              setTimeout(() => {
                Promise.resolve()
                  .then(() => writer.editor.edit(writer.entry, (current) => ({ ...(current ?? {}), vaultPath: target })))
                  .catch(() => {})
              }, 80)
              return
            }
            if (req.method === 'GET' && path === '/api/list') {
              sendJson(res, 200, { ok: true, ...(await vault.list(url.searchParams.get('folder') ?? '')) })
              return
            }
            if (req.method === 'GET' && path === '/api/read') {
              sendJson(res, 200, { ok: true, ...(await vault.read(url.searchParams.get('path') ?? '')) })
              return
            }
            if (req.method === 'GET' && path === '/api/current') {
              sendJson(res, 200, {
                ok: true,
                path: currentNote === null ? null : currentNote.path,
                title: currentNote === null ? null : currentNote.title,
                outline: currentNote === null ? [] : currentNote.outline,
                updatedAt: currentNote === null ? null : currentNote.updatedAt,
                focus: currentFocus,
              })
              return
            }
            if (req.method === 'POST' && path === '/api/current') {
              const body = await readJsonBody(req)
              await setCurrentNote(body.path)
              sendJson(res, 200, {
                ok: true,
                path: currentNote === null ? null : currentNote.path,
                title: currentNote === null ? null : currentNote.title,
                outline: currentNote === null ? [] : currentNote.outline,
                focus: currentFocus,
              })
              return
            }
            if (req.method === 'POST' && path === '/api/focus') {
              const body = await readJsonBody(req)
              setCurrentFocus(body)
              sendJson(res, 200, { ok: true, focus: currentFocus })
              return
            }
            if (req.method === 'GET' && path === '/api/stat') {
              sendJson(res, 200, { ok: true, ...(await vault.stat(url.searchParams.get('path') ?? '')) })
              return
            }
            if (req.method === 'POST' && path === '/api/ask') {
              const body = await readJsonBody(req)
              await askStream(req, res, body)
              return
            }
            if (req.method === 'POST' && path === '/api/ask/agent') {
              const body = await readJsonBody(req)
              await askAgentStream(req, res, body)
              return
            }
            if (req.method === 'POST' && path === '/api/ai/agent') {
              const body = await readJsonBody(req)
              sendJson(res, 200, { ok: true, ...(await aiAgentRun(body?.instruction)) })
              return
            }
            if (req.method === 'POST' && path === '/api/ai') {
              const body = await readJsonBody(req)
              sendJson(res, 200, { ok: true, ...(await aiGenerate(body ?? {})) })
              return
            }
            if (req.method === 'POST' && path === '/api/ai/stream') {
              const body = await readJsonBody(req)
              await aiStream(req, res, body)
              return
            }
            if (req.method === 'GET' && path === '/api/stats/writing') {
              sendJson(res, 200, { ok: true, ...(await vault.writingStats()) })
              return
            }
            if (req.method === 'GET' && path === '/api/fields') {
              sendJson(res, 200, {
                ok: true,
                ...(await vault.fields(url.searchParams.get('folder') ?? '')),
              })
              return
            }
            if (req.method === 'GET' && path === '/api/parents') {
              sendJson(res, 200, { ok: true, ...(await vault.parents()) })
              return
            }
            if (req.method === 'GET' && path === '/api/backlinks') {
              sendJson(res, 200, {
                ok: true,
                ...(await vault.backlinks(url.searchParams.get('path') ?? '')),
              })
              return
            }
            if (req.method === 'GET' && path === '/api/search') {
              const limit = Number(url.searchParams.get('limit') ?? '') || undefined
              sendJson(res, 200, { ok: true, ...(await vault.search(url.searchParams.get('q') ?? '', limit)) })
              return
            }
            if (req.method === 'POST' && path === '/api/upload') {
              const body = await readJsonBody(req)
              sendJson(res, 200, { ok: true, ...(await vault.saveAttachment(body.name, body.data)) })
              return
            }
            if (req.method === 'GET' && path === '/api/file') {
              const file = await vault.readAttachment(url.searchParams.get('path') ?? '')
              res.writeHead(200, {
                'Content-Type': file.mime,
                'Content-Length': file.buffer.length,
                'Cache-Control': 'private, max-age=60',
              })
              res.end(file.buffer)
              return
            }
            if (req.method === 'GET' && path === '/api/config') {
              sendJson(res, 200, { ok: true, ...vault.publicConfig() })
              return
            }
            if (req.method === 'GET' && path === '/api/history') {
              sendJson(res, 200, {
                ok: true,
                ...(await vault.listHistory(url.searchParams.get('path') ?? '')),
              })
              return
            }
            if (req.method === 'GET' && path === '/api/history/note') {
              sendJson(res, 200, {
                ok: true,
                ...(await vault.readHistory(
                  url.searchParams.get('path') ?? '',
                  url.searchParams.get('id') ?? '',
                )),
              })
              return
            }
            if (req.method === 'POST' && path === '/api/write') {
              const body = await readJsonBody(req)
              sendJson(res, 200, {
                ok: true,
                ...(await vault.write(body.path, body.content, 'replace', body.expectedMtimeMs)),
              })
              return
            }
            if (req.method === 'POST' && path === '/api/create') {
              const body = await readJsonBody(req)
              const mode = body.mode === 'replace' ? 'replace' : 'create'
              sendJson(res, 200, { ok: true, ...(await vault.write(body.path, body.content ?? '', mode)) })
              return
            }
            if (req.method === 'POST' && path === '/api/mkdir') {
              const body = await readJsonBody(req)
              sendJson(res, 200, { ok: true, ...(await vault.makeFolder(body.path)) })
              return
            }
            if (req.method === 'POST' && path === '/api/rename') {
              const body = await readJsonBody(req)
              sendJson(res, 200, { ok: true, ...(await vault.rename(body.from, body.to)) })
              return
            }
            if (req.method === 'POST' && path === '/api/delete') {
              const body = await readJsonBody(req)
              sendJson(res, 200, { ok: true, ...(await vault.remove(body.path)) })
              return
            }
            if (req.method === 'GET' && path === '/api/recall') {
              const query = url.searchParams.get('q') ?? ''
              const limit = Number(url.searchParams.get('limit') ?? '') || 8
              const expand = url.searchParams.get('expand') !== '0'
              sendJson(res, 200, {
                ok: true,
                ...(await semanticSearch(query, limit, { expand })),
              })
              return
            }
            if (req.method === 'GET' && path === '/api/flash/summary') {
              sendJson(res, 200, { ok: true, ...(await flash.summary()) })
              return
            }
            if (req.method === 'GET' && path === '/api/flash/list') {
              sendJson(res, 200, {
                ok: true,
                ...(await flash.list({
                  status: url.searchParams.get('status') ?? undefined,
                  category: url.searchParams.get('category') ?? '',
                  query: url.searchParams.get('q') ?? '',
                  limit: Number(url.searchParams.get('limit') ?? '') || undefined,
                })),
              })
              return
            }
            if (req.method === 'POST' && path === '/api/flash/create') {
              const body = await readJsonBody(req)
              sendJson(res, 200, { ok: true, flash: await flash.create(body) })
              return
            }
            if (req.method === 'POST' && path === '/api/flash/update') {
              const body = await readJsonBody(req)
              sendJson(res, 200, { ok: true, flash: await flash.update(body.path, body) })
              return
            }
            if (req.method === 'POST' && path === '/api/flash/flags') {
              const body = await readJsonBody(req)
              sendJson(res, 200, { ok: true, ...(await flash.setFlags(body.path, body)) })
              return
            }
            if (req.method === 'GET' && path === '/api/flash/random') {
              sendJson(res, 200, { ok: true, flash: await flash.random() })
              return
            }
            if (req.method === 'GET' && path === '/api/sync/status') {
              const client = url.searchParams.get('client')
              if (client !== null && client.length > 0 && client.length <= 40) {
                syncClients[client] = (syncClients[client] ?? 0) + 1
                const seen = Object.keys(syncClients)
                if (seen.length > 8) delete syncClients[seen[0]]
              }
              sendJson(res, 200, { ok: true, ...(await sync.status()), clients: { ...syncClients } })
              return
            }
            if (req.method === 'POST' && path === '/api/sync/settings') {
              const body = await readJsonBody(req)
              sendJson(res, 200, { ok: true, ...(await sync.saveSettings(body?.settings ?? body)) })
              return
            }
            if (req.method === 'POST' && path === '/api/sync/test') {
              sendJson(res, 200, { ok: true, ...(await sync.testConnection()) })
              return
            }
            if (req.method === 'POST' && path === '/api/sync/run') {
              // Answer at once and let the run continue: a first sync of a large
              // vault can outlive an HTTP response, and the panel polls
              // /api/sync/status for progress and the final result.
              sync.run({ trigger: 'manual' }).catch(() => {})
              sendJson(res, 200, { ok: true, ...(await sync.status()) })
              return
            }
            sendJson(res, 404, { ok: false, error: `Unknown notebook route: ${req.method} ${path}`, code: 'no_route' })
          } catch (error) {
            failure(res, error)
          }
        },
      }),
    label('vault HTTP API'),
  )

  // One operation, two callers: every tool below calls the same vault service
  // the panel's routes call.
  ctx.effect(() => {
    const disposers = []

    disposers.push(
      ctx.tools.register({
        name: 'notebook_list',
        description:
          'List the notes directly inside one folder of the user\'s Obsidian vault, plus a count for every subfolder. ' +
          'Paths are vault-relative; call it before reading or writing so paths are exact. Pass recursive: true to ' +
          'list every note under the folder instead.',
        parameters: {
          folder: {
            type: 'string',
            description: 'Optional folder inside the vault to list; omit for the vault root.',
          },
          recursive: {
            type: 'boolean',
            description: 'List every note under the folder, not only its direct notes. Defaults to false.',
          },
          limit: {
            type: 'number',
            description: 'Maximum notes to print (default 100, max 500). Folders are summarized separately.',
          },
        },
        output: TOOL_OUTPUT,
        isConcurrencySafe: () => true,
        execute: async (args) => {
          const result = await vault.list(typeof args?.folder === 'string' ? args.folder : '')
          const recursive = args?.recursive === true
          const limit = Math.max(1, Math.min(500, Number(args?.limit) || 100))
          const base = result.folder.length > 0 ? `${result.folder}/` : ''
          const direct = []
          const folders = new Map()
          for (const note of result.notes) {
            const rel = base.length > 0 ? note.path.slice(base.length) : note.path
            const cut = rel.indexOf('/')
            if (cut < 0) {
              direct.push(note)
              continue
            }
            const name = rel.slice(0, cut)
            folders.set(name, (folders.get(name) ?? 0) + 1)
          }
          const lines = [
            `Vault: ${result.vault.path ?? '(none)'} — ${result.notes.length} note(s) under ${
              result.folder.length > 0 ? `"${result.folder}"` : 'the root'
            }`,
          ]
          const folderNames = [...folders.keys()].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true }))
          if (folderNames.length > 0) {
            lines.push(`Folders (${folderNames.length}):`)
            for (const name of folderNames) lines.push(`  ${name}/ — ${folders.get(name)} note(s)`)
          }
          const pool = recursive ? result.notes : direct
          const shown = pool.slice(0, limit)
          lines.push(`Notes (${shown.length} of ${pool.length}):`)
          for (const note of shown) {
            lines.push(
              `  ${note.path}  (${formatBytes(note.size)}, ${new Date(note.mtimeMs).toLocaleString('zh-CN')})`,
            )
          }
          if (pool.length > shown.length) {
            lines.push('(list truncated — pass a folder, recursive: true with a larger limit, or use notebook_search)')
          }
          if (result.truncated) lines.push('(the vault index stopped at maxIndexFiles)')
          return lines.join('\n')
        },
      }),
    )

    disposers.push(
      ctx.tools.register({
        name: 'notebook_read',
        description:
          'Read one Markdown note from the user\'s Obsidian vault by its vault-relative path. Use notebook_list or ' +
          'notebook_search first when the path is not known.',
        parameters: {
          path: {
            type: 'string',
            description: 'Vault-relative note path, for example "项目/Dsh-notebook 设计.md".',
            required: true,
          },
        },
        output: TOOL_OUTPUT,
        isConcurrencySafe: () => true,
        execute: async (args) => {
          const note = await vault.read(args?.path)
          return `# ${note.path} (${formatBytes(note.size)})\n\n${note.content}`
        },
      }),
    )

    disposers.push(
      ctx.tools.register({
        name: 'notebook_search',
        description:
          'Search the notes in the user\'s Obsidian vault. By default it matches the query text literally and returns ' +
          'path:line hits. With semantic: true it ranks notes by meaning instead: the model widens the query with ' +
          'related terms and a local fuzzy match ranks note contents, returning the most relevant notes with a ' +
          'snippet — use that when the user asks for something "related to" or "about" an idea rather than an exact string.',
        parameters: {
          query: { type: 'string', description: 'Text to find, or the idea to search for when semantic is true.', required: true },
          limit: { type: 'number', description: 'Maximum results (default 50 literal, 8 semantic; max 200).' },
          semantic: {
            type: 'boolean',
            description: 'Rank by meaning (model-expanded terms + local fuzzy ranking) instead of exact text. Defaults to false.',
          },
        },
        output: TOOL_OUTPUT,
        isConcurrencySafe: () => true,
        execute: async (args) => {
          if (args?.semantic === true) {
            const result = await semanticSearch(args?.query, args?.limit ?? 8)
            if (result.results.length === 0) {
              return `No related note for "${result.query}" among ${result.scanned} note(s).`
            }
            const lines = result.results.map(
              (entry) => `${entry.path} (${entry.score})\n    ${entry.snippet}`,
            )
            return [
              `${result.results.length} related note(s) for "${result.query}"` +
                (result.expanded.length > 0 ? ` — also searched: ${result.expanded.join('、')}` : ''),
              ...lines,
            ].join('\n')
          }
          const result = await vault.search(args?.query, args?.limit)
          if (result.matches.length === 0) return `No matches for "${result.query}" in ${result.scanned} note(s).`
          const lines = result.matches.map((match) => `${match.path}:${match.line}: ${match.text}`)
          return [
            `${result.matches.length} match(es) for "${result.query}"`,
            ...lines,
            result.truncated ? '(truncated)' : '',
          ]
            .filter(Boolean)
            .join('\n')
        },
      }),
    )

    disposers.push(
      ctx.tools.register({
        name: 'notebook_write',
        description:
          'Write a Markdown note in the user\'s Obsidian vault. mode "replace" (default) overwrites the note and ' +
          'creates it when absent; "append" adds to the end of an existing note; "create" refuses to overwrite. ' +
          'The vault is the user\'s real Obsidian folder: this changes files they can see in Obsidian.',
        parameters: {
          path: { type: 'string', description: 'Vault-relative note path, ending in .md.', required: true },
          content: { type: 'string', description: 'Full Markdown text to store.', required: true },
          mode: {
            type: 'string',
            description: 'One of "replace", "append" or "create". Defaults to "replace".',
            enum: ['replace', 'append', 'create'],
          },
        },
        output: TOOL_OUTPUT,
        isConcurrencySafe: () => false,
        execute: async (args) => {
          const mode = args?.mode === 'append' || args?.mode === 'create' ? args.mode : 'replace'
          const result = await vault.write(args?.path, args?.content, mode)
          return `${mode} ${result.path} (${formatBytes(result.size)})`
        },
      }),
    )

    disposers.push(
      ctx.tools.register({
        name: 'notebook_flash',
        description:
          'Capture a fleeting thought (闪念) without deciding where it belongs, or review what is waiting. action ' +
          '"capture" stores text (plus an optional category) as one Markdown note in the configured flash folder; ' +
          '"recent" lists the unprocessed inbox newest first; "random" resurfaces one old flash. Use capture whenever ' +
          'the user says something worth keeping but does not ask for a note.',
        parameters: {
          action: {
            type: 'string',
            description: 'One of "capture", "recent" or "random". Defaults to "capture" when text is given.',
            enum: ['capture', 'recent', 'random'],
          },
          text: { type: 'string', description: 'The thought to store (required for "capture").' },
          category: {
            type: 'string',
            description: 'Optional category for "capture". Defaults to 随记.',
            enum: [...FLASH_CATEGORIES],
          },
          limit: { type: 'number', description: 'How many flashes "recent" prints (default 10, max 50).' },
        },
        output: TOOL_OUTPUT,
        isConcurrencySafe: () => false,
        execute: async (args) => {
          const action =
            args?.action === 'recent' || args?.action === 'random'
              ? args.action
              : typeof args?.text === 'string' && args.text.trim().length > 0
                ? 'capture'
                : 'recent'
          if (action === 'capture') {
            const flashItem = await flash.create({
              text: args?.text,
              category: args?.category,
            })
            return `闪念已记下：${flashItem.path}\n分类：${flashItem.category}`
          }
          if (action === 'random') {
            const item = await flash.random()
            if (item === null) return '闪念夹还是空的。'
            return `翻到一条 ${new Date(item.createdMs).toLocaleString('zh-CN')} 的闪念 (${item.category})：\n${item.preview}\n\n${item.path}`
          }
          const result = await flash.list({ status: 'inbox', limit: Math.min(50, Number(args?.limit) || 10) })
          if (result.items.length === 0) return '闪念收件箱是空的。'
          const lines = [`未处理的闪念 ${result.counts.inbox} 条（显示 ${result.items.length} 条）：`]
          for (const item of result.items) {
            lines.push(
              `- ${new Date(item.createdMs).toLocaleString('zh-CN')} [${item.category}] ${item.preview.slice(0, 80)} — ${item.path}`,
            )
          }
          return lines.join('\n')
        },
      }),
    )

    disposers.push(
      ctx.tools.register({
        name: 'notebook_sync',
        description:
          'Sync the notebook vault with its configured WebDAV folder or git repository. action "status" reports the ' +
          'configured provider, the tracked file count and the last run; "run" performs one two-way sync — local ' +
          'edits are uploaded, remote edits are downloaded, and a file edited on both sides keeps the local version ' +
          'with the remote content saved as a conflict copy; "test" checks the configured server or remote without ' +
          'touching any note. The vault is the user\'s real folder, so a "run" changes the files they can see.',
        parameters: {
          action: {
            type: 'string',
            description: 'One of "status", "run" or "test". Defaults to "status".',
            enum: ['status', 'run', 'test'],
          },
        },
        output: TOOL_OUTPUT,
        isConcurrencySafe: () => false,
        execute: async (args) => {
          const action = args?.action === 'run' || args?.action === 'test' ? args.action : 'status'
          if (action === 'test') {
            const probe = await sync.testConnection()
            return `${probe.provider}: ${probe.message}`
          }
          if (action === 'status') {
            const state = await sync.status()
            const lines = [
              `Provider: ${state.provider}`,
              `Vault: ${state.vault ?? '(none)'}`,
              `Last sync: ${state.state?.lastSyncAt ? new Date(state.state.lastSyncAt).toLocaleString('zh-CN') : 'never'}`,
              `Tracked files: ${state.state?.files ?? 0}`,
            ]
            const last = state.lastResult
            if (last !== null && last !== undefined) {
              lines.push(
                `Last run: ${last.ok ? 'ok' : 'failed'} — ${last.uploaded} up, ${last.downloaded} down, ` +
                  `${last.conflicts} conflict(s), ${last.errors?.length ?? 0} error(s)`,
              )
              if (last.error) lines.push(`Error: ${last.error.code} — ${last.error.message}`)
              if (last.notes?.length > 0) lines.push(...last.notes.slice(0, 8).map((note) => `  ${note}`))
            }
            return lines.join('\n')
          }
          const result = await sync.run({ trigger: 'agent' })
          const lines = [
            `Sync ${result.ok ? 'finished' : 'finished with errors'} (${result.provider})`,
            `  uploaded: ${result.uploaded}, downloaded: ${result.downloaded}`,
            `  deleted local: ${result.deletedLocal}, deleted remote: ${result.deletedRemote}, conflicts: ${result.conflicts}`,
            `  bytes: ↑${result.bytesUp} ↓${result.bytesDown}`,
          ]
          if (result.notes?.length > 0) lines.push(...result.notes.slice(0, 12).map((note) => `  ${note}`))
          if (result.errors?.length > 0) {
            lines.push(`Errors (${result.errors.length}):`)
            for (const error of result.errors.slice(0, 12)) lines.push(`  ${error.path}: ${error.message}`)
          }
          return lines.join('\n')
        },
      }),
    )

    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          /* already gone */
        }
      }
    }
  }, label('agent tools'))

  ctx.effect(
    () => () => {
      sync.dispose().catch(() => {})
    },
    label('sync service'),
  )
}
