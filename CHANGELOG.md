# 更新日志

按合并到 `main` 的日期记录。提交 sha 可在 `git log` 中查；跨系统协议版本以 `CONTRACT_VERSION` 为准（产品版本见 `package.json`，当前 0.0.1）。

版本与 tag 对应：`v0.1.0` M0 骨架 → `v0.1.1` 引擎 3.0.0 → `v0.1.2` 审核/锚定 → `v0.2.0` 地图 v0.2 → `v0.3.0` 前端体验与运行时模型接入（PR #2）→ `v0.4.0` 记忆子系统 3.1.0 + 地图交互/图鉴 registry 收口（PR #4/#5）→ `v0.5.0` issue #1/#3/#7/#8 批量落地（PR #9–#13）→ `v0.5.1` 三条 issue 修复（PR #22–#24）→ `v0.5.2` 记忆可信边界 / 404 守卫 / tick 原子 / 部署边界（PR #43–#45，CONTRACT 3.3.0）→ `v0.5.3` Turn 幂等（PR #50）→ `v0.5.4` NPC 认识与名字解锁 + 地图出站脱敏/档案收窄（PR #52/#55/#56，CONTRACT 3.4.1）→ `dev/v2` 预览（CONTRACT 3.6.0，13 op + 微信/八卦，尚未合入 main）。

## 3.6.0（dev/v2，2026-11-19）

- 第 13 个 op `msg.send`：NPC 之间/玩家给 NPC 的模拟私信（只有目标+内容），`Envelope.audience` 在 Transport 前过滤；模块 `apiVersion 2→3`。
- 新增 `MessageIndex`、`TalkBudget`、`GossipHost/GossipAgent`、dm 模式、gossip 私忆可信通道；微信内容入库前审核。
- 群聊引擎（v2）与群聊对话模型、前端影响清单、模块适配度检查随 dev/v2 一并交付。

## v0.5.4 — 2026-11-18 NPC 认识与名字解锁 + 地图脱敏/档案收窄（PR #52/#55/#56，合入 main `2547d73`；CONTRACT 3.3.0 → 3.4.1）

### 新增

- **陌生人与认识机制**：新增 `knows_name` 属性（一级口径 = 知道名字才算认识）；未认识 NPC 在 `/map`、`/map/dialogue`、图鉴、`/state`、`/history`、`/turns`/`/events` 中统一下发外貌占位名（`appearance` 优先，缺失用序号）。
- 新增 `content/modules/introduce`：自述姓名写“首次见面”私忆；问名字（`你叫什么/怎么称呼/贵姓…`）只写“谁问过我的名字”记忆，不置位。
- 新增 `apps/server/src/name-unlock.ts` / `view-names.ts`：`speechIntroducesName`（姓名共现才算 NPC 自报姓名）、`unknownPlaceholders` / `maskNamesInText` / `maskNamesDeep`。

### 修复

- **P0 真名泄露**：`/state` 与 `/history` 在未认识时脱敏（`maskNamesDeep`），不再下发真实 `entity.name` 与历史叙事中的真名。
- **P1 解锁规则**：只在 `turn.commit` 之后解锁；目标必须在场（`targetPresent`）；失败回合不再解锁；`我是/我叫/我姓` 不再误判为自报姓名；`introduce` 不再产出“你问到了对方的名字”假 fact。
- **脱敏稳定性**：`maskNamesInText` 按名字长度降序替换（避免短名前缀污染长名占位）；`/turns` 按“回合结束态”而非开始态判定未认识名单。
- **地图出站泄露（#53，PR #55）**：`/map/travel`、`/map/tick` 响应整包经 `maskTurnEvents`，`events`、`moved` 摘要与 `scene.dialogues` 中未认识 NPC 真名统一遮罩。
- **全局端点下发档案（#54，PR #56）**：`/api/v1/scenarios` 的 `npcs[]` 收窄为 `id`/`appearance`，不再下发 role/traits/line/mutter；`mutter` 改随 `/gallery` 且 `met=true` 下发，地图气泡改从房间图鉴取。

### 变更

- **`/turns` SSE 取舍**：事件先收齐、统一脱敏后写出（不再逐 token 流式）；延迟略增，两段式流式改进记录在 docs/03。
- **契约**：`CONTRACT_VERSION 3.3.0 → 3.4.1`（3.4.0 minor：`TurnRequest.targetNpcId?` 可选字段 + 视图行为变更；3.4.1 patch：#53 地图出站脱敏 + #54 档案下发收窄，服务端派生视图不进 schema；12 op / apiVersion / PROMPT_VERSION 不变）。
- **文档**：docs/03 §5.1/§5.2.6/§10.18、docs/02 `knows_name`、docs/06 §7、docs/07（建房种子记忆开销、旧房间不迁移）。

### 验证

- `tsc --noEmit` 0 错；vitest **47 文件 / 320 用例全过**（认识机制/脱敏/反例 10 例 + 地图出站脱敏 3 例 + 档案口径 5 例）；`check:contract` **8/8**（3.4.1）；`build:web` 287.14 kB / gzip 91.02 kB。

### 已知边界

- 旧房间没有 `knows_name` 属性，需重新认识一次；不做批量迁移（文档已注明）。
- SSE 暂为非流式（见上）。
- 建房时给每个 canon NPC 写一条私有种子记忆（一次性开销，见 docs/07）。

## v0.5.3 — 2026-11-18 Turn 幂等收口（PR #50，合入 main `2c51028`；CONTRACT 3.3.0 不变）

### 修复

- **Turn 幂等键含房间与 actor（#34）**：`clientTurnId` 幂等键改为 `JSON.stringify([roomId, actorId, clientTurnId])`，跨房间/actor 不再串台。
- **同 key 并发只结算一次**：新增进程内 `inFlight`，后来者等待首个结算完成并重放同一事件序列，不重复调模型、不重复扣钱。
- **提交记账移到 `yield turn.commit` 之前**：`seen` / `maybeCompact` / 印象 `markDelivered` 全部在 commit 事件交给消费者前完成；`apps/server` 的 `for await ... break` 不再导致“重放重复结算/印象重复投递”。外层 `try/finally` 即使上游 break 也释放等待者。

### 验证

- `tsc --noEmit` 0 错；vitest **39 文件 / 283 用例全过**（新增 `turn.idempotency.test.ts` 4 例：串行重放、同 key 并发、跨房间/actor 隔离、HTTP break-on-commit 记账）；`check:contract` **8/8**（CONTRACT_VERSION=3.3.0）。

### 已知边界

- 幂等缓存为进程内：重启后同一 `clientTurnId` 会重新结算；跨重启恢复需 EventLog 持久化回合标记 + 契约变更（未做）。
- leader 失败后 waiter 重排队与第三个同 key 请求之间存在小竞态窗口；同 key waiters 无超时（leader 挂起会一直等待）——已记录为 follow-up。

## v0.5.2 — 2026-11-18 记忆可信边界 / 房间 404 守卫 / tick 原子 / 部署边界（PR #43–#45，合入 main `259cb5e`；CONTRACT 3.3.0）

### 新增

- **房间入口存在性守卫（#37）**：未知房间或 `room_world_*` 在 `/state`、`/events`、`/turns`、`/history`、`/map`、`/map/travel`、`/map/tick`、`/map/dialogue` 一律 HTTP 404 `E_ROOM_NOT_FOUND`，不再返回空状态、不再隐式写日志建房（`apps/server/src/room-exists.ts`）。
- **`E_ROOM_NOT_FOUND` 契约登记**：`ERROR_CODES` 33→34，docs/03 §7 与 §10.17；`Store` 补充契约外可选能力 `listRooms()` 文档。
- **部署与一致性边界（#40，docs-only）**：新增 `docs/10-部署与一致性边界.md`（单实例边界、禁止多实例共写同一 `data/`、`tmp→rename` ≠ 跨实例事务、备份/升级停写窗口、运维清单、未来 DB/分布式锁规划中）；README/docs/00/docs/02 导航同步。

### 修复

- **tick 单批原子提交（#38）**：`map/tick` 的 `time.advance` 与模块提案合成同一批 `Arbiter.apply`（atomic），失败整批不落库、时段不再单独前进；重试不重复推进。
- **记忆工作记忆可信边界（#36）**：G3/G4/G6 豁免从模型可写 `tags` 改为引擎内部 `workingDrafts` 通道；伪造「最近对话」标签的模型草稿被清洗且仍受 3/30 配额。
- **repair 成功补写记忆（#39）**：repair 成功用修复版叙事/台词/记忆重建整份记忆计划并随最终批提交；首版被拒产物不写记忆。
- **compact 接线（#42）**：每 5 个提交成功回合异步 compact、`COMPACT_AFTER=20`、archived 不占 `ownedCount`/不进 prompt、工作记忆永不归档、重启首次同步确定性重算 archived。
- **x 区口径澄清（#41）**：`xWritesPerTurn` 只统计 `attr.delta`/`attr.set` 的 `x.` 键，`memory.write` 不计入；补 8 条 x 写 + 双 NPC 记忆同回合回归（issue #41 以“前提不成立”关闭）。

### 验证

- `tsc --noEmit` 0 错；vitest **38 文件 / 279 用例全过**；`check:contract` **8/8**（CONTRACT_VERSION=3.3.0，错误码 34/34）；`build:web` 287.05 kB / gzip 90.90 kB。

### 已知限制

- `roomGate` 每次请求扫 `data/rooms/` 目录（O(n)），房间多时可加缓存（follow-up）。
- compact 不落事件：重启按事件日志确定性重算，归档集合可能与运行期有极小差异；进程内计数重启归零（最多晚 5 回合）。
- 并发两个 `map/tick` 的时段推进竞态属基线既有，不在 #38 范围。

## v0.5.1 — 2026-11-18 三条 issue 修复（PR #22/#23/#24，合入 main `42690c9`）

### 新增

- **多 NPC 记忆（#20 / #21-2）**：`MemoryContext.npcs[]` 按在场 NPC 各自召回 long/short（S1.5 之外 1100 tok 均分，超预算先裁 short 再 long）；S7/S8 多 NPC 按人分段标名；写侧每 NPC 首见种子与每回合「最近对话」工作记忆（滚动 tombstone，只留最新 1 条，不占情节配额）；S1 增「只有在场者能说话/行动，不得替不在场者回答」。`PROMPT_VERSION 2026-11-17.3 → 2026-11-18.1`，新建 `docs/prompts/CHANGELOG.md`。
- **点不在场 NPC 隔离（#21-1）**：web `npc-presence.ts` 判定 present/elsewhere/unlocatable；异地给「TA 不在这里（在「XX」）」+「前往 TA 所在地」（复用 `/map/travel`，到达后选中）；场景不可定位时禁用。
- **可重试错误重试按钮（#21-3）**：`turn-error.ts` 优先读服务端 `retryable`；对话区错误条给「重试」（新 `clientTurnId`、不重复玩家行），换场景自动失效。

### 修复

- **LLM 非法 JSON（#18）**：`turn.parse.ts` 先按原文取首个平衡 `{...}`（字符串/转义感知），失败才剥首尾围栏；容忍尾随逗号与前后文本；解析失败带摘要自动重问**一次**，第二次仍坏才 `E_LLM_FORMAT`；重问超时/限流保留真实错误码。
- **`retryable` 语义**：`E_LLM_FORMAT`/`E_LLM_TIMEOUT`/`E_RATE_LIMITED`/`E_STORE_FAULT` 为 true，硬失败 false。
- **多 NPC 记忆注入 bug（#20）**：原 `selectOwner` 在多 NPC 场景退回玩家，在场 NPC 私忆整段不进提示词；修后每 NPC 独立注入，单 NPC / 0 NPC 行为不变。
- **工作记忆配额**：每回合「最近对话」不再耗尽 `sessionCap=30`，也不挤占模型记忆的 `writePerTurn=3`；叙事/台词分别截断，不再丢关键台词。

### 文档

- docs/03 §10.14（3.2.0 → 3.2.1 patch）；docs/07 §4.1/§4.2、docs/06 §7/§8、docs/prompts/CHANGELOG.md；MEMORY §0/§3.2/§3.3/§4。

### 验证

- `tsc --noEmit` 0 错；`vitest run` **37 文件 / 267 用例全过**；`check:contract` **8 项全过**（CONTRACT_VERSION=3.2.1）；`build:web` 287.05 kB / gzip 90.90 kB。

## v0.5.0 — 2026-11-17 四条 issue 批量落地（PR #9–#13，合入 `95185b2`）

### 新增

- **图鉴 I2 收口（#3）**：`GET /api/v1/rooms/:roomId/gallery` 返回服务端按 registry 生成的 `GalleryView`（public 给精确值、secret 只给低/中/高、self 对他人只给分档、hidden 不出现、未遇见不给档案与读数）；`GET /api/v1/scenarios` 返回 `content/scenarios/{openings,npcs}.json` 数据化的开局与 NPC 公开档案；web 图鉴删除 `trust/guard/mood` 字面键与前端阈值，改为只渲染 GalleryView。
- **存档与会话恢复 MVP（#7）**：`GET /rooms/:roomId/history`（已提交回合投影）、`GET /me/saves`、`DELETE /me/saves/:roomId`；`data/history/<roomId>.jsonl` 只记 `turn.commit` 后回合（turnId 去重），`data/users/<uid>/saves.json` 索引（tmp+rename 原子写）；web 标题页「我的存档」、进房历史重放（不重播序章）、本地身份 `ecust.playerId`。
- **整回合预算显式化（#1）**：`Turn` 创建 `TurnBudget` 并跨三次 `apply` 显式传递；`xWritesPerTurn` / `maxDeltaPerTurn` 明确为整回合限额（语义与 3.1.0 一致）；docs/03 §2.4 补提案阶段顺序表。

### 修复

- **store 读取失败污染 loaded（#7）**：`loaded` 置位移到读取+解析+回放成功之后；断档修复先写盘再改内存；`appendMemory` 失败清理半载入状态，避免 seq 假 0 时覆盖真实日志。
- **图鉴口径**：未知房间经 `listRooms()` 判 404（不再 200 空图鉴）；secret/self 数值缺 `min/max` 降级「—」，不猜 0~100。
- **历史目录隔离**：历史改 `data/history/`，避免被 `FileStore.listRooms()` 当房间、避免覆盖历史文件。

### 文档

- README 改为入口文档，版本号/测试数改为单一来源引用（MEMORY §0 / docs/03 §0.4 / `version.ts`）；AGENTS §1 必读清单补齐 06/07/08。
- docs/03 新增 §5.2.4（registry）、§5.2.5（gallery）、§5.2.6（scenarios）、§5.2.7（history/saves）与 §10.12；新增 `docs/09-存档与会话恢复方案.md`；`CONTRACT_VERSION 3.1.0 → 3.2.0`（minor：只增端点/类型/配置，旧调用方式不变）。

### 验证

- `tsc --noEmit` 0 错；`vitest` **31 文件 / 212 用例全过**；`check:contract` **8/8**（`CONTRACT_VERSION 3.2.0`）；`build:web` 272.61 kB / gzip 86.19 kB。
- 已知遗留：`/state` 仍下发 secret 原始数值（issue #3 后续）；`self` 的“看自己”图鉴视图未提供；存档 MVP 无多槽/导出，历史一次最多 200 行。

## v0.4.0 — 2026-11-17 地图交互打磨 + 图鉴 I2 收口（PR #5，合入 `69da448`）

### 新增

- **地图交互**：点标记只选中不出发；场景详情/场景链接/对话统一「前往此处」，前往成功自动切回对话页；对话流贴底跟随最新剧情（距底 120px 判定）；标题页「玩法说明/关于本作」下沉底部小字。
- **注册表端点** `GET /api/v1/registry`（docs/03 §5.2.4）：只返回属性声明（label / visibility / min-max / unit / hidden），不含任何实体数值。
- **图鉴按 registry 渲染**：删除 `trust`/`guard`/`mood` 字面键，secret 只展示低/中/高，public/self 显示数值与进度条。

### 变更 / 已知偏差

- PR 首版（`cd12771`）基线错误、回退了记忆接线，已按要求 rebase 到 `b11ad5a` 后合并。
- `secret` 精确值仍随 `GET /rooms/:id/state` 原始 snapshot 下发；`self` 展示口径与 `scenarios.ts` 硬编码待 issue #3 后续收口。

### 验证

- `tsc --noEmit` 0 错；`vitest` 26 文件 / 185 用例全过；`check:contract` 8/8（`CONTRACT_VERSION 3.1.0`）；`build:web` 271.31 kB / gzip 86.66 kB。

## v0.4.0 — 2026-11-17 记忆子系统 3.1.0（P0–P4，合入 `8a26e00`）

### 新增

- 记忆三层（short/long/permanent）接通：`EventSourcedMemory` 从事件日志投影、六道写入闸门、1100 tok 注入硬顶、两阶段裁决（记忆坏了不拖垮回合）、首轮"第一次见到"种子。
- 账号维度：`RoomMember.userId`、`TurnRequest.userId`、`GET /api/v1/me`（档案只读视图）；solo = 1 个成员。
- 世界层永久记忆：canonize 八道闸门 + 独立 judge（未配 = 全拒）、`room_world_<worldId>` 房间、`admin/canonize/{run,tombstone}`、`worlds/<id>/mem.version`。
- 世界印象：canonize 成功后给相关玩家投递 `【世界印象】…记住了你：…`（用户投影，TTL 30 天）。

### 修复（PR #4 二轮复审收尾）

- **世界印象链路接通**：`turn.ts` 调 `attachAboutUserIds`，闸门重建草稿保留 `aboutUserIds`；新增 `apps/server/src/impressions.e2e.test.ts`（回合 → canonize → impressions.json → 下回合 facts）。
- 私忆 id 的回合序号改用 `cause.seq`（时钟不推进也不撞 id）。
- G6 超限定版：不建次日队列（候选为记忆的纯函数，跨日重新聚合），docs/08 §7.3⑥ + §13 同步。
- `/health` 暴露 `canonize.{enabled,judge}`；`GALGAME_DEV_USER` 接线；tombstone 存在性改查记忆索引。

### 修复（PR #4 复审打回项）

- `store.events` 默认 `limit=Infinity`（原 200 会让记忆在 ~30 回合后静默冻结）。
- 启动重建记忆索引（房间 + 世界层）；世界层版本从 `mem.version` 读回，重启不回退。
- canonize 发布后 `ingest` 世界事件（此前"写进去没人读"，S1.5 恒空）、`retireRoom` 不再丢事件。
- 私忆 `memoryId` 不再由内容哈希派生（同内容不同 owner 各存一条）。
- `room_world_` 房间禁止 `state/events/turns`；`X-User-Id` 可用 `GALGAME_TRUST_USER_HEADER=0` 关闭；`FileImpressions` 目录名单射。
- 提示词按 docs/08 顺序重排（S1→S1.5→S4→S5→S6→S7→S8→S9），静态协议在前保住缓存前缀。

### 验证

`tsc` 0 错；**24 文件 / 180 用例全过**（含 4 条端到端：canonize→S1.5 非空、重启重建版本与召回一致、同内容不同 owner 两条都在）；`check:contract` 8 项（3.1.0）。

## v0.3.0 — 2026-11-17 前端体验与运行时模型接入（合入 main `45ea4d4`）

### 新增

- 前端：标题页（选身份/继续/说明/关于/接入真实模型，独占步骤）、开场剧情并入对话流、人物图鉴（信任数值+戒备分档，初始「—」由玩法写入）、逐字打字机（`typewriter.ts`）、Web Audio 按键音（`sfx.ts`）、页面/切 tab/对话行 CSS 过渡。
- 服务端：`GET/POST/DELETE /api/v1/settings/llm`（玩家自备 key，探活后热切换；保存 `data/llm-settings.json`（0600）重启恢复，环境变量优先；**仅本机可调用**）；离线叙述器 `offline-narrator.ts`（场景白描，无配置字样）。

### 修复

- 建房间按 registry 播种 **public** 属性默认值（secret/self 不预填，canon seed 例外）。
- `map` manifest 补 `keywords`（中文路由）；交易意图让位，避免抢占 `trade`（"去食堂买面包"）。

### 验证

`tsc` 0 错；**17 文件 / 134 用例全过**（审阅方 Linux；作者 Windows 环境的 133/134 为上游既有 chmod 模拟写盘用例）；`check:contract` 8 项；`build:web` OK（269.06 kB / gzip 86.02 kB）。已知偏差：图鉴直读 `attrs.trust/guard/mood`、`scenarios.ts` 硬编码开局与 NPC 档案 → 作为临时债由 issue #3 收口（owner 已拍板，下次前端/图鉴合并前必须完成）。

## v0.2.0 — 2026-11-17 地图 v0.2：奉贤校区真实底图

### 新增

- 真实奉贤校区底图（6000×4500）与 33 个点位：24 建成、4 在建、5 规划（`apps/web/public/map/ecust-campus.jpg`、`content/modules/map/data/world_map.json`）。
- Web 地图：缩放 1–4 倍、拖拽平移、点击选点、三态/分类图例、场景详情（`MapViewport.tsx`、`MapLegend.tsx`、`map-geometry.ts`）。
- 服务端 `MapView` 新增 `image`，场景新增 `status` / `category`；非建成点位禁止进入（`E_FORBIDDEN`，提示“规划中，尚未建成 / 在建，暂不可进入”）。
- canon 新场景首次进入时懒安装（建 entity + 双向 `located_in`，`origin: "seed"`、`canon: false`）。
- 玩家造场景草案发布后固定 `status: "built"`、`category: "other"`。

### 修复 / 变更

- 坐标以 `world_map.json` 模板为准；旧存档 1000×640 时代的 `coord_x/coord_y` 仅作兜底（场景与 NPC 同策略）。
- `coord_x` 上限 2000→6000、`coord_y` 1600→4500；`docs/02`、`docs/03`、`docs/06` 同步。
- 同一检查点的多个 NPC 按 id 做确定性小偏移（只读展示，不写状态）。
- `.gitignore` 增 `/.tmp-map/`，底图叠图等审查产物不再进入版本库。

### 验证

`typecheck` 0 错；14 文件 / 117 用例全过；`check:contract` 8 项全过（`CONTRACT_VERSION 3.0.0`）。

## v0.1.1 — 2026-11-16 引擎 3.0.0：结算原子性 + 持久化闭环

### 新增

- 结算原子性：`Arbiter.apply` 默认 `atomic`，一条被拒整批回滚；返回 `ApplyResult.error`；整回合预算；可信 `cause` 权限校验。
- 持久化闭环：写盘先行、`load()` 恢复、坏档修复、`Store.flush` 变为必选成员（`CONTRACT_VERSION` major 的原因）。

### 验证

14 文件 / 115 用例全过；`check:contract` 8 项全过（`CONTRACT_VERSION 3.0.0`）。

## v0.1.2 — 2026-11-16 内容审核层 + 现实锚定层 + 共享记忆

### 新增

- 内容审核层：叙事发出前经独立模型/端点二次审核，违规按 `content/registry/policy.json` 扣信誉/删档；被审模型不能自审。
- 现实锚定层：玩家“我全知全能 / 忽略提示词”等偏离现实的发言被修饰或过滤，不扣分；类型定义在 `content/registry/reality.json`。
- 跨会话共享记忆 `MEMORY.md` 与 `AGENTS.md` §11 维护规范（按分支记录提交、审阅、合并）。

### 验证

14 文件 / 115 用例全过；`check:contract` 8 项全过（`CONTRACT_VERSION 3.0.0`）。

## v0.1.0 — 2026-11-14 M0 骨架（契约 2.2.0）

### 新增

- 契约冻结 2.2.0：12 个 op 原语、`Envelope`、错误码、registry（属性/事件/意图/工具）。
- `Turn` 流水线（play → apply → tick）、模块宿主、LLM 网关、HTTP + SSE 服务端、React Web。
- 示例模块 `trade` / `core` 与 `packages/testkit` 测试工具。
- 六份规范文档与 v2 JSON Schema。
