// src/context/maintenance-worker.ts

import type { OpenClawConfig } from "../config/config.js";
import type { SessionEntry } from "../config/sessions/types.js";
import { loadSessionStore, updateSessionStore, resolveStorePath } from "../config/sessions/store.js";
import { compactEmbeddedPiSession } from "../agents/pi-embedded-runner/compact.js";
import { resolveOpenClawAgentDir } from "../agents/agent-paths.js";
import { assessWorthiness } from "./worthiness-assessor.js";
import { DEFAULT_MAINTENANCE_CONFIG, type MaintenanceResult } from "./types.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("context/maintenance");

export class ContextMaintenanceWorker {
  constructor(
    private config: OpenClawConfig,
    private workspaceDir: string,
  ) {}

  /**
   * 轻量级扫描所有会话
   */
  async scan(): Promise<Array<{ session: SessionEntry; sessionKey: string; score: number }>> {
    const storePath = resolveStorePath(this.workspaceDir);
    const store = await loadSessionStore(storePath);
    
    const results = [];
    
    for (const [sessionKey, session] of Object.entries(store)) {
      if (!session || !session.sessionFile) continue;
      
      const assessment = assessWorthiness(session, this.config);
      
      if (assessment.score >= DEFAULT_MAINTENANCE_CONFIG.thresholds.medium) {
        results.push({
          session,
          sessionKey,
          score: assessment.score,
        });
        
        log(
          `[Scan] ${sessionKey}: score=${assessment.score}, ` +
          `urgent=${assessment.urgent}, reasons=${assessment.reasons.join(", ")}`
        );
      }
    }
    
    // 按评分排序（高优先级优先）
    results.sort((a, b) => b.score - a.score);
    
    return results;
  }

  /**
   * 执行整理
   */
  async maintain(sessionKey: string, session: SessionEntry): Promise<MaintenanceResult> {
    log(`[Maintain] 开始整理 ${sessionKey}`);
    
    const before = {
      totalTokens: session.totalTokens || 0,
      compactionCount: session.compactionCount || 0,
    };
    
    try {
      // 复用现有的 compaction API
      const result = await compactEmbeddedPiSession({
        sessionId: session.sessionId,
        sessionFile: session.sessionFile!,
        workspaceDir: this.workspaceDir,
        agentDir: resolveOpenClawAgentDir(),
        config: this.config,
        provider: session.modelProvider || session.providerOverride,
        model: session.model || session.modelOverride,
      });
      
      if (!result.ok) {
        log(`[Maintain] 整理失败 ${sessionKey}: ${result.reason}`);
        return {
          ok: false,
          sessionKey,
          action: "failed",
          reason: result.reason,
        };
      }
      
      if (!result.compacted) {
        log(`[Maintain] 跳过整理 ${sessionKey}: ${result.reason}`);
        return {
          ok: true,
          sessionKey,
          action: "skipped",
          reason: result.reason,
        };
      }
      
      // 更新元数据
      await this.updateMetadata(sessionKey, session, result);
      
      const after = {
        totalTokens: result.inputTokens || before.totalTokens,
        compactionCount: result.compactionCount || before.compactionCount,
      };
      
      const savedTokens = before.totalTokens - after.totalTokens;
      
      log(
        `[Maintain] 完成整理 ${sessionKey}: ` +
        `节省 ${savedTokens} tokens (${before.totalTokens} → ${after.totalTokens})`
      );
      
      return {
        ok: true,
        sessionKey,
        action: "compacted",
        before,
        after,
        savedTokens,
      };
      
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log(`[Maintain] 异常 ${sessionKey}: ${error}`);
      
      return {
        ok: false,
        sessionKey,
        action: "failed",
        reason: error,
      };
    }
  }

  /**
   * 更新维护元数据
   */
  private async updateMetadata(
    sessionKey: string,
    session: SessionEntry,
    compactionResult: any,
  ): Promise<void> {
    const assessment = assessWorthiness(session, this.config);
    
    const storePath = resolveStorePath(this.workspaceDir);
    
    await updateSessionStore({
      [sessionKey]: {
        ...session,
        totalTokens: compactionResult.inputTokens,
        compactionCount: compactionResult.compactionCount,
        contextMaintenance: {
          lastRun: Date.now(),
          lastScore: assessment.score,
          // summary: ...,  // 预留
        },
      },
    }, storePath);
  }
}
