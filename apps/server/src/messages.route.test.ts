/**
 * dev/v2 微信端点鉴权回归（十审 P1）：
 * - 收件箱/SSE 的 actorId 必须是当前账号在本房间的玩家角色，不能填 NPC 偷看；
 * - /events 里 msg.sent 必须按 Envelope.audience 过滤，非收发双方读不到正文。
 */
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { afterAll, describe, expect, it } from "vitest";
import { tempDir } from "@galgame/testkit";
import { createApp } from "./bootstrap.ts";
import { registerRoutes } from "./routes.ts";
import type { ServerConfig } from "./config.ts";

function testConfig(): ServerConfig {
  return {
    port: 0, host: "127.0.0.1", dataDir: tempDir("galgame-messages-"), contentDir: "content",
    adminToken: "dev-admin", trustUserHeader: true,
    llm: { baseUrl: "", model: "mock", apiKey: "", timeoutMs: 1000 },
    audit: { baseUrl: "", model: "", apiKey: "", timeoutMs: 1000 },
  };
}

const prevScan = process.env.GALGAME_GOSSIP_SCAN_MS;
afterAll(() => {
  if (prevScan === undefined) delete process.env.GALGAME_GOSSIP_SCAN_MS;
  else process.env.GALGAME_GOSSIP_SCAN_MS = prevScan;
});

describe("v2 微信端点鉴权", () => {
  it("非玩家 actorId 不能读收件箱，/events 只给 audience 内的消息", async () => {
    const cfg = testConfig();
    // 关掉后台扫描，避免测试期间 NPC 自主波次干扰断言
    process.env.GALGAME_GOSSIP_SCAN_MS = "0";
    const deps = await createApp(cfg);
    const { roomId, actorId } = await deps.createRoom("solo", "u_owner");
    const app: FastifyInstance = Fastify();
    registerRoutes(app, deps);
    const headers = { "x-user-id": "u_owner" };
    const state = await deps.store.snapshot(roomId);
    const npc = Object.values(state.entities).find((e) => e.kind === "npc");
    expect(npc).toBeTruthy();
    const npcId = npc!.id;

    const npcBox = await app.inject({ method: "GET", headers, url: `/api/v1/rooms/${roomId}/messages?actorId=plr_other` });
    expect(npcBox.json()).toMatchObject({ ok: false });

    const sent = await app.inject({
      method: "POST", headers, url: `/api/v1/rooms/${roomId}/messages`,
      payload: { from: actorId, to: npcId, content: "只给王五的私信" },
    });
    expect(sent.json()).toMatchObject({ ok: true });

    const mine = await app.inject({ method: "GET", headers, url: `/api/v1/rooms/${roomId}/events?actorId=${actorId}` });
    expect(mine.json().events.some((e: { type: string }) => e.type === "msg.sent")).toBe(true);

    const other = await app.inject({ method: "GET", headers, url: `/api/v1/rooms/${roomId}/events?actorId=plr_other` });
    expect(other.statusCode).toBe(403);

    const noViewer = await app.inject({ method: "GET", headers, url: `/api/v1/rooms/${roomId}/events` });
    expect(noViewer.json().events.some((e: { type: string }) => e.type === "msg.sent")).toBe(false);
    await app.close();
  });
});
