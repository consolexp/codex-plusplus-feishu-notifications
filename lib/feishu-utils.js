"use strict";

const FEISHU_KEYS = {
  enabled: "enabled",
  appId: "appId",
  appSecret: "appSecret",
  appRecipientOpenId: "appRecipientOpenId",
  appPollingIntervalSeconds: "appPollingIntervalSeconds",
  appDirectRouteRecentConversationLimit: "appDirectRouteRecentConversationLimit",
  appDirectRouteWorkspaceLimit: "appDirectRouteWorkspaceLimit",
  appConversationDeliveryMode: "appConversationDeliveryMode",
  groupRunningAvatarDataUrl: "groupRunningAvatarDataUrl",
  groupCompleteAvatarDataUrl: "groupCompleteAvatarDataUrl",
  showProjectNameInGroupTitle: "showProjectNameInGroupTitle",
  debugLoggingEnabled: "debugLoggingEnabled",
  reverseReplyEnabled: "reverseReplyEnabled",
  autoReactToReplies: "autoReactToReplies",
  notifyPrefix: "notifyPrefix",
};

const DEFAULT_FEISHU_DIRECT_ROUTE_RECENT_CONVERSATION_LIMIT = 5;
const DEFAULT_FEISHU_DIRECT_ROUTE_WORKSPACE_LIMIT = 3;

const DEFAULT_SETTINGS = {
  enabled: false,
  mode: "app",
  appId: "",
  appSecret: "",
  appRecipientOpenId: "",
  appPollingIntervalSeconds: 5,
  appDirectRouteRecentConversationLimit: DEFAULT_FEISHU_DIRECT_ROUTE_RECENT_CONVERSATION_LIMIT,
  appDirectRouteWorkspaceLimit: DEFAULT_FEISHU_DIRECT_ROUTE_WORKSPACE_LIMIT,
  appConversationDeliveryMode: "group",
  groupRunningAvatarDataUrl: "",
  groupCompleteAvatarDataUrl: "",
  showProjectNameInGroupTitle: true,
  debugLoggingEnabled: false,
  reverseReplyEnabled: true,
  autoReactToReplies: true,
  notifyPrefix: "Codex Task Complete",
};

const STATE_KEYS = {
  root: "runtimeState",
  bindings: "codexpp-feishu-bindings-v1",
  processedMessages: "codexpp-feishu-processed-messages-v1",
  processingMessages: "codexpp-feishu-processing-messages-v1",
  pollState: "codexpp-feishu-poll-state-v1",
  queuedMessages: "codexpp-feishu-queued-messages-v1",
  polledMessages: "codexpp-feishu-polled-messages-v1",
  pendingImages: "codexpp-feishu-pending-images-v1",
  aliases: "codexpp-feishu-message-aliases-v1",
  completedTurns: "codexpp-feishu-completed-turns-v1",
};

function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function parsePollingIntervalSeconds(value) {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number.parseInt(value, 10)
        : Number.NaN;
  return Number.isFinite(numeric) ? clamp(Math.round(numeric), 3, 60) : 5;
}

function parseDirectRouteLimit(value, fallbackValue) {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number.parseInt(value, 10)
        : Number.NaN;
  return Number.isFinite(numeric) ? clamp(Math.round(numeric), 0, 20) : fallbackValue;
}

function parseDirectRouteRecentConversationLimit(value) {
  return parseDirectRouteLimit(value, DEFAULT_FEISHU_DIRECT_ROUTE_RECENT_CONVERSATION_LIMIT);
}

function parseDirectRouteWorkspaceLimit(value) {
  return parseDirectRouteLimit(value, DEFAULT_FEISHU_DIRECT_ROUTE_WORKSPACE_LIMIT);
}

function normalizeAvatarDataUrl(value) {
  const dataUrl = trimString(value);
  if (!dataUrl) return "";
  return /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=\s]+$/i.test(dataUrl)
    ? dataUrl
    : "";
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function isNonEmptyString(value) {
  return trimString(value).length > 0;
}

function sanitizeNotificationText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function stripNotificationArtifacts(value) {
  return typeof value === "string"
    ? value
        .replace(/<image\b[^>]*>\s*<\/image>/gi, "")
        .replace(/!\[[^\]]*]\([^)]*\)/g, "")
        .replace(/\[([^\]]+)\]\(([^)]*)\)/g, (_, label, target) => {
          const normalizedTarget = trimString(target);
          return /^(?:\/[A-Za-z]:\/|[A-Za-z]:\/|file:\/\/|\/[^)\s]*\/[^)\s]*)/i.test(
            normalizedTarget,
          )
            ? label
            : `[${label}](${target})`;
        })
        .replace(/[^\s]+†L\d+(?:-L\d+)?/g, "")
    : "";
}

function normalizeNotificationSourceText(value) {
  if (typeof value !== "string") return "";
  return stripNotificationArtifacts(value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeNotificationBodyText(value) {
  return normalizeNotificationSourceText(value)
    .replace(/```[a-zA-Z0-9_-]*\s*([\s\S]*?)```/g, (_, code) => `\n${code.trim()}\n`)
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1");
}

function resolveFeishuSettings(raw = {}) {
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(raw && typeof raw === "object" ? raw : {}),
  };
  const appId = trimString(settings.appId);
  const appSecret = trimString(settings.appSecret);
  const appRecipientOpenId = trimString(settings.appRecipientOpenId);
  const appPollingIntervalSeconds = parsePollingIntervalSeconds(settings.appPollingIntervalSeconds);
  const appDirectRouteRecentConversationLimit = parseDirectRouteRecentConversationLimit(
    settings.appDirectRouteRecentConversationLimit,
  );
  const appDirectRouteWorkspaceLimit = parseDirectRouteWorkspaceLimit(
    settings.appDirectRouteWorkspaceLimit,
  );
  const appConversationDeliveryMode =
    trimString(settings.appConversationDeliveryMode) === "group" ? "group" : "group";
  const groupRunningAvatarDataUrl = normalizeAvatarDataUrl(settings.groupRunningAvatarDataUrl);
  const groupCompleteAvatarDataUrl = normalizeAvatarDataUrl(settings.groupCompleteAvatarDataUrl);
  const showProjectNameInGroupTitle = settings.showProjectNameInGroupTitle !== false;
  const debugLoggingEnabled = settings.debugLoggingEnabled === true;
  const enabled = settings.enabled === true;
  return {
    enabled,
    mode: "app",
    appId,
    appSecret,
    appRecipientOpenId,
    appPollingIntervalSeconds,
    appDirectRouteRecentConversationLimit,
    appDirectRouteWorkspaceLimit,
    appConversationDeliveryMode,
    groupRunningAvatarDataUrl,
    groupCompleteAvatarDataUrl,
    showProjectNameInGroupTitle,
    debugLoggingEnabled,
    reverseReplyEnabled: settings.reverseReplyEnabled === true,
    autoReactToReplies: settings.autoReactToReplies !== false,
    notifyPrefix: trimString(settings.notifyPrefix) || DEFAULT_SETTINGS.notifyPrefix,
    isAppReady: Boolean(
      enabled &&
      appId &&
      appSecret &&
      appRecipientOpenId,
    ),
  };
}

function isFeishuMessageId(value) {
  return /^om_[a-z0-9]+$/i.test(trimString(value));
}

function collectFeishuRelatedMessageIds(value, results, keyHint = "", depth = 0) {
  if (depth > 6 || value == null) return;
  if (typeof value === "string") {
    const trimmed = trimString(value);
    if (
      isFeishuMessageId(trimmed) &&
      (!keyHint || /(message|parent|root|thread|upper|reply)/i.test(keyHint))
    ) {
      results.add(trimmed);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectFeishuRelatedMessageIds(item, results, keyHint, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  for (const [childKey, childValue] of Object.entries(value)) {
    collectFeishuRelatedMessageIds(childValue, results, childKey, depth + 1);
  }
}

function extractFeishuResponseMessageIds(payload) {
  const results = new Set();
  collectFeishuRelatedMessageIds(payload, results);
  const explicitMessageId =
    trimString(payload?.data?.message_id) || trimString(payload?.message_id);
  if (explicitMessageId) results.add(explicitMessageId);
  return [...results].filter(Boolean);
}

function buildTextInput(text) {
  return [
    {
      type: "text",
      text,
      text_elements: [],
    },
  ];
}

function buildFeishuTurnInput(text, attachments = []) {
  const normalizedText = trimString(text);
  return [
    ...buildTextInput(
      normalizedText || (attachments.length > 0 ? "Please process this together with the images I attached." : ""),
    ),
    ...attachments
      .filter((attachment) => attachment?.type === "image" && trimString(attachment.data))
      .map((attachment) => ({
        type: "image",
        url: /^data:/i.test(trimString(attachment.data))
          ? trimString(attachment.data)
          : `data:${trimString(attachment.mimeType) || "image/png"};base64,${trimString(
              attachment.data,
            )}`,
      })),
  ];
}

function buildSteerGuidanceText(text) {
  const normalized = trimString(text);
  return normalized
    ? `Additional requirement. Incorporate this directly into the current work:
\n${normalized}`
    : "Additional requirement. Incorporate this directly into the current work.";
}

function buildImageMessagePrompt() {
  return "Please add a text description. I will send that text together with the previous images to Codex.";
}

function getFeishuPendingImageThreadKey(message) {
  const chatId = trimString(message?.chatId);
  const threadId =
    trimString(message?.rootId) ||
    trimString(message?.parentId) ||
    trimString(message?.messageId);
  return chatId && threadId ? `${chatId}::${threadId}` : "";
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error || "unknown error");
}

function summarizeTextForLog(value, limit = 220) {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  const normalizedLimit = Math.max(20, Math.floor(Number(limit) || 220));
  return {
    length: text.length,
    preview: text.length > normalizedLimit ? `${text.slice(0, normalizedLimit)}...[truncated]` : text,
  };
}

function summarizeMessageIdList(values, limit = 12) {
  if (!Array.isArray(values)) return [];
  const normalizedLimit = Math.max(1, Math.floor(Number(limit) || 12));
  return values.map((value) => trimString(value)).filter(Boolean).slice(-normalizedLimit);
}

function summarizeFeishuBindingForLog(binding) {
  return {
    conversationId: trimString(binding?.conversationId),
    hostId: trimString(binding?.hostId),
    cwd: trimString(binding?.cwd),
    title: trimString(binding?.title),
    chatId: trimString(binding?.chatId),
    pendingWorkspaceCwd: trimString(binding?.pendingWorkspaceCwd),
    pendingImageThreadKey: trimString(binding?.pendingImageThreadKey),
    directRoutePromptBatchId: trimString(binding?.directRoutePromptBatchId),
    directRoutePromptMessageId: trimString(binding?.directRoutePromptMessageId),
    directRoutePromptSourceMessageId: trimString(binding?.directRoutePromptSourceMessageId),
    lastTurnId: trimString(binding?.lastTurnId),
    userMirrorTurnId: trimString(binding?.userMirrorTurnId),
    rootMessageId: trimString(binding?.rootMessageId),
    threadRootMessageId: trimString(binding?.threadRootMessageId),
    entryMessageId: trimString(binding?.entryMessageId),
    replyToMessageId: trimString(binding?.replyToMessageId),
    streamMessageId: trimString(binding?.streamMessageId),
    streamReplyTargetMessageId: trimString(binding?.streamReplyTargetMessageId),
    activeRequestMessageId: trimString(binding?.activeRequestMessageId),
    activeRequestChatId: trimString(binding?.activeRequestChatId),
    activeRequestCreatedAt: Number(binding?.activeRequestCreatedAt) || 0,
    directRoutePromptCreatedAt: Number(binding?.directRoutePromptCreatedAt) || 0,
    streamCardId: trimString(binding?.streamCardId),
    streamCardSequence: Number(binding?.streamCardSequence) || 0,
    streamTurnId: trimString(binding?.streamTurnId),
    streamReplyTargetTurnId: trimString(binding?.streamReplyTargetTurnId),
    messageIdHistory: summarizeMessageIdList(binding?.messageIdHistory, 12),
    updatedAt: Number(binding?.updatedAt) || 0,
  };
}

function summarizeFeishuBindingPatchForLog(binding) {
  if (!binding || typeof binding !== "object") return {};
  const patch = {};
  const stringFields = [
    "conversationId",
    "hostId",
    "cwd",
    "title",
    "chatId",
    "pendingWorkspaceCwd",
    "pendingImageThreadKey",
    "directRoutePromptBatchId",
    "directRoutePromptMessageId",
    "directRoutePromptSourceMessageId",
    "lastTurnId",
    "userMirrorTurnId",
    "userMirrorText",
    "rootMessageId",
    "threadRootMessageId",
    "entryMessageId",
    "replyToMessageId",
    "streamMessageId",
    "streamReplyTargetMessageId",
    "activeRequestMessageId",
    "activeRequestChatId",
    "streamCardId",
    "streamTurnId",
    "streamReplyTargetTurnId",
  ];
  const numberFields = [
    "activeRequestCreatedAt",
    "directRoutePromptCreatedAt",
    "streamCardSequence",
    "updatedAt",
  ];
  for (const field of stringFields) {
    if (!Object.prototype.hasOwnProperty.call(binding, field)) continue;
    patch[field] = field === "userMirrorText"
      ? summarizeTextForLog(binding[field])
      : trimString(binding[field]);
  }
  for (const field of numberFields) {
    if (Object.prototype.hasOwnProperty.call(binding, field)) patch[field] = Number(binding[field]) || 0;
  }
  if (Object.prototype.hasOwnProperty.call(binding, "messageIdHistory")) {
    patch.messageIdHistory = summarizeMessageIdList(binding.messageIdHistory, 20);
  }
  return patch;
}

function summarizeParsedFeishuMessageForLog(message) {
  return {
    messageId: trimString(message?.messageId),
    chatId: trimString(message?.chatId),
    parentId: trimString(message?.parentId),
    rootId: trimString(message?.rootId),
    upperMessageId: trimString(message?.upperMessageId),
    threadId: trimString(message?.threadId),
    relatedMessageIds: summarizeMessageIdList(message?.relatedMessageIds, 20),
    senderId: trimString(message?.senderId),
    senderType: trimString(message?.senderType),
    messageType: trimString(message?.messageType),
    createdAt: Number(message?.createdAt) || 0,
    mentions: Boolean(message?.mentions),
    text: summarizeTextForLog(message?.text),
    imageRef: message?.imageRef ? {
      imageKey: trimString(message.imageRef?.imageKey),
      imageToken: trimString(message.imageRef?.imageToken),
      fileKey: trimString(message.imageRef?.fileKey),
    } : null,
  };
}

function logFeishuDebug(api, event, payload = {}) {
  try {
    const settings = resolveFeishuSettings(api?.storage?.get?.("settings", DEFAULT_SETTINGS));
    if (!settings.debugLoggingEnabled) return;
    api?.log?.info?.("Feishu debug", {
      event: trimString(event),
      timestamp: Date.now(),
      ...(payload && typeof payload === "object" ? payload : { value: payload }),
    });
  } catch {}
}

function logFeishuBinding(api, event, payload = {}) {
  logFeishuDebug(api, "binding", {
    bindingEvent: trimString(event),
    ...(payload && typeof payload === "object" ? payload : { value: payload }),
  });
}

module.exports = {
  DEFAULT_SETTINGS,
  DEFAULT_FEISHU_DIRECT_ROUTE_RECENT_CONVERSATION_LIMIT,
  DEFAULT_FEISHU_DIRECT_ROUTE_WORKSPACE_LIMIT,
  FEISHU_KEYS,
  STATE_KEYS,
  buildFeishuTurnInput,
  buildImageMessagePrompt,
  buildSteerGuidanceText,
  collectFeishuRelatedMessageIds,
  extractFeishuResponseMessageIds,
  formatError,
  firstDefined,
  isNonEmptyString,
  normalizeNotificationBodyText,
  normalizeNotificationSourceText,
  parseDirectRouteRecentConversationLimit,
  parseDirectRouteWorkspaceLimit,
  parsePollingIntervalSeconds,
  resolveFeishuSettings,
  sanitizeNotificationText,
  summarizeFeishuBindingForLog,
  summarizeFeishuBindingPatchForLog,
  summarizeParsedFeishuMessageForLog,
  summarizeTextForLog,
  logFeishuBinding,
  logFeishuDebug,
  getFeishuPendingImageThreadKey,
  trimString,
};
