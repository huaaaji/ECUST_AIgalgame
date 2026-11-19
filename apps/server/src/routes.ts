/**
 * HTTP/SSE 层：只做两件事——把请求变成 service/turn 调用、把结果原样返回。
 * 不含业务规则；游戏层拒绝一律 HTTP 200 + {ok:false,code,message}，500 只表示未预期异常。
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ActorId, Memory, MemoryRecord, Registry, RoomId, Store, Turn, TurnEvent, WorldState } from "../../../packages/shared/src/contract/types.ts";
import type { GossipEvent, MessageDigest } from "../../../packages/shared/src/contract/v2.ts";
import { DialogueBodySchema, TickBodySchema, TravelBodySchema, zodMessage } from "./map.data.ts";
import type { MapService } from "./map.ts";
import type { LlmSettings } from "./settings.ts";
import { maskNamesDeep, unknownPlaceholders } from "./view-names.ts";
import { isAskNameInput, namesIntroducedIn } from "./name-unlock.ts";
import type { SaveIndex } from "./saves.ts";
import type { TurnHistory } from "./turn-history.ts";
import { registerResumeRoutes } from "./resume.routes.ts";
import { registerAuthRoutes, type AuthService } from "./auth.ts";
import { registerAdminRoutes } from "./admin.routes.ts";
import { dailyLimitFor } from "./auth-store.ts";
import type { TurnLedger } from "./quota.ts";
import type { AdminLog } from "./admin-log.ts";
import { makeRoomExists } from "./room-exists.ts";
import { isSafeRoomId } from "../../../packages/engine/src/store.ts";
import { EMPTY_SCENARIOS } from "./scenarios.ts";
import type { ScenarioCatalog } from "./scenarios.ts";
import { registerViewRoutes } from "./view.routes.ts";
import { adminTokenOf, guardRoom } from "./room-guard.ts";
import { AdminTokenGate, type TokenVerdict } from "./admin-token.ts";
import { isStoreFault } from "./store-fault.ts";

export interface AppDeps {
  store: Store;
  turn: Turn;
  map: MapService;
  /** 运行时模型接入（玩家自备 key）：/api/v1/settings/llm */
  settings: LlmSettings;
  /** 注册表（属性声明）；/api/v1/registry 给前端按数据渲染面板用（I2） */
  registry: Registry;
  /** npcId → 外貌描述（content/scenarios/npcs.json 的 appearance）：未认识时的占位名 */
  appearance?: Map<string, string>;
  /** 解锁"玩家知道了这些 NPC 的名字"（回合文本里对方自报姓名后调用，见 name-unlock.ts） */
  learnNpcNames?(roomId: string, npcIds: string[]): Promise<void>;
  /** 读取账号维度的私忆档案（GET /api/v1/me）；记忆是日志投影，这里只读 */
  memory: Memory & { all(roomId: string): MemoryRecord[]; get?(memoryId: string): MemoryRecord | undefined };
  createRoom(mode: "solo" | "coop", userId?: string): Promise<{ roomId: string; actorId: string }>;
  /** 开发期账号：没有登录态时用 GALGAME_DEV_USER 兜底（上线接登录中间件后删掉） */
  devUser?: string;
  /** 审核器种类：llm = 真模型审核；deny_all = 未配置（fail-closed，永不发布世界层） */
  canonizeJudge?: "llm" | "deny_all";
  /** 是否信任 X-User-Id 头；默认 true（本机开发）。生产置 GALGAME_TRUST_USER_HEADER=0 */
  trustUserHeader?: boolean;
  /** 世界层永久记忆（P3）：只在管理员端点里被调用 */
  canonize?: {
    retireRoom(roomId: string): Promise<{ written: string[]; candidates: number }>;
    tombstone(memoryId: string, reason: string): Promise<boolean>;
    stats(): { worldId: string; version: number; writtenToday: number; writtenTotal: number; circuitOpen: boolean; consecutiveJudgeFailures: number };
    sample(limit: number): MemoryRecord[];
  };
  /** 管理员令牌；canonize 端点用它鉴权（地图端点由 MapService 自己校验） */
  adminToken?: string;
  /** 令牌校验 + 失败限流（registerRoutes 未提供时按 adminToken 新建；测试可注入独立实例） */
  adminGate?: AdminTokenGate;
  /** 请求级令牌判定缓存（registerRoutes 注入）：登录门/CSRF/room-guard/admin 共用，同一请求只计一次失败 */
  adminVerdict?: (req: FastifyRequest) => TokenVerdict;
  /** 世界印象（用户投影）：/me 只读，投递在 Turn 里 */
  impressions?: { pending(userId: string, roomId: string, limit: number): Promise<unknown[]>; count?(userId: string): Promise<number> };
  /** 回合历史（issue #7）：只记已提交回合，用于续玩重放 */
  history?: TurnHistory;
  /** 存档索引（issue #7）：账号 → 房间游标 */
  saves?: SaveIndex;
  /** 开局剧本 / NPC 公开档案（content/scenarios/*.json）；标题页与图鉴用，缺省 = 无预设 */
  scenarios?: ScenarioCatalog;
  /** 简易用户系统；缺省 = 不做会话鉴权（本地测试/旧调用） */
  auth?: AuthService;
  /** 行动额度账本（收敛稿 B1）；缺省 = 不做额度结算（本地测试） */
  ledger?: TurnLedger;
  /** dev/v2：微信私信宿主（未接线时不注册端点） */
  gossip?: {
    send(roomId: RoomId, from: ActorId, to: ActorId, content: string, opts?: { kind?: "player" | "system"; viewer?: ActorId }): Promise<GossipEvent[]>;
    inbox(roomId: RoomId, to: ActorId): MessageDigest[];
    subscribe(roomId: RoomId, viewer: ActorId, cb: (ev: GossipEvent) => void): () => void;
  };
  /** 管理操作日志 */
  adminLog?: AdminLog;
  /** Cookie 写请求 CSRF 允许的 Origin（authRequired=1 时用） */
  publicOrigin?: string;
  version: string;
}

interface GameError {
  ok: false;
  code: string;
  message: string;
}

function sseWrite(raw: NodeJS.WritableStream, event: string, data: unknown): void {
  raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function schemaError(message: string): GameError {
  return { ok: false, code: "E_SCHEMA_INVALID", message };
}

/** 管理员鉴权失败超限：429 + Retry-After（不再暴露"这次令牌对不对"） */
function tooManyAdminAttempts(reply: FastifyReply, retryAfterMs?: number): FastifyReply {
  if (retryAfterMs && retryAfterMs > 0) reply.header("retry-after", String(Math.ceil(retryAfterMs / 1000)));
  return reply.code(429).send({ ok: false, code: "E_RATE_LIMITED", message: "管理员鉴权失败次数过多，请稍后再试" });
}

/**
 * 账号维度：优先 `X-User-Id` 头（联机/生产由登录态中间件注入），其次请求体，最后开发期默认值。
 * 只在服务端用；绝不把 userId 当权限凭据（它是"哪份记忆档案"的键，不是 token）。
 */
export function userIdOf(req: FastifyRequest, deps: AppDeps, body?: { userId?: string }): string | undefined {
  // 会话优先：登录后 userId 由服务端 Cookie 决定，客户端 header/body 不再参与。
  if (deps.auth) {
    const fromSession = deps.auth.resolveUserId(req);
    if (fromSession) return fromSession;
    if (deps.auth.required) return undefined;
  }
  const raw = req.headers["x-user-id"];
  const header = deps.trustUserHeader === false ? undefined : Array.isArray(raw) ? raw[0] : raw;
  const fromBody = body?.userId;
  const id = (header ?? fromBody ?? deps.devUser ?? "").trim();
  return id === "" ? undefined : id.slice(0, 64);
}

const WORLD_ROOM_PREFIX = "room_world_";

/**
 * 世界层房间（room_world_<worldId>）是永久记忆的存储房间，**没有成员、不能进**。
 * 不拦住的话，客户端可以 GET 它的完整事件流，把"这个世界知道的事"连同 sourceRefs/隐私扫描细节全读走（审阅 P1）。
 */
export function isWorldRoom(roomId: string): boolean {
  return roomId.startsWith(WORLD_ROOM_PREFIX);
}

/**
 * 模型设置端点只允许本机调用（审阅 M3）：这些端点会改服务端出站目标（SSRF 面）且涉及明文 key，
 * 局域网/公网直连一律拒绝。本机浏览器与 Vite 代理都从 127.0.0.1/::1 进来，不受影响。
 */
function requireLocal(req: FastifyRequest): GameError | null {
  const ip = req.ip ?? "";
  if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") return null;
  return { ok: false, code: "E_FORBIDDEN", message: "模型设置仅允许本机操作" };
}

/** 未预期异常兜底成 500；业务拒绝不经过这里（它们在 service 里返回 ok:false） */
async function safe(reply: FastifyReply, fn: () => Promise<unknown>): Promise<unknown> {
  try {
    return await fn();
  } catch (e) {
    // 内部异常（含绝对路径的 zod 错误等）只进服务端日志，不回给客户端
    console.error("[server] unhandled route error", e);
    if (isStoreFault(e)) {
      return reply.code(503).send({ ok: false, code: "E_STORE_FAULT", message: "存储读写失败，请稍后重试" });
    }
    return reply.code(500).send({ ok: false, code: "E_MODULE_FAULT", message: "服务器内部错误" });
  }
}

export function registerRoutes(app: FastifyInstance, deps: AppDeps): void {
  // 未预期异常兜底：存储故障统一 503 E_STORE_FAULT 并脱敏（不把 fs 路径回显给客户端），
  // 其余 500 E_MODULE_FAULT；业务拒绝不经过这里。
  app.setErrorHandler((error, _req, reply) => {
    // Fastify 自己的可预期 4xx（非法 JSON 400 / body 过大 413 / 不支持的 Content-Type 415）
    // 必须保留状态码，不能被折叠成 500；只做脱敏，不回显底层解析细节。
    const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
    const status = typeof statusCode === "number" ? statusCode : 500;
    if (status >= 400 && status < 500) {
      const code = status === 401 ? "E_UNAUTHORIZED" : status === 403 ? "E_FORBIDDEN" : "E_SCHEMA_INVALID";
      const message = status === 413 ? "请求体过大" : status === 415 ? "不支持的 Content-Type" : "请求格式不正确";
      return reply.code(status).send({ ok: false, code, message });
    }
    console.error("[server] unhandled route error", error);
    if (isStoreFault(error)) {
      return reply.code(503).send({ ok: false, code: "E_STORE_FAULT", message: "存储读写失败，请稍后重试" });
    }
    return reply.code(500).send({ ok: false, code: "E_MODULE_FAULT", message: "服务器内部错误" });
  });
  // 所有 admin-token 入口共用同一份失败计数：routes 守卫、room-guard、admin 端点都从这里取
  const adminGate = deps.adminGate ?? new AdminTokenGate(deps.adminToken ?? "");
  deps.adminGate = adminGate;
  // 同一请求的多个 hook/守卫会重复问令牌：缓存结果，避免一次坏令牌被计成多次失败
  const verdictCache = new WeakMap<FastifyRequest, ReturnType<AdminTokenGate["check"]>>();
  const adminVerdict = (req: FastifyRequest) => {
    // 没带令牌 = 走会话/管理员角色判定，不计失败（否则普通玩家的设置请求也会挤爆限流）
    const token = adminTokenOf(req.headers);
    if (!token) return { ok: false };
    const cached = verdictCache.get(req);
    if (cached) return cached;
    const verdict = adminGate.check(token, req.ip);
    verdictCache.set(req, verdict);
    return verdict;
  };
  // room-guard 与登录门/CSRF 共用同一份请求级判定：否则房间写入口会把同一次坏令牌再计一次
  deps.adminVerdict = adminVerdict;

  // 所有带 :roomId 的路径先过白名单：roomId 只允许作为 id，不能变成文件路径。
  // Fastify 会先解码 `%2F`，所以 `..%2F..%2Fpwn` 到这里已经是 `../../pwn`；必须在这里挡。
  app.addHook("preHandler", async (req, reply) => {
    const params = req.params as { roomId?: string } | undefined;
    const roomId = params?.roomId;
    if (roomId !== undefined && !isSafeRoomId(roomId)) {
      return reply.code(400).send({ ok: false, code: "E_SCHEMA_INVALID", message: "非法 roomId" });
    }
  });

  // 强制登录（部署时 GALGAME_AUTH_REQUIRED=1）：除公开端点外一律 401。
  // 公开端点只有 health / registry / scenarios / auth/*；房间、回合、存档、历史、图鉴、地图都要会话。
  // 例外：带有效 x-admin-token 的运维调用可访问 admin/settings（脚本无会话）。
  // 顺序很重要：hook 必须注册在 auth/admin 路由之前（Fastify 只对之后注册的路由生效）。
  const PUBLIC_PATHS = new Set(["/api/v1/health", "/api/v1/registry", "/api/v1/scenarios"]);
  const hasAdminToken = (req: FastifyRequest): boolean => adminVerdict(req).ok;
  app.addHook("preHandler", async (req, reply) => {
    if (!deps.auth?.required) return;
    const path = (req.url ?? "").split("?")[0] ?? "";
    if (!path.startsWith("/api/")) return;
    if (path.startsWith("/api/v1/auth/") || PUBLIC_PATHS.has(path)) return;
    if ((path.startsWith("/api/v1/admin/") || path.startsWith("/api/v1/settings/") || path.startsWith("/api/v1/map/drafts") || path.startsWith("/api/v1/rooms/"))) {
      const verdict = adminVerdict(req);
      if (verdict.blocked) return tooManyAdminAttempts(reply, verdict.retryAfterMs);
      if (verdict.ok) return;
    }
    if (!deps.auth.resolve(req)) {
      return reply.code(401).send({ ok: false, code: "E_UNAUTHORIZED", message: "请先登录" });
    }
  });

  // CSRF（收敛稿 B1，docs/03 §5.2.8）：authRequired=1 时，Cookie 写请求必须带合法 Origin。
  // /auth/* 的写路由（含 login/register/reset）同样校验：否则攻击者可跨站把受害者登进攻击者账号。
  // x-admin-token 运维调用豁免；不信任 Host/转发头。
  app.addHook("preHandler", async (req, reply) => {
    if (!deps.auth?.required) return;
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return;
    const path = (req.url ?? "").split("?")[0] ?? "";
    if (!path.startsWith("/api/")) return;
    if (hasAdminToken(req)) return;
    const isAuthWrite = path.startsWith("/api/v1/auth/");
    // 非 auth 写：无会话的请求（登录前的首次写）豁免；auth 写一律校验（login CSRF 面）
    if (!isAuthWrite && !deps.auth.resolve(req)) return;
    const origin = req.headers.origin;
    if (!deps.publicOrigin || origin !== deps.publicOrigin) {
      return reply.code(403).send({ ok: false, code: "E_FORBIDDEN", message: "跨站写请求被拒绝（Origin 校验）" });
    }
  });

  // 登录/注册/登出与管理端点放在 hook 之后注册，才能被上面的登录门与 CSRF 覆盖。
  if (deps.auth) registerAuthRoutes(app, deps.auth);
  if (deps.auth && deps.ledger && deps.adminLog) {
    registerAdminRoutes(app, { auth: deps.auth, ledger: deps.ledger, log: deps.adminLog, adminToken: deps.adminToken ?? "", gate: adminGate, verdictOf: adminVerdict });
  }

  const roomExists = makeRoomExists(deps.store);

  /**
   * 房间入口统一守卫（issue #37）：世界层房间与不存在的房间一律 404，且必须先于
   * body 校验、SSE 开流与任何写操作。存在性走 `listRooms()`（持久化事实），
   * 不再依赖 `snapshot()` 抛错——后者对缺失房间返回空状态，会把未知房间当 200。
   * 存在性（roomGate）在前，归属授权（guardRoom，issue #33）在后。
   */
  const roomGate = async (roomId: string, reply: FastifyReply): Promise<boolean> => {
    if (isWorldRoom(roomId)) {
      reply.code(404).send({ ok: false, code: "E_ROOM_NOT_FOUND", message: "世界层房间不接受该操作" });
      return false;
    }
    if (!(await roomExists(roomId))) {
      reply.code(404).send({ ok: false, code: "E_ROOM_NOT_FOUND", message: "房间不存在" });
      return false;
    }
    return true;
  };

  /** 全局暂停：所有会写世界/历史的入口共用；地图 travel/tick/dialogue 不能绕过回合入口的开关 */
  const actionsPaused = (reply: FastifyReply): boolean => {
    if (deps.auth?.store.getSettings().actionsEnabled !== false) return false;
    reply.code(429).send({ ok: false, code: "E_RATE_LIMITED", message: "本轮体验已暂停新行动" });
    return true;
  };

  // 公开健康检查只回 ok + 契约版本（建议11）：canonize 的启用/judge 等运维细节
  // 移到鉴权后的 /admin/stats，避免向未登录者暴露内部 fail-closed 配置。
  app.get("/api/v1/health", async () => ({
    ok: true,
    contract: deps.version,
  }));

  // ---------------------------------------------------------------- 注册表（前端按数据渲染面板，I2）
  /** 只暴露声明（标签/可见性/范围），不含任何实体数值；键来自 content/registry/attrs.json */
  app.get("/api/v1/registry", async () => ({
    ok: true,
    attrs: deps.registry.attrs().map((d) => ({
      key: d.key,
      type: d.type,
      scope: d.scope,
      min: d.min,
      max: d.max,
      visibility: d.visibility,
      label: d.display.label,
      unit: d.display.unit,
      hidden: d.display.hidden ?? false,
    })),
  }));

  // ---------------------------------------------------------------- 模型接入（docs/03 §5.2.2，管理员）
  // P1-1：auth 存在时要求 admin-token/管理员会话——反代下 req.ip 恒为 loopback，本机 IP 口径失效。
  const settingsGuard = (req: FastifyRequest): GameError | null => {
    if (deps.auth) {
      const verdict = adminVerdict(req);
      if (verdict.ok) return null;
      if (verdict.blocked) return { ok: false, code: "E_RATE_LIMITED", message: "管理员鉴权失败次数过多，请稍后再试" };
      if (deps.auth.resolve(req)?.role === "admin") return null;
      return { ok: false, code: "E_FORBIDDEN", message: "模型设置仅允许管理员操作" };
    }
    return requireLocal(req);
  };
  app.get("/api/v1/settings/llm", async (req) => {
    const deny = settingsGuard(req);
    if (deny) return deny;
    return { ok: true, view: deps.settings.view() };
  });

  // 暂缓开放（PR #19 P2）：玩家投稿入口已从界面移除，服务端同步收口——草案创建/详情仅管理员。
  // 接用户系统时按 admin-token 或 admin 会话判定；本地无 auth 保留单机开发能力。
  const adminOnly = (req: FastifyRequest, message: string): GameError | null => {
    if (!deps.auth) return null;
    const verdict = adminVerdict(req);
    if (verdict.ok) return null;
    if (verdict.blocked) return { ok: false, code: "E_RATE_LIMITED", message: "管理员鉴权失败次数过多，请稍后再试" };
    if (deps.auth.resolve(req)?.role === "admin") return null;
    return { ok: false, code: "E_FORBIDDEN", message };
  };

  app.post("/api/v1/settings/llm", async (req) => {
    const deny = settingsGuard(req);
    if (deny) return deny;
    const r = await deps.settings.apply(req.body);
    return r.ok ? { ok: true, view: r.view } : { ok: false, code: r.code, message: r.message };
  });

  app.delete("/api/v1/settings/llm", async (req) => {
    const deny = settingsGuard(req);
    if (deny) return deny;
    await deps.settings.clear();
    return { ok: true, view: deps.settings.view() };
  });

  app.post("/api/v1/rooms", async (req, reply) => {
    const body = (req.body ?? {}) as { mode?: "solo" | "coop"; userId?: string; scenarioId?: string };
    const userId = userIdOf(req, deps, body);
    if (deps.auth?.required && !userId) {
      return reply.code(401).send({ ok: false, code: "E_UNAUTHORIZED", message: "请先登录" });
    }
    const room = await deps.createRoom(body.mode === "coop" ? "coop" : "solo", userId);
    // 建房即登记存档索引（issue #7）：lastCommittedSeq 从建房种子事件之后算起。
    // 登记失败不回滚房间——房间本体是权威的，索引只是"我玩过哪些"的投影。
    if (userId && deps.saves) {
      const ts = Date.now();
      const scenarioId = typeof body.scenarioId === "string" && body.scenarioId.trim() ? body.scenarioId.trim().slice(0, 64) : "default";
      // Store 契约没有 seq()（FileStore 的快捷方式是内部实现）：用事件尾序号登记游标
      const seeded = await deps.store.events(room.roomId, 0, 500).catch(() => []);
      try {
        await deps.saves.upsert(userId, {
          roomId: room.roomId,
          scenarioId,
          createdAt: ts,
          updatedAt: ts,
          lastTurnId: "",
          lastCommittedSeq: seeded.length ? seeded[seeded.length - 1]!.seq : 0,
          actorId: room.actorId,
          formatVersion: 1,
        });
      } catch (e) {
        console.warn("[saves] 建房登记失败（房间已创建）:", e);
      }
    }
    return { ...room, ...(userId ? { userId } : {}) };
  });

  /** 玩家档案（记忆的派生视图，不写状态）：私忆只按 userId+ownerId 过滤后返回 */
  app.get("/api/v1/me", async (req, reply) => {
    const q = req.query as { roomId?: string; actorId?: string };
    if (!q.roomId || !q.actorId) return reply.code(400).send({ code: "E_SCHEMA_INVALID", message: "roomId/actorId 必填" });
    // 先定账号口径（缺身份是 schema 错），再走房间存在性 + 成员授权；
    // 否则非成员能借 `/me` 读到旧档/世界层房间的派生记忆（复审 P2）。
    const userId = userIdOf(req, deps);
    if (!userId) {
      return deps.auth?.required
        ? reply.code(401).send({ ok: false, code: "E_UNAUTHORIZED", message: "请先登录" })
        : reply.code(400).send({ code: "E_SCHEMA_INVALID", message: "缺少 X-User-Id（或 GALGAME_DEV_USER）" });
    }
    if (!(await roomGate(q.roomId, reply))) return reply;
    const access = await guardRoom(req, reply, deps, q.roomId, userIdOf);
    if (!access) return reply;
    const profile = await deps.memory.profile(userId, q.actorId, q.roomId);
    let impressionCount = 0;
    let pendingImpressions: unknown[] = [];
    if (deps.impressions) {
      impressionCount = deps.impressions.count ? await deps.impressions.count(userId) : 0;
      pendingImpressions = await deps.impressions.pending(userId, q.roomId, 5);
    }
    return { ok: true, userId, profile, impressionCount, pendingImpressions };
  });

  // 续玩/存档（issue #7）：独立区块，见 resume.routes.ts
  registerResumeRoutes(app, deps, { userIdOf, isWorldRoom, roomExists });

  // ---------------------------------------------------------------- dev/v2 微信私信
  if (deps.gossip) {
    const gossip = deps.gossip;
    app.get("/api/v1/rooms/:roomId/messages", async (req, reply) => {
      const { roomId } = req.params as { roomId: string };
      if (!(await roomGate(roomId, reply))) return reply;
      const q = req.query as { actorId?: string };
      const viewer = q.actorId;
      if (!viewer) return reply.code(400).send({ ok: false, code: "E_SCHEMA_INVALID", message: "actorId 必填" });
      const access = await guardRoom(req, reply, deps, roomId, userIdOf, { actorId: viewer });
      if (!access) return reply;
      // 收件箱只按 actorId 查；玩家不是收发任一方的消息不会出现在响应里
      const messages = gossip.inbox(roomId, viewer);
      return { ok: true, messages };
    });

    app.post("/api/v1/rooms/:roomId/messages", async (req, reply) => {
      const { roomId } = req.params as { roomId: string };
      if (!(await roomGate(roomId, reply))) return reply;
      const body = (req.body ?? {}) as { from?: string; to?: string; content?: string; userId?: string };
      if (!body.from || !body.to || !body.content) {
        return reply.code(400).send({ ok: false, code: "E_SCHEMA_INVALID", message: "from/to/content 必填" });
      }
      const access = await guardRoom(req, reply, deps, roomId, userIdOf, { actorId: body.from, body: { userId: body.userId } });
      if (!access) return reply;
      const events = await gossip.send(roomId, body.from, body.to, body.content, { kind: "player", viewer: body.from });
      const error = events.find((e) => e.type === "gossip.error");
      if (error && error.type === "gossip.error") {
        return reply.code(200).send({ ok: false, code: error.code, message: error.message });
      }
      return { ok: true, events };
    });

    /** SSE：只推送该 actorId 收发的 gossip.message，其他人的私信不会到浏览器 */
    app.get("/api/v1/rooms/:roomId/messages/stream", async (req, reply) => {
      const { roomId } = req.params as { roomId: string };
      if (!(await roomGate(roomId, reply))) return reply;
      const q = req.query as { actorId?: string };
      const viewer = q.actorId;
      if (!viewer) return reply.code(400).send({ ok: false, code: "E_SCHEMA_INVALID", message: "actorId 必填" });
      const access = await guardRoom(req, reply, deps, roomId, userIdOf, { actorId: viewer });
      if (!access) return reply;
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      const send = (ev: GossipEvent): void => {
        reply.raw.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
      };
      send({ type: "gossip.committed", ids: [] });
      const off = gossip.subscribe(roomId, viewer, send);
      const ping = setInterval(() => reply.raw.write(": ping\n\n"), 15_000);
      ping.unref?.();
      req.raw.on("close", () => { clearInterval(ping); off(); });
    });
  }

  app.get("/api/v1/rooms/:roomId/state", async (req, reply) => {
    const { roomId } = req.params as { roomId: string };
    if (!(await roomGate(roomId, reply))) return reply;
    const access = await guardRoom(req, reply, deps, roomId, userIdOf);
    if (!access) return reply;
    // 原始快照里带着实体真名：未认识的人必须在这里也脱敏，否则"服务端不下发真名"
    // 只是口号——新建房间就能从 /state 看光所有 NPC（审阅 P0-1）。
    return maskNamesDeep(access.state, unknownPlaceholders(access.state, deps.appearance));
  });

  app.get("/api/v1/rooms/:roomId/events", async (req, reply) => {
    const { roomId } = req.params as { roomId: string };
    if (!(await roomGate(roomId, reply))) return reply;
    const q = req.query as { fromSeq?: string; limit?: string; actorId?: string };
    const viewer = q.actorId;
    const access = await guardRoom(req, reply, deps, roomId, userIdOf, viewer ? { actorId: viewer } : {});
    if (!access) return reply;
    const from = Number(q.fromSeq ?? 0);
    const limit = Math.min(Number(q.limit ?? 200), 200);
    const allEvents = await deps.store.events(roomId, from, limit);
    // dev/v2：msg.sent 带 audience，玩家非收发双方连历史事件都不能读（十审 P1）
    const events = allEvents.filter((e) => {
      if (e.type !== "msg.sent") return true;
      if (!viewer || !Array.isArray(e.audience)) return false;
      return e.audience.includes(viewer);
    });
    // 历史回放同样脱敏：旧回合的叙事里可能带着尚未认识的人的真名
    const placeholders = unknownPlaceholders(await deps.store.snapshot(roomId), deps.appearance);
    return { events: maskNamesDeep(events, placeholders), lastSeq: events.length ? events[events.length - 1]!.seq : from };
  });

  /** 一次行动 = 一条 SSE 流，事件名就是 TurnEvent.type */
  app.post("/api/v1/rooms/:roomId/turns", async (req, reply) => {
    const { roomId } = req.params as { roomId: string };
    if (!(await roomGate(roomId, reply))) return reply;
    const body = (req.body ?? {}) as {
      actorId?: string;
      input?: string;
      clientTurnId?: string;
      userId?: string;
      /** 这次行动在跟哪个 NPC 说话（前端点 NPC 时给）：用于提示词换真名 + 问名字后解锁谁 */
      targetNpcId?: string;
      options?: Record<string, unknown>;
    };
    if (!body.actorId || !body.input || !body.clientTurnId) {
      return reply.code(400).send({ code: "E_SCHEMA_INVALID", message: "actorId/input/clientTurnId 必填" });
    }
    // 授权在 SSE 头之前：拒绝必须是普通 HTTP 响应，不能先宣布 200 流再反悔
    const access = await guardRoom(req, reply, deps, roomId, userIdOf, { actorId: body.actorId, body });
    if (!access) return reply;
    const userId = access.userId;
    // 幂等作用域：账号 + 房间 + 逻辑请求 ID（P1-1）。未登录（本地无 auth）不结算额度。
    const turnScope = userId ? { userId, roomId, clientTurnId: body.clientTurnId } : undefined;

    // 额度结算（收敛稿 B1，docs/03 §5.2.10）：按逻辑请求预留，拒绝也在 SSE 头之前
    const ledger = userId ? deps.ledger : undefined;
    if (ledger && userId && turnScope) {
      const settings = deps.auth?.store.getSettings();
      const dailyLimit = settings ? dailyLimitFor(settings, userId) : null;
      const reserved = ledger.reserve({
        ...turnScope, actorId: body.actorId,
        dailyLimit, actionsEnabled: settings?.actionsEnabled ?? true,
      });
      if (!reserved.ok) {
        const status = reserved.code === "E_RATE_LIMITED" ? 429 : 409;
        return reply.code(status).send({ ok: false, code: reserved.code, message: reserved.message, ...(reserved.committedSeq !== undefined ? { committedSeq: reserved.committedSeq } : {}) });
      }
      // running 必须先确认落盘再开跑：写失败时磁盘只有 reserved，重启会误判「未开跑」并放行重试
      try {
        await ledger.transitionDurable(turnScope, "running");
      } catch {
        ledger.transition(turnScope, "failed");
        return reply.code(503).send({ ok: false, code: "E_STORE_FAULT", message: "额度账本写入失败，行动未开始，可重试" });
      }
    }

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    let committed = false;
    let errored = false;
    try {
// 玩家点的是某个 NPC：前端会把"对一位陌生的同学说：…"写进行动语义，
      // 服务端在这里把占位名换成真名（只影响喂给模型的 input，不影响下发给玩家的显示），
      // 否则模型看到"一位陌生的同学"根本不知道在跟谁说话，回答必然驴唇不对马嘴。
      const snapshotForInput = await deps.store.snapshot(roomId);
      const target = body.targetNpcId ? snapshotForInput.entities[body.targetNpcId] : undefined;
      // 只有"目标此刻就在玩家所在场景"才允许实名化：不在场的人不能借这次行动被解锁/点名（P1-4）
      const targetPresent = target !== undefined && snapshotForInput.room.scene.presentIds.includes(target.id);
      // 前端写进来的目标名可能是外貌占位名，统一换成真名再喂模型
      const promptInput =
        target && target.kind === "npc" && targetPresent
          ? body.input.replace(/(?:一位|另一位|第[三四五六七八九十]位)?陌生的同学/gu, target.name)
          : body.input;
      const it = deps.turn.run({
        roomId,
        actorId: body.actorId,
        input: promptInput,
        clientTurnId: body.clientTurnId,
        options: body.options as never,
        ...(userId ? { userId } : {}),
      });
      // 叙事/台词里模型会写出 NPC 真名（"严守一：嗯？…"）。不认识的人要遮成占位名，但
      // **必须按本回合结束后的状态判断**：玩家这一回合问「你叫什么」，NPC 回答"我叫林静"，
      // 此时已经认识——遮住反而会出现"陌生人自我介绍"这种荒谬结果。
      // 所以先收齐事件，再用最终 patch 的 state 算一次名单，然后统一写出。
      const events: TurnEvent[] = [];
      for await (const ev of it as AsyncIterable<TurnEvent>) {
        events.push(ev);
        if (ev.type === "turn.commit" || ev.type === "turn.error" || ev.type === "turn.rejected") break;
      }
      // 额度结算与事件流同源：只有真的提交了才记 committed，其余按失败/待核对处理
      committed = events.some((ev) => ev.type === "turn.commit");
      errored = events.some((ev) => ev.type === "turn.error" || ev.type === "turn.rejected");
      if (turnScope) {
        if (committed) {
          const commitEv = events.find((ev) => ev.type === "turn.commit") as Extract<TurnEvent, { type: "turn.commit" }>;
          ledger?.transition(turnScope, "committed", { turnId: commitEv.turnId, committedSeq: commitEv.seq });
        } else if (errored) {
          ledger?.transition(turnScope, "failed");
        } else {
          // 提前 EOF（无 commit 也无 error）：结果待核对，不自动释放额度
          ledger?.transition(turnScope, "unconfirmed");
        }
      }
      let finalState: WorldState | undefined;
      for (const ev of events) {
        const state = (ev as { state?: WorldState }).state;
        if (ev.type === "turn.patch" && state) finalState = state;
      }
      // 「玩家知道了谁的名字」两条确定性来源：
      //   ① 这次行动有明确对话对象（targetNpcId）且玩家在问名字 → 解锁该 NPC（唯一、可判、不靠猜文本）；
      //   ② 没有对象时（自由输入）退回台词判定：台词内容里自报姓名才算，旁白提到不算。
      //
      // 硬约束（审阅 P1-3/P1-4）：
      // - 只有回合真的提交（turn.commit）才解锁——失败回合不落状态；
      // - 目标必须此刻在玩家所在场景（presentIds）里——不在场的人解锁不了。
      if (deps.learnNpcNames && committed) {
        // 已提交回合不能再被旁路失败改写：姓名解锁失败只记日志，账本保持 committed、事件照常下发
        try {
          const snapshot = finalState ?? (await deps.store.snapshot(roomId));
          const npcs = Object.values(snapshot.entities).filter((e) => e.kind === "npc" && e.status === "active");
          const learnedIds = new Set<string>();
          const presentIds = new Set(snapshot.room.scene.presentIds);
          if (body.targetNpcId && isAskNameInput(body.input)) {
            const targetNpc = snapshot.entities[body.targetNpcId];
            if (targetNpc && targetNpc.kind === "npc" && presentIds.has(targetNpc.id)) learnedIds.add(targetNpc.id);
          }
          if (!body.targetNpcId) {
            const speech = events
              .flatMap((ev) => {
                const d = ev as { type?: string; field?: string; text?: string; facts?: string[] };
                if (d.type === "turn.delta" && typeof d.text === "string") return [d.text];
                if (d.type === "turn.facts" && Array.isArray(d.facts)) return d.facts;
                return [];
              })
              .join("\n");
            for (const npc of namesIntroducedIn(speech, npcs)) {
              if (presentIds.has(npc.id)) learnedIds.add(npc.id);
            }
          }
          if (learnedIds.size > 0) {
            await deps.learnNpcNames(roomId, [...learnedIds]);
            finalState = await deps.store.snapshot(roomId);
          }
        } catch (e) {
          console.warn(`[names] 回合已提交，但姓名解锁失败：${roomId}`, e);
        }
      }
      // 响应生成与提交状态解耦：脱敏快照失败时用回合开始前的快照兜底，
      // 宁可把刚解锁的人继续遮住，也不能漏真名或把已提交回合报成可重试失败。
      let placeholders: Map<string, string>;
      try {
        placeholders = unknownPlaceholders(finalState ?? (await deps.store.snapshot(roomId)), deps.appearance);
      } catch (e) {
        console.warn(`[names] 回合已提交，但脱敏快照失败，改用回合开始前快照：${roomId}`, e);
        placeholders = unknownPlaceholders(snapshotForInput, deps.appearance);
      }
      for (const ev of events) sseWrite(reply.raw, ev.type, maskNamesDeep(ev, placeholders));
    } catch (e) {
      errored = true;
      // 收到 turn.commit 后才会走到这里的旁路异常：账本保持 committed，也不给客户端可重试信号
      if (!committed && turnScope) ledger?.transition(turnScope, "failed");
      sseWrite(reply.raw, "turn.error", { type: "turn.error", code: "E_UPSTREAM", message: String(e), retryable: !committed });
    } finally {
      reply.raw.end();
    }
    return reply;
  });

/** 行动核对（docs/03 §5.2.10）：重试前确认逻辑请求结果，避免重复扣费/行动 */
  app.get("/api/v1/rooms/:roomId/turns/:clientTurnId", async (req, reply) => {
    const { roomId, clientTurnId } = req.params as { roomId: string; clientTurnId: string };
    if (!(await roomGate(roomId, reply))) return reply;
    const access = await guardRoom(req, reply, deps, roomId, userIdOf);
    if (!access) return reply;
    const userId = access.userId;
    const scope = userId ? { userId, roomId, clientTurnId } : undefined;
    const entry = scope ? deps.ledger?.get(scope) : undefined;
    if (!entry) {
      return reply.code(404).send({ ok: false, code: "E_REF_NOT_FOUND", message: "没有该行动记录" });
    }
    const needsReconciliation = entry.state === "unconfirmed" || entry.state === "running" || entry.state === "reserved";
    const needsHistoryIdentity = entry.state === "committed" && !entry.turnId;
    let recoveredTurn: { turnId: string; committedSeq: number } | undefined;
    // 历史按账号、角色和逻辑 ID 匹配。人工结案已提交但缺 turnId 时，仅补充查询响应。
    if (scope && deps.history && (needsReconciliation || needsHistoryIdentity)) {
      const line = (await deps.history.readAll(roomId)).find(
        (l) => l.clientTurnId === clientTurnId && l.userId === userId && l.actorId === entry.actorId,
      );
      if (line && needsHistoryIdentity) {
        recoveredTurn = { turnId: line.turnId, committedSeq: line.committedSeq };
      } else if (line) {
        const reconciled = await deps.ledger?.reconcileCommitted(scope, { turnId: line.turnId, committedSeq: line.committedSeq });
        // 账本写失败不能伪装成"结果待核对"：玩家/运维需要区分存储故障与真的未决
        if (reconciled && !reconciled.ok && reconciled.code === "E_STORE_FAULT") {
          return reply.code(503).send({ ok: false, code: "E_STORE_FAULT", message: reconciled.message });
        }
      }
    }
    const current = (scope ? deps.ledger?.get(scope) : undefined) ?? entry;
    const turnId = current.turnId ?? recoveredTurn?.turnId;
    const committedSeq = current.committedSeq ?? recoveredTurn?.committedSeq;
    return { ok: true, state: current.state, ...(turnId ? { turnId } : {}), ...(committedSeq !== undefined ? { committedSeq } : {}) };
  });

  // ---------------------------------------------------------------- 世界层永久记忆（docs/08 §9.3，管理员）
  app.post("/api/v1/admin/canonize/run", async (req, reply) => {
    if (!deps.canonize) return reply.code(404).send({ ok: false, code: "E_FORBIDDEN", message: "canonize 未启用" });
    const verdict = adminVerdict(req);
    if (verdict.blocked) return tooManyAdminAttempts(reply, verdict.retryAfterMs);
    if (!verdict.ok) return reply.code(403).send({ ok: false, code: "E_FORBIDDEN", message: "需要管理员令牌" });
    const body = (req.body ?? {}) as { roomId?: string };
    if (!body.roomId) return reply.code(400).send({ ok: false, code: "E_SCHEMA_INVALID", message: "roomId 必填" });
    const report = await safe(reply, () => deps.canonize!.retireRoom(body.roomId!));
    return { ok: true, report };
  });

  app.post("/api/v1/admin/canonize/tombstone", async (req, reply) => {
    if (!deps.canonize) return reply.code(404).send({ ok: false, code: "E_FORBIDDEN", message: "canonize 未启用" });
    const verdict = adminVerdict(req);
    if (verdict.blocked) return tooManyAdminAttempts(reply, verdict.retryAfterMs);
    if (!verdict.ok) return reply.code(403).send({ ok: false, code: "E_FORBIDDEN", message: "需要管理员令牌" });
    const body = (req.body ?? {}) as { memoryId?: string; reason?: string };
    if (!body.memoryId) return reply.code(400).send({ ok: false, code: "E_SCHEMA_INVALID", message: "memoryId 必填" });
    const done = await deps.canonize.tombstone(body.memoryId, body.reason ?? "管理员撤回");
    if (done) return { ok: true };
    // 撤回失败的真实原因从世界层记忆状态推：不存在 = 404 语义，已撤回 = 不可变
    // 存在性用记忆索引判（sample(200) 在世界层 >200 条时会误判 404，审阅 P2-⑤）
    const hit = deps.memory.get?.(body.memoryId);
    if (!hit) return reply.code(404).send({ ok: false, code: "E_REF_NOT_FOUND", message: `世界记忆 ${body.memoryId} 不存在` });
    return reply.code(409).send({ ok: false, code: "E_MEMORY_IMMUTABLE", message: `世界记忆 ${body.memoryId} 已撤回或不可变` });
  });

  /** 观测（P4）：只读指标 + 人工抽样复审用的永久记忆清单 */
  app.get("/api/v1/admin/stats", async (req, reply) => {
    const verdict = adminVerdict(req);
    if (verdict.blocked) return tooManyAdminAttempts(reply, verdict.retryAfterMs);
    if (!verdict.ok) return reply.code(403).send({ ok: false, code: "E_FORBIDDEN", message: "需要管理员令牌" });
    const q = req.query as { roomId?: string; sample?: string };
    const rooms = q.roomId ? [q.roomId] : [];
    const perRoom = rooms.map((roomId) => {
      const records = deps.memory.all(roomId);
      const byTier: Record<string, number> = {};
      let tombstoned = 0;
      for (const r of records) {
        byTier[r.tier ?? "short"] = (byTier[r.tier ?? "short"] ?? 0) + 1;
        if (r.status === "tombstoned") tombstoned += 1;
      }
      return { roomId, total: records.length, byTier, tombstoned };
    });
    const canonize = deps.canonize ? deps.canonize.stats() : null;
    const sample = deps.canonize ? deps.canonize.sample(Number(q.sample ?? 10)) : [];
    // fail-closed 要能被运维看见（审阅 P2-⑥）：没配 judge 时 canonize 仍启用但永远写不出世界层
    return { ok: true, canonize, canonizeEnabled: deps.canonize !== undefined, canonizeJudge: deps.canonizeJudge ?? "none", rooms: perRoom, sample };
  });

  // ---------------------------------------------------------------- 地图（docs/06 §4）
  app.get("/api/v1/rooms/:roomId/map", async (req, reply) => {
    const { roomId } = req.params as { roomId: string };
    if (!(await roomGate(roomId, reply))) return reply;
    const access = await guardRoom(req, reply, deps, roomId, userIdOf);
    if (!access) return reply;
    const q = req.query as { actorId?: string };
    return safe(reply, () => deps.map.getMap(roomId, q.actorId));
  });

  app.post("/api/v1/rooms/:roomId/map/travel", async (req, reply) => {
    const { roomId } = req.params as { roomId: string };
    if (!(await roomGate(roomId, reply))) return reply;
    const parsed = TravelBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return schemaError(zodMessage(parsed.error));
    const access = await guardRoom(req, reply, deps, roomId, userIdOf, { actorId: parsed.data.actorId });
    if (!access) return reply;
    if (actionsPaused(reply)) return reply;
    return safe(reply, () => deps.map.travel(roomId, parsed.data.actorId, parsed.data.locId));
  });

  app.post("/api/v1/rooms/:roomId/map/tick", async (req, reply) => {
    const { roomId } = req.params as { roomId: string };
    if (!(await roomGate(roomId, reply))) return reply;
    const parsed = TickBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return schemaError(zodMessage(parsed.error));
    const access = await guardRoom(req, reply, deps, roomId, userIdOf);
    if (!access) return reply;
    if (actionsPaused(reply)) return reply;
    return safe(reply, () => deps.map.tick(roomId, parsed.data));
  });

  app.post("/api/v1/rooms/:roomId/map/dialogue", async (req, reply) => {
    const { roomId } = req.params as { roomId: string };
    if (!(await roomGate(roomId, reply))) return reply;
    const parsed = DialogueBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return schemaError(zodMessage(parsed.error));
    const access = await guardRoom(req, reply, deps, roomId, userIdOf, { actorId: parsed.data.actorId });
    if (!access) return reply;
    if (actionsPaused(reply)) return reply;
    return safe(reply, () =>
      deps.map.openDialogue(roomId, parsed.data.actorId, parsed.data.sceneId, parsed.data.dialogueId),
    );
  });

  app.post("/api/v1/map/drafts", (req, reply) => {
    const deny = adminOnly(req, "地图草案暂仅管理员可用");
    if (deny) return deny;
    return safe(reply, () => deps.map.createDraft(req.body));
  });

  app.get("/api/v1/map/drafts", (req, reply) => safe(reply, () => deps.map.listDrafts(adminTokenOf(req.headers))));

  app.get("/api/v1/map/drafts/:id", (req, reply) => {
    const deny = adminOnly(req, "地图草案暂仅管理员可用");
    if (deny) return deny;
    const { id } = req.params as { id: string };
    return safe(reply, () => deps.map.getDraft(id));
  });

  app.post("/api/v1/admin/map/drafts/:id/review", (req, reply) => {
    const { id } = req.params as { id: string };
    return safe(reply, () => deps.map.reviewDraft(id, adminTokenOf(req.headers), req.body));
  });

  app.post("/api/v1/admin/map/drafts/:id/publish", (req, reply) => {
    const { id } = req.params as { id: string };
    return safe(reply, () => deps.map.publishDraft(id, adminTokenOf(req.headers), req.body));
  });

  app.post("/api/v1/admin/map/drafts/:id/generate", (req, reply) => {
    const { id } = req.params as { id: string };
    return safe(reply, () => deps.map.retryGenerate(id, adminTokenOf(req.headers)));
  });

  // ---------------------------------------------------------------- 图鉴 / 开局剧本（docs/03 §5.2.5、§5.2.6）
  // 路由实现放独立文件，这里只做装配：并行开发时这段代码尽量不成为冲突点。
  // 图鉴需要"房间存在性"：FileStore 有 listRooms，snapshot 对缺失房间不抛错；
  // 测试替身若不实现 listRooms，按空房间表处理（图鉴 404），不影响其它端点。
  const viewStore = deps.store as Store & { listRooms?: () => Promise<string[]> };
  registerViewRoutes(app, {
    store: {
      snapshot: (roomId) => viewStore.snapshot(roomId),
      listRooms: () => viewStore.listRooms?.() ?? Promise.resolve([]),
    },
    registry: deps.registry,
    scenarios: deps.scenarios ?? EMPTY_SCENARIOS,
authorize: async (req, reply, roomId) => (await guardRoom(req, reply, deps, roomId, userIdOf)) !== null,
    appearance: deps.appearance,
  });
}
