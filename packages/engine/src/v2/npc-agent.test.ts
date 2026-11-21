import { describe, expect, it } from "vitest";
import { MockLlm } from "../../../llm/src/mock.ts";
import { deliver, loadConversationPolicy, loadModes } from "./delivery.ts";
import { NpcAgent, buildNpcPrompt, formatDeliveryFor, nameFor, type PresentActor } from "./npc-agent.ts";
import type { Delivery } from "../../../shared/src/index.ts";
import { createInitialState } from "../projection.ts";

const ROOT = new URL("../../../../", import.meta.url).pathname;
const modes = await loadModes(`${ROOT}content/v2/utterance-modes.json`);
const policy = await loadConversationPolicy(`${ROOT}content/v2/conversation-policy.json`);

function state() {
  const s = createInitialState("room_1", { locId: "loc_library" });
  s.room.scene.presentIds = ["plr_self", "npc_lin", "npc_ma"];
  return s;
}

const base = {
  npcId: "npc_lin",
  npcName: "林月",
  state: state(),
  deliveries: [],
  sceneText: "",
  memoryText: "",
  streak: 0,
  playerPresent: true,
  hardCapReached: false,
  listening: false,
} as const;

describe("v2 NPC agent（每个 NPC 独立一次 LLM）", () => {
  it("一次调用出一个 speak 决定，输出被校验并规整", async () => {
    const llm = new MockLlm({
      responses: [
        JSON.stringify({
          kind: "speak",
          utterance: { id: "utt_a", mode: "broadcast", content: "我觉得这事不对劲", action: "皱眉" },
        }),
      ],
    });
    const r = await new NpcAgent({ llm, modes, policy }).decide({ ...base });
    expect(llm.calls).toBe(1);
    expect(r.decision.kind).toBe("speak");
    if (r.decision.kind === "speak") expect(r.decision.utterance.speaker).toBe("npc_lin");
  });

  it("非法说话（悄悄话没动作）降级为 silent，不产生世界变更", async () => {
    const llm = new MockLlm({
      responses: [JSON.stringify({ kind: "speak", utterance: { mode: "whisper", target: "npc_ma", content: "psst" } })],
    });
    const r = await new NpcAgent({ llm, modes, policy }).decide({ ...base });
    expect(r.decision.kind).toBe("silent");
  });

  it("think 输出保留 plan（行动计划）与 salience", async () => {
    const llm = new MockLlm({
      responses: [JSON.stringify({ kind: "think", mental: { thought: "她刚才回避了我的目光，大概在隐瞒什么", plan: "下回合试探她", salience: 4 } })],
    });
    const r = await new NpcAgent({ llm, modes, policy }).decide({ ...base });
    expect(r.decision.kind).toBe("think");
    if (r.decision.kind === "think") {
      expect(r.decision.mental.plan).toBe("下回合试探她");
      expect(r.decision.mental.salience).toBe(4);
    }
  });

  it("玩家插话 / 达上限：强制只 think 不 speak，即使模型想说话", async () => {
    const llm = new MockLlm({
      responses: [
        JSON.stringify({ kind: "speak", utterance: { mode: "broadcast", content: "我插一句" } }),
        JSON.stringify({ kind: "speak", utterance: { mode: "broadcast", content: "我再说一句" } }),
      ],
    });
    const agent = new NpcAgent({ llm, modes, policy });
    const listening = await agent.decide({ ...base, listening: true });
    const capped = await agent.decide({ ...base, hardCapReached: true, streak: 9 });
    expect(listening.decision.kind === "think" || listening.decision.kind === "silent").toBe(true);
    expect(capped.decision.kind === "think" || capped.decision.kind === "silent").toBe(true);
  });

  it("非 JSON 输出降级 silent；提示词静态协议在动态段之前", async () => {
    const llm = new MockLlm({ responses: ["不是 JSON"] });
    const r = await new NpcAgent({ llm, modes, policy }).decide({ ...base });
    expect(r.decision.kind).toBe("silent");
    const prompt = buildNpcPrompt({ ...base, memoryText: "私人记忆" }, modes, policy);
    expect(prompt.indexOf("只输出 JSON")).toBeLessThan(prompt.indexOf("【这一轮】"));
    expect(prompt).toContain("私人记忆");
    expect(prompt).toContain("玩家在场");
  });
});

describe("投递行目标语义（#145）", () => {
  const present: PresentActor[] = [
    { id: "plr_1", name: "你", kind: "plr" },
    { id: "npc_lin", name: "林静", kind: "npc" },
    { id: "npc_bai", name: "白晓通", kind: "npc" },
  ];
  const delivery = (over: Partial<Delivery> = {}): Delivery => ({
    to: "npc_bai", speaker: "npc_lin", utteranceId: "u1", mode: "addressed",
    channels: ["content"], content: "只对玩家说", target: "plr_1", ...over,
  });

  it("旁听者看到目标玩家时显示「玩家」，不是「你」", () => {
    const line = formatDeliveryFor("npc_bai", present, delivery());
    expect(line).toBe("林静 → 玩家（你是旁听，content）：只对玩家说");
    expect(line).not.toContain("→ 你");
  });

  it("目标是自己时仍显示「你」", () => {
    const line = formatDeliveryFor("npc_bai", present, delivery({ to: "npc_bai", target: "npc_bai" }));
    expect(line).toBe("林静 → 你（content）：只对玩家说");
  });

  it("自己的话不再标成「你是旁听」，目标玩家显示「玩家」", () => {
    const line = formatDeliveryFor("npc_lin", present, delivery({ speaker: "npc_lin", to: "npc_lin" }));
    expect(line).toBe("你说 → 玩家（content）：只对玩家说");
    expect(line).not.toContain("你是旁听");
  });

  it("自己的公开话显示「你公开说」", () => {
    const line = formatDeliveryFor("npc_lin", present, delivery({ speaker: "npc_lin", to: "npc_lin", target: undefined }));
    expect(line).toBe("你公开说（content）：只对玩家说");
  });

  it("目标玩家的 notice 用「玩家」替换模板", () => {
    const [d] = deliver(
      { id: "u1", speaker: "npc_lin", mode: "addressed", target: "plr_1", content: "只对玩家说" },
      { recipients: ["npc_bai"], modes, nameOf: (id) => nameFor(present, id) },
    );
    expect(d?.notice).toBe("这句话是对 玩家 说的");
  });
});
