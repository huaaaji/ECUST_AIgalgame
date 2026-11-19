import { CONVERSATION_PROMPT_VERSION } from "../../../shared/src/index.ts";
/**
 * NPC agent（dev/v2）：**每个 NPC 各自一次独立 LLM 调用**，上下文只含它自己能看见的东西。
 * 绝不把"所有人的反应"塞进一次调用里——那会共享上下文、毁掉独立心智（用户拍板第 2 条）。
 * 输出三选一：speak（说话）/ think（心理活动）/ silent（沉默）。
 */
import { z } from "zod";
import type {
  ActorId,
  ConversationPolicy,
  Delivery,
  LlmPort,
  NpcDecision,
  Usage,
  Utterance,
  UtteranceModeDef,
  WorldState,
} from "../../../shared/src/index.ts";
import { mentalFraming } from "./scene.ts";
import { validateUtterance } from "./delivery.ts";
import type { MentalActivity } from "../../../shared/src/index.ts";

export interface NpcPromptArgs {
  /** 会话内单调轮次：utterance id 不用 Date.now，保证回放逐字节稳定 */
  turnKey?: number;
  npcId: ActorId;
  npcName: string;
  state: Readonly<WorldState>;
  /** 本次该 NPC 实际收到的通道内容（已被交付层裁剪） */
  deliveries: readonly Delivery[];
  /** 场景 agent 的半常驻注入（已渲染文本） */
  sceneText: string;
  /** 该 NPC 自己的记忆片段（已渲染） */
  memoryText: string;
  streak: number;
  playerPresent: boolean;
  hardCapReached: boolean;
  /** 玩家点了插话：本轮只听不说 */
  listening: boolean;
}

export interface NpcAgentDeps {
  llm: LlmPort;
  modes: Map<string, UtteranceModeDef>;
  policy: ConversationPolicy;
  buildPrompt?: (args: NpcPromptArgs) => string;
}

export interface NpcDecisionResult {
  decision: NpcDecision;
  usage?: Usage;
}

/** 模型原始输出：zod 在边界解析一次，之后都是强类型（AGENTS §6 zod-first） */
const RawDecisionSchema = z.object({
  kind: z.enum(["speak", "think", "silent"]).optional(),
  utterance: z
    .object({
      id: z.string().min(1).optional(),
      mode: z.string().min(1).optional(),
      target: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
      content: z.string().optional(),
      action: z.string().optional(),
      coverAction: z.string().optional(),
      notice: z.string().optional(),
    })
    .optional(),
  mental: z
    .object({
      thought: z.string().optional(),
      plan: z.string().optional(),
      salience: z.number().optional(),
      about: z.array(z.string()).optional(),
    })
    .optional(),
  reason: z.string().optional(),
});
type RawDecision = z.infer<typeof RawDecisionSchema>;

/** v2 提示词内部版本：协议规则变动时递增，便于追踪 KV 缓存前缀变更（v2 尚未接 v1 的 PROMPT_VERSION 机制） */


/** 静态协议放最前面（KV 缓存前缀），动态段在后 */
export function buildNpcPrompt(args: NpcPromptArgs, modes: Map<string, UtteranceModeDef>, policy: ConversationPolicy): string {
  const modeList = [...modes.values()].map((m) => {
    const rule = [m.requiresTarget ? "必须指定一个在场目标（字符串，不能是数组或 @所有人）" : "", m.requiresAction ? "必须附带 action" : ""].filter(Boolean).join("，");
    return `- ${m.id}（${m.label}）${rule ? `：${rule}` : ""}`;
  }).join("\n");
  const staticPart = [
    `你是校园群聊中的一个 NPC，正在与其他在场的人对话。协议版本：${CONVERSATION_PROMPT_VERSION}。`,
    "只输出 JSON（不要 Markdown 围栏），字段：",
    `{"kind":"speak|think|silent","utterance":{"id":"utt_...","speaker":"${args.npcId}","mode":"...","target":"可选","content":"...","action":"...","coverAction":"可选"},"mental":{"thought":"...","plan":"可选","salience":1,"about":[]},"reason":"沉默原因"}`,
    `可选说话方式：\n${modeList}`,
    "规则：一次只能选一种 kind。speak 时 utterance.mode 必须是上面的 id，且遵守上面列出的该模式条件。",
    mentalFraming(),
    `字数：content≤${policy.maxContent}，action≤${policy.maxAction}，thought≤${policy.maxThought}，plan≤${policy.maxPlan}。`,
  ].join("\n");
  const received = args.deliveries.length
    ? args.deliveries.map((d) => `- ${d.speaker} → 你（${d.channels.join("+")}）：${[d.content, d.action, d.notice].filter(Boolean).join(" / ")}`).join("\n")
    : "- （本轮没有收到任何新消息）";
  const dynamic: string[] = [
    `【你】${args.npcId}（${args.npcName}）`,
    args.sceneText || "（暂无场景总结）",
    args.memoryText || "（暂无相关记忆）",
    `【本轮收到】\n${received}`,
  ];
  if (args.playerPresent) {
    dynamic.push(`玩家在场；纯 NPC 连续发言 ${args.streak} 轮（上限 ${policy.npcHardCap}）。`);
    if (args.hardCapReached) dynamic.push("已达上限：本轮禁止说话，只能思考或沉默。除非有必须立刻说的紧急信息，否则 silent。");
    else if (args.streak > 0) dynamic.push("玩家在旁且你已聊了一会儿：除非有重要信息，否则保持简短或沉默。");
  } else {
    dynamic.push("玩家不在场：你可以与其他 NPC 自主续聊，只要有话说就 speak。");
  }
  if (args.listening) dynamic.push("玩家刚点了插话：本轮只听不说，等玩家讲完。你可以思考，但不要 speak。");
  dynamic.push(`【当前地点】${args.state.room.scene.locId ?? "未知"}`);
  return `${staticPart}\n\n${dynamic.join("\n")}`;
}

/** 去围栏 + 取首尾大括号（与 turn.parse 同样的容错，但不依赖 v1 的 TurnJson） */
export function parseDecision(raw: string): RawDecision | null {
  let text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  text = text.slice(a, b + 1);
  try {
    const parsed = RawDecisionSchema.safeParse(JSON.parse(text) as unknown);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export class NpcAgent {
  constructor(private readonly deps: NpcAgentDeps) {}

  async decide(args: NpcPromptArgs): Promise<NpcDecisionResult> {
    const prompt = this.deps.buildPrompt?.(args) ?? buildNpcPrompt(args, this.deps.modes, this.deps.policy);
    let raw: string;
    let usage: Usage | undefined;
    try {
      const result = await this.deps.llm.chat({
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: this.deps.policy.messages.userPrompt },
        ],
        json: true,
        temperature: this.deps.policy.llm.temperature,
        maxTokens: this.deps.policy.llm.maxTokens,
        actorId: args.npcId,
      });
      raw = result.raw;
      usage = result.usage;
    } catch {
      // 格式错误/超时：这一轮沉默，不把异常抛给编排层（v2 的"坏输出不坏会话"）
      return { decision: { kind: "silent", reason: "llm_unavailable" } };
    }
    const parsed = parseDecision(raw);
    if (!parsed) return { decision: { kind: "silent", reason: "E_LLM_FORMAT" }, usage };
    return { decision: this.coerce(parsed, args), usage };
  }

  /** 模型输出降级：不合法就 silent / think，绝不让坏数据变成 world 变更 */
  private coerce(raw: RawDecision, args: NpcPromptArgs): NpcDecision {
    if (args.listening || args.hardCapReached) {
      const m = this.mental(raw.mental, args.npcId);
      return m ? { kind: "think", mental: m } : { kind: "silent", reason: "phase_or_cap" };
    }
    if (raw.kind === "think") {
      const m = this.mental(raw.mental, args.npcId);
      return m ? { kind: "think", mental: m } : { kind: "silent", reason: "bad_mental" };
    }
    if (raw.kind === "speak" && raw.utterance) {
      const u: Utterance = {
        id: typeof raw.utterance.id === "string" && raw.utterance.id ? raw.utterance.id : `utt_${args.npcId}_${args.state.room.scene.locId ?? "x"}_${args.turnKey ?? args.state.clock.tick}`,
        speaker: args.npcId,
        // 缺省模式来自策略数据；模式表里没有就沉默（fail-closed，不硬编码 broadcast）
        mode: raw.utterance.mode ?? this.deps.policy.defaultMode,
        ...(raw.utterance.target ? { target: raw.utterance.target } : {}),
        ...(typeof raw.utterance.content === "string" ? { content: raw.utterance.content } : {}),
        ...(typeof raw.utterance.action === "string" ? { action: raw.utterance.action } : {}),
        ...(typeof raw.utterance.coverAction === "string" ? { coverAction: raw.utterance.coverAction } : {}),
        ...(typeof raw.utterance.notice === "string" ? { notice: raw.utterance.notice } : {}),
      };
      const present = args.state.room.scene.presentIds ?? [];
      const v = validateUtterance(u, this.deps.modes, this.deps.policy, present);
      if (v.ok && v.value) return { kind: "speak", utterance: v.value };
      return { kind: "silent", reason: v.code ?? "bad_utterance" };
    }
    return { kind: "silent", reason: typeof raw.reason === "string" ? raw.reason : "no_speech" };
  }

  private mental(raw: RawDecision["mental"], npcId: ActorId): MentalActivity | null {
    if (!raw || typeof raw.thought !== "string" || !raw.thought.trim()) return null;
    if (raw.thought.length > this.deps.policy.maxThought) return null;
    const salience = typeof raw.salience === "number" ? Math.min(5, Math.max(1, Math.round(raw.salience))) : 3;
    const mental: MentalActivity = { actorId: npcId, thought: raw.thought.trim(), salience };
    if (typeof raw.plan === "string" && raw.plan.trim() && raw.plan.length <= this.deps.policy.maxPlan) mental.plan = raw.plan.trim();
    if (Array.isArray(raw.about)) mental.about = raw.about.filter((x): x is ActorId => typeof x === "string").slice(0, 8);
    return mental;
  }
}
