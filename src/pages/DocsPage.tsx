import { useState, useEffect, useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

interface DocSection {
  id: string;
  title: string;
  content: string;
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');
}

function parseSections(md: string): { intro: string; sections: DocSection[] } {
  const lines = md.split('\n');
  const intro: string[] = [];
  const sections: DocSection[] = [];
  let current: DocSection | null = null;
  let inIntro = true;

  for (const line of lines) {
    const m = line.match(/^## (.+)/);
    if (m) {
      inIntro = false;
      if (current) sections.push(current);
      const title = m[1].trim();
      current = { id: slugify(title), title, content: line + '\n' };
    } else if (inIntro) {
      intro.push(line);
    } else if (current) {
      current.content += line + '\n';
    }
  }
  if (current) sections.push(current);

  return { intro: intro.join('\n'), sections };
}

const customComponents: Components = {
  h2: ({ children, ...props }) => (
    <h2 className="text-xl font-bold mt-2 mb-4 text-[var(--app-text)] border-b border-[var(--app-border)] pb-2" {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }) => {
    const text = Array.isArray(children) ? children.join('') : String(children ?? '');
    return (
      <h3 id={slugify(text)} className="text-base font-semibold mt-5 mb-2 text-[var(--app-text)]" {...props}>
        {children}
      </h3>
    );
  },
  h4: ({ children, ...props }) => (
    <h4 className="text-sm font-semibold mt-4 mb-2 text-[var(--app-text)]" {...props}>
      {children}
    </h4>
  ),
  p: ({ children, ...props }) => (
    <p className="text-sm text-[var(--app-text)] leading-relaxed mb-3" {...props}>
      {children}
    </p>
  ),
  ul: ({ children, ...props }) => (
    <ul className="list-disc list-inside text-sm text-[var(--app-text)] space-y-1 mb-3 ml-2" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol className="list-decimal list-inside text-sm text-[var(--app-text)] space-y-1 mb-3 ml-2" {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => (
    <li className="text-sm text-[var(--app-text)]" {...props}>
      {children}
    </li>
  ),
  code: ({ children, ...props }) => {
    if (!props.className) {
      return (
        <code className="bg-[color-mix(in_srgb,var(--app-blue)_10%,transparent)] text-[var(--app-blue-3)] px-1.5 py-0.5 rounded text-sm font-mono" {...props}>
          {children}
        </code>
      );
    }
    return (
      <pre className="bg-[var(--app-panel-soft-2)] border border-[var(--app-border)] rounded-xl p-4 mb-4 overflow-x-auto">
        <code className="text-sm text-[var(--app-text)] font-mono leading-relaxed" {...props}>
          {children}
        </code>
      </pre>
    );
  },
  pre: ({ children }) => <>{children}</>,
  table: ({ children, ...props }) => (
    <div className="overflow-x-auto mb-4">
      <table className="w-full text-sm border-collapse" {...props}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...props }) => (
    <thead className="bg-[var(--app-panel-soft-2)]" {...props}>
      {children}
    </thead>
  ),
  th: ({ children, ...props }) => (
    <th className="border border-[var(--app-border)] px-3 py-2 text-left text-xs font-semibold text-[var(--app-text)] uppercase" {...props}>
      {children}
    </th>
  ),
  td: ({ children, ...props }) => (
    <td className="border border-[var(--app-border)] px-3 py-2 text-sm text-[var(--app-text)]" {...props}>
      {children}
    </td>
  ),
  a: ({ children, href, ...props }) => (
    <a
      href={href}
      className="text-[var(--app-blue-3)] hover:text-[var(--app-blue-3)] underline underline-offset-2 transition-colors"
      target={href?.startsWith('http') ? '_blank' : undefined}
      rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}
      {...props}
    >
      {children}
    </a>
  ),
  blockquote: ({ children, ...props }) => (
    <blockquote className="border-l-2 border-[color-mix(in_srgb,var(--app-blue)_50%,transparent)] pl-4 italic text-[var(--app-muted)] mb-3" {...props}>
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-[var(--app-border)] my-6" />,
  strong: ({ children, ...props }) => (
    <strong className="font-semibold text-[var(--app-text)]" {...props}>
      {children}
    </strong>
  ),
  em: ({ children, ...props }) => (
    <em className="italic text-[var(--app-text)]" {...props}>
      {children}
    </em>
  ),
};

function EmptySection({ title, icon }: { title: string; icon: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-14 h-14 rounded-full bg-[var(--app-blue)]/10 flex items-center justify-center text-2xl mb-4">{icon}</div>
      <h2 className="text-lg font-semibold text-[var(--app-text)] mb-1">{title}</h2>
      <p className="text-sm text-[var(--app-muted)]">Select a section from the sidebar</p>
    </div>
  );
}

function DocsPage() {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeIdx, setActiveIdx] = useState(0);
  const [tocOpen, setTocOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/docs.md');
        const text = await res.text();
        setContent(text);
      } catch {
        setContent('## Error\n\nFailed to load documentation file.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const { intro, sections } = useMemo(() => parseSections(content), [content]);
  const activeSection = sections[activeIdx];

  const navigate = useCallback((idx: number) => {
    setActiveIdx(idx);
    setTocOpen(false);
  }, []);

  return (
    <div className="max-w-5xl mx-auto py-4">
      <div className="bg-[var(--app-panel)] backdrop-blur-xl rounded-2xl border border-[var(--app-border)] overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-[var(--app-border)]">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--app-blue)] to-[var(--app-blue-2)] flex items-center justify-center font-bold text-sm shadow-lg shadow-[var(--app-shadow)]">
            D
          </div>
          <h1 className="text-lg font-bold text-[var(--app-text)]">
            Documentation
          </h1>
          <button
            onClick={() => setTocOpen(!tocOpen)}
            className="lg:hidden ml-auto p-1.5 rounded-lg hover:bg-[var(--app-hover)] text-[var(--app-muted)] transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-4 bg-[var(--app-panel-soft)] rounded animate-pulse" style={{ width: `${60 + i * 8}%` }} />
            ))}
          </div>
        ) : (
          <div className="flex">
            <aside className="hidden lg:flex flex-col w-56 shrink-0 border-r border-[var(--app-border)]">
              <nav className="p-3 space-y-0.5 sticky top-0 overflow-y-auto max-h-screen">
                <button
                  onClick={() => { setActiveIdx(-1); setTocOpen(false); }}
                  className={`block w-full text-left text-xs py-1.5 px-2 rounded-lg transition-all duration-200 ${
                    activeIdx === -1
                      ? 'bg-[var(--app-blue)]/15 text-[var(--app-blue-3)] font-medium'
                      : 'text-[var(--app-muted)] hover:text-[var(--app-text)] hover:bg-[var(--app-panel-soft-2)]'
                  }`}
                >
                  Overview
                </button>
                <div className="h-px bg-[var(--app-panel)] my-1.5" />
                {sections.map((s, i) => (
                  <button
                    key={s.id}
                    onClick={() => navigate(i)}
                    className={`block w-full text-left text-xs py-1.5 px-2 rounded-lg transition-all duration-200 ${
                      activeIdx === i
                        ? 'bg-[var(--app-blue)]/15 text-[var(--app-blue-3)] font-medium'
                        : 'text-[var(--app-muted)] hover:text-[var(--app-text)] hover:bg-[var(--app-panel-soft-2)]'
                    }`}
                  >
                    {s.title}
                  </button>
                ))}
              </nav>
            </aside>
            {tocOpen && (
              <div className="lg:hidden fixed inset-0 bg-black/75 backdrop-blur-xl z-50" onClick={() => setTocOpen(false)}>
                <div
                  className="absolute left-0 top-0 bottom-0 w-64 bg-[var(--app-panel)] backdrop-blur-xl border-r border-[var(--app-border)] p-4 overflow-y-auto"
                  onClick={e => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[10px] uppercase tracking-wider text-[var(--app-muted)] font-semibold">Sections</span>
                    <button onClick={() => setTocOpen(false)} className="text-[var(--app-muted)] hover:text-[var(--app-text)] transition-colors">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <nav className="space-y-0.5">
                    <button
                      onClick={() => { setActiveIdx(-1); setTocOpen(false); }}
                      className={`block w-full text-left text-sm py-2 px-2 rounded-lg transition-all duration-200 ${
                        activeIdx === -1
                          ? 'bg-[var(--app-blue)]/15 text-[var(--app-blue-3)] font-medium'
                          : 'text-[var(--app-muted)] hover:text-[var(--app-text)] hover:bg-[var(--app-panel-soft-2)]'
                      }`}
                    >
                      Overview
                    </button>
                    <div className="h-px bg-[var(--app-panel)] my-1.5" />
                    {sections.map((s, i) => (
                      <button
                        key={s.id}
                        onClick={() => navigate(i)}
                        className={`block w-full text-left text-sm py-2 px-2 rounded-lg transition-all duration-200 ${
                          activeIdx === i
                            ? 'bg-[var(--app-blue)]/15 text-[var(--app-blue-3)] font-medium'
                            : 'text-[var(--app-muted)] hover:text-[var(--app-text)] hover:bg-[var(--app-panel-soft-2)]'
                        }`}
                      >
                        {s.title}
                      </button>
                    ))}
                  </nav>
                </div>
              </div>
            )}
            <div className="flex-1 min-w-0 p-6 lg:p-8">
              {activeIdx === -1 ? (
                <>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={customComponents}
                  >
                    {intro}
                  </ReactMarkdown>
                  {sections.length > 0 && (
                    <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {sections.map((s, i) => (
                        <button
                          key={s.id}
                          onClick={() => navigate(i)}
                          className="bg-[var(--app-panel-soft-2)] hover:bg-[var(--app-hover)] border border-[var(--app-border)] rounded-xl p-4 text-left transition-all duration-200 hover:border-[var(--app-blue)]/30"
                        >
                          <div className="text-sm font-medium text-[var(--app-blue-3)] mb-1">{s.title}</div>
                          <div className="text-xs text-[var(--app-muted)]">Click to view</div>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : activeSection ? (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={customComponents}
                >
                  {activeSection.content}
                </ReactMarkdown>
              ) : (
                <EmptySection title="No Content" icon="📄" />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default DocsPage;
