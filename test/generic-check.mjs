// CI 用的通用性守门员：模板里不许出现个人内容。
// 单独成文件是因为在 workflow 里写内联 JS 转义太容易出错。
import { LAYERS, buildRuleText } from '../lib/templates.js'

const banned = [
  'D:\\',
  'D:/',
  '19264',
  'dsh-home',
  'Karpathy',
  'andrej',
  'HowToLiveBetter',
  '生活决策',
]

const ids = LAYERS.filter((l) => l.id !== 'personal').map((l) => l.id)
const text = buildRuleText(ids)

const hits = banned.filter((b) => text.includes(b))
if (hits.length) {
  console.error('模板里出现了个人内容：' + hits.join(', '))
  console.error('模板要能给所有人用，个人偏好请放 personal 层或用户的 AGENTS.md。')
  process.exit(1)
}

console.log('模板通用性检查通过（' + ids.length + ' 层，' + LAYERS.reduce((n, l) => n + l.rules.length, 0) + ' 条）')
