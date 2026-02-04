/**
 * Message Complexity Analyzer for Telegram
 * 
 * Analyzes incoming messages to determine their complexity level,
 * enabling intelligent model tier routing.
 */

export type ComplexityScore = {
  score: number; // 0-1
  factors: {
    length: number;
    keywords: number;
    context: number;
    intent: string;
  };
  tier: "quick" | "standard" | "deep";
  reason: string;
};

const GREETINGS = [
  "你好", "您好", "嗨", "hi", "hello", "hey", "嘿",
  "早上好", "晚上好", "下午好",
  "good morning", "good evening", "good afternoon",
];

const SIMPLE_THANKS = [
  "谢谢", "感谢", "多谢", "thanks", "thank you", "thx",
];

const SIMPLE_ACK = [
  "好的", "好", "ok", "okay", "收到", "明白", "知道了",
  "可以", "行", "sure", "got it", "understood",
];

const COMPLEX_KEYWORDS = [
  // 中文
  "设计", "架构", "优化", "分析", "实现", "方案",
  "系统", "算法", "性能", "安全", "部署", "重构",
  "评估", "规划", "策略", "框架", "模式", "原理",
  // English
  "design", "architecture", "optimize", "analyze", "implement",
  "solution", "system", "algorithm", "performance", "security",
  "deploy", "refactor", "evaluate", "plan", "strategy",
  "framework", "pattern", "principle",
];

const SIMPLE_KEYWORDS = [
  // 中文
  "是什么", "怎么", "为什么", "查", "看", "显示",
  "列出", "帮我", "给我", "告诉我",
  // English
  "what", "how", "why", "check", "show", "display",
  "list", "help me", "tell me", "give me",
];

/**
 * Analyze message complexity and determine appropriate model tier
 */
export function analyzeMessageComplexity(
  text: string,
  context?: {
    hasHistory?: boolean;
    hasMedia?: boolean;
    isCommand?: boolean;
    historyLength?: number;
  },
): ComplexityScore {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  
  const factors = {
    length: 0,
    keywords: 0,
    context: 0,
    intent: "unknown",
  };

  // 1. Commands → always quick
  if (context?.isCommand || text.startsWith("/")) {
    return {
      score: 0.05,
      factors: { ...factors, intent: "command" },
      tier: "quick",
      reason: "Command detected",
    };
  }

  // 2. Simple greetings
  if (
    GREETINGS.some((g) => lower === g || lower.includes(g)) &&
    trimmed.length < 20
  ) {
    return {
      score: 0.1,
      factors: { ...factors, intent: "greeting" },
      tier: "quick",
      reason: "Simple greeting",
    };
  }

  // 3. Simple thanks/acknowledgment
  if (
    (SIMPLE_THANKS.some((t) => lower.includes(t)) ||
      SIMPLE_ACK.some((a) => lower === a)) &&
    trimmed.length < 30
  ) {
    return {
      score: 0.15,
      factors: { ...factors, intent: "acknowledgment" },
      tier: "quick",
      reason: "Acknowledgment or thanks",
    };
  }

  // 4. Message length factor
  if (trimmed.length < 30) {
    factors.length = 0.1;
  } else if (trimmed.length < 100) {
    factors.length = 0.2;
  } else if (trimmed.length < 300) {
    factors.length = 0.4;
  } else {
    factors.length = 0.6;
  }

  // 5. Keyword detection
  const hasComplexKeywords = COMPLEX_KEYWORDS.some((k) => lower.includes(k));
  const hasSimpleKeywords = SIMPLE_KEYWORDS.some((k) => lower.includes(k));

  if (hasComplexKeywords) {
    factors.keywords = 0.5;
    factors.intent = "complex-task";
  } else if (hasSimpleKeywords) {
    factors.keywords = 0.2;
    factors.intent = "simple-question";
  } else {
    factors.keywords = 0.3;
    factors.intent = "general";
  }

  // 6. Context factors
  if (context?.hasHistory) {
    factors.context = 0.15;
  }
  if (context?.hasMedia) {
    factors.context += 0.15;
  }
  if (context?.historyLength && context.historyLength > 10) {
    factors.context += 0.1;
  }

  // 7. Calculate score
  const score = Math.min(
    (factors.length + factors.keywords + factors.context) / 1.2,
    1.0,
  );

  // 8. Determine tier
  let tier: "quick" | "standard" | "deep";
  let reason: string;

  if (score < 0.3) {
    tier = "quick";
    reason = `Low complexity (${score.toFixed(2)}): ${factors.intent}`;
  } else if (score < 0.7) {
    tier = "standard";
    reason = `Medium complexity (${score.toFixed(2)}): ${factors.intent}`;
  } else {
    tier = "deep";
    reason = `High complexity (${score.toFixed(2)}): ${factors.intent}`;
  }

  return {
    score,
    factors,
    tier,
    reason,
  };
}

/**
 * Quick check if message should bypass complexity analysis
 */
export function shouldBypassAnalysis(text: string): boolean {
  return text.trim().startsWith("/");
}
