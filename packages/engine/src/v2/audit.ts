/**
 * 审核扩面（dev/v2）：把说话的四段结构 + 心理活动的 thought/plan 全部送去审核。
 * 薄封装，不改 v1 的 AuditGate：违规判定与玩家处置都复用它，保证策略只有一份（policy.json）。
 */
import type { ActorId, Proposal, RoomId, WorldState } from "../../../shared/src/index.ts";
import type { AuditPolicy, AuditPort, AuditVerdict } from "../audit.ts";
import type { AuditGate } from "../audit.gate.ts";

export interface AuditText {
  label: string;
  text: string;
}

export interface ConversationAuditArgs {
  roomId: RoomId;
  actorId: ActorId;
  playerInput: string;
  fields: AuditText[];
}

export type AuditOutcome = { kind: "ok" } | { kind: "blocked"; verdict: AuditVerdict } | { kind: "unavailable" };

export class ConversationAudit {
  constructor(
    private readonly audit: AuditPort,
    private readonly policy: AuditPolicy,
    private readonly gate: AuditGate,
  ) {}

  async review(args: ConversationAuditArgs): Promise<AuditOutcome> {
    if (!this.policy.enabled) return { kind: "ok" };
    // 先按字段正文过滤，再拼标签；否则空字段会带标签凑够长度，把阈值判空变成假阳性
    const text = args.fields
      .filter((f) => f.text.trim().length > 0)
      .map((f) => `[${f.label}] ${f.text.trim()}`)
      .join("\n");
    if (!text.trim()) return { kind: "ok" };
    try {
      const verdict = await this.audit.review({
        roomId: args.roomId,
        actorId: args.actorId,
        playerInput: args.playerInput,
        text,
        categories: this.policy.categories,
        blockSeverity: this.policy.blockSeverity,
        categoryLabels: this.policy.categoryLabels,
      });
      if (!verdict.allow && verdict.severity >= this.policy.blockSeverity) return { kind: "blocked", verdict };
      return { kind: "ok" };
    } catch {
      // 审核器故障：fail-closed（不发布新通道文本），但不惩罚玩家
      return { kind: "unavailable" };
    }
  }

  /** 玩家违规：复用 AuditGate.punish（警告/扣分/删档线），把 TurnEvent 折叠成会话事件 */
  async punishPlayer(args: {
    roomId: RoomId;
    actorId: ActorId;
    clientTurnId: string;
    verdict: AuditVerdict;
    state: WorldState;
    seq: number;
  }): Promise<{ text: string; facts: string[]; ops: Proposal[] }> {
    const cause = {
      v: 1 as const,
      id: `evt_v2_audit_${args.clientTurnId}`,
      roomId: args.roomId,
      seq: args.seq + 1,
      ts: Date.now(),
      actorId: args.actorId,
      type: "engine.audit",
      payload: {},
    };
    const events = await this.gate.punish(
      { roomId: args.roomId, actorId: args.actorId, clientTurnId: args.clientTurnId },
      cause,
      args.verdict,
      args.state,
      args.seq,
    );
    let text = "";
    let facts: string[] = [];
    let ops: Proposal[] = [];
    for (const ev of events) {
      if (ev.type === "turn.delta") text = ev.text;
      if (ev.type === "turn.facts") facts = ev.facts;
      if (ev.type === "turn.patch") ops = ev.ops;
    }
    return { text, facts, ops };
  }
}
