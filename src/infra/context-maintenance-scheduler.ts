// src/infra/context-maintenance-scheduler.ts

import type { OpenClawConfig } from "../config/config.js";
import { resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import { loadConfig } from "../config/config.js";
import { ContextMaintenanceWorker } from "../context/maintenance-worker.js";
import { DEFAULT_MAINTENANCE_CONFIG } from "../context/types.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("infra/context-maintenance");

/**
 * 执行上下文维护
 */
export async function runContextMaintenance(): Promise<void> {
  log.info("[Scan] 开始扫描...");

  const config = await loadConfig();
  const workspaceDir = resolveAgentWorkspaceDir(config);

  const worker = new ContextMaintenanceWorker(config, workspaceDir);

  try {
    // 优先处理事件驱动的 pending 队列（低成本、及时）
    const pending = await worker.scanPending();
    if (pending.length > 0) {
      log.info(`[Scan] pending 队列: ${pending.length} 个会话`);
    }

    // 兼容旧逻辑：仍可做轻量扫描（用于兜底）
    const sessions = pending.length > 0 ? pending : await worker.scan();

    log.info(`[Scan] 发现 ${sessions.length} 个需要整理的会话`);

    if (sessions.length === 0) {
      log.info("[Scan] 无需整理，跳过");
      return;
    }

    // 处理紧急会话
    const urgent = sessions.filter((s) => s.score >= DEFAULT_MAINTENANCE_CONFIG.thresholds.urgent);

    for (const { sessionKey, session } of urgent) {
      log.info(`[Urgent] 整理 ${sessionKey} (score=${session.score})`);
      await worker.maintain(sessionKey, session);
    }

    // 处理高优先级（限制数量，避免阻塞）
    const high = sessions
      .filter(
        (s) =>
          s.score >= DEFAULT_MAINTENANCE_CONFIG.thresholds.high &&
          s.score < DEFAULT_MAINTENANCE_CONFIG.thresholds.urgent,
      )
      .slice(0, 5); // 每轮最多 5 个

    for (const { sessionKey, session } of high) {
      log.info(`[High] 整理 ${sessionKey} (score=${session.score})`);
      await worker.maintain(sessionKey, session);
    }

    log.info(`[Scan] 完成，处理了 ${urgent.length + high.length} 个会话`);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error(`[Error] 维护失败: ${error}`);
  }
}

/**
 * 启动上下文维护定时器
 *
 * 使用 setInterval 而不是 cron，因为这是后台维护任务，不需要会话交互
 */
export function startContextMaintenanceTimer(): ReturnType<typeof setInterval> {
  const intervalMs = DEFAULT_MAINTENANCE_CONFIG.scanIntervalMs;

  log.info(`[Timer] 启动定时器，间隔 ${intervalMs / 1000 / 60} 分钟`);

  // 防止并发重入：如果一次维护超过 interval（或卡住），下一轮直接跳过。
  let running = false;
  const runOnce = async (label: string): Promise<void> => {
    if (running) {
      log.warn(`[Timer] 跳过本轮（上一轮仍在运行）: ${label}`);
      return;
    }
    running = true;
    try {
      await runContextMaintenance();
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.error(`[Error] ${label}失败: ${error}`);
    } finally {
      running = false;
    }
  };

  // 立即执行一次
  void runOnce("初始扫描");

  // 定时执行
  const timer = setInterval(() => {
    void runOnce("定时扫描");
  }, intervalMs);

  return timer;
}
