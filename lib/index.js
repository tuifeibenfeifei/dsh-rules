// dsh-rules —— 宿主半身（Node 侧）
//
// 职责只有两件事：
//   1. 读写 $DSH_HOME/AGENTS.md 里属于本插件的「标记块」
//   2. 通过 webServer 暴露两个 HTTP 路由，给浏览器半身调用
//
// 为什么这么设计：
// - AGENTS.md 由 @deepseek-ai/dsh-agent-instructions 加载，作为 durable user message
//   注入系统提示词；它在**宿主进程**里被读取，所以规则必须落在宿主的文件上，
//   前端 localStorage 对提示词完全无效。
// - 实测（2026-10-28）：改文件后下一次请求即读到新内容，不需要重启会话。
// - 但 AGENTS.md 里通常还有用户手写的内容，绝不能整文件覆写。所以本插件
//   只承认 <!-- dsh-rules:begin --> ... <!-- dsh-rules:end --> 之间的片段，
//   读取只回填这段，保存只替换这段。

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  BEGIN,
  END,
  LEGACY_NAME,
  isValidName,
  parseBlocks,
  renderBlock,
  upsertBlock,
  removeBlock,
} from './blocks.mjs'
import { LAYERS, buildRuleText, countRules, estimateLines, LINE_BUDGET } from './templates.js'

export const name = 'dsh-rules'
// webServer 是可选服务：不写进 inject 的话，ctx.webServer 在顶层取不到
// （会抛 "cannot get property webServer without inject"）。
export const inject = ['webServer']

const BAK_SUFFIX = '.bak-dsh-rules'

// 256KB 上限：AGENTS.md 的注入预算本身是 65536 字节，这里留足余量但仍要
// 挡住误贴进来的巨大文本，避免把一次请求变成几 MB 的写盘。
const MAX_BYTES = 256 * 1024

/**
 * 目标文件：file 参数优先，否则 $DSH_HOME/AGENTS.md。
 *
 * 为什么要能换文件（file 参数）：用户要的是「全局 + 工作区 + 对话」三层。
 * 全局层落在 $DSH_HOME/AGENTS.md，工作区层落在 <工作区根>/AGENTS.md，
 * 由 DSH 的 project 链自己加载。两层用的是同一套标记块语法，所以这里
 * 只多一个「改哪个文件」的入口，不重复实现一遍读写逻辑。
 *
 * 只接受已存在目录下的 AGENTS.md：这个接口会写盘，放开任意路径等于把
 * 设置页变成一个「往任意位置写文件」的按钮。
 */
function resolveAgentsFile(file) {
  if (file === undefined || file === null || file === '') {
    const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
    return path.join(home, 'AGENTS.md')
  }
  if (typeof file !== 'string' || !file.trim()) {
    throw new Error('file 必须是非空字符串')
  }
  const abs = path.resolve(file)
  if (path.basename(abs).toLowerCase() !== 'agents.md') {
    throw new Error('只允许读写名为 AGENTS.md 的文件，收到：' + abs)
  }
  const dir = path.dirname(abs)
  let st = null
  try {
    st = fs.statSync(dir)
  } catch {
    throw new Error('目录不存在：' + dir + '（不替你创建，避免路径写错时默默生成一堆空目录）')
  }
  if (!st.isDirectory()) throw new Error('不是目录：' + dir)
  return abs
}

/** 读文件，不存在当作空文件（返回 exists:false，不抛）。 */
function readRaw(file) {
  try {
    return { raw: fs.readFileSync(file, 'utf8'), exists: true };
  } catch (e) {
    if (e && e.code === 'ENOENT') return { raw: '', exists: false };
    throw e;
  }
}

/**
 * 读取状态：列出所有块，供 UI 展示与编辑。
 *
 * 永远不抛（除 resolveAgentsFile 的参数错误）：读不到也要把「为什么读不到」
 * 原样交给 UI，让用户看到真实的失败原因，而不是一个空白文本框。
 */
function readState(file) {
  let filePath;
  try {
    filePath = resolveAgentsFile(file);
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e), filePath: '', blocks: [] };
  }

  let raw = '';
  let exists = true;
  try {
    const r = readRaw(filePath);
    raw = r.raw;
    exists = r.exists;
  } catch (e) {
    return {
      ok: false,
      error: '读取失败：' + (e && e.message ? e.message : String(e)),
      filePath,
      blocks: [],
    };
  }

  const { blocks, problems } = parseBlocks(raw);

  // 旧字段（text / hasBlock）保留：浏览器半身旧版本仍在用，突然删字段会让
  // 已安装的旧客户端把「有规则」显示成「没有规则」。
  const legacy = blocks.find((b) => b.name === LEGACY_NAME);
  return {
    ok: true,
    filePath,
    exists,
    blocks: blocks.map((b) => ({ name: b.name, text: b.text, bytes: Buffer.byteLength(b.text, 'utf8') })),
    problems,
    text: legacy ? legacy.text : '',
    hasBlock: blocks.length > 0,
    warning: problems.length ? problems.join(' ') : undefined,
  };
}

/** 写盘：先备份（覆盖式，只留一份）再写。 */
function writeRaw(filePath, next, exists) {
  if (exists) {
    try {
      fs.writeFileSync(filePath + BAK_SUFFIX, fs.readFileSync(filePath, 'utf8'), 'utf8');
    } catch { /* 备份失败不影响主流程 */ }
  }
  try {
    fs.writeFileSync(filePath, next, 'utf8');
  } catch (e) {
    return { ok: false, error: '写入失败：' + (e && e.message ? e.message : String(e)) };
  }
  return { ok: true };
}

/** 校验文本体积。AGENTS.md 每个会话都会整份注入，所以这里必须挡。 */
function checkSize(text, label) {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > MAX_BYTES) {
    return {
      ok: false,
      error: (label || '规则') + '过长（' + bytes + ' 字节），上限 ' + MAX_BYTES + ' 字节。AGENTS.md 每个会话都会整份注入，请精简。',
    };
  }
  return { ok: true };
}

/**
 * 写一个具名块（新增或替换）。
 *
 * 这是多块模式的主入口。块名 global 时与旧格式完全兼容——旧文件里那个
 * 没有名字的 <!-- dsh-rules:begin --> 块读出来就叫 global。
 */
function saveBlock(file, blockName, text) {
  if (typeof text !== 'string') return { ok: false, error: 'text 必须是字符串' };
  const nm = blockName === undefined || blockName === null || blockName === '' ? LEGACY_NAME : blockName;
  if (!isValidName(nm)) {
    return { ok: false, error: '块名不合法：' + JSON.stringify(nm) + '（只允许字母数字、点、下划线、连字符，1~64 个字符）' };
  }
  const size = checkSize(text, '块「' + nm + '」');
  if (!size.ok) return size;

  let filePath;
  try {
    filePath = resolveAgentsFile(file);
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }

  let raw = '';
  let exists = true;
  try {
    const r = readRaw(filePath);
    raw = r.raw;
    exists = r.exists;
  } catch (e) {
    return { ok: false, error: '读取原文件失败：' + (e && e.message ? e.message : String(e)) };
  }

  const applied = upsertBlock(raw, nm, text);
  if (!applied.ok) return applied;

  const total = Buffer.byteLength(applied.text, 'utf8');
  if (total > MAX_BYTES) {
    return {
      ok: false,
      error: '写完后整个文件 ' + total + ' 字节，超过上限 ' + MAX_BYTES + ' 字节。请拆到另一个文件或精简。',
    };
  }

  const w = writeRaw(filePath, applied.text, exists);
  if (!w.ok) return w;

  return {
    ok: true,
    name: nm,
    bytes: Buffer.byteLength(text, 'utf8'),
    totalBytes: total,
    filePath,
    warning: applied.warning,
  };
}

/** 删一个具名块。块不存在时明确报错，不假装成功。 */
function deleteBlock(file, blockName) {
  if (!isValidName(blockName)) {
    return { ok: false, error: '块名不合法：' + JSON.stringify(blockName) };
  }
  let filePath;
  try {
    filePath = resolveAgentsFile(file);
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }

  let raw = '';
  let exists = true;
  try {
    const r = readRaw(filePath);
    raw = r.raw;
    exists = r.exists;
  } catch (e) {
    return { ok: false, error: '读取原文件失败：' + (e && e.message ? e.message : String(e)) };
  }
  if (!exists) return { ok: false, error: '文件不存在：' + filePath };

  const applied = removeBlock(raw, blockName);
  if (!applied.ok) return applied;

  const w = writeRaw(filePath, applied.text, exists);
  if (!w.ok) return w;
  return { ok: true, name: blockName, filePath };
}

/**
 * 旧接口：整段写入 global 块。
 *
 * 保留它是因为浏览器半身的旧版本只会调 {text}。等价于 saveBlock(global)。
 */
function saveText(input, file) {
  if (typeof input !== 'string') return { ok: false, error: 'text 必须是字符串' };
  return saveBlock(file, LEGACY_NAME, input);
}

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
}

function sendJson(res, code, obj) {
  try {
    res.writeHead(code, JSON_HEADERS)
    res.end(JSON.stringify(obj))
  } catch { /* 连接已断时忽略 */ }
}

/**
 * 从 GET 的查询串里取 file 参数（读取用）。
 *
 * 为什么不放在请求体里：/read 是 GET，语义上「读哪个文件」是寻址而不是内容。
 * 解析失败一律当作没给 —— 参数写错时退回默认文件，比 500 好排查。
 */
function queryFile(req) {
  try {
    const raw = req && req.url ? String(req.url) : ''
    const q = raw.indexOf('?')
    if (q < 0) return undefined
    const params = new URLSearchParams(raw.slice(q + 1))
    const v = params.get('file')
    return v === null || v === '' ? undefined : v
  } catch {
    return undefined
  }
}

/** 读请求体，带上限；超限直接拒绝，避免把内存吃满。
 *
 * 上限比 MAX_BYTES 宽 4KB：JSON 包装（`{"text":"…"}` + 转义）会让请求体比
 * 规则文本本身大，若两者相等，用户会先撞到 413 这条更含糊的错误，
 * 而不是下面 saveText 里那条带具体字节数的提示。
 */
const MAX_BODY = MAX_BYTES + 4096

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    let size = 0
    let aborted = false
    req.on('data', (c) => {
      if (aborted) return
      size += c.length
      if (size > MAX_BODY) {
        aborted = true
        resolve({ tooLarge: true, raw: '' })
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      if (!aborted) resolve({ tooLarge: false, raw: Buffer.concat(chunks).toString('utf8') })
    })
    req.on('error', () => {
      if (!aborted) resolve({ tooLarge: false, raw: '' })
    })
  })
}

export function apply(ctx) {
  try {
    if (typeof ctx.inject !== 'function') {
      console.error('[dsh-rules] ctx.inject 不可用，宿主半身未启动')
      return
    }

    let webServerRef = null
    const disposers = []

    function registerRoute(p, handler) {
      const ws = webServerRef
      if (!ws || typeof ws.register !== 'function') return
      disposers.push(
        ctx.effect(() => {
          const dispose = ws.register({ kind: 'exact', path: p, handler })
          return () => {
            try { dispose && dispose() } catch { /* 忽略 */ }
          }
        }),
      )
    }

    ctx.effect(() => () => {
      for (const d of disposers) {
        try { typeof d === 'function' && d() } catch { /* 忽略 */ }
      }
    })

    // webServer 只在 inject 作用域内可用，注册路由必须在回调里做。
    ctx.inject(['webServer'], (webCtx) => {
      try {
        webServerRef = webCtx && webCtx.webServer ? webCtx.webServer : null
        if (!webServerRef) {
          console.error('[dsh-rules] webServer 不可用，规则路由未注册')
          return
        }

        // 冒烟用：确认宿主半边真的挂上了。
        registerRoute('/dsh-rules/ping', (req, res) => {
          sendJson(res, 200, { ok: true, plugin: 'dsh-rules' })
        })

        // 规则模板库。
        //
        // 为什么要这个接口：插件要能给别人用，就不能把作者的规则塞进去。
        // 这里只提供「通用规则模板」，用户在前端勾选后才写进自己的 AGENTS.md。
        // core/behavior 层不含任何个人偏好，personal 层留空由用户自己填。
        registerRoute('/dsh-rules/templates', (req, res) => {
          try {
            sendJson(res, 200, {
              ok: true,
              layers: LAYERS.map((l) => ({
                id: l.id,
                title: l.title,
                desc: l.desc,
                count: l.rules.length,
                rules: l.rules.map((r) => ({ id: r.id, title: r.title, reason: r.reason })),
              })),
              budget: LINE_BUDGET,
            })
          } catch (e) {
            sendJson(res, 500, { ok: false, error: '读取模板异常：' + (e && e.message ? e.message : String(e)) })
          }
        })

        // 按选中的层生成规则文本，供前端预览或直接保存。
        // body: { layers: ['core','behavior'], personalText?: string }
        registerRoute('/dsh-rules/templates/build', async (req, res) => {
          try {
            if (req.method && req.method !== 'POST') {
              sendJson(res, 405, { ok: false, error: '只接受 POST' })
              return
            }
            const { tooLarge, raw } = await readBody(req)
            if (tooLarge) {
              sendJson(res, 413, { ok: false, error: '请求体过大' })
              return
            }
            let body = {}
            try { body = raw.trim() === '' ? {} : JSON.parse(raw) } catch { /* 空体按空处理 */ }
            const layers = Array.isArray(body.layers) ? body.layers.filter((x) => typeof x === 'string') : []
            const text = buildRuleText(layers, { personalText: body.personalText })
            const lines = estimateLines(layers, { personalText: body.personalText })
            sendJson(res, 200, {
              ok: true,
              text,
              bytes: Buffer.byteLength(text, 'utf8'),
              count: countRules(layers),
              lines,
              budget: LINE_BUDGET,
              // 超预算时前端给提示，而不是拦住不让用
              overBudget: lines > LINE_BUDGET,
            })
          } catch (e) {
            sendJson(res, 500, { ok: false, error: '生成模板异常：' + (e && e.message ? e.message : String(e)) })
          }
        })

        registerRoute('/dsh-rules/read', (req, res) => {
          try {
            sendJson(res, 200, readState(queryFile(req)))
          } catch (e) {
            sendJson(res, 500, { ok: false, error: '读取异常：' + (e && e.message ? e.message : String(e)) })
          }
        })

        // 保存：向后兼容三种请求体
        //   { text }                        —— 旧客户端，写 global 块
        //   { name, text }                  —— 写指定具名块（不存在则新增）
        //   { text, file } / { name, text, file } —— 顺带指定目标文件
        registerRoute('/dsh-rules/save', async (req, res) => {
          try {
            if (req.method && req.method !== 'POST') {
              sendJson(res, 405, { ok: false, error: '只接受 POST' })
              return
            }
            const { tooLarge, raw } = await readBody(req)
            if (tooLarge) {
              sendJson(res, 413, { ok: false, error: '请求体超过 ' + MAX_BODY + ' 字节' })
              return
            }
            let body = {}
            try {
              body = raw.trim() === '' ? {} : JSON.parse(raw)
            } catch {
              sendJson(res, 400, { ok: false, error: '请求体不是合法 JSON' })
              return
            }
            const b = body || {}
            // 有 name 字段就是多块模式；没有则走旧的整段保存。
            const out = b.name === undefined
              ? saveText(b.text, b.file)
              : saveBlock(b.file, b.name, b.text)
            sendJson(res, 200, out)
          } catch (e) {
            sendJson(res, 500, { ok: false, error: '保存异常：' + (e && e.message ? e.message : String(e)) })
          }
        })

        // 删除一个具名块。info 是空块列表时唯一的补救手段，所以单独开一个路由，
        // 而不是靠「保存空文本」——那两种语义必须分得开。
        registerRoute('/dsh-rules/delete', async (req, res) => {
          try {
            if (req.method && req.method !== 'POST') {
              sendJson(res, 405, { ok: false, error: '只接受 POST' })
              return
            }
            const { tooLarge, raw } = await readBody(req)
            if (tooLarge) {
              sendJson(res, 413, { ok: false, error: '请求体超过 ' + MAX_BODY + ' 字节' })
              return
            }
            let body = {}
            try {
              body = raw.trim() === '' ? {} : JSON.parse(raw)
            } catch {
              sendJson(res, 400, { ok: false, error: '请求体不是合法 JSON' })
              return
            }
            const b = body || {}
            if (!b.name) {
              sendJson(res, 400, { ok: false, error: '缺少 name' })
              return
            }
            sendJson(res, 200, deleteBlock(b.file, b.name))
          } catch (e) {
            sendJson(res, 500, { ok: false, error: '删除异常：' + (e && e.message ? e.message : String(e)) })
          }
        })

        console.log('[dsh-rules] 规则路由已注册：/dsh-rules/{ping,read,save,delete}')
      } catch (e) {
        console.error('[dsh-rules] webServer 注入失败：', e)
      }
    })
  } catch (e) {
    // 前端插件抛异常会让 DSH 判定启动失败并弹出「禁用第三方插件」的恢复界面，
    // 所以整段必须兜住。
    console.error('[dsh-rules] apply 失败：', e)
  }
}
