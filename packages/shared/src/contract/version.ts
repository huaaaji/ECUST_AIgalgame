/** 契约版本：与 docs/03-接口总表.md 顶部一致；scripts/check-contract.ts 会校验 */
export const CONTRACT_VERSION = "3.6.0" as const;
export const SCHEMA_VERSION = 2 as const;
export const API_VERSION = 3 as const;
/** 提示词版本：改 docs/prompts/* 必须 bump（KV 缓存前缀） */
export const PROMPT_VERSION = "2026-11-18.1" as const;
/**
 * 世界层永久记忆的内容版本：canonize / tombstone 之后由 server 重算并持久化到
 * data/worlds/<worldId>/mem.version。它是**数据版本**，与 PROMPT_VERSION 分开：
 * 世界层条目变化 → bump 它（缓存前缀里的 S1.5 段随之失效）。
 */
export const WORLD_MEM_VERSION = 1 as const;
