/**
 * Telegram message queue with intelligent batching.
 * 
 * Automatically merges rapid-fire user messages within a time window,
 * while distinguishing between "append" and "new topic" intents.
 * 
 * @experimental Part of bot-006 short-answer UX improvements.
 */

import { logVerbose } from "../globals.js";

export type QueuedMessage = {
  context: any; // Full bot message context
  text: string;
  timestamp: number;
  isCommand: boolean;
};

export type MessageBatch = {
  userId: string;
  chatId: string;
  messages: QueuedMessage[];
  timer: NodeJS.Timeout | null;
  lastMessageTime: number;
};

export type MessageQueueConfig = {
  enabled: boolean;
  baseWindowMs: number;
  maxBatchSize: number;
  appendConfidenceThreshold: number;
  allowInterrupt: boolean;
};

export type FlushHandler = (batch: MessageBatch) => Promise<void>;

/**
 * Calculate confidence score (0-100) that a message is an "append" to the previous.
 */
function calculateAppendConfidence(text: string, timeSinceLast: number): number {
  let score = 0;

  // Time factor: closer = more likely append
  if (timeSinceLast < 1000) {
    score += 40;
  } else if (timeSinceLast < 2000) {
    score += 20;
  } else if (timeSinceLast < 3000) {
    score += 10;
  }

  // Length factor: shorter = more likely append
  const trimmed = text.trim();
  if (trimmed.length < 10) {
    score += 20;
  } else if (trimmed.length < 20) {
    score += 10;
  }

  // Keyword detection: explicit append signals
  const appendKeywords = [
    "补充",
    "还有",
    "另外",
    "还要",
    "以及",
    "对了",
    "哦对",
    "还需要",
    "再加",
    "而且",
    // English
    "also",
    "and",
    "additionally",
    "plus",
    "oh and",
    "btw",
    "furthermore",
  ];

  const textLower = trimmed.toLowerCase();
  const startsWithAppend = appendKeywords.some((kw) => textLower.startsWith(kw));
  const containsAppend = appendKeywords.some((kw) => textLower.includes(kw));

  if (startsWithAppend) {
    score += 30;
  } else if (containsAppend) {
    score += 15;
  }

  return Math.min(score, 100);
}

/**
 * Check if a message should bypass the queue (e.g., commands).
 */
function shouldBypassQueue(text: string): boolean {
  const trimmed = text.trim();
  // Telegram commands start with /
  return trimmed.startsWith("/");
}

export class TelegramMessageQueue {
  private batches = new Map<string, MessageBatch>();
  private config: MessageQueueConfig;
  private flushHandler: FlushHandler;
  private activeRuns = new Map<string, Promise<void>>(); // Track ongoing AI responses

  constructor(config: MessageQueueConfig, flushHandler: FlushHandler) {
    this.config = config;
    this.flushHandler = flushHandler;
  }

  /**
   * Enqueue a new message. Returns true if queued, false if bypassed.
   */
  async enqueue(
    userId: string,
    chatId: string,
    context: any,
    text: string,
  ): Promise<{ queued: boolean; interrupted: boolean }> {
    if (!this.config.enabled) {
      // Queue disabled, process immediately
      await this.flushHandler({
        userId,
        chatId,
        messages: [
          {
            context,
            text,
            timestamp: Date.now(),
            isCommand: shouldBypassQueue(text),
          },
        ],
        timer: null,
        lastMessageTime: Date.now(),
      });
      return { queued: false, interrupted: false };
    }

    const isCommand = shouldBypassQueue(text);
    if (isCommand) {
      // Commands bypass queue and process immediately
      logVerbose(`telegram-queue: command bypassed queue: ${text.slice(0, 30)}`);
      await this.flushHandler({
        userId,
        chatId,
        messages: [
          {
            context,
            text,
            timestamp: Date.now(),
            isCommand: true,
          },
        ],
        timer: null,
        lastMessageTime: Date.now(),
      });
      return { queued: false, interrupted: false };
    }

    const key = `${userId}:${chatId}`;
    const now = Date.now();
    const existing = this.batches.get(key);

    if (existing) {
      // Batch exists: check if we should append or interrupt
      const timeSinceLast = now - existing.lastMessageTime;
      const confidence = calculateAppendConfidence(text, timeSinceLast);

      logVerbose(
        `telegram-queue: append confidence=${confidence} timeSince=${timeSinceLast}ms text="${text.slice(0, 30)}"`,
      );

      // Check if AI is currently responding
      const activeRun = this.activeRuns.get(key);
      let interrupted = false;

      if (activeRun && this.config.allowInterrupt) {
        if (confidence >= this.config.appendConfidenceThreshold) {
          // High confidence append: interrupt current response
          logVerbose(
            `telegram-queue: interrupting active run for high-confidence append (${confidence})`,
          );
          // Note: actual interruption logic needs to be wired into dispatchTelegramMessage
          // For now, we just flush the queue which will create a new request
          interrupted = true;
        }
      }

      // Add message to batch
      existing.messages.push({
        context,
        text,
        timestamp: now,
        isCommand: false,
      });
      existing.lastMessageTime = now;

      // Reset timer
      if (existing.timer) {
        clearTimeout(existing.timer);
      }

      // Decide flush timing
      if (existing.messages.length >= this.config.maxBatchSize) {
        // Max batch size reached: flush immediately
        logVerbose(`telegram-queue: max batch size reached, flushing ${key}`);
        await this.flush(key);
      } else if (confidence < this.config.appendConfidenceThreshold && timeSinceLast > 2000) {
        // Low confidence and significant gap: likely new topic, flush immediately
        logVerbose(`telegram-queue: low confidence + time gap, flushing ${key}`);
        await this.flush(key);
      } else {
        // Set/reset timer
        const windowMs =
          confidence >= this.config.appendConfidenceThreshold
            ? this.config.baseWindowMs + 500 // Extend window for confident appends
            : this.config.baseWindowMs;

        existing.timer = setTimeout(() => {
          this.flush(key).catch((err) => {
            logVerbose(`telegram-queue: flush error: ${String(err)}`);
          });
        }, windowMs);

        logVerbose(
          `telegram-queue: queued message, will flush in ${windowMs}ms (batch size: ${existing.messages.length})`,
        );
      }

      return { queued: true, interrupted };
    } else {
      // No existing batch: create new one
      const batch: MessageBatch = {
        userId,
        chatId,
        messages: [
          {
            context,
            text,
            timestamp: now,
            isCommand: false,
          },
        ],
        timer: setTimeout(() => {
          this.flush(key).catch((err) => {
            logVerbose(`telegram-queue: flush error: ${String(err)}`);
          });
        }, this.config.baseWindowMs),
        lastMessageTime: now,
      };

      this.batches.set(key, batch);
      logVerbose(`telegram-queue: created new batch for ${key}, will flush in ${this.config.baseWindowMs}ms`);

      return { queued: true, interrupted: false };
    }
  }

  /**
   * Flush a batch immediately.
   */
  private async flush(key: string): Promise<void> {
    const batch = this.batches.get(key);
    if (!batch) {
      return;
    }

    this.batches.delete(key);

    if (batch.timer) {
      clearTimeout(batch.timer);
    }

    logVerbose(
      `telegram-queue: flushing batch ${key} with ${batch.messages.length} message(s)`,
    );

    // Track that we're processing this batch
    const runPromise = this.flushHandler(batch);
    this.activeRuns.set(key, runPromise);

    try {
      await runPromise;
    } finally {
      this.activeRuns.delete(key);
    }
  }

  /**
   * Flush all pending batches immediately (e.g., on shutdown).
   */
  async flushAll(): Promise<void> {
    const keys = Array.from(this.batches.keys());
    await Promise.all(keys.map((key) => this.flush(key)));
  }

  /**
   * Clear all pending batches without processing.
   */
  clear(): void {
    for (const batch of this.batches.values()) {
      if (batch.timer) {
        clearTimeout(batch.timer);
      }
    }
    this.batches.clear();
    this.activeRuns.clear();
  }
}

/**
 * Merge multiple message contexts into a single context.
 * Takes the most recent context as base and merges message bodies.
 */
export function mergeMessageContexts(messages: QueuedMessage[]): any {
  if (messages.length === 0) {
    throw new Error("Cannot merge empty message array");
  }

  if (messages.length === 1) {
    return messages[0].context;
  }

  // Use the most recent message's context as base
  const base = { ...messages[messages.length - 1].context };

  // Merge message bodies
  const bodies = messages.map((msg, index) => {
    if (index === 0) {
      return msg.text;
    }
    // Add markers for appended messages
    return `[补充] ${msg.text}`;
  });

  const mergedBody = bodies.join("\n");

  // Update the merged fields in ctxPayload if it exists
  if (base.ctxPayload) {
    base.ctxPayload = {
      ...base.ctxPayload,
      Body: mergedBody,
      BodyForAgent: mergedBody,
      _batchSize: messages.length,
      _timestamps: messages.map((m) => m.timestamp),
    };
  } else {
    // Fallback: update at top level
    base.Body = mergedBody;
    base.BodyForAgent = mergedBody;
    base._batchSize = messages.length;
    base._timestamps = messages.map((m) => m.timestamp);
  }

  return base;
}
