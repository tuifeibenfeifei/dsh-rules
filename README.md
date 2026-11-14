# dsh-rules · DSH 规则设置页

[![test](https://github.com/tuifeibenfeifei/dsh-rules/actions/workflows/test.yml/badge.svg)](https://github.com/tuifeibenfeifei/dsh-rules/actions/workflows/test.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![dsh](https://img.shields.io/badge/dsh-%3E%3D0.2.1--0-8b5cf6.svg)](https://github.com/deepseek-ai/deepseek-harness)

在 DSH **设置页**新增一个「规则」分区，直接编辑规则文本，写进 `AGENTS.md` 的具名标记块。
保存后**下一次请求立即生效**，无需重启会话。

> 配套插件：[dsh-rules-guard](https://github.com/tuifeibenfeifei/dsh-rules-guard) —— 把「不可逆操作前确认」这类规则变成工具层硬拦截。


规则分三层叠加，这是 DSH 自己的加载顺序，不是本插件发明的：

```
DSH 全局   $DSH_HOME/AGENTS.md          ← 对所有会话生效
工作区     <项目根>/AGENTS.md            ← 在该目录下开会话时加载
对话       同一个文件里的具名块          ← 靠块名自律，不是物理隔离
```

## 为什么需要它

DSH 由 `@deepseek-ai/dsh-agent-instructions` 把 `AGENTS.md` 作为 durable user message 注入系统提示词：
先读 user-global 链（`$DSH_HOME/AGENTS.md`），再读 project 链（**项目根 → 会话工作目录逐层**）。
这是给「所有会话」和「某个项目」定规矩的正规位置。

但普通用户既不知道这些文件存在，也不该为了加一句「回答简洁点」去手改 Markdown。
本插件提供一个 UI 入口，并且**只碰自己的标记块**，绝不会覆盖你手写的内容。

## 块语法

旧格式（单块）仍旧有效，等价于名为 `global` 的块：

```markdown
<!-- dsh-rules:begin -->
（global 块的内容）
<!-- dsh-rules:end -->
```

新增具名块：

```markdown
<!-- dsh-rules:block workspace -->
（这个工作区的规则）
<!-- dsh-rules:end -->

<!-- dsh-rules:block frontend -->
（只在前端任务里希望遵守的规则）
<!-- dsh-rules:end -->
```

结束标记是共用的 `<!-- dsh-rules:end -->`。
块名限 `[A-Za-z0-9._-]{1,64}` —— 块名会进 HTML 注释，含 `-->` 或换行会把注释结构弄坏。

## 硬性保证

| 场景 | 行为 |
|---|---|
| 块已存在 | 只替换该块两个标记之间的内容，其余字节不动 |
| 文件存在、无该块 | 在**文件末尾**追加（前面留一个空行），不动已有内容 |
| 文件不存在 | 创建文件，只写该块 |
| 读取 | **只返回块内部**，手写内容不会进文本框（否则一保存就重复写入） |
| 写入前 | 备份到 `AGENTS.md.bak-dsh-rules`（覆盖式，只留一份） |
| 删除块 | 连同块外多余空行一起吃掉，不留双空行 |

另外：

- 块结构损坏（只有开始标记、只有结束标记、块被前一块包住、块名重复）**只报告不修复**：
  这种损坏通常是手工编辑删多了，自动修复等于替人决定保留哪半
- 规则文本里若混进标记字符串会被剔除，避免把块结构弄坏
- 清空文本框 ≠ 删除块：空文本也是合法的块内容，删块要点「删除这块」
- 单块上限 256 KB，写完后整个文件超 256 KB 也拒绝（两种分开报）
- 建议规则尽量短：`AGENTS.md` 每个会话整份注入，DSH 的注入预算是 65536 字节，两条链各自计算

## 界面

设置页 → 规则：标题、说明、**通用模板折叠区**、块标签栏（每块显示 `名字 · 字节数`，末尾有 `+ 新块`）、
等宽字体多行文本框、「保存 / 重新载入 / 删除这块」、字节数与未保存提示、状态行、
结构问题列表（有才显示）、文件路径（只读）。

样式全部使用主题 CSS 变量（`--dsw-alias-*`），跟随亮色/暗色主题，类名前缀 `dshrules-`。

## 第一次用：从模板开始

不知道该写什么时，不用从空白开始：

1. 打开 设置 → 规则
2. 点「▸ 从通用模板开始」
3. 勾选需要的层（默认已勾 `安全底线`）
4. 点「预览」看生成内容，或直接点「填入编辑框」
5. 按自己的情况改，然后点「保存」

「填入编辑框」**不会自动保存**，只是把文本放进编辑框，你有机会先看再决定。

## 怎么用三层

1. **全局**：设置页打开就是 `$DSH_HOME/AGENTS.md` 的 `global` 块，写对所有项目都成立的话。
2. **工作区**：在项目根放一个 `AGENTS.md`，在里面建一个 `workspace` 块。
   该目录下的会话会自动加载它 —— DSH 的 project 链按目录逐层读，不需要插件参与。
   把绝对路径传给接口即可写到指定文件（见下），**只允许写名为 `AGENTS.md` 的文件**，
   且目录必须已存在（不替你创建，避免路径写错时默默生成一堆空目录）。
3. **对话**：同一个 `AGENTS.md` 里再建 `frontend`、`data-pipeline` 这样的块，
   由提示词告诉智能体「本轮只遵守 global + workspace + frontend」。

> 对话级是**自律**不是隔离：同一工作区的所有会话读到的是同一个文件，
> 别的对话也会看见 `frontend` 块。真正的按会话隔离需要 DSH 支持「按 sessionId 选文件」，
> 而现有加载链是「按目录逐层」，插件做不到。写清楚这一点，比假装做到了更有用。

## 安装

DSH → 侧栏「插件」→「添加插件」→ 填入本目录的绝对路径。

| 改了什么 | 需要重启吗 |
|---|---|
| 首次安装 | 需要（一次） |
| `client.js` | 不需要，刷新页面（Ctrl+R） |
| `lib/index.js`（宿主侧） | **需要重启** |
| `cordis.patch.yml` | **需要重启** |

## HTTP 接口（宿主半身）

前缀 `/dsh-rules/`，与其它插件（`/cost-tracker/` 等）隔离。

| 路径 | 方法 | 说明 |
|---|---|---|
| `/dsh-rules/ping` | GET | `{ ok: true, plugin: 'dsh-rules' }` |
| `/dsh-rules/read?file=<绝对路径>` | GET | `{ ok, filePath, exists, blocks:[{name,text,bytes}], problems, text, hasBlock }`；`file` 可省略＝全局文件；`text`/`hasBlock` 是旧字段，供旧客户端 |
| `/dsh-rules/save` | POST `{ name, text, file? }` | 写具名块；`{ text }` 不带 `name` 等价于写 `global`（旧客户端兼容）；返回 `{ ok, bytes, filePath, warning? }` |
| `/dsh-rules/delete` | POST `{ name, file? }` | 删块；缺 `name` 返回 400 |
| `/dsh-rules/templates` | GET | 规则模板目录：`{ ok, layers:[{id,title,desc,count,rules}] }` |
| `/dsh-rules/templates/build` | POST `{ layers:[], personalText? }` | 生成规则文本：`{ ok, text, bytes, count }` |

### 规则模板（给所有人用）

插件不内置作者的规则。模板按「层」组织，每层都不含任何个人偏好：

| 层 | 条数 | 行数 | 内容 |
|---|---|---|---|
| `core` 安全底线 | 4 | 18 | 不可逆前确认、不手写运行数据、不终止自身进程、用证据汇报 |
| `behavior` 工程纪律 | 9 | 45 | 先问再做、简洁优先、外科手术式修改、目标驱动、算风险、报规模、反复失败回头审视、收尾给下一步、用户操作写到能照做 |
| `quality` 代码质量 | 6 | 29 | 先读再改、不留死代码、错误显式处理、命名与注释、不做提前抽象、改完要验证 |
| `safety` 安全与隐私 | 5 | 24 | 不泄露密钥、外部输入必须校验、依赖要谨慎、不为通过检查而削弱检查、权限最小化 |
| `collab` 协作与版本 | 4 | 19 | 版本操作边界、提交信息说清原因、评审聚焦改动、文档跟着改 |
| `personal` 个人规则 | 0 | 0 | 留空，你自己填 |

**建议只启用当前的需要的层。** 全开是 28 条 139 行，超过建议预算，界面会提示。

#### 为什么有预算限制

调研多个成熟规则集得到的共识：

- 前沿模型只能可靠遵循约 **150–200 条指令**，而模型自身系统提示已占约 50 条（[awesome-agents-md](https://github.com/khasky/awesome-agents-md) 用 CI 卡这个预算）
- **30 条以上警告型规则**会出现「过度探索陷阱」，输出质量下降最多 30%（[Augment Code](https://www.augmentcode.com/blog/how-to-write-good-agents-dot-md-files)）
- 主文件建议 **100–150 行、32 KiB 以内**，超了要么被截断，要么注意力稀释
- 规则越长，核心约束越容易被淹没——65 行的 Karpathy 版本跑赢 200 行的补丁集

所以界面上超预算时会给黄色提示，但不拦着不让用。

生成文本的方式：

```bash
curl -X POST http://127.0.0.1:<端口>/dsh-rules/templates/build \
  -d '{"layers":["core","quality"]}'
# → { ok, text, bytes, count, lines, budget, overBudget }
```

> 让模型帮你写规则也可以：
> `curl -X POST http://127.0.0.1:<端口>/dsh-rules/save -d '{"name":"workspace","text":"…"}'`

## 结构

```
dsh-rules/
├── package.json          # dsh.bundle.patch + dsh.client
├── cordis.patch.yml      # 挂载插件行（没有这行就没有浏览器半身）
├── client.js             # 浏览器半身：设置页分区
├── lib/index.js          # 宿主半身：路由 + 文件读写
├── lib/blocks.mjs        # 纯逻辑：块解析 / 写入 / 删除 / 净化（不碰 fs）
├── test/blocks.test.mjs  # 块逻辑 29 项
├── test/routes.test.mjs  # 路由 17 项
├── test/markblock.test.mjs
├── locale/zh.json, en.json
├── icon.svg
├── README.md
└── LICENSE
```

## 自测

```bash
node test/blocks.test.mjs      # 29 项：块语法与读写边界
node test/routes.test.mjs      # 17 项：四个路由 + 大小上限 + 兼容旧字段
node test/templates.test.mjs   # 模板层定义、通用性守护、预算校验
node test/markblock.test.mjs   # 隔离的临时 DSH_HOME，不碰真实 AGENTS.md
```

四套都用隔离的临时目录，不会碰真实的 `AGENTS.md`。

## 版本记录

见 [CHANGELOG.md](CHANGELOG.md)。

## 已知边界

- 在同一轮对话**进行中**保存，新规则对该轮是否生效未测；日常使用不敏感。
- 读取时若文件被其它程序同时改写，可能拿到旧内容，重载一次即可。
- DSH 不持续监听外部编辑：手工改完 `AGENTS.md` 后，进入更深目录或用一次 `read` 才会刷新。
