/**
 * 房间级发言/调用预算（dev/v2）：在**调用 LLM 之前**判断，避免"生成后 coerce"白烧钱。
 * 场景群聊与微信传播必须共用同一个实例，否则两条通道各自突破上限。
 * 纯内存、确定性、可测试；服务重启后计数清零（与会话一起重建）。
 */
import type { RoomId, ActorId } from "../../../shared/src/index.ts";
import { DEFAULT_CONVERSATION_POLICY, type ConversationPolicy } from "../../../shared/src/index.ts";

export type BudgetReason = "ok" | "min-interval" | "hour-cap" | "call-cap";

const HOUR_MS = 3_600_000;

export class TalkBudget {
  private readonly lastSent = new Map<string, number>();
  private readonly sentTimes = new Map<string, number[]>();
  private readonly callTimes = new Map<string, number[]>();
  private readonly now: () => number;
  private readonly cfg: ConversationPolicy["autonomy"];

  constructor(policy: Pick<ConversationPolicy, "autonomy"> = DEFAULT_CONVERSATION_POLICY, now: () => number = Date.now) {
    this.cfg = policy.autonomy;
    this.now = now;
  }

  private key(roomId: RoomId, actorId: ActorId): string {
    return `${roomId}|${actorId}`;
  }

  /** 同一调用窗口（1 小时）内该 NPC 已产出几条消息 */
  sentInHour(roomId: RoomId, actorId: ActorId, at = this.now()): number {
    return (this.sentTimes.get(this.key(roomId, actorId)) ?? []).filter((t) => at - t < HOUR_MS).length;
  }

  private callsInWindow(roomId: RoomId, at: number): number {
    return (this.callTimes.get(roomId) ?? []).filter((t) => at - t < HOUR_MS).length;
  }

  canSpeak(roomId: RoomId, actorId: ActorId, at = this.now()): BudgetReason {
    const last = this.lastSent.get(this.key(roomId, actorId));
    if (last !== undefined && at - last < this.cfg.minReplyIntervalMs) return "min-interval";
    if (this.sentInHour(roomId, actorId, at) >= this.cfg.maxMessagesPerNpcPerHour) return "hour-cap";
    if (this.callsInWindow(roomId, at) >= this.cfg.maxNpcCallsPerTick) return "call-cap";
    return "ok";
  }

  /** 每个后台波次开始时调用：每波调用上限按 tick 计，不按小时累计 */
  beginTick(roomId: RoomId): void {
    this.callTimes.delete(roomId);
  }

  /** 何时可以再试（供调度器决定下次唤醒，避免空转） */
  nextEligible(roomId: RoomId, actorId: ActorId, at = this.now()): number {
    const last = this.lastSent.get(this.key(roomId, actorId));
    return last === undefined ? at : last + this.cfg.minReplyIntervalMs;
  }

  /** 调用 LLM 时记一次；实际是否产出消息都要记，防止"反复调用但被判无效"绕过上限 */
  recordCall(roomId: RoomId): void {
    const at = this.now();
    const list = (this.callTimes.get(roomId) ?? []).filter((t) => at - t < HOUR_MS);
    list.push(at);
    this.callTimes.set(roomId, list);
  }

  /** 成功发出消息后记一次（同时推进最短回信间隔） */
  recordSent(roomId: RoomId, actorId: ActorId): void {
    const at = this.now();
    const k = this.key(roomId, actorId);
    this.lastSent.set(k, at);
    const list = (this.sentTimes.get(k) ?? []).filter((t) => at - t < HOUR_MS);
    list.push(at);
    this.sentTimes.set(k, list);
  }

  clearRoom(roomId: RoomId): void {
    for (const k of [...this.lastSent.keys()]) if (k.startsWith(`${roomId}|`)) this.lastSent.delete(k);
    for (const k of [...this.sentTimes.keys()]) if (k.startsWith(`${roomId}|`)) this.sentTimes.delete(k);
    this.callTimes.delete(roomId);
  }
}
