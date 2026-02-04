// src/context/types.ts

import type { SessionEntry } from "../config/sessions/types.js";

/**
 * 值得性评分结果
 */
export type WorthinessScore = {
  score: number;              // 0-100
  reasons: string[];          // 得分原因
  urgent: boolean;            // 是否紧急
  breakdown: {
    tokenUsage: number;       // Token 使用率得分
    messageCount: number;     // 消息数得分
    timeSince: number;        // 时间间隔得分
    activity: number;         // 活跃度得分
    patternChange: number;    // 模式变化得分
  };
};

/**
 * 维护配置
 */
export type MaintenanceConfig = {
  enabled: boolean;
  scanIntervalMs: number;     // 扫描间隔（默认 5 分钟）
  thresholds: {
    urgent: number;           // 紧急阈值（默认 70）
    high: number;             // 高优先级（默认 50）
    medium: number;           // 中优先级（默认 30）
  };
  weights: {
    tokenUsage: number;       // Token 权重（默认 40）
    messageCount: number;     // 消息数权重（默认 30）
    timeSince: number;        // 时间权重（默认 15）
    activity: number;         // 活跃度权重（默认 10）
    patternChange: number;    // 模式变化权重（默认 5）
  };
};

/**
 * 维护结果
 */
export type MaintenanceResult = {
  ok: boolean;
  sessionKey: string;
  action: "compacted" | "skipped" | "failed";
  reason?: string;
  before?: {
    totalTokens: number;
    compactionCount: number;
  };
  after?: {
    totalTokens: number;
    compactionCount: number;
  };
  savedTokens?: number;
};

/**
 * 主题聚类（预留，未来扩展）
 */
export type ContextCluster = {
  name: string;
  messageIndices: number[];
  centroid?: number[];
  score?: number;
};

/**
 * SessionEntry 扩展（维护元数据）
 */
export type SessionMaintenanceMetadata = {
  lastRun?: number;           // 上次整理时间
  lastScore?: number;         // 上次评分
  summary?: string;           // 历史摘要
  clusterCount?: number;      // 聚类数（预留）
};

// 默认配置
export const DEFAULT_MAINTENANCE_CONFIG: MaintenanceConfig = {
  enabled: true,
  scanIntervalMs: 5 * 60 * 1000,  // 5 分钟
  thresholds: {
    urgent: 70,
    high: 50,
    medium: 30,
  },
  weights: {
    tokenUsage: 40,
    messageCount: 30,
    timeSince: 15,
    activity: 10,
    patternChange: 5,
  },
};
