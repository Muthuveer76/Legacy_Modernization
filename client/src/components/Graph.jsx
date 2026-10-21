import dagre from '@dagrejs/dagre';
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const CHAR_W = 6.9;
const NODE_H = 38;

function nodeWidth(label, min = 90, max = 280) {
  return Math.max(min, Math.min(max, label.length * CHAR_W + 28));
}

function truncate(label, width) {
  const maxChars = Math.floor((width - 24) / CHAR_W);
  return label.length > maxChars ? `${label.slice(0, maxChars - 1)}…` : label;
}

function pathFor(points) {
  if (!points?.length) return '';
  const [first, ...rest] = points;
  if (rest.length === 1) return `M${first.x},${first.y} L${rest[0].x},${rest[0].y}`;
  let d = `M${first.x},${first.y}`;
  for (let i = 0; i < rest.length - 1; i += 1) {
    const cur = rest[i];
    const next = rest[i + 1];
    const mx = (cur.x + next.x) / 2;
    const my = (cur.y + next.y) / 2;
    d += ` Q${cur.x},${cur.y} ${mx},${my}`;
  }
  const last = rest[rest.length - 1];
  return `${d} L${last.x},${last.y}`;
}

// Layered graph (dagre layout) rendered as SVG with wheel zoom and drag pan.
// nodes: {id, label, kind, tooltip, dim}; edges: {from, to, label, kind, dashed}.
export function Graph({ nodes, edges, direction = 'TB', height = 520, onNodeClick, selected, emptyText = 'Nothing to draw' }) {
  const layout = useMemo(() => {
    if (!nodes.length) return null;
    const g = new dagre.graphlib.Graph({ multigraph: true });
    g.setGraph({ rankdir: direction, nodesep: 26, ranksep: 46, edgesep: 14, marginx: 20, marginy: 20 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const n of nodes) g.setNode(n.id, { ...n, width: nodeWidth(n.label), height: NODE_H });
    edges.forEach((e, i) => {
      if (!g.hasNode(e.from) || !g.hasNode(e.to)) return;
      g.setEdge(e.from, e.to, { ...e, width: e.label ? Math.min(140, e.label.length * 6 + 8) : 0, height: e.label ? 16 : 0, labelpos: 'c' }, `e${i}`);
    });
    dagre.layout(g);
    const info = g.graph();
    return {
      nodes: g.nodes().map((id) => g.node(id)),
      edges: g.edges().map((ref) => ({ ...g.edge(ref), key: ref.name })),
      width: info.width || 400,
      height: info.height || 300,
    };
  }, [nodes, edges, direction]);

  const wrap = useRef(null);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const drag = useRef(null);

  const fit = useCallback(() => {
    if (!layout || !wrap.current) return;
    const w = wrap.current.clientWidth;
    const k = Math.min(1.2, (w - 20) / layout.width, (height - 20) / layout.height);
    const kk = Math.max(0.25, k);
    setView({ k: kk, x: (w - layout.width * kk) / 2, y: Math.max(10, (height - layout.height * kk) / 2) });
  }, [layout, height]);

  useEffect(() => {
    fit();
  }, [fit]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      // Plain wheel scrolls the page; Ctrl/Cmd + wheel (and trackpad pinch) zooms.
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      setView((v) => {
        const k = Math.max(0.2, Math.min(3, v.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
        return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [layout]);

  if (!layout) return <p className="muted graph-empty">{emptyText}</p>;

  const zoom = (factor) => setView((v) => ({ ...v, k: Math.max(0.2, Math.min(3, v.k * factor)) }));

  return (
    <div
      className="graph"
      style={{ height }}
      ref={wrap}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
      }}
      onMouseMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
        setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
      }}
      onMouseUp={() => {
        setTimeout(() => {
          drag.current = null;
        }, 0);
      }}
      onMouseLeave={() => {
        drag.current = null;
      }}
    >
      <div className="graph-controls">
        <span className="graph-hint">Drag to pan · Ctrl + scroll to zoom</span>
        <button type="button" className="icon-btn" onClick={() => zoom(1.2)} aria-label="Zoom in">
          <ZoomIn size={16} />
        </button>
        <button type="button" className="icon-btn" onClick={() => zoom(1 / 1.2)} aria-label="Zoom out">
          <ZoomOut size={16} />
        </button>
        <button type="button" className="icon-btn" onClick={fit} aria-label="Fit to view">
          <Maximize2 size={16} />
        </button>
      </div>
      <svg width="100%" height="100%">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="graph-arrow" />
          </marker>
        </defs>
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {layout.edges.map((e) => (
            <g key={e.key} className={`graph-edge edge-${e.kind || 'default'}${e.dashed ? ' dashed' : ''}`}>
              <path d={pathFor(e.points)} markerEnd="url(#arrow)" />
              {e.label && (
                <text x={e.x} y={e.y + 4} textAnchor="middle" className="graph-edge-label">
                  {e.label.length > 22 ? `${e.label.slice(0, 21)}…` : e.label}
                </text>
              )}
            </g>
          ))}
          {layout.nodes.map((n) => (
            <g
              key={n.id}
              className={`graph-node node-${n.kind || 'default'}${n.dim ? ' dim' : ''}${selected === n.id ? ' selected' : ''}${onNodeClick ? ' clickable' : ''}`}
              transform={`translate(${n.x - n.width / 2},${n.y - NODE_H / 2})`}
              onClick={() => {
                if (!drag.current?.moved) onNodeClick?.(n);
              }}
            >
              <title>{n.tooltip || n.label}</title>
              <rect width={n.width} height={NODE_H} rx={n.kind === 'entry' || n.kind === 'exit' ? NODE_H / 2 : n.kind === 'cond' || n.kind === 'switch' || n.kind === 'loop' ? 4 : 8} />
              <text x={n.width / 2} y={NODE_H / 2 + 4} textAnchor="middle">
                {truncate(n.label, n.width)}
              </text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}
