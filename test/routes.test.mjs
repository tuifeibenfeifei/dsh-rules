// 宿主侧多块路由的集成测试：多块读写、file 参数、删除、向后兼容。
// 用法：node test/routes.test.mjs
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-rules-home-'))
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-rules-ws-'))
process.env.DSH_HOME = home

const mod = await import('../lib/index.js')

const routes = new Map()
const ctx = {
  effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
  inject(_deps, cb) {
    cb({ webServer: { register({ path: p, handler }) { routes.set(p, handler); return () => routes.delete(p) } } })
  },
}
mod.apply(ctx)

const HOME_FILE = path.join(home, 'AGENTS.md')
const WS_FILE = path.join(ws, 'AGENTS.md')

function call(p, body, method, url) {
  return new Promise((resolve) => {
    const res = {
      code: 0,
      writeHead(c) { this.code = c },
      end(s) { resolve({ code: this.code, body: JSON.parse(s) }) },
    }
    const req = {
      method: method || (body === undefined ? 'GET' : 'POST'),
      url: url || p,
      on(ev, fn) {
        if (ev === 'data' && body !== undefined) fn(Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)))
        if (ev === 'end') fn()
      },
    }
    routes.get(p)(req, res)
  })
}

let n = 0
async function ok(name, fn) {
  n++
  try {
    await fn()
  } catch (e) {
    console.error('❌ ' + name + '\n   ' + (e && e.message))
    process.exitCode = 1
  }
}

await ok('R1 delete 路由已注册', () => assert.ok(routes.has('/dsh-rules/delete')))

await ok('R2 写具名块后 read 能列出它', async () => {
  const s = await call('/dsh-rules/save', { name: 'workspace', text: '工作区规则一' })
  assert.strictEqual(s.body.ok, true)
  assert.strictEqual(s.body.name, 'workspace')
  const r = await call('/dsh-rules/read')
  assert.strictEqual(r.body.blocks.length, 1)
  assert.strictEqual(r.body.blocks[0].name, 'workspace')
  assert.strictEqual(r.body.blocks[0].text, '工作区规则一')
})

await ok('R3 加第二个块，第一个不动', async () => {
  await call('/dsh-rules/save', { name: 'session-a', text: '对话规则一' })
  const r = await call('/dsh-rules/read')
  assert.deepStrictEqual(r.body.blocks.map((b) => b.name), ['workspace', 'session-a'])
  assert.strictEqual(r.body.blocks[0].text, '工作区规则一')
})

await ok('R4 file 参数写到工作区 AGENTS.md', async () => {
  const s = await call('/dsh-rules/save', { file: WS_FILE, name: 'workspace', text: 'MR 的工作区规则' })
  assert.strictEqual(s.body.ok, true)
  assert.strictEqual(s.body.filePath, WS_FILE)
  assert.ok(fs.readFileSync(WS_FILE, 'utf8').includes('MR 的工作区规则'))
  // 全局文件不该被这次写入影响
  assert.ok(!fs.readFileSync(HOME_FILE, 'utf8').includes('MR 的工作区规则'))
})

await ok('R5 read 带 ?file= 读的是另一个文件', async () => {
  const r = await call('/dsh-rules/read', undefined, 'GET', '/dsh-rules/read?file=' + encodeURIComponent(WS_FILE))
  assert.strictEqual(r.body.filePath, WS_FILE)
  assert.strictEqual(r.body.blocks[0].text, 'MR 的工作区规则')
})

await ok('R6 拒绝非 AGENTS.md 的文件名', async () => {
  const s = await call('/dsh-rules/save', { file: path.join(ws, 'other.md'), name: 'x', text: 'y' })
  assert.strictEqual(s.body.ok, false)
  assert.ok(/AGENTS\.md/.test(s.body.error))
})

await ok('R7 拒绝不存在的目录（不替人建目录）', async () => {
  const s = await call('/dsh-rules/save', { file: path.join(ws, 'nope', 'AGENTS.md'), name: 'x', text: 'y' })
  assert.strictEqual(s.body.ok, false)
  assert.ok(/目录不存在/.test(s.body.error))
})

await ok('R8 删除具名块', async () => {
  const d = await call('/dsh-rules/delete', { name: 'session-a' })
  assert.strictEqual(d.body.ok, true)
  const r = await call('/dsh-rules/read')
  assert.deepStrictEqual(r.body.blocks.map((b) => b.name), ['workspace'])
})

await ok('R9 删不存在的块明确报错', async () => {
  const d = await call('/dsh-rules/delete', { name: 'ghost' })
  assert.strictEqual(d.body.ok, false)
  assert.ok(d.body.error.includes('ghost'))
})

await ok('R10 delete 缺 name 返回 400', async () => {
  const d = await call('/dsh-rules/delete', { text: 'x' })
  assert.strictEqual(d.code, 400)
})

await ok('R11 旧请求体 {text} 仍写 global 块（向后兼容）', async () => {
  const s = await call('/dsh-rules/save', { text: '旧客户端写的规则' })
  assert.strictEqual(s.body.ok, true)
  const r = await call('/dsh-rules/read')
  const g = r.body.blocks.find((b) => b.name === 'global')
  assert.ok(g, 'global 块不存在')
  assert.strictEqual(g.text, '旧客户端写的规则')
  // 旧字段仍然给，且指向 global 块
  assert.strictEqual(r.body.text, '旧客户端写的规则')
  assert.strictEqual(r.body.hasBlock, true)
})

await ok('R12 非法块名被拒绝', async () => {
  const s = await call('/dsh-rules/save', { name: 'a b', text: 'x' })
  assert.strictEqual(s.body.ok, false)
  assert.ok(/不合法/.test(s.body.error))
})

await ok('R13 超长文本被拒绝且提示具体字节', async () => {
  const s = await call('/dsh-rules/save', { name: 'big', text: 'x'.repeat(300 * 1024) })
  assert.strictEqual(s.body.ok, false)
  assert.ok(/\d+ 字节/.test(s.body.error))
})

await ok('R14 写入后整个文件超限也拒绝', async () => {
  // 现有内容 + 新块 累积超过 256KB（单块 140KB、两块 280KB）
  const chunk = 'y'.repeat(140 * 1024)
  await call('/dsh-rules/save', { name: 'c1', text: chunk })
  const s = await call('/dsh-rules/save', { name: 'c2', text: chunk })
  assert.strictEqual(s.body.ok, false)
  assert.ok(/超过上限/.test(s.body.error))
  // 失败时不该破坏已有内容
  const r = await call('/dsh-rules/read')
  assert.ok(r.body.blocks.some((b) => b.name === 'c1'))
  assert.ok(!r.body.blocks.some((b) => b.name === 'c2'))
})

await ok('R15 无块的文件 read 返回空列表但 ok', async () => {
  const f = path.join(ws, 'AGENTS.md')
  const keep = fs.readFileSync(f, 'utf8')
  fs.writeFileSync(f, '# 只有手写内容\n', 'utf8')
  const r = await call('/dsh-rules/read', undefined, 'GET', '/dsh-rules/read?file=' + encodeURIComponent(f))
  assert.strictEqual(r.body.ok, true)
  assert.strictEqual(r.body.blocks.length, 0)
  assert.strictEqual(r.body.hasBlock, false)
  fs.writeFileSync(f, keep, 'utf8')
})

await ok('R16 半块只报告不修复', async () => {
  const f = path.join(ws, 'AGENTS.md')
  const keep = fs.readFileSync(f, 'utf8')
  fs.writeFileSync(f, '手写\n<!-- dsh-rules:block x -->\n残留\n', 'utf8')
  const r = await call('/dsh-rules/read', undefined, 'GET', '/dsh-rules/read?file=' + encodeURIComponent(f))
  assert.strictEqual(r.body.blocks.length, 0)
  assert.ok(r.body.problems.some((p) => p.includes('缺少结束标记')))
  assert.ok(fs.readFileSync(f, 'utf8').includes('残留'), '不应自动修复')
  fs.writeFileSync(f, keep, 'utf8')
})

await ok('R17 备份文件被写出', async () => {
  assert.ok(fs.existsSync(HOME_FILE + '.bak-dsh-rules'), '没有备份')
})

fs.rmSync(home, { recursive: true, force: true })
fs.rmSync(ws, { recursive: true, force: true })
console.log(n + ' 项断言' + (process.exitCode ? '，有失败' : '，全部通过'))
