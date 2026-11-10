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
  const ctx = {
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
  captured.panel = panel
  captured.main = main
  return `id=${panel.options.id}, label=${label}`
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
  assert(markdownToHtml('<b>') === '&lt;b&gt;', `escaping failed: ${markdownToHtml('<b>')}`)
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
  assert(
    typeof tree.props?.className === 'string' && tree.props.className.includes('zen'),
    'focus-mode root class missing',
  )
  return `${found} block views + toolbar + icon row + ghost + tab + link bar + find`
})

console.log('')
console.log(`SUMMARY: ${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
