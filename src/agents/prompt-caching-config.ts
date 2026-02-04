/**
 * Prompt Caching Configuration
 * 
 * Centralized configuration for Anthropic Prompt Caching feature.
 * This module provides configuration resolution and defaults.
 */

import type { OpenClawConfig } from "../config/config.js";
import { resolveCacheConfig, type CacheConfig } from "./prompt-cache-formatter.js";

/**
 * Resolve prompt caching configuration for an agent
 */
export function resolvePromptCachingConfig(
  cfg: OpenClawConfig,
  agentId?: string,
): CacheConfig {
  // 1. Check agent-specific configuration
  if (agentId) {
    const agent = cfg.agents?.list?.find((a) => a.id === agentId);
    if (agent && "promptCaching" in agent) {
      return resolveCacheConfig(agent.promptCaching as string | CacheConfig);
    }
  }

  // 2. Check global defaults
  const defaults = cfg.agents?.defaults;
  if (defaults && "promptCaching" in defaults) {
    return resolveCacheConfig(defaults.promptCaching as string | CacheConfig);
  }

  // 3. Environment variable
  const envValue = process.env.OPENCLAW_PROMPT_CACHING;
  if (envValue) {
    return resolveCacheConfig(envValue);
  }

  // 4. Default: aggressive caching
  return resolveCacheConfig("aggressive");
}

/**
 * Check if prompt caching should be used for a specific provider/model
 */
export function shouldUsePromptCaching(params: {
  cfg: OpenClawConfig;
  provider: string;
  model: string;
  agentId?: string;
}): boolean {
  // Only Anthropic supports prompt caching currently
  if (params.provider.toLowerCase() !== "anthropic") {
    return false;
  }

  const config = resolvePromptCachingConfig(params.cfg, params.agentId);
  return config.enabled;
}
