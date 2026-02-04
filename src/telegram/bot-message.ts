// @ts-nocheck
import { logVerbose } from "../globals.js";
import { buildTelegramMessageContext } from "./bot-message-context.js";
import { dispatchTelegramMessage } from "./bot-message-dispatch.js";
import {
  TelegramMessageQueue,
  mergeMessageContexts,
  type MessageQueueConfig,
  type MessageBatch,
} from "./message-queue.js";

/**
 * Resolve message queue configuration from config.
 */
function resolveMessageQueueConfig(cfg, accountId: string): MessageQueueConfig {
  // Check environment variable override
  const envDisabled = process.env.OPENCLAW_TELEGRAM_MESSAGE_QUEUE === "0";
  if (envDisabled) {
    return {
      enabled: false,
      baseWindowMs: 1500,
      maxBatchSize: 5,
      appendConfidenceThreshold: 60,
      allowInterrupt: false,
    };
  }

  // Check config (future: add to telegram account config)
  const telegramCfg = cfg.channels?.telegram?.accounts?.[accountId];
  const queueCfg = telegramCfg?.messageQueue;

  return {
    enabled: queueCfg?.enabled ?? true, // Enabled by default
    baseWindowMs: queueCfg?.baseWindowMs ?? 1500,
    maxBatchSize: queueCfg?.maxBatchSize ?? 5,
    appendConfidenceThreshold: queueCfg?.appendConfidenceThreshold ?? 60,
    allowInterrupt: queueCfg?.allowInterrupt ?? false,
  };
}

export const createTelegramMessageProcessor = (deps) => {
  const {
    bot,
    cfg,
    account,
    telegramCfg,
    historyLimit,
    groupHistories,
    dmPolicy,
    allowFrom,
    groupAllowFrom,
    ackReactionScope,
    logger,
    resolveGroupActivation,
    resolveGroupRequireMention,
    resolveTelegramGroupConfig,
    runtime,
    replyToMode,
    streamMode,
    textLimit,
    opts,
    resolveBotTopicsEnabled,
  } = deps;

  // Create message queue for intelligent batching
  const queueConfig = resolveMessageQueueConfig(cfg, account.accountId);

  const flushHandler = async (batch: MessageBatch) => {
    if (batch.messages.length === 0) {
      return;
    }

    if (batch.messages.length === 1) {
      // Single message: dispatch directly
      const { context: singleContext } = batch.messages[0];
      await dispatchTelegramMessage({
        context: singleContext,
        bot,
        cfg,
        runtime,
        replyToMode,
        streamMode,
        textLimit,
        telegramCfg,
        opts,
        resolveBotTopicsEnabled,
      });
      return;
    }

    // Multiple messages: merge contexts
    const mergedContext = mergeMessageContexts(batch.messages);

    logVerbose(
      `telegram-queue: dispatching merged batch of ${batch.messages.length} messages`,
    );

    await dispatchTelegramMessage({
      context: mergedContext,
      bot,
      cfg,
      runtime,
      replyToMode,
      streamMode,
      textLimit,
      telegramCfg,
      opts,
      resolveBotTopicsEnabled,
    });
  };

  const messageQueue = new TelegramMessageQueue(queueConfig, flushHandler);

  return async (primaryCtx, allMedia, storeAllowFrom, options) => {
    const context = await buildTelegramMessageContext({
      primaryCtx,
      allMedia,
      storeAllowFrom,
      options,
      bot,
      cfg,
      account,
      historyLimit,
      groupHistories,
      dmPolicy,
      allowFrom,
      groupAllowFrom,
      ackReactionScope,
      logger,
      resolveGroupActivation,
      resolveGroupRequireMention,
      resolveTelegramGroupConfig,
    });
    if (!context) {
      return;
    }

    // Extract message text for queue logic
    const messageText =
      context.ctxPayload?.Body ??
      context.msg?.text ??
      context.msg?.caption ??
      "";

    // Extract user and chat identifiers
    const userId = String(context.msg?.from?.id ?? "unknown");
    const chatId = String(context.msg?.chat?.id ?? "unknown");

    // Only queue private chat messages (not groups)
    const isPrivateChat = context.msg?.chat?.type === "private";
    
    if (isPrivateChat && queueConfig.enabled) {
      // Queue the message
      await messageQueue.enqueue(userId, chatId, context, messageText);
    } else {
      // Group messages or queue disabled: process immediately
      await dispatchTelegramMessage({
        context,
        bot,
        cfg,
        runtime,
        replyToMode,
        streamMode,
        textLimit,
        telegramCfg,
        opts,
        resolveBotTopicsEnabled,
      });
    }
  };
};
