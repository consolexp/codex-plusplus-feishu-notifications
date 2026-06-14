// PORTABLE_PATCH: Shared pure helpers for Feishu direct-route choices.
function trimString(value) {
return typeof value === "string" ? value.trim() : "";
}

export function sanitizeInlineText(value) {
return trimString(value).replace(/\s+/g, " ");
}

function getPortablePathBaseName(value) {
const normalized = trimString(value).replace(/[\\/]+$/, "");
if (!normalized) {
return "";
}

const segments = normalized.split(/[\\/]+/).filter(Boolean);
return segments.length > 0 ? segments[segments.length - 1] : "";
}

export function normalizePortablePath(value) {
let normalized = trimString(value).replace(/\\/g, "/");
if (!normalized) {
return "";
}

if (normalized.length > 1) {
normalized = normalized.replace(/\/+$/, "");
}

if (/^[a-zA-Z]:\//.test(normalized) || normalized.startsWith("//")) {
return normalized.toLowerCase();
}

return normalized;
}

export function doesWorkspaceContainConversationCwd(workspaceCwd, conversationCwd) {
const normalizedWorkspaceCwd = normalizePortablePath(workspaceCwd);
const normalizedConversationCwd = normalizePortablePath(conversationCwd);
if (!normalizedWorkspaceCwd || !normalizedConversationCwd) {
return false;
}

if (normalizedWorkspaceCwd === "/") {
return normalizedConversationCwd.startsWith("/");
}

return (
normalizedConversationCwd === normalizedWorkspaceCwd ||
normalizedConversationCwd.startsWith(`${normalizedWorkspaceCwd}/`)
);
}

export function formatDirectRouteConversationPromptTitle(choice) {
const projectName = sanitizeInlineText(getPortablePathBaseName(choice?.cwd));
const taskTitle = sanitizeInlineText(choice?.title);

if (projectName && taskTitle && projectName !== taskTitle) {
return `${projectName} / ${taskTitle}`;
}

if (taskTitle) {
return taskTitle;
}

if (projectName) {
return projectName;
}

return trimString(choice?.cwd);
}

export function normalizeRecentRank(value) {
return typeof value === "number" && Number.isFinite(value) && value >= 0 ?
value :
Number.MAX_SAFE_INTEGER;
}

export function compareRecentChoicePriority(left, right) {
const leftHostId = trimString(left?.hostId);
const rightHostId = trimString(right?.hostId);
if (leftHostId && rightHostId && leftHostId === rightHostId) {
const recentRankDelta =
normalizeRecentRank(left?.recentRank) -
normalizeRecentRank(right?.recentRank);
if (recentRankDelta !== 0) {
return recentRankDelta;
}
}

const updatedAtDelta =
(Number(right?.updatedAt) || 0) - (Number(left?.updatedAt) || 0);
if (updatedAtDelta !== 0) {
return updatedAtDelta;
}

const leftTitle = trimString(left?.title || left?.label || left?.cwd);
const rightTitle = trimString(right?.title || right?.label || right?.cwd);
return leftTitle.localeCompare(rightTitle);
}

export function normalizeFeishuTimestampMs(value) {
if (value == null) {
return 0;
}

if (typeof value === "number" && Number.isFinite(value) && value > 0) {
return Math.floor(value);
}

if (typeof value === "string") {
const trimmed = value.trim();
if (!trimmed) {
return 0;
}

const numeric = Number(trimmed);
if (Number.isFinite(numeric) && numeric > 0) {
return Math.floor(numeric);
}

const parsed = Date.parse(trimmed);
if (Number.isFinite(parsed) && parsed > 0) {
return Math.floor(parsed);
}
}

if (value instanceof Date) {
const timestamp = value.getTime();
return Number.isFinite(timestamp) && timestamp > 0 ?
Math.floor(timestamp) :
0;
}

return 0;
}

export function pickFirstFeishuTimestampMs(...values) {
for (const value of values) {
const timestampMs = normalizeFeishuTimestampMs(value);
if (timestampMs > 0) {
return timestampMs;
}
}

return 0;
}
