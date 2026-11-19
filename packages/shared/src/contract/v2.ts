/**
 * dev/v2 加法契约：群聊式多方对话。
 *
 * 规则：只加不改。v1 的 Turn / Dialogue / TurnEvent / 12 op / ErrorCode 全部原样保留；
 * v2 的所有新名字都在这里，调用方自己选 v1 还是 v2 入口。
 */
import type { ActorId, Id, Proposal, RoomId, Usage, WorldState } from "./types.ts";

// ---------------------------------------------------------------- 投递通道
/** 看见哪一部分（与 Envelope.audience "看不看得见"叠加使用） */
export type Channel = "content" | "action" | "notice";

/** 一次说话的四段结构（目标 / 类型 / 行动 / 内容） */
export interface Utterance {
  id: Id;
  speaker: ActorId;
  /**
   * 被 @ 的人；缺省 = 全体。
   * "all" = 显式 @所有人；数组 = @多人（两者都会唤醒场景 agent）。
   */
  target?: ActorId | "all" | ActorId[];
  /** 说话类型：id 来自 content/v2/utterance-modes.json；字符串而非 union → 加模式不改类型 */
  mode: string;
  content?: string;
  /** 完整动作（目标/公开视角；含意义） */
  action?: string;
  /** 低信息动作（非目标视角；缺省由 mode.actionVocab 生成） */
  coverAction?: string;
  notice?: string;
}

/** 模式定义（数据在 content/v2/utterance-modes.json，引擎只写通用解释器） */
export interface UtteranceModeDef {
  id: string;
  label: string;
  requiresAction: boolean;
  targetChannels: Channel[];
  otherChannels: Channel[];
  /** coverAction 缺省时的候选池 */
  actionVocab?: string[];
  /** 该模式不携带 content（只传动作），由数据声明 */
  contentless?: boolean;
  /** @公开时是否给非目标加「对 X 说」标记 */
  addressedNotice?: boolean;
  /** 该模式是否必须且只能 @ 一个目标（数据驱动，引擎不认具体 mode id） */
  requiresTarget?: boolean;
  /** 该模式产出的私忆可见性；缺省 private（fail-closed，不降级为 public） */
  visibility?: "public" | "private" | "secret";
  /** addressedNotice 的文案模板，{target} 在投递时替换；中文只放数据不放引擎 */
  addressedNoticeText?: string;
  /** 目标是否必须在场；缺省 present。微信私信模式声明 any */
  targetPresence?: "present" | "any";
}

/** 单个接收方实际收到的内容：前端只渲染自己那条，绝不拿原文兜底 */
export interface Delivery {
  /** 接收方 actorId（玩家也在其中） */
  to: ActorId;
  /** 说话者（前端显示"谁说的"） */
  speaker: ActorId;
  utteranceId: Id;
  mode: string;
  channels: Channel[];
  content?: string;
  action?: string;
  notice?: string;
}

// ---------------------------------------------------------------- 心理活动
/**
 * NPC 的内心。每轮生成，允许行动计划（用户拍板），但计划**不自动执行**：
 * 它只是 secret 记忆，下一轮该 NPC 自己决定要不要落实成 Proposal（I1 不破）。
 */
export interface MentalActivity {
  actorId: ActorId;
  /** 模拟思考：必须有因果逻辑与世界相关性 */
  thought: string;
  /** 可包含的行动计划；不自动执行 */
  plan?: string;
  salience: number; // 1..5
  about?: ActorId[];
}

// ---------------------------------------------------------------- 场景 agent
export interface SceneBeat {
  id: Id;
  kind: "opening" | "summary";
  roomId: RoomId;
  locId?: Id;
  text: string;
  createdAt: number;
  /** summary 排在玩家发言之前（换地点）/之后（@多人） */
  order: "before" | "after";
}

/** 半常驻注入：放在 S1.5 世界记忆段之后，forced、按 id 排序保缓存 */
export interface SceneMemory {
  id: Id;
  roomId: RoomId;
  worldId?: Id;
  origin: "scene";
  text: string;
  createdAt: number;
}

// ---------------------------------------------------------------- 会话
export type ConversationPhase = "speaking" | "listening";

export interface ConversationSessionV2 {
  id: Id;
  roomId: RoomId;
  participants: ActorId[];
  phase: ConversationPhase;
  turn: number;
  maxTurns: number;
  status: "open" | "closed";
  /** 当前正在说话的人（listening 时要等他说完） */
  speaking?: ActorId;
  /** 待结算的发言队列 */
  queue: Utterance[];
  /** 玩家插话（phase=listening 时攒着） */
  injected: Utterance[];
  sceneBeats: SceneBeat[];
  sceneMemory?: SceneMemory;
  /** 玩家在场但没说话时的连续 NPC 发言数（硬上限/软惩罚用） */
  npcSpeechStreak: number;
  /** phase=listening 的起始时间；listenTimeoutMs 到期自动恢复 speaking */
  listenSince?: number;
  /** 最近一次观察到的地点（换地点唤醒用，会话内维护） */
  lastLocId?: Id;
  visibility: "private" | "scene" | "public";
}

export interface ConversationPolicy {
  /** 玩家不在场时是否允许 NPC 自主续聊 */
  autonomousWhenPlayerAbsent: boolean;
  /** 玩家在场时纯 NPC 连续发言硬上限（之后只 think 不 speak）；0 = 无上限 */
  npcHardCap: number;
  /** 纯 NPC 会话的总轮次上限 */
  maxTurns: number;
  /** 玩家点插话后迟迟不说话的自动恢复毫秒数 */
  listenTimeoutMs: number;
  /** 模型漏写 mode 时的兜底：从模式数据里按 id 取，取不到就 fail-closed（沉默） */
  defaultMode: string;
  /** @全体/@多人 是否唤醒场景 agent */
  wakeOnMultiTarget: boolean;
  /** 换地点是否唤醒场景 agent */
  wakeOnLocationChange: boolean;
  /** 文本上限 */
  maxContent: number;
  maxAction: number;
  maxThought: number;
  maxPlan: number;
  /** 模型调用参数（数据化，避免引擎硬编码） */
  llm: { temperature: number; maxTokens: number };
  /** 异步自主对话/微信的节流参数；引擎在调 LLM 之前消费 */
  autonomy: {
    minReplyIntervalMs: number;
    maxMessagesPerNpcPerHour: number;
    maxNpcCallsPerTick: number;
    maxTurnsPerTick: number;
    idleTimeoutMs: number;
    playerPresentGraceMs: number;
  };
  /** 校验错误文案（数据化，引擎内不写死中文） */
  messages: {
    unknownMode: string;
    speakerAbsent: string;
    targetRequired: string;
    targetAbsent: string;
    actionRequired: string;
    contentTooLong: string;
    actionTooLong: string;
    userPrompt: string;
    invalidUtterance: string;
    auditUnavailable: string;
    modeFileEmpty: string;
    sessionNotFound: string;
    storeUnavailable: string;
    memoryRejected: string;
    storeFlushFailed: string;
  };
}

export const DEFAULT_CONVERSATION_POLICY: ConversationPolicy = {
  npcHardCap: 6,
  maxTurns: 40,
  listenTimeoutMs: 30_000,
  autonomousWhenPlayerAbsent: true,
  defaultMode: "broadcast",
  wakeOnMultiTarget: true,
  wakeOnLocationChange: true,
  maxContent: 400,
  maxAction: 120,
  maxThought: 300,
  maxPlan: 200,
  llm: { temperature: 0.7, maxTokens: 600 },
  autonomy: {
    minReplyIntervalMs: 30_000,
    maxMessagesPerNpcPerHour: 12,
    maxNpcCallsPerTick: 4,
    maxTurnsPerTick: 2,
    idleTimeoutMs: 300_000,
    playerPresentGraceMs: 60_000,
  },
  messages: {
    unknownMode: "unknown utterance mode",
    speakerAbsent: "speaker is not present",
    targetRequired: "exactly one present target is required",
    targetAbsent: "target is not present",
    actionRequired: "an action is required",
    contentTooLong: "content exceeds the limit",
    actionTooLong: "action exceeds the limit",
    userPrompt: "按上面的 JSON 格式输出你这一轮的决定。",
    invalidUtterance: "invalid utterance",
    auditUnavailable: "auditor unavailable; nothing was published",
    modeFileEmpty: "language file declares no mode",
    sessionNotFound: "session does not exist or is closed",
    storeUnavailable: "storage unavailable; safe to retry",
    memoryRejected: "memory write rejected; utterance was not stored",
    storeFlushFailed: "store.flush failed",
  },
};

/** NPC 单次独立 LLM 的输出：说话 / 心理活动 / 沉默（三者互斥） */
export type NpcDecision =
  | { kind: "speak"; utterance: Utterance }
  | { kind: "think"; mental: MentalActivity }
  | { kind: "silent"; reason?: string };

// ---------------------------------------------------------------- 会话端口
export interface ConversationSpecV2 {
  roomId: RoomId;
  participants: ActorId[];
  maxTurns?: number;
  seed?: string;
  visibility?: ConversationSessionV2["visibility"];
}

export interface ConversationTurnInput {
  /** 玩家本轮发言；不传 = 玩家沉默（NPC 自主续聊） */
  utterance?: Utterance;
  /** 玩家点插话：切换 phase 到 listening */
  interject?: ActorId;
  clientTurnId: string;
  userId?: Id;
}

// ---------------------------------------------------------------- 事件（新 union，不改 TurnEvent）
export type ConversationEvent =
  | { type: "conversation.opened"; sessionId: Id; participants: ActorId[] }
  | { type: "conversation.utterance"; delivery: Delivery }
  | { type: "conversation.mental"; actorId: ActorId; mental: MentalActivity }
  | { type: "conversation.scene"; beat: SceneBeat }
  | { type: "conversation.phase"; sessionId: Id; phase: ConversationPhase }
  | { type: "conversation.notice"; text: string; facts?: string[] }
  | { type: "conversation.committed"; sessionId: Id; turn: number; proposals: Proposal[]; usage?: Usage; state: WorldState }
  | { type: "conversation.error"; sessionId: Id; code: string; message: string; retryable?: boolean };

/** v2 编排入口（与 v1 Turn 并列） */
export interface ConversationTurnV2 {
  run(sessionId: Id, input: ConversationTurnInput): AsyncIterable<ConversationEvent>;
}

// ---------------------------------------------------------------- 微信私信（dev/v2 加法）
export type MsgKind = "gossip" | "reply" | "player" | "system";

/** 事件投影出来的私信记录；不进 WorldState，ID 由事件 seq 决定，可回放 */
export interface MessageRecord {
  id: Id;
  roomId: RoomId;
  from: ActorId;
  to: ActorId;
  kind: MsgKind;
  content: string;
  rootId?: Id;
  replyTo?: Id;
  hop: number;
  confidence: number;
  visibility: "private";
  createdAt: number;
  seq: number;
}

/** NPC 提示词里看到的收件箱摘要；只有发送者/内容/时间 */
export interface MessageDigest {
  id: Id;
  from: ActorId;
  kind: MsgKind;
  content: string;
  rootId?: Id;
  hop: number;
  createdAt: number;
}

export interface GossipPolicy {
  minReplyIntervalMs: number;
  maxMessagesPerNpcPerHour: number;
  maxNpcCallsPerTick: number;
  maxHops: number;
  confidenceDecay: number;
  actionVocab?: string[];
  messages: {
    system: string;
    format: string;
    rules: string;
    untrusted: string;
    inboxEmpty: string;
    replyFormat: string;
  };
}

export type GossipDecision =
  | { kind: "relay"; content: string }
  | { kind: "distort"; content: string }
  | { kind: "reply"; content: string }
  | { kind: "ignore"; reason?: string };

export type GossipEvent =
  | { type: "gossip.message"; message: MessageRecord }
  | { type: "gossip.delivered"; id: Id; to: ActorId }
  | { type: "gossip.dropped"; id: Id; reason: string; nextAt?: number }
  | { type: "gossip.committed"; ids: Id[] }
  | { type: "gossip.error"; code: string; message: string; retryable?: boolean };

/** dev/v2 两条独立提示词版本线：会话群聊 / 微信八卦，互不覆盖 */
export const CONVERSATION_PROMPT_VERSION = "2026-11-19.2" as const;
export const GOSSIP_PROMPT_VERSION = "2026-11-19.1" as const;
