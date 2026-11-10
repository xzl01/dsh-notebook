/**
 * Client half of the @local/dsh-notebook bundle.
 *
 * A Notion-style notebook: the page opens rendered, click any block to edit it
 * in place, Markdown syntax turns into structure while typing (`# `, `- `,
 * `[] `, `> `, ```), and every edit is written back to the note file through
 * the Host's shared vault service. There is no source/preview switch and no
 * second editor surface: the document is the editor.
 *
 * Notes come from the Obsidian vault folder on disk, but nothing here opens or
 * embeds Obsidian: the vault is just the notebook directory.
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-notebook',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'dsh-notebook'
    const API = '/notebook/api'
    const LAST_NOTE_KEY = `${NS}:last-note`
    const WIDE_KEY = `${NS}:wide`
    const ZEN_KEY = `${NS}:zen`
    const FONT_KEY = `${NS}:font`
    const TYPEFACE_KEY = `${NS}:typeface`
    const LINKS_OPEN_KEY = `${NS}:links-open`
    const FAVORITES_KEY = `${NS}:favorites`
    const RECENT_KEY = `${NS}:recent`
    const COLS_KEY = `${NS}:cols:`
    const READING_KEY = `${NS}:reading`
    const SCROLL_KEY = `${NS}:scroll:`
    const TABS_KEY = `${NS}:tabs`
    /** Languages offered by the code-block label; empty means plain text. */
    const CODE_LANGS = [
      '', 'text', 'javascript', 'typescript', 'python', 'bash', 'json', 'css', 'html', 'sql',
      'rust', 'go', 'c', 'cpp', 'java', 'markdown', 'yaml',
    ]
    /** Page icons offered by the picker; any emoji typed by the user also works. */
    const PAGE_EMOJIS = [
      '📝', '📖', '💡', '✅', '🔥', '⭐', '🚀', '🎯', '📌', '🧠', '🛠️', '🐧',
      '📦', '🧪', '🌱', '☕', '🎨', '🎵', '🏠', '💼', '📚', '🗂️', '🔖', '⚠️',
      '❓', '🧩', '🌍', '🕹️', '🍀', '🐱', '🦊', '🐼', '🌊', '🌙', '☀️', '🎮',
    ]
    /** Typeface presets for the type panel; every stack falls back to a system font. */
    const FONT_PRESETS = [
      {
        id: 'default',
        labelKey: 'fontDefault',
        sample: '正文 Aa 123',
        stack:
          'ui-sans-serif, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif',
      },
      {
        id: 'inter',
        labelKey: 'fontInter',
        sample: '正文 Aa 123',
        stack: '"Inter", "SF Pro Text", -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
      },
      {
        id: 'sourcehan',
        labelKey: 'fontSourceHan',
        sample: '正文 Aa 123',
        stack: '"Source Han Sans SC", "Noto Sans CJK SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
      },
      {
        id: 'yahei',
        labelKey: 'fontYahei',
        sample: '正文 Aa 123',
        stack: '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif',
      },
      {
        id: 'serif',
        labelKey: 'fontSerif',
        sample: '正文 Aa 123',
        stack: 'Georgia, "Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", "SimSun", serif',
      },
      {
        id: 'kaiti',
        labelKey: 'fontKaiti',
        sample: '正文 Aa 123',
        stack: '"KaiTi", "STKaiti", "Kaiti SC", "LXGW WenKai", "FangSong", serif',
      },
      {
        id: 'wenkai',
        labelKey: 'fontWenkai',
        sample: '正文 Aa 123',
        stack: '"LXGW WenKai", "LXGW WenKai GB", "KaiTi", "STKaiti", serif',
      },
      {
        id: 'mono',
        labelKey: 'fontMono',
        sample: '正文 Aa 123',
        stack: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      },
    ]
    /** Labels for the AI task chips. */
    const AI_TASK_LABELS = {
      rewrite: 'aiRewrite',
      continue: 'aiContinue',
      polish: 'aiPolish',
      translate: 'aiTranslate',
      summary: 'aiSummary',
      tags: 'aiTags',
      agent: 'aiAgent',
    }

    /** A small common emoji shortcode table for `:code:` replacement while typing. */
    const EMOJI_SHORTCODES = {
      smile: '😄',
      grin: '😁',
      joy: '😂',
      wink: '😉',
      heart: '❤️',
      broken_heart: '💔',
      thumbsup: '👍',
      '+1': '👍',
      thumbsdown: '👎',
      ok_hand: '👌',
      clap: '👏',
      wave: '👋',
      tada: '🎉',
      rocket: '🚀',
      fire: '🔥',
      star: '⭐',
      sparkles: '✨',
      zap: '⚡',
      check: '✅',
      x: '❌',
      warning: '⚠️',
      bulb: '💡',
      book: '📚',
      memo: '📝',
      calendar: '📅',
      clock: '⏰',
      mail: '✉️',
      link: '🔗',
      lock: '🔒',
      key: '🔑',
      sun: '☀️',
      moon: '🌙',
      coffee: '☕',
      pizza: '🍕',
      dog: '🐶',
      cat: '🐱',
      eyes: '👀',
      thinking: '🤔',
      question: '❓',
      exclamation: '❗',
      arrow_right: '➡️',
      plus: '➕',
      minus: '➖',
      flag: '🚩',
      pushpin: '📌',
      paperclip: '📎',
      computer: '💻',
      phone: '📱',
      gift: '🎁',
      trophy: '🏆',
      money: '💰',
      chart: '📈',
      bell: '🔔',
      gear: '⚙️',
      hammer: '🔨',
      hourglass: '⏳',
      package: '📦',
    }

    /** The emoji a trailing `:shortcode:` maps to, or null. */
    function emojiAtEnd(text) {
      const source = String(text ?? '')
      const match = /:([a-z0-9_+-]+):$/i.exec(source)
      if (match === null) return null
      const code = match[1].toLowerCase()
      const emoji = EMOJI_SHORTCODES[code]
      if (emoji === undefined) return null
      return { emoji, code }
    }

    /** User-supplied stacks are remembered with this prefix. */
    const CUSTOM_FONT_PREFIX = 'custom:'

    function sanitizeFontStack(value) {
      return String(value ?? '')
        .replace(/[^\w\s,"'\-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200)
    }

    /** Resolve the stored typeface choice to a usable CSS font-family value. */
    function resolveFontStack(choice) {
      const raw = String(choice ?? '').trim()
      const fallback = FONT_PRESETS[0].stack
      if (raw.startsWith(CUSTOM_FONT_PREFIX)) {
        const custom = sanitizeFontStack(raw.slice(CUSTOM_FONT_PREFIX.length))
        return custom.length > 0 ? custom : fallback
      }
      const preset = FONT_PRESETS.find((item) => item.id === raw)
      return preset === undefined ? fallback : preset.stack
    }

    /** First family in a stack, for availability checks in the browser. */
    function primaryFamily(stack) {
      const first = String(stack ?? '').split(',')[0].trim().replace(/^["']|["']$/g, '')
      return first.length > 0 ? first : ''
    }

    /** Vault folder whose notes act as user templates. */
    const TEMPLATE_FOLDER = '模板'
    /** Note templates offered by the new-note dialog. */
    const NOTE_TEMPLATES = [
      { id: 'blank', titleKey: 'templateBlank', bodyKey: 'templateBlankBody' },
      { id: 'meeting', titleKey: 'templateMeeting', bodyKey: 'templateMeetingBody' },
      { id: 'daily', titleKey: 'templateDaily', bodyKey: 'templateDailyBody' },
      { id: 'project', titleKey: 'templateProject', bodyKey: 'templateProjectBody' },
      { id: 'reading', titleKey: 'templateReading', bodyKey: 'templateReadingBody' },
      { id: 'collection', titleKey: 'templateCollection', bodyKey: 'templateCollectionBody' },
    ]
    /** Shortcut cheat sheet shown from the page menu. */
    const SHORTCUTS = [
      ['Ctrl/Cmd + S', 'scSave'],
      ['Ctrl/Cmd + Shift + F', 'scZen'],
      ['Ctrl/Cmd + P', 'scQuickOpen'],
      ['Ctrl/Cmd + Z', 'scUndo'],
      ['Ctrl/Cmd + Shift + Z', 'scRedo'],
      ['Ctrl/Cmd + B / I', 'scBold'],
      ['Enter / Shift+Enter', 'scEnter'],
      ['/', 'scSlash'],
      ['Shift + 点击', 'scMultiSelect'],
      ['Ctrl/Cmd + C / X', 'scCopy'],
      ['Tab / Shift+Tab', 'scTab'],
    ]
    const inject = ['slots', 'locale']

    const zh = {
      panelTitle: '笔记本',
      newNote: '新建笔记',
      searchPlaceholder: '搜索…',
      emptyTitle: '写点什么',
      emptyHint: '从左侧选择一篇笔记，或者新建一页。',
      noNotes: '还没有笔记',
      notes: '笔记库',
      noResults: '没有找到',
      loading: '加载中…',
      saved: '已保存',
      saving: '保存中…',
      unsaved: '未保存',
      saveError: '保存失败',
      untitled: '无标题',
      addBlock: '点击添加块',
      more: '更多',
      deleteNote: '删除笔记',
      rename: '重命名',
      copyPath: '复制路径',
      moveTo: '移动到…',
      newFolder: '新建文件夹',
      folderName: '文件夹名（可含 / 分层）',
      create: '创建',
      vaultRoot: '笔记库根目录',
      copyPathDone: '路径已复制',
      copyFailed: '复制失败',
      outline: '大纲',
      shortcutsTitle: '快捷键',
      findPlaceholder: '在页面中查找',
      zenMode: '禅模式（专注写作）',
      exitZen: '退出禅模式',
      exportMarkdown: '导出 Markdown',
      exportHtml: '导出 HTML',
      exportPdf: '导出 PDF（打印）',
      historyTitle: '版本历史',
      propsTitle: '页面属性',
      propsTags: '标签',
      propsTagPlaceholder: '输入标签后回车',
      removeTag: '移除标签',
      propsAliases: '别名',
      propsHint: '多个值用逗号分隔',
      propsOther: '其他字段',
      propsNewKey: '字段名',
      propsNewValue: '值',
      propsAddField: '新增字段',
      propsInvalidKey: '字段名只能包含字母、数字、下划线和短横线',
      save: '保存',
      fontLarger: '增大字号',
      fontSmaller: '减小字号',
      typeTitle: '字体',
      fontDefault: '默认（系统无衬线）',
      fontInter: 'Inter',
      fontSourceHan: '思源黑体 / Noto Sans',
      fontYahei: '微软雅黑',
      fontSerif: '衬线（宋体）',
      fontKaiti: '楷体',
      fontWenkai: '霞鹜文楷',
      fontMono: '等宽',
      fontMissing: '本机未安装，将回退',
      fontCustomHint: '自定义 font-family，例如 "LXGW WenKai", serif',
      apply: '应用',
      fontScaleLabel: '字号',
      readingMode: '阅读模式',
      exitReading: '退出阅读模式',
      templateTitle: '选择模板',
      templateFromVault: '来自 模板/ 目录',
      templateVaultEmpty: '把模板笔记放进笔记库的 模板/ 文件夹，就会出现在这里',
      templateBlank: '空白笔记',
      templateMeeting: '会议记录',
      templateDaily: '今日记录',
      templateProject: '项目计划',
      templateReading: '读书笔记',
      templateBlankBody: '',
      templateMeetingBody: '## 参会人\n\n- \n\n## 议题\n\n- \n\n## 结论\n\n- \n\n## 待办\n\n- [ ] \n',
      templateDailyBody: '## 今天做了什么\n\n- \n\n## 遇到的问题\n\n- \n\n## 明天计划\n\n- \n',
      templateProjectBody: '## 目标\n\n- \n\n## 里程碑\n\n- [ ] \n\n## 风险\n\n- \n',
      templateReadingBody: '## 书中要点\n\n- \n\n## 我的思考\n\n- \n\n## 引用\n\n> \n',
      templateCollection: '数据库页',
      templateCollectionBody:
        '---\ntype: collection\nview: table\ngroupBy: status\n---\n\n这个页面会汇总当前目录下笔记的属性（表格 / 看板）。属性面板里可改 type、view、groupBy、source、columns。',
      historyEmpty: '还没有历史版本（保存过一次之后才会有）',
      historyPreview: '历史版本预览',
      diffHint: '与当前内容的差异：红色行恢复后会消失，绿色行会加回',
      diffSkipped: '行未改动',
      diffNone: '这个版本与当前内容相同',
      historyRestored: '已恢复历史版本',
      restore: '恢复此版本',
      expandAll: '展开全部',
      collapseAll: '收起',
      close: '关闭',
      scSave: '保存',
      scZen: '禅模式（专注写作）',
      scQuickOpen: '快速打开笔记',
      scUndo: '撤销 / 重做',
      scRedo: '重做',
      scBold: '加粗 / 斜体',
      scEnter: '新建块 / 块内换行',
      scSlash: '插入菜单',
      scMultiSelect: '多选块',
      scCopy: '复制 / 剪切块',
      scTab: '表格跳格',
      deleteTitle: '删除笔记',
      deleteBody: '这篇笔记会移到笔记库的 .trash 文件夹，不会永久删除。',
      cancel: '取消',
      confirm: '删除',
      loadError: '加载失败',
      typeText: '正文',
      typeHeading1: '大标题',
      typeHeading2: '中标题',
      typeHeading3: '小标题',
      typeBullet: '无序列表',
      typeNumbered: '有序列表',
      typeTodo: '待办',
      typeQuote: '引用',
      typeCode: '代码',
      typeDivider: '分隔线',
      typeTable: '表格',
      typeCallout: '提示块',
      typeToggle: '折叠列表',
      expandToggle: '展开',
      collapseToggle: '收起',
      typeImage: '图片',
      imageUrl: '图片地址',
      codeLanguage: '语言',
      codeLanguagePlain: '纯文本',
      deleteBlock: '删除块',
      extractPage: '转为子页面',
      extractPageDone: '已创建子页面：{name}',
      copyBlockLink: '复制块链接',
      copyLinkDone: '已复制：{link}',
      moveUp: '上移',
      moveDown: '下移',
      blockMenu: '块操作',
      blockOptions: '块选项',
      placeholderTitle: '标题',
      placeholderText: '输入文字，或按 “/” 换类型',
      wideMode: '切换全宽',
      narrowMode: '切换默认宽度',
      noBlocks: '空页面',
      addIcon: '添加图标',
      addCover: '添加封面',
      imageAlt: '图片描述',
      imageDone: '完成',
      blocksCount: '个块',
      imageRemove: '移除图片',
      removeCover: '移除封面',
      coverPlaceholder: '图片地址，或笔记库里的相对路径',
      coverInvalid: '封面需要 http(s) 图片地址，或以图片扩展名结尾的路径',
      changeIcon: '更换图标',
      removeIcon: '移除图标',
      tableRow: '行',
      tableCol: '列',
      moveRow: '拖动调整行顺序',
      moveColumn: '拖动调整列顺序',
      collapseHeading: '折叠 / 展开',
      fmtBold: '加粗',
      fmtItalic: '斜体',
      fmtStrike: '删除线',
      fmtCode: '行内代码',
      fmtLink: '链接',
      linkPlaceholder: '粘贴或输入链接地址',
      linkOpen: '打开',
      linkRemove: '移除链接',
      wikiNotFound: '找不到笔记：{name}',
      linksTitle: '链接',
      backlinks: '反向链接',
      outlinks: '出链',
      noBacklinks: '还没有笔记链接到这里',
      noOutlinks: '这篇笔记还没有链接到其他笔记',
      embedTag: '嵌入',
      mentions: '提及',
      collectionTable: '表格',
      collectionBoard: '看板',
      collectionFilter: '筛选笔记…',
      collectionRows: '条',
      collectionEmpty: '这个目录下还没有笔记，或笔记还没有属性',
      collectionUncategorized: '未分类',
      collectionName: '名称',
      collectionSort: '点击排序',
      collectionSource: '数据来源',
      collectionNewRow: '新建条目',
      collectionEditCell: '点击编辑',
      collectionSaved: '已保存',
      collectionRowCreated: '已新建条目，点击行打开填写属性',
      refresh: '刷新',
      favorites: '收藏',
      recent: '最近打开',
      addFavorite: '收藏',
      removeFavorite: '取消收藏',
      quickOpenPlaceholder: '快速打开笔记…',
      linkIt: '加链接',
      graphTitle: '关系图谱',
      aiTitle: 'AI 写作助手',
      aiPageTitle: 'AI 摘要与标签',
      aiRewrite: '改写',
      aiContinue: '续写',
      aiPolish: '润色',
      aiTranslate: '翻译',
      aiSummary: '摘要',
      aiTags: '标签',
      aiGenerate: '生成',
      aiGenerating: '生成中…',
      aiReplace: '替换块',
      aiInsertBelow: '插入到下方',
      aiInsertTop: '插入到开头',
      aiAgent: 'Agent 整理',
      aiRun: '执行',
      aiAgentPlaceholder: '用一句话说明要做什么，例如：把这篇笔记整理成小节并补 3 条摘要',
      copy: '复制',
      copied: '已复制',
      graphEmpty: '这篇笔记还没有链接关系',
      typeNoteLink: '双链笔记',
      typeTemplateButton: '模板按钮',
      templateButtonLabel: '新建页面',
      notePickerTitle: '插入笔记链接',
      notePickerPlaceholder: '搜索笔记名…',
      notePickerEmpty: '没有匹配的笔记',
      linkConfirm: '确定',
      linkCancel: '取消',
      linkInvalid: '链接要以 http://、https:// 或 mailto: 开头',
      fmtClear: '清除格式',
    }

    const en = {
      panelTitle: 'Notebook',
      newNote: 'New note',
      searchPlaceholder: 'Search…',
      emptyTitle: 'Write something',
      emptyHint: 'Pick a note on the left, or create a new page.',
      noNotes: 'No notes yet',
      notes: 'Vault',
      noResults: 'Nothing found',
      loading: 'Loading…',
      saved: 'Saved',
      saving: 'Saving…',
      unsaved: 'Unsaved',
      saveError: 'Save failed',
      untitled: 'Untitled',
      addBlock: 'Click to add a block',
      more: 'More',
      deleteNote: 'Delete note',
      rename: 'Rename',
      copyPath: 'Copy path',
      moveTo: 'Move to…',
      newFolder: 'New folder',
      folderName: 'Folder name (may contain /)',
      create: 'Create',
      vaultRoot: 'Vault root',
      copyPathDone: 'Path copied',
      copyFailed: 'Copy failed',
      outline: 'Outline',
      shortcutsTitle: 'Keyboard shortcuts',
      findPlaceholder: 'Find in page',
      zenMode: 'Zen mode (distraction-free)',
      exitZen: 'Exit zen mode',
      exportMarkdown: 'Export Markdown',
      exportHtml: 'Export HTML',
      exportPdf: 'Export PDF (print)',
      historyTitle: 'Version history',
      propsTitle: 'Page properties',
      propsTags: 'Tags',
      propsTagPlaceholder: 'Type a tag and press Enter',
      removeTag: 'Remove tag',
      propsAliases: 'Aliases',
      propsHint: 'Separate values with commas',
      propsOther: 'Other fields',
      propsNewKey: 'Field name',
      propsNewValue: 'Value',
      propsAddField: 'Add field',
      propsInvalidKey: 'A field name may only contain letters, digits, underscores and dashes',
      save: 'Save',
      fontLarger: 'Larger text',
      fontSmaller: 'Smaller text',
      typeTitle: 'Font',
      fontDefault: 'Default (system sans)',
      fontInter: 'Inter',
      fontSourceHan: 'Source Han Sans / Noto Sans',
      fontYahei: 'Microsoft YaHei',
      fontSerif: 'Serif (Songti)',
      fontKaiti: 'Kaiti',
      fontWenkai: 'LXGW WenKai',
      fontMono: 'Monospace',
      fontMissing: 'Not installed, falls back',
      fontCustomHint: 'Custom font-family, e.g. "LXGW WenKai", serif',
      apply: 'Apply',
      fontScaleLabel: 'Text size',
      readingMode: 'Reading mode',
      exitReading: 'Exit reading mode',
      templateTitle: 'Choose a template',
      templateFromVault: 'From the 模板/ folder',
      templateVaultEmpty: 'Put template notes in the vault\'s 模板/ folder to see them here',
      templateBlank: 'Blank note',
      templateMeeting: 'Meeting notes',
      templateDaily: 'Daily log',
      templateProject: 'Project plan',
      templateReading: 'Reading notes',
      templateBlankBody: '',
      templateMeetingBody:
        '## Attendees\n\n- \n\n## Agenda\n\n- \n\n## Decisions\n\n- \n\n## Action items\n\n- [ ] \n',
      templateDailyBody:
        '## What I did today\n\n- \n\n## Problems\n\n- \n\n## Plan for tomorrow\n\n- \n',
      templateProjectBody: '## Goal\n\n- \n\n## Milestones\n\n- [ ] \n\n## Risks\n\n- \n',
      templateReadingBody: '## Key points\n\n- \n\n## My thoughts\n\n- \n\n## Quotes\n\n> \n',
      templateCollection: 'Database page',
      templateCollectionBody:
        '---\ntype: collection\nview: table\ngroupBy: status\n---\n\nThis page summarizes notes in this folder as table / board views. Edit type, view, groupBy, source or columns in page properties.',
      historyEmpty: 'No history yet — it appears after the first save',
      historyPreview: 'History preview',
      diffHint: 'Compared with the current note: red lines disappear after restore, green lines come back',
      diffSkipped: 'unchanged lines',
      diffNone: 'This version is identical to the current note',
      historyRestored: 'History version restored',
      restore: 'Restore this version',
      expandAll: 'Show all',
      collapseAll: 'Collapse',
      close: 'Close',
      scSave: 'Save',
      scZen: 'Zen mode (distraction-free)',
      scQuickOpen: 'Quick open a note',
      scUndo: 'Undo / redo',
      scRedo: 'Redo',
      scBold: 'Bold / italic',
      scEnter: 'New block / line break',
      scSlash: 'Insert menu',
      scMultiSelect: 'Select blocks',
      scCopy: 'Copy / cut blocks',
      scTab: 'Next table cell',
      deleteTitle: 'Delete note',
      deleteBody: 'The note moves to the vault .trash folder; it is not permanently deleted.',
      cancel: 'Cancel',
      confirm: 'Delete',
      loadError: 'Could not load',
      typeText: 'Text',
      typeHeading1: 'Heading 1',
      typeHeading2: 'Heading 2',
      typeHeading3: 'Heading 3',
      typeBullet: 'Bulleted list',
      typeNumbered: 'Numbered list',
      typeTodo: 'To-do',
      typeQuote: 'Quote',
      typeCode: 'Code',
      typeDivider: 'Divider',
      typeTable: 'Table',
      typeCallout: 'Callout',
      typeToggle: 'Toggle list',
      expandToggle: 'Expand',
      collapseToggle: 'Collapse',
      typeImage: 'Image',
      imageUrl: 'Image URL',
      codeLanguage: 'Language',
      codeLanguagePlain: 'Plain text',
      deleteBlock: 'Delete block',
      extractPage: 'Turn into page',
      extractPageDone: 'Sub-page created: {name}',
      copyBlockLink: 'Copy block link',
      copyLinkDone: 'Copied: {link}',
      moveUp: 'Move up',
      moveDown: 'Move down',
      blockMenu: 'Block actions',
      blockOptions: 'Block options',
      placeholderTitle: 'Title',
      placeholderText: 'Type something, or press "/" for a type',
      wideMode: 'Switch to full width',
      narrowMode: 'Switch to default width',
      noBlocks: 'Empty page',
      addIcon: 'Add icon',
      addCover: 'Add cover',
      imageAlt: 'Alt text',
      imageDone: 'Done',
      blocksCount: 'blocks',
      imageRemove: 'Remove image',
      removeCover: 'Remove cover',
      coverPlaceholder: 'Image URL, or a vault-relative path',
      coverInvalid: 'A cover needs an http(s) image URL or a path ending in an image extension',
      changeIcon: 'Change icon',
      removeIcon: 'Remove icon',
      collapseHeading: 'Collapse / expand',
      tableRow: 'row',
      tableCol: 'column',
      moveRow: 'Drag to reorder rows',
      moveColumn: 'Drag to reorder columns',
      fmtBold: 'Bold',
      fmtItalic: 'Italic',
      fmtStrike: 'Strikethrough',
      fmtCode: 'Inline code',
      fmtLink: 'Link',
      linkPlaceholder: 'Paste or type a link',
      linkOpen: 'Open',
      linkRemove: 'Remove link',
      wikiNotFound: 'Note not found: {name}',
      linksTitle: 'Links',
      backlinks: 'Backlinks',
      outlinks: 'Outgoing links',
      noBacklinks: 'No note links here yet',
      noOutlinks: 'This note links nowhere yet',
      embedTag: 'embed',
      mentions: 'Mentions',
      collectionTable: 'Table',
      collectionBoard: 'Board',
      collectionFilter: 'Filter notes…',
      collectionRows: 'rows',
      collectionEmpty: 'No notes here, or none have properties yet',
      collectionUncategorized: 'Uncategorized',
      collectionName: 'Name',
      collectionSort: 'Click to sort',
      collectionSource: 'Source',
      collectionNewRow: 'New row',
      collectionEditCell: 'Click to edit',
      collectionSaved: 'Saved',
      collectionRowCreated: 'Row created — click it to fill its properties',
      refresh: 'Refresh',
      favorites: 'Favorites',
      recent: 'Recent',
      addFavorite: 'Add to favorites',
      removeFavorite: 'Remove from favorites',
      quickOpenPlaceholder: 'Quick open a note…',
      linkIt: 'Link',
      graphTitle: 'Graph',
      aiTitle: 'AI writing assistant',
      aiPageTitle: 'AI summary & tags',
      aiRewrite: 'Rewrite',
      aiContinue: 'Continue',
      aiPolish: 'Polish',
      aiTranslate: 'Translate',
      aiSummary: 'Summary',
      aiTags: 'Tags',
      aiGenerate: 'Generate',
      aiGenerating: 'Generating…',
      aiReplace: 'Replace block',
      aiInsertBelow: 'Insert below',
      aiInsertTop: 'Insert at top',
      aiAgent: 'Agent',
      aiRun: 'Run',
      aiAgentPlaceholder: 'Describe the task, e.g. restructure this note into sections and add 3 summary points',
      copy: 'Copy',
      copied: 'Copied',
      graphEmpty: 'This note has no links yet',
      typeNoteLink: 'Note link',
      typeTemplateButton: 'Template button',
      templateButtonLabel: 'New page',
      notePickerTitle: 'Insert note link',
      notePickerPlaceholder: 'Search notes…',
      notePickerEmpty: 'No matching notes',
      linkConfirm: 'Apply',
      linkCancel: 'Cancel',
      linkInvalid: 'A link must start with http://, https:// or mailto:',
      fmtClear: 'Clear formatting',
    }

    const CSS = `
.nb-root {
  --nb-surface: var(--dsw-alias-bg-base);
  --nb-panel: var(--dsw-alias-bg-module-platform);
  --nb-card: var(--dsw-alias-button-floating-fill, #fff);
  --nb-hover: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, .06));
  --nb-active: var(--dsw-alias-interactive-bg-active, rgba(38, 49, 72, .1));
  --nb-line: var(--dsw-alias-border-l1);
  --nb-line-2: var(--dsw-alias-border-l2);
  --nb-text: var(--dsw-alias-label-primary);
  --nb-text-2: var(--dsw-alias-label-secondary);
  --nb-text-3: var(--dsw-alias-label-tertiary);
  --nb-accent: var(--dsw-alias-link, var(--dsw-alias-state-business-primary));
  --nb-accent-soft: color-mix(in srgb, var(--nb-accent) 12%, transparent);
  --nb-accent-ring: color-mix(in srgb, var(--nb-accent) 32%, transparent);
  --nb-radius-s: 6px;
  --nb-radius-m: 8px;
  --nb-radius-l: 12px;
  --nb-shadow-1: 0 1px 2px rgba(16, 24, 40, .06), 0 1px 3px rgba(16, 24, 40, .04);
  --nb-shadow-2: 0 12px 32px rgba(16, 24, 40, .14), 0 2px 8px rgba(16, 24, 40, .06);
  --nb-ease: cubic-bezier(.2, .8, .2, 1);
  display: flex;
  height: 100%;
  min-height: 0;
  background: var(--nb-surface);
  color: var(--nb-text);
  font-family: ui-sans-serif, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  -webkit-font-smoothing: antialiased;
  font-synthesis: none;
}
.nb-root ::selection { background: color-mix(in srgb, var(--nb-accent) 22%, transparent); }
.nb-root mark { background: color-mix(in srgb, var(--nb-accent) 16%, transparent); color: inherit; border-radius: 4px; padding: 0 2px; }
.nb-root input:focus-visible, .nb-root button:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--nb-accent-ring); }
.nb-root *::-webkit-scrollbar { width: 9px; height: 9px; }
.nb-root *::-webkit-scrollbar-thumb { background: var(--dsw-alias-scrollbar-bg-l1, #e5e5e5); border-radius: 999px; border: 2px solid transparent; background-clip: content-box; }
.nb-root *::-webkit-scrollbar-thumb:hover { background: var(--dsw-alias-scrollbar-hover-l1, #d4d4d4); background-clip: content-box; }
.nb-root *::-webkit-scrollbar-track { background: transparent; }

/* ── Sidebar ───────────────────────────────────────────── */
.nb-side { width: 248px; flex: 0 0 248px; display: flex; flex-direction: column; min-height: 0; background: var(--nb-panel); border-right: 1px solid var(--nb-line); }
/* Breadcrumb */
.nb-breadcrumb { display: flex; align-items: center; gap: 2px; flex-wrap: wrap; padding: 2px 0 8px; font-size: 12px; color: var(--nb-text-3); }
.nb-breadcrumb button { border: none; background: transparent; color: var(--nb-text-3); font-size: 12px; padding: 1px 4px; border-radius: 4px; cursor: pointer; }
.nb-breadcrumb button:hover { background: var(--nb-hover); color: var(--nb-text); }
.nb-breadcrumb-current { padding: 1px 4px; color: var(--nb-text); font-weight: 500; }
.nb-breadcrumb-sep { color: var(--nb-text-3); opacity: .55; }
.nb-root.zen .nb-breadcrumb { display: none; }
.nb-side-top { padding: 14px 12px 8px; display: flex; flex-direction: column; gap: 6px; flex: 0 0 auto; }
.nb-search { width: 100%; box-sizing: border-box; height: 32px; border: 1px solid var(--nb-line); border-radius: var(--nb-radius-s); background: var(--nb-card); color: var(--nb-text); padding: 0 11px; font-size: 12.5px; outline: none; transition: border-color .14s var(--nb-ease), box-shadow .14s var(--nb-ease); }
.nb-search::placeholder { color: var(--nb-text-3); }
.nb-search:hover { border-color: var(--nb-line-2); }
.nb-search:focus { border-color: var(--nb-accent); box-shadow: 0 0 0 3px var(--nb-accent-ring); }
.nb-new { display: flex; align-items: center; gap: 7px; width: 100%; border: none; background: transparent; color: var(--nb-text); font-size: 13px; font-weight: 500; padding: 6px 8px; border-radius: var(--nb-radius-s); cursor: pointer; text-align: left; transition: background .14s var(--nb-ease); }
.nb-new:hover { background: var(--nb-hover); }
.nb-new-folder { height: 26px; font-size: 12px; font-weight: 400; color: var(--nb-text-2); }
.nb-new-folder:hover { color: var(--nb-text); }
.nb-new-plus { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 5px; border: 1px solid var(--nb-line-2); background: var(--nb-card); color: var(--nb-text-2); font-size: 13px; line-height: 1; }
.nb-quick { flex: 0 0 auto; padding: 0 8px 8px; border-bottom: 1px solid var(--nb-line); }
.nb-quick-group { margin-top: 6px; }
.nb-quick-title { padding: 2px 4px 3px; font-size: 10.5px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--nb-text-3); }
.nb-quick-item { display: block; width: 100%; border: none; background: transparent; color: var(--nb-text); font-size: 12.5px; padding: 3px 8px; border-radius: var(--nb-radius-s); cursor: pointer; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nb-quick-item:hover { background: var(--nb-hover); }
.nb-quick-open { position: absolute; inset: 0; z-index: 95; display: flex; justify-content: center; align-items: flex-start; padding: 12vh 24px 24px; background: color-mix(in srgb, var(--dsw-alias-bg-mask-1, #0000003d) 60%, transparent); backdrop-filter: blur(2px); }
.nb-quick-card { width: min(560px, 94%); box-sizing: border-box; padding: 10px; background: var(--nb-card); border: 1px solid var(--nb-line); border-radius: var(--nb-radius-l); box-shadow: 0 24px 64px rgba(16, 24, 40, .2); animation: nb-pop .16s var(--nb-ease); }
.nb-quick-input { width: 100%; box-sizing: border-box; height: 40px; font-size: 14px; }
.nb-quick-list { max-height: 320px; overflow: auto; margin-top: 8px; display: flex; flex-direction: column; gap: 2px; }
.nb-quick-row { display: flex; align-items: baseline; gap: 8px; width: 100%; border: none; background: transparent; color: var(--nb-text); font-size: 13px; padding: 7px 10px; border-radius: var(--nb-radius-s); cursor: pointer; text-align: left; }
.nb-quick-row.on, .nb-quick-row:hover { background: var(--nb-accent-soft); color: var(--nb-accent); }
.nb-quick-row-name { flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nb-quick-row-path { margin-left: auto; flex: 0 0 auto; font-size: 11px; color: var(--nb-text-3); }
.nb-tree { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 4px 8px 24px; }
.nb-group { margin-top: 8px; }
.nb-group-title { display: flex; align-items: center; gap: 5px; padding: 4px 7px; border-radius: var(--nb-radius-s); font-size: 11.5px; font-weight: 600; letter-spacing: .01em; color: var(--nb-text-2); cursor: pointer; user-select: none; white-space: nowrap; overflow: hidden; transition: background .14s var(--nb-ease); }
.nb-group-title:hover { background: var(--nb-hover); color: var(--nb-text); }
.nb-group-count { margin-left: auto; padding: 1px 6px; border-radius: 999px; background: color-mix(in srgb, var(--nb-panel) 50%, var(--nb-hover)); font-size: 10px; font-weight: 500; color: var(--nb-text-3); }
.nb-note { display: flex; align-items: center; gap: 6px; width: 100%; box-sizing: border-box; border: none; background: transparent; color: var(--nb-text); font-size: 13.5px; padding: 6px 8px; border-radius: var(--nb-radius-s); cursor: pointer; text-align: left; white-space: nowrap; overflow: hidden; transition: background .14s var(--nb-ease); }
.nb-note:hover { background: var(--nb-hover); }
.nb-note.on { position: relative; background: var(--nb-accent-soft); font-weight: 600; }
.nb-note.on::before { content: ''; position: absolute; left: 0; top: 6px; bottom: 6px; width: 2.5px; border-radius: 2px; background: var(--nb-accent); }
.nb-note-name { overflow: hidden; text-overflow: ellipsis; }
.nb-hit { display: block; width: 100%; box-sizing: border-box; border: none; background: transparent; color: var(--nb-text); text-align: left; padding: 6px 8px; border-radius: var(--nb-radius-s); cursor: pointer; overflow: hidden; transition: background .14s var(--nb-ease); }
.nb-hit:hover { background: var(--nb-hover); }
.nb-hit-name { display: block; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nb-hit-line { display: block; margin-top: 1px; font-size: 11px; color: var(--nb-text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nb-side-empty { padding: 14px 10px; font-size: 12px; color: var(--nb-text-3); line-height: 1.7; }

/* ── Outline ───────────────────────────────────────────── */
.nb-outline { flex: 0 0 auto; max-height: 190px; overflow: auto; padding: 6px 8px 10px; border-bottom: 1px solid var(--nb-line); }
.nb-outline-title { padding: 2px 7px 5px; font-size: 10.5px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--nb-text-3); }
.nb-outline-list { display: flex; flex-direction: column; gap: 1px; }
.nb-outline-item { border: none; background: transparent; color: var(--nb-text-2); font-size: 12px; text-align: left; padding: 4px 7px; border-radius: 5px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: background .14s var(--nb-ease), color .14s var(--nb-ease); }
.nb-outline-item:hover { background: var(--nb-hover); color: var(--nb-text); }
.nb-outline-item.on { background: var(--nb-accent-soft); color: var(--nb-accent); font-weight: 600; }

/* ── Main column & topbar ──────────────────────────────── */
.nb-main { position: relative; flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.nb-topbar { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; height: 46px; padding: 0 16px 0 18px; box-sizing: border-box; border-bottom: 1px solid var(--nb-line); background: var(--nb-surface); }
.nb-crumb { min-width: 0; font-size: 12px; color: var(--nb-text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nb-tabs { display: flex; align-items: center; gap: 3px; min-width: 0; overflow-x: auto; flex: 1 1 auto; }
.nb-tabs::-webkit-scrollbar { height: 0; }
.nb-tab { display: inline-flex; align-items: center; gap: 4px; max-width: 200px; padding: 5px 8px; border-radius: var(--nb-radius-s); border: 1px solid transparent; font-size: 12.5px; color: var(--nb-text-2); cursor: pointer; white-space: nowrap; flex: 0 0 auto; transition: background .14s var(--nb-ease), color .14s var(--nb-ease); }
.nb-tab:hover { background: var(--nb-hover); color: var(--nb-text); }
.nb-tab.on { background: var(--nb-card); border-color: var(--nb-line); color: var(--nb-text); font-weight: 600; box-shadow: var(--nb-shadow-1); }
.nb-tab-name { overflow: hidden; text-overflow: ellipsis; }
.nb-tab-close { border: none; background: transparent; color: var(--nb-text-3); cursor: pointer; font-size: 13px; line-height: 1; padding: 1px 3px; border-radius: 4px; opacity: 0; transition: opacity .12s, background .12s; }
.nb-tab:hover .nb-tab-close, .nb-tab.on .nb-tab-close { opacity: 1; }
.nb-tab-close:hover { background: var(--nb-active); color: var(--nb-text); }
.nb-save { margin-left: auto; font-size: 11.5px; color: var(--nb-text-3); white-space: nowrap; }
.nb-save.error { color: var(--dsw-alias-state-error-primary); }
.nb-icon-btn { width: 28px; height: 28px; border: none; border-radius: var(--nb-radius-s); background: transparent; color: var(--nb-text-2); cursor: pointer; font-size: 15px; line-height: 1; display: inline-flex; align-items: center; justify-content: center; transition: background .14s var(--nb-ease), color .14s var(--nb-ease); }
.nb-icon-btn:hover { background: var(--nb-hover); color: var(--nb-text); }
.nb-notice { flex: 0 0 auto; margin: 8px 18px 0; padding: 8px 12px; border-radius: var(--nb-radius-s); font-size: 12px; background: var(--dsw-alias-state-error-tertiary, var(--nb-hover)); color: var(--dsw-alias-state-error-primary); border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 18%, transparent); }
.nb-scroll { flex: 1 1 auto; min-height: 0; overflow: auto; }
.nb-doc { max-width: 720px; margin: 0 auto; padding: 36px 60px 40vh; }
.nb-doc.full { max-width: none; padding-left: 8vw; padding-right: 8vw; }

/* ── Page header: icon / cover / title ─────────────────── */
.nb-icon-row { position: relative; padding: 6px 0 2px; }
.nb-cover { position: relative; height: 200px; margin: 0 0 12px; border-radius: var(--nb-radius-l); background-size: cover; background-position: center; background-color: var(--nb-panel); }
.nb-cover-remove { position: absolute; top: 8px; right: 8px; width: 26px; height: 26px; border: none; border-radius: var(--nb-radius-s); background: rgba(0, 0, 0, .45); color: #fff; font-size: 15px; line-height: 1; cursor: pointer; opacity: 0; transition: opacity .12s; }
.nb-cover:hover .nb-cover-remove { opacity: 1; }
.nb-cover-add { width: 100%; height: 32px; margin-bottom: 8px; box-sizing: border-box; border: 1px dashed var(--nb-line-2); border-radius: var(--nb-radius-m); background: transparent; color: var(--nb-text-3); font-size: 12px; cursor: pointer; opacity: 0; transition: opacity .14s; }
.nb-doc:hover .nb-cover-add { opacity: .85; }
.nb-cover-add:hover { opacity: 1; color: var(--nb-text); border-color: var(--nb-accent); }
.nb-cover-panel { display: flex; gap: 6px; align-items: center; margin-bottom: 10px; }
.nb-page-icon { border: none; background: transparent; font-size: 46px; line-height: 1; padding: 0; cursor: pointer; border-radius: var(--nb-radius-m); transition: background .14s var(--nb-ease); }
.nb-page-icon:hover { background: var(--nb-hover); }
.nb-icon-add { display: inline-flex; align-items: center; gap: 4px; border: none; background: transparent; color: var(--nb-text-3); font-size: 12.5px; padding: 4px 8px; margin-left: -8px; border-radius: var(--nb-radius-s); cursor: pointer; transition: background .14s var(--nb-ease), color .14s var(--nb-ease); }
.nb-icon-add:hover { background: var(--nb-hover); color: var(--nb-text); }
.nb-icon-panel { position: absolute; z-index: 45; top: 100%; left: 0; margin-top: 6px; width: 308px; padding: 10px; background: var(--nb-card); border: 1px solid var(--nb-line); border-radius: var(--nb-radius-l); box-shadow: var(--nb-shadow-2); animation: nb-pop .14s var(--nb-ease); }
.nb-icon-grid { display: grid; grid-template-columns: repeat(9, 1fr); gap: 2px; }
.nb-icon-choice { border: none; background: transparent; font-size: 20px; padding: 5px 0; border-radius: var(--nb-radius-s); cursor: pointer; transition: background .12s; }
.nb-icon-choice:hover { background: var(--nb-hover); }
.nb-icon-remove { width: 100%; margin-top: 8px; border: none; background: transparent; color: var(--nb-text-2); font-size: 12px; padding: 7px; border-radius: var(--nb-radius-s); cursor: pointer; text-align: left; transition: background .12s; }
.nb-icon-remove:hover { background: var(--nb-hover); color: var(--nb-text); }
.nb-title { font-size: 2.5em; font-weight: 700; line-height: 1.16; letter-spacing: -.03em; outline: none; padding: 2px 0 10px; white-space: pre-wrap; word-break: break-word; }
.nb-title:empty::before { content: attr(data-placeholder); color: var(--nb-text-3); opacity: .7; }

/* ── Blocks ────────────────────────────────────────────── */
.nb-blocks { display: flex; flex-direction: column; gap: 3px; }
.nb-block { position: relative; display: flex; align-items: flex-start; gap: 2px; }
.nb-block.selected > .nb-b { background: var(--nb-accent-soft); }
.nb-block.dragging { opacity: .45; }
.nb-block.drop-before::before { content: ''; position: absolute; left: -4px; right: -4px; top: -2px; height: 2px; border-radius: 1px; background: var(--nb-accent); pointer-events: none; }
.nb-block.drop-after::after { content: ''; position: absolute; left: -4px; right: -4px; bottom: -2px; height: 2px; border-radius: 1px; background: var(--nb-accent); pointer-events: none; }
.nb-gutter { position: absolute; left: -74px; width: 74px; justify-content: flex-end; top: 2px; display: flex; align-items: center; gap: 1px; opacity: 0; transition: opacity .12s; }
.nb-block:hover .nb-gutter, .nb-block.menu-open .nb-gutter { opacity: 1; }
.nb-gutter-btn { width: 24px; height: 24px; border: none; border-radius: 5px; background: transparent; color: var(--nb-text-3); cursor: pointer; font-size: 13px; line-height: 1; display: inline-flex; align-items: center; justify-content: center; transition: background .12s, color .12s; }
.nb-gutter-btn:hover { background: var(--nb-hover); color: var(--nb-text); }
.nb-gutter-right { position: absolute; right: -38px; top: 2px; display: flex; align-items: center; opacity: 0; transition: opacity .12s var(--nb-ease); }
.nb-block:hover .nb-gutter-right, .nb-block.menu-open .nb-gutter-right { opacity: 1; }
.nb-root.reading .nb-gutter-right { display: none; }
.nb-b { flex: 1 1 auto; min-width: 0; outline: none; padding: 4px 6px; margin: 0 -6px; font-size: 1em; line-height: 1.65; white-space: pre-wrap; word-break: break-word; cursor: text; border-radius: 4px; transition: background .12s var(--nb-ease); }
.nb-block:hover > .nb-b:not(.nb-b-code):not(.nb-b-callout) { background: var(--nb-hover); }
.nb-b-render { cursor: text; }
.nb-b-edit { cursor: text; min-height: 1.65em; }
.nb-b-edit:empty::before { content: attr(data-placeholder); color: var(--nb-text-3); opacity: .8; }
.nb-b-edit.nb-b-h1 { min-height: 1.3em; }
.nb-b-edit.nb-b-h2 { min-height: 1.35em; }
.nb-b-edit.nb-b-h3 { min-height: 1.4em; }

/* headings */
.nb-b-h1 { font-size: 2.25em; font-weight: 700; line-height: 1.2; letter-spacing: -.02em; padding: 30px 6px 4px; }
.nb-b-h2 { font-size: 1.5em; font-weight: 600; line-height: 1.3; letter-spacing: -.012em; padding: 22px 6px 3px; }
.nb-b-h3 { font-size: 1.25em; font-weight: 600; line-height: 1.35; padding: 16px 6px 2px; }

/* lists & inline */
.nb-b-bullet, .nb-b-numbered { display: block; }
.nb-prefix { flex: 0 0 auto; min-width: 22px; font-size: 15px; line-height: 1.65; color: var(--nb-text-3); user-select: none; display: inline-flex; align-items: flex-start; justify-content: flex-start; padding: 4px 0; }
.nb-prefix-dot::before { content: '•'; }
.nb-prefix-num { color: var(--nb-text-3); font-variant-numeric: tabular-nums; }
.nb-b-quote { border-left: 3px solid var(--nb-line-2); padding-left: 14px; color: var(--nb-text-2); }
.nb-b code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .875em; background: var(--dsw-alias-markdown-inline-code, var(--nb-hover)); border-radius: 5px; padding: 2px 5px; }
.nb-b a { color: var(--nb-accent); text-decoration: none; }
.nb-b a:hover { text-decoration: underline; }
.nb-b strong { font-weight: 650; }
.nb-b img, .nb-b .nb-img { max-width: 100%; height: auto; border-radius: var(--nb-radius-m); display: block; margin: 10px 0; box-shadow: var(--nb-shadow-1); }
.nb-wiki { color: var(--nb-accent); cursor: pointer; }
.nb-wiki:hover { text-decoration: underline; }
.nb-ph { color: var(--nb-text-3); opacity: .7; }
.nb-b-done { color: var(--nb-text-3); text-decoration: line-through; text-decoration-color: var(--nb-text-3); }
.nb-divider-line { width: 100%; border: none; border-top: 1px solid var(--nb-line-2); margin: 18px 0; }

/* checkboxes */
.nb-check { flex: 0 0 auto; width: 18px; height: 18px; margin: 5px 9px 0 1px; padding: 0; border: 1.5px solid var(--nb-line-2); border-radius: 4px; background: var(--nb-card); cursor: pointer; position: relative; transition: background .12s, border-color .12s; }
.nb-check:hover { border-color: var(--nb-accent); }
.nb-check.on { background: var(--nb-accent); border-color: var(--nb-accent); }
.nb-check.on::after { content: ''; position: absolute; left: 4.5px; top: 1.5px; width: 4px; height: 8px; border: solid #fff; border-width: 0 1.6px 1.6px 0; transform: rotate(42deg); }
.nb-check-row { display: flex; align-items: flex-start; }
.nb-check-row .nb-b { padding-left: 2px; }

/* code block */
.nb-b-code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.84em; line-height: 1.65; background: var(--dsw-alias-markdown-code-block, var(--nb-panel)); border: 1px solid var(--nb-line); border-radius: var(--nb-radius-m); padding: 14px 16px; margin: 6px 0; white-space: pre-wrap; }
.nb-b-code .c-comment { color: var(--nb-text-3); font-style: italic; }
.nb-b-code .c-string { color: var(--dsw-alias-state-success-primary); }
.nb-b-code .c-number { color: var(--dsw-alias-state-warn-primary); }
.nb-b-code .c-keyword { color: var(--nb-accent); }
.nb-code-lang-wrap { position: absolute; top: 10px; right: 12px; z-index: 5; }
.nb-code-lang { border: none; background: var(--nb-card); color: var(--nb-text-3); font-size: 10.5px; padding: 3px 8px; border-radius: 5px; cursor: pointer; opacity: 0; transition: opacity .12s; box-shadow: var(--nb-shadow-1); }
.nb-block:hover .nb-code-lang { opacity: 1; }
.nb-code-lang-menu { position: absolute; right: 0; top: 100%; margin-top: 6px; max-height: 220px; overflow: auto; background: var(--nb-card); border: 1px solid var(--nb-line); border-radius: var(--nb-radius-m); padding: 4px; min-width: 130px; box-shadow: var(--nb-shadow-2); animation: nb-pop .14s var(--nb-ease); }
.nb-code-lang-item { display: block; width: 100%; text-align: left; border: none; background: transparent; color: var(--nb-text); font-size: 12px; padding: 5px 8px; border-radius: 5px; cursor: pointer; }
.nb-code-lang-item:hover, .nb-code-lang-item.on { background: var(--nb-hover); }

/* callout & toggle */
.nb-type-callout { background: var(--nb-panel); border: 1px solid var(--nb-line); border-radius: var(--nb-radius-m); padding: 8px 12px 8px 6px; margin: 8px 0; }
.nb-callout-icon { flex: 0 0 auto; padding: 4px 8px 0; font-size: 16px; line-height: 1.4; }
.nb-b-callout { padding: 3px 4px; }
.nb-type-toggle .nb-b { font-weight: 600; }
.nb-toggle-arrow { flex: 0 0 auto; width: 22px; height: 30px; padding: 0; border: none; border-radius: 5px; background: transparent; color: var(--nb-text-3); font-size: 12px; line-height: 1; cursor: pointer; transition: background .12s, color .12s; }
.nb-toggle-arrow:hover { background: var(--nb-hover); color: var(--nb-text); }

/* add button */
.nb-add { display: flex; align-items: center; gap: 6px; width: 100%; border: none; background: transparent; color: var(--nb-text-3); font-size: 13px; padding: 16px 6px 6px; cursor: text; text-align: left; border-radius: var(--nb-radius-s); transition: color .14s; }
.nb-add:hover { color: var(--nb-text); }

/* ── Table ─────────────────────────────────────────────── */
.nb-table-wrap { margin: 10px 0; }
.nb-table { width: 100%; border-collapse: collapse; table-layout: fixed; border-radius: var(--nb-radius-m); }
.nb-table th, .nb-table td { border: 1px solid var(--nb-line-2); padding: 0; }
.nb-table th { position: relative; }
.nb-table td { position: relative; }
.nb-table th .nb-col-handle { position: absolute; left: 2px; top: 50%; transform: translateY(-50%); width: 16px; font-size: 10px; line-height: 1; color: var(--nb-text-3); cursor: grab; opacity: 0; user-select: none; z-index: 3; }
.nb-table th:hover .nb-col-handle { opacity: 1; }
.nb-table th.drag-over { outline: 2px solid var(--nb-accent); outline-offset: -2px; }
.nb-table-row .nb-row-handle { position: absolute; left: -22px; top: 50%; transform: translateY(-50%); width: 18px; font-size: 10px; line-height: 1; color: var(--nb-text-3); cursor: grab; opacity: 0; user-select: none; }
.nb-table-row:hover .nb-row-handle { opacity: 1; }
.nb-table-row.drag-over { outline: 2px solid var(--nb-accent); outline-offset: -2px; }
.nb-table-row:hover td { background: var(--nb-hover); }
.nb-col-resize { position: absolute; top: 0; right: -3px; z-index: 2; width: 6px; height: 100%; cursor: col-resize; opacity: 0; transition: opacity .1s; }
.nb-table th:hover .nb-col-resize { opacity: 1; background: var(--nb-accent); }
.nb-cell { min-height: 36px; padding: 7px 10px; font-size: 0.875em; line-height: 1.55; outline: none; white-space: pre-wrap; word-break: break-word; }
.nb-table thead .nb-cell { background: var(--nb-panel); font-weight: 600; }
.nb-table-actions { display: flex; gap: 4px; margin-top: 6px; opacity: 0; transition: opacity .14s; }
.nb-table-wrap:hover .nb-table-actions { opacity: 1; }
.nb-table-actions button { border: none; background: transparent; color: var(--nb-text-3); font-size: 11.5px; padding: 3px 8px; border-radius: 5px; cursor: pointer; transition: background .12s, color .12s; }
.nb-table-actions button:hover { background: var(--nb-hover); color: var(--nb-text); }

/* ── Overlays: ghost, menus, toolbars, dialogs ─────────── */
.nb-ghost { position: fixed; z-index: 70; pointer-events: none; max-width: 380px; padding: 8px 12px; background: var(--nb-card); border: 1px solid var(--nb-line-2); border-radius: var(--nb-radius-m); box-shadow: var(--nb-shadow-2); color: var(--nb-text); font-size: 14px; line-height: 1.5; opacity: .94; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.nb-find { position: absolute; top: 52px; right: 18px; z-index: 50; display: flex; align-items: center; gap: 4px; padding: 5px 7px; background: var(--nb-card); border: 1px solid var(--nb-line); border-radius: var(--nb-radius-m); box-shadow: var(--nb-shadow-2); animation: nb-pop .14s var(--nb-ease); }
.nb-find-input { width: 180px; height: 28px; }
.nb-find-count { min-width: 22px; text-align: center; font-size: 11.5px; color: var(--nb-text-3); }
.nb-img-bar { position: fixed; z-index: 82; display: flex; align-items: center; gap: 4px; padding: 6px 8px; background: var(--nb-card); border: 1px solid var(--nb-line); border-radius: var(--nb-radius-m); box-shadow: var(--nb-shadow-2); animation: nb-pop .14s var(--nb-ease); }
.nb-img-bar-input { width: 150px; height: 26px; box-sizing: border-box; border: 1px solid var(--nb-line-2); border-radius: 5px; background: var(--nb-surface); color: var(--nb-text); padding: 0 8px; font-size: 12px; outline: none; }
.nb-img-bar-input:focus { border-color: var(--nb-accent); box-shadow: 0 0 0 3px var(--nb-accent-ring); }
.nb-img-bar-btn { border: none; background: transparent; color: var(--nb-text-2); font-size: 12px; padding: 4px 8px; border-radius: 5px; cursor: pointer; transition: background .12s, color .12s; }
.nb-img-bar-btn:hover { background: var(--nb-hover); color: var(--nb-text); }
.nb-img-bar-btn.on { background: var(--nb-active); color: var(--nb-text); font-weight: 600; }
.nb-img-bar-btn.danger { color: var(--dsw-alias-state-error-primary); }
.nb-note-menu { position: fixed; z-index: 60; min-width: 158px; padding: 4px; border: 1px solid var(--nb-line); border-radius: var(--nb-radius-m); background: var(--nb-card); box-shadow: var(--nb-shadow-2); animation: nb-pop .14s var(--nb-ease); }
.nb-menu { position: absolute; z-index: 40; left: 0; top: 100%; margin-top: 4px; min-width: 182px; padding: 4px; background: var(--nb-card); border: 1px solid var(--nb-line); border-radius: var(--nb-radius-m); box-shadow: var(--nb-shadow-2); animation: nb-pop .14s var(--nb-ease); }
.nb-menu-item { display: flex; align-items: center; gap: 8px; width: 100%; box-sizing: border-box; border: none; background: transparent; color: var(--nb-text); font-size: 13px; padding: 6px 8px; border-radius: 5px; cursor: pointer; text-align: left; transition: background .1s; }
.nb-menu-item:hover { background: var(--nb-hover); }
.nb-menu-item.on { background: var(--nb-active); font-weight: 600; }
.nb-menu-item.danger { color: var(--dsw-alias-state-error-primary); }
.nb-menu-icon { flex: 0 0 20px; width: 20px; text-align: center; font-size: 11px; color: var(--nb-text-3); }
.nb-menu-sep { height: 1px; margin: 4px 2px; background: var(--nb-line); }
.nb-menu-label { padding: 4px 8px 2px; font-size: 10.5px; font-weight: 600; letter-spacing: .04em; color: var(--nb-text-3); }
.nb-menu-empty { padding: 8px 10px; font-size: 12px; color: var(--nb-text-3); }
.nb-toolbar { position: fixed; z-index: 80; display: flex; gap: 2px; padding: 4px; background: var(--nb-card); border: 1px solid var(--nb-line); border-radius: var(--nb-radius-m); box-shadow: var(--nb-shadow-2); animation: nb-pop .14s var(--nb-ease); }
.nb-toolbar-btn { min-width: 28px; height: 28px; padding: 0 7px; border: none; border-radius: 5px; background: transparent; color: var(--nb-text); cursor: pointer; font-size: 13px; display: inline-flex; align-items: center; justify-content: center; transition: background .12s; }
.nb-toolbar-btn:hover { background: var(--nb-hover); }
.nb-toolbar-bold { font-weight: 700; }
.nb-toolbar-italic { font-style: italic; }
.nb-toolbar-strike { text-decoration: line-through; }
.nb-toolbar-code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; }
.nb-toolbar-input { width: 190px; height: 28px; box-sizing: border-box; border: 1px solid var(--nb-line-2); border-radius: 5px; background: var(--nb-surface); color: var(--nb-text); padding: 0 8px; font-size: 12.5px; outline: none; }
.nb-toolbar-input:focus { border-color: var(--nb-accent); box-shadow: 0 0 0 3px var(--nb-accent-ring); }
.nb-modal { position: absolute; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; padding: 24px; background: color-mix(in srgb, var(--dsw-alias-bg-mask-1, #0000003d) 70%, transparent); backdrop-filter: blur(2px); animation: nb-fade .14s var(--nb-ease); }
.nb-modal-card { width: min(440px, 100%); box-sizing: border-box; padding: 20px 22px; background: var(--nb-card); border: 1px solid var(--nb-line); border-radius: var(--nb-radius-l); box-shadow: 0 24px 64px rgba(16, 24, 40, .18), 0 4px 12px rgba(16, 24, 40, .08); display: flex; flex-direction: column; gap: 12px; animation: nb-pop .16s var(--nb-ease); }
.nb-modal-title { font-size: 15px; font-weight: 600; letter-spacing: -.005em; }
.nb-modal-text { font-size: 12.5px; color: var(--nb-text-2); line-height: 1.65; word-break: break-word; }
.nb-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }

/* buttons */
.nb-btn { border: 1px solid var(--nb-line-2); background: var(--nb-card); color: var(--nb-text); font-size: 12.5px; font-weight: 500; padding: 7px 14px; border-radius: var(--nb-radius-s); cursor: pointer; transition: background .14s var(--nb-ease), border-color .14s, box-shadow .14s; }
.nb-btn:hover { background: var(--nb-hover); border-color: var(--nb-line-2); }
.nb-btn:active { background: var(--nb-active); }
.nb-btn-primary, .nb-btn.nb-btn-primary { background: var(--dsw-alias-button-primary-fill, var(--nb-text)); border-color: transparent; color: var(--dsw-alias-label-primary-foreground, #fff); }
.nb-btn-primary:hover { background: var(--dsw-alias-button-primary-hover, #43454a); border-color: transparent; }
.nb-btn-danger { background: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); color: #fff; }
.nb-btn-danger:hover { background: var(--dsw-alias-state-error-secondary); border-color: var(--dsw-alias-state-error-secondary); }

/* empty state & loading */
.nb-empty { max-width: 760px; margin: 0 auto; padding: 16vh 64px 0; }
.nb-empty-title { font-size: 40px; font-weight: 700; letter-spacing: -.025em; line-height: 1.15; }
.nb-empty-text { margin-top: 12px; font-size: 14.5px; color: var(--nb-text-2); line-height: 1.7; }
.nb-empty-btn { margin-top: 22px; border: 1px solid var(--nb-line-2); background: var(--nb-card); color: var(--nb-text); font-size: 13px; font-weight: 500; padding: 8px 14px; border-radius: var(--nb-radius-s); cursor: pointer; box-shadow: var(--nb-shadow-1); transition: background .14s, border-color .14s; }
.nb-empty-btn:hover { background: var(--nb-hover); border-color: var(--nb-accent); }
.nb-loading { display: flex; align-items: center; justify-content: center; flex: 1 1 auto; color: var(--nb-text-3); font-size: 13px; }

/* ── Embeds ────────────────────────────────────────────── */
.nb-embed { margin: 8px 0; padding: 8px 14px; border-left: 2px solid var(--nb-line-2); background: var(--nb-panel); border-radius: 0 var(--nb-radius-m) var(--nb-radius-m) 0; }
.nb-embed-title { border: none; background: transparent; color: var(--nb-text-3); font-size: 10.5px; font-weight: 600; letter-spacing: .02em; cursor: pointer; padding: 0 0 4px; }
.nb-embed-title:hover { color: var(--nb-accent); }
.nb-embed-body { font-size: 0.94em; line-height: 1.65; }
.nb-embed-h1 { font-size: 1.3em; font-weight: 700; padding: 4px 0; }
.nb-embed-h2 { font-size: 1.16em; font-weight: 600; padding: 3px 0; }
.nb-embed-h3 { font-size: 1.04em; font-weight: 600; padding: 2px 0; }
.nb-embed-line { padding: 1px 0; }
.nb-embed-quote { border-left: 2px solid var(--nb-line-2); padding-left: 8px; color: var(--nb-text-2); margin: 2px 0; }
.nb-embed-code { background: var(--nb-surface); border-radius: var(--nb-radius-s); padding: 8px 10px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .85em; white-space: pre-wrap; margin: 4px 0; }
.nb-embed-hr { border: none; border-top: 1px solid var(--nb-line-2); margin: 6px 0; }
.nb-embed-loading, .nb-embed-error { font-size: .9em; color: var(--nb-text-3); }
.nb-embed-error { color: var(--dsw-alias-state-error-primary); }
.nb-embed-more { margin-top: 4px; border: none; background: transparent; color: var(--nb-accent); font-size: 11.5px; cursor: pointer; padding: 2px 0; }

/* ── Properties / tags / shortcuts ─────────────────────── */
.nb-shortcuts { display: flex; flex-direction: column; gap: 2px; }
.nb-shortcut { display: flex; align-items: baseline; gap: 12px; padding: 4px 2px; }
.nb-shortcut-keys { flex: 0 0 168px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; color: var(--nb-text); background: var(--nb-panel); border: 1px solid var(--nb-line); border-radius: 5px; padding: 2px 6px; }
.nb-shortcut-label { font-size: 12.5px; color: var(--nb-text-2); }
.nb-template-list { display: flex; flex-direction: column; gap: 5px; }
.nb-template-group { margin-top: 12px; padding: 4px 2px 2px; font-size: 10.5px; font-weight: 600; letter-spacing: .04em; color: var(--nb-text-3); text-transform: uppercase; }
.nb-template-item { width: 100%; box-sizing: border-box; border: 1px solid var(--nb-line); border-radius: var(--nb-radius-m); background: var(--nb-card); color: var(--nb-text); font-size: 13px; padding: 10px 13px; text-align: left; cursor: pointer; transition: border-color .14s, background .14s; }
.nb-template-item:hover { border-color: var(--nb-accent); background: var(--nb-hover); }
.nb-template-button { display: inline-flex; align-items: center; gap: 4px; margin: 4px 0; padding: 6px 12px; border: 1px dashed var(--nb-line-2); border-radius: var(--nb-radius-s); background: var(--nb-card); color: var(--nb-text); font-size: 13px; cursor: pointer; transition: border-color .14s, background .14s, color .14s; }
.nb-template-button:hover { border-color: var(--nb-accent); background: var(--nb-hover); color: var(--nb-accent); }
.nb-props-field { display: flex; flex-direction: column; gap: 5px; }
.nb-props-label { font-size: 11.5px; font-weight: 500; color: var(--nb-text-3); }
.nb-props-list { display: flex; flex-direction: column; gap: 3px; padding: 8px 0 2px; border-top: 1px solid var(--nb-line); max-height: 170px; overflow: auto; }
.nb-props-row { display: flex; gap: 8px; align-items: center; font-size: 12px; padding: 1px 0; }
.nb-props-key { flex: 0 0 96px; color: var(--nb-text-3); }
.nb-props-value { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nb-props-shortcuts { display: flex; gap: 6px; }
.nb-props-input { flex: 1 1 auto; height: 30px; font-size: 12px; }
.nb-tag-list { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
.nb-tag { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; background: var(--nb-accent-soft); color: var(--nb-accent); font-size: 12px; font-weight: 500; }
.nb-tag-x { border: none; background: transparent; color: inherit; opacity: .6; font-size: 12px; line-height: 1; cursor: pointer; padding: 0 1px; }
.nb-tag-x:hover { opacity: 1; color: var(--dsw-alias-state-error-primary); }
.nb-tag-input { flex: 1 1 130px; height: 28px; font-size: 12px; }
.nb-props-add { display: flex; gap: 6px; align-items: center; padding-top: 6px; }
.nb-type-card { width: min(560px, 100%); }
.nb-type-list { display: flex; flex-direction: column; gap: 3px; max-height: 46vh; overflow: auto; }
.nb-type-item { display: flex; align-items: baseline; gap: 10px; width: 100%; box-sizing: border-box; border: 1px solid var(--nb-line); border-radius: var(--nb-radius-m); background: var(--nb-card); color: var(--nb-text); padding: 8px 12px; cursor: pointer; text-align: left; transition: border-color .14s, background .14s; }
.nb-type-item:hover { border-color: var(--nb-accent); background: var(--nb-hover); }
.nb-type-item.on { border-color: var(--nb-accent); background: var(--nb-accent-soft); }
.nb-type-label { flex: 0 0 auto; font-size: 13px; font-weight: 500; }
.nb-type-sample { flex: 1 1 auto; font-size: 12.5px; color: var(--nb-text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nb-type-check { flex: 0 0 auto; color: var(--nb-accent); font-weight: 700; }
.nb-type-missing { flex: 0 0 auto; font-size: 10.5px; color: var(--nb-text-3); }
.nb-type-custom { display: flex; gap: 6px; align-items: center; }
.nb-type-custom .nb-input { flex: 1 1 auto; height: 32px; font-size: 12px; }
.nb-type-scale { display: flex; align-items: center; gap: 8px; }
.nb-type-scale-label { font-size: 11.5px; color: var(--nb-text-3); }
.nb-type-scale-value { min-width: 42px; text-align: center; font-size: 12px; color: var(--nb-text-2); font-variant-numeric: tabular-nums; }
.nb-input { box-sizing: border-box; border: 1px solid var(--nb-line-2); border-radius: var(--nb-radius-s); background: var(--nb-surface); color: var(--nb-text); padding: 0 9px; font-size: 12.5px; outline: none; transition: border-color .14s, box-shadow .14s; }
.nb-input:focus { border-color: var(--nb-accent); box-shadow: 0 0 0 3px var(--nb-accent-ring); }

/* ── History / diff ────────────────────────────────────── */
.nb-history { display: flex; flex-direction: column; gap: 2px; max-height: 320px; overflow: auto; }
.nb-history-item { display: flex; align-items: center; gap: 10px; width: 100%; box-sizing: border-box; border: none; background: transparent; color: var(--nb-text); font-size: 12.5px; padding: 8px; border-radius: var(--nb-radius-s); cursor: pointer; text-align: left; transition: background .14s; }
.nb-history-item:hover { background: var(--nb-hover); }
.nb-history-time { flex: 1 1 auto; }
.nb-history-size { flex: 0 0 auto; color: var(--nb-text-3); font-size: 11.5px; }
.nb-history-empty { padding: 20px 4px; font-size: 12.5px; color: var(--nb-text-3); text-align: center; }
.nb-history-card { width: min(700px, 100%); }
.nb-history-preview { max-height: 50vh; overflow: auto; margin: 0; padding: 12px 14px; background: var(--nb-panel); border: 1px solid var(--nb-line); border-radius: var(--nb-radius-m); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
.nb-diff { max-height: 50vh; overflow: auto; border: 1px solid var(--nb-line); border-radius: var(--nb-radius-m); background: var(--nb-panel); }
.nb-diff-head { position: sticky; top: 0; padding: 7px 12px; font-size: 11.5px; color: var(--nb-text-2); background: var(--nb-panel); border-bottom: 1px solid var(--nb-line); }
.nb-diff-body { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.55; }
.nb-diff-line { display: flex; gap: 8px; padding: 1px 12px; white-space: pre-wrap; word-break: break-word; }
.nb-diff-add { background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent); }
.nb-diff-remove { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent); }
.nb-diff-mark { flex: 0 0 12px; color: var(--nb-text-3); user-select: none; }
.nb-diff-text { flex: 1 1 auto; }
.nb-diff-skip { color: var(--nb-text-3); font-style: italic; padding: 3px 12px; }
.nb-diff-none { padding: 16px; text-align: center; font-size: 12.5px; color: var(--nb-text-3); }

/* ── Motion ────────────────────────────────────────────── */
/* AI helper dialog */
.nb-ai-card { width: min(600px, 100%); }
.nb-ai-tasks { display: flex; gap: 5px; flex-wrap: wrap; }
.nb-ai-task { border: 1px solid var(--nb-line-2); background: var(--nb-card); color: var(--nb-text-2); font-size: 12px; padding: 4px 11px; border-radius: 999px; cursor: pointer; transition: border-color .12s, color .12s, background .12s; }
.nb-ai-task:hover { border-color: var(--nb-accent); color: var(--nb-accent); }
.nb-ai-task.on { border-color: var(--nb-accent); color: var(--nb-accent); background: var(--nb-accent-soft); font-weight: 600; }
.nb-ai-instruction { width: 100%; box-sizing: border-box; min-height: 72px; padding: 10px; font-size: 13px; line-height: 1.6; resize: vertical; }
.nb-ai-source { max-height: 96px; overflow: auto; padding: 8px 10px; background: var(--nb-panel); border-radius: var(--nb-radius-s); font-size: 12px; color: var(--nb-text-3); white-space: pre-wrap; }
.nb-ai-result { width: 100%; box-sizing: border-box; min-height: 130px; padding: 10px; font-size: 13px; line-height: 1.6; }
.nb-ai-result.loading, .nb-ai-result.error { min-height: auto; padding: 12px; background: var(--nb-panel); border-radius: var(--nb-radius-s); font-size: 12.5px; color: var(--nb-text-3); }
.nb-ai-result.error { color: var(--dsw-alias-state-error-primary); }
/* Collection (table / board) views */
.nb-collection { margin: 10px 0 18px; }
.nb-collection-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 6px 0; border-bottom: 1px solid var(--nb-line); }
.nb-collection-views { display: flex; gap: 2px; padding: 2px; background: var(--nb-panel); border-radius: var(--nb-radius-s); }
.nb-collection-view { border: none; background: transparent; color: var(--nb-text-2); font-size: 12px; padding: 4px 10px; border-radius: 5px; cursor: pointer; }
.nb-collection-view.on { background: var(--nb-card); color: var(--nb-text); font-weight: 600; box-shadow: var(--nb-shadow-1); }
.nb-collection-filter { width: 180px; height: 28px; }
.nb-collection-count { color: var(--nb-text-3); font-size: 11.5px; }
.nb-collection-refresh { margin-left: auto; }
.nb-collection-table-wrap { overflow: auto; margin-top: 8px; border: 1px solid var(--nb-line); border-radius: var(--nb-radius-m); }
.nb-collection-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.nb-collection-table th { position: sticky; top: 0; background: var(--nb-panel); text-align: left; font-weight: 600; color: var(--nb-text-2); padding: 7px 10px; border-bottom: 1px solid var(--nb-line); white-space: nowrap; }
.nb-collection-th-sort { cursor: pointer; user-select: none; }
.nb-collection-th-sort:hover { color: var(--nb-text); }
.nb-collection-table td { padding: 6px 10px; border-bottom: 1px solid var(--nb-line); color: var(--nb-text); max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nb-collection-table tbody tr { cursor: pointer; }
.nb-collection-table tbody tr:hover td { background: var(--nb-hover); }
.nb-collection-name { font-weight: 500; }
.nb-collection-board { display: flex; gap: 12px; overflow-x: auto; margin-top: 10px; padding-bottom: 8px; align-items: flex-start; }
.nb-collection-column { flex: 0 0 220px; background: var(--nb-panel); border: 1px solid var(--nb-line); border-radius: var(--nb-radius-m); padding: 8px; }
.nb-collection-column-title { display: flex; align-items: center; justify-content: space-between; padding: 2px 4px 8px; font-size: 12px; font-weight: 600; color: var(--nb-text-2); }
.nb-collection-column-count { font-size: 10.5px; color: var(--nb-text-3); background: var(--nb-card); border-radius: 999px; padding: 1px 6px; }
.nb-collection-card { display: flex; flex-direction: column; gap: 3px; width: 100%; box-sizing: border-box; text-align: left; border: 1px solid var(--nb-line); background: var(--nb-card); border-radius: var(--nb-radius-s); padding: 8px 10px; margin-bottom: 6px; cursor: pointer; box-shadow: var(--nb-shadow-1); }
.nb-collection-card:hover { border-color: var(--nb-accent); }
.nb-collection-card-name { font-size: 12.5px; font-weight: 500; color: var(--nb-text); }
.nb-collection-card-field { font-size: 11px; color: var(--nb-text-3); }
.nb-collection-empty { padding: 18px 6px; font-size: 12.5px; color: var(--nb-text-3); }
.nb-collection-source { margin-top: 8px; font-size: 11px; color: var(--nb-text-3); }
.nb-collection-cell-td { padding: 3px 6px; }
.nb-collection-cell { display: block; min-height: 20px; padding: 3px 4px; border-radius: 4px; cursor: text; }
.nb-collection-cell:hover { background: var(--nb-hover); }
.nb-collection-cell.empty { color: var(--nb-text-3); }
.nb-collection-cell-input { width: 100%; box-sizing: border-box; height: 26px; font-size: 12.5px; }
.nb-collection-card.dragging { opacity: .45; }
.nb-collection-column.drag-over { border-color: var(--nb-accent); background: var(--nb-accent-soft); }
.nb-links { margin-top: 30px; padding-top: 14px; border-top: 1px solid var(--nb-line); }
.nb-links-toggle { display: flex; align-items: baseline; gap: 8px; width: 100%; border: none; background: transparent; padding: 2px 0; cursor: pointer; text-align: left; }
.nb-links-toggle:hover .nb-links-head { color: var(--nb-text-2); }
.nb-links-chevron { flex: 0 0 auto; width: 14px; font-size: 10px; color: var(--nb-text-3); }
.nb-links-counts { margin-left: auto; font-size: 11.5px; color: var(--nb-text-3); }
.nb-links-body { padding-top: 12px; }
.nb-outline-float { position: absolute; top: 64px; right: 18px; z-index: 30; width: 200px; max-height: 52vh; overflow: auto; padding: 8px; background: var(--nb-card); border: 1px solid var(--nb-line); border-radius: var(--nb-radius-m); box-shadow: var(--nb-shadow-2); animation: nb-fade .14s var(--nb-ease); }
.nb-outline-float-title { padding: 2px 6px 6px; font-size: 10.5px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--nb-text-3); }
.nb-outline-float-item { display: block; width: 100%; border: none; background: transparent; color: var(--nb-text-2); font-size: 12px; text-align: left; padding: 3px 6px; border-radius: 4px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nb-outline-float-item:hover { background: var(--nb-hover); color: var(--nb-text); }
.nb-outline-float-item.on { background: var(--nb-accent-soft); color: var(--nb-accent); font-weight: 600; }
.nb-links-head { margin-bottom: 10px; font-size: 10.5px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--nb-text-3); }
.nb-links-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.nb-links-label { margin-bottom: 5px; font-size: 11.5px; font-weight: 600; color: var(--nb-text-2); }
.nb-links-mentions { margin-top: 16px; padding-top: 12px; border-top: 1px dashed var(--nb-line); }
.nb-mention-item { display: flex; align-items: center; gap: 8px; padding: 2px 6px; }
.nb-mention-name { flex: 1 1 auto; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nb-mention-link { flex: 0 0 auto; border: 1px solid var(--nb-line-2); background: var(--nb-card); color: var(--nb-text-2); font-size: 11px; padding: 2px 8px; border-radius: 999px; cursor: pointer; transition: border-color .12s, color .12s; }
.nb-mention-link:hover { border-color: var(--nb-accent); color: var(--nb-accent); }
.nb-graph-card { width: min(760px, 100%); }
.nb-graph { display: block; width: 100%; height: auto; max-height: 56vh; }
.nb-graph-edge { stroke: var(--nb-line-2); stroke-width: 1; }
.nb-graph-dot { fill: var(--nb-card); stroke: var(--nb-line-2); stroke-width: 1.5; }
.nb-graph-dot.nb-graph-out { stroke: var(--nb-accent); }
.nb-graph-dot.nb-graph-in { stroke: var(--nb-text-3); }
.nb-graph-dot.nb-graph-self { fill: var(--nb-accent-soft); stroke: var(--nb-accent); stroke-width: 2.5; }
.nb-graph-label { fill: var(--nb-text); font-size: 11px; pointer-events: none; }
.nb-graph-self-label { font-weight: 600; }
.nb-graph-node { cursor: pointer; }
.nb-graph-node:hover .nb-graph-dot { fill: var(--nb-hover); }
.nb-graph-legend { display: flex; gap: 16px; font-size: 11.5px; color: var(--nb-text-3); }
.nb-graph-key { display: inline-flex; align-items: center; gap: 6px; }
.nb-graph-key::before { content: ''; width: 9px; height: 9px; border-radius: 50%; border: 1.5px solid var(--nb-text-3); }
.nb-graph-key-out::before { border-color: var(--nb-accent); }
.nb-links-empty { font-size: 12px; color: var(--nb-text-3); padding: 2px 0 2px 6px; }
.nb-link-item { display: flex; align-items: baseline; gap: 6px; width: 100%; border: none; background: transparent; color: var(--nb-text); font-size: 12.5px; padding: 3px 6px; border-radius: 4px; cursor: pointer; text-align: left; }
.nb-link-item:hover { background: var(--nb-hover); color: var(--nb-accent); }
.nb-link-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nb-link-meta { flex: 0 0 auto; font-size: 10.5px; color: var(--nb-text-3); }
.nb-note-picker-card { width: min(480px, 100%); }
.nb-note-picker-list { display: flex; flex-direction: column; gap: 3px; max-height: 320px; overflow: auto; }
.nb-wiki-pop { position: fixed; z-index: 84; min-width: 220px; max-width: 320px; max-height: 260px; overflow: auto; padding: 4px; background: var(--nb-card); border: 1px solid var(--nb-line); border-radius: var(--nb-radius-m); box-shadow: var(--nb-shadow-2); animation: nb-pop .12s var(--nb-ease); }
.nb-wiki-item { display: block; width: 100%; border: none; background: transparent; color: var(--nb-text); font-size: 12.5px; padding: 5px 8px; border-radius: 5px; cursor: pointer; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nb-wiki-item:hover, .nb-wiki-item.on { background: var(--nb-hover); }
.nb-flash { animation: nb-flash .9s ease; }
@keyframes nb-flash { 0% { box-shadow: 0 0 0 2px var(--nb-accent-ring); } 100% { box-shadow: 0 0 0 2px transparent; } }
@keyframes nb-pop { from { opacity: 0; transform: translateY(-3px) scale(.99); } to { opacity: 1; transform: none; } }
@keyframes nb-fade { from { opacity: 0; } to { opacity: 1; } }

/* ── Focus / reading modes ─────────────────────────────── */
/* Zen mode: only the writing surface, everything else steps aside. */
.nb-root.zen .nb-side { display: none; }
.nb-root.zen .nb-topbar { display: none; }
.nb-root.zen .nb-icon-row { display: none; }
.nb-root.zen .nb-cover { display: none; }
.nb-root.zen .nb-gutter { display: none; }
.nb-root.zen .nb-add { display: none; }
.nb-root.zen .nb-notice { display: none; }
.nb-root.zen .nb-links { display: none; }
.nb-root.zen .nb-outline-float { display: none; }
.nb-root.zen .nb-doc { max-width: 680px; padding: 11vh 6vw 40vh; }
.nb-zen-exit { position: fixed; top: 14px; right: 16px; z-index: 90; display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border: 1px solid var(--nb-line); border-radius: var(--nb-radius-s); background: var(--nb-card); color: var(--nb-text-3); font-size: 11.5px; cursor: pointer; box-shadow: var(--nb-shadow-1); opacity: .3; transition: opacity .15s var(--nb-ease), color .15s, border-color .15s; }
.nb-root:hover .nb-zen-exit { opacity: 1; }
.nb-zen-exit:hover { color: var(--nb-text); border-color: var(--nb-accent); }
.nb-root.reading .nb-gutter { display: none; }
.nb-root.reading .nb-block:hover > .nb-b { background: transparent; }
.nb-root.reading .nb-add { display: none; }
.nb-root.reading .nb-outline { display: none; }
.nb-root.reading .nb-b-render { cursor: default; }

/* ── Responsive ────────────────────────────────────────── */
@media (max-width: 860px) {
  .nb-side { width: 208px; flex-basis: 208px; }
  .nb-doc { padding: 30px 32px 40vh; }
  .nb-gutter { left: -30px; }
}
@media (max-width: 720px) {
  .nb-side { display: none; }
  .nb-doc { padding: 20px 22px 40vh; }
  .nb-gutter { left: -34px; width: 34px; }
  .nb-toolbar { max-width: calc(100vw - 16px); overflow-x: auto; }
  .nb-topbar { flex-wrap: wrap; height: auto; padding: 8px 12px; gap: 4px; }
  .nb-tabs { order: -1; width: 100%; }
  .nb-find { left: 12px; right: 12px; top: auto; bottom: 16px; }
  .nb-find-input { flex: 1 1 auto; width: auto; }
  .nb-empty { padding: 12vh 24px 0; }
  .nb-links-cols { grid-template-columns: 1fr; gap: 12px; }
  .nb-outline-float { display: none; }
  .nb-gutter-right { display: none; }
  .nb-empty-title { font-size: 32px; }
}

/* ── Print ─────────────────────────────────────────────── */
@media print {
  body * { visibility: hidden; }
  .nb-root, .nb-root * { visibility: visible; }
  .nb-root { position: absolute; inset: 0; display: block; height: auto; background: #fff; color: #000; }
  .nb-side, .nb-topbar, .nb-tabs, .nb-gutter, .nb-add, .nb-notice, .nb-find, .nb-toolbar, .nb-img-bar, .nb-ghost, .nb-modal, .nb-icon-panel, .nb-col-handle, .nb-row-handle, .nb-col-resize, .nb-toggle-arrow { display: none !important; }
  .nb-scroll { overflow: visible; height: auto; }
  .nb-doc { max-width: none; padding: 0; margin: 0; }
  .nb-block:hover > .nb-b { background: transparent; }
  .nb-b-edit { display: none !important; }
  .nb-table { border-collapse: collapse; }
  a { color: inherit; text-decoration: none; }
}
`

    /* ---------------- Host API ---------------- */

    async function request(path, options) {
      let response
      try {
        response = await fetch(API + path, options)
      } catch (error) {
        throw new Error((error && error.message) || 'The notebook request failed')
      }
      let payload = null
      try {
        payload = await response.json()
      } catch {
        throw new Error(`The notebook Host returned HTTP ${response.status}`)
      }
      if (!payload || payload.ok !== true) {
        const error = new Error((payload && payload.error) || `The notebook Host returned HTTP ${response.status}`)
        error.code = payload && payload.code
        throw error
      }
      return payload
    }

    const apiGet = (path) => request(path, { credentials: 'same-origin' })
    const apiPost = (path, body) =>
      request(path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })

    /* ---------------- Markdown block model ----------------
     * A note is an ordered list of blocks. Parsing keeps the common Markdown
     * shapes; serializing writes them back with blank lines between blocks and
     * tight list runs, so parse(serialize(parse(x))) is stable.
     */

    let blockSeq = 0
    function makeId() {
      blockSeq += 1
      return `b${blockSeq.toString(36)}${Math.random().toString(36).slice(2, 6)}`
    }

    function isListType(type) {
      return type === 'bullet' || type === 'numbered' || type === 'todo'
    }

    function headingLevel(type) {
      if (type === 'heading1') return 1
      if (type === 'heading2') return 2
      if (type === 'heading3') return 3
      return 0
    }

    /**
     * Blocks hidden by a collapsed heading: every following block until the
     * next heading of the same or a higher level. Pure, so it is unit-tested.
     */
    function hiddenByCollapsedHeadings(blocks, collapsed) {
      const hidden = new Set()
      let level = 0
      for (const block of blocks) {
        const current = headingLevel(block.type)
        if (level > 0) {
          if (current > 0 && current <= level) {
            level = 0
          } else {
            hidden.add(block.id)
            continue
          }
        }
        if (current > 0 && collapsed[block.id] === true) level = current
      }
      return hidden
    }

    /**
     * Blocks hidden by a collapsed toggle: everything after it that is indented
     * deeper than the toggle itself, until a block returns to its level.
     */
    function hiddenByToggles(blocks) {
      const hidden = new Set()
      let level = -1
      for (const block of blocks) {
        const indent = Math.min(3, Math.max(0, Number(block.indent) || 0))
        if (level >= 0) {
          if (indent > level) {
            hidden.add(block.id)
            continue
          }
          level = -1
        }
        if (block.type === 'toggle' && block.collapsed === true) level = indent
      }
      return hidden
    }

    function parseBlocks(input) {
      const source = String(input ?? '').replace(/\r\n?/g, '\n')
      const lines = source.split('\n')
      const blocks = []
      let paragraph = []
      let paragraphIndent = 0
      let code = null

      const flushParagraph = () => {
        if (paragraph.length === 0) return
        blocks.push({ id: makeId(), type: 'paragraph', text: paragraph.join('\n'), indent: paragraphIndent })
        paragraph = []
        paragraphIndent = 0
      }

      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]
        const indent = indentOf(line)
        if (code !== null) {
          if (/^\s*```/.test(line)) {
            blocks.push({ id: makeId(), type: 'code', text: code.lines.join('\n'), lang: code.lang })
            code = null
          } else {
            code.lines.push(line)
          }
          continue
        }
        const fence = /^\s*```(.*)$/.exec(line)
        if (fence !== null) {
          flushParagraph()
          code = { lang: fence[1].trim(), lines: [] }
          continue
        }
        if (/^\s*$/.test(line)) {
          flushParagraph()
          continue
        }
        if (/^\s*\|/.test(line)) {
          flushParagraph()
          const tableLines = [line]
          let cursor = index + 1
          while (cursor < lines.length && /^\s*\|/.test(lines[cursor])) {
            tableLines.push(lines[cursor])
            cursor += 1
          }
          index = cursor - 1
          const splitCells = (row) =>
            row
              .trim()
              .replace(/^\|/, '')
              .replace(/\|$/, '')
              .split('|')
              .map((cell) => cell.trim().replace(/<br\s*\/?>/gi, '\n'))
          const dividerIndex = tableLines.findIndex((row) => /^\s*\|[\s:|\-]+\|\s*$/.test(row))
          const aligns =
            dividerIndex < 0
              ? []
              : splitCells(tableLines[dividerIndex]).map((cell) => {
                  const left = cell.startsWith(':')
                  const right = cell.endsWith(':')
                  if (left && right) return 'center'
                  if (right) return 'right'
                  return 'left'
                })
          const rows = tableLines
            .filter((row) => !/^\s*\|[\s:|\-]+\|\s*$/.test(row))
            .map((row) => splitCells(row))
          if (rows.length > 0) {
            const width = Math.max(1, ...rows.map((row) => row.length))
            blocks.push({
              id: makeId(),
              type: 'table',
              text: '',
              aligns: Array.from({ length: width }, (_, column) => aligns[column] ?? 'left'),
              rows: rows.map((row) => Array.from({ length: width }, (_, column) => row[column] ?? '')),
            })
          }
          continue
        }
        const todo = /^\s*[-*+]\s+\[([ xX])\]\s?(.*)$/.exec(line)
        if (todo !== null) {
          flushParagraph()
          blocks.push({
            id: makeId(),
            type: 'todo',
            checked: todo[1].toLowerCase() === 'x',
            text: todo[2],
            indent,
          })
          continue
        }
        const heading = /^(#{1,6})\s+(.*)$/.exec(line)
        if (heading !== null) {
          flushParagraph()
          blocks.push({ id: makeId(), type: `heading${Math.min(heading[1].length, 3)}`, text: heading[2] })
          continue
        }
        const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
        if (bullet !== null) {
          flushParagraph()
          blocks.push({ id: makeId(), type: 'bullet', text: bullet[1], indent })
          continue
        }
        const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
        if (numbered !== null) {
          flushParagraph()
          blocks.push({ id: makeId(), type: 'numbered', text: numbered[1], indent })
          continue
        }
        const callout = /^\s*>\s*\[!(\w+)\]([+-]?)\s?(.*)$/.exec(line)
        if (callout !== null) {
          flushParagraph()
          const kind = callout[1].toLowerCase()
          if (kind === 'toggle') {
            blocks.push({
              id: makeId(),
              type: 'toggle',
              text: callout[3],
              indent,
              collapsed: callout[2] === '-',
            })
          } else {
            blocks.push({ id: makeId(), type: 'callout', variant: kind, text: callout[3], indent })
          }
          continue
        }
        const quote = /^\s*>\s?(.*)$/.exec(line)
        if (quote !== null) {
          flushParagraph()
          blocks.push({ id: makeId(), type: 'quote', text: quote[1], indent })
          continue
        }
        if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
          flushParagraph()
          blocks.push({ id: makeId(), type: 'divider', text: '' })
          continue
        }
        if (paragraph.length === 0) paragraphIndent = indent
        // Leading whitespace is the block's indent level, not part of its text.
        paragraph.push(line.trim())
      }
      if (code !== null) blocks.push({ id: makeId(), type: 'code', text: code.lines.join('\n'), lang: code.lang })
      flushParagraph()
      if (blocks.length === 0) blocks.push({ id: makeId(), type: 'paragraph', text: '' })
      // ` ^id` at the end of a block is a persistent anchor for `[[note#^id]]`.
      return blocks.map((block) => {
        if (!BLOCK_ID_TYPES.has(block.type)) return block
        const split = splitBlockId(block.text)
        return split.blockId.length > 0 ? { ...block, text: split.text, blockId: split.blockId } : block
      })
    }

    function tableToMarkdown(rows, aligns) {
      const list = Array.isArray(rows) && rows.length > 0 ? rows : [['', '']]
      const width = Math.max(1, ...list.map((row) => (Array.isArray(row) ? row.length : 0)))
      const normalized = list.map((row) =>
        Array.from({ length: width }, (_, column) =>
          String((row ?? [])[column] ?? '').replace(/\r?\n/g, '<br>'),
        ),
      )
      const header = `| ${normalized[0].join(' | ')} |`
      const divider = `| ${Array.from({ length: width }, (_, column) => {
        const align = (Array.isArray(aligns) ? aligns[column] : undefined) ?? 'left'
        if (align === 'center') return ':---:'
        if (align === 'right') return '---:'
        return '---'
      }).join(' | ')} |`
      const body = normalized.slice(1).map((row) => `| ${row.join(' | ')} |`)
      return [header, divider, ...body].join('\n')
    }

    const INDENTABLE = new Set(['paragraph', 'bullet', 'numbered', 'todo', 'quote', 'callout', 'toggle'])
    /** Block types that can carry a persistent ` ^id` suffix for `[[note#^id]]` links. */
    const BLOCK_ID_TYPES = new Set([
      'paragraph',
      'heading1',
      'heading2',
      'heading3',
      'bullet',
      'numbered',
      'todo',
      'quote',
      'callout',
      'toggle',
    ])

    /** Split a trailing ` ^id` block anchor off one line of block text. */
    function splitBlockId(text) {
      const source = String(text ?? '')
      const match = / \^([A-Za-z0-9_-]+)$/.exec(source)
      if (match === null) return { text: source, blockId: '' }
      return { text: source.slice(0, match.index), blockId: match[1] }
    }

    /**
     * Move a contiguous selection of blocks as one unit. `overId` names the block
     * the drop lands on; dropping into the group itself is a no-op.
     */
    function moveBlockGroup(list, groupIds, overId, before) {
      const groupSet = new Set(groupIds)
      if (overId === null || overId === undefined || groupSet.has(overId)) return null
      const remaining = list.filter((block) => !groupSet.has(block.id))
      const targetIndex = remaining.findIndex((block) => block.id === overId)
      if (targetIndex < 0) return null
      const insertAt = before ? targetIndex : targetIndex + 1
      const moving = list.filter((block) => groupSet.has(block.id))
      return [...remaining.slice(0, insertAt), ...moving, ...remaining.slice(insertAt)]
    }

    /** Move one table data row (index is 0-based over data rows, header excluded). */
    function moveTableRow(rows, from, to) {
      const list = Array.isArray(rows) ? rows.map((row) => row.slice()) : []
      if (list.length < 2) return list
      if (from <= 0 || to <= 0 || from >= list.length || to >= list.length) return list
      const [moved] = list.splice(from, 1)
      list.splice(to, 0, moved)
      return list
    }

    /** Move one table column in every row (0-based column indexes). */
    function moveTableColumn(rows, from, to) {
      const list = Array.isArray(rows) ? rows : []
      const copy = () => list.map((row) => (Array.isArray(row) ? row.slice() : []))
      if (list.length === 0) return copy()
      const width = Math.max(0, ...list.map((row) => (Array.isArray(row) ? row.length : 0)))
      if (width < 2 || from < 0 || to < 0 || from >= width || to >= width || from === to) return copy()
      return copy().map((row) => {
        const [moved] = row.splice(from, 1)
        row.splice(to, 0, moved)
        return row
      })
    }

    /** Resolve an Obsidian-style `[[name]]` link against the note list. */
    /** Parse a collection page's frontmatter into view settings, or null. */
    function collectionConfigFor(frontmatter) {
      const type = frontmatterValue(frontmatter, 'type').trim().toLowerCase()
      if (type !== 'collection' && type !== 'database') return null
      const view = frontmatterValue(frontmatter, 'view').trim().toLowerCase()
      return {
        source: frontmatterValue(frontmatter, 'source').trim(),
        view: view === 'board' ? 'board' : 'table',
        groupBy: frontmatterValue(frontmatter, 'groupBy').trim() || 'status',
        columns: parseListValue(frontmatterValue(frontmatter, 'columns')),
      }
    }

    /** Columns for a collection table: explicit frontmatter ones, else the most common fields. */
    function collectionColumns(rows, explicit) {
      const CONFIG_KEYS = new Set(['type', 'view', 'groupBy', 'source', 'columns'])
      const fixed = (Array.isArray(explicit) ? explicit : []).filter(
        (item) => typeof item === 'string' && item.length > 0,
      )
      if (fixed.length > 0) return fixed
      const counts = new Map()
      for (const row of Array.isArray(rows) ? rows : []) {
        const fields = row !== null && typeof row.fields === 'object' ? row.fields : {}
        for (const key of Object.keys(fields)) {
          if (CONFIG_KEYS.has(key)) continue
          counts.set(key, (counts.get(key) ?? 0) + 1)
        }
      }
      return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([key]) => key)
    }

    function collectionValue(row, key) {
      if (row === null || row === undefined) return ''
      if (key === 'name') return String(row.name ?? '')
      if (key === 'path') return String(row.path ?? '')
      const fields = row !== null && typeof row.fields === 'object' ? row.fields : {}
      return String(fields[key] ?? '')
    }

    /** Filter rows by a query matched against the note name, path and fields. */
    function filterCollectionRows(rows, query) {
      const needle = String(query ?? '').trim().toLowerCase()
      const list = Array.isArray(rows) ? rows : []
      if (needle.length === 0) return list.slice()
      return list.filter((row) => {
        const values = [row.name, row.path, ...Object.values(row.fields ?? {})]
        return values.some((value) => String(value ?? '').toLowerCase().includes(needle))
      })
    }

    /** Sort rows by `name` / `path` / an arbitrary field key. */
    function sortCollectionRows(rows, key, dir) {
      const list = Array.isArray(rows) ? rows.slice() : []
      const field = String(key ?? '')
      if (field.length === 0) return list
      const sign = dir === 'desc' ? -1 : 1
      return list.sort((a, b) => {
        const left = collectionValue(a, field)
        const right = collectionValue(b, field)
        return sign * left.localeCompare(right, 'zh-Hans-CN', { numeric: true })
      })
    }

    /** Group rows by a field value (empty values fall into one bucket). */
    function groupCollectionRows(rows, key) {
      const map = new Map()
      for (const row of Array.isArray(rows) ? rows : []) {
        const value = collectionValue(row, key)
        if (!map.has(value)) map.set(value, [])
        map.get(value).push(row)
      }
      return [...map.entries()].map(([value, list]) => ({ value, rows: list }))
    }

    /** Table / board view over a folder's notes and their frontmatter fields. */
    function CollectionView({ t, config, rows, loading, folder, onOpen, onReload, onFieldChange, onCreate }) {
      const [view, setView] = React.useState(null)
      const [sortKey, setSortKey] = React.useState('')
      const [sortDir, setSortDir] = React.useState('asc')
      const [query, setQuery] = React.useState('')
      const [editingCell, setEditingCell] = React.useState(null)
      const [draft, setDraft] = React.useState('')
      const [dragRow, setDragRow] = React.useState(null)
      const [dragColumn, setDragColumn] = React.useState(null)
      const activeView = view === null ? config.view : view
      const columns = collectionColumns(rows, config.columns)
      const visible = sortCollectionRows(filterCollectionRows(rows, query), sortKey, sortDir)
      const groups = groupCollectionRows(visible, config.groupBy)

      function toggleSort(key) {
        if (sortKey === key) {
          setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
        } else {
          setSortKey(key)
          setSortDir('asc')
        }
      }

      function commitCell() {
        const cell = editingCell
        const value = draft
        setEditingCell(null)
        setDraft('')
        if (cell === null) return
        if (typeof onFieldChange === 'function') onFieldChange(cell.path, cell.key, value)
      }

      function beginCellEdit(event, row, key) {
        event.stopPropagation()
        setEditingCell({ path: row.path, key })
        setDraft(collectionValue(row, key))
      }

      const bar = h(
        'div',
        { className: 'nb-collection-bar' },
        h(
          'div',
          { className: 'nb-collection-views' },
          h(
            'button',
            { className: `nb-collection-view${activeView === 'table' ? ' on' : ''}`, onClick: () => setView('table') },
            `▦ ${t('collectionTable')}`,
          ),
          h(
            'button',
            { className: `nb-collection-view${activeView === 'board' ? ' on' : ''}`, onClick: () => setView('board') },
            `▤ ${t('collectionBoard')}`,
          ),
        ),
        h('input', {
          className: 'nb-input nb-collection-filter',
          value: query,
          placeholder: t('collectionFilter'),
          'aria-label': t('collectionFilter'),
          onChange: (event) => setQuery(event.target.value),
        }),
        h('span', { className: 'nb-collection-count' }, `${visible.length} ${t('collectionRows')}`),
        h(
          'button',
          { className: 'nb-btn nb-collection-new', onClick: () => (typeof onCreate === 'function' ? onCreate() : null) },
          `+ ${t('collectionNewRow')}`,
        ),
        h('button', { className: 'nb-btn nb-collection-refresh', onClick: onReload }, t('refresh')),
      )

      let body
      if (loading === true) {
        body = h('div', { className: 'nb-collection-empty' }, t('loading'))
      } else if (rows.length === 0) {
        body = h('div', { className: 'nb-collection-empty' }, t('collectionEmpty'))
      } else if (activeView === 'board') {
        body = h(
          'div',
          { className: 'nb-collection-board' },
          groups.map((group) =>
            h(
              'div',
              {
                key: `g-${group.value}`,
                className: `nb-collection-column${dragColumn === group.value ? ' drag-over' : ''}`,
                onDragOver: (event) => {
                  event.preventDefault()
                  setDragColumn(group.value)
                },
                onDragLeave: () => setDragColumn((current) => (current === group.value ? null : current)),
                onDrop: (event) => {
                  event.preventDefault()
                  setDragColumn(null)
                  const path = event.dataTransfer !== null && event.dataTransfer !== undefined
                    ? event.dataTransfer.getData('text/plain')
                    : ''
                  const source = path.length > 0 ? path : dragRow
                  setDragRow(null)
                  if (source !== null && source !== undefined && source.length > 0 && typeof onFieldChange === 'function') {
                    onFieldChange(source, config.groupBy, group.value)
                  }
                },
              },
              h(
                'div',
                { className: 'nb-collection-column-title' },
                h('span', null, group.value.length > 0 ? group.value : t('collectionUncategorized')),
                h('span', { className: 'nb-collection-column-count' }, String(group.rows.length)),
              ),
              group.rows.map((row) =>
                h(
                  'button',
                  {
                    key: row.path,
                    className: `nb-collection-card${dragRow === row.path ? ' dragging' : ''}`,
                    draggable: true,
                    onDragStart: (event) => {
                      setDragRow(row.path)
                      if (event.dataTransfer !== null && event.dataTransfer !== undefined) {
                        event.dataTransfer.setData('text/plain', row.path)
                        event.dataTransfer.effectAllowed = 'move'
                      }
                    },
                    onDragEnd: () => {
                      setDragRow(null)
                      setDragColumn(null)
                    },
                    onClick: () => onOpen(row.path),
                  },
                  h('span', { className: 'nb-collection-card-name' }, row.name),
                  columns
                    .slice(0, 2)
                    .map((key) =>
                      collectionValue(row, key).length > 0
                        ? h(
                            'span',
                            { key, className: 'nb-collection-card-field' },
                            `${key}: ${collectionValue(row, key)}`,
                          )
                        : null,
                    ),
                ),
              ),
            ),
          ),
        )
      } else {
        body = h(
          'div',
          { className: 'nb-collection-table-wrap' },
          h(
            'table',
            { className: 'nb-collection-table' },
            h(
              'thead',
              null,
              h(
                'tr',
                null,
                h(
                  'th',
                  { className: 'nb-collection-th-sort', onClick: () => toggleSort('name'), title: t('collectionSort') },
                  `${t('collectionName')}${sortKey === 'name' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}`,
                ),
                columns.map((key) =>
                  h(
                    'th',
                    { key, className: 'nb-collection-th-sort', onClick: () => toggleSort(key), title: t('collectionSort') },
                    `${key}${sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}`,
                  ),
                ),
              ),
            ),
            h(
              'tbody',
              null,
              visible.map((row) =>
                h(
                  'tr',
                  { key: row.path, onClick: () => onOpen(row.path) },
                  h('td', { className: 'nb-collection-name' }, row.name),
                  columns.map((key) =>
                    h(
                      'td',
                      { key, className: 'nb-collection-cell-td' },
                      editingCell !== null && editingCell.path === row.path && editingCell.key === key
                        ? h('input', {
                            className: 'nb-input nb-collection-cell-input',
                            value: draft,
                            autoFocus: true,
                            'aria-label': key,
                            onClick: (event) => event.stopPropagation(),
                            onChange: (event) => setDraft(event.target.value),
                            onBlur: () => commitCell(),
                            onKeyDown: (event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault()
                                commitCell()
                              } else if (event.key === 'Escape') {
                                event.preventDefault()
                                setEditingCell(null)
                              }
                            },
                          })
                        : h(
                            'span',
                            {
                              className: `nb-collection-cell${collectionValue(row, key).length === 0 ? ' empty' : ''}`,
                              onClick: (event) => beginCellEdit(event, row, key),
                              title: t('collectionEditCell'),
                            },
                            collectionValue(row, key).length > 0 ? collectionValue(row, key) : '—',
                          ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        )
      }

      return h(
        'div',
        { className: 'nb-collection' },
        bar,
        body,
        h(
          'div',
          { className: 'nb-collection-source' },
          `${t('collectionSource')}: ${folder.length > 0 ? folder : '/'}`,
        ),
      )
    }

    /**
     * Flatten notes into parent-before-child order using frontmatter parent
     * links; a note whose parent is outside the list stays at the top level.
     */
    function flattenTree(items, parents) {
      const list = Array.isArray(items) ? items : []
      const map = parents !== null && typeof parents === 'object' ? parents : {}
      const byPath = new Map()
      for (const note of list) {
        byPath.set(String(note.path), note)
        byPath.set(String(note.path).replace(/\.md$/i, ''), note)
      }
      const parentOf = (note) => {
        const raw = map[note.path]
        if (typeof raw !== 'string') return null
        const parent = byPath.get(raw.replace(/\.md$/i, ''))
        if (parent === undefined || parent.path === note.path) return null
        return parent
      }
      const children = new Map()
      for (const note of list) {
        const parent = parentOf(note)
        if (parent === null) continue
        if (!children.has(parent.path)) children.set(parent.path, [])
        children.get(parent.path).push(note)
      }
      const ordered = []
      const visit = (note, depth) => {
        ordered.push({ note, depth })
        for (const child of children.get(note.path) ?? []) visit(child, depth + 1)
      }
      for (const note of list) {
        if (parentOf(note) !== null) continue
        visit(note, 0)
      }
      return ordered
    }

    /** Notes matching a quick-open query, by name or path. */
    function filterQuickNotes(notes, query) {
      const needle = String(query ?? '').trim().toLowerCase()
      return (Array.isArray(notes) ? notes : []).filter((note) => {
        if (needle.length === 0) return true
        const name = String(note.name ?? '').toLowerCase()
        const path = String(note.path ?? '').toLowerCase()
        return name.includes(needle) || path.includes(needle)
      })
    }

    /** Lay out graph nodes: outgoing links on the right half, backlinks on the left. */
    function graphPositions(count, side, width, height, radius) {
      const total = Math.max(0, Number(count) || 0)
      const cx = width / 2
      const cy = height / 2
      const positions = []
      if (total === 0) return positions
      const start = side === 'out' ? -Math.PI / 2 : Math.PI / 2
      for (let index = 0; index < total; index += 1) {
        const angle = start + (Math.PI * (index + 0.5)) / total
        positions.push({
          x: Math.round((cx + Math.cos(angle) * radius) * 10) / 10,
          y: Math.round((cy + Math.sin(angle) * radius) * 10) / 10,
        })
      }
      return positions
    }

    /**
     * Note names mentioned as plain text (outside wiki links) in the given blocks,
     * used for one-click linking like Obsidian's unlinked mentions.
     */
    function unlinkedMentions(blocks, notes, selfPath) {
      const texts = (Array.isArray(blocks) ? blocks : [])
        .filter((block) => block.type !== 'code')
        .map((block) => {
          const raw = String(block.text ?? '')
          return {
            raw,
            stripped: raw.replace(/!?\[\[[^\]\n]*\]\]/g, ' '),
          }
        })
      const mentions = []
      for (const note of Array.isArray(notes) ? notes : []) {
        if (note.path === selfPath) continue
        const name = String(note.name ?? '')
        if (name.length < 2) continue
        let count = 0
        for (const item of texts) {
          if (!item.stripped.includes(name)) continue
          count += item.stripped.split(name).length - 1
        }
        if (count > 0) mentions.push({ name, path: note.path, count })
      }
      return mentions.sort((a, b) => b.count - a.count).slice(0, 8)
    }

    /** Turn plain-text mentions of `name` into `[[name]]`, leaving existing links alone. */
    function linkMentions(blocks, name) {
      const target = String(name ?? '')
      if (target.length === 0) return Array.isArray(blocks) ? blocks : []
      const link = `[[${target}]]`
      return (Array.isArray(blocks) ? blocks : []).map((block) => {
        if (block.type === 'code') return block
        const raw = String(block.text ?? '')
        if (!raw.includes(target)) return block
        const parts = raw.split(/(!?\[\[[^\]\n]*\]\])/)
        const next = parts
          .map((part) =>
            part.startsWith('[[') || part.startsWith('![[') ? part : part.split(target).join(link),
          )
          .join('')
        return next === raw ? block : { ...block, text: next }
      })
    }

    /**
     * The note-name query when a block's text ends with an unclosed `[[...]`,
     * otherwise null. Only the last opened bracket counts.
     */
    function wikiQueryFor(text) {
      const source = String(text ?? '')
      const open = source.lastIndexOf('[[')
      if (open < 0) return null
      if (source.lastIndexOf(']]') >= open) return null
      const query = source.slice(open + 2)
      if (query.includes('[') || query.includes(']')) return null
      if (query.length > 40) return null
      return query
    }

    /** Distinct wiki targets referenced by a note (links and embeds). */
    function outgoingLinks(blocks) {
      const found = new Map()
      for (const block of Array.isArray(blocks) ? blocks : []) {
        // Code blocks show literal text; their brackets are not note links.
        if (block.type === 'code') continue
        const text = String(block.text ?? '')
        if (!text.includes('[[')) continue
        for (const match of text.matchAll(/(!?)\[\[([^\]\n]+)\]\]/g)) {
          const raw = match[2].split('|')[0].split('#')[0].trim().replace(/\.md$/i, '')
          if (raw.length === 0 || found.has(raw)) continue
          found.set(raw, { name: raw, embed: match[1] === '!' })
        }
      }
      return [...found.values()]
    }

    /** Split `note#heading` into its note part and optional anchor. */
    function parseWikiLink(raw) {
      const value = String(raw ?? '').trim()
      const hash = value.indexOf('#')
      if (hash < 0) return { name: value, anchor: '' }
      return { name: value.slice(0, hash).trim(), anchor: value.slice(hash + 1).trim() }
    }

    function findWikiTarget(notes, rawName) {
      const target = String(rawName ?? '').trim().replace(/\.md$/i, '')
      if (target.length === 0) return null
      const list = Array.isArray(notes) ? notes : []
      return (
        list.find((note) => note.name === target) ??
        list.find((note) => note.path === target) ??
        list.find((note) => String(note.path ?? '').replace(/\.md$/i, '') === target) ??
        list.find((note) => String(note.path ?? '').endsWith(`/${target}.md`)) ??
        null
      )
    }

    function indentOf(line) {
      const leading = /^(\s*)/.exec(line)[1].length
      return Math.min(3, Math.floor(leading / 2))
    }

    function indentPrefix(block) {
      if (!INDENTABLE.has(block.type)) return ''
      const level = Math.min(3, Math.max(0, Number(block.indent) || 0))
      return '  '.repeat(level)
    }

    function blockToMarkdown(block) {
      const text = block.text ?? ''
      let line
      switch (block.type) {
        case 'heading1':
          line = `# ${text}`
          break
        case 'heading2':
          line = `## ${text}`
          break
        case 'heading3':
          line = `### ${text}`
          break
        case 'bullet':
          line = `- ${text}`
          break
        case 'numbered':
          line = `1. ${text}`
          break
        case 'todo':
          line = `- [${block.checked === true ? 'x' : ' '}] ${text}`
          break
        case 'quote':
          line = text
            .split('\n')
            .map((value) => `> ${value}`)
            .join('\n')
          break
        case 'callout':
          line = `> [!${block.variant ?? 'note'}] ${text}`
          break
        case 'toggle':
          line = `> [!toggle]${block.collapsed === true ? '-' : ''} ${text}`
          break
        case 'code':
          line = `\`\`\`${block.lang ?? ''}\n${text}\n\`\`\``
          break
        case 'table':
          line = tableToMarkdown(block.rows, block.aligns)
          break
        case 'divider':
          line = '---'
          break
        default:
          line = text
      }
      const anchor =
        typeof block.blockId === 'string' && block.blockId.length > 0 && BLOCK_ID_TYPES.has(block.type)
          ? ` ^${block.blockId}`
          : ''
      return indentPrefix(block) + line + anchor
    }

    function serializeBlocks(blocks) {
      const list = Array.isArray(blocks) ? blocks : []
      if (list.length === 0) return ''
      if (list.length === 1 && list[0].type === 'paragraph' && String(list[0].text ?? '').trim() === '') return ''
      let out = ''
      let previous = null
      for (const block of list) {
        if (out.length > 0) out += isListType(previous.type) && isListType(block.type) ? '\n' : '\n\n'
        out += blockToMarkdown(block)
        previous = block
      }
      return `${out}\n`
    }

    /* ---------------- frontmatter (page icon lives here) ----------------
     * A leading `---` block is only treated as frontmatter when every non-empty
     * line looks like a YAML `key: value`; a note that merely starts with a
     * horizontal rule therefore stays a note.
     */

    function splitFrontmatter(content) {
      const source = String(content ?? '')
      if (!source.startsWith('---\n') && !source.startsWith('---\r\n')) {
        return { frontmatter: '', body: source }
      }
      const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source)
      if (match === null) return { frontmatter: '', body: source }
      const meta = match[1]
      const lines = meta.split(/\r?\n/).filter((line) => line.trim().length > 0)
      for (const line of lines) {
        if (!/^[A-Za-z0-9_-]+\s*:\s*.+$/.test(line.trim())) {
          return { frontmatter: '', body: source }
        }
      }
      return { frontmatter: meta, body: source.slice(match[0].length) }
    }

    function composeContent(frontmatter, body) {
      const meta = String(frontmatter ?? '').trim()
      if (meta.length === 0) return body
      return `---\n${meta}\n---\n\n${body}`
    }

    function frontmatterIcon(frontmatter) {
      const match = /^icon:\s*(.+)$/m.exec(String(frontmatter ?? ''))
      if (match === null) return ''
      return match[1].trim().replace(/^["']|["']$/g, '')
    }

    function withFrontmatterIcon(frontmatter, icon) {
      const lines = String(frontmatter ?? '')
        .split('\n')
        .filter((line) => line.trim().length > 0 && !/^icon:\s*/.test(line))
      if (icon.length > 0) lines.push(`icon: ${icon}`)
      return lines.join('\n').trim()
    }

    function frontmatterCover(frontmatter) {
      const match = /^cover:\s*(.+)$/m.exec(String(frontmatter ?? ''))
      if (match === null) return ''
      return match[1].trim().replace(/^["']|["']$/g, '')
    }

    function withFrontmatterCover(frontmatter, cover) {
      const lines = String(frontmatter ?? '')
        .split('\n')
        .filter((line) => line.trim().length > 0 && !/^cover:\s*/.test(line))
      if (cover.length > 0) lines.push(`cover: ${cover}`)
      return lines.join('\n').trim()
    }

    function frontmatterValue(frontmatter, key) {
      const pattern = new RegExp(`^${key}:\\s*(.+)$`, 'm')
      const match = pattern.exec(String(frontmatter ?? ''))
      if (match === null) return ''
      return match[1].trim().replace(/^["']|["']$/g, '')
    }

    function withFrontmatterValue(frontmatter, key, value) {
      const pattern = new RegExp(`^${key}:\\s*`)
      const lines = String(frontmatter ?? '')
        .split('\n')
        .filter((line) => line.trim().length > 0 && !pattern.test(line))
      if (String(value ?? '').length > 0) lines.push(`${key}: ${value}`)
      return lines.join('\n').trim()
    }

    /** Read a YAML list-ish value (`[a, b]` or `a, b`) as separate items. */
    function parseListValue(value) {
      return String(value ?? '')
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((item) => item.trim().replace(/^["']|["']$/g, ''))
        .filter((item) => item.length > 0)
    }

    function formatListValue(text) {
      const items = String(text ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
      return items.length === 0 ? '' : `[${items.join(', ')}]`
    }

    /** Tag chips keep their order, skip blanks and never duplicate. */
    function addTagToList(list, tag) {
      const current = Array.isArray(list) ? list.slice() : []
      const value = String(tag ?? '').trim()
      if (value.length === 0 || current.includes(value)) return current
      return [...current, value]
    }

    function removeTagFromList(list, tag) {
      return Array.isArray(list) ? list.filter((item) => item !== tag) : []
    }

    /** Folders that can receive a moved note: the vault root plus every existing folder. */
    function folderTargets(notes) {
      const dirs = new Set([''])
      for (const note of Array.isArray(notes) ? notes : []) {
        const dir = String(note.dir ?? '')
        if (dir.length === 0) continue
        const parts = dir.split('/')
        for (let index = 1; index <= parts.length; index += 1) dirs.add(parts.slice(0, index).join('/'))
      }
      return [...dirs].sort((a, b) => a.localeCompare(b))
    }

    /** A `[[note#heading]]` link pointing at a block (plain notes use no anchor). */
    function blockLinkFor(notePath, block) {
      const name = String(notePath ?? '').split('/').pop().replace(/\.md$/i, '')
      if (
        block !== null &&
        block !== undefined &&
        typeof block.blockId === 'string' &&
        block.blockId.length > 0
      ) {
        return `[[${name}#^${block.blockId}]]`
      }
      const anchor =
        block !== null && block !== undefined && headingLevel(block.type) > 0
          ? `#${String(block.text ?? '').trim()}`
          : ''
      return `[[${name}${anchor}]]`
    }

    /** Path of a page created from a block: same folder, title from the block text. */
    function pagePathFor(notePath, title) {
      const source = String(notePath ?? '')
      const slash = source.lastIndexOf('/')
      const dir = slash < 0 ? '' : source.slice(0, slash + 1)
      const safe = String(title ?? '')
        .replace(/[\\/:*?"<>|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      return `${dir}${safe.length === 0 ? 'untitled' : safe}.md`
    }

    /** Which tab to open when switching by `delta` (used by touch swipe). */
    function nextTabId(tabs, current, delta) {
      if (!Array.isArray(tabs) || tabs.length < 2) return null
      const index = tabs.indexOf(current)
      if (index < 0) return null
      return tabs[(index + delta + tabs.length) % tabs.length] ?? null
    }

    /** YAML keys the properties panel may create; keeps arbitrary text out of the header. */
    function isValidFrontmatterKey(key) {
      return /^[A-Za-z0-9_-]+$/.test(String(key ?? '').trim())
    }

    /** Frontmatter key/value lines the properties panel shows read-only (editable ones excluded). */
    function frontmatterEntries(frontmatter) {
      const known = new Set(['tags', 'aliases', 'icon', 'cover'])
      const lines = String(frontmatter ?? '').split('\n')
      const entries = []
      for (let index = 0; index < lines.length; index += 1) {
        const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(lines[index].trim())
        if (match === null) continue
        if (known.has(match[1].toLowerCase())) continue
        let value = match[2]
        let multiline = false
        if (value.length === 0) {
          // A key with indented lines below it is a nested / multi-line YAML value.
          const nested = []
          let cursor = index + 1
          while (cursor < lines.length && /^\s+\S/.test(lines[cursor])) {
            nested.push(lines[cursor].trim())
            cursor += 1
          }
          if (nested.length > 0) {
            multiline = true
            value = nested.join(' ')
            index = cursor - 1
          }
        }
        entries.push(multiline ? { key: match[1], value, multiline: true } : { key: match[1], value })
      }
      return entries
    }

    /** The shortcut that turns plain text into a block type while typing. */
    function shortcutFor(text, currentType) {
      if (currentType !== 'paragraph') return null
      let match = /^(#{1,3})\s(.*)$/.exec(text)
      if (match !== null) return { type: `heading${match[1].length}`, text: match[2], checked: false }
      match = /^[-*+]\s\[([ xX])\]\s?(.*)$/.exec(text)
      if (match !== null) return { type: 'todo', checked: match[1].toLowerCase() === 'x', text: match[2] }
      match = /^[-*+]\s(.*)$/.exec(text)
      if (match !== null) return { type: 'bullet', text: match[1], checked: false }
      match = /^\d+[.)]\s(.*)$/.exec(text)
      if (match !== null) return { type: 'numbered', text: match[1], checked: false }
      match = /^>\s(.*)$/.exec(text)
      if (match !== null) return { type: 'quote', text: match[1], checked: false }
      if (text === '```') return { type: 'code', text: '', checked: false }
      if (text === '---' || text === '***' || text === '___') return { type: 'divider', text: '', checked: false }
      return null
    }

    /** Slash-menu search keywords per block type, beyond the visible label. */
    const TYPE_ALIASES = {
      paragraph: ['p', 'text', '正文', '文字'],
      heading1: ['h1', 'title', '标题', '大标题'],
      heading2: ['h2', '标题2', '中标题'],
      heading3: ['h3', '标题3', '小标题'],
      bullet: ['ul', 'list', 'bullet', '列表', '无序'],
      numbered: ['ol', 'number', '编号', '有序'],
      todo: ['task', 'check', 'todo', '待办', '任务'],
      quote: ['quote', '引用'],
      code: ['code', '代码'],
      divider: ['hr', 'divider', '分隔线', '分割线'],
    }

    function matchesSlash(type, label, query) {
      const needle = String(query ?? '').trim().toLowerCase()
      if (needle.length === 0) return true
      if (type.toLowerCase().includes(needle)) return true
      if (String(label).toLowerCase().includes(needle)) return true
      return (TYPE_ALIASES[type] ?? []).some((alias) => alias.toLowerCase().startsWith(needle))
    }

    /* ---------------- inline Markdown rendering ---------------- */

    /** `nb://template` links render as an in-page "new page from template" button. */
    const TEMPLATE_HREF = 'nb://template'

    function isTemplateHref(href) {
      return String(href ?? '').startsWith(TEMPLATE_HREF)
    }

    function safeHref(raw) {
      const value = String(raw).trim()
      if (/^https?:\/\//i.test(value) || /^mailto:/i.test(value)) return value
      return undefined
    }

    /** Resolve an image target: remote/data URLs pass through, vault paths go through the Host file route. */
    function attachmentSrc(raw) {
      const value = String(raw ?? '').trim()
      if (/^https?:\/\//i.test(value) || /^data:/i.test(value)) return value
      return `/notebook/api/file?path=${encodeURIComponent(value.replace(/^\.\//, ''))}`
    }

    function fileToBase64(file) {      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const result = String(reader.result ?? '')
          const comma = result.indexOf(',')
          resolve(comma < 0 ? '' : result.slice(comma + 1))
        }
        reader.onerror = () => reject(new Error('Could not read the pasted image.'))
        reader.readAsDataURL(file)
      })
    }

    function renderInline(text, keyPrefix, context) {
      const ctx = context ?? {}
      const depth = Number(ctx.depth) || 0
      const nodes = []
      let last = 0
      let count = 0
      const pattern =
        /(!\[\[[^\]\n]+\]\])|(!\[[^\]\n]*\]\([^)\n]+\)(?:\{width=\d+%\})?)|(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(~~[^~\n]+~~)|(\[\[[^\]\n]+\]\])|(\[[^\]\n]+\]\([^)\n]+\))|(\*[^*\n]+\*)|(_[^_\n]+_)/g
      let match
      while ((match = pattern.exec(text)) !== null) {
        if (match.index > last) nodes.push(text.slice(last, match.index))
        const token = match[0]
        const key = `${keyPrefix}-${count++}`
        if (token.startsWith('![[')) {
          const name = token.slice(3, -2).trim()
          if (depth >= 2) {
            nodes.push(h('span', { key, className: 'nb-wiki' }, name))
          } else {
            nodes.push(
              h(EmbeddedNote, {
                key,
                name,
                notes: ctx.notes ?? [],
                onOpen: ctx.onOpen,
                t: ctx.t,
                depth: depth + 1,
              }),
            )
          }
        } else if (token.startsWith('![')) {
          const image = /^!\[([^\]]*)\]\(([^)]+)\)(?:\{width=(\d+)%\})?$/.exec(token)
          if (image === null) {
            nodes.push(token)
          } else {
            const width = image[3] === undefined ? null : Number(image[3])
            nodes.push(
              h('img', {
                key,
                src: attachmentSrc(image[2]),
                alt: image[1],
                loading: 'lazy',
                className: 'nb-img',
                style: width !== null && Number.isFinite(width) ? { width: `${Math.max(10, Math.min(100, width))}%` } : undefined,
              }),
            )
          }
        } else if (token.startsWith('`')) {
          nodes.push(h('code', { key }, token.slice(1, -1)))
        } else if (token.startsWith('**') || token.startsWith('__')) {
          nodes.push(h('strong', { key }, token.slice(2, -2)))
        } else if (token.startsWith('~~')) {
          nodes.push(h('del', { key }, token.slice(2, -2)))
        } else if (token.startsWith('[[')) {
          nodes.push(h('span', { key, className: 'nb-wiki' }, token.slice(2, -2)))
        } else if (token.startsWith('[')) {
          const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
          if (link !== null && isTemplateHref(link[2])) {
            nodes.push(
              h(
                'button',
                {
                  key,
                  className: 'nb-template-button',
                  onMouseDown: (event) => event.stopPropagation(),
                  onClick: (event) => {
                    event.stopPropagation()
                    if (typeof ctx.onTemplate === 'function') ctx.onTemplate()
                  },
                },
                `＋ ${link[1]}`,
              ),
            )
          } else {
            const href = link === null ? undefined : safeHref(link[2])
            if (link === null || href === undefined) {
              nodes.push(token)
            } else {
              nodes.push(h('a', { key, href, target: '_blank', rel: 'noreferrer noopener' }, link[1]))
            }
          }
        } else {
          nodes.push(h('em', { key }, token.slice(1, -1)))
        }
        last = match.index + token.length
      }
      if (last < text.length) nodes.push(text.slice(last))
      return nodes
    }

    /** Read-only embed of another note inside a block, like Obsidian's `![[note]]`. */
    function EmbeddedNote({ name, notes, onOpen, t, depth }) {
      const labels = t ?? ((key) => key)
      const [expanded, setExpanded] = React.useState(false)
      const [state, setState] = React.useState({ loading: true, content: '', error: '' })
      React.useEffect(() => {
        let cancelled = false
        const target = findWikiTarget(notes, parseWikiLink(name).name)
        if (target === null) {
          setState({ loading: false, content: '', error: 'missing' })
          return () => {
            cancelled = true
          }
        }
        apiGet(`/read?path=${encodeURIComponent(target.path)}`)
          .then((data) => {
            if (!cancelled) setState({ loading: false, content: data.content, error: '' })
          })
          .catch((error) => {
            if (!cancelled) {
              setState({ loading: false, content: '', error: String((error && error.message) || error) })
            }
          })
        return () => {
          cancelled = true
        }
      }, [name, notes])

      const blocks = React.useMemo(() => {
        if (state.content === '') return []
        return parseBlocks(splitFrontmatter(state.content).body).slice(0, 40)
      }, [state.content])

      if (state.loading) return h('span', { className: 'nb-embed-loading' }, '…')
      if (state.error !== '') {
        return h(
          'span',
          { className: 'nb-embed-error', title: state.error === 'missing' ? '' : state.error },
          `![[${name}]]`,
        )
      }
      const visible = expanded ? blocks : blocks.slice(0, 12)
      return h(
        'div',
        { className: 'nb-embed' },
        h(
          'button',
          {
            className: 'nb-embed-title',
            onClick: (event) => {
              event.stopPropagation()
              if (typeof onOpen === 'function') onOpen(name)
            },
          },
          name,
        ),
        h(
          'div',
          { className: 'nb-embed-body' },
          visible.map((block) =>
            h(EmbeddedBlock, { key: block.id, block, notes, onOpen, t: labels, depth }),
          ),
        ),
        blocks.length > visible.length
          ? h(
              'button',
              {
                className: 'nb-embed-more',
                onClick: (event) => {
                  event.stopPropagation()
                  setExpanded(true)
                },
              },
              labels('expandAll'),
            )
          : expanded === true && blocks.length > 12
            ? h(
                'button',
                {
                  className: 'nb-embed-more',
                  onClick: (event) => {
                    event.stopPropagation()
                    setExpanded(false)
                  },
                },
                labels('collapseAll'),
              )
            : null,
      )
    }

    function EmbeddedBlock({ block, notes, onOpen, depth }) {
      const text = String(block.text ?? '')
      const indent = Math.min(3, Math.max(0, Number(block.indent) || 0))
      const style = indent > 0 ? { marginLeft: `${indent * 18}px` } : undefined
      const inline = renderInline(text, `embed-${block.id}`, { notes, onOpen, depth })
      switch (block.type) {
        case 'heading1':
          return h('div', { className: 'nb-embed-h1', style }, inline)
        case 'heading2':
          return h('div', { className: 'nb-embed-h2', style }, inline)
        case 'heading3':
          return h('div', { className: 'nb-embed-h3', style }, inline)
        case 'bullet':
          return h('div', { className: 'nb-embed-line', style }, '• ', inline)
        case 'numbered':
          return h('div', { className: 'nb-embed-line', style }, '1. ', inline)
        case 'todo':
          return h('div', { className: 'nb-embed-line', style }, block.checked === true ? '☑ ' : '☐ ', inline)
        case 'quote':
          return h('div', { className: 'nb-embed-quote', style }, inline)
        case 'callout':
          return h('div', { className: 'nb-embed-quote', style }, `${calloutIcon(block.variant)} `, inline)
        case 'code':
          return h('pre', { className: 'nb-embed-code', style }, text)
        case 'table':
          return h('div', { className: 'nb-embed-line', style }, `${Array.isArray(block.rows) ? block.rows.length : 0} 行表格`)
        case 'divider':
          return h('hr', { className: 'nb-embed-hr' })
        default:
          return h('div', { className: 'nb-embed-line', style }, inline)
      }
    }

    /* ---------------- caret helpers ---------------- */

    function caretOffset(element) {
      const value = element.textContent ?? ''
      const selection = window.getSelection ? window.getSelection() : null
      if (selection === null || selection.rangeCount === 0) return value.length
      const range = selection.getRangeAt(0)
      if (!element.contains(range.endContainer)) return value.length
      const clone = range.cloneRange()
      clone.selectNodeContents(element)
      clone.setEnd(range.endContainer, range.endOffset)
      return clone.toString().length
    }

    function placeCaret(element, offset) {
      const selection = window.getSelection ? window.getSelection() : null
      if (selection === null) return
      const range = document.createRange()
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      let remaining = Math.max(0, Number(offset) || 0)
      let node = walker.nextNode()
      let placed = false
      while (node !== null) {
        const length = (node.textContent ?? '').length
        if (remaining <= length) {
          range.setStart(node, remaining)
          range.collapse(true)
          placed = true
          break
        }
        remaining -= length
        node = walker.nextNode()
      }
      if (!placed) {
        range.selectNodeContents(element)
        range.collapse(false)
      }
      selection.removeAllRanges()
      selection.addRange(range)
    }

    /* ---------------- rich inline editing (Markdown <-> HTML) ----------------
     * While a block is focused it is a contentEditable RICH node: formatted
     * text looks formatted, not like its Markdown source. The model stays
     * Markdown, so the file on disk is unchanged and the rendered view and the
     * editor agree. Every conversion is pure and testable in Node.
     */

    const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }

    function escapeHtml(text) {
      return String(text ?? '').replace(/[&<>"]/g, (match) => ESCAPES[match])
    }

    function markdownToHtml(text) {
      const source = String(text ?? '')
      const pattern =
        /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(~~[^~\n]+~~)|(\[\[[^\]\n]+\]\])|(\[[^\]\n]+\]\([^)\n]+\))|(\*[^*\n]+\*)|(_[^_\n]+_)/g
      let out = ''
      let last = 0
      let match
      while ((match = pattern.exec(source)) !== null) {
        if (match.index > last) out += escapeHtml(source.slice(last, match.index))
        const token = match[0]
        if (token.startsWith('`')) {
          out += `<code>${escapeHtml(token.slice(1, -1))}</code>`
        } else if (token.startsWith('**') || token.startsWith('__')) {
          out += `<strong>${escapeHtml(token.slice(2, -2))}</strong>`
        } else if (token.startsWith('~~')) {
          out += `<del>${escapeHtml(token.slice(2, -2))}</del>`
        } else if (token.startsWith('[[')) {
          out += `<span class="nb-wiki">${escapeHtml(token.slice(2, -2))}</span>`
        } else if (token.startsWith('[')) {
          const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
          const href = link === null ? undefined : safeHref(link[2])
          if (link === null || href === undefined) out += escapeHtml(token)
          else out += `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener">${escapeHtml(link[1])}</a>`
        } else {
          out += `<em>${escapeHtml(token.slice(1, -1))}</em>`
        }
        last = match.index + token.length
      }
      if (last < source.length) out += escapeHtml(source.slice(last))
      return out
    }

    function nodeToMarkdown(node) {
      if (node === null || node === undefined) return ''
      if (node.nodeType === 3) return String(node.textContent ?? '')
      if (node.nodeType !== 1) return childrenToMarkdown(node)
      const tag = String(node.tagName ?? '').toLowerCase()
      const inner = childrenToMarkdown(node)
      if (tag === 'strong' || tag === 'b') return `**${inner}**`
      if (tag === 'em' || tag === 'i') return `*${inner}*`
      if (tag === 'code') {
        const value = String(node.textContent ?? '').replace(/\n/g, ' ')
        return value.length === 0 ? '' : `\`${value}\``
      }
      if (tag === 'del' || tag === 's' || tag === 'strike') return `~~${inner}~~`
      if (tag === 'a') {
        const href = typeof node.getAttribute === 'function' ? node.getAttribute('href') : ''
        return `[${inner}](${href ?? ''})`
      }
      if (tag === 'br') return '\n'
      if (tag === 'span') {
        const className = typeof node.getAttribute === 'function' ? node.getAttribute('class') : ''
        if (String(className ?? '').includes('nb-wiki')) return `[[${inner}]]`
      }
      return inner
    }

    function childrenToMarkdown(element) {
      const children = element !== null && element !== undefined && element.childNodes ? Array.from(element.childNodes) : []
      let out = ''
      for (const child of children) out += nodeToMarkdown(child)
      return out
    }

    /**
     * A block whose text is empty (or only newlines left by an empty `<br>`)
     * counts as blank, so Backspace on it can delete the block again.
     */
    function isBlankBlockText(text) {
      return String(text ?? '').replace(/\n/g, '') === ''
    }

    function htmlToMarkdown(element) {
      if (element === null || element === undefined) return ''
      return childrenToMarkdown(element)
    }

    /** Split the focused block's DOM at the caret and convert each half back to Markdown. */
    /**
     * Inline Markdown that completes at the caret turns into formatted DOM as
     * soon as the closing marker is typed, so `**bold**` looks bold while
     * typing instead of after blurring.
     */
    const INLINE_CONVERT_RULES = [
      { re: /(\*\*)([^*\n]+)(\*\*)$/, tag: 'strong' },
      { re: /(~~)([^~\n]+)(~~)$/, tag: 'del' },
      { re: /(`)([^`\n]+)(`)$/, tag: 'code' },
      { re: /(\*)([^*\n]+)(\*)$/, tag: 'em' },
    ]

    function matchInlineConvert(before) {
      for (const rule of INLINE_CONVERT_RULES) {
        const match = rule.re.exec(before)
        if (match !== null) {
          return {
            length: match[0].length,
            html: `<${rule.tag}>${escapeHtml(match[2])}</${rule.tag}>`,
          }
        }
      }
      return null
    }

    /** Replace a just-completed inline run before the caret with its formatted DOM. */
    function convertInlineAtCaret(element) {
      const selection = window.getSelection ? window.getSelection() : null
      if (selection === null || selection.rangeCount === 0 || !selection.isCollapsed) return false
      const range = selection.getRangeAt(0)
      const node = range.startContainer
      if (node === null || node.nodeType !== 3) return false
      if (element.contains(node) !== true) return false
      const before = String(node.textContent ?? '').slice(0, range.startOffset)
      const match = matchInlineConvert(before)
      if (match === null) return false
      const start = range.startOffset - match.length
      if (start < 0) return false
      const convert = document.createRange()
      convert.setStart(node, start)
      convert.setEnd(node, range.startOffset)
      selection.removeAllRanges()
      selection.addRange(convert)
      try {
        document.execCommand('insertHTML', false, match.html)
      } catch {
        return false
      }
      return true
    }

    function splitElementAtCaret(element) {
      const selection = window.getSelection ? window.getSelection() : null
      if (selection === null || selection.rangeCount === 0) return null
      const range = selection.getRangeAt(0)
      if (element.contains(range.startContainer) !== true) return null
      const leftRange = document.createRange()
      leftRange.selectNodeContents(element)
      leftRange.setEnd(range.startContainer, range.startOffset)
      const rightRange = document.createRange()
      rightRange.selectNodeContents(element)
      rightRange.setStart(range.endContainer, range.endOffset)
      return {
        left: htmlToMarkdown(leftRange.cloneContents()),
        right: htmlToMarkdown(rightRange.cloneContents()),
      }
    }

    /**
     * Lightweight code highlighting for the displayed (not focused) code block.
     * Comments, strings, numbers and keywords get theme tokens; everything else
     * stays plain, so an unknown language degrades to plain text.
     */
    const CODE_KEYWORDS = new Set([
      'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'class', 'import',
      'from', 'export', 'async', 'await', 'new', 'try', 'catch', 'throw', 'typeof', 'instanceof',
      'this', 'null', 'undefined', 'true', 'false', 'def', 'elif', 'lambda', 'fn', 'pub', 'use',
      'struct', 'enum', 'impl', 'match', 'mod', 'package', 'func', 'type', 'interface', 'public',
      'private', 'static', 'void', 'int', 'char', 'string', 'bool', 'switch', 'case', 'break',
      'continue', 'default', 'do', 'in', 'is', 'not', 'and', 'or', 'nil', 'None', 'True', 'False',
    ])

    /** Wrap search-query occurrences in <mark>, for the search result rows. */
    function highlightText(text, query) {
      const source = String(text ?? '')
      const needle = String(query ?? '').trim()
      if (needle.length === 0) return source
      const lower = source.toLowerCase()
      const target = needle.toLowerCase()
      const nodes = []
      let index = 0
      let count = 0
      for (;;) {
        const found = lower.indexOf(target, index)
        if (found < 0) break
        if (found > index) nodes.push(source.slice(index, found))
        nodes.push(h('mark', { key: `m${count++}`, className: 'nb-mark' }, source.slice(found, found + target.length)))
        index = found + target.length
      }
      if (nodes.length === 0) return source
      if (index < source.length) nodes.push(source.slice(index))
      return nodes
    }

    function highlightCode(text) {
      const source = String(text ?? '')
      const pattern =
        /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*)|('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`)|\b(0x[0-9A-Fa-f]+|\d+(?:\.\d+)?)\b|\b([A-Za-z_$][\w$]*)\b/g
      const nodes = []
      let last = 0
      let count = 0
      let match
      while ((match = pattern.exec(source)) !== null) {
        if (match.index > last) nodes.push(source.slice(last, match.index))
        const token = match[0]
        let className = null
        if (match[1] !== undefined) className = 'c-comment'
        else if (match[2] !== undefined) className = 'c-string'
        else if (match[3] !== undefined) className = 'c-number'
        else if (match[4] !== undefined && CODE_KEYWORDS.has(match[4])) className = 'c-keyword'
        if (className === null) nodes.push(token)
        else nodes.push(h('span', { key: `c${count++}`, className }, token))
        last = match.index + token.length
      }
      if (last < source.length) nodes.push(source.slice(last))
      return nodes
    }

    /* ---------------- components ---------------- */

    function NotebookGlyph({ size = 22, active }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: active === true ? 1.9 : 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          style: { display: 'block' },
        },
        h('path', { d: 'M5 4.5h11.5a1.5 1.5 0 0 1 1.5 1.5v12.5a1.5 1.5 0 0 1-1.5 1.5H5z' }),
        h('path', { d: 'M8 8.2h6.5M8 11.6h7M8 15h4.5' }),
        h('path', { d: 'M5 4.5H3.6a1.1 1.1 0 0 0 0 2.2H5M5 11.2H3.6a1.1 1.1 0 0 0 0 2.2H5M5 17.9H3.6a1.1 1.1 0 0 0 0 2.2H5' }),
      )
    }

    function useLocaleTick(locale) {
      const [, force] = React.useReducer((value) => value + 1, 0)
      React.useEffect(() => {
        if (locale === undefined || locale === null || typeof locale.subscribe !== 'function') return undefined
        return locale.subscribe(() => force())
      }, [locale])
    }

    function TableCell({ value, rowIndex, colIndex, align, onFocusCell, onChange, onNavigate }) {
      const ref = React.useRef(null)
      React.useEffect(() => {
        // The cell owns its text while focused; only a fresh mount seeds it.
        // Newlines are stored as `<br>` so a cell can hold more than one line.
        if (ref.current !== null) {
          const html = escapeHtml(String(value ?? '')).replace(/\n/g, '<br>')
          if (ref.current.innerHTML !== html) ref.current.innerHTML = html
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])
      return h('div', {
        ref,
        className: 'nb-cell',
        contentEditable: true,
        suppressContentEditableWarning: true,
        spellCheck: false,
        style: align === 'center' ? { textAlign: 'center' } : align === 'right' ? { textAlign: 'right' } : undefined,
        'data-row': rowIndex,
        'data-col': colIndex,
        onFocus: () => onFocusCell(rowIndex, colIndex),
        onInput: (event) => {
          const element = event.currentTarget
          // innerText turns <br> back into newlines; textContent keeps none.
          const raw = typeof element.innerText === 'string' ? element.innerText : (element.textContent ?? '')
          onChange(rowIndex, colIndex, raw.replace(/\n$/, ''))
        },
        onKeyDown: (event) => {
          if (event.key === 'Tab') {
            event.preventDefault()
            onNavigate(event.shiftKey ? 'prev' : 'next')
            return
          }
          if (event.key === 'Enter') {
            if (event.shiftKey) {
              event.preventDefault()
              if (typeof document.execCommand === 'function') {
                document.execCommand('insertHTML', false, '<br>')
              }
              return
            }
            event.preventDefault()
            onNavigate('down')
          }
        },
      })
    }

    function TableView({ block, t, onChange, onResize, onMoveColumn }) {
      const rawRows = Array.isArray(block.rows) && block.rows.length > 0 ? block.rows : [['', '']]
      const width = Math.max(1, ...rawRows.map((row) => (Array.isArray(row) ? row.length : 0)))
      const rows = rawRows.map((row) =>
        Array.from({ length: width }, (_, column) => String((row ?? [])[column] ?? '')),
      )
      const [active, setActive] = React.useState(null)
      const tableRef = React.useRef(null)
      const [widths, setWidths] = React.useState(() => {
        if (Array.isArray(block.colWidths) && block.colWidths.length === width) return block.colWidths.slice()
        return Array.from({ length: width }, () => Math.round((100 / width) * 100) / 100)
      })
      const widthsRef = React.useRef(widths)

      React.useEffect(() => {
        widthsRef.current = widths
      }, [widths])

      React.useEffect(() => {
        setWidths((current) =>
          current.length === width
            ? current
            : Array.from({ length: width }, () => Math.round((100 / width) * 100) / 100),
        )
      }, [width])

      function startResize(column, event) {
        event.preventDefault()
        event.stopPropagation()
        const table = tableRef.current
        if (table === null || typeof table.getBoundingClientRect !== 'function') return
        const total = table.getBoundingClientRect().width
        if (total <= 0) return
        const startX = event.clientX
        const start = widths.slice()
        function onMove(moveEvent) {
          const delta = ((moveEvent.clientX - startX) / total) * 100
          const left = Math.max(8, Math.min(92, start[column] + delta))
          const right = start[column] + start[column + 1] - left
          if (right < 8) return
          const next = start.slice()
          next[column] = left
          next[column + 1] = right
          setWidths(next)
        }
        function onUp() {
          document.removeEventListener('mousemove', onMove)
          document.removeEventListener('mouseup', onUp)
          if (typeof onResize === 'function') onResize(block.id, widthsRef.current)
        }
        document.addEventListener('mousemove', onMove)
        document.addEventListener('mouseup', onUp)
      }

      function focusCell(row, column) {
        const root = tableRef.current
        if (root === null || typeof root.querySelector !== 'function') return
        const target = root.querySelector(`[data-row="${row}"][data-col="${column}"]`)
        if (target !== null && typeof target.focus === 'function') target.focus()
      }

      function navigate(direction) {
        if (active === null) return
        let row = active.row
        let column = active.col
        if (direction === 'next') {
          column += 1
          if (column >= width) {
            column = 0
            row += 1
          }
        } else if (direction === 'prev') {
          column -= 1
          if (column < 0) {
            column = width - 1
            row -= 1
          }
        } else if (direction === 'down') {
          row += 1
        } else {
          row -= 1
        }
        row = Math.max(0, Math.min(rows.length - 1, row))
        column = Math.max(0, Math.min(width - 1, column))
        focusCell(row, column)
      }

      function setCell(rowIndex, colIndex, value) {
        onChange(
          rows.map((row, r) => (r === rowIndex ? row.map((cell, c) => (c === colIndex ? value : cell)) : row)),
        )
      }
      function addRow() {
        const at = active === null ? rows.length : active.row + 1
        const next = [...rows]
        next.splice(at, 0, Array.from({ length: width }, () => ''))
        onChange(next)
        setActive({ row: at, col: 0 })
      }
      function addColumn() {
        const at = active === null ? width : active.col + 1
        onChange(
          rows.map((row) => {
            const copy = [...row]
            copy.splice(at, 0, '')
            return copy
          }),
        )
        setActive({ row: active === null ? 0 : active.row, col: at })
      }
      function removeRow() {
        if (active === null || rows.length <= 2) return
        onChange(rows.filter((_, r) => r !== active.row))
        setActive(null)
      }
      function removeColumn() {
        if (active === null || width <= 1) return
        onChange(rows.map((row) => row.filter((_, c) => c !== active.col)))
        setActive(null)
      }

      function startRowDrag(rowOffset, event) {
        event.preventDefault()
        event.stopPropagation()
        const table = tableRef.current
        if (table === null) return
        const domRows = Array.from(table.querySelectorAll('tbody tr'))
        if (domRows.length === 0) return
        const from = rowOffset + 1
        let target = from
        function onMove(moveEvent) {
          domRows.forEach((row, index) => {
            const rect = row.getBoundingClientRect()
            const over = moveEvent.clientY >= rect.top && moveEvent.clientY <= rect.bottom
            row.classList.toggle('drag-over', over)
            if (over) target = index + 1
          })
        }
        function onUp() {
          document.removeEventListener('mousemove', onMove)
          document.removeEventListener('mouseup', onUp)
          domRows.forEach((row) => row.classList.remove('drag-over'))
          if (target === from) return
          onChange(moveTableRow(rows, from, target))
        }
        document.addEventListener('mousemove', onMove)
        document.addEventListener('mouseup', onUp)
      }

      function startColumnDrag(column, event) {
        event.preventDefault()
        event.stopPropagation()
        const table = tableRef.current
        if (table === null) return
        const domColumns = Array.from(table.querySelectorAll('thead th'))
        if (domColumns.length < 2) return
        let target = column
        function onMove(moveEvent) {
          domColumns.forEach((cellNode, index) => {
            const rect = cellNode.getBoundingClientRect()
            const over = moveEvent.clientX >= rect.left && moveEvent.clientX <= rect.right
            cellNode.classList.toggle('drag-over', over)
            if (over) target = index
          })
        }
        function onUp() {
          document.removeEventListener('mousemove', onMove)
          document.removeEventListener('mouseup', onUp)
          domColumns.forEach((cellNode) => cellNode.classList.remove('drag-over'))
          if (target === column) return
          if (typeof onMoveColumn === 'function') onMoveColumn(block.id, column, target)
        }
        document.addEventListener('mousemove', onMove)
        document.addEventListener('mouseup', onUp)
      }

      function cell(rowIndex, colIndex, value) {
        return h(TableCell, {
          key: `${block.id}-${rowIndex}-${colIndex}`,
          value,
          rowIndex,
          colIndex,
          align: Array.isArray(block.aligns) ? block.aligns[colIndex] : 'left',
          onFocusCell: (r, c) => setActive({ row: r, col: c }),
          onChange: setCell,
          onNavigate: navigate,
        })
      }

      return h(
        'div',
        { className: 'nb-table-wrap' },
        h(
          'table',
          { className: 'nb-table', ref: tableRef },
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              rows[0].map((value, column) =>
                h(
                  'th',
                  { key: `head-${column}`, style: { width: `${widths[column] ?? 100 / width}%` } },
                  width > 1
                    ? h(
                        'span',
                        {
                          className: 'nb-col-handle',
                          title: t('moveColumn'),
                          'aria-label': t('moveColumn'),
                          onMouseDown: (event) => startColumnDrag(column, event),
                        },
                        '⋮⋮',
                      )
                    : null,
                  cell(0, column, value),
                  column < width - 1
                    ? h('span', {
                        className: 'nb-col-resize',
                        onMouseDown: (event) => startResize(column, event),
                      })
                    : null,
                ),
              ),
            ),
          ),
          h(
            'tbody',
            null,
            rows
              .slice(1)
              .map((row, rowOffset) =>
                h(
                  'tr',
                  { key: `row-${rowOffset + 1}`, className: 'nb-table-row' },
                  row.map((value, column) =>
                    h(
                      'td',
                      { key: `cell-${column}` },
                      column === 0
                        ? h(
                            'span',
                            {
                              className: 'nb-row-handle',
                              title: t('moveRow'),
                              'aria-label': t('moveRow'),
                              onMouseDown: (event) => startRowDrag(rowOffset, event),
                            },
                            '⋮⋮',
                          )
                        : null,
                      cell(rowOffset + 1, column, value),
                    ),
                  ),
                ),
              ),
          ),
        ),
        h(
          'div',
          { className: 'nb-table-actions' },
          h('button', { onMouseDown: (event) => event.preventDefault(), onClick: addRow }, `+ ${t('tableRow')}`),
          h('button', { onMouseDown: (event) => event.preventDefault(), onClick: addColumn }, `+ ${t('tableCol')}`),
          active !== null && rows.length > 2
            ? h(
                'button',
                { onMouseDown: (event) => event.preventDefault(), onClick: removeRow },
                `- ${t('tableRow')}`,
              )
            : null,
          active !== null && width > 1
            ? h(
                'button',
                { onMouseDown: (event) => event.preventDefault(), onClick: removeColumn },
                `- ${t('tableCol')}`,
              )
            : null,
        ),
      )
    }

    const BLOCK_CLASS = {
      paragraph: 'p',
      heading1: 'h1',
      heading2: 'h2',
      heading3: 'h3',
      bullet: 'bullet',
      numbered: 'numbered',
      todo: 'todo',
      quote: 'quote',
      callout: 'callout',
      toggle: 'toggle',
      code: 'code',
      divider: 'divider',
    }

    const CALLOUT_ICONS = {
      note: '💡',
      tip: '🔥',
      warning: '⚠️',
      danger: '🚫',
      info: 'ℹ️',
      question: '❓',
      success: '✅',
      quote: '💬',
      example: '📌',
    }

    function calloutIcon(variant) {
      const key = String(variant ?? 'note').toLowerCase()
      return CALLOUT_ICONS[key] ?? CALLOUT_ICONS.note
    }

    function formatBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes < 0) return '?'
      if (bytes < 1024) return `${bytes} B`
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
      return `${(bytes / 1024 / 1024).toFixed(1)} MB`
    }

    function formatHistoryTime(ms) {
      try {
        return new Date(ms).toLocaleString('zh-CN', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      } catch {
        return ''
      }
    }

    /**
     * Line diff (longest common subsequence). Normal notes get a precise diff;
     * very large inputs degrade to a coarse replace so the panel never stalls.
     */
    function diffLines(before, after) {
      const a = String(before ?? '').replace(/\r\n?/g, '\n').split('\n')
      const b = String(after ?? '').replace(/\r\n?/g, '\n').split('\n')
      if (a.length * b.length > 400000) {
        return [
          ...a.map((line) => ({ type: 'remove', text: line })),
          ...b.map((line) => ({ type: 'add', text: line })),
        ]
      }
      const cols = b.length + 1
      const table = new Uint32Array((a.length + 1) * cols)
      const at = (row, col) => row * cols + col
      for (let row = a.length - 1; row >= 0; row -= 1) {
        for (let col = b.length - 1; col >= 0; col -= 1) {
          table[at(row, col)] =
            a[row] === b[col]
              ? table[at(row + 1, col + 1)] + 1
              : Math.max(table[at(row + 1, col)], table[at(row, col + 1)])
        }
      }
      const result = []
      let row = 0
      let col = 0
      while (row < a.length && col < b.length) {
        if (a[row] === b[col]) {
          result.push({ type: 'same', text: a[row] })
          row += 1
          col += 1
        } else if (table[at(row + 1, col)] >= table[at(row, col + 1)]) {
          result.push({ type: 'remove', text: a[row] })
          row += 1
        } else {
          result.push({ type: 'add', text: b[col] })
          col += 1
        }
      }
      while (row < a.length) {
        result.push({ type: 'remove', text: a[row] })
        row += 1
      }
      while (col < b.length) {
        result.push({ type: 'add', text: b[col] })
        col += 1
      }
      return result
    }

    /**
     * Trim a diff to changed lines plus `context` unchanged lines around them;
     * a run of unchanged lines in between becomes one skip entry. A diff with
     * no changes collapses to an empty list.
     */
    function collapseDiff(diff, context = 3) {
      const lines = Array.isArray(diff) ? diff : []
      const keep = new Array(lines.length).fill(false)
      let changed = false
      for (let index = 0; index < lines.length; index += 1) {
        if (lines[index].type === 'same') continue
        changed = true
        for (let offset = -context; offset <= context; offset += 1) {
          const target = index + offset
          if (target >= 0 && target < lines.length) keep[target] = true
        }
      }
      if (!changed) return []
      const result = []
      let skipped = 0
      for (let index = 0; index < lines.length; index += 1) {
        if (keep[index]) {
          if (skipped > 0) {
            result.push({ type: 'skip', count: skipped })
            skipped = 0
          }
          result.push(lines[index])
        } else {
          skipped += 1
        }
      }
      if (skipped > 0) result.push({ type: 'skip', count: skipped })
      return result
    }

    /** One block as standalone HTML, for the HTML export. */
    function blockToHtml(block) {
      const text = String(block.text ?? '')
      const indent = Math.min(3, Math.max(0, Number(block.indent) || 0))
      const style = indent > 0 ? ` style="margin-left:${indent * 24}px"` : ''
      switch (block.type) {
        case 'heading1':
          return `<h1${style}>${markdownToHtml(text)}</h1>`
        case 'heading2':
          return `<h2${style}>${markdownToHtml(text)}</h2>`
        case 'heading3':
          return `<h3${style}>${markdownToHtml(text)}</h3>`
        case 'bullet':
          return `<ul${style}><li>${markdownToHtml(text)}</li></ul>`
        case 'numbered':
          return `<ol${style}><li>${markdownToHtml(text)}</li></ol>`
        case 'todo':
          return `<p${style}>${block.checked === true ? '☑' : '☐'} ${markdownToHtml(text)}</p>`
        case 'quote':
          return `<blockquote${style}>${markdownToHtml(text)}</blockquote>`
        case 'callout':
          return `<blockquote${style}><strong>${calloutIcon(block.variant)}</strong> ${markdownToHtml(text)}</blockquote>`
        case 'code':
          return `<pre${style}><code>${escapeHtml(text)}</code></pre>`
        case 'table': {
          const rows = Array.isArray(block.rows) ? block.rows : []
          const aligns = Array.isArray(block.aligns) ? block.aligns : []
          const cell = (value, column, header) => {
            const align = aligns[column] ?? 'left'
            return `<${header ? 'th' : 'td'} style="text-align:${align}">${escapeHtml(String(value ?? ''))}</${header ? 'th' : 'td'}>`
          }
          const head = rows.length > 0 ? `<thead><tr>${rows[0].map((value, column) => cell(value, column, true)).join('')}</tr></thead>` : ''
          const body = rows.length > 1 ? `<tbody>${rows.slice(1).map((row) => `<tr>${row.map((value, column) => cell(value, column, false)).join('')}</tr>`).join('')}</tbody>` : ''
          return `<table>${head}${body}</table>`
        }
        case 'divider':
          return '<hr>'
        default:
          return `<p${style}>${markdownToHtml(text)}</p>`
      }
    }

    function BlockView(props) {
      const {
        block,
        index,
        editing,
        menuOpen,
        focusRequest,
        number,
        t,
        onBegin,
        onText,
        onConvert,
        onSplit,
        onRemove,
        onToggleTodo,
        onMenu,
        onType,
        onMove,
        onDelete,
        onFocusConsumed,
        onInsertAfter,
        onCloseMenu,
        slashQuery,
        onSlash,
        wikiQuery,
        onWiki,
        onPickWiki,
        onPick,
        onPasteBlocks,
        onUploadImages,
        onTableChange,
        onTableResize,
        onTableMoveColumn,
        onToggleBlock,
        onOpenWiki,
        onExtractPage,
        onAi,
        onTemplate,
        onCopyLink,
        notes,
        dragging,
        dropMark,
        onDragStart,
        selected,
        onShiftSelect,
        collapsible,
        collapsed,
        onToggleCollapse,
        tableRevision,
        onSetLang,
        onImageSelect,
        onLinkSelect,
        onIndent,
      } = props
      const editRef = React.useRef(null)
      const renderRef = React.useRef(null)
      const convertingRef = React.useRef(false)
      const longPressTimer = React.useRef(null)
      const longPressed = React.useRef(false)
      const [langOpen, setLangOpen] = React.useState(false)

      React.useEffect(() => {
        if (!langOpen) return undefined
        const close = () => setLangOpen(false)
        const timer = setTimeout(() => document.addEventListener('mousedown', close), 0)
        return () => {
          clearTimeout(timer)
          document.removeEventListener('mousedown', close)
        }
      }, [langOpen])

      React.useEffect(() => {
        if (!editing) return
        const element = editRef.current
        if (element === null) return
        // The focused block is rich text: formatted runs look formatted instead
        // of showing their Markdown markers. The model keeps Markdown.
        element.innerHTML = block.type === 'code' ? escapeHtml(block.text ?? '') : markdownToHtml(block.text ?? '')
        element.focus()
        const visible = (element.textContent ?? '').length
        if (focusRequest !== null && focusRequest.id === block.id) {
          const source = (block.text ?? '').length
          const ratio =
            focusRequest.offset === 'end'
              ? 1
              : Math.min(1, Math.max(0, Number(focusRequest.offset) / (source === 0 ? 1 : source)))
          placeCaret(element, Math.round(ratio * visible))
          onFocusConsumed()
        } else {
          placeCaret(element, visible)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [editing, block.id])

      function beginEditing(event) {
        if (longPressed.current === true) {
          longPressed.current = false
          return
        }
        const anchor =
          event.target !== null && typeof event.target.closest === 'function'
            ? event.target.closest('a')
            : null
        if (anchor !== null) {
          event.preventDefault()
          event.stopPropagation()
          onLinkSelect(block.id, anchor.getAttribute('href') ?? '', event.clientX, event.clientY)
          return
        }
        const wiki =
          event.target !== null && typeof event.target.closest === 'function'
            ? event.target.closest('.nb-wiki')
            : null
        if (wiki !== null) {
          event.preventDefault()
          event.stopPropagation()
          onOpenWiki(wiki.textContent ?? '')
          return
        }
        if (event.target !== null && event.target.tagName === 'IMG') {
          event.preventDefault()
          event.stopPropagation()
          onImageSelect(block.id, event.target.getAttribute('alt') ?? '', event.clientX, event.clientY)
          return
        }
        if (event.shiftKey === true) {
          event.preventDefault()
          onShiftSelect(block.id)
          return
        }
        if (block.type === 'divider') {
          onMenu(block.id)
          return
        }
        let offset = 'end'
        const element = renderRef.current
        if (element !== null) {
          const rect = element.getBoundingClientRect()
          const ratio = rect.width > 0 ? Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) : 1
          offset = Math.round(ratio * (block.text ?? '').length)
        }
        onBegin(block.id, offset)
      }

      function handleInput(event) {
        const element = event.currentTarget
        let text = htmlToMarkdown(element)
        // Deleting the last character leaves a placeholder `<br>` behind, which
        // converts to a lone newline; keep the stored text truly empty instead.
        if (text !== '' && isBlankBlockText(text)) text = ''
        // Typing `[[` opens note suggestions; the open brackets must be the last
        // thing in the block so text that merely contains `[[` does not trigger it.
        const wikiQueryText = wikiQueryFor(text)
        if (wikiQueryText !== null) {
          const rect =
            typeof element.getBoundingClientRect === 'function'
              ? element.getBoundingClientRect()
              : { bottom: 0, left: 0 }
          onWiki(block.id, wikiQueryText, rect)
          onText(block.id, text)
          return
        }
        if (wikiQuery !== null) onWiki(block.id, null, null)
        const emoji = emojiAtEnd(text)
        if (emoji !== null && /<[a-z]/i.test(element.innerHTML) === false) {
          const next = text.slice(0, text.length - emoji.code.length - 2) + emoji.emoji
          element.textContent = next
          placeCaret(element, next.length)
          onText(block.id, next)
          return
        }
        // A leading slash opens the insert menu with the rest of the text as its
        // filter, like Notion. Markdown shortcuts stay out of the way while that
        // menu is open so "/quote" is a search, not a type conversion.
        if (text.startsWith('/')) {
          onSlash(block.id, text.slice(1))
          onText(block.id, text)
          return
        }
        if (slashQuery !== null) onSlash(block.id, null)
        const shortcut = shortcutFor(text, block.type)
        if (shortcut !== null) {
          onConvert(block.id, shortcut, text)
          element.textContent = shortcut.text
          placeCaret(element, shortcut.text.length)
          return
        }
        const composing = event.nativeEvent !== undefined && event.nativeEvent.isComposing === true
        if (!composing && convertingRef.current !== true) {
          convertingRef.current = true
          try {
            if (convertInlineAtCaret(element)) {
              onText(block.id, htmlToMarkdown(element))
              return
            }
          } finally {
            convertingRef.current = false
          }
        }
        onText(block.id, text)
      }

      function insertPlainText(text) {
        const element = editRef.current
        if (element === null) return
        const selection = window.getSelection ? window.getSelection() : null
        if (selection === null || selection.rangeCount === 0) {
          element.textContent = `${element.textContent ?? ''}${text}`
          onText(block.id, htmlToMarkdown(element))
          return
        }
        const range = selection.getRangeAt(0)
        range.deleteContents()
        const node = document.createTextNode(text)
        range.insertNode(node)
        range.setStartAfter(node)
        range.collapse(true)
        selection.removeAllRanges()
        selection.addRange(range)
        onText(block.id, htmlToMarkdown(element))
      }

      function handleKeyDown(event) {
        if (wikiQuery !== null) {
          if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault()
            onPickWiki(block.id)
            return
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            onWiki(block.id, null, null)
            return
          }
        }
        if (slashQuery !== null) {
          if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault()
            const first = typeItems.filter(([type, label]) => matchesSlash(type, label, slashQuery))[0]
            if (first !== undefined) {
              event.currentTarget.textContent = ''
              onPick(block.id, first[0])
            }
            return
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            onSlash(block.id, null)
            return
          }
        }
        if ((event.metaKey || event.ctrlKey) && (event.key.toLowerCase() === 'b' || event.key.toLowerCase() === 'i')) {
          event.preventDefault()
          try {
            document.execCommand(event.key.toLowerCase() === 'b' ? 'bold' : 'italic')
          } catch {
            /* execCommand is legacy, but it is the only inline formatter a plain bundle has */
          }
          onText(block.id, htmlToMarkdown(event.currentTarget))
          return
        }
        if (event.key === 'Tab') {
          event.preventDefault()
          if (block.type === 'code' && event.shiftKey !== true) {
            insertPlainText('  ')
            return
          }
          onIndent(block.id, event.shiftKey ? -1 : 1)
          return
        }
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          if (block.type === 'code') {
            insertPlainText('\n')
            return
          }
          // Split the rich DOM at the caret and convert each half back to
          // Markdown, so formatting survives the split.
          const parts = splitElementAtCaret(event.currentTarget)
          if (parts !== null) onSplit(block.id, parts.left, parts.right)
          else onSplit(block.id, block.text ?? '', '')
          return
        }
        if (event.key === 'Enter' && event.shiftKey) {
          event.preventDefault()
          insertPlainText('\n')
          return
        }
        if (
          event.key === 'Backspace' &&
          (isBlankBlockText(block.text) || isBlankBlockText(htmlToMarkdown(event.currentTarget)))
        ) {
          event.preventDefault()
          // An empty styled block steps back to plain text first (Notion's
          // behaviour); only an empty paragraph itself merges into the previous
          // block.
          if (block.type !== 'paragraph') {
            onType(block.id, 'paragraph')
          } else {
            onRemove(block.id)
          }
          return
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          event.currentTarget.blur()
          return
        }
        if (event.key === '/' && (block.text ?? '') === '') {
          // A quiet hint that types are reachable from here; the menu opens on
          // the block and the text stays empty until the user picks one.
          event.preventDefault()
          onMenu(block.id)
        }
      }

      function handlePaste(event) {
        const clipboard = event.clipboardData
        if (clipboard === null || clipboard === undefined) return
        const items = clipboard.items ? Array.from(clipboard.items) : []
        const images = items
          .filter((item) => item.kind === 'file' && String(item.type).startsWith('image/'))
          .map((item) => item.getAsFile())
          .filter((file) => file !== null)
        if (images.length > 0) {
          event.preventDefault()
          onUploadImages(images, block.id)
          return
        }
        const text = clipboard.getData('text/plain')
        event.preventDefault()
        // Pasting block-structured Markdown builds blocks, the way Notion does;
        // a single line pastes inline at the caret.
        const blockish = /(^|\n)\s*(#{1,6}\s|[-*+]\s|>|\d+[.)]\s|```)/.test(text) || text.includes('\n')
        if (blockish) {
          onPasteBlocks(block.id, text)
          return
        }
        insertPlainText(text)
      }

      function handleBlur() {
        if (menuOpen) return
        if (wikiQuery !== null) onWiki(block.id, null, null)
        onBegin(null, null)
      }

      /** Long-press on touch devices opens the block menu (no right click there). */
      function cancelLongPress() {
        if (longPressTimer.current !== null) {
          clearTimeout(longPressTimer.current)
          longPressTimer.current = null
        }
      }

      function handleTouchStart(event) {
        if (event.touches !== undefined && event.touches.length > 1) {
          cancelLongPress()
          return
        }
        cancelLongPress()
        longPressTimer.current = setTimeout(() => {
          longPressTimer.current = null
          longPressed.current = true
          onMenu(block.id)
        }, 500)
      }

      function handleTouchEnd() {
        cancelLongPress()
      }

      const cls = BLOCK_CLASS[block.type] ?? 'p'
      const text = block.text ?? ''
      const placeholder =
        block.type === 'heading1' || block.type === 'heading2' || block.type === 'heading3'
          ? t('placeholderTitle')
          : block.type === 'code'
            ? '```'
            : t('placeholderText')

      let prefix = null
      let body = null

      if (block.type === 'table') {
        body = h(TableView, {
          key: `table-${block.id}-${tableRevision}`,
          block,
          t,
          onChange: (rows) => onTableChange(block.id, rows),
          onResize: (id, widths) => onTableResize(id, widths),
          onMoveColumn: (id, from, to) => onTableMoveColumn(id, from, to),
        })
      } else if (editing) {
        body = h('div', {
          // A distinct key from the display branch forces React to replace this
          // DOM node instead of reusing it. Reusing it is what duplicated text:
          // a contentEditable node filled outside React keeps its text nodes, and
          // when the controlled children came back React appended them on top.
          key: 'edit',
          ref: editRef,
          className: `nb-b nb-b-${cls} nb-b-edit`,
          contentEditable: true,
          suppressContentEditableWarning: true,
          spellCheck: false,
          'data-placeholder': placeholder,
          onInput: handleInput,
          onKeyDown: handleKeyDown,
          onPaste: handlePaste,
          onDrop: (event) => {
            const files = event.dataTransfer && event.dataTransfer.files ? Array.from(event.dataTransfer.files) : []
            const images = files.filter((file) => String(file.type).startsWith('image/'))
            if (images.length === 0) return
            event.preventDefault()
            event.stopPropagation()
            onUploadImages(images, block.id)
          },
          onDragOver: (event) => {
            const types = event.dataTransfer && event.dataTransfer.types ? Array.from(event.dataTransfer.types) : []
            if (types.includes('Files')) event.preventDefault()
          },
          onBlur: handleBlur,
        })
      } else {
        const inline =
          text.length > 0
            ? renderInline(text, block.id, { notes, onOpen: onOpenWiki, t, depth: 0, onTemplate })
            : null
        let content = inline
        if (block.type === 'divider') {
          content = null
        } else if (block.type === 'code') {
          content = text.length > 0 ? highlightCode(text) : placeholder
        } else if (content === null) {
          content = h('span', { className: 'nb-ph' }, placeholder)
        }
        if (block.type === 'divider') {
          body = h('hr', { key: 'divider', ref: renderRef, className: 'nb-divider-line', onClick: () => onMenu(block.id) })
        } else {
          body = h(
            'div',
            {
              key: 'view',
              ref: renderRef,
              className: `nb-b nb-b-${cls} nb-b-render`,
              onClick: beginEditing,
              onDoubleClick: beginEditing,
              onTouchStart: handleTouchStart,
              onTouchEnd: handleTouchEnd,
              onTouchMove: cancelLongPress,
              onTouchCancel: cancelLongPress,
            },
            content,
          )
        }
      }

      if (block.type === 'todo') {
        prefix = h('button', {
          className: `nb-check${block.checked === true ? ' on' : ''}`,
          role: 'checkbox',
          'aria-checked': block.checked === true,
          onClick: (event) => {
            event.stopPropagation()
            onToggleTodo(block.id)
          },
        })
      } else if (block.type === 'bullet') {
        prefix = h('div', { className: 'nb-prefix' }, h('span', { className: 'nb-prefix-dot' }))
      } else if (block.type === 'numbered') {
        prefix = h('div', { className: 'nb-prefix nb-prefix-num' }, `${number ?? 1}.`)
      } else if (block.type === 'callout') {
        prefix = h('div', { className: 'nb-callout-icon', 'aria-hidden': 'true' }, calloutIcon(block.variant))
      } else if (block.type === 'toggle') {
        prefix = h(
          'button',
          {
            className: 'nb-toggle-arrow',
            'aria-label': block.collapsed === true ? t('expandToggle') : t('collapseToggle'),
            onMouseDown: (event) => event.stopPropagation(),
            onClick: (event) => {
              event.stopPropagation()
              onToggleBlock(block.id)
            },
          },
          block.collapsed === true ? '▸' : '▾',
        )
      }

      const typeItems = [
        ['paragraph', t('typeText'), '¶'],
        ['heading1', t('typeHeading1'), 'H1'],
        ['heading2', t('typeHeading2'), 'H2'],
        ['heading3', t('typeHeading3'), 'H3'],
        ['bullet', t('typeBullet'), '•'],
        ['numbered', t('typeNumbered'), '1.'],
        ['todo', t('typeTodo'), '☐'],
        ['quote', t('typeQuote'), '”'],
        ['code', t('typeCode'), '</>'],
        ['divider', t('typeDivider'), '—'],
        ['table', t('typeTable'), '⊞'],
        ['callout', t('typeCallout'), '💡'],
        ['toggle', t('typeToggle'), '▾'],
        ['image', t('typeImage'), '🖼'],
        ['note-link', t('typeNoteLink'), '🔗'],
        ['template-button', t('typeTemplateButton'), '🧩'],
      ]
      const slashOpen = slashQuery !== null
      const visibleTypes = typeItems.filter(([type, label]) => matchesSlash(type, label, slashQuery))

      const menu =
        menuOpen === true
          ? h(
              'div',
              { className: 'nb-menu', onMouseDown: (event) => event.stopPropagation() },
              slashOpen
                ? visibleTypes.length === 0
                  ? h('div', { className: 'nb-menu-empty' }, t('noResults'))
                  : visibleTypes.map(([type, label, icon]) =>
                      h(
                        'button',
                        {
                          key: type,
                          className: `nb-menu-item${block.type === type ? ' on' : ''}`,
                          onClick: () => {
                            // The edit node still shows "/filter"; the model is
                            // about to be replaced, so clear the DOM first.
                            if (editRef.current !== null) editRef.current.textContent = ''
                            onPick(block.id, type)
                          },
                        },
                        h('span', { className: 'nb-menu-icon' }, icon),
                        h('span', null, label),
                      ),
                    )
                : [
                    h('div', { key: 'label', className: 'nb-menu-label' }, t('blockMenu')),
                    ...visibleTypes.map(([type, label, icon]) =>
                      h(
                        'button',
                        {
                          key: type,
                          className: `nb-menu-item${block.type === type ? ' on' : ''}`,
                          onClick: () => onType(block.id, type),
                        },
                        h('span', { className: 'nb-menu-icon' }, icon),
                        h('span', null, label),
                      ),
                    ),
                    h('div', { key: 'sep1', className: 'nb-menu-sep' }),
                    h(
                      'button',
                      { key: 'up', className: 'nb-menu-item', onClick: () => onMove(block.id, -1) },
                      h('span', { className: 'nb-menu-icon' }, '↑'),
                      h('span', null, t('moveUp')),
                    ),
                    h(
                      'button',
                      { key: 'down', className: 'nb-menu-item', onClick: () => onMove(block.id, 1) },
                      h('span', { className: 'nb-menu-icon' }, '↓'),
                      h('span', null, t('moveDown')),
                    ),
                    h(
                      'button',
                      { key: 'page', className: 'nb-menu-item', onClick: () => onExtractPage(block.id) },
                      h('span', { className: 'nb-menu-icon' }, '↗'),
                      h('span', null, t('extractPage')),
                    ),
                    h(
                      'button',
                      { key: 'link', className: 'nb-menu-item', onClick: () => onCopyLink(block.id) },
                      h('span', { className: 'nb-menu-icon' }, '🔗'),
                      h('span', null, t('copyBlockLink')),
                    ),
                    h(
                      'button',
                      { key: 'ai', className: 'nb-menu-item', onClick: () => onAi(block.id) },
                      h('span', { className: 'nb-menu-icon' }, '✦'),
                      h('span', null, t('aiTitle')),
                    ),

                    h('div', { key: 'sep2', className: 'nb-menu-sep' }),
                    h(
                      'button',
                      { key: 'del', className: 'nb-menu-item danger', onClick: () => onDelete(block.id) },
                      h('span', { className: 'nb-menu-icon' }, '×'),
                      h('span', null, t('deleteBlock')),
                    ),
                  ],
            )
          : null

      return h(
        'div',
        {
          className: `nb-block nb-type-${cls}${menuOpen === true ? ' menu-open' : ''}${dragging === true ? ' dragging' : ''}${selected === true ? ' selected' : ''}${dropMark === 'before' ? ' drop-before' : dropMark === 'after' ? ' drop-after' : ''}`,
          'data-block': block.id,
          style:
            Number(block.indent) > 0
              ? { paddingLeft: `${Math.min(3, Math.max(0, Number(block.indent) || 0)) * 24}px` }
              : undefined,
        },
        h(
          'div',
          { className: 'nb-gutter' },
          collapsible === true
            ? h(
                'button',
                {
                  className: 'nb-gutter-btn nb-collapse',
                  'aria-label': t('collapseHeading'),
                  title: t('collapseHeading'),
                  onMouseDown: (event) => event.stopPropagation(),
                  onClick: () => onToggleCollapse(block.id),
                },
                collapsed === true ? '▸' : '▾',
              )
            : null,
          h(
            'button',
            {
              className: 'nb-gutter-btn',
              'aria-label': t('addBlock'),
              title: t('addBlock'),
              onMouseDown: (event) => event.stopPropagation(),
              onClick: () => onInsertAfter(block.id),
            },
            '+',
          ),
          h(
            'button',
            {
              className: 'nb-gutter-btn',
              'aria-label': t('blockMenu'),
              title: t('blockMenu'),
              onMouseDown: (event) => {
                event.preventDefault()
                event.stopPropagation()
                onDragStart(block.id, event)
              },
            },
            '⋮⋮',
          ),
        ),
        h(
          'div',
          { className: 'nb-gutter-right' },
          h(
            'button',
            {
              className: 'nb-gutter-btn',
              'aria-label': t('blockOptions'),
              title: t('blockOptions'),
              onMouseDown: (event) => event.stopPropagation(),
              onClick: () => onMenu(block.id),
            },
            '⋯',
          ),
        ),
        prefix,
        body,
        block.type === 'code'
          ? h(
              'div',
              { className: 'nb-code-lang-wrap' },
              h(
                'button',
                {
                  className: 'nb-code-lang',
                  title: t('codeLanguage'),
                  onMouseDown: (event) => event.stopPropagation(),
                  onClick: () => setLangOpen((value) => !value),
                },
                block.lang || t('codeLanguagePlain'),
              ),
              langOpen === true
                ? h(
                    'div',
                    { className: 'nb-code-lang-menu', onMouseDown: (event) => event.stopPropagation() },
                    CODE_LANGS.map((lang) =>
                      h(
                        'button',
                        {
                          key: lang.length === 0 ? 'plain' : lang,
                          className: `nb-code-lang-item${(block.lang ?? '') === lang ? ' on' : ''}`,
                          onClick: () => {
                            onSetLang(block.id, lang)
                            setLangOpen(false)
                          },
                        },
                        lang.length === 0 ? t('codeLanguagePlain') : lang,
                      ),
                    ),
                  )
                : null,
            )
          : null,
        menu,
      )
    }

    function Workbench({ t, locale }) {
      useLocaleTick(locale)
      const [status, setStatus] = React.useState(null)
      const [notes, setNotes] = React.useState([])
      const [selected, setSelected] = React.useState(null)
      const [blocks, setBlocks] = React.useState([])
      const [editingId, setEditingId] = React.useState(null)
      const [focusRequest, setFocusRequest] = React.useState(null)
      const [menuFor, setMenuFor] = React.useState(null)
      const [search, setSearch] = React.useState('')
      const [hits, setHits] = React.useState(null)
      const [saveState, setSaveState] = React.useState('saved')
      const [notice, setNotice] = React.useState(null)
      const [dialog, setDialog] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [expanded, setExpanded] = React.useState({})
      const [titleMenu, setTitleMenu] = React.useState(false)
      const [slash, setSlash] = React.useState(null)
      const [wide, setWide] = React.useState(false)
      const [drag, setDrag] = React.useState(null)
      const [selection, setSelection] = React.useState(null)
      const [linkInput, setLinkInput] = React.useState(false)
      const [linkValue, setLinkValue] = React.useState('')
      const [frontmatter, setFrontmatter] = React.useState('')
      const [iconOpen, setIconOpen] = React.useState(false)
      const [coverOpen, setCoverOpen] = React.useState(false)
      const [coverValue, setCoverValue] = React.useState('')
      const [blockSelection, setBlockSelection] = React.useState(null)
      const [collapsedHeadings, setCollapsedHeadings] = React.useState({})
      const [tableRevision, setTableRevision] = React.useState(0)
      const [activeHeadingId, setActiveHeadingId] = React.useState(null)
      const [imageBar, setImageBar] = React.useState(null)
      const [tabs, setTabs] = React.useState([])
      const [linkBar, setLinkBar] = React.useState(null)
      const [imageUrl, setImageUrl] = React.useState('')
      const [imageTargetId, setImageTargetId] = React.useState(null)
      const [zen, setZen] = React.useState(false)
      const [findOpen, setFindOpen] = React.useState(false)
      const [findQuery, setFindQuery] = React.useState('')
      const [findIndex, setFindIndex] = React.useState(0)
      const [history, setHistory] = React.useState(null)
      const [historyPreview, setHistoryPreview] = React.useState(null)
      const [fontScale, setFontScale] = React.useState(16)
      const [typeface, setTypeface] = React.useState('default')
      const [customFont, setCustomFont] = React.useState('')
      const [fontStatus, setFontStatus] = React.useState({})
      const [reading, setReading] = React.useState(false)
      const [vaultTemplates, setVaultTemplates] = React.useState(null)
      const [propsTagList, setPropsTagList] = React.useState([])
      const [propsTagDraft, setPropsTagDraft] = React.useState('')
      const [propsAliases, setPropsAliases] = React.useState('')
      const [propsDraft, setPropsDraft] = React.useState({})
      const [remoteConfig, setRemoteConfig] = React.useState(null)
      const [backlinks, setBacklinks] = React.useState([])
      const [favorites, setFavorites] = React.useState([])
      const [recent, setRecent] = React.useState([])
      const [quickOpen, setQuickOpen] = React.useState(false)
      const [quickQuery, setQuickQuery] = React.useState('')
      const [quickIndex, setQuickIndex] = React.useState(0)
      const [parents, setParents] = React.useState({})
      const [collection, setCollection] = React.useState(null)
      const [aiPanel, setAiPanel] = React.useState(null)
      const [notePicker, setNotePicker] = React.useState(null)
      const [wikiSuggest, setWikiSuggest] = React.useState(null)
      const [linksOpen, setLinksOpen] = React.useState(false)
      const [noteMenu, setNoteMenu] = React.useState(null)
      const [folderDraft, setFolderDraft] = React.useState('')
      const [moveNote, setMoveNote] = React.useState(null)
      const [newFieldKey, setNewFieldKey] = React.useState('')
      const [newFieldValue, setNewFieldValue] = React.useState('')
      const selectedRef = React.useRef(null)
      const blocksRef = React.useRef([])
      const baselineRef = React.useRef('')
      const mtimeRef = React.useRef(0)
      const searchTimer = React.useRef(null)
      const titleRef = React.useRef(null)
      const scrollRef = React.useRef(null)
      const historyRef = React.useRef({ past: [], future: [], lastKey: null, lastAt: 0 })
      const ghostRef = React.useRef(null)
      const outlineLockRef = React.useRef(0)
      const prefsRestoredRef = React.useRef(false)
      const hostSidebarRef = React.useRef(false)
      const zenRef = React.useRef(false)
      const editingIdRef = React.useRef(null)
      const swipeRef = React.useRef(null)
      const dragNotePathRef = React.useRef(null)
      const scrollSaveTimer = React.useRef(null)
      const selectionRef = React.useRef(null)
      const savedRangeRef = React.useRef(null)
      const blockSelectionRef = React.useRef(null)
      const frontmatterRef = React.useRef('')
      const dragRef = React.useRef(null)

      const currentTitle =
        selected === null
          ? ''
          : selected
              .split('/')
              .pop()
              .replace(/\.md$/i, '')
      const icon = frontmatterIcon(frontmatter)
      const propsOthers = frontmatterEntries(frontmatter)
      const graphSelfName = selected === null ? '' : selected.split('/').pop().replace(/\.md$/i, '')
      const outgoing = React.useMemo(() => outgoingLinks(blocks), [blocks])
      const mentions = React.useMemo(() => unlinkedMentions(blocks, notes, selected), [blocks, notes, selected])
      const graph = React.useMemo(() => {
        if (dialog === null || dialog.kind !== 'graph') return null
        const width = 640
        const height = 400
        const radius = 150
        const seen = new Set([selected ?? ''])
        const out = []
        for (const link of outgoing) {
          const note = findWikiTarget(notes, link.name)
          const key = note !== null ? note.path : `missing:${link.name}`
          if (seen.has(key)) continue
          seen.add(key)
          out.push({
            key,
            name: note !== null ? note.name : link.name,
            path: note !== null ? note.path : null,
          })
        }
        const incoming = []
        for (const link of backlinks) {
          if (seen.has(link.path)) continue
          seen.add(link.path)
          incoming.push({ key: link.path, name: link.name, path: link.path })
        }
        const visibleOut = out.slice(0, 12)
        const visibleIn = incoming.slice(0, 12)
        const outPositions = graphPositions(visibleOut.length, 'out', width, height, radius)
        const inPositions = graphPositions(visibleIn.length, 'in', width, height, radius)
        const nodes = [
          ...visibleOut.map((node, index) => ({ ...node, ...outPositions[index], side: 'out' })),
          ...visibleIn.map((node, index) => ({ ...node, ...inPositions[index], side: 'in' })),
        ]
        return { width, height, nodes, cx: width / 2, cy: height / 2 }
      }, [dialog, outgoing, backlinks, notes, selected])
      const wikiItems = React.useMemo(() => {
        if (wikiSuggest === null) return []
        const query = String(wikiSuggest.query ?? '').toLowerCase()
        return notes
          .filter((note) => {
            if (selected !== null && note.path === selected) return false
            return query.length === 0 || String(note.name ?? '').toLowerCase().includes(query)
          })
          .slice(0, 8)
      }, [notes, wikiSuggest, selected])

      const quickItems = React.useMemo(() => filterQuickNotes(notes, quickQuery).slice(0, 12), [notes, quickQuery])

      const notePickerItems = React.useMemo(() => {
        const query = notePicker === null ? '' : String(notePicker.query ?? '').trim().toLowerCase()
        return notes.filter((note) => {
          if (selected !== null && note.path === selected) return false
          return query.length === 0 || String(note.name ?? '').toLowerCase().includes(query)
        })
      }, [notes, notePicker, selected])
      const moveTargets = React.useMemo(() => folderTargets(notes), [notes])
      const cover = frontmatterCover(frontmatter)

      function updateFrontmatter(next) {
        frontmatterRef.current = next
        setFrontmatter(next)
      }

      function applyCover() {
        const value = coverValue.trim()
        setCoverOpen(false)
        setCoverValue('')
        if (value.length === 0) {
          updateFrontmatter(withFrontmatterCover(frontmatterRef.current, ''))
          return
        }
        if (!/^https?:\/\//i.test(value) && !/\.(png|jpe?g|gif|webp|avif|svg)$/i.test(value)) {
          setNotice({ kind: 'error', text: t('coverInvalid') })
          return
        }
        updateFrontmatter(withFrontmatterCover(frontmatterRef.current, value))
      }

      React.useEffect(() => {
        selectedRef.current = selected
      }, [selected])

      React.useEffect(() => {
        try {
          window.localStorage.setItem(TABS_KEY, JSON.stringify(tabs))
        } catch {
          /* preferences are best-effort */
        }
      }, [tabs])

      React.useEffect(() => {
        zenRef.current = zen
      }, [zen])

      React.useEffect(() => {
        editingIdRef.current = editingId
      }, [editingId])

      React.useEffect(() => {
        if (!prefsRestoredRef.current) return
        try {
          window.localStorage.setItem(ZEN_KEY, zen ? '1' : '0')
        } catch {
          /* preferences are best-effort */
        }
      }, [zen])

      React.useEffect(() => {
        if (!prefsRestoredRef.current) return
        try {
          window.localStorage.setItem(FONT_KEY, String(fontScale))
        } catch {
          /* preferences are best-effort */
        }
      }, [fontScale])

      React.useEffect(() => {
        if (!prefsRestoredRef.current) return
        try {
          window.localStorage.setItem(TYPEFACE_KEY, typeface)
        } catch {
          /* preferences are best-effort */
        }
      }, [typeface])

      React.useEffect(() => {
        if (!prefsRestoredRef.current) return
        try {
          window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites))
        } catch {
          /* preferences are best-effort */
        }
      }, [favorites])

      React.useEffect(() => {
        if (!prefsRestoredRef.current) return
        try {
          window.localStorage.setItem(RECENT_KEY, JSON.stringify(recent))
        } catch {
          /* preferences are best-effort */
        }
      }, [recent])

      React.useEffect(() => {
        if (!prefsRestoredRef.current) return
        try {
          window.localStorage.setItem(LINKS_OPEN_KEY, linksOpen ? '1' : '0')
        } catch {
          /* preferences are best-effort */
        }
      }, [linksOpen])

      React.useEffect(() => {
        if (!prefsRestoredRef.current) return
        try {
          window.localStorage.setItem(READING_KEY, reading ? '1' : '0')
        } catch {
          /* preferences are best-effort */
        }
      }, [reading])

      const loadList = React.useCallback(async () => {
        try {
          const data = await apiGet('/list')
          setNotes(Array.isArray(data.notes) ? data.notes : [])
          setStatus(data.vault ?? null)
          return true
        } catch (error) {
          setNotice({ kind: 'error', text: error.message })
          return false
        }
      }, [])

      React.useEffect(() => {
        let disposed = false
        ;(async () => {
          await loadList()
          if (disposed) return
          setLoading(false)
          try {
            const hostConfig = await apiGet('/config')
            if (!disposed) setRemoteConfig(hostConfig)
          } catch {
            /* the Host may predate this route */
          }
          try {
            const relation = await apiGet('/parents')
            if (!disposed && relation.parents !== null && typeof relation.parents === 'object') {
              setParents(relation.parents)
            }
          } catch {
            /* the Host may predate this route */
          }
          // Restore the tab strip before reopening the last page.
          try {
            const rawTabs = window.localStorage.getItem(TABS_KEY)
            if (rawTabs !== null) {
              const parsedTabs = JSON.parse(rawTabs)
              if (Array.isArray(parsedTabs)) {
                setTabs(parsedTabs.filter((item) => typeof item === 'string' && item.length > 0))
              }
            }
          } catch {
            /* preferences are best-effort */
          }
          // Reopen the page the user last had open, like Notion does, when it
          // still exists in the vault.
          try {
            const saved = window.localStorage.getItem(LAST_NOTE_KEY)
            if (saved !== null && saved.length > 0) {
              const exists = await apiGet('/list')
                .then((data) => (Array.isArray(data.notes) ? data.notes.some((note) => note.path === saved) : false))
                .catch(() => false)
              if (exists && !disposed) await openNote(saved)
            }
            if (window.localStorage.getItem(WIDE_KEY) === '1') setWide(true)
            if (window.localStorage.getItem(ZEN_KEY) === '1') setZenMode(true)
            if (window.localStorage.getItem(READING_KEY) === '1') setReading(true)
            const savedFont = Number(window.localStorage.getItem(FONT_KEY))
            if (Number.isFinite(savedFont) && savedFont >= 13 && savedFont <= 22) setFontScale(savedFont)
            const savedTypeface = window.localStorage.getItem(TYPEFACE_KEY)
            if (typeof savedTypeface === 'string' && savedTypeface.length > 0) setTypeface(savedTypeface)
            if (window.localStorage.getItem(LINKS_OPEN_KEY) === '1') setLinksOpen(true)
            try {
              const savedFavorites = JSON.parse(window.localStorage.getItem(FAVORITES_KEY) ?? '[]')
              if (Array.isArray(savedFavorites)) {
                setFavorites(savedFavorites.filter((item) => typeof item === 'string'))
              }
            } catch {
              /* preferences are best-effort */
            }
            try {
              const savedRecent = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]')
              if (Array.isArray(savedRecent)) {
                setRecent(savedRecent.filter((item) => typeof item === 'string'))
              }
            } catch {
              /* preferences are best-effort */
            }
            prefsRestoredRef.current = true
          } catch {
            /* preferences are best-effort */
          }
        })()
        return () => {
          disposed = true
          if (searchTimer.current !== null) clearTimeout(searchTimer.current)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [loadList])

      // Keep the page title's DOM in sync without fighting the caret while the
      // user is typing in it.
      React.useEffect(() => {
        const element = titleRef.current
        if (element === null) return
        if (document.activeElement !== element && element.textContent !== currentTitle) {
          element.textContent = currentTitle
        }
      }, [currentTitle, selected])

      // Close block menus on any outside press.
      React.useEffect(() => {
        if (
          menuFor === null &&
          titleMenu === false &&
          iconOpen === false &&
          coverOpen === false &&
          imageBar === null &&
          linkBar === null
        ) {
          return undefined
        }
        const close = () => {
          setMenuFor(null)
          setTitleMenu(false)
          setSlash(null)
          setIconOpen(false)
          setCoverOpen(false)
          setImageBar(null)
          setLinkBar(null)
        }
        const timer = setTimeout(() => document.addEventListener('mousedown', close), 0)
        return () => {
          clearTimeout(timer)
          document.removeEventListener('mousedown', close)
        }
      }, [menuFor, titleMenu, iconOpen, coverOpen, imageBar, linkBar])

      function updateBlocks(next, options) {
        const settings = options ?? {}
        const previous = blocksRef.current
        if (settings.restore !== true && settings.record !== false) {
          pushHistory(previous, settings.mergeKey)
        }
        blocksRef.current = next
        setBlocks(next)
      }

      function copyBlocks(list) {
        return list.map((block) => ({ ...block }))
      }

      /**
       * Undo history over whole-block snapshots. Consecutive typing in one block
       * merges into a single step so Ctrl+Z undoes a phrase, not a character.
       */
      function pushHistory(snapshot, mergeKey) {
        const history = historyRef.current
        const now = Date.now()
        const merge =
          typeof mergeKey === 'string' &&
          history.lastKey === mergeKey &&
          now - history.lastAt < 700
        if (!merge) {
          history.past.push(copyBlocks(snapshot))
          if (history.past.length > 120) history.past.shift()
        }
        history.lastKey = typeof mergeKey === 'string' ? mergeKey : null
        history.lastAt = now
        history.future = []
      }

      function undo() {
        const history = historyRef.current
        if (history.past.length === 0) return
        history.future.push(copyBlocks(blocksRef.current))
        const snapshot = history.past.pop()
        history.lastKey = null
        updateBlocks(snapshot, { restore: true })
        setEditingId(null)
        setMenuFor(null)
        setSlash(null)
        setTableRevision((value) => value + 1)
      }

      function redo() {
        const history = historyRef.current
        if (history.future.length === 0) return
        history.past.push(copyBlocks(blocksRef.current))
        const snapshot = history.future.pop()
        history.lastKey = null
        updateBlocks(snapshot, { restore: true })
        setEditingId(null)
        setMenuFor(null)
        setSlash(null)
        setTableRevision((value) => value + 1)
      }

      React.useEffect(() => {
        function handleKeyDown(event) {
          if (event.key === 'Escape' && blockSelectionRef.current !== null) {
            setBlockSelection(null)
            return
          }
          if ((event.key === 'Backspace' || event.key === 'Delete') && blockSelectionRef.current !== null) {
            const target = event.target
            if (target !== null && typeof target.closest === 'function') {
              if (target.closest('input, textarea, [contenteditable="true"]') !== null) return
            }
            event.preventDefault()
            deleteSelectedBlocks()
            return
          }
          if (event.key === 'Escape' && zenRef.current === true && editingIdRef.current === null) {
            event.preventDefault()
            setZenMode(false)
            return
          }
          if (!(event.metaKey || event.ctrlKey)) return
          const key = String(event.key).toLowerCase()
          if (key === 'p') {
            event.preventDefault()
            openQuick()
            return
          }
          if (key === 'f' && event.shiftKey) {
            event.preventDefault()
            setZenMode(!zenRef.current)
            return
          }
          if (key === 'f') {
            event.preventDefault()
            setFindOpen(true)
            return
          }
          if (key === '=' || key === '+' || key === '-' || key === '_') {
            event.preventDefault()
            setFontScale((value) =>
              Math.max(13, Math.min(22, value + (key === '=' || key === '+' ? 1 : -1))),
            )
            return
          }
          if ((key === 'c' || key === 'x') && blockSelectionRef.current !== null) {
            const copyTarget = event.target
            if (
              copyTarget !== null &&
              typeof copyTarget.closest === 'function' &&
              copyTarget.closest('input, textarea, [contenteditable="true"]') !== null
            ) {
              return
            }
            const text = selectedBlocksMarkdown()
            if (text.length > 0) {
              event.preventDefault()
              try {
                if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                  navigator.clipboard.writeText(text).catch(() => {})
                }
              } catch {
                /* clipboard unavailable */
              }
              if (key === 'x') deleteSelectedBlocks()
            }
            return
          }
          if (key !== 'z' && key !== 'y') return
          const target = event.target
          if (target !== null && typeof target.closest === 'function') {
            // Text inputs and the page title keep their native undo.
            if (target.closest('input, textarea, .nb-title') !== null) return
          }
          event.preventDefault()
          if (key === 'y' || event.shiftKey) redo()
          else undo()
        }
        document.addEventListener('keydown', handleKeyDown, true)
        return () => document.removeEventListener('keydown', handleKeyDown, true)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      React.useEffect(() => {
        function onMouseDown() {
          setNoteMenu(null)
        }
        document.addEventListener('mousedown', onMouseDown)
        return () => document.removeEventListener('mousedown', onMouseDown)
      }, [])

      async function saveNow(nextBlocks) {
        const path = selectedRef.current
        if (path === null) return
        const text = composeContent(frontmatterRef.current, serializeBlocks(nextBlocks))
        if (text === baselineRef.current) {
          setSaveState('saved')
          return
        }
        setSaveState('saving')
        try {
          const data = await apiPost('/write', { path, content: text, expectedMtimeMs: mtimeRef.current })
          baselineRef.current = text
          mtimeRef.current = data.mtimeMs
          setSaveState('saved')
          setNotice(null)
        } catch (error) {
          setSaveState('error')
          setNotice({ kind: 'error', text: error.message })
        }
      }

      React.useEffect(() => {
        if (selected === null) return undefined
        const text = composeContent(frontmatter, serializeBlocks(blocks))
        if (text === baselineRef.current) {
          setSaveState('saved')
          return undefined
        }
        setSaveState('unsaved')
        const timer = setTimeout(() => {
          saveNow(blocksRef.current)
        }, 900)
        return () => clearTimeout(timer)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [blocks, selected, frontmatter])

      async function openNote(path) {
        if (path === selectedRef.current) return
        setLoading(true)
        try {
          // Remember where the previous note was scrolled, per note.
          if (selectedRef.current !== null && scrollRef.current !== null) {
            try {
              window.localStorage.setItem(
                `${SCROLL_KEY}${selectedRef.current}`,
                String(Math.round(scrollRef.current.scrollTop)),
              )
            } catch {
              /* preferences are best-effort */
            }
          }
          await saveNow(blocksRef.current)
          const data = await apiGet(`/read?path=${encodeURIComponent(path)}`)
          let savedScroll = 0
          try {
            savedScroll = Number(window.localStorage.getItem(`${SCROLL_KEY}${data.path}`)) || 0
          } catch {
            savedScroll = 0
          }
          const split = splitFrontmatter(data.content)
          const parsed = parseBlocks(split.body)
          // Restore remembered table column widths (view-only, per note).
          let restored = parsed
          try {
            const rawCols = window.localStorage.getItem(`${COLS_KEY}${data.path}`)
            const savedCols = rawCols === null ? null : JSON.parse(rawCols)
            if (Array.isArray(savedCols)) {
              let tableIndex = 0
              restored = parsed.map((block) => {
                if (block.type !== 'table') return block
                const widths = savedCols[tableIndex]
                tableIndex += 1
                return Array.isArray(widths) && widths.length > 0 ? { ...block, colWidths: widths } : block
              })
            }
          } catch {
            restored = parsed
          }
          frontmatterRef.current = split.frontmatter
          setFrontmatter(split.frontmatter)
          baselineRef.current = composeContent(split.frontmatter, serializeBlocks(restored))
          mtimeRef.current = data.mtimeMs
          selectedRef.current = data.path
          setSelected(data.path)
          setTabs((previous) => (previous.includes(data.path) ? previous : [...previous, data.path]))
          setRecent((previous) => [data.path, ...previous.filter((item) => item !== data.path)].slice(0, 6))
          apiPost('/current', { path: data.path }).catch(() => {})
          updateBlocks(restored, { record: false })
          historyRef.current = { past: [], future: [], lastKey: null, lastAt: 0 }
          try {
            window.localStorage.setItem(LAST_NOTE_KEY, data.path)
          } catch {
            /* preferences are best-effort */
          }
          setEditingId(null)
          setFocusRequest(null)
          setMenuFor(null)
          setSaveState('saved')
          setNotice(null)
          setSearch('')
          setHits(null)
          const cut = data.path.lastIndexOf('/')
          const parent = cut < 0 ? '' : data.path.slice(0, cut)
          if (parent !== '') {
            setExpanded((previous) => (previous[parent] === true ? previous : { ...previous, [parent]: true }))
          }
          setLoading(false)
          if (typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(() => {
              if (scrollRef.current !== null) scrollRef.current.scrollTop = savedScroll > 0 ? savedScroll : 0
            })
          }
          setBacklinks([])
          try {
            const links = await apiGet(`/backlinks?path=${encodeURIComponent(data.path)}`)
            if (selectedRef.current === data.path) {
              setBacklinks(Array.isArray(links.backlinks) ? links.backlinks : [])
            }
          } catch {
            /* the Host may predate this route */
          }
          const collectionConfig = collectionConfigFor(split.frontmatter)
          if (collectionConfig !== null) {
            const folder =
              collectionConfig.source.length > 0
                ? collectionConfig.source
                : data.path.lastIndexOf('/') < 0
                  ? ''
                  : data.path.slice(0, data.path.lastIndexOf('/'))
            setCollection({ config: collectionConfig, rows: [], loading: true, folder })
            try {
              const payload = await apiGet(`/fields?folder=${encodeURIComponent(folder)}`)
              if (selectedRef.current === data.path) {
                setCollection({
                  config: collectionConfig,
                  rows: (Array.isArray(payload.rows) ? payload.rows : []).filter(
                    (row) => row.path !== data.path,
                  ),
                  loading: false,
                  folder: typeof payload.folder === 'string' ? payload.folder : folder,
                })
              }
            } catch {
              if (selectedRef.current === data.path) {
                setCollection({ config: collectionConfig, rows: [], loading: false, folder })
              }
            }
          } else {
            setCollection(null)
          }
        } catch (error) {
          setNotice({ kind: 'error', text: error.message })
          setLoading(false)
        }
      }

      function beginEditing(id, offset) {
        if (id === null || id === undefined) {
          setEditingId(null)
          return
        }
        if (blockSelection !== null) setBlockSelection(null)
        setEditingId(id)
        setFocusRequest(offset === null || offset === undefined ? null : { id, offset })
      }

      function changeText(id, text) {
        updateBlocks(
          blocksRef.current.map((block) => (block.id === id ? { ...block, text } : block)),
          { mergeKey: `text:${id}` },
        )
      }

      /**
       * Zen mode also folds the host's own sidebar so the writing surface is the
       * only thing left; the previous state is restored when zen ends.
       */
      function toggleHostSidebar(expand) {
        try {
          const wanted = expand
            ? ['打开侧边栏', 'Open sidebar']
            : ['收起侧边栏', 'Collapse sidebar']
          const button = Array.from(document.querySelectorAll('button')).find((item) => {
            const label = item.getAttribute('aria-label') ?? ''
            return wanted.includes(label)
          })
          if (button !== null && button !== undefined) {
            button.click()
            return true
          }
        } catch {
          /* the host layout is best-effort */
        }
        return false
      }

      function setZenMode(next) {
        if (next === true) {
          hostSidebarRef.current = toggleHostSidebar(false)
        } else if (hostSidebarRef.current === true) {
          toggleHostSidebar(true)
          hostSidebarRef.current = false
        }
        setZen(next)
      }

      function openAiBlock(blockId) {
        setMenuFor(null)
        const block = blocksRef.current.find((item) => item.id === blockId)
        if (block === undefined) return
        setAiPanel({ scope: 'block', blockId, task: 'rewrite', result: '', loading: false, error: '' })
      }

      function openAiPage() {
        setTitleMenu(false)
        setAiPanel({ scope: 'page', blockId: null, task: 'summary', result: '', loading: false, error: '' })
      }

      function aiInputText(panel) {
        if (panel === null) return ''
        if (panel.scope === 'block') {
          const block = blocksRef.current.find((item) => item.id === panel.blockId)
          return block === undefined ? '' : String(block.text ?? '').trim()
        }
        return serializeBlocks(blocksRef.current).slice(0, 6000)
      }

      async function runAi() {
        const panel = aiPanel
        if (panel === null || panel.loading === true) return
        if (panel.task === 'agent') {
          const instruction = String(panel.instruction ?? '').trim()
          if (instruction.length === 0) return
          setAiPanel({ ...panel, loading: true, error: '', result: '' })
          try {
            const payload = await apiPost('/ai/agent', { instruction })
            const writes = Array.isArray(payload.writes) ? payload.writes : []
            const current = selectedRef.current
            if (current !== null && writes.includes(current)) await openNote(current)
            setAiPanel((currentPanel) =>
              currentPanel === null
                ? currentPanel
                : { ...currentPanel, loading: false, result: String(payload.text ?? '') },
            )
          } catch (error) {
            setAiPanel((currentPanel) =>
              currentPanel === null ? currentPanel : { ...currentPanel, loading: false, error: error.message },
            )
          }
          return
        }
        const text = aiInputText(panel)
        if (text.length === 0) return
        setAiPanel({ ...panel, loading: true, error: '', result: '' })
        try {
          const payload = await apiPost('/ai', {
            task: panel.task,
            text,
            locale: String(locale ?? '').startsWith('en') ? 'en' : 'zh',
          })
          setAiPanel((current) =>
            current === null ? current : { ...current, loading: false, result: String(payload.text ?? '') },
          )
        } catch (error) {
          setAiPanel((current) =>
            current === null ? current : { ...current, loading: false, error: error.message },
          )
        }
      }

      function applyAiResult(mode) {
        const panel = aiPanel
        if (panel === null) return
        const result = String(panel.result ?? '').trim()
        if (result.length === 0) return
        if (mode === 'copy') {
          try {
            navigator.clipboard.writeText(result)
            setNotice({ kind: 'ok', text: t('copied') })
          } catch {
            /* clipboard unavailable */
          }
          setAiPanel(null)
          return
        }
        if (panel.scope === 'block') {
          const blockId = panel.blockId
          if (mode === 'replace') {
            updateBlocks(
              blocksRef.current.map((block) => (block.id === blockId ? { ...block, text: result } : block)),
            )
          } else {
            const list = blocksRef.current
            const index = list.findIndex((block) => block.id === blockId)
            const created = { id: makeId(), type: 'paragraph', text: result, checked: false }
            const next =
              index < 0
                ? [...list, created]
                : [...list.slice(0, index + 1), created, ...list.slice(index + 1)]
            updateBlocks(next)
          }
        } else {
          const created = { id: makeId(), type: 'paragraph', text: result, checked: false }
          updateBlocks([created, ...blocksRef.current])
        }
        setAiPanel(null)
      }

      async function updateCollectionField(path, key, value) {
        if (typeof path !== 'string' || path.length === 0) return
        try {
          const data = await apiGet(`/read?path=${encodeURIComponent(path)}`)
          const split = splitFrontmatter(data.content)
          const nextFrontmatter = withFrontmatterValue(split.frontmatter, key, String(value ?? ''))
          const content = composeContent(nextFrontmatter, split.body)
          await apiPost('/write', { path, content, expectedMtimeMs: data.mtimeMs })
          await reloadCollection()
          setNotice({ kind: 'ok', text: t('collectionSaved') })
        } catch (error) {
          setNotice({ kind: 'error', text: error.message })
          await reloadCollection()
        }
      }

      async function createCollectionRow() {
        const current = collection
        if (current === null) return
        const dir = current.folder
        const base = t('untitled')
        let attempt = 1
        while (attempt <= 50) {
          const name = attempt === 1 ? base : `${base} ${attempt}`
          const path = dir.length > 0 ? `${dir}/${name}.md` : `${name}.md`
          try {
            await apiPost('/create', { path, content: '' })
            await loadList()
            await reloadCollection()
            setNotice({ kind: 'ok', text: t('collectionRowCreated') })
            return
          } catch (error) {
            if (error.code !== 'note_exists') {
              setNotice({ kind: 'error', text: error.message })
              return
            }
            attempt += 1
          }
        }
      }

      async function reloadCollection() {
        const current = collection
        if (current === null) return
        try {
          const payload = await apiGet(`/fields?folder=${encodeURIComponent(current.folder)}`)
          setCollection({
            ...current,
            rows: (Array.isArray(payload.rows) ? payload.rows : []).filter(
              (row) => row.path !== selectedRef.current,
            ),
            loading: false,
            folder: typeof payload.folder === 'string' ? payload.folder : current.folder,
          })
        } catch (error) {
          setNotice({ kind: 'error', text: error.message })
        }
      }

      function revealFolder(dir) {
        if (dir.length === 0) return
        setExpanded((previous) => ({ ...previous, [dir]: true }))
        try {
          const element = document.querySelector(`[data-folder="${dir}"]`)
          if (element !== null && typeof element.scrollIntoView === 'function') {
            element.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
          }
        } catch {
          /* best-effort */
        }
      }

      function handleWikiSuggest(blockId, query, rect) {
        if (query === null) {
          setWikiSuggest(null)
          return
        }
        setWikiSuggest({
          blockId,
          query,
          top: rect !== null && rect !== undefined ? rect.bottom + 4 : 0,
          left: rect !== null && rect !== undefined ? rect.left : 0,
        })
      }

      function insertWikiLink(name) {
        const suggestion = wikiSuggest
        setWikiSuggest(null)
        const clean = String(name ?? '').trim()
        if (suggestion === null || clean.length === 0) return
        const block = blocksRef.current.find((item) => item.id === suggestion.blockId)
        if (block === undefined) return
        // The editing DOM owns its text while focused, so update it in place too.
        let element = null
        try {
          element = document.querySelector(`[data-block="${suggestion.blockId}"] .nb-b-edit`)
        } catch {
          element = null
        }
        const source = element !== null ? String(element.textContent ?? '') : String(block.text ?? '')
        const open = source.lastIndexOf('[[')
        const base = open < 0 ? source : source.slice(0, open)
        const next = `${base}[[${clean}]]`
        if (element !== null) {
          element.textContent = next
          placeCaret(element, next.length)
        }
        updateBlocks(blocksRef.current.map((item) => (item.id === block.id ? { ...item, text: next } : item)))
        setEditingId(block.id)
        if (element === null) setFocusRequest({ id: block.id, offset: next.length })
      }

      function pickWikiSuggestion() {
        const first = wikiItems[0]
        if (first !== undefined) insertWikiLink(first.name)
      }

      function insertNoteLink(name) {
        const picker = notePicker
        setDialog(null)
        setNotePicker(null)
        if (picker === null) return
        const clean = String(name ?? '').trim()
        if (clean.length === 0) return
        updateBlocks(
          blocksRef.current.map((block) => {
            if (block.id !== picker.blockId) return block
            const current = String(block.text ?? '')
            const text = `${current}${current.length > 0 ? ' ' : ''}[[${clean}]]`
            return { ...block, text }
          }),
        )
        setEditingId(picker.blockId)
        setFocusRequest({ id: picker.blockId, offset: null })
      }

      function pickSlash(blockId, type) {
        if (type === 'image') {
          setSlash(null)
          setMenuFor(null)
          setImageUrl('')
          setImageTargetId(blockId)
          setDialog({ kind: 'image' })
          return
        }
        if (type === 'note-link') {
          setSlash(null)
          setMenuFor(null)
          setNotePicker({ blockId, query: '' })
          setDialog({ kind: 'note' })
          return
        }
        if (type === 'template-button') {
          setSlash(null)
          setMenuFor(null)
          updateBlocks(
            blocksRef.current.map((block) => {
              if (block.id !== blockId) return block
              const current = String(block.text ?? '')
              const label = t('templateButtonLabel')
              const text = `${current}${current.length > 0 ? ' ' : ''}[${label}](${TEMPLATE_HREF})`
              return { ...block, type: 'paragraph', text }
            }),
          )
          setEditingId(null)
          setFocusRequest(null)
          return
        }
        updateBlocks(
          blocksRef.current.map((block) => {
            if (block.id !== blockId) return block
            if (type === 'table') {
              return { ...block, type, text: '', checked: false, rows: [['', ''], ['', '']] }
            }
            return { ...block, type, text: '', checked: false }
          }),
          { record: true },
        )
        setSlash(null)
        setMenuFor(null)
        if (type === 'divider' || type === 'table') {
          setEditingId(null)
          setFocusRequest(null)
        } else {
          setEditingId(blockId)
          setFocusRequest({ id: blockId, offset: 0 })
        }
      }

      function handleSlash(blockId, query) {
        if (query === null) {
          setSlash(null)
          setMenuFor((current) => (current === blockId ? null : current))
          return
        }
        setSlash({ blockId, query })
        setMenuFor(blockId)
      }

      /**
       * Drag a block by its ⋮⋮ handle. A press without movement opens the block
       * menu, matching Notion: one handle, two gestures.
       */
      function startDrag(blockId, event) {
        const range = selectedBlockRange()
        const group = range !== null && range.length > 1 && range.some((block) => block.id === blockId)
          ? range.map((block) => block.id)
          : null
        dragRef.current = {
          id: blockId,
          group,
          startX: event.clientX,
          startY: event.clientY,
          moved: false,
          overId: null,
          before: true,
        }
        setSlash(null)
        setDrag({ id: blockId, overId: null, before: true })
      }

      // Floating format toolbar: appears over a non-empty selection inside a
      // focused block and keeps that selection alive when a button is pressed.
      React.useEffect(() => {
        function clear() {
          if (selectionRef.current === null) return
          selectionRef.current = null
          setSelection(null)
        }
        function update() {
          // While the link input owns the caret, the block selection is no
          // longer the document selection; keep the toolbar and its saved range.
          const active = document.activeElement
          if (
            active !== null &&
            typeof active.closest === 'function' &&
            active.closest('.nb-toolbar') !== null
          ) {
            return
          }
          const current = window.getSelection ? window.getSelection() : null
          if (current === null || current.rangeCount === 0 || current.isCollapsed) {
            clear()
            return
          }
          const range = current.getRangeAt(0)
          const node = range.commonAncestorContainer
          const element = node.nodeType === 1 ? node : node.parentElement
          const edit =
            element !== null && typeof element.closest === 'function' ? element.closest('.nb-b-edit') : null
          if (edit === null) {
            clear()
            return
          }
          const block = typeof edit.closest === 'function' ? edit.closest('[data-block]') : null
          const rect = range.getBoundingClientRect()
          if (rect.width === 0 && rect.height === 0) {
            clear()
            return
          }
          savedRangeRef.current = range.cloneRange()
          const next = {
            blockId: block === null ? null : block.getAttribute('data-block'),
            top: rect.top,
            left: rect.left + rect.width / 2,
          }
          selectionRef.current = next
          setSelection(next)
        }
        document.addEventListener('selectionchange', update)
        window.addEventListener('scroll', clear, true)
        return () => {
          document.removeEventListener('selectionchange', update)
          window.removeEventListener('scroll', clear, true)
        }
      }, [])

      function formatSelection(kind) {
        const state = selectionRef.current
        if (state === null) return
        const selection = window.getSelection ? window.getSelection() : null
        if (selection === null || selection.rangeCount === 0) return
        try {
          if (kind === 'code') {
            const range = selection.getRangeAt(0)
            const text = range.toString()
            if (text.length > 0) {
              range.deleteContents()
              const code = document.createElement('code')
              code.textContent = text
              range.insertNode(code)
              selection.removeAllRanges()
              const after = document.createRange()
              after.setStartAfter(code)
              after.collapse(true)
              selection.addRange(after)
            }
          } else if (kind === 'clear') {
            document.execCommand('removeFormat')
          } else {
            document.execCommand(kind)
          }
        } catch {
          /* a browser refusing a command must not break the editor */
        }
        if (state.blockId !== null) {
          const element = document.querySelector(`[data-block="${state.blockId}"] .nb-b-edit`)
          if (element !== null) changeText(state.blockId, htmlToMarkdown(element))
        }
      }

      function applyLink() {
        const state = selectionRef.current
        const saved = savedRangeRef.current
        const url = linkValue.trim()
        setLinkInput(false)
        setLinkValue('')
        if (state === null || saved === null || url.length === 0) return
        if (!/^https?:\/\//i.test(url) && !/^mailto:/i.test(url)) {
          setNotice({ kind: 'error', text: t('linkInvalid') })
          return
        }
        const selection = window.getSelection ? window.getSelection() : null
        if (selection === null) return
        const text = saved.toString()
        if (text.length === 0) return
        selection.removeAllRanges()
        selection.addRange(saved)
        saved.deleteContents()
        const anchor = document.createElement('a')
        anchor.setAttribute('href', url)
        anchor.setAttribute('target', '_blank')
        anchor.setAttribute('rel', 'noreferrer noopener')
        anchor.textContent = text
        saved.insertNode(anchor)
        if (state.blockId !== null) {
          const element = document.querySelector(`[data-block="${state.blockId}"] .nb-b-edit`)
          if (element !== null) changeText(state.blockId, htmlToMarkdown(element))
        }
        selection.removeAllRanges()
        selectionRef.current = null
        savedRangeRef.current = null
        setSelection(null)
      }

      const dragging = drag !== null
      React.useEffect(() => {
        if (!dragging) return undefined
        function handleMove(event) {
          const state = dragRef.current
          if (state === null) return
          if (!state.moved && Math.hypot(event.clientX - state.startX, event.clientY - state.startY) < 5) return
          state.moved = true
          if (ghostRef.current !== null) {
            ghostRef.current.style.left = `${event.clientX + 14}px`
            ghostRef.current.style.top = `${event.clientY + 10}px`
          }
          // Auto-scroll near the document's vertical edges so a block can be
          // dragged past the visible area.
          const scroller = scrollRef.current
          if (scroller !== null) {
            const viewport = scroller.getBoundingClientRect()
            const edge = 56
            if (event.clientY < viewport.top + edge) scroller.scrollTop -= 20
            else if (event.clientY > viewport.bottom - edge) scroller.scrollTop += 20
          }
          let over = null
          const nodes = Array.from(document.querySelectorAll('[data-block]'))
          for (const node of nodes) {
            const rect = node.getBoundingClientRect()
            if (event.clientY >= rect.top && event.clientY <= rect.bottom) {
              over = { id: node.getAttribute('data-block'), before: event.clientY < rect.top + rect.height / 2 }
              break
            }
          }
          state.overId = over === null ? null : over.id
          state.before = over === null ? true : over.before
          setDrag({ id: state.id, overId: state.overId, before: state.before, moved: true })
        }
        function handleUp() {
          const state = dragRef.current
          dragRef.current = null
          setDrag(null)
          if (state === null) return
          if (state.moved !== true) {
            setMenuFor(state.id)
            return
          }
          const list = blocksRef.current
          if (Array.isArray(state.group) && state.group.length > 1) {
            const moved = moveBlockGroup(list, state.group, state.overId, state.before)
            if (moved !== null) {
              updateBlocks(moved)
              setBlockSelection(null)
            }
            return
          }
          const from = list.findIndex((block) => block.id === state.id)
          const targetIndex = list.findIndex((block) => block.id === state.overId)
          if (from < 0 || targetIndex < 0) return
          let insertAt = state.before ? targetIndex : targetIndex + 1
          if (from < insertAt) insertAt -= 1
          if (insertAt === from) return
          const next = [...list]
          const [moved] = next.splice(from, 1)
          next.splice(insertAt, 0, moved)
          updateBlocks(next)
        }
        document.addEventListener('mousemove', handleMove)
        document.addEventListener('mouseup', handleUp)
        return () => {
          document.removeEventListener('mousemove', handleMove)
          document.removeEventListener('mouseup', handleUp)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [dragging])

      function pasteBlocks(blockId, raw) {
        const list = blocksRef.current
        const index = list.findIndex((block) => block.id === blockId)
        if (index < 0) return
        const parsed = parseBlocks(raw)
        const current = list[index]
        const replaceCurrent = current === undefined || String(current.text ?? '').trim() === ''
        const next = replaceCurrent
          ? [...list.slice(0, index), ...parsed, ...list.slice(index + 1)]
          : [...list.slice(0, index + 1), ...parsed, ...list.slice(index + 1)]
        updateBlocks(next)
        setEditingId(null)
        setSlash(null)
      }

      function handleFileDragOver(event) {
        const types = event.dataTransfer && event.dataTransfer.types ? Array.from(event.dataTransfer.types) : []
        if (types.includes('Files')) event.preventDefault()
      }

      function selectLink(blockId, href, x, y) {
        setLinkBar({ blockId, href: String(href ?? ''), x, y })
        setImageBar(null)
      }

      function commitLink(nextHref, remove) {
        const bar = linkBar
        if (bar === null) return
        updateBlocks(
          blocksRef.current.map((block) => {
            if (block.id !== bar.blockId) return block
            let rewritten = false
            const next = String(block.text ?? '').replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, href) => {
              if (rewritten || href !== bar.href) return match
              rewritten = true
              return remove ? text : `[${text}](${nextHref})`
            })
            return rewritten ? { ...block, text: next } : block
          }),
        )
        if (remove) setLinkBar(null)
      }

      function insertImageUrl() {
        const url = imageUrl.trim()
        const blockId = imageTargetId
        setDialog(null)
        setImageUrl('')
        setImageTargetId(null)
        if (url.length === 0 || blockId === null) return
        if (!/^https?:\/\//i.test(url) && !/\.(png|jpe?g|gif|webp|avif|svg)$/i.test(url)) {
          setNotice({ kind: 'error', text: t('coverInvalid') })
          return
        }
        updateBlocks(
          blocksRef.current.map((block) => {
            if (block.id !== blockId) return block
            const text = String(block.text ?? '')
            return { ...block, text: text.trim().length === 0 ? `![](${url})` : `${text}\n![](${url})` }
          }),
        )
        setEditingId(null)
      }

      function selectImage(blockId, alt, widthText, x, y) {
        const parsed = Number.parseInt(String(widthText ?? '').replace('%', ''), 10)
        setImageBar({
          blockId,
          alt: String(alt ?? ''),
          width: Number.isFinite(parsed) && parsed > 0 ? parsed : null,
          x,
          y,
        })
      }

      /** Rewrite the first image run in the block's text (alt / width / remove). */
      function commitImage(nextAlt, nextWidth, remove) {
        const bar = imageBar
        if (bar === null) return
        updateBlocks(
          blocksRef.current.map((block) => {
            if (block.id !== bar.blockId) return block
            const text = String(block.text ?? '')
            let rewritten = false
            const next = text.replace(/!\[[^\]]*\]\(([^)]+)\)(?:\{width=\d+%\})?/g, (match, src) => {
              if (rewritten) return match
              rewritten = true
              if (remove) return ''
              const suffix = nextWidth === null || nextWidth === undefined ? '' : `{width=${nextWidth}%}`
              return `![${nextAlt}](${src})${suffix}`
            })
            return rewritten ? { ...block, text: next } : block
          }),
        )
      }

      function handleFileDrop(event) {
        const files = event.dataTransfer && event.dataTransfer.files ? Array.from(event.dataTransfer.files) : []
        const images = files.filter((file) => String(file.type).startsWith('image/'))
        if (images.length === 0) return
        event.preventDefault()
        const list = blocksRef.current
        const targetId = editingId !== null ? editingId : list.length > 0 ? list[list.length - 1].id : null
        if (targetId === null) return
        uploadImages(images, targetId)
      }

      async function uploadImages(files, blockId) {
        for (const file of files) {
          try {
            const data = await fileToBase64(file)
            const uploaded = await apiPost('/upload', { name: file.name || 'image.png', data })
            const markdown = `![](${uploaded.path})`
            const list = blocksRef.current
            const index = list.findIndex((block) => block.id === blockId)
            if (index < 0) continue
            const text = String(list[index].text ?? '')
            const nextText = text.trim().length === 0 ? markdown : `${text}\n${markdown}`
            updateBlocks(list.map((item) => (item.id === blockId ? { ...item, text: nextText } : item)))
          } catch (error) {
            setNotice({ kind: 'error', text: error.message })
          }
        }
        // Leave edit mode so the image renders immediately instead of showing
        // its Markdown source in the focused block.
        setEditingId(null)
        setSlash(null)
      }

      function setCodeLang(id, lang) {
        updateBlocks(blocksRef.current.map((block) => (block.id === id ? { ...block, lang } : block)))
      }

      function changeIndent(id, delta) {
        updateBlocks(
          blocksRef.current.map((block) => {
            if (block.id !== id) return block
            const current = Math.min(3, Math.max(0, Number(block.indent) || 0))
            const next = Math.max(0, Math.min(3, current + delta))
            return next === current ? block : { ...block, indent: next }
          }),
        )
      }

      function tableChange(id, rows) {
        updateBlocks(
          blocksRef.current.map((block) => (block.id === id ? { ...block, rows } : block)),
          { mergeKey: `table:${id}` },
        )
      }

      /** Column widths are view state: kept on the block and remembered per note. */
      function moveTableColumns(id, from, to) {
        updateBlocks(
          blocksRef.current.map((block) => {
            if (block.id !== id) return block
            const rows = moveTableColumn(block.rows, from, to)
            let aligns = block.aligns
            if (Array.isArray(block.aligns) && block.aligns.length > Math.max(from, to)) {
              const nextAligns = block.aligns.slice()
              const [movedAlign] = nextAligns.splice(from, 1)
              nextAligns.splice(to, 0, movedAlign)
              aligns = nextAligns
            }
            return { ...block, rows, aligns }
          }),
        )
      }

      function updateTableWidths(id, widths) {
        const next = blocksRef.current.map((block) =>
          block.id === id ? { ...block, colWidths: widths } : block,
        )
        updateBlocks(next, { record: false })
        const path = selectedRef.current
        if (path === null) return
        try {
          const tables = next
            .filter((block) => block.type === 'table')
            .map((block) => (Array.isArray(block.colWidths) ? block.colWidths : null))
          window.localStorage.setItem(`${COLS_KEY}${path}`, JSON.stringify(tables))
        } catch {
          /* preferences are best-effort */
        }
      }

      function convertBlock(id, shortcut, sourceText) {
        updateBlocks(
          blocksRef.current.map((block) => {
            if (block.id !== id) return block
            return {
              ...block,
              type: shortcut.type,
              text: shortcut.text,
              checked: shortcut.checked === true,
            }
          }),
        )
        setEditingId(id)
        setFocusRequest({ id, offset: shortcut.text.length })
        void sourceText
      }

      function splitBlock(id, before, after) {
        const list = blocksRef.current
        const index = list.findIndex((block) => block.id === id)
        if (index < 0) return
        const block = list[index]
        const headText = String(before ?? '')
        const tailText = String(after ?? '')
        // Enter on an empty styled block exits the style instead of creating a
        // second empty block of the same kind.
        if (headText.length === 0 && tailText.length === 0 && block.type !== 'paragraph') {
          updateBlocks(list.map((item) => (item.id === id ? { ...item, type: 'paragraph', checked: false } : item)))
          setEditingId(id)
          setFocusRequest({ id, offset: 0 })
          return
        }
        const continues = isListType(block.type) ? block.type : block.type.startsWith('heading') ? 'paragraph' : block.type === 'quote' || block.type === 'code' ? 'paragraph' : block.type
        const nextType = continues === 'divider' ? 'paragraph' : continues
        const created = { id: makeId(), type: nextType, text: tailText, checked: false }
        const head = { ...block, text: headText }
        const next = [...list.slice(0, index), head, created, ...list.slice(index + 1)]
        updateBlocks(next)
        setEditingId(created.id)
        setFocusRequest({ id: created.id, offset: 0 })
      }

      function removeBlock(id) {
        const list = blocksRef.current
        const index = list.findIndex((block) => block.id === id)
        if (index < 0) return
        if (list.length <= 1) {
          const only = { id: makeId(), type: 'paragraph', text: '', checked: false }
          updateBlocks([only])
          setEditingId(only.id)
          setFocusRequest({ id: only.id, offset: 0 })
          return
        }
        const next = list.filter((block) => block.id !== id)
        const previous = next[Math.max(0, index - 1)]
        updateBlocks(next)
        setEditingId(previous.id)
        setFocusRequest({ id: previous.id, offset: 'end' })
      }

      function setBlockType(id, type) {
        updateBlocks(
          blocksRef.current.map((block) => {
            if (block.id !== id) return block
            if (type === 'table') {
              return { ...block, type, text: '', checked: false, rows: [['', ''], ['', '']] }
            }
            return {
              ...block,
              type,
              text: type === 'divider' ? '' : block.text,
              checked: type === 'todo' ? block.checked === true : false,
            }
          }),
        )
        setMenuFor(null)
        if (type === 'divider' || type === 'table') {
          setEditingId(null)
          setFocusRequest(null)
        } else {
          setEditingId(id)
          setFocusRequest({ id, offset: 'end' })
        }
      }

      function toggleTodo(id) {
        updateBlocks(
          blocksRef.current.map((block) =>
            block.id === id ? { ...block, checked: block.checked !== true } : block,
          ),
        )
      }

      function moveBlock(id, delta) {
        const list = [...blocksRef.current]
        const index = list.findIndex((block) => block.id === id)
        const target = index + delta
        if (index < 0 || target < 0 || target >= list.length) return
        const [moved] = list.splice(index, 1)
        list.splice(target, 0, moved)
        updateBlocks(list)
        setMenuFor(null)
      }

      /** Turn one block into its own page: create the note and leave a wiki link behind. */
      async function extractPage(blockId) {
        const block = blocksRef.current.find((item) => item.id === blockId)
        if (block === undefined || selectedRef.current === null) {
          setMenuFor(null)
          return
        }
        const title = String(block.text ?? '').trim().replace(/\.md$/i, '') || t('untitled')
        const path = pagePathFor(selectedRef.current, title)
        setMenuFor(null)
        try {
          await saveNow(blocksRef.current)
          const parentPath = String(selectedRef.current).replace(/\.md$/i, '')
          const frontmatter = `---\nparent: ${parentPath}\n---\n`
          await apiPost('/create', { path, content: frontmatter })
          try {
            const relation = await apiGet('/parents')
            if (relation.parents !== null && typeof relation.parents === 'object') {
              setParents(relation.parents)
            }
          } catch {
            /* keep the flat list when the Host predates the route */
          }
          updateBlocks(
            blocksRef.current.map((item) =>
              item.id === blockId ? { ...item, type: 'paragraph', text: `[[${title}]]` } : item,
            ),
          )
          await loadList()
          setNotice({ kind: 'ok', text: t('extractPageDone').replace('{name}', title) })
        } catch (error) {
          setNotice({ kind: 'error', text: error.message })
        }
      }

      async function copyBlockLink(blockId) {
        const block = blocksRef.current.find((item) => item.id === blockId)
        setMenuFor(null)
        if (block === undefined || selectedRef.current === null) return
        let target = block
        if (BLOCK_ID_TYPES.has(block.type) && (typeof block.blockId !== 'string' || block.blockId.length === 0)) {
          const anchorId = makeId().replace(/[^A-Za-z0-9_-]/g, '')
          updateBlocks(
            blocksRef.current.map((item) => (item.id === block.id ? { ...item, blockId: anchorId } : item)),
          )
          target = { ...block, blockId: anchorId }
        }
        const link = blockLinkFor(selectedRef.current, target)
        try {
          await navigator.clipboard.writeText(link)
          setNotice({ kind: 'ok', text: t('copyLinkDone').replace('{link}', link) })
        } catch {
          setNotice({ kind: 'error', text: t('copyFailed') })
        }
      }

      function deleteBlock(id) {
        removeBlock(id)
        setMenuFor(null)
      }

      function shiftSelect(blockId) {
        setBlockSelection((current) => {
          if (current === null) {
            const anchor = editingId === null ? blockId : editingId
            return { anchorId: anchor, focusId: blockId }
          }
          return { anchorId: current.anchorId, focusId: blockId }
        })
        setEditingId(null)
      }

      function selectedBlockRange() {
        const current = blockSelectionRef.current
        if (current === null) return null
        const list = blocksRef.current
        const ids = list.map((block) => block.id)
        const a = ids.indexOf(current.anchorId)
        const b = ids.indexOf(current.focusId)
        if (a < 0 || b < 0) return null
        const [lo, hi] = a <= b ? [a, b] : [b, a]
        return list.slice(lo, hi + 1)
      }

      function selectedBlocksMarkdown() {
        const range = selectedBlockRange()
        if (range === null) return ''
        return `${range.map((block) => blockToMarkdown(block)).join('\n\n')}\n`
      }

      function deleteSelectedBlocks() {
        const range = selectedBlockRange()
        if (range === null) return
        const remove = new Set(range.map((block) => block.id))
        const next = blocksRef.current.filter((block) => !remove.has(block.id))
        updateBlocks(
          next.length > 0 ? next : [{ id: makeId(), type: 'paragraph', text: '', checked: false }],
        )
        setBlockSelection(null)
      }

      function toggleCollapse(id) {
        setCollapsedHeadings((current) => ({ ...current, [id]: current[id] !== true }))
      }

      /** Toggle blocks persist their collapsed state in the note (`[!toggle]-`). */
      function openProps() {
        setTitleMenu(false)
        setPropsTagList(parseListValue(frontmatterValue(frontmatterRef.current, 'tags')))
        setPropsTagDraft('')
        setPropsAliases(parseListValue(frontmatterValue(frontmatterRef.current, 'aliases')).join(', '))
        setPropsDraft(
          Object.fromEntries(
            frontmatterEntries(frontmatterRef.current).map((entry) => [entry.key, entry.value]),
          ),
        )
        setDialog({ kind: 'props' })
      }

      function addPropField() {
        const key = newFieldKey.trim()
        if (!isValidFrontmatterKey(key)) {
          setNotice({ kind: 'error', text: t('propsInvalidKey') })
          return
        }
        updateFrontmatter(withFrontmatterValue(frontmatterRef.current, key, newFieldValue.trim()))
        setPropsDraft((current) => ({ ...current, [key]: newFieldValue.trim() }))
        setNewFieldKey('')
        setNewFieldValue('')
      }

      function persistTags(list) {
        setPropsTagList(list)
        updateFrontmatter(
          withFrontmatterValue(frontmatterRef.current, 'tags', formatListValue(list.join(', '))),
        )
      }

      function addPropTag() {
        const tag = propsTagDraft.trim()
        if (tag.length === 0) return
        const next = addTagToList(propsTagList, tag)
        if (next.length === propsTagList.length) {
          setPropsTagDraft('')
          return
        }
        setPropsTagDraft('')
        persistTags(next)
      }

      function removePropTag(tag) {
        persistTags(removeTagFromList(propsTagList, tag))
      }

      function openTypePanel() {
        setTitleMenu(false)
        setCustomFont(
          typeface.startsWith(CUSTOM_FONT_PREFIX) ? typeface.slice(CUSTOM_FONT_PREFIX.length) : '',
        )
        const status = {}
        for (const preset of FONT_PRESETS) {
          const family = primaryFamily(preset.stack)
          try {
            status[preset.id] =
              typeof document !== 'undefined' &&
              document.fonts !== undefined &&
              typeof document.fonts.check === 'function'
                ? document.fonts.check(`14px "${family}"`)
                : true
          } catch {
            status[preset.id] = true
          }
        }
        setFontStatus(status)
        setDialog({ kind: 'type' })
      }

      function applyCustomFont() {
        const clean = sanitizeFontStack(customFont)
        if (clean.length === 0) return
        setTypeface(`${CUSTOM_FONT_PREFIX}${clean}`)
        setDialog(null)
      }

      function saveProps() {
        let next = withFrontmatterValue(
          frontmatterRef.current,
          'tags',
          formatListValue(propsTagList.join(', ')),
        )
        next = withFrontmatterValue(next, 'aliases', formatListValue(propsAliases))
        updateFrontmatter(next)
        setDialog(null)
      }

      function toggleBlockCollapsed(id) {
        updateBlocks(
          blocksRef.current.map((block) =>
            block.id === id ? { ...block, collapsed: block.collapsed !== true } : block,
          ),
        )
      }

      /** Follow an Obsidian-style `[[wiki]]` link to the matching note. */
      async function openWiki(rawName) {
        const link = parseWikiLink(rawName)
        const note = findWikiTarget(notes, link.name)
        if (note === null || note === undefined) {
          setNotice({ kind: 'error', text: t('wikiNotFound').replace('{name}', link.name) })
          return
        }
        await openNote(note.path)
        if (link.anchor.length === 0) return
        if (link.anchor.startsWith('^')) {
          const blockAnchor = link.anchor.slice(1)
          const targetBlock = blocksRef.current.find((block) => block.blockId === blockAnchor)
          if (targetBlock !== undefined) scrollToBlock(targetBlock.id)
          return
        }
        const wanted = link.anchor.toLowerCase()
        const target = blocksRef.current.find(
          (block) => headingLevel(block.type) > 0 && String(block.text ?? '').trim().toLowerCase() === wanted,
        )
        if (target !== undefined) scrollToBlock(target.id)
      }

      function addBlock() {
        const created = { id: makeId(), type: 'paragraph', text: '', checked: false }
        updateBlocks([...blocksRef.current, created])
        setEditingId(created.id)
        setFocusRequest({ id: created.id, offset: 0 })
      }

      function insertAfter(id) {
        const list = blocksRef.current
        const index = list.findIndex((block) => block.id === id)
        const created = { id: makeId(), type: 'paragraph', text: '', checked: false }
        const next =
          index < 0 ? [...list, created] : [...list.slice(0, index + 1), created, ...list.slice(index + 1)]
        updateBlocks(next)
        setEditingId(created.id)
        setFocusRequest({ id: created.id, offset: 0 })
      }

      async function createNoteWith(baseName, body) {
        await saveNow(blocksRef.current)
        const dir =
          selectedRef.current === null
            ? ''
            : selectedRef.current.slice(0, selectedRef.current.lastIndexOf('/') + 1)
        let name = baseName
        let attempt = 1
        while (attempt <= 50) {
          try {
            const data = await apiPost('/create', { path: `${dir}${name}.md`, content: body })
            await loadList()
            await openNote(data.path)
            window.requestAnimationFrame(() => {
              const element = titleRef.current
              if (element === null) return
              element.focus()
              try {
                const range = document.createRange()
                range.selectNodeContents(element)
                const selection = window.getSelection()
                if (selection !== null) {
                  selection.removeAllRanges()
                  selection.addRange(range)
                }
              } catch {
                /* focusing the title is best-effort */
              }
            })
            return
          } catch (error) {
            if (error.code !== 'note_exists') {
              setNotice({ kind: 'error', text: error.message })
              return
            }
            attempt += 1
            name = `${baseName} ${attempt}`
          }
        }
      }

      async function createNote(templateId) {
        const template = NOTE_TEMPLATES.find((item) => item.id === templateId) ?? NOTE_TEMPLATES[0]
        const baseName = template.id === 'blank' ? t('untitled') : t(template.titleKey)
        await createNoteWith(baseName, t(template.bodyKey))
      }

      async function openTemplates() {
        setDialog({ kind: 'template' })
        if (vaultTemplates !== null) return
        try {
          const templateDir =
            remoteConfig !== null &&
            typeof remoteConfig.templateDir === 'string' &&
            remoteConfig.templateDir.length > 0
              ? remoteConfig.templateDir
              : TEMPLATE_FOLDER
          const data = await apiGet(`/list?folder=${encodeURIComponent(templateDir)}`)
          setVaultTemplates(Array.isArray(data.notes) ? data.notes : [])
        } catch {
          setVaultTemplates([])
        }
      }

      async function useVaultTemplate(template, mode) {
        setDialog(null)
        try {
          const data = await apiGet(`/read?path=${encodeURIComponent(template.path)}`)
          const name = String(template.name ?? '').trim() || t('untitled')
          if (mode === 'button') {
            await createSubPageFromContent(name, splitFrontmatter(data.content).body)
          } else {
            await createNoteWith(name, data.content)
          }
        } catch (error) {
          setNotice({ kind: 'error', text: error.message })
        }
      }

      /** Create a child page (parent in frontmatter) from template content. */
      async function createSubPageFromContent(baseName, body) {
        if (selectedRef.current === null) return
        await saveNow(blocksRef.current)
        const parent = String(selectedRef.current).replace(/\.md$/i, '')
        const dir =
          selectedRef.current.lastIndexOf('/') < 0
            ? ''
            : selectedRef.current.slice(0, selectedRef.current.lastIndexOf('/') + 1)
        const base = String(baseName ?? '').trim().replace(/\.md$/i, '') || t('untitled')
        let name = base
        let attempt = 1
        while (attempt <= 50) {
          const path = `${dir}${name}.md`
          try {
            const content = composeContent(`parent: ${parent}`, body)
            const data = await apiPost('/create', { path, content })
            await loadList()
            try {
              const relation = await apiGet('/parents')
              if (relation.parents !== null && typeof relation.parents === 'object') {
                setParents(relation.parents)
              }
            } catch {
              /* keep the flat list when the Host predates the route */
            }
            await openNote(data.path)
            return
          } catch (error) {
            if (error.code !== 'note_exists') {
              setNotice({ kind: 'error', text: error.message })
              return
            }
            attempt += 1
            name = `${base} ${attempt}`
          }
        }
      }

      async function createSubPageFromTemplate(templateId) {
        const template = NOTE_TEMPLATES.find((item) => item.id === templateId) ?? NOTE_TEMPLATES[0]
        const name = template.id === 'blank' ? t('untitled') : t(template.titleKey)
        await createSubPageFromContent(name, t(template.bodyKey))
      }

      async function openTemplateButton() {
        await openTemplates()
        setDialog({ kind: 'template', source: 'button' })
      }

      async function commitTitle(element) {
        if (selected === null) return
        const raw = (element.textContent ?? '').trim().replace(/\.md$/i, '')
        if (raw.length === 0 || raw === currentTitle) {
          element.textContent = currentTitle
          return
        }
        if (/[\\/:*?"<>|]/.test(raw)) {
          setNotice({ kind: 'error', text: 'The title contains a character a file name cannot hold.' })
          element.textContent = currentTitle
          return
        }
        const slash = selected.lastIndexOf('/')
        const dir = slash < 0 ? '' : selected.slice(0, slash + 1)
        const target = `${dir}${raw}.md`
        try {
          const data = await apiPost('/rename', { from: selected, to: target })
          selectedRef.current = data.to
          setSelected(data.to)
          await loadList()
          setSaveState('saved')
        } catch (error) {
          setNotice({ kind: 'error', text: error.message })
          element.textContent = currentTitle
        }
      }

      function closeTab(path) {
        const remaining = tabs.filter((item) => item !== path)
        setTabs(remaining)
        if (selected !== path) return
        const nextPath = remaining.length > 0 ? remaining[remaining.length - 1] : null
        if (nextPath !== null) {
          openNote(nextPath)
          return
        }
        selectedRef.current = null
        setSelected(null)
        updateBlocks([], { record: false })
        historyRef.current = { past: [], future: [], lastKey: null, lastAt: 0 }
        baselineRef.current = ''
        mtimeRef.current = 0
        frontmatterRef.current = ''
        setFrontmatter('')
        setEditingId(null)
        setMenuFor(null)
        setTableRevision((value) => value + 1)
      }

      async function createFolder() {
        const name = folderDraft.trim()
        if (name.length === 0) return
        try {
          const data = await apiPost('/mkdir', { path: name })
          setDialog(null)
          setFolderDraft('')
          setExpanded((current) => ({ ...current, [data.path]: true }))
          await loadList()
        } catch (error) {
          setNotice({ kind: 'error', text: error.message })
        }
      }

      async function movePathTo(path, dir) {
        const name = String(path).split('/').pop().replace(/\.md$/i, '')
        const target = `${dir.length === 0 ? '' : `${dir}/`}${name}.md`
        if (target === path) return
        try {
          await apiPost('/rename', { from: path, to: target })
          await loadList()
          if (selectedRef.current === path) {
            await openNote(target)
          } else {
            setTabs((previous) => previous.map((item) => (item === path ? target : item)))
          }
        } catch (error) {
          setNotice({ kind: 'error', text: error.message })
        }
      }

      async function moveNoteTo(dir) {
        const note = moveNote
        setDialog(null)
        setMoveNote(null)
        if (note === null) return
        await movePathTo(note.path, dir)
      }

      function focusTitle() {
        window.requestAnimationFrame(() => {
          const element = titleRef.current
          if (element === null) return
          element.focus()
          try {
            const range = document.createRange()
            range.selectNodeContents(element)
            const selection = window.getSelection()
            if (selection !== null) {
              selection.removeAllRanges()
              selection.addRange(range)
            }
          } catch {
            /* focusing the title is best-effort */
          }
        })
      }

      async function renameNoteFromMenu() {
        const path = noteMenu === null ? null : noteMenu.path
        setNoteMenu(null)
        if (path === null) return
        await openNote(path)
        focusTitle()
      }

      function toggleFavorite(path) {
        setNoteMenu(null)
        if (typeof path !== 'string' || path.length === 0) return
        setFavorites((previous) =>
          previous.includes(path) ? previous.filter((item) => item !== path) : [path, ...previous],
        )
      }

      function openQuick() {
        setQuickQuery('')
        setQuickIndex(0)
        setQuickOpen(true)
      }

      function pickQuick(path) {
        setQuickOpen(false)
        openNote(path)
      }

      async function copyNotePath() {
        const path = noteMenu === null ? '' : noteMenu.path
        setNoteMenu(null)
        if (path.length === 0) return
        try {
          await navigator.clipboard.writeText(path)
          setNotice({ kind: 'ok', text: t('copyPathDone') })
        } catch {
          setNotice({ kind: 'error', text: t('copyFailed') })
        }
      }

      async function deleteNoteAt(path) {
        setNoteMenu(null)
        if (path.length === 0) return
        try {
          await apiPost('/delete', { path })
          setTabs((previous) => previous.filter((item) => item !== path))
          if (selectedRef.current === path) {
            selectedRef.current = null
            setSelected(null)
            updateBlocks([], { record: false })
            historyRef.current = { past: [], future: [], lastKey: null, lastAt: 0 }
            baselineRef.current = ''
            mtimeRef.current = 0
            frontmatterRef.current = ''
            setFrontmatter('')
            try {
              window.localStorage.removeItem(LAST_NOTE_KEY)
            } catch {
              /* preferences are best-effort */
            }
          }
          await loadList()
        } catch (error) {
          setNotice({ kind: 'error', text: error.message })
        }
      }

      async function deleteNote() {
        if (selected === null) return
        const path = selected
        setDialog(null)
        try {
          await apiPost('/delete', { path })
          setTabs((previous) => previous.filter((item) => item !== path))
          if (selectedRef.current === path) {
            selectedRef.current = null
            setSelected(null)
            updateBlocks([], { record: false })
            historyRef.current = { past: [], future: [], lastKey: null, lastAt: 0 }
            try {
              window.localStorage.removeItem(LAST_NOTE_KEY)
            } catch {
              /* preferences are best-effort */
            }
            baselineRef.current = ''
            mtimeRef.current = 0
            frontmatterRef.current = ''
            setFrontmatter('')
          }
          await loadList()
          setNotice(null)
        } catch (error) {
          setNotice({ kind: 'error', text: error.message })
        }
      }

      function runSearch(value) {
        setSearch(value)
        if (searchTimer.current !== null) clearTimeout(searchTimer.current)
        const query = value.trim()
        if (query.length === 0) {
          setHits(null)
          return
        }
        searchTimer.current = setTimeout(async () => {
          try {
            const data = await apiGet(`/search?q=${encodeURIComponent(query)}&limit=50`)
            setHits(Array.isArray(data.matches) ? data.matches : [])
          } catch (error) {
            setNotice({ kind: 'error', text: error.message })
          }
        }, 300)
      }

      const groups = React.useMemo(() => {
        const map = new Map()
        for (const note of notes) {
          const dir = note.dir || ''
          if (!map.has(dir)) map.set(dir, [])
          map.get(dir).push(note)
        }
        return [...map.entries()].sort((a, b) => {
          if (a[0] === '') return -1
          if (b[0] === '') return 1
          return a[0].localeCompare(b[0], 'zh-Hans-CN')
        })
      }, [notes])

      const outline = React.useMemo(
        () =>
          blocks
            .filter((block) => headingLevel(block.type) > 0)
            .map((block) => ({
              id: block.id,
              level: headingLevel(block.type),
              text: String(block.text ?? '').trim(),
            })),
        [blocks],
      )

      function handleDocScroll() {
        const scroller = scrollRef.current
        if (scroller === null) return
        if (Date.now() < outlineLockRef.current) return
        if (scrollSaveTimer.current !== null) clearTimeout(scrollSaveTimer.current)
        scrollSaveTimer.current = setTimeout(() => {
          const path = selectedRef.current
          if (path === null || scrollRef.current === null) return
          try {
            window.localStorage.setItem(`${SCROLL_KEY}${path}`, String(Math.round(scrollRef.current.scrollTop)))
          } catch {
            /* preferences are best-effort */
          }
        }, 250)
        if (outline.length === 0) return
        const threshold = scroller.getBoundingClientRect().top + 110
        let current = null
        for (const item of outline) {
          const element = document.querySelector(`[data-block="${item.id}"]`)
          if (element === null) continue
          if (element.getBoundingClientRect().top <= threshold) current = item.id
          else break
        }
        setActiveHeadingId((previous) => (previous === current ? previous : current))
      }

      function scrollToTop() {
        if (scrollRef.current !== null) scrollRef.current.scrollTop = 0
      }

      const findMatches = React.useMemo(() => {
        const needle = findQuery.trim().toLowerCase()
        if (needle.length === 0) return []
        return blocks
          .filter((block) => {
            const text = String(block.text ?? '')
            if (text.toLowerCase().includes(needle)) return true
            if (Array.isArray(block.rows)) {
              return block.rows.some((row) =>
                row.some((cell) => String(cell ?? '').toLowerCase().includes(needle)),
              )
            }
            return false
          })
          .map((block) => block.id)
      }, [blocks, findQuery])

      React.useEffect(() => {
        if (!findOpen || findMatches.length === 0) return
        const id = findMatches[Math.min(findIndex, findMatches.length - 1)]
        if (id !== undefined) scrollToBlock(id)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [findIndex, findMatches, findOpen])

      function stepFind(delta) {
        if (findMatches.length === 0) return
        setFindIndex((current) => (current + delta + findMatches.length) % findMatches.length)
      }

      function downloadFile(name, content, mime) {
        try {
          const blob = new Blob([content], { type: mime })
          const url = URL.createObjectURL(blob)
          const anchor = document.createElement('a')
          anchor.href = url
          anchor.download = name
          document.body.appendChild(anchor)
          anchor.click()
          anchor.remove()
          setTimeout(() => URL.revokeObjectURL(url), 1000)
        } catch (error) {
          setNotice({ kind: 'error', text: String((error && error.message) || error) })
        }
      }

      function exportMarkdown() {
        if (selected === null) return
        setTitleMenu(false)
        const content = composeContent(frontmatterRef.current, serializeBlocks(blocksRef.current))
        downloadFile(`${currentTitle.length > 0 ? currentTitle : 'note'}.md`, content, 'text/markdown;charset=utf-8')
      }

      function exportHtml() {
        if (selected === null) return
        setTitleMenu(false)
        const title = currentTitle.length > 0 ? currentTitle : 'note'
        const body = blocksRef.current.map((block) => blockToHtml(block)).join('\n')
        const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font-family:-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;max-width:760px;margin:48px auto;padding:0 20px;line-height:1.7;color:#222}
h1,h2,h3{line-height:1.35}pre{background:#f5f6f8;padding:12px 14px;border-radius:8px;overflow:auto}code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.9em}
blockquote{border-left:3px solid #ddd;margin:.8em 0;padding:.2em 0 .2em 14px;color:#555}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:6px 9px;text-align:left}
img{max-width:100%;border-radius:6px}hr{border:none;border-top:1px solid #ddd;margin:1.2em 0}</style></head>
<body>${body}</body></html>`
        downloadFile(`${title}.html`, html, 'text/html;charset=utf-8')
      }

      async function openHistory() {
        if (selected === null) return
        setTitleMenu(false)
        setHistoryPreview(null)
        setHistory({ path: selected, entries: [], loading: true })
        setDialog({ kind: 'history' })
        try {
          const data = await apiGet(`/history?path=${encodeURIComponent(selected)}`)
          setHistory({
            path: data.path,
            entries: Array.isArray(data.entries) ? data.entries : [],
            loading: false,
          })
        } catch (error) {
          setHistory(null)
          setDialog(null)
          setNotice({ kind: 'error', text: error.message })
        }
      }

      async function previewHistory(entry) {
        if (history === null) return
        try {
          const data = await apiGet(
            `/history/note?path=${encodeURIComponent(history.path)}&id=${encodeURIComponent(entry.id)}`,
          )
          const current = composeContent(frontmatterRef.current, serializeBlocks(blocksRef.current))
          const fullDiff = diffLines(current, data.content)
          setHistoryPreview({
            id: entry.id,
            content: data.content,
            diff: collapseDiff(fullDiff, 3),
            hasChanges: fullDiff.some((line) => line.type !== 'same'),
          })
          setDialog({ kind: 'historyPreview' })
        } catch (error) {
          setNotice({ kind: 'error', text: error.message })
        }
      }

      async function restoreHistory() {
        if (history === null || historyPreview === null) return
        const path = history.path
        const content = historyPreview.content
        setHistoryPreview(null)
        setHistory(null)
        setDialog(null)
        try {
          await saveNow(blocksRef.current)
          const data = await apiPost('/write', { path, content, expectedMtimeMs: mtimeRef.current })
          const split = splitFrontmatter(content)
          const parsed = parseBlocks(split.body)
          frontmatterRef.current = split.frontmatter
          setFrontmatter(split.frontmatter)
          baselineRef.current = content
          mtimeRef.current = data.mtimeMs
          updateBlocks(parsed, { record: false })
          historyRef.current = { past: [], future: [], lastKey: null, lastAt: 0 }
          setTableRevision((value) => value + 1)
          setNotice({ kind: 'ok', text: t('historyRestored') })
        } catch (error) {
          setNotice({ kind: 'error', text: error.message })
        }
      }

      function switchTab(delta) {
        const next = nextTabId(tabs, selected, delta)
        if (next !== null) openNote(next)
      }

      function handleDocTouchStart(event) {
        if (event.touches === undefined || event.touches.length !== 1) {
          swipeRef.current = null
          return
        }
        const touch = event.touches[0]
        swipeRef.current = { x: touch.clientX, y: touch.clientY, at: Date.now() }
      }

      function handleDocTouchEnd(event) {
        const start = swipeRef.current
        swipeRef.current = null
        if (start === null) return
        if (event.changedTouches === undefined || event.changedTouches.length === 0) return
        const touch = event.changedTouches[0]
        const dx = touch.clientX - start.x
        const dy = touch.clientY - start.y
        if (Math.abs(dx) < 80) return
        if (Math.abs(dy) > 60) return
        if (Date.now() - start.at > 700) return
        switchTab(dx < 0 ? 1 : -1)
      }

      function scrollToBlock(id) {
        const element = document.querySelector(`[data-block="${id}"]`)
        if (element !== null && typeof element.scrollIntoView === 'function') {
          element.scrollIntoView({ block: 'start', behavior: 'smooth' })
          element.classList.remove('nb-flash')
          // Restart the flash even when the same block is targeted again.
          void element.offsetWidth
          element.classList.add('nb-flash')
          setTimeout(() => element.classList.remove('nb-flash'), 850)
        }
      }

      const numbers = React.useMemo(() => {
        const map = new Map()
        let counter = 0
        for (const block of blocks) {
          if (block.type === 'numbered') {
            counter += 1
            map.set(block.id, counter)
          } else {
            counter = 0
          }
        }
        return map
      }, [blocks])

      const hiddenIds = React.useMemo(() => {
        const hidden = hiddenByCollapsedHeadings(blocks, collapsedHeadings)
        for (const id of hiddenByToggles(blocks)) hidden.add(id)
        return hidden
      }, [blocks, collapsedHeadings])

      const blockSelectionIds = React.useMemo(() => {
        if (blockSelection === null) return new Set()
        const ids = blocks.map((block) => block.id)
        const a = ids.indexOf(blockSelection.anchorId)
        const b = ids.indexOf(blockSelection.focusId)
        if (a < 0 || b < 0) return new Set()
        const [lo, hi] = a <= b ? [a, b] : [b, a]
        return new Set(ids.slice(lo, hi + 1))
      }, [blockSelection, blocks])

      React.useEffect(() => {
        blockSelectionRef.current = blockSelection
      }, [blockSelection])

      const saveLabel =
        saveState === 'saving'
          ? t('saving')
          : saveState === 'error'
            ? t('saveError')
            : saveState === 'unsaved'
              ? t('unsaved')
              : t('saved')

      const breadcrumb =
        selected === null
          ? status !== null && status.name !== null
            ? status.name
            : ''
          : (() => {
              const cut = selected.lastIndexOf('/')
              return cut < 0 ? (status !== null && status.name !== null ? status.name : '') : `${selected.slice(0, cut)} / `
            })()

      const sidePanel = h(
        'aside',
        { className: 'nb-side' },
        h(
          'div',
          { className: 'nb-side-top' },
          h('input', {
            className: 'nb-search',
            value: search,
            placeholder: t('searchPlaceholder'),
            onChange: (event) => runSearch(event.target.value),
            'aria-label': t('searchPlaceholder'),
          }),
          h(
            'button',
            { className: 'nb-new', onClick: () => openTemplates() },
            h('span', { className: 'nb-new-plus' }, '+'),
            h('span', null, t('newNote')),
          ),
          h(
            'button',
            {
              className: 'nb-new nb-new-folder',
              onClick: () => {
                setFolderDraft('')
                setDialog({ kind: 'folder' })
              },
            },
            `+ ${t('newFolder')}`,
          ),
        ),
        favorites.length > 0 || recent.length > 0
          ? h(
              'div',
              { className: 'nb-quick' },
              favorites.length > 0
                ? h(
                    'div',
                    { className: 'nb-quick-group' },
                    h('div', { className: 'nb-quick-title' }, `★ ${t('favorites')}`),
                    favorites.map((path) => {
                      const note = notes.find((item) => item.path === path)
                      if (note === undefined) return null
                      return h(
                        'button',
                        {
                          key: `fav-${path}`,
                          className: 'nb-quick-item',
                          title: path,
                          onClick: () => openNote(path),
                        },
                        note.name,
                      )
                    }),
                  )
                : null,
              recent.length > 0
                ? h(
                    'div',
                    { className: 'nb-quick-group' },
                    h('div', { className: 'nb-quick-title' }, `⟲ ${t('recent')}`),
                    recent.slice(0, 5).map((path) => {
                      const note = notes.find((item) => item.path === path)
                      if (note === undefined) return null
                      return h(
                        'button',
                        {
                          key: `recent-${path}`,
                          className: 'nb-quick-item',
                          title: path,
                          onClick: () => openNote(path),
                        },
                        note.name,
                      )
                    }),
                  )
                : null,
            )
          : null,
        h(
          'div',
          { className: 'nb-tree' },
          loading === true
            ? h('div', { className: 'nb-side-empty' }, t('loading'))
            : hits !== null
              ? hits.length === 0
                ? h('div', { className: 'nb-side-empty' }, t('noResults'))
                : hits.map((hit, hitIndex) =>
                    h(
                      'button',
                      {
                        key: `hit-${hitIndex}`,
                        className: 'nb-hit',
                        onClick: () => openNote(hit.path),
                        title: `${hit.path}:${hit.line}`,
                      },
                      h('span', { className: 'nb-hit-name' }, hit.path.split('/').pop().replace(/\.md$/i, '')),
                      h('span', { className: 'nb-hit-line' }, highlightText(hit.text, search)),
                    ),
                  )
              : notes.length === 0
                ? h('div', { className: 'nb-side-empty' }, t('noNotes'))
                : groups.map(([dir, items]) =>
                    h(
                      'div',
                      { className: 'nb-group', key: `group-${dir}` },
                      dir === ''
                        ? null
                        : h(
                            'div',
                            {
                              className: 'nb-group-title',
                              'data-folder': dir,
                              style: { paddingLeft: `${6 + Math.max(0, dir.split('/').length - 1) * 12}px` },
                              onClick: () =>
                                setExpanded({ ...expanded, [dir]: !(expanded[dir] === true) }),
                              onDragOver: (event) => {
                                event.preventDefault()
                                if (event.dataTransfer !== null && event.dataTransfer !== undefined) {
                                  event.dataTransfer.dropEffect = 'move'
                                }
                              },
                              onDrop: (event) => {
                                event.preventDefault()
                                const dropped =
                                  dragNotePathRef.current ??
                                  (event.dataTransfer !== null && event.dataTransfer !== undefined
                                    ? event.dataTransfer.getData('text/plain')
                                    : '')
                                dragNotePathRef.current = null
                                if (dropped.length > 0) movePathTo(dropped, dir)
                              },
                            },
                            h('span', null, `${expanded[dir] === true ? '▾' : '▸'} ${dir.split('/').pop()}`),
                            h('span', { className: 'nb-group-count' }, String(items.length)),
                          ),
                      dir === '' || expanded[dir] === true
                        ? flattenTree(items, parents).map(({ note, depth }) =>
                            h(
                              'button',
                              {
                                key: note.path,
                                className: `nb-note${selected === note.path ? ' on' : ''}`,
                                style: {
                                  paddingLeft: `${8 + Math.max(0, dir.split('/').length - 1) * 12 + depth * 14}px`,
                                },
                                onClick: () => openNote(note.path),
                                draggable: true,
                                onDragStart: (event) => {
                                  dragNotePathRef.current = note.path
                                  if (event.dataTransfer !== null && event.dataTransfer !== undefined) {
                                    event.dataTransfer.setData('text/plain', note.path)
                                    event.dataTransfer.effectAllowed = 'move'
                                  }
                                },
                                onDragEnd: () => {
                                  dragNotePathRef.current = null
                                },
                                onContextMenu: (event) => {
                                  event.preventDefault()
                                  setNoteMenu({ path: note.path, name: note.name, x: event.clientX, y: event.clientY })
                                },
                                title: note.path,
                              },
                              h('span', { className: 'nb-note-name' }, note.name),
                            ),
                          )
                        : null,
                    ),
                  ),
        ),
      )

      const mainPanel = h(
        'section',
        { className: 'nb-main' },
        h(
          'div',
          { className: 'nb-topbar' },
          h(
            'div',
            { className: 'nb-tabs' },
            tabs.length === 0
              ? h('div', { className: 'nb-crumb' }, breadcrumb)
              : tabs.map((path) =>
                  h(
                    'div',
                    {
                      key: path,
                      className: `nb-tab${selected === path ? ' on' : ''}`,
                      title: path,
                      onClick: () => openNote(path),
                    },
                    h('span', { className: 'nb-tab-name' }, path.split('/').pop().replace(/\.md$/i, '')),
                    h(
                      'button',
                      {
                        className: 'nb-tab-close',
                        'aria-label': t('close'),
                        onClick: (event) => {
                          event.stopPropagation()
                          closeTab(path)
                        },
                      },
                      '×',
                    ),
                  ),
                ),
          ),
          selected !== null
            ? h(
                'button',
                {
                  className: 'nb-icon-btn',
                  title: zen ? t('exitZen') : t('zenMode'),
                  'aria-label': zen ? t('exitZen') : t('zenMode'),
                  onClick: () => setZenMode(!zen),
                },
                zen ? '◧' : '◨',
              )
            : null,
          selected !== null
            ? h(
                'button',
                {
                  className: 'nb-icon-btn',
                  title: wide ? t('narrowMode') : t('wideMode'),
                  'aria-label': wide ? t('narrowMode') : t('wideMode'),
                  onMouseDown: (event) => event.stopPropagation(),
                  onClick: () => {
                    const next = !wide
                    setWide(next)
                    try {
                      window.localStorage.setItem(WIDE_KEY, next ? '1' : '0')
                    } catch {
                      /* preferences are best-effort */
                    }
                  },
                },
                wide ? '⇥' : '⇤',
              )
            : null,
          selected !== null
            ? h('div', { className: `nb-save${saveState === 'error' ? ' error' : ''}` }, saveLabel)
            : null,
          selected !== null
            ? h(
                'div',
                { style: { position: 'relative' } },
                h(
                  'button',
                  {
                    className: 'nb-icon-btn',
                    'aria-label': t('more'),
                    onMouseDown: (event) => event.stopPropagation(),
                    onClick: (event) => {
                      event.stopPropagation()
                      setTitleMenu((value) => !value)
                    },
                  },
                  '⋯',
                ),
                noteMenu !== null
                  ? h(
                      'div',
                      {
                        className: 'nb-note-menu',
                        style: { left: `${noteMenu.x}px`, top: `${noteMenu.y}px` },
                        onMouseDown: (event) => event.stopPropagation(),
                      },
                      h(
                        'button',
                        { className: 'nb-menu-item', onClick: () => toggleFavorite(noteMenu.path) },
                        favorites.includes(noteMenu.path) ? t('removeFavorite') : t('addFavorite'),
                      ),
                      h(
                        'button',
                        { className: 'nb-menu-item', onClick: () => renameNoteFromMenu() },
                        t('rename'),
                      ),
                      h(
                        'button',
                        {
                          className: 'nb-menu-item',
                          onClick: () => {
                            setMoveNote(noteMenu)
                            setNoteMenu(null)
                            setDialog({ kind: 'move' })
                          },
                        },
                        t('moveTo'),
                      ),
                      h(
                        'button',
                        { className: 'nb-menu-item', onClick: () => copyNotePath() },
                        t('copyPath'),
                      ),
                      h(
                        'button',
                        { className: 'nb-menu-item danger', onClick: () => deleteNoteAt(noteMenu.path) },
                        t('deleteNote'),
                      ),
                    )
                  : null,
                titleMenu === true
                  ? h(
                      'div',
                      {
                        className: 'nb-menu',
                        style: { right: 0, left: 'auto' },
                        onMouseDown: (event) => event.stopPropagation(),
                      },
                      h(
                        'button',
                        { className: 'nb-menu-item', onClick: exportMarkdown },
                        t('exportMarkdown'),
                      ),
                      h('button', { className: 'nb-menu-item', onClick: exportHtml }, t('exportHtml')),
                      h(
                        'button',
                        {
                          className: 'nb-menu-item',
                          onClick: () => {
                            setTitleMenu(false)
                            try {
                              window.print()
                            } catch {
                              /* printing is best-effort */
                            }
                          },
                        },
                        t('exportPdf'),
                      ),
                      h('button', { className: 'nb-menu-item', onClick: openProps }, t('propsTitle')),
                      h('button', { className: 'nb-menu-item', onClick: openHistory }, t('historyTitle')),
                      h(
                        'button',
                        {
                          className: 'nb-menu-item',
                          onClick: () => {
                            setTitleMenu(false)
                            setDialog({ kind: 'graph' })
                          },
                        },
                        t('graphTitle'),
                      ),
                      h(
                        'button',
                        {
                          className: 'nb-menu-item',
                          onClick: () => openAiPage(),
                        },
                        t('aiPageTitle'),
                      ),
                      h(
                        'button',
                        {
                          className: 'nb-menu-item',
                          onClick: () => {
                            setTitleMenu(false)
                            setFontScale((value) => Math.min(22, value + 1))
                          },
                        },
                        t('fontLarger'),
                      ),
                      h(
                        'button',
                        {
                          className: 'nb-menu-item',
                          onClick: () => {
                            setTitleMenu(false)
                            setFontScale((value) => Math.max(13, value - 1))
                          },
                        },
                        t('fontSmaller'),
                      ),
                      h('button', { className: 'nb-menu-item', onClick: openTypePanel }, t('typeTitle')),
                      h(
                        'button',
                        {
                          className: 'nb-menu-item',
                          onClick: () => {
                            setTitleMenu(false)
                            setReading((value) => !value)
                          },
                        },
                        reading ? t('exitReading') : t('readingMode'),
                      ),
                      h('div', { className: 'nb-menu-sep' }),
                      h(
                        'button',
                        {
                          className: 'nb-menu-item',
                          onClick: () => {
                            setTitleMenu(false)
                            setDialog({ kind: 'shortcuts' })
                          },
                        },
                        t('shortcutsTitle'),
                      ),
                      h('div', { className: 'nb-menu-sep' }),
                      h(
                        'button',
                        {
                          className: 'nb-menu-item',
                          onClick: () => {
                            setTitleMenu(false)
                            setIconOpen(true)
                            scrollToTop()
                          },
                        },
                        t('changeIcon'),
                      ),
                      h(
                        'button',
                        {
                          className: 'nb-menu-item',
                          onClick: () => {
                            setTitleMenu(false)
                            if (cover.length > 0) {
                              updateFrontmatter(withFrontmatterCover(frontmatterRef.current, ''))
                            } else {
                              setCoverValue('')
                              setCoverOpen(true)
                              scrollToTop()
                            }
                          },
                        },
                        cover.length > 0 ? t('removeCover') : t('addCover'),
                      ),
                      h('div', { className: 'nb-menu-sep' }),
                      h(
                        'button',
                        {
                          className: 'nb-menu-item danger',
                          onClick: () => {
                            setTitleMenu(false)
                            setDialog({ kind: 'delete', path: selected })
                          },
                        },
                        t('deleteNote'),
                      ),
                    )
                  : null,
              )
            : null,
        ),
        findOpen === true
          ? h(
              'div',
              { className: 'nb-find', onMouseDown: (event) => event.stopPropagation() },
              h('input', {
                className: 'nb-input nb-find-input',
                autoFocus: true,
                value: findQuery,
                placeholder: t('findPlaceholder'),
                'aria-label': t('findPlaceholder'),
                onChange: (event) => {
                  setFindQuery(event.target.value)
                  setFindIndex(0)
                },
                onKeyDown: (event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    stepFind(event.shiftKey ? -1 : 1)
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    setFindOpen(false)
                  }
                },
              }),
              h('span', { className: 'nb-find-count' }, `${findMatches.length}`),
              h('button', { className: 'nb-icon-btn', onClick: () => stepFind(-1), 'aria-label': 'previous' }, '↑'),
              h('button', { className: 'nb-icon-btn', onClick: () => stepFind(1), 'aria-label': 'next' }, '↓'),
              h('button', { className: 'nb-icon-btn', onClick: () => setFindOpen(false), 'aria-label': t('close') }, '×'),
            )
          : null,
        notice !== null
          ? h(
              'div',
              { className: 'nb-notice' },
              h('span', null, notice.text),
              h(
                'button',
                {
                  className: 'nb-icon-btn',
                  style: { float: 'right', marginTop: -2 },
                  onClick: () => setNotice(null),
                  'aria-label': t('cancel'),
                },
                '×',
              ),
            )
          : null,
        selected === null
          ? h(
              'div',
              {
                className: 'nb-scroll',
                ref: scrollRef,
                onDragOver: handleFileDragOver,
                onDrop: handleFileDrop,
                onScroll: handleDocScroll,
                onTouchStart: handleDocTouchStart,
                onTouchEnd: handleDocTouchEnd,
              },
              h(
                'div',
                { className: 'nb-empty' },
                h('div', { className: 'nb-empty-title' }, t('emptyTitle')),
                h('div', { className: 'nb-empty-text' }, t('emptyHint')),
                h(
                  'button',
                  { className: 'nb-empty-btn', onClick: () => openTemplates() },
                  t('newNote'),
                ),
              ),
            )
          : h(
              'div',
              {
                className: 'nb-scroll',
                ref: scrollRef,
                onDragOver: handleFileDragOver,
                onDrop: handleFileDrop,
                onScroll: handleDocScroll,
                onTouchStart: handleDocTouchStart,
                onTouchEnd: handleDocTouchEnd,
              },
              h(
                'div',
                {
                  className: `nb-doc${wide ? ' full' : ''}`,
                  style: { fontSize: `${fontScale}px`, fontFamily: resolveFontStack(typeface) },
                },
                selected === null
                  ? null
                  : h(
                      'div',
                      { className: 'nb-breadcrumb' },
                      h(
                        'button',
                        {
                          className: 'nb-breadcrumb-root',
                          onClick: () => revealFolder(''),
                        },
                        status !== null && status.name !== null ? status.name : t('notes'),
                      ),
                      ...String(selected)
                        .split('/')
                        .map((segment, index, parts) => {
                          const isLast = index === parts.length - 1
                          const dirPath = parts.slice(0, index + 1).join('/')
                          const label = isLast ? segment.replace(/\.md$/i, '') : segment
                          return [
                            h('span', { key: `sep-${index}`, className: 'nb-breadcrumb-sep' }, '/'),
                            isLast
                              ? h('span', { key: `crumb-${index}`, className: 'nb-breadcrumb-current' }, label)
                              : h(
                                  'button',
                                  {
                                    key: `crumb-${index}`,
                                    title: dirPath,
                                    onClick: () => revealFolder(dirPath),
                                  },
                                  label,
                                ),
                          ]
                        })
                        .flat(),
                    ),
                cover.length > 0
                  ? h(
                      'div',
                      {
                        className: 'nb-cover',
                        style: { backgroundImage: `url("${attachmentSrc(cover)}")` },
                      },
                      h(
                        'button',
                        {
                          className: 'nb-cover-remove',
                          title: t('removeCover'),
                          'aria-label': t('removeCover'),
                          onMouseDown: (event) => event.stopPropagation(),
                          onClick: () =>
                            updateFrontmatter(withFrontmatterCover(frontmatterRef.current, '')),
                        },
                        '×',
                      ),
                    )
                  : h(
                      'button',
                      {
                        className: 'nb-cover-add',
                        onMouseDown: (event) => event.stopPropagation(),
                        onClick: () => {
                          setCoverValue('')
                          setCoverOpen(true)
                        },
                      },
                      `+ ${t('addCover')}`,
                    ),
                coverOpen === true
                  ? h(
                      'div',
                      { className: 'nb-cover-panel', onMouseDown: (event) => event.stopPropagation() },
                      h('input', {
                        className: 'nb-input',
                        autoFocus: true,
                        value: coverValue,
                        placeholder: t('coverPlaceholder'),
                        'aria-label': t('coverPlaceholder'),
                        onChange: (event) => setCoverValue(event.target.value),
                        onKeyDown: (event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            applyCover()
                          } else if (event.key === 'Escape') {
                            event.preventDefault()
                            setCoverOpen(false)
                          }
                        },
                      }),
                      h('button', { className: 'nb-btn', onClick: applyCover }, t('confirm')),
                      h('button', { className: 'nb-btn', onClick: () => setCoverOpen(false) }, t('cancel')),
                    )
                  : null,
                h(
                  'div',
                  { className: 'nb-icon-row' },
                  icon.length > 0
                    ? h(
                        'button',
                        {
                          className: 'nb-page-icon',
                          title: t('changeIcon'),
                          'aria-label': t('changeIcon'),
                          onMouseDown: (event) => event.stopPropagation(),
                          onClick: () => setIconOpen((value) => !value),
                        },
                        icon,
                      )
                    : h(
                        'button',
                        {
                          className: 'nb-icon-add',
                          onMouseDown: (event) => event.stopPropagation(),
                          onClick: () => setIconOpen((value) => !value),
                        },
                        `+ ${t('addIcon')}`,
                      ),
                  iconOpen === true
                    ? h(
                        'div',
                        { className: 'nb-icon-panel', onMouseDown: (event) => event.stopPropagation() },
                        h(
                          'div',
                          { className: 'nb-icon-grid' },
                          PAGE_EMOJIS.map((emoji) =>
                            h(
                              'button',
                              {
                                key: emoji,
                                className: 'nb-icon-choice',
                                onClick: () => {
                                  updateFrontmatter(withFrontmatterIcon(frontmatterRef.current, emoji))
                                  setIconOpen(false)
                                },
                              },
                              emoji,
                            ),
                          ),
                        ),
                        h(
                          'button',
                          {
                            className: 'nb-icon-remove',
                            onClick: () => {
                              updateFrontmatter(withFrontmatterIcon(frontmatterRef.current, ''))
                              setIconOpen(false)
                            },
                          },
                          t('removeIcon'),
                        ),
                      )
                    : null,
                ),
                h('div', {
                  ref: titleRef,
                  className: 'nb-title',
                  contentEditable: true,
                  suppressContentEditableWarning: true,
                  spellCheck: false,
                  'data-placeholder': t('untitled'),
                  onBlur: (event) => commitTitle(event.currentTarget),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      event.currentTarget.blur()
                    }
                  },
                }),
                collection !== null
                  ? h(CollectionView, {
                      t,
                      config: collection.config,
                      rows: collection.rows,
                      loading: collection.loading,
                      folder: collection.folder ?? '',
                      onOpen: (path) => openNote(path),
                      onReload: reloadCollection,
                      onFieldChange: updateCollectionField,
                      onCreate: createCollectionRow,
                    })
                  : null,
                h(
                  'div',
                  { className: 'nb-blocks' },
                  blocks
                    .filter((block) => !hiddenIds.has(block.id))
                    .map((block, index) =>
                    h(BlockView, {
                      key: block.id,
                      block,
                      index,
                      editing: editingId === block.id,
                      menuOpen: menuFor === block.id,
                      focusRequest,
                      number: numbers.get(block.id),
                      t,
                      onBegin: beginEditing,
                      onText: changeText,
                      onConvert: convertBlock,
                      onSplit: splitBlock,
                      onRemove: removeBlock,
                      onToggleTodo: toggleTodo,
                      onMenu: setMenuFor,
                      onType: setBlockType,
                      onMove: moveBlock,
                      onDelete: deleteBlock,
                      onInsertAfter: insertAfter,
                      slashQuery: slash !== null && slash.blockId === block.id ? slash.query : null,
                      onSlash: handleSlash,
                      wikiQuery:
                        wikiSuggest !== null && wikiSuggest.blockId === block.id ? wikiSuggest.query : null,
                      onWiki: handleWikiSuggest,
                      onPickWiki: pickWikiSuggestion,
                      onPick: pickSlash,
                      onPasteBlocks: pasteBlocks,
                      onTableResize: updateTableWidths,
                      onTableMoveColumn: moveTableColumns,
                      onToggleBlock: toggleBlockCollapsed,
                      onOpenWiki: openWiki,
                      onExtractPage: extractPage,
                      onTemplate: openTemplateButton,
                      onCopyLink: copyBlockLink,
                      onAi: openAiBlock,
                      notes,
                      onUploadImages: uploadImages,
                      onTableChange: tableChange,
                      dragging: drag !== null && drag.id === block.id,
                      dropMark: drag !== null && drag.overId === block.id ? (drag.before ? 'before' : 'after') : null,
                      onDragStart: startDrag,
                      selected: blockSelectionIds.has(block.id),
                      onShiftSelect: shiftSelect,
                      collapsible: headingLevel(block.type) > 0,
                      collapsed: collapsedHeadings[block.id] === true,
                      onToggleCollapse: toggleCollapse,
                      tableRevision,
                      onSetLang: setCodeLang,
                      onImageSelect: selectImage,
                      onLinkSelect: selectLink,
                      onIndent: changeIndent,
                      onFocusConsumed: () => setFocusRequest(null),
                      onCloseMenu: () => setMenuFor(null),
                    }),
                  ),
                ),
                h('button', { className: 'nb-add', onClick: addBlock }, `+ ${t('addBlock')}`),
                backlinks.length > 0 || outgoing.length > 0 || mentions.length > 0
                  ? h(
                      'div',
                      { className: `nb-links${linksOpen ? ' open' : ''}` },
                      h(
                        'button',
                        {
                          className: 'nb-links-toggle',
                          onClick: () => setLinksOpen((value) => !value),
                          'aria-expanded': linksOpen ? 'true' : 'false',
                        },
                        h('span', { className: 'nb-links-chevron' }, linksOpen ? '▾' : '▸'),
                        h('span', { className: 'nb-links-head' }, t('linksTitle')),
                        h(
                          'span',
                          { className: 'nb-links-counts' },
                          `${t('backlinks')} ${backlinks.length} · ${t('outlinks')} ${outgoing.length}${
                            mentions.length > 0 ? ` · ${t('mentions')} ${mentions.length}` : ''
                          }`,
                        ),
                      ),
                      linksOpen === true
                        ? h(
                            'div',
                            { className: 'nb-links-body' },
                            h(
                              'div',
                              { className: 'nb-links-cols' },
                        h(
                          'div',
                          { className: 'nb-links-col' },
                          h('div', { className: 'nb-links-label' }, `${t('backlinks')} · ${backlinks.length}`),
                          backlinks.length === 0
                            ? h('div', { className: 'nb-links-empty' }, t('noBacklinks'))
                            : backlinks.map((link) =>
                                h(
                                  'button',
                                  {
                                    key: link.path,
                                    className: 'nb-link-item',
                                    title: (Array.isArray(link.lines) ? link.lines : [])
                                      .map((line) => `L${line.number}: ${line.text}`)
                                      .join('\n'),
                                    onClick: () => openNote(link.path),
                                  },
                                  h('span', { className: 'nb-link-name' }, link.name),
                                  Array.isArray(link.lines) && link.lines.length > 0
                                    ? h('span', { className: 'nb-link-meta' }, `L${link.lines[0].number}`)
                                    : null,
                                ),
                              ),
                        ),
                        h(
                          'div',
                          { className: 'nb-links-col' },
                          h('div', { className: 'nb-links-label' }, `${t('outlinks')} · ${outgoing.length}`),
                          outgoing.length === 0
                            ? h('div', { className: 'nb-links-empty' }, t('noOutlinks'))
                            : outgoing.map((link) =>
                                h(
                                  'button',
                                  {
                                    key: link.name,
                                    className: 'nb-link-item',
                                    onClick: () => openWiki(link.name),
                                  },
                                  h('span', { className: 'nb-link-name' }, link.name),
                                  link.embed === true
                                    ? h('span', { className: 'nb-link-meta' }, t('embedTag'))
                                    : null,
                                ),
                              ),
                        ),
                      ),
                      mentions.length > 0
                        ? h(
                            'div',
                            { className: 'nb-links-mentions' },
                            h('div', { className: 'nb-links-label' }, `${t('mentions')} · ${mentions.length}`),
                            mentions.map((mention) =>
                              h(
                                'div',
                                { key: mention.path, className: 'nb-mention-item' },
                                h('span', { className: 'nb-mention-name' }, mention.name),
                                h('span', { className: 'nb-link-meta' }, String(mention.count)),
                                h(
                                  'button',
                                  {
                                    className: 'nb-mention-link',
                                    onClick: () => updateBlocks(linkMentions(blocksRef.current, mention.name)),
                                  },
                                  t('linkIt'),
                                ),
                              ),
                            ),
                          )
                        : null,
                            )
                          : null,
                    )
                  : null,
              ),
            ),
            editingId !== null && outline.length > 0
              ? h(
                  'div',
                  { className: 'nb-outline-float', onMouseDown: (event) => event.preventDefault() },
                  h('div', { className: 'nb-outline-float-title' }, t('outline')),
                  outline.map((item) =>
                    h(
                      'button',
                      {
                        key: item.id,
                        className: `nb-outline-float-item${activeHeadingId === item.id ? ' on' : ''}`,
                        style: { paddingLeft: `${8 + (item.level - 1) * 10}px` },
                        title: item.text,
                        onClick: () => {
                          outlineLockRef.current = Date.now() + 800
                          setActiveHeadingId(item.id)
                          scrollToBlock(item.id)
                        },
                      },
                      item.text.length > 0 ? item.text : t('untitled'),
                    ),
                  ),
                )
              : null,
      )

      return h(
        'div',
        { className: `nb-root${zen ? ' zen' : ''}${reading ? ' reading' : ''}` },
        h('style', null, CSS),
        sidePanel,
        mainPanel,
        zen === true
          ? h(
              'button',
              {
                className: 'nb-zen-exit',
                onClick: () => setZenMode(false),
                title: t('exitZen'),
                'aria-label': t('exitZen'),
              },
              '◧ ',
              t('exitZen'),
            )
          : null,
        aiPanel !== null
          ? h(
              'div',
              {
                className: 'nb-modal',
                onMouseDown: (event) => {
                  if (event.target === event.currentTarget) setAiPanel(null)
                },
              },
              h(
                'div',
                { className: 'nb-modal-card nb-ai-card', role: 'dialog', 'aria-modal': 'true' },
                h('div', { className: 'nb-modal-title' }, t('aiTitle')),
                h(
                  'div',
                  { className: 'nb-ai-tasks' },
                  (aiPanel.scope === 'block'
                    ? ['rewrite', 'continue', 'polish', 'translate']
                    : ['summary', 'tags', 'agent']
                  ).map((task) =>
                    h(
                      'button',
                      {
                        key: task,
                        className: `nb-ai-task${aiPanel.task === task ? ' on' : ''}`,
                        onClick: () => setAiPanel({ ...aiPanel, task, result: '', error: '' }),
                      },
                      t(AI_TASK_LABELS[task]),
                    ),
                  ),
                ),
                aiPanel.task === 'agent'
                  ? h('textarea', {
                      className: 'nb-input nb-ai-instruction',
                      value: aiPanel.instruction ?? '',
                      rows: 3,
                      placeholder: t('aiAgentPlaceholder'),
                      onChange: (event) => setAiPanel({ ...aiPanel, instruction: event.target.value }),
                    })
                  : h(
                      'div',
                      { className: 'nb-ai-source' },
                      (() => {
                        const source = aiInputText(aiPanel)
                        return source.length > 240 ? `${source.slice(0, 240)}…` : source
                      })(),
                    ),
                aiPanel.loading === true
                  ? h('div', { className: 'nb-ai-result loading' }, t('aiGenerating'))
                  : aiPanel.error.length > 0
                    ? h('div', { className: 'nb-ai-result error' }, aiPanel.error)
                    : aiPanel.result.length > 0
                      ? h('textarea', {
                          className: 'nb-input nb-ai-result',
                          value: aiPanel.result,
                          rows: 6,
                          onChange: (event) => setAiPanel({ ...aiPanel, result: event.target.value }),
                        })
                      : null,
                h(
                  'div',
                  { className: 'nb-modal-actions' },
                  aiPanel.result.length > 0
                    ? h('button', { className: 'nb-btn', onClick: () => applyAiResult('copy') }, t('copy'))
                    : null,
                  h('button', { className: 'nb-btn', onClick: () => setAiPanel(null) }, t('cancel')),
                  aiPanel.task === 'agent'
                    ? null
                    : aiPanel.result.length > 0 && aiPanel.scope === 'block'
                      ? h('button', { className: 'nb-btn', onClick: () => applyAiResult('insert') }, t('aiInsertBelow'))
                      : null,
                  aiPanel.task === 'agent'
                    ? aiPanel.result.length > 0
                      ? h('button', { className: 'nb-btn nb-btn-primary', onClick: () => setAiPanel(null) }, t('close'))
                      : h(
                          'button',
                          {
                            className: 'nb-btn nb-btn-primary',
                            onClick: runAi,
                            disabled: aiPanel.loading === true,
                          },
                          t('aiRun'),
                        )
                    : aiPanel.result.length > 0
                      ? h(
                          'button',
                          {
                            className: 'nb-btn nb-btn-primary',
                            onClick: () => applyAiResult(aiPanel.scope === 'block' ? 'replace' : 'insert'),
                          },
                          aiPanel.scope === 'block' ? t('aiReplace') : t('aiInsertTop'),
                        )
                      : h(
                          'button',
                          {
                            className: 'nb-btn nb-btn-primary',
                            onClick: runAi,
                            disabled: aiPanel.loading === true,
                          },
                          t('aiGenerate'),
                        ),
                ),
              ),
            )
          : null,
        quickOpen === true
          ? h(
              'div',
              {
                className: 'nb-quick-open',
                onMouseDown: (event) => {
                  if (event.target === event.currentTarget) setQuickOpen(false)
                },
              },
              h(
                'div',
                { className: 'nb-quick-card', role: 'dialog', 'aria-modal': 'true' },
                h('input', {
                  className: 'nb-input nb-quick-input',
                  value: quickQuery,
                  placeholder: t('quickOpenPlaceholder'),
                  autoFocus: true,
                  'aria-label': t('quickOpenPlaceholder'),
                  onChange: (event) => {
                    setQuickQuery(event.target.value)
                    setQuickIndex(0)
                  },
                  onKeyDown: (event) => {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault()
                      setQuickIndex((index) => Math.min(index + 1, quickItems.length - 1))
                    } else if (event.key === 'ArrowUp') {
                      event.preventDefault()
                      setQuickIndex((index) => Math.max(0, index - 1))
                    } else if (event.key === 'Enter') {
                      event.preventDefault()
                      const note = quickItems[quickIndex]
                      if (note !== undefined) pickQuick(note.path)
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      setQuickOpen(false)
                    }
                  },
                }),
                h(
                  'div',
                  { className: 'nb-quick-list' },
                  quickItems.length === 0
                    ? h('div', { className: 'nb-side-empty' }, t('noResults'))
                    : quickItems.map((note, index) =>
                        h(
                          'button',
                          {
                            key: note.path,
                            className: `nb-quick-row${index === quickIndex ? ' on' : ''}`,
                            onMouseDown: (event) => {
                              event.preventDefault()
                              pickQuick(note.path)
                            },
                          },
                          h('span', { className: 'nb-quick-row-name' }, note.name),
                          h('span', { className: 'nb-quick-row-path' }, note.dir),
                        ),
                      ),
                ),
              ),
            )
          : null,
        wikiSuggest !== null && wikiItems.length > 0
          ? h(
              'div',
              {
                className: 'nb-wiki-pop',
                style: { top: `${wikiSuggest.top}px`, left: `${wikiSuggest.left}px` },
                onMouseDown: (event) => event.preventDefault(),
              },
              wikiItems.map((note) =>
                h(
                  'button',
                  {
                    key: note.path,
                    className: 'nb-wiki-item',
                    title: note.path,
                    onMouseDown: (event) => {
                      event.preventDefault()
                      insertWikiLink(note.name)
                    },
                  },
                  note.name,
                ),
              ),
            )
          : null,
        drag !== null
          ? h(
              'div',
              { ref: ghostRef, className: 'nb-ghost' },
              (() => {
                const group = dragRef.current !== null && Array.isArray(dragRef.current.group)
                  ? dragRef.current.group
                  : null
                if (group !== null && group.length > 1) return `${group.length} ${t('blocksCount')}`
                const block = blocksRef.current.find((item) => item.id === drag.id)
                if (block === undefined) return ''
                const text = String(block.text ?? '').trim()
                return text.length > 0 ? text.slice(0, 120) : '⋮⋮'
              })(),
            )
          : null,
        imageBar !== null
          ? h(
              'div',
              {
                className: 'nb-img-bar',
                style: {
                  left: `${Math.max(8, Math.min(imageBar.x, (window.innerWidth || 1200) - 380))}px`,
                  top: `${Math.max(8, imageBar.y + 14)}px`,
                },
                onMouseDown: (event) => event.stopPropagation(),
              },
              h('input', {
                className: 'nb-img-bar-input',
                value: imageBar.alt,
                placeholder: t('imageAlt'),
                'aria-label': t('imageAlt'),
                onChange: (event) => {
                  const next = event.target.value
                  setImageBar((current) => (current === null ? current : { ...current, alt: next }))
                  commitImage(next, imageBar.width, false)
                },
                onKeyDown: (event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    setImageBar(null)
                  }
                },
              }),
              [25, 50, 75, 100].map((width) =>
                h(
                  'button',
                  {
                    key: width,
                    className: `nb-img-bar-btn${imageBar.width === width ? ' on' : ''}`,
                    onClick: () => {
                      setImageBar((current) => (current === null ? current : { ...current, width }))
                      commitImage(imageBar.alt, width, false)
                    },
                  },
                  `${width}%`,
                ),
              ),
              h(
                'button',
                { className: 'nb-img-bar-btn', onClick: () => setImageBar(null) },
                t('imageDone'),
              ),
              h(
                'button',
                {
                  className: 'nb-img-bar-btn danger',
                  onClick: () => {
                    commitImage(imageBar.alt, null, true)
                    setImageBar(null)
                  },
                },
                t('imageRemove'),
              ),
            )
          : null,
        linkBar !== null
          ? h(
              'div',
              {
                className: 'nb-img-bar',
                style: {
                  left: `${Math.max(8, Math.min(linkBar.x, (window.innerWidth || 1200) - 380))}px`,
                  top: `${Math.max(8, linkBar.y + 14)}px`,
                },
                onMouseDown: (event) => event.stopPropagation(),
              },
              h('input', {
                className: 'nb-img-bar-input',
                value: linkBar.href,
                placeholder: t('linkPlaceholder'),
                'aria-label': t('linkPlaceholder'),
                onChange: (event) => {
                  const next = event.target.value
                  setLinkBar((current) => (current === null ? current : { ...current, href: next }))
                  commitLink(next, false)
                },
                onKeyDown: (event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    setLinkBar(null)
                  }
                },
              }),
              h(
                'button',
                {
                  className: 'nb-img-bar-btn',
                  onClick: () => {
                    if (/^https?:/i.test(linkBar.href)) window.open(linkBar.href, '_blank', 'noopener')
                  },
                },
                t('linkOpen'),
              ),
              h(
                'button',
                {
                  className: 'nb-img-bar-btn danger',
                  onClick: () => {
                    commitLink(null, true)
                    setLinkBar(null)
                  },
                },
                t('linkRemove'),
              ),
              h('button', { className: 'nb-img-bar-btn', onClick: () => setLinkBar(null) }, t('imageDone')),
            )
          : null,
        selection !== null
          ? h(
              'div',
              {
                className: 'nb-toolbar',
                style: {
                  top: `${Math.max(8, selection.top - 46)}px`,
                  left: `${selection.left}px`,
                  transform: 'translateX(-50%)',
                },
                onMouseDown: (event) => event.preventDefault(),
              },
              ...(linkInput === true
                ? [
                    h('input', {
                      key: 'link-input',
                      className: 'nb-toolbar-input',
                      autoFocus: true,
                      value: linkValue,
                      placeholder: t('linkPlaceholder'),
                      'aria-label': t('linkPlaceholder'),
                      onChange: (event) => setLinkValue(event.target.value),
                      onKeyDown: (event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          applyLink()
                        } else if (event.key === 'Escape') {
                          event.preventDefault()
                          setLinkInput(false)
                          setLinkValue('')
                        }
                      },
                    }),
                    h(
                      'button',
                      {
                        key: 'link-ok',
                        className: 'nb-toolbar-btn',
                        title: t('linkConfirm'),
                        onMouseDown: (event) => event.preventDefault(),
                        onClick: applyLink,
                      },
                      '✓',
                    ),
                    h(
                      'button',
                      {
                        key: 'link-cancel',
                        className: 'nb-toolbar-btn',
                        title: t('linkCancel'),
                        onMouseDown: (event) => event.preventDefault(),
                        onClick: () => {
                          setLinkInput(false)
                          setLinkValue('')
                        },
                      },
                      '×',
                    ),
                  ]
                : [
                    ['bold', 'B', t('fmtBold'), 'nb-toolbar-bold'],
                    ['italic', 'I', t('fmtItalic'), 'nb-toolbar-italic'],
                    ['strikeThrough', 'S', t('fmtStrike'), 'nb-toolbar-strike'],
                    ['code', '</>', t('fmtCode'), 'nb-toolbar-code'],
                    ['link', '🔗', t('fmtLink'), ''],
                    ['clear', '⌫', t('fmtClear'), ''],
                  ].map(([kind, label, title, extra]) =>
                    h(
                      'button',
                      {
                        key: kind,
                        className: `nb-toolbar-btn ${extra}`.trim(),
                        title,
                        'aria-label': title,
                        onMouseDown: (event) => event.preventDefault(),
                        onClick: () => {
                          if (kind === 'link') {
                            setLinkInput(true)
                            setLinkValue('')
                            return
                          }
                          formatSelection(kind)
                        },
                      },
                      label,
                    ),
                  )),
            )
          : null,
        dialog !== null && dialog.kind === 'delete'
          ? h(
              'div',
              {
                className: 'nb-modal',
                onMouseDown: (event) => {
                  if (event.target === event.currentTarget) setDialog(null)
                },
              },
              h(
                'div',
                { className: 'nb-modal-card', role: 'dialog', 'aria-modal': 'true' },
                h('div', { className: 'nb-modal-title' }, t('deleteTitle')),
                h('div', { className: 'nb-modal-text' }, `${dialog.path} — ${t('deleteBody')}`),
                h(
                  'div',
                  { className: 'nb-modal-actions' },
                  h('button', { className: 'nb-btn', onClick: () => setDialog(null) }, t('cancel')),
                  h('button', { className: 'nb-btn nb-btn-danger', onClick: deleteNote }, t('confirm')),
                ),
              ),
            )
          : dialog !== null && dialog.kind === 'shortcuts'
            ? h(
                'div',
                {
                  className: 'nb-modal',
                  onMouseDown: (event) => {
                    if (event.target === event.currentTarget) setDialog(null)
                  },
                },
                h(
                  'div',
                  { className: 'nb-modal-card', role: 'dialog', 'aria-modal': 'true' },
                  h('div', { className: 'nb-modal-title' }, t('shortcutsTitle')),
                  h(
                    'div',
                    { className: 'nb-shortcuts' },
                    SHORTCUTS.map(([keys, labelKey]) =>
                      h(
                        'div',
                        { key: labelKey, className: 'nb-shortcut' },
                        h('span', { className: 'nb-shortcut-keys' }, keys),
                        h('span', { className: 'nb-shortcut-label' }, t(labelKey)),
                      ),
                    ),
                  ),
                  h(
                    'div',
                    { className: 'nb-modal-actions' },
                    h('button', { className: 'nb-btn', onClick: () => setDialog(null) }, t('close')),
                  ),
                ),
              )
            : dialog !== null && dialog.kind === 'image'
              ? h(
                  'div',
                  {
                    className: 'nb-modal',
                    onMouseDown: (event) => {
                      if (event.target === event.currentTarget) setDialog(null)
                    },
                  },
                  h(
                    'div',
                    { className: 'nb-modal-card', role: 'dialog', 'aria-modal': 'true' },
                    h('div', { className: 'nb-modal-title' }, t('typeImage')),
                    h('input', {
                      className: 'nb-input',
                      autoFocus: true,
                      value: imageUrl,
                      placeholder: t('imageUrl'),
                      'aria-label': t('imageUrl'),
                      onChange: (event) => setImageUrl(event.target.value),
                      onKeyDown: (event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          insertImageUrl()
                        } else if (event.key === 'Escape') {
                          event.preventDefault()
                          setDialog(null)
                        }
                      },
                    }),
                    h(
                      'div',
                      { className: 'nb-modal-actions' },
                      h('button', { className: 'nb-btn', onClick: () => setDialog(null) }, t('cancel')),
                      h('button', { className: 'nb-btn nb-btn-primary', onClick: insertImageUrl }, t('confirm')),
                    ),
                  ),
                )
              : dialog !== null && dialog.kind === 'template'
                ? h(
                    'div',
                    {
                      className: 'nb-modal',
                      onMouseDown: (event) => {
                        if (event.target === event.currentTarget) setDialog(null)
                      },
                    },
                    h(
                      'div',
                      { className: 'nb-modal-card', role: 'dialog', 'aria-modal': 'true' },
                      h('div', { className: 'nb-modal-title' }, t('templateTitle')),
                      h(
                        'div',
                        { className: 'nb-template-list' },
                        NOTE_TEMPLATES.map((template) =>
                          h(
                            'button',
                            {
                              key: template.id,
                              className: 'nb-template-item',
                              onClick: () => {
                                if (dialog.source === 'button') createSubPageFromTemplate(template.id)
                                else createNote(template.id)
                              },
                            },
                            t(template.titleKey),
                          ),
                        ),
                        h('div', { className: 'nb-template-group' }, t('templateFromVault')),
                        vaultTemplates === null
                          ? h('div', { className: 'nb-history-empty' }, t('loading'))
                          : vaultTemplates.length === 0
                            ? h('div', { className: 'nb-history-empty' }, t('templateVaultEmpty'))
                            : vaultTemplates.map((template) =>
                                h(
                                  'button',
                                  {
                                    key: template.path,
                                    className: 'nb-template-item',
                                    title: template.path,
                                    onClick: () => useVaultTemplate(template, dialog.source === 'button' ? 'button' : ''),
                                  },
                                  template.name,
                                ),
                              ),
                      ),
                      h(
                        'div',
                        { className: 'nb-modal-actions' },
                        h('button', { className: 'nb-btn', onClick: () => setDialog(null) }, t('cancel')),
                      ),
                    ),
                  )
                : dialog !== null && dialog.kind === 'folder'
                  ? h(
                      'div',
                      {
                        className: 'nb-modal',
                        onMouseDown: (event) => {
                          if (event.target === event.currentTarget) setDialog(null)
                        },
                      },
                      h(
                        'div',
                        { className: 'nb-modal-card', role: 'dialog', 'aria-modal': 'true' },
                        h('div', { className: 'nb-modal-title' }, t('newFolder')),
                        h('input', {
                          className: 'nb-input',
                          value: folderDraft,
                          placeholder: t('folderName'),
                          onChange: (event) => setFolderDraft(event.target.value),
                          onKeyDown: (event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              createFolder()
                            }
                          },
                        }),
                        h(
                          'div',
                          { className: 'nb-modal-actions' },
                          h('button', { className: 'nb-btn', onClick: () => setDialog(null) }, t('cancel')),
                          h('button', { className: 'nb-btn nb-btn-primary', onClick: createFolder }, t('create')),
                        ),
                      ),
                    )
                  : dialog !== null && dialog.kind === 'move'
                    ? h(
                        'div',
                        {
                          className: 'nb-modal',
                          onMouseDown: (event) => {
                            if (event.target === event.currentTarget) {
                              setDialog(null)
                              setMoveNote(null)
                            }
                          },
                        },
                        h(
                          'div',
                          { className: 'nb-modal-card', role: 'dialog', 'aria-modal': 'true' },
                          h('div', { className: 'nb-modal-title' }, t('moveTo')),
                          h(
                            'div',
                            { className: 'nb-template-list' },
                            moveTargets.map((dir) =>
                              h(
                                'button',
                                {
                                  key: dir === '' ? '__root' : dir,
                                  className: 'nb-template-item',
                                  onClick: () => moveNoteTo(dir),
                                },
                                dir === '' ? t('vaultRoot') : dir,
                              ),
                            ),
                          ),
                          h(
                            'div',
                            { className: 'nb-modal-actions' },
                            h('button', { className: 'nb-btn', onClick: () => setDialog(null) }, t('cancel')),
                          ),
                        ),
                      )
                    : dialog !== null && dialog.kind === 'graph' && graph !== null
                  ? h(
                      'div',
                      {
                        className: 'nb-modal',
                        onMouseDown: (event) => {
                          if (event.target === event.currentTarget) setDialog(null)
                        },
                      },
                      h(
                        'div',
                        { className: 'nb-modal-card nb-graph-card', role: 'dialog', 'aria-modal': 'true' },
                        h('div', { className: 'nb-modal-title' }, t('graphTitle')),
                        graph.nodes.length === 0
                          ? h('div', { className: 'nb-links-empty' }, t('graphEmpty'))
                          : h(
                              'svg',
                              {
                                className: 'nb-graph',
                                viewBox: `0 0 ${graph.width} ${graph.height}`,
                                role: 'img',
                              },
                              graph.nodes.map((node) =>
                                h('line', {
                                  key: `e-${node.key}`,
                                  x1: graph.cx,
                                  y1: graph.cy,
                                  x2: node.x,
                                  y2: node.y,
                                  className: 'nb-graph-edge',
                                }),
                              ),
                              graph.nodes.map((node) =>
                                h(
                                  'g',
                                  {
                                    key: node.key,
                                    className: 'nb-graph-node',
                                    onClick: () => {
                                      setDialog(null)
                                      if (node.path !== null) openNote(node.path)
                                      else openWiki(node.name)
                                    },
                                  },
                                  h('circle', {
                                    cx: node.x,
                                    cy: node.y,
                                    r: 22,
                                    className: `nb-graph-dot nb-graph-${node.side}`,
                                  }),
                                  h(
                                    'text',
                                    {
                                      x: node.x,
                                      y: node.y,
                                      className: 'nb-graph-label',
                                      textAnchor: 'middle',
                                      dominantBaseline: 'middle',
                                    },
                                    node.name.length > 6 ? `${node.name.slice(0, 6)}…` : node.name,
                                  ),
                                ),
                              ),
                              h('circle', {
                                cx: graph.cx,
                                cy: graph.cy,
                                r: 30,
                                className: 'nb-graph-dot nb-graph-self',
                              }),
                              h(
                                'text',
                                {
                                  x: graph.cx,
                                  y: graph.cy,
                                  className: 'nb-graph-label nb-graph-self-label',
                                  textAnchor: 'middle',
                                  dominantBaseline: 'middle',
                                },
                                graphSelfName.length > 8 ? `${graphSelfName.slice(0, 8)}…` : graphSelfName,
                              ),
                            ),
                        h(
                          'div',
                          { className: 'nb-graph-legend' },
                          h('span', { className: 'nb-graph-key nb-graph-key-in' }, t('backlinks')),
                          h('span', { className: 'nb-graph-key nb-graph-key-out' }, t('outlinks')),
                        ),
                        h(
                          'div',
                          { className: 'nb-modal-actions' },
                          h('button', { className: 'nb-btn', onClick: () => setDialog(null) }, t('close')),
                        ),
                      ),
                    )
                  : dialog !== null && dialog.kind === 'note' && notePicker !== null
                  ? h(
                      'div',
                      {
                        className: 'nb-modal',
                        onMouseDown: (event) => {
                          if (event.target === event.currentTarget) {
                            setDialog(null)
                            setNotePicker(null)
                          }
                        },
                      },
                      h(
                        'div',
                        {
                          className: 'nb-modal-card nb-note-picker-card',
                          role: 'dialog',
                          'aria-modal': 'true',
                        },
                        h('div', { className: 'nb-modal-title' }, t('notePickerTitle')),
                        h('input', {
                          className: 'nb-input',
                          value: notePicker.query,
                          placeholder: t('notePickerPlaceholder'),
                          autoFocus: true,
                          onChange: (event) => setNotePicker({ ...notePicker, query: event.target.value }),
                          onKeyDown: (event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              const first = notePickerItems[0]
                              if (first !== undefined) insertNoteLink(first.name)
                            }
                          },
                        }),
                        h(
                          'div',
                          { className: 'nb-note-picker-list' },
                          notePickerItems.length === 0
                            ? h('div', { className: 'nb-links-empty' }, t('notePickerEmpty'))
                            : notePickerItems
                                .slice(0, 80)
                                .map((note) =>
                                  h(
                                    'button',
                                    {
                                      key: note.path,
                                      className: 'nb-template-item',
                                      title: note.path,
                                      onClick: () => insertNoteLink(note.name),
                                    },
                                    note.name,
                                  ),
                                ),
                        ),
                        h(
                          'div',
                          { className: 'nb-modal-actions' },
                          h(
                            'button',
                            {
                              className: 'nb-btn',
                              onClick: () => {
                                setDialog(null)
                                setNotePicker(null)
                              },
                            },
                            t('cancel'),
                          ),
                        ),
                      ),
                    )
                  : dialog !== null && dialog.kind === 'type'
                  ? h(
                      'div',
                      {
                        className: 'nb-modal',
                        onMouseDown: (event) => {
                          if (event.target === event.currentTarget) setDialog(null)
                        },
                      },
                      h(
                        'div',
                        { className: 'nb-modal-card nb-type-card', role: 'dialog', 'aria-modal': 'true' },
                        h('div', { className: 'nb-modal-title' }, t('typeTitle')),
                        h(
                          'div',
                          { className: 'nb-type-list' },
                          FONT_PRESETS.map((preset) =>
                            h(
                              'button',
                              {
                                key: preset.id,
                                className: `nb-type-item${typeface === preset.id ? ' on' : ''}`,
                                onClick: () => {
                                  setTypeface(preset.id)
                                  setDialog(null)
                                },
                              },
                              h(
                                'span',
                                { className: 'nb-type-label', style: { fontFamily: preset.stack } },
                                t(preset.labelKey),
                              ),
                              h(
                                'span',
                                { className: 'nb-type-sample', style: { fontFamily: preset.stack } },
                                preset.sample,
                              ),
                              fontStatus[preset.id] === false
                                ? h('span', { className: 'nb-type-missing' }, t('fontMissing'))
                                : typeface === preset.id
                                  ? h('span', { className: 'nb-type-check' }, '✓')
                                  : null,
                            ),
                          ),
                        ),
                        h(
                          'div',
                          { className: 'nb-type-custom' },
                          h('input', {
                            className: 'nb-input',
                            value: customFont,
                            placeholder: t('fontCustomHint'),
                            'aria-label': t('fontCustomHint'),
                            onChange: (event) => setCustomFont(event.target.value),
                            onKeyDown: (event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault()
                                applyCustomFont()
                              }
                            },
                          }),
                          h('button', { className: 'nb-btn', onClick: applyCustomFont }, t('apply')),
                        ),
                        h(
                          'div',
                          { className: 'nb-type-scale' },
                          h('span', { className: 'nb-type-scale-label' }, t('fontScaleLabel')),
                          h(
                            'button',
                            {
                              className: 'nb-btn',
                              onClick: () => setFontScale((value) => Math.max(13, value - 1)),
                            },
                            'A−',
                          ),
                          h('span', { className: 'nb-type-scale-value' }, `${fontScale}px`),
                          h(
                            'button',
                            {
                              className: 'nb-btn',
                              onClick: () => setFontScale((value) => Math.min(22, value + 1)),
                            },
                            'A+',
                          ),
                        ),
                        h(
                          'div',
                          { className: 'nb-modal-actions' },
                          h('button', { className: 'nb-btn', onClick: () => setDialog(null) }, t('cancel')),
                        ),
                      ),
                    )
                  : dialog !== null && dialog.kind === 'props'
                  ? h(
                      'div',
                      {
                        className: 'nb-modal',
                        onMouseDown: (event) => {
                          if (event.target === event.currentTarget) setDialog(null)
                        },
                      },
                      h(
                        'div',
                        { className: 'nb-modal-card', role: 'dialog', 'aria-modal': 'true' },
                        h('div', { className: 'nb-modal-title' }, t('propsTitle')),
                        h(
                          'div',
                          { className: 'nb-props-shortcuts' },
                          h(
                            'button',
                            {
                              className: 'nb-btn',
                              onClick: () => {
                                setDialog(null)
                                setIconOpen(true)
                                scrollToTop()
                              },
                            },
                            t('changeIcon'),
                          ),
                          h(
                            'button',
                            {
                              className: 'nb-btn',
                              onClick: () => {
                                setDialog(null)
                                if (cover.length > 0) {
                                  updateFrontmatter(withFrontmatterCover(frontmatterRef.current, ''))
                                } else {
                                  setCoverValue('')
                                  setCoverOpen(true)
                                  scrollToTop()
                                }
                              },
                            },
                            cover.length > 0 ? t('removeCover') : t('addCover'),
                          ),
                        ),
                        h(
                          'div',
                          { className: 'nb-props-field' },
                          h('span', { className: 'nb-props-label' }, t('propsTags')),
                          h(
                            'div',
                            { className: 'nb-tag-list' },
                            propsTagList.map((tag) =>
                              h(
                                'span',
                                { key: tag, className: 'nb-tag' },
                                tag,
                                h(
                                  'button',
                                  {
                                    className: 'nb-tag-x',
                                    'aria-label': `${t('removeTag')}: ${tag}`,
                                    onClick: () => removePropTag(tag),
                                  },
                                  '×',
                                ),
                              ),
                            ),
                            h('input', {
                              className: 'nb-input nb-tag-input',
                              value: propsTagDraft,
                              placeholder: t('propsTagPlaceholder'),
                              'aria-label': t('propsTags'),
                              onChange: (event) => setPropsTagDraft(event.target.value),
                              onKeyDown: (event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault()
                                  addPropTag()
                                } else if (
                                  event.key === 'Backspace' &&
                                  propsTagDraft.length === 0 &&
                                  propsTagList.length > 0
                                ) {
                                  removePropTag(propsTagList[propsTagList.length - 1])
                                }
                              },
                            }),
                          ),
                        ),
                        h(
                          'div',
                          { className: 'nb-props-field' },
                          h('span', { className: 'nb-props-label' }, t('propsAliases')),
                          h('input', {
                            className: 'nb-input',
                            value: propsAliases,
                            placeholder: t('propsHint'),
                            'aria-label': t('propsAliases'),
                            onChange: (event) => setPropsAliases(event.target.value),
                            onKeyDown: (event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault()
                                saveProps()
                              }
                            },
                          }),
                        ),
                        propsOthers.length > 0
                          ? h(
                              'div',
                              { className: 'nb-props-list' },
                              h('div', { className: 'nb-props-label' }, t('propsOther')),
                              propsOthers.map((entry) =>
                                h(
                                  'div',
                                  { key: entry.key, className: 'nb-props-row' },
                                  h('span', { className: 'nb-props-key' }, entry.key),
                                  entry.multiline === true
                                    ? h(
                                        'span',
                                        { className: 'nb-props-value', title: entry.value },
                                        entry.value,
                                      )
                                    : h('input', {
                                        className: 'nb-input nb-props-input',
                                        value: propsDraft[entry.key] ?? entry.value,
                                        'aria-label': entry.key,
                                        onChange: (event) =>
                                          setPropsDraft({ ...propsDraft, [entry.key]: event.target.value }),
                                        onBlur: (event) => {
                                          const value = event.target.value.trim()
                                          updateFrontmatter(
                                            withFrontmatterValue(frontmatterRef.current, entry.key, value),
                                          )
                                        },
                                      }),
                                ),
                              ),
                            )
                          : null,
                        h(
                          'div',
                          { className: 'nb-props-add' },
                          h('input', {
                            className: 'nb-input nb-props-input',
                            value: newFieldKey,
                            placeholder: t('propsNewKey'),
                            'aria-label': t('propsNewKey'),
                            onChange: (event) => setNewFieldKey(event.target.value),
                            onKeyDown: (event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault()
                                addPropField()
                              }
                            },
                          }),
                          h('input', {
                            className: 'nb-input nb-props-input',
                            value: newFieldValue,
                            placeholder: t('propsNewValue'),
                            'aria-label': t('propsNewValue'),
                            onChange: (event) => setNewFieldValue(event.target.value),
                            onKeyDown: (event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault()
                                addPropField()
                              }
                            },
                          }),
                          h('button', { className: 'nb-btn', onClick: addPropField }, `+ ${t('propsAddField')}`),
                        ),
                        h(
                          'div',
                          { className: 'nb-modal-actions' },
                          h('button', { className: 'nb-btn', onClick: () => setDialog(null) }, t('cancel')),
                          h('button', { className: 'nb-btn nb-btn-primary', onClick: saveProps }, t('save')),
                        ),
                      ),
                    )
                  : dialog !== null && dialog.kind === 'history'
                ? h(
                    'div',
                    {
                      className: 'nb-modal',
                      onMouseDown: (event) => {
                        if (event.target === event.currentTarget) {
                          setDialog(null)
                          setHistory(null)
                        }
                      },
                    },
                    h(
                      'div',
                      { className: 'nb-modal-card', role: 'dialog', 'aria-modal': 'true' },
                      h('div', { className: 'nb-modal-title' }, t('historyTitle')),
                      history === null || history.loading === true
                        ? h('div', { className: 'nb-history-empty' }, t('loading'))
                        : history.entries.length === 0
                          ? h('div', { className: 'nb-history-empty' }, t('historyEmpty'))
                          : h(
                              'div',
                              { className: 'nb-history' },
                              history.entries.map((entry) =>
                                h(
                                  'button',
                                  {
                                    key: entry.id,
                                    className: 'nb-history-item',
                                    onClick: () => previewHistory(entry),
                                  },
                                  h('span', { className: 'nb-history-time' }, formatHistoryTime(entry.mtimeMs)),
                                  h('span', { className: 'nb-history-size' }, formatBytes(entry.bytes)),
                                ),
                              ),
                            ),
                      h(
                        'div',
                        { className: 'nb-modal-actions' },
                        h(
                          'button',
                          {
                            className: 'nb-btn',
                            onClick: () => {
                              setDialog(null)
                              setHistory(null)
                            },
                          },
                          t('close'),
                        ),
                      ),
                    ),
                  )
                : dialog !== null && dialog.kind === 'historyPreview'
                  ? h(
                      'div',
                      {
                        className: 'nb-modal',
                        onMouseDown: (event) => {
                          if (event.target === event.currentTarget) setDialog({ kind: 'history' })
                        },
                      },
                      h(
                        'div',
                        { className: 'nb-modal-card nb-history-card', role: 'dialog', 'aria-modal': 'true' },
                        h('div', { className: 'nb-modal-title' }, t('historyPreview')),
                        h(
                          'div',
                          { className: 'nb-diff' },
                          h('div', { className: 'nb-diff-head' }, t('diffHint')),
                          h(
                            'div',
                            { className: 'nb-diff-body' },
                            (historyPreview === null || !Array.isArray(historyPreview.diff)
                              ? []
                              : historyPreview.diff
                            ).map((line, index) =>
                              line.type === 'skip'
                                ? h(
                                    'div',
                                    { key: `diff-${index}`, className: 'nb-diff-line nb-diff-skip' },
                                    `… ${line.count} ${t('diffSkipped')}`,
                                  )
                                : h(
                                    'div',
                                    { key: `diff-${index}`, className: `nb-diff-line nb-diff-${line.type}` },
                                    h(
                                      'span',
                                      { className: 'nb-diff-mark' },
                                      line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ',
                                    ),
                                    h('span', { className: 'nb-diff-text' }, line.text.length > 0 ? line.text : ' '),
                                  ),
                            ),
                          ),
                          historyPreview !== null && historyPreview.hasChanges === false
                            ? h('div', { className: 'nb-diff-none' }, t('diffNone'))
                            : null,
                        ),
                        h(
                          'div',
                          { className: 'nb-modal-actions' },
                          h(
                            'button',
                            { className: 'nb-btn', onClick: () => setDialog({ kind: 'history' }) },
                            t('cancel'),
                          ),
                          h('button', { className: 'nb-btn nb-btn-primary', onClick: restoreHistory }, t('restore')),
                        ),
                      ),
                    )
                  : null,
      )
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), `${NS}: dictionaries`)
      const t = ctx.locale.bind(NS)

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: NS,
            order: 40,
            label: () => t('panelTitle'),
          },
          NotebookGlyph,
        ),
      )

      ctx.slots.inject('main', () =>
        ctx.slots.register({ name: 'main', key: NS }, () => h(Workbench, { t, locale: ctx.locale })),
      )
    }

    return {
      name: NS,
      inject,
      apply,
      // Plain-function model helpers, exported only so a Node test can verify
      // Markdown round-trips without a browser. The shell ignores this field.
      __internal: {
        parseBlocks,
        serializeBlocks,
        shortcutFor,
        matchesSlash,
        markdownToHtml,
        htmlToMarkdown,
        highlightCode,
        highlightText,
        diffLines,
        collapseDiff,
        moveTableRow,
        findWikiTarget,
        frontmatterValue,
        frontmatterEntries,
        isValidFrontmatterKey,
        nextTabId,
        pagePathFor,
        addTagToList,
        parseWikiLink,
        folderTargets,
        blockLinkFor,
        outgoingLinks,
        wikiQueryFor,
        unlinkedMentions,
        linkMentions,
        graphPositions,
        filterQuickNotes,
        emojiAtEnd,
        flattenTree,
        splitBlockId,
        collectionConfigFor,
        collectionColumns,
        filterCollectionRows,
        sortCollectionRows,
        groupCollectionRows,
        isTemplateHref,
        isBlankBlockText,
        EMOJI_SHORTCODES,
        removeTagFromList,
        withFrontmatterValue,
        parseListValue,
        formatListValue,
        EmbeddedNote,
        moveTableColumn,
        NOTE_TEMPLATES,
        FONT_PRESETS,
        SHORTCUTS,
        sanitizeFontStack,
        resolveFontStack,
        primaryFamily,
        matchInlineConvert,
        moveBlockGroup,
        splitFrontmatter,
        composeContent,
        frontmatterIcon,
        withFrontmatterIcon,
        frontmatterCover,
        withFrontmatterCover,
        hiddenByCollapsedHeadings,
        hiddenByToggles,
        calloutIcon,
        blockToHtml,
        BlockView,
      },
    }
  },
})
