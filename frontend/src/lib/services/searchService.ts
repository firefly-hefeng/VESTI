import type { Conversation, RelatedConversation, VectorRecord } from "../types";
import { db } from "../db/schema";
import { embedText } from "./embeddingService";

const MAX_MESSAGE_COUNT = 12;
const MAX_TEXT_LENGTH = 4000;

function toFloat32Array(value: Float32Array | number[]): Float32Array {
  return value instanceof Float32Array ? value : new Float32Array(value);
}

function buildConversationText(
  conversation: Conversation,
  messageTexts: string[]
): string {
  const chunks = [conversation.title, conversation.snippet, ...messageTexts];
  const combined = chunks.filter(Boolean).join("\n");
  if (combined.length <= MAX_TEXT_LENGTH) return combined;
  return combined.slice(0, MAX_TEXT_LENGTH);
}

export async function hashText(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getConversationText(
  conversationId: number
): Promise<{ conversation: Conversation; text: string; textHash: string }> {
  const conversation = await db.conversations.get(conversationId);
  if (!conversation || conversation.id === undefined) {
    throw new Error("CONVERSATION_NOT_FOUND");
  }

  const messages = await db.messages
    .where("conversation_id")
    .equals(conversationId)
    .sortBy("created_at");

  const messageTexts = messages
    .slice(0, MAX_MESSAGE_COUNT)
    .map((message) => message.content_text)
    .filter(Boolean);

  const text = buildConversationText(conversation as Conversation, messageTexts);
  const textHash = await hashText(text);
  return { conversation: conversation as Conversation, text, textHash };
}

export async function ensureVectorForConversation(
  conversationId: number
): Promise<VectorRecord | null> {
  const { conversation, text, textHash } = await getConversationText(conversationId);

  const existing = await db.vectors
    .where("[conversation_id+text_hash]")
    .equals([conversationId, textHash])
    .first();
  if (existing && existing.id !== undefined) {
    return existing as VectorRecord;
  }

  const embedding = await embedText(text);

  await db.transaction("rw", db.vectors, async () => {
    await db.vectors
      .where("conversation_id")
      .equals(conversationId)
      .and((record) => record.text_hash !== textHash)
      .delete();
  });

  const id = await db.vectors.add({
    conversation_id: conversation.id,
    text_hash: textHash,
    embedding,
  });

  return {
    id,
    conversation_id: conversation.id,
    text_hash: textHash,
    embedding,
  };
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i];
    const bv = b[i];
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function findRelatedConversations(
  conversationId: number,
  limit = 3
): Promise<RelatedConversation[]> {
  const targetVector = await ensureVectorForConversation(conversationId);
  if (!targetVector) return [];

  const vectors = await db.vectors.toArray();
  const targetEmbedding = toFloat32Array(targetVector.embedding);

  const scores: Array<{ id: number; similarity: number }> = [];
  for (const vector of vectors) {
    if (vector.conversation_id === conversationId) continue;
    const embedding = toFloat32Array(vector.embedding as Float32Array | number[]);
    const similarity = cosineSimilarity(targetEmbedding, embedding);
    scores.push({ id: vector.conversation_id, similarity });
  }

  const top = scores
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

  const conversations = await db.conversations.bulkGet(top.map((item) => item.id));
  const byId = new Map<number, Conversation>();
  conversations.forEach((item) => {
    if (item && item.id !== undefined) {
      byId.set(item.id, item as Conversation);
    }
  });

  return top
    .map((item) => {
      const conversation = byId.get(item.id);
      if (!conversation) return null;
      return {
        id: conversation.id,
        title: conversation.title,
        platform: conversation.platform,
        similarity: Math.round(item.similarity * 100),
      } as RelatedConversation;
    })
    .filter(Boolean) as RelatedConversation[];
}

export async function hybridSearch(_query: string): Promise<void> {
  return;
}

export async function vectorizeAllConversations(): Promise<number> {
  const conversations = await db.conversations.toArray();
  let created = 0;
  for (const conversation of conversations) {
    if (!conversation?.id) continue;
    try {
      const vector = await ensureVectorForConversation(conversation.id);
      if (vector) created += 1;
    } catch {
      // skip failures to keep task resilient
    }
  }
  return created;
}
