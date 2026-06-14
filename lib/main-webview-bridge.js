"use strict";

const RPC_PREFIX = "__CODEXPP_FEISHU_RPC__";
const LOG_PREFIX = "__CODEXPP_FEISHU_LOG__";
const RESPONSE_EVENT = "__codexpp_feishu_rpc_response__";
const GLOBAL_KEY = "__codexpp_feishu_webview_bridge__";
const BRIDGE_VERSION = 37;
const QUIET_RPC_CHANNELS = new Set(["get-settings", "portable-host-invoke"]);

function summarizeRpcArgs(channel, args) {
  if (channel === "portable-host-invoke") {
    const payload = Array.isArray(args) ? args[0] : null;
    const action = String(payload?.action || "");
    return {
      action,
      keys: payload && typeof payload === "object" ? Object.keys(payload).slice(0, 8) : [],
    };
  }
  return null;
}

function createMainWebviewBridge(options) {
  const api = options.api;
  const readRendererBundle = options.readRendererBundle;
  const handleRpc = options.handleRpc;
  const state = globalThis[GLOBAL_KEY] || {
    attached: new Map(),
    listenerRegistered: false,
    webContentsCreatedHandler: null,
    lastInjectLogAtById: new Map(),
    retryTimersById: new Map(),
    hardReloadedVersionById: new Map(),
  };
  if (!(state.attached instanceof Map)) state.attached = new Map();
  if (!(state.lastInjectLogAtById instanceof Map)) state.lastInjectLogAtById = new Map();
  if (!(state.retryTimersById instanceof Map)) state.retryTimersById = new Map();
  if (!(state.hardReloadedVersionById instanceof Map)) state.hardReloadedVersionById = new Map();
  state.listenerRegistered = Boolean(state.listenerRegistered);
  globalThis[GLOBAL_KEY] = state;

  function isDebugLoggingEnabled() {
    const settings = api.storage?.get?.("settings", {});
    return settings?.debugLoggingEnabled === true;
  }

  function debugLog(...args) {
    if (isDebugLoggingEnabled()) {
      api.log.info(...args);
    }
  }

  function isCandidateWebContents(wc) {
    if (!wc || wc.isDestroyed?.()) return false;
    const url = String(wc.getURL?.() || "");
    if (!url) return true;
    return url.startsWith("app://") || url.includes("codex") || url.includes("localhost");
  }

  function sendResponse(wc, id, payload) {
    if (!id || !wc || wc.isDestroyed?.()) return;
    const detail = JSON.stringify({ id, ...payload });
    wc.executeJavaScript(
      `window.dispatchEvent(new CustomEvent(${JSON.stringify(RESPONSE_EVENT)}, { detail: ${detail} }));`,
      true,
    ).catch(() => {});
  }

  async function handleConsoleMessage(wc, rawMessage) {
    const message = String(rawMessage || "");
    if (message.startsWith(LOG_PREFIX)) {
      try {
        const entry = JSON.parse(message.slice(LOG_PREFIX.length));
        const args = Array.isArray(entry.args) ? entry.args : [];
        const level = entry.level === "warn" ? "warn" : "info";
        if (level === "warn") {
          api.log.warn(`[webview] ${args.map(formatLogArg).join(" ")}`);
        } else {
          debugLog(`[webview] ${args.map(formatLogArg).join(" ")}`);
        }
      } catch {
        debugLog(message);
      }
      return;
    }
    if (!message.startsWith(RPC_PREFIX)) return;

    let request;
    try {
      request = JSON.parse(message.slice(RPC_PREFIX.length));
    } catch (error) {
      api.log.warn("Feishu webview RPC parse failed", error?.message || String(error));
      return;
    }

    const id = String(request?.id || "");
    const channel = String(request?.channel || "");
    const args = Array.isArray(request?.args) ? request.args : [];
    const argsSummary = summarizeRpcArgs(channel, args);
    const isQuietPortableHostAction =
      channel === "portable-host-invoke" &&
      (
        argsSummary?.action === "append-debug-log" ||
        argsSummary?.action === "feishu-runtime-configure" ||
        argsSummary?.action === "feishu-runtime-status" ||
        argsSummary?.action === "feishu-poll-cursor-get" ||
        argsSummary?.action === "feishu-poll-cursor-set" ||
        argsSummary?.action === "feishu-message-processed-check" ||
        argsSummary?.action === "feishu-message-processed-mark" ||
        argsSummary?.action === "feishu-message-claim-try" ||
        argsSummary?.action === "feishu-message-claim-release" ||
        argsSummary?.action === "feishu-queue-message-enqueue" ||
        argsSummary?.action === "feishu-queue-message-dequeue" ||
        argsSummary?.action === "feishu-queue-message-peek"
      );
    const logRpc = !QUIET_RPC_CHANNELS.has(channel) && !isQuietPortableHostAction;
    if (logRpc) {
      debugLog("Feishu webview RPC request", {
        id,
        channel,
        argsLength: args.length,
        argsSummary,
        webContentsId: typeof wc.id === "number" ? wc.id : null,
      });
    }
    try {
      const result = await handleRpc(channel, args);
      if (logRpc) {
        debugLog("Feishu webview RPC success", {
          id,
          channel,
          resultType: typeof result,
          chunkLength: typeof result?.chunk === "string" ? result.chunk.length : 0,
        });
      }
      sendResponse(wc, id, { ok: true, result });
    } catch (error) {
      api.log.warn("Feishu webview RPC error", {
        id,
        channel,
        error: error?.message || String(error),
      });
      sendResponse(wc, id, {
        ok: false,
        error: error?.message || String(error),
      });
    }
  }

  function attach(wc) {
    if (!isCandidateWebContents(wc)) return;
    const existing = state.attached.get(wc);
    if (existing) {
      return;
    }

    const onConsoleMessage = (...eventArgs) => {
      const message = extractConsoleMessage(eventArgs);
      handleConsoleMessage(wc, message).catch((error) => {
        api.log.warn("Feishu webview RPC failed", error?.message || String(error));
      });
    };
    const injectSoon = () => {
      setTimeout(() => inject(wc).catch(() => {}), 250);
    };

    wc.on("console-message", onConsoleMessage);
    wc.on("dom-ready", injectSoon);
    wc.on("did-finish-load", injectSoon);
    state.attached.set(wc, {
      dispose() {
        try {
          wc.off("console-message", onConsoleMessage);
          wc.off("dom-ready", injectSoon);
          wc.off("did-finish-load", injectSoon);
        } catch {}
      },
    });
    debugLog("Feishu webview bridge attached", {
      id: typeof wc.id === "number" ? wc.id : null,
      url: String(wc.getURL?.() || ""),
    });
    injectSoon();
  }

  async function inject(wc) {
    if (!isCandidateWebContents(wc)) return;
    const bundleSource = String(readRendererBundle() || "");
    const sourceLength = bundleSource.length;
    const debugLoggingEnabled = isDebugLoggingEnabled();
    const smokeScript = buildSmokeScript(debugLoggingEnabled);
    const script = buildInjectionScript(bundleSource, debugLoggingEnabled);
    const id = typeof wc.id === "number" ? wc.id : String(wc.getURL?.() || "unknown");
    debugLog("Feishu webview bridge inject begin", {
      id,
      url: String(wc.getURL?.() || ""),
      sourceLength,
    });
    try {
      const probe = await withTimeout(
        wc.executeJavaScript("(() => ({ ok: true, href: location.href, title: document.title }))()", true),
        5000,
        "probe timed out",
      );
      const existingBridge = await withTimeout(
        wc.executeJavaScript(
          "(() => window.__codexppFeishuWebviewBridge ? { started: !!window.__codexppFeishuWebviewBridge.started, version: window.__codexppFeishuWebviewBridge.version ?? null, bundleLength: window.__codexppFeishuWebviewBridge.bundleLength ?? null } : null)()",
          true,
        ),
        5000,
        "existing bridge probe timed out",
      );
      const reloadKey = `${BRIDGE_VERSION}:${sourceLength}`;
      if (
        existingBridge?.started &&
        (
          Number(existingBridge.version) !== BRIDGE_VERSION ||
          Number(existingBridge.bundleLength) !== sourceLength
        ) &&
        state.hardReloadedVersionById.get(id) !== reloadKey
      ) {
        state.hardReloadedVersionById.set(id, reloadKey);
        debugLog("Feishu webview bridge forcing hard reload for new bridge version", {
          id,
          fromVersion: existingBridge.version,
          fromBundleLength: existingBridge.bundleLength,
          toVersion: BRIDGE_VERSION,
          toBundleLength: sourceLength,
          href: probe?.href || "",
        });
        wc.reload();
        return;
      }
      debugLog("Feishu webview bridge probe result", { id, probe });
      debugLog("Feishu webview bridge smoke dispatch", { id });
      const smoke = await withTimeout(
        wc.executeJavaScript(smokeScript, true),
        5000,
        "smoke timed out",
      );
      debugLog("Feishu webview bridge smoke result", { id, smoke });
      debugLog("Feishu webview bridge loader dispatch", { id, scriptLength: script.length });
      try {
        const promise = wc.executeJavaScript(script, true);
        debugLog("Feishu webview bridge loader promise created", { id });
        Promise.resolve(promise).then(
          (result) => logInjectResult(wc, result || { ok: true, returned: true }),
          (error) => logInjectResult(wc, { ok: false, error: error?.message || String(error) }),
        );
      } catch (error) {
        logInjectResult(wc, { ok: false, error: error?.message || String(error) });
      }
      logInjectResult(wc, { ok: true, scheduled: true, href: probe?.href || "" });
    } catch (error) {
      logInjectResult(wc, { ok: false, error: error?.message || String(error) });
      scheduleRetry(wc, error);
    }
  }

  function scheduleRetry(wc, error) {
    if (!wc || wc.isDestroyed?.()) return;
    const id = typeof wc.id === "number" ? wc.id : String(wc.getURL?.() || "unknown");
    if (state.retryTimersById.has(id)) return;
    const message = error?.message || String(error || "");
    const delayMs = /timed out/i.test(message) ? 4000 : 8000;
    const timer = setTimeout(() => {
      state.retryTimersById.delete(id);
      inject(wc).catch(() => {});
    }, delayMs);
    state.retryTimersById.set(id, timer);
  }

  function logInjectResult(wc, result) {
    const id = typeof wc.id === "number" ? wc.id : String(wc.getURL?.() || "unknown");
    const now = Date.now();
    const previous = Number(state.lastInjectLogAtById.get(id) || 0);
    const ok = result?.ok === true;
    const started = result?.started === true;
    const scheduled = result?.scheduled === true;
    const alreadyStarted = result?.alreadyStarted === true;
    if (ok && alreadyStarted && now - previous < 60_000) return;
    state.lastInjectLogAtById.set(id, now);
    const payload = {
      id,
      ok,
      started,
      scheduled,
      alreadyStarted,
      href: String(result?.href || wc.getURL?.() || ""),
      error: String(result?.error || ""),
    };
    if (ok) {
      debugLog("Feishu webview bridge inject result", payload);
    } else {
      api.log.warn("Feishu webview bridge inject result", payload);
    }
  }

  function start() {
    const { app, webContents } = require("electron");
    for (const wc of webContents.getAllWebContents()) attach(wc);
    if (!state.listenerRegistered) {
      state.webContentsCreatedHandler = (_event, wc) => {
        globalThis[GLOBAL_KEY]?.attach?.(wc);
      };
      app.on("web-contents-created", state.webContentsCreatedHandler);
      state.listenerRegistered = true;
    }
    state.attach = attach;
    debugLog("Feishu webview appserver bridge active.");
  }

  function dispose() {
    try {
      const { app } = require("electron");
      if (state.listenerRegistered && state.webContentsCreatedHandler) {
        app.removeListener("web-contents-created", state.webContentsCreatedHandler);
      }
    } catch {}
    state.listenerRegistered = false;
    state.webContentsCreatedHandler = null;
    state.attach = null;
    for (const timer of state.retryTimersById.values()) {
      clearTimeout(timer);
    }
    state.retryTimersById.clear();
    for (const [wc, attached] of state.attached.entries()) {
      attached.dispose();
      state.attached.delete(wc);
    }
  }

  return { dispose, start };
}

function formatLogArg(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function extractConsoleMessage(eventArgs) {
  for (let index = eventArgs.length - 1; index >= 0; index -= 1) {
    const value = eventArgs[index];
    if (typeof value === "string" && (value.startsWith(RPC_PREFIX) || value.startsWith(LOG_PREFIX))) {
      return value;
    }
  }
  const maybeMessage = eventArgs.find((value) => typeof value === "string");
  return maybeMessage || "";
}

function withTimeout(promise, timeoutMs, message) {
  let timerId = null;
  return new Promise((resolve, reject) => {
    timerId = setTimeout(() => reject(new Error(message)), timeoutMs);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timerId);
        resolve(value);
      },
      (error) => {
        clearTimeout(timerId);
        reject(error);
      },
    );
  });
}

function buildSmokeScript(debugLoggingEnabled = false) {
  return `
(() => {
  const LOG_PREFIX = ${JSON.stringify(LOG_PREFIX)};
  const DEBUG_LOGGING_ENABLED = ${debugLoggingEnabled ? "true" : "false"};
  try {
    if (DEBUG_LOGGING_ENABLED) {
    console.info(LOG_PREFIX + JSON.stringify({
      level: "info",
      args: ["Feishu webview smoke", location.href, document.title],
    }));
    }
  } catch {}
  return { ok: true, smoke: true, href: location.href, title: document.title };
})()
`;
}

function buildInjectionScript(bundleSource, debugLoggingEnabled = false) {
  return `
(() => {
  const RESPONSE_EVENT = ${JSON.stringify(RESPONSE_EVENT)};
  const RPC_PREFIX = ${JSON.stringify(RPC_PREFIX)};
  const LOG_PREFIX = ${JSON.stringify(LOG_PREFIX)};
  const DEBUG_LOGGING_ENABLED = ${debugLoggingEnabled ? "true" : "false"};
  const BRIDGE_VERSION = ${BRIDGE_VERSION};
  const BUNDLE_SOURCE_LENGTH = ${bundleSource.length};
  if (window.__codexppFeishuWebviewBridge?.started) {
    if (
      window.__codexppFeishuWebviewBridge.version === BRIDGE_VERSION &&
      window.__codexppFeishuWebviewBridge.bundleLength === BUNDLE_SOURCE_LENGTH &&
      !window.__codexppFeishuWebviewBridge.error
    ) {
      return { ok: true, alreadyStarted: true, version: BRIDGE_VERSION };
    }
    try { window.__codexppFeishuWebviewBridge.dispose?.(); } catch {}
  }

  const pending = new Map();
  let nextRequestId = 1;
  const serializeArg = (value) => {
    if (value instanceof Error) return value.message || String(value);
    if (typeof value === "string") return value;
    try { return JSON.stringify(value); } catch { return String(value); }
  };
  const emitLog = (level, args) => {
    try {
      if (level !== "warn" && !DEBUG_LOGGING_ENABLED) return;
      console[level === "warn" ? "warn" : "info"](
        LOG_PREFIX + JSON.stringify({ level, args: Array.from(args).map(serializeArg) }),
      );
    } catch {}
  };
  const onResponse = (event) => {
    const detail = event?.detail || {};
    const id = String(detail.id || "");
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    window.clearTimeout(entry.timer);
    if (detail.ok) entry.resolve(detail.result);
    else entry.reject(new Error(detail.error || "Feishu RPC failed."));
  };
  window.addEventListener(RESPONSE_EVENT, onResponse);

  const ipc = {
    invoke(channel, ...args) {
      const id = "feishu-rpc-" + Date.now() + "-" + nextRequestId++;
      return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => {
          pending.delete(id);
          reject(new Error("Feishu RPC timed out: " + channel));
        }, 120000);
        pending.set(id, { resolve, reject, timer });
        console.info(RPC_PREFIX + JSON.stringify({ id, channel, args }));
      });
    },
  };

  const react = {
    getFiber(node) {
      if (!node || typeof node !== "object") return null;
      for (const key of Object.keys(node)) {
        if (key.startsWith("__reactFiber$") || key.startsWith("__reactContainer$")) {
          return node[key] || null;
        }
      }
      return null;
    },
  };

  const api = {
    ipc,
    react,
    log: {
      info: (...args) => emitLog("info", args),
      warn: (...args) => emitLog("warn", args),
    },
  };

  window.__codexppFeishuWebviewBridge = {
    started: true,
    loading: true,
    version: BRIDGE_VERSION,
    bundleLength: BUNDLE_SOURCE_LENGTH,
    disposeAppserver: null,
    dispose() {
      try { this.disposeAppserver?.(); } catch {}
      window.removeEventListener(RESPONSE_EVENT, onResponse);
      for (const entry of pending.values()) window.clearTimeout(entry.timer);
      pending.clear();
      this.started = false;
    },
  };
  api.log.info("Feishu webview loader installed.", location.href, "v" + BRIDGE_VERSION);
  window.setTimeout(async () => {
    try {
      api.log.info("Feishu webview loader timer fired.");
      const module = { exports: {} };
      const exports = module.exports;
      ${bundleSource}
      ;
      api.log.info("Feishu webview bundle evaluated.");
      const createRendererAppServer = module.exports?.createRendererAppServer;
      if (typeof createRendererAppServer !== "function") {
        throw new Error("Feishu renderer bundle did not export createRendererAppServer.");
      }
      const appserver = createRendererAppServer(api);
      window.__codexppFeishuWebviewBridge.disposeAppserver = appserver.start();
      window.__codexppFeishuWebviewBridge.loading = false;
      api.log.info("Feishu webview appserver bridge started.", location.href);
    } catch (error) {
      window.__codexppFeishuWebviewBridge.loading = false;
      window.__codexppFeishuWebviewBridge.error = error?.message || String(error);
      api.log.warn("Feishu webview appserver bridge failed", error?.message || String(error));
    }
  }, 0);
  return { ok: true, scheduled: true, href: location.href };
})()
`;
}

module.exports = { createMainWebviewBridge };
