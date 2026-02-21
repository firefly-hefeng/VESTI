export type Platform =
  | 'ChatGPT'
  | 'Claude'
  | 'Gemini'
  | 'DeepSeek'
  | 'Qwen'
  | 'Doubao';

export interface Topic {
  id: number;
  name: string;
  parent_id: number | null;
  created_at: number;
  updated_at: number;
  count?: number;
  children?: Topic[];
}

export interface GardenerStep {
  step: string;
  status: 'pending' | 'running' | 'completed';
  details?: string;
}

export interface GardenerResult {
  tags: string[];
  matchedTopic?: Topic;
  createdTopic?: Topic;
  steps: GardenerStep[];
}

export interface Conversation {
  id: number;
  title: string;
  platform: Platform;
  snippet: string;
  tags: string[];
  topic_id: number | null;
  updated_at: number;
  is_starred: boolean;
  has_note?: boolean;
}

export interface AgentStep {
  step: string;
  status: 'pending' | 'running' | 'completed';
  details?: string;
}

export interface RelatedConversation {
  id: number;
  title: string;
  similarity: number;
  platform: Platform;
}

export interface Message {
  id: number;
  conversation_id: number;
  role: 'user' | 'ai';
  content_text: string;
  created_at: number;
}

export interface Note {
  id: number;
  title: string;
  content: string;
  linked_conversation_ids: number[];
  created_at: number;
  updated_at: number;
  tags: string[];
}
