/** PR #51 review 回归：审核扩面 / 落盘重试 / zod 边界 / 数据驱动 / 幂等键 */
import { describe, expect, it } from "vitest";
import type { ConversationEvent, ConversationPolicy, ConversationSessionV2, Entity, Envelope, LlmPort, LlmResult, Utterance } from "../../../shared/src/index.ts";
import type { AuditPort, AuditVerdict } from "../audit.ts";
import { MockLlm } from "../../../llm/src/mock.ts";
import { DefaultArbiter } from "../arbiter.ts";
import { EventSourcedStore } from "../store.ts";
import { emptyRegistry } from "../registry.ts";
import { EventSourcedMemory } from "../memory.ts";
import { AuditGate } from "../audit.gate.ts";
import { DEFAULT_AUDIT_POLICY } from "../audit.ts";
import { loadConversationPolicy, loadModes, validateUtterance } from "./delivery.ts";
import { SceneManager, type SceneAgentPort } from "./scene.ts";
import { NpcAgent, parseDecision } from "./npc-agent.ts";
import { ConversationAudit } from "./audit.ts";
import { ConversationHostV2 } from "./conversation.ts";

const ROOT = new URL("../../../../", import.meta.url).pathname;
const MODES = `${ROOT}content/v2/utterance-modes.json`;
const POLICY = `${ROOT}content/v2/conversation-policy.json`;
const ROOM = "room_chat";
const PLR = "plr_self";
const LIN = "npc_lin";
const MA = "npc_ma";
const GATE = "loc_library";

function entity(id: string, kind: Entity["kind"], name: string): Entity {
  return { id, kind, name, attrs: {}, tags: [], origin: "seed", canon: true, status: "active", createdAt: 0, updatedAt: 0 };
}
function env(seq: number, type: string, payload: unknown): Envelope {
  return { v: 1, id: `evt_${seq}`, roomId: ROOM, seq, ts: seq, actorId: "system", type, payload };
}
const sceneAgent: SceneAgentPort = {
  describe: async ({ locName }) => `开场：${locName}`,
  summarize: async ({ trigger }) => `场景更新（${trigger}）：几人各怀心思`,
};
const speak = (id: string, mode: string, patch: Partial<Utterance> = {}): string =>
  JSON.stringify({ kind: "speak", utterance: { id, mode, ...patch } });
const think = (thought: string, plan?: string): string => JSON.stringify({ kind: "think", mental: { thought, plan, salience: 4 } });

class FakeAudit implements AuditPort {
  readonly inputs: { actorId: string; text: string }[] = [];
  constructor(private readonly verdicts: AuditVerdict[] = []) {}
  async review(input: { actorId: string; text: string }): Promise<AuditVerdict> {
    this.inputs.push({ actorId: input.actorId, text: input.text });
    return this.verdicts.shift() ?? { allow: true, categories: [], severity: 0, reason: "ok" };
  }
}
class FailOnceStore extends EventSourcedStore {
  fail = true;
  override async flush(roomId: string): Promise<void> {
    if (this.fail) {
      this.fail = false;
      throw new Error("disk temporarily unavailable");
    }
    await super.flush(roomId);
  }
}
class ThrowingLlm implements LlmPort {
  calls = 0;
  async chat(): Promise<LlmResult> {
    this.calls += 1;
    throw new Error("upstream down");
  }
}

async function setup(opts: {
  responses?: string[];
  llm?: LlmPort;
  audit?: AuditPort;
  store?: EventSourcedStore;
  arbiter?: DefaultArbiter;
  policy?: ConversationPolicy;
  present?: string[];
  now?: () => number;
} = {}) {
  const store = opts.store ?? new EventSourcedStore({ worldId: "w1", locId: GATE });
  if (!opts.store) {
    store.append(ROOM, [
      env(1, "entity.created", { entity: entity(GATE, "loc", "图书馆") }),
      env(2, "entity.created", { entity: entity(PLR, "plr", "我") }),
      env(3, "entity.created", { entity: entity(LIN, "npc", "林月") }),
      env(4, "entity.created", { entity: entity(MA, "npc", "马骁") }),
      env(5, "scene.changed", { locId: GATE, presentIds: opts.present ?? [PLR, LIN, MA] }),
    ]);
  }
  const registry = emptyRegistry();
  const memory = new EventSourcedMemory();
  const arbiter = opts.arbiter ?? new DefaultArbiter({ store, registry, memories: memory });
  const modes = await loadModes(MODES);
  const policy = opts.policy ?? await loadConversationPolicy(POLICY);
  const llm = opts.llm ?? new MockLlm({ responses: opts.responses ?? [] });
  const fakeAudit = opts.audit ?? new FakeAudit();
  const gate = new AuditGate({ arbiter, store, registry, audit: fakeAudit, policy: DEFAULT_AUDIT_POLICY });
  const host = new ConversationHostV2({
    store,
    arbiter,
    registry,
    memory,
    modes,
    policy,
    scene: new SceneManager(sceneAgent, () => 1000),
    npc: new NpcAgent({ llm, modes, policy }),
    audit: new ConversationAudit(fakeAudit, DEFAULT_AUDIT_POLICY, gate),
    now: opts.now,
  });
  const session = await host.open({ roomId: ROOM, participants: [PLR, LIN, MA] });
  return { host, session, memory, store, llm, audit: fakeAudit };
}

async function collect(it: AsyncIterable<ConversationEvent>): Promise<ConversationEvent[]> {
  const out: ConversationEvent[] = [];
  for await (const ev of it) out.push(ev);
  return out;
}

describe("PR#51 P1 回归", () => {
  it("①审核扩面：玩家发言与 NPC 的 content/action/coverAction/notice/thought/plan 都进审核文本", async () => {
    const audit = new FakeAudit();
    const { host, session, llm } = await setup({
      audit,
      responses: [
        speak("utt_l", "broadcast", { content: "我看见了", action: "皱眉", coverAction: "摊手", notice: "注意听" }),
        think("马骁沉默太久", "下回合试探他"),
      ],
    });
    await collect(
      host.run(session.id, {
        clientTurnId: "t-audit",
        utterance: { id: "utt_p", speaker: PLR, mode: "broadcast", content: "大家怎么看", action: "看向两人" },
      }),
    );
    expect(audit.inputs).toHaveLength(3); // 玩家 + 2 个 NPC
    const all = audit.inputs.map((i) => i.text).join("\n");
    for (const label of ["content", "action", "coverAction", "notice", "thought", "plan"]) {
      expect(all).toContain(`[${label}]`);
    }
    expect((llm as MockLlm).calls).toBe(2);
  });

  it("①玩家被拦截 → 只发 notice、不投递、不调 NPC 模型", async () => {
    const audit = new FakeAudit([{ allow: false, categories: ["violence"], severity: 3, reason: "blocked" }]);
    const { host, session, llm } = await setup({ audit, responses: [think("不该发生")] });
    const events = await collect(
      host.run(session.id, {
        clientTurnId: "t-block",
        utterance: { id: "utt_p", speaker: PLR, mode: "broadcast", content: "暴力内容" },
      }),
    );
    expect(events.some((e) => e.type === "conversation.notice")).toBe(true);
    expect(events.some((e) => e.type === "conversation.utterance")).toBe(false);
    expect(events.some((e) => e.type === "conversation.committed")).toBe(false);
    expect((llm as MockLlm).calls).toBe(0);
  });

  it("①审核器故障 → fail-closed 且不惩罚玩家", async () => {
    const audit: AuditPort = { review: async () => { throw new Error("audit offline"); } };
    const { host, session } = await setup({ audit });
    const events = await collect(
      host.run(session.id, { clientTurnId: "t-offline", utterance: { id: "u1", speaker: PLR, mode: "broadcast", content: "你好" } }),
    );
    expect(events.some((e) => e.type === "conversation.error" && e.code === "E_CONTENT_BLOCKED")).toBe(true);
    expect(events.some((e) => e.type === "conversation.notice")).toBe(false);
  });

  it("③flush 失败 → retryable 且不写幂等；重试不重复调用 LLM / 不发重复提案", async () => {
    const store = new FailOnceStore({ worldId: "w1", locId: GATE });
    store.append(ROOM, [
      env(1, "entity.created", { entity: entity(GATE, "loc", "图书馆") }),
      env(2, "entity.created", { entity: entity(PLR, "plr", "我") }),
      env(3, "entity.created", { entity: entity(LIN, "npc", "林月") }),
      env(4, "entity.created", { entity: entity(MA, "npc", "马骁") }),
      env(5, "scene.changed", { locId: GATE, presentIds: [PLR, LIN, MA] }),
    ]);
    const llm = new MockLlm({ responses: [speak("utt_l", "broadcast", { content: "我说话" }), think("沉默")] });
    const { host, session } = await setup({ store, llm });
    const input = { clientTurnId: "t-flush", utterance: { id: "u1", speaker: PLR, mode: "broadcast", content: "开始" } } as const;
    const first = await collect(host.run(session.id, input));
    expect(first.some((e) => e.type === "conversation.error" && e.code === "E_STORE_FAULT" && e.retryable)).toBe(true);
    expect((llm as MockLlm).calls).toBe(2);
    const second = await collect(host.run(session.id, input));
    expect(second.some((e) => e.type === "conversation.committed")).toBe(true);
    expect((llm as MockLlm).calls).toBe(2); // 重试没有再问模型
    expect((await store.events(ROOM, 0)).filter((e) => e.type === "memory.written")).toHaveLength(3); // 玩家 + NPC 发言 + 心理活动，没有重复落库
  });

  it("④parseDecision 用 zod 拒绝非法字段（coverAction 数字 / target 数组含空串）", () => {
    expect(parseDecision('{"kind":"speak","utterance":{"id":"x","mode":"broadcast","content":"hi","coverAction":123}}')).toBeNull();
    expect(parseDecision('{"kind":"speak","utterance":{"id":"x","mode":"whisper","target":["npc_lin",""],"content":"hi","action":"凑耳"}}')).toBeNull();
    expect(parseDecision('{"kind":"speak","utterance":{"id":"x","mode":"broadcast","content":"hi"}}')).not.toBeNull();
  });

  it("⑤mode 数据驱动：自定义模式的 requiresTarget/contentless 生效，没有按 mode id 硬编码", async () => {
    const modes = await loadModes(MODES);
    const custom = new Map(modes);
    custom.set("hush", { ...(modes.get("whisper")!), id: "hush", label: "自定义悄悄话", requiresTarget: true });
    const policy = await loadConversationPolicy(POLICY);
    const state = { room: { scene: { presentIds: [PLR, LIN, MA] } } } as never;
    expect(validateUtterance({ id: "u", speaker: PLR, mode: "hush", content: "hi" }, custom, policy, [PLR, LIN, MA]).ok).toBe(false);
    expect(validateUtterance({ id: "u", speaker: PLR, mode: "hush", target: LIN, content: "hi", action: "凑耳" }, custom, policy, [PLR, LIN, MA]).ok).toBe(true);
    // 缺省 mode 来自 policy.defaultMode，未知 mode 不会被静默当 broadcast
    expect(validateUtterance({ id: "u", speaker: PLR, mode: "unknown_mode", content: "hi" }, custom, policy, [PLR, LIN, MA]).ok).toBe(false);
    expect(state).toBeTruthy();
  });

  it("⑥幂等键带 actorId：同 clientTurnId 不同说话人不是同一请求", async () => {
    const { host, session, llm } = await setup({ responses: [think("x"), think("y"), think("z"), think("w")] });
    await collect(host.run(session.id, { clientTurnId: "same", utterance: { id: "u1", speaker: PLR, mode: "broadcast", content: "甲" } }));
    await collect(host.run(session.id, { clientTurnId: "same", utterance: { id: "u2", speaker: LIN, mode: "broadcast", content: "乙" } }));
    expect((llm as MockLlm).calls).toBe(3); // 第二次说话人是 NPC，只剩 1 个其他 NPC 要回应；若 key 不带 actorId 第二次会被缓存吞掉
  });

  it("②listenTimeoutMs 到期可恢复，resumeExpired 返回会话 id", async () => {
    let now = 1000;
    const { host, session } = await setup({ now: () => now, responses: [] });
    await collect(host.run(session.id, { clientTurnId: "i1", interject: PLR }));
    expect(host.get(session.id)?.phase).toBe("listening");
    now = 1000 + 31_000;
    expect(host.resumeExpired()).toContain(session.id);
    expect(host.get(session.id)?.phase).toBe("speaking");
  });

  it("LLM 抛异常 → NPC 静默、不产提案、会话仍可结算", async () => {
    const llm = new ThrowingLlm();
    const { host, session } = await setup({ llm });
    const events = await collect(
      host.run(session.id, { clientTurnId: "t-throw", utterance: { id: "u1", speaker: PLR, mode: "broadcast", content: "你好" } }),
    );
    expect(llm.calls).toBe(2);
    expect(events.some((e) => e.type === "conversation.committed")).toBe(true);
    expect(events.some((e) => e.type === "conversation.utterance")).toBe(true); // 玩家自己的话仍投递
  });
});

describe("PR#51 P2 回归", () => {
  it("addressed notice：非目标收到『对 X 说』提示，目标与说话人不收到", async () => {
    const { host, session } = await setup({});
    const events = await collect(
      host.run(session.id, {
        clientTurnId: "t-addressed",
        utterance: { id: "u1", speaker: PLR, mode: "addressed", target: LIN, content: "林月，你怎么看" },
      }),
    );
    const ds = events.flatMap((e) => (e.type === "conversation.utterance" ? [e.delivery] : []));
    expect(ds.find((d) => d.to === MA)?.notice).toContain("林月");
    expect(ds.find((d) => d.to === LIN)?.notice).toBeUndefined();
    expect(ds.find((d) => d.to === PLR)?.notice).toBeUndefined();
  });

  it("atomic 回滚：ApplyResult 不 ok → 不发 committed、记忆不落库", async () => {
    const stub = {
      apply: async () => ({
        ok: false,
        mode: "atomic",
        seq: 6,
        applied: [],
        rejected: [{ proposal: { op: "memory.write", args: { ownerId: PLR, content: "x" } }, code: "E_PRECONDITION", detail: "test" }],
        events: [],
        error: { code: "E_PRECONDITION", message: "测试拒绝" },
      }),
      endTurn: () => {},
    } as unknown as DefaultArbiter;
    const { host, session, store } = await setup({ arbiter: stub, responses: [think("x"), think("y")] });
    const events = await collect(
      host.run(session.id, { clientTurnId: "t-reject", utterance: { id: "u1", speaker: PLR, mode: "broadcast", content: "hi" } }),
    );
    expect(events.some((e) => e.type === "conversation.error" && e.code === "E_PRECONDITION")).toBe(true);
    expect(events.some((e) => e.type === "conversation.committed")).toBe(false);
    expect((await store.events(ROOM, 0)).filter((e) => e.type === "memory.written")).toHaveLength(0);
  });

  it("幂等缓存有上限（≤256），不会无限增长", async () => {
    const { host, session } = await setup({});
    for (let i = 0; i < 260; i++) {
      await collect(host.run(session.id, { clientTurnId: `i${i}`, interject: PLR }));
    }
    expect(host.idempotencySize).toBeLessThanOrEqual(256);
  });
});

describe("PR#51 二审回归", () => {
  it("A：换地点真的触发场景唤醒（locId 落进 beat，order=before）", async () => {
    const { host, session, store } = await setup({ responses: [] });
    store.append(ROOM, [env(6, "scene.changed", { locId: "loc_cafe", presentIds: [PLR, LIN, MA] })]);
    const events = await collect(
      host.run(session.id, { clientTurnId: "t-loc", utterance: { id: "u1", speaker: PLR, mode: "broadcast", content: "到了新地方" } }),
    );
    const beat = events.flatMap((e) => (e.type === "conversation.scene" ? [e.beat] : []))[0];
    expect(beat?.text).toContain("location");
    expect(beat?.locId).toBe("loc_cafe");
    expect(beat?.order).toBe("before");
    expect(host.get(session.id)?.lastLocId).toBe("loc_cafe");
    // 同一地点不应再次唤醒
    const again = await collect(host.run(session.id, { clientTurnId: "t-loc2", utterance: { id: "u2", speaker: PLR, mode: "broadcast", content: "还是这里" } }));
    expect(again.some((e) => e.type === "conversation.scene")).toBe(false);
  });

  it("E：autonomousWhenPlayerAbsent=false 且玩家不在场 → NPC 不自主续聊，但仍发 committed", async () => {
    const base = await loadConversationPolicy(POLICY);
    const { host, session, llm } = await setup({
      policy: { ...base, autonomousWhenPlayerAbsent: false },
      present: [LIN, MA],
      responses: [speak("l1", "broadcast", { content: "不该发生" }), speak("m1", "broadcast", { content: "不该发生" })],
    });
    const events = await collect(host.run(session.id, { clientTurnId: "t-auto" }));
    expect((llm as MockLlm).calls).toBe(0);
    expect(events.some((e) => e.type === "conversation.committed")).toBe(true);
  });

  it("H：resumeExpiredEvents 带回 phase 事件", async () => {
    let now = 1000;
    const { host, session } = await setup({ now: () => now, responses: [] });
    await collect(host.run(session.id, { clientTurnId: "i1", interject: PLR }));
    now += 31_000;
    const evs = host.resumeExpiredEvents();
    expect(evs.some((e) => e.type === "conversation.phase" && e.phase === "speaking")).toBe(true);
  });

  it("F：同房间并发两个回合都提交，seq 单调，无 E_SEQ_GAP", async () => {
    const { host, session, store } = await setup({ responses: [think("a"), think("b"), think("c"), think("d")] });
    const [a, b] = await Promise.all([
      collect(host.run(session.id, { clientTurnId: "p1", utterance: { id: "u1", speaker: PLR, mode: "broadcast", content: "甲" } })),
      collect(host.run(session.id, { clientTurnId: "p2", utterance: { id: "u2", speaker: PLR, mode: "broadcast", content: "乙" } })),
    ]);
    for (const events of [a, b]) expect(events.some((e) => e.type === "conversation.error" && e.code === "E_SEQ_GAP")).toBe(false);
    expect([...a, ...b].filter((e) => e.type === "conversation.committed")).toHaveLength(2);
    const logs = await store.events(ROOM, 0);
    expect(logs[logs.length - 1]?.seq).toBe(logs.length);
  });

  it("B：flush 重试成功后事件流不重复携带旧的 E_STORE_FAULT", async () => {
    const store = new FailOnceStore({ worldId: "w1", locId: GATE });
    store.append(ROOM, [
      env(1, "entity.created", { entity: entity(GATE, "loc", "图书馆") }),
      env(2, "entity.created", { entity: entity(PLR, "plr", "我") }),
      env(3, "entity.created", { entity: entity(LIN, "npc", "林月") }),
      env(4, "entity.created", { entity: entity(MA, "npc", "马骁") }),
      env(5, "scene.changed", { locId: GATE, presentIds: [PLR, LIN, MA] }),
    ]);
    const { host, session } = await setup({ store, responses: [JSON.stringify({ kind: "silent", reason: "ok" })] });
    const input = { clientTurnId: "t1", utterance: { id: "u1", speaker: PLR, mode: "broadcast" as const, content: "各位早" } };
    const first = await collect(host.run(session.id, input));
    expect(first.filter((e) => e.type === "conversation.error" && e.code === "E_STORE_FAULT")).toHaveLength(1);
    const second = await collect(host.run(session.id, input));
    expect(second.filter((e) => e.type === "conversation.error")).toHaveLength(0);
    expect(second.some((e) => e.type === "conversation.committed")).toBe(true);
  });

  it("四审：flush 重试成功后前移 lastLocId，下一轮不重复唤醒同一移动", async () => {
    const store = new FailOnceStore({ worldId: "w1", locId: GATE });
    store.append(ROOM, [
      env(1, "entity.created", { entity: entity(GATE, "loc", "图书馆") }),
      env(2, "entity.created", { entity: entity(PLR, "plr", "我") }),
      env(3, "entity.created", { entity: entity(LIN, "npc", "林月") }),
      env(4, "entity.created", { entity: entity(MA, "npc", "马骁") }),
      env(5, "scene.changed", { locId: GATE, presentIds: [PLR, LIN, MA] }),
    ]);
    const { host, session } = await setup({ store, responses: [JSON.stringify({ kind: "silent", reason: "ok" })] });
    store.append(ROOM, [env(6, "scene.changed", { locId: "loc_cafe", presentIds: [PLR, LIN, MA] })]);
    const input = { clientTurnId: "t-move", utterance: { id: "u-move", speaker: PLR, mode: "broadcast" as const, content: "到了" } };
    const first = await collect(host.run(session.id, input));
    expect(first.some((e) => e.type === "conversation.error" && e.code === "E_STORE_FAULT")).toBe(true);
    const retry = await collect(host.run(session.id, input));
    expect(retry.some((e) => e.type === "conversation.committed")).toBe(true);
    expect(host.get(session.id)?.lastLocId).toBe("loc_cafe");
    const again = await collect(host.run(session.id, { clientTurnId: "t-again", utterance: { id: "u-again", speaker: PLR, mode: "broadcast", content: "继续" } }));
    expect(again.some((e) => e.type === "conversation.scene")).toBe(false);
  });

  it("五审：会话淘汰跳过仍有 pendingFlush 的会话", async () => {
    const { host } = await setup({ responses: [] });
    const internal = host as unknown as {
      sessions: Map<string, ConversationSessionV2>;
      pendingFlush: Map<string, { s: ConversationSessionV2 }>;
    };
    const protectedSession = internal.sessions.values().next().value as ConversationSessionV2;
    internal.pendingFlush.set("pending-1", { s: protectedSession });
    for (let i = 0; i < 260; i += 1) await host.open({ roomId: ROOM, participants: [PLR, LIN, MA] });
    expect(internal.sessions.size).toBeLessThanOrEqual(256);
    expect(internal.sessions.has(protectedSession.id)).toBe(true);
  });
});
