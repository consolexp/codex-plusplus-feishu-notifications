"use strict";

function createPortableBrowserEntry(api) {
  const DISCOVERY_RETRY_INTERVAL_MS = 3000;
  const DISCOVERY_MAX_RETRY_ATTEMPTS = 12;
  const state = {
    disposed: false,
    modules: new Map(),
    factories: new Map(),
    managers: new Set(),
    registries: new Set(),
    hookStates: [],
    hookIndex: 0,
    pendingEffects: [],
    cleanups: [],
    renderScheduled: false,
    renderCount: 0,
    mountedPlugins: [],
    settingsSnapshot: null,
    lastSettingsSnapshotLogKey: "",
    lastDiscoverySignature: "",
    discoveryRetryTimerId: 0,
    discoveryRetryAttempts: 0,
  };

  function trimString(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function isDebugLoggingEnabled() {
    return state.settingsSnapshot?.debugLoggingEnabled === true;
  }

  function debugLog(...args) {
    if (isDebugLoggingEnabled()) {
      api.log.info(...args);
    }
  }

  function summarizeSettingsSnapshot(settings) {
    const source = settings && typeof settings === "object" ? settings : {};
    return {
      enabled: source.enabled === true,
      mode: trimString(source.mode),
      hasAppId: Boolean(trimString(source.appId)),
      hasAppSecret: Boolean(trimString(source.appSecret)),
      hasAppRecipientOpenId: Boolean(trimString(source.appRecipientOpenId)),
      appPollingIntervalSeconds: Number(source.appPollingIntervalSeconds) || 0,
      appDirectRouteRecentConversationLimit: Number(source.appDirectRouteRecentConversationLimit) || 0,
      appDirectRouteWorkspaceLimit: Number(source.appDirectRouteWorkspaceLimit) || 0,
      showProjectNameInGroupTitle: source.showProjectNameInGroupTitle !== false,
      debugLoggingEnabled: source.debugLoggingEnabled === true,
      isAppReady: source.isAppReady === true,
    };
  }

  function redactSettingsValue(settingsKey, value) {
    if (settingsKey === "appSecret" || /secret/i.test(settingsKey)) {
      return { present: Boolean(trimString(value)) };
    }
    if (typeof value === "string") return trimString(value);
    return value;
  }

  function setSettingsSnapshot(settings, reason) {
    state.settingsSnapshot = settings && typeof settings === "object" ? settings : {};
    window.__CODEX_PORTABLE_REGISTRY_DEBUG__ =
      state.settingsSnapshot.debugLoggingEnabled === true;
    try {
      if (state.settingsSnapshot.debugLoggingEnabled !== true) return state.settingsSnapshot;
      const logKey = JSON.stringify(summarizeSettingsSnapshot(state.settingsSnapshot));
      if (logKey !== state.lastSettingsSnapshotLogKey) {
        state.lastSettingsSnapshotLogKey = logKey;
        debugLog("Portable Feishu settings snapshot", {
          reason: trimString(reason),
          summary: summarizeSettingsSnapshot(state.settingsSnapshot),
        });
      }
    } catch {}
    return state.settingsSnapshot;
  }

  async function refreshSettingsSnapshot(reason) {
    const settings = await api.ipc.invoke("get-settings");
    return setSettingsSnapshot(settings, reason);
  }

  function transformEsmToCommonJs(source, filename) {
    let code = String(source || "");
    const appendedExports = [];
    code = code.replace(
      /import\s*\{\s*([^}]+?)\s*\}\s*from\s*["']([^"']+)["'];?/g,
      (_match, names, specifier) => `const { ${names.trim()} } = require(${JSON.stringify(specifier)});`,
    );
    code = code.replace(
      /export\s*\{\s*([^}]+?)\s*\}\s*from\s*["']([^"']+)["'];?/g,
      (_match, names, specifier) => `Object.assign(exports, (({ ${names.trim()} }) => ({ ${names.trim()} }))(require(${JSON.stringify(specifier)})));`,
    );
    code = code.replace(/export\s+const\s+([A-Za-z_$][\w$]*)\s*=/g, "const $1 = exports.$1 =");
    code = code.replace(/export\s+let\s+([A-Za-z_$][\w$]*)\s*=/g, "let $1 = exports.$1 =");
    code = code.replace(/export\s+var\s+([A-Za-z_$][\w$]*)\s*=/g, "var $1 = exports.$1 =");
    code = code.replace(/export\s+async\s+function\s+([A-Za-z_$][\w$]*)\s*\(/g, (_match, name) => {
      appendedExports.push(`exports.${name} = ${name};`);
      return `async function ${name}(`;
    });
    code = code.replace(/export\s+function\s+([A-Za-z_$][\w$]*)\s*\(/g, (_match, name) => {
      appendedExports.push(`exports.${name} = ${name};`);
      return `function ${name}(`;
    });
    code = code.replace(/export\s*\{\s*([^}]+?)\s*\};?/g, (_match, names) => {
      return names
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const match = part.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
          if (!match) throw new Error(`Unsupported export syntax in ${filename}: ${part}`);
          return `exports.${match[2] || match[1]} = ${match[1]};`;
        })
        .join("\n");
    });
    if (appendedExports.length > 0) code += `\n${appendedExports.join("\n")}\n`;
    if (String(filename || "").replace(/\\/g, "/").endsWith("portable-host-request-compat.js")) {
      code = code.replace(
        "return globalThis.window?.electronBridge ?? null;",
        "return globalThis.window?.__codexppPortableElectronBridge ?? globalThis.window?.electronBridge ?? null;",
      );
      code = code.replace(
        "const bridge = globalThis.window?.electronBridge;",
        "const bridge = globalThis.window?.__codexppPortableElectronBridge ?? globalThis.window?.electronBridge;",
      );
    }
    return code;
  }

  async function loadModuleSource(filename) {
    const cached = state.factories.get(filename);
    if (cached) return cached;
    if (window.__codexppPortableFeishuFactories?.[filename]) {
      const factory = window.__codexppPortableFeishuFactories[filename];
      state.factories.set(filename, factory);
      return factory;
    }
    const source = await api.ipc.invoke("portable-source", { filename });
    const code = transformEsmToCommonJs(source, filename);
    const factory = new Function("module", "exports", "require", `${code}\n//# sourceURL=codexpp-portable-upstream/${filename}`);
    state.factories.set(filename, factory);
    return factory;
  }

  function resolveFilename(specifier, parentFilename = "") {
    let normalized = trimString(specifier).replace(/\\/g, "/");
    if (!normalized.startsWith(".")) return normalized;
    const base = parentFilename.includes("/") ? parentFilename.slice(0, parentFilename.lastIndexOf("/") + 1) : "";
    while (normalized.startsWith("./")) normalized = normalized.slice(2);
    const parts = `${base}${normalized}`.split("/");
    const out = [];
    for (const part of parts) {
      if (!part || part === ".") continue;
      if (part === "..") out.pop();
      else out.push(part);
    }
    const filename = out.join("/");
    return filename.endsWith(".js") ? filename : `${filename}.js`;
  }

  async function requireAsync(specifier, parentFilename = "") {
    const filename = resolveFilename(specifier, parentFilename);
    return requireLoadedModule(filename);
  }

  function requireLoadedModule(filename) {
    if (state.modules.has(filename)) return state.modules.get(filename).exports;
    const factory = state.factories.get(filename);
    if (typeof factory !== "function") {
      throw new Error(`Portable module was not preloaded: ${filename}`);
    }
    const module = { exports: {} };
    state.modules.set(filename, module);
    const requireSync = (nextSpecifier) => {
      const nextFilename = resolveFilename(nextSpecifier, filename);
      return requireLoadedModule(nextFilename);
    };
    factory(module, module.exports, requireSync);
    return module.exports;
  }

  async function preloadModules(files) {
    for (const file of files) await loadModuleSource(file);
    for (const file of files) await requireAsync(file);
  }

  function preloadEmbeddedModuleFactories(files) {
    for (const file of files) {
      const factory = window.__codexppPortableFeishuFactories?.[file];
      if (typeof factory === "function") state.factories.set(file, factory);
    }
  }

  function findAllReactRoots() {
    const roots = [];
    for (const node of Array.from(document.querySelectorAll("body, body *"))) {
      for (const key of Object.keys(node)) {
        if (key.startsWith("__reactContainer$") || key.startsWith("__reactFiber$")) {
          roots.push(node);
          break;
        }
      }
    }
    return roots;
  }

  function getFiber(node) {
    if (api?.react?.getFiber) return api.react.getFiber(node);
    for (const key of Object.keys(node || {})) {
      if (key.startsWith("__reactFiber$") || key.startsWith("__reactContainer$")) return node[key] || null;
    }
    return null;
  }

  function walkFiberTree(fiber, visit, seen = new Set()) {
    if (!fiber || seen.has(fiber)) return;
    seen.add(fiber);
    visit(fiber);
    walkFiberTree(fiber.child, visit, seen);
    walkFiberTree(fiber.sibling, visit, seen);
  }

  function looksLikeCodexManager(value) {
    return Boolean(
      value &&
        typeof value === "object" &&
        typeof value.sendRequest === "function" &&
        (typeof value.getHostId === "function" ||
          typeof value.getConversation === "function" ||
          typeof value.getLastAgentMessageForTurn === "function" ||
          typeof value.addTurnCompletedListener === "function" ||
          typeof value.addAnyConversationCallback === "function" ||
          typeof value.resumeConversationForUnavailableOwner === "function" ||
          typeof value.hydrateBackgroundThreads === "function"),
    );
  }

  function looksLikeAppServerRegistry(value) {
    return Boolean(
      value &&
        typeof value === "object" &&
        typeof value.getAll === "function" &&
        (typeof value.getImplForHostId === "function" ||
          typeof value.getForHostId === "function" ||
          typeof value.getMaybeForConversationId === "function"),
    );
  }

  function collectCandidateObjects(value, seen, depth = 0) {
    if (!value || typeof value !== "object" || seen.has(value) || depth > 4) return;
    seen.add(value);
    if (looksLikeCodexManager(value)) state.managers.add(value);
    if (looksLikeAppServerRegistry(value)) {
      state.registries.add(value);
      try {
        const managers = value.getAll();
        if (Array.isArray(managers)) {
          for (const manager of managers) if (looksLikeCodexManager(manager)) state.managers.add(manager);
        }
      } catch {}
    }
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 30)) collectCandidateObjects(item, seen, depth + 1);
      return;
    }
    for (const key of Object.keys(value).slice(0, 100)) {
      if (/^_|fiber|return|child|sibling|stateNode|alternate/i.test(key)) continue;
      try {
        collectCandidateObjects(value[key], seen, depth + 1);
      } catch {}
    }
  }

  function discoverManagersAndRegistries() {
    for (const node of findAllReactRoots()) {
      const rootFiber = getFiber(node);
      walkFiberTree(rootFiber, (fiber) => {
        collectCandidateObjects(fiber.memoizedProps, new WeakSet());
        collectCandidateObjects(fiber.memoizedState, new WeakSet());
        collectCandidateObjects(fiber.stateNode, new WeakSet());
      });
    }
  }

  function pruneInvalidDiscoveredObjects() {
    for (const manager of [...state.managers]) {
      if (!looksLikeCodexManager(manager)) state.managers.delete(manager);
    }
    for (const registry of [...state.registries]) {
      if (!looksLikeAppServerRegistry(registry)) state.registries.delete(registry);
    }
  }

  function hasUsableDiscoveredObjects() {
    pruneInvalidDiscoveredObjects();
    return state.managers.size > 0 || state.registries.size > 0;
  }

  function clearDiscoveryRetry() {
    if (state.discoveryRetryTimerId) {
      window.clearTimeout(state.discoveryRetryTimerId);
      state.discoveryRetryTimerId = 0;
    }
    state.discoveryRetryAttempts = 0;
  }

  function scheduleDiscoveryRetry(reason = "") {
    if (
      state.disposed ||
      state.discoveryRetryTimerId ||
      state.discoveryRetryAttempts >= DISCOVERY_MAX_RETRY_ATTEMPTS
    ) {
      debugLog("Portable Feishu discovery retry skipped", {
        reason: trimString(reason),
        disposed: state.disposed,
        hasTimer: Boolean(state.discoveryRetryTimerId),
        attempts: state.discoveryRetryAttempts,
        maxAttempts: DISCOVERY_MAX_RETRY_ATTEMPTS,
      });
      return;
    }

    state.discoveryRetryAttempts += 1;
    const attempt = state.discoveryRetryAttempts;
    debugLog("Portable Feishu discovery retry scheduled", {
      reason: trimString(reason),
      attempt,
      intervalMs: DISCOVERY_RETRY_INTERVAL_MS,
    });
    state.discoveryRetryTimerId = window.setTimeout(() => {
      state.discoveryRetryTimerId = 0;
      if (state.disposed) {
        debugLog("Portable Feishu discovery retry aborted", {
          reason: "disposed",
          attempt,
        });
        return;
      }
      const hadUsableObjectsBefore = hasUsableDiscoveredObjects();
      debugLog("Portable Feishu discovery retry fired", {
        attempt,
        hadUsableObjectsBefore,
      });
      if (hadUsableObjectsBefore) {
        clearDiscoveryRetry();
        return;
      }
      ensureManagersAndRegistriesDiscovered(true, `retry-${attempt}`);
      if (!hasUsableDiscoveredObjects()) {
        scheduleDiscoveryRetry(`retry-${attempt}-miss`);
      }
    }, DISCOVERY_RETRY_INTERVAL_MS);
  }

  function ensureManagersAndRegistriesDiscovered(force = false, reason = "") {
    if (!force && hasUsableDiscoveredObjects()) return false;
    state.managers.clear();
    state.registries.clear();
    discoverManagersAndRegistries();
    pruneInvalidDiscoveredObjects();
    const hasDiscoveredObjects = state.managers.size > 0 || state.registries.size > 0;
    const discoverySignature = JSON.stringify({
      managerCount: state.managers.size,
      registryCount: state.registries.size,
      hostIds: [...state.managers]
        .map((manager) => trimString(manager?.getHostId?.()))
        .filter(Boolean)
        .slice(0, 10),
    });
    if (discoverySignature !== state.lastDiscoverySignature) {
      const hadPreviousSignature = state.lastDiscoverySignature.length > 0;
      state.lastDiscoverySignature = discoverySignature;
      if (hadPreviousSignature && !state.renderScheduled) {
        scheduleRender();
      }
    }
    debugLog("Portable Feishu discovery result", {
      reason: trimString(reason),
      force,
      managerCount: state.managers.size,
      registryCount: state.registries.size,
      hasDiscoveredObjects,
      hostIds: [...state.managers]
        .map((manager) => trimString(manager?.getHostId?.()))
        .filter(Boolean)
        .slice(0, 10),
    });
    if (hasDiscoveredObjects) {
      clearDiscoveryRetry();
    } else {
      scheduleDiscoveryRetry(reason || "discovery-miss");
    }
    return true;
  }

  function getPrimaryManager() {
    ensureManagersAndRegistriesDiscovered(false, "get-primary-manager");
    return [...state.managers][0] || null;
  }

  function createRegistryShim() {
    return {
      getAll() {
        ensureManagersAndRegistriesDiscovered(false, "registry-getAll");
        return [...state.managers];
      },
      getImplForHostId(hostId) {
        const normalizedHostId = trimString(hostId);
        ensureManagersAndRegistriesDiscovered(false, "registry-getImplForHostId");
        for (const registry of state.registries) {
          try {
            const manager = registry.getImplForHostId?.(normalizedHostId);
            if (manager) return manager;
          } catch {}
        }
        return [...state.managers].find((manager) => trimString(manager?.getHostId?.()) === normalizedHostId) || null;
      },
      getMaybeForConversationId(conversationId) {
        const normalizedConversationId = trimString(conversationId);
        ensureManagersAndRegistriesDiscovered(false, "registry-getMaybeForConversationId");
        return [...state.managers].find((manager) => {
          try {
            return Boolean(manager.getConversation?.(normalizedConversationId));
          } catch {
            return false;
          }
        }) || null;
      },
    };
  }

  function depsSame(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => Object.is(value, right[index]));
  }

  function scheduleRender() {
    if (state.disposed || state.renderScheduled) return;
    state.renderScheduled = true;
    window.setTimeout(() => {
      state.renderScheduled = false;
      renderPlugins();
    }, 0);
  }

  const ReactShim = {
    useState(initialValue) {
      const index = state.hookIndex++;
      if (!Object.prototype.hasOwnProperty.call(state.hookStates, index)) {
        state.hookStates[index] = typeof initialValue === "function" ? initialValue() : initialValue;
      }
      const setValue = (nextValue) => {
        const value = typeof nextValue === "function" ? nextValue(state.hookStates[index]) : nextValue;
        if (Object.is(value, state.hookStates[index])) return;
        state.hookStates[index] = value;
        scheduleRender();
      };
      return [state.hookStates[index], setValue];
    },
    useRef(initialValue) {
      const index = state.hookIndex++;
      if (!state.hookStates[index]) state.hookStates[index] = { current: initialValue };
      return state.hookStates[index];
    },
    useMemo(factory, deps) {
      const index = state.hookIndex++;
      const previous = state.hookStates[index];
      if (previous && depsSame(previous.deps, deps)) return previous.value;
      const value = factory();
      state.hookStates[index] = { deps, value };
      return value;
    },
    useEffect(effect, deps) {
      const index = state.hookIndex++;
      const previous = state.hookStates[index];
      if (previous && depsSame(previous.deps, deps)) return;
      state.pendingEffects.push({ index, effect, deps });
    },
    createElement(Component, props) {
      return typeof Component === "function" ? Component(props || {}) : null;
    },
  };

  function flushEffects() {
    const effects = state.pendingEffects.splice(0);
    for (const entry of effects) {
      const previous = state.hookStates[entry.index];
      try {
        previous?.cleanup?.();
      } catch {}
      let cleanup = null;
      try {
        const result = entry.effect();
        cleanup = typeof result === "function" ? result : null;
      } catch (error) {
        api.log.warn("Portable Feishu effect failed", error?.message || String(error));
      }
      state.hookStates[entry.index] = { deps: entry.deps, cleanup };
      if (cleanup) state.cleanups.push(cleanup);
    }
  }

  function mapPortableGlobalKeyToSettingsKey(key) {
    return {
      "feishu.enabled": "enabled",
      "feishu.mode": "mode",
      "feishu.webhook": "webhook",
      "feishu.webhook.secret": "webhookSecret",
      "feishu.app.id": "appId",
      "feishu.app.secret": "appSecret",
      "feishu.app.recipient_open_id": "appRecipientOpenId",
      "feishu.app.polling_interval_seconds": "appPollingIntervalSeconds",
      "feishu.app.direct_route_recent_conversation_limit": "appDirectRouteRecentConversationLimit",
      "feishu.app.direct_route_workspace_limit": "appDirectRouteWorkspaceLimit",
      "feishu.app.conversation_delivery_mode": "appConversationDeliveryMode",
      "feishu.group.avatar.running_data_url": "groupRunningAvatarDataUrl",
      "feishu.group.avatar.complete_data_url": "groupCompleteAvatarDataUrl",
      "feishu.group.title.show_project_name": "showProjectNameInGroupTitle",
      "feishu.debug_logging_enabled": "debugLoggingEnabled",
      "FEISHU_NOTIFICATIONS_ENABLED": "enabled",
      "FEISHU_WEBHOOK": "webhook",
      "FEISHU_WEBHOOK_SECRET": "webhookSecret",
      "feishu.app.open_id": "appRecipientOpenId",
      "feishu.app.receive_id_type": "appReceiveIdType",
    }[trimString(key)] || "";
  }

  function readCachedSettingsValue(key) {
    const settingsKey = mapPortableGlobalKeyToSettingsKey(key);
    if (!settingsKey) return undefined;
    const settings = state.settingsSnapshot && typeof state.settingsSnapshot === "object" ? state.settingsSnapshot : {};
    if (settingsKey === "mode") return settings.mode || (settings.enabled ? "app" : "off");
    if (settingsKey === "appReceiveIdType") return settings.appRecipientOpenId ? "open_id" : undefined;
    return settings[settingsKey];
  }

  function createPortableGlobalStateStore() {
    return {
      get(key) {
        return readCachedSettingsValue(key);
      },
      set(key, value) {
        const settingsKey = mapPortableGlobalKeyToSettingsKey(key);
        if (!settingsKey) return;
        state.settingsSnapshot = {
          ...(state.settingsSnapshot && typeof state.settingsSnapshot === "object" ? state.settingsSnapshot : {}),
          [settingsKey]: value,
        };
        sendPortableRawHostRequest("set-global-state", { params: { key, value } }).catch((error) => {
          api.log.warn("Portable Feishu settings write failed", error?.message || String(error));
        });
      },
      query: {
        snapshot() {
          return {
            "feishu.enabled": readCachedSettingsValue("feishu.enabled"),
            "feishu.mode": readCachedSettingsValue("feishu.mode"),
            "feishu.webhook": readCachedSettingsValue("feishu.webhook"),
            "feishu.webhook.secret": readCachedSettingsValue("feishu.webhook.secret"),
            "feishu.app.id": readCachedSettingsValue("feishu.app.id"),
            "feishu.app.secret": readCachedSettingsValue("feishu.app.secret"),
            "feishu.app.recipient_open_id": readCachedSettingsValue("feishu.app.recipient_open_id"),
            "feishu.app.polling_interval_seconds": readCachedSettingsValue("feishu.app.polling_interval_seconds"),
            "feishu.app.direct_route_recent_conversation_limit": readCachedSettingsValue("feishu.app.direct_route_recent_conversation_limit"),
            "feishu.app.direct_route_workspace_limit": readCachedSettingsValue("feishu.app.direct_route_workspace_limit"),
            "feishu.app.conversation_delivery_mode": readCachedSettingsValue("feishu.app.conversation_delivery_mode"),
            "feishu.group.avatar.running_data_url": readCachedSettingsValue("feishu.group.avatar.running_data_url"),
            "feishu.group.avatar.complete_data_url": readCachedSettingsValue("feishu.group.avatar.complete_data_url"),
            "feishu.group.title.show_project_name": readCachedSettingsValue("feishu.group.title.show_project_name"),
            "feishu.debug_logging_enabled": readCachedSettingsValue("feishu.debug_logging_enabled"),
            "FEISHU_NOTIFICATIONS_ENABLED": readCachedSettingsValue("FEISHU_NOTIFICATIONS_ENABLED"),
            "FEISHU_WEBHOOK": readCachedSettingsValue("FEISHU_WEBHOOK"),
            "FEISHU_WEBHOOK_SECRET": readCachedSettingsValue("FEISHU_WEBHOOK_SECRET"),
            "feishu.app.open_id": readCachedSettingsValue("feishu.app.open_id"),
            "feishu.app.receive_id_type": readCachedSettingsValue("feishu.app.receive_id_type"),
          };
        },
      },
    };
  }

  async function sendPortableRawHostRequest(method, payload = {}) {
    if (method === "get-global-state") {
      const key = trimString(payload?.params?.key);
      const value = readCachedSettingsValue(key);
      return { value };
    }
    if (method === "set-global-state") {
      const key = trimString(payload?.params?.key);
      const settingsKey = mapPortableGlobalKeyToSettingsKey(key);
      if (!settingsKey) return { ok: true, skipped: true };
      const next = await api.ipc.invoke("set-settings", { [settingsKey]: payload?.params?.value });
      setSettingsSnapshot(next, "set-global-state");
      return next;
    }
    return api.ipc.invoke("portable-raw-host-request", { method, payload });
  }

  function makeCloneableValue(value, seen = new WeakSet()) {
    if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "bigint") return String(value);
    if (typeof value === "function" || typeof value === "symbol" || typeof value === "undefined") return undefined;
    if (value instanceof Date) return value.toISOString();
    if (typeof value !== "object" || seen.has(value)) return undefined;
    seen.add(value);
    if (Array.isArray(value)) return value.map((item) => makeCloneableValue(item, seen) ?? null);
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      const cloneable = makeCloneableValue(item, seen);
      if (cloneable !== undefined) result[key] = cloneable;
    }
    seen.delete(value);
    return result;
  }

  function makeCloneableObject(value) {
    const cloneable = makeCloneableValue(value);
    return cloneable && typeof cloneable === "object" && !Array.isArray(cloneable) ? cloneable : {};
  }

  function summarizeStreamRoleForLog(streamRole) {
    return {
      role: typeof streamRole?.role === "string" ? streamRole.role : null,
      hasOwnerClientId: !!trimString(streamRole?.ownerClientId),
    };
  }

  async function startPortableHostConversationTurn(manager, conversationId, options = {}) {
    const normalizedConversationId = trimString(conversationId);
    if (!normalizedConversationId) throw new Error("Portable conversationId is required");
    const conversation = manager?.getConversation?.(normalizedConversationId) || null;
    const latestTurn = Array.isArray(conversation?.turns) ? conversation.turns[conversation.turns.length - 1] || null : null;
    const latestParams = latestTurn?.params && typeof latestTurn.params === "object" ? latestTurn.params : {};
    const params = {
      threadId: normalizedConversationId,
      input: Array.isArray(options.input) ? options.input : [],
      cwd: options.cwd || conversation?.cwd || manager?.getConversationCwd?.(normalizedConversationId) || null,
      approvalPolicy: latestParams.approvalPolicy ?? null,
      approvalsReviewer: typeof latestParams.approvalsReviewer === "string" ? latestParams.approvalsReviewer : "user",
      sandboxPolicy: latestParams.sandboxPolicy ?? null,
      model: null,
      serviceTier: typeof latestParams.serviceTier === "string" ? latestParams.serviceTier : null,
      effort: null,
      summary: typeof latestParams.summary === "string" ? latestParams.summary : "none",
      personality: typeof manager?.getPersonality === "function" ? manager.getPersonality() : null,
      outputSchema: options.outputSchema ?? latestParams.outputSchema ?? null,
      collaborationMode: options.collaborationMode ?? conversation?.latestCollaborationMode ?? null,
      attachments: Array.isArray(options.attachments) ? options.attachments : [],
    };
    const streamRole = typeof manager?.getStreamRole === "function" ? manager.getStreamRole(normalizedConversationId) : null;
    if (streamRole?.role === "follower") {
      if (typeof manager?.sendThreadFollowerRequest !== "function") {
        throw new Error("Codex manager does not expose sendThreadFollowerRequest for follower turn/start.");
      }
      debugLog("Portable Feishu follower turn/start forwarding", {
        conversationId: normalizedConversationId,
        streamRole: summarizeStreamRoleForLog(streamRole),
      });
      const response = await manager.sendThreadFollowerRequest(
        streamRole,
        "thread-follower-start-turn",
        {
          conversationId: normalizedConversationId,
          turnStartParams: makeCloneableObject(params),
        },
      );
      debugLog("Portable Feishu follower turn/start forwarded", {
        conversationId: normalizedConversationId,
        streamRole: summarizeStreamRoleForLog(streamRole),
        hasResult: response != null,
      });
      return response?.result ?? response;
    }
    if (typeof manager?.sendRequest !== "function") throw new Error("Codex manager does not expose sendRequest for turn/start.");
    return manager.sendRequest("turn/start", makeCloneableObject(params), { timeoutMs: 120000 });
  }

  async function steerPortableHostConversationTurn(manager, conversationId, input, restoreMessage, attachments, options = {}) {
    const normalizedConversationId = trimString(conversationId);
    const expectedTurnId = trimString(options?.expectedTurnId);
    if (!normalizedConversationId) throw new Error("Portable conversationId is required");
    if (!expectedTurnId) throw new Error("Portable expectedTurnId is required for turn/steer.");
    if (typeof manager?.sendRequest !== "function") throw new Error("Codex manager does not expose sendRequest for turn/steer.");
    return manager.sendRequest(
      "turn/steer",
      makeCloneableObject({ threadId: normalizedConversationId, expectedTurnId, input, restoreMessage, attachments }),
      { timeoutMs: 120000 },
    );
  }

  function parseStaleRolloutPathError(error) {
    const message = error?.message || String(error || "");
    const match = message.match(/cannot resume running thread\s+([^\s]+)\s+with stale path: requested `([^`]+)`, active `([^`]+)`/);
    if (!match) return null;
    return {
      conversationId: trimString(match[1]),
      requestedPath: trimString(match[2]),
      activePath: trimString(match[3]),
    };
  }

  function normalizeRolloutPathForCompare(value) {
    let path = trimString(value);
    if (path.startsWith("\\\\?\\")) path = path.slice(4);
    if (path.startsWith("//?/")) path = path.slice(4);
    return path.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
  }

  function canRetryStaleRolloutPath(errorInfo, conversationId) {
    return (
      errorInfo &&
      errorInfo.conversationId === conversationId &&
      errorInfo.requestedPath &&
      errorInfo.activePath &&
      normalizeRolloutPathForCompare(errorInfo.requestedPath) === normalizeRolloutPathForCompare(errorInfo.activePath)
    );
  }

  async function ensurePortableHostConversationReady(manager, options = {}) {
    const conversationId = trimString(options.conversationId);
    if (!conversationId || typeof manager?.resumeConversationForUnavailableOwner !== "function") return null;
    const resumeOptions = {
      conversationId,
      model: options.model ?? null,
      serviceTier: options.serviceTier,
      reasoningEffort: options.reasoningEffort ?? null,
      workspaceRoots: Array.isArray(options.workspaceRoots) ? options.workspaceRoots : [],
      collaborationMode: options.collaborationMode ?? null,
    };
    try {
      return await manager.resumeConversationForUnavailableOwner(resumeOptions);
    } catch (error) {
      const stalePath = parseStaleRolloutPathError(error);
      if (!canRetryStaleRolloutPath(stalePath, conversationId) || typeof manager?.updateConversationState !== "function") {
        throw error;
      }
      debugLog("Portable Feishu retrying resume with active rollout path", {
        conversationId,
        requestedHadLongPathPrefix: stalePath.requestedPath.startsWith("\\\\?\\"),
        activeHadLongPathPrefix: stalePath.activePath.startsWith("\\\\?\\"),
      });
      manager.updateConversationState(conversationId, (conversation) => {
        conversation.rolloutPath = stalePath.activePath;
      });
      return manager.resumeConversationForUnavailableOwner(resumeOptions);
    }
  }

  async function sendMessageFromView(message = {}) {
    if (message?.type !== "mcp-request") {
      api.log.warn("Portable Feishu ignored unsupported view message", message?.type || "");
      return;
    }
    const request = message.request && typeof message.request === "object" ? message.request : {};
    const requestId = trimString(request.id);
    const method = trimString(request.method);
    const manager = createRegistryShim().getImplForHostId(message.hostId || "local") || getPrimaryManager();
    const respond = (payload) => {
      try {
        window.postMessage({
          type: "mcp-response",
          message: {
            id: requestId,
            ...payload,
          },
        }, "*");
      } catch (error) {
        api.log.warn("Portable Feishu MCP response post failed", error?.message || String(error));
      }
    };
    if (!requestId || !method) {
      respond({ error: { message: "Portable MCP request is missing id or method." } });
      return;
    }
    if (!manager || typeof manager.sendRequest !== "function") {
      respond({ error: { message: "Codex manager does not expose sendRequest for portable MCP." } });
      return;
    }
    try {
      debugLog("Portable Feishu MCP request", { method, hostId: message.hostId || "local" });
      const result = await manager.sendRequest(method, makeCloneableObject(request.params), { timeoutMs: 120000 });
      respond({ result });
    } catch (error) {
      respond({ error: { message: error?.message || String(error) } });
    }
  }

  function renderPlugins() {
    if (state.disposed) return;
    state.renderCount += 1;
    state.hookIndex = 0;
    state.pendingEffects = [];
    ensureManagersAndRegistriesDiscovered(false, "render-plugins");
    for (const plugin of state.mountedPlugins) {
      try {
        plugin.Component();
      } catch (error) {
        api.log.warn("Portable Feishu plugin render failed", plugin.id, error?.message || String(error));
      }
    }
    flushEffects();
  }

  function installElectronBridgeShim() {
    const existing = window.electronBridge && typeof window.electronBridge === "object" ? window.electronBridge : {};
    const portableHostInvoke = (payload) => api.ipc.invoke("portable-host-invoke", payload);
    const portableBridge = {
      portableHostInvoke,
      sendMessageFromView,
    };
    window.__codexppPortableElectronBridge = portableBridge;
    try {
      existing.portableHostInvoke = portableHostInvoke;
      existing.sendMessageFromView = sendMessageFromView;
      if (typeof existing.portableHostInvoke === "function") {
        window.electronBridge = existing;
        debugLog("Portable Feishu electronBridge shim installed", {
          globalBridge: typeof window.__codexppPortableElectronBridge?.portableHostInvoke,
          electronBridge: typeof window.electronBridge?.portableHostInvoke,
        });
        return;
      }
    } catch {}
    const wrapper = Object.create(existing);
    Object.defineProperty(wrapper, "portableHostInvoke", {
      configurable: true,
      enumerable: true,
      value: portableHostInvoke,
      writable: true,
    });
    Object.defineProperty(wrapper, "sendMessageFromView", {
      configurable: true,
      enumerable: true,
      value: sendMessageFromView,
      writable: true,
    });
    try {
      window.electronBridge = wrapper;
    } catch {
      try {
        Object.defineProperty(window, "electronBridge", {
          configurable: true,
          value: wrapper,
        });
      } catch {}
    }
    debugLog("Portable Feishu electronBridge shim installed", {
      globalBridge: typeof window.__codexppPortableElectronBridge?.portableHostInvoke,
      electronBridge: typeof window.electronBridge?.portableHostInvoke,
    });
  }

  async function startAsync() {
    installElectronBridgeShim();
    await refreshSettingsSnapshot("startup").catch((error) => {
      api.log.warn("Portable Feishu settings snapshot failed", error?.message || String(error));
      setSettingsSnapshot({}, "startup-failed");
    });
    const onSettingsChanged = (event) => {
      setSettingsSnapshot(event?.detail, "settings-changed-event");
      scheduleRender();
    };
    window.addEventListener("codexpp-feishu-settings-changed", onSettingsChanged);
    state.cleanups.push(() => {
      window.removeEventListener("codexpp-feishu-settings-changed", onSettingsChanged);
    });
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
    preloadEmbeddedModuleFactories(portableFiles);
    await preloadModules(portableFiles);
    const host = state.modules.get("portable-host-request-compat.js").exports;
    host.installPortableHostBridge({
      React: ReactShim,
      JSX: { jsx: (Component, props) => ReactShim.createElement(Component, props), jsxs: (Component, props) => ReactShim.createElement(Component, props) },
      SettingsGroup: () => null,
      SettingsRow: () => null,
      Toggle: () => null,
      createPortal: () => null,
      useGlobalState: (key) => readCachedSettingsValue(key),
      useAppServerManager: () => getPrimaryManager(),
      useAppServerRegistry: () => createRegistryShim(),
      sendPortableAppServerRequest: (method, payload) => api.ipc.invoke("portable-appserver-request", { method, payload }),
      nativeRequest: {
        safePost(path, options) {
          return api.ipc.invoke("portable-native-request", { method: "POST", path, options });
        },
        safeGet(path, options) {
          return api.ipc.invoke("portable-native-request", { method: "GET", path, options });
        },
      },
      portableAppServerRequestBus: {},
      usePortableIntl: () => ({ formatMessage: (message) => message?.defaultMessage || message?.id || "" }),
      getPortableProjectName: () => "Codex++",
      usePortableSettingsHostSelection: () => ({ hostId: "local" }),
      getPortableGeneralSettingsComponent: () => null,
      getPortableSettingsContentLayoutComponent: () => null,
      describePortableGlobalStateCandidates: () => "codexplusplus-storage",
      resolvePortableGlobalStateScope: () => ({ id: "codexplusplus-feishu-settings" }),
      resolvePortableGlobalStateStoreHook: () => () => createPortableGlobalStateStore(),
      writePortableHostGlobalStateValue: (_store, key, value) => sendPortableRawHostRequest("set-global-state", { params: { key, value } }),
      sendPortableRawHostRequest,
      ensurePortableHostConversationReady,
      startPortableHostConversationTurn,
      steerPortableHostConversationTurn,
    });
    state.mountedPlugins = host.listPortableBridgePlugins().filter((plugin) => plugin.id === "portable-feishu-notifications");
    debugLog("Portable Feishu upstream bridge loaded", state.mountedPlugins.map((plugin) => plugin.id).join(","));
    renderPlugins();
    return () => {
      state.disposed = true;
      clearDiscoveryRetry();
      for (const cleanup of state.cleanups.splice(0)) {
        try {
          cleanup();
        } catch {}
      }
    };
  }

  function start() {
    let disposeInner = null;
    startAsync().then((dispose) => {
      disposeInner = typeof dispose === "function" ? dispose : null;
    }).catch((error) => {
      api.log.warn("Portable Feishu upstream bridge failed", error?.message || String(error));
    });
    return () => {
      state.disposed = true;
      try {
        disposeInner?.();
      } catch {}
    };
  }

  return { start };
}

function createPortableRendererAppServer(api) {
  return createPortableBrowserEntry(api);
}

module.exports = {
  createPortableBrowserEntry,
  createRendererAppServer: createPortableRendererAppServer,
};
