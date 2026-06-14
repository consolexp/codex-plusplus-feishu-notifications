"use strict";

// PORTABLE_PATCH: Portable-only main-process Feishu bridge. This file is added
// PORTABLE_PATCH: on top of the official app to handle IPC, logging, and Feishu API calls.
const fs = require("node:fs/promises");
const path = require("node:path");
const {
app,
ipcMain,
net
} = require("electron");
const {
readPortableApiSettings,
writePortableApiSettings,
} = require("./portable-api-main.js");
const {
configureFeishuRuntime,
getFeishuRuntimeStatus,
handleFeishuControlResponse,
registerFeishuControlPort,
unregisterFeishuControlPort,
} = require("./portable-feishu-runtime.js");
const {
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
} = require("./portable-feishu-runtime-state.js");

const PORTABLE_HOST_CHANNEL = "codex_desktop:portable-host";
const FEISHU_DEFAULT_API_BASE_URL = "https://open.feishu.cn";
const FEISHU_API_BASE_ENV = "CODEX_PORTABLE_FEISHU_API_BASE_URL";
const TOKEN_CACHE = new Map();
const FEISHU_DEBUG_LOG_DIRNAME = "logs";
const FEISHU_DEBUG_LOG_FILENAME = "portable-feishu-debug.log";
const FEISHU_DEBUG_LOG_MAX_BYTES = 2 * 1024 * 1024;

function trimString(value) {
return typeof value === "string" ? value.trim() : "";
}

function toPlainObject(value) {
return value && typeof value === "object" ? value : {};
}

function normalizeFeishuBaseUrl(value) {
const raw = trimString(value);
if (!raw) {
return FEISHU_DEFAULT_API_BASE_URL;
}

try {
const parsed = new URL(raw);
parsed.hash = "";
return parsed.toString().replace(/\/+$/, "");
} catch {
return FEISHU_DEFAULT_API_BASE_URL;
}
}

function getFeishuApiBaseUrl() {
return normalizeFeishuBaseUrl(process.env[FEISHU_API_BASE_ENV]);
}

function buildFeishuApiUrl(targetPath) {
const normalizedPath = trimString(targetPath).replace(/^\/+/, "");
return new URL(`${normalizedPath}`, `${getFeishuApiBaseUrl()}/`).toString();
}

function rewriteFeishuRequestUrl(url) {
const raw = trimString(url);
if (!raw) {
return raw;
}

try {
const parsed = new URL(raw);
const defaultOrigin = new URL(FEISHU_DEFAULT_API_BASE_URL).origin;
if (parsed.origin !== defaultOrigin) {
return parsed.toString();
}

return buildFeishuApiUrl(
`${parsed.pathname.replace(/^\/+/, "")}${parsed.search}${parsed.hash}`,
);
} catch {
if (/^\/?open-apis\//i.test(raw)) {
return buildFeishuApiUrl(raw);
}
return raw;
}
}

function isFeishuDebugLogEnabled() {
const raw = trimString(
process.env.CODEX_PORTABLE_FEISHU_DEBUG_LOG,
).toLowerCase();
if (!raw) {
return false;
}

return !["0", "false", "no", "off"].includes(raw);
}

function arrayBufferToBase64(buffer) {
return Buffer.from(buffer).toString("base64");
}

function bufferToDataUrl(buffer, mimeType) {
const normalizedMimeType = trimString(mimeType) || "image/png";
return `data:${normalizedMimeType};base64,${buffer.toString("base64")}`;
}

function getImageSourceAbsolutePath(imageSource = {}) {
const src = trimString(imageSource?.src);
if (!src) {
return "";
}

if (/^file:\/\//i.test(src)) {
try {
const parsed = new URL(src);
const pathname = decodeURIComponent(parsed.pathname || "");
if (/^\/[A-Za-z]:\//.test(pathname)) {
return path.resolve(pathname.slice(1));
}
return path.resolve(pathname);
} catch {
return "";
}
}

if (/^\/@fs\//i.test(src)) {
const resolved = decodeURIComponent(src.slice("/@fs/".length));
return path.resolve(resolved);
}

if (/^\/[A-Za-z]:\//.test(src)) {
return path.resolve(src.slice(1));
}

if (/^[a-zA-Z]:[\\/]/.test(src) || src.startsWith("\\\\")) {
return path.resolve(src);
}

const cwd = trimString(imageSource?.cwd);
if (!cwd) {
return "";
}

return path.resolve(cwd, src);
}

async function readResponseJson(response) {
const text = await response.text();
if (!text) {
return null;
}

try {
return JSON.parse(text);
} catch (error) {
throw new Error(
`Feishu JSON response parse failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
);
}
}

async function requestFeishu(url, init = {}) {
const response = await net.fetch(rewriteFeishuRequestUrl(url), {
method: init.method || "GET",
headers: init.headers,
body: init.body,
});

const contentType = trimString(
response.headers.get("content-type"),
).toLowerCase();
return {
ok: response.ok,
status: response.status,
headers: response.headers,
contentType,
response,
};
}

async function getTenantAccessToken(settings) {
const appId = trimString(settings?.appId);
const appSecret = trimString(settings?.appSecret);

if (!appId || !appSecret) {
throw new Error("Feishu app credentials are missing.");
}

const cacheKey = `${appId}:${appSecret}`;
const cached = TOKEN_CACHE.get(cacheKey);
if (cached && cached.expiresAt > Date.now() + 60_000) {
return cached.token;
}

const response = await requestFeishu(
buildFeishuApiUrl("open-apis/auth/v3/tenant_access_token/internal"), {
method: "POST",
headers: {
"content-type": "application/json",
},
body: JSON.stringify({
app_id: appId,
app_secret: appSecret,
}),
},
);

const data = await readResponseJson(response.response);
if (!response.ok) {
throw new Error(
`Feishu auth failed (${response.status}): ${JSON.stringify(data)}`,
);
}
if (data != null && typeof data.code === "number" && data.code !== 0) {
throw new Error(`Feishu auth failed: ${data.msg || JSON.stringify(data)}`);
}

const token = trimString(data?.tenant_access_token);
if (!token) {
throw new Error("Feishu tenant access token missing.");
}

TOKEN_CACHE.set(cacheKey, {
token,
expiresAt: Date.now() + Number(data?.expire || 7200) * 1000,
});
return token;
}

function extractImageUrlFromJson(data) {
const payload = toPlainObject(data);
const inner = toPlainObject(payload.data);
return (
trimString(inner.image_url) ||
trimString(inner.download_url) ||
trimString(inner.url) ||
trimString(payload.image_url) ||
trimString(payload.download_url) ||
trimString(payload.url) ||
""
);
}

function buildImageCandidates(imageRef = {}) {
const keys = [
trimString(imageRef.imageKey),
trimString(imageRef.imageToken),
trimString(imageRef.fileKey),
].filter(Boolean);

const uniqueKeys = [...new Set(keys)];
const candidates = [];

for (const key of uniqueKeys) {
candidates.push(
`${buildFeishuApiUrl("open-apis/image/v4/get")}?image_key=${encodeURIComponent(
        key,
      )}`,
`${buildFeishuApiUrl("open-apis/image/v4/get")}?image_token=${encodeURIComponent(
        key,
      )}`,
buildFeishuApiUrl(`open-apis/im/v1/images/${encodeURIComponent(key)}`),
buildFeishuApiUrl(`open-apis/im/v1/images/${encodeURIComponent(
        key,
      )}/download`),
);
}

const messageId = trimString(imageRef.messageId);
for (const key of uniqueKeys) {
if (!messageId) {
continue;
}
candidates.push(
buildFeishuApiUrl(`open-apis/im/v1/messages/${encodeURIComponent(
        messageId,
      )}/resources/${encodeURIComponent(key)}`),
`${buildFeishuApiUrl(`open-apis/im/v1/messages/${encodeURIComponent(
        messageId,
      )}/resources/${encodeURIComponent(key)}`)}?type=image`,
);
}

return [...new Set(candidates)];
}

async function readImageResponse(responseInfo) {
const arrayBuffer = await responseInfo.response.arrayBuffer();
const mimeType =
trimString(responseInfo.headers.get("content-type")) || "image/png";
const base64 = arrayBufferToBase64(arrayBuffer);

return {
type: "image",
mimeType,
data: `data:${mimeType};base64,${base64}`,
};
}

async function fetchImageFromUrl(url, token) {
const response = await requestFeishu(url, {
method: "GET",
headers: token ? {
authorization: `Bearer ${token}`,
} : undefined,
});

if (!response.ok) {
const text = await response.response.text().catch(() => "");
throw new Error(
`Feishu image download failed (${response.status}): ${trimString(text)}`,
);
}

const contentType = response.contentType;
if (
contentType.includes("application/json") ||
contentType.includes("text/json")
) {
const data = await readResponseJson(response.response);
const nestedUrl = extractImageUrlFromJson(data);
if (!nestedUrl) {
throw new Error(
"Feishu image JSON response did not contain a download URL.",
);
}
return fetchImageFromUrl(nestedUrl, "");
}

return readImageResponse(response);
}

async function resolveFeishuImageAttachment(settings, imageRef) {
const token = await getTenantAccessToken(settings);
const candidates = buildImageCandidates(imageRef);
if (candidates.length === 0) {
throw new Error("Feishu image key is missing.");
}

const errors = [];

for (const url of candidates) {
try {
const response = await requestFeishu(url, {
method: "GET",
headers: {
authorization: `Bearer ${token}`,
},
});

if (!response.ok) {
const text = await response.response.text().catch(() => "");
errors.push(`${url} -> HTTP ${response.status} ${trimString(text)}`);
continue;
}

if (
response.contentType.startsWith("image/") ||
response.contentType.includes("application/octet-stream")
) {
return readImageResponse(response);
}

const data = await readResponseJson(response.response);
const imageUrl = extractImageUrlFromJson(data);
if (imageUrl) {
return fetchImageFromUrl(imageUrl, token);
}

if (data != null && typeof data.code === "number" && data.code !== 0) {
errors.push(`${url} -> ${data.msg || JSON.stringify(data)}`);
continue;
}

errors.push(`${url} -> unsupported JSON response`);
} catch (error) {
errors.push(
`${url} -> ${
          error instanceof Error ? error.message : JSON.stringify(error)
        }`,
);
}
}

throw new Error(
`Unable to resolve Feishu image attachment. ${errors
      .filter(Boolean)
      .slice(0, 4)
      .join(" | ")}`,
);
}

async function requestFeishuJson(payload) {
const url = trimString(payload?.url);
if (!url) {
throw new Error("Feishu request url is missing.");
}

const method = trimString(payload?.method || "GET").toUpperCase() || "GET";
const headers = toPlainObject(payload?.headers);
const body =
typeof payload?.body === "string" ?
payload.body :
payload?.body == null ?
undefined :
JSON.stringify(payload.body);

const response = await requestFeishu(url, {
method,
headers,
body,
});

const data = await readResponseJson(response.response);
if (!response.ok) {
throw new Error(
`Feishu request failed (${response.status}): ${JSON.stringify(data)}`,
);
}

if (data != null && typeof data.code === "number" && data.code !== 0) {
throw new Error(
`Feishu request failed: ${data.msg || JSON.stringify(data)}`,
);
}

return data;
}

async function normalizeAppUploadImageSource(imageSource = {}) {
const src = trimString(imageSource?.src);
if (!src) {
throw new Error("Feishu app upload image source is missing.");
}

if (/^data:image\//i.test(src)) {
const match = src.match(/^data:([^;,]+);base64,(.+)$/i);
if (!match) {
throw new Error("Unsupported data URL image source.");
}

return {
buffer: Buffer.from(match[2], "base64"),
mimeType: trimString(match[1]) || "image/png",
name: trimString(imageSource?.name) || "codex-image",
};
}

if (/^https?:\/\//i.test(src)) {
const response = await requestFeishu(src, {
method: "GET",
});
if (!response.ok) {
const text = await response.response.text().catch(() => "");
throw new Error(
`Image fetch failed (${response.status}): ${trimString(text)}`,
);
}

const arrayBuffer = await response.response.arrayBuffer();
return {
buffer: Buffer.from(arrayBuffer),
mimeType: trimString(response.headers.get("content-type")) || "image/png",
name: trimString(imageSource?.name) || "codex-image",
};
}

const absolutePath = getImageSourceAbsolutePath(imageSource);
if (!absolutePath) {
throw new Error("Image source path could not be resolved.");
}

const buffer = await fs.readFile(absolutePath);
const extension = trimString(path.extname(absolutePath)).toLowerCase();
let mimeType = trimString(imageSource?.mimeType);
if (!mimeType) {
mimeType =
extension === ".jpg" || extension === ".jpeg" ?
"image/jpeg" :
extension === ".webp" ?
"image/webp" :
extension === ".gif" ?
"image/gif" :
"image/png";
}

return {
buffer,
mimeType,
name: trimString(imageSource?.name) || path.basename(absolutePath),
};
}

async function uploadFeishuAppImage(settings, imageSource) {
const token = await getTenantAccessToken(settings);
const normalized = await normalizeAppUploadImageSource(imageSource);
const formData = new FormData();
const blob = new Blob([normalized.buffer], {
type: normalized.mimeType || "image/png",
});
formData.set("image_type", trimString(imageSource?.imageType) || "message");
formData.set("image", blob, normalized.name || "codex-image");

const response = await requestFeishu(buildFeishuApiUrl("open-apis/im/v1/images"), {
method: "POST",
headers: {
authorization: `Bearer ${token}`,
},
body: formData,
});

const data = await readResponseJson(response.response);
if (!response.ok) {
throw new Error(
`Feishu image upload failed (${response.status}): ${JSON.stringify(data)}`,
);
}
if (data != null && typeof data.code === "number" && data.code !== 0) {
throw new Error(
`Feishu image upload failed: ${data.msg || JSON.stringify(data)}`,
);
}

const imageKey = trimString(data?.data?.image_key || data?.image_key);
if (!imageKey) {
throw new Error("Feishu image upload response missing image_key.");
}

return {
imageKey,
previewDataUrl: bufferToDataUrl(normalized.buffer, normalized.mimeType),
};
}

function getFeishuDebugLogPath() {
return path.join(
app.getPath("userData"),
FEISHU_DEBUG_LOG_DIRNAME,
FEISHU_DEBUG_LOG_FILENAME,
);
}

async function rotateFeishuDebugLogIfNeeded(filePath) {
try {
const stats = await fs.stat(filePath);
if (stats.size < FEISHU_DEBUG_LOG_MAX_BYTES) {
return;
}

const rotatedPath = `${filePath}.1`;
try {
await fs.unlink(rotatedPath);
} catch {}
await fs.rename(filePath, rotatedPath);
} catch {}
}

async function appendFeishuDebugLog(payload) {
if (!isFeishuDebugLogEnabled()) {
return {
ok: true,
disabled: true,
};
}

const filePath = getFeishuDebugLogPath();
await fs.mkdir(path.dirname(filePath), {
recursive: true
});
await rotateFeishuDebugLogIfNeeded(filePath);

const record = {
ts: new Date().toISOString(),
...(toPlainObject(payload) || {}),
};
await fs.appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
return {
ok: true,
path: filePath,
};
}

function registerPortableHostBridgeMain() {
if (ipcMain.handle.__portableHostBridgeRegistered) {
return;
}

ipcMain.handle(PORTABLE_HOST_CHANNEL, async (event, payload) => {
const request = toPlainObject(payload);
switch (request.action) {
case "append-debug-log":
return appendFeishuDebugLog(request.payload);
case "feishu-runtime-configure":
return configureFeishuRuntime(request);
case "feishu-runtime-status":
return getFeishuRuntimeStatus();
case "feishu-control-port-register":
return registerFeishuControlPort(event, request);
case "feishu-control-port-unregister":
return unregisterFeishuControlPort(event, request);
case "feishu-control-response":
return handleFeishuControlResponse(request);
case "openai-api-key":
return {
value: readPortableApiSettings().apiKey || null,
};
case "portable-api-settings-read":
return readPortableApiSettings();
case "portable-api-settings-write":
return writePortableApiSettings(toPlainObject(request.params));
case "resolve-image-attachment":
return resolveFeishuImageAttachment(request.settings, request.imageRef);
case "upload-app-image":
return uploadFeishuAppImage(request.settings, {
...(request.imageSource && typeof request.imageSource === "object" ?
request.imageSource :
{}),
imageType: trimString(request.imageType),
});
case "request-json":
return requestFeishuJson(request);
case "feishu-runtime-state-read":
return readRuntimeState();
case "feishu-runtime-state-write":
return writeRuntimeStateValue(request);
case "feishu-message-processed-check":
return isMessageProcessed(request);
case "feishu-message-processed-mark":
return markMessageProcessed(request);
case "feishu-message-claim-try":
return tryClaimMessage(request);
case "feishu-message-claim-release":
return releaseMessageClaim(request);
case "feishu-poll-cursor-get":
return getPollCursor(request);
case "feishu-poll-cursor-set":
return setPollCursor(request);
case "feishu-queue-message-enqueue":
return enqueueConversationMessage(request);
case "feishu-queue-message-peek":
return peekQueuedConversationMessage(request);
case "feishu-queue-message-dequeue":
return dequeueConversationMessage(request);
case "feishu-pending-image-queue":
return queuePendingImage(request);
case "feishu-pending-image-take":
return takePendingImages(request);
case "feishu-pending-image-restore":
return restorePendingImages(request);
default:
throw new Error(
`Unsupported portable Feishu action: ${trimString(request.action)}`,
);
}
});

ipcMain.handle.__portableHostBridgeRegistered = true;
}

module.exports = {
PORTABLE_HOST_CHANNEL,
registerPortableHostBridgeMain,
};
