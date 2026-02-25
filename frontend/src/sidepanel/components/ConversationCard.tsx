import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  Check,
  Copy,
  ExternalLink,
  FolderOpen,
  MessageSquare,
  Pencil,
  Star,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { resolveTurnCount } from "~lib/capture/turn-metrics";
import type { Conversation } from "~lib/types";
import { updateConversationAndSync } from "~lib/services/syncActions";
import { PlatformTag } from "./PlatformTag";

const TOOLTIP_DELAY_MS = 200;
const COPY_FEEDBACK_MS = 1500;
const MAX_TITLE_LENGTH = 120;

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

interface ActionIconButtonProps {
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  tone?: "default" | "danger";
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}

function ActionIconButton({
  label,
  icon,
  disabled = false,
  tone = "default",
  onClick,
}: ActionIconButtonProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const startTooltip = () => {
    if (disabled) return;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      setShowTooltip(true);
    }, TOOLTIP_DELAY_MS);
  };

  const stopTooltip = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setShowTooltip(false);
  };

  const toneClass =
    tone === "danger"
      ? "hover:bg-danger/10 hover:text-danger"
      : "hover:bg-accent-primary-light hover:text-accent-primary";

  return (
    <div className="relative flex items-center">
      <button
        type="button"
        aria-label={label}
        title={label}
        disabled={disabled}
        onClick={onClick}
        onMouseEnter={startTooltip}
        onMouseLeave={stopTooltip}
        onFocus={startTooltip}
        onBlur={stopTooltip}
        className={`flex h-6 w-6 items-center justify-center rounded-sm text-text-tertiary transition-[opacity,colors] [transition-duration:120ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus ${
          disabled
            ? "cursor-not-allowed opacity-35"
            : `opacity-60 group-hover:opacity-100 hover:opacity-100 focus-visible:opacity-100 ${toneClass}`
        }`}
      >
        {icon}
      </button>
      {showTooltip && (
        <div className="pointer-events-none absolute bottom-full right-0 z-20 mb-1 whitespace-nowrap rounded-sm bg-text-primary px-2 py-1 text-[10px] text-white shadow-popover">
          {label}
        </div>
      )}
    </div>
  );
}

interface ConversationCardProps {
  conversation: Conversation;
  onClick: () => void;
  onCopyFullText?: (conversation: Conversation) => Promise<boolean>;
  onOpenSource?: (conversation: Conversation) => void;
  onDelete?: (id: number) => Promise<void> | void;
  onRenameTitle?: (id: number, title: string) => Promise<boolean>;
  topicOptions?: { id: number; label: string }[];
  onConversationUpdated?: (conversation: Conversation) => void;
  matchedInMessagesOnly?: boolean;
}

export function ConversationCard({
  conversation,
  onClick,
  onCopyFullText,
  onOpenSource,
  onDelete,
  onRenameTitle,
  topicOptions = [],
  onConversationUpdated,
  matchedInMessagesOnly = false,
}: ConversationCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(conversation.title);
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const copyFeedbackTimerRef = useRef<number | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const skipBlurSaveRef = useRef(false);
  const saveInFlightRef = useRef(false);
  const hasSourceUrl = conversation.url.trim().length > 0;
  const turnCount = resolveTurnCount(
    conversation.turn_count,
    conversation.message_count
  );

  useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isEditingTitle) {
      setDraftTitle(conversation.title);
    }
  }, [conversation.title, isEditingTitle]);

  useEffect(() => {
    if (!isEditingTitle) return;
    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, [isEditingTitle]);

  const handleCopy = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!onCopyFullText) return;
    try {
      const ok = await onCopyFullText(conversation);
      if (!ok) return;
      setCopied(true);
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current);
      }
      copyFeedbackTimerRef.current = window.setTimeout(() => {
        setCopied(false);
      }, COPY_FEEDBACK_MS);
    } catch {
      setCopied(false);
    }
  };

  const handleOpenSource = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!hasSourceUrl) return;
    if (onOpenSource) {
      onOpenSource(conversation);
      return;
    }
    window.open(conversation.url, "_blank", "noopener,noreferrer");
  };

  const handleDelete = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    await onDelete?.(conversation.id);
  };

  const cancelTitleEdit = useCallback(() => {
    setDraftTitle(conversation.title);
    setIsEditingTitle(false);
    setIsSavingTitle(false);
    skipBlurSaveRef.current = false;
    saveInFlightRef.current = false;
  }, [conversation.title]);

  const commitTitleEdit = useCallback(async () => {
    if (!isEditingTitle || isSavingTitle || saveInFlightRef.current) return;

    const trimmedTitle = draftTitle.trim();
    if (!trimmedTitle || trimmedTitle.length > MAX_TITLE_LENGTH) {
      cancelTitleEdit();
      return;
    }

    if (trimmedTitle === conversation.title) {
      setIsEditingTitle(false);
      skipBlurSaveRef.current = false;
      return;
    }

    if (!onRenameTitle) {
      cancelTitleEdit();
      return;
    }

    saveInFlightRef.current = true;
    setIsSavingTitle(true);
    try {
      const saved = await onRenameTitle(conversation.id, trimmedTitle);
      if (!saved) {
        cancelTitleEdit();
        return;
      }
      setIsEditingTitle(false);
    } catch (error) {
      console.error("Failed to rename conversation title", error);
      cancelTitleEdit();
    } finally {
      saveInFlightRef.current = false;
      setIsSavingTitle(false);
      skipBlurSaveRef.current = false;
    }
  }, [
    cancelTitleEdit,
    conversation.id,
    conversation.title,
    draftTitle,
    isEditingTitle,
    isSavingTitle,
    onRenameTitle,
  ]);

  const handleStartTitleEdit = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (isSavingTitle) return;
    setDraftTitle(conversation.title);
    setIsEditingTitle(true);
  };

  const handleToggleStar = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    try {
      const updated = await updateConversationAndSync(conversation.id, {
        is_starred: !conversation.is_starred,
      });
      onConversationUpdated?.(updated);
    } catch (error) {
      console.error("Failed to update star status", error);
    }
  };

  const handleTopicChange = async (event: ChangeEvent<HTMLSelectElement>) => {
    event.stopPropagation();
    const value = event.target.value;
    const nextTopicId = value ? Number(value) : null;

    try {
      const updated = await updateConversationAndSync(conversation.id, {
        topic_id: Number.isNaN(nextTopicId) ? null : nextTopicId,
      });
      onConversationUpdated?.(updated);
    } catch (error) {
      console.error("Failed to update topic assignment", error);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onFocus={() => setIsHovered(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsHovered(false);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`group w-full cursor-pointer rounded-md p-3 text-left transition-all duration-150 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus ${
        isHovered ? "bg-surface-card-hover shadow-card-hover" : "bg-surface-card"
      }`}
    >
      <div className="flex items-center justify-between">
        <PlatformTag platform={conversation.platform} />
        <div className="flex items-center gap-1">
          <ActionIconButton
            label={conversation.is_starred ? "Unstar" : "Star"}
            onClick={handleToggleStar}
            icon={
              <Star
                className={
                  conversation.is_starred
                    ? "h-3.5 w-3.5 text-accent-primary"
                    : "h-3.5 w-3.5"
                }
                strokeWidth={1.75}
                fill={conversation.is_starred ? "currentColor" : "none"}
              />
            }
          />
          <span className="text-vesti-xs text-text-tertiary">
            {formatRelativeTime(conversation.updated_at)}
          </span>
        </div>
      </div>

      <div className="mt-1.5 flex items-start gap-1">
        {isEditingTitle ? (
          <input
            ref={titleInputRef}
            value={draftTitle}
            maxLength={MAX_TITLE_LENGTH}
            disabled={isSavingTitle}
            aria-label="Edit conversation title"
            onChange={(event) => {
              setDraftTitle(event.target.value);
            }}
            onClick={(event) => {
              event.stopPropagation();
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                skipBlurSaveRef.current = true;
                void commitTitleEdit();
              } else if (event.key === "Escape") {
                event.preventDefault();
                skipBlurSaveRef.current = true;
                cancelTitleEdit();
              }
            }}
            onBlur={() => {
              if (skipBlurSaveRef.current) {
                skipBlurSaveRef.current = false;
                return;
              }
              void commitTitleEdit();
            }}
            className="h-7 min-w-0 flex-1 rounded-sm border border-border-subtle bg-white px-2 text-vesti-sm text-text-primary outline-none focus:border-text-primary focus:ring-2 focus:ring-[rgba(26,25,24,0.12)]"
          />
        ) : (
          <h3 className="min-w-0 flex-1 truncate text-vesti-base font-medium tracking-tight text-text-primary">
            {conversation.title}
          </h3>
        )}

        {!isEditingTitle && (
          <div className="flex items-center gap-0.5 shrink-0">
            <ActionIconButton
              label="Rename title"
              onClick={handleStartTitleEdit}
              disabled={!onRenameTitle || isSavingTitle}
              icon={<Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Assign group"
                  onClick={(event) => event.stopPropagation()}
                  className="flex h-6 items-center gap-1 rounded-sm px-1.5 text-[11px] text-text-tertiary opacity-60 transition-all duration-150 hover:bg-accent-primary-light hover:text-accent-primary hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                >
                  <FolderOpen className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem
                  onClick={(event) => {
                    event.stopPropagation();
                    handleTopicChange({
                      target: { value: "" },
                    } as ChangeEvent<HTMLSelectElement>);
                  }}
                >
                  <span className="text-text-tertiary">No group</span>
                </DropdownMenuItem>
                {topicOptions.map((topic) => (
                  <DropdownMenuItem
                    key={topic.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleTopicChange({
                        target: { value: String(topic.id) },
                      } as ChangeEvent<HTMLSelectElement>);
                    }}
                  >
                    {topic.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      <div
        className={`grid transition-[grid-template-rows,opacity] duration-150 ease-in-out ${
          isHovered ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <p className="mt-1.5 line-clamp-2 text-vesti-sm leading-[1.5] text-text-secondary">
            {conversation.snippet}
          </p>

          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex items-center gap-1 text-vesti-xs text-text-tertiary">
                <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.75} />
                {conversation.message_count} messages · {turnCount} turns
              </span>
              {matchedInMessagesOnly ? (
                <span className="shrink-0 rounded-full border border-border-subtle bg-bg-primary px-2 py-0.5 text-[10px] font-medium text-text-tertiary">
                  Matched in messages
                </span>
              ) : null}
            </div>

            <div className="flex items-center gap-1.5">
              <ActionIconButton
                label={copied ? "Copied!" : "Copy Full Text"}
                onClick={handleCopy}
                icon={
                  copied ? (
                    <Check className="h-3.5 w-3.5 text-success" strokeWidth={1.75} />
                  ) : (
                    <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
                  )
                }
              />
              <ActionIconButton
                label={
                  hasSourceUrl
                    ? "Go to Original URL"
                    : "Source URL unavailable"
                }
                onClick={handleOpenSource}
                disabled={!hasSourceUrl}
                icon={<ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />}
              />
              <div className="mx-0.5 h-3.5 w-px bg-border-subtle" />
              <ActionIconButton
                label="Delete conversation"
                onClick={handleDelete}
                tone="danger"
                icon={<Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
