/**
 * 八卦传播导演（dev/v2）：玩家离线也能互相发微信。
 * 每个 NPC 各自一次 LLM（独立心智），先过 TalkBudget 再调用；产出 msg.send + 私忆，一次原子落库。
 * 微信只有「目标 + 内容」：不接受 action/notice/coverAction，玩家非收件人零可见。
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  ActorId, Envelope, Id, LlmPort, RoomId, Usage, WorldState,
} from "../../../shared/src/index.ts";
import { DEFAULT_CONVERSATION_POLICY, GOSSIP_PROMPT_VERSION, type ConversationPolicy, type GossipDecision, type GossipEvent, type GossipPolicy, type MessageDigest, type MessageRecord } from "../../../shared/src/index.ts";
import type { EventLog } from "../store.ts";
import type { DefaultArbiter } from "../arbiter.ts";
import { DEFAULT_AUDIT_POLICY, type AuditPolicy, type AuditPort } from "../audit.ts";
import { applyMemoryGates } from "../memory.gate.ts";
import type { EventSourcedMemory } from "../memory.ts";
import type { MessageIndex } from "./message.ts";
import type { TalkBudget } from "./talk-budget.ts";

const DecisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("relay"), content: z.string().min(1).max(400) }).strict(),
  z.object({ kind: z.literal("distort"), content: z.string().min(1).max(400) }).strict(),
  z.object({ kind: z.literal("reply"), content: z.string().min(1).max(400) }).strict(),
  z.object({ kind: z.literal("ignore"), reason: z.string().max(120).optional() }).strict(),
]);

const GossipPolicySchema = z.object({
  schemaVersion: z.number().int().positive().optional(),
  minReplyIntervalMs: z.number().int().nonnegative(),
  maxMessagesPerNpcPerHour: z.number().int().positive(),
  maxNpcCallsPerTick: z.number().int().positive(),
  maxHops: z.number().int().positive(),
  confidenceDecay: z.number().min(0).max(1),
  messages: z.object({
    system: z.string().min(1), format: z.string().min(1), rules: z.string().min(1),
    untrusted: z.string().min(1), inboxEmpty: z.string().min(1), replyFormat: z.string().min(1),
  }),
});

/** 坏数据 fail-closed：策略文件不存在或非法时直接抛，不静默放行 */
export async function loadGossipPolicy(path: string): Promise<GossipPolicy> {
  const { readFile } = await import("node:fs/promises");
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (e) {
    throw new Error(`gossip 策略文件缺失或不可读（需随 content 一起部署）：${path}（${e instanceof Error ? e.message : String(e)}）`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`gossip 策略文件不是合法 JSON：${path}（${e instanceof Error ? e.message : String(e)}）`);
  }
  const p = GossipPolicySchema.parse(raw);
  return {
    minReplyIntervalMs: p.minReplyIntervalMs, maxMessagesPerNpcPerHour: p.maxMessagesPerNpcPerHour,
    maxNpcCallsPerTick: p.maxNpcCallsPerTick, maxHops: p.maxHops, confidenceDecay: p.confidenceDecay,
    messages: { ...p.messages },
  };
}

export function parseGossipDecision(raw: string): GossipDecision | null {
  let text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  const parsed = DecisionSchema.safeParse(JSON.parse(text.slice(a, b + 1)) as unknown);
  return parsed.success ? parsed.data : null;
}

/** 静态协议在前（保缓存），动态收件箱在后 */
export function buildGossipPrompt(args: {
  npcId: ActorId; npcName: string; inbox: readonly MessageDigest[];
  fromName: (id: ActorId) => string; policy: GossipPolicy;
}): string {
  const m = args.policy.messages;
  const staticPart = [
    m.system.replace("{version}", GOSSIP_PROMPT_VERSION),
    m.format, m.rules, m.untrusted, m.inboxEmpty, m.replyFormat,
  ].join("\n");
  const lines = args.inbox.length
    ? args.inbox.map((m) => `- ${args.fromName(m.from)}：${m.content}`).join("\n")
    : "(暂无未读消息)";
  return `${staticPart}\n\n【你】${args.npcName}（${args.npcId}）\n【收件箱】\n${lines}`;
}

export interface GossipAgentDeps {
  llm: LlmPort;
  policy: GossipPolicy;
  conversation: ConversationPolicy;
}

export class GossipAgent {
  constructor(private readonly deps: GossipAgentDeps) {}

  async decide(prompt: string, npcId: ActorId, roomId: RoomId): Promise<{ decision: GossipDecision | null; usage?: Usage }> {
    try {
      const res = await this.deps.llm.chat({
        messages: [{ role: "system", content: prompt }],
        json: true,
        temperature: this.deps.conversation.llm.temperature,
        maxTokens: this.deps.conversation.llm.maxTokens,
        roomId,
        actorId: npcId,
      });
      return { decision: parseGossipDecision(res.raw), usage: res.usage };
    } catch {
      return { decision: null };
    }
  }
}

export interface GossipHostDeps {
  store: EventLog;
  arbiter: DefaultArbiter;
  messages: MessageIndex;
  budget: TalkBudget;
  agent: GossipAgent;
  policy: GossipPolicy;
  conversation?: ConversationPolicy;
  now?: () => number;
  audit?: AuditPort;
  auditPolicy?: AuditPolicy;
  memory?: EventSourcedMemory;
}

function cause(roomId: RoomId, actorId: ActorId, id: Id, type: string): Envelope {
  return { v: 1, id, roomId, seq: 0, ts: 0, actorId, type, payload: {} };
}

/** 从已提交事件里取 msg.sent 记录（消息索引投影的结果） */
function recordsOf(events: readonly Envelope[]): MessageRecord[] {
  const out: MessageRecord[] = [];
  for (const env of events) {
    if (env.type !== "msg.sent") continue;
    const p = env.payload as { message?: MessageRecord };
    if (p.message?.id) out.push(p.message);
  }
  return out;
}

export class GossipHost {
  private readonly now: () => number;
  private readonly conv: ConversationPolicy;
  private readonly chains = new Map<RoomId, Promise<GossipEvent[]>>();
  private readonly listeners = new Map<RoomId, Set<(ev: GossipEvent) => void>>();
  /** 同一条过期消息每房只上报一次，避免每波 × 每 NPC 重复推给 SSE（有界 256 + TTL 自动过期） */
  private readonly staleSeen = new Map<RoomId, Map<Id, number>>();

  constructor(private readonly deps: GossipHostDeps) {
    this.now = deps.now ?? Date.now;
    this.conv = deps.conversation ?? DEFAULT_CONVERSATION_POLICY;
  }

  private serial(roomId: RoomId, fn: () => Promise<GossipEvent[]>): Promise<GossipEvent[]> {
    const prev = this.chains.get(roomId) ?? Promise.resolve([]);
    const run = prev.then(fn, fn);
    this.chains.set(roomId, run.then(() => [], () => []));
    return run;
  }

  /**
   * 订阅私信事件（SSE 用）。只发布 gossip.message，且按收发双方过滤：
   * 玩家不是收件人时连事件都拿不到，前端没有"神色降级"实现的机会。
   */
  subscribe(roomId: RoomId, viewer: ActorId, cb: (ev: GossipEvent) => void): () => void {
    const set = this.listeners.get(roomId) ?? new Set();
    const wrapped = (ev: GossipEvent): void => {
      if (ev.type !== "gossip.message") return;
      if (ev.message.from !== viewer && ev.message.to !== viewer) return;
      cb(ev);
    };
    set.add(wrapped);
    this.listeners.set(roomId, set);
    return () => set.delete(wrapped);
  }

  private publish(roomId: RoomId, events: readonly GossipEvent[]): void {
    for (const ev of events) for (const cb of this.listeners.get(roomId) ?? []) cb(ev);
  }

  /** 玩家/系统发消息：不调 LLM，直接经 Arbiter 落库 */
  send(roomId: RoomId, from: ActorId, to: ActorId, content: string, opts: {
    kind?: "player" | "system"; rootId?: Id; replyTo?: Id; viewer?: ActorId;
  } = {}): Promise<GossipEvent[]> {
    return this.serial(roomId, async () => {
      const kind = opts.kind ?? "player";
      const key = `seed_${createHash("sha256").update(JSON.stringify([roomId, from, to, kind, content, opts.rootId ?? null, opts.replyTo ?? null])).digest("hex").slice(0, 20)}`;
      if (this.deps.audit) {
        const ap = this.deps.auditPolicy ?? DEFAULT_AUDIT_POLICY;
        try {
          const verdict = await this.deps.audit.review({
            roomId, actorId: from, playerInput: content, text: content,
            categories: ap.categories, blockSeverity: ap.blockSeverity, categoryLabels: ap.categoryLabels,
          });
          if (!verdict.allow || verdict.severity >= ap.blockSeverity) {
            return [{ type: "gossip.error", code: "E_CONTENT_BLOCKED", message: "message rejected by audit", retryable: false }];
          }
        } catch {
          return [{ type: "gossip.error", code: "E_AUDIT_UNAVAILABLE", message: "audit unavailable", retryable: true }];
        }
      }
      const expectedSeq = this.deps.store.seq(roomId);
      const result = await this.deps.arbiter.apply(roomId, [{
        op: "msg.send",
        args: { from, to, kind, content, rootId: opts.rootId, replyTo: opts.replyTo, hop: 0, confidence: 1, visibility: "private" },
        reason: "player message", by: "gossip",
      }], cause(roomId, from, key, "dialogue.speak"), { expectedSeq });
      if (!result.ok || result.rejected.length) {
        return [{ type: "gossip.error", code: result.error?.code ?? "E_FORBIDDEN", message: result.error?.message ?? result.rejected[0]?.detail ?? "message rejected", retryable: false }];
      }
      this.deps.messages.ingest(result.events);
      await this.deps.store.flush(roomId);
      const out: GossipEvent[] = recordsOf(result.events)
        .filter((m) => opts.viewer === undefined || opts.viewer === m.from || opts.viewer === m.to)
        .map((m) => ({ type: "gossip.message" as const, message: m }));
      this.publish(roomId, out);
      return out;
    });
  }

  /** 一次后台波次：每个有未读消息的 NPC 独立决策；先预算后调用 */
  step(roomId: RoomId, viewer?: ActorId): Promise<GossipEvent[]> {
    return this.serial(roomId, async () => {
      this.deps.budget.beginTick(roomId);
      const state: WorldState = this.deps.store.state(roomId);
      const out: GossipEvent[] = [];
      const proposals: { op: "msg.send" | "memory.write"; args: Record<string, unknown>; reason: string; by: string }[] = [];
      const npcs = Object.values(state.entities).filter((e) => e.kind === "npc" && !e.tombstonedAt);
      const auto = this.conv.autonomy;
      let calls = 0;
      // 玩家在场景里且刚发过消息时给一段宽限期，避免 NPC 抢话（dev/v2 autonomy.playerPresentGraceMs）
      const graceMs = auto?.playerPresentGraceMs ?? 0;
      if (graceMs > 0 && state.room.scene?.presentIds?.length) {
        const player = Object.values(state.entities).find((e) => e.kind === "plr" && state.room.scene?.presentIds?.includes(e.id));
        const lastPlayer = player ? this.deps.messages.lastFrom(roomId, player.id) : undefined;
        if (lastPlayer && this.now() - lastPlayer.createdAt < graceMs) {
          out.push({ type: "gossip.dropped", id: roomId, reason: "player-grace" });
          return out;
        }
      }

      for (const npc of npcs) {
        if (calls >= Math.min(this.deps.policy.maxNpcCallsPerTick, auto?.maxTurnsPerTick ?? this.deps.policy.maxNpcCallsPerTick)) break;
        const inbox = this.deps.messages.inbox(roomId, npc.id, 5)
          .filter((m) => !this.deps.messages.hasReplyTo(roomId, m.id))
          .filter((m) => {
            const fresh = m.createdAt <= 0 || this.now() - m.createdAt <= (auto?.idleTimeoutMs ?? Number.MAX_SAFE_INTEGER);
            if (!fresh && this.markStale(roomId, m.id)) out.push({ type: "gossip.dropped", id: m.id, reason: "idle-timeout" });
            return fresh;
          });
        if (inbox.length === 0) continue;
        const reason = this.deps.budget.canSpeak(roomId, npc.id, this.now());
        if (reason !== "ok") {
          out.push({ type: "gossip.dropped", id: npc.id, reason, nextAt: this.deps.budget.nextEligible(roomId, npc.id, this.now()) });
          continue;
        }
        this.deps.budget.recordCall(roomId);
        calls += 1;
        const prompt = buildGossipPrompt({
          npcId: npc.id, npcName: npc.name, inbox,
          fromName: (id) => state.entities[id]?.name ?? id,
          policy: this.deps.policy,
        });
        const { decision } = await this.deps.agent.decide(prompt, npc.id, roomId);
        if (!decision || decision.kind === "ignore") {
          out.push({ type: "gossip.dropped", id: inbox[0]?.id ?? npc.id, reason: decision?.reason ?? "invalid-decision" });
          continue;
        }
        const source = inbox[0];
            if (!source) continue;
        if (this.deps.audit) {
          const ap = this.deps.auditPolicy ?? DEFAULT_AUDIT_POLICY;
          try {
            const verdict = await this.deps.audit.review({
              roomId, actorId: npc.id, playerInput: "", text: decision.content,
              categories: ap.categories, blockSeverity: ap.blockSeverity, categoryLabels: ap.categoryLabels,
            });
            if (!verdict.allow || verdict.severity >= ap.blockSeverity) {
              out.push({ type: "gossip.dropped", id: source.id, reason: "audit-blocked" });
              continue;
            }
          } catch {
            out.push({ type: "gossip.dropped", id: source.id, reason: "audit-unavailable" });
            continue;
          }
        }
        const targets = decision.kind === "reply" ? [source.from] : this.pickRelayTargets(state, npc.id, source.from, 2);
        const rootId = source.rootId ?? source.id;
        const hop = decision.kind === "reply" ? 0 : (source.hop ?? 0) + 1;
        if (hop > this.deps.policy.maxHops) {
          out.push({ type: "gossip.dropped", id: source.id, reason: "max-hops" });
          continue;
        }
        const confidence = decision.kind === "reply"
          ? 1
          : Math.max(0, Math.round((this.deps.messages.byMessageId(source.id)?.confidence ?? 1) * this.deps.policy.confidenceDecay * 100) / 100);
        for (const to of targets) {
          proposals.push({
            op: "msg.send",
            args: {
              from: npc.id, to, kind: decision.kind === "reply" ? "reply" : "gossip",
              content: decision.content, rootId, replyTo: source.id, hop, confidence, visibility: "private",
            },
            reason: decision.kind, by: "gossip.spread",
          });
          const draft = {
            ownerId: to, content: `收到 ${npc.name} 的消息：${decision.content}`,
            tags: ["八卦", rootId], salience: Math.max(1, Math.ceil(confidence * 5)),
            visibility: "private" as const, about: [npc.id], sourceRefs: [source.id],
          };
          const mem = this.deps.memory;
          const owned = mem ? mem.all(roomId).filter((r: { ownerId: string }) => r.ownerId === to) : [];
          const gated = applyMemoryGates({
            state, actorId: npc.id, ownerId: to, drafts: [draft],
            recent: owned.slice(-8), ownedCount: owned.length, trustedChannel: "gossip",
          });
          for (const accepted of gated.accepted) {
            proposals.push({
              op: "memory.write", args: { ...accepted }, reason: "gossip memory", by: "gossip.spread",
            });
          }
        }
      }

      if (proposals.length === 0) return out;
      const expectedSeq = this.deps.store.seq(roomId);
      const result = await this.deps.arbiter.apply(roomId, proposals, cause(roomId, "gossip", `tick_${state.clock.tick}_${expectedSeq}`, "gossip.spread"), { expectedSeq });
      if (!result.ok || result.rejected.length) {
        return [...out, { type: "gossip.error", code: result.error?.code ?? "E_FORBIDDEN", message: result.error?.message ?? result.rejected[0]?.detail ?? "rejected", retryable: true }];
      }
      this.deps.messages.ingest(result.events);
      for (const m of recordsOf(result.events)) {
        this.deps.budget.recordSent(roomId, m.from);
        if (viewer === undefined || viewer === m.from || viewer === m.to) out.push({ type: "gossip.message", message: m });
      }
      await this.deps.store.flush(roomId);
      out.push({ type: "gossip.committed", ids: recordsOf(result.events).map((m) => m.id) });
      this.publish(roomId, out);
      return out;
    });
  }

  private markStale(roomId: RoomId, id: Id): boolean {
    let seen = this.staleSeen.get(roomId);
    if (!seen) { seen = new Map(); this.staleSeen.set(roomId, seen); }
    const now = this.now();
    // TTL 到期后同一条陈旧消息可能再上报一次 dropped：可接受的一次性重复，
    // 换来无界房间最终自清理；SSE 消费端应按 id 幂等去重。
    const ttl = (this.conv.autonomy?.idleTimeoutMs ?? 300_000) * 4;
    for (const [key, at] of seen) if (now - at > ttl) seen.delete(key);
    if (seen.has(id)) return false;
    if (seen.size >= 256) {
      const oldest = seen.keys().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
    seen.set(id, now);
    return true;
  }

  /**
   * 房间销毁/重置时清理导演侧投影（仅限销毁，不会给 SSE 订阅者关闭信号）。
   * 平时由 markStale 的 TTL + 256 上限自清理；调用前必须确保已断开该房间的 SSE。
   */
  clearRoom(roomId: RoomId): void {
    this.staleSeen.delete(roomId);
    this.listeners.delete(roomId);
    this.chains.delete(roomId);
    this.deps.budget.clearRoom(roomId);
  }

  /** 社会图：优先把八卦告诉权重最高的熟人（不含发信人与自己） */
  private pickRelayTargets(state: WorldState, from: ActorId, exclude: ActorId, limit: number): ActorId[] {
    return state.links
      .filter((l) => l.kind === "knows" && (l.from === from || l.to === from))
      .map((l) => ({ id: l.from === from ? l.to : l.from, weight: l.weight ?? 0 }))
      .filter((c) => c.id !== from && c.id !== exclude && state.entities[c.id]?.kind === "npc")
      .sort((a, b) => b.weight - a.weight)
      .slice(0, limit)
      .map((c) => c.id);
  }
}
