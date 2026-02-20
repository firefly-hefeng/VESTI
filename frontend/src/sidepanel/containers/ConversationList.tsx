import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Conversation, Message, Topic } from "~lib/types";
import {
  deleteConversation,
  getConversations,
  getMessages,
  getTopics,
  updateConversationTitle,
} from "~lib/services/storageService";
import { trackCardActionClick } from "~lib/services/telemetry";
import { ConversationCard } from "../components/ConversationCard";

interface ConversationListProps {
  searchQuery: string;
  onSelect: (conversation: Conversation) => void;
  refreshToken: number;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function toLocalDateTime(value: number): string {
  const date = new Date(value);
  const yyyy = date.getFullYear();
  const mm = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const mi = pad2(date.getMinutes());
  const ss = pad2(date.getSeconds());
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function getDisplayCreatedAt(conversation: Conversation): number {
  return conversation.source_created_at ?? conversation.created_at;
}

function buildConversationCopyText(
  conversation: Conversation,
  messages: Message[]
): string {
  const lines: string[] = [];
  lines.push(`# ${conversation.title || "Untitled Conversation"}`);
  lines.push(`Platform: ${conversation.platform}`);
  lines.push(`Source URL: ${conversation.url || "N/A"}`);
  lines.push(`Created At: ${toLocalDateTime(getDisplayCreatedAt(conversation))}`);
  lines.push(`Updated At: ${toLocalDateTime(conversation.updated_at)}`);
  lines.push(`Message Count: ${messages.length}`);
  lines.push("");

  for (const message of messages) {
    const role = message.role === "user" ? "User" : "AI";
    lines.push(`${role}: [${toLocalDateTime(message.created_at)}]`);
    lines.push(message.content_text);
    lines.push("");
  }

  return lines.join("\n").trim();
}

function matchesSearch(conversation: Conversation, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  return (
    conversation.title.toLowerCase().includes(normalizedQuery) ||
    conversation.snippet.toLowerCase().includes(normalizedQuery)
  );
}

interface TopicOption {
  id: number;
  label: string;
}

function flattenTopics(
  topics: Topic[],
  level: number = 0,
  acc: TopicOption[] = []
): TopicOption[] {
  for (const topic of topics) {
    const prefix = level > 0 ? `${"- ".repeat(level)}` : "";
    acc.push({ id: topic.id, label: `${prefix}${topic.name}` });
    if (topic.children && topic.children.length > 0) {
      flattenTopics(topic.children, level + 1, acc);
    }
  }
  return acc;
}

export function ConversationList({
  searchQuery,
  onSelect,
  refreshToken,
}: ConversationListProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const fullTextCacheRef = useRef<Map<number, string>>(new Map());
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getConversations({ search: searchQuery || undefined })
      .then((data) => {
        if (!cancelled) {
          setConversations(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setConversations([]);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [searchQuery, refreshToken]);

  useEffect(() => {
    let cancelled = false;
    getTopics()
      .then((data) => {
        if (!cancelled) {
          setTopics(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTopics([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  const topicOptions = useMemo(() => flattenTopics(topics), [topics]);

  const grouped = useMemo(() => {
    const now = Date.now();
    const today: Conversation[] = [];
    const week: Conversation[] = [];
    const older: Conversation[] = [];

    for (const conversation of conversations) {
      const diff = now - conversation.updated_at;
      if (diff < 86_400_000) today.push(conversation);
      else if (diff < 604_800_000) week.push(conversation);
      else older.push(conversation);
    }

    const groups: { label: string; items: Conversation[] }[] = [];
    if (today.length > 0) groups.push({ label: "Today", items: today });
    if (week.length > 0) groups.push({ label: "This Week", items: week });
    if (older.length > 0) groups.push({ label: "Earlier", items: older });
    return groups;
  }, [conversations]);

  const handleCopyFullText = useCallback(async (conversation: Conversation) => {
    const hasCache = fullTextCacheRef.current.has(conversation.id);
    trackCardActionClick({
      action_type: "copy_text",
      platform_source: conversation.platform,
      has_full_text_cache: hasCache,
      conversation_id: conversation.id,
    });

    try {
      let fullText = fullTextCacheRef.current.get(conversation.id);
      if (!fullText) {
        const messages = await getMessages(conversation.id);
        fullText = buildConversationCopyText(conversation, messages);
        fullTextCacheRef.current.set(conversation.id, fullText);
      }

      await navigator.clipboard.writeText(fullText);
      return true;
    } catch {
      return false;
    }
  }, []);

  const handleOpenSource = useCallback((conversation: Conversation) => {
    trackCardActionClick({
      action_type: "open_source_url",
      platform_source: conversation.platform,
      has_full_text_cache: null,
      conversation_id: conversation.id,
    });
    if (!conversation.url.trim()) return;
    window.open(conversation.url, "_blank", "noopener,noreferrer");
  }, []);

  const handleDeleteConversation = useCallback(
    async (id: number) => {
      const targetConversation = conversations.find((item) => item.id === id);
      if (!targetConversation) return;

      trackCardActionClick({
        action_type: "delete_conversation",
        platform_source: targetConversation.platform,
        has_full_text_cache: null,
        conversation_id: id,
      });

      await deleteConversation(id);
      fullTextCacheRef.current.delete(id);
      setConversations((prev) => prev.filter((item) => item.id !== id));
    },
    [conversations]
  );

  const handleRenameTitle = useCallback(
    async (conversationId: number, title: string) => {
      const targetConversation = conversations.find(
        (item) => item.id === conversationId
      );
      if (!targetConversation) return false;

      const normalizedTitle = title.trim();
      if (!normalizedTitle || normalizedTitle.length > 120) {
        return false;
      }

      trackCardActionClick({
        action_type: "rename_title",
        platform_source: targetConversation.platform,
        has_full_text_cache: null,
        conversation_id: conversationId,
      });

      try {
        const updatedConversation = await updateConversationTitle(
          conversationId,
          normalizedTitle
        );
        fullTextCacheRef.current.delete(conversationId);

        setConversations((prev) => {
          const next = prev.map((item) =>
            item.id === conversationId
              ? { ...item, title: updatedConversation.title }
              : item
          );

          if (!normalizedSearchQuery) {
            return next;
          }

          return next.filter((item) => matchesSearch(item, normalizedSearchQuery));
        });

        return true;
      } catch (error) {
        console.error("Failed to rename conversation title", error);
        return false;
      }
    },
    [conversations, normalizedSearchQuery]
  );

  const handleConversationUpdated = useCallback(
    (updatedConversation: Conversation) => {
      setConversations((prev) => {
        let next = prev.map((item) =>
          item.id === updatedConversation.id
            ? { ...item, ...updatedConversation }
            : item
        );

        next = next.sort((a, b) => b.updated_at - a.updated_at);

        if (!normalizedSearchQuery) {
          return next;
        }

        return next.filter((item) => matchesSearch(item, normalizedSearchQuery));
      });
    },
    [normalizedSearchQuery]
  );

  if (loading) {
    return (
      <div className="flex flex-col gap-2.5 p-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-16 animate-pulse rounded-md bg-surface-card"
          />
        ))}
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-vesti-sm text-text-tertiary">
          {searchQuery ? "No matches" : "No conversations yet"}
        </p>
      </div>
    );
  }

  return (
    <div className="vesti-scroll flex flex-col gap-2 overflow-y-auto px-4 pb-4">
      {grouped.map((group) => (
        <div key={group.label}>
          <h4 className="-mx-4 sticky top-0 z-10 bg-bg-tertiary px-4 pb-1 pt-3 text-vesti-xs font-medium text-text-tertiary">
            {group.label}
          </h4>
          <div className="flex flex-col gap-2">
            {group.items.map((conversation) => (
              <ConversationCard
                key={conversation.id}
                conversation={conversation}
                onClick={() => onSelect(conversation)}
                onCopyFullText={handleCopyFullText}
                onOpenSource={handleOpenSource}
                onDelete={handleDeleteConversation}
                onRenameTitle={handleRenameTitle}
                topicOptions={topicOptions}
                onConversationUpdated={handleConversationUpdated}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
