// PORTABLE_PATCH: Portable-only renderer bridge that translates Codex thread
// PORTABLE_PATCH: activity into Feishu streaming cards, replies, and completion messages.
import {
invokePortableHostBridge,
React,
registerPortableBridgePlugin,
useAppServerManager,
useAppServerRegistry,
} from "./portable-host-request-compat.js";
import {
readPortableGlobalStateValue,
} from "./portable-global-state-compat.js";
import {
ensurePortableConversationReady,
isPortableConversationTurnInProgress,
startPortableConversationTurn,
steerPortableConversationTurn,
} from "./portable-manager-compat.js";
import {
FEISHU_KEYS,
FEISHU_CARDKIT_STREAM_ELEMENT_ID,
addAppMessageReaction,
appendFeishuBindingLog,
appendFeishuDebugLog,
buildFeishuCardKitCompleteCard,
buildTurnCompleteText,
buildTurnReplyText,
configureFeishuDebugLogging,
createAppGroupChat,
createAppCardKitCard,
getAppGroupChat,
createAppGroupShareLink,
deleteAppMessage,
dequeueFeishuConversationMessage,
dequeueFeishuConversationMessageByHost,
enqueueFeishuConversationMessage,
enqueueFeishuConversationMessageByHost,
ensureFeishuRuntimeStateHydrated,
extractTurnSummary,
findBindingForMessage,
findFeishuMessageAlias,
getFeishuPendingImageThreadKey,
getFeishuPollCursorByHost,
isFeishuDebugLoggingEnabled,
isProcessedFeishuMessageByHost,
isProcessedFeishuMessage,
listAppChatMessages,
markFeishuMessageProcessed,
peekQueuedFeishuConversationMessage,
peekQueuedFeishuConversationMessageByHost,
queuePendingFeishuImage,
queuePendingFeishuImageByHost,
readFeishuDirectChats,
readFeishuBindings,
rememberFeishuDirectChat,
releaseFeishuMessageClaim,
releaseFeishuMessageClaimByHost,
replyAppCardKitNotification,
resolveFeishuImageAttachment,
resolveFeishuSettings,
restorePendingFeishuImagesForMessage,
restorePendingFeishuImagesForMessageByHost,
restorePendingFeishuImagesForThreadKey,
restorePendingFeishuImagesForThreadKeyByHost,
replyAppCardNotification,
sendAppCardToChat,
sendAppCardNotification,
sendAppCardKitToChat,
sendAppCardKitNotification,
sendAppTextToChat,
sendAppTextNotification,
registerFeishuMessageAlias,
replyAppTextNotification,
sendWebhookTextNotification,
setAppCardKitStreamingMode,
setFeishuPollCursorByHost,
summarizeFeishuBindingForLog,
summarizeParsedFeishuMessageForLog,
streamAppCardKitElement,
takePendingFeishuImagesForMessage,
takePendingFeishuImagesForMessageByHost,
takePendingFeishuImagesForThreadKey,
takePendingFeishuImagesForThreadKeyByHost,
tryClaimFeishuMessage,
tryClaimFeishuMessageByHost,
updateAppCardNotification,
updateAppCardKitCard,
updateAppGroupChat,
uploadFeishuAppImage,
upsertFeishuBinding,
writeFeishuBindings,
} from "./portable-feishu-common.js";
import {
buildFeishuTurnInput,
buildImageMessagePrompt,
buildSteerGuidanceText,
} from "./portable-feishu-turn-core.js";
import {
getManagerHostId,
getConversationTaskTitle,
listActiveWorkspaceChoices,
listManagerRecentConversationIds,
listManagerTrackedConversationIds,
listRecentConversationChoices,
resolveManagerForConversation,
startConversationWithManager,
} from "./portable-feishu-conversation-adapter.js";
import {
formatDirectRouteConversationPromptTitle,
normalizeFeishuTimestampMs,
normalizeRecentRank,
pickFirstFeishuTimestampMs,
sanitizeInlineText,
} from "./portable-feishu-choice-core.js";
import {
buildFeishuStreamCardSnapshot,
buildStreamingPhaseText,
buildStreamingStatus,
extractDesktopTurnPromptText,
extractStreamingTurnData,
formatFeishuElapsedDuration,
getFeishuLoadingFallbackText,
getFeishuLoadingFrameIndex,
getFeishuNextLoadingFrameDelay,
getLatestConversationTurn,
} from "./portable-feishu-stream-core.js";
import {
DIRECT_FEISHU_KIND_CONVERSATION,
DIRECT_FEISHU_KIND_WORKSPACE,
extractDirectFeishuRoute,
resolveConversationChoice,
resolveWorkspaceChoice,
selectDirectRoutePromptConversationChoices,
selectDirectRoutePromptWorkspaceChoices,
} from "./portable-feishu-route-core.js";
const PENDING_WORKSPACE_CONVERSATION_PREFIX = "pending-workspace:";
const FEISHU_STREAM_UPDATE_INTERVAL_MS = 80;
const FEISHU_ACTIVE_STREAM_SCAN_INTERVAL_MS = 3e4;
const FEISHU_CONFIG_REFRESH_INTERVAL_MS = 35e3;
const FEISHU_STREAM_STATES = new Map();
const FEISHU_POLL_BASELINE_MS_BY_CHAT = new Map();
const FEISHU_GROUP_BINDING_LOCKS = new Map();
const FEISHU_GROUP_AVATAR_STATE_KEYS = {
running: "running",
complete: "complete",
};
const FEISHU_GROUP_AVATAR_ASSET_VERSION = "opaque-v3-symbols";
const FEISHU_GROUP_AVATAR_IMAGES = {
running: {
name: "codex-running-avatar.png",
dataUrl: "data:image/png;base64,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",
},
complete: {
name: "codex-complete-avatar.png",
dataUrl: "data:image/png;base64,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",
},
};

function hashFeishuAvatarDataUrl(value) {
const text = trimString(value);
let hash = 5381;
for (let index = 0; index < text.length; index += 1) {
hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
}
return (hash >>> 0).toString(36);
}

function getFeishuDataUrlMimeType(dataUrl) {
const match = trimString(dataUrl).match(/^data:([^;,]+);base64,/i);
return trimString(match?.[1]) || "image/png";
}

function getFeishuGroupAvatarAsset(config, stateKey) {
const normalizedStateKey = trimString(stateKey);
const fallback = FEISHU_GROUP_AVATAR_IMAGES[normalizedStateKey];
if (!fallback) {
return null;
}

const customDataUrl =
normalizedStateKey === FEISHU_GROUP_AVATAR_STATE_KEYS.running ?
trimString(config?.groupRunningAvatarDataUrl) :
trimString(config?.groupCompleteAvatarDataUrl);
if (customDataUrl) {
return {
name: `${normalizedStateKey}-custom-avatar.png`,
dataUrl: customDataUrl,
mimeType: getFeishuDataUrlMimeType(customDataUrl),
assetVersion: `custom-${customDataUrl.length}-${hashFeishuAvatarDataUrl(customDataUrl)}`,
};
}

return {
...fallback,
mimeType: "image/png",
assetVersion: FEISHU_GROUP_AVATAR_ASSET_VERSION,
};
}

function createFeishuConfigSnapshotSignature(snapshot) {
return JSON.stringify({
...snapshot,
[FEISHU_KEYS.groupRunningAvatarDataUrl]: {
length: trimString(snapshot[FEISHU_KEYS.groupRunningAvatarDataUrl]).length,
hash: hashFeishuAvatarDataUrl(snapshot[FEISHU_KEYS.groupRunningAvatarDataUrl]),
},
[FEISHU_KEYS.groupCompleteAvatarDataUrl]: {
length: trimString(snapshot[FEISHU_KEYS.groupCompleteAvatarDataUrl]).length,
hash: hashFeishuAvatarDataUrl(snapshot[FEISHU_KEYS.groupCompleteAvatarDataUrl]),
},
});
}
const FEISHU_CONTROL_REQUEST_TYPE = "portable-feishu-control-request";
const FEISHU_BRIDGE_DISABLED_ROUTE_PREFIXES = [
"/tray-menu",
"/thread-overlay",
"/hotkey-window",
"/avatar-overlay",
];
export {
buildFeishuStreamCardSnapshot,
extractStreamingTurnData,
};

function trimString(value) {
return typeof value === "string" ? value.trim() : "";
}

function ensureLocalConversationFeishuBinding(manager, conversationId) {
const normalizedConversationId = trimString(conversationId);
if (!normalizedConversationId) {
return null;
}

const conversation =
typeof manager?.getConversation === "function" ?
manager.getConversation(normalizedConversationId) :
null;
const latestTurn = getLatestConversationTurn(conversation);
const existingBinding = readFeishuBindings()[normalizedConversationId] || {};
if (isFeishuDebugLoggingEnabled()) {
appendFeishuDebugLog(() => ({
type: "feishu-ensure-local-binding",
timestamp: Date.now(),
conversationId: normalizedConversationId,
hostId: trimString(getManagerHostId(manager)),
hasConversation: Boolean(conversation),
latestTurnStatus: trimString(latestTurn?.status),
latestTurnId: trimString(
latestTurn?.turnId ||
latestTurn?.turn_id ||
latestTurn?.id,
),
existingChatId: trimString(existingBinding?.chatId),
existingGroupChatId: trimString(existingBinding?.groupChatId),
})).catch(() => {});
}
if (latestTurn?.status !== "inProgress") {return {
binding: existingBinding,
conversation,
latestTurn,
};
}

const nextBinding = upsertFeishuBinding({
conversationId: normalizedConversationId,
hostId: trimString(existingBinding.hostId) ||
trimString(getManagerHostId(manager)),
cwd: trimString(conversation?.cwd || existingBinding.cwd || ""),
title: getConversationTaskTitle(
manager,
normalizedConversationId,
conversation,
) || trimString(existingBinding.title),
chatId: trimString(existingBinding.chatId || ""),
});

return {
binding: nextBinding,
conversation,
latestTurn,
};
}

function getLatestTurnAgentMessage(turn) {
if (!Array.isArray(turn?.items) || turn.items.length === 0) {
return "";
}

for (let index = turn.items.length - 1; index >= 0; index -= 1) {
const item = turn.items[index];
if (item?.type !== "agentMessage") {
continue;
}

const text = trimString(item?.text);
if (text) {
return text;
}
}

return "";
}

function buildTurnCompletedEventFromSnapshot(
manager,
conversationId,
conversation = null,
options = {},
) {
const normalizedConversationId = trimString(conversationId);
if (!normalizedConversationId) {
return null;
}

const liveConversation =
conversation ||
(typeof manager?.getConversation === "function" ?
manager.getConversation(normalizedConversationId) :
null);
const latestTurn = getLatestConversationTurn(liveConversation);
const turnId = trimString(
latestTurn?.turnId ||
latestTurn?.turn_id ||
latestTurn?.id ||
options.fallbackTurnId,
);
if (trimString(latestTurn?.status) !== "completed" || !turnId) {
return null;
}

let lastAgentMessage = "";
if (typeof manager?.getLastAgentMessageForTurn === "function") {
try {
lastAgentMessage = trimString(
manager.getLastAgentMessageForTurn(normalizedConversationId, turnId),
);
} catch (error) {
console.warn(
"[portable-feishu] snapshot turn message lookup failed",
error,
);
}
}
if (!lastAgentMessage) {
lastAgentMessage = getLatestTurnAgentMessage(latestTurn);
}

return {
conversationId: normalizedConversationId,
hostId: trimString(getManagerHostId(manager)),
turnId,
lastAgentMessage,
heartbeatAssistantMessage: null,
restoredQueuedFollowUps: [],
};
}

function buildTurnInterruptedEventFromSnapshot(
manager,
conversationId,
conversation = null,
options = {},
) {
const normalizedConversationId = trimString(conversationId);
if (!normalizedConversationId) {
return null;
}

const liveConversation =
conversation ||
(typeof manager?.getConversation === "function" ?
manager.getConversation(normalizedConversationId) :
null);
const latestTurn = getLatestConversationTurn(liveConversation);
if (trimString(latestTurn?.status) !== "interrupted") {
return null;
}

const latestTurnId = trimString(
latestTurn?.turnId ||
latestTurn?.turn_id ||
latestTurn?.id,
);
const fallbackTurnId = trimString(options.fallbackTurnId);
if (latestTurnId && fallbackTurnId && latestTurnId !== fallbackTurnId) {
return null;
}

const turnId = latestTurnId || fallbackTurnId;
if (!turnId) {
return null;
}

return {
conversationId: normalizedConversationId,
hostId: trimString(getManagerHostId(manager)),
turnId,
    lastAgentMessage: "已手动停止",
heartbeatAssistantMessage: null,
restoredQueuedFollowUps: [],
};
}

function summarizeBindingForDebug(binding) {
return {
conversationId: trimString(binding?.conversationId),
title: trimString(binding?.title),
rootMessageId: trimString(binding?.rootMessageId),
threadRootMessageId: trimString(binding?.threadRootMessageId),
entryMessageId: trimString(binding?.entryMessageId),
replyToMessageId: trimString(binding?.replyToMessageId),
streamMessageId: trimString(binding?.streamMessageId),
streamReplyTargetMessageId: trimString(binding?.streamReplyTargetMessageId),
messageIdHistory: Array.isArray(binding?.messageIdHistory) ?
binding.messageIdHistory
.map((value) => trimString(value))
.filter(Boolean)
.slice(-12) : [],
updatedAt: Number(binding?.updatedAt) || 0,
};
}

async function logUnmatchedFeishuReply(message) {
if (!isFeishuDebugLoggingEnabled()) {
return;
}

const bindings = Object.values(readFeishuBindings())
.sort(
(left, right) =>
(Number(right?.updatedAt) || 0) - (Number(left?.updatedAt) || 0),
)
.slice(0, 20)
.map(summarizeBindingForDebug);

await appendFeishuDebugLog(() => ({
type: "unmatched-feishu-reply",
message: {
messageId: trimString(message?.messageId),
chatId: trimString(message?.chatId),
parentId: trimString(message?.parentId),
rootId: trimString(message?.rootId),
upperMessageId: trimString(message?.upperMessageId),
threadId: trimString(message?.threadId),
relatedMessageIds: Array.isArray(message?.relatedMessageIds) ?
message.relatedMessageIds
.map((value) => trimString(value))
.filter(Boolean) : [],
senderId: trimString(message?.senderId),
senderType: trimString(message?.senderType),
messageType: trimString(message?.messageType),
createdAt: Number(message?.createdAt) || 0,
text: trimString(message?.text).slice(0, 1000),
},
bindings,
}));
}

async function logFeishuCardKitEvent(type, payload = {}) {
if (!isFeishuDebugLoggingEnabled()) {
return;
}

await appendFeishuDebugLog(() => ({
type,
...(() => {
const resolvedPayload =
typeof payload === "function" ? payload() : payload;
return resolvedPayload && typeof resolvedPayload === "object" ?
resolvedPayload : {};
})(),
}));
}

function collectMessageCandidateIds(message) {
return [
trimString(message?.rootId),
trimString(message?.parentId),
trimString(message?.upperMessageId),
trimString(message?.threadId),
trimString(message?.messageId),
...(Array.isArray(message?.relatedMessageIds) ?
message.relatedMessageIds.map((value) => trimString(value)) : []),
].filter(Boolean);
}

function findDeletedMessageAliasForBinding(binding, message) {
const conversationId = trimString(binding?.conversationId);
if (!conversationId) {
return null;
}

for (const candidateMessageId of collectMessageCandidateIds(message)) {
const alias = findFeishuMessageAlias(candidateMessageId);
if (trimString(alias?.conversationId) === conversationId) {
return {
sourceMessageId: candidateMessageId,
alias,
};
}
}

return null;
}

function migrateBindingAnchorAfterDeletedMessageHit(binding, message) {
const aliasMatch = findDeletedMessageAliasForBinding(binding, message);
if (!aliasMatch) {
appendFeishuBindingLog("migrate-anchor-skip", () => ({
source: "migrateBindingAnchorAfterDeletedMessageHit",
reason: "no-alias-match",
binding: summarizeFeishuBindingForLog(binding),
message: summarizeParsedFeishuMessageForLog(message),
})).catch(() => {});
return binding;
}

const replacementMessageId =
trimString(aliasMatch.alias?.replacementMessageId) ||
trimString(binding?.entryMessageId) ||
trimString(binding?.rootMessageId);
if (!replacementMessageId) {
appendFeishuBindingLog("migrate-anchor-skip", () => ({
source: "migrateBindingAnchorAfterDeletedMessageHit",
reason: "missing-replacement-message-id",
binding: summarizeFeishuBindingForLog(binding),
message: summarizeParsedFeishuMessageForLog(message),
aliasMatch: {
sourceMessageId: trimString(aliasMatch?.sourceMessageId),
conversationId: trimString(aliasMatch?.alias?.conversationId),
replacementMessageId: trimString(
aliasMatch?.alias?.replacementMessageId,
),
},
})).catch(() => {});
return binding;
}

return upsertFeishuBinding({
conversationId: binding.conversationId,
rootMessageId: replacementMessageId,
entryMessageId: replacementMessageId,
threadRootMessageId: trimString(binding?.threadRootMessageId) || replacementMessageId,
messageIdHistory: [aliasMatch.sourceMessageId, replacementMessageId],
}, {
source: "migrateBindingAnchorAfterDeletedMessageHit",
});
}

function messageReferencesAnyId(message, candidateIds) {
if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
return false;
}

const relatedIds = collectMessageCandidateIds(message);
return relatedIds.some((value) => candidateIds.includes(value));
}

async function findBindingViaVisibleFeishuDescendant(config, message) {
const chatId = trimString(message?.chatId);
const anchorIds = collectMessageCandidateIds(message).filter(
(value) => value !== trimString(message?.messageId),
);
if (!config?.isAppReady || !chatId || anchorIds.length === 0) {
return null;
}

try {
const now = Date.now();
const recentMessages = await listAppChatMessages(
config,
chatId,
now - 7 * 24 * 60 * 60 * 1000,
now + 60 * 1000,
);

const descendant = recentMessages
.filter(
(item) =>
trimString(item?.messageId) !== trimString(message?.messageId),
)
.sort(
(left, right) =>
Number(right?.createdAt || 0) - Number(left?.createdAt || 0),
)
.find((item) => messageReferencesAnyId(item, anchorIds));

if (!descendant) {
return null;
}

return findBindingForMessage(descendant, {
source: "findBindingViaVisibleFeishuDescendant",
});
} catch (error) {
console.warn(
"[portable-feishu] visible descendant binding lookup failed",
error,
);
return null;
}
}

function findGroupBindingForMessage(message) {
const chatId = trimString(message?.chatId);
if (!chatId) {
return null;
}

const binding = Object.values(readFeishuBindings()).find(
(candidate) =>
candidate &&
trimString(candidate.deliveryMode) === "group" &&
getBindingGroupChatId(candidate) === chatId &&
trimString(candidate.conversationId),
) || null;
if (binding) {
appendFeishuBindingLog("find-match", () => ({
source: "findGroupBindingForMessage",
matchedBy: "group-chat-id",
chatId,
message: summarizeParsedFeishuMessageForLog(message),
binding: summarizeFeishuBindingForLog(binding),
})).catch(() => {});
return binding;
}

appendFeishuBindingLog("find-miss", () => ({
source: "findGroupBindingForMessage",
chatId,
message: summarizeParsedFeishuMessageForLog(message),
})).catch(() => {});
return null;
}

function findPendingWorkspaceBindingForMessage(message) {
const bindings = Object.values(readFeishuBindings()).filter(isPendingWorkspaceBinding);
const candidateMessageIds = collectMessageCandidateIds(message);
for (const binding of bindings) {
const bindingMessageIds = [
trimString(binding?.rootMessageId),
trimString(binding?.threadRootMessageId),
trimString(binding?.entryMessageId),
...(Array.isArray(binding?.messageIdHistory) ?
binding.messageIdHistory.map((value) => trimString(value)) :
[]),
].filter(Boolean);
const matchedMessageId = bindingMessageIds.find((value) =>
candidateMessageIds.includes(value),
) || "";
if (!matchedMessageId) {
continue;
}

appendFeishuBindingLog("find-match", () => ({
source: "findPendingWorkspaceBindingForMessage",
matchedBy: "pending-workspace-anchor",
matchedMessageId,
candidateMessageIds,
message: summarizeParsedFeishuMessageForLog(message),
binding: summarizeFeishuBindingForLog(binding),
})).catch(() => {});
return binding;
}

appendFeishuBindingLog("find-miss", () => ({
source: "findPendingWorkspaceBindingForMessage",
candidateMessageIds,
message: summarizeParsedFeishuMessageForLog(message),
})).catch(() => {});
return null;
}

function isKnownFeishuDirectChat(chatId) {
const normalizedChatId = trimString(chatId);
if (!normalizedChatId) {
return false;
}

return Object.values(readFeishuDirectChats()).some(
(chat) => trimString(chat?.chatId) === normalizedChatId,
);
}

function readPortableBridgeRouteInfo() {
if (typeof window === "undefined") {
return {
pathname: "",
initialRoute: "",
};
}

const url = new URL(window.location.href);
const metaInitialRoute =
typeof document !== "undefined" ?
trimString(
document
.querySelector("meta[name='initial-route']")
?.getAttribute("content"),
) :
"";

return {
pathname: trimString(url.pathname),
initialRoute: trimString(
url.searchParams.get("initialRoute") || metaInitialRoute,
),
};
}

function isPortableBridgeDisabledRoute(route) {
const normalizedRoute = trimString(route);
if (!normalizedRoute) {
return false;
}

return FEISHU_BRIDGE_DISABLED_ROUTE_PREFIXES.some(
(prefix) =>
normalizedRoute === prefix || normalizedRoute.startsWith(`${prefix}/`),
);
}

function shouldEnablePortableFeishuBridge() {
const {
pathname,
initialRoute
} = readPortableBridgeRouteInfo();
return (
!isPortableBridgeDisabledRoute(pathname) &&
!isPortableBridgeDisabledRoute(initialRoute)
);
}

function appendPortableFeishuRegistryLog(event, detail = {}) {}

function getErrorText(error) {
if (error instanceof Error) {
const message = sanitizeInlineText(error.message);
if (
message === "Please continue this conversation on the window where it was started."
) {
return "当前无法直接从飞书继续这个会话。请在桌面端重新打开，或重新选择工作区后再试。";
}

return message || "未知错误";
}

return sanitizeInlineText(String(error || "")) || "未知错误";
}

function getPortableConversationRoutingState(manager, conversationId) {
const normalizedConversationId = trimString(conversationId);
const conversation =
normalizedConversationId &&
typeof manager?.getConversation === "function" ?
manager.getConversation(normalizedConversationId) :
null;
const streamRole =
normalizedConversationId &&
typeof manager?.getStreamRole === "function" ?
manager.getStreamRole(normalizedConversationId) :
null;
return {
resumeState: trimString(conversation?.resumeState),
streamRole: trimString(streamRole?.role),
isStreaming: normalizedConversationId &&
typeof manager?.isConversationStreaming === "function" ?
Boolean(manager.isConversationStreaming(normalizedConversationId)) : false,
};
}

function logFeishuContinuationTrace(event, payload = {}) {
if (!isFeishuDebugLoggingEnabled()) {
return;
}
}

function assertPortableConversationReadyForFeishuTurn(manager, conversationId) {
const state = getPortableConversationRoutingState(manager, conversationId);
if (state.streamRole === "owner" && state.isStreaming) {
return state;
}

if (
state.streamRole === "follower" &&
state.isStreaming &&
typeof manager?.sendThreadFollowerRequest === "function"
) {
return state;
}

throw new Error(
"This conversation cannot currently continue directly from Feishu. Reopen it on the desktop or select the workspace again, then try again.",
);
}

function getActivePortableTurnId(manager, conversationId) {
const normalizedConversationId = trimString(conversationId);
const conversation =
normalizedConversationId &&
typeof manager?.getConversation === "function" ?
manager.getConversation(normalizedConversationId) :
null;
const latestTurn = getLatestConversationTurn(conversation);
if (trimString(latestTurn?.status) !== "inProgress") {
return "";
}

return trimString(latestTurn?.turnId);
}

function createFeishuPollWorkerId(manager) {
const hostId = getManagerHostId(manager) || "local";
const suffix =
typeof crypto?.randomUUID === "function" ?
crypto.randomUUID() :
`${Date.now()}-${Math.random().toString(16).slice(2)}`;
return `feishu-poller:${hostId}:${suffix}`;
}

function getPendingWorkspaceConversationId(cwd, hostId = "") {
const suffix =
typeof crypto?.randomUUID === "function" ?
crypto.randomUUID() :
`${Date.now()}-${Math.random().toString(16).slice(2)}`;
return `${PENDING_WORKSPACE_CONVERSATION_PREFIX}${cwd}:${trimString(hostId)}:${suffix}`;
}

function isPendingWorkspaceBinding(binding) {
return trimString(binding?.pendingWorkspaceCwd).length > 0;
}

function createDirectRoutePromptBatchId(sourceMessage = null) {
const messageId = trimString(sourceMessage?.messageId);
const suffix =
typeof crypto?.randomUUID === "function" ?
crypto.randomUUID() :
`${Date.now()}-${Math.random().toString(16).slice(2)}`;
return `direct-route-prompt:${messageId || "manual"}:${suffix}`;
}

function buildDirectRoutePromptPatch(batchId, sourceMessage, result) {
return {
directRoutePromptBatchId: trimString(batchId),
directRoutePromptMessageId: trimString(result?.messageId),
directRoutePromptSourceMessageId: trimString(sourceMessage?.messageId),
directRoutePromptCreatedAt: Date.now(),
};
}

function clearDirectRoutePromptPatch() {
return {
directRoutePromptBatchId: "",
directRoutePromptMessageId: "",
directRoutePromptSourceMessageId: "",
directRoutePromptCreatedAt: 0,
};
}

function collectDirectRoutePromptCleanupTargets(message, selectedBinding = null) {
const bindings = Object.values(readFeishuBindings());
const selectedConversationId = trimString(selectedBinding?.conversationId);
const selectedPromptMessageId = trimString(
selectedBinding?.directRoutePromptMessageId,
);
const messageId = trimString(message?.messageId);
const chatId = trimString(message?.chatId);
const sourceMessageId = trimString(message?.rootId || message?.parentId);
const batches = new Set();

if (selectedBinding?.directRoutePromptBatchId) {
batches.add(trimString(selectedBinding.directRoutePromptBatchId));
}

for (const binding of bindings) {
const promptBatchId = trimString(binding?.directRoutePromptBatchId);
if (!promptBatchId) {
continue;
}

const promptChatId = trimString(binding?.chatId);
const promptSourceMessageId = trimString(
binding?.directRoutePromptSourceMessageId,
);
const sameChat = chatId && promptChatId && promptChatId === chatId;
const sameSource =
sourceMessageId &&
promptSourceMessageId &&
promptSourceMessageId === sourceMessageId;

if (sameChat || sameSource) {
batches.add(promptBatchId);
}
}

const targets = [];
const seenPromptMessageIds = new Set();
for (const binding of bindings) {
const promptBatchId = trimString(binding?.directRoutePromptBatchId);
const promptMessageId = trimString(binding?.directRoutePromptMessageId);
if (!promptBatchId || !promptMessageId || !batches.has(promptBatchId)) {
continue;
}

const keepSelected =
selectedConversationId &&
trimString(binding?.conversationId) === selectedConversationId &&
promptMessageId === selectedPromptMessageId &&
messageId &&
messageId !== promptMessageId;
if (keepSelected) {
continue;
}

if (seenPromptMessageIds.has(promptMessageId)) {
continue;
}

seenPromptMessageIds.add(promptMessageId);
targets.push({
conversationId: trimString(binding?.conversationId),
messageId: promptMessageId,
batchId: promptBatchId,
});
}

return targets;
}

async function cleanupDirectRoutePromptMessages(config, message, selectedBinding = null) {
const targets = collectDirectRoutePromptCleanupTargets(message, selectedBinding);
if (targets.length === 0) {
return;
}

const bindings = readFeishuBindings();
let changed = false;
for (const [conversationId, binding] of Object.entries(bindings)) {
if (!binding || typeof binding !== "object") {
continue;
}

const promptBatchId = trimString(binding.directRoutePromptBatchId);
const promptMessageId = trimString(binding.directRoutePromptMessageId);
const shouldClear = targets.some(
(target) =>
target.batchId === promptBatchId &&
target.messageId === promptMessageId,
);
if (!shouldClear) {
continue;
}

bindings[conversationId] = {
...binding,
...clearDirectRoutePromptPatch(),
updatedAt: Date.now(),
};
changed = true;
}

if (changed) {
writeFeishuBindings(bindings);
}
}

function deleteFeishuBinding(conversationId) {
const key = trimString(conversationId);
if (!key) {
return;
}

disposeFeishuStreamState(key);

const bindings = readFeishuBindings();
if (!Object.prototype.hasOwnProperty.call(bindings, key)) {
appendFeishuBindingLog("delete-skip-missing", () => ({
source: "deleteFeishuBinding",
conversationId: key,
})).catch(() => {});
return;
}

appendFeishuBindingLog("delete", () => ({
source: "deleteFeishuBinding",
conversationId: key,
binding: summarizeFeishuBindingForLog(bindings[key]),
})).catch(() => {});
delete bindings[key];
writeFeishuBindings(bindings);
}

function buildActiveFeishuRequestPatch(message, fallbackChatId = "") {
return {
activeRequestMessageId: trimString(message?.messageId),
activeRequestChatId: trimString(message?.chatId || fallbackChatId),
activeRequestCreatedAt: Number(message?.createdAt) || Date.now(),
};
}

function setActiveFeishuRequest(conversationId, message, fallbackChatId = "") {
const key = trimString(conversationId);
if (!key) {
return null;
}

return upsertFeishuBinding({
conversationId: key,
...buildActiveFeishuRequestPatch(message, fallbackChatId),
}, {
source: "setActiveFeishuRequest",
});
}

function clearActiveFeishuRequest(conversationId) {
const key = trimString(conversationId);
if (!key) {
return null;
}

const bindings = readFeishuBindings();
if (!Object.prototype.hasOwnProperty.call(bindings, key)) {
appendFeishuBindingLog("clear-active-request-skip-missing", () => ({
source: "clearActiveFeishuRequest",
conversationId: key,
})).catch(() => {});
return null;
}

const previousBinding = bindings[key];
bindings[key] = {
...bindings[key],
activeRequestMessageId: "",
activeRequestChatId: "",
activeRequestCreatedAt: 0,
updatedAt: Date.now(),
};
writeFeishuBindings(bindings);
appendFeishuBindingLog("clear-active-request", () => ({
source: "clearActiveFeishuRequest",
conversationId: key,
previousBinding: summarizeFeishuBindingForLog(previousBinding),
nextBinding: summarizeFeishuBindingForLog(bindings[key]),
})).catch(() => {});
return bindings[key];
}

function clearFeishuStreamBinding(conversationId) {
const key = trimString(conversationId);
if (!key) {
return null;
}

return upsertFeishuBinding({
conversationId: key,
streamCardId: "",
streamCardSequence: 0,
streamMessageId: "",
streamTurnId: "",
streamReplyTargetMessageId: "",
streamReplyTargetTurnId: "",
}, {
source: "clearFeishuStreamBinding",
});
}

function getFeishuStreamState(conversationId) {
const key = trimString(conversationId);
if (!key) {
return null;
}

if (!FEISHU_STREAM_STATES.has(key)) {
FEISHU_STREAM_STATES.set(key, {
timerId: 0,
inFlight: false,
needsResync: false,
immediateResync: false,
completedTurnId: "",
streamStartedAtMs: 0,
lastSentAt: 0,
lastPayloadKey: "",
lastStatusText: "",
lastStatusSecondaryText: "",
lastPhaseText: "",
lastLoadingVisualKey: "",
usedStructuredCard: false,
lastMissingTurnIdLogAt: 0,
missingTurnIdRetryCount: 0,
uploadedImages: new Map(),
manager: null,
config: null,
});
}

return FEISHU_STREAM_STATES.get(key) || null;
}

function disposeFeishuStreamState(conversationId) {
const key = trimString(conversationId);
if (!key) {
return;
}

const state = FEISHU_STREAM_STATES.get(key);
if (!state) {
return;
}

if (state.timerId) {
window.clearTimeout(state.timerId);
}

FEISHU_STREAM_STATES.delete(key);
}

function getConversationTurnCompletionAnchorMs(
conversation,
turn,
binding = null,
) {
return pickFirstFeishuTimestampMs(
turn?.updatedAtMs,
turn?.updated_at_ms,
turn?.updatedAt,
turn?.updated_at,
turn?.completedAtMs,
turn?.completed_at_ms,
turn?.completedAt,
turn?.completed_at,
conversation?.updatedAt,
binding?.updatedAt,
binding?.activeRequestCreatedAt,
);
}

function shouldBackfillRecentCompletedConversationGroup(binding, conversation, latestTurn) {
const hasBinding = Boolean(binding && typeof binding === "object");
const hasGroupBinding =
trimString(binding?.deliveryMode) === "group" &&
trimString(binding?.groupChatId);
if (hasGroupBinding) {
return false;
}

if (trimString(latestTurn?.status) !== "completed") {
return false;
}

const completionAnchorMs = getConversationTurnCompletionAnchorMs(
conversation,
latestTurn,
binding,
);
if (completionAnchorMs <= 0) {
return false;
}

if (
hasBinding &&
trimString(binding?.deliveryMode) &&
trimString(binding?.deliveryMode) !== "group"
) {
return false;
}

return Date.now() - completionAnchorMs <= 15000;
}

function getFeishuMessageCreatedAtSeconds(message) {
const createdAtMs = normalizeFeishuTimestampMs(message?.createdAt);
return createdAtMs > 0 ? Math.floor(createdAtMs / 1000) : 0;
}

function getFeishuMessageCreatedAtMs(message) {
return normalizeFeishuTimestampMs(message?.createdAt);
}

function listFeishuAppChatIds(
config,
bindings = Object.values(readFeishuBindings()),
) {
const directChats = Object.values(readFeishuDirectChats());
return [
...new Set(
[...bindings.flatMap((binding) => [
trimString(binding?.chatId),
trimString(binding?.activeRequestChatId),
]), ...directChats.map((chat) => trimString(chat?.chatId))]
.map((value) => trimString(value))
.filter(Boolean),
),
];
}

function hasFeishuBindingPendingActivity(binding) {
return Boolean(
trimString(binding?.activeRequestMessageId) ||
trimString(binding?.activeRequestChatId) ||
Number(binding?.activeRequestCreatedAt) > 0 ||
trimString(binding?.replyToMessageId) ||
trimString(binding?.streamCardId) ||
trimString(binding?.streamMessageId) ||
trimString(binding?.streamTurnId) ||
trimString(binding?.streamReplyTargetMessageId) ||
trimString(binding?.streamReplyTargetTurnId),
);
}

function primeFeishuActivationBaseline(
manager,
config,
activatedAtMs = Date.now(),
) {
if (!manager || !config?.enabled || config.mode !== "app" || !config.isAppReady) {
return;
}

const hostId = trimString(getManagerHostId(manager));
const bindingsByConversationId = readFeishuBindings();
const bindings = Object.values(bindingsByConversationId).filter(
(binding) => binding && shouldHandleBindingForManager(binding, manager),
);
const candidateConversationIds = new Set([
...bindings
.map((binding) => trimString(binding?.conversationId))
.filter(Boolean),
...listManagerTrackedConversationIds(manager),
]);
let primedConversationCount = 0;
let clearedConversationCount = 0;

for (const conversationId of candidateConversationIds) {
const binding = bindingsByConversationId[conversationId] || null;
const conversation =
typeof manager?.getConversation === "function" ?
manager.getConversation(conversationId) :
null;
const latestTurn = getLatestConversationTurn(conversation);
if (trimString(latestTurn?.status) !== "completed") {
continue;
}

const turnId = trimString(latestTurn?.turnId);
if (!turnId) {
continue;
}

const completionAnchorMs = getConversationTurnCompletionAnchorMs(
conversation,
latestTurn,
binding,
);
if (completionAnchorMs > 0 && completionAnchorMs > activatedAtMs) {
continue;
}

const nextTitle =
getConversationTaskTitle(manager, conversationId, conversation) ||
trimString(binding?.title);
const nextCwd = trimString(conversation?.cwd || binding?.cwd || "");
const hadPendingActivity = hasFeishuBindingPendingActivity(binding);
const needsUpdate = !binding ||
trimString(binding?.lastTurnId) !== turnId ||
(!trimString(binding?.hostId) && hostId) ||
(nextCwd && nextCwd !== trimString(binding?.cwd)) ||
(nextTitle && nextTitle !== trimString(binding?.title)) ||
hadPendingActivity;

if (!needsUpdate) {
continue;
}

upsertFeishuBinding({
conversationId,
hostId: trimString(binding?.hostId) || hostId,
cwd: nextCwd,
title: nextTitle,
lastTurnId: turnId,
activeRequestMessageId: "",
activeRequestChatId: "",
activeRequestCreatedAt: 0,
replyToMessageId: null,
streamCardId: "",
streamCardSequence: 0,
streamMessageId: "",
streamTurnId: "",
streamReplyTargetMessageId: "",
streamReplyTargetTurnId: "",
}, {
source: "primeFeishuActivationBaseline",
});
disposeFeishuStreamState(conversationId);
primedConversationCount += 1;
if (hadPendingActivity) {
clearedConversationCount += 1;
}
}

const cursorSeconds = Math.floor(Math.max(activatedAtMs, Date.now()) / 1000);
let primedChatCount = 0;
for (const chatId of listFeishuAppChatIds(config, bindings)) {
FEISHU_POLL_BASELINE_MS_BY_CHAT.set(chatId, activatedAtMs);
setFeishuPollCursorByHost(chatId, cursorSeconds).catch((error) => {
console.warn("[portable-feishu] activation poll cursor write failed", error);
});
primedChatCount += 1;
}
appendFeishuBindingLog("activation-baseline-primed", () => ({
source: "primeFeishuActivationBaseline",
hostId,
activatedAtMs,
primedConversationCount,
clearedConversationCount,
primedChatCount,
})).catch(() => {});
}

function getFeishuItemsStartedAtMs(turn) {
if (!Array.isArray(turn?.items) || turn.items.length === 0) {
return 0;
}

let earliest = 0;
for (const item of turn.items) {
if (!item || typeof item !== "object") {
continue;
}

const timestampMs = pickFirstFeishuTimestampMs(
item.startedAtMs,
item.started_at_ms,
item.startedAt,
item.started_at,
item.createdAtMs,
item.created_at_ms,
item.createdAt,
item.created_at,
item.timestampMs,
item.timestamp,
);
if (timestampMs > 0 && (earliest === 0 || timestampMs < earliest)) {
earliest = timestampMs;
}
}

return earliest;
}

function getFeishuTurnStartedAtMs(turn, options = {}) {
const conversation = options.conversation;
const binding = options.binding;
const fallbackStartedAtMs = options.fallbackStartedAtMs;

const directStartedAtMs = pickFirstFeishuTimestampMs(
turn?.turnStartedAtMs,
turn?.startedAtMs,
turn?.started_at_ms,
turn?.startTimeMs,
turn?.turnStartedAt,
turn?.startedAt,
turn?.started_at,
turn?.startTime,
turn?.createdAtMs,
turn?.created_at_ms,
turn?.createdAt,
turn?.created_at,
);
if (directStartedAtMs > 0) {
return directStartedAtMs;
}

const itemStartedAtMs = getFeishuItemsStartedAtMs(turn);
if (itemStartedAtMs > 0) {
return itemStartedAtMs;
}

const conversationStartedAtMs = pickFirstFeishuTimestampMs(
conversation?.firstTurnWorkItemStartedAtMs,
conversation?.startedAtMs,
conversation?.startedAt,
);
if (conversationStartedAtMs > 0) {
return conversationStartedAtMs;
}

return pickFirstFeishuTimestampMs(
binding?.activeRequestCreatedAt,
fallbackStartedAtMs,
);
}

function getFeishuStreamSequence(binding) {
const sequence = Number(binding?.streamCardSequence);
if (Number.isFinite(sequence) && sequence > 0) {
return Math.floor(sequence);
}
return 1;
}

function shouldHandleBindingForManager(binding, manager) {
const bindingHostId = trimString(binding?.hostId);
if (!bindingHostId) {
return true;
}

return bindingHostId === getManagerHostId(manager);
}

function getBindingGroupChatId(binding) {
if (trimString(binding?.deliveryMode) !== "group") {
return "";
}

return trimString(binding?.groupChatId || binding?.chatId);
}

function getBindingConversationChatId(config, binding, message = null) {
const groupChatId = getBindingGroupChatId(binding);
if (groupChatId) {
return groupChatId;
}

return trimString(message?.chatId || binding?.chatId);
}

function getPortablePathBaseName(value) {
const normalized = trimString(value).replace(/[\\/]+$/, "");
if (!normalized) {
return "";
}

const parts = normalized.split(/[\\/]+/).map((part) => trimString(part)).filter(Boolean);
return sanitizeInlineText(parts[parts.length - 1] || normalized);
}

function buildFeishuGroupName(title, cwd = "", options = {}) {
const normalizedTitle = sanitizeInlineText(title);
if (options?.showProjectNameInGroupTitle === false) {
return normalizedTitle || "Codex 会话";
}
const projectName = getPortablePathBaseName(cwd);
if (projectName && normalizedTitle && projectName !== normalizedTitle) {
return `${projectName} - ${normalizedTitle}`;
}

return normalizedTitle || projectName || "Codex 会话";
}

async function getFeishuGroupAvatarImageKey(config, binding, stateKey) {
const normalizedStateKey = trimString(stateKey);
const avatar = getFeishuGroupAvatarAsset(config, normalizedStateKey);
if (!avatar) {
return "";
}

const bindingKey =
normalizedStateKey === FEISHU_GROUP_AVATAR_STATE_KEYS.running ?
"groupRunningAvatarImageKey" :
"groupCompleteAvatarImageKey";
const bindingVersionKey =
normalizedStateKey === FEISHU_GROUP_AVATAR_STATE_KEYS.running ?
"groupRunningAvatarAssetVersion" :
"groupCompleteAvatarAssetVersion";
const cachedImageKey = trimString(binding?.[bindingKey]);
const cachedAssetVersion = trimString(binding?.[bindingVersionKey]);
if (
cachedImageKey &&
cachedAssetVersion === avatar.assetVersion
) {
return cachedImageKey;
}

const uploaded = await uploadFeishuAppImage(config, {
src: avatar.dataUrl,
mimeType: avatar.mimeType,
name: avatar.name,
imageType: "avatar",
});
const imageKey = trimString(uploaded?.imageKey);
if (!imageKey) {
throw new Error("Feishu avatar upload returned empty image key.");
}

upsertFeishuBinding({
conversationId: binding.conversationId,
[bindingKey]: imageKey,
[bindingVersionKey]: avatar.assetVersion,
}, {
source: "getFeishuGroupAvatarImageKey",
});
return imageKey;
}

async function setConversationGroupAvatarState(config, binding, stateKey) {
const conversationId = trimString(binding?.conversationId);
const chatId = trimString(binding?.chatId);
const normalizedStateKey = trimString(stateKey);
const bindingVersionKey =
normalizedStateKey === FEISHU_GROUP_AVATAR_STATE_KEYS.running ?
"groupRunningAvatarAssetVersion" :
"groupCompleteAvatarAssetVersion";
const avatar = getFeishuGroupAvatarAsset(config, normalizedStateKey);
const expectedAvatarAssetVersion = trimString(avatar?.assetVersion);
const currentAvatarAssetVersion = trimString(binding?.[bindingVersionKey]);
if (
!config?.isAppReady ||
!conversationId ||
!chatId ||
trimString(binding?.deliveryMode) !== "group" ||
(
trimString(binding?.groupAvatarState) === normalizedStateKey &&
currentAvatarAssetVersion === expectedAvatarAssetVersion
)
) {
return binding;
}

try {
const imageKey = await getFeishuGroupAvatarImageKey(
config,
binding,
normalizedStateKey,
);
if (!imageKey) {
return binding;
}

const updated = await updateAppGroupChat(config, chatId, {
avatar: imageKey,
});
return upsertFeishuBinding({
conversationId,
groupAvatarState: normalizedStateKey,
groupAvatarImageKey: trimString(updated?.avatar || imageKey),
groupAvatarAssetVersion: expectedAvatarAssetVersion,
}, {
source: "setConversationGroupAvatarState",
});
} catch (error) {return binding;
}
}

function buildOpenConversationGroupActions(binding) {
const groupChatId = getBindingGroupChatId(binding);
const directLink = groupChatId ?
`https://applink.feishu.cn/client/chat/open?openChatId=${encodeURIComponent(groupChatId)}` :
"";
const shareLink = trimString(binding?.groupShareLink);
const url = directLink || shareLink;
if (!url) {
return [];
}

return [{
tag: "button",
text: {
tag: "plain_text",
content: "打开会话群",
},
type: "primary",
url,
}];
}

function buildOpenConversationGroupCard(binding) {
const title = sanitizeInlineText(binding?.title) || "Codex 会话";
const groupName = sanitizeInlineText(binding?.groupName) || title;
const actions = buildOpenConversationGroupActions(binding);

return {
config: {
wide_screen_mode: true,
},
header: {
template: "blue",
title: {
tag: "plain_text",
content: title,
},
},
elements: [{
tag: "div",
text: {
tag: "lark_md",
content: `已创建飞书会话群：${groupName}`,
},
}, ...(actions.length > 0 ? [{
tag: "action",
actions,
}] : [])],
};
}

function createDirectRouteConversationListCardPayload(items) {
const elements = [{
tag: "div",
text: {
tag: "lark_md",
    content: "选择要继续的会话群：",
},
}];

for (const item of items) {
const title = sanitizeInlineText(item?.title) || "Codex 会话";
const cwd = sanitizeInlineText(item?.cwd);
const actions = buildOpenConversationGroupActions(item?.binding);
elements.push({
tag: "div",
text: {
tag: "lark_md",
content: cwd ? `**${title}**\n${cwd}` : `**${title}**`,
},
});
if (actions.length > 0) {
elements.push({
tag: "action",
actions,
});
}
}

return {
config: {
wide_screen_mode: true,
},
header: {
template: "blue",
title: {
tag: "plain_text",
content: "Old Conversation",
},
},
elements,
};
}

async function ensureConversationGroupBinding(
manager,
config,
conversationId,
conversation = null,
binding = null,
options = {},
) {
const normalizedConversationId = trimString(conversationId);
if (!normalizedConversationId) {
return binding || null;
}

const existingLock = FEISHU_GROUP_BINDING_LOCKS.get(normalizedConversationId);
if (existingLock) {
try {
await existingLock;
} catch {}

const latestBinding = readFeishuBindings()[normalizedConversationId] || null;
const latestGroupChatId = getBindingGroupChatId(latestBinding);
if (latestGroupChatId) {
return latestBinding;
}
}

const lockPromise = ensureConversationGroupBindingUnlocked(
manager,
config,
normalizedConversationId,
conversation,
binding,
options,
);
FEISHU_GROUP_BINDING_LOCKS.set(normalizedConversationId, lockPromise);
try {
return await lockPromise;
} finally {
if (FEISHU_GROUP_BINDING_LOCKS.get(normalizedConversationId) === lockPromise) {
FEISHU_GROUP_BINDING_LOCKS.delete(normalizedConversationId);
}
}
}

async function ensureConversationGroupBindingUnlocked(
manager,
config,
conversationId,
conversation = null,
binding = null,
options = {},
) {
const normalizedConversationId = trimString(conversationId);
if (!normalizedConversationId) {
return binding || null;
}

const existingBinding = binding || readFeishuBindings()[normalizedConversationId] || {};
const existingGroupChatId = getBindingGroupChatId(existingBinding);
if (existingGroupChatId) {
const directChatSnapshot = Object.values(readFeishuDirectChats());
let existingGroupInfo = null;
let shouldRecreateExistingGroup = false;
try {
existingGroupInfo = await getAppGroupChat(config, existingGroupChatId);
shouldRecreateExistingGroup =
trimString(existingGroupInfo?.chatStatus) !== "normal" ||
Number(existingGroupInfo?.userCount) <= 0;} catch (error) {shouldRecreateExistingGroup = true;
}

if (shouldRecreateExistingGroup) {deleteFeishuBinding(normalizedConversationId);
binding = null;
}

if (!shouldRecreateExistingGroup) {const liveConversation =
conversation ||
(typeof manager?.getConversation === "function" ?
manager.getConversation(normalizedConversationId) :
null);
const title =
getConversationTaskTitle(manager, normalizedConversationId, liveConversation) ||
trimString(existingBinding.title);
const cwd = trimString(liveConversation?.cwd || existingBinding.cwd || "");
const expectedGroupName = buildFeishuGroupName(title, cwd, config);
if (
title &&
title !== trimString(existingBinding.title) ||
expectedGroupName !== trimString(existingBinding.groupName)
) {
try {
const updated = await updateAppGroupChat(
config,
existingGroupChatId, {
name: expectedGroupName
},
);
return upsertFeishuBinding({
conversationId: normalizedConversationId,
title,
groupName: trimString(updated?.name) || expectedGroupName,
}, {
source: "ensureConversationGroupBinding:update-name",
});
} catch (error) {}
}
return existingBinding;
}
}

const liveConversation =
conversation ||
(typeof manager?.getConversation === "function" ?
manager.getConversation(normalizedConversationId) :
null);
const title =
getConversationTaskTitle(manager, normalizedConversationId, liveConversation) ||
trimString(existingBinding.title);
const cwd = trimString(liveConversation?.cwd || existingBinding.cwd || "");
const groupName = buildFeishuGroupName(title, cwd, config);
const created = await createAppGroupChat(config, {
name: groupName,
userOpenId: config.appRecipientOpenId,
});let shareLink = "";
try {
shareLink = trimString(
(await createAppGroupShareLink(config, created.chatId))?.shareLink,
);
} catch (error) {}

const nextBinding = upsertFeishuBinding({
conversationId: normalizedConversationId,
hostId: trimString(existingBinding.hostId) ||
trimString(getManagerHostId(manager)),
cwd,
title,
deliveryMode: "group",
chatId: trimString(created.chatId),
groupChatId: trimString(created.chatId),
groupShareLink: shareLink,
groupName: trimString(created.name) || groupName,
}, {
source: "ensureConversationGroupBinding",
});

appendFeishuBindingLog("group-created", () => ({
source: "ensureConversationGroupBinding",
conversationId: normalizedConversationId,
chatId: trimString(created.chatId),
groupName: trimString(created.name) || groupName,
hasShareLink: Boolean(shareLink),
})).catch(() => {});

if (options.sendEntryCard !== false) {
try {
const entry = await sendAppCardNotification(
config,
buildOpenConversationGroupCard(nextBinding),
);
if (entry?.messageId) {
markFeishuMessageProcessed(entry.messageId);
upsertFeishuBinding({
conversationId: normalizedConversationId,
groupEntryMessageId: entry.messageId,
messageIdHistory: Array.isArray(entry.relatedMessageIds) ?
entry.relatedMessageIds : [],
}, {
source: "ensureConversationGroupBinding:entry-card",
});
}
} catch (error) {}
}

return nextBinding;
}

async function sendFeishuTextForBinding(config, binding, text, options = {}) {
const groupChatId = getBindingGroupChatId(binding);
if (groupChatId) {
try {
return await sendAppTextToChat(config, groupChatId, text, options);
} catch (error) {throw error;
}
}

throw new Error("Feishu conversation group chat id is missing.");
}

async function sendFeishuCardForBinding(config, binding, card) {
const groupChatId = getBindingGroupChatId(binding);
if (groupChatId) {
try {
return await sendAppCardToChat(config, groupChatId, card);
} catch (error) {throw error;
}
}

throw new Error("Feishu conversation group chat id is missing.");
}

async function sendFeishuCardKitForBinding(config, binding, cardId) {
const groupChatId = getBindingGroupChatId(binding);
if (groupChatId) {
try {
return await sendAppCardKitToChat(config, groupChatId, cardId);
} catch (error) {throw error;
}
}

throw new Error("Feishu conversation group chat id is missing.");
}

function formatMirroredGroupQuestionText(text) {
const normalizedText = trimString(text);
return normalizedText ? `问题：${normalizedText}` : "";
}

function extractExplicitTurnInputText(turn) {
const inputItems = Array.isArray(turn?.params?.input) ? turn.params.input : [];
const textParts = [];

for (const item of inputItems) {
if (!item || typeof item !== "object" || item.type !== "text") {
continue;
}

const text = trimString(item.text || item.content || "");
if (text) {
textParts.push(text);
}
}

return textParts.join("\n\n").trim();
}

async function mirrorInitialUserMessageToGroup(config, binding, text) {
const normalizedText = trimString(text);
const conversationId = trimString(binding?.conversationId);
const chatId = getBindingGroupChatId(binding);
if (
!conversationId ||
!chatId ||
!normalizedText ||
trimString(binding?.groupInitialUserMessageId)
) {
return binding;
}

const result = await sendAppTextToChat(config, chatId, formatMirroredGroupQuestionText(normalizedText), {
title: "",
});
if (result?.messageId) {
markFeishuMessageProcessed(result.messageId);
return upsertFeishuBinding({
conversationId,
groupInitialUserMessageId: result.messageId,
messageIdHistory: Array.isArray(result.relatedMessageIds) ?
result.relatedMessageIds : [],
}, {
source: "mirrorInitialUserMessageToGroup",
});
}

return binding;
}

async function mirrorDesktopTurnPromptToGroup(config, binding, turn, conversation = null) {
const conversationId = trimString(binding?.conversationId);
const chatId = getBindingGroupChatId(binding);
const turnId = trimString(turn?.turnId);
const activeRequestMessageId = trimString(binding?.activeRequestMessageId);
if (
!conversationId ||
!chatId ||
!turnId ||
activeRequestMessageId ||
trimString(binding?.groupUserMirrorTurnId) === turnId
) {
return binding;
}

const promptText = trimString(extractExplicitTurnInputText(turn));
if (!promptText) {return binding;
}

const result = await sendAppTextToChat(config, chatId, formatMirroredGroupQuestionText(promptText), {
title: "",
});
if (result?.messageId) {
markFeishuMessageProcessed(result.messageId);
return upsertFeishuBinding({
conversationId,
groupUserMirrorTurnId: turnId,
groupUserMirrorMessageId: result.messageId,
messageIdHistory: Array.isArray(result.relatedMessageIds) ?
result.relatedMessageIds : [],
}, {
source: "mirrorDesktopTurnPromptToGroup",
});
}

return binding;
}

async function ensureChoiceGroupBinding(config, choice, fallbackManager = null) {
if (!trimString(choice?.conversationId)) {
return readFeishuBindings()[trimString(choice?.conversationId)] || null;
}

const manager = choice.manager || fallbackManager;
const conversation =
typeof manager?.getConversation === "function" ?
manager.getConversation(choice.conversationId) :
null;
const existingBinding = readFeishuBindings()[trimString(choice.conversationId)] || {
conversationId: trimString(choice.conversationId),
hostId: trimString(choice.hostId),
cwd: trimString(choice.cwd),
title: trimString(choice.title),
chatId: trimString(choice.chatId),
rootMessageId: trimString(choice.rootMessageId),
};

return ensureConversationGroupBinding(
manager,
config,
choice.conversationId,
conversation,
existingBinding,
{
sendEntryCard: false,
},
);
}

async function syncFeishuStreamConversation(
manager,
config,
conversationId,
state,
) {
if (!config?.enabled || config.mode !== "app" || !config.isAppReady) {
return;
}

const binding = readFeishuBindings()[conversationId];
if (!binding || !shouldHandleBindingForManager(binding, manager)) {
return;
}

const conversation =
typeof manager?.getConversation === "function" ?
manager.getConversation(conversationId) :
null;
const latestTurn = getLatestConversationTurn(conversation);
if (latestTurn?.status !== "inProgress") {
if (trimString(binding?.streamMessageId) || trimString(binding?.streamCardId)) {}
if (trimString(latestTurn?.status) === "completed") {
const event = buildTurnCompletedEventFromSnapshot(
manager,
conversationId,
conversation,
{
fallbackTurnId: binding?.streamTurnId,
},
);
if (event) {
await finalizeFeishuTurnFromStream(manager, config, event);
} else if (trimString(binding?.streamMessageId) || trimString(binding?.streamCardId)) {}
}
if (trimString(latestTurn?.status) === "interrupted") {
const event = buildTurnInterruptedEventFromSnapshot(
manager,
conversationId,
conversation,
{
fallbackTurnId: binding?.streamTurnId,
},
);
if (event) {
await finalizeFeishuTurnFromStream(manager, config, event);
} else if (trimString(binding?.streamMessageId) || trimString(binding?.streamCardId)) {}
}
return;
}

const turnId = trimString(latestTurn?.turnId);
let latestBinding = binding;
const previousStreamMessageId = trimString(latestBinding.streamMessageId);
const previousStreamTurnId = trimString(latestBinding.streamTurnId);if (previousStreamMessageId && turnId && previousStreamTurnId !== turnId) {try {
await deleteAppMessage(config, previousStreamMessageId);
} catch (error) {
console.warn("[portable-feishu] stale stream message delete failed", error);
}
latestBinding = clearFeishuStreamBinding(conversationId) || {
...latestBinding,
streamCardId: "",
streamCardSequence: 0,
streamMessageId: "",
streamTurnId: "",
streamReplyTargetMessageId: "",
streamReplyTargetTurnId: "",
};
state.lastPayloadKey = "";
state.lastStatusText = "";
state.lastStatusSecondaryText = "";
state.lastPhaseText = "";
state.lastLoadingVisualKey = "";
state.usedStructuredCard = false;
}
const streamMessageId = trimString(latestBinding.streamMessageId);
const title = getConversationTaskTitle(manager, conversationId, conversation);
let replyTargetMessageId = "";
if (turnId && trimString(state.completedTurnId) === turnId) {disposeFeishuStreamState(conversationId);
return;
}
latestBinding = await ensureConversationGroupBinding(
manager,
config,
conversationId,
conversation,
latestBinding,
);
latestBinding = await setConversationGroupAvatarState(
config,
latestBinding,
FEISHU_GROUP_AVATAR_STATE_KEYS.running,
);
if (title && title !== trimString(latestBinding.title)) {
latestBinding = upsertFeishuBinding({
conversationId,
title,
});
}
latestBinding = await mirrorDesktopTurnPromptToGroup(
config,
latestBinding,
latestTurn,
conversation,
);
if (!turnId) {
const nowMs = Date.now();
if (
!state.lastMissingTurnIdLogAt ||
nowMs - state.lastMissingTurnIdLogAt > 2000
) {
state.lastMissingTurnIdLogAt = nowMs;}

if ((state.missingTurnIdRetryCount || 0) < 20) {
state.missingTurnIdRetryCount = (state.missingTurnIdRetryCount || 0) + 1;
state.lastSentAt = 0;
scheduleFeishuStreamSync(manager, config, conversationId);
}
return;
}

state.missingTurnIdRetryCount = 0;
state.lastMissingTurnIdLogAt = 0;
const streamCardTitle = "";
const loadingFrameIndex = getFeishuLoadingFrameIndex();
const loadingFallbackText = getFeishuLoadingFallbackText(loadingFrameIndex);
const loadingVisualKey = loadingFallbackText;
const turnStartedAtMs = getFeishuTurnStartedAtMs(latestTurn, {
conversation,
binding: latestBinding,
fallbackStartedAtMs: state.streamStartedAtMs,
});
if (turnStartedAtMs > 0) {
state.streamStartedAtMs = turnStartedAtMs;
}
const elapsedText = formatFeishuElapsedDuration(
turnStartedAtMs || state.streamStartedAtMs,
Date.now(),
);
const streamingStatus = buildStreamingStatus(
latestTurn,
loadingFallbackText,
elapsedText,
state.lastPhaseText || "思考中",
);
const statusText = streamingStatus.elapsedText;
const statusFooterText = streamingStatus.phaseText;
const renderedStream = await buildFeishuStreamCardSnapshot(
config,
conversation,
turnId,
state, {
title: streamCardTitle,
summaryText: "处理中...",
summaryTextEn: "处理中...",
statusText,
statusFooterText,
variant: "streaming",
},
);
const displayText = renderedStream.displayText;
const structuredContentBlocks = renderedStream.contentBlocks;
const structuredContentSegments = renderedStream.contentSegments;

const payloadKey =
`${turnId}\n${statusText}\n${statusFooterText}\n${JSON.stringify(structuredContentSegments)}\n${JSON.stringify(structuredContentBlocks)}\n${displayText}`;
if (payloadKey === state.lastPayloadKey && streamMessageId) {
return;
}

let didUpdate = false;

try {
const postRenderBinding = readFeishuBindings()[conversationId] || latestBinding;
if (
turnId &&
(trimString(state.completedTurnId) === turnId ||
trimString(postRenderBinding?.lastTurnId) === turnId)
) {disposeFeishuStreamState(conversationId);
return;
}
latestBinding = postRenderBinding;
let streamCardId = trimString(latestBinding.streamCardId);
let currentStreamMessageId = trimString(latestBinding.streamMessageId);
replyTargetMessageId = "";

if (!streamCardId && currentStreamMessageId) {
throw new Error("Stream is already using interactive fallback.");
}

if (!streamCardId) {
const created = await createAppCardKitCard(
config,
renderedStream.card,
);
streamCardId = trimString(created?.cardId);
if (!streamCardId) {
throw new Error("CardKit card_id is missing.");
}

try {
await setAppCardKitStreamingMode(config, streamCardId, true, 1);
} catch (error) {
await logFeishuCardKitEvent("feishu-cardkit-streaming-mode-failed", () => ({
conversationId,
cardId: streamCardId,
error: getErrorText(error),
}));
}

latestBinding = upsertFeishuBinding({
conversationId,
streamCardId,
streamCardSequence: 1,
});
await logFeishuCardKitEvent("feishu-cardkit-created", () => ({
conversationId,
cardId: streamCardId,
}));
}

if (!currentStreamMessageId) {
const result = replyTargetMessageId ?
await replyAppCardKitNotification(
config,
replyTargetMessageId,
streamCardId,
) :
await sendFeishuCardKitForBinding(config, latestBinding, streamCardId);
if (!result?.messageId) {
throw new Error("CardKit stream message id is missing.");
}

latestBinding = upsertFeishuBinding({
conversationId,
streamCardId,
streamCardSequence: getFeishuStreamSequence(latestBinding),
streamMessageId: result.messageId,
streamTurnId: turnId,
streamReplyTargetMessageId: replyTargetMessageId,
chatId: result.chatId || latestBinding.chatId || binding.chatId || "",
messageIdHistory: Array.isArray(result?.relatedMessageIds) ?
result.relatedMessageIds : [],
});
currentStreamMessageId = result.messageId;
await logFeishuCardKitEvent("feishu-cardkit-message-sent", () => ({
conversationId,
cardId: streamCardId,
streamMessageId: currentStreamMessageId,
replyTargetMessageId,
}));
}

const nextSequence = getFeishuStreamSequence(latestBinding) + 1;
const hasSingleStreamingTextBlock =
structuredContentSegments.length === 1 &&
structuredContentSegments[0]?.type === "text";
const needsFullCardUpdate =
state.usedStructuredCard ||
!hasSingleStreamingTextBlock ||
state.lastStatusText !== statusText ||
state.lastStatusSecondaryText !== statusFooterText ||
state.lastLoadingVisualKey !== loadingVisualKey;

if (needsFullCardUpdate) {
await updateAppCardKitCard(
config,
streamCardId,
renderedStream.card,
nextSequence,
);
} else {
await streamAppCardKitElement(
config,
streamCardId,
FEISHU_CARDKIT_STREAM_ELEMENT_ID,
displayText,
nextSequence,
);
}
state.usedStructuredCard = !hasSingleStreamingTextBlock;
state.lastStatusText = statusText;
state.lastStatusSecondaryText = statusFooterText;
state.lastPhaseText =
trimString(
buildStreamingPhaseText(latestTurn, state.lastPhaseText || "思考中"),
) || "思考中";
state.lastLoadingVisualKey = loadingVisualKey;

latestBinding = upsertFeishuBinding({
conversationId,
streamCardId,
streamCardSequence: nextSequence,
streamMessageId: currentStreamMessageId,
streamTurnId: turnId,
streamReplyTargetMessageId: replyTargetMessageId,
chatId: latestBinding.chatId || binding.chatId || "",
});
didUpdate = true;
} catch (cardKitError) {
console.warn("[portable-feishu] CardKit stream sync failed", cardKitError);
await logFeishuCardKitEvent("feishu-cardkit-sync-failed", () => ({
conversationId,
cardId: trimString(latestBinding?.streamCardId),
streamMessageId: trimString(latestBinding?.streamMessageId),
replyTargetMessageId,
error: getErrorText(cardKitError),
}));

const card = buildFeishuCardKitCompleteCard(displayText, {
title: streamCardTitle,
statusText,
statusFooterText,
contentBlocks: structuredContentBlocks,
contentSegments: structuredContentSegments,
});
const currentStreamMessageId = trimString(latestBinding.streamMessageId);

if (!currentStreamMessageId) {
const result = replyTargetMessageId ?
await replyAppCardNotification(config, replyTargetMessageId, card) :
await sendFeishuCardForBinding(config, latestBinding, card);
if (!result?.messageId) {
return;
}

latestBinding = upsertFeishuBinding({
conversationId,
streamCardId: "",
streamCardSequence: 0,
streamMessageId: result.messageId,
streamTurnId: turnId,
streamReplyTargetMessageId: replyTargetMessageId,
chatId: result.chatId || latestBinding.chatId || binding.chatId || "",
messageIdHistory: Array.isArray(result?.relatedMessageIds) ?
result.relatedMessageIds : [],
});
await logFeishuCardKitEvent("feishu-cardkit-fallback-message-sent", () => ({
conversationId,
streamMessageId: result.messageId,
replyTargetMessageId,
}));
} else {
await updateAppCardNotification(config, currentStreamMessageId, card);
latestBinding = upsertFeishuBinding({
conversationId,
streamCardId: "",
streamCardSequence: 0,
streamMessageId: currentStreamMessageId,
streamTurnId: turnId,
streamReplyTargetMessageId: replyTargetMessageId,
});
await logFeishuCardKitEvent("feishu-cardkit-fallback-message-updated", () => ({
conversationId,
streamMessageId: currentStreamMessageId,
}));
}
state.usedStructuredCard =
structuredContentSegments.length !== 1 ||
structuredContentSegments[0]?.type !== "text";
state.lastStatusText = statusText;
state.lastStatusSecondaryText = statusFooterText;
state.lastPhaseText =
trimString(
buildStreamingPhaseText(latestTurn, state.lastPhaseText || "思考中"),
) || "思考中";
state.lastLoadingVisualKey = loadingVisualKey;
didUpdate = true;
}

if (!didUpdate) {
return;
}

state.lastPayloadKey = payloadKey;
state.lastSentAt = Date.now();

if (latestTurn?.status === "inProgress") {
scheduleFeishuStreamSync(manager, config, conversationId);
}
}

async function flushFeishuStreamSync(conversationId) {
const key = trimString(conversationId);
const state = FEISHU_STREAM_STATES.get(key);
if (!state || state.inFlight) {
if (state) {
state.needsResync = true;
}
return;
}

state.inFlight = true;try {
await syncFeishuStreamConversation(state.manager, state.config, key, state);
} catch (error) {
console.warn("[portable-feishu] stream sync failed", error);
} finally {
state.inFlight = false;if (FEISHU_STREAM_STATES.get(key) !== state) {
return;
}
if (state.needsResync) {
const immediate = state.immediateResync === true;
state.needsResync = false;
state.immediateResync = false;
scheduleFeishuStreamSync(state.manager, state.config, key, immediate);
}
}
}

function scheduleFeishuStreamSync(
manager,
config,
conversationId,
immediate = false,
) {
const state = getFeishuStreamState(conversationId);
if (!state) {
return;
}

state.manager = manager;
state.config = config;
if (state.inFlight) {
state.needsResync = true;
state.immediateResync = state.immediateResync || immediate;
return;
}

if (state.timerId) {
if (!immediate) {
return;
}

window.clearTimeout(state.timerId);
state.timerId = 0;
}

const nowMs = Date.now();
const elapsed = nowMs - state.lastSentAt;
const loadingDelay = getFeishuNextLoadingFrameDelay(nowMs);
const delay = immediate ?
0 :
Math.min(
Math.max(0, FEISHU_STREAM_UPDATE_INTERVAL_MS - elapsed),
loadingDelay,
);

state.timerId = window.setTimeout(() => {
state.timerId = 0;
flushFeishuStreamSync(conversationId).catch((error) => {
console.warn("[portable-feishu] stream flush failed", error);
});
}, delay);
}

function buildSteerRestoreMessage(manager, binding) {
const conversation =
typeof manager?.getConversation === "function" ?
manager.getConversation(binding.conversationId) :
null;
const cwd = trimString(binding.cwd || conversation?.cwd) || "/";

return {
cwd,
pausedReason: null,
context: {
workspaceRoots: [cwd],
collaborationMode: conversation?.latestCollaborationMode || null,
commentAttachments: [],
},
};
}

async function steerConversationFromFeishu(manager, config, binding, message) {
await withResolvedFeishuAttachments(
config,
binding,
message,
async (attachments) => {
const expectedTurnId = getActivePortableTurnId(manager, binding.conversationId);
if (!expectedTurnId) {
throw new Error("Cannot steer Feishu message without an active Codex turn id.");
}

upsertFeishuBinding({
conversationId: binding.conversationId,
replyToMessageId: message.messageId,
chatId: getBindingConversationChatId(config, binding, message),
});

await steerPortableConversationTurn(
manager,
binding.conversationId,
buildFeishuTurnInput(buildSteerGuidanceText(message.text), attachments),
buildSteerRestoreMessage(manager, binding),
[],
{
expectedTurnId,
},
);

setActiveFeishuRequest(
binding.conversationId,
message,
getBindingConversationChatId(config, binding, message),
);
scheduleFeishuStreamSync(manager, config, binding.conversationId, true);
},
);
}

async function queueConversationMessageFromFeishu(binding, message) {
appendFeishuBindingLog("queue-message", () => ({
source: "queueConversationMessageFromFeishu",
conversationId: trimString(binding?.conversationId),
binding: summarizeFeishuBindingForLog(binding),
message: summarizeParsedFeishuMessageForLog(message),
})).catch(() => {});
await enqueueFeishuConversationMessageByHost(binding.conversationId, {
messageId: message.messageId,
chatId: message.chatId || binding.chatId || "",
parentId: message.parentId || null,
rootId: message.rootId || null,
text: message.text,
senderId: message.senderId || "",
senderType: message.senderType || "",
createdAt: Number(message.createdAt) || Date.now(),
mentions: message.mentions === true,
});
}

async function withResolvedFeishuAttachments(
config,
binding,
message,
callback,
) {
let pendingImages = await takePendingFeishuImagesForMessageByHost(message);
let pendingImageSource = "message";

if (
pendingImages.length === 0 &&
trimString(binding?.pendingImageThreadKey)
) {
pendingImages = await takePendingFeishuImagesForThreadKeyByHost(
binding.pendingImageThreadKey,
);
if (pendingImages.length > 0) {
pendingImageSource = "binding-thread";
}
}

if (pendingImages.length === 0) {
return callback([]);
}

if (!config?.isAppReady) {
if (
pendingImageSource === "binding-thread" &&
trimString(binding?.pendingImageThreadKey)
) {
await restorePendingFeishuImagesForThreadKeyByHost(
binding.pendingImageThreadKey,
pendingImages,
);
} else {
await restorePendingFeishuImagesForMessageByHost(message, pendingImages);
}
throw new Error("Feishu app bot is not ready for image forwarding.");
}

try {
const attachments = [];
for (const imageRef of pendingImages) {
attachments.push(await resolveFeishuImageAttachment(config, imageRef));
}

const result = await callback(attachments);
if (trimString(binding?.conversationId)) {
upsertFeishuBinding({
conversationId: binding.conversationId,
pendingImageThreadKey: "",
}, {
source: "withResolvedFeishuAttachments:success-clear-thread",
});
}
return result;
} catch (error) {
if (trimString(binding?.conversationId)) {
upsertFeishuBinding({
conversationId: binding.conversationId,
pendingImageThreadKey: "",
}, {
source: "withResolvedFeishuAttachments:error-clear-thread",
});
}
throw error;
}
}

async function isFeishuMessageStillAvailable(config, message) {
const chatId = trimString(message?.chatId);
const messageId = trimString(message?.messageId);
if (!chatId || !messageId) {
return false;
}

const createdAtMs = Number(message?.createdAt) || Date.now();
const nowSeconds = Math.floor(Date.now() / 1000);
const startSeconds = Math.max(
0,
Math.floor(createdAtMs / 1000) - 6 * 60 * 60,
);

try {
const messages = await listAppChatMessages(
config,
chatId,
startSeconds,
nowSeconds,
);
return messages.some((entry) => trimString(entry?.messageId) === messageId);
} catch (error) {
console.warn(
"[portable-feishu] queued message availability check failed",
error,
);
return true;
}
}

async function interruptConversationForRecalledActiveRequest(
manager,
appRegistry,
config,
binding,
) {
const conversationId = trimString(binding?.conversationId);
const activeRequestMessageId = trimString(binding?.activeRequestMessageId);
if (
!conversationId ||
!activeRequestMessageId ||
isPendingWorkspaceBinding(binding)
) {
return;
}

const bindingManager = resolveManagerForConversation(
appRegistry,
manager,
conversationId,
binding.hostId,
);
if (!bindingManager) {
return;
}

if (!isPortableConversationTurnInProgress(bindingManager, conversationId)) {
clearActiveFeishuRequest(conversationId);
return;
}

if (typeof bindingManager.interruptConversation !== "function") {
console.warn(
"[portable-feishu] interruptConversation is unavailable for manager",
conversationId,
);
return;
}

const isAvailable = await isFeishuMessageStillAvailable(config, {
chatId: binding.activeRequestChatId || binding.chatId || "",
messageId: activeRequestMessageId,
createdAt: Number(binding.activeRequestCreatedAt) || Date.now(),
});
if (isAvailable) {
return;
}

try {
await bindingManager.interruptConversation(conversationId);
} catch (error) {
if (!isPortableConversationTurnInProgress(bindingManager, conversationId)) {
clearActiveFeishuRequest(conversationId);
return;
}
throw error;
}

clearActiveFeishuRequest(conversationId);
}

async function replyAndTrack(config, messageId, text) {
const result = await replyAppTextNotification(config, messageId, text);
if (result?.messageId) {
markFeishuMessageProcessed(result.messageId);
}
rememberFeishuDirectChat(result, "replyAndTrack");
return result;
}

async function sendDirectPromptTextAndTrack(config, text) {
const result = await sendAppTextNotification(config, text);
if (result?.messageId) {
markFeishuMessageProcessed(result.messageId);
}
rememberFeishuDirectChat(result, "sendDirectPromptTextAndTrack");
return result;
}

async function sendDirectRoutePrompt(
config,
conversationChoices,
workspaceChoices,
sourceMessage = null,
) {
const pendingImageThreadKey = getFeishuPendingImageThreadKey(sourceMessage);
const promptBatchId = createDirectRoutePromptBatchId(sourceMessage);
if (conversationChoices.length > 0) {
const conversationPromptItems = [];
for (const choice of conversationChoices) {
const promptTitle = formatDirectRouteConversationPromptTitle(choice);
const existingBinding = await ensureChoiceGroupBinding(config, choice);

if (pendingImageThreadKey && trimString(choice.conversationId)) {
upsertFeishuBinding({
conversationId: choice.conversationId,
pendingImageThreadKey,
}, {
source: "sendDirectRoutePrompt:pending-image-thread",
});
}

upsertFeishuBinding({
conversationId: choice.conversationId,
hostId: trimString(
choice.manager ? getManagerHostId(choice.manager) : "",
),
cwd: choice.cwd,
title: choice.title,
threadRootMessageId: trimString(existingBinding.threadRootMessageId || existingBinding.rootMessageId || choice.rootMessageId),
rootMessageId: trimString(existingBinding.rootMessageId || choice.rootMessageId),
entryMessageId: trimString(existingBinding.entryMessageId || choice.rootMessageId),
chatId: trimString(existingBinding.chatId || choice.chatId),
}, {
source: "sendDirectRoutePrompt:conversation-list-binding",
});
conversationPromptItems.push({
title: promptTitle,
cwd: choice.cwd,
binding: existingBinding,
});
}

if (conversationPromptItems.length > 0) {
const result = await sendAppCardNotification(
config,
createDirectRouteConversationListCardPayload(conversationPromptItems),
);
if (result?.messageId) {
markFeishuMessageProcessed(result.messageId);
}
rememberFeishuDirectChat(result, "sendDirectRoutePrompt:conversation-list");
}
}

if (workspaceChoices.length > 0) {
for (const choice of workspaceChoices) {
const pendingConversationId = getPendingWorkspaceConversationId(
choice.cwd,
choice.hostId,
);
const title = choice.label || choice.cwd;
const result = await sendDirectPromptTextAndTrack(
config,
`${title}\nReply here directly and I will create a new task in this workspace.`,
);

upsertFeishuBinding({
conversationId: pendingConversationId,
hostId: trimString(choice.hostId),
pendingWorkspaceCwd: choice.cwd,
title,
pendingImageThreadKey,
rootMessageId: result?.messageId || "",
entryMessageId: result?.messageId || "",
chatId: result?.chatId || "",
lastTurnId: "",
replyToMessageId: null,
...buildDirectRoutePromptPatch(promptBatchId, sourceMessage, result),
}, {
source: "sendDirectRoutePrompt:pending-workspace",
});
}
}
}

async function createConversationFromFeishu(
manager,
workspaceChoice,
messageText,
message,
options = {},
) {
const conversationId = await withResolvedFeishuAttachments(
options.config || null,
options.binding || null,
message,
(attachments) =>
startConversationWithManager(
manager,
workspaceChoice,
messageText,
attachments,
),
);

const rootMessageId = trimString(options.rootMessageId || message.messageId);
appendFeishuBindingLog("create-conversation", () => ({
source: "createConversationFromFeishu",
conversationId: trimString(conversationId),
rootMessageId,
message: summarizeParsedFeishuMessageForLog(message),
existingBinding: summarizeFeishuBindingForLog(options.binding || null),
workspaceChoice: {
cwd: trimString(workspaceChoice?.cwd),
label: trimString(workspaceChoice?.label),
},
})).catch(() => {});
let createdBinding = upsertFeishuBinding({
conversationId: trimString(conversationId),
hostId: getManagerHostId(manager),
cwd: workspaceChoice.cwd,
title: getConversationTaskTitle(manager, conversationId),
rootMessageId,
threadRootMessageId: rootMessageId,
entryMessageId: rootMessageId,
replyToMessageId: message.messageId,
chatId: message.chatId || "",
lastTurnId: "",
...clearDirectRoutePromptPatch(),
...buildActiveFeishuRequestPatch(message, message.chatId || ""),
}, {
source: "createConversationFromFeishu",
});
createdBinding = await ensureConversationGroupBinding(
manager,
options.config,
conversationId,
typeof manager?.getConversation === "function" ?
manager.getConversation(conversationId) :
null,
createdBinding,
);
createdBinding = await mirrorInitialUserMessageToGroup(
options.config,
createdBinding,
messageText,
);
scheduleFeishuStreamSync(
manager,
options.config || null,
conversationId,
true,
);
return conversationId;
}

async function routeDirectFeishuMessage(
manager,
appRegistry,
config,
message,
route,
) {const conversationChoices = listRecentConversationChoices(
appRegistry,
manager,
);
const workspaceChoices = await listActiveWorkspaceChoices(
appRegistry,
manager,
);

if (!route) {
await sendDirectRoutePrompt(
config,
selectDirectRoutePromptConversationChoices(
conversationChoices,
config.appDirectRouteRecentConversationLimit,
),
selectDirectRoutePromptWorkspaceChoices(
workspaceChoices,
config.appDirectRouteWorkspaceLimit,
),
message,
);
return;
}

if (!route.body) {
await replyAndTrack(
config,
message.messageId,
"请在目标后输入要处理的内容，例如 `@conversation:1 帮我继续`。",
);
return;
}

if (route.kind === DIRECT_FEISHU_KIND_CONVERSATION) {
const conversationChoice = resolveConversationChoice(
route.target,
conversationChoices,
);
if (!conversationChoice) {
await replyAndTrack(
config,
message.messageId,
"没有找到指定会话。请检查列表中的会话编号后重新发送。",
);
return;
}

const routeBinding = await ensureChoiceGroupBinding(config, conversationChoice, conversationChoice.manager || manager);
if (!routeBinding || trimString(routeBinding.deliveryMode) !== "group") {
throw new Error("Feishu conversation group binding is missing.");
}
await continueConversationFromFeishu(
conversationChoice.manager || manager,
routeBinding, {
...message,
text: route.body,
}, {
config,
queueWhileInProgress: true,
},
);
return;
}

const workspaceChoice = resolveWorkspaceChoice(
route.target,
workspaceChoices,
);
if (!workspaceChoice) {
await replyAndTrack(
config,
message.messageId,
"没有找到指定工作区。请检查列表中的工作区编号后重新发送。",
);
return;
}

await createConversationFromFeishu(
workspaceChoice.manager || manager,
workspaceChoice,
route.body,
message, {
config,
},
);
}

async function readFeishuConfigSnapshot() {
const keys = [
FEISHU_KEYS.enabled,
FEISHU_KEYS.mode,
FEISHU_KEYS.webhook,
FEISHU_KEYS.webhookSecret,
FEISHU_KEYS.appId,
FEISHU_KEYS.appSecret,
FEISHU_KEYS.appRecipientOpenId,
FEISHU_KEYS.appPollingIntervalSeconds,
FEISHU_KEYS.appDirectRouteRecentConversationLimit,
FEISHU_KEYS.appDirectRouteWorkspaceLimit,
FEISHU_KEYS.appConversationDeliveryMode,
FEISHU_KEYS.groupRunningAvatarDataUrl,
FEISHU_KEYS.groupCompleteAvatarDataUrl,
FEISHU_KEYS.showProjectNameInGroupTitle,
FEISHU_KEYS.debugLoggingEnabled,
FEISHU_KEYS.legacyWebhookEnabled,
FEISHU_KEYS.legacyWebhook,
FEISHU_KEYS.legacyWebhookSecret,
FEISHU_KEYS.legacyAppOpenId,
FEISHU_KEYS.legacyAppReceiveId,
FEISHU_KEYS.legacyAppReceiveIdType,
];
const values = await Promise.all(
keys.map((key) => readPortableGlobalStateValue(key).catch(() => undefined)),
);
return Object.fromEntries(keys.map((key, index) => [key, values[index]]));
}

function useFeishuConfig() {
const [snapshot, setSnapshot] = React.useState({});

React.useEffect(() => {
let disposed = false;
let lastSignature = "";

const applySnapshot = (nextSnapshot) => {
if (disposed || !nextSnapshot || typeof nextSnapshot !== "object") {
return;
}

const signature = createFeishuConfigSnapshotSignature(nextSnapshot);
if (signature !== lastSignature) {
lastSignature = signature;
setSnapshot(nextSnapshot);
}
};

const refresh = () => {
readFeishuConfigSnapshot().then((nextSnapshot) => {
applySnapshot(nextSnapshot);
}).catch(() => {});
};

const onSettingsChanged = (event) => {
applySnapshot(event?.detail);
};

const onVisibilityChange = () => {
if (document.visibilityState === "visible") {
refresh();
}
};

refresh();
window.addEventListener("codexpp-feishu-settings-changed", onSettingsChanged);
document.addEventListener("visibilitychange", onVisibilityChange);
const timerId = window.setInterval(
refresh,
FEISHU_CONFIG_REFRESH_INTERVAL_MS,
);

return () => {
disposed = true;
window.removeEventListener("codexpp-feishu-settings-changed", onSettingsChanged);
document.removeEventListener("visibilitychange", onVisibilityChange);
window.clearInterval(timerId);
};
}, []);

return React.useMemo(
() => {
const resolved = resolveFeishuSettings({
enabled: snapshot[FEISHU_KEYS.enabled],
mode: snapshot[FEISHU_KEYS.mode],
webhook: snapshot[FEISHU_KEYS.webhook],
webhookSecret: snapshot[FEISHU_KEYS.webhookSecret],
appId: snapshot[FEISHU_KEYS.appId],
appSecret: snapshot[FEISHU_KEYS.appSecret],
appRecipientOpenId: snapshot[FEISHU_KEYS.appRecipientOpenId],
appPollingIntervalSeconds: snapshot[FEISHU_KEYS.appPollingIntervalSeconds],
appDirectRouteRecentConversationLimit: snapshot[FEISHU_KEYS
.appDirectRouteRecentConversationLimit],
appDirectRouteWorkspaceLimit: snapshot[FEISHU_KEYS.appDirectRouteWorkspaceLimit],
appConversationDeliveryMode: snapshot[FEISHU_KEYS.appConversationDeliveryMode],
groupRunningAvatarDataUrl: snapshot[FEISHU_KEYS.groupRunningAvatarDataUrl],
groupCompleteAvatarDataUrl: snapshot[FEISHU_KEYS.groupCompleteAvatarDataUrl],
showProjectNameInGroupTitle: snapshot[FEISHU_KEYS.showProjectNameInGroupTitle],
debugLoggingEnabled: snapshot[FEISHU_KEYS.debugLoggingEnabled],
legacyWebhookEnabled: snapshot[FEISHU_KEYS.legacyWebhookEnabled],
legacyWebhook: snapshot[FEISHU_KEYS.legacyWebhook],
legacyWebhookSecret: snapshot[FEISHU_KEYS.legacyWebhookSecret],
legacyAppOpenId: snapshot[FEISHU_KEYS.legacyAppOpenId],
legacyAppReceiveId: snapshot[FEISHU_KEYS.legacyAppReceiveId],
legacyAppReceiveIdType: snapshot[FEISHU_KEYS.legacyAppReceiveIdType],
});
configureFeishuDebugLogging(resolved.debugLoggingEnabled);
return resolved;
},
[snapshot],
);
}

async function finalizeFeishuTurnFromStream(manager, config, event) {
const bindings = readFeishuBindings();
let existingBinding = bindings[event.conversationId] || {};
clearActiveFeishuRequest(event.conversationId);

if (!config.enabled || config.mode === "off") {return;
}

const summary = extractTurnSummary(event);
const hasExplicitSummary = trimString(
event?.lastAgentMessage ||
event?.heartbeatAssistantMessage?.notificationMessage ||
event?.heartbeatAssistantMessage?.visibleText,
);
if (!summary || !hasExplicitSummary) {const staleBinding = readFeishuBindings()[event.conversationId] || existingBinding;
const staleStreamMessageId = trimString(staleBinding?.streamMessageId);
if (config.mode === "app" && config.isAppReady && staleStreamMessageId) {
try {
await deleteAppMessage(config, staleStreamMessageId);
} catch (error) {
console.warn("[portable-feishu] stale stream message delete failed", error);
}
}
upsertFeishuBinding({
conversationId: event.conversationId,
lastTurnId: trimString(event?.turnId),
streamCardId: "",
streamCardSequence: 0,
streamMessageId: "",
streamTurnId: "",
streamReplyTargetMessageId: "",
streamReplyTargetTurnId: "",
}, {
source: "finalizeFeishuTurnFromStream:empty-summary",
});
if (config.mode !== "app" || !config.isAppReady) {
disposeFeishuStreamState(event.conversationId);
return;
}
await setConversationGroupAvatarState(
config,
readFeishuBindings()[event.conversationId] || staleBinding,
FEISHU_GROUP_AVATAR_STATE_KEYS.complete,
);
disposeFeishuStreamState(event.conversationId);
return;
}

const conversation = manager.getConversation(event.conversationId);
const taskTitle = getConversationTaskTitle(
manager,
event.conversationId,
conversation,
);
if (taskTitle && taskTitle !== trimString(existingBinding.title)) {
existingBinding = upsertFeishuBinding({
conversationId: event.conversationId,
title: taskTitle,
});
}
const completedTurn = getLatestConversationTurn(conversation);
const state = getFeishuStreamState(event.conversationId);
const details = {
title: taskTitle,
summary,
timestamp: Date.now(),
cwd: conversation?.cwd || "",
conversationId: event.conversationId,
turnId: event.turnId || "",
};
if (state && trimString(details.turnId)) {
state.completedTurnId = trimString(details.turnId);
state.needsResync = false;
state.immediateResync = false;
if (state.timerId) {
window.clearTimeout(state.timerId);
state.timerId = 0;
}
}
const turnStartedAtMs = getFeishuTurnStartedAtMs(completedTurn, {
conversation,
binding: existingBinding,
fallbackStartedAtMs: state?.streamStartedAtMs,
});
const elapsedText = formatFeishuElapsedDuration(
turnStartedAtMs || state?.streamStartedAtMs,
Date.now(),
);

if (config.mode === "webhook") {
if (!config.isWebhookReady) {return;
}

await sendWebhookTextNotification({
webhook: config.webhook,
secret: config.webhookSecret,
text: buildTurnCompleteText({
...details,
mode: "webhook"
}),
title: details.title,
});
return;
}

if (!config.isAppReady) {return;
}

existingBinding = await ensureConversationGroupBinding(
manager,
config,
event.conversationId,
conversation,
existingBinding,
);

if (existingBinding.lastTurnId === details.turnId) {
clearFeishuStreamBinding(event.conversationId);
disposeFeishuStreamState(event.conversationId);
return;
}

const textForNewMessageBase = buildTurnCompleteText({
...details,
mode: "app",
});
const textForNewMessage = elapsedText ?
`${textForNewMessageBase}\n\n耗时：${elapsedText}` :
textForNewMessageBase;
const streamMessageId = trimString(existingBinding.streamMessageId);
const streamCardId = trimString(existingBinding.streamCardId);
const finalMessageTitle = "";

let result = null;
const finalSnapshot = await buildFeishuStreamCardSnapshot(
config,
conversation,
details.turnId,
state, {
title: finalMessageTitle,
statusText: elapsedText ? `耗时：${elapsedText}` : "",
statusFooterText: "",
variant: "complete",
},
);
const hasCompletionImages = Array.isArray(finalSnapshot?.contentSegments) ?
finalSnapshot.contentSegments.some((segment) =>
segment?.type === "image" &&
Boolean(trimString(segment?.imageKey || segment?.imgKey)),
) :
false;
const shouldSendCompletionCard = hasCompletionImages;
if (streamMessageId) {
try {
await deleteAppMessage(config, streamMessageId);
} catch (error) {
console.warn("[portable-feishu] stream message delete failed", error);
}
}

if (result == null && shouldSendCompletionCard) {
result = await sendFeishuCardForBinding(config, existingBinding, finalSnapshot.card);
}

if (result == null) {
result = await sendFeishuTextForBinding(config, existingBinding, textForNewMessage, {
title: finalMessageTitle,
});
}

if (streamMessageId) {
registerFeishuMessageAlias(streamMessageId, {
conversationId: event.conversationId,
replacementMessageId: trimString(result?.messageId),
});
}

if (result?.messageId) {
markFeishuMessageProcessed(result.messageId);
}
appendFeishuBindingLog("turn-completed-writeback", () => ({
source: "finalizeFeishuTurnFromStream",
conversationId: trimString(event?.conversationId),
turnId: trimString(details.turnId),
previousBinding: summarizeFeishuBindingForLog(existingBinding),
resultMessageId: trimString(result?.messageId),
resultChatId: trimString(result?.chatId),
streamMessageId: trimString(streamMessageId),
})).catch(() => {});
const completedGroupChatId = getBindingGroupChatId(existingBinding);
const completedChatId = completedGroupChatId || result?.chatId || existingBinding.chatId || "";
upsertFeishuBinding({
conversationId: event.conversationId,
cwd: conversation?.cwd || existingBinding.cwd || "",
title: details.title,
rootMessageId: existingBinding.rootMessageId || result?.messageId || "",
threadRootMessageId: existingBinding.threadRootMessageId ||
existingBinding.rootMessageId ||
result?.messageId ||
"",
entryMessageId: result?.messageId || existingBinding.entryMessageId || "",
chatId: completedChatId,
groupChatId: completedGroupChatId || trimString(existingBinding.groupChatId),
lastTurnId: details.turnId,
replyToMessageId: null,
streamCardId: "",
streamCardSequence: 0,
streamMessageId: "",
streamTurnId: "",
streamReplyTargetMessageId: "",
streamReplyTargetTurnId: "",
messageIdHistory: Array.isArray(result?.relatedMessageIds) ?
result.relatedMessageIds : [],
}, {
source: "finalizeFeishuTurnFromStream",
});
await setConversationGroupAvatarState(
config,
readFeishuBindings()[event.conversationId] || existingBinding,
FEISHU_GROUP_AVATAR_STATE_KEYS.complete,
);
disposeFeishuStreamState(event.conversationId);

for (;;) {
const nextQueuedMessage = await peekQueuedFeishuConversationMessageByHost(
event.conversationId,
);
if (!nextQueuedMessage) {
return;
}

await dequeueFeishuConversationMessageByHost(event.conversationId);

if (!(await isFeishuMessageStillAvailable(config, nextQueuedMessage))) {
continue;
}

await continueConversationFromFeishu(
manager, {
...existingBinding,
conversationId: event.conversationId,
cwd: conversation?.cwd || existingBinding.cwd || "",
chatId: completedChatId,
groupChatId: completedGroupChatId || trimString(existingBinding.groupChatId),
rootMessageId: existingBinding.rootMessageId || result?.messageId || "",
title: details.title,
},
nextQueuedMessage, {
config,
},
);
return;
}
}

async function continueConversationFromFeishu(
manager,
binding,
message,
options = {},
) {
const {
config = null,
preferSteerWhileInProgress = false,
queueWhileInProgress = false,
} = options;

if (isPortableConversationTurnInProgress(manager, binding.conversationId)) {
logFeishuContinuationTrace("in-progress-detected", () => ({
conversationId: trimString(binding?.conversationId),
message: summarizeParsedFeishuMessageForLog(message),
preferSteerWhileInProgress,
queueWhileInProgress,
routingState: getPortableConversationRoutingState(manager, binding.conversationId),
activeTurnId: getActivePortableTurnId(manager, binding.conversationId),
}));
if (preferSteerWhileInProgress) {
try {
logFeishuContinuationTrace("steer-before", () => ({
conversationId: trimString(binding?.conversationId),
message: summarizeParsedFeishuMessageForLog(message),
routingState: getPortableConversationRoutingState(manager, binding.conversationId),
activeTurnId: getActivePortableTurnId(manager, binding.conversationId),
}));
await steerConversationFromFeishu(manager, config, binding, message);
logFeishuContinuationTrace("steer-after", () => ({
conversationId: trimString(binding?.conversationId),
message: summarizeParsedFeishuMessageForLog(message),
routingState: getPortableConversationRoutingState(manager, binding.conversationId),
activeTurnId: getActivePortableTurnId(manager, binding.conversationId),
}));
return;
} catch (error) {
logFeishuContinuationTrace("steer-failed", () => ({
conversationId: trimString(binding?.conversationId),
message: summarizeParsedFeishuMessageForLog(message),
routingState: getPortableConversationRoutingState(manager, binding.conversationId),
activeTurnId: getActivePortableTurnId(manager, binding.conversationId),
error: getErrorText(error),
}));
if (isPortableConversationTurnInProgress(manager, binding.conversationId)) {
throw error;
}
}
}

if (queueWhileInProgress) {
logFeishuContinuationTrace("queue-before", () => ({
conversationId: trimString(binding?.conversationId),
message: summarizeParsedFeishuMessageForLog(message),
routingState: getPortableConversationRoutingState(manager, binding.conversationId),
activeTurnId: getActivePortableTurnId(manager, binding.conversationId),
}));
await queueConversationMessageFromFeishu(binding, message);
logFeishuContinuationTrace("queue-after", () => ({
conversationId: trimString(binding?.conversationId),
message: summarizeParsedFeishuMessageForLog(message),
routingState: getPortableConversationRoutingState(manager, binding.conversationId),
activeTurnId: getActivePortableTurnId(manager, binding.conversationId),
}));
return;
}
}

const workspaceRoot = binding.cwd || "/";

appendFeishuBindingLog("continue-conversation", () => ({
source: "continueConversationFromFeishu",
conversationId: trimString(binding?.conversationId),
binding: summarizeFeishuBindingForLog(binding),
message: summarizeParsedFeishuMessageForLog(message),
preferSteerWhileInProgress,
queueWhileInProgress,
})).catch(() => {});
upsertFeishuBinding({
conversationId: binding.conversationId,
replyToMessageId: message.messageId,
chatId: getBindingConversationChatId(config, binding, message),
...clearDirectRoutePromptPatch(),
}, {
source: "continueConversationFromFeishu",
});

logFeishuContinuationTrace("ensure-ready-before", () => ({
conversationId: trimString(binding?.conversationId),
message: summarizeParsedFeishuMessageForLog(message),
routingState: getPortableConversationRoutingState(manager, binding.conversationId),
}));
await ensurePortableConversationReady(manager, {
conversationId: binding.conversationId,
model: null,
reasoningEffort: null,
workspaceRoots: [workspaceRoot],
collaborationMode: null,
});
logFeishuContinuationTrace("ensure-ready-after", () => ({
conversationId: trimString(binding?.conversationId),
message: summarizeParsedFeishuMessageForLog(message),
routingState: getPortableConversationRoutingState(manager, binding.conversationId),
}));
let routingState = null;
try {
routingState = assertPortableConversationReadyForFeishuTurn(
manager,
binding.conversationId,
);
} catch (error) {
logFeishuContinuationTrace("assert-ready-failed", () => ({
conversationId: trimString(binding?.conversationId),
message: summarizeParsedFeishuMessageForLog(message),
routingState: getPortableConversationRoutingState(manager, binding.conversationId),
error: getErrorText(error),
}));
throw error;
}
appendFeishuBindingLog("continue-conversation-ready", () => ({
source: "continueConversationFromFeishu",
conversationId: trimString(binding?.conversationId),
streamRole: routingState.streamRole || null,
resumeState: routingState.resumeState || null,
isStreaming: routingState.isStreaming,
})).catch(() => {});

logFeishuContinuationTrace("start-turn-before", () => ({
conversationId: trimString(binding?.conversationId),
message: summarizeParsedFeishuMessageForLog(message),
routingState: getPortableConversationRoutingState(manager, binding.conversationId),
}));
await withResolvedFeishuAttachments(config, binding, message, (attachments) =>
startPortableConversationTurn(manager, binding.conversationId, {
input: buildFeishuTurnInput(message.text, attachments),
cwd: binding.cwd || null,
attachments: [],
}),
);
logFeishuContinuationTrace("start-turn-after", () => ({
conversationId: trimString(binding?.conversationId),
message: summarizeParsedFeishuMessageForLog(message),
routingState: getPortableConversationRoutingState(manager, binding.conversationId),
}));

setActiveFeishuRequest(
binding.conversationId,
message,
getBindingConversationChatId(config, binding, message),
);
scheduleFeishuStreamSync(manager, config, binding.conversationId, true);
}

async function handlePendingWorkspaceReply(manager, config, binding, message) {
const workspaceCwd = trimString(binding.pendingWorkspaceCwd || binding.cwd);
if (!workspaceCwd) {
return;
}

const workspaceChoice = {
cwd: workspaceCwd,
hostId: trimString(binding.hostId),
label: sanitizeInlineText(binding.title || ""),
};

appendFeishuBindingLog("pending-workspace-reply", () => ({
source: "handlePendingWorkspaceReply",
conversationId: trimString(binding?.conversationId),
binding: summarizeFeishuBindingForLog(binding),
message: summarizeParsedFeishuMessageForLog(message),
workspaceChoice,
})).catch(() => {});
await createConversationFromFeishu(
manager,
workspaceChoice,
message.text,
message, {
config,
},
);
}

async function pollFeishuReplies(manager, appRegistry, config, workerId) {
await ensureFeishuRuntimeStateHydrated();
const bindings = Object.values(readFeishuBindings());

for (const binding of bindings) {
try {
await interruptConversationForRecalledActiveRequest(
manager,
appRegistry,
config,
binding,
);
} catch (error) {
console.warn(
"[portable-feishu] active request recall check failed",
error,
);
}
}

const chatIds = listFeishuAppChatIds(config, bindings);
const indexedChatIds = chatIds.map((chatId, index) => ({
index,
chatId,
}));
for (const [chatIndex, chatId] of chatIds.entries()) {
const nowSeconds = Math.floor(Date.now() / 1000);
const cursorSeconds = Math.max(
0,
(await getFeishuPollCursorByHost(chatId)) || nowSeconds - 60,
);
const startSeconds = cursorSeconds;
let messages = [];
try {messages = await listAppChatMessages(
config,
chatId,
Math.max(0, startSeconds - 5),
nowSeconds,
);} catch (error) {continue;
}

for (const message of messages) {
let hasClaim = false;
try {
const createdAtMs = getFeishuMessageCreatedAtMs(message);
const createdAtSeconds = getFeishuMessageCreatedAtSeconds(message);
const baselineMs = FEISHU_POLL_BASELINE_MS_BY_CHAT.get(chatId) || 0;
if (
(createdAtSeconds > 0 && createdAtSeconds < cursorSeconds) ||
(baselineMs > 0 && createdAtMs > 0 && createdAtMs <= baselineMs)
) {
continue;
}

const directRoute = extractDirectFeishuRoute(message.text);if (
message.senderType === "bot" ||
message.senderType === "app" ||
(await isProcessedFeishuMessageByHost(message.messageId))
) {
continue;
}

hasClaim = await tryClaimFeishuMessageByHost(message.messageId, workerId);
if (!hasClaim) {
continue;
}

try {
await addAppMessageReaction(config, message.messageId, "OK");
} catch (error) {
console.warn("[portable-feishu] ack reaction failed", error);
}

if (message.messageType === "image") {
if (message.imageRef) {
await queuePendingFeishuImageByHost(message, message.imageRef);
const groupBinding = findGroupBindingForMessage(message);
const pendingImageThreadKey = getFeishuPendingImageThreadKey(message);
if (
groupBinding &&
trimString(groupBinding.conversationId) &&
pendingImageThreadKey
) {
upsertFeishuBinding({
conversationId: groupBinding.conversationId,
pendingImageThreadKey,
}, {
source: "pollFeishuReplies:image-pending-thread",
});}
}
await replyAndTrack(
config,
message.messageId,
buildImageMessagePrompt(),
);
markFeishuMessageProcessed(message.messageId);
continue;
}

if (directRoute) {
await routeDirectFeishuMessage(
manager,
appRegistry,
config,
message,
directRoute,
);
await cleanupDirectRoutePromptMessages(config, message);
markFeishuMessageProcessed(message.messageId);
continue;
}

let binding = findPendingWorkspaceBindingForMessage(message);
if (!binding) {
binding = findGroupBindingForMessage(message);
}
if (!binding && !isKnownFeishuDirectChat(message.chatId)) {
binding = findBindingForMessage(message, {
source: "pollFeishuReplies",
});
}
if (!binding && !isKnownFeishuDirectChat(message.chatId)) {
binding = await findBindingViaVisibleFeishuDescendant(
config,
message,
);
}
if (binding) {
binding = migrateBindingAnchorAfterDeletedMessageHit(
binding,
message,
);
}
if (!binding) {
await logUnmatchedFeishuReply(message);
await routeDirectFeishuMessage(
manager,
appRegistry,
config,
message,
null,
);
markFeishuMessageProcessed(message.messageId);
continue;
}

if (isPendingWorkspaceBinding(binding)) {
const bindingManager = resolveManagerForConversation(
appRegistry,
manager,
binding.conversationId,
binding.hostId,
);
await handlePendingWorkspaceReply(
bindingManager,
config,
binding,
message,
);
await cleanupDirectRoutePromptMessages(config, message, binding);
markFeishuMessageProcessed(message.messageId);
continue;
}

const bindingManager = resolveManagerForConversation(
appRegistry,
manager,
binding.conversationId,
binding.hostId,
);
await continueConversationFromFeishu(bindingManager, binding, message, {
config,
preferSteerWhileInProgress: true,
queueWhileInProgress: true,
});
await cleanupDirectRoutePromptMessages(config, message, binding);
markFeishuMessageProcessed(message.messageId);
} catch (error) {
console.warn("[portable-feishu] message handle failed", error);try {const errorText = `处理失败：${getErrorText(error)}`;
await replyAndTrack(
config,
message.messageId,
errorText,
);} catch (replyError) {
console.warn("[portable-feishu] error reply failed", replyError);}
markFeishuMessageProcessed(message.messageId);
continue;
} finally {
if (hasClaim && !isProcessedFeishuMessage(message.messageId)) {
await releaseFeishuMessageClaimByHost(message.messageId, workerId);
}
}
}

await setFeishuPollCursorByHost(chatId, nowSeconds);
}
}

function serializePortableFeishuChoice(choice) {
if (!choice || typeof choice !== "object") {
return null;
}

return {
index: Number(choice.index) || 0,
conversationId: trimString(choice.conversationId),
cwd: trimString(choice.cwd),
title: trimString(choice.title),
label: trimString(choice.label),
rootMessageId: trimString(choice.rootMessageId),
chatId: trimString(choice.chatId),
updatedAt: Number(choice.updatedAt) || 0,
hostId: trimString(choice.hostId),
recentRank: Number(choice.recentRank),
};
}

async function handlePortableFeishuControlRequest(
request,
manager,
appRegistry,
config,
) {
const action = trimString(request?.action);
const params = request?.params && typeof request.params === "object" ?
request.params : {};

switch (action) {
case "ping":
return {
ok: true,
hostId: trimString(getManagerHostId(manager)),
};
case "list-route-targets": {
const conversationChoices = listRecentConversationChoices(
appRegistry,
manager,
)
.map(serializePortableFeishuChoice)
.filter(Boolean);
const workspaceChoices = (await listActiveWorkspaceChoices(
appRegistry,
manager,
))
.map(serializePortableFeishuChoice)
.filter(Boolean);
return {
conversationChoices,
workspaceChoices,
};
}
case "continue-conversation": {
const binding = params.binding && typeof params.binding === "object" ?
params.binding : {};
const message = params.message && typeof params.message === "object" ?
params.message : {};
const targetManager = resolveManagerForConversation(
appRegistry,
manager,
binding.conversationId,
binding.hostId,
);
await continueConversationFromFeishu(targetManager, binding, message, {
config,
preferSteerWhileInProgress: true,
queueWhileInProgress: true,
});
return {
ok: true,
conversationId: trimString(binding.conversationId),
};
}
case "create-conversation": {
const workspaceChoice =
params.workspaceChoice && typeof params.workspaceChoice === "object" ?
params.workspaceChoice : {};
const message = params.message && typeof params.message === "object" ?
params.message : {};
const targetManager = resolveManagerForConversation(
appRegistry,
manager,
"",
workspaceChoice.hostId,
);
const conversationId = await createConversationFromFeishu(
targetManager,
workspaceChoice,
trimString(params.messageText || message.text),
message, {
config,
},
);
return {
ok: true,
conversationId: trimString(conversationId),
};
}
default:
throw new Error(`Unsupported Feishu control action: ${action}`);
}
}

async function respondPortableFeishuControlRequest(request, result, error = null) {
const requestId = trimString(request?.requestId);
if (!requestId) {
return;
}

await invokePortableHostBridge({
action: "feishu-control-response",
requestId,
hostId: trimString(request?.hostId),
ok: !error,
result: error ? null : result,
error: error ? getErrorText(error) : "",
});
}

export function PortableFeishuNotificationBridge() {
const manager = useAppServerManager(null);
const appRegistry = useAppServerRegistry();
const config = useFeishuConfig();
const bridgeRouteInfo = readPortableBridgeRouteInfo();
const bridgeEnabled = React.useMemo(
() =>
!isPortableBridgeDisabledRoute(bridgeRouteInfo.pathname) &&
!isPortableBridgeDisabledRoute(bridgeRouteInfo.initialRoute),
[bridgeRouteInfo.initialRoute, bridgeRouteInfo.pathname],
);
const configRef = React.useRef(config);
const pollingRef = React.useRef(false);
const pollWorkerIdRef = React.useRef(createFeishuPollWorkerId(manager));
const bridgeLogKeyRef = React.useRef("");
const activationBaselineKeyRef = React.useRef("");

const appActivationKey = React.useMemo(() => {
if (
!bridgeEnabled ||
!manager ||
!config.enabled ||
config.mode !== "app" ||
!config.isAppReady
) {
return "";
}

return JSON.stringify({
hostId: trimString(getManagerHostId(manager)),
appId: trimString(config.appId),
appRecipientOpenId: trimString(config.appRecipientOpenId),
});
}, [
bridgeEnabled,
config.appId,
config.appRecipientOpenId,
config.enabled,
config.isAppReady,
config.mode,
manager,
]);

React.useEffect(() => {
configRef.current = config;
}, [config]);

React.useEffect(() => {
const hostId = trimString(getManagerHostId(manager)) || "local";invokePortableHostBridge({
action: "feishu-runtime-configure",
enabled: bridgeEnabled &&
Boolean(manager) &&
config.enabled &&
config.mode === "app" &&
config.isAppReady,
hostId,
config,
}).catch((error) => {
console.warn("[portable-feishu] host runtime configure failed", error);
});
}, [
bridgeEnabled,
config.appDirectRouteRecentConversationLimit,
config.appDirectRouteWorkspaceLimit,
config.appId,
config.appPollingIntervalSeconds,
config.appRecipientOpenId,
config.appSecret,
config.enabled,
config.isAppReady,
config.mode,
config.webhook,
config.webhookSecret,
manager,
]);

React.useEffect(() => {
if (!bridgeEnabled || !manager) {return undefined;
}

const hostId = trimString(getManagerHostId(manager)) || "local";
let disposed = false;

const handleControlRequest = (event) => {
const request = event?.data;
if (
disposed ||
!request ||
request.type !== FEISHU_CONTROL_REQUEST_TYPE
) {
return;
}

const requestHostId = trimString(request.hostId) || "local";
if (requestHostId !== hostId) {
return;
}

handlePortableFeishuControlRequest(
request,
manager,
appRegistry,
configRef.current,
).then((result) =>
respondPortableFeishuControlRequest(request, result),
).catch((error) =>
respondPortableFeishuControlRequest(request, null, error),
);
};

window.addEventListener("message", handleControlRequest);
invokePortableHostBridge({
action: "feishu-control-port-register",
hostId,
}).catch((error) => {
console.warn("[portable-feishu] control port register failed", error);
});

return () => {
disposed = true;
window.removeEventListener("message", handleControlRequest);
invokePortableHostBridge({
action: "feishu-control-port-unregister",
hostId,
}).catch(() => {});
};
}, [
appRegistry,
bridgeEnabled,
manager,
]);

React.useEffect(() => {
appendPortableFeishuRegistryLog("bridge-component-mounted", {
pathname: bridgeRouteInfo.pathname,
initialRoute: bridgeRouteInfo.initialRoute,
bridgeEnabled,
disabledByPathname: isPortableBridgeDisabledRoute(bridgeRouteInfo.pathname),
disabledByInitialRoute: isPortableBridgeDisabledRoute(
bridgeRouteInfo.initialRoute,
),
hostId: trimString(getManagerHostId(manager)),
configEnabled: config.enabled,
configMode: config.mode,
isAppReady: config.isAppReady,
});

return () => {
appendPortableFeishuRegistryLog("bridge-component-unmounted", {
pathname: bridgeRouteInfo.pathname,
initialRoute: bridgeRouteInfo.initialRoute,
hostId: trimString(getManagerHostId(manager)),
});
};
}, []);

React.useEffect(() => {
pollWorkerIdRef.current = createFeishuPollWorkerId(manager);
}, [bridgeEnabled, manager]);

React.useEffect(() => {
if (!appActivationKey || !manager) {activationBaselineKeyRef.current = "";
return undefined;
}

if (activationBaselineKeyRef.current === appActivationKey) {
return undefined;
}

ensureFeishuRuntimeStateHydrated().then(() => {
primeFeishuActivationBaseline(manager, config, Date.now());
}).catch((error) => {
console.warn("[portable-feishu] activation baseline hydrate failed", error);
});
activationBaselineKeyRef.current = appActivationKey;
return undefined;
}, [appActivationKey, config, manager]);

React.useEffect(() => {
const detail = {
enabled: bridgeEnabled,
pathname: bridgeRouteInfo.pathname,
initialRoute: bridgeRouteInfo.initialRoute,
hasManager: Boolean(manager),
hostId: getManagerHostId(manager),
configEnabled: config.enabled,
configMode: config.mode,
isAppReady: config.isAppReady,
};
const logKey = JSON.stringify(detail);
if (logKey === bridgeLogKeyRef.current) {
return undefined;
}

bridgeLogKeyRef.current = logKey;
return undefined;
}, [
bridgeEnabled,
bridgeRouteInfo.initialRoute,
bridgeRouteInfo.pathname,
config.enabled,
config.isAppReady,
config.mode,
manager,
]);

React.useEffect(() => {
if (
!bridgeEnabled ||
!manager ||
!config.enabled ||
config.mode !== "app" ||
!config.isAppReady ||
typeof manager.addAnyConversationCallback !== "function"
) {
if (isFeishuDebugLoggingEnabled()) {
appendFeishuDebugLog(() => ({
type: "feishu-active-stream-effect-gate",
timestamp: Date.now(),
bridgeEnabled,
hasManager: Boolean(manager),
hostId: trimString(getManagerHostId(manager)),
configEnabled: config.enabled,
configMode: config.mode,
isAppReady: config.isAppReady,
hasConversationCallback: typeof manager?.addAnyConversationCallback === "function",
})).catch(() => {});
}
return undefined;
}

const syncActiveStreams = async () => {
await ensureFeishuRuntimeStateHydrated();
const resolvedManager =
resolveManagerForConversation(
appRegistry,
manager,
"",
getManagerHostId(manager),
) || manager;
const hostId = getManagerHostId(resolvedManager);
const scheduledConversationIds = new Set();
const bindings = Object.values(readFeishuBindings());
const recentConversationIds = listManagerTrackedConversationIds(resolvedManager);
const cachedConversationIds =
typeof resolvedManager?.getCachedConversations === "function" ?
resolvedManager.getCachedConversations()
.map((conversation) => trimString(
conversation?.id || conversation?.conversationId,
))
.filter(Boolean) :
[];
const rawRecentConversationIds =
typeof resolvedManager?.getRecentConversations === "function" ?
resolvedManager.getRecentConversations()
.map((conversation) => trimString(
conversation?.id || conversation?.conversationId,
))
.filter(Boolean) :
[];
if (isFeishuDebugLoggingEnabled()) {
appendFeishuDebugLog(() => ({
type: "feishu-active-stream-cycle-start",
timestamp: Date.now(),
hostId: trimString(hostId),
bindingCount: bindings.length,
recentConversationCount: recentConversationIds.length,
recentConversationIds: recentConversationIds.slice(0, 12),
rawRecentConversationCount: rawRecentConversationIds.length,
rawRecentConversationIds: rawRecentConversationIds.slice(0, 12),
cachedConversationCount: cachedConversationIds.length,
cachedConversationIds: cachedConversationIds.slice(0, 12),
hasGetCachedConversations: typeof resolvedManager?.getCachedConversations === "function",
resolvedManagerReplaced: resolvedManager !== manager,
})).catch(() => {});
}
for (const binding of bindings) {
const conversationId = trimString(binding?.conversationId);
if (!conversationId) {
continue;
}

if (
trimString(binding?.hostId) &&
trimString(binding.hostId) !== hostId
) {
continue;
}

if (
!trimString(binding?.activeRequestMessageId) &&
!trimString(binding?.streamMessageId) &&
!isPortableConversationTurnInProgress(resolvedManager, conversationId)
) {
continue;
}

scheduledConversationIds.add(conversationId);scheduleFeishuStreamSync(
resolvedManager,
configRef.current,
conversationId,
true,
);
}

for (const conversationId of recentConversationIds) {
if (scheduledConversationIds.has(conversationId)) {
continue;
}

const ensured = ensureLocalConversationFeishuBinding(
resolvedManager,
conversationId,
);
if (isFeishuDebugLoggingEnabled()) {
appendFeishuDebugLog(() => ({
type: "feishu-active-stream-cycle-recent",
timestamp: Date.now(),
hostId: trimString(hostId),
conversationId,
hasBinding: Boolean(ensured?.binding),
bindingChatId: trimString(ensured?.binding?.chatId),
bindingGroupChatId: trimString(ensured?.binding?.groupChatId),
latestTurnStatus: trimString(ensured?.latestTurn?.status),
latestTurnId: trimString(
ensured?.latestTurn?.turnId ||
ensured?.latestTurn?.turn_id ||
ensured?.latestTurn?.id
),
conversationCwd: trimString(ensured?.conversation?.cwd),
})).catch(() => {});
}
if (!ensured?.binding) {
continue;
}

if (
shouldBackfillRecentCompletedConversationGroup(
ensured.binding,
ensured.conversation,
ensured.latestTurn,
)
) {
const backfilledBinding = await ensureConversationGroupBinding(
resolvedManager,
configRef.current,
conversationId,
ensured.conversation || null,
ensured.binding || null,
);
if (backfilledBinding) {
ensured.binding = backfilledBinding;
}
}

scheduleFeishuStreamSync(
resolvedManager,
configRef.current,
conversationId,
true,
);
}
if (isFeishuDebugLoggingEnabled()) {
appendFeishuDebugLog(() => ({
type: "feishu-active-stream-cycle-end",
timestamp: Date.now(),
hostId: trimString(hostId),
scheduledConversationCount: scheduledConversationIds.size,
scheduledConversationIds: [...scheduledConversationIds].slice(0, 12),
})).catch(() => {});
}
};

const handleAnyConversationCallback = (...args) => {
if (isFeishuDebugLoggingEnabled()) {
appendFeishuDebugLog(() => {
const preview = args.slice(0, 3).map((value) => {
if (typeof value === "string") {
return value;
}
if (value && typeof value === "object") {
return {
keys: Object.keys(value).slice(0, 12),
conversationId: trimString(
value.conversationId ||
value.id ||
value.threadId ||
value.thread_id,
),
status: trimString(value.status),
turnId: trimString(
value.turnId ||
value.turn_id ||
value.id,
),
};
}
return value;
});
return {
type: "feishu-any-conversation-callback",
timestamp: Date.now(),
hostId: trimString(getManagerHostId(manager)),
argCount: args.length,
argsPreview: preview,
};
}).catch(() => {});
}
return syncActiveStreams(...args);
};

const unsubscribe = manager.addAnyConversationCallback(handleAnyConversationCallback);
syncActiveStreams().catch((error) => {
console.warn("[portable-feishu] active stream sync failed", error);
});
const timerId = window.setInterval(() => {
syncActiveStreams().catch((error) => {
console.warn("[portable-feishu] active stream interval sync failed", error);
});
}, FEISHU_ACTIVE_STREAM_SCAN_INTERVAL_MS);

return () => {
window.clearInterval(timerId);
unsubscribe?.();
};
}, [
bridgeEnabled,
config.appId,
config.appRecipientOpenId,
config.appSecret,
config.enabled,
config.isAppReady,
config.mode,
manager,
]);

React.useEffect(() => {
if (
!bridgeEnabled ||
!manager ||
!config.enabled ||
config.mode !== "app" ||
!config.isAppReady
) {return undefined;
}

let disposed = false;
const intervalMs = Math.max(config.appPollingIntervalSeconds, 3) * 1000;

const tick = async () => {
if (disposed || pollingRef.current) {return;
}

pollingRef.current = true;
const tickStartedAt = Date.now();try {
await pollFeishuReplies(
manager,
appRegistry,
configRef.current,
pollWorkerIdRef.current,
);
} catch (error) {
console.warn("[portable-feishu] poll failed", error);} finally {
pollingRef.current = false;}
};

tick().catch(() => {});
const timerId = window.setInterval(() => {
tick().catch(() => {});
}, intervalMs);

return () => {
disposed = true;
window.clearInterval(timerId);
};
}, [
bridgeEnabled,
config.appId,
config.appPollingIntervalSeconds,
config.appRecipientOpenId,
config.appSecret,
config.enabled,
config.isAppReady,
config.mode,
appRegistry,
manager,
]);

return null;
}

registerPortableBridgePlugin({
id: "portable-feishu-notifications",
order: 20,
Component: PortableFeishuNotificationBridge,
});
