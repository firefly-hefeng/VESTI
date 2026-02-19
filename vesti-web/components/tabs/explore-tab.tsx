'use client';

import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Platform } from '@/lib/types';

const platformColors: Record<Platform, { bg: string; text: string }> = {
  ChatGPT: { bg: '#F3F4F6', text: '#1A1A1A' },
  Claude: { bg: '#F7D8BA', text: '#1A1A1A' },
  Gemini: { bg: '#3A62D9', text: '#FFFFFF' },
  DeepSeek: { bg: '#172554', text: '#FFFFFF' },
};

const sampleQuestions = [
  'What React performance optimization techniques have I discussed?',
  'Summarize all conversations about database architecture',
  'Find all discussions involving TypeScript type system',
];

const mockAnswer = `Based on your knowledge base, you've discussed various React performance optimization approaches:

**1. Memoization Techniques**
In conversations with Claude, you explored React.memo, useMemo, and useCallback usage patterns. Key takeaways:
- React.memo works best for pure presentational components
- useMemo for expensive computations
- useCallback prevents unnecessary child re-renders

**2. Code Splitting**
With ChatGPT, you discussed React.lazy and Suspense practices, including route-level and component-level lazy loading strategies.

**3. Virtualizing Long Lists**
In conversations about large data rendering, you mentioned react-window and react-virtualized libraries.`;

const mockSources = [
  {
    id: 2,
    title: 'Optimizing React Rendering Performance',
    platform: 'Claude' as Platform,
  },
  {
    id: 1,
    title: 'Building a Reusable Component Library',
    platform: 'ChatGPT' as Platform,
  },
  {
    id: 6,
    title: 'Code Splitting Strategies',
    platform: 'Gemini' as Platform,
  },
];

export function ExploreTab() {
  const [question, setQuestion] = useState('');
  const [hasSubmitted, setHasSubmitted] = useState(false);

  const handleSubmit = (q: string) => {
    setQuestion(q);
    setHasSubmitted(true);
  };

  return (
    <div className="h-full flex items-start justify-center overflow-y-auto">
      <div className="w-full max-w-3xl px-8 py-16">
        {!hasSubmitted ? (
          <>
            <h1 className="text-[32px] font-serif font-normal text-text-primary text-center mb-12">
              What do you want to explore?
            </h1>

            <div className="mb-8">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Ask your knowledge base..."
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && question.trim()) {
                      handleSubmit(question);
                    }
                  }}
                  className="w-full px-4 py-3 pr-12 rounded-lg border border-border-default bg-bg-primary text-base font-sans text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-primary/20 focus:border-accent-primary transition-all"
                />
                <button
                  onClick={() => question.trim() && handleSubmit(question)}
                  disabled={!question.trim()}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-md bg-accent-primary text-white hover:bg-accent-primary/90 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                >
                  <ArrowRight strokeWidth={1.5} className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-xs font-sans text-text-tertiary uppercase tracking-wide mb-4">
                Sample Questions
              </p>
              {sampleQuestions.map((q) => (
                <button
                  key={q}
                  onClick={() => handleSubmit(q)}
                  className="block w-full text-left px-3.5 py-2.5 rounded-md bg-bg-surface-card hover:bg-bg-surface-card-hover text-[13px] font-sans text-text-secondary hover:text-text-primary transition-all"
                >
                  {q}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            {/* Question */}
            <div className="mb-8 pb-6 border-b border-border-subtle">
              <h2 className="text-xl font-serif font-normal text-text-primary">{question}</h2>
            </div>

            {/* Answer */}
            <div className="mb-8">
              <div className="prose prose-slate max-w-none">
                <div className="text-base font-serif text-text-primary leading-relaxed whitespace-pre-line">
                  {mockAnswer}
                </div>
              </div>
            </div>

            {/* Sources */}
            <div className="pt-6 border-t border-border-subtle">
              <h3 className="text-[11px] font-sans font-medium text-text-tertiary uppercase tracking-wider mb-4">
                Sources
              </h3>
              <div className="space-y-2">
                {mockSources.map((source) => (
                  <button
                    key={source.id}
                    className="w-full flex items-center justify-between p-3 rounded-lg bg-bg-surface-card hover:bg-bg-surface-card-hover transition-all group"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-sans text-text-primary">{source.title}</span>
                      <span
                        className="px-2 py-0.5 rounded-md text-[11px] font-sans font-medium leading-none"
                        style={{
                          backgroundColor: platformColors[source.platform].bg,
                          color: platformColors[source.platform].text,
                        }}
                      >
                        {source.platform}
                      </span>
                    </div>
                    <ArrowRight strokeWidth={1.5} className="w-4 h-4 text-text-tertiary group-hover:text-accent-primary transition-colors" />
                  </button>
                ))}
              </div>
            </div>

            {/* New Question Button */}
            <div className="mt-8 text-center">
              <button
                onClick={() => {
                  setQuestion('');
                  setHasSubmitted(false);
                }}
                className="px-4 py-2 rounded-lg bg-bg-surface-card hover:bg-bg-surface-card-hover text-sm font-sans text-text-primary transition-all"
              >
                Ask a new question
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
