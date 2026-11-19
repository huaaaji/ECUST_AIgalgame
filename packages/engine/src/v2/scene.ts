/**
 * 场景 agent（dev/v2）：开场广播一次 → 下线；被显式 @多人 / 换地点 唤醒 → 产出群像总结。
 * 总结不进世界状态，作为**半常驻特权注入**（S1.5 之后、forced、按 id 排序）进入 NPC 上下文。
 * 这里只定义端口与编排；真正的"怎么写场景"由注入的 SceneAgentPort 决定（通常是另一个 LLM 调用）。
 */
import type { Id, SceneBeat, SceneMemory, Utterance } from "../../../shared/src/index.ts";

export interface SceneAgentPort {
  /** 开场：描述当前地点与在场者 */
  describe(input: { roomId: Id; locName?: string; present: readonly Id[] }): Promise<string>;
  /** 唤醒：总结群像场景 */
  summarize(input: {
    roomId: Id;
    trigger: "multi" | "location";
    recent: readonly string[];
    previous?: string;
  }): Promise<string>;
}

export interface WakeInput {
  utterance?: Utterance;
  locationChanged: boolean;
  wakeOnMultiTarget: boolean;
  wakeOnLocationChange: boolean;
}

/** 唤醒条件：显式 @全体 / @多人，或换地点。悄悄话/不动声色的单体 @ 不算。 */
export function shouldWake(input: WakeInput): "multi" | "location" | null {
  const t = input.utterance?.target;
  const many = t === "all" || (Array.isArray(t) && t.length >= 2);
  if (input.wakeOnMultiTarget && many) return "multi";
  if (input.wakeOnLocationChange && input.locationChanged) return "location";
  return null;
}

export class SceneManager {
  private readonly beats = new Map<Id, SceneBeat[]>();
  private readonly memories = new Map<Id, SceneMemory>();

  constructor(
    private readonly agent: SceneAgentPort,
    private readonly now: () => number = Date.now,
  ) {}

  async open(sessionId: Id, roomId: Id, locName: string | undefined, present: readonly Id[], locId?: Id): Promise<SceneBeat> {
    const text = (await this.agent.describe({ roomId, locName, present })).trim();
    const beat: SceneBeat = {
      id: `scene_${sessionId}_0`,
      kind: "opening",
      roomId,
      ...(locId ? { locId } : {}),
      text,
      createdAt: this.now(),
      order: "before",
    };
    this.beats.set(sessionId, [beat]);
    return beat;
  }

  /**
   * 唤醒：产出一条 summary beat，并把最新总结写进会话级 SceneMemory。
   * order="after" 表示排在玩家发言之后（@多人）→ NPC 优先对玩家反应；
   * order="before" 表示换地点发生在发言之前 → NPC 按心理/背景自由发挥。
   */
  async wake(
    sessionId: Id,
    roomId: Id,
    trigger: "multi" | "location",
    recent: readonly string[],
    locId?: Id,
  ): Promise<SceneBeat> {
    const previous = this.memories.get(sessionId)?.text;
    const text = (await this.agent.summarize({ roomId, trigger, recent, previous })).trim();
    const list = this.beats.get(sessionId) ?? [];
    const beat: SceneBeat = {
      id: `scene_${sessionId}_${list.length}`,
      kind: "summary",
      roomId,
      ...(locId ? { locId } : {}),
      text,
      createdAt: this.now(),
      order: trigger === "location" ? "before" : "after",
    };
    this.beats.set(sessionId, [...list, beat]);
    this.memories.set(sessionId, {
      id: beat.id,
      roomId,
      origin: "scene",
      text,
      createdAt: beat.createdAt,
    });
    return beat;
  }

  memory(sessionId: Id): SceneMemory | undefined {
    return this.memories.get(sessionId);
  }

  list(sessionId: Id): SceneBeat[] {
    return [...(this.beats.get(sessionId) ?? [])];
  }

  /**
   * 半常驻注入文本：标题 + 按 id 排序的条目（逐字节稳定，保住提示词缓存前缀）。
   * 只返回最新一条 summary（旧的被取代），没有则空串。
   */
  render(sessionId: Id): string {
    const mem = this.memories.get(sessionId);
    if (!mem) return "";
    return [`【场景·群像】（${mem.id}）`, mem.text].join("\n");
  }
}

/** 心理活动的文本上限与"有逻辑/世界相关"的提示：给 NPC agent 拼 prompt 用 */
export function mentalFraming(): string {
  return [
    "写下你此刻的真实想法：必须因果相关（因为刚才发生了什么，所以你怎么想），并引用在场的人或具体细节。",
    "可以包含下一步打算（plan），但计划不会自动执行——之后是否行动由你自己决定。",
    "心理活动只有你自己知道，其他人和玩家都看不到；他们只能看到你的神色动作。",
  ].join("\n");
}
