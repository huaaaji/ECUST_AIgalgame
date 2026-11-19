/**
 * Arbiter：唯一写入口（AGENTS.md I1）。LLM 与模块只能"提议"，这里"裁决"。
 *
 * 一次 apply = 逐条校验 → 在状态副本上试算 → 整批通过才追加事件。
 * 拦下的提案进 rejected[]（02 §4：坏条目丢弃、不阻断其余条目），
 * 唯一的例外是 op 名不在 13 个原语闭集内：那是代码写错了，整批回滚。
 *
 * 回合预算：`xWritesPerTurn` / `maxDeltaPerTurn` 是**整回合**限额，不是单次 apply 的限额。
 * 同一回合拆成多次 apply 时，Turn 用 createTurnBudget() 建一个预算对象并在每次 apply 传同一个
 * `turnBudget`（ArbiterApplyOptions），计数因此跨批累计；不传时按 cause.causedBy（回退 cause.id）
 * 隐式归集，与旧行为一致。
 */

import type {
  ApplyMode,
  ApplyOptions,
  ApplyResult,
  Envelope,
  OpName,
  Proposal,
  Rejected,
  Registry,
  RoomId,
  ValidationResult,
  WorldState,
} from "../../shared/src/contract/types.ts";
import { OP_NAMES } from "../../shared/src/contract/types.ts";
import { applyEvent } from "./projection.ts";
import type { MemoryReader, OpLimits } from "./arbiter.ops.ts";
import { validateOp } from "./arbiter.ops.ts";
import type { EventLog } from "./store.ts";

/** 全部来自 docs/02 §3、03 §8 与 03 §10.4 的默认值；改这里等于改玩法手感，要同步文档 */
export type ArbiterLimits = OpLimits & {
  xWritesPerTurn: number;
};

export const DEFAULT_LIMITS: ArbiterLimits = {
  npc: 24,
  loc: 40,
  item: 200,
  plots: 6,
  presentMax: 16,
  nameMax: 24,
  tagsMax: 16,
  xKeysPerEntity: 32,
  xWritesPerTurn: 8,
  maxDeltaPerTurn: 25,
  memoryContentMax: 500,
  memoryTagsMax: 8,
};

export interface ArbiterOptions {
  /** 必须是 EventLog 而不是 Store：只有 Arbiter 能拿到 append */
  store: EventLog;
  registry: Registry;
  limits?: Partial<ArbiterLimits>;
  /** 事件 ts；测试里注入固定值，便于断言全量事件 */
  now?: () => number;
  /** 保留多少个"回合预算"档（默认 64，超出按插入顺序淘汰） */
  maxTrackedTurns?: number;
  /**
   * 记忆索引（只读）：permanent 的幂等/不可变校验、tombstone 目标校验要看已有条目。
   * 不注入时只做结构校验（单测可以省掉）。
   */
  memories?: MemoryReader;
}

/**
 * 整回合预算（引擎内部契约，不在跨包类型里）：同一次 Turn 内多次 apply 共享同一份计数。
 * 由 createTurnBudget() 创建；Turn 负责在回合结束时 endTurn(turnKey)。
 */
export interface TurnBudget {
  /** `entityId|key` → 本回合累计变化量（限额是按回合累计，不是按单条） */
  delta: Map<string, number>;
  /** 本回合 x. 区已写入条数（多次 apply 共享） */
  xWrites: number;
  /** 本回合已写记忆条数：memory id 的序号，保证同回合同 owner 不撞 id */
  memSeq: number;
}

export function createTurnBudget(): TurnBudget {
  return { delta: new Map(), xWrites: 0, memSeq: 0 };
}

/** apply 可选参数：在 03 §2.3 的 ApplyOptions 之上加引擎内部的回合预算 */
export type ArbiterApplyOptions = ApplyOptions & { turnBudget?: TurnBudget };

export class DefaultArbiter {
  private readonly store: EventLog;
  private readonly registry: Registry;
  private readonly limits: ArbiterLimits;
  private readonly now: () => number;
  private readonly maxTrackedTurns: number;
  private readonly memories?: MemoryReader;
  private readonly budgets = new Map<string, TurnBudget>();
  /** 每房间一条串行链：并发 apply 不会交错读同一份快照 */
  private readonly chains = new Map<RoomId, Promise<unknown>>();

  constructor(opts: ArbiterOptions) {
    this.store = opts.store;
    this.registry = opts.registry;
    this.limits = { ...DEFAULT_LIMITS, ...opts.limits };
    this.now = opts.now ?? Date.now;
    this.maxTrackedTurns = opts.maxTrackedTurns ?? 64;
    this.memories = opts.memories;
  }

  /** 同房间串行化：所有 apply 排队执行，避免两个请求各读到同一 seq 后互相覆盖 */
  private exclusive<T>(roomId: RoomId, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(roomId) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    this.chains.set(roomId, run.then(() => undefined, () => undefined));
    return run;
  }

  /** 登记一份预算到回合键（超出 maxTrackedTurns 按插入顺序淘汰最旧的一档） */
  private trackBudget(turnKey: string, budget: TurnBudget): void {
    if (!this.budgets.has(turnKey) && this.budgets.size >= this.maxTrackedTurns) {
      const oldest = this.budgets.keys().next();
      if (!oldest.done) this.budgets.delete(oldest.value);
    }
    this.budgets.set(turnKey, budget);
  }

  private budgetFor(turnKey: string): TurnBudget {
    const existing = this.budgets.get(turnKey);
    if (existing) return existing;
    const budget = createTurnBudget();
    this.trackBudget(turnKey, budget);
    return budget;
  }

  /**
   * 显式预算优先；传了就登记到回合键——这样同回合内没传预算的入口
   * （如 Turn 走审核处置的 audit.punish）也会共享同一份计数，而不是另开一档。
   */
  private budgetOf(turnKey: string, explicit?: TurnBudget): TurnBudget {
    if (!explicit) return this.budgetFor(turnKey);
    this.trackBudget(turnKey, explicit);
    return explicit;
  }

  /** 回合结束由编排层调用（Turn 在 commit 后调用），避免预算表无限增长 */
  endTurn(turnKey: string): void {
    this.budgets.delete(turnKey);
  }

  /** 只校验不落库、不消耗回合预算：给 Turn 做"先 dryRun 再 apply"的两段式，也方便单元测试 */
  async dryRun(roomId: RoomId, ops: Proposal[]): Promise<ValidationResult> {
    const seq = await this.store.load(roomId); // 先载入：文件实现未载入时 seq 是 0
    const state = await this.store.snapshot(roomId);
    const sim = this.simulate(seq, state, ops, this.pseudoCause(roomId, seq), "atomic", createTurnBudget());
    return { ok: !sim.fatal && sim.rejected.length === 0, rejected: sim.rejected };
  }

  /**
   * 裁决 + 提交。默认 atomic：**任何一条被拒 → 整批不落库**（03 §2.3 / 02 §4）。
   * partial 只在明确需要"坏条目丢弃、其余照做"的场景显式指定。
   * 传 `turnBudget` 时跨多次 apply 共享整回合计数；不传则按 cause.causedBy（回退 cause.id）归集。
   */
  async apply(roomId: RoomId, ops: Proposal[], cause: Envelope, opts: ArbiterApplyOptions = {}): Promise<ApplyResult> {
    return this.exclusive(roomId, async () => {
      const mode: ApplyMode = opts.mode ?? "atomic";
      // 必须先载入再读 seq：FileStore 懒加载，重启后未载入时 seq 是 0（MAJOR-1）
      const seqBefore = await this.store.load(roomId);

      if (opts.expectedSeq !== undefined && opts.expectedSeq !== seqBefore) {
        // 整批失败，没有"哪条 proposal 被拒"可说 —— 不要伪造一条来占位（MAJOR-2）
        return {
          ok: false, mode, seq: seqBefore, applied: [], rejected: [], events: [],
          error: { code: "E_SEQ_GAP", message: `期望 seq ${opts.expectedSeq}，实际 ${seqBefore}（状态已过期，请重放后重试）` },
        };
      }

      const state = await this.store.snapshot(roomId);
      const turnKey = cause.causedBy ?? cause.id;
      const budget = this.budgetOf(turnKey, opts.turnBudget);
      // 失败回滚时预算也要回滚，否则一条被拒的提案会白吃掉本回合额度
      const deltaBackup = new Map(budget.delta);
      const xBackup = budget.xWrites;
      const memBackup = budget.memSeq;

      const sim = this.simulate(seqBefore, state, ops, cause, mode, budget);
      const abort = sim.fatal || (mode === "atomic" && sim.rejected.length > 0);
      if (abort) {
        budget.delta = deltaBackup;
        budget.xWrites = xBackup;
        budget.memSeq = memBackup;
        return { ok: false, mode, seq: seqBefore, applied: [], rejected: sim.rejected, events: [] };
      }
      if (sim.events.length > 0) {
        try {
          // 写盘先行（FileStore 会 await）：失败则状态未变更，可以直接重试
          await this.store.append(roomId, sim.events);
        } catch (e) {
          budget.delta = deltaBackup;
          budget.xWrites = xBackup;
          budget.memSeq = memBackup;
          return {
            ok: false, mode, seq: seqBefore, applied: [], rejected: [], events: [],
            error: { code: "E_STORE_FAULT", message: `落盘失败：${e instanceof Error ? e.message : String(e)}` },
          };
        }
      }
      return {
        // ok = "这批到底提交了没有"。partial 模式下部分被拒不等于提交失败（03 §2.3）
        ok: mode === "atomic" ? sim.rejected.length === 0 : true,
        mode,
        seq: this.store.seq(roomId),
        applied: sim.applied,
        rejected: sim.rejected,
        events: sim.events,
      };
    });
  }

  private pseudoCause(roomId: RoomId, seq: number): Envelope {
    return {
      v: 1,
      id: "dry-run",
      roomId,
      seq,
      ts: this.now(),
      actorId: "system",
      type: "arbiter.dryRun",
      payload: {},
    };
  }

  /**
   * 试算循环。它改的是快照副本：任何一步抛异常事件都不会进日志，
   * 所以"先算完再提交"本身就是回滚机制，不需要 undo 栈。
   */
  private simulate(
    startSeq: number,
    base: WorldState,
    ops: Proposal[],
    cause: Envelope,
    _mode: ApplyMode,
    budget: TurnBudget,
  ): { events: Envelope[]; applied: Proposal[]; rejected: Rejected[]; fatal: boolean } {
    const roomId = cause.roomId;
    let state = base;
    const events: Envelope[] = [];
    const applied: Proposal[] = [];
    const rejected: Rejected[] = [];
    let msgSeq = 0;

    for (const proposal of ops) {
      const op = proposal && typeof proposal.op === "string" ? proposal.op : undefined;
      if (op === undefined || !(OP_NAMES as readonly string[]).includes(op)) {
        // 未知 op 不是"这条数据脏"，而是调用方版本不一致，继续跑只会写坏世界
        rejected.push({ proposal, code: "E_ILLEGAL_OP", detail: `op ${String(op)} 不在 13 个原语闭集内` });
        return { events: [], applied: [], rejected, fatal: true };
      }
      const args = proposal.args ?? {};
      const key = typeof args.key === "string" ? args.key : "";
      const isXWrite = (op === "attr.delta" || op === "attr.set") && key.startsWith("x.");
      const ctx = {
        state,
        registry: this.registry,
        cause,
        deltaBudget: budget.delta,
        ...(this.memories ? { memories: this.memories } : {}),
        nextMemorySeq: () => {
          budget.memSeq += 1;
          return budget.memSeq;
        },
        nextMessageSeq: () => {
          msgSeq += 1;
          return msgSeq;
        },
      };
      const result = validateOp(op as OpName, args, ctx, proposal, this.limits);
      if ("fail" in result) {
        rejected.push({ proposal, code: result.fail.code, detail: result.fail.detail });
        continue;
      }
      if (isXWrite) {
        // 只有真正通过的写入才消耗额度：被拒的条目不占额度（否则 partial 模式会"越错越紧"）
        budget.xWrites += 1;
        if (budget.xWrites > this.limits.xWritesPerTurn) {
          rejected.push({ proposal, code: "E_X_LIMIT", detail: `x. 区每回合最多写 ${this.limits.xWritesPerTurn} 条` });
          continue;
        }
      }
      const seq = startSeq + events.length + 1;
      const env: Envelope = {
        v: 1,
        id: `evt_${roomId}_${seq}`,
        roomId,
        seq,
        ts: this.now(),
        actorId: cause.actorId,
        type: result.event.type,
        payload: result.event.payload,
        causedBy: cause.id,
        ...(result.event.audience ? { audience: result.event.audience } : {}),
      };
      events.push(env);
      applied.push(proposal);
      state = applyEvent(state, env);
    }
    return { events, applied, rejected, fatal: false };
  }
}
