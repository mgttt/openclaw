// src/infra/context-maintenance-scheduler.ts

import type { OpenClawConfig } from "../config/config.js";
import { loadConfig } from "../config/config.js";
import { ContextMaintenanceWorker } from "../context/maintenance-worker.js";
import { DEFAULT_MAINTENANCE_CONFIG } from "../context/types.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveAgentWorkspaceDir } from "../agents/agent-scope.js";

const log = createSubsystemLogger("infra/context-maintenance");

/**
 * 执行上下文维护
 */
export async function runContextMaintenance(): Promise<void> {
  log("[Scan] 开始扫描...");
  
  const config = await loadConfig();
  const workspaceDir = resolveAgentWorkspaceDir(config);
  
  const worker = new ContextMaintenanceWorker(config, workspaceDir);
  
  try {
    // 轻量级扫描
    const sessions = await worker.scan();
    
    log(`[Scan] 发现 ${sessions.length} 个需要整理的会话`);
    
    if (sessions.length === 0) {
      log("[Scan] 无需整理，跳过");
      return;
    }
    
    // 处理紧急会话
    const urgent = sessions.filter(s => s.score >= DEFAULT_MAINTENANCE_CONFIG.thresholds.urgent);
    
    for (const { sessionKey, session } of urgent) {
      log(`[Urgent] 整理 ${sessionKey} (score=${session.score})`);
      await worker.maintain(sessionKey, session);
    }
    
    // 处理高优先级（限制数量，避免阻塞）
    const high = sessions
      .filter(s => 
        s.score >= DEFAULT_MAINTENANCE_CONFIG.thresholds.high &&
        s.score < DEFAULT_MAINTENANCE_CONFIG.thresholds.urgent
      )
      .slice(0, 5);  // 每轮最多 5 个
    
    for (const { sessionKey, session } of high) {
      log(`[High] 整理 ${sessionKey} (score=${session.score})`);
      await worker.maintain(sessionKey, session);
    }
    
    log(`[Scan] 完成，处理了 ${urgent.length + high.length} 个会话`);
    
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log(`[Error] 维护失败: ${error}`);
  }
}

/**
 * 注册 Cron 任务
 */
export function registerContextMaintenanceCron(cron: any): void {
  const intervalMs = DEFAULT_MAINTENANCE_CONFIG.scanIntervalMs;
  
  cron.add({
    name: "context-maintenance-scan",
    schedule: { 
      kind: "every", 
      everyMs: intervalMs 
    },
    sessionTarget: "main",
    payload: {
      kind: "systemEvent",
      text: "执行上下文维护扫描"
    }
  });
  
  log(`[Cron] 已注册，间隔 ${intervalMs / 1000 / 60} 分钟`);
}
