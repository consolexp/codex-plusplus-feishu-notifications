"use strict";

// PORTABLE_PATCH: Shared Feishu runtime state owned by the main process.
// Keeping volatile bindings and cursors here reduces renderer bundle coupling.
const fs = require("node:fs/promises");
const path = require("node:path");
const {
app
} = require("electron");

const FEISHU_RUNTIME_STATE_FILENAME = "portable-feishu-runtime-state.json";
const FEISHU_RUNTIME_STATE_MAX_BYTES = 4 * 1024 * 1024;
const FEISHU_PROCESSED_MESSAGES_STORAGE_KEY =
"codex-portable-feishu-processed-messages-v1";
const FEISHU_PROCESSING_MESSAGES_STORAGE_KEY =
"codex-portable-feishu-processing-messages-v1";
const FEISHU_POLL_STATE_STORAGE_KEY = "codex-portable-feishu-poll-state-v1";
const FEISHU_QUEUED_MESSAGES_STORAGE_KEY =
"codex-portable-feishu-queued-messages-v1";
const FEISHU_PENDING_IMAGES_STORAGE_KEY =
"codex-portable-feishu-pending-images-v1";
let writeQueue = Promise.resolve();

function trimString(value) {
return typeof value === "string" ? value.trim() : "";
}

function toPlainObject(value) {
return value && typeof value === "object" && !Array.isArray(value) ?
value : {};
}

function readStateObject(state, key) {
return toPlainObject(toPlainObject(state)[key]);
}

function trimEntriesByTimestamp(map, limit) {
return Object.fromEntries(
Object.entries(toPlainObject(map))
.sort(
(left, right) =>
(Number(right?.[1]?.updatedAt ?? right?.[1]) || 0) -
(Number(left?.[1]?.updatedAt ?? left?.[1]) || 0),
)
.slice(0, limit),
);
}

function dedupePendingImages(images) {
const normalized = Array.isArray(images) ? images : [];
const seen = new Set();
const result = [];

for (const image of normalized) {
if (!image || typeof image !== "object") {
continue;
}

const messageId = trimString(image.messageId);
const imageKey = trimString(image.imageKey);
const imageToken = trimString(image.imageToken);
const fileKey = trimString(image.fileKey);
if (!messageId && !imageKey && !imageToken && !fileKey) {
continue;
}

const identity = `${messageId}::${imageKey}::${imageToken}::${fileKey}`;
if (seen.has(identity)) {
continue;
}

seen.add(identity);
result.push({
messageId,
imageKey,
imageToken,
fileKey,
});
}

return result;
}

function trimPendingImageMap(images) {
return Object.fromEntries(
Object.entries(toPlainObject(images))
.filter(([, value]) => Array.isArray(value) && value.length > 0)
.slice(-100),
);
}

function getFeishuRuntimeStatePath() {
return path.join(app.getPath("userData"), FEISHU_RUNTIME_STATE_FILENAME);
}

async function readStateFile() {
const filePath = getFeishuRuntimeStatePath();
try {
const stats = await fs.stat(filePath);
if (stats.size > FEISHU_RUNTIME_STATE_MAX_BYTES) {
return {};
}

const raw = await fs.readFile(filePath, "utf8");
if (!raw.trim()) {
return {};
}

return toPlainObject(JSON.parse(raw));
} catch {
return {};
}
}

async function writeStateFile(state) {
const filePath = getFeishuRuntimeStatePath();
await fs.mkdir(path.dirname(filePath), {
recursive: true
});
await fs.writeFile(filePath, `${JSON.stringify(toPlainObject(state), null, 2)}\n`, "utf8");
return {
ok: true,
path: filePath,
};
}

function enqueueWrite(mutator) {
writeQueue = writeQueue.then(
async () => {
const state = await readStateFile();
return writeStateFile(mutator(state));
},
async () => {
const state = await readStateFile();
return writeStateFile(mutator(state));
},
);
return writeQueue;
}

async function readRuntimeState() {
return {
ok: true,
path: getFeishuRuntimeStatePath(),
state: await readStateFile(),
};
}

async function writeRuntimeStateValue(payload) {
const key = trimString(payload?.key);
if (!key) {
throw new Error("Feishu runtime state key is missing.");
}

return enqueueWrite((state) => ({
...state,
[key]: payload?.value,
}));
}

async function isMessageProcessed(payload) {
const messageId = trimString(payload?.messageId);
if (!messageId) {
return {
processed: false,
};
}

const state = await readStateFile();
const processed = readStateObject(state, FEISHU_PROCESSED_MESSAGES_STORAGE_KEY);
return {
processed: Object.prototype.hasOwnProperty.call(processed, messageId),
};
}

async function markMessageProcessed(payload) {
const messageId = trimString(payload?.messageId);
if (!messageId) {
return {
ok: false,
};
}

return enqueueWrite((state) => {
const processed = readStateObject(state, FEISHU_PROCESSED_MESSAGES_STORAGE_KEY);
processed[messageId] = Date.now();
const claims = readStateObject(state, FEISHU_PROCESSING_MESSAGES_STORAGE_KEY);
if (Object.prototype.hasOwnProperty.call(claims, messageId)) {
delete claims[messageId];
}
return {
...state,
[FEISHU_PROCESSED_MESSAGES_STORAGE_KEY]: trimEntriesByTimestamp(
processed,
500,
),
[FEISHU_PROCESSING_MESSAGES_STORAGE_KEY]: claims,
};
});
}

async function tryClaimMessage(payload) {
const messageId = trimString(payload?.messageId);
const ownerId = trimString(payload?.ownerId);
const ttlMs = Math.max(5000, Math.floor(Number(payload?.ttlMs) || 45000));
if (!messageId || !ownerId) {
return {
claimed: false,
};
}

let claimed = false;
await enqueueWrite((state) => {
const now = Date.now();
const claims = readStateObject(state, FEISHU_PROCESSING_MESSAGES_STORAGE_KEY);
for (const [claimMessageId, claim] of Object.entries(claims)) {
if (!claim || Number(claim.expiresAt) <= now) {
delete claims[claimMessageId];
}
}

const existingClaim = claims[messageId];
if (
existingClaim &&
trimString(existingClaim.ownerId) !== ownerId &&
Number(existingClaim.expiresAt) > now
) {
claimed = false;
return {
...state,
[FEISHU_PROCESSING_MESSAGES_STORAGE_KEY]: claims,
};
}

claims[messageId] = {
ownerId,
expiresAt: now + ttlMs,
};
claimed = true;
return {
...state,
[FEISHU_PROCESSING_MESSAGES_STORAGE_KEY]: claims,
};
});

return {
claimed,
};
}

async function releaseMessageClaim(payload) {
const messageId = trimString(payload?.messageId);
const ownerId = trimString(payload?.ownerId);
if (!messageId || !ownerId) {
return {
ok: false,
};
}

return enqueueWrite((state) => {
const claims = readStateObject(state, FEISHU_PROCESSING_MESSAGES_STORAGE_KEY);
const existingClaim = claims[messageId];
if (
existingClaim &&
trimString(existingClaim.ownerId) === ownerId
) {
delete claims[messageId];
}
return {
...state,
[FEISHU_PROCESSING_MESSAGES_STORAGE_KEY]: claims,
};
});
}

async function getPollCursor(payload) {
const chatId = trimString(payload?.chatId);
if (!chatId) {
return {
cursorSeconds: 0,
};
}

const state = await readStateFile();
const pollState = readStateObject(state, FEISHU_POLL_STATE_STORAGE_KEY);
const chats = readStateObject(pollState, "chats");
return {
cursorSeconds: Number(chats[chatId] || 0),
};
}

async function setPollCursor(payload) {
const chatId = trimString(payload?.chatId);
const cursorSeconds = Math.max(0, Math.floor(Number(payload?.cursorSeconds) || 0));
if (!chatId) {
return {
ok: false,
};
}

return enqueueWrite((state) => {
const pollState = readStateObject(state, FEISHU_POLL_STATE_STORAGE_KEY);
const chats = readStateObject(pollState, "chats");
chats[chatId] = cursorSeconds;
return {
...state,
[FEISHU_POLL_STATE_STORAGE_KEY]: {
...pollState,
chats,
},
};
});
}

async function enqueueConversationMessage(payload) {
const conversationId = trimString(payload?.conversationId);
const message = payload?.message && typeof payload.message === "object" ?
payload.message : null;
if (!conversationId || !message) {
return {
queue: [],
};
}

let nextQueue = [];
await enqueueWrite((state) => {
const queues = readStateObject(state, FEISHU_QUEUED_MESSAGES_STORAGE_KEY);
const queue = Array.isArray(queues[conversationId]) ?
queues[conversationId] : [];
const messageId = trimString(message.messageId);
if (
messageId &&
queue.some((entry) => trimString(entry?.messageId) === messageId)
) {
nextQueue = queue;
return state;
}

nextQueue = [
...queue,
{
...message,
queuedAt: Date.now(),
},
].slice(-20);
return {
...state,
[FEISHU_QUEUED_MESSAGES_STORAGE_KEY]: {
...queues,
[conversationId]: nextQueue,
},
};
});

return {
queue: nextQueue,
};
}

async function peekQueuedConversationMessage(payload) {
const conversationId = trimString(payload?.conversationId);
if (!conversationId) {
return {
message: null,
};
}

const state = await readStateFile();
const queues = readStateObject(state, FEISHU_QUEUED_MESSAGES_STORAGE_KEY);
const queue = Array.isArray(queues[conversationId]) ?
queues[conversationId] : [];
return {
message: queue[0] || null,
};
}

async function dequeueConversationMessage(payload) {
const conversationId = trimString(payload?.conversationId);
if (!conversationId) {
return {
message: null,
};
}

let nextMessage = null;
await enqueueWrite((state) => {
const queues = readStateObject(state, FEISHU_QUEUED_MESSAGES_STORAGE_KEY);
const queue = Array.isArray(queues[conversationId]) ?
queues[conversationId] : [];
const [message, ...rest] = queue;
nextMessage = message || null;
const nextQueues = {
...queues,
};
if (rest.length > 0) {
nextQueues[conversationId] = rest;
} else {
delete nextQueues[conversationId];
}
return {
...state,
[FEISHU_QUEUED_MESSAGES_STORAGE_KEY]: nextQueues,
};
});

return {
message: nextMessage,
};
}

async function queuePendingImage(payload) {
const threadKey = trimString(payload?.threadKey);
const imageRef = payload?.imageRef && typeof payload.imageRef === "object" ?
payload.imageRef : null;
if (!threadKey || !imageRef) {
return {
images: [],
};
}

let nextImages = [];
await enqueueWrite((state) => {
const images = readStateObject(state, FEISHU_PENDING_IMAGES_STORAGE_KEY);
nextImages = dedupePendingImages([
...(Array.isArray(images[threadKey]) ? images[threadKey] : []),
imageRef,
]).slice(-10);
return {
...state,
[FEISHU_PENDING_IMAGES_STORAGE_KEY]: trimPendingImageMap({
...images,
[threadKey]: nextImages,
}),
};
});

return {
images: nextImages,
};
}

async function takePendingImages(payload) {
const threadKey = trimString(payload?.threadKey);
if (!threadKey) {
return {
images: [],
};
}

let takenImages = [];
await enqueueWrite((state) => {
const images = readStateObject(state, FEISHU_PENDING_IMAGES_STORAGE_KEY);
takenImages = dedupePendingImages(images[threadKey]);
if (!Object.prototype.hasOwnProperty.call(images, threadKey)) {
return state;
}

const nextImages = {
...images,
};
delete nextImages[threadKey];
return {
...state,
[FEISHU_PENDING_IMAGES_STORAGE_KEY]: trimPendingImageMap(nextImages),
};
});

return {
images: takenImages,
};
}

async function restorePendingImages(payload) {
const threadKey = trimString(payload?.threadKey);
const restored = dedupePendingImages(payload?.imageRefs);
if (!threadKey || restored.length === 0) {
return {
images: [],
};
}

let nextImages = [];
await enqueueWrite((state) => {
const images = readStateObject(state, FEISHU_PENDING_IMAGES_STORAGE_KEY);
nextImages = dedupePendingImages([
...restored,
...(Array.isArray(images[threadKey]) ? images[threadKey] : []),
]).slice(-10);
return {
...state,
[FEISHU_PENDING_IMAGES_STORAGE_KEY]: trimPendingImageMap({
...images,
[threadKey]: nextImages,
}),
};
});

return {
images: nextImages,
};
}

module.exports = {
dequeueConversationMessage,
enqueueConversationMessage,
getPollCursor,
isMessageProcessed,
markMessageProcessed,
peekQueuedConversationMessage,
queuePendingImage,
readRuntimeState,
releaseMessageClaim,
restorePendingImages,
setPollCursor,
takePendingImages,
tryClaimMessage,
writeRuntimeStateValue,
};
