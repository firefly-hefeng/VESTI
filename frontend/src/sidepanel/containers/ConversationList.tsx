import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Conversation, Message, Platform } from "~lib/types";
import {
  deleteConversation,
  getConversations,
  getMessages,
  searchConversationIdsByText,
  updateConversationTitle,
} from "~lib/services/storageService";
import { trackCardActionClick } from "~lib/services/telemetry";
import type { DatePreset } from "../types/timelineFilters";
import { ConversationCard } from "../components/ConversationCard";

interface ConversationListProps {
  searchQuery: string;
  datePreset: DatePreset;
  selectedPlatforms: Set<Platform>;
  onSelect: (conversation: Conversation) => void;
  refreshToken: number;
}

interface FilteredConversationItem {
  conversation: Conversation;
  matchedInMessagesOnly: boolean;
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

function matchesDatePreset(timestamp: number, preset: DatePreset): boolean {
  if (preset === "all_time") return true;

  const now = new Date();
  if (preset === "today") {
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return timestamp >= startOfToday;
  }

  if (preset === "this_week") {
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const sevenDaysAgo = startOfToday - 6 * 24 * 60 * 60 * 1000;
    return timestamp >= sevenDaysAgo;
  }

  return (
    new Date(timestamp).getMonth() === now.getMonth() &&
    new Date(timestamp).getFullYear() === now.getFullYear()
  );
}

export function ConversationList({
  searchQuery,
  datePreset,
  selectedPlatforms,
  onSelect,
  refreshToken,
}: ConversationListProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [messageMatchIds, setMessageMatchIds] = useState<Set<number>>(new Set());
  const [isMessageSearchPending, setIsMessageSearchPending] = useState(false);
  const fullTextCacheRef = useRef<Map<number, string>>(new Map());
  const queryCacheRef = useRef<Map<string, Set<number>>>(new Map());
  const searchRequestSeqRef = useRef(0);
  const searchDebounceRef = useRef<number | null>(null);
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    queryCacheRef.current.clear();
    setMessageMatchIds(new Set());
    getConversations()
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
  }, [refreshToken]);

  useEffect(() => {
    const requestSeq = searchRequestSeqRef.current + 1;
    searchRequestSeqRef.current = requestSeq;

    if (searchDebounceRef.current !== null) {
      window.clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }

    if (normalizedSearchQuery.length < 2) {
      setIsMessageSearchPending(false);
      setMessageMatchIds(new Set());
      return;
    }

    const cached = queryCacheRef.current.get(normalizedSearchQuery);
    if (cached) {
      setIsMessageSearchPending(false);
      setMessageMatchIds(new Set(cached));
      return;
    }

    setIsMessageSearchPending(true);
    searchDebounceRef.current = window.setTimeout(() => {
      void (async () => {
        try {
          const ids = await searchConversationIdsByText(normalizedSearchQuery);
          if (requestSeq !== searchRequestSeqRef.current) {
            return;
          }
          const matchSet = new Set(ids);
          queryCacheRef.current.set(normalizedSearchQuery, matchSet);
          setMessageMatchIds(new Set(matchSet));
        } catch {
          if (requestSeq !== searchRequestSeqRef.current) {
            return;
          }
          setMessageMatchIds(new Set());
        } finally {
          if (requestSeq === searchRequestSeqRef.current) {
            setIsMessageSearchPending(false);
          }
        }
      })();
    }, 180);

    return () => {
      if (searchDebounceRef.current !== null) {
        window.clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = null;
      }
    };
  }, [normalizedSearchQuery, refreshToken]);

  const filteredConversations = useMemo(() => {
    const convs = conversations ?? [];
    return convs.reduce<FilteredConversationItem[]>((acc, conversation) => {
      const baseMatch = matchesSearch(conversation, normalizedSearchQuery);
      const textMatch =
        normalizedSearchQuery.length >= 2 && messageMatchIds.has(conversation.id);
      const matchesQuery =
        normalizedSearchQuery.length === 0 ? true : baseMatch || textMatch;
      if (!matchesQuery) return acc;
      if (!matchesDatePreset(conversation.updated_at, datePreset)) return acc;
      if (selectedPlatforms.size > 0 && !selectedPlatforms.has(conversation.platform)) {
        return acc;
      }
      acc.push({
        conversation,
        matchedInMessagesOnly: textMatch && !baseMatch,
      });
      return acc;
    }, []);
  }, [
    conversations,
    datePreset,
    messageMatchIds,
    normalizedSearchQuery,
    selectedPlatforms,
  ]);

  const grouped = useMemo(() => {
    const now = Date.now();
    const today: FilteredConversationItem[] = [];
    const week: FilteredConversationItem[] = [];
    const older: FilteredConversationItem[] = [];

    for (const item of filteredConversations) {
      const diff = now - item.conversation.updated_at;
      if (diff < 86_400_000) today.push(item);
      else if (diff < 604_800_000) week.push(item);
      else older.push(item);
    }

    const groups: { label: string; items: FilteredConversationItem[] }[] = [];
    if (today.length > 0) groups.push({ label: "Today", items: today });
    if (week.length > 0) groups.push({ label: "This Week", items: week });
    if (older.length > 0) groups.push({ label: "Earlier", items: older });
    return groups;
  }, [filteredConversations]);

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

        setConversations((prev) =>
          prev.map((item) =>
            item.id === conversationId
              ? { ...item, title: updatedConversation.title }
              : item
          )
        );
        return true;
      } catch (error) {
        console.error("Failed to rename conversation title", error);
        return false;
      }
    },
    [conversations]
  );

  if (loading) {
    return (
      <div className="flex h-full flex-col gap-2.5 p-4">
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
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-vesti-sm text-text-tertiary">No conversations yet</p>
      </div>
    );
  }

  if (filteredConversations.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-vesti-sm text-text-tertiary">
          {isMessageSearchPending ? "Searching messages..." : "No matches"}
        </p>
      </div>
    );
  }

  return (
    <div className="vesti-scroll h-full min-h-0 flex flex-col gap-2 overflow-y-scroll px-4 pb-4">
      {grouped.map((group) => (
        <div key={group.label}>
          <h4 className="-mx-4 sticky top-0 z-10 bg-bg-app px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-tertiary">
            {group.label}
          </h4>
          <div className="flex flex-col gap-2">
            {group.items.map((item) => (
              <ConversationCard
                key={item.conversation.id}
                conversation={item.conversation}
                matchedInMessagesOnly={item.matchedInMessagesOnly}
                onClick={() => onSelect(item.conversation)}
                onCopyFullText={handleCopyFullText}
                onOpenSource={handleOpenSource}
                onDelete={handleDeleteConversation}
                onRenameTitle={handleRenameTitle}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
