// PORTABLE_PATCH: Portable-only Feishu settings section for the wrapped
// PORTABLE_PATCH: General Settings screen.
import {
JSX,
React,
SettingsGroup,
SettingsRow,
Toggle,
registerPortableSettingsPlugin,
} from "./portable-host-request-compat.js";
import {
readPortableGlobalStateValue,
writePortableGlobalStateValue,
} from "./portable-global-state-compat.js";
import {
FEISHU_KEYS,
parseDirectRouteRecentConversationLimit,
parseDirectRouteWorkspaceLimit,
normalizeFeishuAvatarDataUrl,
parsePollingIntervalSeconds,
resolveFeishuSettings,
} from "./portable-feishu-common.js";
const FEISHU_AVATAR_MAX_BYTES = 1024 * 1024;
const FEISHU_AVATAR_ACCEPT = "image/png,image/jpeg,image/webp";
const TEXT = {
en: {
basicMode: "Basic Mode",
basicModeDescription: "Send notifications through a custom bot webhook.",
enhancedMode: "Enhanced Mode",
enhancedModeDescription: "Send through the app bot and continue the current conversation from Feishu replies.",
selectImage: "Select an image file.",
supportedImages: "Only PNG, JPG, or WebP images are supported.",
imageTooLarge: "Images cannot exceed 1 MB.",
imageReadFailed: "Failed to read the image.",
chooseImage: "Choose Image",
restoreDefault: "Restore Default",
savedEmbeddedImage: "Saved as an embedded configuration image",
usingDefaultAvatar: "Using the built-in default avatar",
enableTitle: "Enable Feishu Notifications",
enableDescription: "When disabled, webhooks are not sent and app bot replies are not polled.",
modeTitle: "Mode",
modeDescription: "The two modes are mutually exclusive. Only the current mode is used.",
webhookUrlTitle: "Webhook URL",
webhookUrlDescription: "For example: https://open.feishu.cn/open-apis/bot/v2/hook/...",
signingSecretTitle: "Signing Secret",
signingSecretDescription: "Enter the secret here if your Feishu custom bot uses signature verification.",
optional: "Optional",
appIdTitle: "App ID",
appIdDescription: "App ID for the Feishu app bot.",
appSecretTitle: "App Secret",
appSecretDescription: "App Secret for the Feishu app bot.",
appSecretPlaceholder: "Enter app secret",
targetUserTitle: "Target User Open ID",
targetUserDescription: "Used for direct-message entry and to add you when creating conversation groups.",
runningAvatarTitle: "Running Avatar",
runningAvatarDescription: "Feishu group avatar used while a conversation is running.",
completedAvatarTitle: "Completed Avatar",
completedAvatarDescription: "Feishu group avatar used after a conversation completes.",
pollingTitle: "Polling Interval (Seconds)",
pollingDescription: "Enhanced mode polls Feishu replies at this interval and continues the current desktop conversation.",
recentPromptTitle: "Recent Conversation Prompt Count",
recentPromptDescription: "Maximum number of recent active conversations shown for direct Feishu replies when sending a blank message.",
workspacePromptTitle: "Workspace Prompt Count",
workspacePromptDescription: "Maximum number of recent active workspaces shown for starting a new Feishu conversation when sending a blank message.",
sectionTitle: "Feishu",
},
zh: {
basicMode: "基础模式",
basicModeDescription: "通过自定义机器人 webhook 发送通知。",
enhancedMode: "增强模式",
enhancedModeDescription: "通过应用机器人发送，并从飞书回复继续当前对话。",
selectImage: "请选择一个图片文件。",
supportedImages: "仅支持 PNG、JPG 或 WebP 图片。",
imageTooLarge: "图片不能超过 1 MB。",
imageReadFailed: "读取图片失败。",
chooseImage: "选择图片",
restoreDefault: "恢复默认",
savedEmbeddedImage: "已保存为嵌入式配置图片",
usingDefaultAvatar: "正在使用内置默认头像",
enableTitle: "启用飞书通知",
enableDescription: "关闭后不会发送 webhook，也不会轮询应用机器人回复。",
modeTitle: "模式",
modeDescription: "两种模式互斥。只会使用当前模式。",
webhookUrlTitle: "Webhook URL",
webhookUrlDescription: "例如：https://open.feishu.cn/open-apis/bot/v2/hook/...",
signingSecretTitle: "签名密钥",
signingSecretDescription: "如果飞书自定义机器人使用签名校验，请在这里输入密钥。",
optional: "可选",
appIdTitle: "App ID",
appIdDescription: "飞书应用机器人的 App ID。",
appSecretTitle: "App Secret",
appSecretDescription: "飞书应用机器人的 App Secret。",
appSecretPlaceholder: "输入 app secret",
targetUserTitle: "目标用户 Open ID",
targetUserDescription: "用于私聊入口，并在创建会话群时将你加入群聊。",
runningAvatarTitle: "运行中头像",
runningAvatarDescription: "会话运行时使用的飞书群头像。",
completedAvatarTitle: "已完成头像",
completedAvatarDescription: "会话完成后使用的飞书群头像。",
pollingTitle: "轮询间隔（秒）",
pollingDescription: "增强模式会按此间隔轮询飞书回复，并继续当前桌面对话。",
recentPromptTitle: "最近会话提示数量",
recentPromptDescription: "发送空消息时，私聊回复中展示的最近活跃会话最大数量。",
workspacePromptTitle: "工作区提示数量",
workspacePromptDescription: "发送空消息开始新飞书对话时，展示的最近活跃工作区最大数量。",
sectionTitle: "飞书",
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

function feishuModeOptions() {
return [{
id: "webhook",
label: t("basicMode"),
description: t("basicModeDescription"),
},
{
id: "app",
label: t("enhancedMode"),
description: t("enhancedModeDescription"),
},
];
}

function createCard(children) {
return JSX.jsx("div", {
className: "overflow-hidden rounded-2xl border border-token-border bg-token-input-background shadow-sm",
children: JSX.jsx("div", {
className: "divide-y-[0.5px] divide-token-border",
children,
}),
});
}

function createSelect({
value,
options,
onChange
}) {
return JSX.jsx("select", {
className: "focus-visible:ring-token-focus h-9 min-w-[11rem] rounded-lg border border-token-border bg-token-input-background px-3 text-sm text-token-text-primary shadow-sm outline-none focus-visible:ring-2 max-sm:min-w-0",
value,
onChange,
children: options.map((option) =>
JSX.jsx(
"option", {
value: option.id,
children: option.label,
},
option.id,
),
),
});
}

function createTextInput({
value,
placeholder,
type = "text",
min,
max,
step,
onChange,
}) {
return JSX.jsx("input", {
className: "focus-visible:ring-token-focus h-9 w-full min-w-[16rem] rounded-lg border border-token-border bg-token-input-background px-3 text-sm text-token-text-primary shadow-sm outline-none focus-visible:ring-2 max-sm:min-w-0",
value,
placeholder,
type,
min,
max,
step,
spellCheck: false,
onChange,
});
}

function createSmallButton({
children,
onClick,
disabled = false,
}) {
return JSX.jsx("button", {
type: "button",
disabled,
className: "focus-visible:ring-token-focus h-8 rounded-lg border border-token-border bg-token-input-background px-3 text-sm text-token-text-primary shadow-sm outline-none transition hover:bg-token-main-surface-secondary disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2",
onClick,
children,
});
}

function readFeishuAvatarFileAsDataUrl(file) {
return new Promise((resolve, reject) => {
if (!file) {
reject(new Error(t("selectImage")));
return;
}

if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
reject(new Error(t("supportedImages")));
return;
}

if (file.size > FEISHU_AVATAR_MAX_BYTES) {
reject(new Error(t("imageTooLarge")));
return;
}

const reader = new FileReader();
reader.onload = () => {
const dataUrl = normalizeFeishuAvatarDataUrl(reader.result);
if (!dataUrl) {
reject(new Error(t("imageReadFailed")));
return;
}
resolve(dataUrl);
};
reader.onerror = () => reject(new Error(t("imageReadFailed")));
reader.readAsDataURL(file);
});
}

function FeishuAvatarPreview({
dataUrl,
kind,
}) {
  const isComplete = kind === "complete";
  const defaultSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180"><rect width="180" height="180" rx="36" fill="${isComplete ? "#16A34A" : "#2563EB"}"/><text x="90" y="${isComplete ? "112" : "100"}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${isComplete ? "86" : "72"}" font-weight="700" fill="#fff">${isComplete ? "✓" : "..."}</text></svg>`;
  return JSX.jsx("img", {
    className: "h-12 w-12 rounded-full border border-token-border object-cover shadow-sm",
    src: dataUrl || `data:image/svg+xml;charset=utf-8,${encodeURIComponent(defaultSvg)}`,
    alt: "",
  });
}

function FeishuAvatarControl({
kind,
dataUrl,
writeValue,
}) {
const [error, setError] = React.useState("");
const hasCustomAvatar = Boolean(dataUrl);

const handleFileChange = React.useCallback(
(event) => {
const file = event.target.files?.[0] || null;
event.target.value = "";
if (!file) {
return;
}

setError("");
readFeishuAvatarFileAsDataUrl(file)
.then((nextDataUrl) => writeValue(nextDataUrl))
.catch((readError) => {
const message =
readError instanceof Error ? readError.message : t("imageReadFailed");
setError(message);
});
},
[kind, writeValue],
);

return JSX.jsxs("div", {
className: "flex min-w-0 items-center justify-end gap-3 max-sm:w-full max-sm:justify-between",
children: [
JSX.jsx(FeishuAvatarPreview, {
dataUrl,
kind,
}),
JSX.jsxs("div", {
className: "flex min-w-0 flex-col items-end gap-1.5 max-sm:items-stretch",
children: [
JSX.jsxs("div", {
className: "flex items-center justify-end gap-2",
children: [
JSX.jsxs("label", {
className: "focus-within:ring-token-focus inline-flex h-8 cursor-pointer items-center rounded-lg border border-token-border bg-token-input-background px-3 text-sm text-token-text-primary shadow-sm outline-none transition hover:bg-token-main-surface-secondary focus-within:ring-2",
children: [
t("chooseImage"),
JSX.jsx("input", {
className: "hidden",
type: "file",
accept: FEISHU_AVATAR_ACCEPT,
onChange: handleFileChange,
}),
],
}),
createSmallButton({
children: t("restoreDefault"),
disabled: !hasCustomAvatar,
onClick: () => {
setError("");
writeValue("");
},
}),
],
}),
error ?
JSX.jsx("div", {
className: "max-w-[18rem] text-right text-xs text-red-500 max-sm:text-left",
children: error,
}) :
JSX.jsx("div", {
className: "max-w-[18rem] text-right text-xs text-token-text-secondary max-sm:text-left",
children: hasCustomAvatar ? t("savedEmbeddedImage") : t("usingDefaultAvatar"),
}),
],
}),
],
});
}

function trackFeishuSettingsWrite(action, detail, startWrite) {
let writePromise;

try {
writePromise = startWrite();
} catch (error) {
return;
}

if (!writePromise || typeof writePromise.then !== "function") {
return;
}

writePromise.catch(() => {});
}

function useFeishuGlobalStateValue(key) {
const [data, setData] = React.useState(undefined);

React.useEffect(() => {
let cancelled = false;

readPortableGlobalStateValue(key)
.then((value) => {
if (!cancelled) {
setData(value);
}
})
.catch(() => {});

return () => {
cancelled = true;
};
}, [key]);

return {
key,
data,
setData,
};
}

function useFeishuState() {
const enabled = useFeishuGlobalStateValue(FEISHU_KEYS.enabled);
const mode = useFeishuGlobalStateValue(FEISHU_KEYS.mode);
const webhook = useFeishuGlobalStateValue(FEISHU_KEYS.webhook);
const webhookSecret = useFeishuGlobalStateValue(FEISHU_KEYS.webhookSecret);
const appId = useFeishuGlobalStateValue(FEISHU_KEYS.appId);
const appSecret = useFeishuGlobalStateValue(FEISHU_KEYS.appSecret);
const appRecipientOpenId = useFeishuGlobalStateValue(FEISHU_KEYS.appRecipientOpenId);
const appPollingIntervalSeconds = useFeishuGlobalStateValue(
FEISHU_KEYS.appPollingIntervalSeconds,
);
const appDirectRouteRecentConversationLimit = useFeishuGlobalStateValue(
FEISHU_KEYS.appDirectRouteRecentConversationLimit,
);
const appDirectRouteWorkspaceLimit = useFeishuGlobalStateValue(
FEISHU_KEYS.appDirectRouteWorkspaceLimit,
);
const groupRunningAvatarDataUrl = useFeishuGlobalStateValue(
FEISHU_KEYS.groupRunningAvatarDataUrl,
);
const groupCompleteAvatarDataUrl = useFeishuGlobalStateValue(
FEISHU_KEYS.groupCompleteAvatarDataUrl,
);

const legacyWebhookEnabled = useFeishuGlobalStateValue(FEISHU_KEYS.legacyWebhookEnabled);
const legacyWebhook = useFeishuGlobalStateValue(FEISHU_KEYS.legacyWebhook);
const legacyWebhookSecret = useFeishuGlobalStateValue(FEISHU_KEYS.legacyWebhookSecret);
const legacyAppOpenId = useFeishuGlobalStateValue(FEISHU_KEYS.legacyAppOpenId);
const legacyAppReceiveId = useFeishuGlobalStateValue(FEISHU_KEYS.legacyAppReceiveId);
const legacyAppReceiveIdType = useFeishuGlobalStateValue(
FEISHU_KEYS.legacyAppReceiveIdType,
);

const resolved = React.useMemo(
() =>
resolveFeishuSettings({
enabled: enabled.data,
mode: mode.data,
webhook: webhook.data,
webhookSecret: webhookSecret.data,
appId: appId.data,
appSecret: appSecret.data,
appRecipientOpenId: appRecipientOpenId.data,
appPollingIntervalSeconds: appPollingIntervalSeconds.data,
appDirectRouteRecentConversationLimit: appDirectRouteRecentConversationLimit.data,
appDirectRouteWorkspaceLimit: appDirectRouteWorkspaceLimit.data,
groupRunningAvatarDataUrl: groupRunningAvatarDataUrl.data,
groupCompleteAvatarDataUrl: groupCompleteAvatarDataUrl.data,
legacyWebhookEnabled: legacyWebhookEnabled.data,
legacyWebhook: legacyWebhook.data,
legacyWebhookSecret: legacyWebhookSecret.data,
legacyAppOpenId: legacyAppOpenId.data,
legacyAppReceiveId: legacyAppReceiveId.data,
legacyAppReceiveIdType: legacyAppReceiveIdType.data,
}),
[
appDirectRouteRecentConversationLimit.data,
appDirectRouteWorkspaceLimit.data,
groupCompleteAvatarDataUrl.data,
groupRunningAvatarDataUrl.data,
appId.data,
appPollingIntervalSeconds.data,
appRecipientOpenId.data,
appSecret.data,
enabled.data,
legacyAppOpenId.data,
legacyAppReceiveId.data,
legacyAppReceiveIdType.data,
legacyWebhook.data,
legacyWebhookEnabled.data,
legacyWebhookSecret.data,
mode.data,
webhook.data,
webhookSecret.data,
],
);

return {
resolved,
enabled,
mode,
webhook,
webhookSecret,
appId,
appSecret,
appRecipientOpenId,
appPollingIntervalSeconds,
appDirectRouteRecentConversationLimit,
appDirectRouteWorkspaceLimit,
groupRunningAvatarDataUrl,
groupCompleteAvatarDataUrl,
legacyWebhookEnabled,
legacyWebhook,
legacyWebhookSecret,
legacyAppOpenId,
legacyAppReceiveId,
legacyAppReceiveIdType,
};
}

function FeishuSettingsSection() {
const state = useFeishuState();

const writeGlobalState = React.useCallback(
(key, value) => {
const stateEntry = Object.values(state).find(
(entry) => entry && typeof entry === "object" && entry.key === key,
);
if (typeof stateEntry?.setData === "function") {
stateEntry.setData(value);
}
return writePortableGlobalStateValue(key, value);
},
[state],
);

const enabled = state.resolved.enabled;
const webhook = state.resolved.webhook;
const webhookSecret = state.resolved.webhookSecret;
const appId = state.resolved.appId;
const appSecret = state.resolved.appSecret;
const appRecipientOpenId = state.resolved.appRecipientOpenId;
const pollingIntervalSeconds = state.resolved.appPollingIntervalSeconds;
const directRouteRecentConversationLimit =
state.resolved.appDirectRouteRecentConversationLimit;
const directRouteWorkspaceLimit =
state.resolved.appDirectRouteWorkspaceLimit;
const groupRunningAvatarDataUrl = state.resolved.groupRunningAvatarDataUrl;
const groupCompleteAvatarDataUrl = state.resolved.groupCompleteAvatarDataUrl;
const modeOptions = feishuModeOptions();
const selectedMode =
modeOptions.find((option) => option.id === state.mode.data) ?? null;
const defaultEnabledMode =
appId && appRecipientOpenId ? "app" : "webhook";
const configuredMode =
selectedMode?.id ??
(state.resolved.mode === "app" || state.resolved.mode === "webhook" ?
state.resolved.mode :
defaultEnabledMode);
const resolvedSelectedMode =
modeOptions.find((option) => option.id === configuredMode) ??
modeOptions[0];

return createCard(
JSX.jsxs(JSX.Fragment, {
children: [
JSX.jsx(SettingsRow, {
label: t("enableTitle"),
description: t("enableDescription"),
variant: "nested",
control: JSX.jsx(Toggle, {
checked: enabled,
onChange: (next) => {
trackFeishuSettingsWrite("toggle-enabled", null, () =>
writeGlobalState(FEISHU_KEYS.enabled, next),
);
if (
next &&
state.mode.data !== "app" &&
state.mode.data !== "webhook"
) {
trackFeishuSettingsWrite(
"toggle-default-mode",
null,
() => writeGlobalState(FEISHU_KEYS.mode, defaultEnabledMode),
);
}
},
ariaLabel: t("enableTitle"),
}),
}),
JSX.jsx(SettingsRow, {
label: t("modeTitle"),
description: t("modeDescription"),
variant: "nested",
control: JSX.jsx("div", {
className: "flex min-w-0 flex-col items-end gap-1.5 max-sm:items-stretch",
children: [
createSelect({
value: configuredMode,
options: modeOptions,
onChange: (event) => {
const nextMode = event.target.value;
trackFeishuSettingsWrite("mode", null, () =>
writeGlobalState(FEISHU_KEYS.mode, nextMode),
);
},
}),
JSX.jsx("div", {
className: "max-w-[18rem] text-right text-xs text-token-text-secondary max-sm:max-w-none max-sm:text-left",
children: resolvedSelectedMode.description,
}),
],
}),
}),
configuredMode === "webhook" ?
JSX.jsxs(JSX.Fragment, {
children: [
JSX.jsx(SettingsRow, {
label: t("webhookUrlTitle"),
description: t("webhookUrlDescription"),
variant: "nested",
control: createTextInput({
value: webhook,
placeholder: "https://open.feishu.cn/open-apis/bot/v2/hook/...",
onChange: (event) => {
writeGlobalState(
FEISHU_KEYS.webhook,
event.target.value,
).catch(() => {});
},
}),
}),
JSX.jsx(SettingsRow, {
label: t("signingSecretTitle"),
description: t("signingSecretDescription"),
variant: "nested",
control: createTextInput({
value: webhookSecret,
placeholder: t("optional"),
onChange: (event) => {
writeGlobalState(
FEISHU_KEYS.webhookSecret,
event.target.value,
).catch(() => {});
},
}),
}),
],
}) :
JSX.jsxs(JSX.Fragment, {
children: [
JSX.jsx(SettingsRow, {
label: t("appIdTitle"),
description: t("appIdDescription"),
variant: "nested",
control: createTextInput({
value: appId,
placeholder: "cli_xxx",
onChange: (event) => {
writeGlobalState(
FEISHU_KEYS.appId,
event.target.value,
).catch(() => {});
},
}),
}),
JSX.jsx(SettingsRow, {
label: t("appSecretTitle"),
description: t("appSecretDescription"),
variant: "nested",
control: createTextInput({
value: appSecret,
placeholder: t("appSecretPlaceholder"),
onChange: (event) => {
writeGlobalState(
FEISHU_KEYS.appSecret,
event.target.value,
).catch(() => {});
},
}),
}),
JSX.jsx(SettingsRow, {
label: t("targetUserTitle"),
description: t("targetUserDescription"),
variant: "nested",
control: createTextInput({
value: appRecipientOpenId,
placeholder: "ou_xxx",
onChange: (event) => {
writeGlobalState(
FEISHU_KEYS.appRecipientOpenId,
event.target.value,
).catch(() => {});
},
}),
}),
JSX.jsx(SettingsRow, {
label: t("runningAvatarTitle"),
description: t("runningAvatarDescription"),
variant: "nested",
control: JSX.jsx(FeishuAvatarControl, {
kind: "running",
dataUrl: groupRunningAvatarDataUrl,
writeValue: (value) =>
writeGlobalState(
FEISHU_KEYS.groupRunningAvatarDataUrl,
value,
).catch(() => {}),
}),
}),
JSX.jsx(SettingsRow, {
label: t("completedAvatarTitle"),
description: t("completedAvatarDescription"),
variant: "nested",
control: JSX.jsx(FeishuAvatarControl, {
kind: "complete",
dataUrl: groupCompleteAvatarDataUrl,
writeValue: (value) =>
writeGlobalState(
FEISHU_KEYS.groupCompleteAvatarDataUrl,
value,
).catch(() => {}),
}),
}),
JSX.jsx(SettingsRow, {
label: t("pollingTitle"),
description: t("pollingDescription"),
variant: "nested",
control: createTextInput({
type: "number",
min: 3,
max: 60,
step: 1,
value: String(pollingIntervalSeconds),
onChange: (event) => {
writeGlobalState(
FEISHU_KEYS.appPollingIntervalSeconds,
parsePollingIntervalSeconds(event.target.value),
).catch(() => {});
},
}),
}),
JSX.jsx(SettingsRow, {
label: t("recentPromptTitle"),
description: t("recentPromptDescription"),
variant: "nested",
control: createTextInput({
type: "number",
min: 0,
max: 20,
step: 1,
value: String(directRouteRecentConversationLimit),
onChange: (event) => {
writeGlobalState(
FEISHU_KEYS.appDirectRouteRecentConversationLimit,
parseDirectRouteRecentConversationLimit(
event.target.value,
),
).catch(() => {});
},
}),
}),
JSX.jsx(SettingsRow, {
label: t("workspacePromptTitle"),
description: t("workspacePromptDescription"),
variant: "nested",
control: createTextInput({
type: "number",
min: 0,
max: 20,
step: 1,
value: String(directRouteWorkspaceLimit),
onChange: (event) => {
writeGlobalState(
FEISHU_KEYS.appDirectRouteWorkspaceLimit,
parseDirectRouteWorkspaceLimit(event.target.value),
).catch(() => {});
},
}),
}),
],
}),
],
}),
);
}

export function FeishuSettingsGroup() {
return JSX.jsx(SettingsGroup, {
children: JSX.jsxs(JSX.Fragment, {
children: [
JSX.jsx(SettingsGroup.Header, {
title: t("sectionTitle"),
}),
JSX.jsx(SettingsGroup.Content, {
children: JSX.jsx(FeishuSettingsSection, {}),
}),
],
}),
});
}

registerPortableSettingsPlugin({
id: "portable-feishu-settings",
order: 30,
renderGroup: () => JSX.jsx(FeishuSettingsGroup, {}, "portable-feishu-settings-group"),
});
