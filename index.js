"use strict";

const TWEAK_ID = "io.github.consolexp.feishu-notifications";
const LEGACY_TWEAK_IDS = ["com.local.feishu-notifications"];
const MAIN_IPC_CHANNELS = [
  "get-settings",
  "set-settings",
  "get-default-avatars",
  "resolve-image",
  "upload-image",
  "portable-source",
  "portable-host-invoke",
  "portable-raw-host-request",
  "portable-appserver-request",
  "portable-native-request",
  "sidebar-toggle-bundle",
];

let mainRuntime = null;
let mainApi = null;
let settingsHandle = null;
let webviewBridge = null;
let sidebarToggleDispose = null;

function clearMainIpcHandlers() {
  let ipcMain = null;
  if (typeof require !== "function") return;
  try {
    ipcMain = require("electron")?.ipcMain;
  } catch {}
  if (!ipcMain || typeof ipcMain.removeHandler !== "function") return;
  for (const tweakId of [TWEAK_ID, ...LEGACY_TWEAK_IDS]) {
    for (const channel of MAIN_IPC_CHANNELS) {
      try {
        ipcMain.removeHandler(`codexpp:${tweakId}:${channel}`);
      } catch {}
    }
  }
}

function handleMainIpc(api, channel, handler) {
  api.ipc.handle(channel, handler);
}

function ensureMainRuntime(api = mainApi) {
  if (mainRuntime) return mainRuntime;
  if (!api) {
    throw new Error("Feishu main runtime is not ready.");
  }
  const { createMainRuntime } = require("./lib/main-runtime.js");
  mainRuntime = createMainRuntime(api);
  return mainRuntime;
}

function startMain(api) {
  clearMainIpcHandlers();
  mainApi = api;
  mainRuntime = null;
  ensureMainRuntime(api);
  handleMainIpc(api, "get-settings", () => ensureMainRuntime(api).getSettings());
  handleMainIpc(api, "set-settings", (patch) => {
    const runtime = ensureMainRuntime(api);
    const previous = runtime.getSettings();
    const next = runtime.setSettings(patch);
    if (previous?.enabled === true && next?.enabled !== true) {
      stopWebviewBridge();
    } else if (previous?.enabled !== true && next?.enabled === true) {
      startWebviewBridge(api);
    }
    return next;
  });
  handleMainIpc(api, "get-default-avatars", () => readDefaultAvatarDataUrls());
  handleMainIpc(api, "resolve-image", (request) => ensureMainRuntime(api).resolveImage(request));
  handleMainIpc(api, "upload-image", (request) => ensureMainRuntime(api).uploadImage(request));
  handleMainIpc(api, "portable-source", (request) => readPortableSource(request));
  handleMainIpc(api, "portable-host-invoke", (request) => handlePortableHostInvoke(api, request));
  handleMainIpc(api, "portable-raw-host-request", (request) => handlePortableRawHostRequest(api, request));
  handleMainIpc(api, "portable-appserver-request", (request) => handlePortableAppServerRequest(api, request));
  handleMainIpc(api, "portable-native-request", (request) => handlePortableNativeRequest(api, request));
  handleMainIpc(api, "sidebar-toggle-bundle", () => readSidebarToggleBundle());
  if (ensureMainRuntime(api).getSettings().debugLoggingEnabled) {
    api.log.info("Feishu portable upstream mode enabled; legacy poll/session watcher disabled.");
  }
  if (ensureMainRuntime(api).getSettings().enabled === true) {
    startWebviewBridge(api);
  }
}

function startWebviewBridge(api) {
  if (webviewBridge) return;
  const { createMainWebviewBridge } = require("./lib/main-webview-bridge.js");
  webviewBridge = createMainWebviewBridge({
    api,
    readRendererBundle,
    handleRpc: (channel, args) => handleWebviewRpc(channel, args),
  });
  webviewBridge.start();
}

function stopWebviewBridge() {
  try {
    webviewBridge?.dispose?.();
  } catch {}
  webviewBridge = null;
}

function startRenderer(api) {
  startRendererSidebarToggle(api);
  if (api.settings) {
    settingsHandle = api.settings.registerPage({
      id: "feishu",
      title: t("pageTitle"),
      description: t("pageDescription"),
      render(root) {
        renderSettingsPage(root, api);
      },
    });
  }
}

function readRendererBundle() {
  const fs = require("node:fs");
  const path = require("node:path");
  const { transformEsmToCommonJs } = require("./lib/portable-loader.js");
  const root = path.join(__dirname, "lib", "portable-upstream");
  const portableFiles = [
    "portable-host-request-compat.js",
    "portable-global-state-compat.js",
    "portable-manager-compat-core.js",
    "portable-manager-compat.js",
    "portable-feishu-common.js",
    "portable-feishu-turn-core.js",
    "portable-feishu-choice-core.js",
    "portable-feishu-route-core.js",
    "portable-feishu-stream-core.js",
    "portable-feishu-conversation-adapter.js",
    "portable-feishu-notifications.js",
    "portable-feishu-sidebar-toggle.js",
  ];
  const factoryEntries = portableFiles.map((filename) => {
    const source = fs.readFileSync(path.join(root, filename), "utf8");
    const transformed = transformEsmToCommonJs(source, filename);
    return `${JSON.stringify(filename)}: function(module, exports, require) {\n${transformed}\n//# sourceURL=codexpp-portable-upstream/${filename}\n}`;
  });
  const entrySource = fs.readFileSync(path.join(__dirname, "lib", "portable-browser-entry.js"), "utf8");
  return [
    "window.__codexppPortableFeishuFactories = {",
    factoryEntries.join(",\n"),
    "};",
    entrySource,
  ].join("\n");
}

function readPortableSource(request = {}) {
  const fs = require("node:fs");
  const path = require("node:path");
  const root = path.join(__dirname, "lib", "portable-upstream");
  const filename = String(request.filename || "").replace(/\\/g, "/");
  if (!filename || filename.includes("..") || path.isAbsolute(filename)) {
    throw new Error(`Invalid portable source filename: ${filename}`);
  }
  const filePath = path.resolve(root, filename);
  if (!filePath.startsWith(path.resolve(root))) {
    throw new Error(`Portable source outside root: ${filename}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

function readSidebarToggleBundle() {
  const fs = require("node:fs");
  const path = require("node:path");
  return fs.readFileSync(path.join(__dirname, "lib", "sidebar-toggle.js"), "utf8");
}

function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}

const TEXT = {
  en: {
    pageTitle: "Feishu Notifications",
    pageDescription: "Configure Feishu notifications after Codex turns complete and continue conversations from Feishu replies.",
    loadingSettings: "Loading Feishu settings...",
    saved: "Saved",
    selectImage: "Select an image file.",
    supportedImages: "Only PNG, JPG, or WebP images are supported.",
    imageTooLarge: "Images cannot exceed 1 MB.",
    imageReadFailed: "Failed to read the image.",
    savedEmbeddedImage: "Saved as an embedded configuration image",
    usingDefaultAvatar: "Using the built-in default avatar",
    readingImage: "Reading image...",
    chooseImage: "Choose Image",
    restoreDefault: "Restore Default",
    enableTitle: "Enable Feishu Notifications",
    enableDescription: "When disabled, Feishu notifications are not sent and app bot replies are not polled.",
    logsTitle: "Logs",
    logsDescription: "When enabled, Feishu diagnostic logs are written. Disabled by default.",
    projectTitle: "Show Project Name in Group Title",
    projectDescription: 'When enabled, group titles use "Project - Title". When disabled, group titles show only the title.',
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
  },
  zh: {
    pageTitle: "飞书通知",
    pageDescription: "在 Codex 回合完成后发送飞书通知，并从飞书回复继续对话。",
    loadingSettings: "正在加载飞书设置...",
    saved: "已保存",
    selectImage: "请选择一个图片文件。",
    supportedImages: "仅支持 PNG、JPG 或 WebP 图片。",
    imageTooLarge: "图片不能超过 1 MB。",
    imageReadFailed: "读取图片失败。",
    savedEmbeddedImage: "已保存为嵌入式配置图片",
    usingDefaultAvatar: "正在使用内置默认头像",
    readingImage: "正在读取图片...",
    chooseImage: "选择图片",
    restoreDefault: "恢复默认",
    enableTitle: "启用飞书通知",
    enableDescription: "关闭后不会发送飞书通知，也不会轮询应用机器人回复。",
    logsTitle: "日志",
    logsDescription: "启用后会写入飞书诊断日志。默认关闭。",
    projectTitle: "在群标题中显示项目名",
    projectDescription: "启用后，群标题使用“项目 - 标题”。关闭后，群标题只显示标题。",
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

function t(key, ...args) {
  const entry = TEXT[currentLanguage()][key] ?? TEXT.en[key] ?? key;
  return typeof entry === "function" ? entry(...args) : entry;
}

function readDefaultAvatarDataUrls() {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(
    path.join(__dirname, "lib", "portable-upstream", "portable-feishu-notifications.js"),
    "utf8",
  );
  const pick = (kind) => {
    const match = source.match(
      new RegExp(`${kind}:\\s*\\{[\\s\\S]*?dataUrl:\\s*"([^"]+)"`),
    );
    return normalizeAvatarDataUrl(match?.[1]) || "";
  };
  return {
    running: pick("running"),
    complete: pick("complete"),
  };
}

const FEISHU_AVATAR_MAX_BYTES = 1024 * 1024;
const FEISHU_AVATAR_ACCEPT = "image/png,image/jpeg,image/webp";

function normalizeAvatarDataUrl(value) {
  const dataUrl = trimString(value);
  if (!dataUrl) return "";
  return /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=\s]+$/i.test(dataUrl)
    ? dataUrl
    : "";
}

function readPortableState(api) {
  const state = api.storage.get("portableRuntimeState", {});
  return state && typeof state === "object" ? state : {};
}

function writePortableState(api, state) {
  api.storage.set("portableRuntimeState", state && typeof state === "object" ? state : {});
}

function readPortableStateObject(api, key) {
  const state = readPortableState(api);
  const value = state[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function writePortableStateObject(api, key, value) {
  const state = readPortableState(api);
  state[key] = value && typeof value === "object" ? value : {};
  writePortableState(api, state);
  return { ok: true };
}

function trimEntriesByTimestamp(map, limit) {
  return Object.fromEntries(
    Object.entries(map || {})
      .sort((left, right) => (Number(right?.[1]?.updatedAt ?? right?.[1]) || 0) - (Number(left?.[1]?.updatedAt ?? left?.[1]) || 0))
      .slice(0, limit),
  );
}

const PORTABLE_STATE_KEYS = {
  processedMessages: "codex-portable-feishu-processed-messages-v1",
  processingMessages: "codex-portable-feishu-processing-messages-v1",
  pollState: "codex-portable-feishu-poll-state-v1",
  queuedMessages: "codex-portable-feishu-queued-messages-v1",
  pendingImages: "codex-portable-feishu-pending-images-v1",
};

async function handlePortableHostInvoke(api, request = {}) {
  const action = trimString(request.action);
  switch (action) {
    case "append-debug-log":
      if (!ensureMainRuntime(api).getSettings().debugLoggingEnabled) {
        return { ok: true, skipped: true };
      }
      api.log.info("Portable Feishu debug", request.payload || {});
      return { ok: true };
    case "feishu-runtime-configure":
      api.storage.set("portableRuntimeConfig", {
        enabled: request.enabled === true,
        hostId: trimString(request.hostId) || "local",
        config: request.config && typeof request.config === "object" ? request.config : null,
        updatedAt: Date.now(),
      });
      return { ok: true };
    case "feishu-runtime-status":
      return { runtime: api.storage.get("portableRuntimeConfig", {}) };
    case "feishu-control-port-register":
    case "feishu-control-port-unregister":
    case "feishu-control-response":
      return { ok: true, skipped: true };
    case "request-json": {
      const { fetchJson } = require("./lib/feishu-api.js");
      const init = {
        method: trimString(request.method || "GET").toUpperCase() || "GET",
        headers: request.headers && typeof request.headers === "object" ? request.headers : undefined,
        body: request.body == null ? undefined : JSON.stringify(request.body),
      };
      return fetchJson(trimString(request.url), init);
    }
    case "resolve-image-attachment":
      return ensureMainRuntime(api).resolveImage({ imageRef: request.imageRef });
    case "upload-app-image":
      return ensureMainRuntime(api).uploadImage({
        imageSource: request.imageSource,
        imageType: trimString(request.imageType),
      });
    case "feishu-runtime-state-read":
      return { ok: true, state: readPortableState(api) };
    case "feishu-runtime-state-write":
      return writePortableStateObject(api, trimString(request.key), request.value);
    case "feishu-message-processed-check": {
      const messageId = trimString(request.messageId);
      const processed = readPortableStateObject(api, PORTABLE_STATE_KEYS.processedMessages);
      return { processed: Boolean(messageId && Object.prototype.hasOwnProperty.call(processed, messageId)) };
    }
    case "feishu-message-processed-mark": {
      const messageId = trimString(request.messageId);
      if (!messageId) return { ok: false };
      const processed = readPortableStateObject(api, PORTABLE_STATE_KEYS.processedMessages);
      processed[messageId] = Date.now();
      writePortableStateObject(api, PORTABLE_STATE_KEYS.processedMessages, trimEntriesByTimestamp(processed, 1000));
      const claims = readPortableStateObject(api, PORTABLE_STATE_KEYS.processingMessages);
      delete claims[messageId];
      writePortableStateObject(api, PORTABLE_STATE_KEYS.processingMessages, claims);
      return { ok: true };
    }
    case "feishu-message-claim-try": {
      const messageId = trimString(request.messageId);
      const ownerId = trimString(request.ownerId);
      const ttlMs = Math.max(5000, Math.floor(Number(request.ttlMs) || 45000));
      if (!messageId || !ownerId) return { claimed: false };
      const now = Date.now();
      const claims = readPortableStateObject(api, PORTABLE_STATE_KEYS.processingMessages);
      for (const [claimMessageId, claim] of Object.entries(claims)) {
        if (!claim || Number(claim.expiresAt) <= now) delete claims[claimMessageId];
      }
      const existing = claims[messageId];
      if (existing && trimString(existing.ownerId) !== ownerId && Number(existing.expiresAt) > now) {
        writePortableStateObject(api, PORTABLE_STATE_KEYS.processingMessages, claims);
        return { claimed: false };
      }
      claims[messageId] = { ownerId, expiresAt: now + ttlMs };
      writePortableStateObject(api, PORTABLE_STATE_KEYS.processingMessages, claims);
      return { claimed: true };
    }
    case "feishu-message-claim-release": {
      const messageId = trimString(request.messageId);
      const ownerId = trimString(request.ownerId);
      const claims = readPortableStateObject(api, PORTABLE_STATE_KEYS.processingMessages);
      if (messageId && (!ownerId || trimString(claims[messageId]?.ownerId) === ownerId)) {
        delete claims[messageId];
        writePortableStateObject(api, PORTABLE_STATE_KEYS.processingMessages, claims);
      }
      return { ok: true };
    }
    case "feishu-poll-cursor-get": {
      const chatId = trimString(request.chatId);
      const pollState = readPortableStateObject(api, PORTABLE_STATE_KEYS.pollState);
      return { cursor: chatId ? Number(pollState[chatId]) || 0 : 0 };
    }
    case "feishu-poll-cursor-set": {
      const chatId = trimString(request.chatId);
      const cursor = Number(request.cursorSeconds || request.cursor) || 0;
      if (!chatId) return { ok: false };
      const pollState = readPortableStateObject(api, PORTABLE_STATE_KEYS.pollState);
      pollState[chatId] = cursor;
      writePortableStateObject(api, PORTABLE_STATE_KEYS.pollState, pollState);
      return { ok: true };
    }
    case "feishu-queue-message-enqueue": {
      const conversationId = trimString(request.conversationId);
      if (!conversationId || !request.message) return { ok: false };
      const queues = readPortableStateObject(api, PORTABLE_STATE_KEYS.queuedMessages);
      const queue = Array.isArray(queues[conversationId]) ? queues[conversationId] : [];
      queue.push(request.message);
      queues[conversationId] = queue.slice(-20);
      writePortableStateObject(api, PORTABLE_STATE_KEYS.queuedMessages, queues);
      return { ok: true };
    }
    case "feishu-queue-message-peek": {
      const queue = readPortableStateObject(api, PORTABLE_STATE_KEYS.queuedMessages)[trimString(request.conversationId)];
      return { message: Array.isArray(queue) ? queue[0] || null : null };
    }
    case "feishu-queue-message-dequeue": {
      const conversationId = trimString(request.conversationId);
      const queues = readPortableStateObject(api, PORTABLE_STATE_KEYS.queuedMessages);
      const queue = Array.isArray(queues[conversationId]) ? queues[conversationId] : [];
      const message = queue.shift() || null;
      if (queue.length > 0) queues[conversationId] = queue;
      else delete queues[conversationId];
      writePortableStateObject(api, PORTABLE_STATE_KEYS.queuedMessages, queues);
      return { message };
    }
    case "feishu-pending-image-queue": {
      const key = trimString(request.threadKey);
      if (!key || !request.imageRef) return { ok: false };
      const images = readPortableStateObject(api, PORTABLE_STATE_KEYS.pendingImages);
      const list = Array.isArray(images[key]) ? images[key] : [];
      list.push(request.imageRef);
      images[key] = list.slice(-20);
      writePortableStateObject(api, PORTABLE_STATE_KEYS.pendingImages, images);
      return { ok: true };
    }
    case "feishu-pending-image-take": {
      const key = trimString(request.threadKey);
      const images = readPortableStateObject(api, PORTABLE_STATE_KEYS.pendingImages);
      const list = Array.isArray(images[key]) ? images[key] : [];
      delete images[key];
      writePortableStateObject(api, PORTABLE_STATE_KEYS.pendingImages, images);
      return { images: list };
    }
    case "feishu-pending-image-restore": {
      const key = trimString(request.threadKey);
      const imageRefs = Array.isArray(request.imageRefs) ? request.imageRefs : [];
      const images = readPortableStateObject(api, PORTABLE_STATE_KEYS.pendingImages);
      if (key && imageRefs.length > 0) images[key] = imageRefs;
      writePortableStateObject(api, PORTABLE_STATE_KEYS.pendingImages, images);
      return { ok: true };
    }
    default:
      throw new Error(`Unsupported portable Feishu action: ${action}`);
  }
}

function handlePortableRawHostRequest(_api, request = {}) {
  throw new Error(`Unsupported portable raw host request: ${trimString(request.method)}`);
}

function handlePortableAppServerRequest(_api, request = {}) {
  throw new Error(`Unsupported portable appserver request: ${trimString(request.method)}`);
}

function handlePortableNativeRequest(api, request = {}) {
  const targetPath = trimString(request.path);
  if (targetPath === "vscode://codex/workspace-root-options") {
    const state = mainRuntime.getBindings();
    const bindings = state?.bindings && typeof state.bindings === "object" ? state.bindings : {};
    const bindingValues = Object.values(bindings);
    const roots = [...new Set(bindingValues.map((binding) => trimString(binding.cwd)).filter(Boolean))];
    const labels = Object.fromEntries(bindingValues.map((binding) => [trimString(binding.cwd), trimString(binding.cwd)]).filter(([cwd]) => cwd));
    return { roots, labels };
  }
  throw new Error(`Unsupported portable native request: ${trimString(request.method)} ${targetPath}`);
}

function startRendererSidebarToggle(api) {
  if (sidebarToggleDispose) return;
  api.ipc.invoke("sidebar-toggle-bundle").then((source) => {
    if (sidebarToggleDispose) return;
    if (typeof source !== "string" || !source.trim()) {
      throw new Error("Feishu sidebar toggle bundle is empty.");
    }
    const module = { exports: {} };
    const exports = module.exports;
    new Function("module", "exports", "console", `${source}\n//# sourceURL=codexpp-feishu-sidebar-toggle.js`)(
      module,
      exports,
      console,
    );
    const startSidebarToggle = module.exports?.startSidebarToggle;
    if (typeof startSidebarToggle !== "function") {
      throw new Error("Feishu sidebar toggle bundle did not export startSidebarToggle.");
    }
    sidebarToggleDispose = startSidebarToggle(api);
    if (api.storage.get("settings", {})?.debugLoggingEnabled === true) {
      api.log.info("Feishu sidebar toggle started.");
    }
  }).catch((error) => {
    api.log.warn("Feishu sidebar toggle failed", error?.message || String(error));
  });
}

function handleWebviewRpc(channel, args) {
  const runtime = ensureMainRuntime(mainApi);
  switch (channel) {
    case "get-settings":
      return runtime.getSettings();
    case "set-settings":
      return runtime.setSettings(args[0]);
    case "resolve-image":
      return runtime.resolveImage(args[0]);
    case "upload-image":
      return runtime.uploadImage(args[0]);
    case "portable-source":
      return readPortableSource(args[0]);
    case "portable-host-invoke":
      return handlePortableHostInvoke(mainApi, args[0]);
    case "portable-raw-host-request":
      return handlePortableRawHostRequest(mainApi, args[0]);
    case "portable-appserver-request":
      return handlePortableAppServerRequest(mainApi, args[0]);
    case "portable-native-request":
      return handlePortableNativeRequest(mainApi, args[0]);
    default:
      throw new Error(`Unsupported Feishu webview RPC channel: ${channel}`);
  }
}

function createEl(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "className") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key === "type") el.type = value;
    else if (key === "checked") el.checked = Boolean(value);
    else if (key === "value") el.value = value == null ? "" : String(value);
    else if (value != null) el.setAttribute(key, String(value));
  }
  for (const child of children) el.append(child);
  return el;
}

function renderSettingsPage(root, api) {
  let settings = api.storage.get("settings", null);
  let defaultAvatars = root.__feishuDefaultAvatars || null;
  root.innerHTML = "";
  const status = createEl("div", { className: "min-h-5 text-xs text-token-text-secondary" });
  const rows = createEl("div", { className: "divide-y-[0.5px] divide-token-border" });
  const card = createEl("div", {
    className: "overflow-hidden rounded-lg border border-token-border bg-token-input-background shadow-sm",
  }, [rows]);
  const page = createEl("div", { className: "flex max-w-3xl flex-col gap-4" }, [card, status]);

  if (!settings || root.dataset.feishuSettingsLoaded !== "true") {
    root.append(createEl("div", { className: "text-sm text-token-text-secondary", text: t("loadingSettings") }));
    Promise.all([
      api.ipc.invoke("get-settings"),
      api.ipc.invoke("get-default-avatars").catch(() => null),
    ]).then(([next, avatars]) => {
      settings = next;
      defaultAvatars = avatars && typeof avatars === "object" ? avatars : null;
      root.__feishuDefaultAvatars = defaultAvatars;
      api.storage.set("settings", next);
      root.dataset.feishuSettingsLoaded = "true";
      renderSettingsPage(root, api);
    }).catch((error) => {
      root.innerHTML = "";
      root.append(createEl("div", { className: "text-sm text-red-500", text: error?.message || String(error) }));
    });
    return;
  }

  function updateStatus(text, kind) {
    status.textContent = text || "";
    status.className =
      kind === "error"
        ? "min-h-5 text-xs text-red-500"
        : kind === "ok"
          ? "min-h-5 text-xs text-green-600"
          : "min-h-5 text-xs text-token-text-secondary";
  }

  function savePatch(patch) {
    return api.ipc.invoke("set-settings", patch).then((next) => {
      settings = next;
      api.storage.set("settings", next);
      window.dispatchEvent(
        new CustomEvent("codexpp-feishu-settings-changed", { detail: next }),
      );
      updateStatus(t("saved"), "ok");
      window.setTimeout(() => {
        if (status.textContent === t("saved")) updateStatus("");
      }, 1200);
    }).catch((error) => updateStatus(error?.message || String(error), "error"));
  }

  const inputClass = () =>
    "h-9 w-full rounded-lg border border-token-border bg-token-input-background px-3 text-sm text-token-text-primary shadow-sm outline-none placeholder:text-token-text-tertiary focus-visible:ring-2 focus-visible:ring-token-focus";
  const parseNumber = (value, fallback, min, max) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
  };

  function row(labelText, description, control) {
    return createEl("div", {
      className: "flex items-center justify-between gap-4 p-3 max-sm:flex-col max-sm:items-stretch",
    }, [
      createEl("div", { className: "min-w-0 flex-1" }, [
        createEl("div", { className: "text-sm font-medium text-token-text-primary", text: labelText }),
        description ? createEl("div", { className: "mt-0.5 text-xs leading-5 text-token-text-secondary", text: description }) : document.createTextNode(""),
      ]),
      createEl("div", { className: "flex min-w-[18rem] justify-end max-sm:min-w-0" }, [control]),
    ]);
  }

  function createSwitch(checked, onChange) {
    let current = Boolean(checked);
    const button = createEl("button", {
      type: "button",
      role: "switch",
      "aria-checked": current ? "true" : "false",
      className:
        "inline-flex items-center text-sm focus-visible:outline-none focus-visible:ring-2 " +
        "focus-visible:ring-token-focus-border focus-visible:rounded-full cursor-interaction",
    });
    const pill = createEl("span", {
      className: "relative inline-flex shrink-0 items-center rounded-full transition-colors duration-200 ease-out h-5 w-8",
    });
    const knob = createEl("span", {
      className:
        "rounded-full border border-[color:var(--gray-0)] bg-[color:var(--gray-0)] " +
        "shadow-sm transition-transform duration-200 ease-out h-4 w-4",
    });
    const paint = () => {
      button.setAttribute("aria-checked", current ? "true" : "false");
      button.dataset.state = current ? "checked" : "unchecked";
      pill.dataset.state = current ? "checked" : "unchecked";
      knob.dataset.state = current ? "checked" : "unchecked";
      pill.className =
        "relative inline-flex shrink-0 items-center rounded-full transition-colors duration-200 ease-out h-5 w-8 " +
        (current ? "bg-token-charts-blue" : "bg-token-foreground/20");
      knob.style.transform = current ? "translateX(14px)" : "translateX(2px)";
    };
    pill.append(knob);
    button.append(pill);
    paint();
    button.addEventListener("click", async () => {
      const previous = current;
      current = !current;
      paint();
      button.disabled = true;
      try {
        await onChange(current);
      } catch {
        current = previous;
        paint();
      } finally {
        button.disabled = false;
      }
    });
    return button;
  }

  function textInput(key, placeholder, type = "text", parser = null) {
    const input = createEl("input", {
      type,
      value: settings?.[key] ?? "",
      placeholder,
      className: inputClass(),
    });
    const commit = () => savePatch({ [key]: parser ? parser(input.value) : input.value });
    input.addEventListener("change", commit);
    input.addEventListener("blur", commit);
    return input;
  }

  function smallButton(text, onClick, disabled = false) {
    const button = createEl("button", {
      type: "button",
      text,
      className:
        "h-8 rounded-lg border border-token-border bg-token-input-background px-3 text-sm text-token-text-primary shadow-sm outline-none transition hover:bg-token-main-surface-secondary disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-token-focus",
    });
    button.disabled = Boolean(disabled);
    button.addEventListener("click", onClick);
    return button;
  }

  function readAvatarFileAsDataUrl(file) {
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
        const dataUrl = normalizeAvatarDataUrl(reader.result);
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

  function avatarPreview(dataUrl, kind) {
    const isComplete = kind === "complete";
    const defaultDataUrl = normalizeAvatarDataUrl(defaultAvatars?.[kind]);
    const defaultSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180"><rect width="180" height="180" rx="36" fill="${isComplete ? "#16A34A" : "#2563EB"}"/><text x="90" y="${isComplete ? "112" : "100"}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${isComplete ? "86" : "72"}" font-weight="700" fill="#fff">${isComplete ? "✓" : "..."}</text></svg>`;
    return createEl("img", {
      src: dataUrl || defaultDataUrl || `data:image/svg+xml;charset=utf-8,${encodeURIComponent(defaultSvg)}`,
      alt: "",
      className: "h-12 w-12 rounded-full border border-token-border object-cover shadow-sm",
    });
  }

  function avatarControl(key, kind) {
    const dataUrl = normalizeAvatarDataUrl(settings?.[key]);
    const container = createEl("div", {
      className: "flex min-w-0 items-center justify-end gap-3 max-sm:w-full max-sm:justify-between",
    });
    const side = createEl("div", {
      className: "flex min-w-0 flex-col items-end gap-1.5 max-sm:items-stretch",
    });
    const actions = createEl("div", { className: "flex items-center justify-end gap-2" });
    const note = createEl("div", {
      className: "max-w-[18rem] text-right text-xs text-token-text-secondary max-sm:text-left",
      text: dataUrl ? t("savedEmbeddedImage") : t("usingDefaultAvatar"),
    });
    const label = createEl("label", {
      className:
        "inline-flex h-8 cursor-pointer items-center rounded-lg border border-token-border bg-token-input-background px-3 text-sm text-token-text-primary shadow-sm outline-none transition hover:bg-token-main-surface-secondary focus-within:ring-2 focus-within:ring-token-focus",
      text: t("chooseImage"),
    });
    const input = createEl("input", {
      type: "file",
      accept: FEISHU_AVATAR_ACCEPT,
      className: "hidden",
    });
    input.addEventListener("change", () => {
      const file = input.files?.[0] || null;
      input.value = "";
      if (!file) return;
      note.textContent = t("readingImage");
      note.className = "max-w-[18rem] text-right text-xs text-token-text-secondary max-sm:text-left";
      readAvatarFileAsDataUrl(file)
        .then((nextDataUrl) => savePatch({ [key]: nextDataUrl }))
        .then(() => renderSettingsPage(root, api))
        .catch((error) => {
          note.textContent = error?.message || String(error);
          note.className = "max-w-[18rem] text-right text-xs text-red-500 max-sm:text-left";
        });
    });
    label.append(input);
    actions.append(
      label,
      smallButton(t("restoreDefault"), () => {
        savePatch({ [key]: "" }).then(() => renderSettingsPage(root, api));
      }, !dataUrl),
    );
    side.append(actions, note);
    container.append(avatarPreview(dataUrl, kind), side);
    return container;
  }

  const enabled = createSwitch(Boolean(settings?.enabled), (next) => savePatch({ enabled: next }));
  const debugLoggingEnabled = createSwitch(Boolean(settings?.debugLoggingEnabled), (next) => savePatch({ debugLoggingEnabled: next }));
  const showProjectNameInGroupTitle = createSwitch(
    settings?.showProjectNameInGroupTitle !== false,
    (next) => savePatch({ showProjectNameInGroupTitle: next }),
  );

  rows.append(
    row(t("enableTitle"), t("enableDescription"), enabled),
    row(t("logsTitle"), t("logsDescription"), debugLoggingEnabled),
    row(t("projectTitle"), t("projectDescription"), showProjectNameInGroupTitle),
  );

  rows.append(
    row(t("appIdTitle"), t("appIdDescription"), textInput("appId", "cli_xxx")),
    row(t("appSecretTitle"), t("appSecretDescription"), textInput("appSecret", t("appSecretPlaceholder"))),
    row(t("targetUserTitle"), t("targetUserDescription"), textInput("appRecipientOpenId", "ou_xxx")),
    row(t("runningAvatarTitle"), t("runningAvatarDescription"), avatarControl("groupRunningAvatarDataUrl", "running")),
    row(t("completedAvatarTitle"), t("completedAvatarDescription"), avatarControl("groupCompleteAvatarDataUrl", "complete")),
    row(t("pollingTitle"), t("pollingDescription"), textInput("appPollingIntervalSeconds", "5", "number", (value) => parseNumber(value, 5, 3, 60))),
    row(t("recentPromptTitle"), t("recentPromptDescription"), textInput("appDirectRouteRecentConversationLimit", "5", "number", (value) => parseNumber(value, 5, 0, 20))),
    row(t("workspacePromptTitle"), t("workspacePromptDescription"), textInput("appDirectRouteWorkspaceLimit", "3", "number", (value) => parseNumber(value, 3, 0, 20))),
  );

  root.append(page);
}

module.exports = {
  start(api) {
    if (api.process === "main") {
      startMain(api);
    } else {
      startRenderer(api);
    }
  },
  stop() {
    try {
    mainRuntime?.dispose?.();
  } catch {}
  mainRuntime = null;
    stopWebviewBridge();
  clearMainIpcHandlers();
    try {
      settingsHandle?.unregister?.();
    } catch {}
    settingsHandle = null;
    try {
      sidebarToggleDispose?.();
    } catch {}
    sidebarToggleDispose = null;
  },
};
