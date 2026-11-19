/**
 * 群聊会话宿主（dev/v2）：与 v1 DialogueHost 并列的新入口，不改 v1 任何签名。
 * 只做会话生命周期、幂等、落盘重试与房间级串行化；单轮结算在 conversation.step.ts。
 * 世界状态的所有变更仍只有一条路（I1）；本文件不碰 store.append、不碰文件。
 */
import type {
  ApplyResult,
  ConversationEvent,
  ConversationSessionV2,
  ConversationSpecV2,
  ConversationTurnInput,
  ConversationTurnV2,
  Id,
  RoomId,
  UtteranceModeDef,
  ConversationPolicy,
  Registry,
} from "../../../shared/src/index.ts";
import type { EventLog } from "../store.ts";
import type { DefaultArbiter } from "../arbiter.ts";
import type { EventSourcedMemory } from "../memory.ts";
import type { SceneManager } from "./scene.ts";
import type { NpcAgent } from "./npc-agent.ts";
import type { ConversationAudit } from "./audit.ts";
import { StoreFlushError, runStep } from "./conversation.step.ts";

export interface ConversationDeps {
  store: EventLog;
  arbiter: DefaultArbiter;
  registry: Registry;
  memory: EventSourcedMemory;
  modes: Map<string, UtteranceModeDef>;
  policy: ConversationPolicy;
  scene: SceneManager;
  npc: NpcAgent;
  audit: ConversationAudit;
  /** dev/v2 可选：与 GossipHost 共用的发言/调用预算 */
  budget?: import("./talk-budget.ts").TalkBudget;
  wakeOnMultiTarget?: boolean;
  wakeOnLocationChange?: boolean;
  now?: () => number;
}

interface PendingFlush {
  roomId: RoomId;
  s: ConversationSessionV2;
  applied: ApplyResult;
  out: ConversationEvent[];
  /** flush 失败前的 lastLocId；仅当期间未被别的回合推进时才用当前快照前移 */
  beforeLocId?: string;
}

const MAX_SEEN = 256;
const MAX_SESSIONS = 256;
const MAX_PENDING = 256;

export class ConversationHostV2 implements ConversationTurnV2 {
  private readonly sessions = new Map<Id, ConversationSessionV2>();
  private readonly seen = new Map<string, ConversationEvent[]>();
  private readonly pendingFlush = new Map<string, PendingFlush>();
  /** 房间级串行：LLM 等待期间不能让第二个 run 用同一份 seq 提交（PR#51 二审 F） */
  private readonly chains = new Map<RoomId, Promise<void>>();
  private nextId = 0;

  constructor(private readonly deps: ConversationDeps) {}

  /** 仅用于测试/观测：缓存条数（全部有界） */
  get idempotencySize(): number {
    return this.seen.size;
  }

  async open(spec: ConversationSpecV2): Promise<ConversationSessionV2> {
    const state = await this.deps.store.snapshot(spec.roomId);
    const locId = state.room.scene.locId;
    const session: ConversationSessionV2 = {
      id: `conv_${++this.nextId}`,
      roomId: spec.roomId,
      participants: [...spec.participants],
      phase: "speaking",
      turn: 0,
      maxTurns: spec.maxTurns ?? this.deps.policy.maxTurns,
      status: "open",
      queue: [],
      injected: [],
      sceneBeats: [],
      lastLocId: locId,
      npcSpeechStreak: 0,
      visibility: spec.visibility ?? "scene",
    };
    this.sessions.set(session.id, session);
    this.trimSessions();
    session.sceneBeats.push(
      await this.deps.scene.open(session.id, spec.roomId, locId ? state.entities[locId]?.name : undefined, spec.participants, locId),
    );
    return session;
  }

  get(sessionId: Id): ConversationSessionV2 | undefined {
    return this.sessions.get(sessionId);
  }

  /** 插话超时恢复；返回被恢复的会话 id（保留旧签名供 server tick 使用） */
  resumeExpired(now = this.deps.now?.() ?? Date.now()): Id[] {
    return this.resumeExpiredEvents(now).flatMap((e) => (e.type === "conversation.phase" ? [e.sessionId] : []));
  }

  /** 与 resumeExpired 同源，但带回可下发给前端的 phase 事件 */
  resumeExpiredEvents(now = this.deps.now?.() ?? Date.now()): ConversationEvent[] {
    const out: ConversationEvent[] = [];
    for (const s of this.sessions.values()) {
      if (s.phase === "listening" && s.listenSince !== undefined && now - s.listenSince >= this.deps.policy.listenTimeoutMs) {
        s.phase = "speaking";
        s.listenSince = undefined;
        out.push({ type: "conversation.phase", sessionId: s.id, phase: "speaking" });
      }
    }
    return out;
  }

  async *run(sessionId: Id, input: ConversationTurnInput): AsyncIterable<ConversationEvent> {
    const roomId = this.sessions.get(sessionId)?.roomId ?? "";
    const events = await this.exclusive(roomId, () => this.runInner(sessionId, input));
    for (const ev of events) yield ev;
  }

  private exclusive<T>(roomId: RoomId, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(roomId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.then(() => undefined, () => undefined);
    this.chains.set(roomId, tail);
    void tail.finally(() => {
      if (this.chains.get(roomId) === tail) this.chains.delete(roomId);
    });
    return next;
  }

  private async runInner(sessionId: Id, input: ConversationTurnInput): Promise<ConversationEvent[]> {
    const actorId = input.utterance?.speaker ?? input.interject ?? "sys";
    const key = JSON.stringify([sessionId, actorId, input.clientTurnId]);
    const cached = this.seen.get(key);
    if (cached) return [...cached];

    const s = this.sessions.get(sessionId);
    if (!s || s.status === "closed") {
      return [{ type: "conversation.error", sessionId, code: "E_DIALOGUE_NOT_FOUND", message: this.deps.policy.messages.sessionNotFound }];
    }
    // 放在幂等命中与会话校验之后：重放旧回合不应清空另一个 host 正在用的波次预算
    this.deps.budget?.beginTick(s.roomId);

    // 落盘重试：apply 已完成、记忆已 ingest，这次只重试 flush，绝不重复发 Proposal
    const pending = this.pendingFlush.get(key);
    if (pending) {
      try {
        await this.deps.store.flush(pending.roomId);
      } catch {
        return [{ type: "conversation.error", sessionId, code: "E_STORE_FAULT", message: this.deps.policy.messages.storeUnavailable, retryable: true }];
      }
      // 用当前快照而非失败当时的快照：若期间别的回合已推进地点，不回写旧值
      if (pending.beforeLocId !== undefined && pending.s.lastLocId === pending.beforeLocId) {
        pending.s.lastLocId = (await this.deps.store.snapshot(pending.roomId)).room.scene.locId;
      }
      const done = await this.commitWithState(pending.s, pending.applied);
      const all = [...pending.out, done];
      this.remember(key, all);
      this.pendingFlush.delete(key);
      return all;
    }

    const out: ConversationEvent[] = [...this.resumeExpiredEvents()];
    try {
      await runStep(this.deps, s, input, out, this.deps.now?.() ?? Date.now(), (ss, a) => this.commitWithState(ss, a));
    } catch (e) {
      if (e instanceof StoreFlushError) {
        // 先冻结 out 再追加错误，重试时才不会重复 yield 上一轮的 E_STORE_FAULT
        this.pendingFlush.set(key, { roomId: e.roomId, s, applied: e.applied, out: [...out], beforeLocId: s.lastLocId });
        this.trim(this.pendingFlush, MAX_PENDING);
        out.push({ type: "conversation.error", sessionId, code: "E_STORE_FAULT", message: e.message, retryable: true });
      } else {
        out.push({
          type: "conversation.error",
          sessionId,
          code: "E_MODULE_FAULT",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
    if (!out.some((e) => e.type === "conversation.error" && e.retryable)) this.remember(key, out);
    return out;
  }

  private trim<T>(map: Map<string, T>, max: number): void {
    while (map.size > max) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) return;
      map.delete(oldest);
    }
  }

  /** 会话淘汰不能踢掉仍有 pendingFlush 的会话（三审 P3-⑤） */
  private trimSessions(): void {
    while (this.sessions.size > MAX_SESSIONS) {
      const pendingIds = new Set([...this.pendingFlush.values()].map((p) => p.s.id));
      const all = [...this.sessions.values()];
      const victim = all.find((ss) => ss.status === "closed" && !pendingIds.has(ss.id))
        ?? all.find((ss) => !pendingIds.has(ss.id));
      if (!victim) return; // 全部都有 pendingFlush，宁可暂时超限也不能丢待重试会话
      this.sessions.delete(victim.id);
    }
  }

  private remember(key: string, events: ConversationEvent[]): void {
    this.seen.set(key, events);
    this.trim(this.seen, MAX_SEEN);
  }

  private async commitWithState(s: ConversationSessionV2, applied: ApplyResult): Promise<ConversationEvent> {
    const turn = ++s.turn;
    if (turn >= s.maxTurns) s.status = "closed";
    return {
      type: "conversation.committed",
      sessionId: s.id,
      turn,
      proposals: applied.applied,
      state: await this.deps.store.snapshot(s.roomId),
    };
  }
}
