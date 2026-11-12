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
    // The composer can sit inside a transformed container, where a fixed child
    // would be positioned relative to it. The cite picker portals to <body>
    // instead; a loader without react-dom keeps the inline fallback.
    const ReactDOM = (() => {
      try {
        return require('react-dom')
      } catch {
        return null
      }
    })()
    const h = React.createElement

    /**
     * A render error inside the notebook must not blank the whole app view.
     * The fallback shows the actual error so it can be reported instead of
     * leaving a white panel with no clue.
     */
    const BoundaryBase = typeof React.Component === 'function' ? React.Component : class {}
    class NotebookBoundary extends BoundaryBase {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      componentDidCatch(error) {
        try {
          console.error('[dsh-notebook] render failed', error)
        } catch {
          /* logging is best-effort */
        }
      }

      render() {
        if (this.state.error !== null) {
          return h(
            'div',
            { className: 'nb-crash' },
            h('div', { className: 'nb-crash-title' }, '笔记本渲染出错'),
            h('pre', { className: 'nb-crash-detail' }, String(this.state.error?.stack ?? this.state.error)),
            h(
              'button',
              {
                className: 'nb-btn nb-btn-primary',
                onClick: () => {
                  try {
                    window.location.reload()
                  } catch {
                    /* reload is best-effort */
                  }
                },
              },
              '重新加载',
            ),
          )
        }
        return this.props.children
      }
    }
    const NS = 'dsh-notebook'
    const API = '/notebook/api'
    /** Sent with the first sync status fetch so the Host can tell which panel build is live. */
    const SYNC_BUILD = '0.2.0'
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
      '', 'text', 'javascript', 'typescript', 'python', 'bash', 'shell', 'json', 'css', 'scss',
      'html', 'vue', 'sql', 'rust', 'go', 'c', 'cpp', 'csharp', 'java', 'markdown', 'yaml',
      'ini', 'toml', 'desktop', 'dockerfile',
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
      ['Ctrl/Cmd + P / K', 'scQuickOpen'],
      ['Ctrl/Cmd + Alt + J', 'scAsk'],
      ['Ctrl/Cmd + Z', 'scUndo'],
      ['Ctrl/Cmd + Shift + Z', 'scRedo'],
      ['Ctrl/Cmd + B / I', 'scBold'],
      ['Enter / Shift+Enter', 'scEnter'],
      ['/', 'scSlash'],
      ['Shift + 点击', 'scMultiSelect'],
      ['Ctrl/Cmd + C / X', 'scCopy'],
      ['Tab / Shift+Tab', 'scTab'],
    ]
    const inject = ['slots', 'locale', 'sessions']

    const zh = {
      panelTitle: '笔记本',
      newNote: '新建笔记',
      searchPlaceholder: '搜索…',
      basesRows: '{n} 条',
      basesLoading: '载入视图…',
      basesEmpty: '没有匹配的笔记',
      basesError: '无法加载视图',
      basesUncategorized: '未分类',
      saveToFlash: '存到闪念',
      typeColumns2: '2 栏',
      typeColumns3: '3 栏',
      columnsHint: '每栏之间用空行（>）分隔；内容支持行内 Markdown。',
      footnotesTitle: '脚注',
      mermaidTitle: 'Mermaid 图表',
      mermaidSource: '查看源码',
      mermaidHint: '在 Obsidian 里打开这篇笔记即可渲染图表（插件暂未内置 Mermaid 引擎）。',
      mermaidLoading: '渲染图表…',
      mermaidError: '图表渲染失败',
      canvasLoading: '载入画布…',
      canvasEmpty: '这个画布是空的，在 Obsidian 里添加卡片。',
      canvasNodes: '节点',
      canvasEdges: '连线',
      canvasHint: '只读预览：在 Obsidian 里编辑画布。',
      basesView: 'Bases 视图',
      basesTag: 'Obsidian',
      basesViews: '个视图',
      basesInObsidian: '这个视图由 Obsidian Bases 渲染；在 Obsidian 里打开这篇笔记即可看到动态表格。',
      basesRows: '{n} items',
      basesLoading: 'Loading view…',
      basesEmpty: 'No matching notes',
      basesError: 'Could not load the view',
      basesUncategorized: 'Uncategorized',
      saveToFlash: 'Save to flash',
      typeColumns2: '2 columns',
      typeColumns3: '3 columns',
      columnsHint: 'Separate columns with an empty quoted line (>); inline Markdown is supported.',
      footnotesTitle: 'Footnotes',
      mermaidTitle: 'Mermaid diagram',
      mermaidSource: 'Show source',
      mermaidHint: 'Open this note in Obsidian to render the diagram (the Mermaid engine is not bundled yet).',
      mermaidLoading: 'Rendering diagram…',
      mermaidError: 'Diagram rendering failed',
      canvasLoading: 'Loading canvas…',
      canvasEmpty: 'This canvas is empty — add cards in Obsidian.',
      canvasNodes: 'nodes',
      canvasEdges: 'edges',
      canvasHint: 'Read-only preview: edit the canvas in Obsidian.',
      basesView: 'Bases view',
      basesTag: 'Obsidian',
      basesViews: 'views',
      basesInObsidian: 'This view is rendered by Obsidian Bases; open the note in Obsidian to see the live table.',
      timeJustNow: '刚刚',
      timeMinutesAgo: '{n} 分钟前',
      timeHoursAgo: '{n} 小时前',
      timeDaysAgo: '{n} 天前',
      timeJustNow: 'just now',
      timeMinutesAgo: '{n} min ago',
      timeHoursAgo: '{n} h ago',
      timeDaysAgo: '{n} d ago',
      emptyTitle: '写点什么',
      emptyHint: '从左侧选择一篇笔记，或者新建一页。',
      vaultEmptyTitle: '还没有找到笔记库',
      vaultEmptyText: '去 设置 → 通用 → 笔记本笔记库，点「选择目录…」挑一个文件夹；如果 Obsidian 已经打开过仓库，留空会自动检测。',
      vaultEmptyError: 'Host 返回：{message}',
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
      folderHomeNote: '新建/打开文件夹主页',
      folderNewSubfolder: '新建子文件夹',
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
      scAsk: '打开 / 关闭「问 AI」',
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
      calloutCycle: '点击切换标注类型',
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
      copyBlockEmbed: '复制块嵌入',
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
      embedAnchorMissing: '（找不到被引用的块）',
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
      palettePlaceholder: '搜索笔记或命令…',
      paletteNewNote: '新建笔记',
      paletteMove: '选择',
      paletteRun: '执行或打开',
      paletteClose: '关闭',
      scPalette: '命令面板（搜索 + 动作）',
      writingHeatmap: '写作热力',
      characters: '字',
      statsTotal: '总计',
      statsActiveDays: '活跃天数',
      statsStreak: '连续天数',
      statsBest: '最高单日',
      statsLess: '少',
      statsMore: '多',
      statsSince: '从 {date} 开始记录',
      statsEmptyHint: '在笔记本里写作后，这里会逐日亮起来。',
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
      aiAgentPlaceholder: '用一句话说明要做什么；可用 @笔记名 引用其他笔记，例如：把 @会议纪要 的要点整理进这篇笔记',
      aiAgentSnapshotHint: 'Agent 会直接改写笔记；每次写入前已自动留版本快照。',
      aiOpenHistory: '查看版本历史',
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
      chatReadNote: '读取笔记',
      chatWriteNote: '写入笔记',
      chatListNotes: '列出笔记',
      chatFlashNote: '闪念',
      chatSearchNotes: '搜索笔记',
      chatOpenInNotebook: '在笔记本中打开',
      chatOpen: '打开',
      chatHistory: '历史',
      chatAllNotes: '全部笔记',
      chatModeReplace: '覆盖',
      chatModeAppend: '追加',
      chatModeCreate: '新建',
      chatRunning: '进行中…',
      chatFailed: '失败',
      chatMatches: '{count} 条',
      folderFilter: '筛选笔记…',
      folderNoteCount: '{count} 篇笔记',
      folderFolderCount: '{count} 个文件夹',
      folderSortName: '名称',
      folderSortUpdated: '最近修改',
      folderEmpty: '这个目录还没有笔记',
      folderShowBody: '查看原文',
      folderHideBody: '收起原文',
      folderPageOn: '设为目录页',
      folderPageOff: '取消目录页',
      folderFolderEmpty: '这个文件夹里没有直接笔记',
      folderReload: '刷新列表',
      syncExternal: '这篇笔记在别处被修改了（Agent、Obsidian 或另一个窗口）。',
      syncReload: '重新加载',
      syncTitle: '同步',
      syncProvider: '同步方式',
      syncOff: '关闭',
      syncWebdav: 'WebDAV',
      syncGit: 'Git 仓库',
      syncWebdavUrl: '服务器地址',
      syncWebdavUrlHint: '带路径的完整地址，例如 https://dav.example.com/remote.php/dav/files/我',
      syncUsername: '用户名',
      syncPassword: '密码',
      syncRemotePath: '远程子目录（可选）',
      syncGitRemote: '远程仓库（可选）',
      syncGitRemoteHint: 'SSH 或 HTTPS 地址，凭据沿用本机 git 配置；留空只在本机提交版本',
      syncGitBranch: '分支',
      syncGitMessage: '提交信息（可选）',
      syncGitUser: '用户名（HTTP 远端）',
      syncGitPassword: '密码 / 访问令牌',
      syncGitAuthHint: 'HTTP(S) 远端（如 Gitea）在后台同步时无法弹窗输入，凭据填在这里；SSH 远端留空，沿用 ssh key。',
      syncGitSystemSsh: '沿用系统 ssh 配置（不强制 BatchMode，允许口令/Keychain 提示）',
      syncAutoSave: '保存笔记后自动同步',
      syncInterval: '定时同步（分钟，0 关闭）',
      syncDeletes: '删除处理',
      syncDeletesTrash: '同步删除，保留备份',
      syncDeletesKeep: '不传播删除',
      syncSave: '保存设置',
      syncTest: '测试连接',
      syncRun: '立即同步',
      syncCancel: '取消',
      syncNever: '还没有同步过',
      syncLast: '上次同步：{time}',
      syncTracked: '已跟踪 {count} 个文件',
      syncRunning: '同步中… {done}/{total}',
      syncStat: '上传 {up} · 下载 {down} · 冲突 {conflicts} · 删除 {deleted}',
      syncStatErrors: '，{count} 处错误',
      syncSettingsSaved: '设置已保存',
      syncTesting: '正在测试连接…',
      syncTestOk: '连接正常：{message}',
      syncRunningNow: '正在同步，请稍候…',
      syncRunOk: '同步完成',
      syncRunFail: '同步失败',
      syncHistory: '同步历史',
      syncHistoryEmpty: '还没有同步记录',
      syncTriggerManual: '手动',
      syncTriggerSave: '保存后',
      syncTriggerInterval: '定时',
      syncTriggerAgent: 'Agent',
      syncNoVault: '还没有笔记库：先到 设置 → 通用 → 笔记本笔记库 里选一个目录。',
      syncHintWebdav:
        '双向同步：本地改动上传，远端改动下载。两边都改过的笔记保留本地版本，远端内容另存为「冲突」副本；删除会移到回收站或先做备份。',
      syncHintGit: '把笔记库当作 git 工作区：先提交本地改动，再拉取远端分支（rebase），最后推送。第一次同步会初始化仓库。',
      syncErrAuth: 'WebDAV 认证失败（401）：用户名或密码不对',
      syncErrForbidden: 'WebDAV 拒绝写入（403）：账号可能只读，或目录不允许 PUT/MKCOL',
      syncErrNotFound: 'WebDAV 路径不存在（404）',
      syncErrUnreachable: '连不上 WebDAV 服务器',
      syncErrTimeout: 'WebDAV 请求超时',
      syncErrUrl: 'WebDAV 地址格式不对',
      syncErrQuota: 'WebDAV 空间不足（507）',
      syncErrGitAuth: 'git 凭据被拒绝：HTTP 远端请填用户名和密码/令牌，SSH 远端请确认 key 可用',
      syncErrGitUnreachable: '连不上 git 远程仓库',
      syncErrGitTimeout: 'git 命令超时（远程不可达或卡在网络等待）',
      syncErrGitConflict: 'git 冲突：远端和本地改了同一处',
      syncErrGitMissing: '找不到 git 命令',
      syncErrTooManyDeletes: '这次同步要删除的文件过多，已停止（什么都没删）',
      syncErrIncomplete: '同步设置不完整',
      syncErrLocalChanged: '同步期间本地文件被改动，已跳过',
      syncErrTooLarge: '文件超过 64 MB，已跳过',
      syncLoadFailed: '打不开同步设置：{message}',
      syncRetry: '重试',
      flashTitle: '闪念',
      flashCapture: '记一笔',
      flashPlaceholder: '脑子里闪过什么，先记下来…',
      flashHint: '回车记下 · Shift+回车换行 · Esc 取消',
      flashSaved: '已记下',
      flashInbox: '未处理',
      flashAll: '全部',
      flashDone: '已完成',
      flashEmpty: '还没有闪念。想到什么就先记一笔，整理留到以后。',
      flashEmptyDone: '还没有标记完成的闪念',
      flashNoMatch: '没有匹配的闪念',
      flashPending: '{count} 条待整理',
      flashRandom: '翻旧账',
      flashRandomEmpty: '还没有可以翻的旧闪念',
      flashPin: '置顶',
      flashUnpin: '取消置顶',
      flashMarkDone: '标记完成',
      flashMarkInbox: '标记未处理',
      flashDelete: '删除',
      flashConfirmDelete: '确认删除',
      flashOpenNote: '打开笔记',
      flashEdit: '编辑',
      flashSaveEdit: '保存修改',
      flashSearch: '搜索闪念…',
      flashCategoryAll: '全部分类',
      flashCategoryLabel: '分类（可留空）',
      flashCreated: '记于 {time}',
      flashOpenFailed: '加载闪念失败：{message}',
      flashSaveFailed: '没记上：{message}',
      flashErrEmpty: '写点什么再记',
      flashErrTooLarge: '这条太长了',
      flashErrPath: '只能改闪念文件夹里的笔记',
      flashCatMisc: '随记',
      flashCatIdea: '想法',
      flashCatTodo: '待办',
      flashCatSpark: '灵感',
      flashCatQuote: '摘录',
      flashShortcut: '闪念：快速记一笔',
      searchTitleHits: '标题匹配',
      searchBodyHits: '正文匹配',
      searchMoreHits: '还有 {count} 处',
      deckSlides: '幻灯片',
      deckSource: 'Markdown',
      deckPrev: '上一张',
      deckNext: '下一张',
      menuOpenNotebook: '打开笔记本',
      menuAskAi: '问 AI（当前笔记）',
      menuInsertNote: '插入当前笔记',
      menuCiteNotes: '引用笔记…',
      citeTitle: '引用笔记',
      citePlaceholder: '搜索笔记…',
      citeInsert: '插入 {count} 篇',
      citeEmpty: '没有匹配的笔记',
      citeFailed: '加载笔记失败：{message}',
      settingsVaultTitle: '笔记本笔记库',
      settingsPick: '选择目录…',
      settingsAuto: '自动检测',
      settingsApplying: '正在应用…',
      settingsNoVault: '还没有可用的笔记库',
      settingsDetected: '自动检测',
      settingsRestart: '改动会重启插件并重新载入笔记面板',
      settingsUnavailable: '当前 profile 不支持在这里改笔记库，请到插件页修改 vaultPath',
      askAi: '问 AI',
      askAbout: '关于《{title}》',
      askFocus: '聚焦：{text}',
      askEmpty: '就这篇笔记问点什么：它在讲什么？哪里没写清楚？帮我列个提纲？',
      askYou: '我',
      askAgent: 'AI',
      askPlaceholder: '就这篇笔记提问…（Enter 发送，Shift+Enter 换行）',
      askSend: '发送',
      askStop: '停止',
      askThinking: '思考中…',
      askNoNote: '先打开一篇笔记',
      askCopy: '复制',
      askCopied: '已复制',
      askInsert: '插入到笔记',
      askInserted: '已插入',
      askSave: '存为笔记',
      askSaved: '已保存',
      askUntitled: 'AI 回答',
      askModeNote: '问这篇笔记',
      askModeAgent: 'Agent 查库',
      askPlaceholderAgent: '让 Agent 在笔记库里查找并回答…（只读）',
      askEmptyAgent: 'Agent 模式会按需读取、搜索整个笔记库来回答，不会修改任何文件。',
      askSelection: '选中：“{text}”',
      askQuickSummary: '总结这篇笔记的要点',
      askQuickTodos: '整理这篇的待办和下一步',
      askQuickExplain: '解释选中的这段文字',
      askSteps: '检索了 {count} 步',
      askRetry: '重试',
      askClear: '清空对话',
      askNoteMissing: '找不到笔记：{name}',
    }

    const en = {
      panelTitle: 'Notebook',
      newNote: 'New note',
      searchPlaceholder: 'Search…',
      emptyTitle: 'Write something',
      emptyHint: 'Pick a note on the left, or create a new page.',
      vaultEmptyTitle: 'No notebook vault yet',
      vaultEmptyText: 'Open Settings → General → Notebook vault and choose a folder; if Obsidian has been opened before, leaving it empty auto-detects the vault.',
      vaultEmptyError: 'Host said: {message}',
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
      folderHomeNote: 'Create / open folder home note',
      folderNewSubfolder: 'New subfolder',
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
      scAsk: 'Toggle the ask panel',
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
      calloutCycle: 'Click to change the callout type',
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
      copyBlockEmbed: 'Copy block embed',
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
      embedAnchorMissing: '(referenced block not found)',
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
      palettePlaceholder: 'Search notes or commands…',
      paletteNewNote: 'New note',
      paletteMove: 'move',
      paletteRun: 'run or open',
      paletteClose: 'close',
      scPalette: 'Command palette (search + actions)',
      writingHeatmap: 'Writing heatmap',
      characters: 'chars',
      statsTotal: 'Total',
      statsActiveDays: 'Active days',
      statsStreak: 'Streak',
      statsBest: 'Best day',
      statsLess: 'Less',
      statsMore: 'More',
      statsSince: 'Recording since {date}',
      statsEmptyHint: 'Write in the notebook and this fills in day by day.',
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
      aiAgentPlaceholder: 'Describe the task; use @note-name to reference another note, e.g. merge @Meeting notes into this note',
      aiAgentSnapshotHint: 'The agent edits your note directly; a version snapshot is kept before every write.',
      aiOpenHistory: 'Open version history',
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
      chatReadNote: 'Read note',
      chatWriteNote: 'Write note',
      chatListNotes: 'List notes',
      chatFlashNote: 'Flash',
      chatSearchNotes: 'Search notes',
      chatOpenInNotebook: 'Open in notebook',
      chatOpen: 'Open',
      chatHistory: 'History',
      chatAllNotes: 'All notes',
      chatModeReplace: 'Replace',
      chatModeAppend: 'Append',
      chatModeCreate: 'Create',
      chatRunning: 'Running…',
      chatFailed: 'Failed',
      chatMatches: '{count} matches',
      folderFilter: 'Filter notes…',
      folderNoteCount: '{count} notes',
      folderFolderCount: '{count} folders',
      folderSortName: 'Name',
      folderSortUpdated: 'Updated',
      folderEmpty: 'This folder has no notes yet',
      folderShowBody: 'Show source',
      folderHideBody: 'Hide source',
      folderPageOn: 'Use as folder page',
      folderPageOff: 'Stop using as folder page',
      folderFolderEmpty: 'No notes directly in this folder',
      folderReload: 'Refresh list',
      syncExternal: 'This note changed outside this panel (agent, Obsidian or another window).',
      syncReload: 'Reload',
      syncTitle: 'Sync',
      syncProvider: 'Provider',
      syncOff: 'Off',
      syncWebdav: 'WebDAV',
      syncGit: 'Git repository',
      syncWebdavUrl: 'Server URL',
      syncWebdavUrlHint: 'Full address including the folder, e.g. https://dav.example.com/remote.php/dav/files/me',
      syncUsername: 'Username',
      syncPassword: 'Password',
      syncRemotePath: 'Remote subfolder (optional)',
      syncGitRemote: 'Remote repository (optional)',
      syncGitRemoteHint: 'SSH or HTTPS URL; credentials come from your git config. Empty commits locally only.',
      syncGitBranch: 'Branch',
      syncGitMessage: 'Commit message (optional)',
      syncGitUser: 'Username (HTTP remote)',
      syncGitPassword: 'Password / token',
      syncGitAuthHint: 'An HTTP(S) remote (e.g. Gitea) cannot prompt during a background sync, so store its credentials here; leave empty for an SSH remote that uses a key.',
      syncGitSystemSsh: 'Use the system ssh config (no forced BatchMode; allows passphrase/Keychain prompts)',
      syncAutoSave: 'Sync after saving a note',
      syncInterval: 'Sync every N minutes (0 = off)',
      syncDeletes: 'Deletions',
      syncDeletesTrash: 'Sync deletions, keep backups',
      syncDeletesKeep: 'Never delete',
      syncSave: 'Save settings',
      syncTest: 'Test connection',
      syncRun: 'Sync now',
      syncCancel: 'Cancel',
      syncNever: 'Never synced',
      syncLast: 'Last sync: {time}',
      syncTracked: '{count} tracked file(s)',
      syncRunning: 'Syncing… {done}/{total}',
      syncStat: '{up} up · {down} down · {conflicts} conflict(s) · {deleted} deleted',
      syncStatErrors: ', {count} error(s)',
      syncSettingsSaved: 'Settings saved',
      syncTesting: 'Testing the connection…',
      syncTestOk: 'Connection OK: {message}',
      syncRunningNow: 'Syncing, please wait…',
      syncRunOk: 'Sync finished',
      syncRunFail: 'Sync failed',
      syncHistory: 'Sync history',
      syncHistoryEmpty: 'No runs yet',
      syncTriggerManual: 'Manual',
      syncTriggerSave: 'After save',
      syncTriggerInterval: 'Timer',
      syncTriggerAgent: 'Agent',
      syncNoVault: 'No notebook vault yet: pick a folder under Settings → General → Notebook vault.',
      syncHintWebdav:
        'Two-way: local edits upload, remote edits download. A note edited on both sides keeps the local version and saves the remote content as a conflict copy; deletions are moved to the trash or backed up first.',
      syncHintGit:
        'The vault is a git working tree: commit local changes, replay the remote branch (rebase), then push. The first sync initializes the repository.',
      syncErrAuth: 'WebDAV authentication failed (401): check the username and password',
      syncErrForbidden: 'WebDAV refused the write (403): the account may be read-only or the folder may reject PUT/MKCOL',
      syncErrNotFound: 'The WebDAV path does not exist (404)',
      syncErrUnreachable: 'The WebDAV server could not be reached',
      syncErrTimeout: 'The WebDAV request timed out',
      syncErrUrl: 'That WebDAV address is not valid',
      syncErrQuota: 'The WebDAV account is out of space (507)',
      syncErrGitAuth: 'git rejected the credentials: fill in the HTTP username and password/token, or check the ssh key',
      syncErrGitUnreachable: 'The git remote could not be reached',
      syncErrGitTimeout: 'The git command timed out (remote unreachable or stalled)',
      syncErrGitConflict: 'git conflict: the remote and the local copy changed the same lines',
      syncErrGitMissing: 'The git command was not found',
      syncErrTooManyDeletes: 'This run would delete too many files, so it stopped before deleting anything',
      syncErrIncomplete: 'The sync settings are incomplete',
      syncErrLocalChanged: 'A local file changed during the sync and was skipped',
      syncErrTooLarge: 'A file is larger than 64 MB and was skipped',
      syncLoadFailed: 'Could not open the sync settings: {message}',
      syncRetry: 'Retry',
      flashTitle: 'Flash',
      flashCapture: 'Capture',
      flashPlaceholder: 'Whatever just crossed your mind — jot it down…',
      flashHint: 'Enter saves · Shift+Enter for a new line · Esc cancels',
      flashSaved: 'Captured',
      flashInbox: 'Inbox',
      flashAll: 'All',
      flashDone: 'Done',
      flashEmpty: 'No flashes yet. Capture the thought now, sort it out later.',
      flashEmptyDone: 'Nothing marked done yet',
      flashNoMatch: 'No matching flashes',
      flashPending: '{count} to sort out',
      flashRandom: 'Resurface',
      flashRandomEmpty: 'No old flash to resurface yet',
      flashPin: 'Pin',
      flashUnpin: 'Unpin',
      flashMarkDone: 'Mark done',
      flashMarkInbox: 'Move back to inbox',
      flashDelete: 'Delete',
      flashConfirmDelete: 'Confirm delete',
      flashOpenNote: 'Open note',
      flashEdit: 'Edit',
      flashSaveEdit: 'Save changes',
      flashSearch: 'Search flashes…',
      flashCategoryAll: 'All categories',
      flashCategoryLabel: 'Category (optional)',
      flashCreated: 'Captured {time}',
      flashOpenFailed: 'Could not load flashes: {message}',
      flashSaveFailed: 'Not saved: {message}',
      flashErrEmpty: 'Write something first',
      flashErrTooLarge: 'That flash is too long',
      flashErrPath: 'Only notes inside the flash folder can be edited',
      flashCatMisc: 'Misc',
      flashCatIdea: 'Idea',
      flashCatTodo: 'To-do',
      flashCatSpark: 'Spark',
      flashCatQuote: 'Quote',
      flashShortcut: 'Flash: quick capture',
      searchTitleHits: 'Title matches',
      searchBodyHits: 'In body',
      searchMoreHits: '{count} more',
      deckSlides: 'Slides',
      deckSource: 'Markdown',
      deckPrev: 'Previous slide',
      deckNext: 'Next slide',
      menuOpenNotebook: 'Open notebook',
      menuAskAi: 'Ask AI (current note)',
      menuInsertNote: 'Insert current note',
      menuCiteNotes: 'Cite notes…',
      citeTitle: 'Cite notes',
      citePlaceholder: 'Search notes…',
      citeInsert: 'Insert {count}',
      citeEmpty: 'No matching notes',
      citeFailed: 'Could not load notes: {message}',
      settingsVaultTitle: 'Notebook vault',
      settingsPick: 'Choose folder…',
      settingsAuto: 'Auto-detect',
      settingsApplying: 'Applying…',
      settingsNoVault: 'No vault configured',
      settingsDetected: 'auto-detected',
      settingsRestart: 'Changes restart the plugin and reload the notebook panel',
      settingsUnavailable: 'This profile cannot change the vault here; edit vaultPath on the plugin page',
      askAi: 'Ask AI',
      askAbout: 'About "{title}"',
      askFocus: 'Focus: {text}',
      askEmpty: 'Ask about this note: what is it about? What is unclear? Outline it for me?',
      askYou: 'You',
      askAgent: 'AI',
      askPlaceholder: 'Ask about this note… (Enter to send, Shift+Enter for a new line)',
      askSend: 'Send',
      askStop: 'Stop',
      askThinking: 'Thinking…',
      askNoNote: 'Open a note first',
      askCopy: 'Copy',
      askCopied: 'Copied',
      askInsert: 'Insert into note',
      askInserted: 'Inserted',
      askSave: 'Save as note',
      askSaved: 'Saved',
      askUntitled: 'AI answer',
      askModeNote: 'Ask this note',
      askModeAgent: 'Agent search',
      askPlaceholderAgent: 'Let the agent read and search the vault… (read-only)',
      askEmptyAgent: 'Agent mode reads and searches the whole vault as needed; it never writes.',
      askSelection: 'Selected: "{text}"',
      askQuickSummary: 'Summarize this note',
      askQuickTodos: 'List its to-dos and next steps',
      askQuickExplain: 'Explain the selected text',
      askSteps: 'Searched {count} step(s)',
      askRetry: 'Retry',
      askClear: 'Clear conversation',
      askNoteMissing: 'Note not found: {name}',
    }

    const CSS = `
.nb-crash { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; height: 100%; padding: 40px; box-sizing: border-box; color: var(--nb-text-2); }
.nb-crash-title { font-size: 15px; font-weight: 600; color: var(--nb-text); }
.nb-crash-detail { max-width: min(720px, 90%); max-height: 40vh; overflow: auto; padding: 12px; border: 1px solid var(--nb-line); border-radius: var(--nb-radius-m); background: var(--nb-surface); font-size: 12px; line-height: 1.5; white-space: pre-wrap; }
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
  --nb-ease-out: cubic-bezier(.16, 1, .3, 1);
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
.nb-root .nb-title, .nb-root .nb-b, .nb-root .nb-ask-input { caret-color: var(--nb-accent); }
.nb-root :is(button, [role="button"]):focus-visible { outline: none; box-shadow: 0 0 0 2px var(--nb-accent-ring); }
.nb-root mark { background: color-mix(in srgb, var(--nb-accent) 16%, transparent); color: inherit; border-radius: 4px; padding: 0 2px; }
.nb-root input:focus-visible, .nb-root button:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--nb-accent-ring); }
.nb-root *::-webkit-scrollbar { width: 9px; height: 9px; }
.nb-root *::-webkit-scrollbar-thumb { background: var(--dsw-alias-scrollbar-bg-l1, #e5e5e5); border-radius: 999px; border: 2px solid transparent; background-clip: content-box; }
.nb-root *::-webkit-scrollbar-thumb:hover { background: var(--dsw-alias-scrollbar-hover-l1, #d4d4d4); background-clip: content-box; }
.nb-root *::-webkit-scrollbar-track { background: transparent; }

/* ── Sidebar ───────────────────────────────────────────── */
.nb-side-foot { flex: 0 0 auto; padding: 8px; border-top: 1px solid var(--nb-line); }
.nb-heat-card { display: flex; flex-direction: column; gap: 7px; width: 100%; box-sizing: border-box; border: 1px solid transparent; background: transparent; border-radius: var(--nb-radius-m); padding: 8px; cursor: pointer; text-align: left; transition: background .14s var(--nb-ease), border-color .14s var(--nb-ease); }
.nb-heat-card:hover { background: var(--nb-hover); border-color: var(--nb-line); }
.nb-heat-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.nb-heat-title { font-size: 11px; font-weight: 600; color: var(--nb-text-2); }
.nb-heat-total { font-size: 10.5px; color: var(--nb-text-3); font-variant-numeric: tabular-nums; }
.nb-heat { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.nb-heat-grid { display: flex; gap: 3px; width: max-content; }
.nb-heat-week { display: flex; flex-direction: column; gap: 3px; }
.nb-heat-cell { width: 10px; height: 10px; border-radius: 2px; background: color-mix(in srgb, var(--nb-line) 55%, transparent); }
.nb-heat.compact .nb-heat-cell { width: 7px; height: 7px; border-radius: 1.5px; }
.nb-heat-cell[data-level="1"] { background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #1a7f4b) 24%, var(--nb-panel)); }
.nb-heat-cell[data-level="2"] { background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #1a7f4b) 44%, var(--nb-panel)); }
.nb-heat-cell[data-level="3"] { background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #1a7f4b) 67%, var(--nb-panel)); }
.nb-heat-cell[data-level="4"] { background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #1a7f4b) 92%, var(--nb-panel)); }
.nb-heat-cell[data-future="1"] { background: transparent; }
.nb-heat-months { display: flex; gap: 3px; height: 12px; font-size: 10px; color: var(--nb-text-3); }
.nb-heat-month { flex: 0 0 10px; width: 10px; overflow: visible; white-space: nowrap; }
.nb-modal-card.nb-stats-card { width: min(880px, 96%); max-height: min(86vh, 780px); overflow: auto; gap: 16px; }
.nb-stats-card .nb-heat { overflow-x: auto; padding-bottom: 2px; }
.nb-stats-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.nb-stats-title { font-size: 15px; font-weight: 600; letter-spacing: -.01em; color: var(--nb-text); }
.nb-stats-sub { margin-top: 3px; font-size: 11.5px; color: var(--nb-text-3); }
.nb-stats-summary { display: flex; gap: 10px; flex-wrap: wrap; }
.nb-stats-stat { flex: 1 1 140px; min-width: 0; padding: 10px 12px; border-radius: var(--nb-radius-m); background: var(--nb-panel); }
.nb-stats-value { font-size: 18px; font-weight: 600; letter-spacing: -.02em; font-variant-numeric: tabular-nums; color: var(--nb-text); }
.nb-stats-label { margin-top: 2px; font-size: 11px; color: var(--nb-text-3); }
.nb-stats-legend { display: flex; align-items: center; gap: 4px; font-size: 10.5px; color: var(--nb-text-3); }
.nb-stats-legend .nb-heat-cell { width: 10px; height: 10px; }
.nb-stats-empty { font-size: 12px; color: var(--nb-text-3); }
.nb-side { width: 248px; flex: 0 0 248px; display: flex; flex-direction: column; min-height: 0; background: var(--nb-panel); border-right: 1px solid var(--nb-line); }
/* Breadcrumb */
.nb-breadcrumb { display: flex; align-items: center; gap: 2px; flex-wrap: wrap; padding: 2px 0 8px; font-size: 12px; color: var(--nb-text-3); }
.nb-breadcrumb button { border: none; background: transparent; color: var(--nb-text-3); font-size: 12px; padding: 1px 4px; border-radius: 4px; cursor: pointer; }
.nb-breadcrumb button:hover { background: var(--nb-hover); color: var(--nb-text); }
.nb-breadcrumb-current { padding: 1px 4px; color: var(--nb-text); font-weight: 500; }
.nb-breadcrumb-sep { color: var(--nb-text-3); opacity: .55; }
.nb-root.zen .nb-breadcrumb { display: none; }
.nb-side-top { padding: 16px 12px 10px; display: flex; flex-direction: column; gap: 4px; flex: 0 0 auto; }
.nb-search { width: 100%; box-sizing: border-box; height: 32px; border: 1px solid transparent; border-radius: var(--nb-radius-s); background: color-mix(in srgb, var(--nb-card) 62%, transparent); color: var(--nb-text); padding: 0 11px; font-size: 12.5px; outline: none; transition: background .14s var(--nb-ease), border-color .14s var(--nb-ease), box-shadow .14s var(--nb-ease); }
.nb-search::placeholder { color: var(--nb-text-3); }
.nb-search:hover { background: var(--nb-card); border-color: var(--nb-line); }
.nb-search:focus { background: var(--nb-card); border-color: var(--nb-accent); box-shadow: 0 0 0 3px var(--nb-accent-ring); }
.nb-new { display: flex; align-items: center; gap: 8px; width: 100%; border: none; background: transparent; color: var(--nb-text); font-size: 13px; font-weight: 500; padding: 7px 8px; border-radius: var(--nb-radius-s); cursor: pointer; text-align: left; transition: background .14s var(--nb-ease); }
.nb-new:hover { background: var(--nb-hover); }
.nb-new-folder { height: 26px; font-size: 12px; font-weight: 400; color: var(--nb-text-2); }
.nb-new-folder:hover { color: var(--nb-text); }
.nb-new-plus { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: var(--nb-radius-s); border: 1px solid var(--nb-line-2); background: var(--nb-card); color: var(--nb-text-2); font-size: 13px; line-height: 1; }
.nb-quick { flex: 0 0 auto; padding: 2px 8px 10px; border-bottom: 1px solid var(--nb-line); }
.nb-quick-group { margin-top: 6px; }
.nb-quick-title { padding: 6px 8px 3px; font-size: 11px; font-weight: 600; letter-spacing: .02em; color: var(--nb-text-2); }
.nb-quick-item { display: block; width: 100%; border: none; background: transparent; color: var(--nb-text-2); font-size: 12.5px; padding: 4px 8px; border-radius: var(--nb-radius-s); cursor: pointer; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; transition: background .12s var(--nb-ease), color .12s var(--nb-ease); }
.nb-quick-item:hover { background: var(--nb-hover); }
.nb-quick-open { position: absolute; inset: 0; z-index: 95; display: flex; justify-content: center; align-items: flex-start; padding: 12vh 24px 24px; background: color-mix(in srgb, var(--dsw-alias-bg-mask-1, #0000003d) 60%, transparent); backdrop-filter: blur(2px); animation: nb-fade 120ms var(--nb-ease-out); }
.nb-quick-card { width: min(560px, 94%); box-sizing: border-box; padding: 10px; background: var(--nb-card); border: 1px solid var(--nb-line); border-radius: var(--nb-radius-l); box-shadow: 0 24px 64px rgba(16, 24, 40, .2); animation: nb-pop 180ms var(--nb-ease-out); }
.nb-quick-input { width: 100%; box-sizing: border-box; height: 40px; font-size: 14px; }
.nb-quick-hint { display: flex; align-items: center; gap: 14px; margin-top: 8px; padding: 8px 10px 2px; border-top: 1px solid var(--nb-line); color: var(--nb-text-3); font-size: 11px; }
.nb-quick-hint kbd { display: inline-block; min-width: 16px; padding: 1px 5px; margin-right: 4px; border: 1px solid var(--nb-line-2); border-radius: 4px; background: var(--nb-panel); color: var(--nb-text-2); font-family: inherit; font-size: 10.5px; text-align: center; }
.nb-quick-list { max-height: 320px; overflow: auto; margin-top: 8px; display: flex; flex-direction: column; gap: 2px; }
.nb-quick-row { display: flex; align-items: baseline; gap: 8px; width: 100%; border: none; background: transparent; color: var(--nb-text); font-size: 13px; padding: 7px 10px; border-radius: var(--nb-radius-s); cursor: pointer; text-align: left; transition: background .12s var(--nb-ease), color .12s var(--nb-ease); }
.nb-quick-row.on, .nb-quick-row:hover { background: var(--nb-accent-soft); color: var(--nb-accent); }
.nb-quick-row-name { flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nb-quick-row-path { margin-left: auto; flex: 0 0 auto; font-size: 11px; color: var(--nb-text-3); }
.nb-tree { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 2px 8px 24px; }
.nb-group { margin-top: 10px; }
.nb-group-title { display: flex; align-items: center; gap: 6px; padding: 6px 8px 4px; border-radius: var(--nb-radius-s); font-size: 11px; font-weight: 600; letter-spacing: .02em; color: var(--nb-text-2); cursor: pointer; user-select: none; white-space: nowrap; overflow: hidden; transition: background .14s var(--nb-ease); }
.nb-group-title:hover { background: var(--nb-hover); color: var(--nb-text); }
.nb-group-caret { padding: 0 1px; color: var(--nb-text-3); border-radius: 3px; }
.nb-group-caret:hover { color: var(--nb-text); background: var(--nb-hover); }
.nb-group-name.is-home { color: var(--nb-text); }
.nb-group-count { margin-left: auto; padding: 0; border-radius: 0; background: none; font-size: 10.5px; font-weight: 500; color: var(--nb-text-3); font-variant-numeric: tabular-nums; }
.nb-note { display: flex; align-items: center; gap: 6px; width: 100%; box-sizing: border-box; border: none; background: transparent; color: var(--nb-text-2); font-size: 13px; padding: 6px 8px; border-radius: var(--nb-radius-s); cursor: pointer; text-align: left; white-space: nowrap; overflow: hidden; transition: background .14s var(--nb-ease); }
.nb-note:hover { background: var(--nb-hover); color: var(--nb-text); }
.nb-note.on { position: relative; background: var(--nb-active); color: var(--nb-text); font-weight: 600; }
.nb-note-caret { flex: 0 0 10px; text-align: center; color: var(--nb-text-3); }
.nb-note-name { overflow: hidden; text-overflow: ellipsis; }
.nb-hit { display: block; width: 100%; box-sizing: border-box; border: none; background: transparent; color: var(--nb-text); text-align: left; padding: 6px 8px; border-radius: var(--nb-radius-s); cursor: pointer; overflow: hidden; transition: background .14s var(--nb-ease); }
.nb-hit:hover { background: var(--nb-hover); }
.nb-hit-name { display: block; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nb-search-results { padding: 4px 4px 12px; }
.nb-search-group { margin-bottom: 6px; }
.nb-search-group-title { display: flex; align-items: center; gap: 6px; padding: 8px 8px 4px; font-size: 10.5px; font-weight: 600; letter-spacing: .04em; color: var(--nb-text-3); }
.nb-search-group-count { margin-left: auto; font-size: 10px; color: var(--nb-text-3); opacity: .8; }
.nb-hit-title { padding: 6px 8px; }
.nb-hit-dir { display: block; margin-top: 1px; font-size: 10.5px; color: var(--nb-text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nb-hit-note { padding: 2px 0 4px; }
.nb-hit-note-name { display: block; width: 100%; box-sizing: border-box; border: none; background: transparent; color: var(--nb-text); text-align: left; font-size: 12px; font-weight: 500; padding: 4px 8px; border-radius: var(--nb-radius-s); cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nb-hit-note-name:hover { background: var(--nb-hover); }
.nb-hit-line { display: flex; align-items: baseline; gap: 6px; width: 100%; box-sizing: border-box; border: none; background: transparent; color: var(--nb-text-2); text-align: left; padding: 3px 8px 3px 16px; border-radius: var(--nb-radius-s); cursor: pointer; }
.nb-hit-line:hover { background: var(--nb-hover); color: var(--nb-text); }
.nb-hit-line-no { flex: 0 0 auto; min-width: 18px; font-size: 10px; color: var(--nb-text-3); font-variant-numeric: tabular-nums; }
.nb-hit-line-text { flex: 1 1 auto; min-width: 0; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nb-hit-more { padding: 2px 8px 0 16px; font-size: 10px; color: var(--nb-text-3); }
@keyframes nb-hit-flash { 0%, 30% { background: var(--nb-accent-soft); } 100% { background: transparent; } }
.nb-flash-hit { animation: nb-hit-flash 1.8s var(--nb-ease-out); border-radius: var(--nb-radius-s); }
.nb-side-empty { padding: 14px 10px; font-size: 12px; color: var(--nb-text-3); line-height: 1.7; }

/* ── Outline ───────────────────────────────────────────── */
.nb-outline { flex: 0 0 auto; max-height: 190px; overflow: auto; padding: 6px 8px 10px; border-bottom: 1px solid var(--nb-line); }
.nb-outline-title { padding: 6px 8px 4px; font-size: 11px; font-weight: 600; letter-spacing: .02em; color: var(--nb-text-2); }
.nb-outline-list { display: flex; flex-direction: column; gap: 1px; }
.nb-outline-item { border: none; background: transparent; color: var(--nb-text-2); font-size: 12px; text-align: left; padding: 4px 7px; border-radius: var(--nb-radius-s); cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: background .14s var(--nb-ease), color .14s var(--nb-ease); }
.nb-outline-item:hover { background: var(--nb-hover); color: var(--nb-text); }
.nb-outline-item.on { background: var(--nb-accent-soft); color: var(--nb-accent); font-weight: 600; }

/* ── Main column & topbar ──────────────────────────────── */
.nb-main { position: relative; flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.nb-topbar { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; height: 46px; padding: 0 16px 0 18px; box-sizing: border-box; border-bottom: 1px solid var(--nb-line); background: var(--nb-surface); }
.nb-crumb { min-width: 0; font-size: 12px; color: var(--nb-text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nb-tabs { display: flex; align-items: center; gap: 3px; min-width: 0; overflow-x: auto; flex: 1 1 auto; }
.nb-tabs::-webkit-scrollbar { height: 0; }
.nb-tab { display: inline-flex; align-items: center; gap: 4px; max-width: 200px; padding: 5px 8px; border-radius: var(--nb-radius-s); border: 1px solid transparent; font-size: 12.5px; color: var(--nb-text-2); cursor: pointer; white-space: nowrap; flex: 0 0 auto; transition: background .14s var(--nb-ease), color .14s var(--nb-ease), box-shadow .16s var(--nb-ease); }
.nb-tab:hover { background: var(--nb-hover); color: var(--nb-text); }
.nb-tab.on { background: var(--nb-card); border-color: var(--nb-line); color: var(--nb-text); font-weight: 600; box-shadow: var(--nb-shadow-1); }
.nb-tab-name { overflow: hidden; text-overflow: ellipsis; }
.nb-tab-close { border: none; background: transparent; color: var(--nb-text-3); cursor: pointer; font-size: 13px; line-height: 1; padding: 1px 3px; border-radius: 4px; opacity: 0; transition: opacity .12s, background .12s; }
.nb-tab:hover .nb-tab-close, .nb-tab.on .nb-tab-close { opacity: 1; }
.nb-tab-close:hover { background: var(--nb-active); color: var(--nb-text); }
.nb-save { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; font-size: 11.5px; color: var(--nb-text-2); white-space: nowrap; }
.nb-save::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-success-primary, #1a7f4b); opacity: .75; transition: background .2s var(--nb-ease); }
.nb-save[data-state="saving"]::before, .nb-save[data-state="unsaved"]::before { background: var(--dsw-alias-state-warn-primary, #a15c00); }
.nb-save[data-state="saving"]::before { animation: nb-save-pulse 1.2s var(--nb-ease) infinite; }
.nb-save[data-state="error"]::before { background: var(--dsw-alias-state-error-primary); }
.nb-save.error { color: var(--dsw-alias-state-error-primary); }
.nb-icon-btn { width: 28px; height: 28px; border: none; border-radius: var(--nb-radius-s); background: transparent; color: var(--nb-text-2); cursor: pointer; font-size: 15px; line-height: 1; display: inline-flex; align-items: center; justify-content: center; transition: background .14s var(--nb-ease), color .14s var(--nb-ease), transform .1s var(--nb-ease); }
.nb-icon-btn:hover { background: var(--nb-hover); color: var(--nb-text); }
.nb-notice { flex: 0 0 auto; margin: 8px 18px 0; padding: 8px 12px; border-radius: var(--nb-radius-s); font-size: 12px; background: var(--dsw-alias-state-error-tertiary, var(--nb-hover)); color: var(--dsw-alias-state-error-primary); border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 18%, transparent); animation: nb-notice-in 180ms var(--nb-ease-out); }
.nb-notice[data-kind="ok"] { background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #1a7f4b) 7%, var(--nb-card)); color: var(--dsw-alias-state-success-primary, #1a7f4b); border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #1a7f4b) 24%, transparent); }
.nb-notice.nb-sync { display: flex; align-items: center; gap: 10px; background: var(--nb-hover); color: var(--nb-text); border-color: var(--nb-line-2); }
.nb-sync-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nb-sync-action { flex: none; margin-left: auto; height: 24px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--nb-line-2); background: var(--nb-card); color: var(--nb-text); font-size: 12px; cursor: pointer; }
.nb-sync-action:hover { background: var(--nb-panel); }
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
.nb-icon-panel { position: absolute; z-index: 45; top: 100%; left: 0; margin-top: 6px; width: 308px; padding: 10px; background: var(--nb-card); border: 1px solid var(--nb-line); border-radius: var(--nb-radius-l); box-shadow: var(--nb-shadow-2); transform-origin: top left; animation: nb-pop 160ms var(--nb-ease-out); }
.nb-icon-grid { display: grid; grid-template-columns: repeat(9, 1fr); gap: 2px; }
.nb-icon-choice { border: none; background: transparent; font-size: 20px; padding: 5px 0; border-radius: var(--nb-radius-s); cursor: pointer; transition: background .12s; }
.nb-icon-choice:hover { background: var(--nb-hover); }
.nb-icon-remove { width: 100%; margin-top: 8px; border: none; background: transparent; color: var(--nb-text-2); font-size: 12px; padding: 7px; border-radius: var(--nb-radius-s); cursor: pointer; text-align: left; transition: background .12s; }
.nb-icon-remove:hover { background: var(--nb-hover); color: var(--nb-text); }
.nb-title { font-size: 2.4em; font-weight: 700; line-height: 1.15; letter-spacing: -.03em; outline: none; padding: 4px 0 12px; white-space: pre-wrap; word-break: break-word; }
.nb-title:empty::before { content: attr(data-placeholder); color: var(--nb-text-3); opacity: .7; }

/* ── Blocks ────────────────────────────────────────────── */
.nb-blocks { display: flex; flex-direction: column; gap: 2px; }
.nb-block { position: relative; display: flex; align-items: flex-start; gap: 2px; }
.nb-block.selected > .nb-b { background: var(--nb-accent-soft); }
.nb-block.dragging { opacity: .45; }
.nb-block.drop-before::before { content: ''; position: absolute; left: -4px; right: -4px; top: -2px; height: 2px; border-radius: 1px; background: var(--nb-accent); pointer-events: none; }
.nb-block.drop-after::after { content: ''; position: absolute; left: -4px; right: -4px; bottom: -2px; height: 2px; border-radius: 1px; background: var(--nb-accent); pointer-events: none; }
.nb-gutter { position: absolute; left: -74px; width: 74px; justify-content: flex-end; top: 2px; display: flex; align-items: center; gap: 1px; opacity: 0; transition: opacity .12s; }
.nb-block:hover .nb-gutter, .nb-block.menu-open .nb-gutter { opacity: 1; }
.nb-gutter-btn { width: 24px; height: 24px; border: none; border-radius: var(--nb-radius-s); background: transparent; color: var(--nb-text-3); cursor: pointer; font-size: 13px; line-height: 1; display: inline-flex; align-items: center; justify-content: center; transition: background .12s, color .12s; }
.nb-gutter-btn:hover { background: var(--nb-hover); color: var(--nb-text); }
.nb-gutter-right { position: absolute; right: -38px; top: 2px; display: flex; align-items: center; opacity: 0; transition: opacity .12s var(--nb-ease); }
.nb-block:hover .nb-gutter-right, .nb-block.menu-open .nb-gutter-right { opacity: 1; }
.nb-root.reading .nb-gutter-right { display: none; }
.nb-b { flex: 1 1 auto; min-width: 0; outline: none; padding: 3px 6px; margin: 0 -6px; font-size: 1em; line-height: 1.68; white-space: pre-wrap; word-break: break-word; cursor: text; border-radius: 4px; transition: background .12s var(--nb-ease); }
.nb-block:hover > .nb-b:not(.nb-b-code):not(.nb-b-callout) { background: var(--nb-hover); }
.nb-b-render { cursor: text; }
.nb-b-edit { cursor: text; min-height: 1.65em; }
.nb-b-edit:empty::before { content: attr(data-placeholder); color: var(--nb-text-3); opacity: .8; }
.nb-b-edit.nb-b-h1 { min-height: 1.3em; }
.nb-b-edit.nb-b-h2 { min-height: 1.35em; }
.nb-b-edit.nb-b-h3 { min-height: 1.4em; }

/* headings */
.nb-b-h1 { font-size: 1.9em; font-weight: 700; line-height: 1.25; letter-spacing: -.02em; padding: 26px 6px 4px; }
.nb-b-h2 { font-size: 1.45em; font-weight: 600; line-height: 1.32; letter-spacing: -.012em; padding: 22px 6px 3px; }
.nb-b-h3 { font-size: 1.2em; font-weight: 600; line-height: 1.38; padding: 16px 6px 2px; }

/* lists & inline */
.nb-b-bullet, .nb-b-numbered { display: block; }
.nb-prefix { flex: 0 0 auto; min-width: 22px; font-size: 15px; line-height: 1.65; color: var(--nb-text-3); user-select: none; display: inline-flex; align-items: flex-start; justify-content: flex-start; padding: 4px 0; }
.nb-prefix-dot::before { content: '•'; }
.nb-prefix-num { color: var(--nb-text-3); font-variant-numeric: tabular-nums; }
.nb-b-quote { border-left: 3px solid var(--nb-line-2); padding-left: 14px; color: var(--nb-text-2); }
.nb-b code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .875em; background: var(--dsw-alias-markdown-inline-code, var(--nb-hover)); border-radius: var(--nb-radius-s); padding: 2px 5px; }
.nb-b a { color: var(--nb-accent); text-decoration: none; }
.nb-b a:hover { text-decoration: underline; }
.nb-b strong { font-weight: 650; }
.nb-b img, .nb-b .nb-img { max-width: 100%; height: auto; border-radius: var(--nb-radius-m); display: block; margin: 10px 0; box-shadow: var(--nb-shadow-1); }
.nb-wikitext, .nb-wiki { color: var(--nb-accent); text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 2px; }
/* Obsidian Canvas */
.nb-canvas-shell { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.nb-canvas-head { display: flex; align-items: center; gap: 10px; padding: 10px 18px; border-bottom: 1px solid var(--nb-line); }
.nb-canvas-icon { font-size: 15px; }
.nb-canvas-name { font-size: 13.5px; font-weight: 600; color: var(--nb-text); }
.nb-canvas-count { font-size: 11px; color: var(--nb-text-3); }
.nb-canvas-badge { margin-left: auto; font-size: 10px; font-weight: 600; letter-spacing: .04em; color: var(--nb-text-3); border: 1px solid var(--nb-line-2); border-radius: 999px; padding: 1px 8px; }
.nb-canvas-close { border: none; background: transparent; color: var(--nb-text-3); font-size: 18px; line-height: 1; cursor: pointer; padding: 2px 6px; border-radius: 4px; }
.nb-canvas-close:hover { background: var(--nb-hover); color: var(--nb-text); }
.nb-canvas-body { flex: 1 1 auto; overflow: auto; padding: 28px; background: var(--nb-panel); }
.nb-canvas-stage { position: relative; }
.nb-canvas-edges { position: absolute; left: 0; top: 0; pointer-events: none; }
.nb-canvas-edge { stroke: var(--nb-line-2); stroke-width: 2; }
.nb-canvas-node { position: absolute; box-sizing: border-box; border: 1.5px solid var(--nb-line-2); border-radius: 10px; background: var(--nb-card); box-shadow: var(--nb-shadow-1); padding: 10px 12px; overflow: hidden; font-size: 12px; line-height: 1.55; color: var(--nb-text-2); white-space: pre-wrap; word-break: break-word; }
.nb-canvas-node-file { border-color: color-mix(in srgb, var(--nb-accent) 40%, var(--nb-line-2)); }
.nb-canvas-file { border: none; background: transparent; color: var(--nb-accent); font-size: 12.5px; font-weight: 500; cursor: pointer; padding: 0; text-align: left; }
.nb-canvas-node-group { background: color-mix(in srgb, var(--nb-accent-soft) 70%, transparent); border-style: dashed; border-radius: 12px; }
.nb-canvas-group-label { position: absolute; top: 6px; left: 10px; font-size: 10.5px; font-weight: 600; color: var(--nb-text-3); letter-spacing: .04em; }
.nb-canvas-text { display: block; }
.nb-canvas-link-text { color: var(--nb-accent); }
.nb-canvas-loading { flex: 1 1 auto; display: flex; align-items: center; justify-content: center; color: var(--nb-text-3); font-size: 13px; padding: 40px; }
.nb-canvas-empty { padding: 40px; text-align: center; color: var(--nb-text-3); font-size: 12.5px; }
.nb-canvas-tools { display: flex; align-items: center; gap: 8px; padding: 8px 18px; border-top: 1px solid var(--nb-line); }
.nb-canvas-tool { border: 1px solid var(--nb-line-2); background: var(--nb-card); color: var(--nb-text-2); width: 26px; height: 26px; border-radius: 6px; cursor: pointer; font-size: 14px; line-height: 1; }
.nb-canvas-tool:hover { border-color: var(--nb-accent); color: var(--nb-text); }
.nb-canvas-zoom { font-size: 11px; color: var(--nb-text-3); min-width: 38px; text-align: center; }
.nb-canvas-hint { margin-left: auto; font-size: 10.5px; color: var(--nb-text-3); }
/* Callout columns (obsidian-columns syntax) */
.nb-columns { display: grid; gap: 16px; align-items: start; margin: 8px 0; }
.nb-column { min-width: 0; border: 1px solid var(--nb-line); border-radius: var(--nb-radius-m); padding: 10px 12px; background: var(--nb-panel); }
.nb-column > :first-child { margin-top: 0; }
.nb-footnotes { margin-top: 22px; padding-top: 12px; border-top: 1px solid var(--nb-line); }
.nb-footnotes-title { font-size: 10.5px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--nb-text-3); margin-bottom: 6px; }
.nb-footnote { display: flex; gap: 8px; font-size: 12px; line-height: 1.65; color: var(--nb-text-2); padding: 2px 0; }
.nb-footnote-ref { color: var(--nb-accent); font-weight: 600; min-width: 16px; }
.nb-mermaid-render { display: flex; justify-content: center; padding: 18px 16px; border: 1px solid var(--nb-line-2); border-radius: var(--nb-radius-m); background: var(--nb-panel); overflow: auto; }
.nb-mermaid-render svg { max-width: 100%; height: auto; background: transparent; }
.nb-mermaid-render .node rect { rx: 8px; ry: 8px; }
.nb-mermaid-render .node rect, .nb-mermaid-render .node circle, .nb-mermaid-render .node polygon, .nb-mermaid-render .node path { stroke-width: 1.4px; }
.nb-mermaid-render .nodeLabel { font-size: 12.5px; font-weight: 500; }
.nb-mermaid-render .edgePath path { stroke-width: 1.3px; }
.nb-mermaid-render .edgeLabel { border-radius: 6px; padding: 1px 4px; }
.nb-mermaid-render .label { font-weight: 500; }
.nb-mermaid-loading { padding: 4px 0; font-size: 12px; color: var(--nb-text-3); }
.nb-mermaid-card { border: 1px solid var(--nb-line-2); border-radius: var(--nb-radius-m); background: var(--nb-panel); padding: 12px 14px; }
.nb-mermaid-head { display: flex; align-items: center; gap: 8px; }
.nb-mermaid-icon { font-size: 14px; }
.nb-mermaid-title { font-size: 12.5px; font-weight: 600; color: var(--nb-text); }
.nb-mermaid-src { margin-top: 8px; font-size: 11px; color: var(--nb-text-3); }
.nb-mermaid-src summary { cursor: pointer; }
.nb-mermaid-code { margin: 8px 0 0; padding: 10px; background: var(--nb-card); border: 1px solid var(--nb-line); border-radius: var(--nb-radius-s); font-size: 11.5px; overflow: auto; color: var(--nb-text-2); }
.nb-mermaid-hint { margin-top: 8px; font-size: 11px; color: var(--nb-text-3); }
.nb-html-block { line-height: 1.7; }
.nb-html-block iframe, .nb-html-block video { max-width: 100%; border-radius: var(--nb-radius-s); }
.nb-math { font-family: 'Latin Modern Math', 'STIX Two Math', 'Cambria Math', serif; font-size: 1.02em; }
.nb-math-block-wrap { padding: 6px 0; text-align: center; }
.nb-math-block { display: inline-block; font-size: 1.16em; }
.nb-math-frac { display: inline-flex; flex-direction: column; vertical-align: -0.55em; margin: 0 .18em; text-align: center; }
.nb-math-num { border-bottom: 1px solid currentColor; padding: 0 .18em; line-height: 1.25; }
.nb-math-den { padding: 0 .18em; line-height: 1.25; }
.nb-math-sqrt { white-space: nowrap; }
.nb-math-radicand { border-top: 1px solid currentColor; padding-top: 1px; }
.nb-math sup, .nb-math sub { font-size: .72em; }
.nb-tag { display: inline-flex; align-items: center; font-size: .92em; line-height: 1.5; padding: 0 6px; border-radius: 4px; background: var(--nb-accent-soft); color: var(--nb-accent); white-space: nowrap; }
mark { background: color-mix(in srgb, var(--dsw-alias-state-warning-primary, #f5b83d) 38%, transparent); color: inherit; border-radius: 3px; padding: 0 1px; }
.nb-footnote-ref { font-size: .72em; color: var(--nb-accent); cursor: pointer; padding: 0 2px; }
.nb-wiki { color: var(--nb-accent); cursor: pointer; }
.nb-wiki:hover { text-decoration: underline; }
.nb-ph { color: var(--nb-text-3); opacity: .7; }
.nb-b-done { color: var(--nb-text-3); text-decoration: line-through; text-decoration-color: var(--nb-text-3); }
.nb-divider-line { width: 100%; border: none; border-top: 1px solid var(--nb-line-2); margin: 18px 0; }

/* checkboxes */
.nb-check { flex: 0 0 auto; width: 18px; height: 18px; margin: 5px 9px 0 1px; padding: 0; border: 1.5px solid var(--nb-line-2); border-radius: 4px; background: var(--nb-card); cursor: pointer; position: relative; transition: background .12s, border-color .12s; }
.nb-check:hover { border-color: var(--nb-accent); }
.nb-check.on { background: var(--nb-accent); border-color: var(--nb-accent); }
.nb-check.on::after { content: ''; position: absolute; left: 4.5px; top: 1.5px; width: 4px; height: 8px; border: solid #fff; border-width: 0 1.6px 1.6px 0; transform: rotate(42deg); animation: nb-tick .16s var(--nb-ease-out); }
.nb-check-row { display: flex; align-items: flex-start; }
.nb-check-row .nb-b { padding-left: 2px; }

/* code block */
.nb-b-code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.84em; line-height: 1.65; background: var(--dsw-alias-markdown-code-block, var(--nb-panel)); border: 1px solid var(--nb-line); border-radius: var(--nb-radius-m); padding: 14px 16px; margin: 6px 0; white-space: pre-wrap; }
.nb-b-code .c-comment { color: var(--nb-text-3); font-style: italic; }
.nb-b-code .c-string { color: var(--dsw-alias-state-success-primary); }
.nb-b-code .c-number, .nb-b-code .c-bool { color: var(--dsw-alias-state-warn-primary); }
.nb-b-code .c-keyword { color: var(--nb-accent); }
.nb-b-code .c-func, .nb-b-code .c-decorator { color: var(--dsw-alias-state-info-primary); }
.nb-b-code .c-type { color: color-mix(in srgb, var(--dsw-alias-state-info-primary) 65%, var(--dsw-alias-state-business-primary)); }
.nb-b-code .c-prop, .nb-b-code .c-attr { color: var(--nb-text-2); }
.nb-b-code .c-tag { color: var(--dsw-alias-state-business-primary); }
.nb-b-code .c-var, .nb-b-code .c-anchor { color: color-mix(in srgb, var(--nb-accent) 55%, var(--dsw-alias-state-success-primary)); }
.nb-b-code .c-section { color: var(--dsw-alias-state-business-primary); font-weight: 600; }
.nb-b-code .c-atrule { color: var(--nb-accent); }
.nb-b-code .c-entity, .nb-b-code .c-meta { color: var(--nb-text-3); }
.nb-b-code .c-heading { color: var(--nb-text); font-weight: 600; }

/* Marp deck inside a fenced block */
.nb-b-code.nb-has-deck { background: transparent; border: none; padding: 0; white-space: normal; font-family: inherit; font-size: inherit; line-height: inherit; }
.nb-deck { display: flex; flex-direction: column; gap: 8px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; }
.nb-deck-bar { display: flex; align-items: center; gap: 6px; }
.nb-deck-tag { font-size: 9.5px; letter-spacing: .1em; color: var(--nb-text-2); border: 1px solid var(--nb-line-2); border-radius: 4px; padding: 1px 5px; }
.nb-deck-tab { border: none; background: transparent; color: var(--nb-text-2); font-size: 11.5px; padding: 3px 9px; border-radius: 5px; cursor: pointer; }
.nb-deck-tab:hover { background: var(--nb-hover); color: var(--nb-text); }
.nb-deck-tab.on { background: var(--nb-accent-soft); color: var(--nb-accent); }
.nb-deck-stage { position: relative; width: 100%; aspect-ratio: 16 / 9; max-height: 560px; border: 1px solid var(--nb-line); border-radius: 10px; background: #fff; color: #1c1c1e; overflow: hidden; box-shadow: 0 6px 20px rgba(16, 24, 40, .08); outline: none; }
.nb-deck-stage:focus-visible { border-color: var(--nb-accent); box-shadow: 0 0 0 3px var(--nb-accent-ring); }
.nb-deck-slide { position: absolute; inset: 0; overflow: auto; padding: 4.5% 5.5%; font-size: clamp(12px, 1.15vw, 17px); line-height: 1.6; }
.nb-deck-slide h3 { margin: 0 0 .45em; font-size: 2em; line-height: 1.2; }
.nb-deck-slide h4 { margin: 0 0 .5em; font-size: 1.5em; line-height: 1.25; }
.nb-deck-slide h5 { margin: 0 0 .5em; font-size: 1.2em; }
.nb-deck-slide p { margin: .45em 0; }
.nb-deck-slide ul, .nb-deck-slide ol { margin: .4em 0; padding-left: 1.25em; }
.nb-deck-slide blockquote { margin: .6em 0; padding: .2em .8em; border-left: 3px solid #c9cfda; color: #4a4f58; }
.nb-deck-slide table { border-collapse: collapse; margin: .6em 0; font-size: .82em; }
.nb-deck-slide th, .nb-deck-slide td { border: 1px solid #d5d9e0; padding: 4px 9px; text-align: left; vertical-align: top; }
.nb-deck-slide th { background: #f3f5f9; }
.nb-deck-slide code { background: #f1f3f7; padding: 1px 4px; border-radius: 3px; font-size: .9em; }
.nb-deck-slide pre { background: #f6f8fa; padding: 8px 10px; border-radius: 6px; overflow: auto; }
.nb-deck-nav { display: flex; align-items: center; justify-content: center; gap: 10px; }
.nb-deck-btn { width: 26px; height: 26px; border: 1px solid var(--nb-line-2); background: var(--nb-card); color: var(--nb-text); border-radius: 6px; cursor: pointer; font-size: 14px; line-height: 1; }
.nb-deck-btn:hover { border-color: var(--nb-accent); color: var(--nb-accent); }
.nb-deck-count { min-width: 46px; text-align: center; font-size: 11.5px; color: var(--nb-text-2); }
.nb-deck-fallback { padding: 16px 18px; border: 1px dashed var(--nb-line-2); border-radius: 8px; color: var(--dsw-alias-state-error-primary); font-size: 12.5px; line-height: 1.7; }
.nb-code-lang-wrap { position: absolute; top: 10px; right: 12px; z-index: 5; }
.nb-code-lang { border: none; background: var(--nb-card); color: var(--nb-text-3); font-size: 10.5px; padding: 3px 8px; border-radius: var(--nb-radius-s); cursor: pointer; opacity: 0; transition: opacity .12s; box-shadow: var(--nb-shadow-1); }
.nb-block:hover .nb-code-lang { opacity: 1; }
.nb-code-lang-menu { position: absolute; right: 0; top: 100%; margin-top: 6px; max-height: 220px; overflow: auto; background: var(--nb-card); border: 1px solid var(--nb-line); border-radius: var(--nb-radius-m); padding: 4px; min-width: 130px; box-shadow: var(--nb-shadow-2); transform-origin: top right; animation: nb-pop 160ms var(--nb-ease-out); }
.nb-code-lang-item { display: block; width: 100%; text-align: left; border: none; background: transparent; color: var(--nb-text); font-size: 12px; padding: 5px 8px; border-radius: var(--nb-radius-s); cursor: pointer; }
.nb-code-lang-item:hover, .nb-code-lang-item.on { background: var(--nb-hover); }

/* callout & toggle */
.nb-block.nb-callout-note, .nb-block.nb-callout-info { --nb-callout-tone: var(--nb-accent); }
.nb-block.nb-callout-tip, .nb-block.nb-callout-abstract { --nb-callout-tone: #0d9488; }
.nb-block.nb-callout-success, .nb-block.nb-callout-todo { --nb-callout-tone: var(--dsw-alias-state-success-primary, #1a7f4b); }
.nb-block.nb-callout-warning { --nb-callout-tone: var(--dsw-alias-state-warn-primary, #b45309); }
.nb-block.nb-callout-danger, .nb-block.nb-callout-bug, .nb-block.nb-callout-failure { --nb-callout-tone: var(--dsw-alias-state-error-primary, #c0392b); }
.nb-block.nb-callout-question, .nb-block.nb-callout-important { --nb-callout-tone: #7c3aed; }
.nb-block.nb-callout-example { --nb-callout-tone: #4f46e5; }
.nb-block.nb-callout-quote { --nb-callout-tone: var(--nb-text-3); }
.nb-type-callout { background-color: color-mix(in srgb, var(--nb-callout-tone, var(--nb-accent)) 10%, var(--nb-surface)); border: 1px solid color-mix(in srgb, var(--nb-callout-tone, var(--nb-accent)) 20%, transparent); border-radius: var(--nb-radius-m); padding: 7px 12px 7px 8px; margin: 8px 0; transition: background-color .28s var(--nb-ease), border-color .28s var(--nb-ease); }
.nb-callout-icon { flex: 0 0 auto; width: 26px; height: 26px; margin: 1px 7px 0 1px; padding: 0; border: none; border-radius: var(--nb-radius-s); background: color-mix(in srgb, var(--nb-callout-tone, var(--nb-accent)) 16%, transparent); font-size: 13.5px; line-height: 1; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: background .14s var(--nb-ease), transform .16s var(--nb-ease-out); }
.nb-callout-icon:hover { background: color-mix(in srgb, var(--nb-callout-tone, var(--nb-accent)) 28%, transparent); transform: scale(1.06) rotate(-3deg); }
.nb-callout-icon:active { transform: scale(.88) rotate(-8deg); }
.nb-root.reading .nb-callout-icon { cursor: default; }
.nb-root.reading .nb-callout-icon:hover { background: color-mix(in srgb, var(--nb-callout-tone, var(--nb-accent)) 16%, transparent); }
.nb-b-callout { padding: 3px 4px; }
.nb-type-toggle .nb-b { font-weight: 600; }
.nb-toggle-arrow { flex: 0 0 auto; width: 22px; height: 30px; padding: 0; border: none; border-radius: var(--nb-radius-s); background: transparent; color: var(--nb-text-3); font-size: 12px; line-height: 1; cursor: pointer; transition: background .12s, color .12s; }
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
.nb-table-actions button { border: none; background: transparent; color: var(--nb-text-3); font-size: 11.5px; padding: 3px 8px; border-radius: var(--nb-radius-s); cursor: pointer; transition: background .12s, color .12s; }
.nb-table-actions button:hover { background: var(--nb-hover); color: var(--nb-text); }

/* ── Overlays: ghost, menus, toolbars, dialogs ─────────── */
.nb-ghost { position: fixed; z-index: 70; pointer-events: none; max-width: 380px; padding: 8px 12px; background: var(--nb-card); border: 1px solid var(--nb-line-2); border-radius: var(--nb-radius-m); box-shadow: var(--nb-shadow-2); color: var(--nb-text); font-size: 14px; line-height: 1.5; opacity: .94; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.nb-find { position: absolute; top: 52px; right: 18px; z-index: 50; display: flex; align-items: center; gap: 4px; padding: 5px 7px; background: var(--nb-card); border: 1px solid var(--nb-line); border-radius: var(--nb-radius-m); box-shadow: var(--nb-shadow-2); animation: nb-pop 160ms var(--nb-ease-out); }
.nb-find-input { width: 180px; height: 28px; }
.nb-find-count { min-width: 22px; text-align: center; font-size: 11.5px; color: var(--nb-text-3); }
.nb-img-bar { position: fixed; z-index: 82; display: flex; align-items: center; gap: 4px; padding: 6px 8px; background: var(--nb-card); border: 1px solid var(--nb-line); border-radius: var(--nb-radius-m); box-shadow: var(--nb-shadow-2); animation: nb-pop 160ms var(--nb-ease-out); }
.nb-img-bar-input { width: 150px; height: 26px; box-sizing: border-box; border: 1px solid var(--nb-line-2); border-radius: var(--nb-radius-s); background: var(--nb-surface); color: var(--nb-text); padding: 0 8px; font-size: 12px; outline: none; }
.nb-img-bar-input:focus { border-color: var(--nb-accent); box-shadow: 0 0 0 3px var(--nb-accent-ring); }
.nb-img-bar-btn { border: none; background: transparent; color: var(--nb-text-2); font-size: 12px; padding: 4px 8px; border-radius: var(--nb-radius-s); cursor: pointer; transition: background .12s, color .12s; }
.nb-img-bar-btn:hover { background: var(--nb-hover); color: var(--nb-text); }
.nb-img-bar-btn.on { background: var(--nb-active); color: var(--nb-text); font-weight: 600; }
.nb-img-bar-btn.danger { color: var(--dsw-alias-state-error-primary); }
.nb-note-menu { position: fixed; z-index: 60; min-width: 158px; padding: 4px; border: 1px solid var(--nb-line); border-radius: var(--nb-radius-m); background: var(--nb-card); box-shadow: var(--nb-shadow-2); transform-origin: top left; animation: nb-pop 160ms var(--nb-ease-out); }
.nb-menu { position: absolute; z-index: 40; left: 0; top: 100%; margin-top: 4px; min-width: 182px; padding: 4px; background: var(--nb-card); border: 1px solid var(--nb-line); border-radius: var(--nb-radius-m); box-shadow: var(--nb-shadow-2); transform-origin: top left; animation: nb-pop 160ms var(--nb-ease-out); }
.nb-menu-item { display: flex; align-items: center; gap: 8px; width: 100%; box-sizing: border-box; border: none; background: transparent; color: var(--nb-text); font-size: 13px; padding: 6px 8px; border-radius: var(--nb-radius-s); cursor: pointer; text-align: left; transition: background .12s var(--nb-ease); }
.nb-menu-item:hover { background: var(--nb-hover); }
.nb-menu-item.on { background: var(--nb-active); font-weight: 600; }
.nb-menu-item.danger { color: var(--dsw-alias-state-error-primary); }
.nb-menu-icon { flex: 0 0 20px; width: 20px; text-align: center; font-size: 11px; color: var(--nb-text-3); }
.nb-menu-sep { height: 1px; margin: 4px 2px; background: var(--nb-line); }
.nb-menu-label { padding: 4px 8px 2px; font-size: 10.5px; font-weight: 600; letter-spacing: .04em; color: var(--nb-text-3); }
.nb-menu-empty { padding: 8px 10px; font-size: 12px; color: var(--nb-text-3); }
.nb-toolbar { position: fixed; z-index: 80; display: flex; gap: 2px; padding: 4px; background: var(--nb-card); border: 1px solid var(--nb-line); border-radius: var(--nb-radius-m); box-shadow: var(--nb-shadow-2); animation: nb-pop 160ms var(--nb-ease-out); }
.nb-toolbar-btn { min-width: 28px; height: 28px; padding: 0 7px; border: none; border-radius: var(--nb-radius-s); background: transparent; color: var(--nb-text); cursor: pointer; font-size: 13px; display: inline-flex; align-items: center; justify-content: center; transition: background .12s; }
.nb-toolbar-btn.nb-toolbar-ask { color: var(--nb-accent); }
.nb-toolbar-btn:hover { background: var(--nb-hover); }
.nb-toolbar-bold { font-weight: 700; }
.nb-toolbar-italic { font-style: italic; }
.nb-toolbar-strike { text-decoration: line-through; }
.nb-toolbar-code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; }
.nb-toolbar-input { width: 190px; height: 28px; box-sizing: border-box; border: 1px solid var(--nb-line-2); border-radius: var(--nb-radius-s); background: var(--nb-surface); color: var(--nb-text); padding: 0 8px; font-size: 12.5px; outline: none; }
.nb-toolbar-input:focus { border-color: var(--nb-accent); box-shadow: 0 0 0 3px var(--nb-accent-ring); }
.nb-modal { position: absolute; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; padding: 24px; background: color-mix(in srgb, var(--dsw-alias-bg-mask-1, #0000003d) 70%, transparent); backdrop-filter: blur(2px); animation: nb-fade 120ms var(--nb-ease-out); }
.nb-modal-card { width: min(440px, 100%); box-sizing: border-box; padding: 20px 22px; background: var(--nb-card); border: 1px solid var(--nb-line); border-radius: var(--nb-radius-l); box-shadow: 0 24px 64px rgba(16, 24, 40, .18), 0 4px 12px rgba(16, 24, 40, .08); display: flex; flex-direction: column; gap: 12px; animation: nb-dialog-in 180ms var(--nb-ease-out); }
.nb-modal-title { font-size: 15px; font-weight: 600; letter-spacing: -.005em; }
.nb-modal-text { font-size: 12.5px; color: var(--nb-text-2); line-height: 1.65; word-break: break-word; }
.nb-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }

/* sync dialog */
.nb-sync-card { width: min(560px, 100%); max-height: min(86vh, 780px); overflow: auto; }
.nb-sync-tabs { display: inline-flex; padding: 3px; gap: 2px; background: var(--nb-hover); border-radius: var(--nb-radius-m); align-self: flex-start; }
.nb-sync-tab { border: none; background: transparent; color: var(--nb-text-2); font-size: 12.5px; font-weight: 500; padding: 6px 14px; border-radius: calc(var(--nb-radius-m) - 2px); cursor: pointer; transition: background .14s var(--nb-ease), color .14s var(--nb-ease); }
.nb-sync-tab[data-on="1"] { background: var(--nb-card); color: var(--nb-text); box-shadow: 0 1px 2px rgba(16, 24, 40, .12); }
.nb-sync-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.nb-sync-label { font-size: 11.5px; font-weight: 600; color: var(--nb-text-2); letter-spacing: .01em; }
.nb-sync-input { height: 32px; box-sizing: border-box; width: 100%; border: 1px solid var(--nb-line-2); border-radius: var(--nb-radius-s); background: var(--nb-surface); color: var(--nb-text); padding: 0 10px; font-size: 12.5px; outline: none; transition: border-color .14s, box-shadow .14s; }
.nb-sync-input:focus { border-color: var(--nb-accent); box-shadow: 0 0 0 3px var(--nb-accent-ring); }
.nb-sync-hint { font-size: 11px; color: var(--nb-text-2); opacity: .85; line-height: 1.55; }
.nb-sync-row { display: flex; gap: 10px; }
.nb-sync-group { display: flex; flex-direction: column; gap: 10px; }
.nb-sync-row > .nb-sync-field { flex: 1; }
.nb-sync-check { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--nb-text); }
.nb-sync-status { border: 1px solid var(--nb-line); border-radius: var(--nb-radius-m); padding: 10px 12px; background: var(--nb-surface); display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--nb-text-2); }
.nb-sync-status[data-kind="error"] { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #c0392b) 45%, var(--nb-line)); }
.nb-sync-status[data-kind="ok"] { border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #1a7f4b) 35%, var(--nb-line)); }
.nb-sync-meter { height: 4px; border-radius: 2px; background: var(--nb-hover); overflow: hidden; }
.nb-sync-meter i { display: block; height: 100%; border-radius: 2px; background: var(--nb-accent); transition: width .25s var(--nb-ease); }
.nb-sync-history { border: 1px solid var(--nb-line); border-radius: var(--nb-radius-m); background: var(--nb-surface); padding: 4px 8px; }
.nb-sync-history-toggle { width: 100%; border: none; background: transparent; color: var(--nb-text-2); font-size: 11.5px; text-align: left; padding: 4px 2px; cursor: pointer; }
.nb-sync-history-toggle:hover { color: var(--nb-text); }
.nb-sync-history-list { display: flex; flex-direction: column; gap: 2px; padding-bottom: 4px; }
.nb-sync-history-row { display: flex; align-items: baseline; gap: 8px; font-size: 11px; color: var(--nb-text-2); padding: 3px 2px; border-top: 1px dashed var(--nb-line); }
.nb-sync-history-row[data-ok="0"] { color: var(--dsw-alias-state-error-primary); }
.nb-sync-history-time { flex: 0 0 auto; }
.nb-sync-history-trigger { flex: 0 0 auto; color: var(--nb-text-3); }
.nb-sync-history-stat { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nb-sync-history-error { flex: 1 1 100%; color: var(--dsw-alias-state-error-primary); }
.nb-sync-detail { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; line-height: 1.5; color: var(--nb-text-2); white-space: pre-wrap; word-break: break-all; max-height: 132px; overflow: auto; }
.nb-sync-note { font-size: 12px; line-height: 1.55; }
.nb-sync-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.nb-sync-actions .nb-sync-spacer { flex: 1; }
.nb-sync-btn { position: relative; }
.nb-sync-btn::after { content: ''; position: absolute; right: 5px; bottom: 5px; width: 5px; height: 5px; border-radius: 50%; background: var(--nb-line-2); }
.nb-sync-btn[data-state="busy"]::after { background: var(--dsw-alias-state-warn-primary, #a15c00); animation: nb-save-pulse 1.2s var(--nb-ease) infinite; }
.nb-sync-btn[data-state="error"]::after { background: var(--dsw-alias-state-error-primary, #c0392b); }
.nb-sync-btn[data-state="idle"]::after { background: var(--dsw-alias-state-success-primary, #1a7f4b); opacity: .8; }

/* flash (闪念) */
.nb-flash-entry { display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 12px; box-sizing: border-box; border: 1px solid var(--nb-line-2); border-radius: var(--nb-radius-s); background: var(--nb-card); color: var(--nb-text); font-size: 12.5px; font-weight: 500; cursor: pointer; transition: background .14s var(--nb-ease), border-color .14s; }
.nb-flash-entry:hover { background: var(--nb-hover); border-color: var(--nb-accent); }
.nb-tab-flash { color: var(--nb-accent); font-weight: 600; }
.nb-flash-entry-icon { font-size: 14px; }
.nb-flash-count { margin-left: auto; min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; border-radius: 9px; background: var(--nb-accent-soft); color: var(--nb-accent); font-size: 11px; font-weight: 600; }
.nb-flash { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; background: var(--nb-bg); }
.nb-flash-head { display: flex; align-items: center; gap: 10px; padding: 18px 24px 10px; flex-wrap: wrap; }
.nb-flash-title { font-size: 20px; font-weight: 700; letter-spacing: -.01em; }
.nb-flash-sub { font-size: 12px; color: var(--nb-text-2); }
.nb-flash-head .nb-btn { height: 28px; padding: 0 12px; font-size: 12px; }
.nb-flash-filters { display: flex; align-items: center; gap: 8px; padding: 0 24px 12px; flex-wrap: wrap; border-bottom: 1px solid var(--nb-line); }
.nb-flash-tab { border: none; background: transparent; color: var(--nb-text-2); font-size: 12.5px; font-weight: 500; padding: 5px 10px; border-radius: var(--nb-radius-s); cursor: pointer; }
.nb-flash-tab[data-on="1"] { background: var(--nb-accent-soft); color: var(--nb-accent); }
.nb-flash-cats { display: flex; gap: 6px; flex-wrap: wrap; }
.nb-flash-cat-chip { border: 1px solid var(--nb-line-2); background: transparent; color: var(--nb-text-2); font-size: 11.5px; padding: 3px 10px; border-radius: 999px; cursor: pointer; transition: background .14s, border-color .14s, color .14s; }
.nb-flash-cat-chip[data-on="1"] { border-color: var(--nb-accent); color: var(--nb-accent); background: var(--nb-accent-soft); }
.nb-flash-search { margin-left: auto; width: 190px; height: 28px; box-sizing: border-box; border: 1px solid var(--nb-line-2); border-radius: var(--nb-radius-s); background: var(--nb-surface); color: var(--nb-text); padding: 0 9px; font-size: 12.5px; outline: none; }
.nb-flash-search:focus { border-color: var(--nb-accent); box-shadow: 0 0 0 3px var(--nb-accent-ring); }
.nb-flash-list { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 16px 24px 48px; display: flex; flex-direction: column; gap: 10px; }
.nb-flash-card { border: 1px solid var(--nb-line); background: var(--nb-card); border-radius: var(--nb-radius-m); padding: 12px 14px; display: flex; flex-direction: column; gap: 7px; }
.nb-flash-card.pinned { border-color: color-mix(in srgb, var(--nb-accent) 45%, var(--nb-line)); }
.nb-flash-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 11.5px; color: var(--nb-text-2); }
.nb-flash-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--nb-line-2); }
.nb-flash-dot[data-cat="0"] { background: var(--nb-text-3, #8a8f98); }
.nb-flash-dot[data-cat="1"] { background: var(--dsw-alias-state-info-primary, #2f6feb); }
.nb-flash-dot[data-cat="2"] { background: var(--dsw-alias-state-warn-primary, #a15c00); }
.nb-flash-dot[data-cat="3"] { background: var(--nb-accent); }
.nb-flash-dot[data-cat="4"] { background: var(--dsw-alias-state-success-primary, #1a7f4b); }
.nb-flash-tag { font-size: 11px; color: var(--nb-text-2); opacity: .85; }
.nb-flash-text { margin: 0; font-size: 14px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; cursor: pointer; }
.nb-flash-text:hover { color: var(--nb-accent); }
.nb-flash-actions { display: flex; gap: 2px; opacity: .55; transition: opacity .14s var(--nb-ease); flex-wrap: wrap; }
.nb-flash-card:hover .nb-flash-actions { opacity: 1; }
.nb-flash-action { border: none; background: transparent; color: var(--nb-text-2); font-size: 11.5px; padding: 3px 7px; border-radius: 4px; cursor: pointer; }
.nb-flash-action:hover { background: var(--nb-hover); color: var(--nb-text); }
.nb-flash-action[data-on="1"] { color: var(--nb-accent); }
.nb-flash-action.danger { color: var(--dsw-alias-state-error-primary, #c0392b); }
.nb-flash-empty { padding: 64px 0; text-align: center; color: var(--nb-text-2); font-size: 13px; line-height: 1.8; }
.nb-flash-error { padding: 10px 24px 0; color: var(--dsw-alias-state-error-primary, #c0392b); font-size: 12px; }
.nb-flash-textarea { width: 100%; min-height: 132px; box-sizing: border-box; resize: vertical; border: 1px solid var(--nb-line-2); border-radius: var(--nb-radius-m); background: var(--nb-surface); color: var(--nb-text); padding: 12px 14px; font-size: 14px; line-height: 1.7; font-family: inherit; outline: none; }
.nb-flash-textarea:focus { border-color: var(--nb-accent); box-shadow: 0 0 0 3px var(--nb-accent-ring); }
.nb-flash-edit { display: flex; flex-direction: column; gap: 8px; }
.nb-flash-edit-area { min-height: 96px; font-size: 13px; }
.nb-flash-edit-actions { display: flex; justify-content: flex-end; gap: 4px; }
.nb-flash-capture-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.nb-flash-capture-actions .nb-flash-hint { font-size: 11px; color: var(--nb-text-2); margin-right: auto; }

/* buttons */
.nb-btn { border: 1px solid var(--nb-line-2); background: var(--nb-card); color: var(--nb-text); font-size: 12.5px; font-weight: 500; padding: 7px 14px; border-radius: var(--nb-radius-s); cursor: pointer; transition: background .14s var(--nb-ease), border-color .14s var(--nb-ease), box-shadow .14s var(--nb-ease), transform .1s var(--nb-ease); }
.nb-btn:hover { background: var(--nb-hover); border-color: var(--nb-line-2); }
.nb-btn:active { background: var(--nb-active); }
.nb-btn-primary, .nb-btn.nb-btn-primary { background: var(--dsw-alias-button-primary-fill, var(--nb-text)); border-color: transparent; color: var(--dsw-alias-label-primary-foreground, #fff); }
.nb-btn-primary:hover { background: var(--dsw-alias-button-primary-hover, #43454a); border-color: transparent; }
.nb-btn-danger { background: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); color: #fff; }
.nb-btn-danger:hover { background: var(--dsw-alias-state-error-secondary); border-color: var(--dsw-alias-state-error-secondary); }

/* empty state & loading */
/* Obsidian Bases views */
.nb-bases-view { border: 1px solid var(--nb-line-2); border-radius: var(--nb-radius-m); background: var(--nb-card); overflow: hidden; }
.nb-bases-head { display: flex; align-items: center; gap: 8px; padding: 9px 12px; border-bottom: 1px solid var(--nb-line); background: var(--nb-panel); }
.nb-bases-icon { font-size: 13px; }
.nb-bases-name { font-size: 12.5px; font-weight: 600; color: var(--nb-text); }
.nb-bases-type { font-size: 10.5px; color: var(--nb-text-3); border: 1px solid var(--nb-line); border-radius: 999px; padding: 1px 7px; }
.nb-bases-tag { margin-left: auto; font-size: 10px; font-weight: 600; letter-spacing: .04em; color: var(--nb-text-3); border: 1px solid var(--nb-line-2); border-radius: 999px; padding: 1px 8px; }
.nb-bases-count { font-size: 11px; color: var(--nb-text-3); }
.nb-bases-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.nb-bases-table th { text-align: left; font-weight: 500; font-size: 10.5px; letter-spacing: .04em; color: var(--nb-text-3); padding: 7px 12px; border-bottom: 1px solid var(--nb-line); }
.nb-bases-table td { padding: 8px 12px; border-bottom: 1px solid var(--nb-line); color: var(--nb-text-2); }
.nb-bases-table tr:last-child td { border-bottom: none; }
.nb-bases-row { cursor: pointer; }
.nb-bases-row:hover td { background: var(--nb-hover); color: var(--nb-text); }
.nb-bases-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 8px; padding: 10px 12px; }
.nb-bases-card { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; padding: 10px 12px; border: 1px solid var(--nb-line); border-radius: var(--nb-radius-s); background: var(--nb-panel); cursor: pointer; text-align: left; transition: border-color .12s, background .12s; }
.nb-bases-card:hover { border-color: var(--nb-accent); background: var(--nb-card); }
.nb-bases-card-title { font-size: 12.5px; font-weight: 500; color: var(--nb-text); }
.nb-bases-card-meta { font-size: 10.5px; color: var(--nb-text-3); }
.nb-bases-list { padding: 5px 6px; }
.nb-bases-list-item { display: block; width: 100%; text-align: left; border: none; background: transparent; color: var(--nb-text-2); font-size: 12.5px; padding: 6px 8px; border-radius: 6px; cursor: pointer; }
.nb-bases-list-item:hover { background: var(--nb-hover); color: var(--nb-text); }
.nb-bases-kanban { display: flex; gap: 8px; overflow-x: auto; padding: 10px 12px; align-items: flex-start; }
.nb-bases-kanban-col { flex: 0 0 190px; display: flex; flex-direction: column; gap: 6px; }
.nb-bases-kanban-head { font-size: 10.5px; font-weight: 600; letter-spacing: .04em; color: var(--nb-text-3); padding-bottom: 4px; }
.nb-bases-empty { padding: 14px 12px; font-size: 11.5px; color: var(--nb-text-3); }
.nb-empty { max-width: 760px; margin: 0 auto; padding: 16vh 64px 0; }
.nb-empty-title { font-size: 40px; font-weight: 700; letter-spacing: -.025em; line-height: 1.15; }
.nb-empty-text { margin-top: 12px; font-size: 14.5px; color: var(--nb-text-2); line-height: 1.7; }
.nb-empty-btn { margin-top: 22px; border: 1px solid var(--nb-line-2); background: var(--nb-card); color: var(--nb-text); font-size: 13px; font-weight: 500; padding: 8px 14px; border-radius: var(--nb-radius-s); cursor: pointer; box-shadow: var(--nb-shadow-1); transition: background .14s, border-color .14s; }
.nb-empty-btn:hover { background: var(--nb-hover); border-color: var(--nb-accent); }
.nb-empty-error { margin-top: 18px; font-size: 12px; color: var(--nb-text-3); word-break: break-word; }
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
.nb-shortcut-keys { flex: 0 0 168px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; color: var(--nb-text); background: var(--nb-panel); border: 1px solid var(--nb-line); border-radius: var(--nb-radius-s); padding: 2px 6px; }
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
.nb-ai-snapshot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 11.5px; color: var(--nb-text-3); }
.nb-ai-source { max-height: 96px; overflow: auto; padding: 8px 10px; background: var(--nb-panel); border-radius: var(--nb-radius-s); font-size: 12px; color: var(--nb-text-3); white-space: pre-wrap; }
.nb-ai-result { width: 100%; box-sizing: border-box; min-height: 130px; padding: 10px; font-size: 13px; line-height: 1.6; }
.nb-ai-result.loading, .nb-ai-result.error { min-height: auto; padding: 12px; background: var(--nb-panel); border-radius: var(--nb-radius-s); font-size: 12.5px; color: var(--nb-text-3); }
.nb-ai-result.error { color: var(--dsw-alias-state-error-primary); }
/* Collection (table / board) views */
.nb-collection { margin: 10px 0 18px; }
.nb-collection-bar { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding: 8px 0; border-bottom: 1px solid var(--nb-line); }
.nb-collection-main { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1 1 300px; }
.nb-collection-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-left: auto; }
.nb-collection-views { display: flex; gap: 2px; padding: 2px; background: var(--nb-panel); border-radius: var(--nb-radius-s); }
.nb-collection-view { border: none; background: transparent; color: var(--nb-text-2); font-size: 12px; padding: 4px 10px; border-radius: var(--nb-radius-s); cursor: pointer; transition: background .12s var(--nb-ease), color .12s var(--nb-ease), box-shadow .16s var(--nb-ease), transform .1s var(--nb-ease); }
.nb-collection-view.on { background: var(--nb-card); color: var(--nb-text); font-weight: 600; box-shadow: var(--nb-shadow-1); }
.nb-collection-filter { width: auto; flex: 1 1 150px; max-width: 260px; height: 28px; }
.nb-collection-count { color: var(--nb-text-3); font-size: 11.5px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.nb-collection-bar .nb-btn { height: 28px; padding: 0 11px; font-size: 12px; }
.nb-collection-refresh { margin-left: 0; }
.nb-collection-filterbtn.on { color: var(--nb-accent); background: var(--nb-accent-soft); border-color: transparent; }
.nb-collection-filterbar { display: flex; gap: 6px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--nb-line); }
.nb-collection-filterinput { flex: 1 1 auto; height: 30px; }
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
.nb-collection-card { display: flex; flex-direction: column; gap: 3px; width: 100%; box-sizing: border-box; text-align: left; border: 1px solid var(--nb-line); background: var(--nb-card); border-radius: var(--nb-radius-s); padding: 8px 10px; margin-bottom: 6px; cursor: pointer; box-shadow: var(--nb-shadow-1); transition: border-color .14s var(--nb-ease), box-shadow .18s var(--nb-ease), transform .18s var(--nb-ease-out); }
.nb-collection-card:hover { border-color: var(--nb-accent); transform: translateY(-1px); box-shadow: 0 6px 16px rgba(16, 24, 40, .08); }
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
.nb-outline-float { position: absolute; top: 64px; right: 18px; z-index: 30; width: 200px; max-height: 52vh; overflow: auto; padding: 8px; background: var(--nb-card); border: 1px solid var(--nb-line); border-radius: var(--nb-radius-m); box-shadow: var(--nb-shadow-2); animation: nb-fade 160ms var(--nb-ease-out); }
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
.nb-wiki-pop { position: fixed; z-index: 84; min-width: 220px; max-width: 320px; max-height: 260px; overflow: auto; padding: 4px; background: var(--nb-card); border: 1px solid var(--nb-line); border-radius: var(--nb-radius-m); box-shadow: var(--nb-shadow-2); transform-origin: top left; animation: nb-pop 160ms var(--nb-ease-out); }
.nb-wiki-item { display: block; width: 100%; border: none; background: transparent; color: var(--nb-text); font-size: 12.5px; padding: 5px 8px; border-radius: var(--nb-radius-s); cursor: pointer; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; transition: background .12s var(--nb-ease), color .12s var(--nb-ease); }
.nb-wiki-item:hover, .nb-wiki-item.on { background: var(--nb-hover); }
.nb-flash { animation: nb-flash .9s ease; }
@keyframes nb-flash { 0% { box-shadow: 0 0 0 2px var(--nb-accent-ring); } 100% { box-shadow: 0 0 0 2px transparent; } }
@keyframes nb-pop { from { opacity: 0; transform: translateY(-4px) scale(.98); } to { opacity: 1; transform: none; } }
@keyframes nb-dialog-in { from { opacity: 0; transform: scale(.97); } to { opacity: 1; transform: none; } }
@keyframes nb-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes nb-ask-in { from { opacity: 0; transform: translateX(8px); } to { opacity: 1; transform: none; } }
@keyframes nb-notice-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
@keyframes nb-save-pulse { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
@keyframes nb-tick { from { transform: rotate(42deg) scale(.4); opacity: 0; } to { transform: rotate(42deg) scale(1); opacity: 1; } }
@keyframes nb-msg-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.nb-root .nb-btn:active, .nb-root .nb-ask-btn:active, .nb-root .nb-ask-chip:active, .nb-root .nb-collection-view:active, .nb-root .nb-folder-sort:active { transform: scale(.96); }
.nb-root .nb-icon-btn:active { transform: scale(.92); }
@media (prefers-reduced-motion: reduce) { .nb-root *, .nb-root *::before, .nb-root *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; scroll-behavior: auto !important; } }

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

/* ── Folder page ────────────────────────────────────────── */
.nb-folder { display: flex; flex-direction: column; gap: 6px; margin: 2px 0 20px; }
.nb-folder-bar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.nb-folder-filter { flex: 0 1 210px; min-width: 120px; height: 28px; padding: 0 10px; border: 1px solid var(--nb-line); border-radius: var(--nb-radius-s); background: var(--nb-card); color: var(--nb-text); font-size: 12.5px; outline: none; transition: border-color .14s var(--nb-ease), box-shadow .14s var(--nb-ease); }
.nb-folder-filter::placeholder { color: var(--nb-text-3); }
.nb-folder-filter:focus { border-color: var(--nb-accent); box-shadow: 0 0 0 3px var(--nb-accent-ring); }
.nb-folder-sort { height: 26px; padding: 0 9px; border: 1px solid transparent; border-radius: var(--nb-radius-s); background: transparent; color: var(--nb-text-3); font-size: 12px; cursor: pointer; transition: background .14s var(--nb-ease), color .14s var(--nb-ease), transform .1s var(--nb-ease); }
.nb-folder-sort:hover { background: var(--nb-hover); color: var(--nb-text-2); }
.nb-folder-sort.on { background: var(--nb-hover); color: var(--nb-text); }
.nb-folder-count { margin-left: auto; color: var(--nb-text-3); font-size: 12px; }
.nb-folder-list { display: flex; flex-direction: column; border: 1px solid var(--nb-line); border-radius: var(--nb-radius-m); overflow: hidden; background: var(--nb-card); }
.nb-folder-row { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 34px; padding: 5px 10px; border: none; border-top: 1px solid var(--nb-line); background: transparent; color: var(--nb-text); font-size: 13px; text-align: left; cursor: pointer; }
.nb-folder-list > .nb-folder-row:first-child { border-top: none; }
.nb-folder-row { transition: background .12s var(--nb-ease); }
.nb-folder-row:hover { background: var(--nb-hover); }
.nb-folder-row:focus-visible { outline: 2px solid var(--nb-accent); outline-offset: -2px; }
.nb-folder-glyph { flex: none; width: 18px; text-align: center; font-size: 13px; line-height: 1; }
.nb-folder-chevron { flex: none; width: 10px; color: var(--nb-text-3); font-size: 10px; }
.nb-folder-name { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nb-folder-meta { margin-left: auto; flex: none; color: var(--nb-text-3); font-size: 11.5px; font-variant-numeric: tabular-nums; }
.nb-folder-note { padding: 6px 10px; color: var(--nb-text-3); font-size: 12px; }
.nb-folder-body { align-self: flex-start; margin-top: 2px; padding: 2px 8px; border: none; border-radius: var(--nb-radius-s); background: transparent; color: var(--nb-text-3); font-size: 12px; cursor: pointer; }
.nb-folder-body:hover { background: var(--nb-hover); color: var(--nb-text-2); }
.nb-folder-new { color: var(--nb-text-3); }
.nb-folder-new:hover { color: var(--nb-text); background: var(--nb-hover); }

/* ── Ask-AI right column ───────────────────────────────── */
.nb-icon-btn.on { color: var(--nb-accent); background: var(--nb-accent-soft); }
.nb-ask { flex: 0 0 340px; width: 340px; min-width: 260px; max-width: 46%; display: flex; flex-direction: column; min-height: 0; border-left: 1px solid var(--nb-line); background: var(--nb-surface); animation: nb-ask-in 200ms var(--nb-ease-out); }
.nb-ask-head { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; height: 46px; padding: 0 8px 0 16px; border-bottom: 1px solid var(--nb-line); }
.nb-ask-title { flex: 1 1 auto; font-size: 13px; font-weight: 600; letter-spacing: -.005em; color: var(--nb-text); }
.nb-ask-model { max-width: 132px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10.5px; letter-spacing: .01em; color: var(--nb-text-3); }
.nb-ask-context { flex: 0 0 auto; padding: 10px 16px 12px; border-bottom: 1px solid var(--nb-line); min-width: 0; }
.nb-ask-about { font-size: 12px; color: var(--nb-text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nb-ask-about::before { content: ''; display: inline-block; width: 10px; height: 10px; margin-right: 7px; border-radius: 3px; background: var(--nb-accent-soft); box-shadow: inset 0 0 0 1px var(--nb-accent-ring); vertical-align: -1px; }
.nb-ask-selection { display: flex; align-items: center; gap: 4px; margin-top: 8px; min-width: 0; }
.nb-ask-selection-text { flex: 1 1 auto; min-width: 0; padding: 4px 9px; border-radius: var(--nb-radius-s); background: var(--nb-accent-soft); color: var(--nb-accent); font-size: 11.5px; line-height: 1.5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nb-ask-focus { margin-top: 6px; font-size: 11.5px; line-height: 1.55; color: var(--nb-text-3); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.nb-ask-thread { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 14px 16px 18px; display: flex; flex-direction: column; gap: 16px; }
.nb-ask-empty { color: var(--nb-text-3); font-size: 12.5px; line-height: 1.7; }
.nb-ask-quick { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.nb-ask-chip { height: 24px; padding: 0 10px; border: 1px solid var(--nb-line-2); border-radius: 999px; background: var(--nb-card); color: var(--nb-text-2); font-size: 12px; cursor: pointer; transition: background .14s var(--nb-ease), color .14s var(--nb-ease), border-color .14s var(--nb-ease), transform .1s var(--nb-ease); }
.nb-ask-chip:hover:not(:disabled) { background: var(--nb-hover); color: var(--nb-text); }
.nb-ask-chip:disabled { opacity: .5; cursor: default; }
.nb-ask-msg { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.nb-ask-msg:last-child { animation: nb-msg-in .22s var(--nb-ease-out); }
.nb-ask-role { font-size: 10.5px; font-weight: 600; letter-spacing: .06em; color: var(--nb-text-3); }
.nb-ask-text { font-size: 13px; line-height: 1.72; color: var(--nb-text); white-space: pre-wrap; word-break: break-word; }
.nb-ask-msg.user .nb-ask-text { background: var(--nb-panel); border-radius: var(--nb-radius-m); padding: 8px 11px; }
.nb-ask-md { font-size: 13px; line-height: 1.7; color: var(--nb-text); white-space: normal; }
.nb-ask-md p { margin: 0 0 8px; }
.nb-ask-md p:last-child { margin-bottom: 0; }
.nb-ask-md h3 { margin: 2px 0 6px; font-size: 15px; line-height: 1.4; }
.nb-ask-md h4 { margin: 2px 0 6px; font-size: 14px; line-height: 1.4; }
.nb-ask-md h5 { margin: 2px 0 6px; font-size: 13px; line-height: 1.4; color: var(--nb-text-2); }
.nb-ask-md ul, .nb-ask-md ol { margin: 0 0 8px; padding-left: 20px; }
.nb-ask-md li { margin: 2px 0; }
.nb-ask-md li.todo { display: flex; align-items: baseline; gap: 6px; list-style: none; margin-left: -20px; }
.nb-ask-md li.todo .box { flex: none; width: 11px; height: 11px; border: 1.5px solid var(--nb-line-2); border-radius: 3px; }
.nb-ask-md li.todo.done .box { background: var(--nb-accent); border-color: var(--nb-accent); }
.nb-ask-md li.todo.done { color: var(--nb-text-3); text-decoration: line-through; }
.nb-ask-md pre { margin: 0 0 8px; padding: 8px 10px; border-radius: 6px; background: var(--nb-panel); overflow-x: auto; }
.nb-ask-md pre code { padding: 0; background: transparent; }
.nb-ask-md code { padding: 1px 4px; border-radius: 4px; background: var(--nb-hover); font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 12px; }
.nb-ask-md blockquote { margin: 0 0 8px; padding: 2px 0 2px 10px; border-left: 3px solid var(--nb-line-2); color: var(--nb-text-2); }
.nb-ask-md hr { margin: 10px 0; border: none; border-top: 1px solid var(--nb-line); }
.nb-ask-md table { width: 100%; margin: 0 0 8px; border-collapse: collapse; font-size: 12px; }
.nb-ask-md th, .nb-ask-md td { padding: 4px 6px; border: 1px solid var(--nb-line-2); text-align: left; }
.nb-ask-md a { color: var(--nb-accent); }
.nb-ask-md a.nb-ask-note { color: var(--nb-accent); text-decoration: none; border-bottom: 1px dashed var(--nb-accent-soft); cursor: pointer; }
.nb-ask-md a.nb-ask-note code { color: var(--nb-accent); background: var(--nb-accent-soft); }
.nb-ask-error { display: flex; align-items: baseline; gap: 8px; flex: none; margin: 0 14px 8px; font-size: 12px; color: var(--dsw-alias-state-error-primary); }
.nb-ask-error-text { flex: 1 1 auto; min-width: 0; }
.nb-ask-steps { font-size: 11px; color: var(--nb-text-3); }
.nb-ask-msg-actions { display: flex; gap: 6px; margin-top: 2px; }
.nb-ask-mini { padding: 2px 6px; border: none; border-radius: 4px; background: transparent; color: var(--nb-text-3); font-size: 11px; cursor: pointer; }
.nb-ask-mini:hover { background: var(--nb-hover); color: var(--nb-text-2); }
.nb-ask-modes { display: flex; gap: 4px; margin-top: 10px; }
.nb-ask-mode { height: 22px; padding: 0 8px; border: 1px solid transparent; border-radius: 999px; background: transparent; color: var(--nb-text-3); font-size: 11.5px; cursor: pointer; transition: background .14s var(--nb-ease), color .14s var(--nb-ease); }
.nb-ask-mode:hover:not(:disabled) { background: var(--nb-hover); color: var(--nb-text-2); }
.nb-ask-mode.on { background: var(--nb-accent-soft); color: var(--nb-accent); }
.nb-ask-mode:disabled { opacity: .6; cursor: default; }
.nb-ask-compose { flex: 0 0 auto; display: flex; flex-direction: column; gap: 8px; padding: 10px 12px 14px; border-top: 1px solid var(--nb-line); }
.nb-ask-input { width: 100%; box-sizing: border-box; min-height: 58px; max-height: 160px; resize: vertical; padding: 9px 11px; border: 1px solid var(--nb-line); border-radius: var(--nb-radius-s); background: var(--nb-card); color: var(--nb-text); font: inherit; font-size: 13px; line-height: 1.5; outline: none; transition: border-color .14s var(--nb-ease), box-shadow .14s var(--nb-ease); }
.nb-ask-input:focus { border-color: var(--nb-accent); box-shadow: 0 0 0 3px var(--nb-accent-ring); }
.nb-ask-input::placeholder { color: var(--nb-text-3); }
.nb-ask-actions { display: flex; justify-content: flex-end; }
.nb-ask-btn { height: 30px; padding: 0 16px; border-radius: var(--nb-radius-s); border: 1px solid var(--nb-line-2); background: var(--nb-card); color: var(--nb-text); font-size: 12.5px; cursor: pointer; transition: background .14s var(--nb-ease), border-color .14s var(--nb-ease), transform .1s var(--nb-ease); }
.nb-ask-btn.primary { background: var(--nb-accent); border-color: var(--nb-accent); color: #fff; }
.nb-ask-btn:disabled { opacity: .5; cursor: default; }
.nb-root.zen .nb-ask { display: none; }
@media (max-width: 1000px) { .nb-ask { flex: 0 0 300px; width: 300px; max-width: none; } }

/* ── Print ─────────────────────────────────────────────── */
@media print {
  body * { visibility: hidden; }
  .nb-root, .nb-root * { visibility: visible; }
  .nb-root { position: absolute; inset: 0; display: block; height: auto; background: #fff; color: #000; }
  .nb-side, .nb-topbar, .nb-tabs, .nb-gutter, .nb-add, .nb-notice, .nb-find, .nb-toolbar, .nb-img-bar, .nb-ghost, .nb-modal, .nb-icon-panel, .nb-ask, .nb-col-handle, .nb-row-handle, .nb-col-resize, .nb-toggle-arrow { display: none !important; }
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
        const colCallout = /^\s*>\s*\[!col\]([+-]?)\s?(.*)$/i.exec(line)
        if (colCallout !== null) {
          flushParagraph()
          const columns = []
          const widths = []
          const marker = /^\s*\[!col-md(?:-([0-9.]+))?\]/i
          let current = []
          let currentWidth = 1
          let pending = false
          const flushColumn = (force) => {
            if (current.length === 0 && force !== true) return
            columns.push(current.join('\n'))
            widths.push(currentWidth)
            current = []
            currentWidth = 1
            pending = false
          }
          const startColumn = (inner) => {
            if (current.length > 0) flushColumn(true)
            const match = marker.exec(String(inner ?? ''))
            const weight = match !== null && match[1] !== undefined ? Number(match[1]) : 1
            currentWidth = Number.isFinite(weight) && weight > 0 ? weight : 1
            pending = true
          }
          const firstText = String(colCallout[2] ?? '').trim()
          if (firstText.length > 0) current.push(firstText)
          let scan = index + 1
          while (scan < lines.length) {
            const quoted = /^\s*>\s?(.*)$/.exec(lines[scan])
            if (quoted === null) break
            const content = String(quoted[1] ?? '')
            const nested = /^\s*>\s?(.*)$/.exec(content)
            if (nested !== null) {
              const inner = String(nested[1] ?? '')
              if (marker.test(inner.trim())) {
                startColumn(inner)
                scan += 1
                continue
              }
              if (inner.trim().length === 0) {
                flushColumn(false)
                scan += 1
                continue
              }
              current.push(inner.trim())
              pending = false
              scan += 1
              continue
            }
            if (content.trim().length === 0) {
              flushColumn(false)
              scan += 1
              continue
            }
            if (marker.test(content.trim())) {
              startColumn(content)
              scan += 1
              continue
            }
            current.push(content.trim())
            pending = false
            scan += 1
          }
          if (current.length > 0) flushColumn(true)
          if (pending) flushColumn(true)
          if (columns.length === 0) {
            columns.push('')
            widths.push(1)
          }
          blocks.push({ id: makeId(), type: 'columns', columns, widths, text: columns.join('\n'), indent })
          index = scan - 1
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
        filter: frontmatterValue(frontmatter, 'filter').trim(),
        sort: frontmatterValue(frontmatter, 'sort').trim(),
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

    /**
     * Parse a saved filter like `status = done and tags ~ infra` (conditions are
     * joined with `and`; ~ means contains; quoting is optional).
     */
    function parseCollectionFilter(text) {
      const source = String(text ?? '').trim()
      if (source.length === 0) return []
      const conditions = []
      for (const part of source.split(/\s+and\s+/i)) {
        const match = /^([A-Za-z0-9_-]+)\s*(!=|>=|<=|=|~|>|<)\s*(.+)$/.exec(part.trim())
        if (match === null) continue
        let value = match[3].trim()
        if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
          value = value.slice(1, -1)
        }
        conditions.push({ field: match[1], op: match[2], value })
      }
      return conditions
    }

    /** Does one row satisfy every condition of a parsed filter? */
    function matchCollectionFilter(row, conditions) {
      for (const condition of conditions) {
        const left = collectionValue(row, condition.field)
        const right = condition.value
        const leftNumber = Number(left)
        const rightNumber = Number(right)
        const numeric =
          left.trim().length > 0 &&
          right.trim().length > 0 &&
          Number.isFinite(leftNumber) &&
          Number.isFinite(rightNumber)
        const lowerLeft = left.toLowerCase()
        const lowerRight = right.toLowerCase()
        switch (condition.op) {
          case '=':
            if (numeric ? leftNumber !== rightNumber : lowerLeft !== lowerRight) return false
            break
          case '!=':
            if (numeric ? leftNumber === rightNumber : lowerLeft === lowerRight) return false
            break
          case '~':
            if (!lowerLeft.includes(lowerRight)) return false
            break
          case '>':
            if (!(numeric ? leftNumber > rightNumber : lowerLeft > lowerRight)) return false
            break
          case '<':
            if (!(numeric ? leftNumber < rightNumber : lowerLeft < lowerRight)) return false
            break
          case '>=':
            if (!(numeric ? leftNumber >= rightNumber : lowerLeft >= lowerRight)) return false
            break
          case '<=':
            if (!(numeric ? leftNumber <= rightNumber : lowerLeft <= lowerRight)) return false
            break
          default:
            return false
        }
      }
      return true
    }

    /** Apply a saved filter expression to rows; an unparsable filter shows all. */
    function applyCollectionFilter(rows, text) {
      const conditions = parseCollectionFilter(text)
      const list = Array.isArray(rows) ? rows : []
      if (conditions.length === 0) return list.slice()
      return list.filter((row) => matchCollectionFilter(row, conditions))
    }

    /** Read a saved `sort` value (`field:asc|desc`). */
    function parseCollectionSort(text) {
      const match = /^([A-Za-z0-9_-]+)(?::(asc|desc))?$/.exec(String(text ?? '').trim())
      if (match === null) return { key: '', dir: 'asc' }
      return { key: match[1], dir: match[2] === 'desc' ? 'desc' : 'asc' }
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

    /** Directory part of a vault-relative note path ('' at the vault root). */
    function folderOfPath(path) {
      const text = String(path ?? '')
      const cut = text.lastIndexOf('/')
      return cut < 0 ? '' : text.slice(0, cut)
    }

    /** The single link a block's whole text is, or null for anything else. */
    function linkOnlyTarget(text) {
      const value = String(text ?? '').trim()
      const markdown = /^\[[^\]]*\]\(\s*<?([^)<>]+?)>?\s*\)$/.exec(value)
      if (markdown !== null) {
        const target = markdown[1].split('#')[0].trim()
        return target.length > 0 ? target : null
      }
      const wiki = /^!?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]$/.exec(value)
      return wiki === null ? null : wiki[1].trim()
    }

    /** Resolve one note's relative link into a vault-relative path. */
    function resolveNoteLink(notePath, target) {
      const raw = String(target ?? '').trim()
      const wiki = /^!?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]$/.exec(raw)
      const bare = wiki !== null ? wiki[1] : raw.replace(/^<(.+)>$/, '$1')
      const text = bare.split('#')[0].trim()
      const base = folderOfPath(notePath).split('/').filter(Boolean)
      for (const part of text.replace(/\\/g, '/').split('/')) {
        if (part.length === 0 || part === '.') continue
        if (part === '..') {
          if (base.length === 0) return null
          base.pop()
          continue
        }
        base.push(part)
      }
      const joined = base.join('/')
      if (joined.length === 0) return null
      return /\.[a-z0-9]+$/i.test(joined) ? joined : `${joined}.md`
    }

    /**
     * Resolve `[label](note.md)` to a real note. Relative paths, `../`, URL
     * encoding and `#anchors` are handled; web URLs never become note links.
     */
    function markdownNoteLink(notePath, href, notes) {
      const raw = String(href ?? '').trim().replace(/^<(.+)>$/, '$1').trim()
      if (raw.length === 0 || raw.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return null
      let decoded = raw
      try {
        decoded = decodeURIComponent(raw)
      } catch {
        /* keep the raw text when it is not valid percent-encoding */
      }
      if (!/\.md(?:[#?].*)?$/i.test(decoded)) return null
      const resolved = resolveNoteLink(notePath, decoded)
      if (resolved === null) return null
      return findWikiTarget(notes, resolved)
    }

    /**
     * A page whose body is nothing but links to its own folder's notes reads as
     * a folder index — `工作.md` listing the notes of `01 工作/`. One leading
     * heading equal to the page name is allowed (it is the page title written
     * out again), and three links is the floor so a stray list does not count.
     */
    function autoFolderPageFor(blocks, notePath) {
      const folder = folderOfPath(notePath)
      const noteName = noteNameFromPath(notePath)
      const links = []
      let first = true
      for (const block of Array.isArray(blocks) ? blocks : []) {
        const text = String(block?.text ?? '').trim()
        if (text.length === 0) continue
        if (first && block.type === 'heading1' && text === noteName) {
          first = false
          continue
        }
        first = false
        if (block.type !== 'paragraph') return null
        const target = linkOnlyTarget(text)
        if (target === null) return null
        links.push(target)
      }
      if (links.length < 3) return null
      const targets = new Set()
      for (const target of links) {
        const resolved = resolveNoteLink(notePath, target)
        if (resolved === null || folderOfPath(resolved) !== folder) return null
        targets.add(resolved)
      }
      if (targets.size < 3) return null
      return { folder, auto: true, links: targets.size }
    }

    /** Frontmatter `type: folder` / `directory` / `index`, with a `folder:` override. */
    function folderPageConfigFor(frontmatter, notePath) {
      const type = frontmatterValue(frontmatter, 'type').trim().toLowerCase()
      if (type !== 'folder' && type !== 'directory' && type !== 'index') return null
      const override = frontmatterValue(frontmatter, 'folder').trim().replace(/^\/+|\/+$/g, '')
      return { folder: override.length > 0 ? override : folderOfPath(notePath), auto: false, links: 0 }
    }

    /** Resolve the folder a page presents: explicit frontmatter wins, else detection. */
    function folderPageFor(frontmatter, notePath, blocks) {
      const linkList = autoFolderPageFor(blocks, notePath)
      const explicit = folderPageConfigFor(frontmatter, notePath)
      if (explicit !== null) return { ...explicit, linkBody: linkList !== null }
      return linkList === null ? null : { ...linkList, linkBody: true }
    }

    /** Direct notes and subfolders of one folder, from the Host's note list. */
    function folderEntriesFor(notes, folder, selfPath) {
      const prefix = folder.length === 0 ? '' : `${folder}/`
      const files = []
      const folders = new Map()
      for (const note of Array.isArray(notes) ? notes : []) {
        const path = typeof note?.path === 'string' ? note.path : ''
        if (path.length === 0 || path === selfPath || !path.startsWith(prefix)) continue
        const rest = path.slice(prefix.length)
        const cut = rest.indexOf('/')
        if (cut < 0) {
          files.push(note)
          continue
        }
        const name = rest.slice(0, cut)
        if (!folders.has(name)) folders.set(name, { name, path: `${prefix}${name}`, count: 0, notes: [] })
        const entry = folders.get(name)
        entry.count += 1
        if (rest.slice(cut + 1).indexOf('/') < 0) entry.notes.push(note)
      }
      const byName = (a, b) => String(a.name).localeCompare(String(b.name), 'zh-Hans-CN', { numeric: true })
      files.sort(byName)
      const dirs = [...folders.values()].sort(byName)
      for (const entry of dirs) entry.notes.sort(byName)
      return { files, folders: dirs }
    }

    /** Sort a folder page's notes by name (ascending) or last change (newest first). */
    function sortFolderNotes(notes, key) {
      const list = Array.isArray(notes) ? notes.slice() : []
      if (key === 'updated') return list.sort((a, b) => (Number(b.mtimeMs) || 0) - (Number(a.mtimeMs) || 0))
      return list.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-Hans-CN', { numeric: true }))
    }

    /** Folder page body: live listing of the folder's notes and subfolders. */
    function FolderView({ t, folder, entries, hasBody, bodyOpen, onToggleBody, onOpen, onReload, onCreate }) {
      const [query, setQuery] = React.useState('')
      const [sort, setSort] = React.useState('name')
      const [expanded, setExpanded] = React.useState({})
      const needle = query.trim().toLowerCase()
      const matches = (note) =>
        needle.length === 0 || `${note.name ?? ''} ${note.path}`.toLowerCase().includes(needle)
      const files = sortFolderNotes(entries.files.filter(matches), sort)
      const folders = entries.folders
        .map((item) => ({ ...item, notes: item.notes.filter(matches) }))
        .filter((item) => needle.length === 0 || item.name.toLowerCase().includes(needle) || item.notes.length > 0)
      const countLabel = [
        t('folderNoteCount', { count: entries.files.length }),
        entries.folders.length > 0 ? t('folderFolderCount', { count: entries.folders.length }) : '',
      ]
        .filter(Boolean)
        .join(' · ')
      const noteRow = (note, depth) =>
        h(
          'button',
          {
            key: note.path,
            type: 'button',
            className: 'nb-folder-row',
            style: depth > 0 ? { paddingLeft: 12 + depth * 18 } : undefined,
            onClick: () => onOpen(note.path),
            title: note.path,
          },
          h('span', { className: 'nb-folder-glyph', 'aria-hidden': 'true' }, '📄'),
          h('span', { className: 'nb-folder-name' }, note.name ?? noteNameFromPath(note.path)),
          h(
            'span',
            { className: 'nb-folder-meta' },
            [formatBytes(note.size), formatShortDate(note.mtimeMs)].filter(Boolean).join(' · '),
          ),
        )
      const folderRow = (item) => {
        const open = expanded[item.path] === true
        return h(
          'button',
          {
            key: item.path,
            type: 'button',
            className: 'nb-folder-row nb-folder-row-dir',
            'aria-expanded': open,
            onClick: () => setExpanded((previous) => ({ ...previous, [item.path]: !previous[item.path] })),
            title: item.path,
          },
          h('span', { className: 'nb-folder-chevron', 'aria-hidden': 'true' }, open ? '▾' : '▸'),
          h('span', { className: 'nb-folder-glyph', 'aria-hidden': 'true' }, '📁'),
          h('span', { className: 'nb-folder-name' }, item.name),
          h('span', { className: 'nb-folder-meta' }, t('folderFolderCount', { count: item.count })),
        )
      }
      const rows = []
      for (const item of folders) {
        rows.push(folderRow(item))
        if (expanded[item.path] === true) {
          if (item.notes.length === 0) {
            rows.push(
              h('div', { key: `${item.path}:empty`, className: 'nb-folder-note' }, t('folderFolderEmpty')),
            )
          } else {
            for (const note of sortFolderNotes(item.notes, 'name')) rows.push(noteRow(note, 1))
          }
        }
      }
      for (const note of files) rows.push(noteRow(note, 0))
      // A folder page is where the folder's next note gets started.
      if (typeof onCreate === 'function') {
        rows.push(
          h(
            'button',
            { key: '__new', type: 'button', className: 'nb-folder-row nb-folder-new', onClick: () => onCreate() },
            h('span', { className: 'nb-folder-glyph', 'aria-hidden': 'true' }, '+'),
            h('span', { className: 'nb-folder-name' }, t('newNote')),
          ),
        )
      }
      return h(
        'div',
        { className: 'nb-folder' },
        h(
          'div',
          { className: 'nb-folder-bar' },
          h('input', {
            className: 'nb-folder-filter',
            value: query,
            placeholder: t('folderFilter'),
            'aria-label': t('folderFilter'),
            onChange: (event) => setQuery(event.target.value),
          }),
          h(
            'button',
            {
              type: 'button',
              className: `nb-folder-sort${sort === 'name' ? ' on' : ''}`,
              onClick: () => setSort('name'),
            },
            t('folderSortName'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: `nb-folder-sort${sort === 'updated' ? ' on' : ''}`,
              onClick: () => setSort('updated'),
            },
            t('folderSortUpdated'),
          ),
          typeof onReload === 'function'
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'nb-folder-sort',
                  title: t('folderReload'),
                  'aria-label': t('folderReload'),
                  onClick: () => onReload(),
                },
                '⟳',
              )
            : null,
          h('span', { className: 'nb-folder-count', title: folder.length === 0 ? '/' : folder }, countLabel),
        ),
        h(
          'div',
          { className: 'nb-folder-list' },
          rows.length > 0 ? rows : h('div', { className: 'nb-folder-note' }, t('folderEmpty')),
        ),
        hasBody
          ? h(
              'button',
              { type: 'button', className: 'nb-folder-body', onClick: onToggleBody },
              bodyOpen ? t('folderHideBody') : t('folderShowBody'),
            )
          : null,
      )
    }

    /** Table / board view over a folder's notes and their frontmatter fields. */
    function CollectionView({ t, config, rows, loading, folder, onOpen, onReload, onFieldChange, onCreate, onSaveConfig }) {
      const initialSort = parseCollectionSort(config.sort)
      const initialFilter = String(config.filter ?? '').trim()
      const [view, setView] = React.useState(null)
      const [sortKey, setSortKey] = React.useState(initialSort.key)
      const [sortDir, setSortDir] = React.useState(initialSort.dir)
      const [query, setQuery] = React.useState('')
      const [filterText, setFilterText] = React.useState(initialFilter)
      const [filterDraft, setFilterDraft] = React.useState(initialFilter)
      const [filterOpen, setFilterOpen] = React.useState(initialFilter.length > 0)
      const [editingCell, setEditingCell] = React.useState(null)
      const [draft, setDraft] = React.useState('')
      const [dragRow, setDragRow] = React.useState(null)
      const [dragColumn, setDragColumn] = React.useState(null)
      const activeView = view === null ? config.view : view
      const columns = collectionColumns(rows, config.columns)
      const visible = sortCollectionRows(
        applyCollectionFilter(filterCollectionRows(rows, query), filterText),
        sortKey,
        sortDir,
      )
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
          { className: 'nb-collection-main' },
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
        ),
        h(
          'div',
          { className: 'nb-collection-actions' },
          h(
            'button',
            {
              className: `nb-btn nb-collection-filterbtn${filterText.length > 0 ? ' on' : ''}`,
              onClick: () => setFilterOpen((open) => !open),
              title: t('collectionFilterAdvanced'),
            },
            filterText.length > 0 ? `${t('collectionFilterAdvanced')} •` : t('collectionFilterAdvanced'),
          ),
          typeof onSaveConfig === 'function'
            ? h(
                'button',
                {
                  className: 'nb-btn nb-collection-save',
                  title: t('collectionSaveHint'),
                  onClick: () =>
                    onSaveConfig({
                      view: activeView,
                      filter: filterText,
                      sort: sortKey.length > 0 ? `${sortKey}:${sortDir}` : '',
                      groupBy: config.groupBy,
                    }),
                },
                t('collectionSaveView'),
              )
            : null,
          h(
            'button',
            { className: 'nb-btn nb-collection-new', onClick: () => (typeof onCreate === 'function' ? onCreate() : null) },
            `+ ${t('collectionNewRow')}`,
          ),
          h('button', { className: 'nb-btn nb-collection-refresh', onClick: onReload }, t('refresh')),
        ),
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
        filterOpen
          ? h(
              'div',
              { className: 'nb-collection-filterbar' },
              h('input', {
                className: 'nb-input nb-collection-filterinput',
                value: filterDraft,
                placeholder: t('collectionFilterHint'),
                'aria-label': t('collectionFilterHint'),
                onChange: (event) => setFilterDraft(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    setFilterText(filterDraft.trim())
                  }
                },
              }),
              h(
                'button',
                {
                  className: 'nb-btn',
                  onClick: () => setFilterText(filterDraft.trim()),
                },
                t('collectionApplyFilter'),
              ),
              h(
                'button',
                {
                  className: 'nb-btn',
                  onClick: () => {
                    setFilterDraft('')
                    setFilterText('')
                  },
                },
                t('collectionClearFilter'),
              ),
            )
          : null,
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
        case 'columns': {
          const columns = Array.isArray(block.columns) && block.columns.length > 0 ? block.columns : ['']
          const widths = Array.isArray(block.widths) ? block.widths : []
          const groups = columns.map((column, columnIndex) => {
            const width = Number(widths[columnIndex] ?? 1)
            const marker = Number.isFinite(width) && width > 0 && width !== 1 ? `>> [!col-md-${width}]` : '>> [!col-md]'
            const quoted = String(column ?? '')
              .split('\n')
              .map((value) => `>> ${value}`)
              .join('\n')
            return `${marker}\n${quoted}`
          })
          line = ['> [!col]', ...groups].join('\n>\n')
          break
        }
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

    /** The embed form of a block link: `![[note#^id]]` renders that block. */
    function blockEmbedFor(notePath, block) {
      const link = blockLinkFor(notePath, block)
      return link.startsWith('![') ? link : `!${link}`
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

    /**
     * Wrap one selected substring with Markdown markers. Used to format a
     * selection that spans several blocks without rewriting the whole note.
     * Returns null when the substring cannot be located (rendered markup).
     */
    function wrapMarkdownSelection(text, selected, before, after) {
      const source = String(text ?? '')
      const needle = String(selected ?? '')
      if (needle.length === 0) return null
      let start = source.indexOf(needle)
      let length = needle.length
      if (start < 0) {
        const trimmed = needle.trim()
        if (trimmed.length === 0) return null
        start = source.indexOf(trimmed)
        length = trimmed.length
      }
      if (start < 0) return null
      const already =
        source.slice(Math.max(0, start - before.length), start) === before &&
        source.slice(start + length, start + length + after.length) === after
      if (already) return source
      return `${source.slice(0, start)}${before}${source.slice(start, start + length)}${after}${source.slice(start + length)}`
    }

    /** True when the OS asks for reduced motion; JS-driven scrolling must honor it too. */
    function prefersReducedMotion() {
      return (
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches === true
      )
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
        /(!\[\[[^\]\n]+\]\])|(!\[[^\]\n]*\]\([^)\n]+\)(?:\{width=\d+%\})?)|(`[^`\n]+`)|(\$\$[^$\n]+\$\$)|(\$[^$\n]+\$)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(~~[^~\n]+~~)|(==[^=\n]+==)|(%%.*?%%)|(\[\[[^\]\n]+\]\])|(\[[^\]\n]+\]\([^)\n]+\))|(\[\^[^\]\n]+\])|(#([\w\u4e00-\u9fa5][\w\u4e00-\u9fa5/-]*))|(\*[^*\n]+\*)|(_[^_\n]+_)/g
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
        } else if (token.startsWith('$$')) {
          nodes.push(
            h('span', { key, className: 'nb-math', dangerouslySetInnerHTML: { __html: renderLatexMath(token, true) } }),
          )
        } else if (token.startsWith('$')) {
          const inner = token.slice(1, -1)
          if (LATEX_LIKE.test(inner)) {
            nodes.push(
              h('span', { key, className: 'nb-math', dangerouslySetInnerHTML: { __html: renderLatexMath(token, false) } }),
            )
          } else {
            nodes.push(token)
          }
        } else if (token.startsWith('**') || token.startsWith('__')) {
          nodes.push(h('strong', { key }, token.slice(2, -2)))
        } else if (token.startsWith('~~')) {
          nodes.push(h('del', { key }, token.slice(2, -2)))
        } else if (token.startsWith('==')) {
          nodes.push(h('mark', { key }, token.slice(2, -2)))
        } else if (token.startsWith('%%')) {
          /* Obsidian comments stay hidden */
        } else if (token.startsWith('[^')) {
          const ref = token.slice(2, -1)
          nodes.push(h('sup', { key, className: 'nb-footnote-ref', 'data-ref': ref }, ref))
        } else if (token.startsWith('#')) {
          const previous = match.index === 0 ? '' : text[match.index - 1]
          if (previous === '' || /[\s(（，。;；:：!！?？]/.test(previous)) {
            nodes.push(h('span', { key, className: 'nb-tag' }, token))
          } else {
            nodes.push(token)
          }
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
            const note =
              link !== null && typeof ctx.notePath === 'string' && ctx.notePath.length > 0
                ? markdownNoteLink(ctx.notePath, link[2], ctx.notes)
                : null
            if (note !== null) {
              nodes.push(
                h(
                  'span',
                  {
                    key,
                    className: 'nb-wiki',
                    onMouseDown: (event) => event.stopPropagation(),
                    onClick: (event) => {
                      event.stopPropagation()
                      if (typeof ctx.onOpen === 'function') ctx.onOpen(note.path)
                    },
                  },
                  link[1],
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
          }
        } else {
          nodes.push(h('em', { key }, token.slice(1, -1)))
        }
        last = match.index + token.length
      }
      if (last < text.length) nodes.push(text.slice(last))
      return nodes
    }

    /**
     * Pick the blocks an embed shows: the whole note, one `^id` block, or the
     * section under one heading. Pure so the anchor rules are testable.
     */
    function embedBlocksFor(parsed, anchor) {
      const list = Array.isArray(parsed) ? parsed : []
      if (anchor.startsWith('^')) {
        const found = list.find((block) => block.blockId === anchor.slice(1))
        return { blocks: found === undefined ? [] : [found], missing: found === undefined }
      }
      const levelOf = (block) => {
        const match = /^heading([1-3])$/.exec(String(block.type))
        return match === null ? 0 : Number(match[1])
      }
      if (anchor.length > 0) {
        const start = list.findIndex(
          (block) => levelOf(block) > 0 && String(block.text ?? '').trim() === anchor,
        )
        if (start >= 0) {
          const rank = levelOf(list[start])
          const section = [list[start]]
          for (let index = start + 1; index < list.length; index += 1) {
            const level = levelOf(list[index])
            if (level > 0 && level <= rank) break
            section.push(list[index])
          }
          return { blocks: section.slice(0, 40), missing: false }
        }
      }
      return { blocks: list.slice(0, 40), missing: false }
    }

    /** Read-only embed of another note inside a block, like Obsidian's `![[note]]`. */
    function EmbeddedNote({ name, notes, onOpen, t, depth }) {
      const labels = t ?? ((key) => key)
      const link = parseWikiLink(name)
      const [expanded, setExpanded] = React.useState(false)
      const [state, setState] = React.useState({ loading: true, content: '', error: '' })
      React.useEffect(() => {
        let cancelled = false
        const target = findWikiTarget(notes, link.name)
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

      const [blocks, missingAnchor] = React.useMemo(() => {
        if (state.content === '') return [[], false]
        const selection = embedBlocksFor(parseBlocks(splitFrontmatter(state.content).body), link.anchor)
        return [selection.blocks, selection.missing]
      }, [state.content, link.anchor])

      if (state.loading) return h('span', { className: 'nb-embed-loading' }, '…')
      if (state.error !== '') {
        return h(
          'span',
          { className: 'nb-embed-error', title: state.error === 'missing' ? '' : state.error },
          `![[${name}]]`,
        )
      }
      if (missingAnchor) {
        return h(
          'span',
          { className: 'nb-embed-error' },
          `![[${name}]] ${labels('embedAnchorMissing')}`,
        )
      }
      const anchored = link.anchor.length > 0
      const visible = anchored ? blocks : expanded ? blocks : blocks.slice(0, 12)
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
        anchored
          ? null
          : blocks.length > visible.length
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

    /** Whether a resolved CSS colour is dark, for the Mermaid theme. */
    function mermaidColorIsDark(color) {
      const value = String(color ?? '').trim()
      const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value)
      if (rgb !== null) {
        const r = Number(rgb[1])
        const g = Number(rgb[2])
        const b = Number(rgb[3])
        return (r * 299 + g * 587 + b * 114) / 1000 < 128
      }
      const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)
      if (hex !== null) {
        const raw = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1]
        const r = parseInt(raw.slice(0, 2), 16)
        const g = parseInt(raw.slice(2, 4), 16)
        const b = parseInt(raw.slice(4, 6), 16)
        return (r * 299 + g * 587 + b * 114) / 1000 < 128
      }
      return true
    }

    /** Mermaid theme variables derived from the DSH theme tokens. */
    function mermaidThemeVariables(styles) {
      const read = (name, fallback) => {
        try {
          const value = styles !== undefined && styles !== null ? String(styles.getPropertyValue(name) ?? '').trim() : ''
          return value.length > 0 ? value : fallback
        } catch {
          return fallback
        }
      }
      const paper = read('--dsw-alias-bg-base', '#1b1e27')
      const card = read('--dsw-alias-button-floating-fill', '#252934')
      const panel = read('--dsw-alias-bg-module-platform', '#20232d')
      const text = read('--dsw-alias-label-primary', '#e9ebf2')
      const muted = read('--dsw-alias-label-tertiary', '#8b93a7')
      const line = read('--dsw-alias-border-l2', '#3a3f4b')
      const accent = read('--dsw-alias-link', '#6b93f2')
      return {
        darkMode: mermaidColorIsDark(paper),
        fontFamily: "'Inter', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
        fontSize: '13px',
        background: 'transparent',
        primaryColor: card,
        primaryTextColor: text,
        primaryBorderColor: accent,
        secondaryColor: panel,
        secondaryTextColor: text,
        secondaryBorderColor: line,
        tertiaryColor: panel,
        tertiaryTextColor: muted,
        tertiaryBorderColor: line,
        lineColor: line,
        textColor: text,
        edgeLabelBackground: paper,
        labelBkg: paper,
        clusterBkg: 'transparent',
        clusterBorder: line,
        titleColor: text,
        actorBkg: card,
        actorBorder: accent,
        actorTextColor: text,
        actorLineColor: line,
        signalColor: line,
        signalTextColor: text,
        noteBkgColor: panel,
        noteTextColor: text,
        noteBorderColor: line,
        pie1: accent,
        pie2: '#e9973f',
        pie3: '#44cf6e',
        pie4: '#a882ff',
        git0: accent,
        git1: '#e9973f',
        git2: '#44cf6e',
        git3: '#a882ff',
        cScale0: accent,
        cScale1: '#e9973f',
        cScale2: '#44cf6e',
        cScale3: '#a882ff',
      }
    }

    function applyMermaidTheme(mermaid) {
      if (mermaid === undefined || mermaid === null) return
      let styles = null
      try {
        styles = window.getComputedStyle(document.documentElement)
      } catch {
        styles = null
      }
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        themeVariables: mermaidThemeVariables(styles),
        flowchart: { curve: 'basis', nodeSpacing: 40, rankSpacing: 56, padding: 14, htmlLabels: false },
        sequence: { mirrorActors: false, messageAlign: 'center', wrap: true },
        er: { useMaxWidth: true },
      })
    }

    // ---- Mermaid rendering (runtime script served by the Host) ----
    let mermaidRuntimePromise = null

    function loadMermaidRuntime() {
      if (typeof window !== 'undefined' && window.mermaid !== undefined) return Promise.resolve(window.mermaid)
      if (mermaidRuntimePromise !== null) return mermaidRuntimePromise
      mermaidRuntimePromise = new Promise((resolve, reject) => {
        if (typeof document === 'undefined') {
          reject(new Error('document is not available'))
          return
        }
        const script = document.createElement('script')
        script.src = '/notebook/vendor/mermaid.js'
        script.async = true
        script.onload = () => {
          if (window.mermaid === undefined) {
            reject(new Error('Mermaid runtime did not load'))
            return
          }
          try {
            applyMermaidTheme(window.mermaid)
          } catch {
            /* keep the runtime defaults */
          }
          resolve(window.mermaid)
        }
        script.onerror = () => reject(new Error('Mermaid runtime could not be loaded'))
        document.head.appendChild(script)
      })
      return mermaidRuntimePromise
    }

    function MermaidView({ code, t }) {
      const [state, setState] = React.useState({ status: 'loading', svg: '', error: '' })
      const [themeTick, setThemeTick] = React.useState(0)
      React.useEffect(() => {
        if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return undefined
        // DSH re-themes by changing attributes on the root element; re-render the
        // diagram so its colours follow light/dark switches.
        const observer = new MutationObserver(() => setThemeTick((value) => value + 1))
        observer.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['class', 'style', 'data-theme', 'data-color-scheme'],
        })
        return () => observer.disconnect()
      }, [])
      React.useEffect(() => {
        let disposed = false
        const renderId = `nb-mermaid-${Math.random().toString(36).slice(2, 10)}`
        loadMermaidRuntime()
          .then((mermaid) => {
            applyMermaidTheme(mermaid)
            return mermaid.render(renderId, String(code ?? ''))
          })
          .then((result) => {
            if (!disposed) setState({ status: 'ready', svg: String(result?.svg ?? ''), error: '' })
          })
          .catch((error) => {
            if (!disposed) setState({ status: 'error', svg: '', error: String(error?.message ?? error) })
          })
        return () => {
          disposed = true
        }
      }, [code, themeTick])
      if (state.status === 'loading') {
        return h(
          'div',
          { className: 'nb-mermaid-card' },
          h('div', { className: 'nb-mermaid-loading' }, t('mermaidLoading')),
        )
      }
      if (state.status === 'error') {
        return h(
          'div',
          { className: 'nb-mermaid-card' },
          h(
            'div',
            { className: 'nb-mermaid-head' },
            h('span', { className: 'nb-mermaid-icon', 'aria-hidden': 'true' }, '📈'),
            h('span', { className: 'nb-mermaid-title' }, t('mermaidTitle')),
          ),
          h(
            'details',
            { className: 'nb-mermaid-src' },
            h('summary', null, t('mermaidSource')),
            h('pre', { className: 'nb-mermaid-code' }, h('code', null, String(code ?? ''))),
          ),
          h('div', { className: 'nb-mermaid-hint' }, `${t('mermaidError')}：${state.error}`),
        )
      }
      return h('div', { className: 'nb-mermaid-render', dangerouslySetInnerHTML: { __html: state.svg } })
    }

    // ---- Obsidian Canvas (.canvas) rendering -------------------------------
    const CANVAS_COLORS = {
      '1': '#fb464c', '2': '#e9973f', '3': '#e0de71', '4': '#44cf6e', '5': '#53d4e8', '6': '#a882ff',
    }

    function canvasBounds(nodes) {
      const list = Array.isArray(nodes) ? nodes : []
      let minX = 0
      let minY = 0
      let maxX = 0
      let maxY = 0
      for (const node of list) {
        const x = Number(node?.x) || 0
        const y = Number(node?.y) || 0
        const width = Number(node?.width) || 220
        const height = Number(node?.height) || 80
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x + width)
        maxY = Math.max(maxY, y + height)
      }
      const padding = 80
      return {
        minX: minX - padding,
        minY: minY - padding,
        width: maxX - minX + padding * 2,
        height: maxY - minY + padding * 2,
      }
    }

    function CanvasView({ path, nodes, edges, loading, error, t, onOpen, onClose }) {
      const [zoom, setZoom] = React.useState(1)
      const list = Array.isArray(nodes) ? nodes : []
      const links = Array.isArray(edges) ? edges : []
      const bounds = canvasBounds(list)
      const byId = new Map(list.map((node) => [String(node.id), node]))
      const centerOf = (node) => ({ x: Number(node.x) + Number(node.width) / 2, y: Number(node.y) + Number(node.height) / 2 })
      if (loading) return h('div', { className: 'nb-canvas-loading' }, t('canvasLoading'))
      if (error !== undefined && error !== '') return h('div', { className: 'nb-canvas-loading' }, error)
      return h(
        'div',
        { className: 'nb-canvas-shell' },
        h(
          'div',
          { className: 'nb-canvas-head' },
          h('span', { className: 'nb-canvas-icon', 'aria-hidden': 'true' }, '🗺️'),
          h('span', { className: 'nb-canvas-name' }, String(path ?? '').split('/').pop().replace(/\.canvas$/i, '')),
          h('span', { className: 'nb-canvas-count' }, `${list.length} ${t('canvasNodes')} · ${links.length} ${t('canvasEdges')}`),
          h('span', { className: 'nb-canvas-badge' }, 'Obsidian Canvas'),
          h('button', { className: 'nb-canvas-close', onClick: onClose, title: t('close') }, '×'),
        ),
        h(
          'div',
          { className: 'nb-canvas-body' },
          list.length === 0
            ? h('div', { className: 'nb-canvas-empty' }, t('canvasEmpty'))
            : h(
                'div',
                {
                  className: 'nb-canvas-stage',
                  style: {
                    width: `${bounds.width}px`,
                    height: `${bounds.height}px`,
                    transform: `scale(${zoom})`,
                    transformOrigin: '0 0',
                  },
                },
                h(
                  'svg',
                  { className: 'nb-canvas-edges', width: bounds.width, height: bounds.height, 'aria-hidden': 'true' },
                  links.map((edge) => {
                    const from = byId.get(String(edge.fromNode))
                    const to = byId.get(String(edge.toNode))
                    if (from === undefined || to === undefined) return null
                    const a = centerOf(from)
                    const b = centerOf(to)
                    return h('line', {
                      key: String(edge.id ?? `${edge.fromNode}-${edge.toNode}`),
                      x1: a.x - bounds.minX,
                      y1: a.y - bounds.minY,
                      x2: b.x - bounds.minX,
                      y2: b.y - bounds.minY,
                      className: 'nb-canvas-edge',
                    })
                  }),
                ),
                list.map((node) => {
                  const color = CANVAS_COLORS[String(node.color ?? '')]
                  const isGroup = String(node.type) === 'group'
                  const style = {
                    left: `${(Number(node.x) || 0) - bounds.minX}px`,
                    top: `${(Number(node.y) || 0) - bounds.minY}px`,
                    width: `${Number(node.width) || 220}px`,
                    height: `${Number(node.height) || 80}px`,
                    ...(color !== undefined ? { borderColor: color } : {}),
                  }
                  const content = isGroup
                    ? h('span', { className: 'nb-canvas-group-label' }, String(node.label ?? ''))
                    : String(node.type) === 'file'
                      ? h(
                          'button',
                          {
                            className: 'nb-canvas-file',
                            onClick: (event) => {
                              event.stopPropagation()
                              if (typeof onOpen === 'function') onOpen(String(node.file ?? ''))
                            },
                          },
                          String(node.file ?? '').split('/').pop().replace(/\.md$/i, ''),
                        )
                      : String(node.type) === 'link'
                        ? h('span', { className: 'nb-canvas-link-text' }, String(node.url ?? ''))
                        : h('span', { className: 'nb-canvas-text' }, String(node.text ?? ''))
                  return h(
                    'div',
                    {
                      key: String(node.id),
                      className: `nb-canvas-node nb-canvas-node-${isGroup ? 'group' : String(node.type ?? 'text')}`,
                      style,
                      title: isGroup ? String(node.label ?? '') : undefined,
                    },
                    content,
                  )
                }),
              ),
        ),
        h(
          'div',
          { className: 'nb-canvas-tools' },
          h('button', { className: 'nb-canvas-tool', onClick: () => setZoom((value) => Math.min(2, Math.round((value + 0.1) * 10) / 10)) }, '+'),
          h('span', { className: 'nb-canvas-zoom' }, `${Math.round(zoom * 100)}%`),
          h('button', { className: 'nb-canvas-tool', onClick: () => setZoom((value) => Math.max(0.3, Math.round((value - 0.1) * 10) / 10)) }, '−'),
          h('span', { className: 'nb-canvas-hint' }, t('canvasHint')),
        ),
      )
    }

    // ---- Obsidian footnotes: `[^ref]` references and `[^ref]: text` definitions ----
    const FOOTNOTE_DEFINITION = /^\s*\[\^([^\]\s]+)\]:\s*([\s\S]*)$/

    function isFootnoteDefinition(block) {
      return block !== null && block !== undefined && block.type === 'paragraph' && FOOTNOTE_DEFINITION.test(String(block.text ?? ''))
    }

    function collectFootnotes(blocks) {
      const list = []
      for (const block of Array.isArray(blocks) ? blocks : []) {
        if (!isFootnoteDefinition(block)) continue
        const match = FOOTNOTE_DEFINITION.exec(String(block.text ?? ''))
        if (match !== null) list.push({ ref: match[1], text: match[2].trim() })
      }
      return list
    }

    function FootnoteList({ blocks, t }) {
      const notes = collectFootnotes(blocks)
      if (notes.length === 0) return null
      return h(
        'div',
        { className: 'nb-footnotes' },
        h('div', { className: 'nb-footnotes-title' }, t('footnotesTitle')),
        notes.map((note) =>
          h(
            'div',
            { key: note.ref, className: 'nb-footnote', id: `nb-fn-${note.ref}` },
            h('span', { className: 'nb-footnote-ref' }, note.ref),
            h('span', {
              className: 'nb-footnote-text',
              dangerouslySetInnerHTML: { __html: markdownToHtml(note.text) },
            }),
          ),
        ),
      )
    }

    // ---- Minimal LaTeX renderer for Obsidian-style $...$ / $$...$$ math ----
    const LATEX_SYMBOLS = {
      alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ',
      eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν',
      xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ',
      upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ',
      Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ',
      Omega: 'Ω', times: '×', cdot: '·', pm: '±', mp: '∓', div: '÷', le: '≤', leq: '≤', ge: '≥',
      geq: '≥', ne: '≠', neq: '≠', approx: '≈', equiv: '≡', sim: '∼', propto: '∝', infty: '∞',
      sum: '∑', prod: '∏', int: '∫', oint: '∮', partial: '∂', nabla: '∇', forall: '∀', exists: '∃',
      in: '∈', notin: '∉', subset: '⊂', supset: '⊃', cup: '∪', cap: '∩', subseteq: '⊆',
      supseteq: '⊇', emptyset: '∅', leftarrow: '←', rightarrow: '→', to: '→', gets: '←',
      Leftarrow: '⇐', Rightarrow: '⇒', leftrightarrow: '↔', Leftrightarrow: '⇔', uparrow: '↑',
      downarrow: '↓', ldots: '…', cdots: '⋯', prime: '′', angle: '∠', perp: '⊥', parallel: '∥',
      degree: '°', because: '∵', therefore: '∴', aa: 'Å', circ: '∘', bullet: '•', star: '⋆',
    }
    const LATEX_LIKE = /\\[a-zA-Z]+|\^|_|\{|\}|\\frac|\\sqrt/

    function renderLatexGroup(source, start) {
      let depth = 1
      let index = start
      while (index < source.length && depth > 0) {
        const char = source[index]
        if (char === '{') depth += 1
        else if (char === '}') depth -= 1
        if (depth === 0) break
        index += 1
      }
      return { content: source.slice(start, index), next: index + 1 }
    }

    function renderLatexInline(source) {
      const text = String(source ?? '')
      let out = ''
      let index = 0
      while (index < text.length) {
        const char = text[index]
        if (char === '\\') {
          const rest = text.slice(index + 1)
          const frac = /^frac\s*/.exec(rest)
          if (frac !== null) {
            const first = renderLatexGroup(text, index + 1 + frac[0].length + 1)
            const second = renderLatexGroup(text, first.next + 1)
            if (text[index + 1 + frac[0].length] === '{' && text[first.next] === '{') {
              out += `<span class="nb-math-frac"><span class="nb-math-num">${renderLatexInline(first.content)}</span><span class="nb-math-den">${renderLatexInline(second.content)}</span></span>`
              index = second.next
              continue
            }
          }
          const sqrt = /^sqrt\s*/.exec(rest)
          if (sqrt !== null && text[index + 1 + sqrt[0].length] === '{') {
            const group = renderLatexGroup(text, index + 1 + sqrt[0].length + 1)
            out += `<span class="nb-math-sqrt">√<span class="nb-math-radicand">${renderLatexInline(group.content)}</span></span>`
            index = group.next
            continue
          }
          const textCommand = /^text\s*/.exec(rest)
          if (textCommand !== null && text[index + 1 + textCommand[0].length] === '{') {
            const group = renderLatexGroup(text, index + 1 + textCommand[0].length + 1)
            out += escapeHtml(group.content)
            index = group.next
            continue
          }
          const command = /^([a-zA-Z]+)/.exec(rest)
          if (command !== null) {
            const name = command[1]
            if (LATEX_SYMBOLS[name] !== undefined) {
              out += LATEX_SYMBOLS[name]
            } else if (name === 'quad' || name === 'qquad') {
              out += '&nbsp;&nbsp;'
            } else {
              out += escapeHtml(name)
            }
            index += 1 + name.length
            continue
          }
          const escaped = /^[\\,;:! ]/.exec(rest)
          if (escaped !== null) {
            out += ' '
            index += 2
            continue
          }
          out += escapeHtml(rest[0] ?? '')
          index += 2
          continue
        }
        if (char === '^' || char === '_') {
          const tag = char === '^' ? 'sup' : 'sub'
          if (text[index + 1] === '{') {
            const group = renderLatexGroup(text, index + 2)
            out += `<${tag}>${renderLatexInline(group.content)}</${tag}>`
            index = group.next
            continue
          }
          out += `<${tag}>${renderLatexInline(text[index + 1] ?? '')}</${tag}>`
          index += 2
          continue
        }
        if (char === '{' || char === '}') {
          index += 1
          continue
        }
        out += escapeHtml(char)
        index += 1
      }
      return out
    }

    function renderLatexMath(source, block = false) {
      const math = String(source ?? '').replace(/^\$\$|\$\$$/g, '').replace(/^\$|\$$/g, '').trim()
      return `<span class="nb-math${block ? ' nb-math-block' : ''}">${renderLatexInline(math)}</span>`
    }

    /** The inline HTML subset Obsidian renders in reading mode. */
    const INLINE_HTML_TAGS = new Set([
      'a', 'abbr', 'audio', 'b', 'blockquote', 'br', 'center', 'code', 'del', 'details', 'div',
      'em', 'figcaption', 'figure', 'hr', 'i', 'iframe', 'img', 'ins', 'kbd', 'li', 'mark', 'ol',
      'p', 'pre', 's', 'small', 'source', 'span', 'strong', 'sub', 'summary', 'sup', 'table',
      'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul', 'video',
    ])
    const DANGEROUS_HTML_ATTR = /(^|\s)on[a-z]+\s*=|javascript:|vbscript:|data:text\/html/i

    function sanitizeHtmlBlock(text) {
      const tokens = []
      const withTokens = String(text ?? '').replace(
        /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*?)?)(\/?)>/g,
        (whole, closing, name, attrs, selfClose) => {
          const rendered = safeInlineHtmlTag(closing, name, attrs, selfClose)
          if (rendered === null) return whole
          const index = tokens.push(rendered) - 1
          return `\u0000${index}\u0000`
        },
      )
      let out = escapeHtml(withTokens)
      out = out.replace(/\u0000(\d+)\u0000/g, (whole, index) => tokens[Number(index)] ?? '')
      return out
    }

    function safeInlineHtmlTag(closing, name, attrs, selfClose) {
      const tag = String(name ?? '').toLowerCase()
      if (!INLINE_HTML_TAGS.has(tag)) return null
      if (DANGEROUS_HTML_ATTR.test(String(attrs ?? ''))) return null
      if (tag === 'iframe') {
        const src = /src\s*=\s*["']([^"']*)["']/i.exec(String(attrs ?? ''))
        if (src === null || !/^https?:\/\//i.test(src[1])) return null
      }
      return `<${closing}${tag}${attrs ?? ''}${selfClose}>`
    }

    /** Markdown block subset for one column of a `> [!col]` callout. */
    function columnToHtml(source) {
      const lines = String(source ?? '').split(/\r?\n/)
      const html = []
      let listTag = null
      let listItems = []
      let paragraph = []
      const flushList = () => {
        if (listTag === null) return
        html.push(`<${listTag}>${listItems.join('')}</${listTag}>`)
        listTag = null
        listItems = []
      }
      const flushParagraph = () => {
        if (paragraph.length === 0) return
        html.push(`<p>${markdownToHtml(paragraph.join(' '))}</p>`)
        paragraph = []
      }
      for (const raw of lines) {
        const line = raw.trim()
        const heading = /^(#{1,6})\s+(.*)$/.exec(line)
        if (heading !== null) {
          flushList()
          flushParagraph()
          const level = Math.min(heading[1].length, 4)
          html.push(`<h${level}>${markdownToHtml(heading[2])}</h${level}>`)
          continue
        }
        const bullet = /^[-*+]\s+(.*)$/.exec(line)
        if (bullet !== null) {
          flushParagraph()
          if (listTag !== 'ul') {
            flushList()
            listTag = 'ul'
          }
          listItems.push(`<li>${markdownToHtml(bullet[1])}</li>`)
          continue
        }
        const numbered = /^\d+[.)]\s+(.*)$/.exec(line)
        if (numbered !== null) {
          flushParagraph()
          if (listTag !== 'ol') {
            flushList()
            listTag = 'ol'
          }
          listItems.push(`<li>${markdownToHtml(numbered[1])}</li>`)
          continue
        }
        if (line.length === 0) {
          flushList()
          flushParagraph()
          continue
        }
        flushList()
        paragraph.push(line)
      }
      flushList()
      flushParagraph()
      return html.join('')
    }

    function markdownToHtml(text) {
      const source = String(text ?? '')
      // Preserve a safe subset of inline HTML; everything else stays escaped.
      const htmlTokens = []
      const withHtml = source.replace(
        /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*?)?)(\/?)>/g,
        (whole, closing, name, attrs, selfClose) => {
          const rendered = safeInlineHtmlTag(closing, name, attrs, selfClose)
          if (rendered === null) return whole
          const index = htmlTokens.push(rendered) - 1
          return `\u0000${index}\u0000`
        },
      )
      const pattern =
        /(`[^`\n]+`)|(\$\$[^$\n]+\$\$)|(\$[^$\n]+\$)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(~~[^~\n]+~~)|(==[^=\n]+==)|(%%.*?%%)|(\[\[[^\]\n]+\]\])|(\[[^\]\n]+\]\([^)\n]+\))|(\[\^[^\]\n]+\])|(#([\w\u4e00-\u9fa5][\w\u4e00-\u9fa5/-]*))|(\*[^*\n]+\*)|(_[^_\n]+_)/g
      let out = ''
      let last = 0
      let match
      while ((match = pattern.exec(withHtml)) !== null) {
        if (match.index > last) out += escapeHtml(withHtml.slice(last, match.index))
        const token = match[0]
        if (token.startsWith('`')) {
          out += `<code>${escapeHtml(token.slice(1, -1))}</code>`
        } else if (token.startsWith('$$')) {
          out += renderLatexMath(token, true)
        } else if (token.startsWith('$')) {
          const inner = token.slice(1, -1)
          out += LATEX_LIKE.test(inner) ? renderLatexMath(token, false) : escapeHtml(token)
        } else if (token.startsWith('**') || token.startsWith('__')) {
          out += `<strong>${escapeHtml(token.slice(2, -2))}</strong>`
        } else if (token.startsWith('~~')) {
          out += `<del>${escapeHtml(token.slice(2, -2))}</del>`
        } else if (token.startsWith('==')) {
          out += `<mark>${escapeHtml(token.slice(2, -2))}</mark>`
        } else if (token.startsWith('%%')) {
          /* Obsidian comments are hidden in reading mode */
        } else if (token.startsWith('[[')) {
          out += `<span class="nb-wiki">${escapeHtml(token.slice(2, -2))}</span>`
        } else if (token.startsWith('[^')) {
          const ref = token.slice(2, -1)
          out += `<sup class="nb-footnote-ref" data-ref="${escapeHtml(ref)}">${escapeHtml(ref)}</sup>`
        } else if (token.startsWith('[')) {
          const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
          const href = link === null ? undefined : safeHref(link[2])
          if (link === null || href === undefined) out += escapeHtml(token)
          else out += `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener">${escapeHtml(link[1])}</a>`
        } else if (token.startsWith('#')) {
          const previous = match.index === 0 ? '' : withHtml[match.index - 1]
          if (previous === '' || /[\s(（，。;；:：!！?？]/.test(previous)) {
            out += `<span class="nb-tag">${escapeHtml(token)}</span>`
          } else {
            out += escapeHtml(token)
          }
        } else {
          out += `<em>${escapeHtml(token.slice(1, -1))}</em>`
        }
        last = match.index + token.length
      }
      if (last < withHtml.length) out += escapeHtml(withHtml.slice(last))
      out = out.replace(/\u0000(\d+)\u0000/g, (whole, index) => htmlTokens[Number(index)] ?? '')
      return out
    }

    /**
     * Render a model's Markdown answer as read-only HTML: block structure from
     * the same parser the editor uses, inline formatting from markdownToHtml
     * (escaped text, http(s)/mailto links only). Used by the ask panel.
     */
    function answerHtml(text) {
      const blocks = parseBlocks(String(text ?? ''))
      const html = []
      let list = null
      const flush = () => {
        if (list === null) return
        html.push(`<${list.tag}>${list.items.join('')}</${list.tag}>`)
        list = null
      }
      for (const block of blocks) {
        const inline = markdownToHtml(block.text ?? '')
        if (block.type === 'bullet' || block.type === 'numbered' || block.type === 'todo') {
          const tag = block.type === 'numbered' ? 'ol' : 'ul'
          if (list === null || list.tag !== tag) {
            flush()
            list = { tag, items: [] }
          }
          if (block.type === 'todo') {
            list.items.push(
              `<li class="todo${block.checked === true ? ' done' : ''}"><span class="box"></span>${inline}</li>`,
            )
          } else {
            list.items.push(`<li>${inline}</li>`)
          }
          continue
        }
        flush()
        if (block.type === 'heading1') html.push(`<h3>${inline}</h3>`)
        else if (block.type === 'heading2') html.push(`<h4>${inline}</h4>`)
        else if (block.type === 'heading3') html.push(`<h5>${inline}</h5>`)
        else if (block.type === 'code') html.push(`<pre><code>${escapeHtml(block.text)}</code></pre>`)
        else if (block.type === 'quote') html.push(`<blockquote>${inline}</blockquote>`)
        else if (block.type === 'divider') html.push('<hr>')
        else if (block.type === 'table') {
          const rows = Array.isArray(block.rows) ? block.rows : []
          const head = rows[0] ?? []
          const body = rows.slice(1)
          const row = (cells, tag) => `<tr>${cells.map((cell) => `<${tag}>${markdownToHtml(cell)}</${tag}>`).join('')}</tr>`
          html.push(`<table><thead>${row(head, 'th')}</thead><tbody>${body.map((line) => row(line, 'td')).join('')}</tbody></table>`)
        } else html.push(`<p>${inline}</p>`)
      }
      flush()
      // Citations become clickable: [[note]] spans and bare vault `.md` paths
      // inside inline code carry the raw target in data-note.
      return html
        .join('')
        .replace(
          /<span class="nb-wiki">([^<]*)<\/span>/g,
          '<a href="#" class="nb-ask-note" data-note="$1">$1</a>',
        )
        .replace(
          /(?<!<pre>)<code>([^<>]+\.md)<\/code>/g,
          (match, path) => `<a href="#" class="nb-ask-note" data-note="${path}"><code>${path}</code></a>`,
        )
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
     * Language-aware highlighting for displayed code blocks. Each language
     * compiles one alternation of named groups (order is priority), so a single
     * pass finds comments, strings, numbers and that language's own vocabulary.
     * Unknown named languages fall back to the generic tokenizer; plain text
     * ('', text, txt) stays untouched.
     */
    const CODE_SPECS = {
      js: [
        ['comment', /\/\/[^\n]*|\/\*[\s\S]*?\*\//],
        ['string', /'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/],
        ['number', /\b(?:0[xX][0-9a-fA-F]+|0[bB][01]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/],
        ['bool', /\b(?:true|false|null|undefined|NaN|Infinity)\b/],
        ['keyword', /\b(?:async|await|break|case|catch|class|const|continue|debugger|declare|default|delete|do|else|enum|export|extends|finally|for|from|function|if|implements|import|in|infer|instanceof|interface|keyof|let|namespace|never|new|of|private|protected|public|readonly|return|satisfies|static|super|switch|this|throw|try|type|typeof|unknown|var|void|while|with|yield)\b/],
        ['func', /\b[A-Za-z_$][\w$]*(?=\s*\()/],
        ['type', /\b(?:Array|Promise|Map|Set|Date|RegExp|Error|string|number|boolean|object|symbol|bigint|any|void|unknown|never)\b|\b[A-Z][A-Za-z0-9_$]*\b/],
      ],
      py: [
        ['comment', /#[^\n]*/],
        ['string', /"""[\s\S]*?"""|'''[\s\S]*?'''|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/],
        ['decorator', /@[\w.]+/],
        ['number', /\b(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?)\b/],
        ['bool', /\b(?:True|False|None)\b/],
        ['keyword', /\b(?:and|as|assert|async|await|break|case|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|match|nonlocal|not|or|pass|raise|return|self|try|while|with|yield)\b/],
        ['func', /\b[A-Za-z_]\w*(?=\s*\()/],
        ['type', /\b(?:int|str|float|bool|list|dict|set|tuple|bytes|object)\b/],
      ],
      sh: [
        ['comment', /#[^\n]*/],
        ['string', /'[^']*'|"(?:\\.|[^"\\])*"/],
        ['var', /\$\{[^}\n]*\}|\$[A-Za-z_]\w*|\$[0-9@#?*!$-]/],
        ['keyword', /\b(?:break|case|continue|declare|do|done|elif|else|esac|eval|exec|exit|export|fi|for|function|if|in|local|readonly|return|select|set|shift|source|then|time|trap|unset|until|while|true|false)\b/],
        ['number', /\b\d+(?:\.\d+)?\b/],
        ['func', /\b[A-Za-z_][\w-]*(?=\s*\()/],
      ],
      json: [
        ['comment', /\/\/[^\n]*|\/\*[\s\S]*?\*\//],
        ['prop', /"(?:\\.|[^"\\])*"(?=\s*:)/],
        ['string', /"(?:\\.|[^"\\])*"/],
        ['number', /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/],
        ['bool', /\b(?:true|false|null)\b/],
      ],
      yaml: [
        ['comment', /#[^\n]*/],
        ['prop', /^[ \t]*(?:-[ \t]+)?[\w.-]+(?=[ \t]*:)/],
        ['meta', /[&*][\w-]+|!![\w:/.-]+/],
        ['string', /'(?:''|[^'\n])*'|"(?:\\.|[^"\\\n])*"/],
        ['number', /\b\d+(?:\.\d+)?\b/],
        ['bool', /\b(?:true|false|null|yes|no|on|off|~)\b/],
      ],
      ini: [
        ['comment', /[#;][^\n]*/],
        ['section', /^[ \t]*\[[^\]\n]+\]/],
        ['prop', /^[ \t]*[A-Za-z_][\w.-]*(?:\[[^\]\n]*\])*(?=[ \t]*=)/],
        ['string', /"(?:\\.|[^"\\\n])*"|'[^'\n]*'/],
        ['bool', /\b(?:true|false|yes|no|on|off)\b/],
        ['number', /\b\d+(?:\.\d+)?\b/],
      ],
      toml: [
        ['comment', /#[^\n]*/],
        ['section', /^[ \t]*\[\[?[^\]\n]+\]\]?/],
        ['prop', /^[ \t]*(?:"[^"\n]+"|'[^'\n]+'|[A-Za-z_][\w.-]*)(?:\[[^\]\n]*\])*(?=[ \t]*=)/],
        ['string', /"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'[^'\n]*'/],
        ['bool', /\b(?:true|false)\b/],
        ['number', /\b\d+(?:\.\d+)?\b/],
      ],
      desktop: [
        ['comment', /#[^\n]*/],
        ['section', /^[ \t]*\[[^\]\n]+\]/],
        ['prop', /^[ \t]*[A-Za-z_][\w.-]*(?:\[[^\]\n]*\])*(?=[ \t]*=)/],
        ['string', /"(?:\\.|[^"\\\n])*"/],
        ['bool', /\b(?:true|false)\b/],
        ['number', /\b\d+(?:\.\d+)?\b/],
      ],
      html: [
        ['comment', /<!--[\s\S]*?-->/],
        ['tag', /<\/?[A-Za-z][\w:-]*/],
        ['attr', /\b[A-Za-z_:][\w:.-]*(?=[ \t]*=)/],
        ['string', /"(?:\\.|[^"\\])*"|'[^']*'/],
        ['entity', /&[#\w]+;/],
      ],
      css: [
        ['comment', /\/\*[\s\S]*?\*\//],
        ['atrule', /@[\w-]+/],
        ['prop', /[-\w]+(?=[ \t]*:)/],
        ['number', /#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|vmin|vmax|s|ms|deg|fr)?\b/],
        ['string', /"(?:\\.|[^"\\\n])*"|'[^'\n]*'/],
      ],
      sql: [
        ['comment', /--[^\n]*|\/\*[\s\S]*?\*\//],
        ['string', /'(?:''|[^'\n])*'/],
        ['bool', /\b(?:null|true|false)\b/],
        ['keyword', /\b(?:add|all|alter|and|as|asc|between|by|case|column|create|delete|desc|distinct|drop|else|end|exists|from|full|group|having|if|in|index|inner|insert|into|is|join|left|like|limit|not|offset|on|or|order|outer|primary|references|right|select|set|table|then|union|unique|update|values|view|when|where|with)\b/],
        ['func', /\b[A-Za-z_]\w*(?=\s*\()/],
        ['number', /\b\d+(?:\.\d+)?\b/],
      ],
      c: [
        ['comment', /\/\/[^\n]*|\/\*[\s\S]*?\*\//],
        ['meta', /^[ \t]*#[ \t]*\w+/],
        ['string', /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/],
        ['number', /\b(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?[fFuUlL]*)\b/],
        ['bool', /\b(?:true|false|null|NULL|nil|None)\b/],
        ['keyword', /\b(?:abstract|as|async|await|auto|break|case|catch|chan|char|class|const|continue|defer|default|delete|do|double|dyn|else|enum|extern|final|finally|float|fn|for|func|go|goto|if|impl|implements|import|in|inline|int|interface|is|let|long|loop|map|match|mod|move|mut|namespace|new|operator|override|package|private|protected|pub|public|range|register|restrict|return|select|self|short|signed|sizeof|static|struct|super|switch|template|throw|trait|try|type|typedef|typename|union|unsigned|use|using|var|virtual|void|volatile|where|while|yield)\b/],
        ['func', /\b[A-Za-z_]\w*(?=\s*\()/],
        ['type', /\b(?:bool|byte|char|double|float|i8|i16|i32|i64|int|int8|int16|int32|int64|isize|rune|size_t|string|String|u8|u16|u32|u64|uint|uint8|uint16|uint32|uint64|usize|f32|f64)\b/],
      ],
      markdown: [
        ['comment', /<!--[\s\S]*?-->/],
        ['heading', /^#{1,6}[ \t].*$/],
        ['string', /`[^`\n]+`/],
        ['keyword', /\*\*[^*\n]+\*\*|__[^_\n]+__/],
        ['prop', /\[[^\]\n]*\]\([^)\n]*\)/],
      ],
      dockerfile: [
        ['comment', /#[^\n]*/],
        ['keyword', /^[ \t]*(?:FROM|RUN|CMD|LABEL|MAINTAINER|EXPOSE|ENV|ADD|COPY|ENTRYPOINT|VOLUME|USER|WORKDIR|ARG|ONBUILD|STOPSIGNAL|HEALTHCHECK|SHELL)\b/],
        ['string', /"(?:\\.|[^"\\\n])*"|'[^'\n]*'/],
        ['var', /\$\{[^}\n]*\}|\$[A-Za-z_]\w*/],
        ['number', /\b\d+\b/],
      ],
      generic: [
        ['comment', /\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*/],
        ['string', /'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/],
        ['number', /\b(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?)\b/],
        ['keyword', /\b(?:and|as|async|await|break|case|catch|class|const|continue|def|default|do|elif|else|enum|export|false|fn|for|from|func|function|if|impl|import|in|instanceof|interface|is|lambda|let|match|mod|new|nil|None|not|null|or|package|pass|private|public|pub|return|self|static|struct|switch|throw|true|try|type|typeof|undefined|use|var|void|while|with)\b/],
      ],
    }

    const CODE_LANG_ALIASES = {
      javascript: 'js', js: 'js', jsx: 'js', mjs: 'js', cjs: 'js',
      typescript: 'js', ts: 'js', tsx: 'js',
      python: 'py', py: 'py',
      bash: 'sh', sh: 'sh', zsh: 'sh', shell: 'sh', console: 'sh', terminal: 'sh',
      json: 'json', jsonc: 'json',
      yaml: 'yaml', yml: 'yaml',
      ini: 'ini', conf: 'ini', cfg: 'ini', properties: 'ini', env: 'ini',
      toml: 'toml', desktop: 'desktop',
      html: 'html', xml: 'html', svg: 'html', vue: 'html',
      css: 'css', scss: 'css', less: 'css',
      sql: 'sql',
      c: 'c', h: 'c', cpp: 'c', 'c++': 'c', cc: 'c', hpp: 'c', objc: 'c',
      go: 'c', golang: 'c', rust: 'c', rs: 'c', java: 'c', kotlin: 'c', kt: 'c',
      csharp: 'c', 'c#': 'c', swift: 'c',
      markdown: 'markdown', md: 'markdown',
      dockerfile: 'dockerfile', docker: 'dockerfile',
    }
    const CODE_PLAIN = new Set(['', 'text', 'txt', 'plain', 'plaintext'])
    const CODE_COMPILED = new Map()

    function compiledCodePattern(key) {
      const cached = CODE_COMPILED.get(key)
      if (cached !== undefined) return cached
      const spec = CODE_SPECS[key] ?? CODE_SPECS.generic
      const names = []
      const parts = spec.map(([name, pattern], index) => {
        names.push(name)
        return `(?<t${index}>${pattern.source})`
      })
      const flags = key === 'sql' ? 'gmi' : 'gm'
      const compiled = { regex: new RegExp(parts.join('|'), flags), names }
      CODE_COMPILED.set(key, compiled)
      return compiled
    }

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

    function highlightCode(text, lang) {
      const source = String(text ?? '')
      const explicit = lang !== undefined
      const name = String(lang ?? '').trim().toLowerCase()
      // The old no-language call still tokenizes generically; an explicit
      // lang="" or "text" fence stays plain.
      if (explicit && CODE_PLAIN.has(name)) return [source]
      // A named language we do not know stays plain: guessing colours on an
      // unknown fence is worse than leaving the text alone.
      const key = explicit
        ? CODE_LANG_ALIASES[name] ?? (CODE_SPECS[name] !== undefined ? name : 'plain')
        : 'generic'
      if (key === 'plain') return [source]
      const compiled = compiledCodePattern(key)
      const nodes = []
      let last = 0
      let count = 0
      for (const match of source.matchAll(compiled.regex)) {
        if (match.index > last) nodes.push(source.slice(last, match.index))
        const groups = match.groups ?? {}
        let className = 'c-keyword'
        for (let index = 0; index < compiled.names.length; index += 1) {
          if (groups[`t${index}`] !== undefined) {
            className = `c-${compiled.names[index]}`
            break
          }
        }
        nodes.push(h('span', { key: `c${count++}`, className }, match[0]))
        last = match.index + match[0].length
      }
      if (last < source.length) nodes.push(source.slice(last))
      return nodes
    }

    /* ---------------- components ---------------- */

    // ---------------------------------------------------------------------
    // Conversation tool cards
    //
    // The agent's notebook tools run in the Host; these rows are their face in
    // the chat: which note was read or written, in which mode, and a direct
    // jump into the workbench. Clicking "Open" stores the path in NOTE_OPEN,
    // switches the main panel, and the workbench consumes it on mount (or
    // immediately while it is already mounted).
    // ---------------------------------------------------------------------

    const CHAT_TOOL_CSS = `
.nb-chat-action { border: none; background: transparent; color: inherit; cursor: pointer; font-size: 13px; line-height: 1; padding: 2px 5px; border-radius: 4px; opacity: .75; }
.nb-chat-action:hover { opacity: 1; background: color-mix(in srgb, currentColor 12%, transparent); }
.nb-chat-action.is-done { color: var(--dsw-alias-state-success-primary, #1a7f4b); }
.nb-chat-action.is-warn { color: var(--dsw-alias-state-warn-primary, #b45309); }

.nb-chat-tool { display: flex; flex-direction: column; min-width: 0; }
.nb-chat-tool-row {
  display: flex; align-items: center; gap: 6px; min-width: 0;
  min-height: 24px; padding: 0 6px; border-radius: 6px;
  color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 24px;
}
.nb-chat-tool-row[role="button"] { cursor: pointer; }
.nb-chat-tool-row[role="button"]:hover { color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, .05)); }
.nb-chat-tool-row[role="button"]:focus-visible { outline: 2px solid var(--dsw-alias-link); outline-offset: 1px; }
.nb-chat-tool-leading { display: inline-flex; width: 16px; height: 16px; align-items: center; justify-content: center; flex: none; }
.nb-chat-tool-title { flex: none; }
.nb-chat-tool-sep { width: 2px; height: 2px; flex: none; border-radius: 1px; background: currentColor; opacity: .55; }
.nb-chat-tool-summary {
  min-width: 0; flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
}
.nb-chat-tool-suffix {
  flex: none; font-size: 11px; line-height: 16px; padding: 0 6px; border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, .06));
  color: var(--dsw-alias-label-tertiary);
}
.nb-chat-tool[data-state="error"] .nb-chat-tool-suffix { color: var(--dsw-alias-state-error-primary); }
.nb-chat-tool-open {
  flex: none; margin-left: auto; padding: 0 8px; border-radius: 999px;
  border: .5px solid var(--dsw-alias-border-l2); background: transparent;
  color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 16px; cursor: pointer;
}
.nb-chat-tool-open:hover { background: var(--dsw-alias-interactive-bg-hover-solid, rgba(38, 49, 72, .08)); color: var(--dsw-alias-label-primary); }
.nb-chat-tool-results { display: flex; flex-direction: column; margin: 2px 0 4px 22px; border: .5px solid var(--dsw-alias-border-l1); border-radius: 8px; overflow: hidden; }
.nb-chat-tool-result { display: flex; align-items: baseline; gap: 8px; width: 100%; padding: 4px 10px; border: none; border-top: .5px solid var(--dsw-alias-border-l1); background: transparent; color: var(--dsw-alias-label-secondary); font-size: 12px; text-align: left; cursor: pointer; }
.nb-chat-tool-result:first-child { border-top: none; }
.nb-chat-tool-result:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, .05)); }
.nb-chat-tool-result-path { flex: none; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.nb-chat-tool-result-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nb-chat-tool-body {
  margin: 2px 0 4px 22px; padding: 8px 10px; max-height: 190px; overflow: auto;
  border: .5px solid var(--dsw-alias-border-l1); border-radius: 8px;
  background: var(--dsw-alias-markdown-code-block, var(--dsw-alias-bg-module-platform));
  color: var(--dsw-alias-label-secondary);
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word;
}

.nb-cite-pop { position: fixed; z-index: 10000; width: min(440px, calc(100vw - 16px)); height: min(58vh, 430px); display: flex; flex-direction: column; background: var(--dsw-alias-bg-module-platform, #fff); border: .5px solid var(--dsw-alias-border-l2); border-radius: 10px; box-shadow: 0 18px 48px rgba(16, 24, 40, .2), 0 2px 8px rgba(16, 24, 40, .08); overflow: hidden; }
.nb-cite-head { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 8px 8px 12px; font-size: 12.5px; font-weight: 600; color: var(--dsw-alias-label-primary); border-bottom: .5px solid var(--dsw-alias-border-l1); }
.nb-cite-search { flex: 0 0 auto; height: 34px; box-sizing: border-box; border: none; border-bottom: .5px solid var(--dsw-alias-border-l1); background: transparent; color: var(--dsw-alias-label-primary); padding: 0 12px; font-size: 13px; outline: none; }
.nb-cite-list { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 6px; display: flex; flex-direction: column; gap: 1px; }
.nb-cite-row { display: flex; align-items: center; gap: 9px; padding: 6px 8px; border-radius: 6px; cursor: pointer; }
.nb-cite-row:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, .06)); }
.nb-cite-row.on { background: var(--dsw-alias-interactive-bg-selected, rgba(47, 111, 235, .1)); }
.nb-cite-main { display: flex; flex-direction: column; min-width: 0; flex: 1 1 auto; }
.nb-cite-name { font-size: 12.5px; color: var(--dsw-alias-label-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nb-cite-path { font-size: 11px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nb-cite-foot { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-top: .5px solid var(--dsw-alias-border-l1); }
.nb-cite-count { margin-right: auto; font-size: 11.5px; color: var(--dsw-alias-label-tertiary); }
.nb-cite-empty { padding: 22px 12px; text-align: center; font-size: 12px; color: var(--dsw-alias-label-tertiary); line-height: 1.7; }
.nb-cite-close { width: 24px; height: 24px; border: none; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-tertiary); font-size: 15px; line-height: 1; cursor: pointer; }
.nb-cite-close:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, .06)); color: var(--dsw-alias-label-secondary); }
.nb-cite-btn { height: 28px; padding: 0 12px; border: .5px solid var(--dsw-alias-border-l2); border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary); font-size: 12.5px; cursor: pointer; }
.nb-cite-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, .06)); }
.nb-cite-btn-primary { border-color: transparent; background: var(--dsw-alias-brand-primary, #111); color: #fff; }
.nb-cite-btn-primary:hover { background: var(--dsw-alias-brand-primary, #111); opacity: .9; }
.nb-cite-btn:disabled { opacity: .45; cursor: default; }

/* Composer notebook button + its body-level menu */
.nb-composer-btn { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border: none; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; }
.nb-composer-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, .06)); color: var(--dsw-alias-label-secondary); }
.nb-composer-btn:focus-visible { outline: 2px solid var(--dsw-alias-link); outline-offset: 1px; }
.nb-composer-menu { position: fixed; z-index: 10000; min-width: 168px; padding: 4px; border-radius: 8px; border: .5px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-module-platform, #fff); box-shadow: 0 8px 28px rgba(0, 0, 0, .16); }
.nb-composer-menu-item { display: flex; align-items: center; width: 100%; padding: 6px 10px; border: none; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary); font-size: 13px; text-align: left; cursor: pointer; }
.nb-composer-menu-item:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, .06)); }

/* Settings → General row for the vault folder */
.nb-set-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 10px 0; }
.nb-set-main { min-width: 0; flex: 1 1 260px; }
.nb-set-title { font-size: 13px; color: var(--dsw-alias-label-primary); }
.nb-set-sub { margin-top: 2px; font-size: 12px; color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }
.nb-set-hint { margin-top: 2px; font-size: 11.5px; color: var(--dsw-alias-label-caption, var(--dsw-alias-label-tertiary)); }
.nb-set-actions { display: flex; flex: none; gap: 8px; }
.nb-set-btn { height: 28px; padding: 0 12px; border-radius: 6px; border: .5px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: 12px; cursor: pointer; }
.nb-set-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, .06)); }
.nb-set-btn:disabled { opacity: .5; cursor: default; }
.nb-set-error { flex: 1 1 100%; color: var(--dsw-alias-state-error-primary); font-size: 12px; }
`

    /** Cross-component mailbox: chat tool card → workbench. */
    const NOTE_OPEN = { pending: null, listeners: new Set() }

    /** A directory is visible only when every ancestor folder is expanded. */
    function directoryOpen(dir, expanded) {
      if (dir.length === 0) return true
      const parts = dir.split('/')
      let prefix = ''
      for (let index = 0; index < parts.length - 1; index += 1) {
        prefix = prefix.length === 0 ? parts[index] : `${prefix}/${parts[index]}`
        if (expanded[prefix] !== true) return false
      }
      return true
    }

    /** Expand `dir` and all of its ancestors (returns the next state). */
    function expandedPath(expanded, dir) {
      const next = { ...expanded }
      if (dir.length === 0) return next
      const parts = dir.split('/')
      let prefix = ''
      for (const part of parts) {
        prefix = prefix.length === 0 ? part : `${prefix}/${part}`
        next[prefix] = true
      }
      return next
    }

    /**
     * A folder's home note is `<dir>/<folder name>.md`. Folders usually carry an
     * ordering prefix ("01 工作"), so the prefix is stripped as a fallback: both
     * `01 工作.md` and `工作.md` count, and `index.md` is the last resort.
     */
    function folderHomeBase(dir) {
      const name = dir.split('/').pop()
      const stripped = name.replace(/^\d+[\s._-]+/, '').trim()
      return stripped.length > 0 ? stripped : name
    }

    function folderHomePath(dir) {
      if (typeof dir !== 'string' || dir.length === 0) return null
      const name = folderHomeBase(dir)
      return name.length === 0 ? null : `${dir}/${name}.md`
    }

    function folderHomes(notes) {
      const byDir = new Map()
      for (const note of Array.isArray(notes) ? notes : []) {
        const path = String(note.path ?? '')
        const slash = path.lastIndexOf('/')
        if (slash <= 0) continue
        const dir = path.slice(0, slash)
        const base = path.slice(slash + 1).replace(/\.md$/i, '').toLowerCase()
        if (!byDir.has(dir)) byDir.set(dir, new Map())
        if (!byDir.get(dir).has(base)) byDir.get(dir).set(base, path)
      }
      const map = new Map()
      for (const [dir, files] of byDir) {
        const full = dir.split('/').pop().toLowerCase()
        const candidates = [full, folderHomeBase(dir).toLowerCase(), 'index']
        for (const name of candidates) {
          const hit = files.get(name)
          if (hit !== undefined) {
            map.set(dir, hit)
            break
          }
        }
      }
      return map
    }

    /** A search hit asks the note view to scroll to the matching block. */
    const SEARCH_JUMP = { pending: null }

    /** Normalize a matched source line into text the rendered block contains. */
    function jumpNeedle(text) {
      const raw = String(text ?? '')
        .replace(/^\s+/, '')
        .replace(/^(?:[>#*+\-]+\s*|\d+[.)]\s*)+/, '')
        .replace(/^\[[ xX]\]\s*/, '')
        .replace(/[`*_~]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
      return raw.slice(0, 28)
    }
    /** Set when the Settings row switched the vault while the panel was closed. */
    const VAULT_CHANGED = { pending: false }
    /** Ask threads survive the workbench unmounting when the main panel changes. */
    const ASK_THREADS = new Map()
    const ASK_THREAD_LIMIT = 40

    function rememberAskThread(key, thread) {
      ASK_THREADS.delete(key)
      ASK_THREADS.set(key, thread)
      while (ASK_THREADS.size > ASK_THREAD_LIMIT) {
        const oldest = ASK_THREADS.keys().next()
        if (oldest.done === true) break
        ASK_THREADS.delete(oldest.value)
      }
    }
    /** Cross-component mailbox: a shortcut asks the open workbench to toggle ask. */
    const ASK_TOGGLE = { listeners: new Set() }

    /** Cross-component mailbox: open the ask panel (composer menu → workbench). */
    const ASK_OPEN = { pending: false, listeners: new Set() }

    function requestAskOpen() {
      ASK_OPEN.pending = true
      for (const listener of [...ASK_OPEN.listeners]) {
        try {
          listener()
        } catch {
          /* a stale listener must not break the menu */
        }
      }
      if (ASK_OPEN.listeners.size > 0) ASK_OPEN.pending = false
    }

    function takePendingAskOpen() {
      const pending = ASK_OPEN.pending
      ASK_OPEN.pending = false
      return pending
    }

    /** Cross-component mailbox: a shortcut asks the open workbench for a capture box. */
    const FLASH_CAPTURE = { pending: false, listeners: new Set() }

    function requestFlashCapture() {
      FLASH_CAPTURE.pending = true
      for (const listener of [...FLASH_CAPTURE.listeners]) {
        try {
          listener()
        } catch {
          /* a stale listener must not break the shortcut */
        }
      }
      if (FLASH_CAPTURE.listeners.size > 0) FLASH_CAPTURE.pending = false
    }

    function takePendingFlashCapture() {
      const pending = FLASH_CAPTURE.pending
      FLASH_CAPTURE.pending = false
      return pending
    }

    function requestAskToggle() {
      for (const listener of [...ASK_TOGGLE.listeners]) {
        try {
          listener()
        } catch {
          /* a stale listener must not break the shortcut */
        }
      }
    }

    function requestNoteOpen(path, options) {
      const request = { path, history: options?.history === true }
      NOTE_OPEN.pending = request
      let delivered = false
      for (const listener of [...NOTE_OPEN.listeners]) {
        try {
          listener(request)
          delivered = true
        } catch {
          /* a stale listener must not break the click */
        }
      }
      if (delivered) NOTE_OPEN.pending = null
    }

    function subscribeNoteOpen(listener) {
      NOTE_OPEN.listeners.add(listener)
      return () => NOTE_OPEN.listeners.delete(listener)
    }

    function takePendingNoteOpen() {
      const request = NOTE_OPEN.pending
      NOTE_OPEN.pending = null
      return request
    }

    /** Open the workbench on one note, whichever main panel is showing. */
    function openNoteInWorkbench(ctx, path, options) {
      if (typeof path !== 'string' || path.trim().length === 0) return
      requestNoteOpen(path.trim(), options)
      const layout = typeof ctx.get === 'function' ? ctx.get('layout') : undefined
      if (layout !== undefined && layout !== null && typeof layout.selectPanel === 'function') {
        layout.selectPanel(NS)
      }
    }

    /** Per-block Marp view choice, so a remount does not flip back unexpectedly. */
    const MARP_MODES = new Map()

    const NOTE_TOOL_TITLE_KEYS = {
      notebook_read: 'chatReadNote',
      notebook_write: 'chatWriteNote',
      notebook_list: 'chatListNotes',
      notebook_search: 'chatSearchNotes',
      notebook_flash: 'chatFlashNote',
    }

    /** Model-supplied arguments of any Tool block stage; null while preparing. */
    function toolBlockArgs(block) {
      if (block === null || typeof block !== 'object' || block.phase === 'preparing') return null
      const call = 'kind' in block ? block.call : block
      const raw = call !== null && typeof call === 'object' && typeof call.argsRaw === 'string' ? call.argsRaw : ''
      if (raw.length === 0) return null
      try {
        const value = JSON.parse(raw)
        return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
      } catch {
        return null
      }
    }

    /** The single text result of a settled Tool call; empty while running. */
    function toolBlockText(block) {
      if (block === null || typeof block !== 'object' || !('kind' in block)) return ''
      const content = Array.isArray(block.content) ? block.content : []
      return content
        .filter(
          (part) =>
            part !== null && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string',
        )
        .map((part) => part.text)
        .join('\n')
    }

    function noteNameFromPath(path) {
      const base = String(path ?? '').split('/').pop() ?? ''
      return base.replace(/\.(md|markdown|mdown|mkd)$/i, '') || base
    }

    /** Key for the ask panel's per-note conversation cache. */
    function askThreadKeyFor(path) {
      return `note:${path ?? ''}`
    }

    /** Directory prefix for a new note: an explicit target wins, else the open note's. */
    function noteDirFor(selectedPath, targetDir) {
      if (typeof targetDir === 'string') {
        return targetDir.length === 0 ? '' : `${targetDir.replace(/\/+$/, '')}/`
      }
      if (typeof selectedPath !== 'string' || selectedPath.length === 0) return ''
      const cut = selectedPath.lastIndexOf('/')
      return cut < 0 ? '' : selectedPath.slice(0, cut + 1)
    }

    /**
     * Rows of the Cmd/Ctrl+K palette: matching commands first, then matching
     * notes (the same filter quick open uses). Pure so the order is testable.
     */
    function paletteRows(actions, notes, query) {
      const needle = String(query ?? '').trim().toLowerCase()
      const matched = (Array.isArray(actions) ? actions : [])
        .filter((action) => needle.length === 0 || String(action.label ?? '').toLowerCase().includes(needle))
        .slice(0, needle.length === 0 ? 6 : 10)
      return [
        ...matched.map((action) => ({ kind: 'action', key: `action:${action.id}`, ...action })),
        ...filterQuickNotes(notes, query)
          .slice(0, 12)
          .map((note) => ({ kind: 'note', key: `note:${note.path}`, ...note })),
      ]
    }

    /** A note title from a model answer's first meaningful line. */
    function askAnswerTitle(text, fallback) {
      for (const raw of String(text ?? '').split('\n')) {
        const line = raw
          .trim()
          .replace(/^#{1,6}\s+/, '')
          .replace(/^[-*+>]\s+/, '')
          .replace(/^\d+[.)]\s+/, '')
          .replace(/[*_`]/g, '')
          .trim()
        if (line.length === 0) continue
        return line.slice(0, 60)
      }
      return fallback
    }

    /** The note name behind one citation (`[[a#b]]`, `[[a|alias]]`, `a.md`). */
    function citationNoteName(raw) {
      return parseWikiLink(String(raw ?? '').split('|')[0]).name
    }

    /** Read one SSE response and hand every `data:` JSON frame to `onEvent`. */
    async function readSse(response, onEvent) {
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let cut = buffer.indexOf('\n\n')
        while (cut >= 0) {
          const frame = buffer.slice(0, cut)
          buffer = buffer.slice(cut + 2)
          for (const line of frame.split('\n')) {
            if (!line.startsWith('data: ')) continue
            let event
            try {
              event = JSON.parse(line.slice(6))
            } catch {
              continue
            }
            await onEvent(event)
          }
          cut = buffer.indexOf('\n\n')
        }
      }
    }

    /** Collapse browser selection whitespace into one prompt-sized string. */
    function normalizeSelectionText(text) {
      return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 800)
    }

    /** Index of the last user turn, or -1 (the retry anchor of one thread). */
    function lastUserIndex(thread) {
      const list = Array.isArray(thread) ? thread : []
      for (let index = list.length - 1; index >= 0; index -= 1) {
        if (list[index]?.role === 'user') return index
      }
      return -1
    }

    /** Insert blocks right after one block, or at the end when it is gone. */
    function insertAfterBlock(blocks, blockId, additions) {
      const list = Array.isArray(blocks) ? blocks.slice() : []
      const extra = Array.isArray(additions) ? additions : []
      const index = blockId === null || blockId === undefined ? -1 : list.findIndex((block) => block.id === blockId)
      if (index < 0) return [...list, ...extra]
      return [...list.slice(0, index + 1), ...extra, ...list.slice(index + 1)]
    }

    /** Last parenthesised value of the first result line, e.g. `(1.2 KB)`. */
    function resultSuffix(text) {
      const firstLine = text.split('\n', 1)[0] ?? ''
      const match = /\(([^()]+)\)\s*$/.exec(firstLine)
      return match === null ? '' : match[1]
    }

    function previewOf(text) {
      const lines = text.split('\n').slice(0, 12).join('\n')
      return lines.length > 900 ? `${lines.slice(0, 900)}…` : lines
    }

    /**
     * One row model for the four notebook tools: title, note or query summary,
     * a short suffix, the expandable preview and the note to open. Pure so the
     * Node test can check the formats the Host's tool results actually use.
     */
    function chatNoteToolModel(toolName, block, t) {
      const args = toolBlockArgs(block) ?? {}
      const text = toolBlockText(block)
      const settled = block !== null && typeof block === 'object' && 'kind' in block
      const state = settled
        ? block.isError === true
          ? 'error'
          : 'ok'
        : block !== null && typeof block === 'object' && block.phase === 'preparing'
          ? 'preparing'
          : 'running'
      const rawPath = typeof args.path === 'string' ? args.path.trim() : ''
      let path = rawPath.length > 0 ? rawPath : null
      const title = t(NOTE_TOOL_TITLE_KEYS[toolName] ?? 'chatReadNote')
      let summary = ''
      let suffix = ''
      let body = ''
      const results = []
      if (toolName === 'notebook_flash') {
        const action =
          typeof args.action === 'string'
            ? args.action
            : typeof args.text === 'string' && args.text.trim().length > 0
              ? 'capture'
              : 'recent'
        summary =
          action === 'capture'
            ? typeof args.text === 'string'
              ? args.text.trim().slice(0, 80)
              : ''
            : t(action === 'random' ? 'flashRandom' : 'flashInbox')
        // The tool result carries the stored path; make the row open it.
        const saved = /闪念已记下：(.+?\.md)/.exec(text)
        if (saved !== null) path = saved[1]
        body = text
      } else if (toolName === 'notebook_list') {
        summary =
          typeof args.folder === 'string' && args.folder.trim().length > 0 ? args.folder.trim() : t('chatAllNotes')
        const count = /—\s*(\d+)\s+note\(s\)/.exec(text)
        suffix = count === null ? '' : t('chatMatches', { count: count[1] })
        body = text.split('\n').slice(1).join('\n')
      } else if (toolName === 'notebook_search') {
        summary = typeof args.query === 'string' ? args.query.trim() : ''
        const count = /^(\d+)\s+match/.exec(text)
        suffix =
          count !== null
            ? t('chatMatches', { count: count[1] })
            : text.startsWith('No matches')
              ? t('chatMatches', { count: '0' })
              : ''
        const lines = text.split('\n').slice(1)
        for (const line of lines) {
          const match = /^(.+?):(\d+):\s?(.*)$/.exec(line)
          if (match === null) continue
          results.push({ path: match[1], line: Number(match[2]), text: match[3].slice(0, 200) })
          if (results.length >= 20) break
        }
        body = lines.join('\n')
      } else if (toolName === 'notebook_write') {
        summary = path === null ? '' : noteNameFromPath(path)
        const modeLabel = t(
          args.mode === 'append'
            ? 'chatModeAppend'
            : args.mode === 'create'
              ? 'chatModeCreate'
              : 'chatModeReplace',
        )
        suffix = state === 'ok' ? [modeLabel, resultSuffix(text)].filter(Boolean).join(' · ') : ''
        body = typeof args.content === 'string' ? args.content : ''
      } else {
        summary = path === null ? '' : noteNameFromPath(path)
        suffix = state === 'ok' ? resultSuffix(text) : ''
        body = text.replace(/^#[^\n]*\n+/, '')
      }
      if (state === 'preparing' || state === 'running') suffix = t('chatRunning')
      else if (state === 'error') {
        suffix = t('chatFailed')
        body = text
      }
      const preview = state === 'preparing' || state === 'running' ? '' : previewOf(body.trim())
      return { title, summary, suffix, state, path, preview, results }
    }

    /** The chat row for notebook_read / _write / _list / _search. */
    function NotebookToolRow({ toolName, block, t: translate, useDisclosure, onOpenNote }) {
      const { expanded, toggle } = useDisclosure()
      // The slot supplies `t` through the registration's locale; keep a raw-key
      // fallback so a host change can never break the whole chat row.
      const t = typeof translate === 'function' ? translate : (key) => key
      const model = chatNoteToolModel(toolName, block, t)
      const expandable = model.preview.length > 0 || model.results.length > 0
      const open = expanded && expandable
      const onKeyDown = (event) => {
        if (!expandable) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          toggle()
        }
      }
      return h(
        'div',
        { className: 'nb-chat-tool', 'data-tool': toolName, 'data-state': model.state },
        h(
          'div',
          {
            className: 'nb-chat-tool-row',
            role: expandable ? 'button' : undefined,
            tabIndex: expandable ? 0 : undefined,
            'aria-expanded': expandable ? open : undefined,
            onClick: expandable ? toggle : undefined,
            onKeyDown: expandable ? onKeyDown : undefined,
          },
          h('span', { className: 'nb-chat-tool-leading' }, h(NotebookGlyph, { size: 14 })),
          h('span', { className: 'nb-chat-tool-title' }, model.title),
          model.summary.length > 0 ? h('span', { className: 'nb-chat-tool-sep', 'aria-hidden': 'true' }) : null,
          model.summary.length > 0
            ? h('span', { className: 'nb-chat-tool-summary', title: model.path ?? model.summary }, model.summary)
            : null,
          model.suffix.length > 0 ? h('span', { className: 'nb-chat-tool-suffix' }, model.suffix) : null,
          model.path !== null && model.state !== 'preparing'
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'nb-chat-tool-open',
                  title: t('chatOpenInNotebook'),
                  onClick: (event) => {
                    event.stopPropagation()
                    onOpenNote(model.path)
                  },
                },
                t('chatOpen'),
              )
            : null,
          model.path !== null && model.state === 'ok' && toolName === 'notebook_write'
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'nb-chat-tool-open',
                  title: t('chatHistory'),
                  onClick: (event) => {
                    event.stopPropagation()
                    onOpenNote(model.path, { history: true })
                  },
                },
                t('chatHistory'),
              )
            : null,
        ),
        open
          ? model.results.length > 0
            ? h(
                'div',
                { className: 'nb-chat-tool-results' },
                model.results.map((item) =>
                  h(
                    'button',
                    {
                      key: `${item.path}:${item.line}`,
                      type: 'button',
                      className: 'nb-chat-tool-result',
                      title: `${item.path}:${item.line}`,
                      onClick: (event) => {
                        event.stopPropagation()
                        onOpenNote(item.path)
                      },
                    },
                    h(
                      'span',
                      { className: 'nb-chat-tool-result-path' },
                      `${noteNameFromPath(item.path)}:${item.line}`,
                    ),
                    h('span', { className: 'nb-chat-tool-result-text' }, item.text),
                  ),
                ),
              )
            : h('div', { className: 'nb-chat-tool-body' }, model.preview)
          : null,
      )
    }

    /** Switch the main panel to the notebook, whichever panel is showing. */
    function openNotebookPanel(ctx) {
      const layout = typeof ctx.get === 'function' ? ctx.get('layout') : undefined
      if (layout !== undefined && layout !== null && typeof layout.selectPanel === 'function') {
        layout.selectPanel(NS)
      }
    }

    /** The Host folder picker behind the notebook's Settings row. */
    async function pickVaultDirectory(ctx) {
      const workspace = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined
      if (workspace === undefined || workspace === null || typeof workspace.pickDirectory !== 'function') return null
      return workspace.pickDirectory()
    }

    /**
     * The composer menu lives on document.body: the docked composer clips its
     * own descendants, so a menu rendered inside the tool row would be cut off.
     */
    function showComposerMenu({ anchor, t, onOpen, onAsk, onInsert, onCite }) {
      if (typeof document === 'undefined' || anchor === null || anchor === undefined) return null
      const rect = anchor.getBoundingClientRect()
      const menu = document.createElement('div')
      menu.className = 'nb-composer-menu'
      menu.setAttribute('role', 'menu')
      let closed = false
      const close = () => {
        if (closed) return
        closed = true
        document.removeEventListener('mousedown', onPointerDown, true)
        document.removeEventListener('keydown', onKeyDown, true)
        window.removeEventListener('resize', close)
        window.removeEventListener('scroll', close, true)
        menu.remove()
      }
      const onPointerDown = (event) => {
        if (menu.contains(event.target) || anchor.contains(event.target)) return
        close()
      }
      const onKeyDown = (event) => {
        if (event.key === 'Escape') close()
      }
      for (const [label, action] of [
        [t('menuCiteNotes'), onCite],
        [t('menuOpenNotebook'), onOpen],
        [t('menuAskAi'), onAsk],
        [t('menuInsertNote'), onInsert],
      ]) {
        const item = document.createElement('button')
        item.type = 'button'
        item.className = 'nb-composer-menu-item'
        item.setAttribute('role', 'menuitem')
        item.textContent = label
        item.addEventListener('click', () => {
          close()
          if (typeof action === 'function') action()
        })
        menu.appendChild(item)
      }
      document.body.appendChild(menu)
      menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`
      menu.style.top = `${Math.max(8, rect.top - menu.offsetHeight - 8)}px`
      document.addEventListener('mousedown', onPointerDown, true)
      document.addEventListener('keydown', onKeyDown, true)
      window.addEventListener('resize', close)
      window.addEventListener('scroll', close, true)
      return close
    }

    /** Multi-select note picker: inserts "path + summary" citations into the draft. */
    function NotebookCitePicker({ t, anchor, inputActions, onClose }) {
      const [notes, setNotes] = React.useState(null)
      const [query, setQuery] = React.useState('')
      const [selected, setSelected] = React.useState([])
      const [error, setError] = React.useState(null)
      const searchRef = React.useRef(null)
      const rootRef = React.useRef(null)

      React.useEffect(() => {
        let disposed = false
        apiGet('/list')
          .then((data) => {
            if (!disposed) setNotes(Array.isArray(data.notes) ? data.notes : [])
          })
          .catch((failure) => {
            if (disposed) return
            setNotes([])
            setError(String((failure && failure.message) || failure))
          })
        return () => {
          disposed = true
        }
      }, [])

      React.useEffect(() => {
        const node = searchRef.current
        if (node !== null && node !== undefined && typeof node.focus === 'function') node.focus()
        const onKey = (event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
          }
        }
        const onDown = (event) => {
          if (rootRef.current !== null && rootRef.current.contains(event.target)) return
          onClose()
        }
        const onDrift = (event) => {
          // Scrolling the picker's own list must not dismiss it.
          const root = rootRef.current
          if (root !== null && event !== undefined && event.target instanceof Node && root.contains(event.target)) {
            return
          }
          onClose()
        }
        document.addEventListener('keydown', onKey, true)
        document.addEventListener('mousedown', onDown, true)
        window.addEventListener('resize', onDrift)
        window.addEventListener('scroll', onDrift, true)
        return () => {
          document.removeEventListener('keydown', onKey, true)
          document.removeEventListener('mousedown', onDown, true)
          window.removeEventListener('resize', onDrift)
          window.removeEventListener('scroll', onDrift, true)
        }
      }, [onClose])

      const filtered = React.useMemo(() => {
        const needle = query.trim().toLowerCase()
        return (notes ?? [])
          .filter((note) => needle.length === 0 || `${note.name} ${note.path}`.toLowerCase().includes(needle))
          .slice(0, 80)
      }, [notes, query])

      const toggle = (path) =>
        setSelected((current) => (current.includes(path) ? current.filter((item) => item !== path) : [...current, path]))

      const insert = () => {
        if (selected.length === 0) return
        // Paths only: the model reads whatever it needs with notebook_read, so
        // the draft stays one short line instead of a quoted excerpt block.
        const text = `${selected.map((path) => `@[[${path}]]`).join(' ')}\n`
        if (
          inputActions !== null &&
          inputActions !== undefined &&
          typeof inputActions.insertText === 'function' &&
          typeof inputActions.captureInsertion === 'function'
        ) {
          const span =
            anchor.span !== undefined ? anchor.span : inputActions.captureInsertion()
          if (span !== undefined) inputActions.insertText(text, span)
        }
        onClose()
      }

      const style = {
        left: `${Math.max(8, Math.min(anchor.left, window.innerWidth - 448))}px`,
        bottom: `${Math.max(8, window.innerHeight - anchor.top + 8)}px`,
        maxHeight: `${Math.max(180, Math.min(440, anchor.top - 72))}px`,
      }
      const panel = h(
        'div',
        { className: 'nb-cite-pop', style, ref: rootRef, role: 'dialog', 'aria-label': t('citeTitle') },
        h(
          'div',
          { className: 'nb-cite-head' },
          h('span', null, t('citeTitle')),
          h(
            'button',
            { type: 'button', className: 'nb-cite-close', 'aria-label': t('cancel'), onClick: onClose },
            '×',
          ),
        ),
        h('input', {
          ref: searchRef,
          className: 'nb-cite-search',
          value: query,
          placeholder: t('citePlaceholder'),
          onChange: (event) => setQuery(event.target.value),
        }),
        h(
          'div',
          { className: 'nb-cite-list' },
          notes === null
            ? h('div', { className: 'nb-cite-empty' }, t('loading'))
            : error !== null
              ? h('div', { className: 'nb-cite-empty' }, t('citeFailed', { message: error }))
              : filtered.length === 0
                ? h('div', { className: 'nb-cite-empty' }, t('citeEmpty'))
                : filtered.map((note) =>
                    h(
                      'label',
                      {
                        key: note.path,
                        className: `nb-cite-row${selected.includes(note.path) ? ' on' : ''}`,
                      },
                      h('input', {
                        type: 'checkbox',
                        checked: selected.includes(note.path),
                        onChange: () => toggle(note.path),
                      }),
                      h(
                        'span',
                        { className: 'nb-cite-main' },
                        h('span', { className: 'nb-cite-name' }, note.name),
                        h('span', { className: 'nb-cite-path' }, note.path),
                      ),
                    ),
                  ),
        ),
        h(
          'div',
          { className: 'nb-cite-foot' },
          h('span', { className: 'nb-cite-count' }, `${selected.length}`),
          h('button', { type: 'button', className: 'nb-cite-btn', onClick: onClose }, t('cancel')),
          h(
            'button',
            {
              type: 'button',
              className: 'nb-cite-btn nb-cite-btn-primary',
              onClick: insert,
              disabled: selected.length === 0,
            },
            t('citeInsert', { count: selected.length }),
          ),
        ),
      )
      if (
        typeof document !== 'undefined' &&
        ReactDOM !== null &&
        ReactDOM !== undefined &&
        typeof ReactDOM.createPortal === 'function'
      ) {
        return ReactDOM.createPortal(panel, document.body)
      }
      return panel
    }

    /** Notebook entry in the composer tool row: open the panel or insert a note. */
    function NotebookComposerButton({ t, locale, inputActions, openPanel, openAsk }) {
      useLocaleTick(locale)
      const buttonRef = React.useRef(null)
      const closeRef = React.useRef(null)
      const [cite, setCite] = React.useState(null)
      React.useEffect(
        () => () => {
          if (closeRef.current !== null) closeRef.current()
        },
        [],
      )
      const insertCurrentNote = async () => {
        try {
          const data = await apiGet('/current')
          if (typeof data?.path !== 'string' || data.path.length === 0) {
            openPanel()
            return
          }
          const text = `${data.path} `
          if (inputActions === null || inputActions === undefined) return
          if (typeof inputActions.insertText !== 'function' || typeof inputActions.captureInsertion !== 'function') {
            return
          }
          const span = inputActions.captureInsertion()
          if (span !== undefined && inputActions.insertText(text, span) === false) {
            // The caret moved while /current was loading: capture it once more
            // rather than replacing whatever the user has typed since.
            const retry = inputActions.captureInsertion()
            if (retry !== undefined) inputActions.insertText(text, retry)
          }
        } catch {
          openPanel()
        }
      }
      const toggle = () => {
        if (closeRef.current !== null) {
          closeRef.current()
          closeRef.current = null
          return
        }
        if (buttonRef.current === null) return
        closeRef.current = showComposerMenu({
          anchor: buttonRef.current,
          t,
          onOpen: () => {
            closeRef.current = null
            openPanel()
          },
          onAsk: () => {
            closeRef.current = null
            openAsk()
          },
          onInsert: () => {
            closeRef.current = null
            insertCurrentNote()
          },
          onCite: () => {
            closeRef.current = null
            const node = buttonRef.current
            if (node === null) return
            const rect = node.getBoundingClientRect()
            // Remember the composer caret before focus moves into the picker.
            const span =
              inputActions !== null &&
              inputActions !== undefined &&
              typeof inputActions.captureInsertion === 'function'
                ? inputActions.captureInsertion()
                : undefined
            setCite({ left: rect.left, top: rect.top, span })
          },
        })
      }
      return h(
        'div',
        { style: { display: 'inline-flex' } },
        h(
          'button',
          {
            ref: buttonRef,
            type: 'button',
            className: 'nb-composer-btn',
            title: t('panelTitle'),
            'aria-label': t('panelTitle'),
            'aria-haspopup': 'menu',
            onClick: toggle,
          },
          h(NotebookGlyph, { size: 16 }),
        ),
        cite === null
          ? null
          : h(NotebookCitePicker, {
              t,
              anchor: cite,
              inputActions,
              onClose: () => setCite(null),
            }),
      )
    }

    /** Settings → General row: the vault folder, picked through the Host. */
    function VaultSettingRow({ t, locale, pickDirectory }) {
      useLocaleTick(locale)
      const [status, setStatus] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [pending, setPending] = React.useState(false)
      const pollRef = React.useRef(null)
      React.useEffect(
        () => () => {
          if (pollRef.current !== null) clearInterval(pollRef.current)
        },
        [],
      )
      React.useEffect(() => {
        let disposed = false
        apiGet('/status')
          .then((data) => {
            if (!disposed) setStatus(data)
          })
          .catch((failure) => {
            if (!disposed) setError(failure.message)
          })
        return () => {
          disposed = true
        }
      }, [])
      const apply = async (path) => {
        if (pending) return
        setPending(true)
        setError(null)
        try {
          await apiPost('/vault', { path })
          const expectedMode = path.length === 0 ? 'obsidian' : 'config'
          let tries = 0
          if (pollRef.current !== null) clearInterval(pollRef.current)
          pollRef.current = setInterval(async () => {
            tries += 1
            try {
              const data = await apiGet('/status')
              const settled =
                (data.configuredBy ?? '') === expectedMode && (expectedMode === 'obsidian' || data.path === path)
              if (settled || tries >= 12) {
                clearInterval(pollRef.current)
                pollRef.current = null
                setStatus(data)
                setPending(false)
                if (settled) {
                  VAULT_CHANGED.pending = true
                  document.dispatchEvent(new CustomEvent('dsh-notebook:vault-changed'))
                }
              }
            } catch {
              if (tries >= 12) {
                clearInterval(pollRef.current)
                pollRef.current = null
                setPending(false)
              }
            }
          }, 600)
        } catch (failure) {
          setError(failure.message)
          setPending(false)
        }
      }
      const writable = status === null || status.configWritable !== false
      const choose = async () => {
        if (pending || !writable || typeof pickDirectory !== 'function') return
        try {
          const path = await pickDirectory()
          if (typeof path !== 'string' || path.length === 0) return
          await apply(path)
        } catch (failure) {
          setError(failure !== null && failure !== undefined ? failure.message : String(failure))
        }
      }
      const statusText =
        status === null
          ? ''
          : status.path === null || status.path === undefined
            ? t('settingsNoVault')
            : `${status.path}${status.configuredBy === 'obsidian' ? ` · ${t('settingsDetected')}` : ''}`
      return h(
        'div',
        { className: 'nb-set-row' },
        h(
          'div',
          { className: 'nb-set-main' },
          h('div', { className: 'nb-set-title' }, t('settingsVaultTitle')),
          h(
            'div',
            { className: 'nb-set-sub', title: statusText },
            pending ? t('settingsApplying') : statusText,
          ),
          h('div', { className: 'nb-set-hint' }, writable ? t('settingsRestart') : t('settingsUnavailable')),
        ),
        h(
          'div',
          { className: 'nb-set-actions' },
          h(
            'button',
            { type: 'button', className: 'nb-set-btn', disabled: pending || !writable, onClick: choose },
            t('settingsPick'),
          ),
          h(
            'button',
            { type: 'button', className: 'nb-set-btn', disabled: pending || !writable, onClick: () => apply('') },
            t('settingsAuto'),
          ),
        ),
        error !== null ? h('div', { className: 'nb-set-error' }, error) : null,
      )
    }

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
      abstract: '📋',
      todo: '☑️',
      bug: '🐞',
      failure: '❌',
      important: '❗',
    }
    const CALLOUT_KINDS = new Set(Object.keys(CALLOUT_ICONS))

    /** Safe tone key for a callout variant; unknown kinds fall back to note. */
    function calloutKind(variant) {
      const key = String(variant ?? 'note').toLowerCase()
      return CALLOUT_KINDS.has(key) ? key : 'note'
    }

    function calloutIcon(variant) {
      return CALLOUT_ICONS[calloutKind(variant)]
    }

    const CALLOUT_CYCLE = ['note', 'tip', 'warning', 'danger', 'info', 'success', 'question', 'quote', 'example']

    /** The kind a click on the callout badge moves to. */
    function nextCalloutKind(variant) {
      const index = CALLOUT_CYCLE.indexOf(calloutKind(variant))
      return CALLOUT_CYCLE[(index + 1) % CALLOUT_CYCLE.length]
    }

    function formatBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes < 0) return '?'
      if (bytes < 1024) return `${bytes} B`
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
      return `${(bytes / 1024 / 1024).toFixed(1)} MB`
    }

    function formatShortDate(ms) {
      const time = Number(ms)
      if (!Number.isFinite(time) || time <= 0) return ''
      try {
        return new Date(time).toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' })
      } catch {
        return ''
      }
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

    /**
     * A Marp deck inside a fenced block: optional YAML frontmatter announcing
     * `marp: true` (the note may use a full-width colon), then slides separated
     * by `---` (or `***` / `___`, as Marp allows). Returns null for other code.
     */
    // ---- Obsidian Bases: YAML subset, filters, sort, render ----
    const BASES_TYPE_LABELS = { table: '表格', cards: '卡片', list: '列表', kanban: '看板', map: '地图' }
    const BASES_COLUMN_LABELS = {
      'file.name': '名称',
      'file.folder': '目录',
      'file.path': '路径',
      'file.ext': '类型',
      'file.mtime': '修改时间',
      'file.ctime': '创建时间',
      'file.size': '大小',
      'file.tags': '标签',
    }

    function parseBaseScalar(raw) {
      const value = String(raw ?? '').trim()
      if (value.length >= 2) {
        const first = value[0]
        const last = value[value.length - 1]
        if ((first === '"' && last === '"') || (first === "'" && last === "'")) return value.slice(1, -1)
      }
      if (value === 'true') return true
      if (value === 'false') return false
      if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value)
      return value
    }

    /** Parse the indentation-based YAML subset a base code block uses. */
    function parseYamlSubset(blockLines) {
      if (blockLines.length === 0) return null
      const isList = blockLines[0].text.startsWith('- ')
      const result = isList ? [] : {}
      let index = 0
      const takeChildren = (parentIndent) => {
        const children = []
        while (index < blockLines.length && blockLines[index].indent > parentIndent) {
          children.push(blockLines[index])
          index += 1
        }
        return children
      }
      if (isList) {
        while (index < blockLines.length) {
          const line = blockLines[index]
          if (line.indent !== blockLines[0].indent || !line.text.startsWith('- ')) break
          const rest = line.text.slice(2).trim()
          index += 1
          const children = takeChildren(line.indent)
          if (rest.length === 0) {
            result.push(parseYamlSubset(children))
            continue
          }
          const colon = rest.indexOf(':')
          const keyCandidate = colon > 0 ? rest.slice(0, colon).trim() : ''
          if (/^[A-Za-z_][\w.-]*$/.test(keyCandidate)) {
            const key = keyCandidate
            const value = rest.slice(colon + 1).trim()
            const item = {}
            item[key] = value.length === 0 ? parseYamlSubset(children) : parseBaseScalar(value)
            const extra = parseYamlSubset(children)
            if (extra !== null && typeof extra === 'object' && !Array.isArray(extra)) Object.assign(item, extra)
            result.push(item)
            continue
          }
          result.push(parseBaseScalar(rest))
          if (children.length > 0) {
            /* trailing children on a scalar item are ignored */
          }
        }
        return result
      }
      while (index < blockLines.length) {
        const line = blockLines[index]
        const colon = line.text.indexOf(':')
        if (colon < 0) {
          index += 1
          continue
        }
        const key = line.text.slice(0, colon).trim()
        const value = line.text.slice(colon + 1).trim()
        index += 1
        const children = takeChildren(line.indent)
        result[key] = value.length === 0 ? parseYamlSubset(children) : parseBaseScalar(value)
      }
      return result
    }

    function parseBasesConfig(text) {
      const lines = []
      for (const raw of String(text ?? '').split(/\r?\n/)) {
        if (raw.trim().length === 0 || raw.trim().startsWith('#')) continue
        lines.push({ indent: raw.length - raw.trimStart().length, text: raw.trim() })
      }
      const parsed = parseYamlSubset(lines)
      const config = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
      return { filters: config.filters ?? null, views: Array.isArray(config.views) ? config.views : [] }
    }

    function makeBaseRow(note, fields) {
      const path = String(note?.path ?? '')
      const parts = path.split('/')
      const name = String(note?.name ?? parts[parts.length - 1] ?? '').replace(/\.md$/i, '')
      const rawTags = fields?.tags ?? fields?.Tags ?? []
      const tags = Array.isArray(rawTags)
        ? rawTags.map((tag) => String(tag).replace(/^#/, ''))
        : String(rawTags ?? '')
            .split(/[,\s]+/)
            .map((tag) => tag.replace(/^#/, ''))
            .filter(Boolean)
      return {
        path,
        name,
        folder: parts.length > 1 ? parts.slice(0, -1).join('/') : '',
        ext: (path.split('.').pop() ?? '').toLowerCase(),
        size: Number(note?.size ?? 0),
        mtime: Number(note?.mtimeMs ?? 0),
        ctime: Number(note?.mtimeMs ?? 0),
        fields: fields ?? {},
        tags,
      }
    }

    function baseRowValue(row, property) {
      const key = String(property ?? '')
      if (key === 'file.name' || key === 'name' || key === 'note.name') return row.name
      if (key === 'file.folder' || key === 'file.dir' || key === 'folder') return row.folder
      if (key === 'file.path' || key === 'path') return row.path
      if (key === 'file.ext' || key === 'ext') return row.ext
      if (key === 'file.mtime' || key === 'mtime') return row.mtime
      if (key === 'file.ctime' || key === 'ctime') return row.ctime
      if (key === 'file.size' || key === 'size') return row.size
      if (key === 'file.tags' || key === 'tags') return row.tags
      if (key.startsWith('note.')) return row.fields[key.slice(5)]
      if (key.startsWith('file.')) return row[key.slice(5)]
      return row.fields[key]
    }

    function parseBaseLiteral(raw, now) {
      const value = String(raw ?? '').trim()
      if (value === 'now()' || value === 'today()') return now
      if (value.startsWith('date(') && value.endsWith(')')) return Date.parse(value.slice(5, -1).replace(/^["']|["']$/g, ''))
      return parseBaseScalar(value)
    }

    function evalBaseExpression(expr, row, now) {
      const source = String(expr ?? '').trim()
      if (source.length === 0) return true
      const folder = /^file\.inFolder\("([^"]*)"\)$/.exec(source)
      if (folder !== null) {
        const target = folder[1].replace(/^\/+|\/+$/g, '')
        return target.length === 0 ? true : row.folder === target || row.folder.startsWith(`${target}/`)
      }
      const tag = /^file\.hasTag\("([^"]*)"\)$/.exec(source)
      if (tag !== null) return row.tags.includes(tag[1].replace(/^#/, ''))
      const comparison = /^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/.exec(source)
      if (comparison !== null) {
        const left = baseRowValue(row, comparison[1].trim())
        const right = parseBaseLiteral(comparison[3], now)
        const operator = comparison[2]
        const numeric = typeof left === 'number' && typeof right === 'number'
        if (operator === '==') return numeric ? left === right : String(left ?? '') === String(right ?? '')
        if (operator === '!=') return numeric ? left !== right : String(left ?? '') !== String(right ?? '')
        if (operator === '>') return Number(left) > Number(right)
        if (operator === '<') return Number(left) < Number(right)
        if (operator === '>=') return Number(left) >= Number(right)
        return Number(left) <= Number(right)
      }
      return true
    }

    function evalBaseFilter(filter, row, now) {
      if (filter === null || filter === undefined) return true
      if (typeof filter === 'string') return evalBaseExpression(filter, row, now)
      if (Array.isArray(filter)) return filter.every((item) => evalBaseFilter(item, row, now))
      const source = filter
      if (source.and !== undefined) {
        const list = Array.isArray(source.and) ? source.and : [source.and]
        return list.every((item) => evalBaseFilter(item, row, now))
      }
      if (source.or !== undefined) {
        const list = Array.isArray(source.or) ? source.or : [source.or]
        return list.some((item) => evalBaseFilter(item, row, now))
      }
      if (source.not !== undefined) {
        const list = Array.isArray(source.not) ? source.not : [source.not]
        return !list.every((item) => evalBaseFilter(item, row, now))
      }
      return true
    }

    function sortBaseRows(rows, sort) {
      const rules = (Array.isArray(sort) ? sort : [sort])
        .filter((rule) => rule !== null && typeof rule === 'object' && typeof rule.property === 'string')
        .map((rule) => ({ property: rule.property, direction: String(rule.direction ?? 'ASC').toUpperCase() }))
      if (rules.length === 0) return rows
      return [...rows].sort((left, right) => {
        for (const rule of rules) {
          const a = baseRowValue(left, rule.property)
          const b = baseRowValue(right, rule.property)
          const numeric = typeof a === 'number' && typeof b === 'number'
          const compare = numeric ? a - b : String(a ?? '').localeCompare(String(b ?? ''), 'zh-Hans-CN')
          if (compare !== 0) return rule.direction === 'DESC' ? -compare : compare
        }
        return 0
      })
    }

    function baseColumnLabel(property) {
      return BASES_COLUMN_LABELS[property] ?? String(property ?? '').replace(/^note\./, '')
    }

    function formatBaseCell(row, property, t) {
      const value = baseRowValue(row, property)
      if (property === 'file.mtime' || property === 'file.ctime') return formatBaseTime(Number(value ?? 0), t)
      if (property === 'file.tags' || property === 'tags') return Array.isArray(value) ? value.map((tag) => `#${tag}`).join(' ') : ''
      if (value === undefined || value === null || value === '') return ''
      if (Array.isArray(value)) return value.join(', ')
      return String(value)
    }

    function formatBaseTime(ms, t) {
      const value = Number(ms ?? 0)
      if (!Number.isFinite(value) || value <= 0) return ''
      const delta = Math.max(0, Date.now() - value)
      const minutes = Math.floor(delta / 60000)
      if (minutes < 1) return t('timeJustNow')
      if (minutes < 60) return t('timeMinutesAgo', { n: minutes })
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return t('timeHoursAgo', { n: hours })
      const days = Math.floor(hours / 24)
      if (days < 7) return t('timeDaysAgo', { n: days })
      return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(value))
    }


    /** Read just enough of an Obsidian `base` code block to label it. */
    function parseBasesView(text) {
      const lines = String(text ?? '').split(/\r?\n/)
      const views = []
      let inViews = false
      for (const line of lines) {
        if (/^views:\s*$/.test(line)) {
          inViews = true
          continue
        }
        if (!inViews) continue
        if (/^\S/.test(line)) {
          inViews = false
          continue
        }
        const type = /^\s{2}- type:\s*(\w+)\s*$/.exec(line)
        if (type !== null) {
          views.push({ type: type[1], name: '' })
          continue
        }
        const name = /^\s{4}name:\s*(.+?)\s*$/.exec(line)
        if (name !== null && views.length > 0) {
          const value = name[1].replace(/^["']|["']$/g, '')
          if (value.length > 0 && views[views.length - 1].name === '') views[views.length - 1].name = value
        }
      }
      return views.length > 0 ? { views } : null
    }

    // Every Bases view needs the same full-vault rows; share one load for a
    // short window so opening several views (or re-rendering) is not repeated work.
    let basesSourceCache = { at: 0, promise: null }
    const BASES_SOURCE_TTL_MS = 2000

    function loadBasesSource() {
      const now = Date.now()
      if (basesSourceCache.promise !== null && now - basesSourceCache.at < BASES_SOURCE_TTL_MS) {
        return basesSourceCache.promise
      }
      const entry = {
        at: now,
        promise: Promise.all([apiGet('/list?folder='), apiGet('/fields?folder=')]).then(
          ([listResult, fieldsResult]) => {
            const fieldMap = new Map()
            for (const row of Array.isArray(fieldsResult?.rows) ? fieldsResult.rows : []) {
              fieldMap.set(row.path, row.fields ?? {})
            }
            const notes = Array.isArray(listResult?.notes) ? listResult.notes : []
            return notes.map((note) => makeBaseRow(note, fieldMap.get(note.path) ?? {}))
          },
        ),
      }
      basesSourceCache = entry
      entry.promise.catch(() => {
        if (basesSourceCache === entry) basesSourceCache = { at: 0, promise: null }
      })
      return entry.promise
    }

    /** Render an Obsidian `base` code block from the vault's own data. */
    function BasesView({ text, t, onOpen }) {
      const config = React.useMemo(() => parseBasesConfig(text), [text])
      const [state, setState] = React.useState({ status: 'loading', rows: [], view: null, error: '' })
      React.useEffect(() => {
        let disposed = false
        const view = config.views[0] ?? null
        const viewValue = view !== null && typeof view === 'object' ? view : {}
        loadBasesSource()
          .then((allRows) => {
            if (disposed) return
            let rows = allRows
            const filters = viewValue.filters ?? config.filters
            const now = Date.now()
            rows = rows.filter((row) => evalBaseFilter(filters, row, now))
            rows = sortBaseRows(rows, viewValue.sort)
            const limit = Number(viewValue.limit)
            if (Number.isFinite(limit) && limit > 0) rows = rows.slice(0, limit)
            setState({ status: 'ready', rows, view: viewValue, error: '' })
          })
          .catch((error) => {
            if (!disposed) {
              setState({ status: 'error', rows: [], view: viewValue, error: String(error?.message ?? error) })
            }
          })
        return () => {
          disposed = true
        }
      }, [text])
      const view = state.view ?? {}
      const type = String(view.type ?? 'table')
      const order =
        Array.isArray(view.order) && view.order.length > 0
          ? view.order.filter((item) => typeof item === 'string')
          : ['file.name', 'file.folder', 'file.mtime']
      const heading = (count) =>
        h(
          'div',
          { className: 'nb-bases-head' },
          h('span', { className: 'nb-bases-icon', 'aria-hidden': 'true' }, '📊'),
          h(
            'span',
            { className: 'nb-bases-name' },
            typeof view.name === 'string' && view.name.length > 0 ? view.name : t('basesView'),
          ),
          h('span', { className: 'nb-bases-type' }, BASES_TYPE_LABELS[type] ?? type),
          h('span', { className: 'nb-bases-tag' }, 'Obsidian'),
          h('span', { className: 'nb-bases-count' }, t('basesRows', { n: count })),
        )
      if (state.status === 'loading') {
        return h('div', { className: 'nb-bases-view' }, heading(0), h('div', { className: 'nb-bases-empty' }, t('basesLoading')))
      }
      if (state.status === 'error') {
        return h(
          'div',
          { className: 'nb-bases-view' },
          heading(0),
          h('div', { className: 'nb-bases-empty' }, `${t('basesError')}：${state.error}`),
        )
      }
      if (state.rows.length === 0) {
        return h('div', { className: 'nb-bases-view' }, heading(0), h('div', { className: 'nb-bases-empty' }, t('basesEmpty')))
      }
      const open = (path) => {
        if (typeof onOpen === 'function') onOpen(path)
      }
      const card = (row) =>
        h(
          'button',
          {
            key: row.path,
            className: 'nb-bases-card',
            title: row.path,
            onClick: (event) => {
              event.stopPropagation()
              open(row.path)
            },
          },
          h('span', { className: 'nb-bases-card-title' }, row.name),
          h(
            'span',
            { className: 'nb-bases-card-meta' },
            [row.folder, formatBaseTime(row.mtime, t)].filter(Boolean).join(' · '),
          ),
        )
      let body = null
      if (type === 'cards') {
        body = h('div', { className: 'nb-bases-cards' }, state.rows.map(card))
      } else if (type === 'list') {
        body = h(
          'div',
          { className: 'nb-bases-list' },
          state.rows.map((row) =>
            h(
              'button',
              {
                key: row.path,
                className: 'nb-bases-list-item',
                onClick: (event) => {
                  event.stopPropagation()
                  open(row.path)
                },
              },
              row.name,
            ),
          ),
        )
      } else if (type === 'kanban') {
        const groupBy = view.groupBy !== null && typeof view.groupBy === 'object' ? String(view.groupBy.property ?? '') : ''
        const groups = new Map()
        for (const row of state.rows) {
          const value = groupBy.length > 0 ? baseRowValue(row, groupBy) : ''
          const label = value === undefined || value === null || value === '' ? t('basesUncategorized') : String(value)
          if (!groups.has(label)) groups.set(label, [])
          groups.get(label).push(row)
        }
        body = h(
          'div',
          { className: 'nb-bases-kanban' },
          [...groups.entries()].map(([label, rows]) =>
            h(
              'div',
              { key: label, className: 'nb-bases-kanban-col' },
              h('div', { className: 'nb-bases-kanban-head' }, `${label} · ${rows.length}`),
              rows.map(card),
            ),
          ),
        )
      } else {
        body = h(
          'table',
          { className: 'nb-bases-table' },
          h(
            'thead',
            null,
            h('tr', null, order.map((property) => h('th', { key: property }, baseColumnLabel(property)))),
          ),
          h(
            'tbody',
            null,
            state.rows.map((row) =>
              h(
                'tr',
                {
                  key: row.path,
                  className: 'nb-bases-row',
                  title: row.path,
                  onClick: (event) => {
                    event.stopPropagation()
                    open(row.path)
                  },
                },
                order.map((property) => h('td', { key: property }, formatBaseCell(row, property, t))),
              ),
            ),
          ),
        )
      }
      return h('div', { className: 'nb-bases-view' }, heading(state.rows.length), body)
    }

    /** Obsidian Bases blocks render as a labelled card here; Obsidian renders the table itself. */
    function renderBasesCard(bases, t) {
      const first = bases.views[0]
      const labels = bases.views.map((view) => BASES_VIEW_TYPES[view.type] ?? view.type)
      return h(
        'div',
        { className: 'nb-bases-card' },
        h(
          'div',
          { className: 'nb-bases-head' },
          h('span', { className: 'nb-bases-icon', 'aria-hidden': 'true' }, '📊'),
          h('span', { className: 'nb-bases-title' }, first.name.length > 0 ? first.name : t('basesView')),
          h('span', { className: 'nb-bases-tag' }, t('basesTag')),
        ),
        h('div', { className: 'nb-bases-meta' }, `${labels.join(' / ')} · ${bases.views.length} ${t('basesViews')}`),
        h('div', { className: 'nb-bases-hint' }, t('basesInObsidian')),
      )
    }

    function parseMarpDeck(source, lang) {
      const raw = String(source ?? '').replace(/\r\n/g, '\n')
      if (raw.trim().length === 0) return null
      const lines = raw.split('\n')
      const languageSaysMarp = typeof lang === 'string' && /marp/i.test(lang)
      let start = 0
      let frontmatter = false
      if (lines[0].trim() === '---') {
        const end = lines.findIndex((line, index) => index > 0 && /^\s*---\s*$/.test(line))
        if (end > 0) {
          const head = lines.slice(1, end).join('\n')
          if (/^\s*marp\s*[:：]\s*true\b/im.test(head)) {
            start = end + 1
            frontmatter = true
          }
        }
      }
      if (!frontmatter && !languageSaysMarp) return null
      const slides = []
      let current = []
      const flush = () => {
        const body = current.join('\n').trim()
        if (body.length > 0) slides.push(body)
        current = []
      }
      for (let index = start; index < lines.length; index += 1) {
        if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(lines[index])) {
          flush()
          continue
        }
        current.push(lines[index])
      }
      flush()
      return slides.length > 0 ? { slides } : null
    }

    /** Error boundary so one bad slide can never take the page down. */
    const MarpBoundary =
      typeof React.Component === 'function'
        ? class MarpBoundary extends React.Component {
            constructor(props) {
              super(props)
              this.state = { error: null }
            }
            static getDerivedStateFromError(error) {
              return { error }
            }
            render() {
              if (this.state.error !== null) {
                return h(
                  'div',
                  { className: 'nb-deck-fallback' },
                  `幻灯片渲染失败：${(this.state.error && this.state.error.message) || this.state.error}`,
                )
              }
              return this.props.children
            }
          }
        : null

    /** One slide at a time with arrow-key and button navigation. */
    function MarpDeck({ slides, t }) {
      const [index, setIndex] = React.useState(0)
      const total = slides.length
      const safe = Math.max(0, Math.min(index, total - 1))
      const go = (step) => setIndex(total === 0 ? 0 : (safe + step + total) % total)
      let html = ''
      try {
        html = answerHtml(slides[safe] ?? '')
      } catch (error) {
        html = `<pre>${escapeHtml(slides[safe] ?? '')}</pre>`
      }
      return h(
        'div',
        { className: 'nb-deck' },
        h(
          'div',
          {
            className: 'nb-deck-stage',
            tabIndex: 0,
            role: 'region',
            'aria-label': t('deckSlides'),
            onKeyDown: (event) => {
              if (event.key === 'ArrowRight' || event.key === 'PageDown') {
                event.preventDefault()
                event.stopPropagation()
                go(1)
              } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
                event.preventDefault()
                event.stopPropagation()
                go(-1)
              }
            },
          },
          h('div', { className: 'nb-deck-slide', dangerouslySetInnerHTML: { __html: html } }),
        ),
        h(
          'div',
          { className: 'nb-deck-nav' },
          h(
            'button',
            { type: 'button', className: 'nb-deck-btn', 'aria-label': t('deckPrev'), onClick: () => go(-1) },
            '‹',
          ),
          h('span', { className: 'nb-deck-count' }, `${safe + 1} / ${total}`),
          h(
            'button',
            { type: 'button', className: 'nb-deck-btn', 'aria-label': t('deckNext'), onClick: () => go(1) },
            '›',
          ),
        ),
      )
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
        onCalloutVariant,
        notePath,
        readOnly,
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
      const [marpMode, setMarpMode] = React.useState(() => MARP_MODES.get(block.id) ?? 'deck')
      const chooseMarpMode = (mode) => {
        MARP_MODES.set(block.id, mode)
        setMarpMode(mode)
      }

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
      // A fenced Marp deck renders as slides; the bar switches back to source.
      const marp = block.type === 'code' ? parseMarpDeck(text, block.lang) : null
      const placeholder =
        block.type === 'heading1' || block.type === 'heading2' || block.type === 'heading3'
          ? t('placeholderTitle')
          : block.type === 'code'
            ? '```'
            : t('placeholderText')

      const mathBlock =
        block.type === 'paragraph' && /^\s*\$\$[\s\S]*\$\$\s*$/.test(text) ? text.trim() : null
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
      } else if (block.type === 'columns' && !editing) {
        const columns = Array.isArray(block.columns) && block.columns.length > 0 ? block.columns : ['']
        body = h(
          'div',
          {
            key: 'columns',
            ref: renderRef,
            className: 'nb-columns',
            style: {
              gridTemplateColumns: columns
                .map((column, columnIndex) => {
                  const weight = Number(Array.isArray(block.widths) ? block.widths[columnIndex] : 1)
                  return `${Number.isFinite(weight) && weight > 0 ? weight : 1}fr`
                })
                .join(' '),
            },
            onClick: beginEditing,
            onDoubleClick: beginEditing,
          },
          columns.map((column, columnIndex) =>
            h('div', {
              key: `col-${columnIndex}`,
              className: 'nb-column',
              dangerouslySetInnerHTML: { __html: columnToHtml(String(column ?? '')) },
            }),
          ),
        )
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
            ? renderInline(text, block.id, {
                notes,
                onOpen: onOpenWiki,
                t,
                depth: 0,
                onTemplate,
                notePath,
              })
            : null
        let content = inline
        if (block.type === 'divider') {
          content = null
        } else if (block.type === 'code' && marp !== null) {
          content = h(
            'div',
            {
              className: 'nb-deck',
              // Clicks and presses here must never reach the block's
              // click-to-edit handler: paging would otherwise open the source.
              onClick: (event) => event.stopPropagation(),
              onMouseDown: (event) => event.stopPropagation(),
              onDoubleClick: (event) => event.stopPropagation(),
            },
            h(
              'div',
              { className: 'nb-deck-bar' },
              h('span', { className: 'nb-deck-tag' }, 'MARP'),
              h(
                'button',
                {
                  type: 'button',
                  className: `nb-deck-tab${marpMode === 'deck' ? ' on' : ''}`,
                  onClick: () => chooseMarpMode('deck'),
                },
                t('deckSlides'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: `nb-deck-tab${marpMode === 'source' ? ' on' : ''}`,
                  onClick: () => chooseMarpMode('source'),
                },
                t('deckSource'),
              ),
            ),
            marpMode === 'deck'
              ? h(
                  'div',
                  { className: 'nb-deck-body' },
                  MarpBoundary === null
                    ? h(MarpDeck, { slides: marp.slides, t })
                    : h(MarpBoundary, null, h(MarpDeck, { slides: marp.slides, t })),
                )
              : highlightCode(text, block.lang),
          )
        } else if (block.type === 'code' && String(block.lang ?? '') === 'base' && parseBasesConfig(text).views.length > 0) {
          content = h(BasesView, { text, t, onOpen: onOpenWiki })
        } else if (block.type === 'code' && String(block.lang ?? '').toLowerCase() === 'mermaid') {
          content = h(MermaidView, { key: 'mermaid', code: text, t })
        } else if (mathBlock !== null) {
          content = h('div', { className: 'nb-math-block-wrap', dangerouslySetInnerHTML: { __html: renderLatexMath(mathBlock, true) } })
        } else if (
          block.type !== 'code' &&
          block.type !== 'table' &&
          block.type !== 'divider' &&
          /<(\/?)(kbd|mark|u|s|b|i|span|div|sup|sub|br|details|summary|a|img|table|tr|td|th|thead|tbody|ul|ol|li|iframe|video|audio|figure|figcaption|small|abbr|del|ins|center|hr)\b/i.test(text)
        ) {
          content = h('div', {
            className: 'nb-html-block',
            dangerouslySetInnerHTML: { __html: markdownToHtml(text) },
          })
        } else if (block.type === 'code') {
          content = text.length > 0 ? highlightCode(text, block.lang) : placeholder
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
              className: `nb-b nb-b-${cls} nb-b-render${marp !== null && marpMode === 'deck' ? ' nb-has-deck' : ''}`,
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
        prefix =
          typeof onCalloutVariant === 'function' && readOnly !== true
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'nb-callout-icon',
                  title: t('calloutCycle'),
                  'aria-label': t('calloutCycle'),
                  contentEditable: false,
                  onMouseDown: (event) => {
                    event.preventDefault()
                    event.stopPropagation()
                  },
                  onClick: (event) => {
                    event.stopPropagation()
                    onCalloutVariant(block.id)
                  },
                },
                calloutIcon(block.variant),
              )
            : h('div', { className: 'nb-callout-icon', 'aria-hidden': 'true' }, calloutIcon(block.variant))
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
        ['columns-2', t('typeColumns2'), '▥'],
        ['columns-3', t('typeColumns3'), '▥'],
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
                      {
                        key: 'embed',
                        className: 'nb-menu-item',
                        onClick: () => onCopyLink(block.id, true),
                      },
                      h('span', { className: 'nb-menu-icon' }, '⧉'),
                      h('span', null, t('copyBlockEmbed')),
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
          className: `nb-block nb-type-${cls}${cls === 'callout' ? ` nb-callout-${calloutKind(block.variant)}` : ''}${menuOpen === true ? ' menu-open' : ''}${dragging === true ? ' dragging' : ''}${selected === true ? ' selected' : ''}${dropMark === 'before' ? ' drop-before' : dropMark === 'after' ? ' drop-after' : ''}`,
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

    /**
     * What the agent should know about the block being edited: the nearest
     * heading above it, its kind, and its current text. Null for an empty block
     * (nothing worth describing) or a block that no longer exists.
     */
    function focusPayloadFor(blocks, blockId) {
      const list = Array.isArray(blocks) ? blocks : []
      const index = list.findIndex((block) => block.id === blockId)
      if (index < 0) return null
      const block = list[index]
      const text = String(block.text ?? '').trim().slice(0, 500)
      if (text.length === 0) return null
      let heading = ''
      for (let cursor = index; cursor >= 0; cursor -= 1) {
        const candidate = list[cursor]
        if (candidate.type === 'heading1' || candidate.type === 'heading2' || candidate.type === 'heading3') {
          heading = String(candidate.text ?? '').trim().slice(0, 120)
          break
        }
      }
      return { heading, kind: String(block.type ?? 'paragraph'), text }
    }

    /**
     * How the panel reacts to a note file that changed on disk: an unsaved or
     * saving editor never discards its own state, editing gets a prompt, and a
     * clean idle page reloads silently.
     */
    function noteSyncDecision({ saved, editing }) {
      if (!saved) return 'ignore'
      return editing ? 'warn' : 'reload'
    }

    /** A save refused for a stale mtime gets the reload banner, not a toast. */
    function saveFailureKind(code) {
      return code === 'conflict' ? 'sync' : 'notice'
    }

    /** Codes the Host's sync engine returns, mapped to a localized one-liner. */
    const SYNC_ERROR_KEYS = {
      webdav_unauthorized: 'syncErrAuth',
      webdav_forbidden: 'syncErrForbidden',
      webdav_not_found: 'syncErrNotFound',
      webdav_unreachable: 'syncErrUnreachable',
      webdav_timeout: 'syncErrTimeout',
      webdav_url_invalid: 'syncErrUrl',
      webdav_quota: 'syncErrQuota',
      webdav_locked: 'syncErrForbidden',
      webdav_method_rejected: 'syncErrForbidden',
      webdav_error: 'syncErrUnreachable',
      git_auth: 'syncErrGitAuth',
      git_unreachable: 'syncErrGitUnreachable',
      git_conflict: 'syncErrGitConflict',
      git_missing: 'syncErrGitMissing',
      git_timeout: 'syncErrGitTimeout',
      too_many_deletes: 'syncErrTooManyDeletes',
      sync_incomplete: 'syncErrIncomplete',
      sync_not_configured: 'syncErrIncomplete',
      local_changed: 'syncErrLocalChanged',
      file_too_large: 'syncErrTooLarge',
    }

    function syncErrorLabel(t, error) {
      const key = error === null || error === undefined ? undefined : SYNC_ERROR_KEYS[error.code]
      if (key !== undefined) return t(key)
      return String((error && (error.message || error.error)) || t('syncRunFail'))
    }

    function syncFormFromSettings(settings) {
      const source = settings !== null && typeof settings === 'object' ? settings : {}
      const webdav = source.webdav !== null && typeof source.webdav === 'object' ? source.webdav : {}
      const git = source.git !== null && typeof source.git === 'object' ? source.git : {}
      const auto = source.auto !== null && typeof source.auto === 'object' ? source.auto : {}
      return {
        provider: typeof source.provider === 'string' ? source.provider : 'off',
        deletes: typeof source.deletes === 'string' ? source.deletes : 'trash',
        webdavUrl: String(webdav.url ?? ''),
        webdavUser: String(webdav.username ?? ''),
        webdavPassword: String(webdav.password ?? ''),
        webdavPath: String(webdav.remotePath ?? ''),
        gitRemote: String(git.remote ?? ''),
        gitBranch: String(git.branch ?? ''),
        gitMessage: String(git.message ?? ''),
        gitUser: String(git.username ?? ''),
        gitPassword: String(git.password ?? ''),
        gitSystemSsh: git.useSystemSsh === true,
        onSave: auto.onSave === true,
        interval: Number(auto.intervalMinutes) > 0 ? String(auto.intervalMinutes) : '0',
      }
    }

    function syncSettingsFromForm(form) {
      return {
        provider: form.provider,
        deletes: form.deletes,
        webdav: {
          url: form.webdavUrl,
          username: form.webdavUser,
          password: form.webdavPassword,
          remotePath: form.webdavPath,
        },
        git: {
          remote: form.gitRemote,
          branch: form.gitBranch,
          message: form.gitMessage,
          username: form.gitUser,
          password: form.gitPassword,
          useSystemSsh: form.gitSystemSsh === true,
        },
        auto: { onSave: form.onSave === true, intervalMinutes: Number(form.interval) || 0 },
      }
    }

    /** 闪念 category values are stable Chinese keys; only the labels are localized. */
    const FLASH_CATEGORY_KEYS = {
      随记: 'flashCatMisc',
      想法: 'flashCatIdea',
      待办: 'flashCatTodo',
      灵感: 'flashCatSpark',
      摘录: 'flashCatQuote',
    }
    const FLASH_CATEGORY_ORDER = ['随记', '想法', '待办', '灵感', '摘录']

    function flashCategoryLabel(t, category) {
      const key = FLASH_CATEGORY_KEYS[category]
      return key === undefined ? String(category ?? '') : t(key)
    }

    function flashCategoryIndex(category) {
      const index = FLASH_CATEGORY_ORDER.indexOf(category)
      return index < 0 ? 0 : index
    }

    function flashErrorLabel(t, error) {
      if (error?.code === 'flash_empty') return t('flashErrEmpty')
      if (error?.code === 'flash_too_large') return t('flashErrTooLarge')
      if (error?.code === 'invalid_flash_path') return t('flashErrPath')
      return String(error?.message ?? t('flashSaveFailed'))
    }

    /** Zero-decision capture: one box, Enter stores, no folder or title to pick. */
    function FlashCapture({ t, onClose, onSaved }) {
      const [text, setText] = React.useState('')
      const [category, setCategory] = React.useState('')
      const [pending, setPending] = React.useState(false)
      const [error, setError] = React.useState(null)
      const areaRef = React.useRef(null)

      React.useEffect(() => {
        const node = areaRef.current
        if (node !== null && node !== undefined && typeof node.focus === 'function') node.focus()
      }, [])

      const save = async () => {
        if (pending) return
        const value = text.trim()
        if (value.length === 0) {
          setError(t('flashErrEmpty'))
          return
        }
        setPending(true)
        setError(null)
        try {
          const data = await apiPost('/flash/create', {
            text: value,
            ...(category.length > 0 ? { category } : {}),
          })
          onSaved(data.flash)
        } catch (failure) {
          setError(flashErrorLabel(t, failure))
          setPending(false)
        }
      }

      const onKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
          return
        }
        // Enter stores; an IME candidate window must not be treated as Enter.
        if (event.key === 'Enter' && event.shiftKey !== true && event.isComposing !== true) {
          event.preventDefault()
          void save()
        }
      }

      return h(
        'div',
        {
          className: 'nb-modal',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) onClose()
          },
        },
        h(
          'div',
          { className: 'nb-modal-card nb-sync-card', role: 'dialog', 'aria-modal': 'true' },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 } },
            h('div', { className: 'nb-modal-title' }, `⚡ ${t('flashTitle')}`),
            h('button', { className: 'nb-icon-btn', onClick: onClose, 'aria-label': t('cancel') }, '×'),
          ),
          h('textarea', {
            className: 'nb-flash-textarea',
            ref: areaRef,
            value: text,
            placeholder: t('flashPlaceholder'),
            spellCheck: false,
            onKeyDown,
            onChange: (event) => setText(event.target.value),
          }),
          h(
            'div',
            { className: 'nb-flash-cats' },
            FLASH_CATEGORY_ORDER.map((value) =>
              h(
                'button',
                {
                  key: value,
                  type: 'button',
                  className: 'nb-flash-cat-chip',
                  'data-on': category === value ? '1' : '0',
                  onClick: () => setCategory(category === value ? '' : value),
                },
                flashCategoryLabel(t, value),
              ),
            ),
          ),
          error === null ? null : h('div', { className: 'nb-flash-error' }, error),
          h(
            'div',
            { className: 'nb-flash-capture-actions' },
            h('span', { className: 'nb-flash-hint' }, t('flashHint')),
            h('button', { className: 'nb-btn', onClick: onClose }, t('cancel')),
            h(
              'button',
              {
                className: 'nb-btn nb-btn-primary',
                onClick: save,
                disabled: pending || text.trim().length === 0,
              },
              pending ? '…' : t('flashCapture'),
            ),
          ),
        ),
      )
    }

    /** Triage: inbox / all / done, categories, search, pin, complete, delete, resurface. */
    function FlashPanel({ t, localeId, revision, onCapture, onOpen, onClose, onChanged }) {
      const [status, setStatus] = React.useState('inbox')
      const [category, setCategory] = React.useState('')
      const [query, setQuery] = React.useState('')
      const [data, setData] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [error, setError] = React.useState(null)
      const [confirmPath, setConfirmPath] = React.useState(null)
      const [edit, setEdit] = React.useState(null)
      const [editBusy, setEditBusy] = React.useState(false)
      const [editError, setEditError] = React.useState(null)

      React.useEffect(() => {
        let disposed = false
        setLoading(true)
        const timer = setTimeout(
          () => {
            const params = new URLSearchParams({ status, category, q: query, limit: '200' })
            apiGet(`/flash/list?${params.toString()}`)
              .then((payload) => {
                if (disposed) return
                setData(payload)
                setError(null)
              })
              .catch((failure) => {
                if (!disposed) setError(flashErrorLabel(t, failure))
              })
              .finally(() => {
                if (!disposed) setLoading(false)
              })
          },
          query.length > 0 ? 180 : 0,
        )
        return () => {
          disposed = true
          clearTimeout(timer)
        }
      }, [status, category, query, revision])

      const act = async (work) => {
        try {
          await work()
          onChanged()
        } catch (failure) {
          setError(flashErrorLabel(t, failure))
        }
      }
      const setFlags = (path, patch) => act(() => apiPost('/flash/flags', { path, ...patch }))
      const remove = (path) =>
        act(async () => {
          await apiPost('/delete', { path })
          setConfirmPath(null)
        })
      const resurface = async () => {
        try {
          const found = await apiGet('/flash/random')
          if (found.flash !== null && found.flash !== undefined) onOpen(found.flash.path)
          else setError(t('flashRandomEmpty'))
        } catch (failure) {
          setError(flashErrorLabel(t, failure))
        }
      }

      const beginEdit = async (item) => {
        setEditError(null)
        try {
          const note = await apiGet(`/read?path=${encodeURIComponent(item.path)}`)
          const split = splitFrontmatter(note.content)
          setEdit({
            path: item.path,
            text: split.body.replace(/^\n+/, ''),
            category: item.category,
            mtimeMs: note.mtimeMs,
          })
        } catch (failure) {
          setEditError(flashErrorLabel(t, failure))
        }
      }
      const saveEdit = async () => {
        if (edit === null || editBusy) return
        setEditBusy(true)
        setEditError(null)
        try {
          await apiPost('/flash/update', {
            path: edit.path,
            text: edit.text,
            category: edit.category,
            mtimeMs: edit.mtimeMs,
          })
          setEdit(null)
          onChanged()
        } catch (failure) {
          setEditError(flashErrorLabel(t, failure))
        } finally {
          setEditBusy(false)
        }
      }

      const counts = data?.counts ?? { inbox: 0, done: 0, total: 0 }
      const items = data?.items ?? []
      const localeTag = localeId === 'en' ? 'en-US' : 'zh-CN'
      const triggerLabel = (trigger) =>
        t(
          trigger === 'save'
            ? 'syncTriggerSave'
            : trigger === 'interval'
              ? 'syncTriggerInterval'
              : trigger === 'agent'
                ? 'syncTriggerAgent'
                : 'syncTriggerManual',
        )
      const tabs = [
        ['inbox', t('flashInbox')],
        ['all', t('flashAll')],
        ['done', t('flashDone')],
      ]

      return h(
        'div',
        { className: 'nb-flash' },
        h(
          'div',
          { className: 'nb-flash-head' },
          h('div', { className: 'nb-flash-title' }, `⚡ ${t('flashTitle')}`),
          h('span', { className: 'nb-flash-sub' }, t('flashPending', { count: counts.inbox })),
          h('button', { className: 'nb-btn nb-btn-primary', onClick: onCapture }, `＋ ${t('flashCapture')}`),
          h('button', { className: 'nb-btn', onClick: resurface }, `⟲ ${t('flashRandom')}`),
          h('button', { className: 'nb-icon-btn', onClick: onClose, 'aria-label': t('close') }, '×'),
        ),
        h(
          'div',
          { className: 'nb-flash-filters' },
          h(
            'div',
            { style: { display: 'flex', gap: 2 } },
            tabs.map(([value, label]) =>
              h(
                'button',
                {
                  key: value,
                  className: 'nb-flash-tab',
                  'data-on': status === value ? '1' : '0',
                  onClick: () => setStatus(value),
                },
                label,
              ),
            ),
          ),
          h(
            'div',
            { className: 'nb-flash-cats' },
            h(
              'button',
              {
                className: 'nb-flash-cat-chip',
                'data-on': category === '' ? '1' : '0',
                onClick: () => setCategory(''),
              },
              t('flashCategoryAll'),
            ),
            FLASH_CATEGORY_ORDER.map((value) =>
              h(
                'button',
                {
                  key: value,
                  className: 'nb-flash-cat-chip',
                  'data-on': category === value ? '1' : '0',
                  onClick: () => setCategory(category === value ? '' : value),
                },
                flashCategoryLabel(t, value),
              ),
            ),
          ),
          h('input', {
            className: 'nb-flash-search',
            value: query,
            placeholder: t('flashSearch'),
            onChange: (event) => setQuery(event.target.value),
          }),
        ),
        error === null ? null : h('div', { className: 'nb-flash-error' }, error),
        h(
          'div',
          { className: 'nb-flash-list' },
          loading && data === null ? h('div', { className: 'nb-flash-empty' }, t('loading')) : null,
          data !== null && items.length === 0
            ? h(
                'div',
                { className: 'nb-flash-empty' },
                status === 'done' ? t('flashEmptyDone') : query.length > 0 ? t('flashNoMatch') : t('flashEmpty'),
              )
            : null,
          items.map((item) =>
            h(
              'article',
              { key: item.path, className: `nb-flash-card${item.pinned ? ' pinned' : ''}` },
              h(
                'div',
                { className: 'nb-flash-meta' },
                h('span', { className: 'nb-flash-dot', 'data-cat': String(flashCategoryIndex(item.category)) }),
                h('span', null, flashCategoryLabel(t, item.category)),
                h('span', null, new Date(item.createdMs).toLocaleString(localeTag)),
                item.tags.map((tag) => h('span', { key: tag, className: 'nb-flash-tag' }, `#${tag}`)),
              ),
              edit !== null && edit.path === item.path
                ? h(
                    'div',
                    { className: 'nb-flash-edit' },
                    h('textarea', {
                      className: 'nb-flash-textarea nb-flash-edit-area',
                      value: edit.text,
                      onChange: (event) => setEdit({ ...edit, text: event.target.value }),
                    }),
                    h(
                      'div',
                      { className: 'nb-flash-cats' },
                      FLASH_CATEGORY_ORDER.map((value) =>
                        h(
                          'button',
                          {
                            key: value,
                            type: 'button',
                            className: 'nb-flash-cat-chip',
                            'data-on': edit.category === value ? '1' : '0',
                            onClick: () => setEdit({ ...edit, category: value }),
                          },
                          flashCategoryLabel(t, value),
                        ),
                      ),
                    ),
                    editError !== null ? h('div', { className: 'nb-flash-error' }, editError) : null,
                    h(
                      'div',
                      { className: 'nb-flash-edit-actions' },
                      h('button', { className: 'nb-flash-action', onClick: () => setEdit(null) }, t('cancel')),
                      h(
                        'button',
                        {
                          className: 'nb-flash-action',
                          'data-on': '1',
                          disabled: editBusy,
                          onClick: saveEdit,
                        },
                        t('flashSaveEdit'),
                      ),
                    ),
                  )
                : h(
                    'p',
                    { className: 'nb-flash-text', onClick: () => onOpen(item.path) },
                    item.preview.length > 0 ? item.preview : item.name,
                  ),
              h(
                'div',
                { className: 'nb-flash-actions' },
                h(
                  'button',
                  {
                    className: 'nb-flash-action',
                    'data-on': item.pinned ? '1' : '0',
                    onClick: () => setFlags(item.path, { pinned: !item.pinned }),
                  },
                  item.pinned ? t('flashUnpin') : t('flashPin'),
                ),
                h(
                  'button',
                  {
                    className: 'nb-flash-action',
                    'data-on': item.done ? '1' : '0',
                    onClick: () => setFlags(item.path, { done: !item.done }),
                  },
                  item.done ? t('flashMarkInbox') : t('flashMarkDone'),
                ),
                h('button', { className: 'nb-flash-action', onClick: () => onOpen(item.path) }, t('flashOpenNote')),
                h('button', { className: 'nb-flash-action', onClick: () => beginEdit(item) }, t('flashEdit')),
                h(
                  'button',
                  {
                    className: 'nb-flash-action danger',
                    onClick: () => {
                      if (confirmPath === item.path) void remove(item.path)
                      else setConfirmPath(item.path)
                    },
                  },
                  confirmPath === item.path ? t('flashConfirmDelete') : t('flashDelete'),
                ),
              ),
            ),
          ),
        ),
      )
    }

    /** Sync setup and manual runs, over the Host's `/api/sync/*` routes. */
    function SyncDialog({ t, localeId, onClose, onStatus, onDone }) {
      const [status, setStatus] = React.useState(null)
      const [form, setForm] = React.useState(null)
      const [pending, setPending] = React.useState(null)
      const [message, setMessage] = React.useState(null)
      const [progress, setProgress] = React.useState(null)
      const [loadError, setLoadError] = React.useState(null)
      const [historyOpen, setHistoryOpen] = React.useState(false)
      const alive = React.useRef(true)
      const poll = React.useRef(null)
      // The parent hands over a fresh callback on every render; a ref keeps the
      // mount effect stable so opening the dialog never loops.
      const notifyStatus = React.useRef(onStatus)
      notifyStatus.current = onStatus

      React.useEffect(
        () => () => {
          alive.current = false
          if (poll.current !== null) clearTimeout(poll.current)
        },
        [],
      )

      const accept = (data) => {
        if (!alive.current || data === null || data === undefined) return
        setStatus(data)
        if (typeof notifyStatus.current === 'function') notifyStatus.current(data)
      }

      const load = async () => {
        try {
          const data = await apiGet(`/sync/status?client=${SYNC_BUILD}`)
          if (!alive.current) return
          accept(data)
          setForm(syncFormFromSettings(data.settings))
          setLoadError(null)
        } catch (failure) {
          if (!alive.current) return
          setLoadError(String((failure && failure.message) || failure))
        }
      }

      React.useEffect(() => {
        void load()
      }, [])

      const update = (patch) => setForm((current) => ({ ...(current ?? {}), ...patch }))
      const refresh = async () => {
        const data = await apiGet('/sync/status').catch(() => null)
        if (data !== null) accept(data)
      }
      const persist = async () => {
        const data = await apiPost('/sync/settings', { settings: syncSettingsFromForm(form) })
        if (data !== null && data !== undefined && data.settings !== undefined) {
          setForm(syncFormFromSettings(data.settings))
        }
        return data
      }

      const save = async () => {
        if (pending !== null || form === null) return
        setPending('save')
        setMessage(null)
        try {
          await persist()
          setMessage({ kind: 'ok', text: t('syncSettingsSaved') })
          await refresh()
        } catch (failure) {
          setMessage({ kind: 'error', text: syncErrorLabel(t, failure), detail: failure.detail })
        } finally {
          setPending(null)
        }
      }

      const test = async () => {
        if (pending !== null || form === null) return
        setPending('test')
        setMessage({ kind: 'ok', text: t('syncTesting') })
        try {
          await persist()
          const probe = await apiPost('/sync/test')
          setMessage({ kind: 'ok', text: t('syncTestOk', { message: String(probe.message ?? '') }) })
        } catch (failure) {
          setMessage({ kind: 'error', text: syncErrorLabel(t, failure), detail: failure.detail })
        } finally {
          setPending(null)
          await refresh()
        }
      }

      /** Wait until the Host reports the run is over, refreshing the progress meter. */
      const pollUntilIdle = () =>
        new Promise((resolve) => {
          const deadline = Date.now() + 30 * 60 * 1000
          const tick = async () => {
            if (!alive.current) {
              resolve(null)
              return
            }
            const data = await apiGet('/sync/status').catch(() => null)
            if (!alive.current) {
              resolve(null)
              return
            }
            if (data !== null) {
              accept(data)
              setProgress(data.progress ?? null)
              if (data.busy !== true || Date.now() > deadline) {
                resolve(data)
                return
              }
            } else if (Date.now() > deadline) {
              resolve(null)
              return
            }
            poll.current = setTimeout(() => {
              void tick()
            }, 900)
          }
          poll.current = setTimeout(() => {
            void tick()
          }, 600)
        })

      const run = async () => {
        if (pending !== null || form === null) return
        setPending('run')
        setMessage(null)
        try {
          await persist()
        } catch (failure) {
          setPending(null)
          setMessage({ kind: 'error', text: syncErrorLabel(t, failure), detail: failure.detail })
          return
        }
        setMessage({ kind: 'ok', text: t('syncRunningNow') })
        try {
          await apiPost('/sync/run')
          const finished = await pollUntilIdle()
          const result = finished !== null && finished !== undefined ? finished.lastResult : null
          if (result === null || result === undefined) {
            setMessage({ kind: 'error', text: t('syncRunFail') })
            return
          }
          if (result.error !== null && result.error !== undefined) {
            setMessage({ kind: 'error', text: syncErrorLabel(t, result.error), detail: result.error.detail })
          } else {
            setMessage({
              kind: result.ok === true ? 'ok' : 'error',
              text: result.ok === true ? t('syncRunOk') : t('syncRunFail'),
              result,
            })
          }
          if (typeof onDone === 'function') onDone(result)
        } catch (failure) {
          setMessage({ kind: 'error', text: syncErrorLabel(t, failure), detail: failure.detail })
        } finally {
          if (poll.current !== null) {
            clearTimeout(poll.current)
            poll.current = null
          }
          setPending(null)
          setProgress(null)
          await refresh()
        }
      }

      const closeOnBackdrop = (event) => {
        if (event.target === event.currentTarget && pending !== 'run') onClose()
      }

      const field = (label, value, onChange, options = {}) =>
        h(
          'label',
          { className: 'nb-sync-field' },
          h('span', { className: 'nb-sync-label' }, label),
          h('input', {
            className: 'nb-sync-input',
            type: options.type ?? 'text',
            value,
            placeholder: options.placeholder ?? '',
            spellCheck: false,
            autoComplete: 'off',
            onChange: (event) => onChange(event.target.value),
          }),
          options.hint === undefined ? null : h('span', { className: 'nb-sync-hint' }, options.hint),
        )

      const header = h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 } },
        h('div', { className: 'nb-modal-title' }, t('syncTitle')),
        h(
          'button',
          { className: 'nb-icon-btn', 'aria-label': t('syncCancel'), onClick: onClose, disabled: pending === 'run' },
          '×',
        ),
      )

      if (form === null) {
        return h(
          'div',
          { className: 'nb-modal', onMouseDown: closeOnBackdrop },
          h(
            'div',
            { className: 'nb-modal-card nb-sync-card', role: 'dialog', 'aria-modal': 'true' },
            header,
            h(
              'div',
              { className: 'nb-modal-text' },
              loadError === null ? t('loading') : t('syncLoadFailed', { message: loadError }),
            ),
            loadError === null
              ? null
              : h(
                  'button',
                  {
                    className: 'nb-btn',
                    onClick: () => {
                      setLoadError(null)
                      void load()
                    },
                  },
                  t('syncRetry'),
                ),
          ),
        )
      }

      const providerHint = form.provider === 'webdav' ? t('syncHintWebdav') : form.provider === 'git' ? t('syncHintGit') : ''
      const lastSyncAt = status?.state?.lastSyncAt ?? status?.lastResult?.endedAt ?? null
      const lastResult = status?.lastResult ?? null
      const localeTag = localeId === 'en' ? 'en-US' : 'zh-CN'
      const statLine = (result) =>
        t('syncStat', {
          up: result.uploaded ?? 0,
          down: result.downloaded ?? 0,
          conflicts: result.conflicts ?? 0,
          deleted: (result.deletedLocal ?? 0) + (result.deletedRemote ?? 0),
        }) + ((result.errors?.length ?? 0) > 0 ? t('syncStatErrors', { count: result.errors.length }) : '')

      const progressBar =
        pending === 'run' && progress !== null && progress.phase === 'transfer' && progress.total > 0
          ? h(
              'div',
              { className: 'nb-sync-meter', role: 'progressbar' },
              h('i', { style: { width: `${Math.min(100, Math.round((progress.done / progress.total) * 100))}%` } }),
            )
          : null

      return h(
        'div',
        {
          className: 'nb-modal',
          onMouseDown: closeOnBackdrop,
          onKeyDown: (event) => {
            if (event.key === 'Escape' && pending !== 'run') {
              event.stopPropagation()
              onClose()
            }
          },
        },
        h(
          'div',
          { className: 'nb-modal-card nb-sync-card', role: 'dialog', 'aria-modal': 'true' },
          header,
          h(
            'div',
            { className: 'nb-sync-tabs', role: 'tablist' },
            [
              ['off', t('syncOff')],
              ['webdav', t('syncWebdav')],
              ['git', t('syncGit')],
            ].map(([value, label]) =>
              h(
                'button',
                {
                  key: value,
                  type: 'button',
                  role: 'tab',
                  className: 'nb-sync-tab',
                  'data-on': form.provider === value ? '1' : '0',
                  onClick: () => update({ provider: value }),
                },
                label,
              ),
            ),
          ),
          providerHint.length > 0 ? h('div', { className: 'nb-sync-hint' }, providerHint) : null,
          form.provider === 'webdav'
            ? h(
                'div',
                { className: 'nb-sync-group' },
                field(t('syncWebdavUrl'), form.webdavUrl, (value) => update({ webdavUrl: value }), {
                  placeholder: 'https://dav.example.com/remote.php/dav/files/me',
                  hint: t('syncWebdavUrlHint'),
                }),
                h(
                  'div',
                  { className: 'nb-sync-row' },
                  field(t('syncUsername'), form.webdavUser, (value) => update({ webdavUser: value })),
                  field(t('syncPassword'), form.webdavPassword, (value) => update({ webdavPassword: value }), {
                    type: 'password',
                  }),
                ),
                field(t('syncRemotePath'), form.webdavPath, (value) => update({ webdavPath: value }), {
                  placeholder: t('syncRemotePath'),
                }),
              )
            : null,
          form.provider === 'git'
            ? h(
                'div',
                { className: 'nb-sync-group' },
                field(t('syncGitRemote'), form.gitRemote, (value) => update({ gitRemote: value }), {
                  placeholder: 'git@example.com:me/notes.git',
                  hint: t('syncGitRemoteHint'),
                }),
                h(
                  'div',
                  { className: 'nb-sync-row' },
                  field(t('syncGitBranch'), form.gitBranch, (value) => update({ gitBranch: value }), {
                    placeholder: 'main',
                  }),
                  field(t('syncGitMessage'), form.gitMessage, (value) => update({ gitMessage: value }), {
                    placeholder: 'notebook sync',
                  }),
                ),
                h(
                  'div',
                  { className: 'nb-sync-row' },
                  field(t('syncGitUser'), form.gitUser, (value) => update({ gitUser: value }), {
                    placeholder: 'git',
                  }),
                  field(t('syncGitPassword'), form.gitPassword, (value) => update({ gitPassword: value }), {
                    type: 'password',
                    placeholder: '••••••',
                  }),
                ),
                h('div', { className: 'nb-sync-hint' }, t('syncGitAuthHint')),
                h(
                  'label',
                  { className: 'nb-sync-check' },
                  h('input', {
                    type: 'checkbox',
                    checked: form.gitSystemSsh === true,
                    onChange: (event) => update({ gitSystemSsh: event.target.checked }),
                  }),
                  t('syncGitSystemSsh'),
                ),
              )
            : null,
          form.provider === 'off'
            ? null
            : h(
                'div',
                { className: 'nb-sync-group' },
                h(
                  'label',
                  { className: 'nb-sync-check' },
                  h('input', {
                    type: 'checkbox',
                    checked: form.onSave === true,
                    onChange: (event) => update({ onSave: event.target.checked }),
                  }),
                  t('syncAutoSave'),
                ),
                h(
                  'label',
                  { className: 'nb-sync-field' },
                  h('span', { className: 'nb-sync-label' }, t('syncInterval')),
                  h('input', {
                    className: 'nb-sync-input',
                    type: 'number',
                    min: 0,
                    max: 1440,
                    value: form.interval,
                    onChange: (event) => update({ interval: event.target.value }),
                  }),
                ),
                h(
                  'label',
                  { className: 'nb-sync-field' },
                  h('span', { className: 'nb-sync-label' }, t('syncDeletes')),
                  h(
                    'select',
                    {
                      className: 'nb-sync-input',
                      value: form.deletes,
                      onChange: (event) => update({ deletes: event.target.value }),
                    },
                    h('option', { value: 'trash' }, t('syncDeletesTrash')),
                    h('option', { value: 'keep' }, t('syncDeletesKeep')),
                  ),
                ),
              ),
          h(
            'div',
            { className: 'nb-sync-status', 'data-kind': message !== null ? message.kind : 'ok' },
            progressBar,
            pending === 'run'
              ? h('div', { className: 'nb-sync-note' }, t('syncRunningNow'))
              : h('div', { className: 'nb-sync-note' }, lastSyncAt === null ? t('syncNever') : t('syncLast', { time: new Date(lastSyncAt).toLocaleString(localeTag) })),
            status?.state?.files !== undefined && status.state.files > 0
              ? h('div', null, t('syncTracked', { count: status.state.files }))
              : null,
            lastResult !== null && lastResult !== undefined && pending !== 'run'
              ? h(
                  'div',
                  { className: 'nb-sync-note' },
                  `${lastResult.ok ? t('syncRunOk') : t('syncRunFail')} · ${statLine(lastResult)}`,
                )
              : null,
            message !== null ? h('div', { className: 'nb-sync-note' }, message.text) : null,
            message?.result !== null && message?.result !== undefined
              ? h('div', { className: 'nb-sync-note' }, statLine(message.result))
              : null,
            message?.result?.notes?.length > 0
              ? h('div', { className: 'nb-sync-detail' }, message.result.notes.slice(0, 8).join('\n'))
              : null,
            message?.result?.errors?.length > 0
              ? h(
                  'div',
                  { className: 'nb-sync-detail' },
                  message.result.errors
                    .slice(0, 8)
                    .map((error) => `${error.path}: ${syncErrorLabel(t, error)}`)
                    .join('\n'),
                )
              : null,
            message?.detail !== undefined
              ? h('div', { className: 'nb-sync-detail' }, String(message.detail))
              : null,
          ),
          status !== null && Array.isArray(status.runs) && status.runs.length > 0
            ? h(
                'div',
                { className: 'nb-sync-history' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'nb-sync-history-toggle',
                    'aria-expanded': historyOpen,
                    onClick: () => setHistoryOpen((open) => !open),
                  },
                  `${historyOpen ? '▾' : '▸'} ${t('syncHistory')} (${status.runs.length})`,
                ),
                historyOpen
                  ? h(
                      'div',
                      { className: 'nb-sync-history-list' },
                      status.runs.slice(0, 10).map((run) =>
                        h(
                          'div',
                          {
                            key: run.id,
                            className: 'nb-sync-history-row',
                            'data-ok': run.ok === true ? '1' : '0',
                          },
                          h(
                            'span',
                            { className: 'nb-sync-history-time' },
                            new Date(run.endedAt ?? run.startedAt).toLocaleString(localeTag),
                          ),
                          h('span', { className: 'nb-sync-history-trigger' }, triggerLabel(run.trigger)),
                          h(
                            'span',
                            { className: 'nb-sync-history-stat' },
                            t('syncStat', {
                              up: run.uploaded ?? 0,
                              down: run.downloaded ?? 0,
                              conflicts: run.conflicts ?? 0,
                              deleted: (run.deletedLocal ?? 0) + (run.deletedRemote ?? 0),
                            }),
                          ),
                          run.error !== null && run.error !== undefined
                            ? h(
                                'span',
                                { className: 'nb-sync-history-error' },
                                syncErrorLabel(t, run.error),
                              )
                            : null,
                        ),
                      ),
                    )
                  : null,
              )
            : null,
          h(
            'div',
            { className: 'nb-sync-actions' },
            h('button', { className: 'nb-btn', onClick: test, disabled: pending !== null }, t('syncTest')),
            h('button', { className: 'nb-btn', onClick: save, disabled: pending !== null }, t('syncSave')),
            h('span', { className: 'nb-sync-spacer' }),
            h('button', { className: 'nb-btn', onClick: onClose, disabled: pending === 'run' }, t('syncCancel')),
            h(
              'button',
              { className: 'nb-btn nb-btn-primary', onClick: run, disabled: pending !== null || form.provider === 'off' },
              pending === 'run' ? t('syncRunningNow') : t('syncRun'),
            ),
          ),
        ),
      )
    }

    /** The active locale id as `en` / `zh`, for Host prompts. */
    function activeLocaleId(locale) {
      try {
        const snapshot = typeof locale?.getSnapshot === 'function' ? locale.getSnapshot() : locale?.getLocale?.()
        const id = typeof snapshot === 'string' ? snapshot : snapshot?.active
        return typeof id === 'string' && id.toLowerCase().startsWith('en') ? 'en' : 'zh'
      } catch {
        return 'zh'
      }
    }

    /** Local `YYYY-MM-DD` for a Date (the heatmap follows the user's day). */
    function localDayKey(date) {
      const pad = (value) => String(value).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    }

    function addLocalDays(date, days) {
      const next = new Date(date.getFullYear(), date.getMonth(), date.getDate())
      next.setDate(next.getDate() + days)
      return next
    }

    /** Five levels, relative to the busiest day (0 = nothing written). */
    function writingLevel(chars, max) {
      if (!(Number(chars) > 0)) return 0
      const ratio = Number(max) > 0 ? Number(chars) / Number(max) : 1
      if (ratio <= 0.25) return 1
      if (ratio <= 0.5) return 2
      if (ratio <= 0.75) return 3
      return 4
    }

    /**
     * GitHub-style grid: Monday-first columns, ending with the current week.
     * Returns every cell (future days are flagged) so the layout is stable.
     */
    function writingHeatmap(days, weeks, todayMs) {
      const map = days !== null && typeof days === 'object' ? days : {}
      const values = Object.values(map).map(Number).filter((value) => Number.isFinite(value) && value > 0)
      const max = values.length > 0 ? Math.max(...values) : 0
      const today = new Date(todayMs ?? Date.now())
      const weekStart = addLocalDays(today, -((today.getDay() + 6) % 7))
      const count = Math.max(1, Math.round(Number(weeks) || 18))
      const first = addLocalDays(weekStart, -(count - 1) * 7)
      const columns = []
      for (let column = 0; column < count; column += 1) {
        const cells = []
        for (let row = 0; row < 7; row += 1) {
          const date = addLocalDays(first, column * 7 + row)
          const key = localDayKey(date)
          const chars = Number(map[key]) || 0
          const future = date.getTime() > today.getTime()
          cells.push({ date: key, chars, future, level: future ? 0 : writingLevel(chars, max) })
        }
        columns.push(cells)
      }
      return { weeks: columns, max }
    }

    function formatWritingCount(value) {
      const number = Math.round(Number(value) || 0)
      return number.toLocaleString()
    }

    /** One GitHub-style contribution grid; `compact` fits the sidebar. */
    function WritingHeatmap({ t, days, weeks, compact, labels }) {
      const grid = React.useMemo(() => writingHeatmap(days, weeks), [days, weeks])
      const months = React.useMemo(() => {
        let previous = -1
        return grid.weeks.map((cells) => {
          const date = new Date(`${cells[0].date}T12:00:00`)
          const month = date.getMonth()
          const label = month === previous ? '' : date.toLocaleDateString(undefined, { month: 'short' })
          previous = month
          return label
        })
      }, [grid])
      return h(
        'div',
        { className: `nb-heat${compact === true ? ' compact' : ''}` },
        labels === true
          ? h(
              'div',
              { className: 'nb-heat-months', 'aria-hidden': 'true' },
              months.map((label, index) =>
                h('span', { key: `m-${index}`, className: 'nb-heat-month' }, label),
              ),
            )
          : null,
        h(
          'div',
          { className: 'nb-heat-grid', role: 'img', 'aria-label': t('writingHeatmap') },
          grid.weeks.map((cells, column) =>
            h(
              'div',
              { key: `w-${column}`, className: 'nb-heat-week' },
              cells.map((cell) =>
                h('span', {
                  key: cell.date,
                  className: 'nb-heat-cell',
                  'data-level': String(cell.level),
                  'data-future': cell.future ? '1' : undefined,
                  title: `${cell.date} · ${formatWritingCount(cell.chars)} ${t('characters')}`,
                }),
              ),
            ),
          ),
        ),
      )
    }

    function Workbench({ t, locale }) {
      useLocaleTick(locale)
      const [status, setStatus] = React.useState(null)
      const [notes, setNotes] = React.useState([])
      const [folderList, setFolderList] = React.useState([])
      const [selected, setSelected] = React.useState(null)
      const [blocks, setBlocks] = React.useState([])
      const [editingId, setEditingId] = React.useState(null)
      const [focusRequest, setFocusRequest] = React.useState(null)
      const [menuFor, setMenuFor] = React.useState(null)
      const [search, setSearch] = React.useState('')
      const [hits, setHits] = React.useState(null)
      const [saveState, setSaveState] = React.useState('saved')
      const [notice, setNotice] = React.useState(null)
      React.useEffect(() => {
        // A success toast is an acknowledgement, not a task: fade it out.
        if (notice === null || notice.kind !== 'ok') return undefined
        const timer = setTimeout(() => setNotice(null), 3200)
        return () => clearTimeout(timer)
      }, [notice])
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
      const [canvasView, setCanvasView] = React.useState(null)
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
      const [folderBodyOpen, setFolderBodyOpen] = React.useState(false)
      const [syncRemote, setSyncRemote] = React.useState(null)
      const [syncOpen, setSyncOpen] = React.useState(false)
      const [syncStatus, setSyncStatus] = React.useState(null)
      React.useEffect(() => {
        let disposed = false
        apiGet(`/sync/status?client=${SYNC_BUILD}`)
          .then((data) => {
            if (!disposed) setSyncStatus(data)
          })
          .catch(() => {})
        return () => {
          disposed = true
        }
      }, [])
      const [flashOpen, setFlashOpen] = React.useState(false)
      const [flashCapture, setFlashCapture] = React.useState(false)
      const [flashRevision, setFlashRevision] = React.useState(0)
      const [flashCounts, setFlashCounts] = React.useState(null)
      const [jumpTick, setJumpTick] = React.useState(0)
      const [flashTabOpen, setFlashTabOpen] = React.useState(() => {
        try {
          return window.localStorage.getItem(`${NS}:flash-tab`) === '1'
        } catch {
          return false
        }
      })
      React.useEffect(() => {
        try {
          window.localStorage.setItem(`${NS}:flash-tab`, flashTabOpen ? '1' : '0')
        } catch {
          /* preferences are best-effort */
        }
      }, [flashTabOpen])
      React.useEffect(() => {
        let disposed = false
        apiGet('/flash/summary')
          .then((data) => {
            if (!disposed) setFlashCounts(data.counts)
          })
          .catch(() => {})
        return () => {
          disposed = true
        }
      }, [flashRevision, flashOpen])
      React.useEffect(() => {
        const open = () => setFlashCapture(true)
        FLASH_CAPTURE.listeners.add(open)
        if (takePendingFlashCapture()) setFlashCapture(true)
        return () => {
          FLASH_CAPTURE.listeners.delete(open)
        }
      }, [])
      const [askOpen, setAskOpen] = React.useState(() => {
        try {
          return window.localStorage.getItem(`${NS}:ask-open`) === '1'
        } catch {
          return false
        }
      })
      const [askThreads, setAskThreads] = React.useState(() => {
        const seed = {}
        for (const [key, thread] of ASK_THREADS) seed[key] = thread
        return seed
      })
      const [askInput, setAskInput] = React.useState('')
      const [askBusy, setAskBusy] = React.useState(false)
      const [askError, setAskError] = React.useState(null)
      const [askFlash, setAskFlash] = React.useState(null)
      const [askSelection, setAskSelection] = React.useState('')
      const [askModel, setAskModel] = React.useState('')
      const [vaultError, setVaultError] = React.useState(null)
      const [askMode, setAskMode] = React.useState(() => {
        try {
          return window.localStorage.getItem(`${NS}:ask-mode`) === 'agent' ? 'agent' : 'note'
        } catch {
          return 'note'
        }
      })
      const askThread = selected === null ? [] : (askThreads[askThreadKeyFor(selected)] ?? [])
      const [vaultTemplates, setVaultTemplates] = React.useState(null)
      const [propsTagList, setPropsTagList] = React.useState([])
      const [propsTagDraft, setPropsTagDraft] = React.useState('')
      const [propsAliases, setPropsAliases] = React.useState('')
      const [propsDraft, setPropsDraft] = React.useState({})
      const [remoteConfig, setRemoteConfig] = React.useState(null)
      const [backlinks, setBacklinks] = React.useState([])
      const [favorites, setFavorites] = React.useState([])
      const [recent, setRecent] = React.useState([])
      const [writing, setWriting] = React.useState(null)
      const writingBusy = React.useRef(false)
      const writingRetried = React.useRef(false)

      async function loadWriting() {
        if (writingBusy.current) return
        writingBusy.current = true
        try {
          const data = await apiGet('/stats/writing')
          setWriting(data)
        } catch {
          // The panel can mount before the Host that serves the route is
          // reloaded; retry once instead of leaving the widget empty forever.
          if (writingRetried.current !== true) {
            writingRetried.current = true
            window.setTimeout(() => {
              void loadWriting()
            }, 4000)
          }
        } finally {
          writingBusy.current = false
        }
      }

      React.useEffect(() => {
        void loadWriting()
      }, [])

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
      // The chat tool cards can ask this panel for a note while it is open;
      // the ref keeps the latest openNote closure out of the subscription.
      const openNoteRef = React.useRef(null)
      openNoteRef.current = openNote
      const openHistoryRef = React.useRef(null)
      openHistoryRef.current = openHistoryFor
      // The sync poll and the focus reporter run from closures created once, so
      // they read the live editor state through refs instead of stale props.
      const saveStateRef = React.useRef('saved')
      saveStateRef.current = saveState
      const syncDismissedRef = React.useRef(0)
      const reloadFromDiskRef = React.useRef(null)
      reloadFromDiskRef.current = reloadFromDisk
      const askAbortRef = React.useRef(null)
      const askBusyRef = React.useRef(false)
      const askThreadRef = React.useRef(null)
      const askInputRef = React.useRef(null)
      const askFlashTimer = React.useRef(null)

      React.useEffect(
        () =>
          subscribeNoteOpen((request) => {
            if (openNoteRef.current === null) return
            void Promise.resolve(openNoteRef.current(request.path)).then(() => {
              if (request.history === true && openHistoryRef.current !== null) openHistoryRef.current(request.path)
            })
          }),
        [],
      )

      React.useEffect(() => {
        const pending = SEARCH_JUMP.pending
        if (pending === null || pending.path !== selected) return undefined
        const needle = pending.needle
        let attempts = 0
        let timer = null
        const tryScroll = () => {
          const root = scrollRef.current
          if (root !== null && needle.length > 0) {
            for (const node of root.querySelectorAll('.nb-b')) {
              const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
              if (!text.includes(needle)) continue
              node.scrollIntoView({ block: 'center', behavior: 'smooth' })
              node.classList.add('nb-flash-hit')
              setTimeout(() => node.classList.remove('nb-flash-hit'), 1800)
              SEARCH_JUMP.pending = null
              return
            }
          }
          attempts += 1
          if (attempts >= 12) {
            SEARCH_JUMP.pending = null
            return
          }
          timer = setTimeout(tryScroll, 120)
        }
        timer = setTimeout(tryScroll, 60)
        return () => {
          if (timer !== null) clearTimeout(timer)
        }
      }, [selected, blocks, jumpTick])

      React.useEffect(() => {
        const toggle = () => setAskOpen((open) => !open)
        const open = () => setAskOpen(true)
        ASK_TOGGLE.listeners.add(toggle)
        ASK_OPEN.listeners.add(open)
        if (takePendingAskOpen()) setAskOpen(true)
        return () => {
          ASK_TOGGLE.listeners.delete(toggle)
          ASK_OPEN.listeners.delete(open)
        }
      }, [])

      // Tell the Host which block is being edited, so the agent's prompt context
      // can resolve "这段 / 这里" to the actual paragraph. Debounced: typing
      // updates it at most every ~700ms.
      React.useEffect(() => {
        if (selected === null || editingId === null) return undefined
        const payload = focusPayloadFor(blocks, editingId)
        if (payload === null) return undefined
        const timer = setTimeout(() => {
          apiPost('/focus', { path: selected, ...payload }).catch(() => {})
        }, 700)
        return () => clearTimeout(timer)
      }, [editingId, blocks, selected])

      // The agent (or Obsidian, or another window) can rewrite the open note.
      // Poll a cheap stat: a clean idle page reloads by itself, a page with the
      // caret in it asks first, and unsaved edits keep the conflict protection.
      React.useEffect(() => {
        if (selected === null) return undefined
        let disposed = false
        let running = false
        const tick = async () => {
          if (disposed || running || document.hidden) return
          running = true
          try {
            const stat = await apiGet(`/stat?path=${encodeURIComponent(selected)}`)
            if (disposed || stat.exists !== true || stat.mtimeMs === mtimeRef.current) return
            if (stat.mtimeMs === syncDismissedRef.current) return
            const decision = noteSyncDecision({
              saved: saveStateRef.current === 'saved',
              editing: editingIdRef.current !== null,
            })
            if (decision === 'reload') await reloadFromDiskRef.current()
            else if (decision === 'warn') setSyncRemote(stat.mtimeMs)
          } catch {
            /* a restarting Host is not a content change */
          } finally {
            running = false
          }
        }
        const timer = setInterval(tick, 3000)
        return () => {
          disposed = true
          clearInterval(timer)
        }
      }, [selected])

      /**
       * Re-read the open note from disk without saving over it: used when the
       * file changed underneath the panel. Undo history restarts because the
       * snapshots before the external change are no longer this document.
       */
      async function reloadFromDisk() {
        const path = selectedRef.current
        if (path === null) return
        try {
          const data = await apiGet(`/read?path=${encodeURIComponent(path)}`)
          if (path !== selectedRef.current) return
          const split = splitFrontmatter(data.content)
          const parsed = parseBlocks(split.body)
          frontmatterRef.current = split.frontmatter
          setFrontmatter(split.frontmatter)
          baselineRef.current = composeContent(split.frontmatter, serializeBlocks(parsed))
          mtimeRef.current = data.mtimeMs
          updateBlocks(parsed, { record: false })
          historyRef.current = { past: [], future: [], lastKey: null, lastAt: 0 }
          syncDismissedRef.current = 0
          setSyncRemote(null)
          setEditingId(null)
          setSaveState('saved')
        } catch (error) {
          setNotice({ kind: 'error', text: error.message })
        }
      }

      // Each note keeps its own thread, so switching back finds the answers
      // again; only the draft and an in-flight answer belong to the old note.
      React.useEffect(() => {
        setAskInput('')
        setAskError(null)
        setAskBusy(false)
        setAskSelection('')
        if (askAbortRef.current !== null) {
          askAbortRef.current.abort()
          askAbortRef.current = null
        }
      }, [selected])

      React.useEffect(() => {
        try {
          window.localStorage.setItem(`${NS}:ask-open`, askOpen ? '1' : '0')
        } catch {
          /* preferences are best-effort */
        }
      }, [askOpen])

      React.useEffect(() => {
        try {
          window.localStorage.setItem(`${NS}:ask-mode`, askMode)
        } catch {
          /* preferences are best-effort */
        }
      }, [askMode])

      // The selection a question may be about: captured when the panel opens
      // (a button click keeps the document selection), then kept up to date
      // without being cleared by typing into the ask box.
      const captureAskSelection = () => {
        try {
          const selection = typeof window.getSelection === 'function' ? window.getSelection() : null
          if (selection === null || selection === undefined || selection.isCollapsed === true) return ''
          const text = normalizeSelectionText(selection.toString())
          if (text.length === 0) return ''
          const anchor = selection.anchorNode
          const element =
            anchor === null || anchor === undefined ? null : anchor.nodeType === 1 ? anchor : anchor.parentElement
          if (element === null || typeof element.closest !== 'function' || element.closest('.nb-doc') === null) return ''
          return text
        } catch {
          return ''
        }
      }

      React.useEffect(() => {
        if (!askOpen) return undefined
        const element = askInputRef.current
        if (element !== null) element.focus()
        setAskSelection((previous) => (previous.length > 0 ? previous : captureAskSelection()))
        const onSelectionChange = () => {
          const next = captureAskSelection()
          if (next.length > 0) setAskSelection(next)
        }
        document.addEventListener('selectionchange', onSelectionChange)
        return () => document.removeEventListener('selectionchange', onSelectionChange)
      }, [askOpen])

      React.useEffect(
        () => () => {
          if (askAbortRef.current !== null) askAbortRef.current.abort()
          if (askFlashTimer.current !== null) clearTimeout(askFlashTimer.current)
        },
        [],
      )

      React.useEffect(() => {
        const element = askThreadRef.current
        if (element !== null) element.scrollTop = element.scrollHeight
      }, [askThread])

      function updateAskThread(path, update) {
        setAskThreads((previous) => {
          const key = askThreadKeyFor(path)
          const next = update(previous[key] ?? [])
          rememberAskThread(key, next)
          return { ...previous, [key]: next }
        })
      }

      function updateAskAnswer(path, text) {
        updateAskThread(path, (previous) => {
          const next = previous.slice()
          for (let index = next.length - 1; index >= 0; index -= 1) {
            if (next[index].role === 'assistant') {
              next[index] = { role: 'assistant', text }
              return next
            }
          }
          return previous
        })
      }

      function flashAsk(type, index) {
        setAskFlash({ type, index })
        if (askFlashTimer.current !== null) clearTimeout(askFlashTimer.current)
        askFlashTimer.current = setTimeout(() => setAskFlash(null), 1400)
      }

      function copyAsk(text) {
        try {
          if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            navigator.clipboard.writeText(text).catch(() => {})
          }
        } catch {
          /* clipboard unavailable */
        }
      }

      /** Append one answer to the open note as real blocks (undoable). */
      function insertAsk(text) {
        const parsed = parseBlocks(text)
        if (parsed.length === 0) return false
        updateBlocks(insertAfterBlock(blocksRef.current, editingIdRef.current, parsed))
        setSaveState('unsaved')
        return true
      }

      function startAskTurn(path, question, history) {
        updateAskThread(path, (previous) => [
          ...previous,
          { role: 'user', text: question },
          { role: 'assistant', text: '' },
        ])
        void runAsk(path, question, history)
      }

      async function sendAsk(override) {
        const question = (typeof override === 'string' ? override : askInput).trim()
        if (question.length === 0 || askBusyRef.current || selected === null) return
        const path = selected
        const history = askThread
          .filter((message) => message.text.length > 0)
          .slice(-8)
          .map((message) => ({ role: message.role, text: message.text }))
        setAskInput('')
        setAskError(null)
        startAskTurn(path, question, history)
      }

      /** Re-run the last question without adding a second copy of it. */
      function retryAsk() {
        if (askBusyRef.current || selected === null) return
        const path = selected
        const thread = askThreads[askThreadKeyFor(path)] ?? []
        const index = lastUserIndex(thread)
        if (index < 0) return
        const question = thread[index].text
        const history = thread
          .slice(0, index)
          .filter((message) => message.text.length > 0)
          .slice(-8)
          .map((message) => ({ role: message.role, text: message.text }))
        setAskError(null)
        updateAskThread(path, (previous) => [
          ...previous.slice(0, index),
          { role: 'user', text: question },
          { role: 'assistant', text: '' },
        ])
        void runAsk(path, question, history)
      }

      async function runAsk(path, question, history) {
        if (askBusyRef.current) return
        askBusyRef.current = true
        setAskBusy(true)
        const controller = new AbortController()
        askAbortRef.current = controller
        let answer = ''
        const agentMode = askMode === 'agent'
        const setAnswerSteps = (steps) => {
          updateAskThread(path, (previous) => {
            const next = previous.slice()
            for (let index = next.length - 1; index >= 0; index -= 1) {
              if (next[index].role === 'assistant') {
                next[index] = { ...next[index], steps }
                return next
              }
            }
            return previous
          })
        }
        const bumpAnswerStep = () => {
          updateAskThread(path, (previous) => {
            const next = previous.slice()
            for (let index = next.length - 1; index >= 0; index -= 1) {
              if (next[index].role === 'assistant') {
                next[index] = { ...next[index], steps: (Number(next[index].steps) || 0) + 1 }
                return next
              }
            }
            return previous
          })
        }
        try {
          const response = await fetch(`${API}${agentMode ? '/ask/agent' : '/ask'}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              path,
              question,
              history: agentMode ? undefined : history,
              locale: activeLocaleId(locale),
              selection: askSelection,
            }),
            signal: controller.signal,
          })
          if (!response.ok) {
            const payload = await response.json().catch(() => null)
            throw new Error((payload !== null && payload.error) || `HTTP ${response.status}`)
          }
          await readSse(response, (event) => {
            if (event.type === 'meta') {
              setAskModel([event.provider, event.model].filter(Boolean).join('/'))
              return
            }
            if (event.type === 'step') {
              bumpAnswerStep()
              return
            }
            if (event.type === 'answer' && typeof event.text === 'string') {
              answer = event.text
              updateAskAnswer(path, answer)
              if (Array.isArray(event.steps) && event.steps.length > 0) setAnswerSteps(event.steps.length)
              return
            }
            if (event.type === 'delta' && typeof event.text === 'string') {
              answer += event.text
              updateAskAnswer(path, answer)
              return
            }
            if (event.type === 'error') {
              throw new Error(String(event.error ?? '模型调用失败。'))
            }
          })
        } catch (error) {
          if (error !== null && error !== undefined && error.name !== 'AbortError') {
            setAskError(error.message ?? String(error))
            updateAskAnswer(path, answer)
          }
        } finally {
          askBusyRef.current = false
          setAskBusy(false)
          if (askAbortRef.current === controller) askAbortRef.current = null
        }
      }

      function stopAsk() {
        if (askAbortRef.current !== null) askAbortRef.current.abort()
      }

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

      // Cmd/Ctrl+K palette rows: commands first, then matching notes. Commands
      // close the palette before running so their dialogs own the focus.
      const quickActions = [
        { id: 'new', label: t('paletteNewNote'), icon: '＋', run: () => openTemplates() },
        { id: 'flash', label: t('flashCapture'), icon: '⚡', run: () => setFlashCapture(true) },
        {
          id: 'flash-list',
          label: t('flashTitle'),
          icon: '⚡',
          run: () => {
            setFlashTabOpen(true)
            setFlashOpen(true)
          },
        },
        { id: 'ask', label: t('askAi'), icon: '✨', run: () => setAskOpen(true) },
        { id: 'stats', label: t('writingHeatmap'), icon: '▦', run: () => setDialog({ kind: 'stats' }) },
        { id: 'zen', label: zen ? t('exitZen') : t('zenMode'), icon: '◨', run: () => setZenMode(!zen) },
        { id: 'reading', label: reading ? t('exitReading') : t('readingMode'), icon: '◐', run: () => setReading(!reading) },
        { id: 'wide', label: wide ? t('narrowMode') : t('wideMode'), icon: '⇔', run: () => setWide(!wide) },
        { id: 'props', label: t('propsTitle'), icon: '≡', run: () => openProps() },
        { id: 'history', label: t('historyTitle'), icon: '⟲', run: () => openHistory() },
        { id: 'graph', label: t('graphTitle'), icon: '◌', run: () => setDialog({ kind: 'graph' }) },
        { id: 'shortcuts', label: t('shortcutsTitle'), icon: '⌘', run: () => setDialog({ kind: 'shortcuts' }) },
        { id: 'export', label: t('exportMarkdown'), icon: '⇩', run: () => exportMarkdown() },
      ].filter((action) => selected !== null || !['props', 'history', 'graph', 'export'].includes(action.id))

      const quickRows = React.useMemo(
        () => paletteRows(quickActions, notes, quickQuery),
        [quickActions, notes, quickQuery],
      )

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
          const [data, canvasData] = await Promise.all([
            apiGet('/list'),
            apiGet('/canvases').catch(() => ({ files: [] })),
          ])
          const canvasItems = Array.isArray(canvasData?.files) ? canvasData.files : []
          setNotes([...(Array.isArray(data.notes) ? data.notes : []), ...canvasItems])
          setFolderList(Array.isArray(data.folders) ? data.folders : [])
          setStatus(data.vault ?? null)
          setVaultError(null)
          return true
        } catch (error) {
          // A missing vault gets its own first-run screen instead of a toast
          // over an empty sidebar; other failures keep the toast only.
          setVaultError(error.code === 'no_vault' ? error.message : null)
          setNotice({ kind: 'error', text: error.message })
          return false
        }
      }, [])

      // The Settings row switched the vault: drop the old page and reload from
      // the new folder instead of leaving a note from the previous vault open.
      React.useEffect(() => {
        const onVaultChanged = () => {
          try {
            window.localStorage.removeItem(LAST_NOTE_KEY)
            window.localStorage.removeItem(TABS_KEY)
          } catch {
            /* preferences are best-effort */
          }
          selectedRef.current = null
          blocksRef.current = []
          mtimeRef.current = 0
          setSelected(null)
          setBlocks([])
          setTabs([])
          setRecent([])
          setEditingId(null)
          setSaveState('saved')
          void loadList()
        }
        if (VAULT_CHANGED.pending) {
          VAULT_CHANGED.pending = false
          onVaultChanged()
        }
        window.addEventListener('dsh-notebook:vault-changed', onVaultChanged)
        return () => window.removeEventListener('dsh-notebook:vault-changed', onVaultChanged)
      }, [loadList])

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
          // A chat tool card may have asked for a note before this panel
          // mounted; that request outranks the remembered last page.
          // Otherwise reopen the page the user last had open, like Notion
          // does, when it still exists in the vault.
          try {
            const requested = takePendingNoteOpen()
            const target = requested !== null ? requested.path : window.localStorage.getItem(LAST_NOTE_KEY)
            if (target !== null && target.length > 0) {
              const exists = await apiGet('/list')
                .then((data) => (Array.isArray(data.notes) ? data.notes.some((note) => note.path === target) : false))
                .catch(() => false)
              if (exists && !disposed) {
                await openNote(target)
                if (requested !== null && requested.history === true) await openHistoryFor(target)
              }
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

      // Drop any stale title text from the previous note when the page changes.
      React.useEffect(() => {
        const element = titleRef.current
        if (element !== null) element.textContent = currentTitle
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [selected])

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
          // A text selection that spans several blocks deletes those blocks,
          // the way Notion treats a multi-block selection.
          if (event.key === 'Backspace' || event.key === 'Delete') {
            const live = window.getSelection ? window.getSelection() : null
            if (live !== null && live.isCollapsed === false && live.rangeCount > 0) {
              const range = live.getRangeAt(0)
              const doc = document.querySelector('.nb-doc')
              if (doc !== null && doc.contains(range.commonAncestorContainer)) {
                const ids = Array.from(doc.querySelectorAll('[data-block]'))
                  .filter((block) => range.intersectsNode(block))
                  .map((block) => block.getAttribute('data-block'))
                  .filter((id) => typeof id === 'string' && id.length > 0)
                if (ids.length > 1) {
                  event.preventDefault()
                  deleteBlocksByIds(ids)
                  return
                }
              }
            }
          }
          if (event.key === 'Escape' && zenRef.current === true && editingIdRef.current === null) {
            event.preventDefault()
            setZenMode(false)
            return
          }
          if (!(event.metaKey || event.ctrlKey)) return
          const key = String(event.key).toLowerCase()
          if (key === 'p' || key === 'k') {
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
          void loadWriting()
        } catch (error) {
          setSaveState('error')
          if (saveFailureKind(error !== null && error !== undefined ? error.code : undefined) === 'sync') {
            setSyncRemote(-1)
          } else {
            setNotice({ kind: 'error', text: error.message })
          }
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

      async function openCanvas(path) {
        const target = String(path ?? '')
        setSelected(null)
        selectedRef.current = null
        setCanvasView({ path: target, nodes: [], edges: [], loading: true, error: '' })
        try {
          const data = await apiGet(`/canvas?path=${encodeURIComponent(target)}`)
          const opened = data.path ?? target
          setCanvasView({
            path: opened,
            nodes: Array.isArray(data.nodes) ? data.nodes : [],
            edges: Array.isArray(data.edges) ? data.edges : [],
            loading: false,
            error: '',
          })
          setTabs((previous) => (previous.includes(opened) ? previous : [...previous, opened]))
          setRecent((previous) => [opened, ...previous.filter((item) => item !== opened)].slice(0, 6))
        } catch (error) {
          setCanvasView({ path: target, nodes: [], edges: [], loading: false, error: error.message })
        }
      }

      async function openNote(path) {
        setFlashOpen(false)
        if (String(path ?? '').toLowerCase().endsWith('.canvas')) {
          await openCanvas(path)
          return
        }
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
          // Reveal the note in the folder tree: expand every ancestor folder.
          if (data.path.includes('/')) {
            const parent = data.path.slice(0, data.path.lastIndexOf('/'))
            setExpanded((previous) => expandedPath(previous, parent))
          }
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
          setFolderBodyOpen(false)
          setSyncRemote(null)
          syncDismissedRef.current = 0
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
          const response = await fetch(`${API}/ai/stream`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ task: panel.task, text, locale: activeLocaleId(locale) }),
          })
          if (!response.ok) {
            const payload = await response.json().catch(() => null)
            throw new Error((payload !== null && payload.error) || `HTTP ${response.status}`)
          }
          let streamed = ''
          let streamFailure = null
          await readSse(response, (event) => {
            if (event.type === 'delta' && typeof event.text === 'string') {
              streamed += event.text
              setAiPanel((current) => (current === null ? current : { ...current, result: streamed }))
              return
            }
            if (event.type === 'error') {
              streamFailure = String(event.error ?? '模型调用失败。')
              return
            }
            if (event.type === 'done' && typeof event.text === 'string') streamed = event.text
          })
          if (streamFailure !== null) throw new Error(streamFailure)
          setAiPanel((current) =>
            current === null ? current : { ...current, loading: false, result: streamed },
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

      /** Persist the collection's view/filter/sort into the page frontmatter. */
      function saveCollectionView(next) {
        let fm = frontmatterRef.current
        fm = withFrontmatterValue(fm, 'view', next.view)
        fm = withFrontmatterValue(fm, 'filter', next.filter)
        fm = withFrontmatterValue(fm, 'sort', next.sort)
        fm = withFrontmatterValue(fm, 'groupBy', next.groupBy)
        updateFrontmatter(fm)
        setCollection((current) =>
          current === null ? current : { ...current, config: { ...current.config, ...next } },
        )
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
        setExpanded((previous) => expandedPath(previous, dir))
        try {
          const element = document.querySelector(`[data-folder="${dir}"]`)
          if (element !== null && typeof element.scrollIntoView === 'function') {
            element.scrollIntoView({
            block: 'nearest',
            behavior: prefersReducedMotion() ? 'auto' : 'smooth',
          })
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
        if (type === 'columns-2' || type === 'columns-3') {
          setSlash(null)
          setMenuFor(null)
          const count = type === 'columns-3' ? 3 : 2
          updateBlocks(
            blocksRef.current.map((block) =>
              block.id === blockId
                ? { ...block, type: 'columns', columns: Array.from({ length: count }, () => ''), text: '' }
                : block,
            ),
          )
          setEditingId(null)
          setFocusRequest(null)
          return
        }
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
          // A selection can cover several blocks (each block is its own
          // editor), so do not require the common ancestor to be one editor.
          if (element === null || typeof element.closest !== 'function' || element.closest('.nb-doc') === null) {
            clear()
            return
          }
          const edit = element.closest('.nb-b-edit')
          const blocks = Array.from(document.querySelectorAll('.nb-doc [data-block]')).filter((candidate) =>
            range.intersectsNode(candidate),
          )
          if (edit === null && blocks.length === 0) {
            clear()
            return
          }
          const block = edit !== null ? edit.closest('[data-block]') : blocks[0]
          const rect = range.getBoundingClientRect()
          if (rect.width === 0 && rect.height === 0) {
            clear()
            return
          }
          savedRangeRef.current = range.cloneRange()
          const next = {
            blockId: block === null ? null : block.getAttribute('data-block'),
            multi: edit === null || blocks.length > 1,
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

      function selectedBlockElements() {
        const selection = window.getSelection ? window.getSelection() : null
        const doc = document.querySelector('.nb-doc')
        if (selection === null || selection.rangeCount === 0 || doc === null) return []
        const range = selection.getRangeAt(0)
        return Array.from(doc.querySelectorAll('[data-block]')).filter((block) => range.intersectsNode(block))
      }

      /** Apply Markdown markers to the selected text of every selected block. */
      function formatSelectionAcrossBlocks(kind, blockEls, range) {
        const pair =
          kind === 'bold'
            ? ['**', '**']
            : kind === 'italic'
              ? ['*', '*']
              : kind === 'strikeThrough'
                ? ['~~', '~~']
                : kind === 'code'
                  ? ['`', '`']
                  : null
        if (pair === null) return
        let changed = false
        for (const element of blockEls) {
          const id = element.getAttribute('data-block')
          const block = blocksRef.current.find((item) => item.id === id)
          if (block === undefined || block.type === 'code' || block.type === 'table' || block.type === 'divider') continue
          const content = element.querySelector('.nb-b')
          const sub = range.cloneRange()
          if (content !== null) {
            if (!content.contains(sub.startContainer)) sub.setStart(content, 0)
            if (!content.contains(sub.endContainer)) sub.setEnd(content, content.childNodes.length)
          }
          const selected = sub.toString()
          if (selected.length === 0) continue
          const next = wrapMarkdownSelection(block.text ?? '', selected, pair[0], pair[1])
          if (next === null || next === block.text) continue
          changeText(id, next)
          changed = true
        }
        if (changed) {
          setSelection(null)
          const live = window.getSelection ? window.getSelection() : null
          if (live !== null) live.removeAllRanges()
        }
      }

      function formatSelection(kind) {
        const state = selectionRef.current
        if (state === null) return
        const selection = window.getSelection ? window.getSelection() : null
        if (selection === null || selection.rangeCount === 0) return
        if (state.multi === true) {
          if (kind === 'clear') return
          formatSelectionAcrossBlocks(kind, selectedBlockElements(), selection.getRangeAt(0))
          return
        }
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
        if (state.multi === true) {
          const doc = document.querySelector('.nb-doc')
          const blockEls =
            doc === null
              ? []
              : Array.from(doc.querySelectorAll('[data-block]')).filter((block) => saved.intersectsNode(block))
          const range = saved
          let changed = false
          for (const element of blockEls) {
            const id = element.getAttribute('data-block')
            const block = blocksRef.current.find((item) => item.id === id)
            if (block === undefined) continue
            const content = element.querySelector('.nb-b')
            const sub = range.cloneRange()
            if (content !== null) {
              if (!content.contains(sub.startContainer)) sub.setStart(content, 0)
              if (!content.contains(sub.endContainer)) sub.setEnd(content, content.childNodes.length)
            }
            const selected = sub.toString()
            if (selected.length === 0) continue
            const next = wrapMarkdownSelection(block.text ?? '', selected, '[', `](${url})`)
            if (next === null || next === block.text) continue
            changeText(id, next)
            changed = true
          }
          if (changed) {
            setSelection(null)
            savedRangeRef.current = null
            selection.removeAllRanges()
          }
          return
        }
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

      async function copyBlockLink(blockId, embed) {
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
        const link =
          embed === true
            ? blockEmbedFor(selectedRef.current, target)
            : blockLinkFor(selectedRef.current, target)
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

      function deleteBlocksByIds(ids) {
        const remove = new Set(Array.isArray(ids) ? ids : [])
        if (remove.size === 0) return
        const next = blocksRef.current.filter((block) => !remove.has(block.id))
        updateBlocks(
          next.length > 0 ? next : [{ id: makeId(), type: 'paragraph', text: '', checked: false }],
        )
        setSelection(null)
        setEditingId(null)
        const selection = window.getSelection ? window.getSelection() : null
        if (selection !== null) selection.removeAllRanges()
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

      function cycleCalloutVariant(id) {
        updateBlocks(
          blocksRef.current.map((item) =>
            item.id === id && item.type === 'callout' ? { ...item, variant: nextCalloutKind(item.variant) } : item,
          ),
        )
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

      async function createNoteWith(baseName, body, targetDir) {
        await saveNow(blocksRef.current)
        const dir = noteDirFor(selectedRef.current, targetDir)
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

      async function createNote(templateId, targetDir) {
        const template = NOTE_TEMPLATES.find((item) => item.id === templateId) ?? NOTE_TEMPLATES[0]
        const baseName = template.id === 'blank' ? t('untitled') : t(template.titleKey)
        await createNoteWith(baseName, t(template.bodyKey), targetDir)
      }

      async function openTemplates(targetFolder) {
        setDialog({ kind: 'template', folder: typeof targetFolder === 'string' ? targetFolder : null })
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

      async function useVaultTemplate(template, mode, targetDir) {
        setDialog(null)
        try {
          const data = await apiGet(`/read?path=${encodeURIComponent(template.path)}`)
          const name = String(template.name ?? '').trim() || t('untitled')
          if (mode === 'button') {
            await createSubPageFromContent(name, splitFrontmatter(data.content).body)
          } else {
            await createNoteWith(name, data.content, targetDir)
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
        setCanvasView((current) => (current !== null && current.path === path ? null : current))
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
          setExpanded((current) => expandedPath(current, data.path))
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
            // One state object keeps the matches and their title/body split
            // together; the sidebar renders the groups, tools keep the lines.
            setHits({
              matches: Array.isArray(data.matches) ? data.matches : [],
              groups: {
                titles:
                  data.groups !== null && data.groups !== undefined && Array.isArray(data.groups.titles)
                    ? data.groups.titles
                    : [],
                body:
                  data.groups !== null && data.groups !== undefined && Array.isArray(data.groups.body)
                    ? data.groups.body
                    : [],
              },
            })
          } catch (error) {
            setNotice({ kind: 'error', text: error.message })
          }
        }, 300)
      }

      const groups = React.useMemo(() => {
        const map = new Map()
        // A folder can exist with no notes (freshly created) and a deep folder
        // implies its parents; both must appear in the tree.
        const ensure = (dir) => {
          if (!map.has(dir)) map.set(dir, [])
          let parent = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : ''
          while (parent.length > 0) {
            if (!map.has(parent)) map.set(parent, [])
            parent = parent.includes('/') ? parent.slice(0, parent.lastIndexOf('/')) : ''
          }
        }
        for (const dir of folderList) ensure(dir)
        for (const note of notes) {
          const dir = note.dir || ''
          ensure(dir)
          map.get(dir).push(note)
        }
        return [...map.entries()].sort((a, b) => {
          if (a[0] === '') return -1
          if (b[0] === '') return 1
          return a[0].localeCompare(b[0], 'zh-Hans-CN')
        })
      }, [notes, folderList])

      const homes = React.useMemo(() => folderHomes(notes), [notes])

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
        await openHistoryFor(selected)
      }

      async function openHistoryFor(path) {
        if (typeof path !== 'string' || path.length === 0) return
        setTitleMenu(false)
        setHistoryPreview(null)
        setHistory({ path, entries: [], loading: true })
        setDialog({ kind: 'history' })
        try {
          const data = await apiGet(`/history?path=${encodeURIComponent(path)}`)
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
          element.scrollIntoView({
            block: 'start',
            behavior: prefersReducedMotion() ? 'auto' : 'smooth',
          })
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

      // A page that presents its folder — either `type: folder` or a body that
      // is only links to sibling notes — renders the live directory above the
      // blocks; a detected link list hides its own blocks (the original list).
      const folderPage = React.useMemo(
        () => (selected === null ? null : folderPageFor(frontmatter, selected, blocks)),
        [frontmatter, selected, blocks],
      )
      const folderEntries = React.useMemo(
        () => (folderPage === null ? null : folderEntriesFor(notes, folderPage.folder, selected)),
        [folderPage, notes, selected],
      )
      const folderHidesBody = folderPage !== null && folderPage.linkBody === true && !folderBodyOpen

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

      // Whether the open page pins its folder-page behavior in frontmatter
      // (`type: folder`), as opposed to being detected from its link body.
      const explicitFolderPage = folderPageConfigFor(frontmatter, selected ?? '') !== null
      // The block being edited, shown as the ask panel's context line.
      const askFocus = editingId === null ? null : focusPayloadFor(blocks, editingId)

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
            {
              className: 'nb-flash-entry',
              title: t('flashTitle'),
              onClick: () => {
                setFlashTabOpen(true)
                setFlashOpen(true)
              },
            },
            h('span', { className: 'nb-flash-entry-icon' }, '⚡'),
            h('span', null, t('flashTitle')),
            flashCounts !== null && flashCounts.inbox > 0
              ? h('span', { className: 'nb-flash-count' }, String(flashCounts.inbox))
              : null,
          ),
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
          {
            className: 'nb-tree',
            onContextMenu: (event) => {
              if (event.target !== event.currentTarget) return
              event.preventDefault()
              setNoteMenu({ kind: 'folder', dir: '', x: event.clientX, y: event.clientY })
            },
          },
          loading === true
            ? h('div', { className: 'nb-side-empty' }, t('loading'))
            : hits !== null
              ? hits.groups.titles.length === 0 && hits.groups.body.length === 0
                ? h('div', { className: 'nb-side-empty' }, t('noResults'))
                : h(
                    'div',
                    { className: 'nb-search-results' },
                    hits.groups.titles.length > 0
                      ? h(
                          'div',
                          { className: 'nb-search-group' },
                          h(
                            'div',
                            { className: 'nb-search-group-title' },
                            t('searchTitleHits'),
                            h('span', { className: 'nb-search-group-count' }, String(hits.groups.titles.length)),
                          ),
                          hits.groups.titles.map((note) =>
                            h(
                              'button',
                              {
                                key: `title-${note.path}`,
                                className: 'nb-hit nb-hit-title',
                                onClick: () => openNote(note.path),
                                title: note.path,
                              },
                              h('span', { className: 'nb-hit-name' }, highlightText(note.name, search)),
                              note.dir.length > 0 ? h('span', { className: 'nb-hit-dir' }, note.dir) : null,
                            ),
                          ),
                        )
                      : null,
                    hits.groups.body.length > 0
                      ? h(
                          'div',
                          { className: 'nb-search-group' },
                          h(
                            'div',
                            { className: 'nb-search-group-title' },
                            t('searchBodyHits'),
                            h('span', { className: 'nb-search-group-count' }, String(hits.groups.body.length)),
                          ),
                          hits.groups.body.map((note) =>
                            h(
                              'div',
                              { key: `body-${note.path}`, className: 'nb-hit-note' },
                              h(
                                'button',
                                {
                                  className: 'nb-hit-note-name',
                                  onClick: () => openNote(note.path),
                                  title: note.path,
                                },
                                highlightText(note.name, search),
                              ),
                              note.hits.map((hit) =>
                                h(
                                  'button',
                                  {
                                    key: `${note.path}-${hit.line}`,
                                    className: 'nb-hit-line',
                                    onClick: () => {
                                      SEARCH_JUMP.pending = { path: note.path, needle: jumpNeedle(hit.text) }
                                      // Already-open note: openNote() would early-return,
                                      // so nudge the jump effect by hand.
                                      if (note.path === selected) setJumpTick((tick) => tick + 1)
                                      else openNote(note.path)
                                    },
                                    title: `${note.path}:${hit.line}`,
                                  },
                                  h('span', { className: 'nb-hit-line-no' }, String(hit.line)),
                                  h('span', { className: 'nb-hit-line-text' }, highlightText(hit.text, search)),
                                ),
                              ),
                              note.hitCount > note.hits.length
                                ? h(
                                    'div',
                                    { className: 'nb-hit-more' },
                                    t('searchMoreHits', { count: note.hitCount - note.hits.length }),
                                  )
                                : null,
                            ),
                          ),
                        )
                      : null,
                  )
              : notes.length === 0
                ? h('div', { className: 'nb-side-empty' }, t('noNotes'))
                : groups.map(([dir, items]) =>
                    !directoryOpen(dir, expanded)
                      ? null
                      : h(
                      'div',
                      { className: 'nb-group', key: `group-${dir}` },
                      dir === ''
                        ? null
                        : h(
                            'div',
                            {
                              className: `nb-group-title${homes.has(dir) ? ' has-home' : ''}`,
                              'data-folder': dir,
                              title: homes.get(dir) ?? dir,
                              style: { paddingLeft: `${6 + Math.max(0, dir.split('/').length - 1) * 12}px` },
                              onClick: () => {
                                const home = homes.get(dir)
                                if (home !== undefined) {
                                  void openNote(home)
                                  return
                                }
                                setExpanded({ ...expanded, [dir]: !(expanded[dir] === true) })
                              },
                              onContextMenu: (event) => {
                                event.preventDefault()
                                event.stopPropagation()
                                setNoteMenu({ kind: 'folder', dir, x: event.clientX, y: event.clientY })
                              },
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
                            h(
                              'span',
                              {
                                className: 'nb-group-caret',
                                onClick: (event) => {
                                  event.stopPropagation()
                                  setExpanded({ ...expanded, [dir]: !(expanded[dir] === true) })
                                },
                              },
                              expanded[dir] === true ? '▾' : '▸',
                            ),
                            h(
                              'span',
                              { className: `nb-group-name${homes.has(dir) ? ' is-home' : ''}` },
                              dir.split('/').pop(),
                            ),
                            h('span', { className: 'nb-group-count' }, items.length > 0 ? String(items.length) : ''),
                          ),
                      dir === '' || expanded[dir] === true
                        ? flattenTree(items, parents).map(({ note, depth }) =>
                            h(
                              'button',
                              {
                                key: note.path,
                                className: `nb-note${selected === note.path ? ' on' : ''}`,
                                style: {
                                  paddingLeft: `${6 + Math.max(0, dir.split('/').length) * 12 + depth * 14}px`,
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
                              h('span', { className: 'nb-note-caret', 'aria-hidden': 'true' }, '·'),
                              h('span', { className: 'nb-note-name' }, note.name),
                            ),
                          )
                        : null,
                    ),
                  ),
        ),
        h(
          'div',
          { className: 'nb-side-foot' },
          h(
            'button',
            {
              className: 'nb-heat-card',
              onClick: () => setDialog({ kind: 'stats' }),
              title: t('writingHeatmap'),
            },
            h(
              'div',
              { className: 'nb-heat-head' },
              h('span', { className: 'nb-heat-title' }, t('writingHeatmap')),
              h(
                'span',
                { className: 'nb-heat-total' },
                writing === null
                  ? '…'
                  : `${formatWritingCount(writing.total)} ${t('characters')}`,
              ),
            ),
            h(WritingHeatmap, { t, days: writing?.days ?? {}, weeks: 18, compact: true }),
          ),
        ),
      )

      const noteActive = selected !== null && flashOpen !== true
      const mainPanel = h(
        'section',
        { className: 'nb-main' },
        h(
          'div',
          { className: 'nb-topbar' },
          h(
            'div',
            { className: 'nb-tabs' },
            flashTabOpen
              ? h(
                  'div',
                  {
                    className: `nb-tab nb-tab-flash${flashOpen ? ' on' : ''}`,
                    title: t('flashTitle'),
                    onClick: () => setFlashOpen(true),
                  },
                  h('span', { className: 'nb-tab-name' }, `⚡ ${t('flashTitle')}`),
                  h(
                    'button',
                    {
                      className: 'nb-tab-close',
                      'aria-label': t('close'),
                      onClick: (event) => {
                        event.stopPropagation()
                        setFlashOpen(false)
                        setFlashTabOpen(false)
                      },
                    },
                    '×',
                  ),
                )
              : null,
            tabs.length === 0
              ? flashTabOpen
                ? null
                : h('div', { className: 'nb-crumb' }, breadcrumb)
              : tabs.map((path) =>
                  h(
                    'div',
                    {
                      key: path,
                      className: `nb-tab${selected === path && flashOpen !== true ? ' on' : ''}`,
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
          noteActive
            ? h(
                'button',
                {
                  className: `nb-icon-btn${askOpen ? ' on' : ''}`,
                  title: t('askAi'),
                  'aria-label': t('askAi'),
                  onMouseDown: () => {
                    if (!askOpen) setAskSelection(captureAskSelection())
                  },
                  onClick: () => setAskOpen((open) => !open),
                },
                '✨',
              )
            : null,
          noteActive
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
          noteActive
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
          noteActive
            ? h(
                'div',
                { className: `nb-save${saveState === 'error' ? ' error' : ''}`, 'data-state': saveState },
                saveLabel,
              )
            : null,
          h(
            'button',
            {
              className: 'nb-icon-btn',
              title: t('flashCapture'),
              'aria-label': t('flashCapture'),
              onClick: () => setFlashCapture(true),
            },
            '⚡',
          ),
          h(
            'button',
            {
              className: 'nb-icon-btn nb-sync-btn',
              title:
                syncStatus === null
                  ? t('syncTitle')
                  : syncStatus.provider === 'off'
                    ? `${t('syncTitle')} · ${t('syncOff')}`
                    : t('syncTitle'),
              'aria-label': t('syncTitle'),
              'data-state':
                syncStatus === null
                  ? 'off'
                  : syncStatus.busy
                    ? 'busy'
                    : syncStatus.lastResult !== null &&
                        syncStatus.lastResult !== undefined &&
                        syncStatus.lastResult.ok === false
                      ? 'error'
                      : syncStatus.provider === 'off'
                        ? 'off'
                        : 'idle',
              onClick: () => setSyncOpen(true),
            },
            '⟳',
          ),
          noteActive
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
                noteMenu !== null && noteMenu.kind === 'folder'
                  ? h(
                      'div',
                      {
                        className: 'nb-note-menu',
                        style: { left: `${noteMenu.x}px`, top: `${noteMenu.y}px` },
                        onMouseDown: (event) => event.stopPropagation(),
                      },
                      noteMenu.dir.length > 0
                        ? h(
                        'button',
                        {
                          className: 'nb-menu-item',
                          onClick: async () => {
                            const folder = noteMenu.dir
                            setNoteMenu(null)
                            const existing = homes.get(folder)
                            if (existing !== undefined) {
                              await openNote(existing)
                              return
                            }
                            const path = folderHomePath(folder)
                            if (path === null) return
                            try {
                              await apiPost('/create', {
                                path,
                                content: `# ${folder.split('/').pop()}\n\n`,
                              })
                              await loadList()
                              await openNote(path)
                            } catch (error) {
                              setNotice({ kind: 'error', text: error.message })
                            }
                          },
                        },
                        t('folderHomeNote'),
                      )
                        : null,
                      h(
                        'button',
                        {
                          className: 'nb-menu-item',
                          onClick: () => {
                            const folder = noteMenu.dir
                            setNoteMenu(null)
                            void openTemplates(folder)
                          },
                        },
                        t('folderNewNote'),
                      ),
                      h(
                        'button',
                        {
                          className: 'nb-menu-item',
                          onClick: () => {
                            const folder = noteMenu.dir
                            setNoteMenu(null)
                            setFolderDraft(folder.length > 0 ? `${folder}/` : '')
                            setDialog({ kind: 'folder' })
                          },
                        },
                        t('folderNewSubfolder'),
                      ),
                      h(
                        'button',
                        {
                          className: 'nb-menu-item',
                          onClick: () => {
                            const folder = noteMenu.dir
                            setNoteMenu(null)
                            try {
                              if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                                navigator.clipboard.writeText(folder)
                              }
                            } catch {
                              /* clipboard unavailable */
                            }
                          },
                        },
                        t('copyPath'),
                      ),
                    )
                  : noteMenu !== null
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
                      h(
                        'button',
                        {
                          className: 'nb-menu-item',
                          onClick: () => {
                            setTitleMenu(false)
                            updateFrontmatter(
                              withFrontmatterValue(frontmatterRef.current, 'type', explicitFolderPage ? '' : 'folder'),
                            )
                          },
                        },
                        explicitFolderPage ? t('folderPageOff') : t('folderPageOn'),
                      ),
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
              { className: 'nb-notice', 'data-kind': notice.kind === 'ok' ? 'ok' : 'error' },
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
        syncRemote !== null
          ? h(
              'div',
              { className: 'nb-notice nb-sync' },
              h('span', { className: 'nb-sync-text' }, t('syncExternal')),
              h(
                'button',
                {
                  className: 'nb-sync-action',
                  onClick: () => {
                    reloadFromDiskRef.current?.()
                  },
                },
                t('syncReload'),
              ),
              h(
                'button',
                {
                  className: 'nb-icon-btn',
                  onClick: () => {
                    syncDismissedRef.current = syncRemote
                    setSyncRemote(null)
                  },
                  'aria-label': t('cancel'),
                },
                '×',
              ),
            )
          : null,
        flashOpen
          ? h(FlashPanel, {
              t,
              localeId: activeLocaleId(locale),
              revision: flashRevision,
              onCapture: () => setFlashCapture(true),
              onOpen: (path) => {
                setFlashOpen(false)
                void openNote(path)
              },
              onClose: () => {
                setFlashOpen(false)
                setFlashTabOpen(false)
              },
              onChanged: () => setFlashRevision((value) => value + 1),
            })
          : canvasView !== null
          ? h(CanvasView, {
              path: canvasView.path,
              nodes: canvasView.nodes,
              edges: canvasView.edges,
              loading: canvasView.loading,
              error: canvasView.error,
              t,
              onOpen: (path) => void openNote(path),
              onClose: () => {
                setCanvasView(null)
                setSelected(null)
              },
            })
          : selected === null
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
              vaultError !== null
                ? h(
                    'div',
                    { className: 'nb-empty' },
                    h('div', { className: 'nb-empty-title' }, t('vaultEmptyTitle')),
                    h('div', { className: 'nb-empty-text' }, t('vaultEmptyText')),
                    h(
                      'div',
                      { className: 'nb-empty-error' },
                      t('vaultEmptyError', { message: vaultError }),
                    ),
                  )
                : h(
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
                      key: `collection:${selected ?? ''}:${collection.folder ?? ''}`,
                      t,
                      config: collection.config,
                      rows: collection.rows,
                      loading: collection.loading,
                      folder: collection.folder ?? '',
                      onOpen: (path) => openNote(path),
                      onReload: reloadCollection,
                      onFieldChange: updateCollectionField,
                      onCreate: createCollectionRow,
                      onSaveConfig: saveCollectionView,
                    })
                  : null,
                folderEntries !== null
                  ? h(FolderView, {
                      key: `folder:${folderPage.folder}`,
                      t,
                      folder: folderPage.folder,
                      entries: folderEntries,
                      hasBody: blocks.length > 0,
                      bodyOpen: folderBodyOpen,
                      onToggleBody: () => setFolderBodyOpen((open) => !open),
                      onOpen: (path) => openNote(path),
                      onReload: loadList,
                      onCreate: () => openTemplates(folderPage.folder),
                    })
                  : null,
                folderHidesBody
                  ? null
                  : h(
                  'div',
                  { className: 'nb-blocks' },
                  blocks
                    .filter((block) => !hiddenIds.has(block.id) && !isFootnoteDefinition(block))
                    .map((block, index) =>
                    h(BlockView, {
                      key: block.id,
                      block,
                      index,
                      editing: editingId === block.id,
                      readOnly: reading,
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
                      onCalloutVariant: cycleCalloutVariant,
                      notePath: selected ?? '',
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
                  h(FootnoteList, { key: 'footnotes', blocks, t }),
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
        askOpen && selected !== null
          ? h(
              'aside',
              {
                className: 'nb-ask',
                'aria-label': t('askAi'),
                onKeyDown: (event) => {
                  if (event.key === 'Escape') {
                    event.stopPropagation()
                    setAskOpen(false)
                  }
                },
              },
              h(
                'div',
                { className: 'nb-ask-head' },
                h('span', { className: 'nb-ask-title' }, '✨ ', t('askAi')),
                askModel.length > 0
                  ? h('span', { className: 'nb-ask-model', title: askModel }, askModel)
                  : null,
                askThread.length > 0
                  ? h(
                      'button',
                      {
                        className: 'nb-icon-btn',
                        title: t('askClear'),
                        'aria-label': t('askClear'),
                        onClick: () => {
                          updateAskThread(selected, () => [])
                          setAskError(null)
                        },
                      },
                      '⟲',
                    )
                  : null,
                h(
                  'button',
                  {
                    className: 'nb-icon-btn',
                    title: t('close'),
                    'aria-label': t('close'),
                    onClick: () => setAskOpen(false),
                  },
                  '×',
                ),
              ),
              h(
                'div',
                { className: 'nb-ask-context' },
                h(
                  'div',
                  { className: 'nb-ask-about', title: selected },
                  t('askAbout', { title: noteNameFromPath(selected) }),
                ),
                askSelection.length > 0
                  ? h(
                      'div',
                      { className: 'nb-ask-selection' },
                      h(
                        'span',
                        {
                          className: 'nb-ask-selection-text',
                          title: askSelection,
                        },
                        t('askSelection', { text: askSelection }),
                      ),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'nb-ask-mini',
                          'aria-label': t('close'),
                          onClick: () => setAskSelection(''),
                        },
                        '×',
                      ),
                    )
                  : null,
                askFocus !== null
                  ? h(
                      'div',
                      { className: 'nb-ask-focus', title: askFocus.text },
                      t('askFocus', {
                        text: `${askFocus.heading.length > 0 ? `${askFocus.heading} · ` : ''}${askFocus.text}`,
                      }),
                    )
                  : null,
                h(
                  'div',
                  { className: 'nb-ask-modes' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: `nb-ask-mode${askMode === 'note' ? ' on' : ''}`,
                      disabled: askBusy,
                      onClick: () => setAskMode('note'),
                    },
                    t('askModeNote'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: `nb-ask-mode${askMode === 'agent' ? ' on' : ''}`,
                      disabled: askBusy,
                      onClick: () => setAskMode('agent'),
                    },
                    t('askModeAgent'),
                  ),
                ),
              ),
              h(
                'div',
                { className: 'nb-ask-thread', ref: askThreadRef },
                askThread.length === 0
                  ? h(
                      'div',
                      { className: 'nb-ask-empty' },
                      h('div', null, askMode === 'agent' ? t('askEmptyAgent') : t('askEmpty')),
                      h(
                        'div',
                        { className: 'nb-ask-quick' },
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'nb-ask-chip',
                            disabled: askBusy,
                            onClick: () => void sendAsk(t('askQuickSummary')),
                          },
                          t('askQuickSummary'),
                        ),
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'nb-ask-chip',
                            disabled: askBusy,
                            onClick: () => void sendAsk(t('askQuickTodos')),
                          },
                          t('askQuickTodos'),
                        ),
                        askSelection.length > 0
                          ? h(
                              'button',
                              {
                                type: 'button',
                                className: 'nb-ask-chip',
                                disabled: askBusy,
                                onClick: () => void sendAsk(t('askQuickExplain')),
                              },
                              t('askQuickExplain'),
                            )
                          : null,
                      ),
                    )
                  : askThread.map((message, index) =>
                      h(
                        'div',
                        {
                          key: `${index}:${message.role}`,
                          className: `nb-ask-msg ${message.role}`,
                        },
                        h(
                          'div',
                          { className: 'nb-ask-role' },
                          message.role === 'user' ? t('askYou') : t('askAgent'),
                        ),
                        message.role === 'assistant'
                          ? message.text.length > 0
                            ? h('div', {
                                className: 'nb-ask-text nb-ask-md',
                                dangerouslySetInnerHTML: { __html: answerHtml(message.text) },
                                onClick: (event) => {
                                  const target = event.target
                                  const anchor =
                                    target !== null && typeof target.closest === 'function'
                                      ? target.closest('.nb-ask-note')
                                      : null
                                  if (anchor === null) return
                                  event.preventDefault()
                                  const raw = String(anchor.getAttribute('data-note') ?? '')
                                  const note = findWikiTarget(notes, citationNoteName(raw))
                                  if (note === null) {
                                    setNotice({ kind: 'error', text: t('askNoteMissing', { name: raw }) })
                                    return
                                  }
                                  void openNote(note.path)
                                },
                              })
                            : h('div', { className: 'nb-ask-text' }, askBusy ? t('askThinking') : '')
                          : h('div', { className: 'nb-ask-text' }, message.text),
                        message.role === 'assistant' && message.steps > 0
                          ? h('div', { className: 'nb-ask-steps' }, t('askSteps', { count: message.steps }))
                          : null,
                        message.role === 'assistant' && message.text.length > 0
                          ? h(
                              'div',
                              { className: 'nb-ask-msg-actions' },
                              h(
                                'button',
                                {
                                  type: 'button',
                                  className: 'nb-ask-mini',
                                  onClick: () => {
                                    copyAsk(message.text)
                                    flashAsk('copy', index)
                                  },
                                },
                                askFlash !== null && askFlash.type === 'copy' && askFlash.index === index
                                  ? t('askCopied')
                                  : t('askCopy'),
                              ),
                              h(
                                'button',
                                {
                                  type: 'button',
                                  className: 'nb-ask-mini',
                                  onClick: () => {
                                    if (insertAsk(message.text)) flashAsk('insert', index)
                                  },
                                },
                                askFlash !== null && askFlash.type === 'insert' && askFlash.index === index
                                  ? t('askInserted')
                                  : t('askInsert'),
                              ),
                              h(
                                'button',
                                {
                                  type: 'button',
                                  className: 'nb-ask-mini',
                                  onClick: () => {
                                    void createNoteWith(askAnswerTitle(message.text, t('askUntitled')), message.text)
                                    flashAsk('save', index)
                                  },
                                },
                                askFlash !== null && askFlash.type === 'save' && askFlash.index === index
                                  ? t('askSaved')
                                  : t('askSave'),
                              ),
                            )
                          : null,
                      ),
                    ),
              ),
              askError !== null
                ? h(
                    'div',
                    { className: 'nb-ask-error' },
                    h('span', { className: 'nb-ask-error-text' }, askError),
                    h(
                      'button',
                      { type: 'button', className: 'nb-ask-mini', onClick: retryAsk },
                      t('askRetry'),
                    ),
                  )
                : null,
              h(
                'div',
                { className: 'nb-ask-compose' },
                h('textarea', {
                  ref: askInputRef,
                  className: 'nb-ask-input',
                  value: askInput,
                  placeholder: askMode === 'agent' ? t('askPlaceholderAgent') : t('askPlaceholder'),
                  rows: 2,
                  onChange: (event) => setAskInput(event.target.value),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter' && event.shiftKey === false) {
                      event.preventDefault()
                      void sendAsk()
                    }
                  },
                }),
                h(
                  'div',
                  { className: 'nb-ask-actions' },
                  askBusy
                    ? h('button', { type: 'button', className: 'nb-ask-btn', onClick: stopAsk }, t('askStop'))
                    : h(
                        'button',
                        {
                          type: 'button',
                          className: 'nb-ask-btn primary',
                          disabled: askInput.trim().length === 0,
                          onClick: () => void sendAsk(),
                        },
                        t('askSend'),
                      ),
                ),
              ),
            )
          : null,
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
                aiPanel.loading === true && aiPanel.result.length === 0
                  ? h('div', { className: 'nb-ai-result loading' }, t('aiGenerating'))
                  : aiPanel.error.length > 0
                    ? h('div', { className: 'nb-ai-result error' }, aiPanel.error)
                    : aiPanel.result.length > 0
                      ? h('textarea', {
                          className: 'nb-input nb-ai-result',
                          value: aiPanel.result,
                          rows: 6,
                          readOnly: aiPanel.loading === true,
                          onChange: (event) => setAiPanel({ ...aiPanel, result: event.target.value }),
                        })
                      : null,
                aiPanel.task === 'agent' && aiPanel.result.length > 0
                  ? h(
                      'div',
                      { className: 'nb-ai-snapshot' },
                      h('span', null, t('aiAgentSnapshotHint')),
                      h(
                        'button',
                        {
                          className: 'nb-btn',
                          onClick: () => {
                            setAiPanel(null)
                            openHistory()
                          },
                        },
                        t('aiOpenHistory'),
                      ),
                    )
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
                  placeholder: t('palettePlaceholder'),
                  autoFocus: true,
                  'aria-label': t('palettePlaceholder'),
                  onChange: (event) => {
                    setQuickQuery(event.target.value)
                    setQuickIndex(0)
                  },
                  onKeyDown: (event) => {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault()
                      setQuickIndex((index) => Math.min(index + 1, quickRows.length - 1))
                    } else if (event.key === 'ArrowUp') {
                      event.preventDefault()
                      setQuickIndex((index) => Math.max(0, index - 1))
                    } else if (event.key === 'Enter') {
                      event.preventDefault()
                      const row = quickRows[quickIndex]
                      if (row === undefined) return
                      setQuickOpen(false)
                      if (row.kind === 'action') row.run()
                      else pickQuick(row.path)
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      setQuickOpen(false)
                    }
                  },
                }),
                h(
                  'div',
                  { className: 'nb-quick-list' },
                  quickRows.length === 0
                    ? h('div', { className: 'nb-side-empty' }, t('noResults'))
                    : quickRows.map((row, index) =>
                        h(
                          'button',
                          {
                            key: row.key,
                            className: `nb-quick-row${index === quickIndex ? ' on' : ''}${
                              row.kind === 'action' ? ' nb-quick-action' : ''
                            }`,
                            onMouseDown: (event) => {
                              event.preventDefault()
                              setQuickOpen(false)
                              if (row.kind === 'action') row.run()
                              else pickQuick(row.path)
                            },
                          },
                          row.kind === 'action'
                            ? [
                                h('span', { key: 'icon', className: 'nb-quick-row-icon' }, row.icon),
                                h('span', { key: 'label', className: 'nb-quick-row-name' }, row.label),
                              ]
                            : [
                                h('span', { key: 'name', className: 'nb-quick-row-name' }, row.name),
                                h('span', { key: 'path', className: 'nb-quick-row-path' }, row.dir),
                              ],
                        ),
                      ),
                ),
                h(
                  'div',
                  { className: 'nb-quick-hint' },
                  h('span', null, h('kbd', null, '↑↓'), t('paletteMove')),
                  h('span', null, h('kbd', null, '↵'), t('paletteRun')),
                  h('span', null, h('kbd', null, 'esc'), t('paletteClose')),
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
                    ...(selection.multi === true ? [] : [['clear', '⌫', t('fmtClear'), '']]),
                    ['ask', '✨', t('askAi'), 'nb-toolbar-ask'],
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
                          if (kind === 'ask') {
                            const text = captureAskSelection()
                            if (text.length > 0) setAskSelection(text)
                            setAskOpen(true)
                            setSelection(null)
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
        dialog !== null && dialog.kind === 'stats'
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
                { className: 'nb-modal-card nb-stats-card', role: 'dialog', 'aria-modal': 'true' },
                h(
                  'div',
                  { className: 'nb-stats-head' },
                  h(
                    'div',
                    null,
                    h('div', { className: 'nb-stats-title' }, t('writingHeatmap')),
                    h(
                      'div',
                      { className: 'nb-stats-sub' },
                      writing !== null && writing.recordedSince !== null && writing.recordedSince !== undefined
                        ? t('statsSince').replace('{date}', writing.recordedSince)
                        : t('statsEmptyHint'),
                    ),
                  ),
                  h(
                    'button',
                    { className: 'nb-icon-btn', onClick: () => setDialog(null), 'aria-label': t('close') },
                    '×',
                  ),
                ),
                h(
                  'div',
                  { className: 'nb-stats-summary' },
                  [
                    ['statsTotal', `${formatWritingCount(writing?.total ?? 0)} ${t('characters')}`],
                    ['statsActiveDays', String(writing?.activeDays ?? 0)],
                    ['statsStreak', String(writing?.streak ?? 0)],
                    ['statsBest', writing?.best !== null && writing?.best !== undefined ? formatWritingCount(writing.best.chars) : '—'],
                  ].map(([key, value]) =>
                    h(
                      'div',
                      { key, className: 'nb-stats-stat' },
                      h('div', { className: 'nb-stats-value' }, value),
                      h('div', { className: 'nb-stats-label' }, t(key)),
                    ),
                  ),
                ),
                writing === null
                  ? h('div', { className: 'nb-stats-empty' }, t('loading'))
                  : h(WritingHeatmap, { t, days: writing.days ?? {}, weeks: 53, labels: true }),
                h(
                  'div',
                  { className: 'nb-stats-legend' },
                  h('span', null, t('statsLess')),
                  [0, 1, 2, 3, 4].map((level) =>
                    h('span', { key: level, className: 'nb-heat-cell', 'data-level': String(level) }),
                  ),
                  h('span', null, t('statsMore')),
                ),
              ),
            )
          : dialog !== null && dialog.kind === 'delete'
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
                                else createNote(template.id, dialog.folder ?? undefined)
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
                                    onClick: () =>
                                      useVaultTemplate(
                                        template,
                                        dialog.source === 'button' ? 'button' : '',
                                        dialog.folder ?? undefined,
                                      ),
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
        flashCapture
          ? h(FlashCapture, {
              t,
              onClose: () => setFlashCapture(false),
              onSaved: (flashItem) => {
                setFlashCapture(false)
                setFlashRevision((value) => value + 1)
                setNotice({ kind: 'ok', text: `${t('flashSaved')} · ${flashCategoryLabel(t, flashItem.category)}` })
              },
            })
          : null,
        syncOpen
          ? h(SyncDialog, {
              t,
              localeId: activeLocaleId(locale),
              onClose: () => setSyncOpen(false),
              onStatus: (data) => setSyncStatus(data),
              onDone: (result) => {
                // Pulled or deleted notes change the tree; the open note notices
                // its own mtime change through the external-change poller.
                if (result !== null && (result.downloaded > 0 || result.deletedLocal > 0 || result.uploaded > 0)) {
                  void loadList()
                }
              },
            })
          : null,
      )
    }

    /** Icon action on finalized assistant messages: copy the reply into the flash inbox. */
    function AssistantNotebookAction(props) {
      const { t, messageId, readMessageText, saveToFlash } = props
      const [state, setState] = React.useState('idle')
      const onClick = async (event) => {
        event.preventDefault()
        event.stopPropagation()
        if (state === 'saving') return
        setState('saving')
        try {
          const text = typeof readMessageText === 'function' ? await readMessageText(messageId) : null
          if (text === null || String(text).trim().length === 0) {
            setState('empty')
          } else {
            await saveToFlash(String(text))
            setState('saved')
          }
        } catch {
          setState('error')
        }
        window.setTimeout(() => setState('idle'), 1800)
      }
      const label = t('saveToFlash')
      const symbol =
        state === 'saving' ? '…' : state === 'saved' ? '✓' : state === 'error' || state === 'empty' ? '!' : '⚡'
      return h(
        'button',
        {
          type: 'button',
          className: `nb-chat-action${state === 'saved' ? ' is-done' : ''}${state === 'error' || state === 'empty' ? ' is-warn' : ''}`,
          title: label,
          'aria-label': label,
          onClick,
          disabled: state === 'saving',
        },
        symbol,
      )
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), `${NS}: dictionaries`)
      const t = ctx.locale.bind(NS)

      // The chat rows live outside the workbench, so their styles cannot ride
      // on the panel's <style> element: install one shared tag for the page.
      ctx.effect(() => {
        if (typeof document === 'undefined') return undefined
        const tagId = `${NS}/chat-tool.css`
        if (document.querySelector(`style[data-plugin-css="${tagId}"]`) !== null) return undefined
        const tag = document.createElement('style')
        tag.dataset.plugin = NS
        tag.dataset.pluginCss = tagId
        tag.textContent = CHAT_TOOL_CSS
        document.head.appendChild(tag)
        return () => tag.remove()
      }, `${NS}: chat tool styles`)

      const openFromChat = (path) => openNoteInWorkbench(ctx, path)
      for (const toolName of Object.keys(NOTE_TOOL_TITLE_KEYS)) {
        ctx.slots.inject('tool.call.toolview', () =>
          ctx.slots.register(
            { name: 'tool.call.toolview', key: toolName, locale: NS },
            (props) => h(NotebookToolRow, { ...props, onOpenNote: openFromChat }),
          ),
        )
      }

      // A DSH shortcut toggles the ask panel while the workbench is mounted.
      if (typeof ctx.inject === 'function') {
        ctx.inject(['shortcuts'], (scope) => {
          scope.effect(() => {
            try {
              return scope.shortcuts.register({
                id: `${NS}.ask`,
                label: () => t('askAi'),
                defaults: {
                  'desktop:macos': { code: 'KeyJ', modifiers: ['primary', 'alt'] },
                  'desktop:windows': { code: 'KeyJ', modifiers: ['primary', 'alt'] },
                  'desktop:linux': { code: 'KeyJ', modifiers: ['primary', 'alt'] },
                },
                regions: ['page', 'editable'],
                resolve: () => ({ status: 'handled', run: () => requestAskToggle() }),
              })
            } catch {
              // A conflicting default must not take the whole plugin down.
              return () => {}
            }
          }, `${NS}: ask shortcut`)

          // Zero-decision capture: one shortcut, wherever the panel has focus.
          scope.effect(() => {
            try {
              return scope.shortcuts.register({
                id: `${NS}.flash`,
                label: () => t('flashShortcut'),
                defaults: {
                  'desktop:macos': { code: 'KeyF', modifiers: ['primary', 'shift'] },
                  'desktop:windows': { code: 'KeyF', modifiers: ['primary', 'shift'] },
                  'desktop:linux': { code: 'KeyF', modifiers: ['primary', 'shift'] },
                },
                regions: ['page', 'editable'],
                resolve: () => ({ status: 'handled', run: () => requestFlashCapture() }),
              })
            } catch {
              // A conflicting default must not take the whole plugin down.
              return () => {}
            }
          }, `${NS}: flash shortcut`)
        })
      }

      // Settings → General: the vault folder, with the Host's folder picker.
      ctx.slots.inject('settings.general.item', () =>
        ctx.slots.register({ name: 'settings.general.item', id: `${NS}:vault`, order: 18 }, () =>
          h(VaultSettingRow, {
            t,
            locale: ctx.locale,
            pickDirectory: () => pickVaultDirectory(ctx),
          }),
        ),
      )

      // Composer tool row: jump to the notebook or insert the open note's path.
      ctx.slots.inject('conversation.input.left', () =>
        ctx.slots.register({ name: 'conversation.input.left', id: `${NS}:composer`, order: 30 }, (props) =>
          h(NotebookComposerButton, {
            ...props,
            t,
            locale: ctx.locale,
            openPanel: () => openNotebookPanel(ctx),
            openAsk: () => {
              requestAskOpen()
              openNotebookPanel(ctx)
            },
          }),
        ),
      )

      // Finalized assistant reply → one click into the flash inbox.
      const clientSessions = (() => {
        try {
          return ctx.sessions
        } catch {
          return undefined
        }
      })()
      if (clientSessions !== undefined && typeof clientSessions.using === 'function') {
        ctx.slots.inject('conversation.chat.assistant-actions', () =>
          ctx.slots.register(
            {
              name: 'conversation.chat.assistant-actions',
              id: `${NS}:flash`,
              order: 20,
              locale: NS,
              inject: (sessionId) => ({
                readMessageText: async (messageId) => {
                  return clientSessions.using(
                    sessionId,
                    { source: 'controllerOperation' },
                    async (reference) => {
                      const binding = await reference.ready
                      const window = binding.eventSource.getSnapshot()
                      const entries = Array.isArray(window?.entries) ? window.entries : []
                      let fallback = ''
                      for (const entry of entries) {
                        if (entry === null || entry === undefined || entry.type !== 'event') continue
                        const event = entry.event
                        if (event === null || event === undefined || event.type !== 'assistant/message') continue
                        const message = event.data?.message ?? event.message
                        if (message === null || message === undefined) continue
                        const blocks = Array.isArray(message.content) ? message.content : []
                        const value = blocks
                          .filter((item) => item !== null && item.type === 'text')
                          .map((item) => String(item.text ?? ''))
                          .join('\n')
                          .trim()
                        if (value.length === 0) continue
                        fallback = value
                        if (message.id === messageId) return value
                      }
                      return fallback.length > 0 ? fallback : null
                    },
                  )
                },
                saveToFlash: async (text) => {
                  await apiPost('/flash/create', { text, category: '摘录', tags: ['对话'] })
                },
              }),
            },
            (props) => h(AssistantNotebookAction, { ...props, t }),
          ),
        )
      }

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
        ctx.slots.register({ name: 'main', key: NS }, () => {
          const panel = h(Workbench, { t, locale: ctx.locale })
          // The smoke harness has no React.Component; only real React gets a boundary.
          return typeof React.Component === 'function' ? h(NotebookBoundary, null, panel) : panel
        }),
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
        folderOfPath,
        linkOnlyTarget,
        resolveNoteLink,
        autoFolderPageFor,
        markdownNoteLink,
        wrapMarkdownSelection,
        folderPageConfigFor,
        folderPageFor,
        folderEntriesFor,
        sortFolderNotes,
        FolderView,
        formatShortDate,
        focusPayloadFor,
        noteSyncDecision,
        saveFailureKind,
        activeLocaleId,
        answerHtml,
        normalizeSelectionText,
        insertAfterBlock,
        lastUserIndex,
        rememberAskThread,
        citationNoteName,
        noteDirFor,
        paletteRows,
        writingHeatmap,
        writingLevel,
        localDayKey,
        askAnswerTitle,
        ASK_THREADS,
        collectionColumns,
        filterCollectionRows,
        parseCollectionFilter,
        matchCollectionFilter,
        applyCollectionFilter,
        parseCollectionSort,
        sortCollectionRows,
        groupCollectionRows,
        isTemplateHref,
        isBlankBlockText,
        parseBasesView,
        parseBasesConfig,
        collectFootnotes,
        canvasBounds,
        CanvasView,
        isFootnoteDefinition,
        renderLatexMath,
        makeBaseRow,
        evalBaseFilter,
        sortBaseRows,
        baseRowValue,
        chatNoteToolModel,
        toolBlockArgs,
        toolBlockText,
        noteNameFromPath,
        resultSuffix,
        requestNoteOpen,
        requestAskOpen,
        takePendingAskOpen,
        subscribeNoteOpen,
        takePendingNoteOpen,
        EMOJI_SHORTCODES,
        removeTagFromList,
        withFrontmatterValue,
        parseListValue,
        formatListValue,
        EmbeddedNote,
        embedBlocksFor,
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
        calloutKind,
        nextCalloutKind,
        blockToHtml,
        BlockView,
        SyncDialog,
        syncFormFromSettings,
        syncSettingsFromForm,
        FlashCapture,
        FlashPanel,
        parseMarpDeck,
        MarpDeck,
        jumpNeedle,
        directoryOpen,
        expandedPath,
        folderHomes,
        folderHomePath,
        flashCategoryLabel,
        flashCategoryIndex,
        flashErrorLabel,
        requestFlashCapture,
        takePendingFlashCapture,
      },
    }
  },
})
