/**
 * Rendered Markdown.
 *
 * Every node here is a React element built from a token, so text from the
 * repository can only ever become a text node. There is no
 * `dangerouslySetInnerHTML` in this file and there should never be one — see
 * `data/markdown.ts` for why that guarantee is structural rather than a filter.
 */

import { useEffect, useState } from 'react';

import type { Block, Inline } from '../data/markdown';
import { parseMarkdown } from '../data/markdown';
import { source } from '../data/source';

function Spans({ inline }: { inline: Inline[] }) {
  return (
    <>
      {inline.map((t, i) => {
        switch (t.kind) {
          case 'strong':
            return <strong key={i}>{t.text}</strong>;
          case 'em':
            return <em key={i}>{t.text}</em>;
          case 'code':
            return (
              <code key={i} className="md-code">
                {t.text}
              </code>
            );
          case 'link':
            // Opens in the real browser: `will-navigate` in main blocks
            // in-place navigation, and a link should never move the app off
            // the page that carries the bridge.
            return (
              <a key={i} href={t.href} target="_blank" rel="noreferrer noopener">
                {t.text}
              </a>
            );
          default:
            return <span key={i}>{t.text}</span>;
        }
      })}
    </>
  );
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'heading': {
            const Tag = `h${Math.min(6, b.level)}` as 'h1';
            return (
              <Tag key={i}>
                <Spans inline={b.inline} />
              </Tag>
            );
          }
          case 'code':
            return (
              <pre key={i} className="md-pre">
                <code>{b.text}</code>
              </pre>
            );
          case 'list':
            return b.ordered ? (
              <ol key={i}>
                {b.items.map((item, j) => (
                  <li key={j}>
                    <Spans inline={item} />
                  </li>
                ))}
              </ol>
            ) : (
              <ul key={i}>
                {b.items.map((item, j) => (
                  <li key={j}>
                    <Spans inline={item} />
                  </li>
                ))}
              </ul>
            );
          case 'quote':
            return (
              <blockquote key={i}>
                <Spans inline={b.inline} />
              </blockquote>
            );
          case 'hr':
            return <hr key={i} />;
          default:
            return (
              <p key={i}>
                <Spans inline={b.inline} />
              </p>
            );
        }
      })}
    </>
  );
}

/**
 * The rendered new version of a changed Markdown file, collapsed by default.
 *
 * Collapsed because the diff is what you came for: rendered output answers
 * "what does this look like now", which is a different and secondary question.
 */
export function MarkdownPreview({
  repoPath,
  oid,
  file,
}: {
  repoPath: string;
  oid: string;
  file: string;
}) {
  const [open, setOpen] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open || src !== null) return;
    let cancelled = false;
    source
      .fileAt(repoPath, oid, file)
      .then((text) => !cancelled && setSrc(text))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [open, src, repoPath, oid, file]);

  return (
    <div className="md-block">
      <button className="md-toggle" onClick={() => setOpen((o) => !o)}>
        <span className="label">{open ? 'hide preview' : 'preview'}</span>
        <span className="md-name">{file}</span>
      </button>

      {open &&
        (failed ? (
          <div className="empty">Could not read {file} at this commit.</div>
        ) : src === null ? (
          <div className="empty">…</div>
        ) : (
          <div className="md-body">
            <Blocks blocks={parseMarkdown(src)} />
          </div>
        ))}
    </div>
  );
}
