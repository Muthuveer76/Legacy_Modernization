import { useEffect, useMemo, useRef } from 'react';
import { highlight, languageFor } from '../lib/prism.js';

export const LINE_HEIGHT = 20;

// Read-only highlighted code with a line gutter. `startLine` numbers a snippet from its real
// position; `range` highlights lines [start, end] and `markers` maps line -> count (e.g. review
// comments), both in those real line numbers. `onLineClick` makes the gutter clickable.
export function CodeView({ code = '', path = '', language, startLine = 1, range, markers = {}, onLineClick, maxHeight = 560, className = '' }) {
  const lang = language || languageFor(path);
  const html = useMemo(() => highlight(code, lang), [code, lang]);
  const lineCount = useMemo(() => code.split('\n').length, [code]);
  const scroller = useRef(null);
  const offset = startLine - 1;

  useEffect(() => {
    if (!range?.start || !scroller.current) return;
    scroller.current.scrollTo({ top: Math.max(0, (range.start - offset - 4) * LINE_HEIGHT), behavior: 'smooth' });
  }, [range?.start, range?.end, offset]);

  return (
    <div className={`code-view ${className}`} style={{ maxHeight }} ref={scroller}>
      <div className="code-grid">
        <div className="gutter" aria-hidden="true">
          {Array.from({ length: lineCount }, (_, i) => {
            const n = i + 1 + offset;
            return (
              <div
                key={n}
                className={`ln${markers[n] ? ' has-marker' : ''}${onLineClick ? ' clickable' : ''}`}
                onClick={onLineClick ? () => onLineClick(n) : undefined}
                title={markers[n] ? `${markers[n]} comment(s)` : onLineClick ? 'Comment on this line' : undefined}
              >
                {n}
              </div>
            );
          })}
        </div>
        <div className="code-area">
          {range?.start && <div className="line-highlight" style={{ top: (range.start - offset - 1) * LINE_HEIGHT + 10, height: (Math.max(range.end || range.start, range.start) - range.start + 1) * LINE_HEIGHT }} />}
          <pre className="code-pre">
            <code dangerouslySetInnerHTML={{ __html: html }} />
          </pre>
        </div>
      </div>
    </div>
  );
}
