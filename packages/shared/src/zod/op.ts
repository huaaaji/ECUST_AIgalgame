/**
 * op 原语 zod schema：12 个是闭集（03 §3）。真源是 contract/types.ts 的 OpArgs。
 * 这里只做"形状 + 枚举"校验；数值钳制、邻接、canon 锁定等语义裁决属于 Arbiter。
 */
import { z } from "zod";
import type { OpName } from "../contract/types.ts";
import { OP_NAMES } from "../contract/types.ts";
import {
  ActorIdSchema,
  AttrValueSchema,
  EntityKindSchema,
  EntityStatusSchema,
  IdSchema,
  LinkKindSchema,
  OriginSchema,
  PhaseSchema,
} from "./entity.ts";

/** OP_NAMES 是 readonly 数组，z.enum 需要非空元组；用一次窄化让"名字只有一个来源" */
const OP_NAME_TUPLE = OP_NAMES as unknown as [OpName, ...OpName[]];

export const OpNameSchema = z.enum(OP_NAME_TUPLE).describe("12 个 op 原语名，闭集，逐字对齐 03 §3");
export type OpNameParsed = z.infer<typeof OpNameSchema>;

const BySchema = z
  .string()
  .max(64)
  .describe("提议来源：mod.<moduleId> / npc.director / engine.turn");
const ReasonSchema = z.string().max(60).describe("一句话说明为什么，≤60 字，只进日志");

// ---------------------------------------------------------------- 1 attr.delta
export const AttrDeltaArgsSchema = z
  .object({
    entityId: IdSchema.describe("被改的实体"),
    key: IdSchema.describe("属性键：必须在 registry 声明，或以 x. 开头（x 区不校验类型）"),
    delta: z.number().finite().describe("增量，可负；越界由 Arbiter 按 registry min/max 钳制"),
    mustKeep: z
      .boolean()
      .optional()
      .describe("强约束：被钳制（余额/额度不足）即整条拒绝 E_PRECONDITION，用于支付类操作"),
  })
  .describe("attr.delta：按增量改属性，产出 attr.changed。同回合累计超 maxDeltaPerTurn 会被钳制（mustKeep 时改为拒绝）");
export type AttrDeltaArgsParsed = z.infer<typeof AttrDeltaArgsSchema>;

// ---------------------------------------------------------------- 2 attr.set
export const AttrSetArgsSchema = z
  .object({
    entityId: IdSchema.describe("被改的实体"),
    key: IdSchema.describe("属性键（同上，registry 或 x. 区）"),
    value: AttrValueSchema.describe("新值，整体覆盖"),
  })
  .describe("attr.set：直接设值，产出 attr.changed；canon 实体的白名单外属性会被拒（E_CANON_LOCKED）");
export type AttrSetArgsParsed = z.infer<typeof AttrSetArgsSchema>;

// ---------------------------------------------------------------- 3 entity.create
export const EntityCreateArgsSchema = z
  .object({
    id: IdSchema.describe("新实体 id；已存在则拒绝（E_ID_TAKEN），id 永不复用"),
    kind: EntityKindSchema,
    name: z.string().min(1).max(64).describe("显示名"),
    attrs: z.record(AttrValueSchema).optional().describe("初始属性，键受 registry / x. 区约束"),
    tags: z.array(z.string().max(32)).max(32).optional().describe("检索标签"),
    origin: OriginSchema.optional().describe("来源；AI 生成必须是 ai"),
    canon: z.boolean().optional().describe("是否人工锁定；AI 产出只能是 false"),
  })
  .describe("entity.create：新建实体，产出 entity.created");
export type EntityCreateArgsParsed = z.infer<typeof EntityCreateArgsSchema>;

// ---------------------------------------------------------------- 4 entity.update
export const EntityUpdateArgsSchema = z
  .object({
    entityId: IdSchema.describe("目标实体"),
    name: z.string().min(1).max(64).optional().describe("改名（canon 实体通常被锁）"),
    tags: z.array(z.string().max(32)).max(32).optional().describe("整体替换标签"),
    status: EntityStatusSchema.optional().describe("状态迁移"),
  })
  .describe("entity.update：改名字/标签/状态，产出 entity.updated。属性变更走 attr.* 而不是这里");
export type EntityUpdateArgsParsed = z.infer<typeof EntityUpdateArgsSchema>;

// ---------------------------------------------------------------- 5 entity.tombstone
export const EntityTombstoneArgsSchema = z
  .object({
    entityId: IdSchema.describe("要软删除的实体"),
    reason: ReasonSchema.optional().describe("删除原因，进事件日志"),
  })
  .describe("entity.tombstone：软删除（保留记录、id 不复用），产出 entity.tombstoned");
export type EntityTombstoneArgsParsed = z.infer<typeof EntityTombstoneArgsSchema>;

// ---------------------------------------------------------------- 6 link.create
export const LinkCreateArgsSchema = z
  .object({
    kind: LinkKindSchema.describe("关系类型"),
    from: IdSchema.describe("起点实体"),
    to: IdSchema.describe("终点实体"),
    weight: z.number().min(0).max(100).optional().describe("关系强度 0~100"),
    audience: z.array(ActorIdSchema).max(16).optional().describe("可见范围（空=公开）"),
  })
  .describe("link.create：建关系边，产出 link.created；重复建同一条边按 kind+from+to 去重");
export type LinkCreateArgsParsed = z.infer<typeof LinkCreateArgsSchema>;

// ---------------------------------------------------------------- 7 link.remove
export const LinkRemoveArgsSchema = z
  .object({
    linkId: IdSchema.optional().describe("按边 id 精确删除"),
    kind: LinkKindSchema.optional().describe("按类型匹配"),
    from: IdSchema.optional().describe("按起点匹配"),
    to: IdSchema.optional().describe("按终点匹配"),
  })
  .describe("link.remove：删关系边，产出 link.removed。linkId 或 kind/from/to 至少要给一个，否则匹配到空集")
  .refine(
    (v) => v.linkId !== undefined || v.kind !== undefined || v.from !== undefined || v.to !== undefined,
    { message: "link.remove 需要 linkId 或至少一个 kind/from/to" },
  );
export type LinkRemoveArgsParsed = z.infer<typeof LinkRemoveArgsSchema>;

// ---------------------------------------------------------------- 8 move.to
export const MoveToArgsSchema = z
  .object({
    actorId: ActorIdSchema.describe("移动的玩家/NPC"),
    locId: IdSchema.describe("目标地点实体；不邻接则拒绝（E_NOT_ADJACENT）"),
  })
  .describe("move.to：移动并更新 scene.presentIds，产出 actor.moved；邻接判断由 Arbiter 做");
export type MoveToArgsParsed = z.infer<typeof MoveToArgsSchema>;

// ---------------------------------------------------------------- 9 time.advance
export const TimeAdvanceArgsSchema = z
  .object({
    ticks: z.number().int().min(1).max(8).optional().describe("推进几行；不填=1"),
    phase: PhaseSchema.optional().describe("直接跳到指定时段"),
  })
  .describe("time.advance：推进游戏内时间，产出 clock.advanced；入夜触发 tick.night");
export type TimeAdvanceArgsParsed = z.infer<typeof TimeAdvanceArgsSchema>;

// ---------------------------------------------------------------- 10 scene.set
export const SceneSetArgsSchema = z
  .object({
    locId: IdSchema.optional().describe("切换地点"),
    presentIds: z.array(ActorIdSchema).max(16).optional().describe("★ 整体替换在场者（唯一真源）"),
    props: z.array(IdSchema).max(32).optional().describe("整体替换场景道具"),
  })
  .describe("scene.set：改场景，产出 scene.changed；present 边由引擎据此重建");
export type SceneSetArgsParsed = z.infer<typeof SceneSetArgsSchema>;

// ---------------------------------------------------------------- 11 memory.write
export const MemoryWriteArgsSchema = z
  .object({
    ownerId: ActorIdSchema.describe("记忆所有者（谁记得这件事）"),
    content: z.string().min(1).max(200).describe("记忆内容（视角化之后的一句话）"),
    tags: z.array(z.string().max(32)).max(4).optional().describe("检索标签，1~4 个"),
    salience: z.number().min(1).max(5).optional().describe("重要度 1~5，影响召回排序"),
    visibility: z
      .enum(["public", "private", "secret"])
      .optional()
      .describe("可见性；secret 走强制注入通道，只有引擎/导演骨架能写"),
    about: z.array(ActorIdSchema).max(8).optional().describe("关于谁的记忆"),
    userId: IdSchema.optional().describe("账号维度（私忆隔离用）"),
    worldId: IdSchema.optional().describe("世界层所属世界（permanent 必填）"),
    tier: z
      .enum(["short", "long", "permanent"])
      .optional()
      .describe("分档；turn 只允许 short/long，permanent 只由 canonize 产生"),
    sourceRefs: z.array(IdSchema).max(8).optional().describe("永久层来源（已提交 evt_* / canon id）"),
    contentHash: z.string().max(64).optional().describe("永久层幂等键"),
    status: z
      .enum(["current", "historical", "tombstoned"])
      .optional()
      .describe("永久层状态；tombstoned 必须带 supersedes"),
    supersedes: IdSchema.optional().describe("被撤回/替换的旧记忆 id"),
    aboutUserIds: z.array(IdSchema).max(8).optional().describe("反查印象用的账号 id"),
  })
  .describe("memory.write：写一条视角化记忆，产出 memory.written；模块不可写 secret");
export type MemoryWriteArgsParsed = z.infer<typeof MemoryWriteArgsSchema>;

/**
 * 模型输出的记忆草稿（03 §2.4 `memory[]` 字段、docs/02 §4.4）。
 * 与 op 参数的区别：**没有 ownerId** —— 谁记得这件事由引擎决定（当前对谈的 NPC），
 * 也不允许模型自己声明 permanent（只有 canonize 能产）。
 */
export const LlmMemoryDraftSchema = z
  .object({
    content: z.string().min(1).max(200).describe("一句话记忆（像人记的事，不像日志）"),
    tags: z.array(z.string().max(32)).max(4).optional().describe("检索标签，1~4 个"),
    salience: z.number().min(1).max(5).optional().describe("重要度 1~5"),
    about: z.array(ActorIdSchema).max(8).optional().describe("关于谁的记忆"),
    userId: IdSchema.optional().describe("账号维度（私忆隔离用）"),
    worldId: IdSchema.optional().describe("世界层所属世界（permanent 必填）"),
    visibility: z.enum(["public", "private", "secret"]).optional().describe("secret 只有引擎/导演能写"),
    tier: z.enum(["short", "long"]).optional().describe("短期/长期；permanent 只由 canonize 产生"),
  })
  .describe("LLM 记忆草稿：ownerId 由引擎补，模型不许自填");
export type LlmMemoryDraftParsed = z.infer<typeof LlmMemoryDraftSchema>;

// ---------------------------------------------------------------- 12 plot.upsert
export const PlotUpsertArgsSchema = z
  .object({
    id: IdSchema.optional().describe("剧情线 id；不填=新建"),
    goal: z.string().min(1).max(120).describe("这条线的目标"),
    actors: z.array(ActorIdSchema).min(1).max(8).describe("参与者"),
    leverage: z.string().max(200).optional().describe("把柄/筹码"),
    risk: z.number().min(0).max(100).optional().describe("败露风险 0~100"),
    tone: z.string().max(40).optional().describe("基调"),
    leakPoints: z.array(z.string().max(80)).max(8).optional().describe("可被调查发现的痕迹"),
    forbidReveal: z.string().max(200).optional().describe("绝不能直说的真相"),
    status: z.enum(["active", "dormant", "resolved", "leaked"]).optional().describe("线状态"),
    guard: z
      .record(ActorIdSchema, z.number().min(0).max(100))
      .optional()
      .describe("参与者戒备值快照，引擎会同步到实体 attrs"),
  })
  .describe("plot.upsert：新建/更新剧情线，产出 plot.upserted；败露时转 leaked 并产出 plot.resolved");
export type PlotUpsertArgsParsed = z.infer<typeof PlotUpsertArgsSchema>;

// ---------------------------------------------------------------- 13 msg.send（dev/v2）
export const MsgSendArgsSchema = z
  .object({
    from: ActorIdSchema, to: ActorIdSchema,
    kind: z.enum(["gossip", "reply", "player", "system"]),
    content: z.string().min(1).max(400),
    rootId: IdSchema.optional(), replyTo: IdSchema.optional(),
    hop: z.number().int().min(0).max(12).optional(),
    confidence: z.number().min(0).max(1).optional(),
    visibility: z.literal("private").optional(),
  })
  .describe("msg.send：异步私信，只有目标与内容；产出 msg.sent，audience=[from,to]");
export type MsgSendArgsParsed = z.infer<typeof MsgSendArgsSchema>;

// ---------------------------------------------------------------- 13 分支联合
export const ProposalSchema = z
  .discriminatedUnion("op", [
    z.object({ op: z.literal("attr.delta"), args: AttrDeltaArgsSchema, reason: ReasonSchema.optional(), by: BySchema.optional() }),
    z.object({ op: z.literal("attr.set"), args: AttrSetArgsSchema, reason: ReasonSchema.optional(), by: BySchema.optional() }),
    z.object({ op: z.literal("entity.create"), args: EntityCreateArgsSchema, reason: ReasonSchema.optional(), by: BySchema.optional() }),
    z.object({ op: z.literal("entity.update"), args: EntityUpdateArgsSchema, reason: ReasonSchema.optional(), by: BySchema.optional() }),
    z.object({ op: z.literal("entity.tombstone"), args: EntityTombstoneArgsSchema, reason: ReasonSchema.optional(), by: BySchema.optional() }),
    z.object({ op: z.literal("link.create"), args: LinkCreateArgsSchema, reason: ReasonSchema.optional(), by: BySchema.optional() }),
    z.object({ op: z.literal("link.remove"), args: LinkRemoveArgsSchema, reason: ReasonSchema.optional(), by: BySchema.optional() }),
    z.object({ op: z.literal("move.to"), args: MoveToArgsSchema, reason: ReasonSchema.optional(), by: BySchema.optional() }),
    z.object({ op: z.literal("time.advance"), args: TimeAdvanceArgsSchema, reason: ReasonSchema.optional(), by: BySchema.optional() }),
    z.object({ op: z.literal("scene.set"), args: SceneSetArgsSchema, reason: ReasonSchema.optional(), by: BySchema.optional() }),
    z.object({ op: z.literal("memory.write"), args: MemoryWriteArgsSchema, reason: ReasonSchema.optional(), by: BySchema.optional() }),
    z.object({ op: z.literal("plot.upsert"), args: PlotUpsertArgsSchema, reason: ReasonSchema.optional(), by: BySchema.optional() }),
    z.object({ op: z.literal("msg.send"), args: MsgSendArgsSchema, reason: ReasonSchema.optional(), by: BySchema.optional() }),
  ])
  .describe("Proposal：模块/导演/记忆层唯一的输出形态；引擎裁决后才落库（I1 不变量）");
export type ProposalParsed = z.infer<typeof ProposalSchema>;

/** 编译期校验：联合里的 op 名集合必须与 OpName 完全相等（多一个/少一个都编译失败） */
export const OP_COVERAGE_CHECK: OpName extends ProposalParsed["op"]
  ? ProposalParsed["op"] extends OpName
    ? true
    : never
  : never = true;
