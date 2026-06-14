// PORTABLE_PATCH: Stable portable host bridge. Official bundles install live
// host capabilities here, while portable business files only depend on this
// stable portable module graph.
const SETTINGS_PLUGINS = [];
const SETTINGS_PAGE_PLUGINS = [];
const BRIDGE_PLUGINS = [];
const LOGIN_PLUGINS = [];
const ARCHIVE_PLUGINS = [];
const MANAGER_PATCHES = [];
const APPLIED_MANAGER_PATCH_IDS = new Set();
const PORTABLE_HOST_CAPABILITIES = Object.create(null);

function isPortableRegistryDebugEnabled() {
return globalThis.__CODEX_PORTABLE_REGISTRY_DEBUG__ === true;
}

function trimPortableRegistryText(value) {
return typeof value === "string" ? value.trim() : "";
}

function describePortableRegistryWindowContext() {
if (typeof window === "undefined") {
return {
href: "",
pathname: "",
initialRoute: "",
title: "",
};
}

let href = "";
let pathname = "";
let initialRoute = "";
try {
const url = new URL(window.location.href);
href = trimPortableRegistryText(url.toString());
pathname = trimPortableRegistryText(url.pathname);
initialRoute = trimPortableRegistryText(url.searchParams.get("initialRoute"));
} catch {}

if (!initialRoute && typeof document !== "undefined") {
initialRoute = trimPortableRegistryText(
document
.querySelector("meta[name='initial-route']")
?.getAttribute("content"),
);
}

return {
href,
pathname,
initialRoute,
title: typeof document !== "undefined" ?
trimPortableRegistryText(document.title) : "",
};
}

function emitPortableRegistryDebugLog(event, detail = {}) {
if (!isPortableRegistryDebugEnabled()) {
return;
}

const payload = {
type: "portable-registry",
event,
timestamp: Date.now(),
window: describePortableRegistryWindowContext(),
detail,
};

try {
const bridge = globalThis.window?.electronBridge;
if (typeof bridge?.portableHostInvoke === "function") {
bridge.portableHostInvoke({
action: "append-debug-log",
payload,
}).catch(() => {});
return;
}
} catch {}

}

function normalizeId(value, kind) {
const normalized = typeof value === "string" ? value.trim() : "";
if (!normalized) {
throw new Error(`Portable ${kind} requires a non-empty id.`);
}
return normalized;
}

function normalizeOrder(value) {
return Number.isFinite(value) ? Number(value) : 100;
}

function sortByOrderThenId(entries) {
entries.sort((left, right) => {
if (left.order !== right.order) {
return left.order - right.order;
}
return left.id.localeCompare(right.id);
});
}

function upsertPlugin(registry, plugin) {
const existingIndex = registry.findIndex((entry) => entry.id === plugin.id);
if (existingIndex >= 0) {
registry.splice(existingIndex, 1, plugin);
} else {
registry.push(plugin);
}
sortByOrderThenId(registry);
return plugin;
}

function requirePortableHostCapability(name) {
const capability = PORTABLE_HOST_CAPABILITIES[name];
if (capability == null) {
throw new Error(`Portable host capability is unavailable: ${name}`);
}
return capability;
}

function createPortableObjectProxy(name) {
return new Proxy({}, {
get(target, property, receiver) {
if (Reflect.has(target, property)) {
return Reflect.get(target, property, receiver);
}
return requirePortableHostCapability(name)[property];
},
set(target, property, value, receiver) {
return Reflect.set(target, property, value, receiver);
},
}, );
}

function createPortableFunctionProxy(name) {
const callable = (...args) => requirePortableHostCapability(name)(...args);

return new Proxy(callable, {
apply(_target, _thisArg, args) {
return requirePortableHostCapability(name)(...args);
},
get(_target, property) {
return requirePortableHostCapability(name)[property];
},
});
}

export function installPortableHostBridge(definition) {
if (!definition || typeof definition !== "object") {
return PORTABLE_HOST_CAPABILITIES;
}

emitPortableRegistryDebugLog("install-host-bridge", {
capabilityKeys: Object.keys(definition).sort(),
});
Object.assign(PORTABLE_HOST_CAPABILITIES, definition);
return PORTABLE_HOST_CAPABILITIES;
}

export const React = createPortableObjectProxy("React");
export const JSX = createPortableObjectProxy("JSX");
export const SettingsGroup = createPortableFunctionProxy("SettingsGroup");
export const SettingsRow = createPortableFunctionProxy("SettingsRow");
export const Toggle = createPortableFunctionProxy("Toggle");
export const createPortal = createPortableFunctionProxy("createPortal");
export const nativeRequest = createPortableFunctionProxy("nativeRequest");
export const portableAppServerRequestBus = createPortableObjectProxy(
"portableAppServerRequestBus",
);
export const useGlobalState = createPortableFunctionProxy("useGlobalState");
export const useAppServerManager = createPortableFunctionProxy(
"useAppServerManager",
);
export const useAppServerRegistry = createPortableFunctionProxy(
"useAppServerRegistry",
);
export const sendPortableAppServerRequest = createPortableFunctionProxy(
"sendPortableAppServerRequest",
);
export const refreshPortableModelListOverride = createPortableFunctionProxy(
"refreshPortableModelListOverride",
);
export const appendPortableModelListOverrideLog = createPortableFunctionProxy(
"appendPortableModelListOverrideLog",
);
export const loadPortableModelListForHost = createPortableFunctionProxy(
"loadPortableModelListForHost",
);

export function usePortableSettingsHostSelection(...args) {
return requirePortableHostCapability("usePortableSettingsHostSelection")(
...args,
);
}

export function usePortableConversationNavigator(...args) {
return requirePortableHostCapability("usePortableConversationNavigator")(
...args,
);
}

export function usePortableIntl(...args) {
return requirePortableHostCapability("usePortableIntl")(...args);
}

export function getPortableProjectName(...args) {
return requirePortableHostCapability("getPortableProjectName")(...args);
}

export function getPortableGeneralSettingsComponent() {
return requirePortableHostCapability("getPortableGeneralSettingsComponent");
}

export function getPortableSettingsContentLayoutComponent() {
return requirePortableHostCapability("getPortableSettingsContentLayoutComponent");
}

export function describePortableGlobalStateCandidates() {
return requirePortableHostCapability("describePortableGlobalStateCandidates")();
}

export function resolvePortableGlobalStateScope() {
return requirePortableHostCapability("resolvePortableGlobalStateScope")();
}

export function resolvePortableGlobalStateStoreHook() {
return requirePortableHostCapability("resolvePortableGlobalStateStoreHook")();
}

export function writePortableHostGlobalStateValue(globalStateStore, key, value) {
return requirePortableHostCapability("writePortableHostGlobalStateValue")(
globalStateStore,
key,
value,
);
}

export function sendPortableRawHostRequest(method, payload) {
return requirePortableHostCapability("sendPortableRawHostRequest")(
method,
payload,
);
}

export function resolvePortableManagerPrototype() {
return requirePortableHostCapability("resolvePortableManagerPrototype")();
}

export function ensurePortableHostConversationReady(manager, options = {}) {
return requirePortableHostCapability("ensurePortableHostConversationReady")(
manager,
options,
);
}

export function startPortableHostConversationTurn(
manager,
conversationId,
options = {},
) {
return requirePortableHostCapability("startPortableHostConversationTurn")(
manager,
conversationId,
options,
);
}

export function steerPortableHostConversationTurn(
manager,
conversationId,
input,
restoreMessage,
attachments,
options = {},
) {
return requirePortableHostCapability("steerPortableHostConversationTurn")(
manager,
conversationId,
input,
restoreMessage,
attachments,
options,
);
}

export function registerPortableSettingsPlugin(definition) {
if (typeof definition?.renderGroup !== "function") {
throw new Error("Portable settings plugin must provide renderGroup().");
}

const plugin = upsertPlugin(SETTINGS_PLUGINS, {
id: normalizeId(definition.id, "settings plugin"),
order: normalizeOrder(definition.order),
renderGroup: definition.renderGroup,
});
emitPortableRegistryDebugLog("register-settings-plugin", {
id: plugin.id,
order: plugin.order,
registrySize: SETTINGS_PLUGINS.length,
registryIds: SETTINGS_PLUGINS.map((entry) => entry.id),
});
return plugin;
}

export function listPortableSettingsPlugins() {
return SETTINGS_PLUGINS.slice();
}

export function registerPortableSettingsPagePlugin(definition) {
if (typeof definition?.renderSettingsPage !== "function") {
throw new Error(
"Portable settings page plugin must provide renderSettingsPage().",
);
}

const settingsSection = normalizePortableSettingsSection(
definition?.settingsSection,
);
if (settingsSection == null) {
throw new Error(
"Portable settings page plugin must provide settingsSection.",
);
}

const plugin = upsertPlugin(SETTINGS_PAGE_PLUGINS, {
id: normalizeId(definition.id, "settings page plugin"),
order: normalizeOrder(definition.order),
hiddenSettingsSectionSlugs: normalizePortableSettingsSectionSlugs(
definition.hiddenSettingsSectionSlugs,
),
renderSettingsPage: definition.renderSettingsPage,
settingsSection,
});
emitPortableRegistryDebugLog("register-settings-page-plugin", {
id: plugin.id,
order: plugin.order,
settingsSectionSlug: plugin.settingsSection?.slug ?? "",
registrySize: SETTINGS_PAGE_PLUGINS.length,
registryIds: SETTINGS_PAGE_PLUGINS.map((entry) => entry.id),
});
return plugin;
}

export function listPortableSettingsPagePlugins() {
return SETTINGS_PAGE_PLUGINS.slice();
}

export function resolvePortableSettingsPagePlugin(slug) {
const normalizedSlug = typeof slug === "string" ? slug.trim() : "";
if (!normalizedSlug) {
return null;
}

const settingsPagePlugin =
SETTINGS_PAGE_PLUGINS.find(
(plugin) => plugin.settingsSection?.slug === normalizedSlug,
) ?? null;
if (settingsPagePlugin != null) {
return settingsPagePlugin;
}

const archivePlugin = ARCHIVE_PLUGINS.find(
(plugin) =>
plugin.settingsSection?.slug === normalizedSlug &&
typeof plugin.renderSettingsPage === "function",
);
return archivePlugin ?? null;
}

export function registerPortableBridgePlugin(definition) {
if (typeof definition?.Component !== "function") {
throw new Error("Portable bridge plugin must provide Component.");
}

const plugin = upsertPlugin(BRIDGE_PLUGINS, {
id: normalizeId(definition.id, "bridge plugin"),
order: normalizeOrder(definition.order),
Component: definition.Component,
});
emitPortableRegistryDebugLog("register-bridge-plugin", {
id: plugin.id,
order: plugin.order,
registrySize: BRIDGE_PLUGINS.length,
registryIds: BRIDGE_PLUGINS.map((entry) => entry.id),
});
return plugin;
}

export function listPortableBridgePlugins() {
const plugins = BRIDGE_PLUGINS.slice();
emitPortableRegistryDebugLog("list-bridge-plugins", {
registrySize: plugins.length,
registryIds: plugins.map((entry) => entry.id),
});
return plugins;
}

export function registerPortableLoginPlugin(definition) {
if (typeof definition?.resolveApiUrlFromConfig !== "function") {
throw new Error(
"Portable login plugin must provide resolveApiUrlFromConfig().",
);
}
if (typeof definition?.loadApiKeyValue !== "function") {
throw new Error("Portable login plugin must provide loadApiKeyValue().");
}
if (typeof definition?.persistAfterLogin !== "function") {
throw new Error("Portable login plugin must provide persistAfterLogin().");
}

return upsertPlugin(LOGIN_PLUGINS, {
id: normalizeId(definition.id, "login plugin"),
order: normalizeOrder(definition.order),
officialApiBaseUrl: typeof definition.officialApiBaseUrl === "string" ?
definition.officialApiBaseUrl : "",
resolveApiUrlFromConfig: definition.resolveApiUrlFromConfig,
loadApiKeyValue: definition.loadApiKeyValue,
persistAfterLogin: definition.persistAfterLogin,
});
}

export function listPortableLoginPlugins() {
return LOGIN_PLUGINS.slice();
}

export function resolvePortableLoginPlugin() {
return LOGIN_PLUGINS[0] ?? null;
}

function normalizePortableSettingsSection(definition) {
if (definition == null || typeof definition !== "object") {
return null;
}

const slug = normalizeId(
definition.slug,
"archive settings section slug",
);
const title =
typeof definition.title === "string" ? definition.title.trim() : "";
const titleMessage =
definition.titleMessage != null && typeof definition.titleMessage === "object" ?
definition.titleMessage :
null;
const hasTitleMessage =
titleMessage != null &&
typeof titleMessage.defaultMessage === "string" &&
titleMessage.defaultMessage.trim().length > 0;

if (!title && !hasTitleMessage) {
throw new Error(
"Portable archive settings section must provide title or titleMessage.",
);
}

return {
slug,
title,
titleMessage,
icon: typeof definition.icon === "function" ? definition.icon : null,
};
}

function normalizePortableSettingsSectionSlugs(values) {
if (!Array.isArray(values)) {
return [];
}

const result = [];
for (const value of values) {
const normalized = typeof value === "string" ? value.trim() : "";
if (!normalized) {
continue;
}
if (!result.includes(normalized)) {
result.push(normalized);
}
}
return result;
}

export function registerPortableArchivePlugin(definition) {
const hasGroupedRenderer = typeof definition?.renderArchivedGroups === "function";
const hasSettingsPageRenderer =
typeof definition?.renderSettingsPage === "function";

if (!hasGroupedRenderer && !hasSettingsPageRenderer) {
throw new Error(
"Portable archive plugin must provide renderArchivedGroups() or renderSettingsPage().",
);
}

const settingsSection = normalizePortableSettingsSection(
definition?.settingsSection,
);
if (settingsSection != null && !hasSettingsPageRenderer) {
throw new Error(
"Portable archive plugin settingsSection requires renderSettingsPage().",
);
}

return upsertPlugin(ARCHIVE_PLUGINS, {
id: normalizeId(definition.id, "archive plugin"),
order: normalizeOrder(definition.order),
hiddenSettingsSectionSlugs: normalizePortableSettingsSectionSlugs(
definition.hiddenSettingsSectionSlugs,
),
renderArchivedGroups: hasGroupedRenderer ?
definition.renderArchivedGroups : null,
renderSettingsPage: hasSettingsPageRenderer ?
definition.renderSettingsPage : null,
settingsSection,
});
}

export function listPortableArchivePlugins() {
return ARCHIVE_PLUGINS.slice();
}

export function resolvePortableArchivePlugin() {
return ARCHIVE_PLUGINS[0] ?? null;
}

export function registerPortableManagerPatch(definition) {
if (typeof definition?.apply !== "function") {
throw new Error("Portable manager patch must provide apply().");
}

const patch = upsertPlugin(MANAGER_PATCHES, {
id: normalizeId(definition.id, "manager patch"),
order: normalizeOrder(definition.order),
apply: definition.apply,
});
emitPortableRegistryDebugLog("register-manager-patch", {
id: patch.id,
order: patch.order,
registrySize: MANAGER_PATCHES.length,
registryIds: MANAGER_PATCHES.map((entry) => entry.id),
});
return patch;
}

export function applyPortableManagerPatches() {
let appliedCount = 0;
const appliedIds = [];

for (const patch of MANAGER_PATCHES) {
if (APPLIED_MANAGER_PATCH_IDS.has(patch.id)) {
continue;
}

patch.apply();
APPLIED_MANAGER_PATCH_IDS.add(patch.id);
appliedCount += 1;
appliedIds.push(patch.id);
}

emitPortableRegistryDebugLog("apply-manager-patches", {
appliedCount,
appliedIds,
totalRegistered: MANAGER_PATCHES.length,
alreadyAppliedIds: [...APPLIED_MANAGER_PATCH_IDS],
});
return appliedCount;
}

function normalizeParams(payload) {
if (payload != null && typeof payload === "object" && "params" in payload) {
return payload.params ?? {};
}
return payload ?? {};
}

function resolveHostId(payload) {
const params = normalizeParams(payload);
return typeof params.hostId === "string" && params.hostId.trim().length > 0 ?
params.hostId :
"local";
}

function unwrapMcpResult(message) {
if (message?.error != null) {
const error = message.error;
throw new Error(
typeof error === "string" ?
error :
error?.message || "portable-mcp-request-failed",
);
}
return message?.result ?? null;
}

export function resolvePortableElectronBridge() {
return globalThis.window?.electronBridge ?? null;
}

export function requirePortableElectronBridge(capability) {
const bridge = resolvePortableElectronBridge();
if (!bridge) {
throw new Error("Portable electron bridge is unavailable.");
}

if (
typeof capability === "string" &&
capability.trim().length > 0 &&
typeof bridge[capability] !== "function"
) {
throw new Error(`Portable electron bridge does not expose ${capability}.`);
}

return bridge;
}

export function invokePortableHostBridge(payload) {
const bridge = requirePortableElectronBridge("portableHostInvoke");
return bridge.portableHostInvoke(payload);
}

export function sendPortableMcpRequest(
method,
params, {
hostId = "local",
timeoutMs = 10000
} = {},
) {
const bridge = requirePortableElectronBridge("sendMessageFromView");
const request = {
id: `portable-${method}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
method,
params,
};

return new Promise((resolve, reject) => {
const timer = globalThis.window.setTimeout(() => {
globalThis.window.removeEventListener("message", onMessage);
reject(new Error(`Timed out waiting for ${method}`));
}, timeoutMs);

const cleanup = () => {
globalThis.window.clearTimeout(timer);
globalThis.window.removeEventListener("message", onMessage);
};

const onMessage = (event) => {
const data = event?.data;
if (data?.type !== "mcp-response" || data?.message?.id !== request.id) {
return;
}
cleanup();
try {
resolve(unwrapMcpResult(data.message));
} catch (error) {
reject(error);
}
};

globalThis.window.addEventListener("message", onMessage);
bridge.sendMessageFromView({
type: "mcp-request",
hostId,
request,
});
});
}

export async function listPortableArchivedThreads(payload = {}) {
const params = normalizeParams(payload);
const result = await sendPortableMcpRequest(
"thread/list", {
limit: 200,
cursor: null,
sortKey: "updated_at",
modelProviders: [],
sourceKinds: [],
archived: true,
}, {
hostId: resolveHostId(params)
},
);
return Array.isArray(result?.data) ? result.data : [];
}

export async function unarchivePortableConversation(payload = {}) {
const params = normalizeParams(payload);
const threadId = String(
params.threadId ?? params.conversationId ?? "",
).trim();
if (threadId.length === 0) {
throw new Error("Missing threadId for archived chat unarchive");
}

return sendPortableMcpRequest(
"thread/unarchive", {
threadId,
}, {
hostId: resolveHostId(params)
},
);
}

export async function deletePortableArchivedConversation(payload = {}) {
const params = normalizeParams(payload);
const conversationId = String(
params.conversationId ?? params.threadId ?? "",
).trim();
const path =
typeof params.path === "string" ? params.path.trim() : "";

if (conversationId.length === 0) {
throw new Error("Missing conversationId for archived chat deletion");
}
if (path.length === 0) {
throw new Error("Missing archived path for archived chat deletion");
}

return sendPortableAppServerRequest("delete-archived-conversation", {
hostId: resolveHostId(params),
conversationId,
path,
});
}

export function sendPortableHostRequest(method, payload) {
switch (method) {
case "list-archived-threads":
return listPortableArchivedThreads(payload);
case "unarchive-conversation":
return unarchivePortableConversation(payload);
case "delete-archived-conversation":
return deletePortableArchivedConversation(payload);
default:
return sendPortableRawHostRequest(method, payload);
}
}
