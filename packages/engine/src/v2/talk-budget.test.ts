import { describe, expect, it } from "vitest";
import { TalkBudget } from "./talk-budget.ts";
import { DEFAULT_CONVERSATION_POLICY } from "../../../shared/src/index.ts";

const policy = {
  autonomy: { ...DEFAULT_CONVERSATION_POLICY.autonomy, minReplyIntervalMs: 30_000, maxMessagesPerNpcPerHour: 2, maxNpcCallsPerTick: 3 },
};

describe("TalkBudget：LLM 调用前节流", () => {
  it("最短回信间隔未到 → canSpeak=min-interval", () => {
    let now = 1000;
    const b = new TalkBudget(policy, () => now);
    expect(b.canSpeak("r", "npc_a", now)).toBe("ok");
    b.recordSent("r", "npc_a");
    expect(b.canSpeak("r", "npc_a", now + 1000)).toBe("min-interval");
    expect(b.canSpeak("r", "npc_b", now + 1000)).toBe("ok");
    expect(b.nextEligible("r", "npc_a", now)).toBe(31_000);
    expect(b.canSpeak("r", "npc_a", now + 30_000)).toBe("ok");
  });

  it("每小时上限与每波调用上限分别生效", () => {
    let now = 1000;
    const b = new TalkBudget(policy, () => now);
    b.recordSent("r", "npc_a");
    b.recordCall("r"); b.recordCall("r"); b.recordCall("r");
    expect(b.canSpeak("r", "npc_b", now)).toBe("call-cap");
    now += 3_600_001;
    b.recordSent("r1", "npc_a");
    now += 30_001;
    b.recordSent("r1", "npc_a");
    now += 30_001;
    expect(b.canSpeak("r1", "npc_a", now)).toBe("hour-cap");
    b.clearRoom("r1");
    expect(b.canSpeak("r1", "npc_a", now)).toBe("ok");
  });
});
