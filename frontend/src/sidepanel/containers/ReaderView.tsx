import { useEffect, useState } from "react";
import { ArrowLeft, MessageSquare } from "lucide-react";
import type { Conversation, Message } from "~lib/types";
import { getMessages } from "~lib/services/storageService";
import { PlatformTag } from "../components/PlatformTag";
import { MessageBubble } from "../components/MessageBubble";

interface ReaderViewProps {
  conversation: Conversation;
  onBack: () => void;
  refreshToken: number;
}

export function ReaderView({ conversation, onBack, refreshToken }: ReaderViewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getMessages(conversation.id)
      .then((data) => {
        if (!cancelled) {
          setMessages(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMessages([]);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [conversation.id, refreshToken]);

  return (
    <div className="flex h-full flex-col">
      <header className="reader-view-header">
        <button
          type="button"
          aria-label="Back"
          onClick={onBack}
          className="reader-view-back-btn"
        >
          <ArrowLeft className="reader-view-back-icon" strokeWidth={1.75} />
        </button>

        <h2 className="reader-view-title min-w-0 flex-1 truncate text-vesti-base font-semibold text-text-primary">
          {conversation.title}
        </h2>

        <PlatformTag platform={conversation.platform} />

        <span className="reader-view-msg-count text-vesti-xs text-text-tertiary">
          <MessageSquare className="reader-view-msg-icon" strokeWidth={1.75} />
          {conversation.message_count} messages
        </span>
      </header>

      <div className="flex-1 overflow-y-auto vesti-scroll">
        {loading ? (
          <div className="reader-view-loading">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="reader-view-loading-item">
                <div className="h-3 w-12 animate-pulse rounded bg-surface-card" />
                <div className="h-20 animate-pulse rounded-md bg-surface-card" />
              </div>
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-vesti-sm text-text-tertiary">No messages yet</p>
          </div>
        ) : (
          <div className="flex flex-col pb-2">
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                platform={conversation.platform}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
