import type { Conversation } from "../types";
import type { ConversationUpdateChanges } from "../messaging/protocol";
import { updateConversation } from "./storageService";

export async function updateConversationAndSync(
  id: number,
  changes: ConversationUpdateChanges
): Promise<Conversation> {
  const result = await updateConversation(id, changes);
  const payloadChanges: ConversationUpdateChanges = {};

  if (changes.topic_id !== undefined) {
    payloadChanges.topic_id = changes.topic_id;
  }
  if (changes.is_starred !== undefined) {
    payloadChanges.is_starred = changes.is_starred;
  }

  chrome.runtime.sendMessage(
    { type: "CONVERSATION_UPDATED", payload: { id, changes: payloadChanges } },
    () => {
      void chrome.runtime.lastError;
    }
  );

  return result.conversation;
}
