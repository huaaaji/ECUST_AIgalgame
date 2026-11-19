import { describe, expect, it } from "vitest";
import type { ConversationEvent, Entity, Envelope, Utterance } from "../../../shared/src/index.ts";
import { MockLlm } from "../../../llm/src/mock.ts";
import { createInitialState } from "../projection.ts";
import { DefaultArbiter } from "../arbiter.ts";
import { EventSourcedStore } from "../store.ts";
import { emptyRegistry } from "../registry.ts";
import { EventSourcedMemory } from "../memory.ts";
import { AuditGate } from "../audit.gate.ts";
import { DEFAULT_AUDIT_POLICY, NoopAudit } from "../audit.ts";
import { loadConversationPolicy, loadModes } from "./delivery.ts";
import { SceneManager, type SceneAgentPort } from "./scene.ts";
import { NpcAgent } from "./npc-agent.ts";
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

async function setup(responses: string[], cap = 6) {
  const store = new EventSourcedStore({ worldId: "w1", locId: GATE });
  store.append(ROOM, [
    env(1, "entity.created", { entity: entity(GATE, "loc", "图书馆") }),
    env(2, "entity.created", { entity: entity(PLR, "plr", "我") }),
    env(3, "entity.created", { entity: entity(LIN, "npc", "林月") }),
    env(4, "entity.created", { entity: entity(MA, "npc", "马骁") }),
    env(5, "scene.changed", { locId: GATE, presentIds: [PLR, LIN, MA] }),
  ]);
  const registry = emptyRegistry();
  const memory = new EventSourcedMemory();
  const arbiter = new DefaultArbiter({ store, registry, memories: memory });
  const modes = await loadModes(MODES);
  const policy = { ...(await loadConversationPolicy(POLICY)), npcHardCap: cap };
  const llm = new MockLlm({ responses });
  const gate = new AuditGate({ arbiter, store, registry, audit: new NoopAudit(), policy: DEFAULT_AUDIT_POLICY });
  const host = new ConversationHostV2({
    store,
    arbiter,
    registry,
    memory,
    modes,
    policy,
    scene: new SceneManager(sceneAgent, () => 1000),
    npc: new NpcAgent({ llm, modes, policy }),
    audit: new ConversationAudit(new NoopAudit(), DEFAULT_AUDIT_POLICY, gate),
  });
  const session = await host.open({ roomId: ROOM, participants: [PLR, LIN, MA] });
  return { host, session, memory, store, llm };
}

async function collect(it: AsyncIterable<ConversationEvent>): Promise<ConversationEvent[]> {
  const out: ConversationEvent[] = [];
  for await (const ev of it) out.push(ev);
  return out;
}
const speak = (id: string, mode: string, patch: Partial<Utterance> = {}): string =>
  JSON.stringify({ kind: "speak", utterance: { id, mode, ...patch } });
const think = (thought: string, plan?: string): string => JSON.stringify({ kind: "think", mental: { thought, plan, salience: 4 } });

describe("v2 群聊会话（端到端，真实 Arbiter/Store/Memory）", () => {
  it("公开说话：所有人在场者收到内容；一个 NPC 说话、另一个只思考；记忆落库", async () => {
    const { host, session, memory, llm } = await setup([
      speak("utt_l", "broadcast", { content: "我觉得有人在说谎", action: "皱眉" }),
      think("马骁刚才沉默太久，可能在隐瞒", "下回合试探他"),
    ]);
    const events = await collect(
      host.run(session.id, {
        clientTurnId: "t1",
        utterance: { id: "utt_p", speaker: PLR, mode: "broadcast", content: "大家怎么看这件事", action: "看向两人" },
      }),
    );
    const deliveries = events.filter((e) => e.type === "conversation.utterance").map((e) => (e.type === "conversation.utterance" ? e.delivery : null));
    expect(deliveries.filter(Boolean).length).toBeGreaterThanOrEqual(4);
    expect(deliveries.some((d) => d?.to === PLR && d.content === "大家怎么看这件事")).toBe(true);
    expect(events.some((e) => e.type === "conversation.mental")).toBe(true);
    expect(llm.calls).toBe(2); // 两个 NPC 各一次独立调用
    const records = memory.all(ROOM);
    expect(records.some((r) => r.content && r.content.includes("有人在说谎"))).toBe(true);
    expect(records.some((r) => r.tags.includes("mental") && r.visibility === "secret" && r.content.includes("下回合试探他"))).toBe(true);
    expect(events.some((e) => e.type === "conversation.committed")).toBe(true);
  });

  it("NPC↔NPC 悄悄话：玩家与旁人只看得到神色动作，目标只收到内容", async () => {
    const { host, session, memory } = await setup([
      speak("utt_w", "whisper", { target: MA, content: "钥匙藏在花盆下", action: "附耳说了几句" }),
      think("我什么也没听清"),
    ]);
    const events = await collect(host.run(session.id, { clientTurnId: "t2" }));
    const deliveries = events.filter((e) => e.type === "conversation.utterance").map((e) => (e.type === "conversation.utterance" ? e.delivery : null));
    for (const d of deliveries) {
      if (d?.to === MA) {
        expect(d.content).toBe("钥匙藏在花盆下");
        expect(d.notice).toBeUndefined();
      } else if (d?.to === LIN) {
        // 说话人自己当然知道内容
        expect(d.content).toBe("钥匙藏在花盆下");
      } else {
        expect(d?.content).toBeUndefined();
        expect(d?.notice).toBeUndefined();
        expect(d?.action).toBeTruthy();
      }
    }
    expect(deliveries.some((d) => d?.to === MA && d.content === "钥匙藏在花盆下")).toBe(true);
    expect(memory.all(ROOM).some((r) => r.visibility === "private" && r.content.includes("钥匙藏在花盆下"))).toBe(true);
  });

  it("玩家不说话：NPC 自主续聊；达到硬上限后只思考不说话", async () => {
    const { host, session, llm } = await setup(
      [
        speak("utt_1", "broadcast", { content: "自主发言一" }),
        speak("utt_2", "broadcast", { content: "自主发言二" }),
        think("聊够了"),
        think("该停了"),
      ],
      1,
    );
    await collect(host.run(session.id, { clientTurnId: "t3" }));
    const r2 = await collect(host.run(session.id, { clientTurnId: "t4" }));
    expect(r2.some((e) => e.type === "conversation.mental")).toBe(true);
    expect(r2.some((e) => e.type === "conversation.utterance" && (e as never as { delivery: { speaker: string } }).delivery.speaker.startsWith("npc_"))).toBe(false);
    expect(llm.calls).toBe(4);
  });

  it("插话：phase 切 listening，NPC 本轮只听不说；玩家发言后恢复 speaking", async () => {
    const { host, session } = await setup([think("等他说完"), think("先听着")]);
    const a = await collect(host.run(session.id, { clientTurnId: "t5", interject: PLR }));
    expect(a.some((e) => e.type === "conversation.phase" && e.phase === "listening")).toBe(true);
    const b = await collect(
      host.run(session.id, { clientTurnId: "t6", utterance: { id: "utt_i", speaker: PLR, mode: "broadcast", content: "我先说" } }),
    );
    expect(b.some((e) => e.type === "conversation.phase" && e.phase === "speaking")).toBe(true);
    expect(b.some((e) => e.type === "conversation.utterance" && (e as never as { delivery: { speaker: string } }).delivery.speaker.startsWith("npc_"))).toBe(false);
  });

  it("@全体唤醒场景 agent，summary 在玩家发言之后发出", async () => {
    const { host, session } = await setup([think("场景变了"), think("嗯")]);
    const events = await collect(
      host.run(session.id, {
        clientTurnId: "t7",
        utterance: { id: "utt_all", speaker: PLR, mode: "broadcast", target: "all", content: "大家都过来" },
      }),
    );
    const scene = events.find((e) => e.type === "conversation.scene");
    expect(scene).toBeDefined();
    if (scene?.type === "conversation.scene") expect(scene.beat.order).toBe("after");
    expect(events.findIndex((e) => e.type === "conversation.scene")).toBeLessThan(
      events.findIndex((e) => e.type === "conversation.committed"),
    );
  });

  it("clientTurnId 重放不重复调模型、不重复落库", async () => {
    const { host, session, llm } = await setup([think("一"), think("二")]);
    const req = { clientTurnId: "t8", utterance: { id: "utt_e", speaker: PLR, mode: "broadcast" as const, content: "重复测试" } };
    const a = await collect(host.run(session.id, req));
    const b = await collect(host.run(session.id, req));
    expect(a).toEqual(b);
    expect(llm.calls).toBe(2);
  });
});
