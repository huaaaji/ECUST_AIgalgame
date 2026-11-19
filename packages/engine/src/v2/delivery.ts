/**
 * 投递解释器（dev/v2）：把一次说话按"模式定义"翻译成每个接收方实际看到的通道内容。
 * 引擎里没有针对具体 mode id 的分支 —— 规则全在 utterance-modes.json，本文件只按字段解释。
 */
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { ActorId, Id, Utterance, Channel, Delivery, UtteranceModeDef } from "../../../shared/src/index.ts";
import { DEFAULT_CONVERSATION_POLICY, type ConversationPolicy } from "../../../shared/src/index.ts";

const ModeSchema: z.ZodType<UtteranceModeDef> = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  requiresAction: z.boolean(),
  targetChannels: z.array(z.enum(["content", "action", "notice"])),
  otherChannels: z.array(z.enum(["content", "action", "notice"])),
  actionVocab: z.array(z.string()).optional(),
  addressedNotice: z.boolean().optional(),
  addressedNoticeText: z.string().optional(),
  requiresTarget: z.boolean().optional(),
  contentless: z.boolean().optional(),
  visibility: z.enum(["public", "private", "secret"]).optional(),
  targetPresence: z.enum(["present", "any"]).optional(),
});

const ModesFileSchema = z.object({ schemaVersion: z.number(), modes: z.array(ModeSchema) });
const PolicyFileSchema = z.object({
  schemaVersion: z.number(),
  npcHardCap: z.number().int().nonnegative().optional(),
  maxTurns: z.number().int().positive().optional(),
  listenTimeoutMs: z.number().int().positive().optional(),
  autonomousWhenPlayerAbsent: z.boolean().optional(),
  defaultMode: z.string().min(1).optional(),
  wakeOnMultiTarget: z.boolean().optional(),
  wakeOnLocationChange: z.boolean().optional(),
  maxContent: z.number().int().positive().optional(),
  maxAction: z.number().int().positive().optional(),
  maxThought: z.number().int().positive().optional(),
  maxPlan: z.number().int().positive().optional(),
  llm: z.object({ temperature: z.number(), maxTokens: z.number().int().positive() }).optional(),
  autonomy: z.object({
    minReplyIntervalMs: z.number().int().positive(), maxMessagesPerNpcPerHour: z.number().int().positive(),
    maxNpcCallsPerTick: z.number().int().positive(), maxTurnsPerTick: z.number().int().positive(),
    idleTimeoutMs: z.number().int().positive(), playerPresentGraceMs: z.number().int().nonnegative(),
  }).partial().optional(),
  messages: z.object({
    unknownMode: z.string(), speakerAbsent: z.string(), targetRequired: z.string(), targetAbsent: z.string(),
    actionRequired: z.string(), contentTooLong: z.string(), actionTooLong: z.string(), userPrompt: z.string(),
  }).partial().optional(),
});

/** 载入模式定义；坏数据 fail-closed（抛错，不静默放行） */
export async function loadModes(path: string): Promise<Map<string, UtteranceModeDef>> {
  const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  const parsed = ModesFileSchema.parse(raw);
  const out = new Map<string, UtteranceModeDef>();
  for (const m of parsed.modes) out.set(m.id, m);
  if (out.size === 0) throw new Error(DEFAULT_CONVERSATION_POLICY.messages.modeFileEmpty);
  return out;
}

export async function loadConversationPolicy(path: string): Promise<ConversationPolicy> {
  const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  const p = PolicyFileSchema.parse(raw);
  const { schemaVersion: _ignored, messages, llm, ...rest } = p;
  return {
    ...DEFAULT_CONVERSATION_POLICY,
    ...rest,
    llm: { ...DEFAULT_CONVERSATION_POLICY.llm, ...llm },
    autonomy: { ...DEFAULT_CONVERSATION_POLICY.autonomy, ...p.autonomy },
    messages: { ...DEFAULT_CONVERSATION_POLICY.messages, ...messages },
  };
}

export interface ValidateResult {
  ok: boolean;
  code?: string;
  message?: string;
  /** 被规整后的 utterance（补齐 coverAction / 去掉 signal 的 content） */
  value?: Utterance;
}

/**
 * 说话前的纯校验 + 规整。不写状态、不调模型。
 * 复用现有 E_SCHEMA_INVALID / E_OVER_LIMIT / E_REF_NOT_FOUND，不新增错误码（不动 check-contract）。
 */
export function validateUtterance(
  u: Utterance,
  modes: Map<string, UtteranceModeDef>,
  policy: ConversationPolicy,
  present: readonly ActorId[],
): ValidateResult {
  const mode = modes.get(u.mode);
  if (!mode) return { ok: false, code: "E_SCHEMA_INVALID", message: `${policy.messages.unknownMode}: ${u.mode}` };
  if (!present.includes(u.speaker)) {
    return { ok: false, code: "E_REF_NOT_FOUND", message: `${policy.messages.speakerAbsent}: ${u.speaker}` };
  }
  // 数据驱动：是否需要单目标由模式定义给，引擎不认具体 id（I3）
  const needsTarget = mode.requiresTarget === true;
  const targets = Array.isArray(u.target) ? u.target : u.target && u.target !== "all" ? [u.target] : [];
  // requiresTarget 一律要求具名在场目标；"all" 只留给不需要目标的模式
  if (needsTarget && (!u.target || u.target === "all" || Array.isArray(u.target))) return { ok: false, code: "E_SCHEMA_INVALID", message: policy.messages.targetRequired };
  if (mode.targetPresence !== "any") {
    for (const t of targets) {
      if (!present.includes(t)) return { ok: false, code: "E_REF_NOT_FOUND", message: `${policy.messages.targetAbsent}: ${t}` };
    }
  }
  if (mode.requiresAction && !u.action?.trim()) {
    return { ok: false, code: "E_SCHEMA_INVALID", message: policy.messages.actionRequired };
  }
  if (u.content && u.content.length > policy.maxContent) {
    return { ok: false, code: "E_OVER_LIMIT", message: policy.messages.contentTooLong };
  }
  if (u.action && u.action.length > policy.maxAction) {
    return { ok: false, code: "E_OVER_LIMIT", message: policy.messages.actionTooLong };
  }

  // contentless 模式只传动作（信息密度限制）；由数据声明，不是 mode id 硬编码
  const value: Utterance = mode.contentless ? { ...u, content: undefined } : { ...u };
  // coverAction 缺省：从词表按 id 稳定取一条（同 id 永远同一动作，便于回放）
  if (!value.coverAction && mode.actionVocab?.length) {
    value.coverAction = mode.actionVocab[stableIndex(value.id, mode.actionVocab.length)];
  }
  return { ok: true, value };
}

/** 稳定哈希（不为随机，回放要逐字节一致） */
function stableIndex(id: Id, len: number): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) % len;
}

export interface DeliverOptions {
  /** 接收方名单（调用方已按 audience / 在场过滤） */
  recipients: readonly ActorId[];
  modes: Map<string, UtteranceModeDef>;
  /** @公开时给非目标的提示文案生成器 */
  noticeFor?: (target: ActorId) => string;
}

/** 按模式定义算每个接收方看到的通道；玩家也在 recipients 里，规则对所有人一致 */
export function deliver(u: Utterance, opts: DeliverOptions): Delivery[] {
  const mode = opts.modes.get(u.mode);
  if (!mode) return [];
  // 纵深防御：即便调用方漏了 validateUtterance，私密模式也不得把 content 投向全场
  if (mode.requiresTarget && (!u.target || u.target === "all" || Array.isArray(u.target))) return [];
  const isTarget = (to: ActorId): boolean =>
    !u.target || u.target === "all" || (Array.isArray(u.target) ? u.target.includes(to) : to === u.target) || to === u.speaker;
  const out: Delivery[] = [];
  for (const to of opts.recipients) {
    const channels = isTarget(to) ? mode.targetChannels : mode.otherChannels;
    if (channels.length === 0) continue;
    const payload: Delivery = {
      to,
      speaker: u.speaker,
      utteranceId: u.id,
      mode: u.mode,
      channels: [...channels],
    };
    for (const ch of channels) {
      if (ch === "content" && u.content) payload.content = u.content;
      // action 通道：目标看到完整 action，非目标看到 coverAction（悄悄话=凑耳；不动声色=无意义小动作）
      if (ch === "action") {
        const text = isTarget(to) ? u.action : (u.coverAction ?? u.action);
        if (text) payload.action = text;
      }
      if (ch === "notice") {
        if (mode.addressedNotice && targetsOf(u).length) {
          const list = targetsOf(u);
          payload.notice = list.map((t) => opts.noticeFor?.(t) ?? mode.addressedNoticeText?.replace("{target}", t) ?? `to ${t}`).join("、");
        } else if (u.notice) payload.notice = u.notice;
      }
    }
    // 一个通道都没填出内容就不投（比如 mode 声明了 content 但模型没写）
    if (payload.content || payload.action || payload.notice) out.push(payload);
  }
  return out;
}

function targetsOf(u: Utterance): ActorId[] {
  return Array.isArray(u.target) ? u.target : u.target && u.target !== "all" ? [u.target] : [];
}

/** 通道集合的纯工具：供上下文渲染/前端裁剪复用 */
export function pickChannels(d: Delivery, keys: readonly Channel[]): Partial<Delivery> {
  const out: Partial<Delivery> = { ...d, channels: d.channels.filter((c) => keys.includes(c)) };
  if (!out.channels?.includes("content")) delete out.content;
  if (!out.channels?.includes("action")) delete out.action;
  if (!out.channels?.includes("notice")) delete out.notice;
  return out;
}
