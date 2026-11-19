import { describe, expect, it } from "vitest";
import { deliver, loadConversationPolicy, loadModes, validateUtterance } from "./delivery.ts";
import type { Utterance } from "../../../shared/src/index.ts";

const ROOT = new URL("../../../../", import.meta.url).pathname;
const MODES = `${ROOT}content/v2/utterance-modes.json`;
const POLICY = `${ROOT}content/v2/conversation-policy.json`;

const present = ["plr_self", "npc_lin", "npc_ma"] as const;

function u(patch: Partial<Utterance> & { mode: string }): Utterance {
  return { id: "utt_1", speaker: "npc_lin", ...patch };
}

describe("v2 投递解释器", () => {
  it("四种模式的定义从数据文件载入，引擎不写死模式", async () => {
    const modes = await loadModes(MODES);
    expect([...modes.keys()]).toEqual(["broadcast", "addressed", "whisper", "signal", "dm"]);
    expect(modes.get("whisper")?.targetChannels).toEqual(["content"]);
    expect(modes.get("whisper")?.otherChannels).toEqual(["action"]);
    expect((await loadConversationPolicy(POLICY)).npcHardCap).toBe(6);
  });

  it("不 @：所有人收到内容 + 动作", async () => {
    const modes = await loadModes(MODES);
    const out = deliver(u({ mode: "broadcast", content: "今天图书馆人多", action: "环顾四周" }), { recipients: present, modes });
    expect(out).toHaveLength(3);
    for (const d of out) expect(d.channels).toEqual(["content", "action"]);
  });

  it("悄悄话：目标只收到内容，其他所有人（含玩家）只收到低信息动作", async () => {
    const modes = await loadModes(MODES);
    const v = validateUtterance(
      u({ mode: "whisper", target: "npc_ma", content: "我藏了钥匙", action: "附耳说了几句" }),
      modes,
      { ...(await loadConversationPolicy(POLICY)) },
      present,
    );
    expect(v.ok).toBe(true);
    const out = deliver(v.value!, { recipients: present, modes });
    const toMa = out.find((d) => d.to === "npc_ma")!;
    const toPlayer = out.find((d) => d.to === "plr_self")!;
    expect(toMa.channels).toEqual(["content"]);
    expect(toMa.content).toBe("我藏了钥匙");
    expect(toMa.action).toBeUndefined();
    expect(toPlayer.channels).toEqual(["action"]);
    expect(toPlayer.action).toMatch(/凑近压低声音|侧身挡住话|附耳说了几句|把声音压得很低/);
    expect(toPlayer.content).toBeUndefined();
    expect(toPlayer.notice).toBeUndefined();
  });

  it("不动声色：目标只收到有意义的动作，旁人只收到无意义动作，内容被剥掉", async () => {
    const modes = await loadModes(MODES);
    const policy = await loadConversationPolicy(POLICY);
    const v = validateUtterance(
      u({ mode: "signal", target: "npc_ma", content: "快跑", action: "三短一长的敲击" }),
      modes,
      policy,
      present,
    );
    expect(v.value?.content).toBeUndefined();
    const out = deliver(v.value!, { recipients: present, modes });
    expect(out.find((d) => d.to === "npc_ma")?.action).toBe("三短一长的敲击");
    const other = out.find((d) => d.to === "plr_self")!;
    expect(other.action).not.toBe("三短一长的敲击");
    expect(other.action).toBeTruthy();
  });

  it("悄悄话/不动声色缺动作被拒；目标不在场被拒；coverAction 同 id 稳定", async () => {
    const modes = await loadModes(MODES);
    const policy = await loadConversationPolicy(POLICY);
    expect(validateUtterance(u({ mode: "whisper", target: "npc_ma", content: "hi" }), modes, policy, present).code).toBe("E_SCHEMA_INVALID");
    expect(validateUtterance(u({ mode: "whisper", target: "npc_ghost", content: "hi", action: "x" }), modes, policy, present).code).toBe("E_REF_NOT_FOUND");
    const a = validateUtterance(u({ id: "utt_same", mode: "whisper", target: "npc_ma", action: "耳语" }), modes, policy, present).value!;
    const b = validateUtterance(u({ id: "utt_same", mode: "whisper", target: "npc_ma", action: "耳语" }), modes, policy, present).value!;
    expect(a.coverAction).toBe(b.coverAction);
  });

  it("audience 叠加：不在 recipients 的人完全收不到（服务端先过滤）", async () => {
    const modes = await loadModes(MODES);
    const out = deliver(u({ mode: "broadcast", content: "公开消息" }), { recipients: ["npc_ma"], modes });
    expect(out.map((d) => d.to)).toEqual(["npc_ma"]);
  });

  it("P2-1：悄悄话/眼神带 target=all 必须为非法，不能把 content 投递全场", async () => {
    const modes = await loadModes(MODES);
    const policy = await loadConversationPolicy(POLICY);
    for (const mode of ["whisper", "signal"]) {
      const v = validateUtterance(u({ mode, target: "all", content: "全场机密", action: "耳语" }), modes, policy, present);
      expect(v.ok).toBe(false);
      expect(v.code).toBe("E_SCHEMA_INVALID");
      expect(deliver(v.value ?? u({ mode, target: "all", content: "全场机密", action: "耳语" }), { recipients: present, modes }).some((d) => d.content === "全场机密")).toBe(false);
    }
  });

  it("P2-2：JSON 只写部分 messages 键时其余默认文案仍存在", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "v2-policy-"));
    const file = join(dir, "policy.json");
    writeFileSync(file, JSON.stringify({ schemaVersion: 1, messages: { unknownMode: "自定义未知模式" } }));
    const policy = await loadConversationPolicy(file);
    expect(policy.messages.unknownMode).toBe("自定义未知模式");
    expect(policy.messages.invalidUtterance).toBeTruthy();
    expect(policy.messages.targetRequired).toBeTruthy();
    expect(policy.llm.maxTokens).toBe(600);
  });

  it("四审 P3：单目标模式拒绝数组目标；requiresTarget 模式拒绝 @all（@all 走 broadcast）", async () => {
    const modes = await loadModes(MODES);
    const policy = await loadConversationPolicy(POLICY);
    expect(validateUtterance(u({ mode: "whisper", target: ["npc_lin"], content: "hi", action: "耳语" }), modes, policy, present).ok).toBe(false);
    expect(validateUtterance(u({ mode: "addressed", target: "all", content: "hi" }), modes, policy, present).ok).toBe(false);
    expect(validateUtterance(u({ mode: "addressed", target: "npc_lin", content: "hi" }), modes, policy, present).ok).toBe(true);
    expect(validateUtterance(u({ mode: "broadcast", target: "all", content: "hi" }), modes, policy, present).ok).toBe(true);
  });

  it("五审：requiresTarget 模式拒绝空数组目标", async () => {
    const modes = await loadModes(MODES);
    const policy = await loadConversationPolicy(POLICY);
    expect(validateUtterance(u({ mode: "addressed", target: [] as unknown as string, content: "hi" }), modes, policy, present).ok).toBe(false);
  });

  it("六审：requiresTarget 模式统一只接受字符串单目标（数组一律拒绝）", async () => {
    const modes = await loadModes(MODES);
    const policy = await loadConversationPolicy(POLICY);
    for (const mode of ["addressed", "whisper", "signal"]) {
      const patch = mode === "whisper" || mode === "signal" ? { action: "耳语" } : {};
      expect(validateUtterance(u({ mode, target: ["npc_lin"] as unknown as string, content: "hi", ...patch }), modes, policy, present).ok).toBe(false);
      expect(validateUtterance(u({ mode, target: ["npc_lin", "npc_ma"] as unknown as string, content: "hi", ...patch }), modes, policy, present).ok).toBe(false);
    }
  });
});
