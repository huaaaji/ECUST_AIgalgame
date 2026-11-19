/**
 * Registry：把 content/registry/*.json 变成引擎可查的只读表。
 * 为什么引擎不硬编码属性：I2（加属性只改 JSON，不改引擎）。
 * 12 个 op 是闭集，即使 ops.json 缺失也用内置定义兜底 —— 闭集由契约保证，不由数据保证。
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type {
  AttrDef,
  EntityKind,
  EventDef,
  IntentDef,
  OpDef,
  OpName,
  Registry,
  ToolDef,
} from "../../shared/src/contract/types.ts";
import { OP_NAMES } from "../../shared/src/contract/types.ts";

export interface RegistrySource {
  attrs?: AttrDef[];
  events?: EventDef[];
  intents?: IntentDef[];
  tools?: ToolDef[];
  ops?: OpDef[];
}

const OP_REQUIRES: Record<OpName, OpDef["requires"]> = {
  "attr.delta": "attr",
  "attr.set": "attr",
  "entity.create": "none",
  "entity.update": "entity",
  "entity.tombstone": "entity",
  "link.create": "entity",
  "link.remove": "entity",
  "move.to": "entity",
  "time.advance": "none",
  "scene.set": "none",
  "memory.write": "none",
  "plot.upsert": "plot",
  "msg.send": "none",
};

const BUILTIN_OPS: OpDef[] = OP_NAMES.map((name) => ({ name, args: {}, requires: OP_REQUIRES[name] }));

/** 逐文件读 JSON；文件不存在不是错误（M0 阶段 content 可能还没铺开） */
async function readJsonFile<T>(dir: string, file: string): Promise<T | undefined> {
  const full = path.join(dir, file);
  if (!existsSync(full)) return undefined;
  try {
    return JSON.parse(await readFile(full, "utf8")) as T;
  } catch {
    return undefined; // 坏 JSON 由 check-contract 抓，不在运行时炸引擎
  }
}

export class JsonRegistry implements Registry {
  private attrMap = new Map<string, AttrDef>();
  private eventMap = new Map<string, EventDef>();
  private intentMap = new Map<string, IntentDef>();
  private toolMap = new Map<string, ToolDef>();
  private opMap = new Map<string, OpDef>();
  private readonly dir: string;

  constructor(source: RegistrySource = {}, dir = "") {
    this.dir = dir;
    this.loadSync(source);
  }

  private loadSync(source: RegistrySource): void {
    this.attrMap = new Map((source.attrs ?? []).map((a) => [a.key, a]));
    this.eventMap = new Map((source.events ?? []).map((e) => [e.type, e]));
    this.intentMap = new Map((source.intents ?? []).map((i) => [i.name, i]));
    this.toolMap = new Map((source.tools ?? []).map((t) => [t.name, t]));
    this.opMap = new Map([...BUILTIN_OPS, ...(source.ops ?? [])].map((o) => [o.name, o]));
  }

  /** 默认读 <cwd>/content/registry；文件缺失则退化为内置 op 表 */
  static async load(dir = path.join(process.cwd(), "content", "registry")): Promise<JsonRegistry> {
    const [attrs, events, intents, tools, ops] = await Promise.all([
      readJsonFile<{ attrs: AttrDef[] }>(dir, "attrs.json"),
      readJsonFile<{ events: EventDef[] }>(dir, "events.json"),
      readJsonFile<{ intents: IntentDef[] }>(dir, "intents.json"),
      readJsonFile<{ tools: ToolDef[] }>(dir, "tools.json"),
      readJsonFile<{ ops: OpDef[] }>(dir, "ops.json"),
    ]);
    return new JsonRegistry(
      {
        attrs: attrs?.attrs,
        events: events?.events,
        intents: intents?.intents,
        tools: tools?.tools,
        ops: ops?.ops,
      },
      dir,
    );
  }

  attr(key: string): AttrDef | undefined {
    return this.attrMap.get(key);
  }

  attrs(scope?: EntityKind): AttrDef[] {
    const all = [...this.attrMap.values()];
    return scope ? all.filter((a) => a.scope.includes(scope)) : all;
  }

  event(type: string): EventDef | undefined {
    return this.eventMap.get(type);
  }

  intent(name: string): IntentDef | undefined {
    return this.intentMap.get(name);
  }

  tool(name: string): ToolDef | undefined {
    return this.toolMap.get(name);
  }

  op(name: string): OpDef | undefined {
    return this.opMap.get(name);
  }

  async reload(): Promise<void> {
    if (!this.dir) return;
    const fresh = await JsonRegistry.load(this.dir);
    this.attrMap = fresh.attrMap;
    this.eventMap = fresh.eventMap;
    this.intentMap = fresh.intentMap;
    this.toolMap = fresh.toolMap;
    this.opMap = fresh.opMap;
  }
}

/** 测试与模块作者用的空表：只有内置 op */
export function emptyRegistry(): JsonRegistry {
  return new JsonRegistry();
}
