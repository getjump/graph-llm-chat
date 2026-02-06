import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import type { ReactNode } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useStore } from '../../store';

const katexSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames || []),
    'math',
    'annotation',
    'semantics',
    'mrow',
    'mi',
    'mo',
    'mn',
    'mtext',
    'ms',
    'mfrac',
    'mover',
    'munder',
    'msup',
    'msub',
    'mtable',
    'mtr',
    'mtd',
    'maligngroup',
    'malignmark',
    'mspace',
    'mstyle',
    'menclose',
    'msqrt',
    'mroot',
    'mpadded',
    'mphantom',
    'mglyph',
    'details',
    'summary',
    'kbd',
    'hr',
    'mark',
  ],
  attributes: {
    ...defaultSchema.attributes,
    span: [
      ...(defaultSchema.attributes?.span || []),
      'className',
      'style',
      'ariaHidden',
      'role',
    ],
    div: [...(defaultSchema.attributes?.div || []), 'className', 'style', 'role'],
    code: [...(defaultSchema.attributes?.code || []), 'className'],
    pre: [...(defaultSchema.attributes?.pre || []), 'className'],
    table: [...(defaultSchema.attributes?.table || []), 'className'],
    thead: [...(defaultSchema.attributes?.thead || []), 'className'],
    tbody: [...(defaultSchema.attributes?.tbody || []), 'className'],
    tr: [...(defaultSchema.attributes?.tr || []), 'className'],
    th: [
      ...(defaultSchema.attributes?.th || []),
      'className',
      'colSpan',
      'rowSpan',
    ],
    td: [
      ...(defaultSchema.attributes?.td || []),
      'className',
      'colSpan',
      'rowSpan',
    ],
    a: [...(defaultSchema.attributes?.a || []), 'href', 'title', 'target', 'rel'],
    details: [...(defaultSchema.attributes?.details || []), 'open'],
    math: ['display', 'xmlns'],
    annotation: ['encoding'],
    mark: [...(defaultSchema.attributes?.mark || []), 'className'],
  },
};

interface MarkdownRendererProps {
  content: string;
  className?: string;
  highlightQuery?: string | null;
}

export function MarkdownRenderer({
  content,
  className,
  highlightQuery,
}: MarkdownRendererProps) {
  const theme = useStore((state) => state.theme);
  const normalizedQuery = highlightQuery?.trim();
  const shouldHighlight = Boolean(normalizedQuery && normalizedQuery.length >= 2);
  const highlightPlugin = shouldHighlight
    ? [createHighlightPlugin(normalizedQuery!)]
    : [];

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          rehypeRaw,
          [rehypeKatex, { strict: false }],
          [rehypeSanitize, katexSchema],
          ...highlightPlugin,
        ]}
        components={{
          table: ({ children, ...props }) => (
            <div className="overflow-x-auto">
              <table {...props}>{children}</table>
            </div>
          ),
          a: ({ children, ...props }) => (
            <a {...props} rel="noreferrer" target="_blank">
              {children as ReactNode}
            </a>
          ),
          code: ({ children, className: codeClassName }) => {
            const match = /language-(\w+)/.exec(codeClassName || '');
            const language = match?.[1] || 'text';
            const code = String(children).replace(/\n$/, '');
            const hasLineBreak = code.includes('\n');
            const isInline = !match && !hasLineBreak;

            if (isInline) {
              return (
                <code className="rounded bg-gray-100 dark:bg-transparent px-1 py-0.5 text-[0.85em] dark:text-gray-200">
                  {children}
                </code>
              );
            }

            return (
              <SyntaxHighlighter
                language={language}
                style={theme === 'dark' ? oneDark : oneLight}
                showLineNumbers
                wrapLines
                codeTagProps={{
                  style: { background: 'transparent' },
                }}
                customStyle={{
                  borderRadius: '0.5rem',
                  padding: '1rem',
                  fontSize: '0.85rem',
                  background: theme === 'dark' ? '#0f172a' : '#f8fafc',
                }}
                lineNumberStyle={{
                  minWidth: '2.5em',
                  paddingRight: '1em',
                  color: theme === 'dark' ? '#64748b' : '#94a3b8',
                  background: 'transparent',
                }}
              >
                {code}
              </SyntaxHighlighter>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function createHighlightPlugin(query: string) {
  const escaped = escapeRegExp(query);
  const matcher = new RegExp(escaped, 'gi');
  const skipTags = new Set(['code', 'pre', 'kbd', 'samp']);

  return (tree: HighlightNode) => {
    highlightNode(tree, matcher, skipTags);
  };
}

type HighlightNode = {
  type?: string;
  tagName?: string;
  value?: string;
  children?: HighlightNode[];
  properties?: Record<string, unknown>;
};

function highlightNode(
  node: HighlightNode,
  matcher: RegExp,
  skipTags: Set<string>
) {
  if (!node || !node.children) return;

  if (node.tagName && skipTags.has(node.tagName)) {
    return;
  }

  const nextChildren: HighlightNode[] = [];
  for (const child of node.children) {
    if (child.type === 'text' && typeof child.value === 'string') {
      const parts = splitMatches(child.value, matcher);
      if (parts.length === 1) {
        nextChildren.push(child);
        continue;
      }
      for (const part of parts) {
        if (!part.highlight) {
          nextChildren.push({ ...child, value: part.text });
        } else {
          nextChildren.push({
            type: 'element',
            tagName: 'mark',
            properties: {
              className: ['bg-amber-200/80', 'dark:bg-amber-500/40', 'rounded', 'px-0.5'],
            },
            children: [{ type: 'text', value: part.text }],
          });
        }
      }
      continue;
    }

    highlightNode(child, matcher, skipTags);
    nextChildren.push(child);
  }

  node.children = nextChildren;
}

function splitMatches(text: string, matcher: RegExp) {
  const parts: Array<{ text: string; highlight: boolean }> = [];
  let lastIndex = 0;
  matcher.lastIndex = 0;
  let match = matcher.exec(text);

  while (match) {
    if (match.index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, match.index), highlight: false });
    }
    parts.push({ text: match[0], highlight: true });
    lastIndex = match.index + match[0].length;
    match = matcher.exec(text);
  }

  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), highlight: false });
  }

  return parts.length > 0 ? parts : [{ text, highlight: false }];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
