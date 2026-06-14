"use strict";

// PORTABLE_PATCH: Host-side Feishu runtime boundary. The renderer only exposes
// PORTABLE_PATCH: a thin conversation-control port; Feishu orchestration lives here.
const crypto = require("node:crypto");

const MESSAGE_FOR_VIEW_CHANNEL = "codex_desktop:message-for-view";
const FEISHU_CONTROL_REQUEST_TYPE = "portable-feishu-control-request";
const DEFAULT_CONTROL_TIMEOUT_MS = 30_000;
const CONTROL_PORTS = new Map();
const CONTROL_PENDING = new Map();
let runtimeConfig = {
enabled: false,
hostId: "local",
config: null,
updatedAt: 0,
};

function trimString(value) {
return typeof value === "string" ? value.trim() : "";
}

function normalizeHostId(value) {
return trimString(value) || "local";
}

function createRequestId(action) {
const suffix =
typeof crypto.randomUUID === "function" ?
crypto.randomUUID() :
`${Date.now()}-${Math.random().toString(16).slice(2)}`;
return `portable-feishu:${trimString(action) || "request"}:${suffix}`;
}

function summarizePort(port) {
return port ? {
hostId: port.hostId,
webContentsId: port.webContents?.id || 0,
registeredAt: port.registeredAt,
updatedAt: port.updatedAt,
} : null;
}

function getControlPort(hostId = "local") {
const normalizedHostId = normalizeHostId(hostId);
const port = CONTROL_PORTS.get(normalizedHostId) || null;
if (port?.webContents?.isDestroyed?.()) {
CONTROL_PORTS.delete(normalizedHostId);
return null;
}
return port;
}

function registerFeishuControlPort(event, request = {}) {
const webContents = event?.sender || null;
if (!webContents) {
throw new Error("Feishu control port requires a sender webContents.");
}

const hostId = normalizeHostId(request.hostId);
const existing = CONTROL_PORTS.get(hostId);
if (existing?.webContents === webContents) {
existing.updatedAt = Date.now();
return {
ok: true,
port: summarizePort(existing),
};
}

const port = {
hostId,
webContents,
registeredAt: Date.now(),
updatedAt: Date.now(),
};
CONTROL_PORTS.set(hostId, port);

webContents.once("destroyed", () => {
const current = CONTROL_PORTS.get(hostId);
if (current?.webContents === webContents) {
CONTROL_PORTS.delete(hostId);
}
});

return {
ok: true,
port: summarizePort(port),
};
}

function unregisterFeishuControlPort(event, request = {}) {
const hostId = normalizeHostId(request.hostId);
const webContents = event?.sender || null;
const current = CONTROL_PORTS.get(hostId);
if (current && (!webContents || current.webContents === webContents)) {
CONTROL_PORTS.delete(hostId);
}

return {
ok: true,
hostId,
};
}

function configureFeishuRuntime(request = {}) {
runtimeConfig = {
enabled: request.enabled === true,
hostId: normalizeHostId(request.hostId),
config: request.config && typeof request.config === "object" ? request.config : null,
updatedAt: Date.now(),
};
return {
ok: true,
runtime: {
enabled: runtimeConfig.enabled,
hostId: runtimeConfig.hostId,
updatedAt: runtimeConfig.updatedAt,
hasControlPort: Boolean(getControlPort(runtimeConfig.hostId)),
},
};
}

function handleFeishuControlResponse(request = {}) {
const requestId = trimString(request.requestId);
if (!requestId) {
return {
ok: false,
reason: "missing-request-id",
};
}

const pending = CONTROL_PENDING.get(requestId);
if (!pending) {
return {
ok: false,
reason: "missing-pending-request",
};
}

CONTROL_PENDING.delete(requestId);
clearTimeout(pending.timerId);

if (request.ok === false) {
pending.reject(new Error(trimString(request.error) || "Feishu control request failed."));
} else {
pending.resolve(request.result ?? null);
}

return {
ok: true,
requestId,
};
}

function invokeFeishuControlPort(
action,
params = {}, {
hostId = runtimeConfig.hostId,
timeoutMs = DEFAULT_CONTROL_TIMEOUT_MS,
} = {},
) {
const normalizedHostId = normalizeHostId(hostId);
const port = getControlPort(normalizedHostId);
if (!port) {
return Promise.reject(
new Error(`Feishu control port is unavailable for host ${normalizedHostId}.`),
);
}

const requestId = createRequestId(action);
const message = {
type: FEISHU_CONTROL_REQUEST_TYPE,
requestId,
hostId: normalizedHostId,
action: trimString(action),
params,
};

return new Promise((resolve, reject) => {
const timerId = setTimeout(() => {
CONTROL_PENDING.delete(requestId);
reject(new Error(`Feishu control request timed out: ${message.action}`));
}, Math.max(1_000, Number(timeoutMs) || DEFAULT_CONTROL_TIMEOUT_MS));

CONTROL_PENDING.set(requestId, {
resolve,
reject,
timerId,
});

try {
port.webContents.send(MESSAGE_FOR_VIEW_CHANNEL, message);
} catch (error) {
clearTimeout(timerId);
CONTROL_PENDING.delete(requestId);
reject(error);
}
});
}

function getFeishuRuntimeStatus() {
return {
runtime: {
enabled: runtimeConfig.enabled,
hostId: runtimeConfig.hostId,
updatedAt: runtimeConfig.updatedAt,
hasConfig: Boolean(runtimeConfig.config),
},
ports: [...CONTROL_PORTS.values()].map(summarizePort),
pendingCount: CONTROL_PENDING.size,
};
}

module.exports = {
configureFeishuRuntime,
getFeishuRuntimeStatus,
handleFeishuControlResponse,
invokeFeishuControlPort,
registerFeishuControlPort,
unregisterFeishuControlPort,
};
