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
        'Absolute path of the Obsidian vault folder. Empty detects the currently open vault from ~/.config/obsidian/obsidian.json.',
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
 * The vault Obsidian currently has open, read from its own recent-vault list.
 * Returns null when Obsidian was never launched or the list is unreadable.
 */
function detectObsidianVault() {
  try {
    const record = JSON.parse(readFileSync(join(homedir(), '.config', 'obsidian', 'obsidian.json'), 'utf8'))
    const vaults = Object.entries(record?.vaults ?? {})
      .map(([id, value]) => ({
        id,
        path: typeof value?.path === 'string' ? value.path : '',
        open: value?.open === true,
        ts: Number(value?.ts) || 0,
      }))
      .filter((entry) => entry.path.length > 0)
    if (vaults.length === 0) return null
    const open = vaults.find((entry) => entry.open)
    if (open !== undefined) return open.path
    vaults.sort((a, b) => b.ts - a.ts)
    return vaults[0].path
  } catch {
    return null
  }
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

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '?'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * The vault service. One instance per plugin activation; every method is the
 * operation both callers share.
 */
function createVault(config) {
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
    if (existing !== null) {
      const previous = await fsp.readFile(abs, 'utf8').catch(() => null)
      if (previous !== null) await saveHistorySnapshot(base, rel, previous).catch(() => {})
    }
    const stats = await writeAtomic(abs, next)
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
    let scanned = 0
    for (const note of notes) {
      if (matches.length >= max) break
      if (note.size > config.maxNoteBytes) continue
      scanned += 1
      let text
      try {
        text = await fsp.readFile(join(base, note.path), 'utf8')
      } catch {
        continue
      }
      const lines = text.split(/\r\n|\r|\n/)
      for (let index = 0; index < lines.length; index += 1) {
        if (lines[index].toLowerCase().includes(lower)) {
          matches.push({ path: note.path, line: index + 1, text: lines[index].slice(0, 240) })
          if (matches.length >= max) break
        }
      }
    }
    return { query: needle, matches, scanned, truncated: matches.length >= max }
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

  return {
    root,
    vaultInfo,
    status,
    list,
    read,
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
  if (error instanceof NotebookError) {
    sendJson(res, error.code === 'missing_note' || error.code === 'no_vault' ? 404 : 400, {
      ok: false,
      error: error.message,
      code: error.code,
    })
    return
  }
  const message = error instanceof Error ? error.message : String(error)
  sendJson(res, 500, { ok: false, error: message, code: 'internal' })
}

export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const vault = createVault(config)
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

  async function aiGenerate(input) {
    const task = typeof input === 'object' && input !== null ? String(input.task ?? '') : ''
    const spec = AI_TASKS[task]
    if (spec === undefined) throw new NotebookError('Unknown AI task.', 'unknown_ai_task')
    const text = typeof input.text === 'string' ? input.text.trim() : ''
    if (text.length === 0) throw new NotebookError('There is no text to send.', 'empty_text')
    if (text.length > AI_MAX_INPUT) {
      throw new NotebookError(`The text is longer than ${AI_MAX_INPUT} characters.`, 'text_too_long')
    }
    const locale = input.locale === 'en' ? 'en' : 'zh'
    const expanded = await expandNoteReferences(text)
    const route = await resolveModelRoute()
    if (route === null) {
      throw new NotebookError('This Harness has no model configured yet.', 'no_model')
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS)
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
        if (chunk.type === 'text-delta') output += chunk.text
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
    const result = output.trim()
    if (result.length === 0 && failure !== null) {
      throw new NotebookError(failure.message ?? 'The model call failed.', 'model_error')
    }
    return { task, text: result, provider: route.provider, model: route.model }
  }

  // ---- Live note, /note command, and agent-style AI (all via Host services) ----
  let currentNote = null

  /**
   * Remember the note the panel is editing and read enough of it to describe
   * itself in the prompt context (title + first headings).
   */
  async function setCurrentNote(path) {
    if (typeof path !== 'string' || path.length === 0) return
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
    parts.push('需要读取或修改它时使用 notebook_read / notebook_write 工具；改动后简短说明改了什么。')
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
            'Notebook: 显示当前笔记；/note <名字> 切换；/note save [标题] 保存对话；/note new [标题] 新建笔记',
          input: { hint: '<名字> | save [标题] | new [标题]' },
          handler: async (invocation) => {
            const raw = typeof invocation?.rawInput === 'string' ? invocation.rawInput.trim() : ''
            if (raw.length === 0) {
              return currentNote === null
                ? { kind: 'success', text: '笔记本还没有打开任何笔记，先在笔记面板里打开一篇。' }
                : {
                    kind: 'success',
                    text: `当前笔记：${currentNote.path}${currentNote.title.length > 0 ? `（${currentNote.title}）` : ''}`,
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
              sendJson(res, 200, { ok: true, ...(await vault.status()) })
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
              })
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
          'List Markdown notes in the user\'s Obsidian vault (the notebook workbench). Returns one line per note with ' +
          'its vault-relative path, size and last-modified time. Call this before reading or writing so paths are exact.',
        parameters: {
          folder: {
            type: 'string',
            description: 'Optional folder inside the vault to list; omit for the whole vault.',
          },
        },
        output: TOOL_OUTPUT,
        isConcurrencySafe: () => true,
        execute: async (args) => {
          const result = await vault.list(args?.folder ?? '')
          const header = `Vault: ${result.vault.path ?? '(none)'} — ${result.notes.length} note(s)`
          const lines = result.notes.map(
            (note) => `${note.path}  (${formatBytes(note.size)}, ${new Date(note.mtimeMs).toLocaleString('zh-CN')})`,
          )
          return [header, ...lines, result.truncated ? '(list truncated)' : ''].filter(Boolean).join('\n')
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
          'Search the text of every Markdown note in the user\'s Obsidian vault. Returns matching lines with their ' +
          'vault-relative path and line number.',
        parameters: {
          query: { type: 'string', description: 'Literal text to find (case-insensitive).', required: true },
          limit: { type: 'number', description: 'Maximum matches to return (default 50, max 200).' },
        },
        output: TOOL_OUTPUT,
        isConcurrencySafe: () => true,
        execute: async (args) => {
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
}
