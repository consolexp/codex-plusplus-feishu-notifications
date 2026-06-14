// PORTABLE_PATCH: Feishu stream card data extraction kept outside the bridge orchestration.
import {
buildFeishuCardKitCompleteCard,
buildFeishuCardKitStreamingCard,
getConversationTitle,
uploadFeishuAppImage,
} from "./portable-feishu-common.js";

const FEISHU_STREAM_LOADING_FRAME_INTERVAL_MS = 420;

function trimString(value) {
return typeof value === "string" ? value.trim() : "";
}

export function formatFeishuElapsedDuration(startedAtMs, endedAtMs = Date.now()) {
const start = Number(startedAtMs) || 0;
const end = Number(endedAtMs) || 0;
if (start <= 0 || end <= start) {
return "";
}

const totalSeconds = Math.max(1, Math.round((end - start) / 1000));
const hours = Math.floor(totalSeconds / 3600);
const minutes = Math.floor((totalSeconds % 3600) / 60);
const seconds = totalSeconds % 60;
const parts = [];

if (hours > 0) {
parts.push(`${hours}小时`);
}
if (minutes > 0) {
parts.push(`${minutes}分`);
}
if (seconds > 0 || parts.length === 0) {
parts.push(`${seconds}秒`);
}

return parts.join("");
}

function buildFeishuStreamDisplayText(text) {
const body = trimString(typeof text === "string" ? text : "");
return body;
}

export function getFeishuLoadingFrameIndex(nowMs = Date.now()) {
return Math.floor(nowMs / FEISHU_STREAM_LOADING_FRAME_INTERVAL_MS) % 3;
}

export function getFeishuLoadingFallbackText(frameIndex) {
return ".".repeat(Math.max(1, (Number(frameIndex) % 3) + 1));
}

export function getFeishuNextLoadingFrameDelay(nowMs = Date.now()) {
const elapsedInPhase = nowMs % FEISHU_STREAM_LOADING_FRAME_INTERVAL_MS;
return Math.max(0, FEISHU_STREAM_LOADING_FRAME_INTERVAL_MS - elapsedInPhase);
}

function appendTextBlock(blocks, content) {
const normalized = trimString(content);
if (!normalized) {
return;
}

const lastBlock = blocks[blocks.length - 1];
if (lastBlock?.type === "text") {
lastBlock.content =
`${trimString(lastBlock.content)}\n\n${normalized}`.trim();
return;
}

blocks.push({
type: "text",
content: normalized,
});
}

function appendStreamingTextSegment(segments, content) {
const normalized = trimString(content);
if (!normalized) {
return;
}

const lastSegment = segments[segments.length - 1];
if (lastSegment?.type === "text") {
lastSegment.content =
`${trimString(lastSegment.content)}\n\n${normalized}`.trim();
return;
}

segments.push({
type: "text",
content: normalized,
});
}

function appendStreamingImageSegment(segments, item) {
const src = trimString(item?.src);
if (!src) {
return;
}

segments.push({
type: "image",
src,
mimeType: trimString(item?.mimeType),
name: trimString(item?.name),
identity: trimString(item?.id) || src,
alt: "生成的图片",
status: trimString(item?.status),
});
}

function isLikelyLocalImagePath(value) {
const raw = trimString(value);
if (!raw) {
return false;
}

let normalized = raw;
if (/^file:\/\//i.test(normalized)) {
try {
normalized = new URL(normalized).pathname;
} catch {
return false;
}
}

normalized = normalized.replace(/^\/@fs\//i, "/");
normalized = normalized.replace(/[?#].*$/, "");
return /\.(png|apng|jpe?g|gif|webp|bmp|svg)$/i.test(normalized);
}

function normalizeLocalImageSource(value) {
const raw = trimString(value);
if (!raw) {
return "";
}

if (/^file:\/\//i.test(raw)) {
try {
const parsed = new URL(raw);
const pathname = decodeURIComponent(parsed.pathname || "");
if (/^\/[A-Za-z]:\//.test(pathname)) {
return pathname.slice(1);
}
return pathname || raw;
} catch {
return raw;
}
}

if (/^\/@fs\//i.test(raw)) {
const resolved = decodeURIComponent(raw.slice("/@fs/".length));
return /^[A-Za-z]:\//.test(resolved) ? resolved : `/${resolved}`;
}

if (/^\/[A-Za-z]:\//.test(raw)) {
return raw.slice(1);
}

return raw;
}

function appendAgentMessageSegments(segments, blocks, parts, text, cwd = "") {
const sourceText = typeof text === "string" ? text : "";
if (!sourceText.trim()) {
return;
}

const localImageLinkPattern =
/(!?\[([^\]]*)\]\(([^)\s]+(?:\s+["'][^"']*["'])?)\))/g;
let lastIndex = 0;
let matchedImageLink = false;

for (const match of sourceText.matchAll(localImageLinkPattern)) {
const fullMatch = match[1] || "";
const altOrLabel = trimString(match[2] || "");
const rawTarget = trimString((match[3] || "").replace(/\s+["'][^"']*["']$/, ""));
const startIndex = typeof match.index === "number" ? match.index : -1;

if (startIndex < 0 || !isLikelyLocalImagePath(rawTarget)) {
continue;
}

const beforeText = sourceText.slice(lastIndex, startIndex).trim();
if (beforeText) {
parts.push(beforeText);
appendTextBlock(blocks, beforeText);
appendStreamingTextSegment(segments, beforeText);
}

const normalizedSrc = normalizeLocalImageSource(rawTarget, cwd);
if (normalizedSrc) {
segments.push({
type: "image",
src: normalizedSrc,
mimeType: "",
name: altOrLabel,
identity: normalizedSrc,
alt: altOrLabel || "图片",
status: "completed",
});
matchedImageLink = true;
}

lastIndex = startIndex + fullMatch.length;
}

const trailingText = sourceText.slice(lastIndex).trim();
if (matchedImageLink) {
if (trailingText) {
parts.push(trailingText);
appendTextBlock(blocks, trailingText);
appendStreamingTextSegment(segments, trailingText);
}
return;
}

const normalizedText = sourceText.trim();
if (!normalizedText) {
return;
}

parts.push(normalizedText);
appendTextBlock(blocks, normalizedText);
appendStreamingTextSegment(segments, normalizedText);
}

function appendReferencedImageSegments(segments, turn, cwd = "") {
const referencedFilePaths = Array.isArray(turn?.artifacts?.referencedFilePaths) ?
turn.artifacts.referencedFilePaths : [];
if (referencedFilePaths.length === 0) {
return;
}

const seen = new Set(
segments
.filter((segment) => segment?.type === "image")
.map((segment) => trimString(segment?.src || segment?.identity))
.filter(Boolean),
);

for (const referencedPath of referencedFilePaths) {
const normalizedSrc = normalizeLocalImageSource(referencedPath, cwd);
if (!isLikelyLocalImagePath(normalizedSrc) || seen.has(normalizedSrc)) {
continue;
}

seen.add(normalizedSrc);
segments.push({
type: "image",
src: normalizedSrc,
mimeType: "",
name: "",
identity: normalizedSrc,
alt: "图片",
status: "completed",
});
}
}

function buildFeishuImageUploadCacheKey(conversation, turnId, segment) {
return [
trimString(conversation?.id || conversation?.conversationId),
trimString(turnId),
trimString(segment?.identity || segment?.src),
].join("::");
}

async function resolveUploadedFeishuSegments(
config,
conversation,
turnId,
state,
segments,
) {
const resolvedSegments = [];
const uploadedImages =
state?.uploadedImages instanceof Map ? state.uploadedImages : new Map();
if (state && !(state.uploadedImages instanceof Map)) {
state.uploadedImages = uploadedImages;
}

for (const segment of Array.isArray(segments) ? segments : []) {
if (segment?.type !== "image") {
if (segment?.type === "text" && trimString(segment?.content)) {
resolvedSegments.push({
type: "text",
content: trimString(segment.content),
});
}
continue;
}

const cacheKey = buildFeishuImageUploadCacheKey(conversation, turnId, segment);
let uploaded = uploadedImages.get(cacheKey) || null;
if (!uploaded) {
uploaded = await uploadFeishuAppImage(config, {
src: trimString(segment?.src),
cwd: trimString(conversation?.cwd),
mimeType: trimString(segment?.mimeType),
name: trimString(segment?.name),
});
uploadedImages.set(cacheKey, uploaded);
}

const imageKey = trimString(uploaded?.imageKey);
if (!imageKey) {
continue;
}

resolvedSegments.push({
type: "image",
imageKey,
alt: trimString(segment?.alt) || "生成的图片",
identity: trimString(segment?.identity || segment?.src),
});
}

return resolvedSegments;
}

export async function buildFeishuStreamCardSnapshot(
config,
conversation,
turnId,
state,
options = {},
) {
const streamData = extractStreamingTurnData(conversation, turnId);
const contentBlocks = Array.isArray(streamData.blocks) ?
streamData.blocks.map((block) => ({
...block
})) : [];
const contentSegments = await resolveUploadedFeishuSegments(
config,
conversation,
turnId,
state,
Array.isArray(streamData.segments) ?
streamData.segments.map((segment) => ({
...segment
})) : [],
);
const displayText = buildFeishuStreamDisplayText(streamData.text);
const variant = trimString(options.variant).toLowerCase();
const cardOptions = {
...options,
contentBlocks,
contentSegments,
};
delete cardOptions.variant;

return {
text: streamData.text,
displayText,
contentBlocks,
contentSegments,
card: variant === "complete" ?
buildFeishuCardKitCompleteCard(streamData.text, cardOptions) :
buildFeishuCardKitStreamingCard(displayText, cardOptions),
};
}

export function buildStreamingPhaseText(turn, fallbackText = "") {
if (!Array.isArray(turn?.items) || turn.items.length === 0) {
return trimString(fallbackText);
}

for (let index = turn.items.length - 1; index >= 0; index -= 1) {
const item = turn.items[index];
if (!item || typeof item !== "object") {
continue;
}

if (
item.type === "commandExecution" &&
trimString(item.status) === "inProgress"
) {
return "执行中";
}

if (item.type === "reasoning") {
return "思考中";
}
}

return trimString(fallbackText);
}

export function extractDesktopTurnPromptText(turn, conversation = null) {
const inputItems = Array.isArray(turn?.params?.input) ?
turn.params.input : [];
const textParts = [];

for (const item of inputItems) {
if (!item || typeof item !== "object") {
continue;
}

if (item.type === "text") {
const text = trimString(item.text || item.content || "");
if (text) {
textParts.push(text);
}
}
}

const combinedText = textParts.join("\n\n").trim();
if (combinedText) {
return combinedText;
}

const fallbackTitle = trimString(getConversationTitle(conversation));
if (fallbackTitle) {
return fallbackTitle;
}

return "Please process the request I just submitted in Codex Desktop.";
}

export function buildStreamingStatus(
turn,
dots = "",
elapsedText = "",
fallbackText = "",
) {
const phaseText =
trimString(buildStreamingPhaseText(turn, fallbackText)) || "思考中";
return {
phaseText: `${phaseText}${trimString(dots)}`.trim(),
elapsedText: trimString(elapsedText),
};
}

export function getLatestConversationTurn(conversation) {
return Array.isArray(conversation?.turns) ?
conversation.turns[conversation.turns.length - 1] || null :
null;
}

export function extractStreamingTurnData(conversation, turnId = "") {
const normalizedTurnId = trimString(turnId);
const targetTurn =
(Array.isArray(conversation?.turns) ?
conversation.turns.find(
(item) => trimString(item?.turnId) === normalizedTurnId,
) :
null) || getLatestConversationTurn(conversation);

if (!targetTurn || !Array.isArray(targetTurn.items)) {
return {
text: "",
blocks: [],
segments: [],
};
}

const parts = [];
const blocks = [];
const segments = [];
const conversationCwd = trimString(conversation?.cwd || targetTurn?.cwd || "");

for (const item of targetTurn.items) {
if (item?.type === "commandExecution") {
continue;
}

if (item?.type === "reasoning") {
const reasoningText = [
...(Array.isArray(item.summary) ? item.summary : []),
...(Array.isArray(item.content) ? item.content : []),
]
.filter((text) => typeof text === "string" && text.trim().length > 0)
.join("\n\n")
.trim();

if (reasoningText) {
parts.push(reasoningText);
appendTextBlock(blocks, reasoningText);
appendStreamingTextSegment(segments, reasoningText);
}
continue;
}

if (item?.type === "imageGeneration") {
appendStreamingImageSegment(segments, item);
continue;
}

if (item?.type === "imageView") {
const imagePath = trimString(item?.path);
if (imagePath) {
segments.push({
type: "image",
src: normalizeLocalImageSource(imagePath, conversationCwd),
mimeType: "",
name: "",
identity: trimString(item?.id) || imagePath,
alt: "图片",
status: "completed",
});
}
continue;
}

if (item?.type === "agentMessage") {
appendAgentMessageSegments(
segments,
blocks,
parts,
item.text,
conversationCwd,
);
}
}

appendReferencedImageSegments(segments, targetTurn, conversationCwd);

return {
text: parts.join("\n\n").trim(),
blocks,
segments,
};
}
