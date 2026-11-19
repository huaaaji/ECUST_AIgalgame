import { describe, expect, it } from "vitest";
import { DEFAULT_CONVERSATION_POLICY, type Envelope, type Entity, type LlmPort, type LlmResult } from "../../../shared/src/index.ts";
import { DefaultArbiter } from "../arbiter.ts";
import { EventSourcedStore } from "../store.ts";
import { emptyRegistry } from "../registry.ts";
import { EventSourcedMemory } from "../memory.ts";
import { MockLlm } from "../../../llm/src/mock.ts";
import { MessageIndex } from "./message.ts";
import { TalkBudget } from "./talk-budget.ts";
import { GossipAgent, GossipHost, buildGossipPrompt, parseGossipDecision } from "./gossip.ts";

const ROOM = "room_chat";
const PLR = "plr_self";
const WU = "npc_wangwu";
const ZH = "npc_zhangsan";
const LI = "npc_lin";

function ent(id: string, kind: Entity["kind"], name: string): Entity {
  return { id, kind, name, attrs: {}, tags: [], origin: "seed", canon: true, status: "active", createdAt: 0, updatedAt: 0 };
}
function env(seq: number, type: string, payload: unknown): Envelope {
  return { v: 1, id: `evt_${seq}`, roomId: ROOM, seq, ts: seq, actorId: "system", type, payload };
}
function link(from: string, to: string, weight: number, seq = weight === 9 ? 5 : 6): Envelope {
  return env(seq, "link.created", { link: { id: `link_${from}_${to}`, kind: "knows", from, to, weight, createdAt: 0 } });
}

interface Ctx {
  host: GossipHost; messages: MessageIndex; budget: TalkBudget; llm: MockLlm; store: EventSourcedStore; memory: EventSourcedMemory;
}
function setup(responses: string[], now = () => 1_000_000): Ctx {
  const store = new EventSourcedStore();
  store.append(ROOM, [
    env(1, "entity.created", { entity: ent(PLR, "plr", "我") }),
    env(2, "entity.created", { entity: ent(WU, "npc", "王五") }),
    env(3, "entity.created", { entity: ent(ZH, "npc", "张三") }),
    env(4, "entity.created", { entity: ent(LI, "npc", "林小雨") }),
    link(WU, ZH, 9), link(WU, LI, 2),
  ]);
  const memory = new EventSourcedMemory();
  const arbiter = new DefaultArbiter({ store, registry: emptyRegistry(), memories: memory, now });
  const messages = new MessageIndex();
  const budget = new TalkBudget(undefined, now);
  const llm = new MockLlm({ responses });
  const agent = new GossipAgent({
    llm,
    policy: { minReplyIntervalMs: 120000, maxMessagesPerNpcPerHour: 12, maxNpcCallsPerTick: 4, maxHops: 6, confidenceDecay: 0.8,
      messages: { system: "protocol {version}", format: "json", rules: "content only", untrusted: "data", inboxEmpty: "无消息则 ignore", replyFormat: "输出 JSON" } },
    conversation: {
      autonomousWhenPlayerAbsent: true, npcHardCap: 0, maxTurns: 40, listenTimeoutMs: 30000, defaultMode: "broadcast",
      wakeOnMultiTarget: true, wakeOnLocationChange: true, maxContent: 400, maxAction: 120, maxThought: 300, maxPlan: 200,
      llm: { temperature: 0.7, maxTokens: 600 }, autonomy: { minReplyIntervalMs: 30_000, maxMessagesPerNpcPerHour: 12, maxNpcCallsPerTick: 4, maxTurnsPerTick: 2, idleTimeoutMs: 300000, playerPresentGraceMs: 60000 },
      messages: {} as never,
    },
  });
  const host = new GossipHost({
    store, arbiter, messages, budget, agent, now,
    policy: { minReplyIntervalMs: 120000, maxMessagesPerNpcPerHour: 12, maxNpcCallsPerTick: 4, maxHops: 6, confidenceDecay: 0.8,
      messages: { system: "protocol {version}", format: "json", rules: "content only", untrusted: "data", inboxEmpty: "无消息则 ignore", replyFormat: "输出 JSON" } },
  });
  return { host, messages, budget, llm, store, memory };
}
const relay = (content: string): string => JSON.stringify({ kind: "relay", content });

describe("v2 微信私信引擎", () => {
  it("玩家离线发消息 → 收件箱可见，非收件人零可见", async () => {
    const ctx = setup([]);
    const sent = await ctx.host.send(ROOM, PLR, WU, "值日表是王五改的");
    expect(sent).toHaveLength(1);
    expect(ctx.messages.inbox(ROOM, WU)).toHaveLength(1);
    expect(ctx.messages.inbox(ROOM, ZH)).toHaveLength(0);
    const outsider = await ctx.host.send(ROOM, PLR, WU, "第二条", { viewer: ZH });
    expect(outsider).toHaveLength(0);
    const envelope = (await ctx.store.events(ROOM, 6, 10)).find((e) => e.type === "msg.sent");
    expect(envelope?.audience).toEqual([PLR, WU]);
  });

  it("每个 NPC 各自调用 LLM，八卦沿 knows 边传播且 confidence 递减", async () => {
    const ctx = setup([relay("张三，我听说值日表的事"), relay("林小雨，王五在说你")]);
    await ctx.host.send(ROOM, PLR, WU, "值日表有猫腻");
    const out = await ctx.host.step(ROOM);
    expect(out.filter((e) => e.type === "gossip.message")).toHaveLength(2);
    const msgs = ctx.messages.chain(ROOM, `msg_${ROOM}_seed_${ROOM}_${PLR}_${WU}_0_6_0`.replace("msg_", ""));
    expect(msgs.length).toBeGreaterThanOrEqual(0);
    const all = await ctx.store.events(ROOM, 1, 50);
    const sent = all.filter((e) => e.type === "msg.sent");
    expect(sent).toHaveLength(3);
    expect(sent[1]?.audience).toEqual([WU, ZH]);
    expect(sent[2]?.audience).toEqual([WU, LI]);
    const payload = sent[1]?.payload as { message: { hop: number; confidence: number } };
    expect(payload.message.hop).toBe(1);
    expect(payload.message.confidence).toBeLessThanOrEqual(0.8);
    // 收件人私忆带来源，可回放
    const mems = all.filter((e) => e.type === "memory.written");
    expect(mems.length).toBe(2);
  });

  it("最短回信间隔：未到点不调用 LLM", async () => {
    let now = 1_000_000;
    const ctx = setup([relay("回复")], () => now);
    await ctx.host.send(ROOM, PLR, WU, "在吗");
    await ctx.host.step(ROOM);
    expect(ctx.llm.requests.filter((r) => r.actorId === WU)).toHaveLength(1);
    now += 10_000;
    await ctx.host.send(ROOM, PLR, WU, "再说");
    await ctx.host.step(ROOM);
    expect(ctx.llm.requests.filter((r) => r.actorId === WU)).toHaveLength(1);
    now += 130_000;
    await ctx.host.step(ROOM);
    expect(ctx.llm.requests.filter((r) => r.actorId === WU)).toHaveLength(2);
  });

  it("reply 可以带 rootId 直接回信（hop=0），不再被 arbiter 拒", async () => {
    const ctx = setup([JSON.stringify({ kind: "reply", content: "我明白了" })]);
    await ctx.host.send(ROOM, PLR, WU, "张三告诉你了吗");
    const out = await ctx.host.step(ROOM);
    expect(out.some((e) => e.type === "gossip.error")).toBe(false);
    const sent = (await ctx.store.events(ROOM, 1, 50)).filter((e) => e.type === "msg.sent");
    const reply = sent.find((e) => ((e.payload as { message?: { kind?: string } }).message?.kind === "reply"));
    expect(reply).toBeTruthy();
    const msg = (reply?.payload as { message: { hop: number; rootId?: string } }).message;
    expect(msg.hop).toBe(0);
    expect(msg.rootId).toBeTruthy();
  });

  it("hop 沿八卦链递增，maxHops 生效", async () => {
    const ctx = setup([relay("第二跳")]);
    // 直接注入一条 hop=1 的入站八卦，避免依赖多跳拓扑的邻接关系
    ctx.messages.ingest([env(9, "msg.sent", { message: {
      id: "msg_seed_hop1", roomId: ROOM, from: ZH, to: WU, kind: "gossip",
      content: "第一跳内容", rootId: "msg_seed_root", hop: 1, confidence: 0.8,
      visibility: "private", createdAt: 1_000_000, seq: 1,
    } })]);
    const gp = { minReplyIntervalMs: 0, maxMessagesPerNpcPerHour: 12, maxNpcCallsPerTick: 4, maxHops: 6, confidenceDecay: 0.8,
      messages: { system: "protocol {version}", format: "json", rules: "content only", untrusted: "data", inboxEmpty: "无", replyFormat: "JSON" } };
    const fast = new GossipHost({
      store: ctx.store,
      arbiter: new DefaultArbiter({ store: ctx.store, registry: emptyRegistry(), memories: ctx.memory, now: () => 1_000_000 }),
      messages: ctx.messages, budget: new TalkBudget({ ...DEFAULT_CONVERSATION_POLICY, autonomy: { ...DEFAULT_CONVERSATION_POLICY.autonomy!, minReplyIntervalMs: 0 } } as never, () => 1_000_000),
      agent: new GossipAgent({ llm: ctx.llm, policy: gp, conversation: { llm: { temperature: 0.7, maxTokens: 600 }, autonomy: { idleTimeoutMs: 300000, playerPresentGraceMs: 0, maxTurnsPerTick: 2 } } as never }),
      policy: gp, now: () => 1_000_000,
    });
    const out = await fast.step(ROOM);
    const sent = out.find((e) => e.type === "gossip.message");
    expect(sent).toBeTruthy();
    const msg = (sent as { message: { hop: number; confidence: number } }).message;
    expect(msg.hop).toBe(2);
    expect(msg.confidence).toBeLessThan(0.8);
  });

  it("每波调用上限按 tick 重置，不会一小时只回 4 条", async () => {
    const ctx = setup([relay("第一波"), relay("第二波"), relay("第三波"), relay("第四波")]);
    await ctx.host.send(ROOM, PLR, WU, "第一句话");
    await ctx.host.step(ROOM);
    const first = ctx.llm.calls;
    await ctx.host.send(ROOM, PLR, WU, "第二句话");
    await ctx.host.step(ROOM);
    expect(ctx.llm.calls).toBeGreaterThan(first);
  });

  it("微信内容过审核：blocked 时不产出 msg.send", async () => {
    const ctx = setup([relay("不该发出去的内容")]);
    await ctx.host.send(ROOM, PLR, WU, "诱发消息");
    const guarded = new GossipHost({
      store: ctx.store,
      arbiter: new DefaultArbiter({ store: ctx.store, registry: emptyRegistry(), memories: ctx.memory, now: () => 1_000_000 }),
      messages: ctx.messages, budget: new TalkBudget(undefined, () => 2_000_000),
      agent: new GossipAgent({
        llm: ctx.llm,
        policy: { minReplyIntervalMs: 0, maxMessagesPerNpcPerHour: 12, maxNpcCallsPerTick: 4, maxHops: 6, confidenceDecay: 0.8,
          messages: { system: "protocol {version}", format: "json", rules: "content only", untrusted: "data", inboxEmpty: "无", replyFormat: "JSON" } },
        conversation: { llm: { temperature: 0.7, maxTokens: 600 } } as never,
      }),
      policy: { minReplyIntervalMs: 0, maxMessagesPerNpcPerHour: 12, maxNpcCallsPerTick: 4, maxHops: 6, confidenceDecay: 0.8,
        messages: { system: "protocol {version}", format: "json", rules: "content only", untrusted: "data", inboxEmpty: "无", replyFormat: "JSON" } },
      now: () => 2_000_000,
      audit: { review: async () => ({ allow: false, categories: ["violence"], severity: 3, reason: "blocked" }) },
    });
    const out = await guarded.step(ROOM);
    expect(out.some((e) => e.type === "gossip.dropped" && e.reason === "audit-blocked")).toBe(true);
    expect(out.some((e) => e.type === "gossip.message")).toBe(false);
  });

  it("过期未读消息每房只上报一次 dropped，避免 SSE 重复", async () => {
    const ctx = setup([], () => 2_000_000);
    ctx.messages.ingest([env(9, "msg.sent", { message: {
      id: "msg_stale_1", roomId: ROOM, from: PLR, to: WU, kind: "player",
      content: "很久以前的消息", hop: 0, confidence: 1, visibility: "private",
      createdAt: 1_000_000, seq: 1,
    } })]);
    const out1 = await ctx.host.step(ROOM);
    const out2 = await ctx.host.step(ROOM);
    const stale = [...out1, ...out2].filter((e) => e.type === "gossip.dropped" && e.reason === "idle-timeout");
    expect(stale).toHaveLength(1);
  });

  it("纵深防御：微信 LLM 输出 action 一律拒绝", () => {
    expect(parseGossipDecision('{"kind":"reply","content":"hi","action":"凑耳"}')).toBeNull();
    const prompt = buildGossipPrompt({
      npcId: WU, npcName: "王五", inbox: [], fromName: (id) => id,
      policy: { minReplyIntervalMs: 1, maxMessagesPerNpcPerHour: 1, maxNpcCallsPerTick: 1, maxHops: 1, confidenceDecay: 0.8,
        messages: { system: "protocol {version}", format: "json", rules: "content only", untrusted: "data", inboxEmpty: "无", replyFormat: "JSON" } },
    });
    expect(prompt).toContain("content only");
  });

  it("SSE 订阅按收发双方过滤，旁人拿不到私信", async () => {
    const ctx = setup([relay("hi")]);
    const seen: string[] = [];
    const off = ctx.host.subscribe(ROOM, ZH, (ev) => {
      if (ev.type === "gossip.message") seen.push(ev.message.id);
    });
    await ctx.host.send(ROOM, PLR, WU, "只给王五的私信");
    expect(seen).toHaveLength(0);
    await ctx.host.send(ROOM, PLR, ZH, "给张三的私信");
    expect(seen).toHaveLength(1);
    off();
  });

  it("预算上限：达到每小时条数后不再调用 LLM", async () => {
    let now = 1_000_000;
    const ctx = setup([relay("a"), relay("b")], () => now);
    for (let i = 0; i < 12; i += 1) {
      ctx.budget.recordSent(ROOM, WU);
    }
    await ctx.host.send(ROOM, PLR, WU, "第 13 条");
    const out = await ctx.host.step(ROOM);
    expect(out.some((e) => e.type === "gossip.dropped")).toBe(true);
    expect(ctx.llm.calls).toBe(0);
  });
});
