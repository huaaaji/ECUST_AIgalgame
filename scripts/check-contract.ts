/**
 * check:contract —— 契约一致性体检（AGENTS.md §2 铁律 9）。
 * 只读 docs 与 packages/shared，不写任何文件；任一项不一致 → 打印 FAIL 并以 1 退出。
 * 防的是"文档和代码各说各话"：名字唯一来源是 docs/03-接口总表.md，代码只是它的镜像。
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ERROR_CODES } from "../packages/shared/src/contract/errors.ts";
import { OP_NAMES } from "../packages/shared/src/contract/types.ts";
import { CONTRACT_VERSION } from "../packages/shared/src/contract/version.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures: string[] = [];
const ok = (item: string, detail: string): void => console.log(`OK ${item}: ${detail}`);
const fail = (item: string, detail: string): void => {
  failures.push(`FAIL ${item}: ${detail}`);
};

const docPath = join(ROOT, "docs/03-接口总表.md");
const doc = readFileSync(docPath, "utf8");

const onlyIn = (a: Set<string>, b: Set<string>): string[] => [...a].filter((x) => !b.has(x)).sort();
const sameSet = (a: Set<string>, b: Set<string>): boolean => a.size === b.size && onlyIn(a, b).length === 0;

// ---------------------------------------------------------------- 1 契约版本
{
  const docVersion = /CONTRACT_VERSION\s*[:：]\s*`?(\d+\.\d+\.\d+)/.exec(doc)?.[1];
  if (docVersion === undefined) {
    fail("contract-version", "docs/03-接口总表.md 里找不到 CONTRACT_VERSION: x.y.z");
  } else if (docVersion !== CONTRACT_VERSION) {
    fail("contract-version", `docs=${docVersion} code=${CONTRACT_VERSION}`);
  } else {
    ok("contract-version", `${CONTRACT_VERSION}（docs 与 packages/shared 一致）`);
  }
}

// ---------------------------------------------------------------- 2 op 名（13 个闭集）
{
  const start = doc.indexOf("## 3. Op 原语");
  const rest = start === -1 ? "" : doc.slice(start + 1);
  const end = rest.search(/^## /m);
  const section = start === -1 ? "" : end === -1 ? rest : rest.slice(0, end);
  const docOps = new Set([...section.matchAll(/^\|\s*\d+\s*\|\s*`([^`]+)`/gm)].map((m) => m[1] ?? ""));
  const codeOps = new Set<string>(OP_NAMES);
  if (docOps.size === 0) {
    fail("op-names", "docs/03-接口总表.md §3 的 op 表格解析为空");
  } else if (!sameSet(docOps, codeOps)) {
    fail(
      "op-names",
      `docs 独有=[${onlyIn(docOps, codeOps).join(",")}] code 独有=[${onlyIn(codeOps, docOps).join(",")}]`,
    );
  } else if (docOps.size !== 13) {
    fail("op-names", `03 §3 声明了 ${docOps.size} 个 op，闭集必须是 13 个`);
  } else {
    ok("op-names", `13/13 一致：${[...docOps].join(", ")}`);
  }
}

// ---------------------------------------------------------------- 3 错误码
{
  const docCodes = new Set(doc.match(/\bE_[A-Z][A-Z0-9_]*\b/g) ?? []);
  const codeCodes = new Set<string>(ERROR_CODES);
  if (docCodes.size === 0) {
    fail("error-codes", "docs/03-接口总表.md 里一个 E_ 错误码都没匹配到");
  } else if (!sameSet(docCodes, codeCodes)) {
    fail(
      "error-codes",
      `docs 独有=[${onlyIn(docCodes, codeCodes).join(",")}] code 独有=[${onlyIn(codeCodes, docCodes).join(",")}]`,
    );
  } else {
    ok("error-codes", `${docCodes.size}/${codeCodes.size} 一致`);
  }
}

// ---------------------------------------------------------------- 4 JSON Schema 可用性
{
  const schemaDir = join(ROOT, "docs/schemas/v2");
  let files: string[] = [];
  try {
    files = readdirSync(schemaDir).filter((f) => f.endsWith(".json")).sort();
  } catch {
    fail("schemas", `读不到目录 ${schemaDir}`);
  }
  if (files.length === 0) {
    fail("schemas", "docs/schemas/v2 下没有 .json 文件");
  } else {
    const broken: string[] = [];
    const parsed = new Map<string, unknown>();
    for (const f of files) {
      try {
        parsed.set(f, JSON.parse(readFileSync(join(schemaDir, f), "utf8")) as unknown);
      } catch (e) {
        broken.push(`${f}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (broken.length > 0) {
      fail("schemas", `JSON 解析失败 -> ${broken.join(" | ")}`);
    } else {
      ok("schemas", `${files.length} 份 JSON Schema 全部可解析`);
    }

    const opSchema = parsed.get("op.schema.json");
    if (opSchema === undefined) {
      fail("op-schema", "docs/schemas/v2/op.schema.json 不存在");
    } else {
      const branchOps = new Set(collectOpConsts(opSchema));
      if (!sameSet(branchOps, new Set<string>(OP_NAMES))) {
        fail(
          "op-schema",
          `分支与 OP_NAMES 不一致：schema 独有=[${onlyIn(branchOps, new Set<string>(OP_NAMES)).join(",")}] code 独有=[${onlyIn(new Set<string>(OP_NAMES), branchOps).join(",")}]`,
        );
      } else if (branchOps.size !== 13) {
        fail("op-schema", `op.schema.json 的 op 分支数为 ${branchOps.size}，应为 13`);
      } else {
        ok("op-schema", `13 个分支覆盖 13 个 op：${[...branchOps].join(", ")}`);
      }
    }
  }
}

/** 递归收集 schema 里 properties.op.const 的字面值（兼容 oneOf / $defs / 嵌套结构） */
function collectOpConsts(node: unknown, out: string[] = []): string[] {
  if (node === null || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const v of node) collectOpConsts(v, out);
    return out;
  }
  const obj = node as Record<string, unknown>;
  const props = obj["properties"];
  if (props !== null && typeof props === "object" && !Array.isArray(props)) {
    const op = (props as Record<string, unknown>)["op"];
    if (op !== null && typeof op === "object" && !Array.isArray(op)) {
      const c = (op as Record<string, unknown>)["const"];
      if (typeof c === "string") out.push(c);
    }
  }
  for (const v of Object.values(obj)) collectOpConsts(v, out);
  return out;
}

// ---------------------------------------------------------------- 5 接口骨架（字段级）
{
  const typesSrc = readFileSync(join(ROOT, "packages/shared/src/contract/types.ts"), "utf8");
  const section = (heading: string): string => {
    const at = doc.indexOf(heading);
    if (at === -1) return "";
    const rest = doc.slice(doc.indexOf("\n", at) + 1);
    const end = rest.search(/^### |^## /m);
    return end === -1 ? rest : rest.slice(0, end);
  };

  // 5.1 Store 的每个成员都必须在 §2.9 出现（防"代码加了 flush、文档没加"，Issue #1 复审 MAJOR-3）
  const storeMembers = interfaceMembers(typesSrc, "Store");
  const storeDoc = section("### 2.9");
  const missingStore = [...storeMembers].filter((m) => !storeDoc.includes(`${m}(`));
  if (storeMembers.size === 0) {
    fail("store-shape", "types.ts 里解析不到 interface Store");
  } else if (missingStore.length > 0) {
    fail("store-shape", `§2.9 缺少成员：${missingStore.join(",")}`);
  } else {
    ok("store-shape", `Store ${storeMembers.size} 个成员在 §2.9 全部出现`);
  }

  // 5.2 TurnEvent 的每个分支都必须在 §2.4 出现（含 turn.rejected）
  const turnEvents = new Set(
    [...typesSrc.matchAll(/\|\s*\{\s*type:\s*"(turn\.[a-z]+)"/g)].map((m) => m[1] ?? ""),
  );
  const turnDoc = section("### 2.4");
  const missingEvents = [...turnEvents].filter((t) => !turnDoc.includes(`"${t}"`));
  if (turnEvents.size === 0) {
    fail("turn-events", "types.ts 里解析不到 TurnEvent 分支");
  } else if (missingEvents.length > 0) {
    fail("turn-events", `§2.4 缺少分支：${missingEvents.join(",")}`);
  } else {
    ok("turn-events", `${turnEvents.size} 个分支在 §2.4 全部出现`);
  }

  // 5.3 整批失败形状（error）与持久化纪律必须在文档里写清楚
  const required = ["ApplyResult", "error?", "load(roomId", "写盘先行"];
  const missingDoc = required.filter((k) => !doc.includes(k));
  if (missingDoc.length > 0) {
    fail("apply-error", `03 缺少说明：${missingDoc.join(",")}`);
  } else {
    ok("apply-error", "整批失败(error)/load()/写盘先行 已在 §2.3、§2.9 说明");
  }
}

/** 从 `export interface X { ... }` 里提取成员名（方法或字段，忽略注释/嵌套） */
function interfaceMembers(src: string, name: string): Set<string> {
  const at = src.search(new RegExp(`export interface ${name}\\b[^{]*\\{`));
  if (at === -1) return new Set();
  const start = src.indexOf("{", at);
  let depth = 0;
  let end = start;
  for (let i = start; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = src.slice(start + 1, end);
  const out = new Set<string>();
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (t.startsWith("*") || t.startsWith("//") || t.startsWith("/*")) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\??\s*\(/.exec(t) ?? /^([A-Za-z_][A-Za-z0-9_]*)\??\s*:/.exec(t);
    if (m?.[1]) out.add(m[1]);
  }
  return out;
}

// ---------------------------------------------------------------- 汇总
if (failures.length > 0) {
  for (const f of failures) console.error(f);
  console.error(`\n契约体检未通过：${failures.length} 项失败（CONTRACT_VERSION=${CONTRACT_VERSION}）`);
  process.exit(1);
}
console.log(`\n全部通过：8 项契约检查（CONTRACT_VERSION=${CONTRACT_VERSION}）`);
