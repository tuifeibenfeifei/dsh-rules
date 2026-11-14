// 多块标记的纯逻辑自测。用法：node test/blocks.test.mjs
import assert from 'node:assert'
import {
  BEGIN,
  END,
  LEGACY_NAME,
  isValidName,
  parseBlocks,
  renderBlock,
  sanitize,
  upsertBlock,
  removeBlock,
} from '../lib/blocks.mjs'

let n = 0
function ok(name, fn) {
  n++
  try {
    fn()
  } catch (e) {
    console.error('❌ ' + name + '\n   ' + (e && e.message))
    process.exitCode = 1
  }
}

// ── A 块名校验 ──
ok('A1 普通名字合法', () => assert.strictEqual(isValidName('workspace'), true))
ok('A2 带点与连字符合法', () => assert.strictEqual(isValidName('session-81094445.abc'), true))
ok('A3 空名字非法', () => assert.strictEqual(isValidName(''), false))
ok('A4 含空格非法', () => assert.strictEqual(isValidName('a b'), false))
ok('A5 含 --> 非法（会弄坏注释）', () => assert.strictEqual(isValidName('a-->b'), false))
ok('A6 超 64 字符非法', () => assert.strictEqual(isValidName('x'.repeat(65)), false))
ok('A7 非字符串非法', () => assert.strictEqual(isValidName(null), false))

// ── B 解析 ──
ok('B1 空文件没有块', () => {
  const r = parseBlocks('')
  assert.strictEqual(r.blocks.length, 0)
  assert.strictEqual(r.problems.length, 0)
})
ok('B2 旧格式被识别为 global', () => {
  const r = parseBlocks(BEGIN + '\n内容\n' + END)
  assert.strictEqual(r.blocks.length, 1)
  assert.strictEqual(r.blocks[0].name, LEGACY_NAME)
  assert.strictEqual(r.blocks[0].text, '内容')
})
ok('B3 两个具名块都解析出来', () => {
  const raw = renderBlock('workspace', 'A 规则') + '\n\n' + renderBlock('session-abc', 'B 规则')
  const r = parseBlocks(raw)
  assert.deepStrictEqual(r.blocks.map((b) => b.name), ['workspace', 'session-abc'])
  assert.deepStrictEqual(r.blocks.map((b) => b.text), ['A 规则', 'B 规则'])
})
ok('B4 缺结束标记只报告不修复', () => {
  const r = parseBlocks('<!-- dsh-rules:block workspace -->\n残留')
  assert.strictEqual(r.blocks.length, 0)
  assert.ok(r.problems.some((p) => p.includes('缺少结束标记')))
  assert.ok(r.problems.every((p) => !p.includes('已修复')))
})
ok('B5 只有结束标记也报告', () => {
  const r = parseBlocks('文字\n' + END + '\n')
  assert.strictEqual(r.blocks.length, 0)
  assert.ok(r.problems.length > 0)
})
ok('B6 同名块出现两次要报告（读取取第一个）', () => {
  const raw = renderBlock('x', '一') + '\n' + renderBlock('x', '二')
  const r = parseBlocks(raw)
  assert.strictEqual(r.blocks.length, 2)
  assert.strictEqual(r.blocks[0].text, '一')
  assert.ok(r.problems.some((p) => p.includes('不止一次')))
})

// ── C 写入 ──
ok('C1 空文件写入只生成一个块', () => {
  const r = upsertBlock('', 'workspace', '规则A')
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.text, renderBlock('workspace', '规则A') + '\n')
})
ok('C2 二次写入替换而非堆积', () => {
  let raw = upsertBlock('', 'workspace', '规则A').text
  raw = upsertBlock(raw, 'workspace', '规则B').text
  assert.strictEqual(raw.split('<!-- dsh-rules:block workspace -->').length - 1, 1)
  assert.ok(raw.includes('规则B') && !raw.includes('规则A'))
})
ok('C3 有手写内容时末尾追加，手写一字不动', () => {
  const head = '# 手写标题\n\n手写正文\n'
  const r = upsertBlock(head, 'workspace', '规则C')
  assert.ok(r.text.startsWith(head), '手写内容被破坏：' + JSON.stringify(r.text))
  assert.ok(r.text.includes('规则C'))
})
ok('C4 加第二个块不动第一个块', () => {
  let raw = upsertBlock('# 手写\n', 'workspace', '工作区规则').text
  raw = upsertBlock(raw, 'session-a', '对话规则').text
  const r = parseBlocks(raw)
  assert.deepStrictEqual(r.blocks.map((b) => b.name), ['workspace', 'session-a'])
  assert.ok(raw.startsWith('# 手写\n'))
})
ok('C5 改第二块不动第一块', () => {
  let raw = upsertBlock('', 'workspace', '工作区规则').text
  raw = upsertBlock(raw, 'session-a', '第一版').text
  raw = upsertBlock(raw, 'session-a', '第二版').text
  const r = parseBlocks(raw)
  assert.strictEqual(r.blocks[0].text, '工作区规则')
  assert.strictEqual(r.blocks[1].text, '第二版')
})
ok('C6 旧格式块被新格式写入时保持兼容（仍识别为 global）', () => {
  const raw = upsertBlock(BEGIN + '\n旧\n' + END, LEGACY_NAME, '新')
  const r = parseBlocks(raw.text)
  assert.strictEqual(r.blocks[0].name, LEGACY_NAME)
  assert.strictEqual(r.blocks[0].text, '新')
})
ok('C7 文本里混进标记被剔除并警告', () => {
  const r = upsertBlock('', 'workspace', '健康' + END)
  assert.strictEqual(r.text.split(END).length - 1, 1, '标记未剔除')
  assert.ok(typeof r.warning === 'string' && r.warning.length > 0)
})
ok('C8 非法块名被拒绝，不静默改名', () => {
  const r = upsertBlock('', 'a b', 'x')
  assert.strictEqual(r.ok, false)
  assert.ok(/不合法/.test(r.error))
})
ok('C9 空文本也保留块（清空≠删除）', () => {
  const raw = upsertBlock('', 'workspace', '').text
  const r = parseBlocks(raw)
  assert.strictEqual(r.blocks.length, 1)
  assert.strictEqual(r.blocks[0].text, '')
})
ok('C10 文本里的 $& 不被当成替换模式', () => {
  const raw = upsertBlock('', 'workspace', '价格 $& 和 $1')
  assert.ok(raw.text.includes('价格 $& 和 $1'))
})

// ── D 删除 ──
ok('D1 删掉指定块，另一个不动', () => {
  let raw = upsertBlock('', 'workspace', '工作区规则').text
  raw = upsertBlock(raw, 'session-a', '对话规则').text
  const r = removeBlock(raw, 'session-a')
  assert.strictEqual(r.ok, true)
  const p = parseBlocks(r.text)
  assert.deepStrictEqual(p.blocks.map((b) => b.name), ['workspace'])
})
ok('D2 删不存在的块要报错', () => {
  const r = removeBlock(renderBlock('workspace', 'x'), 'nope')
  assert.strictEqual(r.ok, false)
  assert.ok(r.error.includes('nope'))
})
ok('D3 删块不留多余空行', () => {
  let raw = upsertBlock('# 头\n', 'a', '一').text
  raw = upsertBlock(raw, 'b', '二').text
  const r = removeBlock(raw, 'b')
  assert.ok(!r.text.includes('\n\n\n'), '留下连续空行：' + JSON.stringify(r.text))
  assert.ok(r.text.includes('一'))
})
ok('D4 删光后只剩手写内容', () => {
  let raw = upsertBlock('# 头\n', 'a', '一').text
  raw = removeBlock(raw, 'a').text
  assert.strictEqual(raw.trim(), '# 头'.trim())
})

// ── E 净化 ──
ok('E1 三种标记都被剔除', () => {
  const r = sanitize('a' + BEGIN + 'b<!-- dsh-rules:block x -->c' + END + 'd')
  assert.ok(!(BEGIN in {}) && !r.text.includes(BEGIN) && !r.text.includes(END))
  assert.ok(!r.text.includes('<!-- dsh-rules:block x -->'))
  assert.strictEqual(r.dirty, true)
})
ok('E2 干净文本不算脏', () => {
  const r = sanitize('普通规则')
  assert.strictEqual(r.dirty, false)
  assert.strictEqual(r.text, '普通规则')
})

console.log(n + ' 项断言' + (process.exitCode ? '，有失败' : '，全部通过'))
