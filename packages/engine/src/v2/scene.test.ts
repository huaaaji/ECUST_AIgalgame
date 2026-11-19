import { describe, expect, it } from "vitest";
import { SceneManager, shouldWake } from "./scene.ts";
import type { SceneAgentPort } from "./scene.ts";
import type { Utterance } from "../../../shared/src/index.ts";

const agent: SceneAgentPort = {
  describe: async ({ locName }) => `开场：${locName}很安静`,
  summarize: async ({ trigger, previous }) => `${previous ? previous + "；" : ""}醒来(${trigger})：几人各怀心思`,
};

describe("v2 场景 agent", () => {
  it("开场广播一次后下线：只有 opening beat，没有常驻记忆", async () => {
    const m = new SceneManager(agent, () => 1);
    const beat = await m.open("dlg_1", "room_1", "图书馆", ["plr_self", "npc_lin"]);
    expect(beat.kind).toBe("opening");
    expect(m.memory("dlg_1")).toBeUndefined();
    expect(m.render("dlg_1")).toBe("");
  });

  it("@全体 / @多人 唤醒；@单人（含悄悄话）不唤醒", () => {
    const mk = (target?: Utterance["target"]): Utterance => ({ id: "u1", speaker: "plr_self", mode: "addressed", target });
    expect(shouldWake({ utterance: mk("all"), locationChanged: false, wakeOnMultiTarget: true, wakeOnLocationChange: true })).toBe("multi");
    expect(shouldWake({ utterance: mk(["npc_lin", "npc_ma"]), locationChanged: false, wakeOnMultiTarget: true, wakeOnLocationChange: true })).toBe("multi");
    expect(shouldWake({ utterance: mk("npc_lin"), locationChanged: false, wakeOnMultiTarget: true, wakeOnLocationChange: true })).toBeNull();
    expect(shouldWake({ utterance: mk("npc_lin"), locationChanged: true, wakeOnMultiTarget: true, wakeOnLocationChange: true })).toBe("location");
    expect(shouldWake({ utterance: mk("all"), locationChanged: false, wakeOnMultiTarget: false, wakeOnLocationChange: true })).toBeNull();
  });

  it("唤醒产出 summary、写半常驻记忆，渲染稳定且含最新一条", async () => {
    const m = new SceneManager(agent, () => 1);
    await m.open("dlg_1", "room_1", "图书馆", []);
    const beat = await m.wake("dlg_1", "room_1", "multi", ["林月说了谎"]);
    expect(beat.order).toBe("after");
    expect(beat.kind).toBe("summary");
    const text = m.render("dlg_1");
    expect(text).toContain("【场景·群像】");
    expect(text).toContain("醒来(multi)");
    expect(m.render("dlg_1")).toBe(text);
    const beat2 = await m.wake("dlg_1", "room_1", "location", []);
    expect(beat2.order).toBe("before");
    expect(m.render("dlg_1")).toContain("醒来(location)");
    expect(m.render("dlg_1")).toContain("醒来(multi)");
    expect(m.list("dlg_1")).toHaveLength(3);
  });
});
