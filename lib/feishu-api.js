"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const {
  extractFeishuResponseMessageIds,
  normalizeNotificationBodyText,
  normalizeNotificationSourceText,
  sanitizeNotificationText,
  trimString,
} = require("./feishu-utils.js");

const TOKEN_CACHE = new Map();

async function fetchJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      throw new Error(`Feishu JSON response parse failed: ${error.message || String(error)}`);
    }
  }
  if (!response.ok) {
    throw new Error(`Feishu request failed (${response.status}): ${text.slice(0, 1000)}`);
  }
  if (data != null && typeof data.code === "number" && data.code !== 0) {
    throw new Error(`Feishu request failed: ${data.msg || JSON.stringify(data)}`);
  }
  return data;
}

function shouldUseFeishuPost(text) {
  const normalized = normalizeNotificationSourceText(text);
  if (!normalized) return false;
  return (
    normalized.includes("\n") ||
    /```|`[^`\n]+`|\*\*[^*\n]+\*\*|^#{1,6}\s|^\d+\.\s|^[-*•]\s|^>\s/m.test(normalized)
  );
}

function buildFeishuPostContent(text, options = {}) {
  const normalized = normalizeNotificationSourceText(text);
  const title = sanitizeNotificationText(options.title);
  if (!normalized || !title) return null;
  return {
    title,
    content: [[{ tag: "md", text: normalized }]],
  };
}

function buildAppNotificationPayload(text, options = {}) {
  if (!shouldUseFeishuPost(text)) {
    return {
      msg_type: "text",
      content: JSON.stringify({ text: normalizeNotificationBodyText(text) }),
    };
  }
  const post = buildFeishuPostContent(text, options);
  if (!post) {
    return {
      msg_type: "text",
      content: JSON.stringify({ text: normalizeNotificationBodyText(text) }),
    };
  }
  return {
    msg_type: "post",
    content: JSON.stringify({ zh_cn: post }),
  };
}

async function getTenantAccessToken(settings) {
  const cacheKey = `${settings.appId}:${settings.appSecret}`;
  const cached = TOKEN_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const data = await fetchJson(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        app_id: settings.appId,
        app_secret: settings.appSecret,
      }),
    },
  );
  const token = trimString(data?.tenant_access_token);
  if (!token) throw new Error("Feishu tenant access token missing.");
  TOKEN_CACHE.set(cacheKey, {
    token,
    expiresAt: Date.now() + (Number(data?.expire) || 7200) * 1000,
  });
  return token;
}

function resolveAppRecipient(settings) {
  if (trimString(settings.appRecipientOpenId)) {
    return { receiveIdType: "open_id", receiveId: settings.appRecipientOpenId };
  }
  throw new Error("Feishu app recipient Open ID is not configured.");
}

async function createAuthorizedRequest(path, settings, body, method = "POST") {
  const token = await getTenantAccessToken(settings);
  return fetchJson(`https://open.feishu.cn/${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
}

function buildAppCardPayload(card) {
  return {
    msg_type: "interactive",
    content: JSON.stringify(card),
  };
}

async function createAppGroupChat(settings, options = {}) {
  const name = sanitizeNotificationText(options.name || "Codex Conversation");
  const userOpenId = trimString(options.userOpenId || settings.appRecipientOpenId);
  if (!name) throw new Error("Feishu group name is missing.");
  if (!userOpenId) throw new Error("Feishu group member Open ID is missing.");
  const data = await createAuthorizedRequest(
    "open-apis/im/v1/chats?user_id_type=open_id&set_bot_manager=true",
    settings,
    {
      name,
      chat_mode: "group",
      chat_type: "private",
      user_id_list: [userOpenId],
    },
  );
  return {
    chatId: trimString(data?.data?.chat_id),
    name: trimString(data?.data?.name) || name,
  };
}

async function updateAppGroupChat(settings, chatId, patch = {}) {
  const normalizedChatId = trimString(chatId);
  if (!normalizedChatId) throw new Error("Feishu group chat id is missing.");
  const body = {};
  if (trimString(patch.name)) body.name = sanitizeNotificationText(patch.name);
  if (trimString(patch.avatar)) body.avatar = trimString(patch.avatar);
  if (Object.keys(body).length === 0) return { chatId: normalizedChatId };
  const data = await createAuthorizedRequest(
    `open-apis/im/v1/chats/${encodeURIComponent(normalizedChatId)}?user_id_type=open_id`,
    settings,
    body,
    "PUT",
  );
  return {
    chatId: normalizedChatId,
    name: trimString(data?.data?.name || body.name),
    avatar: trimString(data?.data?.avatar || body.avatar),
  };
}

async function createAppGroupShareLink(settings, chatId) {
  const normalizedChatId = trimString(chatId);
  if (!normalizedChatId) throw new Error("Feishu group chat id is missing.");
  const data = await createAuthorizedRequest(
    `open-apis/im/v1/chats/${encodeURIComponent(normalizedChatId)}/link`,
    settings,
    {},
  );
  return {
    chatId: normalizedChatId,
    shareLink: trimString(data?.data?.share_link),
    expireTime: trimString(data?.data?.expire_time),
    isPermanent: data?.data?.is_permanent === true,
  };
}

async function sendAppPayloadToChat(settings, chatId, payload) {
  const normalizedChatId = trimString(chatId);
  if (!normalizedChatId) throw new Error("Feishu group chat id is missing.");
  const data = await createAuthorizedRequest(
    "open-apis/im/v1/messages?receive_id_type=chat_id",
    settings,
    {
      receive_id: normalizedChatId,
      ...payload,
    },
  );
  return {
    messageId: trimString(data?.data?.message_id),
    chatId: trimString(data?.data?.chat_id),
    relatedMessageIds: extractFeishuResponseMessageIds(data),
  };
}

async function sendAppCardNotification(settings, card) {
  const recipient = resolveAppRecipient(settings);
  const path = `open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(
    recipient.receiveIdType,
  )}`;
  const data = await createAuthorizedRequest(path, settings, {
    receive_id: recipient.receiveId,
    ...buildAppCardPayload(card),
  });
  return {
    messageId: trimString(data?.data?.message_id),
    chatId: trimString(data?.data?.chat_id),
    relatedMessageIds: extractFeishuResponseMessageIds(data),
  };
}

async function sendAppCardToChat(settings, chatId, card) {
  return sendAppPayloadToChat(settings, chatId, buildAppCardPayload(card));
}

function buildAppCardKitReferencePayload(cardId) {
  return {
    msg_type: "interactive",
    content: JSON.stringify({
      type: "card",
      data: { card_id: cardId },
    }),
  };
}

async function createAppCardKitCard(settings, card) {
  const data = await createAuthorizedRequest("open-apis/cardkit/v1/cards", settings, {
    type: "card_json",
    data: JSON.stringify(card),
  });
  return {
    cardId: trimString(data?.data?.card_id || data?.card_id),
  };
}

async function sendAppCardKitNotification(settings, cardId) {
  const recipient = resolveAppRecipient(settings);
  const path = `open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(
    recipient.receiveIdType,
  )}`;
  const data = await createAuthorizedRequest(path, settings, {
    receive_id: recipient.receiveId,
    ...buildAppCardKitReferencePayload(cardId),
  });
  return {
    messageId: trimString(data?.data?.message_id),
    chatId: trimString(data?.data?.chat_id),
    relatedMessageIds: extractFeishuResponseMessageIds(data),
  };
}

async function sendAppCardKitToChat(settings, chatId, cardId) {
  return sendAppPayloadToChat(settings, chatId, buildAppCardKitReferencePayload(cardId));
}

async function replyAppCardKitNotification(settings, messageId, cardId) {
  const path = `open-apis/im/v1/messages/${encodeURIComponent(messageId)}/reply`;
  const data = await createAuthorizedRequest(path, settings, buildAppCardKitReferencePayload(cardId));
  return {
    messageId: trimString(data?.data?.message_id),
    chatId: trimString(data?.data?.chat_id),
    relatedMessageIds: extractFeishuResponseMessageIds(data),
  };
}

async function streamAppCardKitElement(settings, cardId, elementId, content, sequence) {
  await createAuthorizedRequest(
    `open-apis/cardkit/v1/cards/${encodeURIComponent(cardId)}/elements/${encodeURIComponent(
      elementId,
    )}/content`,
    settings,
    { content, sequence },
    "PUT",
  );
  return { ok: true, cardId, sequence };
}

async function updateAppCardKitCard(settings, cardId, card, sequence) {
  await createAuthorizedRequest(
    `open-apis/cardkit/v1/cards/${encodeURIComponent(cardId)}`,
    settings,
    {
      card: {
        type: "card_json",
        data: JSON.stringify(card),
      },
      sequence,
    },
    "PUT",
  );
  return { ok: true, cardId, sequence };
}

async function setAppCardKitStreamingMode(settings, cardId, streamingMode, sequence) {
  await createAuthorizedRequest(
    `open-apis/cardkit/v1/cards/${encodeURIComponent(cardId)}/settings`,
    settings,
    {
      settings: JSON.stringify({ streaming_mode: streamingMode === true }),
      sequence,
    },
    "PATCH",
  );
  return { ok: true, cardId, sequence };
}

async function replyAppCardNotification(settings, messageId, card) {
  const path = `open-apis/im/v1/messages/${encodeURIComponent(messageId)}/reply`;
  const data = await createAuthorizedRequest(path, settings, buildAppCardPayload(card));
  return {
    messageId: trimString(data?.data?.message_id),
    chatId: trimString(data?.data?.chat_id),
    relatedMessageIds: extractFeishuResponseMessageIds(data),
  };
}

async function updateAppCardNotification(settings, messageId, card) {
  const normalizedMessageId = trimString(messageId);
  if (!normalizedMessageId) throw new Error("Feishu card message id is missing.");
  await createAuthorizedRequest(
    `open-apis/im/v1/messages/${encodeURIComponent(normalizedMessageId)}`,
    settings,
    { content: JSON.stringify(card) },
    "PATCH",
  );
  return { messageId: normalizedMessageId, chatId: "" };
}

async function deleteAppMessage(settings, messageId) {
  const normalizedMessageId = trimString(messageId);
  if (!normalizedMessageId) throw new Error("Feishu message id is missing.");
  await createAuthorizedRequest(
    `open-apis/im/v1/messages/${encodeURIComponent(normalizedMessageId)}`,
    settings,
    null,
    "DELETE",
  );
  return { ok: true, messageId: normalizedMessageId };
}

async function getAppMessage(settings, messageId) {
  const normalizedMessageId = trimString(messageId);
  if (!normalizedMessageId) throw new Error("Feishu message id is missing.");
  const data = await createAuthorizedRequest(
    `open-apis/im/v1/messages/${encodeURIComponent(normalizedMessageId)}`,
    settings,
    null,
    "GET",
  );
  return parseFeishuChatMessage(data?.data?.items?.[0] || data?.data || data);
}

async function sendAppTextNotification(settings, text, options = {}) {
  const recipient = resolveAppRecipient(settings);
  const path = `open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(
    recipient.receiveIdType,
  )}`;
  const richPayload = {
    receive_id: recipient.receiveId,
    ...buildAppNotificationPayload(text, options),
  };
  let data;
  try {
    data = await createAuthorizedRequest(path, settings, richPayload);
  } catch (error) {
    if (richPayload.msg_type !== "post") throw error;
    data = await createAuthorizedRequest(path, settings, {
      receive_id: recipient.receiveId,
      msg_type: "text",
      content: JSON.stringify({ text: normalizeNotificationBodyText(text) }),
    });
  }
  return {
    messageId: trimString(data?.data?.message_id),
    chatId: trimString(data?.data?.chat_id),
    relatedMessageIds: extractFeishuResponseMessageIds(data),
  };
}

async function sendAppTextToChat(settings, chatId, text, options = {}) {
  const richPayload = buildAppNotificationPayload(text, options);
  try {
    return await sendAppPayloadToChat(settings, chatId, richPayload);
  } catch (error) {
    if (richPayload.msg_type !== "post") throw error;
    return sendAppPayloadToChat(settings, chatId, {
      msg_type: "text",
      content: JSON.stringify({ text: normalizeNotificationBodyText(text) }),
    });
  }
}

async function replyAppTextNotification(settings, messageId, text, options = {}) {
  const path = `open-apis/im/v1/messages/${encodeURIComponent(messageId)}/reply`;
  const richPayload = buildAppNotificationPayload(text, options);
  let data;
  try {
    data = await createAuthorizedRequest(path, settings, richPayload);
  } catch (error) {
    if (richPayload.msg_type !== "post") throw error;
    data = await createAuthorizedRequest(path, settings, {
      msg_type: "text",
      content: JSON.stringify({ text: normalizeNotificationBodyText(text) }),
    });
  }
  return {
    messageId: trimString(data?.data?.message_id),
    chatId: trimString(data?.data?.chat_id),
    relatedMessageIds: extractFeishuResponseMessageIds(data),
  };
}

async function downloadAppMessageResource(settings, messageId, fileKey, type = "image") {
  const normalizedMessageId = trimString(messageId);
  const normalizedFileKey = trimString(fileKey);
  if (!normalizedMessageId || !normalizedFileKey) {
    throw new Error("Feishu image message id or file key is missing.");
  }
  const token = await getTenantAccessToken(settings);
  const response = await fetch(
    `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(
      normalizedMessageId,
    )}/resources/${encodeURIComponent(normalizedFileKey)}?type=${encodeURIComponent(type)}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  const arrayBuffer = await response.arrayBuffer();
  const body = Buffer.from(arrayBuffer);
  if (!response.ok) {
    throw new Error(`Feishu resource download failed (${response.status}): ${body.toString("utf8").slice(0, 1000)}`);
  }
  return {
    mimeType: trimString(response.headers.get("content-type")) || "image/png",
    data: body.toString("base64"),
  };
}

function extractImageUrlFromJson(data) {
  const payload = data && typeof data === "object" ? data : {};
  const inner = payload.data && typeof payload.data === "object" ? payload.data : {};
  return (
    trimString(inner.image_url) ||
    trimString(inner.download_url) ||
    trimString(inner.url) ||
    trimString(payload.image_url) ||
    trimString(payload.download_url) ||
    trimString(payload.url)
  );
}

function buildImageCandidates(imageRef = {}) {
  const keys = [
    trimString(imageRef.imageKey),
    trimString(imageRef.imageToken),
    trimString(imageRef.fileKey),
  ].filter(Boolean);
  const uniqueKeys = [...new Set(keys)];
  const candidates = [];
  for (const key of uniqueKeys) {
    candidates.push(
      `https://open.feishu.cn/open-apis/image/v4/get?image_key=${encodeURIComponent(key)}`,
      `https://open.feishu.cn/open-apis/image/v4/get?image_token=${encodeURIComponent(key)}`,
      `https://open.feishu.cn/open-apis/im/v1/images/${encodeURIComponent(key)}`,
      `https://open.feishu.cn/open-apis/im/v1/images/${encodeURIComponent(key)}/download`,
    );
  }
  const messageId = trimString(imageRef.messageId);
  for (const key of uniqueKeys) {
    if (!messageId) continue;
    const base = `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(
      messageId,
    )}/resources/${encodeURIComponent(key)}`;
    candidates.push(base, `${base}?type=image`);
  }
  return [...new Set(candidates)];
}

async function readImageResponse(response) {
  const arrayBuffer = await response.arrayBuffer();
  const mimeType = trimString(response.headers.get("content-type")) || "image/png";
  return {
    type: "image",
    mimeType,
    data: Buffer.from(arrayBuffer).toString("base64"),
  };
}

async function fetchImageFromUrl(url, token = "") {
  const response = await fetch(url, {
    method: "GET",
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Feishu image download failed (${response.status}): ${trimString(text)}`);
  }
  const contentType = trimString(response.headers.get("content-type")).toLowerCase();
  if (contentType.startsWith("image/") || contentType.includes("application/octet-stream")) {
    return readImageResponse(response);
  }
  const data = await response.json();
  const nestedUrl = extractImageUrlFromJson(data);
  if (!nestedUrl) throw new Error("Feishu image JSON response did not contain a download URL.");
  return fetchImageFromUrl(nestedUrl, "");
}

async function resolveFeishuImageAttachment(settings, imageRef) {
  const token = await getTenantAccessToken(settings);
  const candidates = buildImageCandidates(imageRef);
  if (candidates.length === 0) throw new Error("Feishu image key is missing.");
  const errors = [];
  for (const url of candidates) {
    try {
      const downloaded = await fetchImageFromUrl(url, token);
      return downloaded;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`Feishu image download failed: ${errors.slice(0, 5).join("; ")}`);
}

function getImageSourceAbsolutePath(imageSource = {}) {
  const src = trimString(imageSource.src);
  if (!src || /^data:image\//i.test(src) || /^https?:\/\//i.test(src)) return "";
  let normalized = src;
  if (/^file:\/\//i.test(normalized)) {
    try {
      normalized = decodeURIComponent(new URL(normalized).pathname || "");
      if (/^\/[A-Za-z]:\//.test(normalized)) normalized = normalized.slice(1);
    } catch {
      normalized = src;
    }
  }
  if (/^\/@fs\//i.test(normalized)) normalized = decodeURIComponent(normalized.slice("/@fs/".length));
  if (/^\/[A-Za-z]:\//.test(normalized)) normalized = normalized.slice(1);
  if (path.isAbsolute(normalized)) return normalized;
  const cwd = trimString(imageSource.cwd);
  return cwd ? path.resolve(cwd, normalized) : path.resolve(normalized);
}

async function normalizeAppUploadImageSource(imageSource = {}) {
  const src = trimString(imageSource.src);
  if (!src) throw new Error("Feishu app upload image source is missing.");
  if (/^data:image\//i.test(src)) {
    const match = src.match(/^data:([^;,]+);base64,(.+)$/i);
    if (!match) throw new Error("Unsupported data URL image source.");
    return {
      buffer: Buffer.from(match[2], "base64"),
      mimeType: trimString(match[1]) || "image/png",
      name: trimString(imageSource.name) || "codex-image",
    };
  }
  if (/^https?:\/\//i.test(src)) {
    const response = await fetch(src);
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Image fetch failed (${response.status}): ${trimString(text)}`);
    }
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      mimeType: trimString(response.headers.get("content-type")) || "image/png",
      name: trimString(imageSource.name) || "codex-image",
    };
  }
  const absolutePath = getImageSourceAbsolutePath(imageSource);
  if (!absolutePath) throw new Error("Image source path could not be resolved.");
  const buffer = await fs.readFile(absolutePath);
  const extension = trimString(path.extname(absolutePath)).toLowerCase();
  const mimeType =
    trimString(imageSource.mimeType) ||
    (extension === ".jpg" || extension === ".jpeg"
      ? "image/jpeg"
      : extension === ".webp"
        ? "image/webp"
        : extension === ".gif"
          ? "image/gif"
          : "image/png");
  return {
    buffer,
    mimeType,
    name: trimString(imageSource.name) || path.basename(absolutePath),
  };
}

async function uploadFeishuAppImage(settings, imageSource) {
  const token = await getTenantAccessToken(settings);
  const normalized = await normalizeAppUploadImageSource(imageSource);
  const formData = new FormData();
  const blob = new Blob([normalized.buffer], { type: normalized.mimeType || "image/png" });
  formData.set("image_type", trimString(imageSource.imageType) || "message");
  formData.set("image", blob, normalized.name || "codex-image");
  const response = await fetch("https://open.feishu.cn/open-apis/im/v1/images", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: formData,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) throw new Error(`Feishu image upload failed (${response.status}): ${text}`);
  if (data != null && typeof data.code === "number" && data.code !== 0) {
    throw new Error(`Feishu image upload failed: ${data.msg || JSON.stringify(data)}`);
  }
  const imageKey = trimString(data?.data?.image_key || data?.image_key);
  if (!imageKey) throw new Error("Feishu image upload response missing image_key.");
  return { imageKey };
}

async function addAppMessageReaction(settings, messageId, emojiType = "OK") {
  if (!trimString(messageId)) return { ok: false };
  const data = await createAuthorizedRequest(
    `open-apis/im/v1/messages/${encodeURIComponent(messageId)}/reactions`,
    settings,
    { reaction_type: { emoji_type: emojiType } },
  );
  return { ok: true, data };
}

function parseStructuredFeishuContent(content) {
  if (content && typeof content === "object") return content;
  const raw = trimString(content);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function extractFeishuText(content) {
  const raw = trimString(content);
  if (!raw) return "";
  if (/^text:/i.test(raw)) return trimString(raw.slice(5));
  try {
    return trimString(JSON.parse(raw)?.text);
  } catch {
    return raw;
  }
}

function extractFeishuPostSegmentText(segment) {
  if (!segment || typeof segment !== "object") return "";
  const tag = trimString(segment.tag).toLowerCase();
  const text = trimString(segment.text) || trimString(segment.content) || trimString(segment.title);
  if (tag === "text" || tag === "a" || tag === "md") return text;
  if (tag === "at") {
    const userName = trimString(segment.user_name) || trimString(segment.userName) || trimString(segment.name);
    return userName ? `@${userName}` : text;
  }
  if (tag === "emotion") return trimString(segment.emoji_type || segment.emojiType || text);
  return "";
}

function extractFeishuPostText(content) {
  const parsed = parseStructuredFeishuContent(content);
  if (!parsed) return "";
  const lines = [];
  const title = trimString(parsed.title);
  if (title) lines.push(title);
  for (const row of Array.isArray(parsed.content) ? parsed.content : []) {
    const line = Array.isArray(row)
      ? row.map((item) => extractFeishuPostSegmentText(item)).filter(Boolean).join("")
      : "";
    if (trimString(line)) lines.push(trimString(line));
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function extractFeishuImageRef(content, messageId = "") {
  const parsed = parseStructuredFeishuContent(content);
  if (!parsed) return null;
  const candidates = [parsed, parsed.data, parsed.content, parsed.image].filter(
    (value) => value && typeof value === "object",
  );
  let imageKey = "";
  let imageToken = "";
  let fileKey = "";
  for (const candidate of candidates) {
    imageKey ||= trimString(candidate.image_key || candidate.imageKey);
    imageToken ||= trimString(candidate.image_token || candidate.imageToken);
    fileKey ||= trimString(candidate.file_key || candidate.fileKey);
  }
  if (!imageKey && !imageToken && !fileKey) return null;
  return { messageId: trimString(messageId), imageKey, imageToken, fileKey };
}

function parseFeishuChatMessage(item) {
  const messageId = trimString(item?.message_id);
  const chatId = trimString(item?.chat_id);
  const messageType = trimString(item?.msg_type).toLowerCase();
  if (!messageId || !chatId || !messageType) return null;
  const body = item?.body && typeof item.body === "object" ? item.body : item;
  const sender = item?.sender && typeof item.sender === "object" ? item.sender : {};
  const relatedMessageIds = new Set();
  const { collectFeishuRelatedMessageIds } = require("./feishu-utils.js");
  collectFeishuRelatedMessageIds(item, relatedMessageIds);
  relatedMessageIds.delete(messageId);
  const base = {
    messageId,
    chatId,
    parentId: trimString(item?.parent_id) || null,
    rootId: trimString(item?.root_id) || null,
    upperMessageId: trimString(item?.upper_message_id) || null,
    threadId: trimString(item?.thread_id) || null,
    relatedMessageIds: [...relatedMessageIds],
    senderId:
      trimString(sender.id) ||
      trimString(sender.sender_id?.open_id) ||
      trimString(sender.sender_id?.user_id),
    senderType: trimString(sender.sender_type),
    messageType,
    createdAt: Number.parseInt(trimString(item?.create_time), 10) || Date.now(),
    deleted: Boolean(item?.deleted),
  };
  if (messageType === "image") {
    return { ...base, text: "", imageRef: extractFeishuImageRef(body.content, messageId), mentions: false };
  }
  const text =
    messageType === "text"
      ? extractFeishuText(body.content)
      : messageType === "post"
        ? extractFeishuPostText(body.content)
        : "";
  if (!text) return null;
  return { ...base, text, mentions: Array.isArray(body.mentions) && body.mentions.length > 0 };
}

async function listAppChatMessages(settings, chatId, startTime, endTime) {
  const normalizedChatId = trimString(chatId);
  if (!normalizedChatId) return [];
  let pageToken = null;
  const messages = [];
  do {
    const params = new URLSearchParams({
      container_id_type: "chat",
      container_id: normalizedChatId,
      page_size: "50",
      start_time: `${Math.floor(Number(startTime) || 0)}`,
      end_time: `${Math.floor(Number(endTime) || 0)}`,
    });
    if (pageToken) params.set("page_token", pageToken);
    const data = await createAuthorizedRequest(
      `open-apis/im/v1/messages?${params.toString()}`,
      settings,
      null,
      "GET",
    );
    for (const item of Array.isArray(data?.data?.items) ? data.data.items : []) {
      const parsed = parseFeishuChatMessage(item);
      if (parsed) messages.push(parsed);
    }
    pageToken = data?.data?.has_more ? trimString(data?.data?.page_token) : null;
  } while (pageToken);
  return messages;
}

module.exports = {
  addAppMessageReaction,
  createAuthorizedRequest,
  createAppGroupChat,
  createAppGroupShareLink,
  createAppCardKitCard,
  deleteAppMessage,
  getAppMessage,
  downloadAppMessageResource,
  fetchJson,
  listAppChatMessages,
  parseFeishuChatMessage,
  resolveFeishuImageAttachment,
  replyAppCardKitNotification,
  replyAppCardNotification,
  replyAppTextNotification,
  sendAppCardKitNotification,
  sendAppCardKitToChat,
  sendAppCardNotification,
  sendAppCardToChat,
  sendAppTextNotification,
  sendAppTextToChat,
  setAppCardKitStreamingMode,
  streamAppCardKitElement,
  updateAppCardKitCard,
  updateAppCardNotification,
  updateAppGroupChat,
  uploadFeishuAppImage,
};
