/**
 * 记忆写入前的六道闸门（docs/07 §4、docs/02 §4.4.2）。
 *
 * 为什么要在引擎里做而不是只写在提示词里：
 * 模型会写"关于一个不在场的人的秘密"，也会把同一句话写三遍，还会把秘密直接写进内容。
 * 这些都是**代码能判定的**，交给提示词就是碰运气。
 *
 * 闸门顺序：G2 形状 → G1 归属 → G5 秘密 → G3 去重 → G4 重要度下限 → G6 配额。
 * 任一闸门拦下的条目只记原因、不报错：记忆是"锦上添花"，不能因为它让整个回合失败。
 */
import { createHash } from "node:crypto";
import type { ActorId, Id, MemoryDraft, MemoryRecord, WorldState } from "../../shared/src/index.ts";
import { LlmMemoryDraftSchema } from "../../shared/src/zod/op.ts";

export interface MemoryGateLimits {
  /** 每回合每个 owner 最多写几条（03 §8 memory.writePerTurn） */
  writePerTurn: number;
  /** 每个 session 每个 owner 最多存几条（超出就归档，别让记忆无限膨胀） */
  sessionCap: number;
  contentMax: number;
  /** trigram Jaccard 阈值：超过它视为重复（旧条 salience+1 由调用方处理） */
  similarity: number;
}

export const DEFAULT_MEMORY_GATES: MemoryGateLimits = {
  writePerTurn: 3,
  sessionCap: 30,
  contentMax: 200,
  similarity: 0.8,
};

/**
 * 工作记忆（"最近对话"）的标签：引擎每回合为在场 NPC 滚动替换的派生数据。
 * 它不属于情节记忆，因此**不参与** G3 去重、G4 重要度提升、G6 配额（PR #24 P2-1）：
 * - 不占 sessionCap=30 的情节记忆上限；
 * - 也不会被模型写满 writePerTurn=3 时挤掉（滚动替换由写侧先 tombstone 旧条保证）。
 */
export const WORKING_MEMORY_TAG = "最近对话";

export function isWorkingMemory(r: { tags?: readonly string[] }): boolean {
  return (r.tags ?? []).includes(WORKING_MEMORY_TAG);
}

export type MemoryDropReason =
  | "shape"
  | "owner_absent"
  | "about_absent"
  | "secret_forbidden"
  | "duplicate"
  | "quota"
  | "permanent_forbidden";

export interface MemoryDrop {
  reason: MemoryDropReason;
  detail: string;
}

export interface MemoryGateInput {
  state: WorldState;
  /** 发起本回合的玩家 */
  actorId: ActorId;
  /** 记忆的所有者（通常是当前对谈的 NPC） */
  ownerId: ActorId;
  userId?: Id;
  drafts: readonly MemoryDraft[];
  /**
   * 引擎内部可信的工作记忆草稿（"最近对话"）。
   * 只由 turn.memory.drafts 在引擎内构造，**不来自模型输出**；因此可以跳过 G3/G4/G6。
   * 模型草稿即使伪造 tags=[WORKING_MEMORY_TAG] 也进不了这里——它们走上面的 drafts，
   * 且标签会被清洗掉（#36：信任边界必须是代码结构，不是一条字符串）。
   */
  workingDrafts?: readonly MemoryDraft[];
  /** 同 owner 的近期记忆（去重用；不需要全量） */
  recent: readonly MemoryRecord[];
  /** 同 owner 在本 room 已有的条数（配额用） */
  ownedCount: number;
  /** 引擎内部可信通道（gossip.spread）：收件人常不在场，凭 sourceRefs 跳过 G1 在场检查 */
  trustedChannel?: "gossip";
  limits?: Partial<MemoryGateLimits>;
}

export interface MemoryGateResult {
  accepted: MemoryDraft[];
  dropped: MemoryDrop[];
}

/** 内容哈希（永久层幂等键）：sha256 前 32 位十六进制，够用且短 */
export function contentHashOf(content: string): string {
  return createHash("sha256").update(content.trim(), "utf8").digest("hex").slice(0, 32);
}

/** 字符三元组 Jaccard：中文按字切，英文也按字切（足够区分"同一句"与"同一件事"） */
export function trigramSimilarity(a: string, b: string): number {
  const grams = (s: string): Set<string> => {
    const clean = s.replace(/\s+/g, "");
    const out = new Set<string>();
    if (clean.length <= 3) {
      if (clean.length > 0) out.add(clean);
      return out;
    }
    for (let i = 0; i + 3 <= clean.length; i += 1) out.add(clean.slice(i, i + 3));
    return out;
  };
  const A = grams(a);
  const B = grams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter += 1;
  return inter / (A.size + B.size - inter);
}

/** 把模型给的 `memory[]` 过一遍 zod：坏条目直接丢（不因为一条脏数据让回合失败） */
export function coerceMemoryDrafts(raw: unknown): { drafts: MemoryDraft[]; invalid: number } {
  if (!Array.isArray(raw)) return { drafts: [], invalid: 0 };
  const drafts: MemoryDraft[] = [];
  let invalid = 0;
  for (const item of raw.slice(0, 8)) {
    const parsed = LlmMemoryDraftSchema.safeParse(item);
    if (!parsed.success) {
      invalid += 1;
      continue;
    }
    const v = parsed.data;
    const draft: MemoryDraft = { ownerId: "", content: v.content.trim() };
    // "最近对话"是引擎内部工作记忆的保留标签：模型输入里即便带了也要清洗掉，
    // 否则读侧 isWorkingMemory 会把它误认成可信工作记忆（#36）。
    if (v.tags) draft.tags = v.tags.filter((t) => t.trim() !== WORKING_MEMORY_TAG);
    if (v.salience !== undefined) draft.salience = v.salience;
    if (v.about) draft.about = v.about;
    if (v.visibility) draft.visibility = v.visibility;
    if (v.tier) draft.tier = v.tier;
    drafts.push(draft);
  }
  return { drafts, invalid };
}

export function applyMemoryGates(input: MemoryGateInput): MemoryGateResult {
  const limits = { ...DEFAULT_MEMORY_GATES, ...input.limits };
  const present = new Set(input.state.room.scene.presentIds);
  const owner = input.state.entities[input.ownerId];
  const accepted: MemoryDraft[] = [];
  const dropped: MemoryDrop[] = [];

  if (!owner) {
    for (const _ of [...input.drafts, ...(input.workingDrafts ?? [])]) {
      dropped.push({ reason: "owner_absent", detail: `记忆所有者 ${input.ownerId} 不存在` });
    }
    return { accepted, dropped };
  }

  // 同一回合内的配额是"每 owner"，所以 accepted 里情节记忆的条数就是已用量。
  // 工作记忆只走下面的可信通道，**不**计入 written（#36 / #41）。
  let written = 0;

  for (const raw of input.drafts) {
    // ---------- G2 形状 ----------
    const content = (raw.content ?? "").trim();
    if (content.length === 0 || content.length > limits.contentMax) {
      dropped.push({ reason: "shape", detail: `content 长度须在 1~${limits.contentMax}` });
      continue;
    }
    const tier = raw.tier === "long" ? "long" : "short";
    if (raw.tier === "permanent") {
      dropped.push({ reason: "permanent_forbidden", detail: "permanent 只能由 canonize 产生" });
      continue;
    }
    // 保留标签只由引擎内部加盖；模型/种子草稿带了这个 tag 也清洗掉，不能借此绕过 G3/G4/G6
    const tags = [...new Set((raw.tags ?? []).map((t) => t.trim()).filter((t) => t !== "" && t !== WORKING_MEMORY_TAG))].slice(0, 4);
    const about = [...new Set(raw.about ?? [])];
    let salience = typeof raw.salience === "number" ? Math.min(5, Math.max(1, Math.round(raw.salience))) : 3;
    const visibility = raw.visibility ?? "private";

    // ---------- G1 归属 ----------
    const trustedGossip = input.trustedChannel === "gossip" && (raw.sourceRefs?.length ?? 0) > 0;
    if (!trustedGossip) {
      if (!present.has(input.ownerId)) {
        dropped.push({ reason: "owner_absent", detail: `${input.ownerId} 不在场，不该记得这一刻` });
        continue;
      }
      if (about.some((id) => !present.has(id))) {
        dropped.push({ reason: "about_absent", detail: "记忆里提到了不在场的人" });
        continue;
      }
    }

    // ---------- G5 秘密（turn 只能写非秘密；秘密由导演/引擎代写） ----------
    if (visibility === "secret") {
      dropped.push({ reason: "secret_forbidden", detail: "叙事层不能写 secret 记忆" });
      continue;
    }
    const secretLine = input.state.plots.find((p) => p.status === "active" && p.forbidReveal && content.includes(p.forbidReveal));
    if (secretLine) {
      dropped.push({ reason: "secret_forbidden", detail: `内容直说了 plot ${secretLine.id} 的禁语` });
      continue;
    }

    // ---------- G3 去重（与自己近期的记忆比；相似就丢掉新的，避免同一件事记十遍） ----------
    const dup = input.recent.find(
      (r) => r.ownerId === input.ownerId && r.status !== "tombstoned" && trigramSimilarity(r.content, content) > limits.similarity,
    );
    if (dup) {
      dropped.push({ reason: "duplicate", detail: `与 ${dup.id} 重复` });
      continue;
    }
    if (accepted.some((d) => trigramSimilarity(d.content, content) > limits.similarity)) {
      dropped.push({ reason: "duplicate", detail: "本回合内重复" });
      continue;
    }

    // ---------- G4 重要度下限（玩家相关的记忆至少 4：不能因为模型给 1 就从记忆里消失） ----------
    if (about.includes(input.actorId) || visibility === "public") salience = Math.max(salience, 4);

    // ---------- G6 配额（只约束情节记忆；工作记忆走可信通道，不占这里） ----------
    if (written >= limits.writePerTurn) {
      dropped.push({ reason: "quota", detail: `每回合最多写 ${limits.writePerTurn} 条` });
      continue;
    }
    if (input.ownedCount + written >= limits.sessionCap) {
      dropped.push({ reason: "quota", detail: `该 owner 记忆已达 ${limits.sessionCap} 条上限` });
      continue;
    }

    written += 1;
    const draft: MemoryDraft = { ownerId: input.ownerId, content, tags, salience, about, visibility, tier };
    if (input.userId) draft.userId = input.userId;
    // aboutUserIds 是 canonize → 印象的反查键（审阅 P1-A）：闸门重建草稿时必须带过去，否则整条链断
    if (raw.aboutUserIds && raw.aboutUserIds.length > 0) draft.aboutUserIds = raw.aboutUserIds;
    // contentHash 只属于永久层（世界层幂等键）；回合内只写 short/long，id 由回合序号派生。
    // 按内容哈希给私忆生成 id 会让"同一句话被两个玩家/两个房间记住"撞 id 并静默丢条（审阅 P1）。
    accepted.push(draft);
  }

  // ---------- 工作记忆（引擎内部可信通道，#36） ----------
  // 信任边界是**调用方式**而不是内容：只有 input.workingDrafts 能进来，模型草稿永远走上面的
  // drafts 路径（标签会被清掉）。工作记忆每回合一条、内容天然相近，若走 G3 会被旧条拦住，
  // 若走 G6 会挤占模型/情节记忆的 3/30 配额，因此这里只做形状/归属/秘密检查。
  for (const raw of input.workingDrafts ?? []) {
    const content = (raw.content ?? "").trim();
    if (content.length === 0 || content.length > limits.contentMax) {
      dropped.push({ reason: "shape", detail: `content 长度须在 1~${limits.contentMax}` });
      continue;
    }
    if (raw.tier === "permanent") {
      dropped.push({ reason: "permanent_forbidden", detail: "permanent 只能由 canonize 产生" });
      continue;
    }
    // 引擎侧强制加回保留标签：即使调用方忘了，读侧也能认出它是工作记忆
    const tags = [...new Set([WORKING_MEMORY_TAG, ...(raw.tags ?? []).map((t) => t.trim()).filter(Boolean)])].slice(0, 4);
    const about = [...new Set(raw.about ?? [])];
    if (!present.has(input.ownerId)) {
      dropped.push({ reason: "owner_absent", detail: `${input.ownerId} 不在场，不该记得这一刻` });
      continue;
    }
    if (about.some((id) => !present.has(id))) {
      dropped.push({ reason: "about_absent", detail: "记忆里提到了不在场的人" });
      continue;
    }
    const visibility = raw.visibility ?? "private";
    if (visibility === "secret") {
      dropped.push({ reason: "secret_forbidden", detail: "叙事层不能写 secret 记忆" });
      continue;
    }
    const secretLine = input.state.plots.find((p) => p.status === "active" && p.forbidReveal && content.includes(p.forbidReveal));
    if (secretLine) {
      dropped.push({ reason: "secret_forbidden", detail: `内容直说了 plot ${secretLine.id} 的禁语` });
      continue;
    }
    const draft: MemoryDraft = { ownerId: input.ownerId, content, tags, salience: 3, about, visibility, tier: "short" };
    if (input.userId) draft.userId = input.userId;
    if (raw.aboutUserIds && raw.aboutUserIds.length > 0) draft.aboutUserIds = raw.aboutUserIds;
    accepted.push(draft);
  }

  return { accepted, dropped };
}

/** 把一条通过闸门的草稿转成 op 参数（Proposal.args），保持"引擎只出数据"的边界 */
export function memoryDraftArgs(d: MemoryDraft): Record<string, unknown> {
  const args: Record<string, unknown> = {
    ownerId: d.ownerId,
    content: d.content,
    tags: d.tags ?? [],
    salience: d.salience ?? 3,
    about: d.about ?? [],
    visibility: d.visibility ?? "private",
    tier: d.tier ?? "short",
  };
  if (d.userId) args.userId = d.userId;
  if (d.contentHash) args.contentHash = d.contentHash;
  if (d.aboutUserIds && d.aboutUserIds.length > 0) args.aboutUserIds = d.aboutUserIds;
  return args;
}
