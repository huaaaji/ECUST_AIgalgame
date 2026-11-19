import { describe, expect, it } from "vitest";
import { MockLlm } from "../../../llm/src/mock.ts";
import { loadConversationPolicy, loadModes } from "./delivery.ts";
import { NpcAgent, buildNpcPrompt } from "./npc-agent.ts";
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
    expect(prompt.indexOf("只输出 JSON")).toBeLessThan(prompt.indexOf("【本轮收到】"));
    expect(prompt).toContain("私人记忆");
    expect(prompt).toContain("玩家在场");
  });
});
