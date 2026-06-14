"use strict";

const SIDEBAR_TOGGLE_ANCHOR_SELECTOR =
  "[data-portable-feishu-sidebar-toggle-anchor='true']";
const NODE_KEY = "__codexppFeishuSidebarToggle";
const INSTANCE_KEY = "__codexppFeishuSidebarToggleInstance";
const MOUNT_RETRY_MS = 60000;
const MOUNT_THROTTLE_MS = 250;

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

function startSidebarToggle(api) {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return () => {};
  }

  try {
    const previousDispose = window[INSTANCE_KEY];
    if (typeof previousDispose === "function") {
      previousDispose();
    }
  } catch {}

  let disposed = false;
  let mounted = null;
  let currentEnabled = false;
  let mountRetryTimer = null;
  let mountThrottleTimer = null;
  let lastMountLogKey = "";

  async function refresh() {
    try {
      const settings = await api.ipc.invoke("get-settings");
      if (disposed) return;
      currentEnabled = settings?.enabled === true;
      if (mounted) paint(mounted, currentEnabled);
    } catch (error) {
      api.log.warn("Feishu sidebar toggle refresh failed", error?.message || String(error));
    }
  }

  async function setEnabled(nextEnabled) {
    const previous = currentEnabled;
    currentEnabled = nextEnabled;
    if (mounted) paint(mounted, currentEnabled, true);
    try {
      const settings = await api.ipc.invoke("set-settings", { enabled: nextEnabled });
      currentEnabled = settings?.enabled === true;
      api.storage.set("settings", settings);
      window.dispatchEvent(
        new CustomEvent("codexpp-feishu-settings-changed", { detail: settings }),
      );
      if (mounted) paint(mounted, currentEnabled, false);
    } catch (error) {
      currentEnabled = previous;
      if (mounted) paint(mounted, currentEnabled, false);
      api.log.warn("Feishu sidebar toggle save failed", error?.message || String(error));
    }
  }

  function scheduleMount() {
    if (disposed || mountThrottleTimer) return;
    mountThrottleTimer = window.setTimeout(() => {
      mountThrottleTimer = null;
      mount();
    }, MOUNT_THROTTLE_MS);
  }

  function hasConnectedMount() {
    return Boolean(
      mounted &&
      mounted.container?.isConnected &&
      mounted.anchor?.isConnected,
    );
  }

  function nodeCouldAffectToggle(node) {
    if (!(node instanceof HTMLElement)) return false;
    if (node.matches?.(SIDEBAR_TOGGLE_ANCHOR_SELECTOR)) return true;
    if (node.querySelector?.(SIDEBAR_TOGGLE_ANCHOR_SELECTOR)) return true;

    if (
      node.matches?.("button, a, [role='button'], [aria-label]") &&
      isMainSidebarSettingsControl(node)
    ) {
      return true;
    }

    const controls = node.querySelectorAll?.("button, a, [role='button'], [aria-label]");
    if (!controls?.length) return false;
    for (const control of controls) {
      if (isMainSidebarSettingsControl(control)) {
        return true;
      }
    }
    return false;
  }

  function mutationCouldAffectToggle(mutations) {
    if (!Array.isArray(mutations) || mutations.length === 0) {
      return !hasConnectedMount();
    }

    if (!hasConnectedMount()) {
      return true;
    }

    for (const mutation of mutations) {
      for (const node of mutation.addedNodes || []) {
        if (nodeCouldAffectToggle(node)) return true;
      }
      for (const node of mutation.removedNodes || []) {
        if (node === mounted?.container || node === mounted?.anchor) return true;
        if (nodeCouldAffectToggle(node)) return true;
      }
    }
    return false;
  }

  function mount() {
    if (disposed) return;
    const target = findToggleTarget();
    if (!target?.anchor) {
      logMountState("missing-anchor");
      removeMounted();
      return;
    }
    const { anchor, control, insertAfter, placement } = target;

    if (
      mounted?.anchor === anchor &&
      mounted?.control === control &&
      mounted?.placement === placement &&
      mounted.container.isConnected
    ) {
      paint(mounted, currentEnabled);
      logMountState("mounted");
      return;
    }

    removeMounted();
    const toggle = createToggleElement();
    mounted = { anchor, control, placement, ...toggle };
    anchor[NODE_KEY] = mounted;

    if (placement === "inline-row") {
      mountInlineRow(mounted, insertAfter);
    } else if (insertAfter?.parentElement === anchor) {
      anchor.insertBefore(toggle.container, insertAfter.nextSibling);
    } else if (anchor.matches?.(SIDEBAR_TOGGLE_ANCHOR_SELECTOR)) {
      anchor.appendChild(toggle.container);
    } else {
      anchor.appendChild(toggle.container);
    }

    toggle.button.addEventListener("click", () => {
      if (toggle.button.disabled) return;
      void setEnabled(!currentEnabled);
    });
    paint(mounted, currentEnabled);
    logMountState("mounted");
  }

  function mountInlineRow(toggle, settingsNode) {
    if (!(settingsNode instanceof HTMLElement) || settingsNode.parentElement !== toggle.anchor) {
      toggle.anchor.appendChild(toggle.container);
      return;
    }

    const anchorStyle = window.getComputedStyle(toggle.anchor);
    const useContentsWrapper =
      anchorStyle.display === "flex" &&
      (!anchorStyle.flexDirection || anchorStyle.flexDirection.startsWith("row"));
    const wrapper = document.createElement("div");
    wrapper.dataset.codexppFeishuSidebarToggleRow = "true";
    if (useContentsWrapper) {
      wrapper.className = "contents";
      wrapper.style.display = "contents";
    } else {
      wrapper.className = "flex min-w-0 w-full items-center gap-2";
      wrapper.style.display = "flex";
      wrapper.style.alignItems = "center";
      wrapper.style.gap = "8px";
      wrapper.style.width = "100%";
      wrapper.style.minWidth = "0";
      wrapper.style.maxWidth = "100%";
      wrapper.style.boxSizing = "border-box";
    }

    toggle.movedNode = settingsNode;
    toggle.wrapper = wrapper;
    toggle.movedNodeStyle = {
      alignSelf: settingsNode.style.alignSelf,
      flex: settingsNode.style.flex,
      maxWidth: settingsNode.style.maxWidth,
      minWidth: settingsNode.style.minWidth,
      width: settingsNode.style.width,
    };

    settingsNode.style.alignSelf = "center";
    settingsNode.style.flex = useContentsWrapper ? "0 0 auto" : "1 1 0";
    settingsNode.style.maxWidth = useContentsWrapper ? "" : "100%";
    settingsNode.style.minWidth = "0";
    settingsNode.style.width = "auto";
    toggle.container.style.flex = "0 0 auto";
    toggle.container.style.maxWidth = "max-content";

    toggle.anchor.insertBefore(wrapper, settingsNode);
    wrapper.appendChild(settingsNode);
    wrapper.appendChild(toggle.container);
  }

  function logMountState(state) {
    if (lastMountLogKey === state) return;
    lastMountLogKey = state;
    try {
      if (api.storage.get("settings", {})?.debugLoggingEnabled === true) {
        api.log.info("Feishu sidebar toggle mount state", { state });
      }
    } catch {}
  }

  function removeMounted() {
    if (!mounted) return;
    try {
      if (mounted.anchor?.[NODE_KEY] === mounted) {
        delete mounted.anchor[NODE_KEY];
      }
    } catch {}
    try {
      restoreMovedNode(mounted);
    } catch {}
    try {
      mounted.container.remove();
    } catch {}
    mounted = null;
  }

  function restoreMovedNode(toggle) {
    if (!toggle?.wrapper || !toggle?.movedNode || !(toggle.anchor instanceof HTMLElement)) {
      return;
    }
    const movedNode = toggle.movedNode;
    const style = toggle.movedNodeStyle || {};
    movedNode.style.alignSelf = style.alignSelf || "";
    movedNode.style.flex = style.flex || "";
    movedNode.style.maxWidth = style.maxWidth || "";
    movedNode.style.minWidth = style.minWidth || "";
    movedNode.style.width = style.width || "";
    if (toggle.wrapper.parentElement === toggle.anchor) {
      toggle.anchor.insertBefore(movedNode, toggle.wrapper);
      toggle.wrapper.remove();
    }
  }

  function onSettingsChanged(event) {
    const settings = event?.detail;
    if (!settings || typeof settings !== "object") return;
    currentEnabled = settings.enabled === true;
    if (mounted) paint(mounted, currentEnabled);
    scheduleMount();
  }

  const observer = new MutationObserver((mutations) => {
    if (!mutationCouldAffectToggle(mutations)) return;
    scheduleMount();
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }

  mount();
  void refresh();
  window.addEventListener("codexpp-feishu-settings-changed", onSettingsChanged);
  window.addEventListener("focus", scheduleMount);
  document.addEventListener("visibilitychange", scheduleMount);
  mountRetryTimer = window.setInterval(() => {
    if (!hasConnectedMount()) {
      mount();
    }
  }, MOUNT_RETRY_MS);

  const dispose = () => {
    disposed = true;
    observer.disconnect();
    window.removeEventListener("codexpp-feishu-settings-changed", onSettingsChanged);
    window.removeEventListener("focus", scheduleMount);
    document.removeEventListener("visibilitychange", scheduleMount);
    if (mountThrottleTimer) window.clearTimeout(mountThrottleTimer);
    if (mountRetryTimer) window.clearInterval(mountRetryTimer);
    removeMounted();
    try {
      if (window[INSTANCE_KEY] === dispose) {
        delete window[INSTANCE_KEY];
      }
    } catch {}
  };
  window[INSTANCE_KEY] = dispose;
  return dispose;
}

function findToggleTarget() {
  const portableAnchor = document.querySelector(SIDEBAR_TOGGLE_ANCHOR_SELECTOR);
  if (portableAnchor) return { anchor: portableAnchor, control: null, insertAfter: null, placement: "anchor" };
  return findSettingsFooterTarget();
}

function findSettingsFooterTarget() {
  const controls = Array.from(
    document.querySelectorAll("button, a, [role='button'], [aria-label]"),
  );
  const settingsControls = controls.filter(isMainSidebarSettingsControl);
  if (settingsControls.length === 0) return null;

  const ranked = settingsControls
    .map((control) => {
      const group = findControlButtonGroup(control);
      return group ? { control, group, score: scoreFooterGroup(group) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best) return null;
  return {
    anchor: best.group,
    control: best.control,
    insertAfter: directChildOf(best.control, best.group),
    placement: "inline-row",
  };
}

function directChildOf(descendant, ancestor) {
  let node = descendant;
  while (node?.parentElement && node.parentElement !== ancestor) {
    node = node.parentElement;
  }
  return node?.parentElement === ancestor ? node : descendant;
}

function isMainSidebarSettingsControl(control) {
  if (!(control instanceof HTMLElement)) return false;
  if (!control.isConnected || !isVisible(control)) return false;
  if (isInsideSettingsSurface(control)) return false;

  const label = [
    control.getAttribute("aria-label"),
    control.getAttribute("title"),
    control.textContent,
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (!label) return false;
  if (!/(^|\s)(settings)(\s|$)/i.test(label) && !label.includes("设置")) return false;

  const rect = control.getBoundingClientRect();
  if (rect.width < 18 || rect.height < 18) return false;
  if (rect.left > Math.max(420, window.innerWidth * 0.45)) return false;
  if (rect.top < window.innerHeight * 0.45) return false;
  return true;
}

function isInsideSettingsSurface(el) {
  return Boolean(el.closest("[data-codexpp-settings-root], [data-codexpp-settings-search]"));
}

function findControlButtonGroup(control) {
  let node = control.parentElement;
  while (node && node !== document.body) {
    if (!(node instanceof HTMLElement)) break;
    if (node.dataset?.codexppFeishuSidebarToggleRow === "true") {
      node = node.parentElement;
      continue;
    }
    const rect = node.getBoundingClientRect();
    const controlCount = Array.from(node.querySelectorAll("button, a, [role='button']"))
      .filter((item) => !item.closest("[data-codexpp-feishu-sidebar-toggle='true']")).length;
    const className = String(node.className || "");
    const looksLikeFooterGroup =
      controlCount >= 1 &&
      controlCount <= 5 &&
      rect.width > 48 &&
      rect.width < 420 &&
      rect.height >= 24 &&
      rect.height < 96 &&
      /flex|items-center|gap/.test(className);
    if (looksLikeFooterGroup) return node;
    node = node.parentElement;
  }
  return null;
}

function scoreFooterGroup(group) {
  const rect = group.getBoundingClientRect();
  let score = 0;
  score += Math.max(0, rect.top);
  if (rect.left < 360) score += 500;
  if (rect.top > window.innerHeight * 0.65) score += 500;
  if (/flex/.test(String(group.className || ""))) score += 50;
  return score;
}

function isVisible(el) {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = window.getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0;
}

function createToggleElement() {
  const container = document.createElement("div");
  container.dataset.codexppFeishuSidebarToggle = "true";
  container.className =
    "flex h-full shrink-0 items-center gap-2 rounded-lg px-2 text-sm text-token-text-secondary";

  const label = document.createElement("span");
  label.className = "font-medium text-inherit leading-none";
  label.textContent = t("label");

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
    "h-4 w-4 rounded-full border border-[color:var(--gray-0)] bg-[color:var(--gray-0)] shadow-sm transition-transform duration-200 ease-out";

  track.appendChild(thumb);
  button.appendChild(track);
  container.append(label, button);

  return { container, button, track, thumb };
}

function paint(toggle, enabled, pending = false) {
  const state = enabled ? "checked" : "unchecked";
  toggle.button.disabled = pending;
  toggle.button.setAttribute("aria-checked", String(enabled));
  toggle.button.setAttribute("aria-label", enabled ? t("disable") : t("enable"));
  toggle.button.dataset.state = state;
  toggle.track.dataset.state = state;
  toggle.thumb.dataset.state = state;
  toggle.track.className = [
    "relative inline-flex h-5 w-8 shrink-0 items-center rounded-full transition-colors duration-200 ease-out",
    enabled ? "bg-token-charts-blue" : "bg-token-foreground/10",
    pending ? "opacity-70" : "",
  ].join(" ");
  toggle.thumb.style.transform = enabled ? "translateX(14px)" : "translateX(2px)";
}

module.exports = { startSidebarToggle };
