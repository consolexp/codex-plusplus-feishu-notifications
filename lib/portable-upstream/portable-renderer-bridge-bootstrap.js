import {
n as ReactFactory,
t as JSXFactory
} from "./jsx-runtime-CiQ1k8xo.js";
import {
t as rawUseGlobalState
} from "./use-global-state-DjfvqpEA.js";
import {
o as useAppServerRegistry,
r as useAppServerManager
} from "./app-server-manager-hooks-ZyucQ4vj.js";
import {
g as portableNativeRequestClient
} from "./setting-storage-EK1Te68s.js";

function portableFormatPathTemplate(path, parameters = {}) {
return String(path).replace(/\{([^}]+)\}/g, (match, key) => String(parameters[key] ?? match))
}

function portableBuildQueryString(query) {
if (!query) return ``;
let params = new URLSearchParams;
for (let [key, value] of Object.entries(query)) {
if (Array.isArray(value))
for (let item of value) params.append(key, portableStringifyQueryValue(item));
else if (value != null) params.append(key, portableStringifyQueryValue(value))
}
let text = params.toString();
return text.length === 0 ? `` : `?${text}`
}

function portableStringifyQueryValue(value) {
return typeof value == `string` || typeof value == `number` || typeof value == `boolean` ||
typeof value == `bigint` ? String(value) : JSON.stringify(value) ?? ``
}

function portableBuildRequestPath(path, options = {}) {
let parameters = options?.parameters ?? {};
let formatted = portableFormatPathTemplate(path, parameters.path ?? {});
return `${formatted}${portableBuildQueryString(parameters.query)}`
}

const nativeRequest = {
async safeGet(path, options = {}) {
return (await portableNativeRequestClient.getInstance().get(portableBuildRequestPath(path,
options), options.additionalHeaders)).body
},
async safePost(path, options = {}) {
let body = options && `requestBody` in options ? JSON.stringify(options.requestBody) :
void 0;
return (await portableNativeRequestClient.getInstance().post(portableBuildRequestPath(path,
options), body, options.additionalHeaders)).body
},
async safePatch(path, options = {}) {
let body = options && `requestBody` in options ? JSON.stringify(options.requestBody) :
void 0;
return (await portableNativeRequestClient.getInstance().sendRequest(`PATCH`,
portableBuildRequestPath(path, options), {
body,
headers: options.additionalHeaders
})).body
},
async safeDelete(path, options = {}) {
let response = await portableNativeRequestClient.getInstance().sendRequest(`DELETE`,
portableBuildRequestPath(path, options), {
headers: options.additionalHeaders
});
return response.status === 204 ? void 0 : response.body
}
};
import {
t as getPortableProjectName
} from "./get-project-name-D3LJ0iVD.js";
import {
t as usePortableSettingsHostSelection
} from "./settings-host-context-B5kZhSF6.js";
import {
S as portableAppScope,
Y as usePortableScopeHost,
l as sendPortableRequest
} from "./setting-storage-EK1Te68s.js";
import {
t as portableGlobalStateSignal
} from "./use-global-state-DjfvqpEA.js";
import {
t as portableIntlSignal
} from "./app-intl-signal-jHPWCZy6.js";
import {
Ct as rawWriteGlobalStateValue
} from "./app-server-manager-signals-Csopz8aM.js";
import {
t as SettingsGroup
} from "./settings-group-DNhpghsa.js";
import {
n as SettingsRow
} from "./settings-row-DYYQqFuu.js";
import {
t as Toggle
} from "./toggle-Ray5d_Lx.js";
import {
t as SettingsContentLayout
} from "./settings-content-layout-Bnulb0lM.js";
import {
t as ReactDOM
} from "./react-dom-De86Q4ix.js";
import {
r as OriginalGeneralSettings
} from "./general-settings-CdQ05ABJ.js";
import {
ns as portableAppServerRequestBus,
ts as sendPortableAppServerRequest
} from "./app-server-manager-signals-Csopz8aM.js";
import {
installPortableHostBridge
} from "./portable-host-request-compat.js";

function psTrimPortableBootstrapText(e) {
return typeof e === `string` ? e.trim() : ``
}

function psGetPortableBootstrapRouteInfo() {
if (typeof window === `undefined`) return {
href: ``,
pathname: ``,
initialRoute: ``
};
let e = ``;
let t = ``;
let n = ``;
try {
let r = new URL(window.location.href);
e = psTrimPortableBootstrapText(r.toString());
t = psTrimPortableBootstrapText(r.pathname);
n = psTrimPortableBootstrapText(r.searchParams.get(`initialRoute`))
} catch {}
if (!n && typeof document < `u`) n = psTrimPortableBootstrapText(document.querySelector(
`meta[name='initial-route']`)?.getAttribute(`content`));
return {
href: e,
pathname: t,
initialRoute: n
}
}

async function psAppendPortableBootstrapDebugLog(e, t = {}) {
try {
if (window.__CODEX_PORTABLE_REGISTRY_DEBUG__ !== true) return;
let n = window.electronBridge;
if (typeof(n?.portableHostInvoke) != `function`) return;
await n.portableHostInvoke({
action: `append-debug-log`,
payload: {
type: `portable-bootstrap`,
event: e,
timestamp: Date.now(),
route: psGetPortableBootstrapRouteInfo(),
detail: t
}
})
} catch {}
}

function sendPortableRawHostRequest(method, payload) {
return sendPortableRequest(method, payload)
}

function resolvePortableHostId(manager, options = {}) {
let hostId = typeof options?.hostId === `string` ? options.hostId.trim() : ``;
if (hostId.length > 0) return hostId;
if (typeof manager?.getHostId === `function`) {
try {
hostId = String(manager.getHostId() ?? ``).trim()
} catch {}
}
return hostId.length > 0 ? hostId : `local`
}

function makePortableIpcCloneableValue(value, seen = new WeakSet) {
if (value == null || typeof value === `string` || typeof value === `number` ||
typeof value === `boolean`) return value;
if (typeof value === `bigint`) return String(value);
if (typeof value === `function` || typeof value === `symbol` || typeof value ===
`undefined`) return void 0;
if (value instanceof Date) return value.toISOString();
if (typeof value !== `object`) return void 0;
if (seen.has(value)) return void 0;
seen.add(value);
if (Array.isArray(value)) return value.map(item => {
let cloneableItem = makePortableIpcCloneableValue(item, seen);
return cloneableItem === void 0 ? null : cloneableItem
});
let cloneableValue = {};
for (let [key, item] of Object.entries(value)) {
let cloneableItem = makePortableIpcCloneableValue(item, seen);
if (cloneableItem !== void 0) cloneableValue[key] = cloneableItem
}
seen.delete(value);
return cloneableValue
}

function makePortableIpcCloneableObject(value) {
let cloneableValue = makePortableIpcCloneableValue(value);
return cloneableValue && typeof cloneableValue === `object` && !Array.isArray(cloneableValue) ?
cloneableValue : {}
}

function resolvePortableGlobalStateScope() {
let scope = portableAppScope;
return scope && typeof scope === `object` && scope.__scopeBrand === `AppScope` ? scope : null
}

function resolvePortableGlobalStateStoreHook() {
if (!resolvePortableGlobalStateScope() || typeof usePortableScopeHost !== `function`) return null;
return function usePortableGlobalStateStore(scope) {
return usePortableScopeHost(scope)
}
}

function usePortableIntl() {
return rawUseGlobalState(portableIntlSignal)
}

async function ensurePortableHostConversationReady(manager, options = {}) {
let conversationId = typeof options?.conversationId === `string` ? options.conversationId
.trim() :
``;
if (conversationId.length === 0) throw Error(`Portable conversationId is required`);
if (!manager) throw Error(`Portable app server manager is unavailable`);
let needsResume = typeof manager.needsResume === `function` ? manager.needsResume(
conversationId) : !0;
let isStreaming = typeof manager.isConversationStreaming === `function` ? manager
.isConversationStreaming(conversationId) : !0;
let streamRole = typeof manager.getStreamRole === `function` ? manager.getStreamRole(
conversationId) : null;
let streamRoleName = typeof streamRole?.role === `string` ? streamRole.role : null;
if (!needsResume && isStreaming && (typeof manager.getStreamRole !== `function` ||
streamRoleName === `owner`))
return null;
if (typeof manager.resumeConversationForUnavailableOwner !== `function`) return null;
let workspaceRoots = Array.isArray(options?.workspaceRoots) ? options.workspaceRoots : [];
return manager.resumeConversationForUnavailableOwner({
conversationId,
model: options?.model ?? null,
serviceTier: options?.serviceTier,
reasoningEffort: options?.reasoningEffort ?? null,
workspaceRoots,
collaborationMode: options?.collaborationMode ?? null
})
}

async function startPortableHostConversationTurn(manager, conversationId, options = {}) {
let normalizedConversationId = typeof conversationId === `string` ? conversationId.trim() : ``;
if (normalizedConversationId.length === 0) throw Error(`Portable conversationId is required`);
if (!manager) throw Error(`Portable app server manager is unavailable`);
let conversation = typeof manager.getConversation === `function` ? manager.getConversation(
normalizedConversationId) : null;
let latestTurn = Array.isArray(conversation?.turns) ? conversation.turns[conversation.turns
.length -
1] ?? null : null;
let latestParams = latestTurn?.params && typeof latestTurn.params === `object` ? latestTurn
.params : {};
let serviceTier = options?.serviceTier;
if (serviceTier === void 0 && typeof manager.getEffectiveServiceTier === `function`) {
let defaultServiceTier = typeof manager.getDefaultServiceTier === `function` ? manager
.getDefaultServiceTier() : null;
serviceTier = manager.getEffectiveServiceTier(await defaultServiceTier, latestParams.model ??
conversation?.latestModel ?? null)
}
let personality = typeof manager.getPersonality === `function` ? manager.getPersonality() :
null;
let turnStartParams = {
input: Array.isArray(options?.input) ? options.input : [],
cwd: options?.cwd ?? conversation?.cwd ?? (typeof manager.getConversationCwd ===
`function` ?
manager.getConversationCwd(normalizedConversationId) : null),
approvalPolicy: latestParams.approvalPolicy ?? null,
approvalsReviewer: typeof latestParams.approvalsReviewer === `string` ? latestParams
.approvalsReviewer : `user`,
sandboxPolicy: latestParams.sandboxPolicy ?? null,
model: null,
serviceTier: typeof serviceTier === `string` ? serviceTier : typeof latestParams
.serviceTier ===
`string` ? latestParams.serviceTier : null,
effort: null,
summary: typeof latestParams.summary === `string` ? latestParams.summary : `none`,
personality: typeof personality === `string` ? personality : null,
responsesapiClientMetadata: options?.responsesapiClientMetadata ?? null,
outputSchema: options?.outputSchema ?? latestParams.outputSchema ?? null,
collaborationMode: options?.collaborationMode ?? conversation?.latestCollaborationMode ??
null,
attachments: Array.isArray(options?.attachments) ? options.attachments : []
};
let requestParams = {
threadId: normalizedConversationId,
...makePortableIpcCloneableObject(turnStartParams)
};
if (typeof manager.updateConversationState === `function`) {
manager.updateConversationState(normalizedConversationId, conversation => {
let syntheticTurn = {
params: {
threadId: normalizedConversationId,
...makePortableIpcCloneableObject(turnStartParams)
},
turnId: null,
status: `inProgress`,
turnStartedAtMs: Date.now(),
durationMs: null,
finalAssistantStartedAtMs: null,
error: null,
diff: null,
items: []
};
conversation.turns ||= [];
conversation.turns.push(syntheticTurn);
conversation.latestCollaborationMode = requestParams.collaborationMode ??
conversation.latestCollaborationMode;
conversation.updatedAt = Date.now()
})
}
let bridge = globalThis.window?.electronBridge;
if (typeof bridge?.sendMessageFromView !== `function`) {
throw Error(`Portable electron bridge does not expose sendMessageFromView()`)
}
let requestId = `portable-turn-start-${Date.now()}-${Math.random().toString(16).slice(2)}`;
await bridge.sendMessageFromView({
type: `mcp-request`,
hostId: resolvePortableHostId(manager, options),
request: {
id: requestId,
method: `turn/start`,
params: requestParams
}
});
return {
turn: {
id: null,
status: `inProgress`
}
}
}

async function steerPortableHostConversationTurn(manager, conversationId, input, restoreMessage,
attachments, options = {}) {
let normalizedConversationId = typeof conversationId === `string` ? conversationId.trim() : ``;
let expectedTurnId = typeof options?.expectedTurnId === `string` ? options.expectedTurnId.trim() : ``;
if (normalizedConversationId.length === 0) throw Error(`Portable conversationId is required`);
if (expectedTurnId.length === 0) throw Error(`Portable expectedTurnId is required for turn/steer.`);
let streamRole = typeof manager?.getStreamRole === `function` ? manager.getStreamRole(
normalizedConversationId) : null;
if (streamRole?.role === `follower`) {
if (typeof manager?.handleThreadFollowerSteerTurn !== `function`) throw Error(
`Portable app server manager does not expose handleThreadFollowerSteerTurn()`
);
let response = await manager.handleThreadFollowerSteerTurn({
conversationId: normalizedConversationId,
expectedTurnId,
input,
restoreMessage,
attachments
});
return response?.result
}
let response = await sendPortableAppServerRequest(`steer-turn-for-host`, {
hostId: resolvePortableHostId(manager),
conversationId: normalizedConversationId,
expectedTurnId,
input,
restoreMessage,
attachments
});
return response?.result
}

installPortableHostBridge({
React: ReactFactory(),
JSX: JSXFactory(),
SettingsGroup,
SettingsRow,
Toggle,
createPortal: (...args) => ReactDOM().createPortal(...args),
useGlobalState: rawUseGlobalState,
useAppServerManager,
useAppServerRegistry,
sendPortableAppServerRequest,
nativeRequest,
portableAppServerRequestBus,
usePortableIntl,
getPortableProjectName,
usePortableSettingsHostSelection,
getPortableGeneralSettingsComponent: OriginalGeneralSettings,
getPortableSettingsContentLayoutComponent: SettingsContentLayout,
describePortableGlobalStateCandidates: () => {
let signal = portableGlobalStateSignal;
let scope = resolvePortableGlobalStateScope();
let storeHook = resolvePortableGlobalStateStoreHook();
return [`scope:${scope?.__scopeBrand ?? typeof scope}`, `storeHook:${typeof storeHook}`,
`signal:${typeof signal}`
]
.join(`, `)
},
resolvePortableGlobalStateScope,
resolvePortableGlobalStateStoreHook,
writePortableHostGlobalStateValue: rawWriteGlobalStateValue,
sendPortableRawHostRequest,
ensurePortableHostConversationReady,
startPortableHostConversationTurn,
steerPortableHostConversationTurn
});

psAppendPortableBootstrapDebugLog(`host-bridge-installed`, {
capabilityKeys: [`React`, `JSX`, `SettingsGroup`, `SettingsRow`, `Toggle`, `createPortal`,
`useGlobalState`,
`useAppServerManager`, `useAppServerRegistry`, `sendPortableAppServerRequest`,
`nativeRequest`, `portableAppServerRequestBus`, `usePortableIntl`,
`getPortableProjectName`, `usePortableSettingsHostSelection`,
`getPortableGeneralSettingsComponent`, `getPortableSettingsContentLayoutComponent`,
`describePortableGlobalStateCandidates`,
`resolvePortableGlobalStateScope`, `resolvePortableGlobalStateStoreHook`,
`writePortableHostGlobalStateValue`, `sendPortableRawHostRequest`,
`ensurePortableHostConversationReady`, `startPortableHostConversationTurn`,
`steerPortableHostConversationTurn`
]
}).catch(() => {});
