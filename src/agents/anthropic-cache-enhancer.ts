/**
 * Anthropic Cache Enhancer
 * 
 * Runtime enhancement layer that intercepts Anthropic API calls
 * and adds cache_control markers for Prompt Caching.
 * 
 * This is a workaround until pi-ai library officially supports caching.
 */

import type { OpenClawConfig } from "../config/config.js";
import { formatPromptWithCaching } from "./prompt-cache-formatter.js";
import { resolvePromptCachingConfig } from "./prompt-caching-config.js";
import { logVerbose } from "../globals.js";

/**
 * Enhance Anthropic API request with cache_control
 * 
 * This function wraps the API call and injects cache markers
 * if the provider is Anthropic and caching is enabled.
 */
export function enhanceAnthropicRequestWithCaching(params: {
  provider: string;
  model: string;
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  cfg: OpenClawConfig;
  agentId?: string;
}): {
  systemPrompt: string | Array<{ type: string; text: string; cache_control?: unknown }>;
  messages: Array<{ role: string; content: string; cache_control?: unknown }>;
  cachingEnabled: boolean;
} {
  // Only enhance Anthropic requests
  if (params.provider.toLowerCase() !== "anthropic") {
    return {
      systemPrompt: params.systemPrompt,
      messages: params.messages,
      cachingEnabled: false,
    };
  }

  const cacheConfig = resolvePromptCachingConfig(params.cfg, params.agentId);

  if (!cacheConfig.enabled) {
    return {
      systemPrompt: params.systemPrompt,
      messages: params.messages,
      cachingEnabled: false,
    };
  }

  // Format with caching
  const { system, messages } = formatPromptWithCaching({
    systemPrompt: params.systemPrompt,
    messages: params.messages,
    config: cacheConfig,
  });

  logVerbose(
    `[Cache] Enhanced Anthropic request: strategy=${cacheConfig.strategy}, ` +
      `system_cached=true, messages=${messages.length}, ` +
      `cached_messages=${messages.filter((m) => m.cache_control).length}`,
  );

  return {
    systemPrompt: system as unknown as string,
    messages: messages as Array<{ role: string; content: string; cache_control?: unknown }>,
    cachingEnabled: true,
  };
}

/**
 * Check if caching should be applied
 */
export function shouldApplyCaching(params: {
  provider: string;
  cfg: OpenClawConfig;
  agentId?: string;
}): boolean {
  if (params.provider.toLowerCase() !== "anthropic") {
    return false;
  }

  const config = resolvePromptCachingConfig(params.cfg, params.agentId);
  return config.enabled;
}
