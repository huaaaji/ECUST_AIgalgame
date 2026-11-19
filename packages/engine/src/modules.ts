/**
 * Modules：玩法插件的宿主。零登记——启动扫描 content/modules/<id>/manifest.json。
 * 一个模块崩了只被隔离成一个带 fault 的 ModuleInfo，不影响其他模块和引擎。
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  ContextSlice,
  Module,
  ModuleContext,
  ModuleId,
  ModuleInfo,
  ModuleManifest,
  ModuleOutcome,
  Modules,
  Phase,
  Proposal,
  ViewPatch,
} from "../../shared/src/index.ts";

const EMPTY: ModuleOutcome = { ok: false, proposals: [] };

export interface ModulesOptions {
  /** 默认 content/modules */
  dir?: string;
  /** 模块 import 的超时（防止某个模块 init 卡死启动） */
  loadTimeoutMs?: number;
}

export class ModuleHost implements Modules {
  private readonly dir: string;
  private readonly timeout: number;
  private readonly infos = new Map<ModuleId, ModuleInfo>();
  readonly impl = new Map<ModuleId, Module>();

  constructor(opts: ModulesOptions = {}) {
    this.dir = opts.dir ?? path.join(process.cwd(), "content", "modules");
    this.timeout = opts.loadTimeoutMs ?? 3000;
  }

  /** 扫描 + 加载；单个模块失败不抛出 */
  async load(): Promise<ModuleInfo[]> {
    const entries = await readdir(this.dir, { withFileTypes: true }).catch(() => []);
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const base = path.join(this.dir, ent.name);
      try {
        const raw = JSON.parse(await readFile(path.join(base, "manifest.json"), "utf8")) as ModuleManifest;
        const info: ModuleInfo = { id: raw.id ?? ent.name, manifest: raw, loaded: false };
        this.infos.set(info.id, info);
        const mod = await this.importModule(base);
        if (!mod) {
          info.fault = { code: "E_MODULE_LOAD", message: "module.ts 未导出默认 Module", at: Date.now() };
          continue;
        }
        if (mod.init) await Promise.race([Promise.resolve(mod.init()), timeout(this.timeout)]);
        this.impl.set(info.id, mod);
        info.loaded = true;
      } catch (e) {
        const id = ent.name as ModuleId;
        this.infos.set(id, {
          id,
          manifest: { id, name: ent.name, version: "0.0.0", apiVersion: 3 } as ModuleManifest,
          loaded: false,
          fault: { code: "E_MODULE_LOAD", message: String(e), at: Date.now() },
        });
      }
    }
    return this.list();
  }

  list(): ModuleInfo[] {
    return [...this.infos.values()].sort((a, b) => (a.manifest.priority ?? 100) - (b.manifest.priority ?? 100));
  }

  get(id: ModuleId): ModuleInfo | undefined {
    return this.infos.get(id);
  }

  /** 按 priority 升序，第一个返回 ok 的模块胜出（模块之间不互相调用） */
  async dispatchIntent(ctx: ModuleContext): Promise<ModuleOutcome> {
    for (const info of this.list()) {
      const mod = this.impl.get(info.id);
      if (!mod?.intent) continue;
      if (!matches(info, ctx.input)) continue;
      try {
        const out = await mod.intent(ctx);
        if (out?.ok) return out;
      } catch (e) {
        this.fault(info.id, e);
      }
    }
    return { ...EMPTY, proposals: [] };
  }

  async callTool(name: string, args: unknown, ctx: ModuleContext): Promise<ModuleOutcome> {
    const modId = name.split(".")[0] as ModuleId;
    const mod = this.impl.get(modId);
    const info = this.infos.get(modId);
    if (!mod?.tool || !info) return { ok: false, proposals: [], error: { code: "E_TOOL_NOT_FOUND", message: name } };
    if (!(info.manifest.capabilities?.tools ?? []).includes(name)) {
      return { ok: false, proposals: [], error: { code: "E_TOOL_NOT_FOUND", message: `manifest 未声明 ${name}` } };
    }
    try {
      return await mod.tool(name, args, ctx);
    } catch (e) {
      this.fault(modId, e);
      return { ok: false, proposals: [], error: { code: "E_MODULE_FAULT", message: String(e) } };
    }
  }

  async tick(ctx: ModuleContext, phase: Phase): Promise<Proposal[]> {
    const out: Proposal[] = [];
    for (const info of this.list()) {
      const mod = this.impl.get(info.id);
      if (!mod?.tick) continue;
      if (!(info.manifest.capabilities?.triggers ?? []).includes(phase)) continue;
      try {
        out.push(...(await mod.tick(ctx, phase)));
      } catch (e) {
        this.fault(info.id, e);
      }
    }
    return out;
  }

  context(ctx: ModuleContext, budget: number): ContextSlice[] {
    const slices: ContextSlice[] = [];
    let left = budget;
    for (const info of this.list()) {
      const mod = this.impl.get(info.id);
      if (!mod?.context) continue;
      for (const s of mod.context(ctx, left) ?? []) {
        const cost = Math.ceil(s.text.length / 4);
        if (cost > left) continue;
        left -= cost;
        slices.push(s);
      }
    }
    return slices;
  }

  view(modId: ModuleId, ctx: ModuleContext): ViewPatch | null {
    const mod = this.impl.get(modId);
    if (!mod?.view) return null;
    try {
      return mod.view(ctx);
    } catch (e) {
      this.fault(modId, e);
      return null;
    }
  }

  private async importModule(base: string): Promise<Module | null> {
    for (const file of ["module.ts", "module.js", "index.ts"]) {
      try {
        const ns = (await import(pathToFileURL(path.join(base, file)).href)) as { default?: Module };
        if (ns.default) return ns.default;
      } catch {
        // 换下一个候选文件名
      }
    }
    return null;
  }

  private fault(id: ModuleId, e: unknown): void {
    const info = this.infos.get(id);
    if (info) info.fault = { code: "E_MODULE_FAULT", message: String(e), at: Date.now() };
  }
}

/** 极简意图匹配：模块在 manifest 里声明 intents，文本包含任一关键词即认为它想处理 */
function matches(info: ModuleInfo, input: string): boolean {
  const caps = info.manifest.capabilities;
  // intents 是给程序看的名字（trade.buy），keywords 是玩家真正会打的词（买/商店）——
  // 只按 intents 的英文片段匹配，中文玩家的输入永远路由不到模块。
  const words = [...(caps?.intents ?? []).map((i) => i.split(".").pop() ?? ""), ...(caps?.keywords ?? [])]
    .map((w) => w.toLowerCase())
    .filter((w) => w.length > 0);
  if (words.length === 0) return false;
  const text = input.toLowerCase();
  return words.some((w) => text.includes(w));
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, rej) => setTimeout(() => rej(new Error(`E_MODULE_LOAD: 超过 ${ms}ms`)), ms));
}
