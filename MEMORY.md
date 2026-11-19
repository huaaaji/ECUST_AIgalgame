# MEMORY.md —— AI 协作者共享记忆

> **用途**：让新会话 / 新协作者在 5 分钟内恢复上下文——代码架构、工程规范、工程进度、各分支的关键决策与遗留。
> **维护规则**：见 `AGENTS.md` §11（读取时机、按分支写入、提交/审阅合并时的写法）。
> **定位**：活文档，只追加、不覆盖；不是契约。与 `docs/03-接口总表.md` 冲突时以 `docs/03` 为准。
> **最后更新**：2026-11-19（**PR #51「dev/v2 群聊对话 + 微信/八卦引擎」已合入 main**（merge commit `02a3318`，CONTRACT 3.5.0→3.6.0，第 13 原语 `msg.send`）；main 现为 72 文件 / 536 用例、契约 8/8（3.6.0）、错误码 39；适配指南见 `docs/v2/前端适配更新指南.md`、`docs/v2/后端模块适配更新指南.md`，待办 issues #85–#92）

---

## 0. 当前快照

| 项 | 值 |
|---|---|
| 主分支 | `main`（sha 见 `git rev-parse --short main`；PR #4/#5、PR #9–#13（`v0.5.0`）、PR #22–#24（`v0.5.1` @ `42690c9`）、PR #43–#45（`v0.5.2`）、PR #50（Turn 幂等 `2c51028`，`v0.5.3`）、PR #52（NPC 认识与名字解锁 `f328bc3`，`v0.5.4`）、PR #55（地图出站脱敏 `4c85797`）、PR #56（档案下发收窄 `2547d73`）、PR #71（回滚未授权合并 `8784b3b` → `35e0c57`）、PR #72（简易用户系统/房间授权 3.5.0 `840e9c5`）、PR #51（dev/v2 群聊+微信引擎 3.6.0，merge `02a3318`）依次合入） |
| `CONTRACT_VERSION` | **3.6.0（main 顶点）**（3.2.0 minor：只增端点/类型/可选字段；3.2.1 patch：三条 issue 修复；3.3.0 minor：房间 404 拒绝路径 + tick 单批原子 + 记忆内部修复，新增 `E_ROOM_NOT_FOUND`；3.4.0 minor：NPC 认识/名字解锁（`TurnRequest.targetNpcId?`、`knows_name`、占位名视图、`/state`+`/history` 脱敏）；3.4.1 patch：#53 地图出站脱敏 + #54 档案下发收窄（派生视图，不进 schema）；**3.5.0 minor：简易用户系统/管理端点/额度与行动核对 + 房间授权 gate（#33，main，PR #72）**；**3.6.0 minor（PR #51）：群聊对话引擎 + NPC 微信私信/八卦传播 + `msg.send` 第 13 原语；已合入 main**；`SCHEMA_VERSION 2`，`API_VERSION 3`，`WORLD_MEM_VERSION 1`） |
| `PROMPT_VERSION` | **v1 2026-11-18.1**（S1 增「只有在场者能说话/行动」；多 NPC 记忆按人分段）；**v2 两条独立线：`CONVERSATION_PROMPT_VERSION 2026-11-19.2`（群聊）/ `GOSSIP_PROMPT_VERSION 2026-11-19.1`（微信八卦）** |
| 测试 | **72 文件 / 536 用例全过**；`check:contract` **8 项全过**（3.6.0，错误码 39/39）；`typecheck` 0 错；`build:web` 295.53 kB / gzip 94.57 kB |
| 已具备 | M0 骨架、地图模块（旅行/场景/草案双审）、引擎 3.0.0（原子结算 + 持久化闭环）、内容审核层、现实锚定层、前端体验与运行时模型接入、记忆子系统 3.1.0（P0–P4）、地图交互打磨 + 图鉴 registry 收口（PR #5）、**图鉴 GalleryView/scenarios 数据化（PR #12）、存档索引/回合历史/会话恢复 MVP（PR #13）、store 鲁棒性（PR #9）、整回合预算显式化（PR #11）、文档职责整理（PR #10）、多 NPC 各自记忆注入与工作记忆滚动（PR #24）、LLM 格式容错/自动重问（PR #23）、点不在场 NPC 隔离与可重试错误重试（PR #22）、房间入口 404 守卫 + tick 单批原子（PR #44）、部署一致性边界文档（PR #43）、记忆可信边界/repair 补写/compact 接线（PR #45）、Turn 幂等（同 `clientTurnId` 只结算一次，进程内；PR #50）、NPC 认识与名字解锁（陌生人占位名/问名字解锁/图鉴同步；PR #52）、地图出站脱敏（#53，PR #55）、`/scenarios` 公开字段收窄与气泡档案门控（#54，PR #56）、**群聊对话引擎（四段说话/三通道投递/每 NPC 独立 LLM/场景总结/扩面审核；PR #51）、NPC 微信私信与八卦传播（`msg.send` 第 13 原语 + `TalkBudget` + SSE；PR #51）** |
| 下一步 | M1：单房单 NPC 完整玩法、夜间 tick/密谋编排；M2 模块宿主验收（`study` 只加目录）；issue #3 余项：`/state` 原始 attrs 过滤 + `self` 看自己口径；存档 MVP 后续：多槽/导出/跨设备、历史一次 200 行上限；PR #19 的修复版 **PR #72**（简易用户系统/房间授权）已合入 main（`840e9c5`）；**PR #51**（dev/v2 群聊/微信引擎）已合入 main（merge `02a3318`），适配待办见 **issues #85–#92**（前端 #85–#87、模块 #88、后端 #89–#90、运维 #91、内容 #92）；后续：roomGate 存在性缓存、compact 非事件持久化的已知限制、Turn 幂等跨重启持久化（需 EventLog 变更）；#33 房间授权、#35 users.json 保护待做；认识机制后续：#53（`/map/travel`、`/map/tick` 响应 events 未脱敏）、#54（`/scenarios` 无条件下发 NPC 档案）；旧房间无 `knows_name` 需重认识（不迁移） |
| 已知遗留 | 见 §3.3（均为 MINOR，不阻断当前 main） |

---

## 1. 代码架构（稳定事实）

**一句话**：Module 算数，Director 说话，Engine 记账。

### 1.1 三个不变量（任何改动不得破坏）

- **I1** 只有 `Arbiter.apply` 能改世界状态。LLM / 模块 / 导演只能产出 `Proposal`，引擎裁决后落库；不许直接写 store / 文件。
- **I2** 状态里没有硬编码字段：属性是 `attrs: Record<string, value>`，键由 `content/registry/attrs.json` 声明；代码里不出现具体属性名（`reputation` 这类值只允许出现在内容 JSON / 默认空串配置里）。
- **I3** 新玩法 = 新数据 + 新目录：加模块不改引擎；加属性只改 JSON；加对话形态只加一个导演文件。

### 1.2 目录

- `packages/shared` —— 冻结契约：类型 + zod + `version.ts`（`CONTRACT_VERSION` / `PROMPT_VERSION`）。
- `packages/engine` —— 闭盒：`arbiter.ts` / `arbiter.ops.ts`（12 op 校验与副作用）、`store.ts`（事件日志 + 投影 + 持久化）、`turn.ts`（回合流水线）、`turn.llm.ts` / `turn.prompt.ts` / `turn.parse.ts`、`modules.ts`（模块宿主）、`audit.ts` / `audit.gate.ts`（审核层）、`reality.ts`（现实锚定层）、`index.ts`。
- `packages/llm` —— 网关（OpenAiCompatClient / MockLlm / retry）。
- `packages/testkit` —— 模块作者测试工具。
- `apps/server` —— `bootstrap.ts`（装配 + 建房种子）、`routes.ts`（HTTP/SSE）、`map.ts` / `map.data.ts` / `map.drafts.ts`（地图/草案流水线）、`audit.ts`（LlmAudit 真实审核器）、`config.ts`。
- `apps/web` —— React 前端（MapPanel / DraftsPanel / 对话与面板）。
- `content/` —— `canon/`（人工锁定，AI 只读）、`registry/`（attrs/events/intents/tools/policy/reality）、`modules/`（trade、map…）、`directors/`、`world/ items/ npcs/`、`prompts/`。
- `docs/` —— `03-接口总表.md` 是唯一名字来源；`00`/`01`/`02`/`04`/`05`/`06` 为规范/方案；`schemas/v2/` 与 03 对应。

### 1.3 Turn 流水线（当前实现，事件顺序以 `docs/03` §2.4 为准）

1. `store.load(roomId)` 取 seq → `options.expectedSeq` 不符只发 `turn.rejected`（不 accepted）。
2. 快照后检查是否 `purged`（`scene.props` 含 `purged`）→ `turn.error E_FORBIDDEN`（删档拒绝接待）。
3. `turn.accepted` → `detectReality`（现实锚定：输入侧子串匹配，数据在 `reality.json`）→ 意图分发。
4. 非 `skipLLM`：`TurnLlm.ask` 一次（JSON；解析失败抛 `E_LLM_FORMAT`）→ 现实锚定 `filterProposals` 过滤模型提案。
5. **审核在裁决之前**：`AuditGate.review`（独立审核模型）三种结果——违规 → 丢弃叙事与模型提案、`punish`（信誉/警告/留痕/可删档）后提交；审核故障 → 叙事换兜底文案、模型提案不采信、不惩罚；通过 → 模型提案入列。
6. 模块提案 + 模型提案一次 **atomic** `apply`（`expectedSeq`）；仅当模块提案为空且被拒全是模型提案时 repair 一次（修复后再审核）。
7. 成功才发 `turn.delta`(narrative) / `turn.facts` / `turn.ui` → 有 events 才 `turn.patch` → `await store.flush`（失败 `turn.error E_STORE_FAULT`，retryable）→ `turn.commit`；失败回合不发叙事；`finally` 里 `arbiter.endTurn`（释放预算）。

### 1.4 Arbiter / Store 关键语义（3.0.0 起）

- 默认提交语义 = **atomic**：任何一条被拒 → 整批不落库；`partial` 必须显式传。整批失败用 `ApplyResult.error {code,message}`（不再伪造 rejected proposal）。
- 权限看 `ctx.cause.type`（可信来源命名空间 `engine`/`tick`/`dialogue`/`plot`…），`proposal.by` 只用于报告；伪造 `by` 不能推进时间/代写记忆。
- 回合预算按 `cause.causedBy` 整回合累计（`maxDeltaPerTurn` / `xWritesPerTurn`），被拒批不耗额度；同房间 `apply` 串行（`exclusive`）。
- `FileStore` **写盘先行**：整份日志写 `*.jsonl.tmp` → `rename` 原子替换 → 成功后才改内存；失败 `E_STORE_FAULT` 且内存/seq 不变。读取前必须 `load()`；载入遇 seq 断档/重复截断到连续前缀并写回（`repaired`）。
- `Store.flush` 是必选成员（3.0.0 的 major 理由）：`Turn` 在 commit 前等待落盘，写盘失败不当作已发生。

### 1.5 审核层 / 现实锚定层

- 审核配置 `GALGAME_AUDIT_BASE_URL` / `MODEL` / `API_KEY` **三项齐全才启用**；不继承叙事模型端点/key，代码里无默认模型名；缺一 → `NoopAudit` 放行 + 启动 `[audit]` 告警。策略（分类/阈值/扣分/警告/删档）在 `content/registry/policy.json`。
- 审核器必须是独立模型/独立端点（不许同一模型或同一 key 家族自审，`AGENTS.md` §4.6）。
- 现实锚定只“修饰”不惩罚：命中诱导时提示词追加 framing，并过滤模型换数值的提案（自己的记忆、`maxSelfDelta` 内自身属性变化可留），丢弃数量如实告知（`世界观校准：N 条`）；**不扣分、不惩罚**。加一类诱导只改 `reality.json`。

### 1.6 地图模块

- 端点见 `docs/03` §5.2.1；`/api/v1/rooms/:roomId/map|map/travel|map/tick|map/dialogue`、`/api/v1/map/drafts`、`/admin/map/drafts/:id/review|publish|generate`；管理员头 `x-admin-token`。
- v0.2 底图：奉贤校区真实鸟瞰 `apps/web/public/map/ecust-campus.jpg`（6000×4500），`world_map.json` schemaVersion 2、33 个点位、`status = built|under_construction|planned`、`category`、`anchorLocId`；`MapView.image`。
- travel：先拒非 `built`（`E_FORBIDDEN`）；懒安装用户场景（`origin:"ai"`）或带 `anchorLocId` 的 canon 新场景（`origin:"seed"`，双向 `located_in`、坐标 attrs）→ `Turn.run({skipLLM:true, input:"map.travel <locId>"})` → 以权威 `located_in` 复核到达，否则 `E_NOT_ADJACENT`。规划/在建只展示，建成后改 JSON 的 `status` 即可进入。
- tick：`time.advance` 用 `cause.type="tick"` → 模块 tick 提案整批 `dryRun` → `apply`。**本轮不做 NPC 与地图点位联动**（用户另有安排）。
- 前端：`MapViewport` 视口裁剪/滚轮缩放（fit~4x）/拖拽/点击选点，三态标记 + 图例；非 built 只看详情不 travel。
- 草案流水线：`pending_review → approved → generating → generated_pending_review → published/rejected`，发布进 soft 区（不直接 `canon:true`）。

### 1.7 契约与名字

- 12 个 op 原语闭集；错误码以 `docs/03` §7 为准（当前 30 个）；新增名字先改 `docs/03` 再写代码。
- 12 op：`attr.delta` / `attr.set` / `entity.create` / `entity.update` / `entity.tombstone` / `link.create` / `link.remove` / `move.to` / `time.advance` / `scene.set` / `memory.write` / `plot.upsert`。

---

## 2. 工程规范（硬约束摘要；细则以 `AGENTS.md` + `docs/03` 为准）

- 不发明名字（先改 03）；不硬编码属性名；只提议不写库；模块不持 LLM/不读 key；不新增 op 原语；不新增依赖（除非用户同意）。
- 版本规则：改 op 语义 / 破坏性变更 → major；只增字段/配置键可 minor，但须在 `docs/03` 补记录（§10.x）；`PROMPT_VERSION` 随提示词结构变化必须 bump（KV 缓存前缀）。
- 测试断言 `Proposal` / `facts` / `view` 结构，不断言 LLM 文案；模板化文案（policy）可例外。
- 文件 ≤ 300 行、函数 ≤ 50 行；`strict: true`，禁 `any`；zod 在边界解析。
- 文档与代码同步；提示词改动同步 `docs/prompts/CHANGELOG.md`（若存在）。
- Git：署名 `ddyyxx-jpg <ddyyxx-jpg@users.noreply.github.com>`；**push 必须每次经用户明确授权**；`commit ≠ 上传`；不许 force-push 未经批准。
- 审阅合并判据：I1/I2/I3、12 op、engine 闭盒、契约版本与文档一致、`typecheck`/`test`/`check:contract` 真实输出、测试质量、安全（鉴权/注入/秘钥）、历史卫生（不提交本地快照/大文件）、合并后全量重验。

---

## 3. 工程进度

### 3.1 已完成的阶段

- **M0 骨架（2026-11-14）**：契约 + 6 份 schema + arbiter + turn + registry + module host + HTTP/SSE + React；示例 `trade`/`core`。
- **地图模块 v0.2（2026-11-17，`feature/campus-map-v0.2` ff 合入 main）**：真实奉贤校区底图（6000×4500）+ 33 个点位（24 建成/4 在建/5 规划）；缩放/拖拽/选点；非 built 禁止进入，canon 新场景首次进入懒安装；服务端/前端/文档同步，117 用例。
- **引擎 3.0.0（2026-11-16）**：结算原子性（atomic 默认、拒绝闭环、整回合预算、可信 cause 权限）+ 持久化闭环（写盘先行、`load()`、坏档修复、`ApplyResult.error`、`flush` 必选）。
- **审核层 + 现实锚定层（2026-11-16）**：叙事发出前二次模型审核；违规扣信誉/删档；玩家“我全知全能/忽略提示词”被修饰并过滤换数值提案。

### 3.2 关键提交时间线（main）

| 提交 | 说明 |
|---|---|
| `95eb27d` | 契约 2.2.0 基线（M0 + 首次修复） |
| `9a12dfa` / `94a0b62` / `362df4a` | 地图模块三步（数据/gitignore → 地图/旅行/双审 → 审查阻断项修复） |
| `8b66458` | 引擎 3.0.0（结算原子性 + 持久化闭环） |
| `3112f79` | merge：引擎 3.0.0 合入 main（解 `bootstrap.ts` 冲突；95 用例、8 项契约检查） |
| `6e70253` | merge（squash）：审核层 + 现实锚定层合入 main → 115 用例；README/docs 统计数字同步 |
| `b509d48` | feat(map)：奉贤校区真实底图（6000×4500）+ 33 点位三态（24 建成/4 在建/5 规划）+ 缩放选点；非 built 禁止进入、canon 懒安装 |
| `c522153` | fix(map)：清复审 must-fix（docs/03 MapView、docs/06 两处矛盾、`.tmp-map/` 忽略）与建议项（module coordOf 模板优先、NPC 同点偏移） |
| `b7f9fae` | fix(map)：NPC 坐标改场景模板优先（旧 1000×640 attrs 只兜底）；ff 合入 main |
| `8a26e00` | PR #4 squash：记忆子系统 3.1.0（事件溯源/账号隔离/canonize/世界印象；25 文件 184 用例、8 项契约） |
| `69da448` | PR #5 squash：地图交互打磨 + 图鉴 registry 收口（点选不出发/前往入口统一并切回对话/对话流跟随；新增 `GET /api/v1/registry`；26 文件 185 用例） |
| `d55b29e` | PR #9 squash：store 读取失败不再污染 loaded（#7；`loaded.add` 移到读取+解析+回放成功之后；EISDIR 回归测试） |
| `f23b1c6` | PR #10 squash：文档职责整理（#8；README 变入口、版本/测试数单一来源、SQLite→FileStore/JSONL、闭盒改角色约定） |
| `c55d5cb` | PR #11 squash：`xWritesPerTurn` 整回合预算显式化 + 提案阶段文档（#1；语义不变，新增 `TurnBudget` 显式传递与测试） |
| `a643d36` | PR #12 squash：图鉴 I2 收口 + scenarios 数据化（#3；服务端 `GalleryView`、secret 只给分档、web 删属性键；`GET /rooms/:id/gallery`、`/scenarios`） |
| `95185b2` | PR #13 squash：存档索引 + 回合历史 + 会话恢复 MVP（#7；`data/history/*.jsonl`、`saves.json`、`GET /rooms/:id/history`、`GET/DELETE /me/saves`、web 我的存档/历史重放） |
| `v0.5.0` | release：`3.2.0` 四条 issue 批量落地；31 文件/212 用例、8 项契约、build 272.61 kB |
| `cad0cf1` | PR #22 squash：点不在场 NPC 隔离（「TA 不在这里」/「前往所在地」）+ 可重试错误重试按钮（#21-1/#21-3；web 17 例） |
| `0617bf2` | PR #23 squash：LLM 非法 JSON 容错 + 自动重问一次 + `retryable` 语义（#18/#21-3；33 文件 231 用例） |
| `9bd9609` | PR #24 squash：多 NPC 各自记忆注入 + 工作记忆滚动替换/配额豁免（#20/#21-2；37 文件 267 用例） |
| `42690c9` | release：3.2.1 收尾（PR #22–#24；此前 `v0.5.1` tag 待打，本次一并补打） |
| `9647a6a` | PR #44 squash：房间入口 404 守卫 + map tick 单批原子提交（#37/#38；38 文件 273 用例） |
| `ff61237` | PR #43 squash：部署与一致性边界 `docs/10` + README/docs/00/docs/02 导航（#40；docs-only） |
| `259cb5e` | PR #45 squash：记忆可信边界/repair 补写/x 区口径/compact（#36/#39/#41/#42；38 文件 279 用例） |
| `2c51028` | PR #50 squash：Turn 幂等键含 roomId+actorId、同 key 并发 inFlight 合并、`seen`/`maybeCompact`/`markDelivered` 移到 commit yield 前（#34；39 文件 283 用例） |
| 本提交（tag `v0.5.3`） | release：v0.5.3（Turn 幂等 #34；CHANGELOG/MEMORY 记账） |
| 本提交（tag `v0.5.2`） | release：3.3.0 落版（`E_ROOM_NOT_FOUND` 登记、docs/03 §10.17、CHANGELOG v0.5.2） |

| `f328bc3` | PR #52 squash：NPC 认识与名字解锁（`knows_name` 一级口径、外貌占位名、目标解锁、图鉴 met 同步、`/state`+`/history` 脱敏；44 文件 312 用例） |
| 本提交（`v0.5.4` 待打） | release：`CONTRACT_VERSION 3.3.0 → 3.4.0`；CHANGELOG v0.5.4 段；docs/03 §10.18；MEMORY 同步 |

| `4c85797` | PR #55 squash：`/map/travel`、`/map/tick` 响应整包脱敏（`maskTurnEvents`；事件、moved 摘要、scene 台词；3 条测试） |
| `2547d73` | PR #56 squash：`/scenarios` 只下发 `id`/`appearance`；`mutter` 改由 `/gallery` 且 met=true 下发；web 气泡从图鉴取（5 条测试） |
| 本提交（`v0.5.4`） | release：`CONTRACT_VERSION 3.4.0 → 3.4.1`；CHANGELOG v0.5.4 定稿；docs/03 §10.19；MEMORY 同步 |

| `840e9c5` | PR #72 squash：简易用户系统 + 房间授权/行动额度（CONTRACT 3.5.0；72 文件 536 用例） |
| `02a3318` | PR #51 merge：dev/v2 群聊对话 + 微信/八卦引擎（merge commit，非 squash；CONTRACT 3.6.0，13 op；72 文件 536 用例） |

### 3.3 已知遗留（MINOR，均有记录；按需修）

- **地图**（来自 `map-review.md` M1–M12）：`createDraft` 无鉴权 + draft id 32 位无碰撞检查；save 先改缓存后写盘（写盘失败假成功）；冷启动并发丢更新；tick 先推时间后校验移动（失败时时间已前进）；崩溃遗留 `generating` 无恢复；文件超 300 行（`map.ts` 575 等）；部分测试断言文案/fixture 偏差；docs 版本/坐标范围历史残留；app 层硬编码 map 数据路径；admin token 存 localStorage（已文档明示）。地图 v0.2：NPC 同点偏移 34 世界像素在 fit 缩放下屏幕差约 5px（视觉余量小、无测试）；偏移只读展示，不写状态。
- **引擎**：`readLog` 失败污染 loaded 已修（PR #9，含 EISDIR 回归）；预算淘汰按插入顺序非 LRU；`bootstrap` 种子直写 + 种子 op abort 时可能半初始化；`trade` 端到端依赖地图/数据文件。`xWritesPerTurn=8` 经核对只统计 `attr.delta`/`attr.set` 的 `x.` 键，`memory.write`（含工作记忆/tombstone）本就不计入，PR #24 复审记录的 `E_X_LIMIT` 前提在 3.2.1 上无法复现；PR #45 补 8 条 x 写 + 双 NPC 记忆同回合回归并在 docs/03 §2.3/§8 写明口径；`memory.write` 不计 xWrites（口径已定）。房间入口每次 `listRooms()` 扫 `data/rooms/` 目录是 O(n)，房间多时可加缓存。Turn 幂等（PR #50）已知边界：①leader 失败后 waiter 重排队与第三个同 key 请求之间有小竞态窗口（极端下可能双提交）；②幂等缓存进程内、重启后失效（跨重启需 EventLog 持久化回合标记 + 契约变更）；③同 key waiters 无超时，leader 挂起时会一直等待；④`seen`/`inFlight` 无上限（`seen` 为既有）。
- **审核/现实锚定**：违规回合连同模块提案一起丢弃（`docs/05` §10.2 已写明理由）；审核测试断言 policy 模板文案（轻度）；子串匹配会漏变体/误伤正常句子（`docs/05` §11.4 已承认）。
- **文档**：README/AGENTS/MEMORY 职责已收口（PR #10）；剩余：`docs/02` §6 SQL DDL 标“规划中”、`docs/07/08` 内的历史版本句子按需清理。
- **记忆子系统（3.1.0）**：`perSourceCap` 缺可构造测试场景；`publish` 函数体 ~150 行（文件已 ≤300）；`memory.impression.queued` 事件注册但未发射（留联机广播用）；canonize 定时默认关（仅 admin 端点触发）。工作记忆「最近对话」滚动 tombstone 只留最新 1 条（PR #24）；PR #45 已接线 compact（每 5 个提交回合异步、`COMPACT_AFTER=20`、archived 不占配额/不进 prompt、重启确定性重算）；残留：compact 不落事件（重启重算，归档集合可能与运行期有极小差异）、进程内计数重启归零（最多晚 5 回合）、`maybeCompact` 在 `mem.available=false` 时仍压缩、`working.tombstones` 未按新条是否过闸区分（连续性小坑）。#41 已核实前提不成立（xWrites 不含 memory.write）。
- **存档/会话 MVP（PR #13）**：历史一次最多 200 行；本地身份 `ecust.playerId` 可伪造、清空即丢索引（房间仍可进）；无多槽/导出/跨设备；`GET /history` 对老房间（成员无 userId）开放只读。
- **前端（#21 修复，PR #22）**：失败回合已流出的部分叙事不回滚（重试追加新叙事）；重试判定纯函数有单测、无组件级 jsdom 测试；与 PR #19 登录门/2D 地图合并时需检查 `enterScene`/travel 签名。
- **引擎 #1 剩余**：阶段数组仍是扁平拼接（无显式阶段对象）、`dryRun`/权限环境一致性未验证（docs/03 §10.11 已记录）。
- **前端（PR #2 临时债，issue #3）**：`GalleryPanel.tsx` 直读 `attrs.trust/guard/mood`（33/66 分档在前端）、`scenarios.ts` 硬编码 3 个开局与 NPC 档案；违反 I2，改名 registry 键会静默显示 undefined。owner 已拍板本次接受为临时债，**下一次涉及前端/图鉴的合并前必须完成**：服务端 GalleryView（按 registry 生成通用 stats，secret 只给分档）+ scenarios 数据化到 `content/scenarios/*.json`。PR #5（`69da448`）已收渲染键；PR #12（`a643d36`）已收 `GalleryView` 与 scenarios 数据化；剩 `/state` 原始数值通道（secret 精确值仍随 snapshot 下发）与 `self` 的“看自己”口径。
- **认识机制（PR #52，3.4.0；#53/#54 于 3.4.1 收口）**：`/map/travel`、`/map/tick` 响应已统一脱敏（#53，PR #55）；`/api/v1/scenarios` 只下发 `id`/`appearance`，档案与 `mutter` 仅在 `/gallery` 且 met=true 时给（#54，PR #56）；旧房间无 `knows_name` 需重新认识（不批量迁移，docs/03 记）；`/turns` SSE 暂为非流式（收齐后脱敏写出，延迟略增，两段式改进记 docs/03）；建房时为每个 canon NPC 写一条私有种子记忆（一次性开销，docs/07）；`maskNamesDeep`/`maskTurnEvents` 对整份 state/事件递归遍历，大房间下有额外开销；CampusMap 气泡在局内新认识后需重挂载/切房才刷新（低优先）。

---

## 4. 分支记忆（按分支记录，详见 `AGENTS.md` §11）

> 格式：`- 日期 ｜ 分支 ｜ 提交 ｜ 类型 ｜ 改了什么 ｜ 决策与理由 ｜ 验证 ｜ 遗留`

### dev/v2（第二版架构试验，长期分支）
- 2026-11-19 ｜ `dev/v2` ｜ `02a3318` ｜ merge ｜ 本分支合入 main（merge commit `02a3318`，未 squash；父 `b0b3944` + `840e9c5`）：群聊对话引擎 + NPC 微信/八卦（`msg.send` 第 13 原语，CONTRACT 3.5.0→3.6.0） ｜ 保留逐轮审阅历史，按 PR 描述约定用 merge commit；main 未被本分支直接改写 ｜ tsc 0 / 72 文件 536 例 / check:contract 8/8（3.6.0） ｜ 分支保留未删除；后续适配 issues #85–#92
- 2026-11-19 ｜ `dev/v2` ｜ `9027fd9` ｜ docs(review) ｜ 纠正前端文档的发信节流口径：`TalkBudget` 只节流 NPC 自主发言路径，`GossipHost.send()` 不碰 budget，玩家连发不会被 min-interval 拦；明确要求前端对发送按钮防抖，NPC 调用仍有 maxNpcCallsPerTick 兜底；删掉不存在的「回合限流」措辞 ｜ 选改文案而非补实现：发信便宜、NPC 波次预算已封顶，防抖属前端职责 ｜ tsc 0 / 72 文件 536 例 / check:contract 8/8（3.6.0）｜ 无遗留
- 2026-11-19 ｜ `dev/v2` ｜ `945cabc` ｜ docs(review) ｜ main PR #72 合入 dev/v2 后（f9ea1ec，72 文件 536 例全过）的 3 条 P3：前端文档写明「微信不扣 TurnLedger 行动额度、由 TalkBudget 独立节流」是有意设计；README 12→13 op 闭集并标 3.6.0；CHANGELOG 版本链补 dev/v2 3.6.0 预览；PR 描述补「合 main 用 merge commit、不 squash」建议 ｜ 审阅通过无阻断，纯文档/口径 ｜ tsc 0 / 72 文件 536 例 / check:contract 8/8（3.6.0）｜ 无遗留；合 main 仍等用户明确指令
- 2026-11-19 ｜ `dev/v2` ｜ `7be6716` ｜ fix(review) ｜ 最终审阅 3 条 P3：PR 描述与 `docs/v2/前端开发注意事项.md` 顶部标 breaking（`/events` 他人 actorId 403）、删 MessageIndex 无调用方 `count()`、`markStale` 注释 TTL 到期一次性重复上报须 SSE 按 id 去重 ｜ 审阅者判通过且阻断清零，这些都是注释/清理级 ｜ tsc 0 / 70 文件 488 例 / check:contract 8/8（3.6.0）｜ 无遗留
- 2026-11-19 ｜ `dev/v2` ｜ `dd3acb1` ｜ fix(review) ｜ 全量审计 P1：`GET /events` 把 `?actorId=` 交给 `guardRoom({actorId})` 绑定账号，别人 actorId 现在 403（此前能读全部私信正文）；补路由用例；AGENTS.md 铁律5/速查 12→13 原语含 msg.send；op.schema.json 描述改 13；前端文档补 `/events?actorId=` 一行；staleSeen 改 TTL+256 自清理（原空闲清理条件不可达），`clearRoom()` 注明仅限房间销毁；npc-agent 悬空 JSDoc 清理 ｜ 逐轮增量修复漏掉的整体性鉴权分支，必须全量审一遍才抓到 ｜ tsc 0 / 70 文件 488 例 / check:contract 8/8（3.6.0）｜ 无阻断遗留
- 2026-11-19 ｜ `dev/v2` ｜ `4def20d` ｜ fix(review) ｜ 十二审 P2/P3：`V2_PROMPT_VERSION` 拆成 shared 中两个契约常量 `CONVERSATION_PROMPT_VERSION 2026-11-19.2` / `GOSSIP_PROMPT_VERSION 2026-11-19.1`，npc-agent 从 shared 引入、本地同名导出删除；会话提示词静态段已变，版本顺延；`GossipHost.clearRoom()` 显式清理 + 空闲波次自动清 staleSeen（仅当无订阅且无消息），MessageIndex 加 `count()`；前端文档 API_VERSION 2→3 并区分两条版本线 ｜ 同名双值从两个 export * 出口泄漏是契约级隐患，必须在合并前拆开 ｜ tsc 0 / 70 文件 488 例 / check:contract 8/8（3.6.0）｜ 无阻断遗留
- 2026-11-19 ｜ `dev/v2` ｜ `a8f9da1` ｜ fix(review) ｜ 十一审 P3：beginTick 移到幂等命中/会话校验之后（重放不清他 host 预算）、过期未读消息每房只上报一次 `gossip.dropped(idle-timeout)`（有界 256）、方案验证数 70/488 与 v2 7/57、补 `playerPresentGraceMs` 迁移说明（旧键被 partial() 静默忽略）｜ 审阅已判通过，剩余均为合并前可选优化，一次清完 ｜ tsc 0 / 70 文件 488 例 / check:contract 8/8（3.6.0）｜ 无阻断遗留
- 2026-11-19 ｜ `dev/v2` ｜ `d2422ed` ｜ fix(review) ｜ 十审剩余 4 条：MEMORY 失真（本提交→`ac264c8`、删掉不存在的 `beginTick` 宣称后又真接上）、`E_AUDIT_UNAVAILABLE` 登记进 shared `ERROR_CODES` 与 docs/03 §7、`playerAbsentGraceMs`→`playerPresentGraceMs`（命名与行为一致）、`idleTimeoutMs` 弃置未读产出 `gossip.dropped(idle-timeout)` 事件、方案「已知偏差」更新为已接线现状 ｜ 记账反复失真，这次先核对代码再写说明 ｜ tsc 0 / 70 文件 487 例 / check:contract 8/8（3.6.0）｜ 无阻断遗留
- 2026-11-19 ｜ `dev/v2` ｜ `c1e3286` ｜ fix(review) ｜ PR #51 十审后 P1 全修：reply 带 rootId 放行、TalkBudget 按波次重置、私信端点鉴权与 /events 按 audience 过滤、微信内容过审、API_VERSION 3 口径统一；+4 用例 ｜ P1 阻断必须清零 ｜ tsc 0 / 70 文件 486 例 / check:contract 8/8（3.6.0）｜ review 通过，建议下轮清 P2/P3
- 2026-11-19 ｜ `dev/v2` ｜ `ac264c8` ｜ fix(review) ｜ 清十审 P2/P3：hop 随源递增且 maxHops 生效、玩家发信入库前审核、波次审核只审 NPC 内容、`idleTimeoutMs`/`playerPresentGraceMs`/`maxTurnsPerTick`/`nextEligible` 真消费、策略缺文件可读报错、路由测试 env 还原、apiVersion 与 op 数文档残留与 3.6.0 变更条目、方案标题 ｜ 审阅建议一次性清完，避免口径反复 ｜ tsc 0 / 70 文件 487 例 / check:contract 8/8（3.6.0）｜ 无阻断遗留
- 微信私信引擎（`3.6.0`，已提交 `0a862d9` + `200bdd8` 并 push）：新增 13th op `msg.send` + `Envelope.audience` + `MessageIndex` + `TalkBudget` + `GossipHost/GossipAgent` + `dm` 模式 + gossip 记忆可信通道；`msg.send` 只有目标与内容，玩家非收件人零可见；预算在 LLM 调用前消费；server 已接 `/messages` 收件箱/发送/SSE（按收发双方过滤）+ `GALGAME_GOSSIP_SCAN_MS` 后台波次；前端交互由前端同学按 `docs/v2/前端开发注意事项.md` 实现。
- 2026-11-18 ｜ `dev/v2` ｜ `410d8bc` ｜ fix(review) ｜ PR #51 九审 P3 收尾：协议规则文本明确为引擎常量（与校验强绑定、不入 policy），新增 `V2_PROMPT_VERSION = "2026-11-18.1"` 写入静态协议首行追踪 KV 前缀 ｜ 九审通过，唯一剩余为提示词数据化/版本口径，按建议②处理 ｜ tsc 0 / 44 文件 327 例 / v2 44 例 / check:contract 8/8 ｜ PR #51 全部审阅项闭环，已具备合并评估条件（未合并）
- 2026-11-18 ｜ `dev/v2` ｜ `6ed3e63` ｜ fix(review) ｜ PR #51 八审 P3 收尾：提示词规则明确「一个在场目标（字符串，非数组/@all）」与校验对齐；架构文档历史小节加注 singleTarget 已删除 ｜ 八审通过，剩余仅体验/口径优化，一次清完 ｜ tsc 0 / 44 文件 327 例 / v2 44 例 / check:contract 8/8 ｜ PR #51 已具备合并评估条件（按用户要求不合并）
- 2026-11-18 ｜ `dev/v2` ｜ `54b8d2c` ｜ fix(review) ｜ PR #51 七审收尾：按行内证据真改二审条目「本提交」→ `be657ad`；删除死字段 `singleTarget`（契约/ModeSchema/两份 JSON/提示词/校验分支），目标形态统一由 `requiresTarget` 表达 ｜ 同一记账问题被指出三次，这次直接核对行内容后再写说明 ｜ tsc 0 / 44 文件 327 例 / v2 44 例 / check:contract 8/8 ｜ 无阻断遗留
- 2026-11-18 ｜ `dev/v2` ｜ `8335ac8` ｜ fix(review) ｜ PR #51 六审 P3 收尾：`requiresTarget` 统一只接受字符串单目标（数组与 @all 全拒，多目标走 broadcast）；MEMORY 验证数 323→324、二审占位「本提交」→ `be657ad`；+1 回归用例 ｜ 六审已判通过，剩余记账与口径细节一并清完 ｜ tsc 0 / 44 文件 327 例 / v2 44 例 / check:contract 8/8 ｜ 无阻断遗留
- 2026-11-18 ｜ `dev/v2` ｜ `89449f5` ｜ fix(review) ｜ PR #51 五审 P3 收尾：`requiresTarget` 拒绝空数组目标、flush 重试用失败前 lastLocId 守卫 + 当前快照前移地点、trimSessions 补回归测试、MEMORY 短 sha 订正 ｜ 五审已判通过，剩余 P3 一并清完 ｜ tsc 0 / 44 文件 326 例 / v2 43 例 / check:contract 8/8 ｜ 无阻断遗留
- 2026-11-18 ｜ `dev/v2` ｜ `932278f` ｜ refactor ｜ PR #51 四审通过；`runStep` 拆为 8 个私有步骤（单函数 7–33 行）｜ 审阅建议与 AGENTS.md §6 对齐 ｜ tsc 0 / 44 文件 322 例 / check:contract 8/8 ｜ 无阻断遗留
- 2026-11-18 ｜ `dev/v2` ｜ `2c0d37e` ｜ fix(review) ｜ PR #51 四审 P3 卫生：`singleTarget` 拒绝数组目标、`requiresTarget` 拒绝 `@all`（`@all` 统一走 broadcast）、flush 重试前移 lastLocId、trimSessions 跳过 pendingFlush、错误文案数据化 ｜ 四审已判通过，剩余 P3 仍按用户「修」逐条清 ｜ tsc 0；44 文件 324 例 / v2 41 例 / check:contract 8/8 ｜ 五审通过，无阻断遗留
- 2026-11-18 ｜ `dev/v2` ｜ `be657ad` ｜ fix(review) ｜ PR #51 **二审**修复：A 换地点唤醒真修（`SceneBeat.locId` + `lastLocId`）；B flush 重试不回放旧错误；C recent/顺序修正；D 删实体前缀硬编码按 kind 判定；E autonomous 开关消费；F 房间级串行链消除 seq 竞态；G 无提案也发 committed；H resumeExpiredEvents 带 phase；K conversation.ts 缩到 ~210 行（拆 conversation.step.ts）；L 中文文案/LLM 参数进 JSON；M utterance id 用 turnKey 可回放；N addressed requiresTarget + @all 放行；O sessions/pending/seen 有界 256 ｜ 首轮文档把未接的换地点写成已实现，故二审按证据真修而非再改文档；v1 仍不动，保持纯加法 ｜ 本地 v2 5 文件 36 例；全量验证见提交说明 ｜ 遗留：v2 契约未进 docs/03（架构文档已记边界）；npc.spoke 仍未生成；server/web 未接线；地图 move.to 未写 scene.changed
- 2026-11-18 ｜ `dev/v2` ｜ `92e8a1c` ｜ fix(review) ｜ PR #51 首轮 review 6 P1 + P2 修复：审核扩面接线与假 AuditPort 12 例（玩家拦截/NPC 丢弃/审核故障/六字段拼接）、`listenSince` + `resumeExpired()` 消费 `listenTimeoutMs`、flush 失败 `E_STORE_FAULT retryable` 且不写幂等且可安全重试、`RawDecisionSchema` zod 边界、mode 改为 JSON 的 `requiresTarget/contentless/visibility/defaultMode` 数据驱动（缺省 fail-closed）、幂等键带 speaker 且 seen≤256；补 addressed notice / atomic 回滚 / LLM 抛异常用例；订正适配度报告行号与架构文档 secret/出口表述 ｜ 审阅判定"接线前必须清零"，故本轮全部按证据修而非只补文档；缺省 mode 不再回落 broadcast 是隐私 fail-open 的直接修复 ｜ tsc 0；44 文件 315 用例；check:contract 8/8（3.3.0） ｜ 未做：`npc.spoke` 领域事件仍未生成（无对应写 op，已记架构文档偏差）、conversation.ts 360 行超 AGENTS 300 行建议、server/web 仍未接线
- 2026-11-18 ｜ `dev/v2` ｜ `51f2495` ｜ fix(review) ｜ PR#51 三审修复：私密模式 `singleTarget` 与隐私口子、policy 深合并、提示词/文案数据化、lastLocId 前移、chains 清理与 +3 回归测试 ｜ 三审两项 P2 必修，按证据实修 ｜ tsc 0 / 322 例 / check:contract 8/8 ｜ 函数拆分留待下轮

- 2026-11-18 ｜ `dev/v2` ｜ `59078d9`（基线 `cda0823` / `v0.5.3` / CONTRACT 3.3.0） ｜ feat ｜ 从 main 拉出长期架构试验分支，仅记录基线，未改任何架构/契约/代码 ｜ 用户要求"在现在项目的基础上分支一个版本试开发第二版架构"；v2 属于整体架构换代（不变量 I1/I2/I3、12 op 闭集都可重新评估），故以 main 为基线而非未合并 PR 分支；记忆子系统已随 PR #4 squash 进入 main，基线是完整当前形态 ｜ 起点校验：本地与 origin/main 均为 `cda0823`（0/0 无分叉）、工作区干净；未修改代码，验证沿用 main 的 tsc 0 / 39 文件 283 用例 / check:contract 8 项（3.3.0） ｜ 待 owner 明确 v2 的验证目标：engine 闭盒与 12 op 闭集是否仍为不可触碰的边界；main 保持不动，定期把 main merge 进 dev/v2；成了发 PR 回 main，废了直接删分支

- 2026-11-18 ｜ `dev/v2` ｜ `374d5a1` ｜ review ｜ 首轮审阅结论：**有条件通过**（无阻断项）。`git diff main...dev/v2` 18 文件 +1832/-1，全为加法，v1/12 op/契约版本未动。P1×6：①审核扩面零测试却称"由会话 e2e 覆盖"（4 份测试全用 NoopAudit，blocked/unavailable/NPC 丢弃三分支从未执行）；②`listenTimeoutMs` 死配置（契约/JSON/文档/前端清单四处声明，引擎零消费，§10 偏差漏记，插话后 phase 永久 listening）；③`store.flush` 异常被 `run()` 兜成 E_MODULE_FAULT 并写入幂等缓存，同 key 重试永久回放错误且状态已变；④LLM 输出未 zod 解析（`parseDecision` 为 `JSON.parse + as RawDecision`），`coverAction`/`target` 未校验可致悄悄话内容外泄；⑤mode id 硬编码（`delivery.ts:72,91`、`npc-agent.ts:149`、`conversation.ts:308`）与文件头"引擎不写死模式"注释自相矛盾，新增私密模式只改 JSON 不生效，缺省 mode 回落 `broadcast` 属隐私 fail-open；⑥幂等键 `[sessionId, clientTurnId]` 丢 actorId 且 `seen` 无上限（v1 #34 已修为 `[roomId, actorId, clientTurnId]`）。P2×10：文档行号多处错（`:192`→:160、`:264-270` 不含 apply→:257、punish 定义 :78≠:154）、secret 信封机制说明错（实际 cause `dialogue.speak`）、"两个 index.ts 各加一行"不实、审核空字段过滤阈值失效、policy 两字段被 zod strip、测试缺 addressed notice/atomic 回滚/LLM 抛错、`delivery.ts:141` 中文兜底进引擎、`conversation.ts` 318 行>300、`createInitialState` 未用、NPC 发言未发 `npc.spoke` 事件 ｜ 依据本地 diff（GitHub token 失效且 7890 代理未开）+ 两个只读 subagent 交叉审阅 ｜ 验证：typecheck 0 错 / `npm test` 43 文件 303 用例全过 / check:contract 8 项（3.3.0） ｜ 遗留：修 P1 后复审（已按 §11.3 用短 sha 订正旧条目）

- 2026-11-18 ｜ `dev/v2` ｜ `1187554` ｜ feat ｜ 群聊对话模型阶段 1–5 落盘：`packages/shared/src/contract/v2.ts`（Utterance 四段结构 / content·action·notice 三通道 / ConversationEvent / 策略）、`content/v2/{utterance-modes,conversation-policy}.json`；`packages/engine/src/v2/{delivery,scene,npc-agent,audit,conversation,index}.ts` + 4 份测试（20 例）。每个 NPC 各自一次 LLM（并行、上下文隔离）、插话 phase、NPC 自主续聊 + 硬上限、心理活动带 plan 走 secret、审核扩面六字段、所有写仍走一次 atomic Arbiter.apply 并写后 ingest ｜ 用户拍板"改引擎没问题，但尽量缩小对其他模块影响"；v2 全部是加法文件，v1 的 Turn/Dialogue/Transport/12 op/契约版本均未改；心理活动允许 plan 是用户推翻我原先"禁止计划"建议后的定版 ｜ tsc 0；v2 单测 4 文件 20 例全过；check:contract 8/8（3.3.0） ｜ 偏差记在 docs/v2/群聊对话架构.md §10（换地点唤醒未接、S1.5 注入未进 v1 prompt、queue 未用、会话仅内存）；前端改动记 docs/v2/前端影响清单.md

### fix/map-bubble-refresh（issue #57，PR 待开）

- 2026-11-18 ｜ `fix/map-bubble-refresh` ｜ `48ce5fe` ｜ fix ｜ App 把 `stateRev` 作为 `version` 传给 ChatPanel → CampusMap；gallery effect 依赖改为 `[roomId, version]`，解锁 NPC 后同房间重拉即出气泡，无需重挂载；抽 `nextBubbleState` 纯函数（换房间立即清空、同房间重拉/失败保留上次成功值、成功只取 met 且有 mutter），新增 8 条 web 用例 ｜ 与 GalleryPanel 的 `version={stateRev}` 口径一致，最小改动复用既有刷新信号；换房间清空防串房，失败保留避免永久空表/闪烁；web vitest 是 node 环境无 jsdom，故用纯函数单测 + effect 依赖结构断言，未加新依赖；不 bump ｜ tsc 0；48 文件/328 用例通过（基线 47/320）；check:contract 8 项（3.4.1）；与 PR #58 集成 49 文件/332 用例全绿，build:web 成功 ｜ 未认识/图鉴失败仍不出气泡（不回归 #54）；#33/#35 按用户指示忽略

### fix/map-event-mask（issue #53，PR #55，已 squash 合并 `4c85797`）

- 2026-11-18 ｜ `fix/map-event-mask` ｜ `9d2cbec` ｜ fix ｜ `view-names.ts` 新增 `maskTurnEvents`（snapshot → `unknownPlaceholders` → `maskNamesDeep`），`map.ts` 的 `travel()`/`tick()` 返回前对**整包响应**脱敏；新增 3 条地图出端口径测试，`docs/06` §4.2/§4.3 同步 ｜ 只遮 events 会从 `movedSummaries`（从 state 取未脱敏真名，map.ts:627）漏出真名，故整包遮掩；已知（`knows_name=true`）名不在占位表、不受影响；与 `/turns`、`/events`、`/state`、`/history` 共用掩码原语避免口径漂移；不 bump（派生视图行为修正） ｜ tsc 0；45 文件/315 用例通过（基线 44/312）；check:contract 8 项（3.4.0）；与 PR #56 合并集成 47 文件/320 用例全绿 ｜ 失败响应 ok:false 未遮（message 只含场景 id/名与错误码）；#33/#35 按用户指示忽略
- 2026-11-18 ｜ `fix/map-event-mask` ｜ `4c85797` ｜ merge ｜ squash 合并 PR #55（head `26e41cb`）；与 PR #56 集成 47 文件/320 用例全绿 ｜ 用户“一起吧”授权合并+发版 ｜ tsc 0；47 文件/320 用例；8 项契约（3.4.0） ｜ 失败响应 message 未遮（后续）

### fix/turn-idempotency-only（issue #34，PR #50，已 squash 合并 `2c51028`）

- 2026-11-18 ｜ `fix/turn-idempotency-only` ｜ `6f2ba4f` ｜ fix ｜ 基于 3.3.0 只移植 #34：幂等键改为 `JSON.stringify([roomId, actorId, clientTurnId])`，同 key 并发用 `inFlight` promise 串行并回放；`seen.set` + `maybeCompact` + `markDelivered` 全部移到 `yield turn.commit` **之前**，外层 try/finally 保证 break 时也释放锁 ｜ 上游 HTTP 消费者在 commit 处 break 生成器，yield 之后的记账不会执行（issue 根因）；只做 #34，不重复已被 PR #45 合并的 #39；进程内缓存不跨重启（需 EventLog + 契约变更） ｜ tsc 0；39 文件/283 用例通过（新增 4 条幂等）；check:contract 8 项（3.3.0） ｜ #33/#35 按用户指示暂缓；PR #46–#49 被并行合并的 #44/#45 supersede，另行关闭

- 2026-11-18 ｜ `fix/turn-idempotency-only` ｜ squash `2c51028` ｜ merge ｜ PR #50 squash 合入 main（39 文件/283 用例）；复审通过，P2 记录：失败路径 waiter 竞态、waiter 无超时、跨重启不幂等仅注释 ｜ issue #34 关闭 ｜ — ｜ 无

### main

- 2026-11-19 ｜ main ｜ `02a3318` ｜ merge（PR #51） ｜ dev/v2 群聊对话 + 微信/八卦引擎合入 main（merge commit，非 squash）：四段说话/三通道投递/每 NPC 独立 LLM、场景总结、审核扩面、`msg.send` 第 13 原语 + 微信私信/八卦、SSE；CONTRACT 3.5.0 → 3.6.0；CHANGELOG/README 已补 minor 说明 ｜ 用户明确指令「合并！」；PR #51 十六轮审阅全部通过，鉴权与 PR #72 对齐 ｜ tsc 0；72 文件/536 用例；check:contract 8/8（3.6.0）；build 295.53 kB / gzip 94.57 kB ｜ 前端/后端适配待办 issues #85–#92
- 2026-11-19 ｜ main ｜ `19d0dd1` ｜ docs ｜ 新增 `docs/v2/前端适配更新指南.md`、`docs/v2/后端模块适配更新指南.md`（3.6.0 合入后的对外面、渲染/迁移规则、验收清单） ｜ 合入后前端与模块作者需要可照做的迁移说明，不能只靠 PR 审阅记录 ｜ docs-only；tsc 0 / 72 文件 536 例 / check:contract 8/8（3.6.0） ｜ 待前端/模块按 issues #85–#92 落地
- 2026-11-19 ｜ main ｜ 本提交 ｜ docs ｜ MEMORY 合并记账 + §0 快照刷新（main 顶点 `02a3318`、3.6.0、72/536、错误码 39）与适配指南/待办入口 ｜ 按 AGENTS §11.5 合并者必须补 merge 条目与快照 ｜ 与上条同批验证 ｜ 无

- 2026-11-18 ｜ main ｜ `35e0c57` ｜ merge ｜ 合并 PR #71（`revert/pr19-merge`，revert commit `cbf84f1`）：撤销 PR #19 未经复审的合并 `8784b3b`，main 回到 CONTRACT 3.4.1；修复版改由 PR #72 重新提交 ｜ 复审（ddyyxx-jpg 2026-11-18 14:49）明确要求先回滚再重提，用户「是的，回滚吧」授权 ｜ typecheck 0；49 文件/332 用例；check:contract 8/8（3.4.1） ｜ PR #72 待复审

- 2026-11-18 ｜ main ｜ 本提交（tag `v0.5.4`） ｜ release ｜ `CONTRACT_VERSION 3.4.0 → 3.4.1`；CHANGELOG v0.5.4 定稿（PR #52/#55/#56）；docs/03 §10.19；MEMORY 快照/时间线/遗留/分支同步 ｜ 把 3.4.0（PR #52）与 #53/#54 的 security patch 收进同一个对外版本 ｜ tsc 0；47 文件/320 用例；8 项契约（3.4.1）；build 287.14 kB / gzip 91.02 kB ｜ #33/#35 仍暂缓
- 2026-11-18 ｜ main ｜ `2547d73` ｜ merge（squash PR #56） ｜ `/scenarios` 收窄为 id/appearance；mutter 改由 `/gallery` met=true 下发；web 气泡从图鉴取（5 条测试） ｜ 全局公开端点不下发任何档案（已知也不带）；气泡由房间图鉴供给 ｜ tsc 0；46 文件/317 用例（合并 main 后 47/320）；8 项契约（3.4.0）；build 287.14 ｜ CampusMap 气泡刷新依赖重挂载（低优先）
- 2026-11-18 ｜ main ｜ `4c85797` ｜ merge（squash PR #55） ｜ travel/tick 整包脱敏（`maskTurnEvents`）；事件、moved 摘要、scene 台词统一遮罩（3 条测试） ｜ 与 /turns /events /state /history 同一掩码原语；失败响应暂不遮 ｜ tsc 0；45 文件/315 用例；8 项契约（3.4.0） ｜ —
- 2026-11-18 ｜ main ｜ 本提交（tag `v0.5.4` 待打） ｜ release ｜ `CONTRACT_VERSION 3.3.0 → 3.4.0`；CHANGELOG 新增 v0.5.4 段；docs/03 §10.18；MEMORY 快照/时间线/遗留/分支同步 ｜ PR #52 落版（用户只要求合并，tag 待确认） ｜ tsc 0；44 文件/312 用例；8 项契约（3.4.0） ｜ #53/#54 已开
- 2026-11-18 ｜ main ｜ `f328bc3` ｜ merge（squash PR #52） ｜ NPC 认识与名字解锁（外貌占位名 + `knows_name` + 目标解锁 + 图鉴 met + `/state`、`/history`、SSE/events 脱敏 + introduce 模块） ｜ 审阅两轮：P0 /state//history 真名泄露、P1 失败回合解锁/不在场目标/“我是”误判/SSE 缓冲/docs 矛盾，全部修复；剩 `/map/travel`、`/map/tick` events 与 `/scenarios` 档案另开 #53/#54 ｜ tsc 0；44 文件/312 用例；8 项契约（3.3.0）；build 287.17 kB / gzip 90.98 kB ｜ 旧房间 knows_name 不迁移

- 2026-11-18 ｜ main ｜ 本提交（tag `v0.5.3`） ｜ release ｜ CHANGELOG 新增 v0.5.3 段；MEMORY 快照/时间线/遗留/分支记录同步 ｜ Turn 幂等单补丁发版 ｜ tsc 0；39 文件/283 用例；8 项契约（3.3.0） ｜ 无
- 2026-11-18 ｜ main ｜ `2c51028` ｜ merge ｜ squash PR #50（#34 Turn 幂等：键含 room+actor、inFlight 合并、记账移到 commit yield 前） ｜ 修复 HTTP 消费者在 commit 处 break 导致重放重复结算 ｜ 39 文件/283 用例；8 项契约（3.3.0） ｜ 后续见 §3.3（跨重启/失败竞态）
- 2026-11-18 ｜ main ｜ 本提交（tag `v0.5.2`） ｜ release ｜ `CONTRACT_VERSION 3.2.1 → 3.3.0`；CHANGELOG 新增 v0.5.2 段、v0.5.1 段标题对齐；`E_ROOM_NOT_FOUND` 登记 + docs/03 §10.17；MEMORY/README 导航同步 ｜ 收口 §10.15/§10.16 的“待 bump”，让房间 404 的 code 有契约来源 ｜ tsc 0；38 文件/279 用例；8 项契约（3.3.0，34 错误码）；build 287.05 kB / gzip 90.90 kB ｜ 后续见 §3.3
- 2026-11-18 ｜ main ｜ `259cb5e` ｜ merge（squash PR #45，issue #36/#39/#41/#42） ｜ 记忆可信边界（workingDrafts 通道）、repair 后记忆补写、compact 接线、xWrites 口径澄清；rebase 到 `ff61237` ｜ #36 信任边界改为代码结构；#41 核实前提不成立（不修预算）；compact 归档不落事件、重启确定性重算 ｜ tsc 0；38 文件/279 用例；8 项契约（3.2.1） ｜ 版本由 release 统一 3.3.0
- 2026-11-18 ｜ main ｜ `ff61237` ｜ merge（squash PR #43，issue #40） ｜ 部署与一致性边界文档：`docs/10`、docs/00 §14 导航、docs/02 §6 SQL 标规划中、README §五/§六；docs-only ｜ 明确单实例边界与多实例禁止共写，避免把 rename 原子性当事务 ｜ check:contract 8/8（3.2.1）；链接核对 ｜ 无代码改动
- 2026-11-18 ｜ main ｜ `9647a6a` ｜ merge（squash PR #44，issue #37/#38） ｜ 房间入口存在性守卫（8 入口 404、不隐式建房）+ map tick 单批 atomic（time.advance 与模块提案同批）；docs/03 §10.15、docs/06 §4/§4.9 ｜ #37 snapshot 对未知房间返回空状态不抛错；#38 先单独提交时间推进无法撤销；`time.advance` 不进 dryRun（信封来源 trustedOrigin） ｜ tsc 0；38 文件/273 用例（新增 6）；8 项契约（3.2.1） ｜ E_ROOM_NOT_FOUND 未登记、listRooms 属契约外能力、roomGate O(n)（release 统一收口）
- 2026-11-18 ｜ main ｜ `42690c9` ｜ release ｜ `CONTRACT_VERSION 3.2.0 → 3.2.1`；CHANGELOG 新增 v0.5.1 段；MEMORY 快照/时间线/遗留同步 ｜ PR #22–#24 收尾；`v0.5.1` tag 当时未打 ｜ tsc 0；37 文件/267 用例；8 项契约（3.2.1） ｜ tag `v0.5.1` 在 v0.5.2 发布时补打
- 2026-11-18 ｜ main ｜ `9bd9609` ｜ merge（squash PR #24，issue #20/#21-2） ｜ 多 NPC 记忆按人注入 + 工作记忆滚动替换（「最近对话」tombstone 旧条、免 G3/G4/G6 与情节配额）+ `LlmProduct.narrative/dialogue`；rebase 到 `0617bf2` 后 head `a71b11e`；`PROMPT_VERSION 2026-11-18.1` ｜ #20 根因=多 NPC 场景 `selectOwner` 退回玩家，NPC 私忆整段不进 S7/S8（bug）；工作记忆不占 30 条情节配额，`archived` 回收留后续 ｜ tsc 0；37 文件/267 用例；8 项契约（3.2.0）；build 287.05 kB / gzip 90.90 kB ｜ `xWritesPerTurn=8` 双 NPC 写满可能 `E_X_LIMIT`（见 §3.3）
- 2026-11-18 ｜ main ｜ `0617bf2` ｜ merge（squash PR #23，issue #18/#21-3） ｜ LLM 非法 JSON：容错提取（平衡括号/围栏/尾逗号）+ 自动重问一次；`retryable` 按 `RETRYABLE` + `E_STORE_FAULT`；重问失败保留真实码；rebase 到 `cad0cf1` 后 head `1491422` ｜ 原 `stripFences` 会误伤叙事含 ``` 的合法 JSON（复审用 `JSON.stringify` 实测复现）；基础设施错误不许被改写成格式错 ｜ tsc 0；35 文件/253 用例（合并 main 后）；8 项契约 ｜ —
- 2026-11-18 ｜ main ｜ `cad0cf1` ｜ merge（squash PR #22，issue #21-1/#21-3） ｜ 点不在场 NPC →「TA 不在这里」/「前往所在地」（travel 到达后再选中）+ 可重试错误重试按钮（新 `clientTurnId`、不重复玩家行）；`npc-presence.ts`/`turn-error.ts` 纯函数 + 9 单测 ｜ 只在当前场景开聊；重试前按当前 WorldState 复核目标在场，换场景清 `lastTurn` ｜ tsc 0；34 文件/237 用例；8 项契约（3.2.0）；build 287.05 kB / gzip 90.90 kB ｜ 失败回合已流出叙事不回滚；无组件级测试
- 2026-11-17 ｜ main ｜ `v0.5.0`（`95185b2` 之后的 release 提交） ｜ release ｜ `CONTRACT_VERSION 3.1.0 → 3.2.0`；建 `v0.5.0` tag + GitHub Release（notes 取 CHANGELOG 四条 issue 批量段），Latest=v0.5.0；CHANGELOG 顶部补版本-tag 对应行 ｜ 一次释放 #1/#3/#7/#8 批量落地 ｜ 31 文件/212 用例；8 项契约（3.2.0）；build:web 272.61 kB / gzip 86.19 kB ｜ issue #3 余项（/state 过滤、self 看自己）仍待后续
- 2026-11-17 ｜ main ｜ `95185b2` ｜ merge（squash PR #13，issue #7） ｜ 存档索引 + 回合历史 + 会话恢复 MVP；合并前解 `MEMORY/routes/App/TitleScreen` 冲突，docs §5.2.5 重编号 §5.2.7（PR #12 已占 5.2.5/5.2.6） ｜ 审阅 P1：历史文件 `rooms/*.history.jsonl` 会被 `FileStore.listRooms()` 当幻影房间（实测可覆盖历史）→ 改独立 `data/history/` 并加 e2e 断言；复验通过 ｜ 29 文件/212 用例；8 项契约（3.1.0）；build:web 272.61 kB ｜ 存档 MVP 限制见 §3.3
- 2026-11-17 ｜ main ｜ `a643d36` ｜ merge（squash PR #12，issue #3） ｜ 图鉴 I2 收口：服务端 `GalleryView`（secret 只分档、self 对他人分档、hidden 不出现）+ scenarios 数据化（`content/scenarios/*.json`）、`GET /rooms/:id/gallery` 与 `/scenarios`；web 删 `api-registry.ts` 与属性键直读 ｜ 审阅发现 2 处文档≠行为（未知房间 404 需 `listRooms()` 判存在、缺 min/max 不猜 0~100），作者修完复验通过 ｜ 28 文件/196 用例（合并 main 后）；8 项契约；build:web 268.65 kB ｜ 剩 issue #3 的 /state 数值通道与 self 看自己口径
- 2026-11-17 ｜ main ｜ `c55d5cb` ｜ merge（squash PR #11，issue #1） ｜ `xWritesPerTurn` 整回合预算显式化（`TurnBudget` 跨三次 apply 传递）+ docs/03 §2.4 提案阶段表/§10.11 ｜ 审阅发现初版文档把历史写成“原本每批限额”不实（3.1.0 已隐式共享预算），作者改为如实描述后通过 ｜ 26 文件/190 用例（合并 main 后）；8 项契约 ｜ 阶段数组扁平拼接、dryRun 一致性仍留待后续
- 2026-11-17 ｜ main ｜ `f23b1c6` ｜ merge（squash PR #10，issue #8） ｜ 文档职责整理：README 入口化、版本/测试数单一来源、SQLite→FileStore/JSONL、闭盒改角色约定；AGENTS §1 必读补 06/07/08 ｜ docs-only，审阅 `grep` 四条旧事实 0 命中、32 相对链接存在；解 MEMORY 分支条目冲突后合并 ｜ check:contract 8 项；docs-only 未跑 test ｜ issue #8 关闭
- 2026-11-17 ｜ main ｜ `d55b29e` ｜ merge（squash PR #9，issue #7 小 bug） ｜ `store.ts` `loaded` 置位后移到读取/解析/回放之后；断档修复先写盘；`appendMemory` 失败清理半载入；EISDIR 回归测试 ｜ 读失败先置 loaded → seq 假 0 → append 从 1 覆盖真实日志（真实丢数据风险） ｜ 26 文件/186 用例；8 项契约 ｜ 通过
- 2026-11-17 ｜ main ｜ `v0.4.0`（commit 见 `git log`） ｜ release ｜ 建 `v0.4.0` tag + GitHub Release（notes 合并记忆 3.1.0 与地图/图鉴两段），Latest 指向 v0.4.0；CHANGELOG 两段「未发布」标题对齐 v0.4.0 ｜ 一次释放记忆子系统 + 地图交互/图鉴收口 ｜ 26 文件/185 用例；8 项契约（3.1.0） ｜ issue #3 余项仍待后续
- 2026-11-17 ｜ main ｜ `69da448` ｜ merge（squash PR #5） ｜ 地图交互打磨 + 图鉴 I2 收口：点选不出发/前往入口统一并切回对话/对话流跟随/标题页次要入口下沉；新增 `GET /api/v1/registry`（docs/03 §5.2.4，只给声明） ｜ 首帖针对旧 head `cd12771` 打过 request-changes（基线回退记忆接线、tsc 2 错、5 测试挂、CONFLICTING），作者 rebase 到 `b11ad5a` 后复跑全绿并 approve；squash 合并、PR MERGED ｜ tsc 0；26 文件/185 用例；8 项契约（3.1.0）；build:web 271.31 kB / gzip 86.66 kB ｜ issue #3 余项（数据通道/self/scenarios）仍需后续；tag/Release 未创建
- 2026-11-17 ｜ main ｜ `8a26e00` ｜ merge（squash PR #4） ｜ 记忆子系统 3.1.0 合入：事件溯源记忆（三层召回/1100 tok/两阶段裁决）、账号维度（userId/`/me`）、世界层 canonize 八闸门 + 独立 judge、世界印象投递、`CONTRACT_VERSION 3.1.0`；先 local merge `origin/main` 解 CHANGELOG 冲突（`b16dabd`）再 squash ｜ 三轮审阅：首轮打回（P0×5+P1×14）→ 6538123 修 P0/P1 → a544d3a 收尾 → 5c3e71a 清 P2 → 通过；squash 保留单提交、PR 标记 MERGED ｜ tsc 0；25 文件/184 用例；check:contract 8 项；`build:web` 未回归（本 PR 不动前端构建） ｜ tag/Release 未创建（如需要另办）；issue #3 仍在
- 2026-11-17 ｜ main ｜ `b16dabd` ｜ merge ｜ `origin/main` 合入 `feat/memory-module`，解 `CHANGELOG.md` 冲突（保留 PR #4 未发布段 + v0.3.0 段） ｜ GitHub 显示 pr #4 CONFLICTING，先合基再 squash ｜ tsc 0；184 用例；8 项契约 ｜ 无
- 2026-11-17 ｜ main ｜ 本提交（tag `v0.3.0`） ｜ release ｜ 建 `v0.3.0` tag + GitHub Release（notes 取 CHANGELOG 对应段），Latest 指向 v0.3.0 ｜ 让 CHANGELOG 标题、tag、Release 三者对齐 ｜ 17 文件/134 用例；8 项契约；build:web 269.06 kB ｜ 无
- 2026-11-17 ｜ main ｜ `45ea4d4` ｜ merge（squash PR #2） ｜ 前端体验与运行时模型接入（源 `feat/web-ux @ 805b50d`，含标题页/对话流/图鉴/打字机/settings 热切换/离线叙述） ｜ squash 保留单提交、PR 标记 Merged；审阅 M1–M5 已复核，旧 head e5672aa 被作者重建 ｜ tsc 0；17 文件/134 用例；check:contract 8 项；build:web 269.06 kB / gzip 86.02 kB ｜ I2 偏差作为临时债（issue #3），下次前端/图鉴合并前必须收口
- 2026-11-17 ｜ main ｜ —（PR #2 复审修订，父 e2cdfab） ｜ fix ｜ 按审阅 M1–M5 修订：MEMORY 行尾改 LF 并修正事实（父 e2cdfab、地图合入 0c70559/b7f9fae）；settings 补测试（探活失败不切换/文件往返/key 不回显/仅本机守卫）+ `clientFactory` 注入口 + 错误信息 key 脱敏 + 落盘 0600 + clear 重置 view；offline-narrator 补测试；`defaultsFor` 只播 public（secret/self 不预填）并补播种测试；map intent 对交易意图让位（「去食堂买面包」归 trade）并补路由回归 ｜ 逐条对应审阅 M1–M5；新增 17 个用例 ｜ tsc 0；vitest 133/134（唯一失败为上游既有的 Windows chmod 用例）；check:contract 8 项；build:web OK ｜ 建议项：App.tsx 已拆 ChatPanel、typewriter 回标题 stop；待 owner 拍板图鉴 I2 临时债
- 2026-11-17 ｜ main ｜ `45ea4d4` ｜ feat ｜ 前端体验与运行时模型接入合入本地树：标题页（选身份/继续/说明/关于/接入真实模型，独占步骤）、对话流开场剧情、图鉴（信任数值+戒备分档）、打字机逐字呈现（`typewriter.ts`）、Web Audio 按键音、CSS 过渡；服务端 `settings.ts`/`llm-switch.ts`（`GET/POST/DELETE /api/v1/settings/llm`，保存 `data/llm-settings.json` 重启恢复、仅本机）、离线叙述器 `offline-narrator.ts`、建房灌 public 属性默认值；map manifest 补 `keywords`（中文路由） ｜ 玩家自备 key 走面板热切换，环境变量优先；地图 v0.2（0c70559/b7f9fae 合入）全部保留，只叠加未改动文件的增量 ｜ tsc 0；17 文件/134 用例；8 项契约；build:web 269.06 kB / gzip 86.02 kB ｜ 图鉴直读 `attrs.trust/guard`（I2 偏差，docs/06 §7 已记录）；设置端点仅本机（loopback）可调用，非本机返回 E_FORBIDDEN；App.tsx 301 行（超 ≤300 上限 1 行）
- 2026-11-16 ｜ main ｜ —（本文件自身提交，sha 见 git log） ｜ docs ｜ 新增共享记忆 MEMORY.md 与 AGENTS §11 维护规范 ｜ 让跨会话协作者先读快照+分支记录，提交/审阅/合并时按分支追加条目 ｜ tsc 0；14 文件/115 用例；check:contract 8 项 ｜ 无
- 2026-11-16 ｜ main ｜ `6e70253` ｜ merge ｜ 审核层 + 现实锚定层（squash 自 `feat/reality-anchoring @ dc6be77`） ｜ 用 squash 避免 `30e7f01` 误提交的 `.ffqa/`+`defense/` 快照（7.3 MB）进入 main 历史 ｜ tsc 0；14 文件/115 用例；check:contract 8 项；build:web OK ｜ 见 §3.3
- 2026-11-16 ｜ main ｜ `3112f79` ｜ merge ｜ 引擎 3.0.0（结算原子性 + 持久化闭环） ｜ 先修引擎再合地图相关路径；解 `bootstrap.ts` 冲突时取并集 ｜ 95 用例、8 项契约检查 ｜ 见 §3.3
- 2026-11-16 ｜ main ｜ `95eb27d..362df4a` ｜ merge（ff） ｜ 地图模块 ｜ 地图不依赖引擎 3.0.0，可先 ff ｜ 76 用例、check:contract（2.2.0） ｜ 见 §3.3

- 2026-11-17 ｜ main ｜ `b7f9fae` ｜ merge（ff） ｜ 地图 v0.2 合入（源 `feature/campus-map-v0.2`，含 b509d48/c522153/b7f9fae） ｜ 分支与 main 同线、无冲突，ff 保留提交 ｜ tsc 0；14 文件/117 用例；check:contract 8 项 ｜ 待 push；遗留见分支小节
- 2026-11-17 ｜ main ｜ `CHANGELOG.md` ｜ docs ｜ 新增根目录更新日志（M0 / 引擎 3.0.0 / 审核与锚定 / 地图 v0.2，按日期分段） ｜ GitHub 上需要可读的更新日志；协议版本以 CONTRACT_VERSION 为准 ｜ tsc 0；14 文件/117 用例；8 项契约 ｜ 无
- 2026-11-17 ｜ main ｜ `CHANGELOG.md`（二次） ｜ docs ｜ 小节标题对齐 tag（v0.1.0/v0.1.1/v0.1.2/v0.2.0），拆出引擎与审核/锚定两段 ｜ 让 CHANGELOG 与 GitHub Releases 一一对应 ｜ tsc 0；14 文件/117 用例；8 项契约 ｜ 无

### fix/map-failure-mask（issue #58，PR 待开）

- 2026-11-18 ｜ `fix/map-failure-mask` ｜ `f4163cb` ｜ fix ｜ `map.ts` 新增私有 `outbound()` 统一出站出口，travel/tick 的成功与全部 10 个 ok:false 返回点都过 `maskTurnEvents`（失败遮 message/detail，成功整包）；早期失败靠 snapshot 回退，有快照的调用点直接传入；新增 4 条失败脱敏用例，`docs/06` §4.2/§4.3 同步 ｜ #55 只用路径巧合论证失败响应安全，错误 detail 可能含未认识 NPC 真名（尤其 tick 的 rejected.detail），失败同属出站视图必须同口径；maskNamesDeep 只替换占位表真名，不误伤错误码/场景 id，也天然覆盖未来 details 字段；不 bump ｜ tsc 0；48 文件/324 用例通过（基线 47/320）；check:contract 8 项（3.4.1）；与 PR #57 集成 49 文件/332 用例全绿 ｜ openDialogue / installScene 内部 fail 不在本 issue 范围（installScene 失败经 travel 的 installFail 已覆盖）；#33/#35 按用户指示忽略

### fix/scenario-profile-gating（issue #54，PR #56，已 squash 合并 `2547d73`）

- 2026-11-18 ｜ `fix/scenario-profile-gating` ｜ `3006ce2` ｜ fix ｜ `/api/v1/scenarios` 的 npcs 收窄为 `PublicNpcEntry`（id/appearance）；`mutter` 改随 `/gallery` 且 `met=true` 下发，web `CampusMap` 按 `roomId` 拉图鉴取气泡（拉不到则不出）；`docs/03` §5.2.5/§5.2.6/§10.18 与 `docs/06` §7/§8 同步；新增 5 条测试 ｜ 一级认识口径要求未认识 NPC 不给档案；全局公开端点不应带任何档案字段（已知也不带）；气泡由房间图鉴供给，避免标题页读档案，同时不回退地图气泡；不 bump（派生视图收窄，不进契约 schema） ｜ tsc 0；46 文件/317 用例通过（基线 44/312）；check:contract 8 项（3.4.0）；与 PR #55 合并集成 47 文件/320 用例全绿 ｜ CampusMap 实际由 `ChatPanel.tsx:168` 渲染，故该文件仅加一行 `roomId={roomId}`；气泡在新认识后下一次房间切换/重挂载出现；#33/#35 按用户指示忽略
- 2026-11-18 ｜ `fix/scenario-profile-gating` ｜ `2547d73` ｜ merge ｜ squash 合并 PR #56（head `c88640c`，先合入新 main `4c85797` 后 47 文件/320 用例全绿） ｜ 用户“一起吧”授权合并+发版 ｜ tsc 0；47 文件/320 用例；8 项契约（3.4.0） ｜ 气泡刷新低优先

### fix/room-tick（issue #37 / #38，PR #44，已 squash 合并 `9647a6a`）

- 2026-11-18 ｜ `fix/room-tick` ｜ 本提交 ｜ fix ｜ 新增 `apps/server/src/room-exists.ts`：房间入口先判持久化存在性（有 `listRooms` 用文件名，否则退化为读 1 条事件），未知/世界层房间一律 404 `E_ROOM_NOT_FOUND`，不隐式落盘；覆盖 `/state`、`/events`、`/turns`（SSE 前）、`/history`、`/map`、`/map/travel`、`/map/tick`、`/map/dialogue`。`map.ts` 的 tick 改为 `time.advance` 与模块提案单批 atomic apply，失败零部分提交（#38）｜ 根因：#37 `FileStore.snapshot` 对未知房间返回空 WorldState 不抛错 → 200 且 tick 写幽灵日志；#38 先单独提交时间推进，后阶段失败无法撤销。判定用持久化事实（`listRooms`）而非 snapshot 抛错，避免依赖实现细节；`time.advance` 不进 dryRun（3.2.1 起按信封来源 trustedOrigin，dryRun 的 `arbiter.dryRun` 来源不被信任），由带 `cause {type:"tick"}` 的 apply 一并裁决 ｜ tsc 0；38 文件/273 用例（新增 6：room-guard 3 + map tick 回归 3）；check:contract 8 项（3.2.1） ｜ 版本号由 Lead 统一落 3.3.0（本 PR 不改 header/version.ts）；未改 engine/web；`docs/03` §10.15、`docs/06` §4/§4.3/§9 已同步

- 2026-11-18 ｜ `fix/room-tick` ｜ squash `9647a6a` ｜ merge ｜ PR #44 squash 合入 main（复审后）；合并后由 release 提交统一登记 `E_ROOM_NOT_FOUND`（docs/03 §7 + §10.17）并补 §2.9 `listRooms` 可选能力说明 ｜ 审阅点：404 code 无契约来源、listRooms 契约外、roomGate 每请求扫目录 O(n) ｜ — ｜ 无

### docs/deploy-boundary（issue #40，PR #43，已 squash 合并 `ff61237`）

- 2026-11-18 ｜ `docs/deploy-boundary` ｜ 本提交 ｜ docs ｜ 新增 `docs/10-部署与一致性边界.md`（单实例边界/多实例禁止共写/rename≠事务/备份升级停写/运维清单/未来 DB·分布式锁规划中）；docs/00 §14 文档地图补 09/10；docs/02 §6 SQL DDL 标未来设计稿；README §五/§六补部署限制与导航 ｜ #40 要求澄清多实例一致性边界；文档只记录当前实现，不承诺未实现能力 ｜ check:contract 8/8（3.2.1）；链接核对 ｜ docs-only，未改代码

### fix/store-robustness（PR #9，已 squash 合并 `d55b29e`）

- 2026-11-17 ｜ `fix/store-robustness` ｜ 本提交 ｜ fix ｜ `FileStore.readLog` 的 `loaded` 置位移到"成功读取+解析+回放"之后；断档修复改为先写回文件再改内存；回放异常时清掉半载入的内存状态。新增回归测试：同名目录占位模拟 `readFile` EISDIR（稳定、不依赖 root/权限），第二次 `load` 必须读到真实日志 ｜ 读失败先置 `loaded` 会让房间永久"已载入"（seq 假 0），后续 append 从 seq 1 重写并覆盖真实日志，属 issue #7 §C 的真实丢数据风险；先写盘再改内存保证失败可重试 ｜ tsc 0；26 文件/186 用例；check:contract 8 项（3.1.0） ｜ 未改 web/memory 索引（`byRoom`/`syncedSeq` 属 `memory.ts`，本次不涉及）；待 PR 审阅

### fix/docs-responsibility（PR #10，已 squash 合并 `f23b1c6`；issue #8）

- 2026-11-17 ｜ `fix/docs-responsibility` ｜ 本提交（sha 见 git log） ｜ docs ｜ 按 issue #8 收口文档职责：README 重写为入口（目标 / 现在能玩什么 / 启动 / 数据位置 / 限制与约定 / 导航），删除与 `AGENTS.md`、本文件重复且已漂移的架构不变量、目录树、扩展配方、权限表；版本号与测试数改为单一来源引用（快照看本文件 §0，版本真源 `docs/03` §0.4 + `packages/shared/src/contract/version.ts`），README 不再手抄具体 3.x 版本与用例数；存储描述由 SQLite 更正为 FileStore/JSONL，SQLite/WAL 与 SQL 投影表明确标「规划中」；「闭盒：只有我能改」改为角色约定「引擎改动需项目所有者批准」；`AGENTS.md` 只改 :5 阶段/版本引用与 §1 必读清单（补 `docs/06`、`07`、`08`）；`docs/07` 状态行由「方案稿 v2，未落地」更正为「P0–P4 已随 3.1.0 进 main」 ｜ 分工定为 README=入口、AGENTS=AI 执行约束、`docs/03`=唯一名字来源、MEMORY=分支决策/审阅/遗留；不删重要约定、不改引擎权限、不动契约 ｜ grep 四条旧事实（`CONTRACT_VERSION 3.0.0`、`184 个测试`、`SQLite（事件日志`、`只有我能改`）在 README 中 0 命中；`npm run check:contract` → 8 项全过（3.1.0）；typecheck/test 未跑（纯文档变更） ｜ 合并后需在 `### main` 补 merge 条目；issue #8 关闭前确认 README 导航与 `docs/02` §6 SQL 设计稿的措辞已一致

### feat/save-session（PR #13，已 squash 合并 `95185b2`）

- 2026-11-17 ｜ `feat/save-session` ｜ 本提交 ｜ feat ｜ issue #7「续玩/会话恢复」MVP：`data/rooms/<roomId>.history.jsonl` 记已提交回合（`withTurnRecording` 包在 Turn 外层，含 map.travel；只在 turn.commit 后写、turnId 去重）、`data/users/<userId>/saves.json` 存档索引（建房登记 / turn.commit 推进游标 / 只删索引，tmp+rename 原子写）、3 个端点（`GET /rooms/:id/history`、`GET/DELETE /me/saves`，docs/03 §5.2.7）、web 本地身份 `ecust.playerId` + 标题页「我的存档」+ 进房重放历史不重播序章、新增 `docs/09-存档与会话恢复方案.md` ｜ 权威仍是事件日志，历史和索引都只是投影：写失败只告警不回滚已提交回合；恢复不产生新回合；不 bump CONTRACT_VERSION、不改引擎、不新增 op；本地 UUID 仅开发期身份（可伪造） ｜ tsc 0；29 文件/201 用例全过（新增 history 9 / saves 5 / e2e 2）；check:contract 8 项全过；build:web 275.17 kB / gzip 87.96 kB ｜ 已知限制：speakers 恒空、历史最多一次 200 行、本地身份清空即丢索引（房间仍可进）、历史写失败只告警；恢复后前端不重拉历史（仅本回合流式追加 + 重拉 state）
- 2026-11-17 ｜ `feat/save-session` ｜ 本提交 ｜ fix ｜ 审阅 P1/P2：历史移到独立目录 `data/history/<roomId>.jsonl`（`data/rooms/` 只放事件日志，避免 `FileStore.listRooms()` 把 `*.history.jsonl` 切成幻影房间、避免 append 覆盖历史）；`GET .../history` 不下发 `userId`（仅落盘审计）；前端 `refreshSaves` 失败兜底 `[]`；docs/03 §5.2.7 + docs/09 补独立目录、隐私、老房间可读说明 ｜ 历史是投影，不能污染房间发现逻辑：`listRooms()` 按 `*.jsonl` 扫目录，投影文件必须与事件日志物理隔离 ｜ tsc 0；29 文件/202 用例全过（e2e 增 listRooms 断言）；check:contract 8 项全过；build:web 成功 ｜ 未改 `POST /rooms` 登记游标取法（共享 `Store` 契约无 `seq()`，沿用 `events()` 尾 seq；见 PR #13 说明）

### fix/arbiter-turn-limits（PR #11，已 squash 合并 `c55d5cb`；issue #1）

- 2026-11-17 ｜ `fix/arbiter-turn-limits` ｜ `872f2a1` → `5a59556` ｜ fix ｜ `Turn` 创建 `TurnBudget` 并跨三次 `apply`（主批/去记忆重提/修复重提）显式传入；`xWritesPerTurn`/`maxDeltaPerTurn` 文档明确为整回合限额；`dryRun` 独立预算；初版文档误写“原实现每批限额”，已改为如实描述（3.1.0 已通过 `cause.causedBy` 隐式共享） ｜ 语义不变、只把隐式共享显式化并补测试，避免把历史写错 ｜ tsc 0；26 文件/189 用例；8 项契约（3.1.0） ｜ 未改：阶段数组扁平拼接、dryRun/权限环境一致性

### fix/llm-robustness（issue #18 / #21-3，已 squash 合并 `0617bf2`）

- 2026-11-18 ｜ `fix/llm-robustness` ｜ `1491422`（rebase 后）→ squash `0617bf2` ｜ merge ｜ PR #23 squash 合入 main（rebase 到 `cad0cf1`，解 MEMORY 冲突）；合并后 main 35 文件/253 用例 ｜ 三轮审阅：首轮 COMMENTS 2 必修（stripFences 误伤、`E_STORE_FAULT` 不可重试）→ 修复复审，P2 再修（重问失败保留真实错误码）→ 通过 ｜ tsc 0；8 项契约 ｜ web 重试按钮由 PR #22 交付；格式修复仍失败后的降级策略留后续
- 2026-11-18 ｜ `fix/llm-robustness` ｜ 本提交 ｜ fix ｜ 引擎侧容忍 LLM 非法 JSON：`turn.parse.ts` 去围栏、取首个平衡 `{...}`（字符串/转义感知）、容忍尾随逗号与前后文本，顶层必须为对象；`TurnLlm.ask` 解析失败（含网关 `json:true` 抛 `E_LLM_FORMAT`）带解析错误摘要自动重问一次，仍失败才 `turn.error`；`turn.error.retryable` 改为按 `RETRYABLE`（`E_LLM_FORMAT`/`E_LLM_TIMEOUT`/`E_RATE_LIMITED` 为 true，`E_MODULE_FAULT` 等硬失败为 false）作为前端重试标记 ｜ 网关是"解析失败即抛"，引擎拿不到坏 raw，所以修复只能落在"容错对齐网关 + 自动重问"；`LlmResult.json` 是可选字段，自定义/旧端口仍必须引擎自己能解析；格式修复与提案拒绝修复分开措辞，避免模型借格式重问改业务内容 ｜ tsc 0；33 文件/225 用例（新增 turn.parse 7 + turn e2e 4）；check:contract 8 项（3.2.0） ｜ web 重试按钮、修复仍失败后的降级策略另任务/Lead 统筹；未 bump CONTRACT_VERSION（docs/03 §10.13 记录）

- 2026-11-18 ｜ `fix/llm-robustness` ｜ 本提交（复审修复）｜ fix ｜ 按 PR #23 复审修：`turn.parse.ts` 先按原文 balanced 解析、失败才剥**首尾**围栏（叙事字符串里含 ``` 的合法 JSON 不再被截断）；`turn.error.retryable` 把 `E_STORE_FAULT` 也计为可重试；`formatError` 报文压平截 200 字；§10.13 标题/文案修正；网关 `json.ts` 与引擎 `turn.parse.ts` 注释互指 ｜ 理由：先 stripFences 再找 `{` 是真回归（复审用 `JSON.stringify` 实测复现）；`E_STORE_FAULT` 本回合未 commit、重试安全（docs/03 §7） ｜ 验证：tsc 0；33 文件/228 用例；check:contract 8 项（3.2.0） ｜ 遗留：web 重试按钮、格式修复仍失败后的降级、版本由 Lead 裁定（倾向 3.2.1）
- 2026-11-18 ｜ `fix/llm-robustness` ｜ 本提交（P2 复审）｜ fix ｜ 格式重问失败保留实际错误码：`RepairFailure{code,cause}`，`ask()` 只在第二次仍解析失败时构造 `E_LLM_FORMAT`；重问遇 `E_LLM_TIMEOUT`/`E_RATE_LIMITED` 原样上抛（`DefaultTurn` 从异常取码） ｜ 理由：否则基础设施故障被误报成格式错，超时切 provider、按码分流失效 ｜ 验证：tsc 0；33 文件/231 用例；check:contract 8 项（3.2.0） ｜ 遗留：web 重试按钮、修复仍失败后的降级、版本待合并裁定（倾向 3.2.1）
### feat/memory-module

- 2026-11-17 ｜ `feat/memory-module` ｜ `<P0>` ｜ docs ｜ 记忆模块 P0 契约：`CONTRACT_VERSION 3.1.0`、`PROMPT_VERSION 2026-11-17.1`、新增 `MemoryTier/MemoryStatus/MemoryProfile/ImpressionNotice`、`Memory.recall/profile`、`TurnRequest.userId`、`RoomMember.userId`、`memory.write` 只增字段、新事件 `memory.tombstoned`/`memory.impression.queued`、33 错误码、`memory.*/canonize.*/impression.*` 配置键、新建 `docs/prompts/04-memory-writer.md`、`00-world-system.md` 加 S1.5 世界记忆占位 ｜ 文档先于代码（§10.10 记录版本影响）；依据 `docs/08` §2；12 op 与 `apiVersion` 不变 → 3.1.0 为 minor（只增字段/类型/事件） ｜ tsc 0；17 文件/134 用例；check:contract 8 项（3.1.0） ｜ 下一步 P1：事件溯源 `memory.ts` + `memory.gate.ts` + 两阶段裁决
- 2026-11-17 ｜ `feat/memory-module` ｜ `<P1>` ｜ feat ｜ 记忆接通：`EventSourcedMemory`（事件投影 + `sync` 增量、`recall/profile/compact`）、`memory.gate.ts` 六道闸门（归属/形状/去重/重要度下限/秘密/配额）、`turn.memory.ts`（三层召回 + 1100 tok 硬顶 + 首轮种子 + 记忆 Proposal）、`turn.ts` 两阶段裁决（只有记忆被拒 → 去掉记忆重提并留 fact）、写后 `ingest`；模型输出新增 `memory[]`（`LlmMemoryDraftSchema`，ownerId 由引擎补） ｜ 记忆必须是"日志的索引投影"而不是第二个库，才能同时满足重启/回放/联机一致；记忆写坏不许毁掉玩家合法行动 ｜ tsc 0；19 文件/152 用例（新增 memory 11 + memory.turn 7）；check:contract 8 项（3.1.0）；`PROMPT_VERSION 2026-11-17.1 → 2026-11-17.2` ｜ 下一步 P2：用户库（userId 贯通/profile/种子/用户投影）

- 2026-11-17 ｜ `feat/memory-module` ｜ `<P2>` ｜ feat ｜ 账号维度贯通：`room.member.joined/left` 进投影（建房即写成员与 `userId`，solo = 1 个成员）；`POST /rooms`、`POST /rooms/:id/turns` 接受 `X-User-Id`/`userId`（缺省取 `GALGAME_DEV_USER`）；新增 `GET /api/v1/me` 返回 `Memory.profile`（只读派生，不写状态）；`createApp` 额外导出 `arbiter` 供测试/运维 ｜ 私忆隔离必须有账号键，否则"跨用户隔离"无从谈起；账号只决定看哪份档案，不是权限凭据 ｜ tsc 0；20 文件/155 用例（新增 user 3）；8 项契约（3.1.0） ｜ 下一步 P3：世界层永久记忆 + canonize 八道闸门

- 2026-11-17 ｜ `feat/memory-module` ｜ `<P3>` ｜ feat ｜ 世界层永久记忆：`packages/engine/src/canonize.ts`（`CanonizeJob`：候选=同内容 ≥2 个 owner 的 public+long 记忆；八道闸门 来源/公共性/隐私/独立审核/幂等/体量/不可变/回滚；发布走 `memory.write tier=permanent`，撤回走 tombstone）；`apps/server/src/canonize.ts`（`LlmCanonizeJudge` / `DenyAllJudge`，未配 = fail-closed）；`GALGAME_CANONIZE_*` 配置；`worlds/<id>/mem.version` 落盘；`POST /api/v1/admin/canonize/{run,tombstone}` ｜ 世界层写错一次所有玩家都受影响，因此闸门在代码里、审核模型必须独立、没配就全拒；世界层 = 同一事件日志的另一个房间，不新增存储 | tsc 0；21 文件/162 用例（新增 canonize 7）；8 项契约（3.1.0） ｜ 下一步 P4：印象投递 + `/me` 计数 + 抽样/熔断

- 2026-11-17 ｜ `feat/memory-module` ｜ `<P4>` ｜ feat ｜ 世界印象与观测：`impressions.ts`（`subjectTextOf`/`buildImpression`/`impressionFact`/`pendingNotices` + `Impressions` 端口）；canonize 成功后按 `aboutUserIds`（≤4）入队、`onImpression` 写 `data/users/<safeId>/impressions.json`（用户投影，非世界状态）；Turn 在 facts 追加 `【世界印象】…记住了你：…`（≤2 条、TTL 30 天、提交后才 `markDelivered`）；`GET /api/v1/admin/stats`（`CanonizeStats` + 按房统计 + 人工抽样）；judge 连续失败 `judgeFailureLimit=3` 熔断（`circuit_open`） ｜ 同一世界事件对不同玩家的投递结果不同，进世界状态会让回放依赖“谁在线”，所以印象是**用户投影**、坏了当空；投递失败宁可下次重复一次，也不要“说过又没说过” ｜ tsc 0；23 文件/171 用例（新增 impressions 5 + server impressions 3 + canonize 熔断 1）；8 项契约（3.1.0）；smoke 12 实体/幂等 OK ｜ 遗留：`memory.impression.queued` 事件保留未发射（联机广播时再用）；canonize 定时器未接（当前只有 admin 端点触发）

- 2026-11-17 ｜ `feat/memory-module` ｜ `PR#4 复审修复` ｜ fix ｜ 按 PR #4 审阅修 P0×5 + P1 核心：`store.events` 默认 Infinity（原 200 条导致 ~30 回合后记忆冻结）；`Memory.rebuild` + 启动重建房间/世界层索引；世界层版本从 `mem.version` 读回（重启不回退）、发布后 `ingest` 世界事件（S1.5 不再恒空）；`retireRoom` 不再丢事件；私忆 id 丢弃 contentHash（同内容不同 owner 各一条）；`memory.write` 四方字段对齐（+`userId,worldId`）；`events.json` 注册 3 个 memory 事件；提示词按 S1→S1.5→S4→S5→S6→S7→S8→S9 重排并加 `WORLD_MEM_VERSION` 标记、`buildPrompt` 透传 `mem`；`recall` 的 forced 不占预算、world scope 不按 userId 过滤；种子不再因世界层 permanent 跳过；`X-User-Id` 可关、`room_world_` 房间禁止 state/events/turns；`FileImpressions` 目录名 `sha256` 单射 + 投递前校验归属；canonize `enabled` 默认 true、`scanMinutes` 定时补扫（原 `sampleRate` 死键删除）；`canonize.ts` 455→208 行（拆 `canonize.candidates.ts` / `canonize.types.ts` / `canonize.publish.ts`） ｜ 世界层链路原本是断的（写进去没人读）；事件日志是唯一真源，所以重启必须重建索引；同一内容必须能属于多个 owner，因此 id 不能由内容派生 ｜ tsc 0；**24 文件 / 180 用例**（新增 e2e 4、memory +3、canonize +2）；check:contract 8 项（3.1.0） ｜ 遗留：`perSourceCap` 缺少可构造的测试场景；`publish` 函数仍 ~150 行（文件已 ≤300）；`GalleryPanel` 直读 attrs 的临时债按 issue #3 处理

- 2026-11-17 ｜ `feat/memory-module` ｜ `PR#4 二轮复审` ｜ fix ｜ 有条件通过后的收尾：① 接通 `attachAboutUserIds`（`turn.ts` 在 `applyMemoryGates` 前调用）+ 闸门重建草稿时保留 `aboutUserIds`（两处都断会导致世界印象恒不触发），新增 `apps/server/src/impressions.e2e.test.ts`（回合写记忆 → canonize → `data/users/*/impressions.json` → 下回合 facts 出现【世界印象】且投递后 pending 清零）；② 私忆 id 的 `turnSeq` 改用回合信封 `cause.seq`（时钟不推进的两个回合原本会撞 id）；③ G6 超限定版为**不建次日队列**（候选是房间记忆的纯函数，跨日重新聚合），docs/08 §7.3⑥ 改正文 + §13 记一行；④ P2 顺手项：`GALGAME_DEV_USER` 真正接线、`/health` 暴露 `canonize.{enabled,judge}`、tombstone 存在性改用记忆索引（不再 `sample(200)` 误判）、`WORLD_MEM_VERSION` 明确为格式版本；⑤ 补测试：`dailyCap` 跨日重聚合、`room_world_*` 404、`trustUserHeader=false` 忽略 `X-User-Id` ｜ 「世界记住你」是 P4 的卖点，链路只要有任一处没接就等于没做；候选不落队列是因为它与记忆是同源的纯函数，重复存储只会制造不一致 ｜ tsc 0；**25 文件 / 184 用例**；check:contract 8 项（3.1.0） ｜ 遗留：图鉴 `defaultsFor` 临时债归 issue #3；`publish` 函数体仍约 150 行（文件 ≤300）

- 2026-11-17 ｜ `feat/memory-module` ｜ `8a26e00` ｜ merge ｜ PR #4 squash 合入 main（源分支 `feat/memory-module @ 5c3e71a`；先 local merge origin/main 解 CHANGELOG 冲突 `b16dabd`） ｜ 三轮审阅通过后 owner 明确“合并并 push”；squash 保持单提交、PR MERGED ｜ 合并树 tsc 0；25 文件/184 用例；8 项契约（3.1.0） ｜ tag 未创建；issue #3 继续
- 2026-11-17 ｜ `feat/memory-module` ｜ `PR#4 三轮复审` ｜ docs ｜ 三轮复审「通过，可合并」后清 P2 文档欠账：`WORLD_MEM_VERSION` 语义统一为**记忆格式版本**（内容版本走 `worlds/<worldId>/mem.version`），同步 `docs/prompts/00:24`、`docs/08:254/315/347/377`、`docs/02:397`；`docs/07:232` 写清 `2026-11-16.1 → .1 → .2` 两跳；`canonize.test.ts` 的 duplicate 用例恢复 `expect(first.written).toHaveLength(1)`（否则"第二次被挡"可以在第一次也没写的情况下成立） ｜ 同一术语如果在正文里残留两种含义，后续协作者一定会按错的那份实现 ｜ tsc 0；25 文件 / 184 用例；8 项契约（3.1.0） ｜ 待 owner 决定合并方式

### fix/memory-context（issue #20/#21-2，已 squash 合并 `9bd9609`）

- 2026-11-18 ｜ `fix/memory-context` ｜ `a71b11e`（rebase 后）→ squash `9bd9609` ｜ merge ｜ PR #24 squash 合入 main（rebase 到 `0617bf2`，解 MEMORY 冲突）；合并后 37 文件/267 用例 ｜ #20 判为 bug（非未实现）；Codex 2 项 P2（工作记忆耗尽 sessionCap、截断丢台词）修复后通过 ｜ tsc 0；8 项契约 ｜ `xWritesPerTurn=8` 双 NPC 写满可能 `E_X_LIMIT`（§3.3）
- 2026-11-18 ｜ `fix/memory-context` ｜ `49d20ce` ｜ feat ｜ 多 NPC 记忆按人注入（`MemoryContext.npcs[]`，S1.5 之外预算 1100 均分，S7/S8 按人分段标名）+ 每回合把「玩家输入+叙事摘要」写成每个在场 NPC 的 short 工作记忆（`memory.write`，排在模型记忆之后，配额满时让位）+ S1 增「只有在场者能说话/行动，不得替不在场者回答」；`PROMPT_VERSION 2026-11-17.3 → 2026-11-18.1`；`docs/07` §4.1/§4.2、`docs/prompts/CHANGELOG.md` ｜ #20 根因：`turn.memory.selectOwner` 在多 NPC 场景把 owner 退回玩家，两个在场 NPC 的私忆整段不进 S7/S8（与 docs/07 §4 的承诺矛盾，判为 bug）；单 NPC/0 NPC 保持旧行为，写入按 owner 各过闸门、每 NPC 每回合仍 ≤3 条 ｜ 修前新测试 7 failed / 1 passed；修后 tsc 0、33 文件/223 用例、check:contract 8/8（3.2.0 未变） ｜ 待 PR 合并；已知：同一事件会分别写入各 NPC 私忆（有意，内容重复）、`speakers` 仍 `[]`、最近对话对下一回合才出现的不在场者不可见

- 2026-11-18 ｜ `fix/memory-context` ｜ `88aef4d` ｜ fix ｜ Codex P2 修复：①「最近对话」工作记忆写新条前先 tombstone 旧条（`memory.write status=tombstoned, supersedes`），每 owner 只留最新 1 条；`ownedCount` 与闸门 G6 排除工作记忆（`WORKING_MEMORY_TAG` 豁免 G3/G4/G6），`sessionCap=30` 只约束情节记忆；② `LlmProduct` 追加 `narrative`/`dialogue`（`text` 语义不变），工作记忆分别取 30/70/90 字、总 ≤200，叙事写满不再丢台词；`docs/07` §4.2 与 G6 行同步 ｜ 理由：工作记忆每回合 1 条会把 30 条上限填满并挤掉模型记忆（P2-1）；只取拼接文本截 100 字会整段丢掉「明早 8 点见」这类台词（P2-2）；不给工作记忆单开配额字段，用标签豁免 + 滚动替换保持改动面最小，`archived` 容量回收留给后续 issue ｜ 新增 `memory.gate.test.ts` 3 例；`memory.multinpc.test.ts` 增滚动替换/台词保留/连续 31 轮；更新 2 处旧预期；tsc 0、34 文件/229 用例、check:contract 8/8（3.2.0 未变）；`PROMPT_VERSION` 未改（提示词文案没动） ｜ 已知：`archived` 仍计入情节记忆配额（`compact` 未接线，后续 issue）；修复前积累的多条旧工作记忆会在首次写入时一次性 tombstone

### fix/memory-issues（issue #36/#39/#41/#42，PR #45，已 squash 合并 `259cb5e`）

- 2026-11-18 ｜ `fix/memory-issues` ｜ `4a7f2a2` ｜ fix ｜ #36 工作记忆对 G3/G4/G6 的豁免从"模型可写 tags"改为引擎内部 `workingDrafts` 通道（模型/种子草稿的「最近对话」标签在 `coerceMemoryDrafts` 与主循环两处清洗，仍受每回合 3 条 / session 30 条；读侧 `isWorkingMemory` 兼容历史）；#39 repair 成功后用修复版叙事/台词/记忆重建整份 plan 并随最终批提交（抽出 `applyBatch` 共用主批与 repair 批）；#42 `maybeCompact` 每 5 个提交回合对每个在场 owner 异步 compact（失败忽略）、`COMPACT_AFTER` 60→20、`archived` 不计 `ownedCount`/不进 prompt/工作记忆不归档、重启首次 sync 确定性重算 archived（新增 `memory.compact.ts`，`memory.ts` 294 行）；#41 核对 `xWrites` 只统计 `attr.delta`/`attr.set` 的 `x.` 键（`arbiter.ts:258`），`memory.write` 本就不计，3.2.1 上无法复现 E_X_LIMIT ｜ 信任边界必须是代码结构而非模型可写字符串；repair 两阶段只重提业务提案导致成功回合 0 记忆；长期房间会被"归档但仍计数"冻结配额；`compact` 归档不落事件，重启需确定性重算才能恢复配额；x 区预算按文档只约束 x. 属性写 ｜ rebase 到 ff61237 后：tsc 0；38 文件 / 279 用例全过（gate 6、turn 8、multinpc 13 含 45 轮/重启重算、#41 回归）；check:contract 8/8（3.2.1 未 bump）；PROMPT_VERSION 未改 ｜ CONTRACT_VERSION 待 Lead 统一 3.3.0；compact 非事件持久化（重启重算，归档集合可能与重启前略有差异）、异步失败静默；`maybeCompact` 进程内计数，重启后从 0 开始（最多晚 5 个回合才再压缩）

- 2026-11-18 ｜ `fix/memory-issues` ｜ squash `259cb5e` ｜ merge ｜ PR #45 squash 合入 main（rebase 到 `ff61237`）；复审：compact/repair/trust 边界通过，#41 按“前提不成立”关闭；§10.16 与 §10.15 的版本叙述由 release §10.17 统一 ｜ — ｜ — ｜ 无

### feature/campus-map-v0.2

- 2026-11-17 ｜ `feature/campus-map-v0.2` ｜ `b509d48` ｜ feat ｜ 真实底图 + 33 点位三态与缩放选点；服务端 status/category/image、travel 拦非 built、canon 懒安装；docs/02/06、README、MEMORY 同步 ｜ 地图要“看得见找得到”，未建成点位只能看不能进；数据驱动（status 在 world_map.json），不改引擎 ｜ tsc 0；14 文件/117 用例；8 项契约 ｜ 首轮打回：docs/03 MapView 未同步、docs/06:56/:154 与实现矛盾、`.tmp-map/` 未忽略
- 2026-11-17 ｜ `feature/campus-map-v0.2` ｜ `c522153` ｜ fix ｜ 清首轮 must-fix 与多数建议 ｜ 文档与实现对齐；旧存档坐标用模板兜底 ｜ tsc 0；117 用例；8 项契约 ｜ 残留：NPC attrs 优先与文档冲突、34px 偏移视觉余量小、偏移无测试
- 2026-11-17 ｜ `feature/campus-map-v0.2` ｜ `b7f9fae` ｜ fix ｜ NPC 坐标改模板优先 ｜ 与 loc 同策略，避免旧房间 NPC 被旧坐标甩偏 ｜ tsc 0；117 用例；8 项契约 ｜ 复审通过，已 ff 合入 main

### feat/web-ux（PR #2，已 squash 合并）

- 2026-11-17 ｜ `feat/web-ux` ｜ `e5672aa` → `805b50d` ｜ feat+fix ｜ 标题页/对话流/图鉴/打字机/运行时模型接入 + 审阅修订 ｜ 首轮 review 打回 M1–M5（MEMORY CRLF、零测试、settings 无鉴权、默认值泄 secret、关键词抢 trade），修订后复审通过；GitHub squash 为 `45ea4d4` ｜ tsc 0；17 文件/134 用例；8 项契约；build:web OK ｜ 图鉴 I2 偏差 = issue #3 临时债；PR 标题已清“123456”前缀

### feat/map-ux

- 2026-11-17 ｜ `feat/map-ux` ｜ `cd12771` → `b11ad5a` → squash `69da448` ｜ feat+fix ｜ 地图交互打磨 + 图鉴 I2 收口（点选不出发/前往入口统一并切回对话/对话流跟随/标题页下沉；`GET /api/v1/registry` 只给声明；图鉴 registry 驱动、删 `trust/guard/mood` 字面键） ｜ 首版基线错误被请求修改（回退记忆接线），rebase 后复审通过；squash 合入 main ｜ tsc 0；26 文件/185 用例；8 项契约（3.1.0）；build:web 271.31 kB / gzip 86.66 kB ｜ issue #3 余项：`/state` 数值过滤、`self` 口径、`scenarios.ts` 数据化；分支在 fork，无法自动删

### feat/gallery-view-scenarios（PR #12，已 squash 合并 `a643d36`）

- 2026-11-17 ｜ `feat/gallery-view-scenarios` ｜ `a0d58ac` ｜ feat ｜ issue #3 收口：新增 `GET /api/v1/rooms/:roomId/gallery`（服务端按 registry 生成 `GalleryView`：public 精确值 / secret 只给低中高三分档且响应不含精确数 / self 对他人只给分档、文本降级「—」 / hidden 不出现 / 未遇见不给档案与读数 / world+未知房间 404）与 `GET /api/v1/scenarios`（`content/scenarios/{openings,npcs}.json` 数据化，坏文件降级空表）；web `GalleryPanel` 改为只渲染 `GalleryView`、删 `api-registry.ts` 与前端 33/66 阈值，`scenarios.ts` 改 fetch 且失败显示「无预设开局」；docs/03 §5.2.5/§5.2.6、docs/06 §7/§8 同步 ｜ 可见性与分档口径放服务端才能保证"响应不含精确数字"；文案进 JSON 才符合 I2/I3；新端点独立成 `view.routes.ts` 并在 routes.ts 末尾独立区块挂载，减少与并行分支的冲突 ｜ tsc 0；**28 文件 / 191 用例**（新增 gallery 3 + scenarios 3）；check:contract 8 项（3.1.0）；build:web 268.65 kB / gzip 84.89 kB；`grep -rnE "attrs\.(trust\|guard\|mood)" apps/web` 空；审阅后修：未知房间改由 `listRooms()` 判 404（补真实 FileStore 路径测试）、self/secret 缺 min/max 降级 masked、文档 `GalleryStat.value` 收窄为 number ｜ 未做：`/state` 原始数值通道过滤、`self` 的"看自己"图鉴视图（本版本不提供）

### feat/simple-auth

- 2026-11-18 ｜ feat/simple-auth ｜ `0c39276` ｜ docs ｜ 按用户新要求关闭并撤回 upstream #25–#32，重新提交为 #33–#40，顺序对应且正文移除 Codex 徽章；旧 issue 评论链接新条目，明确关闭不代表问题已修复 ｜ #33–#39 保留参考方案，#40 多实例存储边界仍不附方案 ｜ gh 创建/关闭均成功；未修改业务代码

- 2026-11-18 ｜ feat/simple-auth ｜ `0c39276` ｜ docs ｜ 按用户授权向 upstream 提交后端审阅问题 #25–#31（房间授权/幂等/账号库保护/记忆配额豁免/幽灵房/tick 部分提交/修复漏记忆），附复现、基线、参考方案与 Codex 徽章；#32 单独记录多实例存储边界，不附方案 ｜ 方案仅供小组讨论，明确 PR #19 分支与 upstream/main 区别；#32 为静态边界分析，不声称多进程实测 ｜ gh issue create 全部成功；未改业务代码、未提交或推送本地变更

- 2026-11-18 ｜ feat/simple-auth ｜ `0c39276` ｜ review ｜ 后端边界审阅：临时目录复现登录 B 读取/操作 A 房间；相同 HTTP clientTurnId 连续提交日志 seq 44→48→52；模型标记「最近对话」时已满 30 条仍接受 5 条；用户库损坏后注册覆盖旧库；未知房间 state 200 且 tick 可写出幽灵房；tick 模块校验失败仍 morning→noon；提案修复成功 commit 但 memory.written=0 ｜ 以上待修，不将 director 占位列为缺陷；登录身份不等于房间授权，工作记忆豁免须可信来源；后端仍单实例 JSONL、会话内存、历史旁路写入 ｜ typecheck 无错误；38 文件/270 用例通过；契约 8/8（3.3.0）；额外复现均使用临时目录并清理 ｜ 未改业务代码、未提交或推送、未创建远程 issue；优先房间授权/回合幂等/账号库损坏保护

- 2026-11-17 ｜ feat/simple-auth ｜ 本提交 ｜ feat ｜ 简易用户系统：邀请注册 + 用户名密码 + HttpOnly Cookie 会话；`userId` 由服务端账号签发，重写 `userIdOf` 为会话优先，强制登录时除 health/registry/scenarios/auth 外全部 401；Web 删除 localStorage 身份、按 userId 分房间指针；新增 Docker/Compose/宿主机 Nginx 443（仅 IP Host，其他 Host 404）部署资产 ｜ 清 localStorage 不等于换账号；密码用 scrypt；不引入依赖；`GALGAME_AUTH_REQUIRED=1` 为生产开关，默认 0 保留旧 header 兜底 ｜ typecheck 0；33 文件/218 用例；check:contract 8 项（3.3.0）；build:web 287.27 kB / gzip 90.56 kB ｜ 会话在内存，重启需重新登录；旧 localStorage 账号/存档不自动迁移；部署到 49.235.185.136（443，仅 IP 访问；域名仍 WordNote）
- 2026-11-18 ｜ feat/simple-auth ｜ merge `upstream/main@42690c9` ｜ merge ｜ 合入上游 4 提交（`cad0cf1` 场景隔离+可重试、`0617bf2` LLM JSON 容错、`9bd9609` 多 NPC 记忆按人注入、`42690c9` 3.2.1 收尾）；解 4 处冲突：`version.ts` 取 `CONTRACT_VERSION 3.3.0` + `PROMPT_VERSION 2026-11-18.1`，docs/03 保留上游 §10.13/§10.14、本分支原 §10.13 后移重编为 **§10.15（3.2.1→3.3.0）**，MEMORY 两个分支小节并存，`style.css` 登录样式与上游重试/场景提示样式并存 ｜ 用 merge 不用 rebase：分支已推送且有 draft PR #19，不改写已推送提交、无需 force-push；进 main 走 squash，merge commit 不入主线 ｜ typecheck 0；`npm test` **38 文件/270 用例全过**；`check:contract` **8/8（3.3.0）**；`build:web` 291.27 kB / gzip 92.05 kB ｜ App.tsx/api.ts 无文本冲突但需联调（登录门 + 点不在场 NPC/重试）；尚未 push，等 owner 授权

### fix/room-auth-33

- 2026-11-18 ｜ fix/room-auth-33 ｜ `035b046` ｜ docs ｜ 收敛稿发布为 upstream PR #19 评论（issuecomment-6978497716，带 Qoder 徽章）：整合原方案+双方评审+负责人五项决定（不用 SQLite/会话持久化放 C/数据不自动删/额度量级先不设/旧 token 暂不轮换），采纳另一 Agent 全部六条收紧，明示四项残留风险与 #34 依赖 ｜ 首次 gh pr comment 返回 499 结果不确定，先回读评论列表确认未发布再重试成功，回读验证正文完整 ｜ 遗留：token 轮换与额度量级待负责人后续给定

- 2026-11-18 ｜ fix/room-auth-33 ｜ `871df40` ｜ merge ｜ merge commit 合入 upstream/main `a8c59eb`（v0.5.2，CONTRACT 3.3.0）：冲突 routes.ts（保留强制登录 preHandler + 上游 roomGate，各房间端点先 #37 存在性再 #33 授权）与 docs/03（保留上游 §10.15–10.17，本分支 auth/授权顺延 §10.18）；CONTRACT_VERSION 3.3.0 → **3.4.0**（上游已占用 3.3.0），E_UNAUTHORIZED 计为第 35 个错误码 ｜ 用户同期拍板：旧 admin token **暂不轮换**（DraftsPanel localStorage 存量暴露留待阶段 A 清理）、额度量级**先不设**（可配置占位）；#34 仍 OPEN 待 engine 审批 ｜ tsc 0 错；vitest **40 文件/287 用例全过**；check:contract 8/8（3.4.0，35/35 错误码） ｜ upstream/main 保留；本分支未推送；下一步：收敛方案提 PR #19 评论

- 2026-11-18 ｜ fix/room-auth-33 ｜ `28e01a3` ｜ docs ｜ 用户跳过小组讨论直接拍板多用户方案：①不用 SQLite，单进程单写者+单一 auth 域文件，设计中明示多用户记录冲突残留隐患（崩溃/损坏/误开多进程）；②会话持久化放阶段 C，首版接受重启重登；③数据不自动删，删除只走人工/申请，测试告知文案相应改；④额度数值待用户给量级（registry JSON 可配置占位不阻塞）；⑤旧 admin token 轮换=改 GALGAME_ADMIN_TOKEN 值使流出副本作废 ｜ 核实上游：#36/#37/#38/#39/#41/#42 已修（PR #44/#45）、#40 补文档（#43），**#34 仍 OPEN 未修**（用户原话"#34 已改"不成立，已纠正）；**上游已发布 3.3.0（v0.5.2）与本分支版本号撞车**，下次合并登录+房间授权需重编号 3.4.0 ｜ gh issue view + git fetch upstream 实证；未改业务代码；待用户决定是否现在合 upstream/main

- 2026-11-18 ｜ fix/room-auth-33 ｜ `28e01a3` ｜ review ｜ 对 upstream PR #19 内另一 Agent 的《校内 Demo 多用户管理方案》comment 提跟进评审质疑（issuecomment-6975923483，带 Qoder 徽章）：核心矛盾是注册原子性要求 vs 存储留白（建议单文件单写者+用户名幂等兜底）、阶段 A 隐含 engine 审批依赖（#34）、管理工作台成本被低估（拆 B1/B2）、草案无归属字段是隐藏契约改动、额度预留泄漏与校园 NAT 限流缺设计；另指出 DraftsPanel 存量 localStorage admin token 需阶段 A 清除 ｜ 质疑均对照代码核实（users.ts verify 只查登录时状态、map.drafts.ts 无 userId、history.list 仅升序游标）；结论「可进评审，先修订五处」 ｜ gh pr comment 成功并回读验证完整；未改业务代码；本条 MEMORY 记录未提交

- 2026-11-18 ｜ fix/room-auth-33 ｜ `28e01a3` ｜ docs ｜ 按用户明确范围新增 temp_doc/校内Demo多用户管理方案.md：校内可控试用，邀请用户名密码注册、管理员人工确认与一次性凭证恢复、玩家/管理员分离、会话/存档隔离及额度管理 ｜ 不接邮箱/短信/SSO，不采集学号证件；保留单实例，存储实现及参数待评审，不引入依赖或改契约 ｜ 纯方案文档；未运行业务测试、未改业务代码、未提交推送

- 2026-11-18 ｜ fix/room-auth-33 ｜ `28e01a3` ｜ review ｜ 前端/公开 Demo 账号设计审阅：mock fetch 复现 saves 500→空列表、logout 503 不报错、SSE 缺 commit 即 EOF 仍正常 resolve；源码发现未统一 401、换档/登出未清 view 与旧异步请求、历史只取最早 200、普通用户可见审核及全局模型设置、存档仍写本地身份旧文案 ｜ 建议公测账号分离身份/准入/角色/房间权限/额度，补邮箱验证找回、持久可撤销会话、独立管理入口；均为参考方案未定案 ｜ 仅 mock HTTP 函数实验与源码检查，未做浏览器/移动端 QA，未改业务代码、未提交远程 issue

- 2026-11-18 ｜ fix/room-auth-33 ｜ 本提交 ｜ fix ｜ upstream #33 房间授权（基于 feat/simple-auth `0c39276` 切出）：新增 `apps/server/src/room-guard.ts` 统一 gate，state/events/turns/map/travel/tick/dialogue/gallery/history 全入口校验成员资格（成员表 userId），写操作绑定 actorId=当前账号的 player 角色；旧档（无 userId）在 authRequired=1 默认 403、=0 保持旧开放度；有效 x-admin-token 为显式运维例外；history 原独立校验收敛进 gate ｜ 登录≠授权，边界放路由层不动 engine；turns 的拒绝在 SSE 头之前返回普通 HTTP；存在性校验留给 #37 不混做；docs/03 §5.2.8 补授权条目、§5.2.7 旧档口径收紧并记入 §10.15（3.3.0 未发布随本版本生效，不另 bump） ｜ typecheck 0；`npm test` **39 文件/275 用例全过**（新增 room-auth.test.ts 5 例：跨账号读/写 403 且 seq 不变、身份头/体不可覆盖、A 正常 commit、旧档+管理员例外、开发模式兼容）；check:contract 8/8（3.3.0） ｜ 3 个旧测试补成员身份头（user/turn-history/room-id）；`/state` 视角裁切仍是 #3 余项；#34–#39 未动（多数涉 engine 闭盒待批）；PR 按用户要求暂缓（依赖 #19，upstream 只有 main），分支未推送

### feat/demo-multiuser

- 2026-11-18 ｜ feat/demo-multiuser ｜ 4e43d7b ｜ feat ｜ 综合 upstream PR #19 全部评论落地收敛稿 B1 服务端 + ddyyxx-jpg 四项 P1 之 P1-1/3/4：单一 auth 域 `auth.json`（users/invites/resets/settings，串行副本写、损坏 fail-fast 保留故障文件、旧 users.json v1 迁移）；会话每请求校**当前**账号状态 + 暂停/改密吊销会话；登录/注册/重置限流（IP + 账号渐进延迟封顶 2s）；CSRF（authRequired=1 时 Cookie 写校 Origin=GALGAME_PUBLIC_ORIGIN，admin-token/无会话豁免）；公开 `auth/status`；一次性邀请原子注册（账号创建+邀请扣减同一串行写）；13 个管理端点（x-admin-token 或 admin 会话，写操作记审计日志不含密码/token）；重置凭证 + `scripts/admin-init.ts`；额度状态机 reserved→running→committed/failed/unconfirmed（clientTurnId 幂等、与历史提交事实对账、总开关、预留过期不自动释放）+ turns 拒绝在 SSE 头之前 + 行动核对端点；P1-1 settings 改 admin-token/管理员会话（反代下本机 IP 口径失效）、P1-3 修 `JSON.parse` 抛裸 SyntaxError 未包装成 AuthStoreCorruptError、P1-4 `GALGAME_TRUST_PROXY` ｜ 不动 engine/canon/shared 契约语义；额度量级 null=不限、旧 admin token 暂不轮换（负责人决定）；不引入依赖；docs/03 §5.2.8–5.2.10/§10.18 已同步 ｜ typecheck 0；新增 quota/admin/auth-store/users/rate-limit/quota-routes 测试；check:contract 8/8（3.4.0，35/35 错误码） ｜ 残留：会话内存重启重登（阶段 C）；#34 未交付→额度人工对账兜底；单进程单写者多用户记录冲突隐患明示；admin-log list 先 flush 写链保证 read-after-write

- 2026-11-18 ｜ feat/demo-multiuser ｜ 4e43d7b ｜ feat ｜ 阶段 A 前端可靠性 + 顺手建议项：`HttpError` 统一 401/403/429/5xx/网络分类、退出先确认且服务端确认才清本地、身份+房间 `RequestScope`（AbortController 作废旧在途流，回调 isCurrent 核对）、SSE 无 commit/error 的 EOF→「结果未确认」+重试先 `fetchTurnStatus` 核对（committed 不重发）、存档 loading/empty/error/forbidden 区分、历史默认最近段+「加载更早」（before 游标）、移除玩家侧管理/模型入口与 localStorage admin token（删 `api-settings.ts`）、AUTH_REQUIRED=0 访客入口（服务不可达默认不放开）；建议7 nginx register/reset `limit_req`、8 会话清扫 setInterval unref、9 scrypt N/r/p 上界防 OOM、11 公开 health 脱敏（canonize enabled/judge 移鉴权后 admin/stats，docs/03 §5.2/§10.18 同步）、12 旧 localStorage 不自动迁移说明、P1-2 本地邀请/访客文档（README/.env.example/deploy/README §7） ｜ 抽 6 个 helper（sse/request-scope/history-lines/turn-handlers/use-auth/use-saves）+ 5 个纯函数测试（断言结构/码非文案）；访客 id 存 localStorage 仅开发态记忆档案键、非凭据（强制登录服务端忽略该头） ｜ `npm test` **51 文件/362 用例全过**；`build:web` 293.23 kB / gzip 93.45 kB；typecheck 0；check:contract 8/8（3.4.0） ｜ 残留：App.tsx 708 行 / ChatPanel 373 / TitleScreen 322 超 300 行规约（已抽 helper，整体游戏屏拆分后置）；分支未推送，等 owner 授权

- 2026-11-18 ｜ feat/demo-multiuser ｜ `b0535d9` ｜ review ｜ upstream PR #19 复审打回：额度账本须按账号/房间/角色隔离（`quota.ts:94`），重启须恢复中断请求且可等待写盘（`quota.ts:51/120`）；旧账号迁移须严格校验（`auth-store.ts:143`），签发会话及改密前须复核当前密码版本（`auth-store.ts:198/237`） ｜ 草案接口仍向玩家开放（`routes.ts:516`）；未确认回合核对后仍会发出服务端明确拒绝的重试（`App.tsx:465`）。PR 正文的 #34 状态已落后，本地 upstream/main `cda0823` 含 #50；引擎去重缓存仍为内存态 ｜ typecheck、Web 构建通过，`node --import tsx scripts/check-contract.ts` 8/8；全量首跑 361/362（额度重载测试固定等待 50ms），复跑 362/362；与 `cda0823` 临时合并无冲突，类型检查与 366/366 通过 ｜ 仅本地审阅与记录

- 2026-11-18 ｜ feat/demo-multiuser ｜ `424b01f` ｜ fix ｜ 修 PR #19 复审 4 P1 + 2 P2：① 额度幂等键改为 `userId+roomId+clientTurnId`，actorId 落库并在复用 ID 换角色时报 `E_PRECONDITION`；② 重启恢复：遗留 running→unconfirmed、reserved→failed 释放额度，新增 `flush()` 等写链落定；③ 旧 users.json 迁移改为「读/解析/users 非数组/任一条非法」整体抛 `AuthStoreCorruptError` 且不写 auth.json；④ `verify` 在 scrypt 返回后复核 state+passwordHash，`changePassword` 在 mutate 内复核旧 hash → `E_PRECONDITION`；⑤ 草案创建/详情服务端 `adminOnly`（admin-token 或 admin 会话）；⑥ 前端核对到 `unconfirmed` 不再用原 ID 重发 ｜ 键不含 actorId 因核对端点拿不到角色，改存 actorId 做一致性校验；reserved 必然尚未开跑（running 同步先于 SSE 头），故可安全释放；不做契约语义变更，docs/03 §5.2.1/§5.2.9/§5.2.10 同步，CONTRACT_VERSION 仍 3.4.0 ｜ typecheck 0；`npm test` **51 文件/371 用例全过**（新增迁移 fail-fast 2、凭据复核 3、作用域隔离/重启恢复/换角色、草案授权边界 1）；check:contract 8/8（3.4.0，35/35 码）；build:web 293.36 kB / gzip 93.48 kB ｜ 残留：本地提交未推送；#34 未交付，unconfirmed 仍需管理员对账

- 2026-11-18 ｜ feat/demo-multiuser ｜ `d5484f7` ｜ docs ｜ 已推送 origin feat/simple-auth（ff `b0535d9..d5484f7`，未 force）并更新 PR #19 正文 + 第二轮复审逐条回应（issuecomment-6980811621） ｜ 上一条「本地提交未推送」自此失效；PR head 已指向 d5484f7，主体仍为 draft=false / OPEN ｜ 推送与 gh 回读成功（headRefOid=d5484f7）；本条仅记忆更新，未改代码

- 2026-11-18 ｜ feat/demo-multiuser ｜ `bd0ebfe` ｜ review ｜ PR #19 复审仍打回：历史对账仅比较 clientTurnId（`routes.ts:430`），应与账本账号/房间/角色归属一致；开跑前未确认 running 落盘（`routes.ts:371`），异步写失败也会被 flush 吞掉（`quota.ts:191`）；旧库迁移未对最终 v2 文档做 schema 校验（`auth-store.ts:178`） ｜ 已核实凭据复核、草案创建及详情授权、unconfirmed 前端等待；临时目录实证无效旧字段被迁移后下次启动失败、账本写失败时 flush 仍返回 ｜ 全量 371/371，类型检查、契约 8/8、Web 构建通过；与本地 upstream/main `cda0823` 临时合并无冲突、375/375 ｜ 未改业务代码或发布 GitHub 审查

- 2026-11-18 ｜ feat/demo-multiuser ｜ `0c9641d` ｜ fix ｜ 第三轮复审 3 P1：① 核对端点与历史对账改为按 `userId+actorId+clientTurnId` 匹配（同房间跨账号同 ID 不再认错回合，缺 userId 的旧行不自动对账）；② 新增 `TurnLedger.transitionDurable`，`running` 确认落盘后才开跑，写失败 → 503 `E_STORE_FAULT` 且内存置 failed（此前只排队写，中断时磁盘仅 reserved 会被重启误判失败并放行重试）；③ 旧 users.json 迁移写盘前用正式 v2 `FileSchema` 整体校验（nickname 为数字等首次启动即中止，不生成下次启动读不了的文件） ｜ 保留 `flush()` 尽力而为语义（账本是可重建投影），关键状态由 transitionDurable 判定；不做契约语义变更，docs/03 §5.2.10/§10.18 同步，CONTRACT_VERSION 仍 3.4.0 ｜ typecheck 0；`npm test` **51 文件/375 用例全过**（新增 durable 写失败、对账防串、迁移 v2 校验、503 接线）；check:contract 8/8（3.4.0）；build:web 293.36 kB / gzip 93.48 kB ｜ 残留：#34 上游已修进程内幂等、跨重启恢复仍待上游；本地提交未推送

- 2026-11-18 ｜ feat/demo-multiuser ｜ `db3c81a` ｜ docs ｜ 已推送 origin feat/simple-auth（ff `bd0ebfe..db3c81a`）并更新 PR #19 正文（第三轮小节、375 用例、#34→#50 表述）+ 第三轮逐条回应（issuecomment-6981048494） ｜ 上一条「本地提交未推送」自此失效 ｜ 推送与 gh 回读成功（headRefOid=db3c81a）；本条仅记忆更新

- 2026-11-18 ｜ feat/demo-multiuser ｜ `831be6a` ｜ review ｜ 核实上轮三项已修：历史按账号和角色核对、running 等写入成功才执行且失败返回 503、旧库迁移先过 v2 schema；PR 正文已更新 #50 ｜ 仍建议合并前修 `quota.ts:71`：账本读失败被当空库，临时文件实证 EACCES 后重新接纳已提交 ID；`quota.ts:189` 人工结案可覆盖 running/committed，实证 running→failed 后同账号下一行动可预留，宜限制状态转换 ｜ 全量 375/375、类型检查、契约 8/8、Web 构建通过；与本地 upstream/main `cda0823` 临时合并无冲突，类型检查与 379/379 通过 ｜ 仅本地复审，未改业务代码或发布 GitHub 评论

- 2026-11-18 ｜ feat/demo-multiuser ｜ `5ea36f4` ｜ fix ｜ 第四轮复审 1 P1 + 1 P2：① `TurnLedger.load` 只把 ENOENT 当新账本，其它读取失败抛 `LedgerUnreadableError` 拒绝启动（此前静默空账本会丢提交记录、重新接受已用逻辑 ID）；② 管理员 `resolve` 仅允许 `unconfirmed`，`running`/`committed` → 409 `E_ILLEGAL_OP`（不再能覆盖执行中/已提交记录） ｜ 结案返回 `ResolveResult` 联合类型以区分「不存在/状态不符」；docs/03 §5.2.9/§5.2.10/§10.18 同步，契约仍 3.4.0 ｜ typecheck 0；`npm test` **51 文件/377 用例全过**（新增账本不可读、resolve 状态守卫）；check:contract 8/8；build:web 293.36 kB / gzip 93.48 kB ｜ 残留：#34 跨重启恢复待上游；本地提交未推送

- 2026-11-18 ｜ feat/demo-multiuser ｜ `7c3f8db` ｜ docs ｜ 已推送 origin feat/simple-auth（ff `831be6a..7c3f8db`）并更新 PR #19 正文（第四轮小节、377 用例）+ 第四轮逐条回应（issuecomment-6981304453，含 Qoder 徽章）；此前 3 条回应评论已补徽章 ｜ 用户约定：Qoder 评论统一带 `powered_by-Qoder` 徽章 ｜ 推送与 gh 回读成功（headRefOid=7c3f8db）

- 2026-11-18 ｜ feat/demo-multiuser ｜ `f99b043` ｜ review ｜ 上轮两项已修：账本非 ENOENT 读取失败拒绝启动，管理员仅可结案 unconfirmed ｜ 仍不可合并：GitHub 返回 mergeable=false，本地与 upstream/main `2748be8` 模拟合并冲突 8 个文件，上游契约已是 3.4.1；另有半截尾行恢复缺口（`quota.ts:93`），临时账本实证恢复后首次人工结案显示 committed、再重启回到 unconfirmed ｜ 全量 377/377，类型检查、契约 8/8、Web 构建通过；合并版因冲突未跑 ｜ 仅本地复审，未修改业务代码或发布 GitHub 评论

- 2026-11-18 ｜ feat/demo-multiuser ｜ merge commit ｜ merge ｜ 合入 upstream/main `2748be8`（3.4.1），契约顺延 **3.5.0**：8 个冲突文件——`routes.ts` 保留额度状态机/核对端点并接上游 targetNpcId 实名化+收齐后脱敏+姓名解锁；`/state` 先过 guardRoom 再脱敏；`resume.routes.ts`/`view.routes.ts` 同时保留成员 gate 与占位名；`bootstrap.ts` 保留 publicOrigin 与 learnNpcNames；`api.ts`/`App.tsx` 保留 scope/abort/信号与存档 hook，runTurn 增第 7 参 targetNpcId、refreshState 增 stateRev；docs/03 上游 §10.18/§10.19 原样保留，本分支 auth/admin/quota 重编号为 §10.20 3.4.1→3.5.0，正文 3.4.0 标签同步改 3.5.0 ｜ 版本顺延而非复用 3.4.0：上游已对外发布 3.4.1，本分支只增端点/错误码，按 minor 记；history 脱敏按当前认识状态重做，避免刷新/续玩泄露真名 ｜ typecheck 0；`npm test` **60 文件/418 用例全过**；check:contract 8/8（3.5.0，35/35 码）；build:web 293.44 kB / gzip 93.58 kB ｜ 遗留：`quota.ts:93` 半截尾行恢复缺口未修（review 已记录，待用户决定）；本地合并提交未推送

- 2026-11-18 ｜ feat/demo-multiuser ｜ `faad626` ｜ docs ｜ 已推送 origin feat/simple-auth（ff `f99b043..cf77479`）；PR #19 标题改为「简易用户系统 + 房间授权/行动额度（CONTRACT 3.5.0）」，正文补合并章节/418 用例/3.5.0 契约并回读 MERGEABLE；发布合并说明评论（issuecomment-6981800374，含 Qoder 徽章） ｜ 推送与 PR 更新获用户明确授权 ｜ headRefOid=cf77479、mergeable=MERGEABLE ｜ 本条回填 sha 后推送

- 2026-11-18 ｜ feat/demo-multiuser ｜ `db969c9` ｜ fix ｜ 按 ddyyxx-jpg 打回意见（review 2026-11-18 14:49）修 4 项 P1 + 文档：① `admin-token.ts` 统一 sha256+`timingSafeEqual`；显式 `GALGAME_ADMIN_TOKEN` <16 字符或 <96 bit 拒绝启动；带令牌的失败按 IP 10 次/60s → 429 `E_RATE_LIMITED`+`Retry-After`，routes/room-guard/admin/canonize/stats 共用同一 gate，单请求 verdict 缓存防重复计数；② CSRF hook 移到 auth 路由注册之前，`/api/v1/auth/*` 写（register/login/logout/password/reset）也校 `Origin=GALGAME_PUBLIC_ORIGIN`；③ 账本 `append` 改 `open`+`writeFile`+`fsync`（`transitionDurable` 崩溃不丢最后一条），坏行跳过计数 + 启动 `[quota]` 告警，`/admin/quota` 增 `skippedLines`；④ `guardRoom`/`gallery`/`history` 的 snapshot 异常改 503 `E_STORE_FAULT` 不再报 404；deploy/README 补部署约束（会话内存重启重登/单进程单写者/额度 null=不限/token 不自动轮换/PUBLIC_ORIGIN/TRUST_PROXY），docs/03 §5.2.8/§5.2.9/§5.2.10/§10.20 同步 ｜ 拒绝把 `running` 等任意 snapshot 异常折叠为"房间不存在"（客户端会误清房间指针）；auth 写也做 Origin 校验以堵 login CSRF；令牌强度只在显式配置时强制（未配置仍旧每进程随机） ｜ typecheck 0；`npm test` **61 文件/429 用例全过**；`check:contract` 8/8（3.5.0，35/35 码）；`build:web` 293.44 kB / gzip 93.58 kB ｜ 未修：`App.tsx` 708 行拆分（超 300 行规约，建议单独 PR）；PR #19 已于 2026-11-18 14:42 被合并为 `8784b3b`，按打回意见需回滚该 merge 后重提 PR（属共享主线操作，待负责人授权）；本地提交未推送

- 2026-11-18 ｜ feat/demo-multiuser ｜ `cbf84f1` / merge `35e0c57` ｜ merge ｜ 按 ddyyxx-jpg 打回意见回滚未授权合并 `8784b3b`：从 upstream/main 建 `revert/pr19-merge`，`git revert -m 1` 生成 `cbf84f1`，PR #71 经用户授权后 merged（`35e0c57`，15:07Z）；main 恢复 CONTRACT 3.4.1 ｜ 复审要求「未经审阅的合并须先回滚再重提」，回滚保持 main 可发布状态；不动分支历史，修复版从新 main 重提 ｜ typecheck 0；`npm test` 49 文件/332 用例；check:contract 8/8（3.4.1） ｜ 修复版重提见下条

- 2026-11-18 ｜ feat/demo-multiuser ｜ `3dfcf43` → `13d85f9` ｜ merge ｜ 修复版重提：先合 upstream 回滚前 tip `3e13f3c`（2 条地图修复）得 `3dfcf43`，再合回滚后的 upstream/main（`35e0c57`）解冲突得 `13d85f9`——恢复 `3dfcf43` 的完整树（避免回滚的删除静默抹掉本分支文件），并 `git rm` 被回滚复活的 `apps/web/src/api-settings.ts`；建 PR #72，正文含 4 项 P1 修法/部署约束/验证输出/Qoder 徽章；PR #19 发布逐条回应（issuecomment-6982566446，含徽章） ｜ 回滚后的 main 与本分支 merge-base 在 `1e537ac`，直接解冲突会把上游删除应用到未改文件上，故以树为准；契约仍 3.5.0（只增端点/错误码） ｜ typecheck 0；`npm test` **63 文件/441 用例全过**；check:contract 8/8（3.5.0，35/35 码）；`build:web` 293.69 kB / gzip 93.64 kB；PR #72 回读 MERGEABLE/CLEAN（head `13d85f9`） ｜ 待上游复审；`App.tsx` 拆分仍后置（单独 PR）

- 2026-11-18 ｜ feat/demo-multiuser ｜ `13d85f9` ｜ review ｜ PR #72 建议打回：提交后姓名解锁失败会把已提交回合改为 failed（`routes.ts:525`）；半截账本尾行会吞掉下一条追加记录（`quota.ts:255`）；个人 null 额度被当成沿用默认值（`routes.ts:412`）；登录门和管理路由仍重复计算同次令牌失败（`admin.routes.ts:46`） ｜ 临时账本复验人工结案重启后退回 unconfirmed；本地注入验证历史已提交但 SSE 报错且账本为 failed，以及个人 null 遇全局 0 返回 429 ｜ typecheck 通过；63 文件/441 用例通过；契约 8/8（通过 Node 加载 tsx 执行）；Web 构建通过 ｜ 修复后补回归用例；结论仅记录在本地

- 2026-11-18 ｜ feat/demo-multiuser ｜ `974ab7d` ｜ fix ｜ 按 PR #72 复审修复 6 项：① `routes.ts` 收到 `turn.commit` 后姓名解锁/脱敏快照异常只告警，账本保持 committed，兜底异常不再送 retryable；② `quota.ts` 每次 append 前先写换行，加载/短写留下的半截尾行都不会吞掉下一条记录；③ 新增 `dailyLimitFor`（auth-store）统一解析，个人显式 `null`=不限、显式 `0` 覆盖全局 `null`，回合入口与管理列表共用；④ `admin.routes` 复用主路由请求级 verdict 缓存，同一请求只计一次令牌失败；⑤ `room-guard` 也复用该缓存，CSRF 钩子与房间写入口不再重复计数；⑥ 补 6 个回归用例，docs/03 §5.2.9/§5.2.10 同步 ｜ 提交态与响应生成解耦（已提交不可回退）；每条记录前先写换行，不删除运维可见的坏行计数；额度解析按"键存在"而非 `??`；令牌计数按请求而非按入口 ｜ typecheck 0；`npm test` **63 文件/447 用例全过**；check:contract 8/8（3.5.0，35/35 码）；build:web 293.69 kB / gzip 93.89 kB；PR #72 head `974ab7d` MERGEABLE/CLEAN ｜ 已推送 origin；MEMORY 本条按要求不提交；`App.tsx` 拆分仍后置（单独 PR）

- 2026-11-18 ｜ feat/demo-multiuser ｜ `dbfcd9c` ｜ review ｜ 本地复审仍建议暂缓合并；远端 PR #72 复核时仍为 `13d85f9` ｜ 上轮四个回归用例通过；P1 `quota.ts:261` 在进程内短写后未隔离尾行，临时账本模拟 reserved 部分写入后抛错，紧接着 running 确认写盘但下次加载无该条目；P2 `room-guard.ts:58` 房间写入口仍绕过 CSRF 钩子共用的令牌判定缓存 ｜ typecheck、63 文件/445 用例、契约 8/8（Node 加载 tsx）、Web 构建通过 ｜ 修复写失败后的尾行恢复，房间守卫复用令牌判定

- 2026-11-18 ｜ feat/demo-multiuser ｜ `974ab7d` ｜ review ｜ PR #72 最终复审通过，远端 head 与本地一致、与 base `35e0c57` 合并无冲突 ｜ 前两轮六个回归场景均通过；额外注入半行写入后抛错，后续 running 经 fsync 后重载为 unconfirmed，坏行单独计数；room-guard 与 CSRF 共用一次判定 ｜ typecheck、63 文件/447 用例、契约 8/8（Node 加载 tsx）、Web 构建通过 ｜ 非阻断：room-guard 的 429 仍缺契约承诺的 Retry-After（`room-guard.ts:63`）

- 2026-11-18 ｜ feat/demo-multiuser ｜ `974ab7d` ｜ review ｜ PR #72 独立复审改判为暂缓合并 ｜ P1 全局暂停仅拦 /turns，地图 tick 仍可推进时段，travel 仍结算回合且未记额度（`routes.ts:643-655`）；P2 关闭注册后在途请求可按哈希前旧设置创建账号（`auth-store.ts:238`）；P2 人工结案持久化失败仍报告成功，重载回到待核对（`quota.ts:230`） ｜ 主审用本地实际路由复现地图行为；子 Agent 用临时存储复现后两项 ｜ 统一暂停入口、在注册事务内检查最新开关、人工结案确认落盘后再成功返回

- 2026-11-18 ｜ feat/demo-multiuser ｜ `39fc9b8` ｜ fix ｜ 按 PR #72 第三轮复审修复 3 项：① `actionsEnabled=false` 时地图 `travel`/`tick`/`dialogue` 与回合入口一样 429，暂停期间不推进时段/不写历史；② 账号创建事务内复核最新 `doc.settings.registrationOpen`，哈希期间关闭注册不会再用旧开关建号；③ 人工结案先 `append` 落盘再更新内存，写失败 503 `E_STORE_FAULT` 且保持 `unconfirmed` 可重试；补 4 个回归用例，docs/03 §5.2.8/§5.2.10 同步 ｜ 地图写入口不能绕过全局暂停；注册开关以串行事务内最新状态为准；结案确认必须在持久化之后 ｜ typecheck 0；`npm test` **63 文件/451 用例全过**；check:contract 8/8（3.5.0，35/35 码）；build:web 293.69 kB / gzip 93.89 kB；PR #72 head `39fc9b8` MERGEABLE/CLEAN ｜ 已推送 origin；MEMORY 本条按要求不提交

- 2026-11-19 ｜ feat/demo-multiuser ｜ `39fc9b8` ｜ review ｜ PR #72 暂缓合并：上一轮三项回归通过，但人工结案新增并发竞态（`quota.ts:221`） ｜ 临时账本并发提交 committed / failed，两个调用都返回成功，重载为 failed 且接受同一逻辑 ID 重试；须串行化同一条目的状态检查、落盘、发布，并覆盖历史自动对账 ｜ typecheck、63 文件/451 用例、契约 8/8（Node 加载 tsx）、Web 构建通过；模拟合并无冲突 ｜ 非阻断的 Retry-After 缺头仍可见

- 2026-11-18 ｜ feat/demo-multiuser ｜ `63b7f63` ｜ fix ｜ 按 PR #72 第四轮复审修复并发结案：`resolve` 的状态检查/落盘/内存更新放入同一串行队列，并发结案仅首个成功、其余 409 `E_ILLEGAL_OP`；新增 `reconcileCommitted` 让人工结案与历史自动对账共用状态规则（committed 幂等、failed 不被覆盖）；补并发单元/端点与对账规则 3 个回归用例，docs/03 §5.2.10 同步 ｜ 结案决策必须整体串行，append 队列只保证写入顺序不能保证读-判-写一致 ｜ typecheck 0；`npm test` **63 文件/454 用例全过**；check:contract 8/8（3.5.0，35/35 码）；build:web 293.69 kB / gzip 93.89 kB；PR #72 head `63b7f63` MERGEABLE/CLEAN ｜ 已推送 origin；MEMORY 本条按要求不提交

- 2026-11-19 ｜ feat/demo-multiuser ｜ `63b7f63` ｜ review ｜ PR #72 并发结案修复复审通过；远端与本地一致，模拟合并无冲突 ｜ 两个并发人工结案只有一个 200，另一请求为 409；临时账本双顺序验证人工结案和历史自动对账共用队列，重载结果与首个落盘结论一致，已提交后不接受同一逻辑 ID 重试 ｜ typecheck、63 文件/454 用例、契约 8/8（Node 加载 tsx）、Web 构建通过 ｜ 已知非阻断：房间守卫 429 缺 Retry-After

- 2026-11-19 ｜ feat/demo-multiuser ｜ `63b7f63` ｜ review ｜ PR #72 第二次独立复审：并发人工结案的 P1 已修，另发现两个 P2 ｜ 自动对账忽略落盘失败（`routes.ts:578`），本地 HTTP 注入及临时账本均验证有提交历史时仍返回 200/unconfirmed；断流核对到 committed 只刷新状态、不补历史叙事（`App.tsx:458`，代码路径确认） ｜ 子 Agent 聚焦 7 文件/76 用例、typecheck、契约 8/8 通过；主审另行复现对账故障 ｜ 可复用人工结案的 503 处理，回合确认后按提交游标补齐对话

- 2026-11-19 ｜ feat/demo-multiuser ｜ `63b7f63` ｜ review ｜ 独立复审补充 P2：历史在同房间按裸 turnId 去重（`turn-history.ts:149`），与引擎按房间/角色/clientTurnId 执行的作用域不一致 ｜ 子 Agent 临时历史验证两个角色使用同一 clientTurnId 时只保留首条，第二条无法续玩或用于重启对账 ｜ 建议历史去重与回合执行同作用域，补双角色同 ID 测试

- 2026-11-18 ｜ feat/demo-multiuser ｜ `cc6ca48` ｜ fix ｜ 按 PR #72 第五轮复审修复 3 项 P2：① 历史去重改为房间内 `actorId+turnId`，与引擎幂等作用域一致，同房不同角色同 ID 两条历史都保留；② 历史自动对账 `E_STORE_FAULT` 映射 503，不再返回 200 unconfirmed；③ 前端核对到 committed 后按 `committedSeq` 拉历史，只补断流前未收到的叙事/facts；补 5 个回归用例，docs/03 §5.2.9/§5.2.10 同步 ｜ 历史去重必须与引擎同一作用域；对账写失败要可区分；断流补齐要按已收前缀做差集 ｜ typecheck 0；`npm test` **63 文件/459 用例全过**；check:contract 8/8（3.5.0，35/35 码）；build:web 294.89 kB / gzip 94.34 kB ｜ 本地提交未推送；待独立子 Agent 全量审查；MEMORY 本条按要求不提交

- 2026-11-19 ｜ feat/demo-multiuser ｜ `2e1b86e` / `84f2704` ｜ review ｜ 独立子 Agent 全量审查 `35e0c57...HEAD`：无 P0/P1，有条件通过；合并前建议修 P2-1 `/me` 未过房间授权、P2-2 存储故障 200/500 且回显路径、P2-3 历史半截尾行；P2-4 `reserve` 只认 running、P2-5 token-only 房间入口、P2-6 登录文案、P2-7 玩家草案入口、P2-8 admin-init 裸提权、P2-9 404 重发、P2-10 MapPanel scope、P2-11 Retry-After 列为后置 ｜ 本分支只读审查，未改文件；按审查修复 P2-1/2/3/5/6/8/11 与两条审查回归（safe 存储故障/保留 Fastify 4xx），并补 8 个回归用例 ｜ typecheck 0；`npm test` **63 文件/467 用例全过**；check:contract 8/8（3.5.0，35/35 码）；build:web 295.03 kB / gzip 94.37 kB；本地 head `84f2704` ｜ 已推送 origin（PR #72 head `84f2704`，MERGEABLE/CLEAN），PR 描述/评论已更新；P2-4/7/9/10 后置；MEMORY 本条不提交

- 2026-11-19 ｜ feat/demo-multiuser ｜ `84f2704` ｜ review ｜ 复审 PR #72：历史按角色去重及自动对账写盘失败返回 503 已通过回归；断流恢复仍建议修复后合并 ｜ P2 `App.tsx:489` 仅按 committedSeq 取首行，实际路由复现 3 个 turnId 均 seq=49、恢复第三条却返回第一条；P2 `turn-history.ts:94` 吞非 ENOENT 读取失败，实际将临时历史文件替换为目录后 GET history 仍 200 空列表 ｜ typecheck、63 文件/467 用例、契约 8/8（Node 加载 tsx）、Web 构建通过，模拟合并无冲突 ｜ 恢复应按回合标识与角色精确取历史；仅缺文件作为空历史，其余 I/O 故障返回 503

- 2026-11-19 ｜ feat/demo-multiuser ｜ 本地未提交 ｜ fix ｜ 修复 PR #72 最新复审两项 P2：断流恢复按 `turnId + actorId` 精确查询历史，避免共享提交序号时取错回合；历史读取仅 ENOENT 为空，其他故障在历史和对账端点返回脱敏的 503 `E_STORE_FAULT` ｜ docs/03 §5.2.7/§5.2.10、docs/09 同步；可选查询参数并入本 PR 尚未发布的 3.5.0 ｜ typecheck、63 文件/471 用例、契约 8/8（Node 加载 tsx）、Web 构建及 diff 检查通过 ｜ 本地修改未推送

- 2026-11-19 ｜ feat/demo-multiuser ｜ 本地未提交 ｜ review ｜ 独立审查两项本地修复，建议补齐人工结案路径 ｜ P2 `App.tsx:487` 只在状态含 turnId 时补叙事；临时账本实测重启后管理员按 committedSeq 人工结案，状态无 turnId 但历史有该回合；应从已匹配的账号/角色/逻辑 ID 获取精确身份 ｜ 子 Agent 的 35 项聚焦用例、typecheck、契约 8/8、git diff --check 通过，主审独立复现人工结案场景 ｜ 业务补丁保持未提交

- 2026-11-19 ｜ feat/demo-multiuser ｜ 本地未提交 ｜ fix ｜ 人工结案已提交但缺 turnId 时，从同账号/角色/clientTurnId 的历史补齐行动核对响应；精确历史查询保留调用方提供的标识并继续脱敏叙事 ｜ 补人工结案与历史标识脱敏两项路由回归；docs/03 §5.2.7/§5.2.10 同步 ｜ typecheck、63 文件/473 用例、契约 8/8（Node 加载 tsx）、Web 构建、diff 检查通过 ｜ 未提交或推送，继续全量独立审查

- 2026-11-19 ｜ feat/demo-multiuser ｜ `84f2704` + 本地补丁 ｜ review ｜ 从 `35e0c57` 全量独立审查：本地人工结案与精确历史修复通过，无新增 P0/P1；建议先修两个 P2 ｜ `turn-history.ts:124` 分页只用 seq，临时历史 201 条同 seq 实测少一条且 hasEarlier=false；`App.tsx:234` 续玩首屏吞掉历史 503 后展示序章；P3 `README.md:64` 本地强制登录缺 Origin 配置，实测未配置注册 403 ｜ 子 Agent 7 文件/76 项定向测试通过，主审另复现分页与本地注册配置路径；未跑浏览器、容器与真实反代 ｜ 审查包含本地未提交改动

- 2026-11-19 ｜ feat/demo-multiuser ｜ 本提交 ｜ fix ｜ 修复 PR #72 全量复审项：历史按页首记录游标翻页，旧数字游标仍支持；续玩遇历史故障保留标题页与重试；README 补本地强制登录的 Origin ｜ 连同同序号精确恢复、人工结案补回合标识和历史读取 503 一并交付；docs/03 §5.2.7/§5.2.10、docs/09 同步，仍属未发布的 3.5.0 ｜ typecheck、63 文件/475 用例、契约 8/8（Node 加载 tsx）、Web 构建、diff 检查通过；浏览器验证首次 503 留标题页、重试恢复历史 ｜ 目标为 PR #72 的源分支

- 2026-11-19 ｜ feat/demo-multiuser ｜ 本提交 ｜ docs ｜ 按 PR #72 合并前审查（`40c9a22`）修 4 项 P1：管理员在 Compose 一次性容器中初始化并补冒烟；明确本地模型设置鉴权；登记并备份 `data/auth/`；§8 补三个配置键 ｜ 对齐开发态额度说明，沿用 3.5.0 ｜ typecheck、63 文件/475 用例、契约 8/8（Node 加载 tsx）、Web 构建通过；Compose 配置校验和临时目录管理员登录冒烟通过 ｜ 未运行真实部署容器

- 2026-11-19 ｜ feat/demo-multiuser ｜ `0a890e1` ｜ review ｜ PR #72 独立全量审查：建议先修访客存档与审计问题 ｜ P2 `use-auth.ts:115` 退出删除持久访客 ID，重新进入后存档 1→0、旧房间 403；P2 `admin-log.ts:37` 审计读写故障静默，实测管理变更 200 但日志空，半截尾行也会吞下一条；部署文档通用 IP 占位与模板固定 IP 不一致（`deploy/README.md:88`） ｜ 两方运行 63 文件/475 用例、typecheck、契约 8/8（Node 加载 tsx）、diff 检查通过，主审 Web 构建通过；未运行实际部署容器 ｜ 上轮四项必修文档在本提交齐备

- 2026-11-19 ｜ feat/demo-multiuser ｜ 本地未提交 ｜ fix ｜ 修复 `0a890e1` 独立复审三项 P2：访客退出仅禁止自动进入并保留存档 ID；管理写入已生效但审计失败时返回 `auditWarning`，读故障 503，前置换行隔离短写残留；Nginx 模板改用部署 IP 并在手册创建证书目录 ｜ docs/03 §5.2.9 补可选响应字段，沿用未发布的 3.5.0 ｜ 64 文件/478 用例、typecheck、契约 8/8（Node 加载 tsx）、Web 构建、diff 检查通过；部署 Bash 语法及替代 IP 渲染通过 ｜ 未运行实际 Nginx，未提交或推送

### fix/scene-isolation-web（issue #21-1 + #21-3，已 squash 合并 `cad0cf1`）

- 2026-11-18 ｜ `fix/scene-isolation-web` ｜ `64f87b6` → squash `cad0cf1` ｜ merge ｜ PR #22 squash 合入 main（无需 rebase）；合并后 34 文件/237 用例 ｜ 首轮通过（2 nit），Codex P2（换场景后重试仍向旧 NPC 说话）修复后复核通过 ｜ tsc 0；8 项契约（3.2.0）；build 287.05 kB / gzip 90.90 kB ｜ 失败回合已流出叙事不回滚；无组件级测试
- 2026-11-18 ｜ `fix/scene-isolation-web` ｜ `48d91d6` ｜ fix ｜ 点不在场 NPC 不再建立对话对象，改为「TA 不在这里（在「XX」）」+「前往 TA 所在地」（复用 `/map/travel`，到达后自动选中）；新增 `npc-presence.ts` 纯函数判定与测试；`turn.error/retryable` 透传，可重试时对话区给「重试」按钮，用新 `clientTurnId` 重发上次输入、不自动重试；docs/06 §7/§8 同步 ｜ 只在当前场景开聊才能保证「在场」语义；travel 成功要等 `view.position.locId` 到位再选中，避免被换场景清理 effect 覆盖；重试判定以服务端 `retryable` 为准、事件缺字段才回退契约 `RETRYABLE`，不自己维护错误码名单 ｜ tsc 0；34 文件 / 228 用例（新增 web 2 文件 13 例）；check:contract 8 项（3.2.0，未 bump）；build:web 286.13 kB / gzip 90.58 kB ｜ 与 PR #19（登录门/2D 地图）交互：本改动只在 ChatPanel/App 对话流与地图点击回调上，不改 MapView/路由；若 #19 改带 actorId 的 travel 调用签名需同步 `enterScene` 返回值 ｜ 未做：失败回合已流出的部分叙事不回滚（重试会追加新叙事）
- 2026-11-18 ｜ `fix/scene-isolation-web` ｜ `6af5bd2` ｜ fix ｜ PR #22 评审 P2：换场景后重试仍向旧 NPC 发「对X说：…」。① `view.position.locId` 变化即清 `lastTurn`（`shouldDropRetryOnMove`），重试按钮可见时收掉并提示失效；② `retry` 提交前用当前 WorldState 复核目标在场（`targetStillInScene`：`scene.presentIds` 或 `located_in` 指向脚下），不在则禁用不请求 ｜ 只清旧重试、不动正常对话；复核与 `planNpcTalk` 共用同一套在场定义，避免两处口径漂移；首次拿到位置（prev 空）不算移动 ｜ tsc 0；34 文件 / 237 用例（web 22 例，新增 9）；check:contract 8/8；build:web 未回归 ｜ 未做：失败回合已流出的部分叙事不回滚（重试追加新叙事）

### ffeat/npc-stranger

- 2026-11-18 ｜ `feat/npc-stranger` ｜ 父 `cda0823`（待推） ｜ feat ｜ 陌生人与认识机制：新增 registry 属性 `npc.knows_name`（boolean，默认 false，一级口径＝知道名字才算认识）；`/map` 的 `npcs[].name`、`dialogue.npc.name`、图鉴 `GalleryView.name` 在未认识时统一下发「一位陌生的同学」；`/map/dialogue` 在未认识时补一句陌生人开场（问怎么称呼）；新增 `content/modules/introduce`（识别「我叫/叫我/名字叫」，产出 `attr.set(knows_name=true)` + 每个在场 NPC 一条 `memory.write`（名字+首次说话）），所以"下次见面记得你"靠记忆召回，不需要改引擎 ｜ 用户拍板：地图显示占位名、一级判定、名字靠对话自述。派生决策：图鉴 `met` 从"在场/同地"改为读 `knows_name`（原逻辑导致开局全员解锁）；NPC 真名不下发到客户端，占位名由服务端统一（`apps/server/src/view-names.ts`）；提示词侧不改（引擎闭盒），陌生人开场由服务端注入台词 ｜ tsc 0；vitest 289/290（唯一失败为上游既有 Windows chmod 用例），新增 6 例（introduce 4 / gallery 认识口径 2）；check:contract 8/8（3.3.0）；API 冒烟：开局 7 个 NPC 全为占位名 + 图鉴 met=0 → 首聊出现「怎么称呼」→ 输入「我叫林然」→ 林静/白晓通解锁、图鉴 met=2 ｜ 遗留：玩家名字只存在 NPC 记忆里（未新增 plr 属性）；未认识时 2D 地图仍画 NPC 肖像（名字已遮罩）；提示词层面"不得假装认识"规则等引擎开盒后再补
- 2026-11-18 ｜ `feat/npc-stranger` ｜ `feat/npc-stranger`（父 cda08233） ｜ fix ｜ 用户实测发现聊天界面仍显示「严守一：…」：模型把名字写进叙事/台词，前端只是原样渲染。改为在 SSE 写出前与 `/events` 回放时递归脱敏（`maskNamesDeep`，`apps/server/src/view-names.ts`），未认识 NPC 真名统一替换为「一位陌生的同学」；覆盖 `turn.delta/turn.facts/turn.patch` 与历史回放。docs/03 §5.1 记一条 ｜ 脱敏放在下发边界而不是提示词：模型侧名字不可控，视图层做唯一收口；改事件文本而不是 entity.name（后者会破坏引擎/记忆内部逻辑） ｜ tsc 0；vitest 293/294（新增 4 例脱敏测试）；check:contract 8/8；SSE 冒烟「对一位陌生的同学说：你好」→ 事件文本无任何真名、占位名出现 ｜ 遗留：`/state` 与 `/scenarios` 仍含真名（界面不渲染，属已知信息面；如需彻底收口另开）
- 2026-11-18 ｜ `feat/npc-stranger` ｜ `feat/npc-stranger`（父 cda08233） ｜ fix ｜ ①"问名字"也解锁：`introduce` 识别「你叫什么/怎么称呼/贵姓」→ 在场 NPC `knows_name=true` + 记忆「这位同学问了我的名字」（此前脱敏后玩家永远学不到名字）；②图鉴同步：`GalleryPanel` 加 `version` 依赖，App 用 `stateRev` 在每次刷新权威状态后 +1，认识后图鉴立即重拉（不用手动切 tab） ｜ 只改派生视图刷新时机与解锁入口，不改引擎 ｜ tsc 0；vitest 294/295（新增问名字用例）；check:contract 8/8（3.3.0）；API 冒烟：开局 met 0/7 → 问「你叫什么名字」→ met 2/7（白晓通/林静） ｜ 遗留：`/state`、`/scenarios` 仍含真名
- 2026-11-18 ｜ `feat/npc-stranger` ｜ `feat/npc-stranger`（父 cda08233） ｜ fix ｜ 用户实测：问 NPC 名字时出现「陌生人自我介绍」，且认识后聊天里仍是占位名。根因是脱敏用了**回合开始前**的状态。修法：`/turns` 先收齐事件，用最终 `turn.patch.state` 算一次未认识名单再统一写出；`/events` 回放同样按当前状态算 ｜ 脱敏按"结束时"而不是"开始时"判定：认识是回合内的结果，按开始态判定会把刚认识的人继续遮住 ｜ tsc 0；vitest 294/295；check:contract 8/8 ｜ 后续被"目标解锁"方案取代（见下一条）
- 2026-11-18 ｜ `feat/npc-stranger` ｜ `feat/npc-stranger`（父 cda08233） ｜ fix ｜ 用户实测「对话不符合逻辑」，逐条实测后确认是三个叠加问题：①`data/llm-settings.json` 丢失导致服务端跑 Mock（台词干瘪、答非所问）；②自述姓名把 NPC 名字也解锁了（方向反了）；③"问名字"原来按在场全员解锁。重做为确定性规则：前端 `runTurn` 新增 `targetNpcId`，服务端把喂给模型的 `input` 里占位名换成真名（只影响提示词），并在"有目标且问了名字"时只解锁该 NPC；无目标时退回台词内容判定。引入模块改为只写记忆不置位 ｜ 目标 id 来自客户端交互、可判；提示词实名化解决"模型不知道在跟谁说话"；方向修正避免"告诉对方我叫什么"= "我知道你叫什么" ｜ tsc 0；vitest 300/301；check:contract 8/8；实测：对林静问名字 → 图鉴 met 1/7、只解锁林静；第二回合林静用真名、另一位仍是占位名 ｜ 见下一条（占位名重复）
- 2026-11-18 ｜ `feat/npc-stranger` ｜ `feat/npc-stranger`（父 cda08233） ｜ feat ｜ 用户选 A（外貌标签）：`content/scenarios/npcs.json` 给 7 个 NPC 加 `appearance`（只写衣着/动作/随身物，不写姓名与身份，如「穿白衬衫、袖口别着校徽的男生」）；`NpcProfileSchema` 加可选 `appearance`；`unknownPlaceholders` 改为外貌优先、缺失退回序号占位；外貌经 `appearanceById(catalog)` 注入 `MapService` / `registerViewRoutes` / `routes` 三处，`/map`、对话脱敏、图鉴共用同一映射；docs/03 §5.2.6、docs/06 §7 同步 ｜ 外貌比序号可读：玩家能从"抱着一摞校刊、挂着相机的女生"认出是谁；数据放 content 而非代码（I3），加 NPC 只改 JSON ｜ tsc 0；vitest 301/302（新增外貌优先用例）；check:contract 8/8（3.3.0）；实测：全图 7 个 NPC 占位名全是外貌描述；对林静问名字后地图显示 `['林静', '抱着一摞校刊、脖子上挂着相机的女生']` ｜ 遗留：`/state`、`/scenarios` 仍含真名与 role；appearance 出现在未认识的场景描述里属预期

- 2026-11-18 ｜ eat/npc-stranger ｜ 父 cda08233 ｜ review ｜ 审阅 #52 打回（REQUEST_CHANGES）：P0 /state 与 /history 仍下发真名；P1 失败回合也解锁、目标不校验在场、台词「我是/我叫」误判、SSE 退化为整批缓冲未记录、docs 与实现矛盾；P2 契约版本写法、facts 假信息、脱敏前缀污染、旧存档与记忆增长未记录、测试缺口。修复：/state、/history 用 unknownPlaceholders+maskNamesDeep 脱敏；解锁只在 	urn.commit 之后且目标必须在 presentIds；speechIntroducesName 改为只认姓名共现；introduce 问名字不再产出 facts；maskNamesInText 按长度降序替换；docs/03（SSE 时序取舍、解锁入口、旧存档说明）与 docs/06、docs/07（种子记忆开销）同步 ｜ /state 是原始快照的旧设计，和服务端不下发真名冲突，选脱敏而不是关闭端点（面板仍需 state）；解锁用 commit 结果判定符合失败不落状态；SSE 选记录取舍而不是两段式，因为前端打字机已掩盖延迟 ｜ tsc 0；vitest 311/312（唯一失败为上游既有 Windows chmod 用例；新增 npc-stranger.routes 7 例 + 反例/前缀测试）；check:contract 8/8（3.3.0）；build:web 287.17 kB ｜ 未做：CONTRACT 版本由 Lead 落版；旧房间不做迁移（文档已注明）

- 2026-11-18 ｜ `feat/npc-stranger` ｜ `c1a831b`（PR #52 head） ｜ review ｜ 第二轮复审通过：P0 `/state`、`/history` 脱敏；失败回合不解锁；目标必须在场；`speechIntroducesName` 收紧为姓名共现；introduce 不产假 fact；`maskNamesInText` 长度降序；docs 更新。非阻塞项转 issue #53/#54 ｜ 复审确认“commit 后才解锁”与“在场校验”两条边界；SSE 选非流式并记录取舍 ｜ tsc 0；44 文件/312 用例；8 项契约（3.3.0）；build 287.17 kB ｜ 已 squash 合并 `f328bc3`
- 2026-11-18 ｜ `feat/npc-stranger` ｜ `f328bc3` ｜ merge ｜ squash 合并 PR #52（最终 head `c1a831b`）；合并树与 `c1a831b` 一致；随后 release 提交落 CONTRACT 3.4.0 ｜ 用户要求“不要动 #51、合并 #52、剩余问题开 issue” ｜ 见 main 记录 ｜ #53/#54 已开

### 历史分支（已合并 / 已删除，保留记录）

- 2026-11-16 ｜ `feature/map-module @ 362df4a` ｜ 已合并（`95eb27d..362df4a` ff，后随 main 进入 `3112f79`）；远端分支已删
- 2026-11-16 ｜ `fix/issue-1-atomicity @ 8b66458` ｜ 已合并（`3112f79`）；远端分支已删
- 2026-11-16 ｜ `feat/audit-layer @ 9f70c70` + `feat/reality-anchoring @ dc6be77` ｜ 已 squash 合并为 `6e70253`；远端分支已删。审核层第一轮被打回（audit 默认继承叙事模型 key 且写死模型名 → 静默开启），修复后复审通过；合并验证/报告见 `.review/reports/audit-reality-review*.md`
- 2026-11-16 ｜ `fix/arbiter-atomicity @ 400cb2c` ｜ 旧方案（2.3.0 未闭环），已被 3.0.0 取代；远端分支已删
- 2026-11-17 ｜ `feat/memory-module @ b16dabd` ｜ 已 squash 合并为 `8a26e00`；远端分支已删（仓库已开 `delete_branch_on_merge`，以后合入自动删）

---

## 5. 写入位置速查

- 本文件顶部「最后更新」与 §0 快照 → 合入 main 时刷新。
- 新分支 → §4 新增 `### <branch>` 小节；分支删除后保留并标注。
- 提交记录 / 审阅结论 / 合并记录 → 对应分支小节内追加一行。
- 新的架构事实 / 规范变化 → §1 / §2（先确认 `docs/03` 或 `AGENTS.md` 已同步）。
