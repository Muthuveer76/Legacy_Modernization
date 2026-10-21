import { diffLines } from 'diff';
import { useMemo } from 'react';

const CONTEXT = 3;

// Unified line diff between the AI output and the reviewer's version.
export function DiffView({ before = '', after = '', maxHeight = 560 }) {
  const rows = useMemo(() => {
    const parts = diffLines(before, after);
    const out = [];
    let oldNo = 1;
    let newNo = 1;
    parts.forEach((part, idx) => {
      const lines = part.value.replace(/\n$/, '').split('\n');
      if (part.added) {
        for (const l of lines) out.push({ kind: 'add', text: l, newNo: newNo++ });
      } else if (part.removed) {
        for (const l of lines) out.push({ kind: 'del', text: l, oldNo: oldNo++ });
      } else {
        const keepHead = idx === 0 ? 0 : CONTEXT;
        const keepTail = idx === parts.length - 1 ? 0 : CONTEXT;
        if (lines.length > keepHead + keepTail + 2) {
          lines.slice(0, keepHead).forEach((l) => out.push({ kind: 'ctx', text: l, oldNo: oldNo++, newNo: newNo++ }));
          const hidden = lines.length - keepHead - keepTail;
          out.push({ kind: 'skip', text: `${hidden} unchanged line${hidden === 1 ? '' : 's'}` });
          oldNo += hidden;
          newNo += hidden;
          lines.slice(lines.length - keepTail).forEach((l) => out.push({ kind: 'ctx', text: l, oldNo: oldNo++, newNo: newNo++ }));
        } else {
          lines.forEach((l) => out.push({ kind: 'ctx', text: l, oldNo: oldNo++, newNo: newNo++ }));
        }
      }
    });
    return out;
  }, [before, after]);

  const added = rows.filter((r) => r.kind === 'add').length;
  const removed = rows.filter((r) => r.kind === 'del').length;

  if (!added && !removed) return <p className="muted diff-none">No changes: this file matches the generated version.</p>;

  return (
    <div className="diff" style={{ maxHeight }}>
      <div className="diff-summary">
        <span className="diff-add">+{added}</span> <span className="diff-del">−{removed}</span> lines changed by the reviewer
      </div>
      <table>
        <tbody>
          {rows.map((r, i) =>
            r.kind === 'skip' ? (
              <tr key={i} className="diff-skip">
                <td colSpan={3}>⋯ {r.text}</td>
              </tr>
            ) : (
              <tr key={i} className={`diff-${r.kind}`}>
                <td className="diff-no">{r.oldNo ?? ''}</td>
                <td className="diff-no">{r.newNo ?? ''}</td>
                <td className="diff-text">
                  <span className="diff-sign">{r.kind === 'add' ? '+' : r.kind === 'del' ? '−' : ' '}</span>
                  {r.text}
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
