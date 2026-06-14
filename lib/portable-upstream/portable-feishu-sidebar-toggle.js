// PORTABLE_PATCH: Sidebar footer Feishu toggle linked to the same global
// PORTABLE_PATCH: state as the Settings page entry.
import {
React,
registerPortableBridgePlugin,
} from "./portable-host-request-compat.js";
import {
readPortableGlobalStateValue,
writePortableGlobalStateValue,
} from "./portable-global-state-compat.js";
import {
FEISHU_KEYS,
resolveFeishuSettings,
} from "./portable-feishu-common.js";

const PORTABLE_FEISHU_SIDEBAR_TOGGLE_ANCHOR =
"[data-portable-feishu-sidebar-toggle-anchor='true']";
const PORTABLE_FEISHU_SIDEBAR_TOGGLE_DEFAULT_MODE = "webhook";
const PORTABLE_FEISHU_SIDEBAR_TOGGLE_NODE_KEY =
"portableFeishuSidebarToggleNode";
const PORTABLE_FEISHU_SIDEBAR_TOGGLE_REFRESH_MS = 2000;
const TEXT = {
en: {
label: "Feishu Notifications",
enable: "Enable Feishu Notifications",
disable: "Disable Feishu Notifications",
},
zh: {
label: "飞书通知",
enable: "启用飞书通知",
disable: "停用飞书通知",
},
};

function currentLanguage() {
const candidates = [
publicLanguageFromGlobals(),
globalThis.__codexppLanguage,
globalThis.__codexppLocale,
documentLanguageFromHtml(),
    uiLanguageFromDocument(),
browserLanguageFromNavigator(),
];
for (const candidate of candidates) {
const language = normalizeLanguageCandidate(candidate);
if (language) return language;
}
return "zh";
}

function normalizeLanguageCandidate(candidate) {
const value = String(candidate || "").trim().toLowerCase();
if (!value || value === "auto" || value === "system" || value === "default") return null;
if (value.startsWith("zh")) return "zh";
if (value.startsWith("en")) return "en";
return null;
}


function uiLanguageFromDocument() {
  if (typeof document === "undefined") return null;
  const text = [
    document.documentElement?.lang,
    document.body?.innerText,
    document.body?.textContent,
  ].filter(Boolean).join("\n");
  return /[\u4e00-\u9fff]/.test(text) ? "zh" : null;
}

function documentLanguageFromHtml() {
if (typeof document === "undefined") return null;
const value = String(document.documentElement?.lang || "").trim().toLowerCase();
return value.startsWith("zh") ? "zh" : null;
}

function browserLanguageFromNavigator() {
if (typeof navigator === "undefined") return null;
const value = String(navigator.language || "").trim().toLowerCase();
return value.startsWith("zh") ? "zh" : null;
}

function publicLanguageFromGlobals() {
const globalCandidates = [
globalThis.__codexppPublicSettings,
globalThis.__codexppSettings,
globalThis.__codex?.settings,
];
for (const candidate of globalCandidates) {
const value = candidate?.localeOverride ?? candidate?.values?.localeOverride;
if (typeof value === "string" && value.trim()) return value;
}
try {
for (let i = 0; i < window.localStorage.length; i += 1) {
const key = window.localStorage.key(i);
if (!key || !/codex|setting|locale|language/i.test(key)) continue;
const raw = window.localStorage.getItem(key);
if (!raw || !raw.includes("localeOverride")) continue;
const value = findLocaleOverride(JSON.parse(raw));
if (value) return value;
}
} catch {}
return null;
}

function findLocaleOverride(value) {
if (!value || typeof value !== "object") return null;
if (typeof value.localeOverride === "string") return value.localeOverride;
if (typeof value.values?.localeOverride === "string") return value.values.localeOverride;
for (const child of Object.values(value)) {
const result = findLocaleOverride(child);
if (result) return result;
}
return null;
}

function t(key) {
return TEXT[currentLanguage()][key] ?? TEXT.en[key] ?? key;
}

function findSidebarToggleAnchor() {
if (typeof document === "undefined") {
return null;
}

return document.querySelector(PORTABLE_FEISHU_SIDEBAR_TOGGLE_ANCHOR);
}

async function readFeishuSidebarState() {
const [
enabled,
mode,
webhook,
appId,
appRecipientOpenId,
legacyWebhookEnabled,
legacyWebhook,
legacyAppReceiveId,
legacyAppReceiveIdType,
] = await Promise.all([
readPortableGlobalStateValue(FEISHU_KEYS.enabled),
readPortableGlobalStateValue(FEISHU_KEYS.mode),
readPortableGlobalStateValue(FEISHU_KEYS.webhook),
readPortableGlobalStateValue(FEISHU_KEYS.appId),
readPortableGlobalStateValue(FEISHU_KEYS.appRecipientOpenId),
readPortableGlobalStateValue(FEISHU_KEYS.legacyWebhookEnabled),
readPortableGlobalStateValue(FEISHU_KEYS.legacyWebhook),
readPortableGlobalStateValue(FEISHU_KEYS.legacyAppReceiveId),
readPortableGlobalStateValue(FEISHU_KEYS.legacyAppReceiveIdType),
]);

const rawState = {
enabled,
mode,
webhook,
appId,
appRecipientOpenId,
legacyWebhookEnabled,
legacyWebhook,
legacyAppReceiveId,
legacyAppReceiveIdType,
};

return {
resolved: resolveFeishuSettings(rawState),
rawMode: rawState.mode,
defaultMode: appId && appRecipientOpenId ? "app" :
PORTABLE_FEISHU_SIDEBAR_TOGGLE_DEFAULT_MODE,
};
}

function createFeishuSidebarToggleElement() {
const container = document.createElement("div");
container.className =
"flex h-full shrink-0 items-center gap-2 rounded-lg px-2 text-sm text-token-text-secondary";

const label = document.createElement("span");
label.className = "font-medium text-inherit leading-none";
label.textContent = t("label");
container.appendChild(label);

const button = document.createElement("button");
button.type = "button";
button.setAttribute("role", "switch");
button.className =
"inline-flex items-center text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-token-focus-border focus-visible:rounded-full cursor-interaction";

const track = document.createElement("span");
track.className =
"relative inline-flex h-5 w-8 shrink-0 items-center rounded-full transition-colors duration-200 ease-out";

const thumb = document.createElement("span");
thumb.className =
"h-4 w-4 rounded-full border border-[color:var(--gray-0)] bg-[color:var(--gray-0)] shadow-sm transition-transform duration-200 ease-out data-[state=unchecked]:translate-x-0 data-[state=unchecked]:translate-x-[2px] data-[state=checked]:translate-x-[14px]";
track.appendChild(thumb);
button.appendChild(track);
container.appendChild(button);

return {
container,
button,
track,
thumb,
};
}

function renderFeishuSidebarToggle(toggle, enabled) {
const state = enabled ? "checked" : "unchecked";
toggle.button.setAttribute("aria-checked", String(enabled));
toggle.button.setAttribute(
"aria-label",
enabled ? t("disable") : t("enable"),
);
toggle.button.dataset.state = state;
toggle.track.dataset.state = state;
toggle.thumb.dataset.state = state;
toggle.track.className = [
"relative inline-flex h-5 w-8 shrink-0 items-center rounded-full transition-colors duration-200 ease-out",
enabled ? "bg-token-charts-blue" : "bg-token-foreground/10",
].join(" ");
}

export function PortableFeishuSidebarToggleBridge() {
React.useEffect(() => {
let cancelled = false;
let currentState = {
resolved: {
enabled: false,
},
rawMode: null,
defaultMode: PORTABLE_FEISHU_SIDEBAR_TOGGLE_DEFAULT_MODE,
};
let toggle = null;
let refreshTimer = null;

const refresh = () => {
readFeishuSidebarState().then((nextState) => {
if (cancelled) {
return;
}

currentState = nextState;
if (toggle) {
renderFeishuSidebarToggle(toggle, currentState.resolved.enabled);
}
}).catch(() => {});
};

const mount = () => {
if (cancelled) {
return;
}

const anchor = findSidebarToggleAnchor();
if (!anchor) {
return;
}

toggle = anchor[PORTABLE_FEISHU_SIDEBAR_TOGGLE_NODE_KEY];
if (!toggle) {
toggle = createFeishuSidebarToggleElement();
anchor[PORTABLE_FEISHU_SIDEBAR_TOGGLE_NODE_KEY] = toggle;
anchor.appendChild(toggle.container);
toggle.button.addEventListener("click", () => {
const nextEnabled = !currentState.resolved.enabled;
currentState = {
...currentState,
resolved: {
...currentState.resolved,
enabled: nextEnabled,
},
};
renderFeishuSidebarToggle(toggle, nextEnabled);

void writePortableGlobalStateValue(FEISHU_KEYS.enabled, nextEnabled);
if (
nextEnabled &&
currentState.rawMode !== "app" &&
currentState.rawMode !== "webhook"
) {
void writePortableGlobalStateValue(
FEISHU_KEYS.mode,
currentState.defaultMode,
);
}
});
}

renderFeishuSidebarToggle(toggle, currentState.resolved.enabled);
};

mount();
refresh();

const observer = new MutationObserver(() => {
mount();
});
if (typeof document !== "undefined" && document.body) {
observer.observe(document.body, {
childList: true,
subtree: true,
});
}

refreshTimer = window.setInterval(
refresh,
PORTABLE_FEISHU_SIDEBAR_TOGGLE_REFRESH_MS,
);

return () => {
cancelled = true;
observer.disconnect();
if (refreshTimer) {
window.clearInterval(refreshTimer);
}
if (toggle?.container?.parentNode) {
toggle.container.parentNode.removeChild(toggle.container);
}
};
}, []);

return null;
}

registerPortableBridgePlugin({
id: "portable-feishu-sidebar-toggle",
order: 35,
Component: PortableFeishuSidebarToggleBridge,
});
