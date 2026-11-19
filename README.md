# galgame —— 校园 AI 文字游戏（引擎 + 插件式玩法）

> 一所学校、一群有私心的 NPC、一个不会被选项框住的玩家。
> 你用自然语言行动；NPC 有自己的记忆和目的，会在你看不见的夜里互相商量；第二天，你从他们的态度里读出破绽。

**这是入口文档**：目标、现在能玩什么、怎么启动、数据存哪、关键限制、文档导航。
仓库执行规则与权限见 [AGENTS.md](AGENTS.md)，跨会话快照与分支记录见 [MEMORY.md](MEMORY.md)，接口名字的唯一来源是 [docs/03-接口总表.md](docs/03-接口总表.md)。

---

## 一、目标

一个**校园场景的 AI 文字游戏**：玩家用自然语言行动，NPC 有独立记忆和私心。记法：**Module 算数，Director 说话，Engine 记账**。

设计立场（完整定义与扩展点矩阵见 [AGENTS.md §0](AGENTS.md)、[docs/00-总方案-v2.md](docs/00-总方案-v2.md)）：模块只产出 `Proposal`，唯一写入口是 `Arbiter.apply`；状态字段由 `content/registry/attrs.json` 声明；新玩法 = 新数据 + 新目录，不改引擎。

技术栈：TypeScript strict 全栈、Fastify + SSE、Vite + React、OpenAI 兼容模型。存储当前是 FileStore/JSONL（见「数据位置」），SQLite 等演进仍在规划中。

---

## 二、现在能玩什么

- **标题页**：选身份进入、继续上次进度、说明/关于、在本机接入真实模型。
- **对话流**：自然语言行动，NPC 台词与面板；打字机逐字呈现、图鉴查看人物。
- **地图**：奉贤校区真实鸟瞰底图（6000×4500），33 个点位分建成/在建/规划三态；缩放、拖拽、选点旅行；非建成点位只展示不可进入；玩家可提交新场景草案（管理员双审 → AI 生成 → 再审核）。
- **示例玩法**：`trade` 交易模块；属性开箱可用（`content/registry/attrs.json`）。
- **离线模式**：不配模型 key 也能完整跑回合（离线叙述器，无配置提示）。
- **内容安全**：叙事发出前经独立审核模型；"我全知全能/忽略提示词"一类发言被现实锚定层修饰，不扣分。
- **记忆子系统**：三层记忆（short/long/permanent）、账号维度档案（`GET /api/v1/me`）、世界层永久记忆 canonize（"这个世界记住你"）。
- **还没做**：夜间 tick 与密谋编排、导演真调 LLM、联机 WS/房间回收、记忆压缩后台调度、canonize 定时任务。进度与遗留以 [MEMORY.md](MEMORY.md) §0/§3 为准。

---

## 三、启动

```bash
npm install                       # 仅首次
npm run dev:server                # http://127.0.0.1:8787；不配 key 时用离线叙述器
npm run dev:web                   # http://127.0.0.1:5173（/api 代理到 8787）
```

接入真实模型（自备 OpenAI 兼容端点；不要把 key 写进仓库）——模型接入是**管理员操作**（服务端 `.env`，或带 `x-admin-token` 调 `/api/v1/settings/llm`）；玩家界面不再提供模型/key 入口。环境变量：

```bash
export GALGAME_LLM_BASE_URL=https://.../v1
export GALGAME_LLM_MODEL=<模型名>
export GALGAME_LLM_API_KEY=...
npm run dev:server
```

内容审核必须另配**另一个家族的强模型**，三项独立、不继承叙事配置；缺任意一项即放行态并在启动时告警：

```bash
export GALGAME_AUDIT_BASE_URL=https://.../v1
export GALGAME_AUDIT_MODEL=<模型名>
export GALGAME_AUDIT_API_KEY=...
```

### 用户系统 / 本地开发（3.4.0）

公开 demo 用「邀请注册 + 用户名密码登录 + HttpOnly Cookie 会话」。本地开发两种进入方式：

- **访客进入**：`GALGAME_AUTH_REQUIRED=0`（默认）时，可直接以访客进入。退出后再次点击访客入口，同一浏览器会继续使用原访客存档。
- **完整注册**：启动服务端前设置 `GALGAME_AUTH_REQUIRED=1`、`GALGAME_INVITE_CODE=<邀请码>` 和 `GALGAME_PUBLIC_ORIGIN=http://127.0.0.1:5173`。Origin 必须与浏览器地址栏的协议、主机和端口完全一致。注册页填写邀请码（共享码可重复用，适合组内测试）。部署时将 Origin 改为实际访问地址，并在可信反向代理后启用 `GALGAME_TRUST_PROXY=1`。
- **管理员 / 一次性邀请**：直接运行 Node 服务时，停服后在同一工作目录用与服务端相同的 `GALGAME_DATA_DIR` 执行 `GALGAME_ADMIN_PASSWORD=<密码> npx tsx scripts/admin-init.ts <用户名>`。Docker 部署按容器步骤初始化；已有账号提权需用该账号当前密码。[管理端点](docs/03-接口总表.md) · [Docker 初始化](deploy/README.md#初始化管理员)

账号数据在 `data/auth/auth.json`（单进程串行写，损坏 fail-fast 不覆盖）；登录态只在 Cookie，清 localStorage 不影响账号。

验证命令（成功时退出码 0；用例数、契约项数等随分支变化的统计见 [MEMORY.md](MEMORY.md) §0 快照，不要手抄进文档）：

```bash
npm test                          # 全量单元/集成测试，不联网不花钱
npm run typecheck                 # tsc --noEmit
npm run check:contract            # 文档↔代码契约一致性
npx tsx scripts/smoke.ts          # 建房 → 行动 → commit → 幂等重放
npx tsx scripts/live-check.ts     # 真模型跑一个回合（需叙事模型配置）
npx tsx scripts/audit-check.ts    # 审核样本抽检（需独立审核模型配置）
npm run replay -- --file data/rooms/<room>.jsonl   # 回放事件日志，查 seq 断档
```

内容审核策略在 `content/registry/policy.json`（分类/阈值/扣分/删档线），改法见 [AGENTS.md §4.6](AGENTS.md)。

---

## 四、数据位置

- **仓库内容（进 git）**：`content/` —— `canon/`（人工锁定，AI 只读）、`registry/`（属性/事件/意图/工具/策略声明）、`modules/<id>/`（玩法）、`directors/`（对话导演）、`world/`、`items/`、`npcs/`、`prompts/`。数据格式见 [docs/02-数据格式.md](docs/02-数据格式.md)。
- **运行时数据（`data/`，已被 `.gitignore` 忽略，可重建）**：
  - `data/rooms/<roomId>.jsonl` —— 每个房间的事件日志，**唯一真源**；重启时从日志重建投影，写盘用临时文件 + 原子替换。
  - `data/map/drafts.json`、`data/map/published.json` —— 地图草案与已发布场景库。
  - `data/users/<safeUserId>/impressions.json` —— 世界印象（用户投影，不是世界状态）。
  - `data/worlds/<worldId>/mem.version` —— 世界记忆格式版本。
  - `data/llm-settings.json` —— 本机接入模型的配置（明文、权限 0600，勿提交）。
- **存储演进**：当前实现是 **FileStore + JSONL 事件日志 + 内存投影**；`SQLite/WAL` 与 SQL 投影表均是**规划中**（尚未实现，代码中无 SQLite 依赖；表结构设计稿见 [docs/02 §6](docs/02-数据格式.md)）。
- 存档导出/迁移格式见 [docs/02 §7](docs/02-数据格式.md)。

---

## 五、限制与约定

- **单人单房可玩**；联机 WS、房间回收、`Last-Event-ID` 续传协议已在 [docs/04-联机与多Agent.md](docs/04-联机与多Agent.md)，代码未落地。
- **阶段**：夜间 tick/密谋、导演真调 LLM、记忆压缩后台调度、canonize 定时任务尚未实现（M1+）。
- **审核**：审核模型必须独立于叙事模型（不同模型/端点），代码里无默认模型名；缺配置即放行并告警。
- **契约**：接口名/op/事件/错误码只在 [docs/03-接口总表.md](docs/03-接口总表.md)；改语义先改 03 并 bump 版本，再改代码。13 个 op 是闭集（`dev/v2` 起含第 13 个 `msg.send`，对应 CONTRACT 3.6.0 minor）。
- **权限角色**：`packages/engine` 是引擎核心——**引擎改动需项目所有者批准**，不能自行修改；`content/canon/**` 与 `docs/v1/**` 只读。完整权限分级与 AI 协作规则见 [AGENTS.md §3](AGENTS.md)。
- **部署**：当前仅支持单实例；多实例/多副本禁止共同写同一 `data/` 目录，备份/升级需停写窗口，运维检查清单见 [docs/10-部署与一致性边界.md](docs/10-部署与一致性边界.md)（issue #40）。
- **已知临时债**：前端图鉴/开局数据仍有 issue #3 的临时债，下次涉及前端/图鉴的合并前收口（详见 [MEMORY.md](MEMORY.md) §3.3）。

---

## 六、文档导航

| 文档 | 用途 |
|---|---|
| [AGENTS.md](AGENTS.md) | 给 AI 协作者与人类的仓库执行约束：读什么、能改什么、任务配方、禁区、提交自查 |
| [MEMORY.md](MEMORY.md) | 跨会话快照、分支决策/审阅/遗留；是交接线索，不替代契约或最新功能说明 |
| [docs/03-接口总表.md](docs/03-接口总表.md) | **唯一名字来源**：内部接口、12 op、事件、HTTP/SSE、错误码、配置键 |
| [docs/00-总方案-v2.md](docs/00-总方案-v2.md) | 架构、扩展点矩阵、明确不做的事、里程碑 |
| [docs/01-模块规范.md](docs/01-模块规范.md) | 写玩法模块的手册：目录、manifest、生命周期、模板、review 清单 |
| [docs/02-数据格式.md](docs/02-数据格式.md) | 属性注册表、实体、事件、存储与投影、存档与迁移 |
| [docs/04-联机与多Agent.md](docs/04-联机与多Agent.md) | 房间模型、seq 续传、并发冲突、NPC 自主对话 |
| [docs/05-内容边界与AI推演.md](docs/05-内容边界与AI推演.md) | canon/soft/x 三档、AI 能生成什么、转正与回收 |
| [docs/06-地图模块.md](docs/06-地图模块.md) | 地图模块设计：内容数据、travel、草案状态机、前端 |
| [docs/07-记忆模块方案.md](docs/07-记忆模块方案.md) · [docs/08-引擎改动要求-记忆模块.md](docs/08-引擎改动要求-记忆模块.md) | 记忆子系统设计稿与引擎改动交接单（已落地，现状见 MEMORY 快照） |
| [docs/09-存档与会话恢复方案.md](docs/09-存档与会话恢复方案.md) | 存档索引、回合历史、会话恢复 MVP：数据格式、恢复流程、已知限制 |
| [docs/10-部署与一致性边界.md](docs/10-部署与一致性边界.md) | **部署/运维必读**：仅支持单实例、多实例禁止共写 `data/`、备份与升级停写窗口、运维检查清单（issue #40） |
| [docs/schemas/v2/](docs/schemas/v2/) | JSON Schema（机器可校验副本，与 `docs/03` 严格对应） |
| [docs/prompts/](docs/prompts/) | 提示词模板（带 `PROMPT_VERSION`） |
| [CHANGELOG.md](CHANGELOG.md) | 按合并日期记录版本变化；当前操作手册不在这里 |
| [docs/v1/](docs/v1/) | 第一版方案归档（只读）：产品定义、记忆公式、成本模型 |

> 文档冲突时 **`docs/03-接口总表.md` 赢**，并在回复里报告冲突。版本号以 `docs/03` §0.4 与 `packages/shared/src/contract/version.ts` 为准；当前快照（版本/测试数/main sha）看 [MEMORY.md §0](MEMORY.md)。详细任务配方见 [AGENTS.md §4](AGENTS.md)。
