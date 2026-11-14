// dsh-rules —— 浏览器半身
//
// 在设置页注册一个「规则」分区：编辑一段注入系统提示词的规则文本。
// 文本存在宿主侧的 $DSH_HOME/AGENTS.md 标记块里，本文件只负责 UI 与往返请求。
//
// 为什么不用 localStorage：AGENTS.md 是宿主进程读取的，前端存储对系统提示词无效。
window.__ModuleLoader__.load({
  id: 'dsh-rules',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const h = React.createElement

    // 命名空间同时用作 locale 字典和 slot 的 locale 选项
    const NS = 'dsh-rules'
    const PANEL_ID = 'rules'
    // order 30：general 是 0、models 是 10，留出中间空档给其它插件插队
    const ORDER = 30

    const inject = ['slots', 'locale']

    // ---------- 文案 ----------
    // 自带的兜底字典：即使 locale 服务里注册失败，UI 也不会出现裸 key。
    const zh = {
      nav: '规则',
      title: '规则',
      intro: '这些规则会注入到系统提示词。每块独立保存、互不覆盖；全局块对所有会话生效，工作区块只要放在项目根就会随该项目加载。',
      placeholder: '例如：回答保持简洁；代码注释用中文；优先使用 bash 而不是 pwsh。',
      save: '保存',
      reload: '重新载入',
      delete: '删除这块',
      addBlock: '+ 新块',
      askName: '块名（字母数字、点、下划线、连字符，最长 64）：',
      badName: '块名不合法：只允许字母数字、点、下划线、连字符，1~64 个字符。',
      newBlock: '新块还没写入磁盘，写好内容后点「保存」。',
      needName: '先选一块，或者点「+ 新块」',
      unsaved: '未保存',
      deleted: '已删除块「{name}」，文件已备份',
      deleteFailed: '删除失败：{error}',
      loading: '载入中…',
      saving: '保存中…',
      saved: '已保存（{bytes} 字节），立即生效',
      savedPartial: '已保存（{bytes} 字节），立即生效。{warning}',
      loadFailed: '读取失败：{error}',
      saveFailed: '保存失败：{error}',
      blockMissing: '这个文件里还没有块。点「+ 新块」建一个，保存时会在末尾追加，不会改动已有内容。',
      filePath: '文件位置：{path}',
      byteHint: '{bytes} 字节',
      templateToggle: '从通用模板开始（不懂怎么写可以先看这里）',
      templateIntro: '这些是通用规则，不含任何个人偏好。勾选后生成文本，你可以改完再保存。',
      templateTip: '写得越短，模型越容易稳定遵守',
      ruleCount: '{n} 条',
      preview: '预览',
      applyTemplate: '填入编辑框',
      personalPlaceholder: '你自己的规则写在这里…',
      templateLoaded: '已填入 {n} 条规则（{bytes} 字节），确认后点「保存」',
      overBudget: '当前 {lines} 行，超过建议的 {budget} 行。规则越多，模型越容易漏读关键的那条——建议只装当前项目需要的层。',
    }
    const en = {
      nav: 'Rules',
      title: 'Rules',
      intro:
        'These rules are injected into the system prompt. Each block is saved independently; the global block applies to every session, and a workspace block applies wherever its project root is loaded.',
      placeholder: 'e.g. Keep answers short; write code comments in Chinese; prefer bash over pwsh.',
      save: 'Save',
      reload: 'Reload',
      delete: 'Delete block',
      addBlock: '+ New block',
      askName: 'Block name (letters, digits, dot, underscore, hyphen; max 64):',
      badName: 'Invalid block name: letters, digits, dot, underscore, hyphen; 1-64 chars.',
      newBlock: 'This block is not on disk yet — write it and press Save.',
      needName: 'Pick a block first, or press "+ New block"',
      unsaved: 'unsaved',
      deleted: 'Block "{name}" deleted; file backed up',
      deleteFailed: 'Delete failed: {error}',
      loading: 'Loading…',
      saving: 'Saving…',
      saved: 'Saved ({bytes} bytes) — in effect now',
      savedPartial: 'Saved ({bytes} bytes) — in effect now. {warning}',
      loadFailed: 'Load failed: {error}',
      saveFailed: 'Save failed: {error}',
      blockMissing: 'No blocks in this file yet. Press "+ New block"; saving appends at the end without touching existing content.',
      filePath: 'File: {path}',
      byteHint: '{bytes} bytes',
      templateToggle: 'Start from a general template',
      templateIntro: 'These are general-purpose rules with no personal preferences. Pick layers, generate, and edit before saving.',
      templateTip: 'Shorter rules are followed more reliably',
      ruleCount: '{n} rules',
      preview: 'Preview',
      applyTemplate: 'Load into editor',
      personalPlaceholder: 'Your own rules go here…',
      templateLoaded: 'Loaded {n} rules ({bytes} bytes) — review and press Save',
      overBudget: '{lines} lines, above the suggested {budget}. More rules means the model is likelier to miss the ones that matter — enable only the layers this project needs.',
    }

    /** 极简插值：只需支持 {name}，不值得为此引入依赖。 */
    function fmt(template, vars) {
      return String(template).replace(/\{(\w+)\}/g, (whole, key) =>
        vars && Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : whole,
      )
    }

    // ---------- 样式 ----------
    // 一次性注入；类名前缀 dshrules- 避免与 dshrf-/cost- 等插件撞车。
    // 全部用主题 CSS 变量，暗色主题下不写死颜色。
    const CSS = `
.dshrules-section{max-width:720px;display:flex;flex-direction:column;gap:12px;color:var(--dsw-alias-label-primary)}
.dshrules-title{margin:0;font-size:16px;font-weight:500;line-height:24px}
.dshrules-intro{margin:0;font-size:14px;line-height:22px;color:var(--dsw-alias-label-tertiary)}
.dshrules-textarea{box-sizing:border-box;width:100%;min-height:240px;padding:10px 12px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-module-platform);border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);resize:vertical;tab-size:2}
.dshrules-textarea:focus{outline:none;border-color:var(--dsw-alias-label-tertiary)}
.dshrules-tabs{display:flex;flex-wrap:wrap;gap:6px}
.dshrules-tab{box-sizing:border-box;height:26px;padding:0 10px;font:inherit;font-size:12px;border-radius:var(--dsw-radius-sm,6px);border:.5px solid var(--dsw-alias-border-l3);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dshrules-tab:hover:not(:disabled){border-color:var(--dsw-alias-label-tertiary)}
.dshrules-tab:disabled{opacity:.5;cursor:default}
.dshrules-tab-on{border-color:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary)}
.dshrules-tab-add{border-style:dashed;color:var(--dsw-alias-label-tertiary)}
.dshrules-problems{margin:0;padding-left:18px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-warn-label)}
.dshrules-btn-danger:hover:not(:disabled){border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.dshrules-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dshrules-btn{box-sizing:border-box;height:32px;padding:0 14px;font:inherit;font-size:13px;border-radius:var(--dsw-radius-md);border:.5px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);cursor:pointer}
.dshrules-btn:hover:not(:disabled){border-color:var(--dsw-alias-label-tertiary)}
.dshrules-btn:disabled{opacity:.5;cursor:default}
.dshrules-btn-primary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-module-platform);border-color:transparent}
.dshrules-meta{margin-left:auto;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dshrules-status{margin:0;font-size:12px;line-height:18px;min-height:18px}
.dshrules-status-ok{color:var(--dsw-alias-state-success-primary)}
.dshrules-status-err{color:var(--dsw-alias-state-error-primary)}
.dshrules-status-warn{color:var(--dsw-alias-state-warn-label)}
.dshrules-file{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);word-break:break-all}
.dshrules-template{border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform)}
.dshrules-template-toggle{box-sizing:border-box;width:100%;display:flex;align-items:center;gap:8px;padding:10px 12px;font:inherit;font-size:13px;background:transparent;border:none;color:var(--dsw-alias-label-secondary);cursor:pointer;text-align:left}
.dshrules-template-toggle:hover{color:var(--dsw-alias-label-primary)}
.dshrules-caret{flex:none;width:12px;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dshrules-template-body{display:flex;flex-direction:column;gap:10px;padding:0 12px 12px}
.dshrules-layers{display:flex;flex-direction:column;gap:6px}
.dshrules-layer{display:flex;align-items:baseline;gap:8px;font-size:13px;cursor:pointer}
.dshrules-layer-name{font-weight:500;color:var(--dsw-alias-label-primary)}
.dshrules-layer-desc{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dshrules-layer-count{margin-left:auto;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dshrules-textarea-sm{min-height:100px}
.dshrules-preview{margin:0;padding:10px 12px;max-height:240px;overflow:auto;white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);border-radius:var(--dsw-radius-sm,6px)}
`

    function ensureStyles() {
      try {
        if (typeof document === 'undefined') return
        if (document.getElementById('dshrules-style')) return
        const style = document.createElement('style')
        style.id = 'dshrules-style'
        style.textContent = CSS
        document.head.appendChild(style)
      } catch (e) {
        try { console.error('[dsh-rules] style inject failed:', e) } catch { /* 忽略 */ }
      }
    }

    // ---------- HTTP ----------
    // 同源相对路径即可：宿主把路由挂在同一个 webServer 上。
    //
    // 三个请求都带一个可选 file：不给就是全局 $DSH_HOME/AGENTS.md，
    // 给了就是那个工作区根下的 AGENTS.md。DSH 的注入链自己会按目录加载
    // 工作区文件，所以插件只需要能「写到那儿」，不需要理解继承顺序。
    async function apiRead(file) {
      const q = file ? '?file=' + encodeURIComponent(file) : ''
      const res = await fetch('/dsh-rules/read' + q, { headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return await res.json()
    }

    async function postJson(path, payload) {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok && res.status !== 200) {
        // 413/400 之类仍然带 JSON body，尽量把它读出来
        try {
          const body = await res.json()
          if (body && body.error) return body
        } catch { /* 忽略 */ }
        throw new Error('HTTP ' + res.status)
      }
      return await res.json()
    }

    async function apiSave(name, text, file) {
      return await postJson('/dsh-rules/save', { name, text, file: file || undefined })
    }

    async function apiDelete(name, file) {
      return await postJson('/dsh-rules/delete', { name, file: file || undefined })
    }

    // ---------- 面板 ----------
    /**
     * 设置分区组件。分两层：上面选块，下面编辑选中的那块。
     *
     * 为什么不做成一个大文本框（旧版的样子）：一旦有多块，「一个框装全部」
     * 就没法表达「这块属于哪个文件、哪个块」——保存时也无从知道该替换哪段。
     * 拆成列表 + 单块编辑，每块的范围是明确的，写回时就只会动那一段。
     *
     * 拿到的 props（由 settings shell 与 slot 系统注入）：
     *   t           —— 绑定本插件命名空间的翻译函数（来自 register 的 locale 选项）
     *   其余 slot 注入项这里用不到
     */
    function RulesSection(props) {
      ensureStyles()
      const injectedT = props && typeof props.t === 'function' ? props.t : null
      const dict = (props && props.locale) === 'en' ? en : zh
      // locale 服务没就绪时退回自带字典，避免渲染出裸 key
      const t = (key, vars) => {
        if (injectedT) {
          try {
            const v = injectedT(key, vars)
            if (v && v !== key) return v
          } catch { /* 忽略 */ }
        }
        const raw = dict[key] !== undefined ? dict[key] : key
        return vars ? fmt(raw, vars) : raw
      }

      const [file, setFile] = React.useState('')
      const [filePath, setFilePath] = React.useState('')
      const [blocks, setBlocks] = React.useState([])
      const [problems, setProblems] = React.useState([])
      const [current, setCurrent] = React.useState('')
      const [text, setText] = React.useState('')
      const [dirty, setDirty] = React.useState(false)
      const [phase, setPhase] = React.useState('loading') // loading | idle | saving
      const [status, setStatus] = React.useState({ kind: 'plain', text: '' })

      const load = React.useCallback(async (targetFile) => {
        setPhase('loading')
        setStatus({ kind: 'plain', text: t('loading') })
        try {
          const data = await apiRead(targetFile)
          if (data && data.ok) {
            const list = Array.isArray(data.blocks) ? data.blocks : []
            setBlocks(list)
            setFilePath(typeof data.filePath === 'string' ? data.filePath : '')
            setProblems(Array.isArray(data.problems) ? data.problems : [])
            setStatus({ kind: 'plain', text: '' })
            // 选中项：保持当前块；它不在了就选第一块；一块都没有就清空编辑区
            setCurrent((prev) => {
              const keep = list.find((b) => b.name === prev)
              const pick = keep ? keep.name : (list[0] ? list[0].name : '')
              const target = list.find((b) => b.name === pick)
              setText(target ? target.text : '')
              setDirty(false)
              return pick
            })
          } else {
            setStatus({ kind: 'err', text: t('loadFailed', { error: (data && data.error) || 'unknown' }) })
          }
        } catch (e) {
          setStatus({ kind: 'err', text: t('loadFailed', { error: errMsg(e) }) })
        } finally {
          setPhase('idle')
        }
      }, [])

      // 挂载即读：磁盘是唯一的真相，不做本地缓存
      React.useEffect(() => { load(file) }, [])

      const pick = React.useCallback((name) => {
        // 切块前不检查未保存改动：这里的代价只是「刚才打的字丢了」，而弹确认
        // 会让每次点块都多一步。真需要保底的话，保存本身有 .bak 备份。
        const b = blocks.find((x) => x.name === name)
        setCurrent(name)
        setText(b ? b.text : '')
        setDirty(false)
        setStatus({ kind: 'plain', text: '' })
      }, [blocks])

      const bytes = React.useMemo(() => {
        try { return new TextEncoder().encode(text).length } catch { return text.length }
      }, [text])

      const save = React.useCallback(async () => {
        if (phase === 'saving') return
        if (!current) {
          setStatus({ kind: 'err', text: t('needName') })
          return
        }
        setPhase('saving')
        setStatus({ kind: 'plain', text: t('saving') })
        try {
          const data = await apiSave(current, text, file)
          if (data && data.ok) {
            if (typeof data.filePath === 'string') setFilePath(data.filePath)
            setStatus({
              kind: 'ok',
              text: data.warning
                ? t('savedPartial', { bytes: data.bytes, warning: data.warning })
                : t('saved', { bytes: data.bytes }),
            })
            setDirty(false)
            await load(file)
          } else {
            setStatus({ kind: 'err', text: t('saveFailed', { error: (data && data.error) || 'unknown' }) })
          }
        } catch (e) {
          setStatus({ kind: 'err', text: t('saveFailed', { error: errMsg(e) }) })
        } finally {
          setPhase('idle')
        }
      }, [current, text, file, phase, blocks])

      const remove = React.useCallback(async () => {
        if (!current || phase === 'saving') return
        setPhase('saving')
        setStatus({ kind: 'plain', text: t('saving') })
        try {
          const data = await apiDelete(current, file)
          if (data && data.ok) {
            setStatus({ kind: 'ok', text: t('deleted', { name: current }) })
            setCurrent('')
            setText('')
            setDirty(false)
            await load(file)
          } else {
            setStatus({ kind: 'err', text: t('deleteFailed', { error: (data && data.error) || 'unknown' }) })
          }
        } catch (e) {
          setStatus({ kind: 'err', text: t('deleteFailed', { error: errMsg(e) }) })
        } finally {
          setPhase('idle')
        }
      }, [current, file, phase])

      const addBlock = React.useCallback(() => {
        const name = window.prompt(t('askName'), 'workspace')
        if (!name) return
        // 前端先挡一次格式：合法的块名限制很窄，等后端报错再告诉用户要多绕一圈
        if (!/^[A-Za-z0-9._-]{1,64}$/.test(name)) {
          setStatus({ kind: 'err', text: t('badName') })
          return
        }
        setCurrent(name)
        setText('')
        setDirty(true)
        setStatus({ kind: 'plain', text: t('newBlock') })
      }, [])

      const busy = phase !== 'idle'
      const statusClass =
        status.kind === 'ok' ? 'dshrules-status dshrules-status-ok'
          : status.kind === 'err' ? 'dshrules-status dshrules-status-err'
            : 'dshrules-status'

      const list = blocks.map((b) =>
        h('button', {
          key: b.name,
          type: 'button',
          className: b.name === current ? 'dshrules-tab dshrules-tab-on' : 'dshrules-tab',
          disabled: busy,
          onClick: () => pick(b.name),
          title: b.name,
        }, b.name + ' · ' + b.bytes + 'B'),
      )

      return h('div', { className: 'dshrules-section' }, [
        h('h2', { key: 'title', className: 'dshrules-title' }, t('title')),
        h('p', { key: 'intro', className: 'dshrules-intro' }, t('intro')),

        // 模板面板：给新用户一个起点，不用从空白开始写
        h(TemplatePanel, {
          key: 'tpl',
          t,
          busy,
          onApply: (generated, bytes, count) => {
            setText(generated)
            setDirty(true)
            setStatus({
              kind: 'plain',
              text: t('templateLoaded', { n: count, bytes }),
            })
          },
        }),

        h('div', { key: 'tabs', className: 'dshrules-tabs' }, [
          ...list,
          h('button', {
            key: '__add',
            type: 'button',
            className: 'dshrules-tab dshrules-tab-add',
            disabled: busy,
            onClick: addBlock,
          }, t('addBlock')),
        ]),

        blocks.length === 0
          ? h('p', { key: 'empty', className: 'dshrules-status' }, t('blockMissing'))
          : null,

        h('textarea', {
          key: 'ta',
          className: 'dshrules-textarea',
          value: text,
          spellCheck: false,
          placeholder: t('placeholder'),
          disabled: busy || !current,
          'aria-label': t('title'),
          onChange: (e) => { setText(e.target.value); setDirty(true) },
        }),

        h('div', { key: 'actions', className: 'dshrules-actions' }, [
          h('button', {
            key: 'save',
            type: 'button',
            className: 'dshrules-btn dshrules-btn-primary',
            disabled: busy || !current || !dirty,
            onClick: save,
          }, t('save')),
          h('button', {
            key: 'reload',
            type: 'button',
            className: 'dshrules-btn',
            disabled: busy,
            onClick: () => load(file),
          }, t('reload')),
          h('button', {
            key: 'del',
            type: 'button',
            className: 'dshrules-btn dshrules-btn-danger',
            disabled: busy || !current,
            onClick: remove,
          }, t('delete')),
          h('span', { key: 'bytes', className: 'dshrules-meta' },
            t('byteHint', { bytes }) + (dirty ? ' · ' + t('unsaved') : '')),
        ]),

        // 状态行：成功/失败/普通三种颜色，始终占位以避免布局跳动
        h('p', { key: 'status', className: statusClass }, status.text),

        problems.length
          ? h('ul', { key: 'problems', className: 'dshrules-problems' },
            problems.map((p, i) => h('li', { key: i }, p)))
          : null,

        filePath
          ? h('p', { key: 'file', className: 'dshrules-file' }, t('filePath', { path: filePath }))
          : null,
      ])
    }


    function errMsg(e) {
      return e && e.message ? e.message : String(e)
    }

    /** 读取模板目录。 */
    async function apiTemplates() {
      const res = await fetch('/dsh-rules/templates', { headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return await res.json()
    }

    /** 按选中的层生成规则文本。 */
    async function apiBuildTemplate(layers, personalText) {
      const res = await fetch('/dsh-rules/templates/build', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ layers, personalText }),
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return await res.json()
    }

    /**
     * 通用规则模板面板。
     *
     * 为什么要这个：插件要能给所有人用，就不能把作者的规则硬塞进去。
     * 这里列出中性的通用规则，用户勾选后生成文本，自己决定写不写。
     * 默认只勾 core（安全底线）——它对任何使用者都成立，且不做会真出事。
     */
    function TemplatePanel(props) {
      const { t, busy, onApply } = props
      const [open, setOpen] = React.useState(false)
      const [layers, setLayers] = React.useState(null)
      const [picked, setPicked] = React.useState(['core'])
      const [personal, setPersonal] = React.useState('')
      const [preview, setPreview] = React.useState('')
      const [err, setErr] = React.useState('')
      const [loading, setLoading] = React.useState(false)
      const [budget, setBudget] = React.useState(120)
      const [lines, setLines] = React.useState(0)

      const loadLayers = React.useCallback(async () => {
        setLoading(true)
        setErr('')
        try {
          const data = await apiTemplates()
          if (data && data.ok) {
            setLayers(data.layers || [])
            if (data.budget) setBudget(data.budget)
          } else setErr(errMsg(new Error((data && data.error) || 'unknown')))
        } catch (e) {
          setErr(errMsg(e))
        } finally {
          setLoading(false)
        }
      }, [])

      const toggle = (id) => {
        setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
        setPreview('')
      }

      const build = React.useCallback(async (applyNow) => {
        setLoading(true)
        setErr('')
        try {
          const data = await apiBuildTemplate(picked, personal)
          if (data && data.ok) {
            setPreview(data.text || '')
            if (data.lines) setLines(data.lines)
            if (data.budget) setBudget(data.budget)
            if (applyNow && typeof onApply === 'function') {
              onApply(data.text || '', data.bytes || 0, data.count || 0, {
                lines: data.lines || 0,
                overBudget: !!data.overBudget,
              })
            }
          } else {
            setErr((data && data.error) || 'unknown')
          }
        } catch (e) {
          setErr(errMsg(e))
        } finally {
          setLoading(false)
        }
      }, [picked, personal, onApply])

      // 展开时才拉模板，避免每次进设置页都发请求
      React.useEffect(() => {
        if (open && layers === null) loadLayers()
      }, [open, layers, loadLayers])

      const head = h('button', {
        key: 'h',
        type: 'button',
        className: 'dshrules-template-toggle',
        onClick: () => setOpen((v) => !v),
        'aria-expanded': open,
      }, [
        h('span', { key: 'i', className: 'dshrules-caret' }, open ? '▾' : '▸'),
        h('span', { key: 'l' }, t('templateToggle')),
      ])

      if (!open) return h('div', { className: 'dshrules-template' }, head)

      const rows = layers === null
        ? h('p', { key: 'loading', className: 'dshrules-status' }, t('loading'))
        : layers.map((layer) => h('label', {
          key: layer.id,
          className: 'dshrules-layer',
        }, [
          h('input', {
            key: 'c',
            type: 'checkbox',
            checked: picked.includes(layer.id),
            disabled: busy || loading || layer.id === 'personal',
            onChange: () => toggle(layer.id),
          }),
          h('span', { key: 'n', className: 'dshrules-layer-name' }, layer.title),
          h('span', { key: 'd', className: 'dshrules-layer-desc' }, layer.desc),
          h('span', { key: 'c2', className: 'dshrules-layer-count' },
            layer.id === 'personal' ? '' : t('ruleCount', { n: layer.count })),
        ]))

      return h('div', { className: 'dshrules-template' }, [
        head,
        h('div', { key: 'body', className: 'dshrules-template-body' }, [
          h('p', { key: 'hint', className: 'dshrules-intro' }, t('templateIntro')),
          h('div', { key: 'layers', className: 'dshrules-layers' }, rows),

          picked.includes('personal')
            ? h('textarea', {
              key: 'personal',
              className: 'dshrules-textarea dshrules-textarea-sm',
              value: personal,
              placeholder: t('personalPlaceholder'),
              disabled: busy || loading,
              onChange: (e) => { setPersonal(e.target.value); setPreview('') },
            })
            : null,

          err ? h('p', { key: 'err', className: 'dshrules-status dshrules-status-err' }, err) : null,

          h('div', { key: 'act', className: 'dshrules-actions' }, [
            h('button', {
              key: 'preview',
              type: 'button',
              className: 'dshrules-btn',
              disabled: busy || loading || picked.length === 0,
              onClick: () => build(false),
            }, t('preview')),
            h('button', {
              key: 'apply',
              type: 'button',
              className: 'dshrules-btn dshrules-btn-primary',
              disabled: busy || loading || picked.length === 0,
              onClick: () => build(true),
            }, t('applyTemplate')),
            h('span', { key: 'tip', className: 'dshrules-meta' }, t('templateTip')),
          ]),

          // 超预算提示：不拦着不让用，但要告诉使用者「多了反而更差」
          lines > budget
            ? h('p', { key: 'over', className: 'dshrules-status dshrules-status-warn' },
              t('overBudget', { lines, budget }))
            : null,

          preview
            ? h('pre', { key: 'pv', className: 'dshrules-preview' }, preview)
            : null,
        ]),
      ])
    }

    /**
     * 错误边界：面板里任何渲染异常只塌陷本分区，不拖垮整个设置页。
     */
    class SectionBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false, message: '' }
      }
      static getDerivedStateFromError(error) {
        return { failed: true, message: error && error.message ? error.message : String(error) }
      }
      componentDidCatch(error) {
        try { console.error('[dsh-rules] panel crashed:', error) } catch { /* 忽略 */ }
      }
      render() {
        if (this.state.failed) {
          return h('div', { className: 'dshrules-section' },
            h('p', { className: 'dshrules-status dshrules-status-err' }, 'dsh-rules 面板异常：' + this.state.message))
        }
        return this.props.children
      }
    }

    function GuardedSection(props) {
      return h(SectionBoundary, null, h(RulesSection, props))
    }

    /**
     * 插件入口。
     *
     * 整段包 try/catch：前端插件抛异常会让 DSH 判定启动失败，
     * 弹出「禁用第三方插件」的恢复界面。
     */
    function apply(ctx) {
      try {
        applyInner(ctx)
      } catch (e) {
        try { console.error('[dsh-rules] apply failed:', e) } catch { /* 忽略 */ }
      }
    }

    function applyInner(ctx) {
      const diag = (typeof window !== 'undefined'
        ? (window.__dshRulesDiag = window.__dshRulesDiag || {})
        : {})
      if (diag.section === undefined) diag.section = 'pending'

      ctx.effect(
        () => ctx.locale.register(NS, { zh, en }),
        'dsh-rules: dictionaries',
      )

      const t = ctx.locale.bind(NS)

      /**
       * settings.section 注册。
       *
       * ⚠️ 必须用 ctx.slots.inject gate 且整段包在 ctx.effect 里：
       * apply 早期 settings.section 还没建立，裸 register 会被静默丢弃
       * （dsh-unsent-drafts / cost-tracker 都实测过这个坑）。
       */
      ctx.effect(() => {
        let offSection = null
        const offInject = ctx.slots.inject('settings.section', () => {
          try {
            offSection = ctx.slots.register({
              name: 'settings.section',
              id: PANEL_ID,
              order: ORDER,
              // label 是设置分区左侧导航行的文字，必须走 t 才会随语言切换
              label: () => t('nav'),
              locale: NS,
            }, GuardedSection)
            diag.section = 'registered'
          } catch (e) {
            diag.section = 'failed: ' + errMsg(e)
            try { console.error('[dsh-rules] settings.section register failed:', e) } catch { /* 忽略 */ }
          }
        })
        return () => {
          if (typeof offSection === 'function') {
            try { offSection() } catch { /* 忽略 */ }
          }
          if (typeof offInject === 'function') {
            try { offInject() } catch { /* 忽略 */ }
          }
        }
      }, 'dsh-rules: settings entry')
    }

    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
