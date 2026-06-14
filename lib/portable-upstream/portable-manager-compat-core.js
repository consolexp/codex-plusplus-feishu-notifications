// PORTABLE_PATCH: Pure manager compat helpers that can be replayed in tests
// without loading the full renderer bridge.
function trimString(value) {
return typeof value === "string" ? value.trim() : "";
}

function getPortableConversation(manager, conversationId) {
const normalizedConversationId = trimString(conversationId);
if (
!normalizedConversationId ||
typeof manager?.getConversation !== "function"
) {
return null;
}

return manager.getConversation(normalizedConversationId);
}

export function getLatestPortableConversationTurn(conversation) {
return Array.isArray(conversation?.turns) ?
conversation.turns[conversation.turns.length - 1] || null :
null;
}

export function isPortableConversationTurnInProgress(manager, conversationId) {
const conversation = getPortableConversation(manager, conversationId);
const latestTurn = getLatestPortableConversationTurn(conversation);
return latestTurn?.status === "inProgress";
}

export function summarizePortableConversation(manager, conversationId) {
const conversation = getPortableConversation(manager, conversationId);
const latestTurn = getLatestPortableConversationTurn(conversation);
return {
conversationId: trimString(conversationId),
cwd: trimString(conversation?.cwd),
turnCount: Array.isArray(conversation?.turns) ? conversation.turns.length : 0,
latestTurnId: trimString(latestTurn?.turnId),
latestTurnStatus: trimString(latestTurn?.status),
};
}
