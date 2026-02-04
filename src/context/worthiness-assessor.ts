// src/context/worthiness-assessor.ts

import type { SessionEntry } from "../config/sessions/types.js";
import type { OpenClawConfig } from "../config/config.js";
import { DEFAULT_MAINTENANCE_CONFIG, type WorthinessScore } from "./types.js";

/**
 * 评估会话是否值得整理
 */
export function assessWorthiness(
  session: SessionEntry,
  config: OpenClawConfig,
): WorthinessScore {
  const weights = DEFAULT_MAINTENANCE_CONFIG.weights;
  
  const tokenScore = assessTokenUsage(session, config);
  const messageScore = assessMessageCount(session);
  const timeScore = assessTimeSince(session);
  const activityScore = 0;  // 预留
  const patternScore = 0;   // 预留
  
  const totalScore = 
    tokenScore * weights.tokenUsage / 100 +
    messageScore * weights.messageCount / 100 +
    timeScore * weights.timeSince / 100 +
    activityScore * weights.activity / 100 +
    patternScore * weights.patternChange / 100;
  
  const reasons = [];
  if (tokenScore > 0.5) reasons.push(`Token 使用率高 (${Math.round(tokenScore * 100)}%)`);
  if (messageScore > 0.5) reasons.push("消息数过多");
  if (timeScore > 0.5) reasons.push("长时间未整理");
  
  return {
    score: Math.round(totalScore),
    reasons,
    urgent: totalScore >= DEFAULT_MAINTENANCE_CONFIG.thresholds.urgent,
    breakdown: {
      tokenUsage: tokenScore * weights.tokenUsage / 100,
      messageCount: messageScore * weights.messageCount / 100,
      timeSince: timeScore * weights.timeSince / 100,
      activity: activityScore * weights.activity / 100,
      patternChange: patternScore * weights.patternChange / 100,
    },
  };
}

/**
 * 评估 Token 使用率（0-1）
 */
function assessTokenUsage(session: SessionEntry, config: OpenClawConfig): number {
  const totalTokens = session.totalTokens || 0;
  if (totalTokens === 0) return 0;
  
  // 获取模型的 token budget（简化版，假设 100k）
  const budget = 100_000;  // TODO: 从 model 配置获取
  
  const usage = totalTokens / budget;
  
  if (usage > 0.9) return 1.0;   // 90%+ → 满分
  if (usage > 0.8) return 0.75;  // 80-90% → 高分
  if (usage > 0.7) return 0.5;   // 70-80% → 中等
  if (usage > 0.5) return 0.25;  // 50-70% → 低分
  return 0;                       // <50% → 0 分
}

/**
 * 评估消息数（0-1）
 */
function assessMessageCount(session: SessionEntry): number {
  // 注：实际消息数需要从 session file 读取
  // 这里简化处理，使用 compactionCount 作为代理指标
  const compactionCount = session.compactionCount || 0;
  
  // 压缩次数越多，说明消息越多
  if (compactionCount > 5) return 1.0;
  if (compactionCount > 3) return 0.75;
  if (compactionCount > 1) return 0.5;
  if (compactionCount > 0) return 0.25;
  return 0;
}

/**
 * 评估距上次整理时间（0-1）
 */
function assessTimeSince(session: SessionEntry): number {
  const lastMaintenance = session.contextMaintenance?.lastRun || session.updatedAt;
  const hoursSince = (Date.now() - lastMaintenance) / (60 * 60 * 1000);
  
  if (hoursSince > 12) return 1.0;   // 12h+ → 满分
  if (hoursSince > 6) return 0.75;   // 6-12h → 高分
  if (hoursSince > 3) return 0.5;    // 3-6h → 中等
  if (hoursSince > 1) return 0.25;   // 1-3h → 低分
  return 0;                           // <1h → 0 分
}

/**
 * 检测模式变化（简化版，预留扩展）
 */
function detectPatternChange(session: SessionEntry): boolean {
  // TODO: 实现模式检测
  // 需要读取 session file 的历史消息
  return false;
}
