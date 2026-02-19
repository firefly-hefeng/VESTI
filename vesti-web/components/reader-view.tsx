'use client';

import { Conversation } from '@/lib/types';

interface ReaderViewProps {
  conversation: Conversation;
}

export function ReaderView({ conversation }: ReaderViewProps) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-prose mx-auto px-8 py-12">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-serif font-medium text-text-primary mb-4 leading-tight">
            {conversation.title}
          </h1>
          <div className="flex items-center gap-3 text-sm font-sans text-text-secondary">
            <span>{conversation.platform}</span>
            <span>•</span>
            <span>{new Date(conversation.updated_at).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            })}</span>
          </div>
        </div>

        {/* Tags */}
        <div className="flex flex-wrap gap-2 mb-8">
          {conversation.tags.map((tag) => (
            <span
              key={tag}
              className="px-3 py-1.5 rounded-md text-sm font-sans bg-white/50 border border-border-default text-text-secondary"
            >
              {tag}
            </span>
          ))}
        </div>

        {/* Content */}
        <div className="prose prose-lg">
          <div className="space-y-6 text-lg leading-loose font-serif text-text-primary">
            <p>
              When building a reusable component library, the foundation of success lies in careful
              planning and adherence to established patterns. Let's explore the key considerations
              that will make your library both powerful and maintainable.
            </p>

            <h2 className="text-2xl font-serif font-medium text-text-primary mt-8 mb-4">
              Folder Structure
            </h2>
            <p>
              A well-organized folder structure is crucial for scalability. Consider organizing by
              feature rather than by file type. This approach keeps related files together and makes
              it easier to understand the scope of each component.
            </p>

            <div className="bg-bg-tertiary rounded-lg p-4 font-mono text-sm my-6 border border-border-default">
              <pre className="text-text-primary overflow-x-auto">
{`components/
├── Button/
│   ├── Button.tsx
│   ├── Button.test.tsx
│   ├── Button.stories.tsx
│   └── index.ts
├── Input/
│   ├── Input.tsx
│   └── index.ts
└── index.ts`}
              </pre>
            </div>

            <h2 className="text-2xl font-serif font-medium text-text-primary mt-8 mb-4">
              Prop Patterns
            </h2>
            <p>
              TypeScript provides excellent tools for creating flexible, type-safe component APIs.
              Use discriminated unions for variant props, and consider the "as" prop pattern for
              polymorphic components that need to render as different elements.
            </p>

            <p>
              The key is finding the right balance between flexibility and simplicity. Too many props
              can make a component difficult to use, while too few can limit its applicability.
            </p>

            <h2 className="text-2xl font-serif font-medium text-text-primary mt-8 mb-4">
              Documentation Strategy
            </h2>
            <p>
              Great documentation is what separates a good component library from an excellent one.
              Use Storybook to create interactive examples, and ensure each component has clear JSDoc
              comments describing its purpose, props, and usage patterns.
            </p>

            <p className="text-text-secondary italic">
              "The best component library is one that developers can use without constantly referring
              to documentation, but when they do need help, the answers are immediately available."
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
