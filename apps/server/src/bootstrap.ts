/**
 * 装配层：把 content/ 里的数据、packages/ 里的引擎、免费的 ecust/超算 API 接起来。
 * 这里是唯一知道"世界长什么样"的地方；引擎本身不认识任何具体名字。
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { DialogueDirector, Entity, Envelope, Proposal, Registry } from "../../../packages/shared/src/index.ts";
import { CONTRACT_VERSION } from "../../../packages/shared/src/index.ts";
import {
  DefaultArbiter,
  DefaultTurn,
  DialogueHost,
  FileStore,
  EventSourcedMemory,
  JsonRegistry,
  MemoryTransport,
  ModuleHost,
  NoopAudit,
  buildView,
  resolveAuditPolicy,
  resolveRealityPolicy,
} from "../../../packages/engine/src/index.ts";
import { MockLlm, OpenAiCompatClient } from "../../../packages/llm/src/index.ts";
import { CanonizeJob, worldRoomId } from "../../../packages/engine/src/index.ts";
import { GossipAgent, GossipHost, MessageIndex, TalkBudget, loadGossipPolicy, loadConversationPolicy } from "../../../packages/engine/src/v2/index.ts";
import { DEFAULT_CONVERSATION_POLICY } from "../../../packages/shared/src/index.ts";
import type { ServerConfig } from "./config.ts";
import { hasAudit, hasCanonize, hasLlm } from "./config.ts";
import { DenyAllJudge, LlmCanonizeJudge } from "./canonize.ts";
import { FileImpressions } from "./impressions.ts";
import { SaveIndex } from "./saves.ts";
import { TurnHistory, withTurnRecording } from "./turn-history.ts";
import { LlmAudit } from "./audit.ts";
import { MapService } from "./map.ts";
import { AuthStore } from "./auth-store.ts";
import { SessionStore } from "./sessions.ts";
import { AuthService } from "./auth.ts";
import { TurnLedger } from "./quota.ts";
import { AdminLog } from "./admin-log.ts";
import { loadSceneDescs, offlineNarrative } from "./offline-narrator.ts";
import { LlmSwitch } from "./llm-switch.ts";
import { LlmSettings, loadPersistedLlmSettings } from "./settings.ts";
import { appearanceById, loadScenarios } from "./scenarios.ts";
import type { AppDeps } from "./routes.ts";

interface CanonWorld {
  worldId: string;
  startLocId?: string;
  locs: { id: string; name: string; exits?: string[] }[];
  npcs: { id: string; name: string; role?: string; traits?: string[]; locId?: string }[];
  facts?: { id: string; text: string }[];
}

const now = () => Date.now();

/**
 * 扫描 content/directors/*.ts(.js) 注册全部导演：新增对话形态 = 新增一个文件，不改这里。
 * 单个导演文件坏了只跳过它——不能因为一个导演把整个服务拖垮。
 */
async function loadDirectors(dir: string): Promise<DialogueDirector[]> {
  const directors: DialogueDirector[] = [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(ts|js)$/.test(entry.name) || entry.name.endsWith(".test.ts")) continue;
    try {
      const ns = (await import(pathToFileURL(path.join(dir, entry.name)).href)) as { default?: DialogueDirector };
      if (ns.default && typeof ns.default.id === "string" && typeof ns.default.nextTurn === "function") {
        directors.push(ns.default);
      }
    } catch (e) {
      console.warn(`[bootstrap] 导演 ${entry.name} 加载失败：`, e instanceof Error ? e.message : e);
    }
  }
  return directors;
}

/** 装配结果 = HTTP 层需要的 deps，另外把引擎内部件给测试/运维用（arbiter 不对外暴露成端点） */
export type App = AppDeps & {
  arbiter: DefaultArbiter;
  memory: EventSourcedMemory;
  /** 世界层永久记忆的发布器（server 只做调度，闸门在引擎里） */
  canonize: CanonizeJob;
  worldRoom: string;
  /** 续玩（issue #7）：已提交回合的对话历史（旁路文件，不是权威状态） */
  history: TurnHistory;
  /** 续玩（issue #7）：账号维度的存档索引 */
  saves: SaveIndex;
  /** 简易用户系统：账号库 + 会话（HTTP 层用） */
  auth: AuthService;
  /** 行动额度账本（收敛稿 B1） */
  ledger: TurnLedger;
  /** 管理操作日志 */
  adminLog: AdminLog;
};

export async function createApp(cfg: ServerConfig): Promise<App> {
  const contentDir = path.resolve(cfg.contentDir);
  const canon = JSON.parse(await readFile(path.join(contentDir, "canon", "world.json"), "utf8")) as CanonWorld;
  // canon 允许不写 startLocId：此时取 locs[0]。必须在建 store 前算出来，
  // 否则 FileStore 会用默认 loc_campus_gate，开场 move.to 全部不相邻被拒。
  const startLoc = canon.startLocId ?? canon.locs[0]?.id;
  if (!startLoc) throw new Error("canon/world.json 缺少 locs");

  const registry: Registry = new JsonRegistry(undefined, path.join(contentDir, "registry"));
  await registry.reload();

  // 开局剧本 / NPC 公开档案是内容数据（content/scenarios/*.json）；缺文件 = 无预设，不影响启动
  const scenarios = await loadScenarios(path.join(contentDir, "scenarios"));

  // 审核策略（分类/阈值/扣分/删档线）是内容，不是代码；缺文件就用引擎默认值
  const auditPolicy = resolveAuditPolicy(await readOptionalJson(path.join(contentDir, "registry", "policy.json")));
  // 现实锚定：识别"我全知全能"这类诱导性发言并修饰回世界内（缺文件则只带基础世界规则）
  const reality = resolveRealityPolicy(await readOptionalJson(path.join(contentDir, "registry", "reality.json")));

  // 初始状态必须有真实地点：world.json 可以省略 startLocId，此时用第一个地点，
  // 否则 createInitialState 会退回占位值 loc_campus_gate，房间一出生就"在不存在的地方"
  const bootLocId = canon.startLocId ?? canon.locs[0]?.id;
  if (!bootLocId) throw new Error("canon/world.json 缺少 locs");
  const store = new FileStore(path.join(path.resolve(cfg.dataDir), "rooms"), {
    worldId: canon.worldId,
    locId: startLoc,
  });

  // 记忆与裁决器共享同一份事件日志：记忆是"日志的投影"，不是第二个数据库
  if (!cfg.trustUserHeader) console.warn("[config] GALGAME_TRUST_USER_HEADER=0：忽略 X-User-Id，只接受前置鉴权注入的 userId");
  const memory = new EventSourcedMemory();
  const arbiter = new DefaultArbiter({ store, registry, memories: memory });
  const modules = new ModuleHost({ dir: path.join(contentDir, "modules") });
  await modules.load();

  // 离线叙述用到的场景描述（内容数据，缺文件也不影响启动）
  const sceneDescs = await loadSceneDescs(path.join(contentDir, "modules", "map", "data", "world_map.json"));

  // 模型端口用开关包一层：Turn/Map/Dialogue 都持有同一个 LlmSwitch，
  // 玩家在界面里提交 key 后，设置服务替换内部实现即可生效，不用重启。
  // 优先级：环境变量 GALGAME_LLM_* > 上次保存的 data/llm-settings.json > 离线叙述。
  const offlineLlm = new MockLlm({
    // 未接入模型时用离线叙述器：按场景/时段/动作拼一段白描。
    // 叙事会原样进玩家对话流，所以这里**不许**出现配置名或"你说了"这类元信息。
    handler: (req) =>
      JSON.stringify({
        narrative: offlineNarrative(req.messages, sceneDescs),
        dialogue: "",
        proposals: [],
      }),
  });
  const settingsFilePath = path.join(path.resolve(cfg.dataDir), "llm-settings.json");
  const saved = await loadPersistedLlmSettings(settingsFilePath);
  const fromEnv = hasLlm(cfg);
  const remoteClient = fromEnv
    ? new OpenAiCompatClient({
        baseUrl: cfg.llm.baseUrl,
        model: cfg.llm.model,
        apiKey: cfg.llm.apiKey,
        timeoutMs: cfg.llm.timeoutMs,
      })
    : saved
      ? new OpenAiCompatClient({
          baseUrl: saved.baseUrl,
          model: saved.model,
          apiKey: saved.apiKey,
          timeoutMs: cfg.llm.timeoutMs,
        })
      : null;
  const llm = new LlmSwitch(remoteClient ?? offlineLlm);
  const settings = new LlmSettings({
    sw: llm,
    offline: offlineLlm,
    filePath: settingsFilePath,
    initial: {
      mode: remoteClient ? "remote" : "offline",
      baseUrl: fromEnv ? cfg.llm.baseUrl : saved?.baseUrl ?? "",
      model: fromEnv ? cfg.llm.model : saved?.model ?? cfg.llm.model,
      persisted: !fromEnv && saved !== null,
    },
  });
  if (saved && !fromEnv) {
    console.log(`[settings] 已从本地恢复模型配置（${saved.model} @ ${saved.baseUrl}）`);
  }

  const transport = new MemoryTransport();
  const directors = await loadDirectors(path.join(contentDir, "directors"));
  const dialogue = new DialogueHost((spec) => ({
    roomId: spec.roomId,
    actorId: spec.participants[0] ?? "system",
    input: "",
    state: store.state(spec.roomId),
    registry,
    clock: store.state(spec.roomId).clock,
    query: {
      entity: (id) => store.state(spec.roomId).entities[id],
      attr: (id, key) => store.state(spec.roomId).entities[id]?.attrs[key],
      present: () => [...store.state(spec.roomId).room.scene.presentIds],
      links: (kind, from) => store.state(spec.roomId).links.filter((l) => (!kind || l.kind === kind) && (!from || l.from === from)),
    },
    llm,
    log: () => undefined,
  }), directors);

  // 审核器必须是"另一个模型"：同一家族自审容易被同一套破甲提示词一起带走
  if (hasLlm(cfg) && !hasAudit(cfg)) {
    console.warn("[audit] 未配置独立审核器（GALGAME_AUDIT_BASE_URL/MODEL/API_KEY），当前为放行态，仅限开发使用");
  }
  const auditCfg = cfg.audit;
  const audit =
    auditCfg && hasAudit(cfg)
      ? new LlmAudit(
          new OpenAiCompatClient({
            baseUrl: auditCfg.baseUrl,
            model: auditCfg.model,
            apiKey: auditCfg.apiKey,
            timeoutMs: auditCfg.timeoutMs,
          }),
        )
      : new NoopAudit();

  // 世界印象：用户投影（data/users/<id>/impressions.json），不写世界状态
  const impressions = new FileImpressions(path.join(path.resolve(cfg.dataDir), "users"), {
    ttlDays: cfg.impressionTtlDays ?? 30,
    now,
  });

  // 续玩（issue #7）：历史和存档索引都是"投影"，写失败不影响已提交的回合。
  // 历史挂在 Turn 外层（而不是 HTTP 路由里），这样 map.travel 这类内部回合也能被记录。
  const dataRoot = path.resolve(cfg.dataDir);
  const history = new TurnHistory(path.join(dataRoot, "history"));
  const saves = new SaveIndex(path.join(dataRoot, "users"));
  const users = new AuthStore(path.join(dataRoot, "auth", "auth.json"));
  await users.load();
  const sessions = new SessionStore((cfg.sessionTtlDays ?? 7) * 24 * 60 * 60 * 1000);
  const auth = new AuthService({
    store: users,
    sessions,
    envCode: cfg.inviteCode ?? "",
    required: cfg.authRequired ?? false,
    secureCookies: cfg.secureCookies ?? false,
    ttlDays: cfg.sessionTtlDays ?? 7,
    resetTtlMs: (cfg.resetTtlMin ?? 15) * 60_000,
  });
  const ledger = new TurnLedger(path.join(dataRoot, "auth", "ledger.jsonl"));
  await ledger.load();
  const adminLog = new AdminLog(path.join(dataRoot, "auth", "admin-actions.jsonl"));
  if (auth.required && !cfg.inviteCode) {
    console.warn("[auth] GALGAME_AUTH_REQUIRED=1 但未配置 GALGAME_INVITE_CODE：注册仅接受管理员签发的一次性邀请");
  }
  if (auth.required && !cfg.publicOrigin) {
    console.warn("[auth] GALGAME_AUTH_REQUIRED=1 但未配置 GALGAME_PUBLIC_ORIGIN：Cookie 写请求的 CSRF Origin 校验将拒绝缺失 Origin 的请求");
  }
  const rawTurn = new DefaultTurn({ store, arbiter, registry, modules, memory, llm, audit, auditPolicy, reality, impressions });
  const turn = withTurnRecording(rawTurn, { history, saves, store, now });

  // ---------------------------------------------------------------- 世界层永久记忆（docs/08 §7）
  // 世界房间 room_world_<worldId>：无成员、不可进入，只存 permanent。
  // 审核器未配置 = DenyAllJudge（fail-closed）：宁可一条都写不进去，也不把没审过的"常识"发给所有人。
  const worldId = canon.worldId;
  const worldRoom = worldRoomId(worldId);
  const canonizeCfg = cfg.canonize;
  const judge =
    canonizeCfg && hasCanonize(cfg)
      ? new LlmCanonizeJudge(
          new OpenAiCompatClient({
            baseUrl: canonizeCfg.baseUrl,
            model: canonizeCfg.model,
            apiKey: canonizeCfg.apiKey,
            timeoutMs: canonizeCfg.timeoutMs,
          }),
        )
      : new DenyAllJudge();
  if (canonizeCfg?.enabled && !hasCanonize(cfg)) {
    console.warn("[canonize] 已启用但缺少独立审核器（GALGAME_CANONIZE_BASE_URL/MODEL/API_KEY），所有候选将被拒绝（fail-closed）");
  }
  const versionFile = path.join(path.resolve(cfg.dataDir), "worlds", worldId, "mem.version");
  // 版本号只写不读会让重启后退回 0：启动时读回（审阅 P0-3）
  let startVersion = 0;
  try {
    const raw = JSON.parse(await readFile(versionFile, "utf8")) as { version?: unknown };
    if (typeof raw.version === "number" && Number.isFinite(raw.version)) startVersion = Math.max(0, Math.floor(raw.version));
  } catch {
    // 首次启动/文件损坏：从 0 开始，不影响正确性（只是版本号会重新涨上来）
  }
  const canonize = new CanonizeJob({
    store,
    arbiter,
    worldRoom,
    worldId,
    memory,
    judge,
    startVersion,
    limits: {
      enabled: canonizeCfg?.enabled ?? false,
      dailyCap: canonizeCfg?.dailyCap ?? 200,
      minWitness: 2,
      perSourceCap: 2,
    },
    onImpression: async (notice) => impressions.enqueue([notice]),
    onVersionBump: async (_worldId, next) => {
      await mkdir(path.dirname(versionFile), { recursive: true });
      await writeFile(versionFile, JSON.stringify({ worldId, version: next, updatedAt: now() }), "utf8");
    },
    now,
  });

  // 定时补扫（可选）：把已加载房间的公共长期记忆陆续提成世界层候选。
  // 不阻塞请求、不 unref 就会吊住进程，所以显式 unref；失败只打日志（下一轮再试）。
  const scanMinutes = canonizeCfg?.scanMinutes ?? 0;
  if (canonizeCfg?.enabled !== false && scanMinutes > 0) {
    const timer = setInterval(() => {
      void (async () => {
        try {
          for (const roomId of await store.listRooms()) {
            if (roomId === worldRoom) continue;
            await canonize.retireRoom(roomId);
          }
        } catch (e) {
          console.warn("[canonize] 定时补扫失败：", e instanceof Error ? e.message : e);
        }
      })();
    }, Math.max(1, scanMinutes) * 60_000);
    timer.unref?.();
  }

  // ---------------------------------------------------------------- 启动重建记忆索引
  // 事件日志是唯一真源，Memory 只是投影：不重建的话，重启后所有召回为 0（审阅 P0-1/P0-3）。
  // 房间与世界层都要重建；世界层必须单独 rebuild，因为 Turn 只 sync 自己那个房间。
  for (const roomId of await store.listRooms()) {
    memory.rebuild(roomId, await store.events(roomId, 0));
  }
  await store.load(worldRoom);
  memory.rebuild(worldRoom, await store.events(worldRoom, 0));


  // ---------------------------------------------------------------- dev/v2 微信私信宿主
  const messageIndex = new MessageIndex();
  for (const roomId of await store.listRooms()) {
    messageIndex.rebuild(roomId, await store.events(roomId, 0));
  }
  const contentRoot = path.resolve(cfg.contentDir);
  const gossipPolicy = await loadGossipPolicy(path.join(contentRoot, "v2", "gossip-policy.json"));
  const conversationPolicy = await loadConversationPolicy(path.join(contentRoot, "v2", "conversation-policy.json"));
  const talkBudget = new TalkBudget(conversationPolicy, now);
  const gossipAgent = new GossipAgent({ llm, policy: gossipPolicy, conversation: conversationPolicy });
  const gossip = new GossipHost({
    store, arbiter, messages: messageIndex, budget: talkBudget, agent: gossipAgent,
    policy: gossipPolicy, conversation: conversationPolicy, now,
    audit, auditPolicy, memory,
  });
  // 后台波次：玩家离线也能互相回消息。unref + try/catch，失败等下一轮（仿 canonize 补扫）
  const gossipScanMs = Number(process.env.GALGAME_GOSSIP_SCAN_MS ?? 30_000);
  if (gossipScanMs > 0) {
    const timer = setInterval(() => {
      void (async () => {
        try {
          for (const roomId of await store.listRooms()) {
            if (roomId === worldRoom) continue;
            await gossip.step(roomId);
          }
        } catch (e) {
          console.warn("[gossip] 定时波次失败：", e instanceof Error ? e.message : e);
        }
      })();
    }, gossipScanMs);
    timer.unref?.();
  }

  const map = new MapService({
    store,
    turn,
    arbiter,
    modules,
    dialogue,
    llm,
    registry,
    contentDir,
    dataDir: path.resolve(cfg.dataDir),
    adminToken: cfg.adminToken,
    appearance: appearanceById(scenarios),
  });

  return {
    store,
    arbiter,
    memory,
    canonize,
    impressions,
    worldRoom,
    adminToken: cfg.adminToken,
    history,
    saves,
    auth,
    ledger,
    adminLog,
    gossip: {
      send: (roomId, from, to, content, opts) => gossip.send(roomId, from, to, content, opts),
      inbox: (roomId, to) => messageIndex.inbox(roomId, to),
      subscribe: (roomId, viewer, cb) => gossip.subscribe(roomId, viewer, cb),
    },
    turn,
    map,
    settings,
    registry,
    scenarios,
    appearance: appearanceById(scenarios),
    trustUserHeader: cfg.trustUserHeader,
    devUser: cfg.devUser,
publicOrigin: cfg.publicOrigin,
    /** 解锁"玩家知道了这些 NPC 的名字"（由 narrative 里对方自报姓名触发，见 name-unlock.ts） */
    async learnNpcNames(roomId, npcIds) {
      if (npcIds.length === 0) return;
      const cause = {
        v: 1 as const,
        id: `evt_learn_${roomId}_${Date.now()}`,
        roomId,
        seq: store.seq(roomId) + 1,
        ts: now(),
        actorId: "system",
        type: "room.bootstrap" as const,
        payload: {},
      };
      const res = await arbiter.apply(
        roomId,
        npcIds.map((id) => ({
          op: "attr.set" as const,
          args: { entityId: id, key: "knows_name", value: true },
          reason: "对方在对话里报出了自己的名字",
        })),
        cause,
      );
      if (!res.ok) throw new Error(`解锁姓名失败: ${JSON.stringify(res.rejected.slice(0, 2))}`);
    },
    canonizeJudge: hasCanonize(cfg) ? "llm" : "deny_all",
    version: CONTRACT_VERSION,
    async createRoom(_mode, userId) {
      const roomId = `room_${now().toString(36)}${Math.floor(Math.random() * 1e3).toString(36)}`;
      // actorId 是服务端签发的房间内角色 id：客户端不得猜，建房返回值 + 存档以它为准。
      // 旧房间里的 plr_self 保持不动（兼容已有存档），新房间一律 plr_<8hex>。
      const actorId = `plr_${randomBytes(4).toString("hex")}`;
      const ts = now();

      // ① canon 由"内容加载器"直接写入事件日志（不是 AI/模块提案，所以不走 Arbiter 的 canon 锁）。
      //    这是唯一允许绕过 proposal 链的地方，且只在建房时发生一次。
      //
      //    属性默认值只播种 **public** 属性（canon seed 例外，见审阅 M4）：
      //    - `display.hidden`（坐标）跳过——坐标由 map 模块按场景写入，默认 0 会把所有地点叠在原点；
      //    - `visibility: secret`（guard/debt…）绝不预填，避免建房即泄密、也避免客户端从 /state 读到精确值；
      //    - `visibility: self`（trust/mood…）由玩法写入，不给"陌生人也信任 50"的虚假开局。
      const defaultsFor = (kind: Entity["kind"]): Entity["attrs"] => {
        const attrs: Entity["attrs"] = {};
        for (const def of registry.attrs(kind)) {
          if (def.display.hidden) continue;
          if (def.visibility !== "public") continue;
          if (def.default !== undefined) attrs[def.key] = def.default;
        }
        return attrs;
      };

      const seeded: Entity[] = [];
      const addSeed = (id: string, kind: Entity["kind"], name: string, canon: boolean, attrs?: Entity["attrs"]) => {
        seeded.push({
          id,
          kind,
          name,
          attrs: attrs ?? defaultsFor(kind),
          tags: [],
          origin: canon ? "seed" : "system",
          canon,
          status: "active",
          createdAt: ts,
          updatedAt: ts,
        });
      };
      for (const loc of canon.locs) addSeed(loc.id, "loc", loc.name, true);
      for (const npc of canon.npcs) addSeed(npc.id, "npc", npc.name, true);
      for (const f of canon.facts ?? []) addSeed(f.id, "fact", f.text, true);
      addSeed(actorId, "plr", "你", false);

      const seedEvents: Envelope[] = seeded.map((entity, i) => ({
        v: 1 as const,
        id: `evt_seed_${roomId}_${i}`,
        roomId,
        seq: i + 1,
        ts,
        actorId: "system",
        type: "entity.created",
        payload: { entity },
      }));
      // 成员表是账号维度的落点：私忆隔离（同一世界里 A 的 private 记忆 B 看不到）靠它。
      // solo 不是特例——就是只有 1 个成员的合作房（docs/04 §2）。
      seedEvents.push({
        v: 1 as const,
        id: `evt_join_${roomId}`,
        roomId,
        seq: seeded.length + 1,
        ts,
        actorId: "system",
        type: "room.member.joined",
        payload: { member: { actorId, role: "player", joinedSeq: seeded.length + 1, online: true, ...(userId ? { userId } : {}) } },
      });
      await store.append(roomId, seedEvents);

      // ② 其余用普通提案（通路、出生点、在场），一样过 Arbiter 校验
      const ops: Proposal[] = [];
      for (const loc of canon.locs) {
        for (const to of loc.exits ?? []) {
          ops.push({ op: "link.create", args: { kind: "located_in", from: loc.id, to }, reason: "通路" });
        }
      }
      for (const npc of canon.npcs) {
        const loc = npc.locId ?? startLoc;
        ops.push({ op: "move.to", args: { actorId: npc.id, locId: loc }, reason: "初始位置" });
      }
      ops.push({ op: "move.to", args: { actorId, locId: startLoc }, reason: "出生点" });
      // 开场就把"已经在出生点"的 NPC 放进在场列表：他们本来就在这儿，
      // 不该等下一次移动/推进才被玩家看见。
      const startPresent = [
        actorId,
        ...canon.npcs.filter((n) => (n.locId ?? startLoc) === startLoc).map((n) => n.id),
      ];
      ops.push({ op: "scene.set", args: { locId: startLoc, presentIds: startPresent }, reason: "开场" });

      // 「陌生人」的第一手记忆：每个 NPC 都不认识这个新来的玩家。
      // 提示词（S7/S8）只吃 NPC 记忆，这是在不改引擎的前提下让模型知道
      // "对面是个没见过的同学、不知道名字"的唯一通道；玩家自述/问名字后
      // content/modules/introduce 会补一条带名字的记忆，之后模型才会用称呼。
      //
      // 注意：memory.write 只允许写"自己的"记忆（引擎按 cause.actorId 校验），
      // 所以每个 NPC 用**自己的 actorId** 单独提交一条，不能在同一个 system 批次里代写。
      for (const npc of canon.npcs) {
        const memCause = {
          v: 1 as const,
          id: `evt_boot_${roomId}_mem_${npc.id}`,
          roomId,
          seq: store.seq(roomId) + 1,
          ts: now(),
          actorId: npc.id,
          type: "room.bootstrap" as const,
          payload: {},
        };
        const memRes = await arbiter.apply(
          roomId,
          [
            {
              op: "memory.write",
              args: {
                ownerId: npc.id,
                content: "你还不认识这位新同学：之前没有见过他，也不知道他叫什么名字。他若来搭话，先弄清他是谁。",
                tags: ["认识", "新同学"],
                salience: 3,
                visibility: "private",
                about: [actorId],
                // 有账号时带上 userId：私忆按账号隔离（否则会混进别的账号的档案）
                ...(typeof userId === "string" && userId ? { userId } : {}),
              },
              reason: "开局：NPC 与玩家互不相识",
            },
          ],
          memCause,
        );
        if (!memRes.ok) {
          throw new Error(`建房间失败（陌生人记忆）: ${JSON.stringify(memRes.rejected.slice(0, 2))}`);
        }
      }

      const seq = store.seq(roomId);
      const cause = { v: 1 as const, id: `evt_boot_${roomId}`, roomId, seq: seq + 1, ts: now(), actorId: "system", type: "room.bootstrap", payload: {} };
      const res = await arbiter.apply(roomId, ops, cause);
      // apply 对坏条目是"丢弃并继续"（res.ok 仍为 true），建房时任何一条被拒
      // 都说明 canon/装配有 bug，必须显式报出来，不能静默降级。
      if (!res.ok || res.rejected.length > 0) {
        throw new Error(`建房间失败: ${JSON.stringify(res.rejected.slice(0, 3))}`);
      }
      return { roomId, actorId };
    },
  };
}

export { buildView };

/** 可选 JSON 文件：不存在/解析失败都当"没有"，不让内容文件缺失把服务拖死 */
async function readOptionalJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return undefined;
  }
}
