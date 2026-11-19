// 由 docs/03-接口总表.md §7 + §10.3 生成（生成时间 2026-11-14）
// 改错代码：先改文档，再改这里；两边必须一致（scripts/check-contract.ts 会校验）

export const ERROR_CODES = [
  "E_ATTR_UNKNOWN",
  "E_BUDGET",
  "E_CANON_LOCKED",
  "E_CONTENT_BLOCKED",
  "E_DIALOGUE_NOT_FOUND",
  "E_ENTITY_MISSING",
  "E_FORBIDDEN",
  "E_IDEMPOTENT",
  "E_ID_TAKEN",
  "E_ILLEGAL_OP",
  "E_LLM_FORMAT",
  "E_LLM_TIMEOUT",
  "E_MEMORY_IMMUTABLE",
  "E_MEMORY_TAINT",
  "E_MEMORY_WORLD_MISMATCH",
  "E_MODULE_FAULT",
  "E_NOT_ADJACENT",
  "E_NOT_IN_ROOM",
  "E_OUT_OF_RANGE",
  "E_OVER_LIMIT",
  "E_PRECONDITION",
  "E_QUOTA_EXCEEDED",
  "E_RATE_LIMITED",
  "E_REF_IN_USE",
  "E_REF_NOT_FOUND",
  "E_ROOM_FULL",
  "E_ROOM_NOT_FOUND",
  "E_SCENE_NOT_FOUND",
  "E_SCHEMA_INVALID",
  "E_SEQ_GAP",
  "E_AUDIT_UNAVAILABLE",
  "E_STORE_FAULT",
  "E_TOOL_UNKNOWN",
  "E_TURN_BUSY",
  "E_UNAUTHORIZED",
  "E_X_LIMIT",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export function isErrorCode(x: unknown): x is ErrorCode {
  return typeof x === "string" && (ERROR_CODES as readonly string[]).includes(x);
}

/** 可重试的错误（网络抖动、模型空响应）——前端/引擎可以自动重试一次 */
export const RETRYABLE: readonly ErrorCode[] = [
  "E_LLM_TIMEOUT",
  "E_LLM_FORMAT",
  "E_RATE_LIMITED",
];
