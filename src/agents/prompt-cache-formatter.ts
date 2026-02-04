/**
 * Prompt Cache Formatter for Anthropic API
 * 
 * Formats messages with cache_control markers to enable Prompt Caching,
 * reducing costs by 60-70% for repeated content.
 * 
 * Official docs: https://docs.anthropic.com/claude/docs/prompt-caching
 */

export type CacheableMessage = {
  role: "user" | "assistant";
  content: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
  cache_control?: { type: "ephemeral" };
};

export type CacheableSystemPrompt = Array<{
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}>;

export type CacheStrategy = "aggressive" | "conservative" | "disabled";

export type CacheConfig = {
  enabled: boolean;
  strategy: CacheStrategy;
  minHistoryForCache: number; // Minimum history messages before caching
};

/**
 * Resolve cache configuration from environment or config
 */
export function resolveCacheConfig(
  configValue?: string | CacheConfig,
): CacheConfig {
  // Check environment variable
  const envValue = process.env.OPENCLAW_PROMPT_CACHING;
  if (envValue === "0" || envValue === "disabled") {
    return {
      enabled: false,
      strategy: "disabled",
      minHistoryForCache: 0,
    };
  }

  const envStrategy = envValue as CacheStrategy | undefined;
  if (envStrategy === "conservative" || envStrategy === "aggressive") {
    return {
      enabled: true,
      strategy: envStrategy,
      minHistoryForCache: envStrategy === "conservative" ? 5 : 2,
    };
  }

  // Parse config value
  if (typeof configValue === "string") {
    if (configValue === "disabled") {
      return { enabled: false, strategy: "disabled", minHistoryForCache: 0 };
    }
    return {
      enabled: true,
      strategy: (configValue as CacheStrategy) || "aggressive",
      minHistoryForCache: configValue === "conservative" ? 5 : 2,
    };
  }

  if (configValue && typeof configValue === "object") {
    return {
      enabled: configValue.enabled ?? true,
      strategy: configValue.strategy ?? "aggressive",
      minHistoryForCache: configValue.minHistoryForCache ?? 2,
    };
  }

  // Default: aggressive caching
  return {
    enabled: true,
    strategy: "aggressive",
    minHistoryForCache: 2,
  };
}

/**
 * Format system prompt with cache control
 */
export function formatSystemPromptWithCaching(
  systemPrompt: string,
  enabled: boolean,
): CacheableSystemPrompt {
  if (!enabled) {
    return [{ type: "text", text: systemPrompt }];
  }

  return [
    {
      type: "text",
      text: systemPrompt,
      cache_control: { type: "ephemeral" },
    },
  ];
}

/**
 * Format messages with cache control markers
 * 
 * Strategy:
 * - aggressive: Cache all messages except the last 1-2
 * - conservative: Cache all messages except the last 3-5
 * - disabled: No caching
 */
export function formatMessagesWithCaching(params: {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  config: CacheConfig;
}): CacheableMessage[] {
  const { messages, config } = params;

  if (!config.enabled || config.strategy === "disabled") {
    return messages;
  }

  // Don't cache if history is too short
  if (messages.length < config.minHistoryForCache) {
    return messages;
  }

  // Determine how many recent messages to NOT cache
  const recentThreshold = config.strategy === "aggressive" ? 1 : 3;

  return messages.map((msg, index) => {
    const isRecentMessage = index >= messages.length - recentThreshold;

    // Don't cache recent messages (they change frequently)
    if (isRecentMessage) {
      return msg;
    }

    // Cache older messages
    return {
      ...msg,
      cache_control: { type: "ephemeral" },
    };
  });
}

/**
 * Format complete prompt with caching (system + messages)
 */
export function formatPromptWithCaching(params: {
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  config: CacheConfig;
}): {
  system: CacheableSystemPrompt;
  messages: CacheableMessage[];
} {
  return {
    system: formatSystemPromptWithCaching(params.systemPrompt, params.config.enabled),
    messages: formatMessagesWithCaching({
      messages: params.messages,
      config: params.config,
    }),
  };
}

/**
 * Estimate cache savings for a request
 */
export function estimateCacheSavings(params: {
  systemPromptTokens: number;
  cachedMessageTokens: number;
  newMessageTokens: number;
  model: string;
  isFirstRequest: boolean;
}): {
  withoutCache: number;
  withCache: number;
  savings: number;
  savingsPercent: number;
} {
  // Pricing per 1M tokens (simplified)
  const pricing: Record<
    string,
    { input: number; systemCacheRead: number; messageCacheRead: number }
  > = {
    "claude-haiku-4": {
      input: 0.25,
      systemCacheRead: 0.025,
      messageCacheRead: 0.125,
    },
    "claude-sonnet-4": {
      input: 3.0,
      systemCacheRead: 0.3,
      messageCacheRead: 1.5,
    },
    "claude-sonnet-4-5": {
      input: 15.0,
      systemCacheRead: 1.5,
      messageCacheRead: 7.5,
    },
    "claude-opus-4-5": {
      input: 15.0,
      systemCacheRead: 1.5,
      messageCacheRead: 7.5,
    },
  };

  const price = pricing[params.model] ?? pricing["claude-sonnet-4"];
  const totalTokens =
    params.systemPromptTokens + params.cachedMessageTokens + params.newMessageTokens;

  const withoutCache = (totalTokens * price.input) / 1_000_000;

  // First request: write cache (same cost as no cache)
  if (params.isFirstRequest) {
    return {
      withoutCache,
      withCache: withoutCache,
      savings: 0,
      savingsPercent: 0,
    };
  }

  // Subsequent requests: read from cache
  const withCache =
    (params.systemPromptTokens * price.systemCacheRead) / 1_000_000 +
    (params.cachedMessageTokens * price.messageCacheRead) / 1_000_000 +
    (params.newMessageTokens * price.input) / 1_000_000;

  const savings = withoutCache - withCache;
  const savingsPercent = withoutCache > 0 ? (savings / withoutCache) * 100 : 0;

  return {
    withoutCache,
    withCache,
    savings,
    savingsPercent,
  };
}

/**
 * Check if a provider supports prompt caching
 */
export function providerSupportsPromptCaching(provider: string): boolean {
  const normalized = provider.toLowerCase();
  return normalized === "anthropic";
}
