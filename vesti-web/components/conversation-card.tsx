'use client';

import { Conversation } from '@/lib/types';
import { Star, GripVertical } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface ConversationCardProps {
  conversation: Conversation;
  onSelect: (id: number) => void;
  isSelected: boolean;
}

const platformColors = {
  ChatGPT: { bg: '#F3F4F6', text: '#1A1A1A' },
  Claude: { bg: '#F7D8BA', text: '#1A1A1A' },
  Gemini: { bg: '#3A62D9', text: '#FFFFFF' },
  DeepSeek: { bg: '#172554', text: '#FFFFFF' },
};

export function ConversationCard({ conversation, onSelect, isSelected }: ConversationCardProps) {
  const platformColor = platformColors[conversation.platform];

  return (
    <button
      onClick={() => onSelect(conversation.id)}
      className={`w-full text-left p-4 rounded-lg transition-all duration-200 group relative shadow-[0_1px_2px_rgba(60,50,40,0.06)] ${
        isSelected
          ? 'bg-bg-surface-card-hover'
          : 'bg-bg-surface-card hover:bg-bg-surface-card-hover'
      }`}
    >
      {/* Drag Handle - shows on hover */}
      <div className="absolute left-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        <GripVertical strokeWidth={1.5} className="w-4 h-4 text-text-tertiary" />
      </div>

      <div className="pl-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <h3 className="font-serif font-medium text-base text-text-primary flex-1 leading-snug">
            {conversation.title}
          </h3>
          {conversation.is_starred && (
            <Star strokeWidth={1.5} className="w-4 h-4 text-yellow-600 fill-yellow-600 flex-shrink-0" />
          )}
        </div>

        <p className="text-sm text-text-secondary font-sans leading-relaxed mb-3 line-clamp-2">
          {conversation.snippet}
        </p>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="px-2 py-0.5 rounded-md text-[11px] font-sans font-medium leading-none"
              style={{
                backgroundColor: platformColor.bg,
                color: platformColor.text,
              }}
            >
              {conversation.platform}
            </span>
            {conversation.tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 rounded-md text-[11px] font-sans font-medium leading-none bg-white/50 border border-border-default text-text-secondary"
              >
                {tag}
              </span>
            ))}
          </div>
          <span className="text-xs text-text-tertiary font-sans flex-shrink-0">
            {formatDistanceToNow(new Date(conversation.updated_at), { addSuffix: true })}
          </span>
        </div>
      </div>
    </button>
  );
}
