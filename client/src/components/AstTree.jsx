import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

function collectMatches(node, query, path, out) {
  const hit = `${node.type} ${node.label}`.toLowerCase().includes(query);
  let childHit = false;
  node.children.forEach((c, i) => {
    if (collectMatches(c, query, `${path}.${i}`, out)) childHit = true;
  });
  if (hit || childHit) out.add(path);
  return hit || childHit;
}

function TreeNode({ node, path, depth, expanded, toggle, matches, query, onSelect, selected }) {
  const hasChildren = node.children.length > 0;
  const open = expanded.has(path) || (query && matches.has(path) && depth < 12);
  if (query && !matches.has(path)) return null;
  const isHit = query && `${node.type} ${node.label}`.toLowerCase().includes(query);
  return (
    <li>
      <div
        className={`ast-row${selected === path ? ' selected' : ''}${node.error ? ' ast-error' : ''}`}
        style={{ paddingLeft: depth * 16 + 6 }}
        onClick={() => {
          onSelect?.(node, path);
          if (hasChildren) toggle(path);
        }}
      >
        <span className="ast-caret">{hasChildren ? open ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : null}</span>
        <span className={`ast-type${isHit ? ' hit' : ''}`}>{node.type}</span>
        {node.label && <span className="ast-label">{node.label}</span>}
        {node.line != null && <span className="ast-line">L{node.line}{node.endLine && node.endLine !== node.line ? `–${node.endLine}` : ''}</span>}
      </div>
      {hasChildren && open && (
        <ul>
          {node.children.map((c, i) => (
            <TreeNode key={i} node={c} path={`${path}.${i}`} depth={depth + 1} expanded={expanded} toggle={toggle} matches={matches} query={query} onSelect={onSelect} selected={selected} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function AstTree({ tree, onSelect }) {
  const initial = useMemo(() => {
    const s = new Set(['0']);
    tree?.children.forEach((c, i) => {
      s.add(`0.${i}`);
    });
    return s;
  }, [tree]);
  const [expanded, setExpanded] = useState(initial);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    const s = new Set();
    if (tree && q) collectMatches(tree, q, '0', s);
    return s;
  }, [tree, q]);

  if (!tree) return null;
  const toggle = (path) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <div className="ast">
      <div className="ast-toolbar">
        <div className="input-icon">
          <Search size={15} />
          <input type="search" placeholder="Filter nodes (e.g. IfStatement, WS-TAX)" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setExpanded(initial)}>
          Collapse
        </button>
      </div>
      {q && !matches.size ? (
        <p className="muted small">No nodes match “{query}”.</p>
      ) : (
        <ul className="ast-tree">
          <TreeNode
            node={tree}
            path="0"
            depth={0}
            expanded={expanded}
            toggle={toggle}
            matches={matches}
            query={q}
            selected={selected}
            onSelect={(node, path) => {
              setSelected(path);
              onSelect?.(node);
            }}
          />
        </ul>
      )}
    </div>
  );
}
