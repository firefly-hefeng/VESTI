'use client';

import { AgentStep, RelatedConversation } from '@/lib/types';
import { Check, Loader2 } from 'lucide-react';

interface AgentPanelProps {
  steps: AgentStep[];
  relatedConversations: RelatedConversation[];
}

const platformColors = {
  ChatGPT: { bg: '#F3F4F6', text: '#1A1A1A' },
  Claude: { bg: '#F7D8BA', text: '#1A1A1A' },
  Gemini: { bg: '#3A62D9', text: '#FFFFFF' },
  DeepSeek: { bg: '#172554', text: '#FFFFFF' },
};

export function AgentPanel({ steps, relatedConversations }: AgentPanelProps) {
  return (
    <div className="w-80 bg-bg-secondary border-l border-border-default p-6 space-y-6 overflow-y-auto">
      {/* Agent Processing Section */}
      <div>
        <h3 className="text-xs font-sans uppercase tracking-wide text-text-tertiary mb-4">
          The Gardener
        </h3>
        <div className="space-y-3">
          {steps.map((step, index) => (
            <div key={index} className="flex items-start gap-3">
              <div className="flex-shrink-0 mt-0.5">
                {step.status === 'completed' && (
                  <div className="w-5 h-5 rounded-full bg-text-accent/10 flex items-center justify-center">
                    <Check strokeWidth={1.5} className="w-3 h-3 text-text-accent" />
                  </div>
                )}
                {step.status === 'running' && (
                  <div className="w-5 h-5 rounded-full bg-text-accent flex items-center justify-center animate-pulse">
                    <Loader2 strokeWidth={1.5} className="w-3 h-3 text-white animate-spin" />
                  </div>
                )}
                {step.status === 'pending' && (
                  <div className="w-5 h-5 rounded-full border-2 border-border-default" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p
                  className={`text-sm font-sans ${
                    step.status === 'running'
                      ? 'text-text-accent font-medium'
                      : step.status === 'completed'
                      ? 'text-text-primary'
                      : 'text-text-tertiary'
                  }`}
                >
                  {step.step}
                </p>
                {step.details && (
                  <p className="text-xs text-text-secondary font-sans mt-1">{step.details}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Related Conversations */}
      <div>
        <h3 className="text-xs font-sans uppercase tracking-wide text-text-tertiary mb-4">
          Related Conversations
        </h3>
        <div className="space-y-2">
          {relatedConversations.map((conv) => {
            const platformColor = platformColors[conv.platform];
            return (
              <button
                key={conv.id}
                className="w-full text-left p-3 rounded-lg bg-bg-surface-card hover:bg-bg-surface-card-hover transition-colors duration-200 shadow-[0_1px_2px_rgba(60,50,40,0.06)]"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="text-sm font-serif text-text-primary leading-snug flex-1">
                    {conv.title}
                  </p>
                  <span className="text-xs font-sans text-text-accent font-medium flex-shrink-0">
                    {conv.similarity}%
                  </span>
                </div>
                <span
                  className="inline-block px-2 py-0.5 rounded-md text-[11px] font-sans font-medium leading-none"
                  style={{
                    backgroundColor: platformColor.bg,
                    color: platformColor.text,
                  }}
                >
                  {conv.platform}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
