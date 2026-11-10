/**
 * Client-half smoke test: evaluates client.js outside the browser with a fake
 * module loader, React and Cordis context, then checks that the workbench
 * registers itself where the shell expects it. This catches factory-time
 * crashes and registration mistakes without browser control; it does not
 * render the workbench's React tree.
 *
 * Run: node test/client-smoke.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')

let passed = 0
let failed = 0

function check(name, operation) {
  try {
    const detail = operation()
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

let stateIndex = 0
let statePresets = []

function resetState(presets) {
  stateIndex = 0
  statePresets = presets ?? []
}

const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  Fragment: Symbol('Fragment'),
  useState: (initial) => {
    const preset = statePresets[stateIndex]
    stateIndex += 1
    return [preset === undefined ? (typeof initial === 'function' ? initial() : initial) : preset, () => {}]
  },
  useEffect: () => {},
  useReducer: (_reducer, initial) => [initial, () => {}],
  useMemo: (factory) => factory(),
  useCallback: (callback) => callback,
  useRef: (initial) => ({ current: initial }),
}

let captured = null
const fakeWindow = {
  __ModuleLoader__: {
    load: (spec) => {
      captured = spec
    },
  },
}

check('client.js evaluates and calls window.__ModuleLoader__.load', () => {
  // eslint-disable-next-line no-new-func
  const evaluate = new Function('window', 'React', source)
  evaluate(fakeWindow, React)
  assert(captured !== null, 'load() was never called')
  assert(captured.id === '@local/dsh-notebook', `bundle id was ${String(captured.id)}`)
  return captured.id
})

check('factory returns the plugin shape with the slots/locale injection', () => {
  const module = captured.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected client module: ${name}`)
  })
  assert(module.name === 'dsh-notebook', `name was ${String(module.name)}`)
  assert(Array.isArray(module.inject), 'inject must be an array')
  assert(module.inject.includes('slots'), 'inject is missing slots')
  assert(module.inject.includes('locale'), 'inject is missing locale')
  assert(typeof module.apply === 'function', 'apply is not a function')
  captured.module = module
  return module.inject.join(', ')
})

check('apply registers the sidebar icon and the main workbench', () => {
  const registrations = []
  const disposals = []
  const shortcutCommands = []
  const shortcutsMock = {
    register(command) {
      shortcutCommands.push(command)
      return () => {}
    },
  }
  const ctx = {
    inject(services, callback) {
      assert(services.includes('shortcuts'), 'unexpected injected services')
      callback({ effect: ctx.effect, shortcuts: shortcutsMock })
    },
    effect: (callback) => {
      const dispose = callback()
      if (typeof dispose === 'function') disposals.push(dispose)
      return () => {}
    },
    locale: {
      register: () => () => {},
      bind: () => (key) => key,
      subscribe: () => () => {},
    },
    slots: {
      inject: (_key, callback) => callback(),
      register: (options, component) => {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }
  captured.module.apply(ctx)
  const panel = registrations.find((entry) => entry.options.name === 'sidebar.panellist')
  const main = registrations.find((entry) => entry.options.name === 'main')
  assert(panel !== undefined, 'no sidebar.panellist registration')
  assert(main !== undefined, 'no main registration')
  assert(panel.options.id === 'dsh-notebook', `sidebar id was ${String(panel.options.id)}`)
  assert(main.options.key === 'dsh-notebook', `main key was ${String(main.options.key)}`)
  assert(panel.options.id === main.options.key, 'sidebar id and main key must match')
  assert(typeof panel.options.label === 'function', 'sidebar label must be a thunk')
  assert(typeof panel.component === 'function', 'sidebar icon must be a component')
  assert(typeof main.component === 'function', 'main panel must be a component')
  const label = panel.options.label()
  assert(typeof label === 'string' && label.length > 0, 'sidebar label is empty')
  assert(shortcutCommands.length === 2, `expected 2 shortcuts, got ${shortcutCommands.length}`)
  const shortcut = shortcutCommands.find((entry) => entry.id === 'dsh-notebook.ask')
  assert(shortcut !== undefined, 'the ask shortcut is missing')
  assert(typeof shortcut.defaults['desktop:macos'] === 'object', 'missing macOS default')
  assert(typeof shortcut.label === 'function' && shortcut.label() === 'askAi', 'shortcut label is wrong')
  const resolution = shortcut.resolve({})
  assert(resolution !== null && resolution.status === 'handled', JSON.stringify(resolution))
  resolution.run()
  const flashShortcut = shortcutCommands.find((entry) => entry.id === 'dsh-notebook.flash')
  assert(flashShortcut !== undefined, 'the flash shortcut is missing')
  assert(flashShortcut.label() === 'flashShortcut', `flash shortcut label was ${flashShortcut.label()}`)
  const flashResolution = flashShortcut.resolve({})
  assert(flashResolution !== null && flashResolution.status === 'handled', JSON.stringify(flashResolution))
  flashResolution.run()
  assert(
    captured.module.__internal.takePendingFlashCapture() === true,
    'the flash shortcut did not request a capture box',
  )
  captured.panel = panel
  captured.main = main
  captured.registrations = registrations
  return `id=${panel.options.id}, label=${label}, shortcut=${shortcut.id}`
})

check('apply registers the five notebook chat tool views', () => {
  const views = captured.registrations.filter((entry) => entry.options.name === 'tool.call.toolview')
  const keys = views.map((entry) => entry.options.key).sort()
  assert(
    keys.join(',') === 'notebook_flash,notebook_list,notebook_read,notebook_search,notebook_write',
    `unexpected tool view keys: ${keys.join(',')}`,
  )
  for (const view of views) {
    assert(view.options.locale === 'dsh-notebook', `${view.options.key} must bind the notebook locale namespace`)
    assert(typeof view.component === 'function', `${view.options.key} view is not a component`)
  }
  // The card renders without the workbench: a fake host owner supplies t and
  // the disclosure hook, and the row must read the block without throwing.
  const view = views.find((entry) => entry.options.key === 'notebook_read')
  const element = view.component({
    callId: 'call-1',
    toolName: 'notebook_read',
    phase: 'start',
    block: { phase: 'start', name: 'notebook_read', argsRaw: '{"path":"笔记/欢迎.md"}', callId: 'call-1', subCalls: [] },
    t: (key) => key,
    useDisclosure: () => ({ expanded: false, toggle: () => {} }),
    onOpenNote: () => {},
  })
  assert(element !== null && typeof element === 'object', 'tool card returned nothing')
  const tree = element.type(element.props)
  assert(tree !== null && typeof tree === 'object', 'tool card rendered nothing')
  assert(tree.props.className === 'nb-chat-tool', 'tool card root class missing')
  return `${keys.join(', ')}`
})

check('chat tool rows derive note, mode, size and preview from real tool payloads', () => {
  const { chatNoteToolModel } = captured.module.__internal
  const t = (key, params) => (params === undefined ? key : `${key}:${JSON.stringify(params)}`)
  const started = (name, args) => ({
    phase: 'start',
    name,
    argsRaw: JSON.stringify(args),
    callId: 'call-1',
    subCalls: [],
  })
  const settled = (name, args, text, isError = false) => ({
    kind: 'tool-result',
    callId: 'call-1',
    call: { name, argsRaw: JSON.stringify(args) },
    content: [{ type: 'text', text }],
    isError,
    meta: {},
    subCalls: [],
  })

  const read = chatNoteToolModel(
    'notebook_read',
    settled('notebook_read', { path: '笔记/欢迎.md' }, '# 笔记/欢迎.md (221 B)\n\n# 欢迎\n正文'),
    t,
  )
  assert(read.title === 'chatReadNote', `read title was ${read.title}`)
  assert(read.summary === '欢迎', `read summary was ${read.summary}`)
  assert(read.suffix === '221 B', `read suffix was ${read.suffix}`)
  assert(read.path === '笔记/欢迎.md', `read path was ${read.path}`)
  assert(read.preview === '# 欢迎\n正文', `read preview was ${JSON.stringify(read.preview)}`)

  const write = chatNoteToolModel(
    'notebook_write',
    settled('notebook_write', { path: '项目/设计.md', mode: 'append', content: '新的一行' }, 'append 项目/设计.md (1.2 KB)'),
    t,
  )
  assert(write.summary === '设计', `write summary was ${write.summary}`)
  assert(write.suffix === 'chatModeAppend · 1.2 KB', `write suffix was ${write.suffix}`)
  assert(write.preview === '新的一行', `write preview was ${JSON.stringify(write.preview)}`)

  const list = chatNoteToolModel(
    'notebook_list',
    settled('notebook_list', {}, 'Vault: /v — 2 note(s)\n笔记/a.md  (1 B)\n笔记/b.md  (2 B)'),
    t,
  )
  assert(list.summary === 'chatAllNotes', `list summary was ${list.summary}`)
  assert(list.suffix === 'chatMatches:{"count":"2"}', `list suffix was ${list.suffix}`)

  const search = chatNoteToolModel(
    'notebook_search',
    settled('notebook_search', { query: '待办' }, '2 match(es) for "待办"\n笔记/a.md:3: 待办'),
    t,
  )
  assert(search.summary === '待办', `search summary was ${search.summary}`)
  assert(search.suffix === 'chatMatches:{"count":"2"}', `search suffix was ${search.suffix}`)
  assert(search.results.length === 1, `search results was ${search.results.length}`)
  assert(search.results[0].path === '笔记/a.md', JSON.stringify(search.results[0]))
  assert(search.results[0].line === 3, JSON.stringify(search.results[0]))
  assert(search.results[0].text === '待办', JSON.stringify(search.results[0]))

  const flash = chatNoteToolModel(
    'notebook_flash',
    settled(
      'notebook_flash',
      { action: 'capture', text: '记一条想法' },
      '闪念已记下：闪念/2026-11-10 14-49-41 记一条想法.md\n分类：想法',
    ),
    t,
  )
  assert(flash.title === 'chatFlashNote', flash.title)
  assert(flash.summary === '记一条想法', flash.summary)
  assert(flash.path === '闪念/2026-11-10 14-49-41 记一条想法.md', String(flash.path))
  const flashInbox = chatNoteToolModel(
    'notebook_flash',
    settled('notebook_flash', { action: 'recent' }, '闪念收件箱：1 条待整理'),
    t,
  )
  assert(flashInbox.summary === 'flashInbox', flashInbox.summary)

  const emptySearch = chatNoteToolModel(
    'notebook_search',
    settled('notebook_search', { query: 'zzz' }, 'No matches for "zzz" in 602 note(s).'),
    t,
  )
  assert(emptySearch.suffix === 'chatMatches:{"count":"0"}', `empty search suffix was ${emptySearch.suffix}`)

  const running = chatNoteToolModel('notebook_read', started('notebook_read', { path: 'a.md' }), t)
  assert(running.state === 'running', `running state was ${running.state}`)
  assert(running.preview === '', 'a running call must not preview an empty body')
  assert(running.suffix === 'chatRunning', `running suffix was ${running.suffix}`)

  const failed = chatNoteToolModel(
    'notebook_read',
    settled('notebook_read', { path: 'a.md' }, 'The note does not exist: a.md', true),
    t,
  )
  assert(failed.state === 'error', `error state was ${failed.state}`)
  assert(failed.suffix === 'chatFailed', `error suffix was ${failed.suffix}`)
  assert(failed.preview.includes('does not exist'), `error preview was ${JSON.stringify(failed.preview)}`)
  return 'read/write/list/search/running/error'
})

check('apply registers the settings row and the composer notebook button', () => {
  const settings = captured.registrations.find((entry) => entry.options.name === 'settings.general.item')
  const composer = captured.registrations.find((entry) => entry.options.name === 'conversation.input.left')
  assert(settings !== undefined, 'no settings.general.item registration')
  assert(composer !== undefined, 'no conversation.input.left registration')
  assert(settings.options.id === 'dsh-notebook:vault', `settings id was ${settings.options.id}`)
  assert(composer.options.id === 'dsh-notebook:composer', `composer id was ${composer.options.id}`)

  const rowElement = settings.component()
  assert(typeof rowElement.type === 'function', 'settings row is not a component')
  resetState([null, null, false])
  const row = rowElement.type(rowElement.props)
  assert(row !== null && row.props.className === 'nb-set-row', 'settings row markup missing')
  const hasButton = JSON.stringify(row).includes('nb-set-btn')
  assert(hasButton, 'settings row draws no controls')

  const buttonElement = composer.component({ inputActions: undefined })
  assert(buttonElement !== null && typeof buttonElement === 'object', 'composer button returned nothing')
  const tree = buttonElement.type(buttonElement.props)
  // The button lives in a wrapper now: it also hosts the note-citation picker.
  const button =
    tree !== null && tree.type === 'div'
      ? (tree.children ?? []).find((child) => child !== null && child !== undefined && child.type === 'button')
      : tree
  assert(
    button !== null && button !== undefined && button.props.className === 'nb-composer-btn',
    'composer button markup missing',
  )
  assert(button.props['aria-label'] === 'panelTitle', `composer aria-label was ${button.props['aria-label']}`)
  return 'vault row + composer button'
})

check('a search tool card renders one clickable row per match', () => {
  const view = captured.registrations.find(
    (entry) => entry.options.name === 'tool.call.toolview' && entry.options.key === 'notebook_search',
  )
  assert(view !== undefined, 'no notebook_search tool view')
  const block = {
    kind: 'tool-result',
    callId: 'call-search',
    call: { name: 'notebook_search', argsRaw: '{"query":"待办"}' },
    content: [
      {
        type: 'text',
        text: '2 match(es) for "待办"\n笔记/a.md:3: 待办一\n笔记/b.md:9: 待办二',
      },
    ],
    isError: false,
    meta: {},
    subCalls: [],
  }
  const element = view.component({
    callId: 'call-search',
    toolName: 'notebook_search',
    phase: 'result',
    block,
    t: (key, params) => (params === undefined ? key : `${key}:${params.count}`),
    useDisclosure: () => ({ expanded: true, toggle: () => {} }),
    onOpenNote: () => {},
  })
  const tree = element.type(element.props)
  let rows = 0
  const walk = (node) => {
    if (node === null || node === undefined) return
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    if (typeof node !== 'object') return
    if (typeof node.props?.className === 'string' && node.props.className === 'nb-chat-tool-result') rows += 1
    if (Array.isArray(node.children)) walk(node.children)
  }
  walk(tree)
  assert(rows === 2, `expected 2 clickable result rows, got ${rows}`)
  return '2 rows'
})

check('a write card offers open and version history', () => {
  const view = captured.registrations.find(
    (entry) => entry.options.name === 'tool.call.toolview' && entry.options.key === 'notebook_write',
  )
  assert(view !== undefined, 'no notebook_write tool view')
  const block = {
    kind: 'tool-result',
    callId: 'call-write',
    call: { name: 'notebook_write', argsRaw: '{"path":"笔记/a.md","content":"新内容"}' },
    content: [{ type: 'text', text: 'replace 笔记/a.md (1.2 KB)' }],
    isError: false,
    meta: {},
    subCalls: [],
  }
  const element = view.component({
    callId: 'call-write',
    toolName: 'notebook_write',
    phase: 'result',
    block,
    t: (key) => key,
    useDisclosure: () => ({ expanded: false, toggle: () => {} }),
    onOpenNote: () => {},
  })
  const tree = element.type(element.props)
  const buttons = []
  const walk = (node) => {
    if (node === null || node === undefined) return
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    if (typeof node !== 'object') return
    if (typeof node.props?.className === 'string' && node.props.className.split(' ').includes('nb-chat-tool-open')) {
      buttons.push(node)
    }
    if (Array.isArray(node.children)) walk(node.children)
  }
  walk(tree)
  assert(buttons.length === 2, `expected open + history buttons, got ${buttons.length}`)
  assert(
    buttons.some((button) => button.props.title === 'chatHistory'),
    'history button missing',
  )
  return 'open + history'
})

check('the agent context tracks the block being edited', () => {
  const { focusPayloadFor } = captured.module.__internal
  const blocks = [
    { id: 'h', type: 'heading1', text: '项目' },
    { id: 'p1', type: 'paragraph', text: '第一段' },
    { id: 'h2', type: 'heading2', text: '细节' },
    { id: 'p2', type: 'paragraph', text: '  需要改的句子  ' },
    { id: 'empty', type: 'paragraph', text: '   ' },
  ]
  assert(
    JSON.stringify(focusPayloadFor(blocks, 'p2')) ===
      JSON.stringify({ heading: '细节', kind: 'paragraph', text: '需要改的句子' }),
    `unexpected focus ${JSON.stringify(focusPayloadFor(blocks, 'p2'))}`,
  )
  assert(focusPayloadFor(blocks, 'empty') === null, 'an empty block carries no focus')
  assert(focusPayloadFor(blocks, 'missing') === null, 'a vanished block carries no focus')
  assert(focusPayloadFor(blocks, 'h').heading === '项目', 'a heading is its own context')
  return 'heading breadcrumb + text + empty/missing'
})

check('ask answers render Markdown as safe read-only HTML', () => {
  const { answerHtml } = captured.module.__internal
  const html = answerHtml(
    '## 小节\n\n- 一\n- 二\n\n```\nconst a = 1\n```\n\n> 引用 **重点**\n\n[链接](https://example.com) [坏链](javascript:alert(1))\n',
  )
  assert(html.includes('<h4>小节</h4>'), html)
  assert(html.includes('<ul><li>一</li><li>二</li></ul>'), html)
  assert(html.includes('<pre><code>const a = 1</code></pre>'), html)
  assert(html.includes('<blockquote>引用 <strong>重点</strong></blockquote>'), html)
  assert(html.includes('href="https://example.com"'), html)
  assert(!html.includes('href="javascript:'), 'unsafe link targets must not become hrefs')
  const escaped = answerHtml('<img src=x onerror=alert(1)>')
  assert(escaped.includes('&lt;img'), `raw HTML must be escaped, got ${escaped}`)
  const table = answerHtml('| a | b |\n| --- | --- |\n| 1 | 2 |\n')
  assert(table.includes('<table>') && table.includes('<th>a</th>'), table)

  const citations = answerHtml('参考 [[内核中断]] 和 `笔记/01 工作/工作.md`\n\n```\n[[不转换]]\n```\n')
  assert(citations.includes('data-note="内核中断"'), citations)
  assert(citations.includes('data-note="笔记/01 工作/工作.md"'), citations)
  assert(!citations.includes('data-note="不转换"'), 'code block contents must stay code')
  return 'headings/lists/code/quotes/links/tables/citations/escape'
})

check('new notes land in the folder a page presents', () => {
  const { noteDirFor } = captured.module.__internal
  assert(noteDirFor(null, '笔记') === '笔记/', `explicit folder: ${noteDirFor(null, '笔记')}`)
  assert(noteDirFor(null, '笔记/') === '笔记/', `trailing slash: ${noteDirFor(null, '笔记/')}`)
  assert(noteDirFor('/a/b.md', '') === '', `root target: ${noteDirFor('/a/b.md', '')}`)
  assert(noteDirFor('笔记/01 工作/工作.md', null) === '笔记/01 工作/', 'defaults to the open note')
  assert(noteDirFor('欢迎.md', null) === '', 'root note has no folder')
  assert(noteDirFor(null, null) === '', 'nothing open, no target')
  return 'explicit / default / root'
})

check('citation names resolve wiki anchors and aliases', () => {
  const { citationNoteName } = captured.module.__internal
  assert(citationNoteName('内核中断') === '内核中断', 'plain name')
  assert(citationNoteName('内核中断#调度') === '内核中断', 'anchor must be dropped')
  assert(citationNoteName('内核中断|别名') === '内核中断', 'alias must be dropped')
  assert(citationNoteName('笔记/01 工作/工作.md') === '笔记/01 工作/工作.md', 'path stays intact')
  return 'name / anchor / alias / path'
})

check('ask threads survive unmounts and stay bounded', () => {
  const { rememberAskThread, ASK_THREADS } = captured.module.__internal
  ASK_THREADS.clear()
  for (let index = 0; index < 45; index += 1) {
    rememberAskThread(`note:${index}`, [{ role: 'user', text: String(index) }])
  }
  assert(ASK_THREADS.size === 40, `cache size was ${ASK_THREADS.size}`)
  assert(!ASK_THREADS.has('note:0'), 'the oldest thread must be evicted')
  assert(ASK_THREADS.has('note:44'), 'the newest thread must be kept')
  rememberAskThread('note:44', [])
  assert(ASK_THREADS.size === 40, 'updating an existing thread must not grow the cache')
  ASK_THREADS.clear()
  return 'bounded at 40'
})

check('retry anchors on the last user turn', () => {
  const { lastUserIndex } = captured.module.__internal
  const thread = [
    { role: 'user', text: 'a' },
    { role: 'assistant', text: 'A' },
    { role: 'user', text: 'b' },
    { role: 'assistant', text: '' },
  ]
  assert(lastUserIndex(thread) === 2, `got ${lastUserIndex(thread)}`)
  assert(lastUserIndex([]) === -1, 'an empty thread has no anchor')
  assert(lastUserIndex(undefined) === -1, 'a missing thread has no anchor')
  return 'last user / empty / undefined'
})

check('an inserted answer lands after the focused block', () => {
  const { insertAfterBlock } = captured.module.__internal
  const blocks = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const afterB = insertAfterBlock(blocks, 'b', [{ id: 'x' }])
  assert(afterB.map((block) => block.id).join(',') === 'a,b,x,c', JSON.stringify(afterB))
  const atEnd = insertAfterBlock(blocks, 'missing', [{ id: 'y' }])
  assert(atEnd.map((block) => block.id).join(',') === 'a,b,c,y', JSON.stringify(atEnd))
  const noFocus = insertAfterBlock(blocks, null, [{ id: 'z' }])
  assert(noFocus.map((block) => block.id).join(',') === 'a,b,c,z', JSON.stringify(noFocus))
  assert(blocks.length === 3, 'the input list must not be mutated')
  return 'after block / fallback / end'
})

check('selected text is normalized for the ask prompt', () => {
  const { normalizeSelectionText } = captured.module.__internal
  assert(normalizeSelectionText('  第一行\n\n第二行  ') === '第一行 第二行', 'whitespace not collapsed')
  assert(normalizeSelectionText(undefined) === '', 'missing selection must be empty')
  assert(normalizeSelectionText('x'.repeat(2000)).length === 800, 'selection must be capped')
  return 'collapse / empty / cap'
})

check('the ask panel reads the app language from the locale service', () => {
  const { activeLocaleId } = captured.module.__internal
  assert(activeLocaleId({ getSnapshot: () => ({ active: 'en-US' }) }) === 'en', 'en snapshot not detected')
  assert(activeLocaleId({ getSnapshot: () => ({ active: 'zh-CN' }) }) === 'zh', 'zh snapshot not detected')
  assert(activeLocaleId({ getSnapshot: () => ({ active: 'ja' }) }) === 'zh', 'unknown locales fall back to zh')
  assert(activeLocaleId(undefined) === 'zh', 'a missing locale falls back to zh')
  return 'en / zh / fallback'
})

check('an external note change reloads when idle and asks while editing', () => {
  const { noteSyncDecision } = captured.module.__internal
  assert(noteSyncDecision({ saved: true, editing: false }) === 'reload', 'a clean idle page reloads')
  assert(noteSyncDecision({ saved: true, editing: true }) === 'warn', 'editing asks before reloading')
  assert(noteSyncDecision({ saved: false, editing: true }) === 'ignore', 'unsaved edits are never discarded')
  assert(noteSyncDecision({ saved: false, editing: false }) === 'ignore', 'a pending save is left alone')
  return 'reload / warn / ignore'
})

check('an answer becomes a short, clean note title', () => {
  const { askAnswerTitle } = captured.module.__internal
  assert(askAnswerTitle('## 中断处理要点\n\n正文', 'fallback') === '中断处理要点', 'heading not stripped')
  assert(askAnswerTitle('- **结论**：可以用', 'fallback') === '结论：可以用', 'list/bold not stripped')
  assert(askAnswerTitle('\n\n', 'fallback') === 'fallback', 'empty answer must fall back')
  assert(askAnswerTitle('x'.repeat(100), 'fallback').length === 60, 'title must be capped')
  return 'heading / list / empty / cap'
})

check('a save conflict offers the reload banner instead of a toast', () => {
  const { saveFailureKind } = captured.module.__internal
  assert(saveFailureKind('conflict') === 'sync', 'conflicts must use the sync banner')
  assert(saveFailureKind('missing_note') === 'notice', 'other failures stay a notice')
  assert(saveFailureKind(undefined) === 'notice', 'unknown failures stay a notice')
  return 'conflict / other'
})

check('the composer ask entry queues an open for the next mount', () => {
  const { requestAskOpen, takePendingAskOpen } = captured.module.__internal
  assert(takePendingAskOpen() === false, 'the queue starts empty')
  requestAskOpen()
  assert(takePendingAskOpen() === true, 'an unmounted panel must keep the request pending')
  assert(takePendingAskOpen() === false, 'the request is consumed once')
  return 'pending open'
})

check('a chat tool card hands its note to the workbench, pending when unmounted', () => {
  const { requestNoteOpen, subscribeNoteOpen, takePendingNoteOpen } = captured.module.__internal
  const seen = []
  const unsubscribe = subscribeNoteOpen((request) => seen.push(request))
  requestNoteOpen('笔记/欢迎.md')
  assert(
    seen.length === 1 && seen[0].path === '笔记/欢迎.md' && seen[0].history === false,
    `listener saw ${JSON.stringify(seen)}`,
  )
  assert(takePendingNoteOpen() === null, 'a delivered request must not stay pending')
  unsubscribe()
  requestNoteOpen('笔记/别.md', { history: true })
  const pending = takePendingNoteOpen()
  assert(pending !== null && pending.path === '笔记/别.md', 'an undelivered request must stay pending')
  assert(pending.history === true, 'the history flag must survive the handoff')
  assert(takePendingNoteOpen() === null, 'pending is consumed once')
  return 'live panel + mount handoff + history flag'
})

check('a body of sibling links is detected as a folder page', () => {
  const { autoFolderPageFor, linkOnlyTarget, resolveNoteLink } = captured.module.__internal
  const page = (blocks, path = '笔记/01 工作/工作.md') => autoFolderPageFor(blocks, path)
  const body = [
    { id: '1', type: 'heading1', text: '工作' },
    { id: '2', type: 'paragraph', text: '[Linux](<./Linux.md>)' },
    { id: '3', type: 'paragraph', text: '[讲稿](<./讲稿.md>)' },
    { id: '4', type: 'paragraph', text: '[[打包工作]]' },
  ]
  const detected = page(body)
  assert(detected !== null, 'a sibling link list was not detected')
  assert(detected.folder === '笔记/01 工作', `folder was ${detected.folder}`)
  assert(detected.auto === true, 'detected pages are automatic')
  assert(detected.links === 3, `links was ${detected.links}`)

  // Two links are a list, not a directory page.
  assert(page(body.slice(0, 3)) === null, 'two links must not become a folder page')
  // Prose, other block types, links leaving the folder, or a different title heading stop it.
  assert(page([...body, { id: '5', type: 'paragraph', text: '补充说明' }]) === null, 'prose must stop detection')
  assert(page([...body, { id: '6', type: 'bullet', text: '- 条目' }]) === null, 'other blocks must stop detection')
  assert(
    page([body[0], body[1], body[2], { id: '7', type: 'paragraph', text: '[生活](../02 生活/生活.md)' }]) === null,
    'a link outside the folder must stop detection',
  )
  assert(page(body, '笔记/01 工作/其他.md') === null, 'a heading that is not the page title must stop detection')

  assert(linkOnlyTarget('[A](<./a.md>)') === './a.md', 'markdown link not read')
  assert(linkOnlyTarget('[[B#标题|别名]]') === 'B', 'wiki link not read')
  assert(linkOnlyTarget('普通文字') === null, 'prose reported as a link')
  assert(resolveNoteLink('笔记/01 工作/工作.md', './Linux.md') === '笔记/01 工作/Linux.md', 'relative link not resolved')
  assert(resolveNoteLink('笔记/01 工作/工作.md', '[[Linux]]') === '笔记/01 工作/Linux.md', 'wiki target not resolved')
  assert(resolveNoteLink('顶层.md', '../外面.md') === null, 'a link leaving the vault must resolve to null')
  return 'detected + five rejection cases'
})

check('frontmatter type: folder pins the page and can point at another folder', () => {
  const { folderPageConfigFor, folderPageFor } = captured.module.__internal
  const pinned = folderPageConfigFor('type: folder\nfolder: 笔记', '笔记/00 首页/爱coding的小龙.md')
  assert(pinned !== null, 'type: folder was not recognized')
  assert(pinned.folder === '笔记', `override folder was ${pinned.folder}`)
  assert(pinned.auto === false, 'a pinned page is explicit')
  const own = folderPageFor('type: directory', '笔记/01 工作/工作.md', [])
  assert(own !== null && own.folder === '笔记/01 工作', 'a page without folder: presents its own folder')
  assert(folderPageConfigFor('type: collection', 'a.md') === null, 'collection pages are not folder pages')
  // A pinned page whose body is still a sibling link list hides that body too.
  const linkBody = [
    { id: '1', type: 'paragraph', text: '[A](./a.md)' },
    { id: '2', type: 'paragraph', text: '[B](./b.md)' },
    { id: '3', type: 'paragraph', text: '[C](./c.md)' },
  ]
  const pinnedLinks = folderPageFor('type: folder', '笔记/01 工作/工作.md', linkBody)
  assert(pinnedLinks.linkBody === true, 'a pinned page with a link list must hide the list')
  const pinnedProse = folderPageFor('type: folder', '笔记/01 工作/工作.md', [
    { id: '1', type: 'paragraph', text: '一段说明' },
  ])
  assert(pinnedProse.linkBody === false, 'a pinned page with prose keeps its body')
  return 'pinned + override + link body'
})

check('the writing heatmap builds GitHub-style columns', () => {
  const { writingHeatmap, writingLevel } = captured.module.__internal
  const today = new Date(2026, 10, 10)
  const days = { '2026-11-10': 100, '2026-11-09': 50, '2026-11-01': 25 }
  const grid = writingHeatmap(days, 53, today.getTime())
  assert(grid.weeks.length === 53, `weeks ${grid.weeks.length}`)
  assert(grid.weeks.every((week) => week.length === 7), 'every column is a full week')
  const last = grid.weeks[grid.weeks.length - 1]
  const todayCell = last.find((cell) => cell.date === '2026-11-10')
  assert(todayCell !== undefined && todayCell.chars === 100, 'today lands in the last column')
  assert(todayCell.level === 4, 'the busiest day is level 4')
  assert(last.filter((cell) => cell.future === true).length === 6 - ((today.getDay() + 6) % 7), 'future days are flagged')
  assert(grid.max === 100, 'max is the busiest day')
  assert(writingLevel(0, 100) === 0, 'nothing written is level 0')
  assert(writingLevel(25, 100) === 1 && writingLevel(26, 100) === 2, 'quartile thresholds')
  assert(writingLevel(75, 100) === 3 && writingLevel(100, 100) === 4, 'higher quartiles')
  return '53 weeks / levels / future'
})

check('callout kinds map to icons and cycle in order', () => {
  const { calloutKind, calloutIcon, nextCalloutKind } = captured.module.__internal
  assert(calloutKind('WARNING') === 'warning', 'variant matching is case-insensitive')
  assert(calloutKind('bogus') === 'note', 'unknown kinds fall back to note')
  assert(calloutIcon('bogus') === calloutIcon('note'), 'unknown kinds reuse the note icon')
  assert(calloutIcon('success') !== calloutIcon('note'), 'known kinds keep their own icon')
  assert(nextCalloutKind('note') === 'tip', 'cycle advances')
  assert(nextCalloutKind('bogus') === 'tip', 'unknown kinds cycle from note')
  assert(nextCalloutKind('example') === 'note', 'cycle wraps')
  return 'fallback + icon + wrap'
})

check('collection filters parse and apply conditions', () => {
  const { parseCollectionFilter, applyCollectionFilter, parseCollectionSort } = captured.module.__internal
  const rows = [
    { name: 'A', path: 'a.md', fields: { status: 'done', points: '3', tags: 'infra,linux' } },
    { name: 'B', path: 'b.md', fields: { status: 'doing', points: '12', tags: 'ui' } },
  ]
  assert(parseCollectionFilter('status = done and points > 2').length === 2, 'two conditions parsed')
  const filtered = applyCollectionFilter(rows, 'status = done and points > 2')
  assert(filtered.length === 1 && filtered[0].name === 'A', JSON.stringify(filtered))
  assert(applyCollectionFilter(rows, 'status != done').length === 1, '!=')
  assert(applyCollectionFilter(rows, 'tags ~ LINUX').length === 1, '~ must be case-insensitive contains')
  assert(applyCollectionFilter(rows, 'points >= 10').length === 1, 'numeric >=')
  assert(applyCollectionFilter(rows, '').length === 2, 'empty filter shows all')
  assert(applyCollectionFilter(rows, 'nonsense').length === 2, 'unparsable filter shows all')
  const sort = parseCollectionSort('points:desc')
  assert(sort.key === 'points' && sort.dir === 'desc', JSON.stringify(sort))
  assert(parseCollectionSort('').key === '', 'an empty sort has no key')
  return 'equals / contains / numeric / fallback / sort'
})

check('the command palette lists matching commands before notes', () => {
  const { paletteRows } = captured.module.__internal
  const actions = [
    { id: 'new', label: '新建笔记', icon: '＋' },
    { id: 'ask', label: '问 AI', icon: '✨' },
    { id: 'zen', label: '禅模式', icon: '◨' },
  ]
  const notes = [
    { path: '笔记/工作.md', name: '工作', dir: '笔记' },
    { path: '笔记/生活.md', name: '生活', dir: '笔记' },
  ]
  const empty = paletteRows(actions, notes, '')
  assert(empty[0].kind === 'action' && empty[0].id === 'new', JSON.stringify(empty[0]))
  assert(empty.some((row) => row.kind === 'note' && row.name === '工作'), 'notes must follow commands')

  const commands = paletteRows(actions, notes, '问')
  assert(commands.length === 1 && commands[0].kind === 'action' && commands[0].id === 'ask', JSON.stringify(commands))

  const byNote = paletteRows(actions, notes, '生活')
  assert(byNote.length === 1 && byNote[0].kind === 'note' && byNote[0].name === '生活', JSON.stringify(byNote))
  return 'empty / command query / note query'
})

check('an embed shows one anchored block or one heading section', () => {
  const { embedBlocksFor, parseBlocks } = captured.module.__internal
  const parsed = parseBlocks(
    '# 总标题\n\n## 第一节\n\n段一 ^abc\n\n### 子节\n\n子段\n\n## 第二节\n\n段二',
  )
  const whole = embedBlocksFor(parsed, '')
  assert(whole.blocks.length === parsed.length && whole.missing === false, 'no anchor shows the note')

  const block = embedBlocksFor(parsed, '^abc')
  assert(block.blocks.length === 1, `block anchor returned ${block.blocks.length}`)
  assert(block.blocks[0].text === '段一', JSON.stringify(block.blocks[0]))
  assert(embedBlocksFor(parsed, '^nope').missing === true, 'a missing block must be reported')

  const section = embedBlocksFor(parsed, '第一节')
  const types = section.blocks.map((item) => item.type).join(',')
  assert(section.missing === false, 'a heading section must resolve')
  assert(types === 'heading2,paragraph,heading3,paragraph', `section was ${types}`)
  assert(!section.blocks.some((item) => item.text === '第二节'), 'the next same-rank heading ends the section')

  const fallback = embedBlocksFor(parsed, '不存在的标题')
  assert(fallback.blocks.length === parsed.length, 'an unknown heading falls back to the note')
  return 'whole / block / missing / section'
})

check('a folder page lists direct notes and subfolders, excluding itself', () => {
  const { folderEntriesFor, sortFolderNotes, FolderView } = captured.module.__internal
  const notes = [
    { path: '笔记/01 工作/工作.md', name: '工作', size: 10, mtimeMs: 1 },
    { path: '笔记/01 工作/Linux.md', name: 'Linux', size: 2048, mtimeMs: 20 },
    { path: '笔记/01 工作/讲稿.md', name: '讲稿', size: 100, mtimeMs: 30 },
    { path: '笔记/01 工作/子目录/a.md', name: 'a', size: 5, mtimeMs: 40 },
    { path: '笔记/02 生活/生活.md', name: '生活', size: 5, mtimeMs: 50 },
  ]
  const entries = folderEntriesFor(notes, '笔记/01 工作', '笔记/01 工作/工作.md')
  assert(entries.files.length === 2, `expected 2 direct notes, got ${entries.files.length}`)
  assert(!entries.files.some((note) => note.name === '工作'), 'the page itself must not be listed')
  assert(entries.folders.length === 1, `expected 1 subfolder, got ${entries.folders.length}`)
  assert(entries.folders[0].name === '子目录', `subfolder was ${entries.folders[0].name}`)
  assert(entries.folders[0].count === 1 && entries.folders[0].notes.length === 1, 'subfolder direct notes are wrong')
  assert(sortFolderNotes(notes.slice(1, 3), 'updated')[0].name === '讲稿', 'updated sort is not newest-first')

  const countRows = (node) => {
    let count = 0
    const walk = (value) => {
      if (value === null || value === undefined) return
      if (Array.isArray(value)) {
        for (const child of value) walk(child)
        return
      }
      if (typeof value !== 'object') return
      const className = typeof value.props?.className === 'string' ? value.props.className.split(' ') : []
      if (className.includes('nb-folder-row')) count += 1
      if (Array.isArray(value.children)) walk(value.children)
    }
    walk(node)
    return count
  }
  const props = {
    t: (key, params) => (params === undefined ? key : `${key}:${params.count}`),
    folder: '笔记/01 工作',
    entries,
    hasBody: true,
    bodyOpen: false,
    onToggleBody: () => {},
    onOpen: () => {},
    onCreate: () => {},
  }
  resetState(['', 'name', {}])
  const collapsed = countRows(FolderView(props))
  assert(collapsed === 4, `expected 1 folder + 2 notes + new rows, got ${collapsed}`)
  resetState(['', 'name', { '笔记/01 工作/子目录': true }])
  const expanded = countRows(FolderView(props))
  assert(expanded === 5, `expected the expanded subfolder note, got ${expanded}`)
  return 'entries + collapsed/expanded rows + new'
})

check('sidebar glyph renders a theme-aware svg in both states', () => {
  const glyph = captured.panel.component
  const idle = glyph({ size: 22, active: false })
  const active = glyph({ size: 20, active: true })
  assert(idle.type === 'svg', 'glyph root is not an svg')
  assert(active.type === 'svg', 'glyph root is not an svg when active')
  assert(idle.props.viewBox === '0 0 24 24', 'unexpected viewBox')
  assert(idle.children.length > 0, 'glyph draws nothing')
  return `${idle.children.length} shapes`
})

check('main panel factory returns a React element without touching the Host', () => {
  const element = captured.main.component()
  assert(element !== null && typeof element === 'object', 'main panel did not return an element')
  assert(typeof element.type === 'function', 'main panel element does not wrap a component')
  return 'element created'
})

check('markdown model round-trips through parse/serialize', () => {
  const internal = captured.module.__internal
  assert(internal !== undefined, 'factory did not expose __internal')
  const { parseBlocks, serializeBlocks } = internal
  const sample = [
    '# 标题',
    '',
    '正文第一段',
    '',
    '- 项目 A',
    '- 项目 B',
    '',
    '1. 第一',
    '2. 第二',
    '',
    '- [ ] 待办',
    '- [x] 完成',
    '',
    '> 引用',
    '',
    '```',
    'const a = 1',
    '```',
    '',
    '---',
    '',
    '结尾',
    '',
  ].join('\n')
  const once = serializeBlocks(parseBlocks(sample))
  const twice = serializeBlocks(parseBlocks(once))
  assert(once === twice, `round-trip is unstable:\n${once}\n---\n${twice}`)
  const types = parseBlocks(sample)
    .map((block) => block.type)
    .join(',')
  for (const required of ['heading1', 'bullet', 'numbered', 'todo', 'quote', 'code', 'divider']) {
    assert(types.includes(required), `missing block type ${required} in ${types}`)
  }
  const empty = serializeBlocks(parseBlocks(''))
  assert(empty === '', `an empty note must serialize to an empty string, got ${JSON.stringify(empty)}`)
  return types
})

check('typing shortcuts turn plain text into block types', () => {
  const { shortcutFor } = captured.module.__internal
  const cases = [
    ['# 标题', 'paragraph', 'heading1'],
    ['## 二级', 'paragraph', 'heading2'],
    ['### 三级', 'paragraph', 'heading3'],
    ['- 项', 'paragraph', 'bullet'],
    ['1. 项', 'paragraph', 'numbered'],
    ['> 引用', 'paragraph', 'quote'],
    ['```', 'paragraph', 'code'],
    ['- [x] 完成', 'paragraph', 'todo'],
    ['---', 'paragraph', 'divider'],
    ['普通文字', 'paragraph', null],
    ['- 项', 'bullet', null],
    ['# 标题', 'heading1', null],
  ]
  for (const [text, type, expected] of cases) {
    const result = shortcutFor(text, type)
    const actual = result === null ? null : result.type
    assert(actual === expected, `${JSON.stringify(text)} (${type}) became ${String(actual)}, expected ${String(expected)}`)
  }
  return `${cases.length} cases`
})

function blockProps(block, overrides) {
  return {
    block,
    index: 0,
    editing: false,
    menuOpen: false,
    focusRequest: null,
    number: 2,
    t: (key) => key,
    onBegin: () => {},
    onText: () => {},
    onConvert: () => {},
    onSplit: () => {},
    onRemove: () => {},
    onToggleTodo: () => {},
    onMenu: () => {},
    onType: () => {},
    onMove: () => {},
    onDelete: () => {},
    onInsertAfter: () => {},
    onFocusConsumed: () => {},
    onCloseMenu: () => {},
    slashQuery: null,
    onSlash: () => {},
    onPick: () => {},
    onPasteBlocks: () => {},
    onUploadImages: () => {},
    onTableChange: () => {},
    dragging: false,
    dropMark: null,
    onDragStart: () => {},
    selected: false,
    onShiftSelect: () => {},
    collapsible: false,
    collapsed: false,
    onToggleCollapse: () => {},
    tableRevision: 0,
    onSetLang: () => {},
    onImageSelect: () => {},
    onLinkSelect: () => {},
    onIndent: () => {},
    onToggleBlock: () => {},
    onOpenWiki: () => {},
    onTableMoveColumn: () => {},
    notes: [],
    onExtractPage: () => {},
    onCopyLink: () => {},
    ...overrides,
  }
}

check('BlockView renders every block type in display and edit mode', () => {
  const { BlockView } = captured.module.__internal
  const types = ['paragraph', 'heading1', 'heading2', 'heading3', 'bullet', 'numbered', 'todo', 'quote', 'code', 'divider']
  let rendered = 0
  for (const type of types) {
    const block = { id: 'b1', type, text: type === 'code' ? 'const a = 1' : '文字内容', checked: false }
    const element = BlockView(blockProps(block))
    assert(element !== null && typeof element === 'object', `${type}: display render returned nothing`)
    assert(typeof element.type === 'string', `${type}: display root is not a DOM element`)
    rendered += 1
  }
  for (const type of ['paragraph', 'heading1', 'heading2', 'heading3', 'bullet', 'numbered', 'todo', 'quote', 'code']) {
    const block = { id: 'b2', type, text: '编辑中的文字', checked: true }
    const element = BlockView(blockProps(block, { editing: true }))
    assert(element !== null && typeof element === 'object', `${type}: edit render returned nothing`)
    rendered += 1
  }
  const menu = BlockView(blockProps({ id: 'b3', type: 'paragraph', text: 'x', checked: false }, { menuOpen: true }))
  assert(menu !== null, 'open block menu returned nothing')
  return `${rendered} renders + menu`
})

check('display and edit bodies use different keys so no DOM node is reused', () => {
  const { BlockView } = captured.module.__internal
  const block = { id: 'b1', type: 'paragraph', text: '文字内容', checked: false }
  const bodyOf = (root) =>
    root.children.find(
      (child) =>
        child !== null &&
        typeof child === 'object' &&
        typeof child.type === 'string' &&
        String((child.props && child.props.className) || '').includes('nb-b'),
    )
  const displayBody = bodyOf(BlockView(blockProps(block)))
  const editBody = bodyOf(BlockView(blockProps(block, { editing: true })))
  assert(displayBody !== undefined, 'display body not found')
  assert(editBody !== undefined, 'edit body not found')
  assert(displayBody.props.key !== editBody.props.key, `bodies share key ${String(displayBody.props.key)}`)
  assert(displayBody.props.contentEditable === undefined, 'display body must not be contentEditable')
  assert(editBody.props.contentEditable === true, 'edit body must be contentEditable')
  return `${String(displayBody.props.key)} vs ${String(editBody.props.key)}`
})

check('slash search matches labels and aliases', () => {
  const { matchesSlash } = captured.module.__internal
  assert(matchesSlash('heading2', '中标题', 'h2') === true, 'h2 alias did not match heading2')
  assert(matchesSlash('code', '代码', '代码') === true, 'label match failed')
  assert(matchesSlash('todo', '待办', 'task') === true, 'task alias did not match todo')
  assert(matchesSlash('bullet', '无序列表', 'quote') === false, 'a non-matching type passed')
  assert(matchesSlash('paragraph', '正文', '') === true, 'an empty query must match everything')
  return '7 alias/label cases'
})

check('BlockView renders the slash menu without throwing', () => {
  const { BlockView } = captured.module.__internal
  const block = { id: 'b1', type: 'paragraph', text: '/h1', checked: false }
  const element = BlockView(blockProps(block, { menuOpen: true, slashQuery: 'h1', editing: true }))
  assert(element !== null && typeof element === 'object', 'slash menu render returned nothing')
  const noMatch = BlockView(blockProps(block, { menuOpen: true, slashQuery: 'zzz', editing: true }))
  assert(noMatch !== null, 'empty-result slash menu returned nothing')
  return 'menu + empty result'
})

check('Markdown converts to safe inline HTML', () => {
  const { markdownToHtml } = captured.module.__internal
  assert(markdownToHtml('**b**') === '<strong>b</strong>', markdownToHtml('**b**'))
  assert(markdownToHtml('*i*') === '<em>i</em>', markdownToHtml('*i*'))
  assert(markdownToHtml('`c`') === '<code>c</code>', markdownToHtml('`c`'))
  assert(markdownToHtml('~~d~~') === '<del>d</del>', markdownToHtml('~~d~~'))
  assert(markdownToHtml('<script>alert(1)</script>').includes('&lt;script&gt;'), `script must stay escaped: ${markdownToHtml('<script>alert(1)</script>')}`)
  assert(markdownToHtml('<img src=x onerror=alert(1)>').includes('&lt;img'), 'dangerous attributes must escape the tag')
  assert(markdownToHtml('<span class="x">a</span>') === '<span class="x">a</span>', markdownToHtml('<span class="x">a</span>'))
  assert(markdownToHtml('<kbd>Ctrl</kbd>') === '<kbd>Ctrl</kbd>', markdownToHtml('<kbd>Ctrl</kbd>'))
  assert(markdownToHtml('==高亮==') === '<mark>高亮</mark>', markdownToHtml('==高亮=='))
  assert(markdownToHtml('%%注释%%') === '', `comments must disappear: ${markdownToHtml('%%注释%%')}`)
  assert(markdownToHtml('#标签 内容').startsWith('<span class="nb-tag">#标签</span>'), markdownToHtml('#标签 内容'))
  assert(markdownToHtml('[^1]').includes('nb-footnote-ref'), markdownToHtml('[^1]'))
  assert(
    markdownToHtml('[t](https://x)') ===
      '<a href="https://x" target="_blank" rel="noreferrer noopener">t</a>',
    markdownToHtml('[t](https://x)'),
  )
  assert(
    markdownToHtml('[t](javascript:alert(1))') === '[t](javascript:alert(1))',
    'an unsafe link must stay plain text',
  )
  return '7 inline cases'
})

check('inline HTML converts back to Markdown', () => {
  const { htmlToMarkdown } = captured.module.__internal
  const text = (value) => ({ nodeType: 3, textContent: value })
  const el = (tagName, children, attrs) => ({
    nodeType: 1,
    tagName,
    childNodes: children,
    textContent: children.map((child) => child.textContent ?? '').join(''),
    getAttribute: (name) => (attrs ?? {})[name] ?? null,
  })
  const fragment = {
    nodeType: 11,
    childNodes: [
      text('a '),
      el('strong', [text('b')]),
      text(' '),
      el('em', [text('c')]),
      text(' '),
      el('code', [text('d')]),
      text(' '),
      el('del', [text('e')]),
      text(' '),
      el('a', [text('f')], { href: 'https://x' }),
    ],
  }
  const markdown = htmlToMarkdown(fragment)
  assert(
    markdown === 'a **b** *c* `d` ~~e~~ [f](https://x)',
    `unexpected markdown: ${JSON.stringify(markdown)}`,
  )
  return markdown
})

check('code highlighting tokenizes keywords, strings, comments and numbers', () => {
  const { highlightCode } = captured.module.__internal
  const nodes = highlightCode('const x = "hi" // note\nreturn 42')
  const classes = nodes
    .filter((node) => node !== null && typeof node === 'object')
    .map((span) => span.props.className)
  for (const required of ['c-keyword', 'c-string', 'c-comment', 'c-number']) {
    assert(classes.includes(required), `missing ${required} in ${classes.join(',')}`)
  }
  const plain = highlightCode('plain text')
  assert(plain.every((node) => typeof node === 'string'), 'plain code must not produce highlighted spans')
  return classes.join(',')
})

check('frontmatter splits only real YAML headers and keeps the icon', () => {
  const { splitFrontmatter, composeContent, frontmatterIcon, withFrontmatterIcon } =
    captured.module.__internal
  const note = '---\nicon: 🦊\ntags: a\n---\n\n# 标题\n'
  const split = splitFrontmatter(note)
  assert(split.frontmatter === 'icon: 🦊\ntags: a', `unexpected frontmatter: ${JSON.stringify(split.frontmatter)}`)
  assert(split.body.trim() === '# 标题', `unexpected body: ${JSON.stringify(split.body)}`)
  const composed = composeContent(split.frontmatter, '# 标题\n')
  assert(composed === '---\nicon: 🦊\ntags: a\n---\n\n# 标题\n', JSON.stringify(composed))
  assert(composeContent('', '# x\n') === '# x\n', 'empty frontmatter must not add a header')
  assert(frontmatterIcon(split.frontmatter) === '🦊', 'icon extraction failed')
  assert(withFrontmatterIcon(split.frontmatter, '') === 'tags: a', 'icon removal failed')
  assert(withFrontmatterIcon('tags: a', '📌') === 'tags: a\nicon: 📌', 'icon add failed')
  const hr = splitFrontmatter('---\n\n正文\n\n---\n')
  assert(hr.frontmatter === '' && hr.body.startsWith('---'), 'a horizontal rule was treated as frontmatter')
  return '7 frontmatter cases'
})

check('collapsed headings hide blocks until the next same-level heading', () => {
  const { hiddenByCollapsedHeadings, parseBlocks } = captured.module.__internal
  const blocks = parseBlocks('# A\n\na\n\n## B\n\nb\n\n## C\n\nc\n\n# D\n\nd\n')
  const hidden = hiddenByCollapsedHeadings(blocks, { [blocks[0].id]: true })
  assert(hidden.size > 0, 'nothing was hidden')
  const dIndex = blocks.findIndex((block) => block.type === 'heading1' && block.text === 'D')
  assert(dIndex > 0, 'test note is malformed')
  const hiddenBeforeD = blocks.slice(0, dIndex).filter((block) => hidden.has(block.id)).length
  assert(hiddenBeforeD === dIndex - 1, `expected all blocks before D hidden, got ${hiddenBeforeD}`)
  assert(!hidden.has(blocks[blocks.length - 1].id), 'the next same-level section must stay visible')
  const none = hiddenByCollapsedHeadings(blocks, {})
  assert(none.size === 0, 'no collapse means nothing hidden')
  return `${hidden.size} hidden`
})

check('image Markdown renders as an img through the vault file route', () => {
  const { BlockView } = captured.module.__internal
  const block = { id: 'b1', type: 'paragraph', text: '前 ![](附件/a b.png) 后', checked: false }
  const element = BlockView(blockProps(block))
  const found = []
  const walk = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    if (node.type === 'img') {
      found.push(node)
      return
    }
    if (Array.isArray(node.children)) walk(node.children)
  }
  walk(element)
  assert(found.length === 1, `expected one img, found ${found.length}`)
  const expected = `/notebook/api/file?path=${encodeURIComponent('附件/a b.png')}`
  assert(found[0].props.src === expected, `src was ${String(found[0].props.src)}`)
  return found[0].props.src
})

check('Markdown tables round-trip through parse/serialize', () => {
  const { parseBlocks, serializeBlocks } = captured.module.__internal
  const source = '| 名称 | 值 |\n| --- | --- |\n| a | 1 |\n| b | 2 |\n'
  const blocks = parseBlocks(source)
  assert(blocks.length === 1 && blocks[0].type === 'table', `blocks: ${blocks.map((block) => block.type).join(',')}`)
  assert(
    JSON.stringify(blocks[0].rows) === JSON.stringify([['名称', '值'], ['a', '1'], ['b', '2']]),
    JSON.stringify(blocks[0].rows),
  )
  const markdown = serializeBlocks(blocks)
  assert(markdown === source, `serialize mismatch:\n${JSON.stringify(markdown)}`)
  const again = serializeBlocks(parseBlocks(markdown))
  assert(again === markdown, 'table round-trip unstable')
  return 'table round-trip'
})

check('table block renders editable cells', () => {
  const { BlockView } = captured.module.__internal
  const block = { id: 't1', type: 'table', text: '', rows: [['a', 'b'], ['1', '2']] }
  const element = BlockView(blockProps(block))
  const bodyElement = (element.children ?? []).find(
    (child) => child !== null && typeof child === 'object' && typeof child.type === 'function',
  )
  assert(bodyElement !== undefined, 'table body component not found')
  const rendered = bodyElement.type(bodyElement.props)
  let cells = 0
  let tables = 0
  let headers = 0
  let bodyCells = 0
  let resizers = 0
  let rowHandles = 0
  let colHandles = 0
  const walk = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    if (node.type === 'div' && node.props !== undefined && node.props.className === 'nb-cell') {
      cells += 1
      return
    }
    if (node.type === 'span' && node.props !== undefined && node.props.className === 'nb-col-resize') {
      resizers += 1
      return
    }
    if (node.type === 'span' && node.props !== undefined && node.props.className === 'nb-row-handle') {
      rowHandles += 1
      return
    }
    if (node.type === 'span' && node.props !== undefined && node.props.className === 'nb-col-handle') {
      colHandles += 1
      return
    }
    if (node.type === 'th') {
      headers += 1
    }
    if (node.type === 'td') {
      bodyCells += 1
    }
    if (typeof node.type === 'function' && node.props !== undefined && node.props.rowIndex !== undefined) {
      cells += 1
      return
    }
    if (node.type === 'table') {
      tables += 1
    }
    if (Array.isArray(node.children)) walk(node.children)
  }
  walk(rendered)
  assert(tables === 1, `expected one table, found ${tables}`)
  assert(cells === 4, `expected four cells, found ${cells}`)
  assert(headers === 2, `expected two header cells, found ${headers}`)
  assert(bodyCells === 2, `expected two body cells, found ${bodyCells}`)
  assert(resizers === 1, `expected one column resizer, found ${resizers}`)
  assert(rowHandles === 1, `expected one row handle (one data row), found ${rowHandles}`)
  assert(colHandles === 2, `expected two column handles, found ${colHandles}`)
  return `${cells} cells + ${headers} headers + ${resizers} resizer + ${rowHandles} row handles`
})

check('code fences keep their language through parse/serialize', () => {
  const { parseBlocks, serializeBlocks } = captured.module.__internal
  const source = '```js\nconst a = 1\n```\n'
  const blocks = parseBlocks(source)
  assert(blocks.length === 1 && blocks[0].type === 'code', `blocks: ${blocks.map((block) => block.type).join(',')}`)
  assert(blocks[0].lang === 'js', `lang was ${String(blocks[0].lang)}`)
  assert(serializeBlocks(blocks) === source, JSON.stringify(serializeBlocks(blocks)))
  const plain = parseBlocks('```\nplain\n```\n')
  assert(plain[0].lang === '', `plain lang was ${String(plain[0].lang)}`)
  return 'js + plain'
})

check('code block renders a language selector', () => {
  const { BlockView } = captured.module.__internal
  const block = { id: 'c1', type: 'code', text: 'const a = 1', lang: 'js', checked: false }
  const element = BlockView(blockProps(block))
  let labels = 0
  const walk = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    if (node.type === 'button' && node.props !== undefined && node.props.className === 'nb-code-lang') {
      labels += 1
      return
    }
    if (Array.isArray(node.children)) walk(node.children)
  }
  walk(element)
  assert(labels === 1, `expected one language label, found ${labels}`)
  return 'language label'
})

check('inline Markdown converts when its closing marker is typed', () => {
  const { matchInlineConvert } = captured.module.__internal
  const bold = matchInlineConvert('**粗体**')
  assert(bold !== null && bold.html === '<strong>粗体</strong>', JSON.stringify(bold))
  assert(bold.length === 6, `length was ${String(bold === null ? null : bold.length)}`)
  assert(matchInlineConvert('*斜*').html === '<em>斜</em>', 'italic conversion failed')
  assert(matchInlineConvert('`代码`').html === '<code>代码</code>', 'code conversion failed')
  assert(matchInlineConvert('~~删~~').html === '<del>删</del>', 'strike conversion failed')
  assert(matchInlineConvert('普通文字') === null, 'plain text must not convert')
  assert(matchInlineConvert('**未闭合') === null, 'an unclosed run must not convert')
  assert(matchInlineConvert('a **b**') !== null, 'a completed run at the caret should match')
  assert(matchInlineConvert('**a**b') === null, 'text after the run must not match')
  return '8 inline cases'
})

check('search hits highlight the query', () => {
  const { highlightText } = captured.module.__internal
  assert(highlightText('plain', 'x') === 'plain', 'no match must return the plain string')
  const nodes = highlightText('a CMake b cmake c', 'cmake')
  assert(Array.isArray(nodes), 'matches must return nodes')
  const marks = nodes.filter((node) => typeof node === 'object' && node.type === 'mark')
  assert(marks.length === 2, `expected 2 marks, got ${marks.length}`)
  assert(marks[0].children[0] === 'CMake', `mark text was ${String(marks[0].children[0])}`)
  return '2 highlights'
})

check('page cover lives in frontmatter', () => {
  const { frontmatterCover, withFrontmatterCover, splitFrontmatter } = captured.module.__internal
  const frontmatter = 'icon: 🦊\ncover: https://x/y.png'
  assert(frontmatterCover(frontmatter) === 'https://x/y.png', 'cover extraction failed')
  assert(withFrontmatterCover(frontmatter, '') === 'icon: 🦊', 'cover removal failed')
  assert(
    withFrontmatterCover('icon: 🦊', 'https://x/z.png') === 'icon: 🦊\ncover: https://x/z.png',
    'cover add failed',
  )
  const split = splitFrontmatter('---\ncover: 附件/a.png\n---\n\n# t\n')
  assert(split.frontmatter === 'cover: 附件/a.png', `frontmatter was ${JSON.stringify(split.frontmatter)}`)
  return 'cover frontmatter'
})

check('callouts parse and serialize as callout quotes', () => {
  const { parseBlocks, serializeBlocks } = captured.module.__internal
  const source = '> [!warning] 注意安全\n'
  const blocks = parseBlocks(source)
  assert(blocks.length === 1 && blocks[0].type === 'callout', blocks.map((block) => block.type).join(','))
  assert(blocks[0].variant === 'warning', `variant was ${String(blocks[0].variant)}`)
  assert(blocks[0].text === '注意安全', `text was ${String(blocks[0].text)}`)
  assert(serializeBlocks(blocks) === source, JSON.stringify(serializeBlocks(blocks)))
  const plainQuote = parseBlocks('> 普通引用\n')
  assert(plainQuote[0].type === 'quote', 'a plain quote must stay a quote')
  return 'callout round-trip'
})

check('callout block renders its type class and icon', () => {
  const { BlockView, calloutIcon } = captured.module.__internal
  const block = { id: 'k1', type: 'callout', variant: 'warning', text: '注意', checked: false }
  const element = BlockView(blockProps(block))
  const classNames = []
  const walk = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    if (typeof node.props?.className === 'string') classNames.push(node.props.className)
    if (Array.isArray(node.children)) walk(node.children)
  }
  walk(element)
  assert(classNames.some((name) => name.includes('nb-type-callout')), 'missing the callout type class')
  assert(classNames.includes('nb-callout-icon'), 'missing the callout icon')
  assert(calloutIcon('warning') === '⚠️', 'wrong warning icon')
  assert(calloutIcon('unknown') === '💡', 'unknown variants fall back to the note icon')
  return 'callout render'
})

check('list indentation survives parse/serialize', () => {
  const { parseBlocks, serializeBlocks } = captured.module.__internal
  const source = '- 一级\n  - 二级\n    - 三级\n- 回到一级\n'
  const blocks = parseBlocks(source)
  assert(blocks.length === 4, `expected 4 blocks, got ${blocks.length}`)
  const indents = blocks.map((block) => block.indent)
  assert(
    JSON.stringify(indents) === JSON.stringify([0, 1, 2, 0]),
    `indents were ${JSON.stringify(indents)}`,
  )
  assert(serializeBlocks(blocks) === source, JSON.stringify(serializeBlocks(blocks)))
  return 'nested lists'
})

check('table alignment survives parse/serialize', () => {
  const { parseBlocks, serializeBlocks } = captured.module.__internal
  const source = '| 左 | 中 | 右 |\n| --- | :---: | ---: |\n| 1 | 2 | 3 |\n'
  const blocks = parseBlocks(source)
  assert(blocks.length === 1 && blocks[0].type === 'table', blocks.map((block) => block.type).join(','))
  assert(
    JSON.stringify(blocks[0].aligns) === JSON.stringify(['left', 'center', 'right']),
    JSON.stringify(blocks[0].aligns),
  )
  assert(serializeBlocks(blocks) === source, JSON.stringify(serializeBlocks(blocks)))
  return 'left/center/right'
})

check('image width syntax renders as a sized image', () => {
  const { BlockView } = captured.module.__internal
  const block = { id: 'i1', type: 'paragraph', text: '前 ![图](附件/a.png){width=50%} 后', checked: false }
  const element = BlockView(blockProps(block))
  const images = []
  const walk = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    if (node.type === 'img') {
      images.push(node)
      return
    }
    if (Array.isArray(node.children)) walk(node.children)
  }
  walk(element)
  assert(images.length === 1, `expected one image, found ${images.length}`)
  assert(images[0].props.style !== undefined && images[0].props.style.width === '50%', 'width was not applied')
  assert(images[0].props.alt === '图', 'alt was not preserved')
  return '50% image'
})

check('HTML export converts blocks', () => {
  const { blockToHtml } = captured.module.__internal
  assert(blockToHtml({ type: 'heading1', text: '标题' }) === '<h1>标题</h1>', 'heading conversion failed')
  assert(blockToHtml({ type: 'paragraph', text: '**粗**' }) === '<p><strong>粗</strong></p>', 'inline conversion failed')
  assert(blockToHtml({ type: 'code', text: 'a < b' }) === '<pre><code>a &lt; b</code></pre>', 'code escaping failed')
  const table = blockToHtml({ type: 'table', rows: [['a', 'b'], ['1', '2']], aligns: ['left', 'right'] })
  assert(table.includes('<table>'), 'table missing')
  assert(table.includes('<th style="text-align:left">a</th>'), 'table header alignment missing')
  assert(table.includes('<td style="text-align:right">2</td>'), 'table cell alignment missing')
  assert(
    blockToHtml({ type: 'bullet', text: 'x', indent: 2 }) === '<ul style="margin-left:48px"><li>x</li></ul>',
    'indent style missing',
  )
  return '6 html cases'
})

check('dragging a block selection moves the whole group', () => {
  const { moveBlockGroup, parseBlocks } = captured.module.__internal
  const blocks = parseBlocks('a\n\nb\n\nc\n\nd\n')
  const ids = blocks.map((block) => block.id)
  const moved = moveBlockGroup(blocks, [ids[0], ids[1]], ids[3], true)
  assert(moved !== null, 'group move returned null')
  const texts = moved.map((block) => block.text)
  assert(JSON.stringify(texts) === JSON.stringify(['c', 'a', 'b', 'd']), JSON.stringify(texts))
  const intoSelf = moveBlockGroup(blocks, [ids[0], ids[1]], ids[1], true)
  assert(intoSelf === null, 'dropping into the group must be a no-op')
  const after = moveBlockGroup(blocks, [ids[0], ids[1]], ids[3], false)
  assert(
    JSON.stringify(after.map((block) => block.text)) === JSON.stringify(['c', 'd', 'a', 'b']),
    'drop-after failed',
  )
  return 'group move'
})

check('history diff marks added and removed lines', () => {
  const { diffLines } = captured.module.__internal
  const diff = diffLines('a\nb\nc\n', 'a\nx\nc\n')
  const kinds = diff.map((line) => `${line.type}:${line.text}`).join('|')
  assert(kinds === 'same:a|remove:b|add:x|same:c|same:', kinds)
  const unchanged = diffLines('a\n', 'a\n')
  assert(unchanged.every((line) => line.type === 'same'), 'unchanged input must be all same')
  const added = diffLines('a\n', 'a\nb\n')
  assert(added.some((line) => line.type === 'add' && line.text === 'b'), 'missing add line')
  return 'line diff'
})

check('table column widths come from the block model', () => {
  const { BlockView } = captured.module.__internal
  const block = { id: 't2', type: 'table', text: '', rows: [['a', 'b'], ['1', '2']], colWidths: [30, 70] }
  const element = BlockView(blockProps(block))
  const bodyElement = (element.children ?? []).find(
    (child) => child !== null && typeof child === 'object' && typeof child.type === 'function',
  )
  assert(bodyElement !== undefined, 'table body component not found')
  const rendered = bodyElement.type(bodyElement.props)
  const widths = []
  const walk = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    if (node.type === 'th' && node.props !== undefined && node.props.style !== undefined) {
      widths.push(node.props.style.width)
      return
    }
    if (Array.isArray(node.children)) walk(node.children)
  }
  walk(rendered)
  assert(JSON.stringify(widths) === JSON.stringify(['30%', '70%']), JSON.stringify(widths))
  return 'stored widths applied'
})

check('toggle blocks parse, serialize and hide their indented children', () => {
  const { parseBlocks, serializeBlocks, hiddenByToggles } = captured.module.__internal
  const source = '> [!toggle]- 标题\n\n  子内容\n\n  子段落\n\n结束\n'
  const blocks = parseBlocks(source)
  assert(blocks[0].type === 'toggle', blocks.map((block) => block.type).join(','))
  assert(blocks[0].collapsed === true, 'collapsed marker was lost')
  assert(blocks[1].indent === 1 && blocks[2].indent === 1, 'children indents are wrong')
  const markdown = serializeBlocks(blocks)
  assert(markdown === source, JSON.stringify(markdown))
  const hidden = hiddenByToggles(blocks)
  assert(hidden.has(blocks[1].id) && hidden.has(blocks[2].id), 'children were not hidden')
  assert(!hidden.has(blocks[3].id), 'a sibling outside the toggle must stay visible')
  const expanded = blocks.map((block) =>
    block.id === blocks[0].id ? { ...block, collapsed: false } : block,
  )
  assert(hiddenByToggles(expanded).size === 0, 'an expanded toggle hides nothing')
  return 'toggle round-trip'
})

check('toggle block renders its arrow', () => {
  const { BlockView } = captured.module.__internal
  const block = { id: 'g1', type: 'toggle', text: '标题', indent: 0, collapsed: true }
  const element = BlockView(blockProps(block))
  let arrows = 0
  const walk = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    if (node.type === 'button' && node.props !== undefined && node.props.className === 'nb-toggle-arrow') {
      arrows += 1
      return
    }
    if (Array.isArray(node.children)) walk(node.children)
  }
  walk(element)
  assert(arrows === 1, `expected one toggle arrow, found ${arrows}`)
  return 'toggle arrow'
})

check('diff collapses long unchanged runs', () => {
  const { collapseDiff } = captured.module.__internal
  const diff = []
  for (let index = 0; index < 12; index += 1) diff.push({ type: 'same', text: `l${index}` })
  diff.push({ type: 'remove', text: 'old' })
  diff.push({ type: 'add', text: 'new' })
  const collapsed = collapseDiff(diff, 2)
  assert(collapsed.some((line) => line.type === 'skip'), 'no skip entry')
  assert(collapsed.some((line) => line.type === 'add' && line.text === 'new'), 'change lost')
  const unchanged = collapseDiff([{ type: 'same', text: 'a' }], 2)
  assert(unchanged.length === 0, 'an unchanged diff must collapse to empty')
  return 'collapsed diff'
})

check('built-in note templates are complete', () => {
  const { NOTE_TEMPLATES } = captured.module.__internal
  assert(Array.isArray(NOTE_TEMPLATES) && NOTE_TEMPLATES.length >= 5, 'templates are missing')
  for (const template of NOTE_TEMPLATES) {
    assert(typeof template.titleKey === 'string' && template.titleKey.length > 0, 'title key missing')
    assert(typeof template.bodyKey === 'string' && template.bodyKey.length > 0, 'body key missing')
  }
  return `${NOTE_TEMPLATES.length} templates`
})

check('table rows reorder and keep the header', () => {
  const { moveTableRow } = captured.module.__internal
  const rows = [['h'], ['a'], ['b'], ['c']]
  const moved = moveTableRow(rows, 1, 3)
  assert(JSON.stringify(moved) === JSON.stringify([['h'], ['b'], ['c'], ['a']]), JSON.stringify(moved))
  const same = moveTableRow(rows, 2, 2)
  assert(JSON.stringify(same) === JSON.stringify(rows), 'identity move changed rows')
  const headerMove = moveTableRow(rows, 0, 2)
  assert(JSON.stringify(headerMove) === JSON.stringify(rows), 'header must not move')
  const short = moveTableRow([['only']], 1, 1)
  assert(short.length === 1, 'single-row table must stay')
  return 'row reorder'
})

check('wiki links resolve by note name and path', () => {
  const { findWikiTarget } = captured.module.__internal
  const notes = [
    { name: '会议纪要', path: '工作/会议纪要.md', dir: '工作' },
    { name: '索引', path: '索引.md', dir: '' },
  ]
  assert(findWikiTarget(notes, '会议纪要').path === '工作/会议纪要.md', 'name lookup failed')
  assert(findWikiTarget(notes, '工作/会议纪要') !== null, 'path lookup failed')
  assert(findWikiTarget(notes, '会议纪要.md') !== null, 'md suffix must be ignored')
  assert(findWikiTarget(notes, '不存在') === null, 'a missing note must return null')
  assert(findWikiTarget(notes, '') === null, 'an empty name must return null')
  return 'wiki lookup'
})

check('table columns reorder across every row', () => {
  const { moveTableColumn } = captured.module.__internal
  const rows = [['h1', 'h2', 'h3'], ['a', 'b', 'c']]
  const moved = moveTableColumn(rows, 0, 2)
  assert(
    JSON.stringify(moved) === JSON.stringify([['h2', 'h3', 'h1'], ['b', 'c', 'a']]),
    JSON.stringify(moved),
  )
  const same = moveTableColumn(rows, 1, 1)
  assert(JSON.stringify(same) === JSON.stringify(rows), 'identity move changed columns')
  const empty = moveTableColumn([], 0, 1)
  assert(Array.isArray(empty) && empty.length === 0, 'empty table must stay empty')
  return 'column reorder'
})

check('embedded note syntax renders an embed component', () => {
  const { BlockView, EmbeddedNote } = captured.module.__internal
  const block = { id: 'e1', type: 'paragraph', text: '前 ![[会议纪要]] 后', checked: false }
  const element = BlockView(blockProps(block))
  let embeds = 0
  const walk = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    if (node.type === EmbeddedNote) {
      embeds += 1
      assert(node.props.name === '会议纪要', `name was ${String(node.props.name)}`)
      return
    }
    if (Array.isArray(node.children)) walk(node.children)
  }
  walk(element)
  assert(embeds === 1, `expected one embed, found ${embeds}`)
  return 'embed component'
})

check('frontmatter values read and write cleanly', () => {
  const { frontmatterValue, withFrontmatterValue, parseListValue, formatListValue } =
    captured.module.__internal
  const fm = 'tags: [a, b]\naliases: 旧名\n'
  assert(frontmatterValue(fm, 'tags') === '[a, b]', frontmatterValue(fm, 'tags'))
  assert(frontmatterValue(fm, 'aliases') === '旧名', 'alias read failed')
  assert(frontmatterValue(fm, 'missing') === '', 'a missing key must be empty')
  const withTags = withFrontmatterValue(fm, 'tags', '[x, y]')
  assert(withTags === 'aliases: 旧名\ntags: [x, y]', JSON.stringify(withTags))
  const removed = withFrontmatterValue(fm, 'aliases', '')
  assert(removed === 'tags: [a, b]', JSON.stringify(removed))
  assert(JSON.stringify(parseListValue('[a, b, c]')) === JSON.stringify(['a', 'b', 'c']), 'parse list failed')
  assert(JSON.stringify(parseListValue('')) === JSON.stringify([]), 'empty list failed')
  assert(formatListValue(' a , b ') === '[a, b]', formatListValue(' a , b '))
  assert(formatListValue('') === '', 'empty format failed')
  return 'frontmatter values'
})

check('frontmatter lists the fields the panel does not edit', () => {
  const { frontmatterEntries } = captured.module.__internal
  const entries = frontmatterEntries('icon: 🦊\ntags: [a]\naliases: x\ndate: 2026-01-01\nsource: web\n')
  assert(
    JSON.stringify(entries) ===
      JSON.stringify([{ key: 'date', value: '2026-01-01' }, { key: 'source', value: 'web' }]),
    JSON.stringify(entries),
  )
  assert(frontmatterEntries('').length === 0, 'empty frontmatter must be empty')
  return 'remaining fields'
})

check('editing a frontmatter field can remove it', () => {
  const { withFrontmatterValue, frontmatterEntries } = captured.module.__internal
  const fm = 'date: 2026-01-01\nsource: web\n'
  const updated = withFrontmatterValue(fm, 'date', '2026-02-02')
  assert(updated === 'source: web\ndate: 2026-02-02', JSON.stringify(updated))
  const cleared = withFrontmatterValue(updated, 'date', '')
  assert(cleared === 'source: web', JSON.stringify(cleared))
  assert(frontmatterEntries(cleared).every((entry) => entry.key !== 'date'), 'date must be removed')
  return 'field edit/remove'
})

check('frontmatter keys are validated before creation', () => {
  const { isValidFrontmatterKey } = captured.module.__internal
  assert(isValidFrontmatterKey('source') === true, 'a simple key must pass')
  assert(isValidFrontmatterKey('my_key-2') === true, 'underscore/dash key must pass')
  assert(isValidFrontmatterKey('has space') === false, 'spaces must fail')
  assert(isValidFrontmatterKey('a:b') === false, 'a colon must fail')
  assert(isValidFrontmatterKey('') === false, 'an empty key must fail')
  return '5 key cases'
})

check('tab switching wraps around for swipe', () => {
  const { nextTabId } = captured.module.__internal
  const tabs = ['a.md', 'b.md', 'c.md']
  assert(nextTabId(tabs, 'a.md', 1) === 'b.md', 'next failed')
  assert(nextTabId(tabs, 'c.md', 1) === 'a.md', 'forward wrap failed')
  assert(nextTabId(tabs, 'a.md', -1) === 'c.md', 'backward wrap failed')
  assert(nextTabId(tabs, 'b.md', 0) === 'b.md', 'zero delta failed')
  assert(nextTabId(['a.md'], 'a.md', 1) === null, 'a single tab must not switch')
  assert(nextTabId(tabs, 'missing.md', 1) === null, 'an unknown current tab must not switch')
  return '6 tab cases'
})

check('multi-line frontmatter values are listed read-only', () => {
  const { frontmatterEntries } = captured.module.__internal
  const entries = frontmatterEntries('list:\n  - a\n  - b\ndate: 2026-01-01\n')
  const list = entries.find((entry) => entry.key === 'list')
  assert(list !== undefined, 'the multi-line field is missing')
  assert(list.multiline === true, 'the multi-line flag is missing')
  assert(list.value === '- a - b', JSON.stringify(list.value))
  const date = entries.find((entry) => entry.key === 'date')
  assert(date !== undefined && date.multiline === undefined, 'a plain field must not be multi-line')
  return 'multi-line field'
})

check('a block can become a sub-page in the same folder', () => {
  const { pagePathFor } = captured.module.__internal
  assert(pagePathFor('工作/会议.md', '议题') === '工作/议题.md', 'same folder failed')
  assert(pagePathFor('会议.md', '议题') === '议题.md', 'root folder failed')
  assert(
    pagePathFor('工作/会议.md', 'a/b:c') === '工作/a b c.md',
    JSON.stringify(pagePathFor('工作/会议.md', 'a/b:c')),
  )
  assert(pagePathFor('工作/会议.md', '') === '工作/untitled.md', 'empty title fallback failed')
  assert(pagePathFor('工作/会议.md', '  多   空格  ') === '工作/多 空格.md', 'whitespace normalization failed')
  assert(pagePathFor('工作/会议.md', '标题.md') === '工作/标题.md.md', 'path helper keeps the suffix it is given')
  return '6 page paths'
})

check('tag chips dedupe, trim and remove', () => {
  const { addTagToList, removeTagFromList } = captured.module.__internal
  assert(JSON.stringify(addTagToList([], 'a')) === JSON.stringify(['a']), 'add to empty failed')
  assert(JSON.stringify(addTagToList(['a'], 'a')) === JSON.stringify(['a']), 'a duplicate must be ignored')
  assert(JSON.stringify(addTagToList(['a'], ' b ')) === JSON.stringify(['a', 'b']), 'trim failed')
  assert(JSON.stringify(addTagToList(['a'], '')) === JSON.stringify(['a']), 'a blank tag must be ignored')
  assert(JSON.stringify(removeTagFromList(['a', 'b'], 'a')) === JSON.stringify(['b']), 'remove failed')
  assert(JSON.stringify(removeTagFromList(['a'], 'x')) === JSON.stringify(['a']), 'a missing tag must be ignored')
  return '6 tag cases'
})

check('wiki links split note and heading anchors', () => {
  const { parseWikiLink } = captured.module.__internal
  assert(
    JSON.stringify(parseWikiLink('笔记#标题')) === JSON.stringify({ name: '笔记', anchor: '标题' }),
    'split failed',
  )
  assert(
    JSON.stringify(parseWikiLink(' 笔记 ')) === JSON.stringify({ name: '笔记', anchor: '' }),
    'plain name failed',
  )
  assert(
    JSON.stringify(parseWikiLink('笔记#')) === JSON.stringify({ name: '笔记', anchor: '' }),
    'empty anchor failed',
  )
  assert(
    JSON.stringify(parseWikiLink('a#b#c')) === JSON.stringify({ name: 'a', anchor: 'b#c' }),
    'multi-hash failed',
  )
  assert(JSON.stringify(parseWikiLink('')) === JSON.stringify({ name: '', anchor: '' }), 'empty input failed')
  return '5 wiki link cases'
})

check('table cells keep line breaks through parse and serialize', () => {
  const { parseBlocks, serializeBlocks } = captured.module.__internal
  const source = '| a | b |\n| --- | --- |\n| x<br>y | z |\n'
  const blocks = parseBlocks(source)
  const table = blocks.find((block) => block.type === 'table')
  assert(table !== undefined, 'table block missing')
  assert(table.rows[1][0] === 'x\ny', JSON.stringify(table.rows))
  const markdown = serializeBlocks(blocks)
  assert(markdown.includes('x<br>y'), JSON.stringify(markdown))
  return 'cell line breaks'
})

check('move targets list root and every folder', () => {
  const { folderTargets } = captured.module.__internal
  const notes = [
    { path: '工作/会议.md', dir: '工作' },
    { path: '工作/2026/计划.md', dir: '工作/2026' },
    { path: '索引.md', dir: '' },
  ]
  const targets = folderTargets(notes)
  assert(JSON.stringify(targets) === JSON.stringify(['', '工作', '工作/2026']), JSON.stringify(targets))
  return '3 targets'
})

check('block links use the heading anchor when available', () => {
  const { blockLinkFor } = captured.module.__internal
  const heading = blockLinkFor('工作/会议.md', { type: 'heading2', text: '议题' })
  assert(heading === '[[会议#议题]]', heading)
  const paragraph = blockLinkFor('会议.md', { type: 'paragraph', text: '正文' })
  assert(paragraph === '[[会议]]', paragraph)
  return '2 block links'
})

check('font presets resolve and custom stacks are sanitized', () => {
  const { FONT_PRESETS, sanitizeFontStack, resolveFontStack, primaryFamily } = captured.module.__internal
  assert(Array.isArray(FONT_PRESETS) && FONT_PRESETS.length >= 8, 'font presets are missing')
  for (const preset of FONT_PRESETS) {
    assert(typeof preset.id === 'string' && preset.id.length > 0, 'preset id missing')
    assert(typeof preset.labelKey === 'string' && preset.labelKey.length > 0, 'preset label key missing')
    assert(typeof preset.stack === 'string' && preset.stack.length > 0, 'preset stack missing')
  }
  const serif = resolveFontStack('serif')
  assert(serif.includes('Georgia'), serif)
  assert(resolveFontStack('nope') === FONT_PRESETS[0].stack, 'unknown id must fall back to default')
  const custom = resolveFontStack('custom:"LXGW WenKai", serif')
  assert(custom === '"LXGW WenKai", serif', custom)
  const injected = resolveFontStack('custom:x;color:red')
  assert(!injected.includes(';') && !injected.includes(':'), injected)
  assert(sanitizeFontStack('  a   b  ') === 'a b', sanitizeFontStack('  a   b  '))
  assert(sanitizeFontStack('<script>x</script>') === 'script x script', sanitizeFontStack('<script>x</script>'))
  assert(primaryFamily('"LXGW WenKai", "KaiTi", serif') === 'LXGW WenKai', primaryFamily('"LXGW WenKai", "KaiTi", serif'))
  return `${FONT_PRESETS.length} presets + sanitize + resolve`
})

check('outgoing links are extracted, deduped and mark embeds', () => {
  const { outgoingLinks } = captured.module.__internal
  const blocks = [
    { id: 'a', type: 'paragraph', text: '见 [[笔记A]] 和 ![[笔记B]]' },
    { id: 'b', type: 'paragraph', text: '[[笔记A#标题]] 再次' },
    { id: 'c', type: 'code', text: '[[笔记C]]' },
  ]
  const links = outgoingLinks(blocks)
  assert(
    JSON.stringify(links) ===
      JSON.stringify([
        { name: '笔记A', embed: false },
        { name: '笔记B', embed: true },
      ]),
    JSON.stringify(links),
  )
  assert(outgoingLinks([]).length === 0, 'empty blocks must yield no links')
  return '3 outgoing cases'
})

check('typing [[ opens note suggestions with the current query', () => {
  const { wikiQueryFor } = captured.module.__internal
  assert(wikiQueryFor('见 [[') === '', 'empty query failed')
  assert(wikiQueryFor('见 [[项目') === '项目', 'query failed')
  assert(wikiQueryFor('见 [[项目]]') === null, 'closed link must not suggest')
  assert(wikiQueryFor('见 [[项目]] 再 [[') === '', 'reopened link failed')
  assert(wikiQueryFor('普通文本') === null, 'plain text must not suggest')
  assert(wikiQueryFor('[[a]b') === null, 'stray bracket must not suggest')
  assert(wikiQueryFor('[[') === '', 'bare open bracket pair failed')
  return '7 suggestion cases'
})

check('unlinked mentions find names outside links', () => {
  const { unlinkedMentions } = captured.module.__internal
  const notes = [
    { name: '当前', path: '当前.md' },
    { name: '项目计划', path: '项目计划.md' },
    { name: '会议纪要', path: '会议纪要.md' },
  ]
  const blocks = [
    { id: 'a', type: 'paragraph', text: '参考 项目计划 和 [[会议纪要]]' },
    { id: 'b', type: 'code', text: '项目计划' },
  ]
  const mentions = unlinkedMentions(blocks, notes, '当前.md')
  assert(
    JSON.stringify(mentions) ===
      JSON.stringify([{ name: '项目计划', path: '项目计划.md', count: 1 }]),
    JSON.stringify(mentions),
  )
  return 'unlinked mentions'
})

check('linking mentions leaves existing links and code alone', () => {
  const { linkMentions } = captured.module.__internal
  const blocks = [
    { id: 'a', type: 'paragraph', text: '项目计划 与 项目计划' },
    { id: 'b', type: 'paragraph', text: '已有 [[项目计划]] 链接' },
    { id: 'c', type: 'code', text: '项目计划' },
  ]
  const next = linkMentions(blocks, '项目计划')
  assert(next[0].text === '[[项目计划]] 与 [[项目计划]]', next[0].text)
  assert(next[1].text === '已有 [[项目计划]] 链接', next[1].text)
  assert(next[2].text === '项目计划', 'code must stay untouched')
  return 'link mentions'
})

check('graph layout puts outgoing right and backlinks left', () => {
  const { graphPositions } = captured.module.__internal
  const out = graphPositions(2, 'out', 640, 400, 150)
  assert(out.length === 2, 'out count')
  assert(out.every((point) => point.x > 320), 'outgoing nodes must be right of center: ' + JSON.stringify(out))
  const incoming = graphPositions(2, 'in', 640, 400, 150)
  assert(incoming.every((point) => point.x < 320), 'backlinks must be left of center: ' + JSON.stringify(incoming))
  assert(graphPositions(0, 'out', 640, 400, 150).length === 0, 'empty layout')
  return '3 layout cases'
})

check('zen mode shortcut is listed', () => {
  const { SHORTCUTS } = captured.module.__internal
  const zen = SHORTCUTS.find((entry) => entry[1] === 'scZen')
  assert(zen !== undefined, 'zen shortcut missing')
  assert(zen[0].includes('Shift'), zen[0])
  return 'zen shortcut'
})

check('quick open filters notes by name and path', () => {
  const { filterQuickNotes } = captured.module.__internal
  const notes = [
    { name: '项目计划', path: '工作/项目计划.md', dir: '工作' },
    { name: '会议纪要', path: '工作/会议纪要.md', dir: '工作' },
    { name: '欢迎', path: '欢迎.md', dir: '' },
  ]
  assert(filterQuickNotes(notes, '').length === 3, 'empty query must match all')
  assert(filterQuickNotes(notes, '项目').length === 1, 'name filter failed')
  assert(filterQuickNotes(notes, '工作/').length === 2, 'path filter failed')
  assert(filterQuickNotes(notes, '无此笔记').length === 0, 'missing query must be empty')
  return '4 quick open cases'
})

check('emoji shortcodes replace only known trailing codes', () => {
  const { emojiAtEnd, EMOJI_SHORTCODES } = captured.module.__internal
  const smile = emojiAtEnd('你好 :smile:')
  assert(smile !== null && smile.emoji === '😄', JSON.stringify(smile))
  const upper = emojiAtEnd(':SMile:')
  assert(upper !== null && upper.emoji === '😄', 'case-insensitive lookup failed')
  assert(emojiAtEnd('未知 :nope:') === null, 'unknown code must not match')
  assert(emojiAtEnd('没有代码') === null, 'plain text must not match')
  assert(emojiAtEnd(':smile: 后面还有字') === null, 'code must be at the end')
  assert(Object.keys(EMOJI_SHORTCODES).length >= 40, 'shortcode table too small')
  return '6 emoji cases'
})

check('sub-page tree nests children under their parent', () => {
  const { flattenTree } = captured.module.__internal
  const notes = [
    { name: '父页', path: '目录/父页.md' },
    { name: '子页', path: '目录/子页.md' },
    { name: '孙页', path: '目录/孙页.md' },
    { name: '独立', path: '目录/独立.md' },
  ]
  const parents = { '目录/子页.md': '目录/父页', '目录/孙页.md': '目录/子页' }
  const ordered = flattenTree(notes, parents)
  assert(
    JSON.stringify(ordered.map((entry) => [entry.note.name, entry.depth])) ===
      JSON.stringify([
        ['父页', 0],
        ['子页', 1],
        ['孙页', 2],
        ['独立', 0],
      ]),
    JSON.stringify(ordered.map((entry) => [entry.note.name, entry.depth])),
  )
  assert(flattenTree([], {}).length === 0, 'empty list must stay empty')
  return '4 tree entries'
})

check('block anchors survive a parse/serialize round-trip', () => {
  const { parseBlocks, serializeBlocks, splitBlockId, blockLinkFor } = captured.module.__internal
  assert(JSON.stringify(splitBlockId('正文 ^abc')) === JSON.stringify({ text: '正文', blockId: 'abc' }), 'split failed')
  assert(splitBlockId('普通文本').blockId === '', 'plain text must have no id')
  const source = '一段正文 ^pid1\n\n# 标题 ^pid2\n'
  const blocks = parseBlocks(source)
  assert(blocks[0].blockId === 'pid1', JSON.stringify(blocks[0]))
  assert(blocks[0].text === '一段正文', JSON.stringify(blocks[0].text))
  assert(blocks[1].blockId === 'pid2', JSON.stringify(blocks[1]))
  const markdown = serializeBlocks(blocks)
  assert(markdown.includes('一段正文 ^pid1'), JSON.stringify(markdown))
  assert(markdown.includes('# 标题 ^pid2'), JSON.stringify(markdown))
  assert(blockLinkFor('笔记/页.md', { type: 'paragraph', text: 'x', blockId: 'pid1' }) === '[[页#^pid1]]', 'block link failed')
  return '5 block anchor cases'
})

check('template button links round-trip through markdown', () => {
  const { isTemplateHref, parseBlocks, serializeBlocks } = captured.module.__internal
  assert(isTemplateHref('nb://template') === true, 'plain template href failed')
  assert(isTemplateHref('nb://template/x') === true, 'template href with id failed')
  assert(isTemplateHref('https://example.com') === false, 'http href must not match')
  assert(isTemplateHref(undefined) === false, 'undefined href must not match')
  const blocks = parseBlocks('[新建页面](nb://template)\n')
  const markdown = serializeBlocks(blocks)
  assert(markdown.includes('nb://template'), JSON.stringify(markdown))
  return '5 template button cases'
})

check('collection views derive columns, filter, sort and group', () => {
  const {
    collectionConfigFor,
    collectionColumns,
    filterCollectionRows,
    sortCollectionRows,
    groupCollectionRows,
  } = captured.module.__internal
  const rows = [
    { name: 'A', path: 'x/A.md', fields: { status: '进行中', priority: '高' } },
    { name: 'B', path: 'x/B.md', fields: { status: '完成', priority: '低' } },
    { name: 'C', path: 'x/C.md', fields: {} },
  ]
  const config = collectionConfigFor('type: collection\nview: board\ngroupBy: status\n')
  assert(config !== null && config.view === 'board', JSON.stringify(config))
  assert(config.groupBy === 'status', JSON.stringify(config))
  assert(collectionConfigFor('title: x\n') === null, 'non-collection page must not enable the view')
  const columns = collectionColumns(rows, [])
  assert(columns.includes('status') && columns.includes('priority'), JSON.stringify(columns))
  assert(JSON.stringify(collectionColumns(rows, ['status'])) === JSON.stringify(['status']), 'explicit columns failed')
  const filtered = filterCollectionRows(rows, '进行')
  assert(filtered.length === 1 && filtered[0].name === 'A', JSON.stringify(filtered))
  const sorted = sortCollectionRows(rows, 'name', 'desc')
  assert(sorted.map((row) => row.name).join('') === 'CBA', JSON.stringify(sorted.map((row) => row.name)))
  const grouped = groupCollectionRows(rows, 'status')
  assert(grouped.length === 3, JSON.stringify(grouped.map((group) => group.value)))
  return 'collection helpers'
})

check('canvas bounds cover every card with padding', () => {
  const { canvasBounds } = captured.module.__internal
  const empty = canvasBounds([])
  assert(empty.width > 0 && empty.height > 0, JSON.stringify(empty))
  const bounds = canvasBounds([
    { x: 0, y: 0, width: 200, height: 100 },
    { x: 400, y: 300, width: 100, height: 50 },
  ])
  assert(bounds.minX <= -80, JSON.stringify(bounds))
  assert(bounds.minY <= -80, JSON.stringify(bounds))
  assert(bounds.width >= 400 + 100 + 80, JSON.stringify(bounds))
  assert(bounds.height >= 300 + 50 + 80, JSON.stringify(bounds))
  return 'canvas bounds'
})

check('obsidian-columns callout parses into a columns block', () => {
  const { parseBlocks, serializeBlocks } = captured.module.__internal
  const blocks = parseBlocks('> [!col]\n> 左栏 A\n> 左栏 B\n>\n> 右栏 C\n')
  assert(blocks.length === 1, JSON.stringify(blocks.map((b) => b.type)))
  assert(blocks[0].type === 'columns', JSON.stringify(blocks[0]))
  assert(
    JSON.stringify(blocks[0].columns) === JSON.stringify(['左栏 A\n左栏 B', '右栏 C']),
    JSON.stringify(blocks[0].columns),
  )
  const markdown = serializeBlocks(blocks)
  assert(markdown.includes('> [!col]') && markdown.includes('> 右栏 C'), markdown)
  const round = parseBlocks(markdown)
  assert(round.length === 1 && round[0].type === 'columns', JSON.stringify(round.map((b) => b.type)))
  assert(round[0].columns.length === 2, JSON.stringify(round[0].columns))
  const three = parseBlocks('> [!col]\n> A\n>\n> B\n>\n> C\n')
  assert(three[0].columns.length === 3, JSON.stringify(three[0].columns))
  return 'columns round-trip'
})

check('math and footnotes follow Obsidian syntax', () => {
  const { markdownToHtml, renderLatexMath, collectFootnotes, isFootnoteDefinition } = captured.module.__internal
  const inline = markdownToHtml('$E=mc^2$')
  assert(inline.includes('nb-math'), inline)
  assert(inline.includes('<sup>2</sup>'), inline)
  const plain = markdownToHtml('$5 and $6')
  assert(!plain.includes('nb-math'), `currency must not become math: ${plain}`)
  const frac = renderLatexMath('\\frac{1}{2}')
  assert(frac.includes('nb-math-frac'), frac)
  const sqrt = renderLatexMath('\\sqrt{x}')
  assert(sqrt.includes('nb-math-radicand'), sqrt)
  const greek = renderLatexMath('\\alpha + \\beta')
  assert(greek.includes('α') && greek.includes('β'), greek)
  const blocks = [
    { type: 'paragraph', text: '正文[^1]' },
    { type: 'paragraph', text: '[^1]: 脚注内容 **加粗**' },
    { type: 'paragraph', text: '普通段落' },
  ]
  assert(isFootnoteDefinition(blocks[1]) === true, 'definition not detected')
  assert(isFootnoteDefinition(blocks[0]) === false, 'reference must not be a definition')
  const notes = collectFootnotes(blocks)
  assert(notes.length === 1 && notes[0].ref === '1' && notes[0].text.includes('脚注内容'), JSON.stringify(notes))
  return 'math + footnotes'
})

check('Bases config parses filters, sort and views', () => {
  const { parseBasesConfig } = captured.module.__internal
  const text = [
    'views:',
    '  - type: table',
    '    name: 最近编辑',
    '    limit: 10',
    '    filters:',
    '      and:',
    '        - \'file.ext == "md"\'',
    '        - not:',
    '            - \'file.inFolder("附件")\'',
    '    sort:',
    '      - property: file.mtime',
    '        direction: DESC',
  ].join('\n')
  const config = parseBasesConfig(text)
  assert(config.views.length === 1, JSON.stringify(config.views))
  assert(config.views[0].type === 'table', JSON.stringify(config.views[0]))
  assert(config.views[0].name === '最近编辑', JSON.stringify(config.views[0]))
  assert(config.views[0].limit === 10, JSON.stringify(config.views[0]))
  assert(Array.isArray(config.views[0].sort), JSON.stringify(config.views[0].sort))
  assert(config.views[0].sort[0].direction === 'DESC', JSON.stringify(config.views[0].sort))
  const and = config.views[0].filters.and
  assert(Array.isArray(and) && and.length === 2, JSON.stringify(and))
  assert(typeof and[1] === 'object' && Array.isArray(and[1].not), JSON.stringify(and[1]))
  return 'bases config'
})

check('Bases filters and sort run on vault rows', () => {
  const { parseBasesConfig, makeBaseRow, evalBaseFilter, sortBaseRows } = captured.module.__internal
  const config = parseBasesConfig(
    ['filters:', '  and:', '    - \'file.ext == "md"\'', '    - not:', '        - \'file.inFolder("附件")\'', 'views:', '  - type: table', '    name: T', '    sort:', '      - property: file.mtime', '        direction: DESC'].join('\n'),
  )
  const rows = [
    makeBaseRow({ path: 'a.md', name: 'a', size: 10, mtimeMs: 100 }, {}),
    makeBaseRow({ path: '附件/x.md', name: 'x', size: 10, mtimeMs: 300 }, {}),
    makeBaseRow({ path: '笔记/b.md', name: 'b', size: 10, mtimeMs: 200 }, {}),
  ]
  const filtered = rows.filter((row) => evalBaseFilter(config.filters, row, Date.now()))
  assert(filtered.length === 2, JSON.stringify(filtered.map((row) => row.path)))
  const sorted = sortBaseRows(filtered, config.views[0].sort)
  assert(sorted[0].path === '笔记/b.md', JSON.stringify(sorted.map((row) => row.path)))
  assert(sorted[1].path === 'a.md', JSON.stringify(sorted.map((row) => row.path)))
  const inFolder = evalBaseFilter('file.inFolder("笔记")', rows[2], Date.now())
  assert(inFolder === true, 'inFolder failed')
  return 'filters + sort'
})

check('Obsidian base code blocks parse their first view', () => {
  const { parseBasesView } = captured.module.__internal
  const parsed = parseBasesView('views:\n  - type: table\n    name: 最近编辑\n    limit: 10\n')
  assert(parsed !== null, 'base block did not parse')
  assert(parsed.views.length === 1, JSON.stringify(parsed.views))
  assert(parsed.views[0].type === 'table', JSON.stringify(parsed.views[0]))
  assert(parsed.views[0].name === '最近编辑', JSON.stringify(parsed.views[0]))
  const two = parseBasesView('filters:\n  and:\n    - 1\nviews:\n  - type: cards\n    name: Cards\n  - type: kanban\n    name: Board\n')
  assert(two !== null && two.views.length === 2, JSON.stringify(two))
  assert(parseBasesView('const x = 1') === null, 'plain code must not parse as bases')
  return 'bases parse cases'
})

check('blank blocks treat newline-only text as empty', () => {
  const { isBlankBlockText } = captured.module.__internal
  assert(isBlankBlockText('') === true, 'empty string failed')
  assert(isBlankBlockText('\n') === true, 'single newline failed')
  assert(isBlankBlockText('\n\n\n') === true, 'multiple newlines failed')
  assert(isBlankBlockText(' ') === false, 'a space is still content')
  assert(isBlankBlockText('文字') === false, 'text failed')
  assert(isBlankBlockText('\n文字') === false, 'newline plus text failed')
  return '6 blank-text cases'
})

check('Workbench renders a selected note with one block view per block', () => {
  const { parseBlocks, BlockView } = captured.module.__internal
  const blocks = parseBlocks('# 标题\n\n正文\n\n- 列表 A\n- 列表 B\n\n- [ ] 待办\n\n> 引用\n')
  const locale = { register: () => () => {}, bind: () => (key) => key, subscribe: () => () => {} }
  const presets = [
    { name: 'Vault', path: '/tmp/vault' },
    [{ path: '笔记/01 工作/a.md', name: 'a', dir: '笔记/01 工作', size: 10, mtimeMs: 0 }],
    '笔记/01 工作/a.md',
    blocks,
    null,
    null,
    null,
    '',
    null,
    'saved',
    null,
    null,
    false,
    { '笔记/01 工作': true },
    false,
    null,
    false,
    { id: blocks[0].id, overId: null, before: true, moved: true },
    { blockId: 'unknown', top: 120, left: 240 },
    false,
    '',
    '',
    false,
    false,
    '',
    null,
    {},
    0,
    null,
    null,
    ['笔记/01 工作/a.md'],
    { blockId: blocks[0].id, href: 'https://example.com', x: 100, y: 100 },
    '',
    null,
    true,
    null,
    true,
    '',
    0,
  ]
  resetState(presets)
  const element = captured.main.component()
  assert(element !== null && typeof element.type === 'function', 'main panel did not wrap the workbench')
  resetState(presets)
  const tree = element.type(element.props)
  assert(tree !== null && typeof tree === 'object', 'workbench returned nothing')
  let found = 0
  let toolbar = 0
  let iconRow = 0
  let ghost = 0
  let tabs = 0
  let linkBar = 0
  let find = 0
  let syncButton = 0
  let flashEntry = 0
  const walk = (node) => {
    if (node === null || node === undefined) return
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    if (typeof node !== 'object') return
    if (node.type === 'div' && node.props !== undefined && node.props.className === 'nb-find') {
      find += 1
      return
    }
    if (node.type === 'div' && node.props !== undefined && node.props.className === 'nb-toolbar') {
      toolbar += 1
      return
    }
    if (
      node.type === 'div' &&
      node.props !== undefined &&
      typeof node.props.className === 'string' &&
      node.props.className.startsWith('nb-tab') &&
      node.props.className !== 'nb-tabs'
    ) {
      tabs += 1
      return
    }
    if (
      node.type === 'button' &&
      node.props !== undefined &&
      typeof node.props.className === 'string' &&
      node.props.className.includes('nb-flash-entry')
    ) {
      flashEntry += 1
      return
    }
    if (
      node.type === 'button' &&
      node.props !== undefined &&
      typeof node.props.className === 'string' &&
      node.props.className.includes('nb-sync-btn')
    ) {
      syncButton += 1
      return
    }
    if (node.type === 'div' && node.props !== undefined && node.props.className === 'nb-img-bar') {
      linkBar += 1
      return
    }
    if (node.type === 'div' && node.props !== undefined && node.props.className === 'nb-ghost') {
      ghost += 1
      return
    }
    if (node.type === 'div' && node.props !== undefined && node.props.className === 'nb-icon-row') {
      iconRow += 1
    }
    if (node.type === BlockView) {
      found += 1
      return
    }
    if (Array.isArray(node.children)) walk(node.children)
  }
  walk(tree)
  assert(found === blocks.length, `expected ${blocks.length} block views, found ${found}`)
  assert(toolbar === 1, `expected one selection toolbar, found ${toolbar}`)
  assert(iconRow === 1, `expected one page-icon row, found ${iconRow}`)
  assert(ghost === 1, `expected one drag ghost, found ${ghost}`)
  assert(tabs === 1, `expected one open tab, found ${tabs}`)
  assert(linkBar === 1, `expected one link bar, found ${linkBar}`)
  assert(find === 1, `expected one find palette, found ${find}`)
  assert(syncButton === 1, `expected one sync entry point in the top bar, found ${syncButton}`)
  assert(flashEntry === 1, `expected one flash entry in the sidebar, found ${flashEntry}`)
  assert(
    typeof tree.props?.className === 'string' && tree.props.className.includes('zen'),
    'focus-mode root class missing',
  )
  return `${found} block views + toolbar + icon row + ghost + tab + link bar + find + sync button + flash entry`
})


check('sync dialog renders provider tabs, fields and the run action', () => {
  const { SyncDialog, syncFormFromSettings, syncSettingsFromForm } = captured.module.__internal
  const settings = {
    provider: 'webdav',
    webdav: { url: 'https://dav.example.com/me', username: 'u', password: 'p', remotePath: 'notes' },
    git: { remote: '', branch: '', message: '' },
    auto: { onSave: true, intervalMinutes: 15 },
    deletes: 'trash',
  }
  const form = syncFormFromSettings(settings)
  assert(form.webdavUrl === 'https://dav.example.com/me', 'webdav url was not mapped')
  assert(form.onSave === true && form.interval === '15', 'auto sync settings were not mapped')
  const round = syncSettingsFromForm(form)
  assert(round.webdav.password === 'p', 'password was not round-tripped')
  assert(round.auto.intervalMinutes === 15, 'interval was not round-tripped')

  const textOf = (node) => {
    if (node === null || node === undefined) return ''
    if (Array.isArray(node)) return node.map(textOf).join('')
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    return textOf(node.children)
  }
  const render = (preset) => {
    resetState([null, preset, null, null, null])
    const tree = SyncDialog({ t: (key) => key, localeId: 'zh', onClose() {}, onStatus() {}, onDone() {} })
    const elements = []
    const walk = (node) => {
      if (node === null || node === undefined) return
      if (Array.isArray(node)) return node.forEach(walk)
      if (typeof node !== 'object') return
      elements.push(node)
      walk(node.children)
    }
    walk(tree)
    assert(
      elements.every((node) => typeof node.type === 'string' || typeof node.type === 'function'),
      'the sync dialog used an element type this runtime may not provide (Fragment or undefined)',
    )
    return elements
  }

  // The shipped client must not depend on React.Fragment: no other part of this
  // bundle uses it, and a partial React surface would unmount the whole panel.
  const savedFragment = React.Fragment
  React.Fragment = undefined
  const webdav = render(form)
  const tabs = webdav.filter((node) => String(node.props?.className ?? '') === 'nb-sync-tab').length
  const inputs = webdav.filter((node) => node.type === 'input').length
  const runButton = webdav.find(
    (node) =>
      node.type === 'button' &&
      String(node.props?.className ?? '').includes('nb-btn-primary') &&
      textOf(node) === 'syncRun',
  )
  assert(tabs === 3, `expected three provider tabs, found ${tabs}`)
  assert(inputs >= 5, `expected the webdav fields, found ${inputs} inputs`)
  assert(runButton !== undefined, 'the run action is missing')
  assert(
    webdav.some(
      (node) => String(node.props?.className ?? '') === 'nb-modal-title' && textOf(node) === 'syncTitle',
    ),
    'the dialog title is missing',
  )

  const gitForm = syncFormFromSettings({ ...settings, provider: 'git', git: { remote: 'git@x:y.git', branch: 'main', message: '' } })
  const git = render(gitForm)
  React.Fragment = savedFragment
  assert(git.some((node) => textOf(node) === 'syncGitRemote'), 'the git remote field is missing')
  assert(git.some((node) => textOf(node) === 'syncGitBranch'), 'the git branch field is missing')
  return 'webdav + git forms, three tabs, run action'
})


check('flash capture and panel render their controls', () => {
  const { FlashCapture, FlashPanel, flashCategoryLabel, flashCategoryIndex, flashErrorLabel } = captured.module.__internal
  assert(flashCategoryLabel((key) => key, '灵感') === 'flashCatSpark', 'category label mapping is wrong')
  assert(flashCategoryIndex('灵感') === 3, 'category index is wrong')
  assert(flashErrorLabel((key) => key, { code: 'flash_empty' }) === 'flashErrEmpty', 'flash error mapping is wrong')

  const textOf = (node) => {
    if (node === null || node === undefined) return ''
    if (Array.isArray(node)) return node.map(textOf).join('')
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    return textOf(node.children)
  }
  const collect = (tree) => {
    const elements = []
    const walk = (node) => {
      if (node === null || node === undefined) return
      if (Array.isArray(node)) return node.forEach(walk)
      if (typeof node !== 'object') return
      elements.push(node)
      walk(node.children)
    }
    walk(tree)
    assert(
      elements.every((node) => typeof node.type === 'string' || typeof node.type === 'function'),
      'a flash view used an element type this runtime may not provide',
    )
    return elements
  }

  // Capture: text, category, pending, error.
  resetState(['', '', false, null])
  const capture = collect(
    FlashCapture({ t: (key) => key, onClose() {}, onSaved() {} }),
  )
  assert(capture.some((node) => node.type === 'textarea'), 'the capture box has no textarea')
  const chips = capture.filter((node) => String(node.props?.className ?? '') === 'nb-flash-cat-chip')
  assert(chips.length === 5, `expected five category chips, found ${chips.length}`)
  assert(
    capture.some(
      (node) =>
        node.type === 'button' &&
        String(node.props?.className ?? '').includes('nb-btn-primary') &&
        textOf(node) === 'flashCapture',
    ),
    'the capture action is missing',
  )

  // Panel: status, category, query, data, loading, error, confirmPath.
  const data = {
    dir: '闪念',
    items: [
      {
        path: '闪念/一条.md',
        name: '一条',
        preview: '整理一下这条闪念',
        createdMs: Date.parse('2026-11-10T14:00:00+08:00'),
        category: '想法',
        tags: ['测试'],
        pinned: false,
        done: false,
      },
    ],
    counts: { inbox: 1, done: 0, total: 1 },
    total: 1,
    categories: ['随记', '想法', '待办', '灵感', '摘录'],
    truncated: false,
  }
  resetState(['inbox', '', '', data, false, null, null])
  const panel = collect(
    FlashPanel({
      t: (key) => key,
      localeId: 'zh',
      revision: 0,
      onCapture() {},
      onOpen() {},
      onClose() {},
      onChanged() {},
    }),
  )
  const text = panel.map((node) => textOf(node)).join('\n')
  assert(text.includes('flashTitle'), 'the panel title is missing')
  assert(text.includes('一条') || text.includes('整理一下这条闪念'), 'the flash card is missing')
  const tabs = panel.filter((node) => String(node.props?.className ?? '') === 'nb-flash-tab')
  assert(tabs.length === 3, `expected three status tabs, found ${tabs.length}`)
  const actions = panel.filter((node) => String(node.props?.className ?? '').includes('nb-flash-action'))
  assert(actions.length >= 4, `expected pin/done/open/delete actions, found ${actions.length}`)
  assert(panel.some((node) => node.type === 'input'), 'the panel search box is missing')
})


check('marp code blocks split into slides and render one at a time', () => {
  const { parseMarpDeck, MarpDeck } = captured.module.__internal
  const source = [
    '---',
    'marp：true',
    '---',
    '# 第一张',
    '',
    '正文',
    '',
    '---',
    '## 第二张',
    '',
    '| a | b |',
    '| - | - |',
    '| 1 | 2 |',
  ].join('\n')
  const deck = parseMarpDeck(source, '纯文本')
  assert(deck !== null, 'a marp deck with a full-width colon was not recognized')
  assert(deck.slides.length === 2, `expected 2 slides, got ${deck.slides.length}`)
  assert(deck.slides[0].startsWith('# 第一张'), deck.slides[0])
  assert(deck.slides[1].startsWith('## 第二张'), deck.slides[1])
  assert(parseMarpDeck('const a = 1', 'js') === null, 'plain code became a deck')
  assert(parseMarpDeck('# one\n\n---\n\n# two', 'marp') !== null, 'a marp fence without frontmatter was not recognized')

  resetState([0])
  const tree = MarpDeck({ slides: deck.slides, t: (key) => key })
  const elements = []
  const walk = (node) => {
    if (node === null || node === undefined) return
    if (Array.isArray(node)) return node.forEach(walk)
    if (typeof node !== 'object') return
    elements.push(node)
    walk(node.children)
  }
  walk(tree)
  const stage = elements.find((node) => String(node.props?.className ?? '') === 'nb-deck-stage')
  const slide = elements.find((node) => String(node.props?.className ?? '') === 'nb-deck-slide')
  const counter = elements.find((node) => String(node.props?.className ?? '') === 'nb-deck-count')
  assert(stage !== undefined, 'the slide stage is missing')
  assert(slide !== undefined, 'the slide body is missing')
  assert(String(slide.props.dangerouslySetInnerHTML.__html).includes('<h3>第一张</h3>'), 'the first slide did not render')
  assert(counter !== undefined && counter.children.join('') === '1 / 2', 'the slide counter is wrong')
  const nav = elements.filter((node) => String(node.props?.className ?? '') === 'nb-deck-btn')
  assert(nav.length === 2, `expected two navigation buttons, found ${nav.length}`)
  return '2 slides + stage + counter + nav'
})

console.log('')
console.log(`SUMMARY: ${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
