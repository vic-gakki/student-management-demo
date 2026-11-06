# 学生管理系统（技术作业）

教育机构的学生管理系统：从**咨询、试听**开始，到**排班、点名扣课时、欠课、续费 / 退费**。
设计思路、取舍、数据模型和业务规则见 **[DESIGN.md](DESIGN.md)**。

- 技术栈：Next.js 15（App Router）+ React 19 + TypeScript、Drizzle ORM、PostgreSQL、Tailwind + shadcn/ui（Radix）、TanStack Query、Zod、Vitest
- 业务时间统一按 `Australia/Melbourne`
- **线上地址：https://student-management-demo-six.vercel.app**（Vercel + Neon PostgreSQL，演示账号见下方）

## 快速开始

需要 Node.js 20+ 和 pnpm。**不需要 Docker**：本地默认使用 [PGlite](https://pglite.dev)（以 WASM 运行的真实 PostgreSQL，支持 `btree_gist`、EXCLUDE 约束和触发器），数据存在 `.data/pglite`。

```bash
pnpm install
```

```bash
pnpm db:seed
```

```bash
pnpm dev
```

打开 http://localhost:3000 。`db:seed` 会清空并重建演示数据，所有日期相对"今天（墨尔本）"生成。运行 seed 前要先停掉 `pnpm dev`，因为 PGlite 同一时间只能被一个进程打开。

| 账号 | 角色 | 说明 |
|---|---|---|
| `admin1@school.test` | 课程顾问 王敏 | 演示主角，负责 28 个学生 |
| `admin2@school.test` ~ `admin10` | 其他顾问 | 用来演示"可看不可改" |
| `teacher1@school.test` | 老师 | 今天有一节演示班（09:00）和一节试听（10:30） |
| `teacher2@school.test` ~ `teacher20` | 其他老师 | |

所有演示账号的密码都是 `demo1234`（定义在 `scripts/seed.ts` 的 `DEMO_PASSWORD`，只用于本地演示数据）。

### 可选配置（`.env.local`）

| 变量 | 作用 |
|---|---|
| `LLM_PROVIDER` | `anthropic`（默认）或 `openai`（OpenAI 及兼容协议：DeepSeek、通义千问、Ollama、vLLM 等） |
| `LLM_MODEL` | 模型名；Anthropic 默认 `claude-haiku-5-5`，openai 协议必填 |
| `LLM_API_KEY` | 通用 key，未设置时回退到 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`。不配置可用的模型时 AI 自动降级，其余功能照常 |
| `LLM_BASE_URL` | 自定义地址：Anthropic 兼容网关，或 OpenAI 兼容服务（如 `http://localhost:11434/v1`，本地模型可以不填 key） |
| `LLM_MAX_TOKENS_FIELD` / `LLM_STRICT_TOOLS` | 仅 openai 协议：OpenAI 新模型用 `max_completion_tokens`；兼容服务不认识 `strict` 时设为 `false` |
| `DATABASE_URL` | 设置后改用 PostgreSQL（如 Neon），先运行 `pnpm db:migrate` |

## 演示路线（约 10 分钟）

1. **admin1 登录 → 工作台**：需跟进的有周舟（咨询 5 天未试听）、张悦（欠课）、李明（试听后逾期未跟进）；课时快用完的有张悦、孙琪、刘洋、赵一；本周新入班的有陈晨等。
2. **张悦详情**：余额 0、欠 1 节。点"加入班级"，所有班都显示"课时余额为 0"。点**录入续费**后会先补扣欠课，流水里出现"续费后补扣欠课"。
3. **加入班级 → 英语**：英语基础A 显示"与数学提高时间冲突"，英语提高（周六）显示"已满"，其余班如果不在可用时间内会给出提示。在 AI 排班助手里输入"避开周末，最好和数学同一天"或"最好和王小明一个班"，AI 给出最多 2 个方案和理由，确认后走正常排班接口。
4. **李明 → 记录跟进结果**：选"考虑中"会生成新的跟进日期；选"报名"会打开录入课时包。
5. **周舟 → 安排试听**：选一个已有时段，或新建时段（如果选的时间老师有课，会提示 `TEACHER_BUSY`）。
6. **teacher1 登录 → 今日课程**：演示班里陈晨显示 🆕 新生，孙琪显示 ⚠️ 课时已用完。提交点名后，孙琪记为欠课，admin1 的工作台出现欠课待办。在 10:30 的试听里点名吴桐，admin1 收到 2 天内跟进的待办。
7. **破坏测试**：用 [break-tests.http](break-tests.http) 绕过界面逐条打接口（VS Code REST Client），或者一次跑完：

```bash
node scripts/break-tests.mjs https://student-management-demo-six.vercel.app
```

破坏测试会改动数据（比如给张悦续费），跑完后要重新生成演示数据。

## 测试

```bash
pnpm test
```

一共 51 个测试，在内存 PGlite 上跑真实的迁移和约束：

| 文件 | 覆盖内容 |
|---|---|
| `tests/enrollment.test.ts` | 规则 1/2/3/4/6/15：老师冲突（数据库 EXCLUDE）、学生冲突、人数上限、余额、权限、转班、并发排班只成功一个 |
| `tests/attendance.test.ts` | 规则 5/7/8/9/10/11：重复点名只扣一次、改点名写补偿流水、代课权限、点名时间窗、欠课上限、续费补扣、付款去重、退费金额、流水只追加 |
| `tests/trials.test.ts` | 规则 12/13/14：每科一次、老师/学生冲突、代课不算冲突、时段人数、试听点名生成跟进待办、跟进结果、工作台 |
| `tests/llm.test.ts` | 规则 16：AI 只拿到只读工具、违规方案被丢弃、确认时重新检查、各种失败降级、经 OpenAI 协议跑通；反馈只接受名单内学生 |
| `tests/llm-adapters.test.ts` | Anthropic / OpenAI 两种格式的请求与响应转换、非法工具参数、错误处理、按环境变量选择协议 |
| `tests/api.test.ts` | 通过 HTTP 层：401 / 403 / 越权修改 / 非法 JSON |
| `tests/time.test.ts` | 跨夏令时课次时间不漂移 |

```bash
pnpm typecheck
```

## 代码结构

```
db/migrations/0001_init.sql   建表与全部数据库约束（EXCLUDE / CHECK / 部分唯一 / 只追加触发器）
src/db/                       Drizzle 表定义、PGlite / PostgreSQL 连接
src/server/services/          业务规则（唯一实现处）
  eligibility.ts              排班资格检查：候选列表、手动排班、AI 工具都调用它
  enrollment.ts               排班事务（锁学生行 + 班级行）、退班、转班
  attendance.ts               点名扣课时、欠课、补偿流水、今日课程
  ledger.ts                   续费（补扣欠课）、退费
  trials.ts                   试听时段、安排试听、试听点名、跟进结果
  students.ts / dashboard.ts  咨询登记、学生详情、工作台
src/server/llm/               AI 排班助手（tool use）、课后反馈整理（结构化输出）
src/server/http.ts            Route Handler 包装：会话 → 角色 → 服务 → 错误映射
src/app/api/**                REST 接口（薄层）
src/app/admin/**, teacher/**  页面
scripts/seed.ts               演示数据
```

**规则在哪里执行**：所有写操作都走 `src/app/api` 下的 REST 接口，并调用 `services`。数据库能表达的规则（老师冲突、余额非负、欠课上限、出勤唯一、付款去重、流水只追加）同时加了数据库约束兜底。具体见 DESIGN.md 第 4 部分。

## 两处 AI

1. **AI 排班助手**（`src/server/llm/scheduling.ts`）：LLM 通过 4 个**只读**工具调用现有的规则函数，再用 `submit_proposals`（`strict` 工具）提交最多 2 个方案。服务端用 Zod 校验格式，并用最新数据重新检查每个班，不通过的丢弃。限制最多 6 轮、总共 30 秒。失败时退回候选列表。admin 确认后走 `POST /api/enrollments`，规则会再检查一次。
2. **课后反馈整理**（`src/server/llm/feedback.ts`）：老师的随手反馈被整理成投入度、给家长的一句话和是否需要跟进。只接受名单里的学生；需要跟进的会生成顾问待办。点名先提交，AI 失败只标记"整理失败"并保留原文。

**协议适配层**：业务代码只依赖 `src/server/llm/types.ts` 里与协议无关的消息格式（文本、工具调用、工具结果）。`anthropic.ts`（官方 SDK）和 `openai.ts`（`/v1/chat/completions`）负责与各自格式互相转换，比如 Anthropic 把工具结果放在 user 消息里，OpenAI 要求每个结果是单独的 `tool` 消息。切换协议只需要改环境变量，校验和降级逻辑不变。

## 部署

已部署在 https://student-management-demo-six.vercel.app （Vercel 从 GitHub main 自动部署，数据库是通过 Vercel Storage 创建的 Neon）。

1. 在 Vercel 导入仓库（`vercel.json` 已指定 Next.js 框架），在 Storage 里创建 Neon。这会自动设置 `DATABASE_URL`。如果要开启 AI，再按上面的表格加上 `LLM_*` 变量（或只加 `ANTHROPIC_API_KEY`）。
2. 本地把同一个连接串写进 `.env.remote`（参考 `.env.remote.example`，已 git 忽略），然后运行下面的命令，会迁移并重新生成演示数据：

```bash
pnpm db:seed:remote
```

演示数据按生成当天的日期构造（"今日课程"、逾期待办等都依赖这一点），所以演示当天要再运行一次。PGlite 只用于本地和测试；Vercel 的文件系统不持久，部署必须设置 `DATABASE_URL`。

## AI 工具的使用

> 这一节需要作者本人根据实际情况补充和确认。

- **用在了哪些环节**：用 Claude Code 梳理需求、讨论设计取舍（DESIGN.md 里的判断由我逐条确认和修改）、生成代码和测试、在浏览器里走查页面。
- **没有采纳的 AI 建议**：
  - AI 最初建议**把试听插进现有正式班**。我没有采纳：正式班学生固定、经常满员，可能排不进去；而且每周内容不同，试听体验不稳定。最后改成独立试听时段 + 每科固定内容。
  - AI 最初建议**第一版不做 AI 排班**，理由是排班是确定性规则。我采纳了"规则由代码判断"这一点，但仍然加入了排班助手：LLM 只通过 tool call 复用现有规则函数、只给建议，由人确认。
  - _（其他按实际情况补充）_
