'use client';

import { useState } from 'react';
import { Topic } from '@/lib/types';
import { ChevronRight, ChevronDown } from 'lucide-react';

interface TopicTreeProps {
  topics: Topic[];
  selectedTopicId: number | null;
  onSelectTopic: (topicId: number) => void;
}

export function TopicTree({ topics, selectedTopicId, onSelectTopic }: TopicTreeProps) {
  const [expandedTopics, setExpandedTopics] = useState<Set<number>>(new Set([1, 2]));

  const toggleExpand = (topicId: number) => {
    const newExpanded = new Set(expandedTopics);
    if (newExpanded.has(topicId)) {
      newExpanded.delete(topicId);
    } else {
      newExpanded.add(topicId);
    }
    setExpandedTopics(newExpanded);
  };

  const renderTopic = (topic: Topic, level: number = 0) => {
    const isExpanded = expandedTopics.has(topic.id);
    const isSelected = selectedTopicId === topic.id;
    const hasChildren = topic.children && topic.children.length > 0;
    return (
      <div key={topic.id}>
        <button
          onClick={() => {
            onSelectTopic(topic.id);
            if (hasChildren) {
              toggleExpand(topic.id);
            }
          }}
          className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors duration-200 rounded-md font-serif ${
            isSelected
              ? 'bg-bg-accent-light text-text-accent'
              : 'text-text-primary hover:bg-bg-accent-light/50'
          }`}
          style={{ paddingLeft: `${0.75 + level * 1}rem` }}
        >
          {hasChildren && (
            <span className="flex-shrink-0">
              {isExpanded ? (
                <ChevronDown strokeWidth={1.5} className="w-4 h-4" />
              ) : (
                <ChevronRight strokeWidth={1.5} className="w-4 h-4" />
              )}
            </span>
          )}
          <span className="flex-1 text-sm">{topic.name}</span>
          <span className="text-xs text-text-tertiary font-sans">{topic.count}</span>
        </button>
        {hasChildren && isExpanded && (
          <div className="mt-1">
            {topic.children!.map((child) => renderTopic(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-1">
      <div className="px-3 py-2 mb-3">
        <h2 className="text-xs font-sans uppercase tracking-wide text-text-tertiary">
          Knowledge Base
        </h2>
      </div>
      {topics.map((topic) => renderTopic(topic))}
    </div>
  );
}
