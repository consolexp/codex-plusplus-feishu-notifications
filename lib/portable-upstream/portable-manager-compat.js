// PORTABLE_PATCH: Centralize upstream app-server manager coupling so portable
// business modules only depend on one stable conversation runtime.
import {
ensurePortableHostConversationReady,
startPortableHostConversationTurn,
steerPortableHostConversationTurn,
} from "./portable-host-request-compat.js";
import {
appendFeishuDebugLog,
isFeishuDebugLoggingEnabled,
} from "./portable-feishu-common.js";
import {
getLatestPortableConversationTurn,
isPortableConversationTurnInProgress,
summarizePortableConversation,
} from "./portable-manager-compat-core.js";

export {
isPortableConversationTurnInProgress
}
from "./portable-manager-compat-core.js";

function trimString(value) {
return typeof value === "string" ? value.trim() : "";
}

function serializePortableManagerError(error) {
if (error instanceof Error) {
return {
name: error.name,
message: error.message,
stack: typeof error.stack === "string" ? error.stack.slice(0, 1200) : "",
};
}

return {
message: String(error ?? "unknown error"),
};
}

function summarizePortableInput(input) {
if (!Array.isArray(input)) {
return {
kind: typeof input,
};
}

return {
partCount: input.length,
textPartCount: input.filter((part) => part?.type === "text").length,
imagePartCount: input.filter((part) => part?.type === "image").length,
};
}

async function logPortableConversationRuntime(type, payload = {}) {
if (!isFeishuDebugLoggingEnabled()) {
return;
}

try {
await appendFeishuDebugLog(() => {
const resolvedPayload =
typeof payload === "function" ? payload() : payload;
return {
type: `conversation-runtime-${type}`,
timestamp: Date.now(),
...(resolvedPayload && typeof resolvedPayload === "object" ? resolvedPayload : {
value: resolvedPayload
}),
};
});
} catch {}
}

async function withPortableConversationRuntime(
type,
manager,
conversationId,
payload,
action,
) {
const normalizedConversationId = trimString(conversationId);

try {
const result = await action();
await logPortableConversationRuntime(`${type}-ok`, () => ({
conversation: summarizePortableConversation(manager, normalizedConversationId),
...((typeof payload === "function" ? payload() : payload) || {}),
}));
return result;
} catch (error) {
await logPortableConversationRuntime(`${type}-failed`, () => ({
conversation: summarizePortableConversation(manager, normalizedConversationId),
...((typeof payload === "function" ? payload() : payload) || {}),
error: serializePortableManagerError(error),
}));
throw error;
}
}

export async function ensurePortableConversationReady(manager, options = {}) {
return withPortableConversationRuntime(
"ensure-ready",
manager,
options?.conversationId,
() => ({
workspaceRootCount: Array.isArray(options?.workspaceRoots) ?
options.workspaceRoots.length : 0,
}),
() => ensurePortableHostConversationReady(manager, options),
);
}

export async function startPortableConversationTurn(
manager,
conversationId,
options = {},
) {
return withPortableConversationRuntime(
"start-turn",
manager,
conversationId,
() => ({
input: summarizePortableInput(options?.input),
cwd: trimString(options?.cwd),
attachmentCount: Array.isArray(options?.attachments) ?
options.attachments.length : 0,
}),
() => startPortableHostConversationTurn(manager, conversationId, options),
);
}

export async function steerPortableConversationTurn(
manager,
conversationId,
input,
restoreMessage,
attachments,
options = {},
) {
return withPortableConversationRuntime(
"steer-turn",
manager,
conversationId,
() => ({
input: summarizePortableInput(input),
restoreCwd: trimString(restoreMessage?.cwd),
expectedTurnId: trimString(options?.expectedTurnId),
restoreWorkspaceRootCount: Array.isArray(
restoreMessage?.context?.workspaceRoots,
) ?
restoreMessage.context.workspaceRoots.length : 0,
attachmentCount: Array.isArray(attachments) ? attachments.length : 0,
}),
() =>
steerPortableHostConversationTurn(
manager,
conversationId,
input,
restoreMessage,
attachments,
options,
),
);
}

export {
getLatestPortableConversationTurn,
summarizePortableConversation
};
