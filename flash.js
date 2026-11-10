/**
 * Flash (闪念) service: one vault folder for zero-decision capture.
 *
 * The capture side keeps working the way flash-capsule describes it: a thought
 * is stored the moment it appears, with no decision about where it belongs;
 * triage happens later in the panel. Each flash is one Markdown note, so it is
 * visible in Obsidian, searchable by the other tools, and covered by sync:
 *
 *   ---
 *   type: flash
 *   created: 2026-11-10T14:40:12+08:00
 *   category: 随记
 *   tags: []
 *   pinned: false
 *   done: false
 *   ---
 *   the thought itself
 *
 * Node built-ins only; the vault service is injected so path checks, atomic
 * writes and trash handling stay in one place.
 */

const DEFAULT_DIR = '闪念'
export const FLASH_CATEGORIES = ['随记', '想法', '待办', '灵感', '摘录']
const DEFAULT_CATEGORY = '随记'
const MAX_TEXT_BYTES = 20000
const MAX_TAGS = 10
const MAX_ITEMS = 2000
const HEAD_BYTES = 4096

export class FlashError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'FlashError'
    this.code = code
  }
}

const pad = (value) => String(value).padStart(2, '0')

function isoLocal(ms) {
  const date = new Date(ms)
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const hours = pad(Math.floor(Math.abs(offset) / 60))
  const minutes = pad(Math.abs(offset) % 60)
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${hours}:${minutes}`
  )
}

function stampName(ms) {
  const date = new Date(ms)
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  )
}

function normalizeDir(value) {
  const dir = typeof value === 'string' ? value.trim().replace(/^\/+|\/+$/g, '') : ''
  return dir.length > 0 ? dir : DEFAULT_DIR
}

function normalizeCategory(value) {
  return FLASH_CATEGORIES.includes(value) ? value : DEFAULT_CATEGORY
}

function normalizeTags(value) {
  const list = Array.isArray(value) ? value : []
  const tags = []
  for (const raw of list) {
    if (typeof raw !== 'string') continue
    const tag = raw.trim().replace(/[,，\]]/g, '').slice(0, 24)
    if (tag.length === 0 || tags.includes(tag)) continue
    tags.push(tag)
    if (tags.length >= MAX_TAGS) break
  }
  return tags
}

function parseTags(raw) {
  const text = String(raw ?? '').trim()
  if (text.length === 0) return []
  const inner = text.startsWith('[') && text.endsWith(']') ? text.slice(1, -1) : text
  return inner
    .split(/[,，]/)
    .map((tag) => tag.trim().replace(/^["']|["']$/g, ''))
    .filter((tag) => tag.length > 0)
}

/** The first meaningful line, used as the file name and the card title. */
function titleFrom(text) {
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw
      .trim()
      .replace(/^#{1,6}\s+/, '')
      .replace(/^[-*+>]\s+/, '')
      .replace(/^\d+[.)]\s+/, '')
      .replace(/[*_`[\]]/g, '')
      .trim()
    if (line.length > 0) return line.slice(0, 24)
  }
  return ''
}

function safeName(value) {
  return value
    .replace(/[\\/:*?"<>|#^]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Parse the frontmatter fields this service writes; unknown keys are ignored. */
export function parseFlash(head) {
  const text = String(head ?? '')
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  const fields = {}
  if (match !== null) {
    for (const line of match[1].split(/\r?\n/)) {
      const field = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line)
      if (field !== null) fields[field[1]] = field[2].trim()
    }
  }
  const body = match === null ? text : text.slice(match[0].length)
  const created = typeof fields.created === 'string' ? fields.created : ''
  return {
    created,
    createdMs: Number.isFinite(Date.parse(created)) ? Date.parse(created) : 0,
    category: normalizeCategory(fields.category),
    tags: parseTags(fields.tags),
    pinned: fields.pinned === 'true',
    done: fields.done === 'true',
    body,
  }
}

export function serializeFlash({ createdMs, category, tags, pinned, done, text }) {
  const lines = [
    '---',
    'type: flash',
    `created: ${isoLocal(createdMs)}`,
    `category: ${normalizeCategory(category)}`,
    `tags: [${normalizeTags(tags).join(', ')}]`,
    `pinned: ${pinned === true}`,
    `done: ${done === true}`,
    '---',
    '',
  ]
  return `${lines.join('\n')}${String(text ?? '').replace(/\r\n/g, '\n').replace(/\s+$/, '')}\n`
}

function previewOf(body) {
  return String(body ?? '')
    .replace(/^\s+/, '')
    .replace(/\s+/g, ' ')
    .slice(0, 240)
}

/**
 * @param {object} options
 * @param {object} options.vault the vault service from index.js
 * @param {string} [options.dir] vault-relative flash folder
 * @param {() => number} [options.now] clock, injectable for tests
 */
export function createFlashService({ vault, dir, now = () => Date.now() }) {
  const folder = normalizeDir(dir)
  /** path -> { mtimeMs, size, parsed }: avoids re-reading unchanged notes on every list. */
  const heads = new Map()

  function insideFolder(path) {
    const value = String(path ?? '')
    if (!value.startsWith(`${folder}/`)) return false
    const rest = value.slice(folder.length + 1)
    return rest.length > 0 && !rest.includes('/') && /\.md$/i.test(rest)
  }

  async function itemFor(note) {
    const cached = heads.get(note.path)
    let parsed
    if (cached !== undefined && cached.mtimeMs === note.mtimeMs && cached.size === note.size) {
      parsed = cached.parsed
    } else {
      const head = await vault.head(note.path, HEAD_BYTES)
      parsed = parseFlash(head.head)
      heads.set(note.path, { mtimeMs: note.mtimeMs, size: note.size, parsed })
    }
    return {
      path: note.path,
      name: note.name,
      size: note.size,
      mtimeMs: note.mtimeMs,
      created: parsed.created,
      createdMs: parsed.createdMs > 0 ? parsed.createdMs : note.mtimeMs,
      category: parsed.category,
      tags: parsed.tags,
      pinned: parsed.pinned,
      done: parsed.done,
      preview: previewOf(parsed.body),
    }
  }

  /** Every flash in the folder, newest first, with triage counts. */
  async function loadAll() {
    const listing = await vault.list(folder)
    const notes = listing.notes
      .slice()
      .sort((a, b) => b.path.localeCompare(a.path, 'zh-Hans-CN', { numeric: true }))
      .slice(0, MAX_ITEMS)
    const alive = new Set(notes.map((note) => note.path))
    for (const path of heads.keys()) if (!alive.has(path)) heads.delete(path)
    const items = []
    for (const note of notes) items.push(await itemFor(note))
    const counts = { inbox: 0, done: 0, total: items.length }
    for (const item of items) {
      if (item.done) counts.done += 1
      else counts.inbox += 1
    }
    return { items, counts, truncated: listing.truncated || items.length >= MAX_ITEMS }
  }

  async function list({ status = 'inbox', category = '', query = '', limit = 200 } = {}) {
    const { items, counts, truncated } = await loadAll()
    const mode = status === 'all' || status === 'done' ? status : 'inbox'
    const needle = String(query ?? '').trim().toLowerCase()
    const wanted = FLASH_CATEGORIES.includes(category) ? category : ''
    const max = Math.max(1, Math.min(500, Number(limit) || 200))
    const filtered = items.filter((item) => {
      if (mode === 'inbox' && item.done) return false
      if (mode === 'done' && !item.done) return false
      if (wanted.length > 0 && item.category !== wanted) return false
      if (needle.length > 0) {
        const haystack = `${item.preview} ${item.tags.join(' ')} ${item.name}`.toLowerCase()
        if (!haystack.includes(needle)) return false
      }
      return true
    })
    return {
      dir: folder,
      items: filtered.slice(0, max),
      counts,
      total: filtered.length,
      truncated: truncated || filtered.length > max,
      categories: FLASH_CATEGORIES,
    }
  }

  async function readItem(path) {
    if (!insideFolder(path)) throw new FlashError('invalid_flash_path', `Not a flash in ${folder}: ${path}`)
    return vault.read(path)
  }

  async function create(input = {}) {
    const text = String(input.text ?? '').replace(/\r\n/g, '\n').trim()
    if (text.length === 0) throw new FlashError('flash_empty', 'A flash needs some text.')
    if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) {
      throw new FlashError('flash_too_large', `A flash is limited to ${MAX_TEXT_BYTES} bytes.`)
    }
    const createdMs = now()
    const category = normalizeCategory(input.category)
    const tags = normalizeTags(input.tags)
    const stamp = stampName(createdMs)
    const title = safeName(titleFrom(text))
    const base = title.length > 0 ? `${stamp} ${title}` : stamp
    for (let attempt = 1; attempt <= 100; attempt += 1) {
      const fileName = attempt === 1 ? `${base}.md` : `${base}-${attempt}.md`
      const path = `${folder}/${fileName}`
      try {
        const written = await vault.write(
          path,
          serializeFlash({ createdMs, category, tags, pinned: false, done: false, text }),
          'create',
        )
        return {
          path: written.path,
          name: fileName.replace(/\.md$/i, ''),
          created: isoLocal(createdMs),
          createdMs,
          category,
          tags,
          pinned: false,
          done: false,
          preview: previewOf(text),
        }
      } catch (error) {
        if (error?.code !== 'note_exists') throw error
      }
    }
    throw new FlashError('flash_name_exhausted', 'Could not find a free file name for this flash.')
  }

  /** Rewrite text/category/tags, keeping the original created stamp. */
  async function update(path, patch = {}) {
    const current = await readItem(path)
    const parsed = parseFlash(current.content)
    const text =
      patch.text === undefined ? parsed.body.replace(/^\n+/, '').replace(/\s+$/, '') : String(patch.text).trim()
    if (text.length === 0) throw new FlashError('flash_empty', 'A flash needs some text.')
    const category = patch.category === undefined ? parsed.category : normalizeCategory(patch.category)
    const tags = patch.tags === undefined ? parsed.tags : normalizeTags(patch.tags)
    const createdMs = parsed.createdMs > 0 ? parsed.createdMs : current.mtimeMs
    await vault.write(
      path,
      serializeFlash({ createdMs, category, tags, pinned: parsed.pinned, done: parsed.done, text }),
      'replace',
      Number.isFinite(Number(patch.mtimeMs)) && Number(patch.mtimeMs) > 0
        ? Number(patch.mtimeMs)
        : current.mtimeMs,
    )
    heads.delete(path)
    const next = await readItem(path)
    const nextParsed = parseFlash(next.content)
    return {
      path: next.path,
      name: next.path.split('/').pop().replace(/\.md$/i, ''),
      created: nextParsed.created,
      createdMs,
      category: nextParsed.category,
      tags: nextParsed.tags,
      pinned: nextParsed.pinned,
      done: nextParsed.done,
      preview: previewOf(nextParsed.body),
    }
  }

  async function setFlags(path, patch = {}) {
    const current = await readItem(path)
    const parsed = parseFlash(current.content)
    const pinned = typeof patch.pinned === 'boolean' ? patch.pinned : parsed.pinned
    const done = typeof patch.done === 'boolean' ? patch.done : parsed.done
    const createdMs = parsed.createdMs > 0 ? parsed.createdMs : current.mtimeMs
    await vault.write(
      path,
      serializeFlash({
        createdMs,
        category: parsed.category,
        tags: parsed.tags,
        pinned,
        done,
        text: parsed.body.replace(/^\n+/, '').replace(/\s+$/, ''),
      }),
      'replace',
    )
    heads.delete(path)
    return { path, pinned, done }
  }

  /** "翻旧账": prefer an untouched, unpinned flash that is already a day old. */
  async function random() {
    const { items } = await loadAll()
    if (items.length === 0) return null
    const untouched = items.filter((item) => !item.done && !item.pinned)
    const old = untouched.filter((item) => now() - item.createdMs > 24 * 60 * 60 * 1000)
    const pool = old.length > 0 ? old : untouched.length > 0 ? untouched : items
    return pool[Math.floor(Math.random() * pool.length)]
  }

  async function summary() {
    const { counts, truncated } = await loadAll()
    return { dir: folder, counts, categories: FLASH_CATEGORIES, truncated }
  }

  return { dir: folder, list, create, update, setFlags, random, summary, categories: FLASH_CATEGORIES }
}
