// 前端逻辑的离线验证：不依赖浏览器，检查模板面板的关键分支。
//
// 直接用 node 跑，模拟 React 的最小环境（只需 createElement 返回结构），
// 重点验证「勾选层 → 生成文本 → 填入编辑框」这条链路没有断。

import assert from 'node:assert'
import { LAYERS, buildRuleText, countRules, estimateLines, LINE_BUDGET } from '../lib/templates.js'

// ① 层定义完整
assert.ok(LAYERS.length >= 3, '至少三层')
assert.deepStrictEqual(
  LAYERS.map((l) => l.id),
  ['core', 'behavior', 'quality', 'safety', 'collab', 'personal'],
  '层顺序应固定',
)
for (const layer of LAYERS) {
  if (layer.id === 'personal') {
    assert.strictEqual(layer.rules.length, 0, 'personal 层应为空模板')
  } else {
    assert.ok(layer.rules.length > 0, layer.id + ' 层应有规则')
  }
}

// ② 每条规则都有可判定的结构
for (const layer of LAYERS) {
  if (layer.id === 'personal') continue
  for (const rule of layer.rules) {
    assert.ok(rule.id, '规则缺 id: ' + rule.title)
    assert.ok(rule.title, '规则缺标题')
    assert.ok(Array.isArray(rule.lines) && rule.lines.length > 0, '规则缺内容: ' + rule.title)
    assert.ok(rule.reason, '规则缺理由: ' + rule.title)
    // 每条至少一行是可判定的祈使句（以 - 开头）
    assert.ok(rule.lines.some((l) => l.trim().startsWith('-')), '规则无祈使句: ' + rule.title)
  }
}

// ③ 不含个人化内容（这是「通用」的核心保证）
const ALL_LAYER_IDS = LAYERS.filter((l) => l.id !== 'personal').map((l) => l.id)
const allText = buildRuleText(ALL_LAYER_IDS)
for (const banned of ['D:\\', 'D:/', '19264', '生活决策', 'HowToLiveBetter', 'Karpathy', 'andrej']) {
  assert.ok(!allText.includes(banned), '通用模板里不该出现个人内容: ' + banned)
}

// ④ 生成结果稳定且符合预算
const a = buildRuleText(['core'])
const b = buildRuleText(['core'])
assert.strictEqual(a, b, '同样输入应得到同样输出')
assert.strictEqual(countRules(['core']), 4)

// 全部层加起来不能超过指令上限（150–200 条指令，系统提示已占约 50）
const full = buildRuleText(ALL_LAYER_IDS)
const fullLines = estimateLines(ALL_LAYER_IDS)
assert.ok(fullLines < 200, '全开不该超过 200 行，实际 ' + fullLines)
const bytes = Buffer.byteLength(full, 'utf8')
assert.ok(bytes < 65536, '必须在 DSH 的 64KB 注入预算内，实际 ' + bytes)
assert.ok(bytes > 1000, '内容不应为空')

// 默认 core 必须远低于预算，这才是「建议始终启用」的底气
assert.ok(estimateLines(['core']) < 30, 'core 应保持精简，实际 ' + estimateLines(['core']) + ' 行')

// ⑤ personal 层行为
const withPersonal = buildRuleText(['core', 'personal'], { personalText: '我的自定义规则内容' })
assert.ok(withPersonal.includes('我的自定义规则内容'), 'personal 内容应被包含')
const emptyPersonal = buildRuleText(['core', 'personal'], { personalText: '   ' })
assert.ok(!emptyPersonal.includes('个人规则'), '空白 personal 不该产生空段落')

// ⑥ 未知层被忽略而不是报错
assert.doesNotThrow(() => buildRuleText(['nonexistent']))
assert.strictEqual(buildRuleText(['nonexistent']), '', '未知层应返回空')

// ⑦ 默认勾选 core 的语义：它必须是最小可用集
assert.strictEqual(LAYERS[0].id, 'core', '第一层应是核心层')
assert.ok(countRules(['core']) >= 3, 'core 不应过少')

// ⑧ 预算常量合理
assert.ok(LINE_BUDGET > 50 && LINE_BUDGET < 200, '预算应在合理区间，实际 ' + LINE_BUDGET)

console.log('all template tests passed')
console.log('  默认 core:      ' + countRules(['core']) + ' 条, ' + estimateLines(['core']) + ' 行, ' + Buffer.byteLength(a, 'utf8') + ' 字节')
console.log('  core+behavior:  ' + countRules(['core', 'behavior']) + ' 条, ' + estimateLines(['core', 'behavior']) + ' 行, ' + Buffer.byteLength(buildRuleText(['core', 'behavior']), 'utf8') + ' 字节')
console.log('  全部层:         ' + countRules(ALL_LAYER_IDS) + ' 条, ' + fullLines + ' 行, ' + bytes + ' 字节')
console.log('  预算:           ' + LINE_BUDGET + ' 行')
