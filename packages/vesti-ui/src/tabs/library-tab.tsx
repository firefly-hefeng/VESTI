"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import {
  ChevronDown,
  BookOpen,
  List,
  Star,
  ChevronUp,
  Check,
  ArrowRight,
} from "lucide-react";
import type {
  Platform,
  Topic,
  StorageApi,
  RelatedConversation,
  Message,
} from "../types";
import { MOCK_NOTES } from "../mock-data";
import { useLibraryData } from "../contexts/library-data";

const platformColors: Record<Platform, string> = {
  ChatGPT: "#1A1A1A",
  Claude: "#1A1A1A",
  Gemini: "#FFFFFF",
  DeepSeek: "#FFFFFF",
  Qwen: "#1A1A1A",
  Doubao: "#1A1A1A",
};

const platformBackgrounds: Record<Platform, string> = {
  ChatGPT: "#F3F4F6",
  Claude: "#F7D8BA",
  Gemini: "#3A62D9",
  DeepSeek: "#172554",
  Qwen: "#F3F4F6",
  Doubao: "#F3F4F6",
};

type ViewMode = "conversations" | "notes";

type LibraryTabProps = {
  storage: StorageApi;
};

export function LibraryTab({ storage }: LibraryTabProps) {
  const { topics, conversations } = useLibraryData();
  const getRelatedConversations = storage.getRelatedConversations;
  const getMessages = storage.getMessages;
  const [viewMode, setViewMode] = useState<ViewMode>("conversations");
  const [selectedConversationId, setSelectedConversationId] = useState<number | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);
  const [gardenerExpanded, setGardenerExpanded] = useState(false);
  const [listFilter, setListFilter] = useState<"all" | "starred">("all");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [relatedConversations, setRelatedConversations] = useState<RelatedConversation[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [relatedError, setRelatedError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [isConversationExpanded, setIsConversationExpanded] = useState(false);

  // Note editing state
  const [editingTitle, setEditingTitle] = useState(false);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [noteSaveStatus, setNoteSaveStatus] = useState<"saved" | "unsaved">("saved");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Auto-save note with debounce
  useEffect(() => {
    if (viewMode !== "notes" || !selectedNoteId) return;
    if (!noteContent && !noteTitle) return;
    setNoteSaveStatus("unsaved");
    const timer = setTimeout(() => {
      console.log("[dashboard] Note saved:", { title: noteTitle, content: noteContent });
      setNoteSaveStatus("saved");
    }, 800);
    return () => clearTimeout(timer);
  }, [noteContent, noteTitle, viewMode, selectedNoteId]);

  // Load selected note
  useEffect(() => {
    if (viewMode === "notes" && selectedNoteId) {
      const note = MOCK_NOTES.find((n) => n.id === selectedNoteId);
      if (note) {
        setNoteTitle(note.title);
        setNoteContent(note.content);
      }
    }
  }, [selectedNoteId, viewMode]);

  useEffect(() => {
    if (conversations.length > 0 && selectedConversationId === null) {
      return;
    }
    if (conversations.length > 0 && selectedConversationId !== null) {
      const exists = conversations.some((c) => c.id === selectedConversationId);
      if (!exists) {
        setSelectedConversationId(null);
      }
    }
  }, [conversations, selectedConversationId]);

  useEffect(() => {
    setIsConversationExpanded(false);
  }, [selectedConversationId]);

  useEffect(() => {
    let cancelled = false;

    const loadRelated = async () => {
      if (!selectedConversationId || !getRelatedConversations) {
        setRelatedConversations([]);
        setRelatedError(null);
        return;
      }

      setRelatedLoading(true);
      setRelatedError(null);
      try {
        const data = await getRelatedConversations(selectedConversationId, 3);
        if (!cancelled) {
          setRelatedConversations(data);
        }
      } catch (error) {
        if (!cancelled) {
          setRelatedConversations([]);
          setRelatedError(
            (error as Error)?.message ?? "Failed to load related conversations"
          );
        }
      } finally {
        if (!cancelled) {
          setRelatedLoading(false);
        }
      }
    };

    void loadRelated();

    return () => {
      cancelled = true;
    };
  }, [selectedConversationId, getRelatedConversations]);

  useEffect(() => {
    let cancelled = false;

    const loadMessages = async () => {
      if (!selectedConversationId || !getMessages) {
        setMessages([]);
        setMessagesError(null);
        return;
      }

      setMessagesLoading(true);
      setMessagesError(null);
      setMessages([]);
      try {
        const data = await getMessages(selectedConversationId);
        if (!cancelled) {
          setMessages(data);
        }
      } catch (error) {
        if (!cancelled) {
          setMessages([]);
          setMessagesError(
            (error as Error)?.message ?? "Failed to load messages"
          );
        }
      } finally {
        if (!cancelled) {
          setMessagesLoading(false);
        }
      }
    };

    void loadMessages();

    return () => {
      cancelled = true;
    };
  }, [selectedConversationId, getMessages]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
    }
  }, [noteContent]);

  // Focus title input when editing
  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitle]);

  const selectedConversation = conversations.find((c) => c.id === selectedConversationId);
  const selectedNote = MOCK_NOTES.find((n) => n.id === selectedNoteId);
  const messageCount = messages.length;
  const messageDate =
    messages.length > 0 ? messages[0].created_at : selectedConversation?.updated_at;
  const previewMessages = useMemo(() => {
    if (messages.length === 0) return [];
    const firstUserIndex = messages.findIndex((message) => message.role === "user");
    const firstAiIndex = messages.findIndex((message) => message.role === "ai");
    if (firstUserIndex === -1 && firstAiIndex === -1) return [];
    if (firstUserIndex !== -1 && firstAiIndex !== -1) {
      return firstUserIndex <= firstAiIndex
        ? [messages[firstUserIndex], messages[firstAiIndex]]
        : [messages[firstAiIndex], messages[firstUserIndex]];
    }
    const index = firstUserIndex !== -1 ? firstUserIndex : firstAiIndex;
    return index !== -1 ? [messages[index]] : [];
  }, [messages]);
  const visibleMessages = isConversationExpanded ? messages : previewMessages;
  const canToggleMessages = messageCount > previewMessages.length;
  const normalizeTags = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return value.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0);
  };

  const activeTags = normalizeTags(selectedConversation?.tags);
  const activeTopicName =
    selectedConversation?.topic_id
      ? findTopicById(topics, selectedConversation.topic_id)?.name
      : undefined;
  const hasAnalysis = Boolean(activeTags.length > 0 || activeTopicName);
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const conversation of conversations) {
      for (const tag of normalizeTags(conversation.tags)) {
        const normalized = tag.trim();
        if (!normalized) continue;
        counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }, [conversations]);

  const starredCount = useMemo(
    () => conversations.filter((conversation) => conversation.is_starred).length,
    [conversations]
  );

  const baseConversations =
    listFilter === "starred"
      ? conversations.filter((conversation) => conversation.is_starred)
      : conversations;
  const tagFilteredConversations = selectedTag
    ? baseConversations.filter((conversation) =>
        normalizeTags(conversation.tags).includes(selectedTag)
      )
    : baseConversations;

  const filteredConversations = tagFilteredConversations;


  function formatDate(timestamp?: number): string {
    if (!timestamp) return "Unknown date";
    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(new Date(timestamp));
  }

  function formatTimeAgo(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    return `${Math.floor(months / 12)}y ago`;
  }

  function findTopicById(nodes: Topic[], id: number): Topic | null {
    for (const node of nodes) {
      if (node.id === id) return node;
      if (node.children && node.children.length > 0) {
        const match = findTopicById(node.children, id);
        if (match) return match;
      }
    }
    return null;
  }

  const switchToConversation = (conversationId: number) => {
    setViewMode("conversations");
    setListFilter("all");
    setSelectedTag(null);
    setSelectedConversationId(conversationId);
    const conversation = conversations.find((c) => c.id === conversationId);
    if (conversation) {
      setSelectedTopicId(conversation.topic_id);
    }
  };

  return (
    <div className="flex h-full">
      {/* Left Column - Sidebar (200px) */}
      <aside className="w-[200px] bg-bg-secondary flex flex-col">
        <div className="flex-1 overflow-y-auto pt-4">
          {tagCounts.length > 0 && (
            <div className="flex flex-col">
              {tagCounts.map(({ tag, count }) => {
                const isSelected = selectedTag === tag;
                return (
                  <button
                    key={tag}
                    onClick={() => {
                      setViewMode("conversations");
                      setListFilter("all");
                      setSelectedTag(tag);
                      setSelectedConversationId(null);
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors duration-200 relative ${
                      isSelected && viewMode === "conversations"
                        ? "bg-bg-surface-card-hover"
                        : "hover:bg-bg-surface-card"
                    }`}
                  >
                    {isSelected && viewMode === "conversations" && (
                      <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-accent-primary" />
                    )}
                    <span className="flex-1 text-sm font-sans text-text-primary">{tag}</span>
                    <span className="text-xs font-sans text-text-tertiary">{count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t border-border-subtle">
          <button
            onClick={() => {
              setViewMode("conversations");
              setListFilter("all");
              setSelectedTag(null);
              setSelectedConversationId(null);
            }}
            className={`w-full flex items-center gap-2 px-3 py-2 transition-colors relative ${
              viewMode === "conversations" &&
              !selectedTag &&
              listFilter === "all"
                ? "bg-bg-surface-card-hover"
                : "hover:bg-bg-surface-card"
            }`}
          >
            {viewMode === "conversations" &&
              !selectedTag &&
              listFilter === "all" && (
              <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-accent-primary" />
            )}
            <List strokeWidth={1.5} className="w-4 h-4 text-text-secondary" />
            <span className="flex-1 text-sm font-sans text-text-primary">All Conversations</span>
            <span className="text-xs font-sans text-text-tertiary">{conversations.length}</span>
          </button>
          <button
            onClick={() => {
              setViewMode("conversations");
              setListFilter("starred");
              setSelectedTag(null);
              setSelectedConversationId(null);
            }}
            className={`w-full flex items-center gap-2 px-3 py-2 transition-colors relative ${
              viewMode === "conversations" && listFilter === "starred"
                ? "bg-bg-surface-card-hover"
                : "hover:bg-bg-surface-card"
            }`}
          >
            {viewMode === "conversations" && listFilter === "starred" && (
              <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-accent-primary" />
            )}
            <Star strokeWidth={1.5} className="w-4 h-4 text-text-secondary" />
            <span className="flex-1 text-sm font-sans text-text-primary">Starred</span>
            <span className="text-xs font-sans text-text-tertiary">{starredCount}</span>
          </button>
        </div>

        {/* My Notes Entry */}
        <div className="mt-2">
          <button
            onClick={() => {
              setViewMode("notes");
              if (MOCK_NOTES.length > 0 && !selectedNoteId) {
                setSelectedNoteId(MOCK_NOTES[0].id);
              }
            }}
            className={`w-full flex items-center gap-2 px-3 py-2 transition-colors relative ${
              viewMode === "notes" ? "bg-bg-surface-card-hover" : "hover:bg-bg-surface-card"
            }`}
          >
            {viewMode === "notes" && (
              <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-accent-primary" />
            )}
            <BookOpen strokeWidth={1.5} className="w-4 h-4 text-text-secondary" />
            <span className="flex-1 text-sm font-sans text-text-primary">My Notes</span>
            <span className="text-xs font-sans text-text-tertiary">{MOCK_NOTES.length}</span>
          </button>
        </div>
      </aside>

      {/* Middle Column - Conversation/Note List (320px) */}
      <div className="w-[320px] bg-bg-tertiary flex flex-col">
        {viewMode === "conversations" ? (
          <>
            <div className="px-4 py-3 border-b border-border-subtle">
              <div className="flex items-baseline justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-serif font-normal text-text-primary">
                    {selectedTag
                        ? selectedTag
                      : listFilter === "starred"
                        ? "Starred"
                        : "All Conversations"}
                  </h2>
                  <span className="text-xs font-sans text-text-tertiary">
                    · {filteredConversations.length} conversations
                  </span>
                </div>
              </div>
            </div>

            {/* New Folder Button */}
            <div className="px-4 py-2 border-b border-[#EEECE5]">
              <button
                onClick={() => console.log("[dashboard] Create new folder")}
                className="text-[12px] font-sans text-text-tertiary hover:text-text-secondary transition-colors"
              >
                + New Folder
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-1.5 mt-2">
              {filteredConversations.map((conv) => {
                const isSelected = conv.id === selectedConversationId;
                return (
                  <button
                    key={conv.id}
                    onClick={() => setSelectedConversationId(conv.id)}
                    className={`w-full text-left p-3 rounded-lg transition-all duration-200 relative group ${
                      isSelected
                        ? "bg-bg-surface-card-active shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
                        : "bg-bg-surface-card hover:bg-bg-surface-card-hover hover:shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
                    }`}
                  >
                    <h3 className="text-sm font-sans font-medium text-text-primary mb-1.5 leading-snug line-clamp-1">
                      {conv.title}
                    </h3>
                    <div
                      className={`grid transition-[grid-template-rows,opacity] duration-150 ease-in-out ${
                        isSelected ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0 group-hover:opacity-100 group-hover:grid-rows-[1fr]"
                      }`}
                    >
                      <div className="overflow-hidden">
                        <p className="text-[13px] font-sans text-text-secondary leading-relaxed mb-2 line-clamp-2">
                          {conv.snippet}
                        </p>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className="px-2 py-0.5 rounded-md text-[11px] font-sans font-medium leading-none"
                            style={{
                              backgroundColor: platformBackgrounds[conv.platform],
                              color: platformColors[conv.platform],
                            }}
                          >
                            {conv.platform}
                          </span>
                          {normalizeTags(conv.tags).slice(0, 2).map((tag) => (
                            <span
                              key={tag}
                              className="px-2 py-0.5 rounded-full text-[11px] font-sans text-text-secondary bg-bg-secondary"
                            >
                              {tag}
                            </span>
                          ))}
                          <span className="ml-auto text-[11px] font-sans text-text-tertiary">
                            {formatTimeAgo(conv.updated_at)}
                          </span>
                          {conv.has_note && (
                            <span
                              title="Has notes"
                              style={{
                                display: "inline-block",
                                width: 6,
                                height: 6,
                                borderRadius: "50%",
                                backgroundColor: "#3266AD",
                                flexShrink: 0,
                              }}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <div className="px-4 py-3 border-b border-border-subtle">
              <div className="flex items-baseline justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-serif font-normal text-text-primary">My Notes</h2>
                  <span className="text-xs font-sans text-text-tertiary">· {MOCK_NOTES.length} notes</span>
                </div>
                <button
                  onClick={() => console.log("[dashboard] Create new note")}
                  className="px-3 py-1.5 text-[13px] font-sans font-medium text-text-primary bg-bg-surface-card hover:bg-bg-surface-card-hover rounded-md transition-colors"
                >
                  + New Note
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
              {MOCK_NOTES.map((note) => {
                const isSelected = note.id === selectedNoteId;
                const preview = note.content.replace(/[#*\[\]]/g, "").slice(0, 100);
                return (
                  <button
                    key={note.id}
                    onClick={() => setSelectedNoteId(note.id)}
                    className={`w-full text-left p-3 rounded-lg transition-all duration-200 relative group ${
                      isSelected
                        ? "bg-bg-surface-card-active shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
                        : "bg-bg-surface-card hover:bg-bg-surface-card-hover hover:shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
                    }`}
                  >
                    {isSelected && (
                      <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-accent-primary rounded-r" />
                    )}
                    <h3 className="text-sm font-sans font-medium text-text-primary mb-1.5 leading-snug">
                      {note.title}
                    </h3>
                    <p className="text-[13px] font-sans text-text-secondary leading-relaxed mb-2 line-clamp-2">
                      {preview}
                    </p>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {note.tags.slice(0, 2).map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 rounded-full text-[11px] font-sans text-text-secondary bg-bg-secondary"
                        >
                          {tag}
                        </span>
                      ))}
                      <span className="ml-auto text-[11px] font-sans text-text-tertiary">
                        {formatTimeAgo(note.updated_at)}
                      </span>
                      {note.linked_conversation_ids.length > 0 && (
                        <span
                          title={`Linked to ${note.linked_conversation_ids.length} conversation${
                            note.linked_conversation_ids.length > 1 ? "s" : ""
                          }`}
                          style={{
                            display: "inline-block",
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            backgroundColor: "#3266AD",
                            flexShrink: 0,
                          }}
                        />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Right Column - Reader/Editor (flex-1) */}
      {viewMode === "conversations" && selectedConversation && (
        <div className="flex-1 bg-bg-primary overflow-y-auto">
          <div className="max-w-3xl mx-auto px-8 py-6">
            {/* Block A - Header */}
            <div className="mb-6 border-b border-border-subtle pb-6">
              <h1 className="text-2xl font-serif font-normal text-text-primary mb-3 leading-tight">
                {selectedConversation.title}
              </h1>
              <div className="flex items-center gap-2 text-[13px] font-sans text-text-secondary mb-4">
                <span
                  className="px-2 py-0.5 rounded-md text-[11px] font-sans font-medium leading-none"
                  style={{
                    backgroundColor: platformBackgrounds[selectedConversation.platform],
                    color: platformColors[selectedConversation.platform],
                  }}
                >
                  {selectedConversation.platform}
                </span>
                <span>·</span>
                <span>{formatDate(messageDate)}</span>
                <span>·</span>
                <span>{messageCount} messages</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {activeTags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2.5 py-1 rounded-md text-[13px] font-sans text-text-secondary bg-bg-secondary"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            {/* Block B - Gardener Summary Card */}
            <div className="mb-6">
              <button
                onClick={() => setGardenerExpanded(!gardenerExpanded)}
                className="w-full p-3 rounded-lg bg-bg-surface-card hover:bg-bg-surface-card-hover transition-colors flex items-center justify-between"
              >
                <div className="flex items-center gap-2 text-sm font-sans">
                  {hasAnalysis ? (
                    <>
                      <Check strokeWidth={1.5} className="w-4 h-4 text-accent-primary" />
                      <span className="text-text-primary">Analyzed</span>
                      {activeTopicName && (
                        <>
                          <span className="text-text-tertiary">·</span>
                          <span className="text-text-tertiary">{activeTopicName}</span>
                        </>
                      )}
                      {activeTags.length > 0 && (
                        <>
                          <span className="text-text-tertiary">·</span>
                          <span className="text-text-tertiary">
                            {activeTags.join(", ")}
                          </span>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="text-text-tertiary">Not analyzed yet</span>
                    </>
                  )}
                </div>
                {gardenerExpanded ? (
                  <ChevronUp strokeWidth={1.5} className="w-4 h-4 text-text-tertiary" />
                ) : (
                  <ChevronDown strokeWidth={1.5} className="w-4 h-4 text-text-tertiary" />
                )}
              </button>

              {gardenerExpanded && (
                <div className="mt-3 p-4 rounded-lg bg-bg-surface-card text-sm font-sans text-text-tertiary">
                  Analysis runs automatically after capture. Step details are not stored yet.
                </div>
              )}
            </div>

            {/* Block C - Conversation Content */}
            <div className="prose prose-slate max-w-none">
              {messagesLoading && (
                <div className="text-[13px] font-sans text-text-tertiary">
                  Loading messages...
                </div>
              )}
              {!messagesLoading && messagesError && (
                <div className="text-[13px] font-sans text-text-tertiary">
                  Unable to load messages.
                </div>
              )}
              {!messagesLoading && !messagesError && messages.length === 0 && (
                <div className="text-[13px] font-sans text-text-tertiary">
                  No messages captured yet.
                </div>
              )}
              {visibleMessages.map((message) => {
                const isUser = message.role === "user";
                return (
                  <div key={message.id} className="mb-6">
                    {isUser ? (
                      <div className="text-[11px] font-sans text-text-tertiary uppercase tracking-wide mb-2">
                        You
                      </div>
                    ) : (
                      <span
                        className="inline-block px-2 py-0.5 rounded-md text-[11px] font-sans font-medium leading-none uppercase tracking-wide mb-2"
                        style={{
                          backgroundColor: platformBackgrounds[selectedConversation.platform],
                          color: platformColors[selectedConversation.platform],
                        }}
                      >
                        {selectedConversation.platform}
                      </span>
                    )}
                    <div
                      className={`text-base font-serif text-text-primary leading-relaxed whitespace-pre-wrap ${
                        isUser ? "" : "p-3 rounded-lg bg-bg-surface-ai-message"
                      }`}
                    >
                      {message.content_text}
                    </div>
                  </div>
                );
              })}
            </div>

            {canToggleMessages && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => setIsConversationExpanded((prev) => !prev)}
                  className="inline-flex items-center gap-1 text-[12px] font-sans text-text-tertiary hover:text-text-secondary transition-colors"
                >
                  {isConversationExpanded ? "Collapse" : "Expand"}
                  {isConversationExpanded ? (
                    <ChevronUp strokeWidth={1.5} className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown strokeWidth={1.5} className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            )}

            {/* Related Notes */}
            {selectedConversation && (
              <div className="mt-10">
                {MOCK_NOTES.filter((note) =>
                  note.linked_conversation_ids.includes(selectedConversation.id)
                ).length > 0 && (
                  <>
                    <h3 className="text-[11px] font-sans font-medium text-text-tertiary uppercase tracking-wider mb-4">
                      RELATED NOTES
                    </h3>
                    <div className="space-y-2">
                      {MOCK_NOTES.filter((note) =>
                        note.linked_conversation_ids.includes(selectedConversation.id)
                      ).map((note) => (
                        <button
                          key={note.id}
                          onClick={() => {
                            setViewMode("notes");
                            setSelectedNoteId(note.id);
                          }}
                          className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-bg-surface-card transition-colors group"
                        >
                          <span className="text-[13px] font-sans text-text-primary">
                            {note.title}
                          </span>
                          <span className="text-[13px] font-sans text-accent-primary">
                            Open →
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Related Conversations */}
            <div className="mt-12 pt-6 border-t border-border-subtle">
              <h3 className="text-[11px] font-sans font-medium text-text-tertiary uppercase tracking-wider mb-4">
                RELATED CONVERSATIONS
              </h3>
              <div className="space-y-2">
                {relatedLoading && (
                  <div className="text-[13px] font-sans text-text-tertiary">
                    Finding related conversations...
                  </div>
                )}
                {!relatedLoading && relatedConversations.length === 0 && (
                  <div className="text-[13px] font-sans text-text-tertiary">
                    {relatedError ? "Unable to load related conversations." : "No related conversations yet."}
                  </div>
                )}
                {!relatedLoading &&
                  relatedConversations.map((related) => (
                    <button
                      key={related.id}
                      onClick={() => switchToConversation(related.id)}
                      className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-bg-surface-card transition-colors group relative"
                    >
                      <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-accent-primary opacity-0 group-hover:opacity-100 transition-opacity rounded-r" />
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <span className="text-[13px] font-sans text-text-primary truncate">
                          {related.title}
                        </span>
                        <span
                          className="px-2 py-0.5 rounded-md text-[11px] font-sans font-medium leading-none flex-shrink-0"
                          style={{
                            backgroundColor: platformBackgrounds[related.platform],
                            color: platformColors[related.platform],
                          }}
                        >
                          {related.platform}
                        </span>
                      </div>
                      <span className="text-xs font-sans text-accent-primary font-medium">
                        {related.similarity}%
                      </span>
                    </button>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {viewMode === "notes" && selectedNote && (
        <div className="flex-1 bg-bg-primary overflow-y-auto">
          <div className="max-w-3xl mx-auto px-8 py-6">
            <div className="mb-4">
              {editingTitle ? (
                <input
                  ref={titleInputRef}
                  type="text"
                  value={noteTitle}
                  onChange={(e) => setNoteTitle(e.target.value)}
                  onBlur={() => setEditingTitle(false)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") setEditingTitle(false);
                    if (e.key === "Escape") {
                      setNoteTitle(selectedNote.title);
                      setEditingTitle(false);
                    }
                  }}
                  className="w-full text-2xl font-serif font-normal text-text-primary bg-transparent border-b border-accent-primary outline-none"
                />
              ) : (
                <h1
                  onClick={() => setEditingTitle(true)}
                  className="text-2xl font-serif font-normal text-text-primary cursor-text hover:opacity-70 transition-opacity"
                >
                  {noteTitle || selectedNote.title}
                </h1>
              )}
            </div>

            <div className="flex items-center gap-2 text-[13px] font-sans text-text-secondary mb-6 pb-6 border-b border-border-subtle">
              {selectedNote.tags.map((tag) => (
                <span
                  key={tag}
                  className="px-2.5 py-1 rounded-md text-[13px] font-sans text-text-secondary bg-bg-secondary"
                >
                  {tag}
                </span>
              ))}
              <span className="ml-auto">
                {noteSaveStatus === "unsaved"
                  ? "Unsaved changes"
                  : `Updated ${formatTimeAgo(selectedNote.updated_at)}`}
              </span>
            </div>

            <textarea
              ref={textareaRef}
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              placeholder="Start writing..."
              className="w-full bg-transparent border-none outline-none resize-none text-[13px] leading-[1.7] text-text-primary placeholder:text-text-tertiary mb-12"
              style={{
                fontFamily: "\"JetBrains Mono\", \"SF Mono\", Menlo, monospace",
                minHeight: "240px",
              }}
            />

            <div className="mt-8">
              <h3 className="text-[11px] font-sans font-medium text-text-tertiary uppercase tracking-wider mb-3">
                Linked Conversations
              </h3>
              {selectedNote.linked_conversation_ids.length > 0 ? (
                <div className="space-y-2">
                  {selectedNote.linked_conversation_ids.map((convId) => {
                    const conversation = conversations.find((c) => c.id === convId);
                    if (!conversation) return null;
                    return (
                      <div
                        key={convId}
                        className="w-full flex items-center justify-between p-3 rounded-lg bg-bg-surface-card hover:bg-bg-surface-card-hover transition-colors group"
                      >
                        <div>
                          <span className="text-sm font-sans text-text-primary block">
                            {conversation.title}
                          </span>
                          <span
                            className="px-2 py-0.5 rounded-md text-[11px] font-sans font-medium leading-none mt-1 inline-block"
                            style={{
                              backgroundColor: platformBackgrounds[conversation.platform],
                              color: platformColors[conversation.platform],
                            }}
                          >
                            {conversation.platform}
                          </span>
                        </div>
                        <button
                          onClick={() => switchToConversation(conversation.id)}
                          className="text-xs font-sans text-accent-primary flex items-center gap-1"
                        >
                          View
                          <ArrowRight strokeWidth={1.5} className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex items-center justify-between p-3 rounded-lg bg-bg-surface-card">
                  <span className="text-[13px] font-sans text-text-tertiary">No linked conversations</span>
                  <button
                    onClick={() => console.log("[dashboard] Link a conversation")}
                    className="text-xs font-sans text-accent-primary"
                  >
                    + Link a conversation
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
