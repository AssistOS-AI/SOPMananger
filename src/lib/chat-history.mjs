export const MAX_CHAT_HISTORY_ITEMS = 200;
export const MAX_CHAT_ATTACHMENTS = 6;

export function normalizeChatHistoryItems(items = []) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .slice(-MAX_CHAT_HISTORY_ITEMS)
    .map((entry, index) => {
      const role = entry?.role === 'assistant' ? 'assistant' : 'user';
      const text = String(entry?.text || '').slice(0, 12000);
      const at = String(entry?.at || '').trim() || new Date().toISOString();
      const actions = Array.isArray(entry?.actions)
        ? entry.actions.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 12)
        : [];
      const attachments = Array.isArray(entry?.attachments)
        ? entry.attachments
          .slice(0, MAX_CHAT_ATTACHMENTS)
          .map((attachment) => ({
            id: String(attachment?.id || `a-${index + 1}`).slice(0, 64),
            name: String(attachment?.name || 'attachment').slice(0, 160),
            mimeType: String(attachment?.mimeType || '').slice(0, 120),
            size: Number(attachment?.size || 0),
          }))
        : [];

      return {
        role,
        text,
        at,
        actions,
        attachments,
      };
    });
}
