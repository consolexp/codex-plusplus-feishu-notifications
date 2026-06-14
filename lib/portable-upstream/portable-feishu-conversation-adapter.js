// PORTABLE_PATCH: Stable adapter around Codex conversation manager coupling.
import {
nativeRequest,
sendPortableAppServerRequest,
} from "./portable-host-request-compat.js";
import {
getConversationTitle,
appendFeishuDebugLog,
isFeishuDebugLoggingEnabled,
readFeishuBindings,
} from "./portable-feishu-common.js";
import {
buildFeishuTurnInput,
} from "./portable-feishu-turn-core.js";
import {
compareRecentChoicePriority,
doesWorkspaceContainConversationCwd,
normalizePortablePath,
normalizeRecentRank,
pickFirstFeishuTimestampMs,
sanitizeInlineText,
} from "./portable-feishu-choice-core.js";

function trimString(value) {
return typeof value === "string" ? value.trim() : "";
}

export function getHostManagers(appRegistry, fallbackManager) {
const managers =
appRegistry && typeof appRegistry.getAll === "function" ?
appRegistry.getAll().filter(Boolean) : [];

if (managers.length > 0) {
return managers;
}

return fallbackManager ? [fallbackManager] : [];
}

export function resolveManagerImplForHost(appRegistry, hostId) {
const normalizedHostId = trimString(hostId);
if (
normalizedHostId &&
appRegistry &&
typeof appRegistry.getImplForHostId === "function"
) {
try {
return appRegistry.getImplForHostId(normalizedHostId);
} catch (error) {
console.warn("[portable-feishu] resolve manager impl by host failed", error);
}
}

return null;
}

export function getManagerHostId(manager) {
return trimString(
typeof manager?.getHostId === "function" ? manager.getHostId() : "",
);
}

function findRecentConversationById(manager, conversationId) {
const normalizedConversationId = trimString(conversationId);
if (
!normalizedConversationId ||
typeof manager?.getRecentConversations !== "function"
) {
return null;
}

const recentConversations = manager.getRecentConversations();
if (!Array.isArray(recentConversations)) {
return null;
}

return (
recentConversations.find(
(recentConversation) =>
trimString(
recentConversation?.id || recentConversation?.conversationId,
) === normalizedConversationId,
) || null
);
}

export function listManagerRecentConversationIds(manager) {
if (typeof manager?.getRecentConversations !== "function") {
return [];
}

const seen = new Set();
const results = [];
const recentConversations = manager.getRecentConversations();
if (!Array.isArray(recentConversations)) {
return results;
}

for (const recentConversation of recentConversations) {
const conversationId = trimString(
recentConversation?.id || recentConversation?.conversationId,
);
if (!conversationId || seen.has(conversationId)) {
continue;
}

seen.add(conversationId);
results.push(conversationId);
}

return results;
}

export function listManagerTrackedConversationIds(
manager,
{
includeRecent = true,
includeCached = true,
} = {},
) {
const seen = new Set();
const results = [];

if (
includeRecent &&
typeof manager?.getRecentConversations === "function"
) {
const recentConversations = manager.getRecentConversations();
if (Array.isArray(recentConversations)) {
for (const recentConversation of recentConversations) {
const conversationId = trimString(
recentConversation?.id || recentConversation?.conversationId,
);
if (!conversationId || seen.has(conversationId)) {
continue;
}

seen.add(conversationId);
results.push(conversationId);
}
}
}

if (
includeCached &&
typeof manager?.getCachedConversations === "function"
) {
const cachedConversations = manager.getCachedConversations();
if (Array.isArray(cachedConversations)) {
for (const conversation of cachedConversations) {
const conversationId = trimString(
conversation?.id || conversation?.conversationId,
);
if (!conversationId || seen.has(conversationId)) {
continue;
}

seen.add(conversationId);
results.push(conversationId);
}
}
}

return results;
}

export function getConversationTaskTitle(
manager,
conversationId,
conversation = null,
) {
const recentConversation = findRecentConversationById(
manager,
conversationId,
);
const liveConversation =
conversation ||
(typeof manager?.getConversation === "function" ?
manager.getConversation(conversationId) :
null);
return sanitizeInlineText(
getConversationTitle(liveConversation || recentConversation || null) || "",
);
}

function getLatestConversationTurn(conversation) {
return Array.isArray(conversation?.turns) ?
conversation.turns[conversation.turns.length - 1] || null :
null;
}

function getConversationRecentActivityMs(
recentConversation,
conversation,
binding = null,
) {
const latestTurn = getLatestConversationTurn(conversation);

return pickFirstFeishuTimestampMs(
latestTurn?.updatedAtMs,
latestTurn?.updated_at_ms,
latestTurn?.updatedAt,
latestTurn?.updated_at,
latestTurn?.completedAtMs,
latestTurn?.completed_at_ms,
latestTurn?.completedAt,
latestTurn?.completed_at,
latestTurn?.turnStartedAtMs,
latestTurn?.startedAtMs,
latestTurn?.started_at_ms,
latestTurn?.turnStartedAt,
latestTurn?.startedAt,
latestTurn?.started_at,
latestTurn?.createdAtMs,
latestTurn?.created_at_ms,
latestTurn?.createdAt,
latestTurn?.created_at,
recentConversation?.updatedAtMs,
recentConversation?.updated_at_ms,
recentConversation?.lastActiveAtMs,
recentConversation?.last_active_at_ms,
recentConversation?.lastActiveAt,
recentConversation?.last_active_at,
recentConversation?.updatedAt,
recentConversation?.updated_at,
conversation?.updatedAtMs,
conversation?.updated_at_ms,
conversation?.lastActiveAtMs,
conversation?.last_active_at_ms,
conversation?.lastActiveAt,
conversation?.last_active_at,
conversation?.updatedAt,
conversation?.updated_at,
conversation?.createdAtMs,
conversation?.created_at_ms,
conversation?.createdAt,
conversation?.created_at,
binding?.updatedAt,
);
}

export function resolveManagerForConversation(
appRegistry,
fallbackManager,
conversationId,
hostId = "",
) {
const normalizedConversationId = trimString(conversationId);
const normalizedHostId = trimString(hostId);

if (appRegistry) {
if (
normalizedConversationId &&
typeof appRegistry.getForConversationId === "function"
) {
try {
const conversationManager = appRegistry.getForConversationId(normalizedConversationId);
const implManager = resolveManagerImplForHost(
appRegistry,
getManagerHostId(conversationManager),
);
return implManager || conversationManager;
} catch (error) {
console.warn(
"[portable-feishu] resolve manager by conversation failed",
error,
);
}
}

if (normalizedHostId && typeof appRegistry.getForHostId === "function") {
const hostManager = appRegistry.getForHostId(normalizedHostId);
if (hostManager) {
return resolveManagerImplForHost(appRegistry, normalizedHostId) || hostManager;
}
}
}

return resolveManagerImplForHost(appRegistry, getManagerHostId(fallbackManager)) ||
fallbackManager;
}

export async function startConversationWithManager(
manager,
workspaceChoice,
messageText,
attachments = [],
) {
const payload = {
input: buildFeishuTurnInput(messageText, attachments),
cwd: workspaceChoice.cwd,
workspaceRoots: workspaceChoice.cwd ? [workspaceChoice.cwd] : [],
workspaceKind: "project",
collaborationMode: null,
attachments,
commentAttachments: [],
};
const hostId =
getManagerHostId(manager) ||
trimString(workspaceChoice?.hostId) ||
"local";

const result =
typeof manager?.startConversation === "function" ?
await manager.startConversation(payload) :
await sendPortableAppServerRequest("start-conversation", {
hostId,
...payload,
});

const conversationId = trimString(
typeof result === "string" ?
result :
result?.conversationId ||
result?.id ||
result?.threadId ||
result?.thread?.id,
);

if (!conversationId) {
throw new Error("startConversation did not return a conversation ID");
}

return conversationId;
}

function listRecentConversationChoicesForManager(
hostManager,
bindings = readFeishuBindings(),
seenConversationIds = new Set(),
) {
const choices = [];
const hostId = getManagerHostId(hostManager) || "local";
const recentConversations =
typeof hostManager?.getRecentConversations === "function" ?
hostManager.getRecentConversations() : [];

for (let recentRank = 0; recentRank < recentConversations.length; recentRank += 1) {
const recentConversation = recentConversations[recentRank];
const conversationId = trimString(
recentConversation?.id || recentConversation?.conversationId,
);
if (!conversationId || seenConversationIds.has(conversationId)) {
continue;
}

seenConversationIds.add(conversationId);
const conversation =
typeof hostManager.getConversation === "function" ?
hostManager.getConversation(conversationId) :
null;

choices.push({
conversationId,
cwd: trimString(conversation?.cwd || recentConversation?.cwd),
title: getConversationTaskTitle(
hostManager,
conversationId,
conversation,
),
rootMessageId: trimString(bindings[conversationId]?.rootMessageId),
chatId: trimString(bindings[conversationId]?.chatId),
updatedAt: getConversationRecentActivityMs(
recentConversation,
conversation,
bindings[conversationId],
),
hostId,
recentRank,
manager: hostManager,
});
}

return choices;
}

export function listRecentConversationChoices(appRegistry, fallbackManager) {
const choices = [];
const seenConversationIds = new Set();
const bindings = readFeishuBindings();

for (const hostManager of getHostManagers(appRegistry, fallbackManager)) {
choices.push(
...listRecentConversationChoicesForManager(
hostManager,
bindings,
seenConversationIds,
),
);
}

choices.sort(compareRecentChoicePriority);
return choices.map((choice, index) => ({
...choice,
index: index + 1,
}));
}

async function listWorkspaceChoicesForManager(manager) {
const hostId = getManagerHostId(manager) || "local";
try {
const response = await nativeRequest.safePost(
"vscode://codex/workspace-root-options", {
requestBody: {
hostId,
},
},
);
const roots = Array.isArray(response?.roots) ? response.roots : [];
const labels =
response?.labels && typeof response.labels === "object" ?
response.labels : {};

if (isFeishuDebugLoggingEnabled()) {
appendFeishuDebugLog(() => ({
type: "feishu-workspace-roots-native",
hostId,
rootCount: roots.length,
})).catch(() => {});
}

const nativeChoices = roots
.map((root) => trimString(root))
.filter(Boolean)
.map((root, index) => ({
index: index + 1,
cwd: root,
label: sanitizeInlineText(labels[root] || ""),
hostId,
manager,
}));
if (nativeChoices.length > 0) {
return nativeChoices;
}
} catch (error) {
console.warn("[portable-feishu] list workspace roots failed", error);
}

const seen = new Set();
const fallbackChoices = [];
const recentConversations =
typeof manager?.getRecentConversations === "function" ?
manager.getRecentConversations() : [];
for (const recentConversation of Array.isArray(recentConversations) ? recentConversations : []) {
const cwd = trimString(recentConversation?.cwd);
const normalizedCwd = normalizePortablePath(cwd);
if (!cwd || !normalizedCwd || seen.has(normalizedCwd)) {
continue;
}

seen.add(normalizedCwd);
fallbackChoices.push({
index: fallbackChoices.length + 1,
cwd,
label: sanitizeInlineText(cwd),
hostId,
manager,
});
}

if (isFeishuDebugLoggingEnabled()) {
appendFeishuDebugLog(() => ({
type: "feishu-workspace-roots-fallback",
hostId,
rootCount: fallbackChoices.length,
})).catch(() => {});
}

return fallbackChoices;
}

export async function listActiveWorkspaceChoices(appRegistry, fallbackManager) {
const choicesByCwd = new Map();

for (const hostManager of getHostManagers(appRegistry, fallbackManager)) {
const recentConversationChoices =
listRecentConversationChoicesForManager(hostManager);
const hostChoices = await listWorkspaceChoicesForManager(hostManager);
for (const choice of hostChoices) {
if (!choice.cwd) {
continue;
}

const normalizedCwd = normalizePortablePath(choice.cwd);
if (!normalizedCwd) {
continue;
}

const updatedAt = recentConversationChoices.reduce((latest, conversation) => {
if (!doesWorkspaceContainConversationCwd(choice.cwd, conversation.cwd)) {
return latest;
}
return Math.max(latest, Number(conversation.updatedAt) || 0);
}, 0);
const recentRank = recentConversationChoices.reduce((bestRank, conversation) => {
if (!doesWorkspaceContainConversationCwd(choice.cwd, conversation.cwd)) {
return bestRank;
}
return Math.min(bestRank, normalizeRecentRank(conversation.recentRank));
}, Number.MAX_SAFE_INTEGER);

const existingChoice = choicesByCwd.get(normalizedCwd);
const nextChoice = {
...choice,
updatedAt,
recentRank,
};
if (
!existingChoice ||
compareRecentChoicePriority(nextChoice, existingChoice) < 0
) {
choicesByCwd.set(normalizedCwd, nextChoice);
}
}
}

return Array.from(choicesByCwd.values())
.sort(compareRecentChoicePriority)
.map((choice, index) => ({
...choice,
index: index + 1,
}));
}
