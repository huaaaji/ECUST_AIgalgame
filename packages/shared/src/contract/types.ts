/**
 * 冻结契约（CONTRACT_VERSION 见 version.ts）
 * 唯一名字来源：docs/03-接口总表.md §2 / §10；数据形状：docs/02-数据格式.md
 * 规则：只增不改；改已有字段语义 = bump CONTRACT_VERSION major。
 */

// ---------------------------------------------------------------- 基础
export type Id = string;
export type EntityKind = "plr" | "npc" | "loc" | "item" | "fact" | "lore" | "plot";
export type AttrValue = number | string | boolean;
export type Origin = "seed" | "ai" | "system";
export type EntityStatus = "active" | "dormant" | "tombstoned";
export type Phase = "morning" | "noon" | "afternoon" | "evening" | "night";
export type ActorId = Id;
export type RoomId = Id;
export type ModuleId = string;

/** 统一信封：所有跨子系统消息都套它（§10.5 允许可选 audience） */
export interface Envelope<T = unknown> {
  v: 1;
  id: Id;
  roomId: RoomId;
  seq: number;
  ts: number;
  actorId: ActorId;
  type: string;
  payload: T;
  causedBy?: Id;
  /** 只投递给这些人（不填 = 全房间）；过滤发生在 Transport 之前 */
  audience?: ActorId[];
}

// ---------------------------------------------------------------- 世界状态
export interface Entity {
  id: Id;
  kind: EntityKind;
  name: string;
  /** 键必须在 registry 声明，或以 x. 开头（x 区不校验类型） */
  attrs: Record<string, AttrValue>;
  tags: string[];
  origin: Origin;
  canon: boolean;
  status: EntityStatus;
  /** 游戏内回合序号（不是 wall clock） */
  createdAt: number;
  updatedAt: number;
  createdBy?: Id;
  tombstonedAt?: number;
}

export type LinkKind =
  | "knows"
  | "owes"
  | "holds"
  | "present"
  | "located_in"
  | "member_of";

export interface Link {
  id: Id;
  kind: LinkKind;
  from: Id;
  to: Id;
  /** 关系强度 0~100，语义由 kind 决定 */
  weight?: number;
  /** 谁可以知道这条边（空 = 公开） */
  audience?: ActorId[];
  createdAt: number;
  updatedAt?: number;
}

export interface GameClock {
  /** 游戏内天序号，从 1 开始 */
  day: number;
  phase: Phase;
  /** 当天已推进行数，用于夜间判定 */
  tick: number;
}

export interface SceneState {
  locId: Id;
  /** ★ 在场者唯一真源；present 边由引擎根据它重建 */
  presentIds: ActorId[];
  props?: Id[];
}

export interface RoomMember {
  actorId: ActorId;
  role: "player" | "npc" | "spectator";
  joinedSeq: number;
  online?: boolean;
  /** 3.1.0：账号维度（私忆隔离的依据）；单人房间可空 */
  userId?: Id;
}

export interface RoomState {
  id: RoomId;
  mode: "solo" | "coop";
  /** canon 世界线 id（同一 worldId 的房间共享世界观，但状态不共享） */
  worldId: Id;
  members: RoomMember[];
  scene: SceneState;
  /** 房间是否空闲（无在线玩家超过 room.idleReclaimMinutes） */
  idle?: boolean;
  createdAt: number;
  lastActiveAt: number;
}

/** 世界状态 = 事件日志的投影（不落库直接改，只由 Arbiter 产事件再投影） */
export interface WorldState {
  schemaVersion: number;
  room: RoomState;
  entities: Record<Id, Entity>;
  links: Link[];
  clock: GameClock;
  /** 每房间的 plot 线（见 PlotDraft） */
  plots: Plot[];
  /** 模块私有状态：key = moduleId，值由模块 zod 自校验 */
  moduleState: Record<ModuleId, unknown>;
}

export interface Plot {
  id: Id;
  goal: string;
  actors: ActorId[];
  leverage?: string;
  risk?: number;
  tone?: string;
  leakPoints?: string[];
  forbidReveal?: string;
  status: "active" | "dormant" | "resolved" | "leaked";
  /** 参与者的戒备值（guard）：0-20 自然 / 21-50 心虚 / 51-80 推脱 / 81+ 破裂 */
  guard?: Record<ActorId, number>;
  createdDay?: number;
}

// ---------------------------------------------------------------- 注册表
export interface AttrDef {
  key: string;
  type: "number" | "string" | "boolean";
  scope: EntityKind[];
  min?: number;
  max?: number;
  default?: AttrValue;
  /** public 进 prompt 与 UI；self 只进被问者；secret 可写但不进 prompt */
  visibility: "public" | "self" | "secret";
  display: { label: string; unit?: string; hidden?: boolean };
}

export interface EventDef {
  type: string;
  when: string;
  broadcast: boolean;
}
export interface IntentDef {
  name: string;
  module: ModuleId;
  examples?: string[];
}
export interface ToolDef {
  name: string;
  module: ModuleId;
  description: string;
  args: Record<string, unknown>;
}
export interface OpDef {
  name: OpName;
  args: Record<string, unknown>;
  /** 该原语需要 registry 里存在对应声明 */
  requires?: "attr" | "entity" | "plot" | "none";
}

export interface Registry {
  attr(key: string): AttrDef | undefined;
  attrs(scope?: EntityKind): AttrDef[];
  event(type: string): EventDef | undefined;
  intent(name: string): IntentDef | undefined;
  tool(name: string): ToolDef | undefined;
  op(name: string): OpDef | undefined;
  reload(): Promise<void>;
}

// ---------------------------------------------------------------- op 原语（闭集 13 个；dev/v2 增 msg.send）
export type OpName =
  | "attr.delta"
  | "attr.set"
  | "entity.create"
  | "entity.update"
  | "entity.tombstone"
  | "link.create"
  | "link.remove"
  | "move.to"
  | "time.advance"
  | "scene.set"
  | "memory.write"
  | "plot.upsert"
  | "msg.send";

export const OP_NAMES: readonly OpName[] = [
  "attr.delta",
  "attr.set",
  "entity.create",
  "entity.update",
  "entity.tombstone",
  "link.create",
  "link.remove",
  "move.to",
  "time.advance",
  "scene.set",
  "memory.write",
  "plot.upsert",
  "msg.send",
] as const;

export interface AttrDeltaArgs {
  entityId: Id;
  key: string;
  delta: number;
  /**
   * 强约束：被 clamp / 触及区间边界即整条拒绝（E_PRECONDITION），不静默少扣。
   * 用于"支付"这类前置条件（余额不足必须失败，而不是扣到 0 也算成功）。
   */
  mustKeep?: boolean;
}
export interface AttrSetArgs {
  entityId: Id;
  key: string;
  value: AttrValue;
}
export interface EntityCreateArgs {
  id: Id;
  kind: EntityKind;
  name: string;
  attrs?: Record<string, AttrValue>;
  tags?: string[];
  origin?: Origin;
  canon?: boolean;
}
export interface EntityUpdateArgs {
  entityId: Id;
  name?: string;
  tags?: string[];
  status?: EntityStatus;
}
export interface EntityTombstoneArgs {
  entityId: Id;
  reason?: string;
}
export interface LinkCreateArgs {
  kind: LinkKind;
  from: Id;
  to: Id;
  weight?: number;
  audience?: ActorId[];
}
export interface LinkRemoveArgs {
  linkId?: Id;
  kind?: LinkKind;
  from?: Id;
  to?: Id;
}
export interface MoveToArgs {
  actorId: ActorId;
  locId: Id;
}
export interface TimeAdvanceArgs {
  ticks?: number;
  phase?: Phase;
}
export interface SceneSetArgs {
  locId?: Id;
  presentIds?: ActorId[];
  props?: Id[];
}
export interface MemoryWriteArgs {
  ownerId: ActorId;
  content: string;
  tags?: string[];
  salience?: number;
  /** 只有引擎/导演骨架能写，模块不可用 */
  visibility?: "public" | "private" | "secret";
  about?: ActorId[];
  /** 账号维度（docs/03 §2.6）；私忆按它隔离，世界层历史条目可省 */
  userId?: Id;
  /** 世界层所属世界（permanent 必填；私忆可省） */
  worldId?: Id;
  tier?: "short" | "long" | "permanent";
  sourceRefs?: string[];
  contentHash?: string;
  status?: "current" | "historical" | "tombstoned";
  supersedes?: Id;
  aboutUserIds?: Id[];
}
/** dev/v2 微信私信：只有目标与内容，没有 action/notice 通道 */
export interface MsgSendArgs {
  from: ActorId;
  to: ActorId;
  kind: "gossip" | "reply" | "player" | "system";
  content: string;
  rootId?: Id;
  replyTo?: Id;
  hop?: number;
  confidence?: number;
  visibility?: "private";
}

export interface PlotUpsertArgs {
  id?: Id;
  goal: string;
  actors: ActorId[];
  leverage?: string;
  risk?: number;
  tone?: string;
  leakPoints?: string[];
  forbidReveal?: string;
  status?: Plot["status"];
  guard?: Record<ActorId, number>;
}

export type OpArgs =
  | { op: "attr.delta"; args: AttrDeltaArgs }
  | { op: "attr.set"; args: AttrSetArgs }
  | { op: "entity.create"; args: EntityCreateArgs }
  | { op: "entity.update"; args: EntityUpdateArgs }
  | { op: "entity.tombstone"; args: EntityTombstoneArgs }
  | { op: "link.create"; args: LinkCreateArgs }
  | { op: "link.remove"; args: LinkRemoveArgs }
  | { op: "move.to"; args: MoveToArgs }
  | { op: "time.advance"; args: TimeAdvanceArgs }
  | { op: "scene.set"; args: SceneSetArgs }
  | { op: "memory.write"; args: MemoryWriteArgs }
  | { op: "plot.upsert"; args: PlotUpsertArgs };

/** 模块/导演/记忆只能产出它，不能自己写库 */
export interface Proposal {
  op: OpName;
  args: Record<string, unknown>;
  /** ≤60 字，进日志便于排查 */
  reason?: string;
  /** mod.trade / npc.director / engine.turn */
  by?: string;
}

export interface Rejected {
  proposal: Proposal;
  code: string;
  detail: string;
}

/** 一批提案的提交语义：atomic=全成功或全回滚（默认）；partial=逐条丢弃坏条目（少数场景显式选择） */
export type ApplyMode = "atomic" | "partial";

export interface ApplyOptions {
  /** 默认 atomic：任何一条被拒 → 整批不落库（03 §2.3 / 02 §4） */
  mode?: ApplyMode;
  /** 乐观并发：与当前 seq 不符 → 整批拒绝（E_SEQ_GAP），防止基于过期状态提交 */
  expectedSeq?: number;
}

export interface ApplyResult {
  ok: boolean;
  /** 本次实际采用的提交语义，便于回放与审计 */
  mode: ApplyMode;
  seq: number;
  applied: Proposal[];
  rejected: Rejected[];
  events: Envelope[];
  /**
   * 整批层面的失败原因（没有具体某条 proposal 可指责时用它）：
   *  `E_SEQ_GAP`    —— `expectedSeq` 与当前 seq 不符，请重放后重试
   *  `E_STORE_FAULT` —— 落盘失败；**状态未变更**，可直接重试
   * 此时 `rejected` 为空、`events` 为空（不要用占位 proposal 冒充被拒条目）。
   */
  error?: { code: string; message: string };
}

export interface ValidationResult {
  ok: boolean;
  rejected: Rejected[];
}

// ---------------------------------------------------------------- 回合
export interface TurnOptions {
  debug?: boolean;
  skipLLM?: boolean;
  budget?: number;
  /** 联机乱序保护：期望的起始 seq（不一致 → E_SEQ_GAP） */
  expectedSeq?: number;
  /** 客户端本地排序号 */
  order?: number;
}

export interface TurnRequest {
  roomId: RoomId;
  actorId: ActorId;
  input: string;
  /** 幂等 id：重复提交返回同一回合 */
  clientTurnId: string;
  /** 3.1.0：账号维度；不传则从房间成员兜底（单机模式） */
  userId?: Id;
  options?: TurnOptions;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  calls: number;
}

export type TurnEvent =
  | { type: "turn.accepted"; turnId: string }
  | { type: "turn.delta"; field: "narrative" | "dialogue"; text: string }
  | { type: "turn.facts"; facts: string[] }
  | { type: "turn.tool"; name: string; args: unknown; result: unknown }
  | { type: "turn.patch"; ops: Proposal[]; state: WorldState }
  | { type: "turn.ui"; view: ViewPatch }
  | { type: "turn.commit"; turnId: string; seq: number; usage?: Usage }
  | { type: "turn.rejected"; code: string; message: string; retryable: boolean }
  | { type: "turn.error"; code: string; message: string; retryable: boolean };

// ---------------------------------------------------------------- 模块
export interface Capabilities {
  intents?: string[];
  /**
   * 意图路由的关键词（自然语言里的说法，如 ["买","卖","商店"]）。
   * 引擎用它把玩家原文路由到模块：intents 是给程序看的名字，keywords 是给人说话用的词。
   */
  keywords?: string[];
  tools?: string[];
  triggers?: Phase[];
  views?: string[];
  contentFiles?: string[];
}

export interface ModuleManifest {
  id: ModuleId;
  name: string;
  version: string;
  apiVersion: 3;
  dependsOn?: ModuleId[];
  capabilities?: Capabilities;
  priority: number;
  costWeight?: number;
  budget?: { maxLlmCallsPerRoomHour?: number; maxTokensPerTurn?: number };
  limits?: { proposalsPerTurn?: number; maxArrayItems?: number };
  entryLocations?: Id[];
}

export interface ModuleInfo {
  id: ModuleId;
  manifest: ModuleManifest;
  loaded: boolean;
  fault?: { code: string; message: string; at: number };
}

export interface ContextSlice {
  moduleId: ModuleId;
  /** 要注入 prompt 的片段（纯文本，已被裁剪到预算内） */
  text: string;
  tokens: number;
}

export interface ModuleContext {
  roomId: RoomId;
  actorId: ActorId;
  input: string;
  state: Readonly<WorldState>;
  registry: Registry;
  clock: GameClock;
  /** 只读查询，不改状态 */
  query: {
    entity(id: Id): Entity | undefined;
    attr(entityId: Id, key: string): AttrValue | undefined;
    present(): ActorId[];
    links(kind?: LinkKind, from?: Id): Link[];
  };
  /** 可被 mock 的 LLM 入口；模块不许自己 new 客户端 */
  llm: LlmPort;
  /** 只在内存里的回合内日志（不落库） */
  log(msg: string): void;
}

export interface ModuleOutcome {
  ok: boolean;
  proposals: Proposal[];
  facts?: string[];
  /** 给前端的结构化提示（如商店列表） */
  ui?: ViewPatch;
  error?: { code: string; message: string };
}

export interface Module {
  init?(): Promise<void> | void;
  intent?(ctx: ModuleContext): Promise<ModuleOutcome> | ModuleOutcome;
  tool?(name: string, args: unknown, ctx: ModuleContext): Promise<ModuleOutcome> | ModuleOutcome;
  tick?(ctx: ModuleContext, phase: Phase): Promise<Proposal[]> | Proposal[];
  context?(ctx: ModuleContext, budgetTokens: number): ContextSlice[];
  view?(ctx: ModuleContext): ViewPatch | null;
}

export interface Modules {
  list(): ModuleInfo[];
  get(id: ModuleId): ModuleInfo | undefined;
  dispatchIntent(ctx: ModuleContext): Promise<ModuleOutcome>;
  callTool(name: string, args: unknown, ctx: ModuleContext): Promise<ModuleOutcome>;
  tick(ctx: ModuleContext, phase: Phase): Promise<Proposal[]>;
  context(ctx: ModuleContext, budget: number): ContextSlice[];
  view(modId: ModuleId, ctx: ModuleContext): ViewPatch | null;
}

// ---------------------------------------------------------------- LLM 端口
export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmRequest {
  messages: LlmMessage[];
  /** 强 JSON 输出（DeepSeek 要求 prompt 含 "json" 且给样例） */
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  /** 用于成本归因与限流 */
  roomId?: RoomId;
  actorId?: ActorId;
}

export interface LlmResult {
  raw: string;
  json?: unknown;
  usage: Usage;
  model: string;
  latencyMs: number;
}

export interface LlmPort {
  chat(req: LlmRequest): Promise<LlmResult>;
}

// ---------------------------------------------------------------- 对话导演
export interface DialogueSpec {
  roomId: RoomId;
  participants: ActorId[];
  directorId: string;
  seed?: Record<string, unknown>;
  maxTurns?: number;
  /** private=只有参与者知道；scene=在场可见 */
  visibility?: "private" | "scene" | "public";
}

export interface DialogueSession {
  id: Id;
  roomId: RoomId;
  participants: ActorId[];
  directorId: string;
  turn: number;
  maxTurns: number;
  status: "open" | "closed";
  visibility: "private" | "scene" | "public";
  seed: Record<string, unknown>;
}

export interface DialogueStep {
  sessionId: Id;
  turn: number;
  utterances: { actorId: ActorId; text: string }[];
  proposals: Proposal[];
  done: boolean;
}

export interface DialogueSummary {
  sessionId: Id;
  turn: number;
  outcome?: string;
  proposals: Proposal[];
}

export interface Dialogue {
  open(spec: DialogueSpec): Promise<DialogueSession>;
  step(sessionId: Id): Promise<DialogueStep>;
  interject(sessionId: Id, actorId: ActorId, text: string): Promise<DialogueStep>;
  close(sessionId: Id, outcome?: string): Promise<DialogueSummary>;
}

/** 导演实现：新增对话形态 = 新增一个文件，不改引擎 */
export interface DialogueDirector {
  id: string;
  /** 决定这一轮谁说、说什么（可调 LLM） */
  nextTurn(session: DialogueSession, ctx: ModuleContext): Promise<DialogueStep>;
}

// ---------------------------------------------------------------- 记忆
export type MemoryTier = "short" | "long" | "permanent";
export type MemoryStatus = "current" | "historical" | "tombstoned";

export interface MemoryDraft {
  ownerId: ActorId;
  content: string;
  tags?: string[];
  salience?: number;
  about?: ActorId[];
  visibility?: "public" | "private" | "secret";
  /** 视角化写入：这版记忆里"不知道"的部分 */
  doesntKnow?: string[];
  /** 3.1.0：分档；turn 只产 short/long，permanent 只由 canonize 产 */
  tier?: MemoryTier;
  /** 3.1.0：账号维度（私忆隔离）；缺省由引擎按房间成员推 */
  userId?: Id;
  /** 永久层必填（≤8 个已提交 evt_* / canon id） */
  sourceRefs?: Id[];
  /** 永久层幂等键（sha256 前 64 位十六进制） */
  contentHash?: string;
  status?: MemoryStatus;
  /** tombstone / 替换旧条目时必填：被撤回或替换的旧记忆 id */
  supersedes?: Id;
  /** 反查印象用 */
  aboutUserIds?: Id[];
}

export interface MemoryRecord {
  id: Id;
  /** 世界层用 room_world_<worldId> */
  roomId: RoomId;
  /** permanent 必填 */
  worldId?: Id;
  /** 账号维度；世界层历史条目可为空 */
  userId?: Id;
  /** permanent 固定 "mem_world"（不是实体） */
  ownerId: ActorId;
  content: string;
  tags: string[];
  /** 1~5（与 zod 对齐，历史数据 0~100 读时按 /20 收敛到 1~5） */
  salience: number;
  about: ActorId[];
  aboutUserIds?: Id[];
  visibility: "public" | "private" | "secret";
  tier: MemoryTier;
  sourceRefs?: Id[];
  contentHash?: string;
  /** permanent 必填，其余可省（缺省视为 current） */
  status?: MemoryStatus;
  turn: number;
  createdAt: number;
  archived?: boolean;
}

export interface MemoryHit {
  record: MemoryRecord;
  score: number;
  /** secret 命中走强制注入通道，不参与打分 */
  forced?: boolean;
}

export interface MemoryQuery {
  /** scope="world" 时传 room_world_<worldId> */
  roomId: RoomId;
  /** 给了就按账号过滤（私忆隔离：A 的 private 记忆 B 查不到） */
  userId?: Id;
  ownerId: ActorId;
  tiers?: MemoryTier[];
  scope?: "room" | "world";
  worldId?: Id;
  about?: ActorId[];
  tags?: string[];
  budgetTokens: number;
  nowTurn: number;
}

export interface MemoryProfile {
  userId: Id;
  roomId: RoomId;
  ownerId: ActorId;
  firstMetTurn?: number;
  /** 0~1，派生：short 条数 + 互相 remembered 的权重 */
  familiarity: number;
  /** 该 owner 记住的 permanent 条目 */
  impressionIds: Id[];
  /** 账号级世界印象计数（跨房间） */
  impressions: number;
  lastTopics: string[];
  /** 已投递印象（由 server 投影注入） */
  seenImpressionIds: Id[];
}

/** 世界印象：canonize 通过后排队、下回合用 facts 投递给玩家（不调模型） */
export interface ImpressionNotice {
  id: Id;
  memoryId: Id;
  userId: Id;
  worldId: Id;
  /** ≤40 字，去掉私密细节 */
  subjectText: string;
  npcId?: Id;
  createdAt: number;
  deliveredAt?: number;
}

export interface Memory {
  /** 测试用，不参与正式写路径（正式路径：Proposal → Arbiter.apply → 事件 → ingest） */
  write(roomId: RoomId, drafts: MemoryDraft[]): Promise<void>;
  recall(q: MemoryQuery): Promise<MemoryHit[]>;
  /** 纯派生：不创建实体、不产事件；无记录返回 null */
  profile(userId: Id, ownerId: ActorId, roomId: RoomId): Promise<MemoryProfile | null>;
  compact(roomId: RoomId, ownerId: ActorId): Promise<{ impressions: number; archived: number }>;
}

// ---------------------------------------------------------------- 视图（前端只渲染它）
export interface ViewPosition {
  locId: Id;
  name: string;
  actors: { actorId: ActorId; name: string; present: boolean }[];
  exits: { locId: Id; name: string }[];
}

export interface ViewPatch {
  /** 面板数据：读 registry 渲染，不是硬编码字段 */
  panels?: Record<string, { label: string; value: AttrValue; unit?: string }[]>;
  position?: ViewPosition;
  /** 结构化列表（商店、任务、对话记录…） */
  lists?: { id: string; title: string; items: { key: string; text: string; meta?: unknown }[] }[];
  /** 叙事文本（流式阶段的最终版本） */
  narrative?: string;
  dialogue?: { actorId: ActorId; name: string; text: string }[];
}

// ---------------------------------------------------------------- 引擎门面
export interface Arbiter {
  apply(roomId: RoomId, ops: Proposal[], cause: Envelope, opts?: ApplyOptions): Promise<ApplyResult>;
  dryRun(roomId: RoomId, ops: Proposal[]): Promise<ValidationResult>;
}

export interface Turn {
  run(req: TurnRequest): AsyncIterable<TurnEvent>;
}

export interface Transport {
  subscribe(roomId: RoomId, actorId: ActorId, fromSeq: number, sink: (e: Envelope) => void): () => void;
  /** 只投递信封，不做业务判断；audience 过滤在内部完成 */
  publish(env: Envelope): void;
  presence(roomId: RoomId): ActorId[];
}

export interface Store {
  snapshot(roomId: RoomId): Promise<WorldState>;
  events(roomId: RoomId, fromSeq: number, limit?: number): Promise<Envelope[]>;
  replay(roomId: RoomId, toSeq?: number): Promise<WorldState>;
  /**
   * 等待已追加事件真正落盘（内存实现是 no-op）。
   * 提交 `turn.commit` 之前必须 await 它：内存提交 ≠ 可靠存档。
   */
  flush(roomId: RoomId): Promise<void>;
}
