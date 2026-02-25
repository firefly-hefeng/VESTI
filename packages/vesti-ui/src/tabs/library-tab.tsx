"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import {
  BookOpen,
  ChevronDown,
  List,
  Star,
  Check,
  ArrowRight,
  Clock,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import type {
  Conversation,
  Topic,
  StorageApi,
  RelatedConversation,
  Message,
  ChatSummaryData,
  Note,
} from "../types";
import { useLibraryData } from "../contexts/library-data";
import { PLATFORM_COLORS, PLATFORM_TEXT_COLORS } from "../constants/platform";
import { StructuredSummaryCard } from "../components/StructuredSummaryCard";
import { SummaryPipelineProgress } from "../components/SummaryPipelineProgress";
import type { PipelineStageState } from "../components/SummaryPipelineProgress";

type ViewMode = "conversations" | "notes";
type FolderItem = { name: string; isCustom: boolean; isTag: boolean };
type FolderMeta = { customFolders: string[] };

type LibraryTabProps = {
  storage: StorageApi;
  openConversationId?: number | null;
  onConversationOpened?: () => void;
};

export function LibraryTab({
  storage,
  openConversationId,
  onConversationOpened,
}: LibraryTabProps) {
  const { topics, conversations, refresh } = useLibraryData();
  const getRelatedConversations = storage.getRelatedConversations;
  const getMessages = storage.getMessages;
  const updateConversation = storage.updateConversation;
  const updateConversationTitle = storage.updateConversationTitle;
  const deleteConversation = storage.deleteConversation;
  const renameFolderTag = storage.renameFolderTag;
  const removeFolderTag = storage.removeFolderTag;
  const [viewMode, setViewMode] = useState<ViewMode>("conversations");
  const [selectedConversationId, setSelectedConversationId] = useState<number | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);
  const [listFilter, setListFilter] = useState<"all" | "starred" | "recent">("all");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [relatedConversations, setRelatedConversations] = useState<RelatedConversation[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [relatedError, setRelatedError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [isConversationExpanded, setIsConversationExpanded] = useState(false);
  const [, setAnalysisData] = useState<{
    summary?: string;
    keyInsights?: string[];
  } | null>(null);
  const [summaryData, setSummaryData] = useState<ChatSummaryData | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryGenerating, setSummaryGenerating] = useState(false);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [pipelineStages, setPipelineStages] = useState<PipelineStageState[]>([]);
  const [customFolders, setCustomFolders] = useState<string[]>([]);
  const [openConversationMenuId, setOpenConversationMenuId] = useState<number | null>(null);
  const [openFolderMenuName, setOpenFolderMenuName] = useState<string | null>(null);

  const [notes, setNotes] = useState<Note[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [hasLinkedNote, setHasLinkedNote] = useState(false);

  // Note editing state
  const [editingTitle, setEditingTitle] = useState(false);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [noteSaveStatus, setNoteSaveStatus] = useState<"saved" | "unsaved">("saved");
  const [isEditingNoteBody, setIsEditingNoteBody] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const FOLDER_META_KEY = "vesti_folder_meta";

  function getInitialStages(): PipelineStageState[] {
    return [
      {
        stage: "initiating_pipeline",
        label: "Initiating pipeline...",
        status: "pending",
      },
      {
        stage: "distilling_core_logic",
        label: "Extracting core question...",
        status: "pending",
      },
      {
        stage: "curating_summary",
        label: "Generating insights...",
        status: "pending",
      },
      {
        stage: "persisting_result",
        label: "Saving summary...",
        status: "pending",
      },
    ];
  }

  function isPipelineStageStatus(
    status: string
  ): status is PipelineStageState["status"] {
    return (
      status === "pending" ||
      status === "in_progress" ||
      status === "completed" ||
      status === "degraded_fallback"
    );
  }

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
    if (!selectedNoteId) return;
    const note = notes.find((n) => n.id === selectedNoteId);
    if (note) {
      setNoteTitle(note.title);
      setNoteContent(note.content);
      setIsEditingNoteBody(false);
    }
  }, [selectedNoteId, notes]);

  useEffect(() => {
    if (!storage.getNotes) return;
    setNotesLoading(true);
    storage
      .getNotes()
      .then((data) => setNotes(data))
      .catch(() => setNotes([]))
      .finally(() => setNotesLoading(false));
  }, [storage]);

  const persistFolderMeta = (nextCustom: string[]) => {
    setCustomFolders(nextCustom);
    if (typeof chrome === "undefined" || !chrome.storage?.local) return;
    chrome.storage.local.set(
      { [FOLDER_META_KEY]: { customFolders: nextCustom } },
      () => {
        void chrome.runtime?.lastError;
      }
    );
  };

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return;
    chrome.storage.local.get(FOLDER_META_KEY, (result) => {
      const meta = result?.[FOLDER_META_KEY] as FolderMeta | undefined;
      if (!meta) return;
      if (Array.isArray(meta.customFolders)) {
        setCustomFolders(meta.customFolders);
      }
    });
  }, []);

  useEffect(() => {
    if (!openConversationMenuId && !openFolderMenuName) return;
    const handleClick = () => {
      setOpenConversationMenuId(null);
      setOpenFolderMenuName(null);
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [openConversationMenuId, openFolderMenuName]);

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
    if (typeof openConversationId !== "number") return;
    if (openConversationId !== selectedConversationId) {
      setViewMode("conversations");
      setSelectedConversationId(openConversationId);
      setSelectedNoteId(null);
    }
    onConversationOpened?.();
  }, [openConversationId, selectedConversationId, onConversationOpened]);

  // TODO: replace with actual db read when teammate's analysis schema is confirmed
  // e.g. db.analyses.where('conversation_id').equals(selectedConversationId).first()
  useEffect(() => {
    setAnalysisData(null);
  }, [selectedConversationId]);

  useEffect(() => {
    if (!selectedConversationId || !storage.getSummary) {
      setSummaryData(null);
      return;
    }
    setSummaryLoading(true);
    storage
      .getSummary(selectedConversationId)
      .then((data) => setSummaryData(data))
      .catch(() => setSummaryData(null))
      .finally(() => setSummaryLoading(false));
  }, [selectedConversationId, storage]);

  useEffect(() => {
    setIsConversationExpanded(false);
    setSummaryExpanded(false);
  }, [selectedConversationId]);

  useEffect(() => {
    if (!selectedConversationId) {
      setHasLinkedNote(false);
      return;
    }
    setHasLinkedNote(
      notes.some((note) => note.linked_conversation_ids.includes(selectedConversationId))
    );
  }, [selectedConversationId, notes]);

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

  useEffect(() => {
    if (isEditingNoteBody && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isEditingNoteBody]);

  // Focus title input when editing
  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitle]);

  const selectedConversation = conversations.find((c) => c.id === selectedConversationId);
  const selectedNote = notes.find((n) => n.id === selectedNoteId);
  const messageCount = messages.length;
  const messageDate =
    messages.length > 0 ? messages[0].created_at : selectedConversation?.updated_at;
  const renderedNoteContent = useMemo(() => {
    if (!noteContent.trim()) return "";
    const html = marked.parse(noteContent, { gfm: true, breaks: false }) as string;
    return DOMPurify.sanitize(html);
  }, [noteContent]);
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
  const recentConversations = useMemo(() => {
    const sorted = [...conversations].sort((a, b) => b.updated_at - a.updated_at);
    return sorted.slice(0, 20);
  }, [conversations]);
  const folderItems = useMemo<FolderItem[]>(() => {
    const normalize = (value: string) => value.trim().toLowerCase();
    const used = new Set<string>();
    const items: FolderItem[] = [];

    const customSet = new Set(customFolders.map((name) => normalize(name)));

    for (const { tag } of tagCounts) {
      const key = normalize(tag);
      if (used.has(key)) continue;
      used.add(key);
      items.push({
        name: tag,
        isCustom: customSet.has(key),
        isTag: true,
      });
    }

    for (const name of customFolders) {
      const key = normalize(name);
      if (used.has(key)) continue;
      used.add(key);
      items.push({
        name,
        isCustom: true,
        isTag: false,
      });
    }

    return items;
  }, [tagCounts, customFolders]);

  const baseConversations =
    listFilter === "starred"
      ? conversations.filter((conversation) => conversation.is_starred)
      : listFilter === "recent"
        ? recentConversations
      : conversations;
  const tagFilteredConversations = selectedTag
    ? baseConversations.filter((conversation) =>
        normalizeTags(conversation.tags).includes(selectedTag)
      )
    : baseConversations;

  const filteredConversations = tagFilteredConversations;

  const handleCreateFolder = () => {
    const name = window.prompt("New folder name");
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const normalized = trimmed.toLowerCase();
    const exists = folderItems.some(
      (item) => item.name.trim().toLowerCase() === normalized
    );
    if (exists) {
      window.alert("A folder with that name already exists.");
      return;
    }
    const nextCustom = [...customFolders, trimmed];
    persistFolderMeta(nextCustom);
    setViewMode("conversations");
    setListFilter("all");
    setSelectedTag(trimmed);
    setSelectedConversationId(null);
  };

  const handleRenameFolder = async (item: FolderItem) => {
    const name = window.prompt("Rename folder", item.name);
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === item.name) return;
    const normalized = trimmed.toLowerCase();
    const exists = folderItems.some(
      (folder) =>
        folder.name.trim().toLowerCase() === normalized &&
        folder.name.trim().toLowerCase() !== item.name.trim().toLowerCase()
    );
    if (exists) {
      window.alert("A folder with that name already exists.");
      return;
    }

    const currentKey = item.name.trim().toLowerCase();
    const nextCustom = customFolders.map((folder) =>
      folder.trim().toLowerCase() === currentKey ? trimmed : folder
    );

    if (item.isTag) {
      if (!renameFolderTag) {
        window.alert("Renaming folders is not available yet.");
        return;
      }
      try {
        await renameFolderTag(item.name, trimmed);
        await refresh();
      } catch (error) {
        window.alert((error as Error)?.message ?? "Failed to rename folder.");
        return;
      }
    }

    persistFolderMeta(nextCustom);
    if (selectedTag?.trim().toLowerCase() === currentKey) {
      setSelectedTag(trimmed);
    }
  };

  const handleDeleteFolder = async (item: FolderItem) => {
    const confirmed = window.confirm(`Delete folder "${item.name}"?`);
    if (!confirmed) return;

    const currentKey = item.name.trim().toLowerCase();
    let nextCustom = customFolders.filter(
      (folder) => folder.trim().toLowerCase() !== currentKey
    );

    if (item.isTag) {
      if (!removeFolderTag) {
        window.alert("Deleting folders is not available yet.");
        return;
      }
      try {
        await removeFolderTag(item.name);
        await refresh();
      } catch (error) {
        window.alert((error as Error)?.message ?? "Failed to delete folder.");
        return;
      }
    }

    persistFolderMeta(nextCustom);
    if (selectedTag?.trim().toLowerCase() === currentKey) {
      setSelectedTag(null);
      setListFilter("all");
      setSelectedConversationId(null);
    }
  };

  const dedupeTagList = (tags: string[]) => {
    const seen = new Set<string>();
    const output: string[] = [];
    for (const tag of tags) {
      const normalized = tag.trim();
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(normalized);
    }
    return output;
  };

  const handleConversationStar = async (conversation: Conversation) => {
    if (!updateConversation) {
      window.alert("Starring is not available yet.");
      return;
    }
    try {
      await updateConversation(conversation.id, {
        is_starred: !conversation.is_starred,
      });
      await refresh();
    } catch (error) {
      window.alert((error as Error)?.message ?? "Failed to update star.");
    }
  };

  const handleConversationRename = async (conversation: Conversation) => {
    if (!updateConversationTitle) {
      window.alert("Renaming is not available yet.");
      return;
    }
    const name = window.prompt("Rename conversation", conversation.title);
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === conversation.title) return;
    try {
      await updateConversationTitle(conversation.id, trimmed);
      await refresh();
    } catch (error) {
      window.alert((error as Error)?.message ?? "Failed to rename conversation.");
    }
  };

  const handleConversationChangeFolder = async (conversation: Conversation) => {
    if (!updateConversation) {
      window.alert("Changing folders is not available yet.");
      return;
    }
    const name = window.prompt("Change folder", selectedTag ?? "");
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;

    const selectedKey = selectedTag?.trim().toLowerCase() ?? null;
    let nextTags = dedupeTagList(normalizeTags(conversation.tags));
    if (selectedKey) {
      nextTags = nextTags.filter(
        (tag) => tag.trim().toLowerCase() !== selectedKey
      );
    }
    nextTags = dedupeTagList([...nextTags, trimmed]).slice(0, 6);

    try {
      await updateConversation(conversation.id, { tags: nextTags });
      if (!customFolders.some((folder) => folder.trim().toLowerCase() === trimmed.toLowerCase())) {
        persistFolderMeta([...customFolders, trimmed]);
      }
      await refresh();
    } catch (error) {
      window.alert((error as Error)?.message ?? "Failed to change folder.");
    }
  };

  const handleConversationRemoveFromFolder = async (conversation: Conversation) => {
    if (!updateConversation) {
      window.alert("Removing from folder is not available yet.");
      return;
    }
    if (!selectedTag) {
      window.alert("Select a folder first.");
      return;
    }
    const selectedKey = selectedTag.trim().toLowerCase();
    let nextTags = dedupeTagList(normalizeTags(conversation.tags));
    nextTags = nextTags.filter((tag) => tag.trim().toLowerCase() !== selectedKey);
    try {
      await updateConversation(conversation.id, { tags: nextTags });
      await refresh();
    } catch (error) {
      window.alert((error as Error)?.message ?? "Failed to remove from folder.");
    }
  };

  const handleConversationDelete = async (conversation: Conversation) => {
    if (!deleteConversation) {
      window.alert("Delete is not available yet.");
      return;
    }
    const confirmed = window.confirm("Delete this conversation?");
    if (!confirmed) return;
    try {
      await deleteConversation(conversation.id);
      await refresh();
    } catch (error) {
      window.alert((error as Error)?.message ?? "Failed to delete conversation.");
    }
  };

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
  };

  const isAllActive =
    viewMode === "conversations" && !selectedTag && listFilter === "all";
  const isStarredActive =
    viewMode === "conversations" && listFilter === "starred";
  const isRecentActive =
    viewMode === "conversations" && listFilter === "recent";

  return (
    <div className="flex h-full">
      {/* Left Column - Sidebar (200px) */}
      <aside className="w-[200px] bg-bg-secondary flex flex-col">
        <div className="px-2 pt-3 pb-2">
          <button
            onClick={() => {
              setViewMode("conversations");
              setListFilter("all");
              setSelectedTag(null);
              setSelectedConversationId(null);
            }}
            className={`w-full flex items-center gap-2 px-3 py-2 transition-colors my-1 rounded-lg ${
              isAllActive ? "bg-accent-primary-light" : "hover:bg-bg-surface-card"
            }`}
          >
            <List
              strokeWidth={1.5}
              className={`w-4 h-4 ${isAllActive ? "text-accent-primary" : "text-text-secondary"}`}
            />
            <span
              className={`flex-1 text-sm font-sans ${
                isAllActive ? "text-accent-primary" : "text-text-primary"
              }`}
            >
              All Conversations
            </span>
            <span className="text-xs font-sans text-text-tertiary">{conversations.length}</span>
          </button>
          <button
            onClick={() => {
              setViewMode("conversations");
              setListFilter("starred");
              setSelectedTag(null);
              setSelectedConversationId(null);
            }}
            className={`w-full flex items-center gap-2 px-3 py-2 transition-colors my-1 rounded-lg ${
              isStarredActive ? "bg-accent-primary-light" : "hover:bg-bg-surface-card"
            }`}
          >
            <Star
              strokeWidth={1.5}
              className={`w-4 h-4 ${isStarredActive ? "text-accent-primary" : "text-text-secondary"}`}
            />
            <span
              className={`flex-1 text-sm font-sans ${
                isStarredActive ? "text-accent-primary" : "text-text-primary"
              }`}
            >
              Starred
            </span>
            <span className="text-xs font-sans text-text-tertiary">{starredCount}</span>
          </button>
          <button
            onClick={() => {
              setViewMode("conversations");
              setListFilter("recent");
              setSelectedTag(null);
              setSelectedConversationId(null);
            }}
            className={`w-full flex items-center gap-2 px-3 py-2 transition-colors my-1 rounded-lg ${
              isRecentActive ? "bg-accent-primary-light" : "hover:bg-bg-surface-card"
            }`}
          >
            <Clock
              strokeWidth={1.5}
              className={`w-4 h-4 ${isRecentActive ? "text-accent-primary" : "text-text-secondary"}`}
            />
            <span
              className={`flex-1 text-sm font-sans ${
                isRecentActive ? "text-accent-primary" : "text-text-primary"
              }`}
            >
              Recent
            </span>
            <span className="text-xs font-sans text-text-tertiary">{recentConversations.length}</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2">
          <div className="flex items-center justify-between px-2 py-2">
            <span className="text-[10px] font-sans font-semibold text-text-tertiary uppercase tracking-wider">
              Folders
            </span>
            <button
              onClick={handleCreateFolder}
              className="w-5 h-5 rounded-md flex items-center justify-center text-text-tertiary hover:text-text-secondary hover:bg-bg-surface-card transition-colors"
              aria-label="Create new folder"
              title="New folder"
            >
              +
            </button>
          </div>
          {folderItems.length > 0 && (
            <div className="flex flex-col">
              {folderItems.map((folder) => {
                const isSelected = selectedTag === folder.name;
                return (
                  <div
                    key={folder.name}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setViewMode("conversations");
                      setListFilter("all");
                      setSelectedTag(folder.name);
                      setSelectedConversationId(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setViewMode("conversations");
                        setListFilter("all");
                        setSelectedTag(folder.name);
                        setSelectedConversationId(null);
                      }
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors duration-200 my-1 rounded-lg group cursor-pointer relative ${
                      isSelected && viewMode === "conversations"
                        ? "bg-bg-surface-card-active"
                        : "hover:bg-bg-surface-card"
                    }`}
                  >
                    <span className="flex-1 text-sm font-sans text-text-primary truncate">
                      {folder.name}
                    </span>
                    <div className="ml-2 flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setOpenFolderMenuName((prev) =>
                            prev === folder.name ? null : folder.name
                          );
                        }}
                        className="w-5 h-5 rounded-md flex items-center justify-center text-text-tertiary hover:text-text-secondary hover:bg-bg-surface-card"
                        title="Folder actions"
                        aria-label={`Folder actions for ${folder.name}`}
                      >
                        <MoreHorizontal strokeWidth={1.5} className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {openFolderMenuName === folder.name && (
                      <div
                        className="absolute right-2 top-9 z-30 w-44 rounded-md border border-border-subtle bg-bg-primary shadow-[0_8px_24px_rgba(0,0,0,0.08)] py-1"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            void handleRenameFolder(folder);
                            setOpenFolderMenuName(null);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-[13px] font-sans text-text-primary hover:bg-bg-surface-card transition-colors"
                        >
                          <Pencil strokeWidth={1.5} className="w-4 h-4" />
                          <span>Rename</span>
                        </button>
                        <div className="my-1 h-px bg-border-subtle" />
                        <button
                          type="button"
                          onClick={() => {
                            void handleDeleteFolder(folder);
                            setOpenFolderMenuName(null);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-[13px] font-sans text-[#B42318] hover:bg-bg-surface-card transition-colors"
                        >
                          <Trash2 strokeWidth={1.5} className="w-4 h-4" />
                          <span>Delete</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t border-border-subtle px-2 py-2">
          <button
            onClick={() => {
              setViewMode("notes");
              if (notes.length > 0 && !selectedNoteId) {
                setSelectedNoteId(notes[0].id);
              }
            }}
            className={`w-full flex items-center gap-2 px-3 py-2 transition-colors my-1 rounded-lg ${
              viewMode === "notes" ? "bg-bg-surface-card-active" : "hover:bg-bg-surface-card"
            }`}
          >
            <BookOpen strokeWidth={1.5} className="w-4 h-4 text-text-secondary" />
            <span className="flex-1 text-sm font-sans text-text-primary">My Notes</span>
            <span className="text-xs font-sans text-text-tertiary">{notes.length}</span>
          </button>
        </div>
      </aside>

      {/* Middle Column - Conversation/Note List (320px) */}
      <div className="w-[320px] bg-bg-tertiary flex flex-col">
        {viewMode === "conversations" ? (
          <>
            <div className="px-4 py-3">
              <div className="flex items-baseline justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-serif font-normal text-text-primary">
                    {selectedTag
                        ? selectedTag
                      : listFilter === "starred"
                        ? "Starred"
                        : listFilter === "recent"
                          ? "Recent"
                        : "All Conversations"}
                  </h2>
                  <span className="text-xs font-sans text-text-tertiary">
                    · {filteredConversations.length} conversations
                  </span>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-1.5 mt-2">
              {filteredConversations.map((conv) => {
                const isSelected = conv.id === selectedConversationId;
                return (
                  <div
                    key={conv.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedConversationId(conv.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedConversationId(conv.id);
                      }
                    }}
                    className={`w-full text-left p-3 rounded-lg transition-all duration-200 relative group cursor-pointer ${
                      isSelected
                        ? "bg-bg-surface-card-active shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
                        : "bg-bg-surface-card hover:bg-bg-surface-card-hover hover:shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedConversationId(conv.id);
                        setOpenConversationMenuId((prev) =>
                          prev === conv.id ? null : conv.id
                        );
                      }}
                      className="absolute right-2 top-2 w-7 h-7 rounded-md flex items-center justify-center text-text-tertiary hover:text-text-secondary hover:bg-bg-surface-card transition-colors opacity-0 group-hover:opacity-100"
                      aria-label="Conversation actions"
                    >
                      <MoreHorizontal strokeWidth={1.5} className="w-4 h-4" />
                    </button>
                    {openConversationMenuId === conv.id && (
                      <div
                        className="absolute right-2 top-10 z-30 w-52 rounded-md border border-border-subtle bg-bg-primary shadow-[0_8px_24px_rgba(0,0,0,0.08)] py-1"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            void handleConversationStar(conv);
                            setOpenConversationMenuId(null);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-[13px] font-sans text-text-primary hover:bg-bg-surface-card transition-colors"
                        >
                          <Star strokeWidth={1.5} className="w-4 h-4" />
                          <span>{conv.is_starred ? "Unstar" : "Star"}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void handleConversationRename(conv);
                            setOpenConversationMenuId(null);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-[13px] font-sans text-text-primary hover:bg-bg-surface-card transition-colors"
                        >
                          <Pencil strokeWidth={1.5} className="w-4 h-4" />
                          <span>Rename</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void handleConversationChangeFolder(conv);
                            setOpenConversationMenuId(null);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-[13px] font-sans text-text-primary hover:bg-bg-surface-card transition-colors"
                        >
                          <ArrowRight strokeWidth={1.5} className="w-4 h-4" />
                          <span>Change folder</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void handleConversationRemoveFromFolder(conv);
                            setOpenConversationMenuId(null);
                          }}
                          disabled={!selectedTag}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-[13px] font-sans transition-colors ${
                            selectedTag
                              ? "text-text-primary hover:bg-bg-surface-card"
                              : "text-text-tertiary cursor-not-allowed"
                          }`}
                        >
                          <X strokeWidth={1.5} className="w-4 h-4" />
                          <span>Remove from folder</span>
                        </button>
                        <div className="my-1 h-px bg-border-subtle" />
                        <button
                          type="button"
                          onClick={() => {
                            void handleConversationDelete(conv);
                            setOpenConversationMenuId(null);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-[13px] font-sans text-[#B42318] hover:bg-bg-surface-card transition-colors"
                        >
                          <Trash2 strokeWidth={1.5} className="w-4 h-4" />
                          <span>Delete</span>
                        </button>
                      </div>
                    )}
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
                              backgroundColor: PLATFORM_COLORS[conv.platform],
                              color: PLATFORM_TEXT_COLORS[conv.platform],
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
                  </div>
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
                  <span className="text-xs font-sans text-text-tertiary">· {notes.length} notes</span>
                </div>
                <button
                  onClick={async () => {
                    if (!storage.saveNote) return;
                    try {
                      const newNote = await storage.saveNote({
                        title: "New Note",
                        content: "",
                        linked_conversation_ids: selectedConversationId
                          ? [selectedConversationId]
                          : [],
                      });
                      setNotes((prev) => [newNote, ...prev]);
                      setSelectedNoteId(newNote.id);
                      setViewMode("notes");
                    } catch (error) {
                      console.error("[library] New Note failed", error);
                    }
                  }}
                  className="px-3 py-1.5 text-[13px] font-sans font-medium text-text-primary bg-bg-surface-card hover:bg-bg-surface-card-hover rounded-md transition-colors"
                >
                  + New Note
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
              {notesLoading && notes.length === 0 ? (
                <div className="text-[13px] font-sans text-text-tertiary">
                  Loading notes...
                </div>
              ) : (
                notes.map((note) => {
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
                      <h3 className="text-sm font-sans font-medium text-text-primary mb-1.5 leading-snug">
                        {note.title}
                      </h3>
                      <div
                        className={`grid transition-[grid-template-rows,opacity] duration-150 ease-in-out ${
                          isSelected
                            ? "grid-rows-[1fr] opacity-100"
                            : "grid-rows-[0fr] opacity-0 group-hover:opacity-100 group-hover:grid-rows-[1fr]"
                        }`}
                      >
                        <div className="overflow-hidden">
                          <p className="text-[13px] font-sans text-text-secondary leading-relaxed mb-2 line-clamp-2">
                            {preview}
                          </p>
                          <div className="flex items-center gap-1.5 flex-wrap">
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
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
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
                    backgroundColor: PLATFORM_COLORS[selectedConversation.platform],
                    color: PLATFORM_TEXT_COLORS[selectedConversation.platform],
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
              <div className="rounded-lg bg-bg-surface-card overflow-hidden">
                <div className="w-full p-3 flex items-center justify-between">
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
                      <span className="text-text-tertiary">Not analyzed yet</span>
                    )}
                  </div>
                </div>

                <div className="border-t border-border-subtle" />

                {/* Summary 区域 */}
                <div className="p-4">
                  {summaryLoading ? (
                    <p className="text-[13px] font-sans text-text-tertiary">
                      Loading summary...
                    </p>
                  ) : summaryData ? (
                    <div>
                      <button
                        type="button"
                        onClick={() => setSummaryExpanded((prev) => !prev)}
                        className="w-full flex items-center justify-between py-1 text-[13px]
                   font-sans text-text-secondary hover:text-text-primary
                   transition-colors duration-150"
                      >
                        <span className="font-medium">{summaryData.meta?.title || "Summary"}</span>
                        <ChevronDown
                          className={`w-4 h-4 transition-transform duration-200 ${
                            summaryExpanded ? "rotate-180" : ""
                          }`}
                          strokeWidth={1.75}
                        />
                      </button>
                      <div
                        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out ${
                          summaryExpanded
                            ? "grid-rows-[1fr] opacity-100 mt-3"
                            : "grid-rows-[0fr] opacity-0"
                        }`}
                      >
                        <div className="overflow-hidden">
                          <StructuredSummaryCard data={summaryData} compact />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      <p className="text-[13px] font-sans text-text-tertiary leading-relaxed">
                        No summary yet. Generate one to see structured insights.
                      </p>
                      {storage.generateSummary && (
                        <>
                          {summaryGenerating && pipelineStages.length > 0 && (
                            <SummaryPipelineProgress stages={pipelineStages} />
                          )}
                          <button
                            type="button"
                            disabled={summaryGenerating}
                            onClick={async () => {
                              if (!selectedConversationId || !storage.generateSummary) return;
                              setSummaryGenerating(true);
                              setPipelineStages(getInitialStages());
                              setPipelineStages((prev) =>
                                prev.map((stage, index) =>
                                  index === 0
                                    ? { ...stage, status: "in_progress" }
                                    : stage
                                )
                              );

                              let progressListener:
                                | ((
                                    message: unknown,
                                    _sender: chrome.runtime.MessageSender,
                                    _sendResponse: (response?: unknown) => void
                                  ) => void)
                                | null = null;

                              try {
                                if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
                                  progressListener = (message) => {
                                    if (!message || typeof message !== "object") return;
                                    const maybeMessage = message as {
                                      type?: unknown;
                                      payload?: { stage?: unknown; status?: unknown };
                                    };
                                    if (maybeMessage.type !== "INSIGHT_PIPELINE_PROGRESS") return;

                                    const stage = maybeMessage.payload?.stage;
                                    const status = maybeMessage.payload?.status;
                                    if (typeof stage !== "string" || typeof status !== "string") {
                                      return;
                                    }
                                    if (!isPipelineStageStatus(status)) {
                                      return;
                                    }

                                    setPipelineStages((prev) => {
                                      const currentIdx = prev.findIndex((item) => item.stage === stage);
                                      if (currentIdx === -1) return prev;

                                      return prev.map((item, idx) => {
                                        if (item.stage === stage) {
                                          return { ...item, status };
                                        }
                                        if (status === "completed" && idx === currentIdx + 1) {
                                          return { ...item, status: "in_progress" };
                                        }
                                        return item;
                                      });
                                    });
                                  };
                                  chrome.runtime.onMessage.addListener(progressListener);
                                } else {
                                  const simulateProgress = async () => {
                                    const stages = getInitialStages().map((item) => item.stage);
                                    for (let i = 0; i < stages.length; i += 1) {
                                      await new Promise((resolve) => {
                                        setTimeout(resolve, 600);
                                      });
                                      setPipelineStages((prev) =>
                                        prev.map((stage, idx) => ({
                                          ...stage,
                                          status:
                                            idx < i
                                              ? "completed"
                                              : idx === i
                                                ? "in_progress"
                                                : "pending",
                                        }))
                                      );
                                    }
                                  };
                                  void simulateProgress();
                                }

                                const data = await storage.generateSummary(selectedConversationId);
                                setPipelineStages((prev) =>
                                  prev.map((stage) => ({ ...stage, status: "completed" }))
                                );
                                setSummaryData(data);
                                setSummaryExpanded(true);
                              } catch (error) {
                                console.error("[library] generateSummary failed", error);
                                setPipelineStages((prev) =>
                                  prev.map((stage) =>
                                    stage.status === "in_progress"
                                      ? { ...stage, status: "degraded_fallback" }
                                      : stage
                                  )
                                );
                              } finally {
                                if (
                                  progressListener &&
                                  typeof chrome !== "undefined" &&
                                  chrome.runtime?.onMessage
                                ) {
                                  chrome.runtime.onMessage.removeListener(progressListener);
                                }
                                setSummaryGenerating(false);
                              }
                            }}
                            className="self-start inline-flex items-center gap-1.5 px-3 py-1.5
                             rounded-md text-[13px] font-sans text-text-secondary
                             hover:text-accent-primary hover:bg-accent-primary-light
                             transition-colors duration-150 disabled:opacity-50
                             disabled:cursor-not-allowed"
                          >
                            Generate Summary
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* 操作栏 */}
                <div className="px-4 pb-3 flex items-center gap-2 border-t border-border-subtle pt-3">
                  {storage.generateSummary && summaryData && (
                    <button
                      type="button"
                      disabled={summaryGenerating}
                      onClick={async () => {
                        if (!selectedConversationId || !storage.generateSummary) return;
                        setSummaryData(null);
                        setSummaryExpanded(false);
                        setSummaryGenerating(true);
                        setPipelineStages(getInitialStages());
                        setPipelineStages((prev) =>
                          prev.map((stage, index) =>
                            index === 0 ? { ...stage, status: "in_progress" } : stage
                          )
                        );
                        try {
                          const data = await storage.generateSummary(selectedConversationId);
                          setPipelineStages((prev) =>
                            prev.map((stage) => ({ ...stage, status: "completed" }))
                          );
                          setSummaryData(data);
                          setSummaryExpanded(true);
                        } catch (error) {
                          console.error("[library] regenerateSummary failed", error);
                          setPipelineStages((prev) =>
                            prev.map((stage) =>
                              stage.status === "in_progress"
                                ? { ...stage, status: "degraded_fallback" }
                                : stage
                            )
                          );
                        } finally {
                          setSummaryGenerating(false);
                        }
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md
                 text-[13px] font-sans text-text-secondary
                 hover:text-accent-primary hover:bg-accent-primary-light
                 transition-colors duration-150 disabled:opacity-50
                 disabled:cursor-not-allowed"
                    >
                      <RefreshCw className="w-3.5 h-3.5" strokeWidth={1.75} />
                      Regenerate
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={async () => {
                      if (!selectedConversationId || !storage.saveNote) return;
                      const title = selectedConversation?.title ?? "Untitled";
                      const content = summaryData
                        ? [
                            `## ${summaryData.core_question}`,
                            "",
                            "### Thinking Journey",
                            ...summaryData.thinking_journey.map(
                              (item) =>
                                `**Step ${item.step} · ${item.speaker}**: ${item.assertion}${
                                  item.real_world_anchor ? `\n> ${item.real_world_anchor}` : ""
                                }`
                            ),
                            "",
                            "### Key Insights",
                            ...summaryData.key_insights.map(
                              (item) => `**${item.term}**: ${item.definition}`
                            ),
                            "",
                            "### Unresolved Threads",
                            ...summaryData.unresolved_threads.map((item) => `- ${item}`),
                            "",
                            "### Next Steps",
                            ...summaryData.actionable_next_steps.map((item) => `- ${item}`),
                          ].join("\n")
                        : `Notes for: ${title}`;
                      try {
                        const newNote = await storage.saveNote({
                          title,
                          content,
                          linked_conversation_ids: [selectedConversationId],
                        });
                        setNotes((prev) => [newNote, ...prev]);
                        setHasLinkedNote(true);
                        setSelectedNoteId(newNote.id);
                        setViewMode("notes");
                      } catch (error) {
                        console.error("[library] saveNote failed", error);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-sans
                      text-text-secondary hover:text-accent-primary hover:bg-accent-primary-light
                      transition-colors duration-150"
                  >
                    <BookOpen strokeWidth={1.5} className="w-3.5 h-3.5" />
                    Import to Notes
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      // TODO: navigate to linked note
                      // 当 has_note 为 true 时跳转到对应笔记
                      const linkedNote = notes.find((n) =>
                        n.linked_conversation_ids.includes(selectedConversationId ?? -1)
                      );
                      if (linkedNote) {
                        setViewMode("notes");
                        setSelectedNoteId(linkedNote.id);
                      } else {
                        console.log("[library] no linked note yet");
                      }
                    }}
                    disabled={!hasLinkedNote}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-sans
                      transition-colors duration-150
                      ${hasLinkedNote
                        ? "text-text-secondary hover:text-accent-primary hover:bg-accent-primary-light"
                        : "text-text-tertiary cursor-not-allowed opacity-50"
                      }`}
                  >
                    <ArrowRight strokeWidth={1.5} className="w-3.5 h-3.5" />
                    View Note
                  </button>
                </div>
              </div>
            </div>

            {/* Block C - Conversation Preview */}
            <div className="mt-6">
              {/* 默认预览条 - 折叠时显示 */}
              {!isConversationExpanded && (
                <div className="flex items-start justify-between gap-4">
                  <p className="text-[13px] font-sans text-text-secondary leading-relaxed line-clamp-2 flex-1">
                    {messagesLoading
                      ? "Loading..."
                      : messages.length === 0
                        ? "No messages captured yet."
                        : `${messages[0]?.content_text?.slice(0, 120) ?? ""}${
                            (messages[0]?.content_text?.length ?? 0) > 120 ? "..." : ""
                          }`}
                  </p>
                  {messageCount > 1 && (
                    <button
                      type="button"
                      onClick={() => setIsConversationExpanded((prev) => !prev)}
                      className="shrink-0 text-[12px] font-sans text-text-tertiary hover:text-text-secondary transition-colors whitespace-nowrap"
                    >
                      Show all {messageCount} messages ↓
                    </button>
                  )}
                </div>
              )}

              {/* 展开后的完整消息流 */}
              <div
                className={`transition-all duration-300 ease-in-out overflow-hidden ${
                  isConversationExpanded
                    ? "opacity-100 mt-6"
                    : "max-h-0 opacity-0 pointer-events-none"
                }`}
              >
                <div
                  className="rounded-lg bg-bg-surface-card border border-border-subtle p-4 max-h-[440px] overflow-y-auto"
                  style={{ scrollbarGutter: "stable" }}
                >
                  {messageCount > 1 && (
                    <div className="sticky top-0 z-10 flex justify-end bg-bg-surface-card pb-2">
                      <button
                        type="button"
                        onClick={() => setIsConversationExpanded(false)}
                        className="text-[12px] font-sans text-text-tertiary hover:text-text-secondary transition-colors whitespace-nowrap"
                      >
                        Hide ↑
                      </button>
                    </div>
                  )}
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
                  {messages.map((message) => {
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
                              backgroundColor: PLATFORM_COLORS[selectedConversation.platform],
                              color: PLATFORM_TEXT_COLORS[selectedConversation.platform],
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
                </div>
              </div>
            </div>

            {/* Related Notes */}
            {selectedConversation && (
              <div className="mt-10">
                {notes.filter((note) =>
                  note.linked_conversation_ids.includes(selectedConversation.id)
                ).length > 0 && (
                  <>
                    <h3 className="text-[11px] font-sans font-medium text-text-tertiary uppercase tracking-wider mb-4">
                      RELATED NOTES
                    </h3>
                    <div className="space-y-2">
                      {notes.filter((note) =>
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
                      className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-bg-surface-card transition-colors"
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <span className="text-[13px] font-sans text-text-primary truncate">
                          {related.title}
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

            <div className="flex items-center text-[13px] font-sans text-text-secondary mb-6 pb-6 border-b border-border-subtle">
              <span className="ml-auto">
                {noteSaveStatus === "unsaved"
                  ? "Unsaved changes"
                  : `Updated ${formatTimeAgo(selectedNote.updated_at)}`}
              </span>
            </div>

            {isEditingNoteBody ? (
              <textarea
                ref={textareaRef}
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                onBlur={async () => {
                  setIsEditingNoteBody(false);
                  if (!selectedNote || !storage.updateNote) return;
                  try {
                    const updated = await storage.updateNote(selectedNote.id, {
                      content: noteContent,
                    });
                    setNotes((prev) =>
                      prev.map((note) => (note.id === updated.id ? updated : note))
                    );
                  } catch (error) {
                    console.error("[library] updateNote failed", error);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && event.metaKey) {
                    event.preventDefault();
                    setIsEditingNoteBody(false);
                  }
                }}
                placeholder="Start writing..."
                className="w-full bg-transparent border-none outline-none resize-none text-[13px] leading-[1.7] text-text-primary placeholder:text-text-tertiary mb-12"
                style={{
                  fontFamily: "\"JetBrains Mono\", \"SF Mono\", Menlo, monospace",
                  minHeight: "240px",
                }}
              />
            ) : (
              <div
                role="button"
                tabIndex={0}
                onClick={() => setIsEditingNoteBody(true)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setIsEditingNoteBody(true);
                  }
                }}
                className="mb-12 cursor-text"
                style={{ minHeight: "240px" }}
              >
                {renderedNoteContent ? (
                  <div
                    className="prose prose-slate max-w-none text-text-primary"
                    dangerouslySetInnerHTML={{ __html: renderedNoteContent }}
                  />
                ) : (
                  <div className="text-[13px] font-sans text-text-tertiary">
                    Start writing...
                  </div>
                )}
              </div>
            )}

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
                      <button
                        key={convId}
                        onClick={() => switchToConversation(conversation.id)}
                        className="w-full flex items-center justify-between p-3 rounded-lg bg-bg-surface-card hover:bg-bg-surface-card-hover transition-colors"
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <span className="text-[13px] font-sans text-text-primary truncate">
                            {conversation.title}
                          </span>
                        </div>
                        <span className="text-xs font-sans text-accent-primary font-medium">
                          Preview →
                        </span>
                      </button>
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
