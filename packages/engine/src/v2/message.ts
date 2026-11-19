/**
 * 微信私信投影（dev/v2）：只读 msg.sent 事件，维护收件箱与八卦链。
 * 消息不进 WorldState —— 它是通信日志，不是世界状态；这样 Agent 的"心智"不会被私信覆盖。
 */
import type { Envelope, Id, MessageRecord, RoomId, ActorId } from "../../../shared/src/index.ts";
import type { MessageDigest } from "../../../shared/src/index.ts";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export class MessageIndex {
  private readonly byRoom = new Map<RoomId, MessageRecord[]>();
  private readonly byId = new Map<Id, MessageRecord>();

  /** 增量投影；重复 ingest 同一事件不会重复入库（键 = 事件里的 message.id） */
  ingest(envs: readonly Envelope[]): number {
    let added = 0;
    for (const env of envs) {
      if (env.type !== "msg.sent" || !isRecord(env.payload)) continue;
      const raw = env.payload.message;
      if (!isRecord(raw)) continue;
      const { id, roomId, from, to, kind, content, rootId, replyTo, hop, confidence, createdAt, seq } = raw;
      if (
        typeof id !== "string" || typeof roomId !== "string" || typeof from !== "string" ||
        typeof to !== "string" || typeof content !== "string" || typeof kind !== "string" ||
        typeof hop !== "number" || typeof confidence !== "number" || typeof createdAt !== "number" ||
        typeof seq !== "number"
      ) continue;
      if (this.byId.has(id)) continue;
      const record: MessageRecord = {
        id, roomId, from, to,
        kind: kind as MessageRecord["kind"],
        content,
        rootId: typeof rootId === "string" ? rootId : undefined,
        replyTo: typeof replyTo === "string" ? replyTo : undefined,
        hop, confidence,
        visibility: "private",
        createdAt, seq,
      };
      const list = this.byRoom.get(roomId) ?? [];
      list.push(record);
      this.byRoom.set(roomId, list);
      this.byId.set(id, record);
      added += 1;
    }
    return added;
  }

  /** 全量重建（重启/回放）：同一房间可安全重复调用 */
  rebuild(roomId: RoomId, envs: readonly Envelope[]): void {
    for (const rec of this.byRoom.get(roomId) ?? []) this.byId.delete(rec.id);
    this.byRoom.set(roomId, []);
    this.ingest(envs.filter((e) => e.roomId === roomId));
  }

  /** 收件箱按时间升序；limit 控制提示词体积 */
  inbox(roomId: RoomId, to: ActorId, limit = 20): MessageDigest[] {
    return (this.byRoom.get(roomId) ?? [])
      .filter((m) => m.to === to)
      .slice(-limit)
      .map((m) => ({ id: m.id, from: m.from, kind: m.kind, content: m.content, rootId: m.rootId, hop: m.hop, createdAt: m.createdAt }));
  }

  /** 玩家最近一次发信时间：dev/v2 playerPresentGraceMs 的判定依据 */
  lastFrom(roomId: RoomId, from: ActorId): MessageRecord | undefined {
    const all = this.byRoom.get(roomId) ?? [];
    for (let i = all.length - 1; i >= 0; i--) if (all[i]!.from === from) return all[i];
    return undefined;
  }

  /** 判断消息是否已被 NPC 回复过（同一 root/replyTo 链内） */
  hasReplyTo(roomId: RoomId, id: Id): boolean {
    return (this.byRoom.get(roomId) ?? []).some((m) => m.replyTo === id);
  }

  byMessageId(id: Id): MessageRecord | undefined {
    return this.byId.get(id);
  }

  chain(roomId: RoomId, rootId: Id): MessageRecord[] {
    return (this.byRoom.get(roomId) ?? []).filter((m) => m.rootId === rootId);
  }
}
