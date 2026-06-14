"use strict";

const {
  resolveFeishuImageAttachment,
  uploadFeishuAppImage,
} = require("./feishu-api.js");
const {
  DEFAULT_SETTINGS,
  resolveFeishuSettings,
  trimString,
} = require("./feishu-utils.js");

const PORTABLE_FEISHU_BINDINGS_STORAGE_KEY = "codex-portable-feishu-bindings-v1";

function toPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function createMainRuntime(api) {
  function getSettings() {
    return resolveFeishuSettings(api.storage.get("settings", DEFAULT_SETTINGS));
  }

  function setSettings(patch) {
    const current = api.storage.get("settings", DEFAULT_SETTINGS);
    const next = {
      ...DEFAULT_SETTINGS,
      ...toPlainObject(current),
      ...toPlainObject(patch),
    };
    api.storage.set("settings", next);
    return resolveFeishuSettings(next);
  }

  function getBindings() {
    const state = toPlainObject(api.storage.get("portableRuntimeState", {}));
    const bindings = toPlainObject(state[PORTABLE_FEISHU_BINDINGS_STORAGE_KEY]);
    return { bindings };
  }

  async function resolveImage(request = {}) {
    const settings = getSettings();
    if (!settings.isAppReady) throw new Error("Feishu app is not configured.");
    return resolveFeishuImageAttachment(settings, request.imageRef);
  }

  async function uploadImage(request = {}) {
    const settings = getSettings();
    if (!settings.isAppReady) throw new Error("Feishu app is not configured.");
    return uploadFeishuAppImage(settings, {
      ...toPlainObject(request.imageSource),
      imageType: trimString(request.imageType),
    });
  }

  function dispose() {}

  return {
    dispose,
    getBindings,
    getSettings,
    resolveImage,
    setSettings,
    uploadImage,
  };
}

module.exports = { createMainRuntime };
