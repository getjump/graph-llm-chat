import { useState } from 'react';
import { MarkdownRenderer } from './MarkdownRenderer';

interface SummaryBlockProps {
  title: string;
  content: string;
  timestamp?: number;
}

export function SummaryBlock({ title, content, timestamp }: SummaryBlockProps) {
  const [isOpen, setIsOpen] = useState(false);
  const formattedTime = timestamp ? new Date(timestamp).toLocaleTimeString() : null;

  return (
    <div className="rounded-lg border border-amber-200 dark:border-amber-500/40 bg-amber-50/60 dark:bg-amber-500/10">
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        className="w-full flex items-center justify-between px-3 py-2 text-sm text-amber-800 dark:text-amber-200"
      >
        <span className="font-medium">{title}</span>
        <span className="text-xs flex items-center gap-2">
          {formattedTime && <span>{formattedTime}</span>}
          <span>{isOpen ? 'Hide' : 'Show'}</span>
        </span>
      </button>
      {isOpen && (
        <div className="px-3 pb-3">
          <MarkdownRenderer
            className="prose prose-sm max-w-none text-amber-900 dark:text-amber-100 dark:prose-invert"
            content={content}
          />
        </div>
      )}
    </div>
  );
}
