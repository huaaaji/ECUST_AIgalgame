/**
 * zod schema：Module manifest（content/modules/<id>/manifest.json）
 * 真源：contract/types.ts 的 ModuleManifest / Capabilities；这里是"文件入口处解析一次"的边界 schema。
 * 注意：JSON Schema 版更严（additionalProperties:false）；zod 默认丢弃未知键，不报错。
 */
import { z } from "zod";
import { IdSchema, PhaseSchema } from "./entity.ts";

export const CostWeightSchema = z
  .number()
  .min(0)
  .max(100)
  .describe("成本权重：调度时的相对代价，越大越后跑（0=免费）");

export const ModuleBudgetSchema = z
  .object({
    maxLlmCallsPerRoomHour: z
      .number()
      .int()
      .min(0)
      .describe("每房间每小时的 LLM 调用上限；0=不调用，超限回 E_BUDGET"),
    maxTokensPerTurn: z
      .number()
      .int()
      .min(0)
      .describe("单回合 token 预算上限，超限回 E_BUDGET 并降级"),
  })
  .describe("模块自己的资源预算；引擎按此熔断，模块不得自行估算");
export type ModuleBudgetParsed = z.infer<typeof ModuleBudgetSchema>;

export const ModuleLimitsSchema = z
  .object({
    proposalsPerTurn: z.number().int().min(0).describe("单回合最多产出的 Proposal 条数"),
    maxArrayItems: z
      .number()
      .int()
      .min(0)
      .describe("args 里数组字段的最大长度；超限回 E_OVER_LIMIT 并截断"),
  })
  .describe("模块的硬上限；由引擎统一执行（模块不用重复判断）");
export type ModuleLimitsParsed = z.infer<typeof ModuleLimitsSchema>;

export const CapabilitiesSchema = z
  .object({
    intents: z.array(z.string().min(1).max(64)).max(64).optional().describe("能响应的意图名列表"),
    keywords: z.array(z.string().min(1).max(16)).max(24).optional().describe("意图路由关键词（玩家自然语言里的说法）"),
    tools: z.array(z.string().min(1).max(96)).max(64).optional().describe("LLM 工具名：<moduleId>.<verb>"),
    triggers: z.array(PhaseSchema).max(5).optional().describe("在哪些时段被 tick 唤醒"),
    views: z.array(z.string().min(1).max(64)).max(64).optional().describe("能下发的 View 名列表"),
    contentFiles: z.array(z.string().min(1).max(256)).max(256).optional().describe("模块数据文件相对路径"),
  })
  .describe("模块能力声明：引擎按能力路由，不按 moduleId 硬编码（I3 不变量）");
export type CapabilitiesParsed = z.infer<typeof CapabilitiesSchema>;

export const ModuleManifestSchema = z
  .object({
    id: IdSchema.describe("模块 id：小写，正文用下划线；保留命名空间不可用（03 §0.2）"),
    name: z.string().min(1).max(64).describe("显示名（中文可以）"),
    version: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/, "version 必须是 semver，如 1.0.0")
      .describe("模块自身版本（semver），与契约版本无关"),
    apiVersion: z.literal(3).describe("模块 API 版本；引擎只加载与自身 API_VERSION 相同的模块"),
    dependsOn: z.array(IdSchema).max(16).optional().describe("依赖的其它模块 id，加载时拓扑排序"),
    capabilities: CapabilitiesSchema.optional(),
    priority: z
      .number()
      .int()
      .min(0)
      .max(100)
      .describe("同事件多模块的裁决优先级，数值大者先跑（0~100）"),
    costWeight: CostWeightSchema.optional(),
    budget: ModuleBudgetSchema.optional(),
    limits: ModuleLimitsSchema.optional(),
    entryLocations: z.array(IdSchema).max(32).optional().describe("模块内容挂载的地点 id"),
  })
  .describe("模块 manifest：id/version/apiVersion 必填，其余为可选能力与预算声明");
export type ModuleManifestParsed = z.infer<typeof ModuleManifestSchema>;
