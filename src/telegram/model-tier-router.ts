/**
 * Model Tier Router for Telegram
 * 
 * Routes messages to appropriate model tiers based on complexity,
 * enabling significant cost reduction while maintaining quality.
 */

import type { OpenClawConfig } from "../config/config.js";
import type { ModelRef } from "../agents/model-selection.js";
import { analyzeMessageComplexity, type ComplexityScore } from "./message-complexity-analyzer.js";

export type ModelTier = {
  name: "quick" | "standard" | "deep";
  model: ModelRef;
  description: string;
  costPer1M: string;
  useCases: string[];
};

export type TierRoutingConfig = {
  enabled: boolean;
  quick: {
    provider: string;
    model: string;
  };
  standard: {
    provider: string;
    model: string;
  };
  deep: {
    provider: string;
    model: string;
  };
  forceeTier?: "quick" | "standard" | "deep";
};

/**
 * Resolve tier routing configuration from config or defaults
 */
export function resolveTierRoutingConfig(
  cfg: OpenClawConfig,
  accountId?: string,
): TierRoutingConfig {
  // Check environment variable override
  const envDisabled = process.env.OPENCLAW_TELEGRAM_TIER_ROUTING === "0";
  const envForceTier = process.env.OPENCLAW_TELEGRAM_FORCE_TIER as
    | "quick"
    | "standard"
    | "deep"
    | undefined;

  if (envDisabled) {
    return {
      enabled: false,
      quick: { provider: "anthropic", model: "claude-haiku-4" },
      standard: { provider: "anthropic", model: "claude-sonnet-4" },
      deep: { provider: "anthropic", model: "claude-sonnet-4-5" },
    };
  }

  // Check config
  const telegramCfg = cfg.channels?.telegram?.accounts?.[accountId ?? "default"];
  const tierCfg = telegramCfg?.modelTiers as TierRoutingConfig | undefined;

  return {
    enabled: tierCfg?.enabled ?? true, // Enabled by default
    quick: tierCfg?.quick ?? {
      provider: "anthropic",
      model: "claude-haiku-4",
    },
    standard: tierCfg?.standard ?? {
      provider: "anthropic",
      model: "claude-sonnet-4",
    },
    deep: tierCfg?.deep ?? {
      provider: "anthropic",
      model: "claude-sonnet-4-5",
    },
    forceeTier: envForceTier ?? tierCfg?.forceeTier,
  };
}

/**
 * Resolve model tiers with metadata
 */
export function resolveModelTiers(
  cfg: OpenClawConfig,
  accountId?: string,
): {
  quick: ModelTier;
  standard: ModelTier;
  deep: ModelTier;
} {
  const config = resolveTierRoutingConfig(cfg, accountId);

  return {
    quick: {
      name: "quick",
      model: {
        provider: config.quick.provider,
        model: config.quick.model,
      },
      description: "Fast responses for simple queries",
      costPer1M: "$0.25",
      useCases: ["Greetings", "Simple Q&A", "Commands", "Acknowledgments"],
    },
    standard: {
      name: "standard",
      model: {
        provider: config.standard.provider,
        model: config.standard.model,
      },
      description: "General conversations and coding tasks",
      costPer1M: "$3",
      useCases: ["Code explanation", "General questions", "Text processing"],
    },
    deep: {
      name: "deep",
      model: {
        provider: config.deep.provider,
        model: config.deep.model,
      },
      description: "Complex reasoning and analysis",
      costPer1M: "$15",
      useCases: ["Architecture design", "Deep analysis", "Complex problem solving"],
    },
  };
}

/**
 * Select appropriate model tier for a message
 */
export function selectModelForMessage(params: {
  text: string;
  cfg: OpenClawConfig;
  accountId?: string;
  context?: {
    hasHistory?: boolean;
    hasMedia?: boolean;
    isCommand?: boolean;
    historyLength?: number;
  };
}): {
  tier: ModelTier;
  complexity: ComplexityScore;
  config: TierRoutingConfig;
} {
  const config = resolveTierRoutingConfig(params.cfg, params.accountId);
  const tiers = resolveModelTiers(params.cfg, params.accountId);

  // If tier routing is disabled, always use deep tier
  if (!config.enabled) {
    const complexity = analyzeMessageComplexity(params.text, params.context);
    return {
      tier: tiers.deep,
      complexity,
      config,
    };
  }

  // If force tier is set, use it
  if (config.forceeTier) {
    const complexity = analyzeMessageComplexity(params.text, params.context);
    return {
      tier: tiers[config.forceeTier],
      complexity,
      config,
    };
  }

  // Analyze complexity and select tier
  const complexity = analyzeMessageComplexity(params.text, params.context);
  const tier = tiers[complexity.tier];

  return {
    tier,
    complexity,
    config,
  };
}

/**
 * Format tier selection for logging
 */
export function formatTierSelection(params: {
  tier: ModelTier;
  complexity: ComplexityScore;
  text: string;
}): string {
  const preview = params.text.slice(0, 50).replace(/\n/g, " ");
  return (
    `[Tier: ${params.tier.name}] ` +
    `complexity=${params.complexity.score.toFixed(2)} ` +
    `intent=${params.complexity.factors.intent} ` +
    `model=${params.tier.model.provider}/${params.tier.model.model} ` +
    `text="${preview}${params.text.length > 50 ? "..." : ""}"`
  );
}
