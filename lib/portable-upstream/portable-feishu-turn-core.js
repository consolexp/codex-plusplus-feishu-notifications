// PORTABLE_PATCH: Keep Feishu input shaping in a small replayable module so
// upgrade validation can test it without the full renderer runtime.
function trimString(value) {
return typeof value === "string" ? value.trim() : "";
}

export function buildTextInput(text) {
return [{
type: "text",
text,
text_elements: [],
}, ];
}

export function normalizeFeishuImageDataUrl(attachment) {
const mimeType = trimString(attachment?.mimeType) || "image/png";
const data = trimString(attachment?.data);
if (!data) {
return "";
}

if (/^data:/i.test(data)) {
return data;
}

return `data:${mimeType};base64,${data}`;
}

export function buildFeishuImageInputParts(attachments = []) {
return attachments
.filter((attachment) => attachment?.type === "image")
.map((attachment) => {
const url = normalizeFeishuImageDataUrl(attachment);
if (!url) {
return null;
}

return {
type: "image",
url,
};
})
.filter(Boolean);
}

export function buildFeishuTurnInput(text, attachments = []) {
const normalizedText = trimString(text);
return [
...buildTextInput(
normalizedText ||
(attachments.length > 0 ? "Please process this together with the images I attached." : ""),
),
...buildFeishuImageInputParts(attachments),
];
}

export function buildSteerGuidanceText(text) {
const normalized = trimString(text);
return normalized ?
`Additional requirement. Incorporate this directly into the current work:
\n${normalized}` :
"Additional requirement. Incorporate this directly into the current work.";
}

export function buildImageMessagePrompt() {
return "请补充一段文字说明，我会把这段文字和上一条图片一起发送给 Codex。";
}
