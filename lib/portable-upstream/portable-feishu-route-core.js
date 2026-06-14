// PORTABLE_PATCH: Pure Feishu route helpers kept outside the renderer bridge.
export const DIRECT_FEISHU_KIND_CONVERSATION = "conversation";
export const DIRECT_FEISHU_KIND_WORKSPACE = "workspace";

function trimString(value) {
return typeof value === "string" ? value.trim() : "";
}

export function normalizeDirectRoutePromptLimit(limit) {
const numeric =
typeof limit === "number" ?
limit :
typeof limit === "string" && limit.trim().length > 0 ?
Number.parseInt(limit, 10) :
Number.NaN;

if (!Number.isFinite(numeric)) {
return 0;
}

return Math.max(0, Math.round(numeric));
}

export function selectDirectRoutePromptConversationChoices(
conversationChoices,
limit,
) {
const safeLimit = normalizeDirectRoutePromptLimit(limit);
return conversationChoices.slice(0, safeLimit);
}

export function selectDirectRoutePromptWorkspaceChoices(
workspaceChoices,
limit,
) {
return workspaceChoices.slice(0, normalizeDirectRoutePromptLimit(limit));
}

export function extractDirectFeishuRoute(text) {
const normalized = trimString(text);
if (!normalized) {
return null;
}

const match = normalized.match(
/^@\s*(conversation|workspace)\s*:?\s*([^\s]+)(?:\s+([\s\S]*))?$/i,
);
if (!match) {
return null;
}

return {
kind: match[1].toLowerCase() === "conversation" ?
DIRECT_FEISHU_KIND_CONVERSATION : DIRECT_FEISHU_KIND_WORKSPACE,
target: trimString(match[2]),
body: trimString(match[3] || ""),
};
}

export function resolveConversationChoice(routeTarget, choices) {
const numericIndex = Number.parseInt(routeTarget, 10);
if (Number.isFinite(numericIndex)) {
return choices.find((choice) => choice.index === numericIndex) || null;
}

return (
choices.find((choice) => choice.conversationId === routeTarget) || null
);
}

export function resolveWorkspaceChoice(routeTarget, choices) {
const numericIndex = Number.parseInt(routeTarget, 10);
if (Number.isFinite(numericIndex)) {
return choices.find((choice) => choice.index === numericIndex) || null;
}

return choices.find((choice) => choice.cwd === routeTarget) || null;
}
