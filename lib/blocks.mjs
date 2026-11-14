// 标记块的纯逻辑：解析 / 渲染 / 替换。不碰文件系统，方便直接测。
//
// 为什么要有「多块」：
// 单一标记块只能表达「一套全局规则」。而 DSH 的注入链其实是三层的
// （$DSH_HOME/AGENTS.md 全局 → 工作区 AGENTS.md → 会话），用户希望
// 「A 工作区的 a 对话同时遵守 a 自己 + 工作区 A + 全局」。文件级的分层
// 由 DSH 自己完成（见 @deepseek-ai/dsh-agent-instructions），本模块只解决
// 「同一个文件里怎么放多段、彼此互不覆盖」。
//
// 语法：
//   <!-- dsh-rules:block NAME -->   普通块
//   <!-- dsh-rules:begin -->        旧格式，等价于 block global（保持兼容）
//   <!-- dsh-rules:end -->          所有块共用同一个结束标记
//
// 为什么 NAME 限制字符：块名会出现在 HTML 注释里，含 `-->` 或换行会把
// 注释结构弄坏，而这正是所有「块管理」最容易翻车的地方。
export const BEGIN = '<!-- dsh-rules:begin -->'
export const END = '<!-- dsh-rules:end -->'
export const LEGACY_NAME = 'global'
export const NAME_RE = /^[A-Za-z0-9._-]{1,64}$/

const BLOCK_OPEN = '<!-- dsh-rules:block '

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 打开标记：普通块带名字，旧格式不带。
const OPEN_RE = new RegExp(
  escapeRe(BLOCK_OPEN) + '([A-Za-z0-9._-]{1,64})' + escapeRe(' -->') + '|' + escapeRe(BEGIN),
  'g',
)

/** 块名是否合法。非法就拒绝，不静默改名——改名会让「我改的那块去哪了」变成谜。 */
export function isValidName(name) {
  return typeof name === 'string' && NAME_RE.test(name)
}

/** 标记块里保存时前后各有一个换行，读回来时去掉，避免每存一次多一个空行。 */
export function trimBlockText(inner) {
  let t = inner
  if (t.startsWith('\r\n')) t = t.slice(2)
  else if (t.startsWith('\n')) t = t.slice(1)
  if (t.endsWith('\r\n')) t = t.slice(0, -2)
  else if (t.endsWith('\n')) t = t.slice(0, -1)
  return t
}

/**
 * 解析整个文件，返回块列表与结构性问题。
 *
 * 结构性问题的处理原则：**只报告，不修复**。「半个块」通常是用户手工
 * 编辑时删多了，自动修复等于替人决定他本来想保留哪一半。
 */
export function parseBlocks(raw) {
  const text = String(raw || '')
  const opens = []
  OPEN_RE.lastIndex = 0
  let m
  while ((m = OPEN_RE.exec(text)) !== null) {
    const name = m[1] || LEGACY_NAME
    opens.push({ name, start: m.index, openEnd: m.index + m[0].length, raw: m[0] })
  }

  const endRe = new RegExp(escapeRe(END), 'g')
  const ends = []
  while ((m = endRe.exec(text)) !== null) ends.push(m.index)

  const blocks = []
  const problems = []
  let cursor = 0
  let usedEnd = 0

  for (let i = 0; i < opens.length; i++) {
    const o = opens[i]
    if (o.start < cursor) {
      problems.push('块「' + o.name + '」被前一个块包住了（嵌套），已跳过。')
      continue
    }
    const e = ends.find((pos, idx) => idx >= usedEnd && pos > o.openEnd)
    if (e === undefined) {
      problems.push('块「' + o.name + '」缺少结束标记，已跳过；不会自动修复。')
      continue
    }
    blocks.push({
      name: o.name,
      text: trimBlockText(text.slice(o.openEnd, e)),
      start: o.start,
      end: e + END.length,
    })
    cursor = e + END.length
    usedEnd = ends.indexOf(e) + 1
  }

  const strayEnd = ends.length - blocks.length
  if (strayEnd > 0 && blocks.length === 0) {
    problems.push('文件里有结束标记但找不到开始标记，已跳过；不会自动修复。')
  }

  const seen = new Set()
  for (const b of blocks) {
    if (seen.has(b.name)) problems.push('块名「' + b.name + '」出现了不止一次，读取取第一个。')
    seen.add(b.name)
  }

  return { blocks, problems, declared: opens.map((o) => o.name) }
}

/** 用户输入里如果混进了标记字符串，会把块结构弄坏，直接剔除并提示。 */
export function sanitize(text) {
  let dirty = false
  let out = String(text == null ? '' : text)
  for (const marker of [BLOCK_OPEN, BEGIN, END]) {
    if (out.includes(marker)) {
      out = out.split(marker).join('')
      dirty = true
    }
  }
  return { text: out, dirty }
}

/** 渲染一个块。text 为空也保留块——「清空」和「删掉」是两件事。 */
export function renderBlock(name, text) {
  const open = name === LEGACY_NAME ? BEGIN : BLOCK_OPEN + name + ' -->'
  return open + '\n' + String(text == null ? '' : text) + '\n' + END
}

/**
 * 写入（新增或替换）一个块，返回新的全文。
 *
 * 四个分支，每个都对应一种真实会遇到的输入：
 *   块已存在   → 只替换那一段，前后内容一字不动
 *   文件为空   → 只写这个块
 *   有内容无块 → 末尾追加，前面留空行
 *   块名重复   → 替换第一个，其余原样保留（不静默删除别人的内容）
 */
export function upsertBlock(raw, name, text) {
  if (!isValidName(name)) {
    return { ok: false, error: '块名不合法：' + JSON.stringify(name) + '（只允许字母数字、点、下划线、连字符，1~64 个字符）' }
  }
  const clean = sanitize(text)
  const parsed = parseBlocks(raw)
  const block = renderBlock(name, clean.text)
  const src = String(raw || '')

  const hit = parsed.blocks.find((b) => b.name === name)
  let next
  if (hit) {
    next = src.slice(0, hit.start) + block + src.slice(hit.end)
  } else if (src === '') {
    next = block + '\n'
  } else {
    const sep = src.endsWith('\n') ? '\n' : '\n\n'
    next = src + sep + block + '\n'
  }
  return { ok: true, text: next, warning: clean.dirty ? '规则文本里含有 dsh-rules 标记字符串，已自动移除。' : undefined }
}

/** 删掉一个块。块不存在时返回 ok:false，让调用方能区分「删了」和「本来没有」。 */
export function removeBlock(raw, name) {
  const parsed = parseBlocks(raw)
  const hit = parsed.blocks.find((b) => b.name === name)
  if (!hit) return { ok: false, error: '没有名为「' + name + '」的块' }
  const src = String(raw || '')
  let before = src.slice(0, hit.start)
  let after = src.slice(hit.end)
  // 删块时顺带吃掉它前面多余的空行，避免每删一次文件里多一行空白
  if (after.startsWith('\r\n')) after = after.slice(2)
  else if (after.startsWith('\n')) after = after.slice(1)
  if (before.endsWith('\n\n')) before = before.slice(0, -1)
  return { ok: true, text: before + after }
}
