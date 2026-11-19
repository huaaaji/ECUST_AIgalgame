/**
 * 会话编排的纯函数（dev/v2）：审核字段拼接 + 私忆 Proposal 生成。
 * 从 conversation.ts 拆出，让编排保持在 300 行以内（AGENTS §6）。
 */
import type { Id, Proposal, RoomId, Utterance, UtteranceModeDef, ActorId } from "../../../shared/src/index.ts";

export interface AuditText {
  label: string;
  text: string;
}

/** 说话四段 + 附加标记 → 待审字段（标签稳定，不随文案变化） */
export function utteranceFields(u: Utterance): AuditText[] {
  return [
    { label: "target", text: u.target ? String(u.target) : "all" },
    { label: "mode", text: u.mode },
    { label: "content", text: u.content ?? "" },
    { label: "action", text: u.action ?? "" },
    { label: "coverAction", text: u.coverAction ?? "" },
    { label: "notice", text: u.notice ?? "" },
  ];
}

/** 心理活动（含可执行的 plan）也必须过审核：plan 不自动执行，但内容要受同一把尺子管 */
export function mentalFields(m: { thought: string; plan?: string }): AuditText[] {
  return [
    { label: "thought", text: m.thought },
    { label: "plan", text: m.plan ?? "" },
  ];
}

/** 一句话 → 可持久化的 memory.write Proposal。可见性来自模式数据，缺省 private（fail-closed） */
export function memoryProposals(u: Utterance, roomId: RoomId, modes: Map<string, UtteranceModeDef>): Proposal[] {
  const text = u.content ? `${u.content}${u.action ? ` (${u.action})` : ""}` : u.action ?? "";
  if (!text.trim()) return [];
  const visibility: "public" | "private" | "secret" = modes.get(u.mode)?.visibility ?? "private";
  const args: Record<string, unknown> = {
    ownerId: u.speaker,
    content: text.slice(0, 500),
    tags: ["dialogue", u.mode],
    salience: 60,
    visibility,
  };
  if (u.target && u.target !== "all") args.about = Array.isArray(u.target) ? u.target : [u.target];
  return [{ op: "memory.write", args, reason: `group utterance (${u.mode})`, by: "dialogue.speak" }];
}

/** mental 记忆：只由引擎代写；plan 不自动执行，仅作为后续轮次的 secret 上下文 */
export function mentalProposal(actorId: ActorId, m: { thought: string; plan?: string; salience: number; about?: Id[] }): Proposal {
  return {
    op: "memory.write",
    args: {
      ownerId: actorId,
      content: [m.thought, m.plan ? `plan: ${m.plan}` : ""].filter(Boolean).join("\n"),
      tags: ["mental", ...(m.about ?? [])],
      salience: m.salience * 20,
      visibility: "secret",
      ...(m.about?.length ? { about: m.about } : {}),
    },
    reason: "NPC mental activity",
    by: "dialogue.think",
  };
}
