// 宿主侧标记块读写的快速自测（不依赖 DSH 运行时）。
// 用法：node test/mark block.test.mjs —— 通过临时 DSH_HOME 隔离，不碰真实 AGENTS.md。
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-rules-'))
process.env.DSH_HOME = dir

const mod = await import('../lib/index.js')

// lib/index.js 只导出 apply/inject/name，读写函数是私有的。
// 所以这里通过伪造的 ctx + webServer 抓路由 handler 来测真实代码路径。
const routes = new Map()
const ctx = {
  effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
  inject(_deps, cb) {
    cb({ webServer: { register({ path: p, handler }) { routes.set(p, handler); return () => routes.delete(p) } } })
  },
}
mod.apply(ctx)

const file = path.join(dir, 'AGENTS.md')

function call(p, body, method) {
  return new Promise((resolve) => {
    const res = {
      code: 0,
      payload: null,
      writeHead(c) { this.code = c },
      end(s) { resolve({ code: this.code, body: JSON.parse(s) }) },
    }
    const req = {
      // 有 body 就默认 POST：save 路由对非 POST 返回 405（下面单独测）
      method: method || (body === undefined ? 'GET' : 'POST'),
      on(ev, fn) {
        if (ev === 'data' && body !== undefined) fn(Buffer.from(JSON.stringify(body)))
        if (ev === 'end') fn()
      },
    }
    routes.get(p)(req, res)
  })
}

assert.ok(routes.has('/dsh-rules/read'), 'read 路由未注册')
assert.strictEqual((await call('/dsh-rules/read')).body.hasBlock, false, '文件不存在时不应有块')

// 1. 文件不存在 → 保存创建，只有标记块
let r = (await call('/dsh-rules/save', { text: '规则A' })).body
assert.strictEqual(r.ok, true)
let raw = fs.readFileSync(file, 'utf8')
assert.ok(raw.includes('<!-- dsh-rules:begin -->') && raw.includes('规则A'))
assert.deepStrictEqual((await call('/dsh-rules/read')).body.text, '规则A')

// 2. 二次保存 → 整体替换，不堆积
await call('/dsh-rules/save', { text: '规则B' })
raw = fs.readFileSync(file, 'utf8')
assert.strictEqual(raw.split('<!-- dsh-rules:begin -->').length - 1, 1, '块重复了')
assert.ok(raw.includes('规则B') && !raw.includes('规则A'))

// 3. 已有手写内容、无标记块 → 末尾追加，手写完好
fs.writeFileSync(file, '# 手写标题\n\n手写正文\n', 'utf8')
await call('/dsh-rules/save', { text: '规则C' })
raw = fs.readFileSync(file, 'utf8')
assert.ok(raw.startsWith('# 手写标题\n\n手写正文\n'), '手写内容被破坏：' + JSON.stringify(raw))
assert.ok(raw.includes('规则C'))

// 4. 有手写内容 + 有块 → 只替换块内
await call('/dsh-rules/save', { text: '规则D' })
raw = fs.readFileSync(file, 'utf8')
assert.ok(raw.startsWith('# 手写标题\n\n手写正文\n'), '手写内容被破坏')
assert.ok(raw.includes('规则D') && !raw.includes('规则C'))

// 5. 清空
await call('/dsh-rules/save', { text: '' })
r = (await call('/dsh-rules/read')).body
assert.strictEqual(r.hasBlock, true, '清空后块应保留')
assert.strictEqual(r.text, '', '清空后文本应为空')
raw = fs.readFileSync(file, 'utf8')
assert.ok(raw.startsWith('# 手写标题'), '清空破坏了手写内容')

// 6. 备份存在
assert.ok(fs.existsSync(file + '.bak-dsh-rules'), '没有备份文件')

// 7. 半块（只有 begin）→ 不自动修复，且保存时追加新块而不是破坏
fs.writeFileSync(file, '手写\n<!-- dsh-rules:begin -->\n残留\n', 'utf8')
r = (await call('/dsh-rules/read')).body
assert.strictEqual(r.hasBlock, false)
assert.ok(typeof r.warning === 'string' && r.warning.length > 0, '缺 END 时应给 warning')

// 8. 文本里混进标记 → 被剔除
await call('/dsh-rules/save', { text: '健康<!-- dsh-rules:end -->' })
raw = fs.readFileSync(file, 'utf8')
assert.strictEqual(raw.split('<!-- dsh-rules:end -->').length - 1, 1, '标记未剔除')

// 9. 超长 → 拒绝
const big = 'x'.repeat(300 * 1024)
r = (await call('/dsh-rules/save', { text: big })).body
assert.strictEqual(r.ok, false)
assert.ok(/上限|超过/.test(r.error))

// 10. 非法 JSON → 400
r = await new Promise((resolve) => {
  const res = { code: 0, writeHead(c) { this.code = c }, end(s) { resolve({ code: this.code, body: JSON.parse(s) }) } }
  const req = {
    method: 'POST',
    on(ev, fn) {
      if (ev === 'data') fn(Buffer.from('{oops'))
      if (ev === 'end') fn()
    },
  }
  routes.get('/dsh-rules/save')(req, res)
})
assert.strictEqual(r.code, 400)

fs.rmSync(dir, { recursive: true, force: true })
console.log('all mark-block tests passed')
