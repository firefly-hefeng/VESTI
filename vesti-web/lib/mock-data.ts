import { Topic, Conversation, AgentStep, RelatedConversation, Note } from './types';

export const mockTopics: Topic[] = [
  {
    id: 1,
    name: 'Frontend Development',
    parent_id: null,
    created_at: Date.parse('2024-01-01T00:00:00Z'),
    updated_at: Date.parse('2024-01-15T00:00:00Z'),
    count: 24,
    children: [
      {
        id: 11,
        name: 'React Patterns',
        parent_id: 1,
        created_at: Date.parse('2024-01-02T00:00:00Z'),
        updated_at: Date.parse('2024-01-15T00:00:00Z'),
        count: 12,
      },
      {
        id: 12,
        name: 'CSS & Styling',
        parent_id: 1,
        created_at: Date.parse('2024-01-03T00:00:00Z'),
        updated_at: Date.parse('2024-01-15T00:00:00Z'),
        count: 8,
      },
      {
        id: 13,
        name: 'Performance',
        parent_id: 1,
        created_at: Date.parse('2024-01-04T00:00:00Z'),
        updated_at: Date.parse('2024-01-15T00:00:00Z'),
        count: 4,
      },
    ],
  },
  {
    id: 2,
    name: 'Backend Architecture',
    parent_id: null,
    created_at: Date.parse('2024-01-01T00:00:00Z'),
    updated_at: Date.parse('2024-01-15T00:00:00Z'),
    count: 18,
    children: [
      {
        id: 21,
        name: 'API Design',
        parent_id: 2,
        created_at: Date.parse('2024-01-05T00:00:00Z'),
        updated_at: Date.parse('2024-01-15T00:00:00Z'),
        count: 9,
      },
      {
        id: 22,
        name: 'Database',
        parent_id: 2,
        created_at: Date.parse('2024-01-06T00:00:00Z'),
        updated_at: Date.parse('2024-01-15T00:00:00Z'),
        count: 9,
      },
    ],
  },
  {
    id: 3,
    name: 'Machine Learning',
    parent_id: null,
    created_at: Date.parse('2024-01-01T00:00:00Z'),
    updated_at: Date.parse('2024-01-15T00:00:00Z'),
    count: 15,
  },
  {
    id: 4,
    name: 'System Design',
    parent_id: null,
    created_at: Date.parse('2024-01-01T00:00:00Z'),
    updated_at: Date.parse('2024-01-15T00:00:00Z'),
    count: 11,
  },
  {
    id: 5,
    name: 'Career & Growth',
    parent_id: null,
    created_at: Date.parse('2024-01-01T00:00:00Z'),
    updated_at: Date.parse('2024-01-15T00:00:00Z'),
    count: 8,
  },
];

export const mockConversations: Conversation[] = [
  {
    id: 1,
    title: 'Building a Reusable Component Library',
    platform: 'ChatGPT',
    snippet: 'Discussed best practices for creating a scalable component library with TypeScript. Covered folder structure, prop patterns, and documentation strategies...',
    tags: ['React', 'TypeScript', 'Components'],
    topic_id: 1,
    updated_at: Date.parse('2024-01-15T10:30:00Z'),
    is_starred: true,
    has_note: true,
  },
  {
    id: 2,
    title: 'Optimizing React Rendering Performance',
    platform: 'Claude',
    snippet: 'Explored React.memo, useMemo, and useCallback patterns. Analyzed when to use each optimization technique and measured their impact on rendering cycles...',
    tags: ['React', 'Performance', 'Optimization'],
    topic_id: 13,
    updated_at: Date.parse('2024-01-14T15:20:00Z'),
    is_starred: false,
    has_note: true,
  },
  {
    id: 3,
    title: 'CSS Grid vs Flexbox Trade-offs',
    platform: 'Gemini',
    snippet: 'Deep dive into layout systems. Grid excels at 2D layouts while Flexbox is better for 1D. Discussed responsive patterns and browser compatibility...',
    tags: ['CSS', 'Layout', 'Design'],
    topic_id: 12,
    updated_at: Date.parse('2024-01-13T09:15:00Z'),
    is_starred: false,
  },
  {
    id: 4,
    title: 'RESTful API Design Principles',
    platform: 'DeepSeek',
    snippet: 'Covered resource naming, HTTP methods, status codes, and versioning strategies. Discussed when to use REST vs GraphQL for different use cases...',
    tags: ['API', 'REST', 'Backend'],
    topic_id: 21,
    updated_at: Date.parse('2024-01-12T14:45:00Z'),
    is_starred: true,
  },
  {
    id: 5,
    title: 'Database Indexing Strategies',
    platform: 'Claude',
    snippet: 'Explored B-tree vs Hash indexes, covering when to use composite indexes and how they impact query performance. Included practical PostgreSQL examples...',
    tags: ['Database', 'PostgreSQL', 'Performance'],
    topic_id: 22,
    updated_at: Date.parse('2024-01-11T11:30:00Z'),
    is_starred: false,
  },
  {
    id: 6,
    title: 'Neural Network Architectures',
    platform: 'ChatGPT',
    snippet: 'Compared CNN, RNN, and Transformer architectures. Discussed use cases for each and how attention mechanisms revolutionized NLP tasks...',
    tags: ['ML', 'Deep Learning', 'Neural Networks'],
    topic_id: 3,
    updated_at: Date.parse('2024-01-10T16:00:00Z'),
    is_starred: false,
  },
];

export const mockAgentSteps: AgentStep[] = [
  {
    step: 'Reading Conversation',
    status: 'completed',
    details: 'Analyzed 2,847 tokens',
  },
  {
    step: 'Extracting Key Concepts',
    status: 'completed',
    details: 'Found 12 technical concepts',
  },
  {
    step: 'Generating Tags',
    status: 'running',
    details: 'React, TypeScript, Components...',
  },
  {
    step: 'Finding Related Topics',
    status: 'pending',
  },
  {
    step: 'Archiving to Knowledge Base',
    status: 'pending',
  },
];

export const mockRelatedConversations: RelatedConversation[] = [
  {
    id: 11,
    title: 'Component Composition Patterns',
    similarity: 89,
    platform: 'Claude',
  },
  {
    id: 12,
    title: 'TypeScript Generics in React',
    similarity: 76,
    platform: 'ChatGPT',
  },
  {
    id: 13,
    title: 'Building Design Systems',
    similarity: 72,
    platform: 'Gemini',
  },
];

export const MOCK_NOTES: Note[] = [
  {
    id: 1,
    title: 'Thoughts on Virtual List Performance',
    content: `## My Understanding

The core insight from the React virtual list conversation is that DOM node count is the real bottleneck, not JS computation.

## Key Takeaways
- react-window is sufficient for most cases
- Only reach for @tanstack/virtual when you need headless flexibility
- Dynamic height measurement has hidden costs

## Questions to Explore
- [ ] How does overscan affect perceived scroll performance?
- [ ] Is there a meaningful difference at 10k vs 100k items?

[[如何用 React 实现虚拟列表优化]]`,
    linked_conversation_ids: [1],
    created_at: Date.now() - 50000,
    updated_at: Date.now() - 30000,
    tags: ['React', 'Performance'],
  },
  {
    id: 2,
    title: 'Chrome Extension Architecture Notes',
    content: `## Framework Comparison

After the Plasmo conversation, my current thinking:

**Plasmo** wins for DX — hot reload, TypeScript out of the box, good abstractions over MV3.

**WXT** is worth watching — more flexible but less mature ecosystem.

## Open Questions
- [ ] How does Plasmo handle side panel lifecycle?
- [ ] Content script injection timing with SPAs

[[Building a Chrome Extension with Plasmo]]`,
    linked_conversation_ids: [5],
    created_at: Date.now() - 432000000,
    updated_at: Date.now() - 400000000,
    tags: ['Chrome', 'Plasmo'],
  },
  {
    id: 3,
    title: 'Rust vs TypeScript Type System Comparison',
    content: `## Unstructured Thoughts

Coming from TypeScript, Rust's ownership model feels like type safety taken to its logical extreme. The borrow checker is annoying until it isn't.

TypeScript gives you escape hatches (any, as). Rust doesn't. That's both the frustration and the point.

## Worth Re-reading
[[Rust ownership 机制详解]]`,
    linked_conversation_ids: [2],
    created_at: Date.now() - 259200000,
    updated_at: Date.now() - 250000000,
    tags: ['Rust', 'TypeScript'],
  },
  {
    id: 4,
    title: 'Independent Reading Log',
    content: `## Books & Articles

Not linked to any specific conversation — just personal reading notes.

- *A Philosophy of Software Design* — Ousterhout's argument against comment-driven development is compelling
- Incremental complexity is the real enemy, not complexity per se
- "Tactical vs Strategic programming" is a useful mental model`,
    linked_conversation_ids: [],
    created_at: Date.now() - 600000000,
    updated_at: Date.now() - 580000000,
    tags: ['Reading'],
  },
];
