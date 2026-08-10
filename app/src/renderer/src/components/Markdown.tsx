/**
 * Rendered Markdown.
 *
 * Every node here is a React element built from a token, so text from the
 * repository can only ever become a text node. There is no
 * `dangerouslySetInnerHTML` in this file and there should never be one — see
 * `data/markdown.ts` for why that guarantee is structural rather than a filter.
 */

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { dataUri, isRemote, mediaMime, resolveRepoPath } from '../data/images';
import type { Block, Inline } from '../data/markdown';
import { parseMarkdown } from '../data/markdown';
import { source } from '../data/source';

/**
 * Where the document being rendered lives, so a relative image inside it can be
 * resolved and fetched. Context rather than props because an image can sit at
 * any depth — inside a table cell, inside a nested list item — and threading
 * two values through every level would be noise at each one.
 */
const DocContext = createContext<{ repoPath: string; oid: string; file: string } | null>(null);

/**
 * An image referenced from the document, read at the same commit.
 *
 * Fetched as bytes and rendered through a `data:` URI rather than pointed at
 * `grove-file://`, because that protocol serves the *working tree*: previewing
 * a commit from last month would silently show today's picture.
 *
 * Remote images are deliberately not loaded. The CSP does not permit them, and
 * that is the right call rather than an obstacle — fetching one would tell a
 * third-party server that this person opened this file, which is not a thing a
 * local git client should do on behalf of a README it did not write.
 */
function MdImage({ alt, src }: { alt: string; src: string }) {
  const doc = useContext(DocContext);
  const [data, setData] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const target = doc && !isRemote(src) ? resolveRepoPath(doc.file, src) : null;

  useEffect(() => {
    if (!doc || !target) return;
    let cancelled = false;
    source
      .fileBytesAt(doc.repoPath, doc.oid, target)
      .then((b) => !cancelled && (b ? setData(b) : setFailed(true)))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [doc, target]);

  const mime = target ? mediaMime(target) : null;

  if (!target || failed || !mime) {
    // Alt text is the honest fallback: it is what the author wrote to describe
    // the picture, and it says more than a broken-image glyph.
    return (
      <span className="md-img-missing" title={src}>
        {alt || src}
      </span>
    );
  }
  if (data === null) return <span className="md-img-missing">…</span>;

  return <img className="md-img" src={dataUri(mime, data)} alt={alt} />;
}

function Spans({ inline }: { inline: Inline[] }) {
  return (
    <>
      {inline.map((t, i) => {
        switch (t.kind) {
          case 'strong':
            return <strong key={i}>{t.text}</strong>;
          case 'em':
            return <em key={i}>{t.text}</em>;
          case 'strike':
            return <s key={i}>{t.text}</s>;
          case 'image':
            return <MdImage key={i} alt={t.alt} src={t.src} />;
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
          case 'list': {
            const Tag = b.ordered ? 'ol' : 'ul';
            return (
              <Tag
                key={i}
                start={b.ordered && b.start !== 1 ? b.start : undefined}
                className={b.items.some((it) => it.checked !== null) ? 'md-tasks' : undefined}
              >
                {b.items.map((item, j) => (
                  <li key={j} className={item.checked !== null ? 'md-task' : undefined}>
                    {item.checked !== null && (
                      // Rendered, not interactive: this is a view of a file at a
                      // commit, and a checkbox you could click would imply Grove
                      // was going to write the tick back.
                      <input type="checkbox" checked={item.checked} readOnly tabIndex={-1} />
                    )}
                    <Spans inline={item.inline} />
                    {item.children && <Blocks blocks={[item.children]} />}
                  </li>
                ))}
              </Tag>
            );
          }
          case 'table':
            // The wrapper is what scrolls. A wide table inside a narrow pane
            // has to take its overflow out on itself rather than on the page.
            return (
              <div key={i} className="md-table-wrap">
                <table className="md-table">
                  <thead>
                    <tr>
                      {b.head.map((cell, j) => (
                        <th key={j} style={{ textAlign: b.align[j] ?? undefined }}>
                          <Spans inline={cell} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, j) => (
                      <tr key={j}>
                        {row.map((cell, k) => (
                          <td key={k} style={{ textAlign: b.align[k] ?? undefined }}>
                            <Spans inline={cell} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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

  /**
   * Held across renders because `MdImage` keys its fetch effect on this value.
   * As a fresh object literal it changed identity on every render, so every
   * re-render of this component re-fetched every image in the document — over
   * IPC, one git invocation each.
   */
  const doc = useMemo(() => ({ repoPath, oid, file }), [repoPath, oid, file]);

  /**
   * Parsing and building the element tree both scale with the document, and
   * neither depends on anything but its source. Memoizing the *element* rather
   * than just the blocks means React skips the subtree entirely when nothing
   * changed — a re-render caused by typing in the find field no longer
   * re-parses a README or re-reconciles it.
   */
  const body = useMemo(
    () => (src === null ? null : <Blocks blocks={parseMarkdown(src)} />),
    [src],
  );

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
            <DocContext.Provider value={doc}>{body}</DocContext.Provider>
          </div>
        ))}
    </div>
  );
}
