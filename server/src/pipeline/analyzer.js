import { childBlocks, clip, exprReads, exprToText, rootName, stmtDefsUses, walkExpr, walkStatements } from './ir.js';

// ---------------------------------------------------------------------------
// Naming helpers (shared with the translators)
// ---------------------------------------------------------------------------

export function words(name) {
  return String(name)
    .replace(/^(WS|LS|WK|W|FD|LK|CPY|G|M)[-_](?=[A-Za-z0-9])/i, '')
    .replace(/^m(?=[A-Z])/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

export function toCamel(name) {
  const w = words(name);
  if (!w.length) return 'value';
  const s = w[0] + w.slice(1).map((x) => x[0].toUpperCase() + x.slice(1)).join('');
  return /^\d/.test(s) ? `v${s}` : s;
}

export function toPascal(name) {
  const c = toCamel(name);
  return c[0].toUpperCase() + c.slice(1);
}

export function toSnake(name) {
  const s = words(name).join('_') || 'value';
  return /^\d/.test(s) ? `v_${s}` : s;
}

export function describeType(type) {
  if (!type) return 'unknown';
  switch (type.t) {
    case 'decimal':
      return type.digits ? `Decimal(${type.digits},${type.scale})` : type.scale ? `Decimal(scale ${type.scale})` : 'Decimal';
    case 'int':
      return 'Integer';
    case 'long':
      return 'Long';
    case 'float':
      return 'Double';
    case 'string':
      return type.edited ? `String (formatted ${type.pic})` : type.length && type.length > 1 ? `String(${type.length})` : type.length === 1 ? 'Char / flag' : 'String';
    case 'bool':
      return 'Boolean';
    case 'date':
      return 'Date';
    case 'array':
      return `${describeType(type.elem)}[${type.length ?? ''}]`;
    case 'record':
      return `${toPascal(type.name)} record`;
    case 'object':
      return type.name || 'Object';
    default:
      return 'Unknown';
  }
}

// ---------------------------------------------------------------------------
// Procedure metrics
// ---------------------------------------------------------------------------

function logicalOps(expr) {
  let n = 0;
  walkExpr(expr, (e) => {
    if (e.k === 'bin' && (e.op === 'and' || e.op === 'or')) n += 1;
    if (e.k === 'cond') n += 1;
  });
  return n;
}

export function cyclomatic(body) {
  let cc = 1;
  walkStatements(body, (s) => {
    switch (s.k) {
      case 'if':
        cc += 1 + logicalOps(s.cond);
        break;
      case 'while':
      case 'for':
        cc += 1 + logicalOps(s.cond);
        break;
      case 'foreach':
      case 'repeat':
        cc += 1;
        break;
      case 'switch':
        cc += s.cases.length;
        for (const c of s.cases) for (const t of c.tests) if (t.cond) cc += logicalOps(t.cond);
        break;
      case 'try':
        cc += s.handlers.length;
        break;
      default:
        for (const key of ['value', 'expr', 'init']) if (s[key]?.k) cc += logicalOps(s[key]);
    }
  });
  return cc;
}

function maxNesting(body) {
  let max = 0;
  walkStatements(body, (s, depth) => {
    if (childBlocks(s).length) max = Math.max(max, depth + 1);
  });
  return max;
}

function statementCount(body) {
  let n = 0;
  walkStatements(body, (s) => {
    if (s.k !== 'label' && s.k !== 'noop') n += 1;
  });
  return n;
}

// ---------------------------------------------------------------------------
// Control-flow graph (basic blocks)
// ---------------------------------------------------------------------------

const SIMPLE = new Set(['assign', 'decl', 'call', 'exprstmt', 'print', 'input', 'io', 'noop', 'raw', 'label', 'return', 'exit', 'goto', 'throw', 'continue']);

function stmtLabel(s) {
  if (s.text) return clip(s.text, 60);
  switch (s.k) {
    case 'assign':
      return clip(`${exprToText(s.target)} = ${exprToText(s.value)}`, 60);
    case 'call':
      return `call ${s.callee}`;
    default:
      return s.k;
  }
}

export function buildCfg(proc, maxNodes = 400) {
  const nodes = [];
  const edges = [];
  const add = (kind, label, lineNo) => {
    const id = `n${nodes.length}`;
    nodes.push({ id, kind, label, line: lineNo ?? null, stmts: [] });
    return id;
  };
  const connect = (pending, to) => {
    for (const p of pending) edges.push({ from: p.from, to, label: p.label || '' });
  };
  const entry = add('entry', 'Entry', proc.loc?.start);
  const exit = add('exit', 'Exit', proc.loc?.end);
  const loops = [];
  let truncated = false;

  const seq = (stmts, pendingIn) => {
    let pending = pendingIn;
    let block = null;
    for (const s of stmts || []) {
      if (nodes.length >= maxNodes) {
        truncated = true;
        return pending;
      }
      if (SIMPLE.has(s.k)) {
        if (s.k === 'label' || s.k === 'noop') continue;
        if (!block) {
          block = add('block', stmtLabel(s), s.line);
          connect(pending, block);
          pending = [{ from: block }];
        }
        const node = nodes[nodes.length - 1].id === block ? nodes[nodes.length - 1] : nodes.find((n) => n.id === block);
        if (node.stmts.length < 8) node.stmts.push(stmtLabel(s));
        else node.more = (node.more || 0) + 1;
        if (s.k === 'call') node.kind = node.kind === 'block' ? 'block' : node.kind;
        const terminal =
          s.k === 'return' || s.k === 'throw' || s.k === 'goto' || (s.k === 'exit' && s.scope !== 'loop');
        if (terminal) {
          const label = s.k === 'goto' ? `GO TO ${s.label}` : s.k === 'exit' && s.scope === 'program' ? 'stop' : s.k;
          edges.push({ from: block, to: exit, label, abrupt: s.k !== 'return' && !(s.k === 'exit' && s.scope === 'procedure') });
          pending = [];
          block = null;
          continue;
        }
        if (s.k === 'exit' && s.scope === 'loop' && loops.length) {
          loops[loops.length - 1].breaks.push({ from: block, label: 'break' });
          pending = [];
          block = null;
          continue;
        }
        if (s.k === 'continue' && loops.length) {
          edges.push({ from: block, to: loops[loops.length - 1].header, label: 'continue' });
          pending = [];
          block = null;
        }
        continue;
      }
      block = null;
      switch (s.k) {
        case 'if': {
          const c = add('cond', clip(`IF ${exprToText(s.cond)}`, 60), s.line);
          connect(pending, c);
          const t = seq(s.then, [{ from: c, label: 'true' }]);
          const e = s.else && s.else.length ? seq(s.else, [{ from: c, label: 'false' }]) : [{ from: c, label: 'false' }];
          pending = [...t, ...e];
          break;
        }
        case 'while': {
          if (!s.testAfter) {
            const header = add('loop', clip(`WHILE ${exprToText(s.cond)}`, 60), s.line);
            connect(pending, header);
            loops.push({ header, breaks: [] });
            const bodyEnd = seq(s.body, [{ from: header, label: 'true' }]);
            connect(bodyEnd.map((p) => ({ ...p, label: p.label || 'loop' })), header);
            const { breaks } = loops.pop();
            pending = [...(s.infinite ? [] : [{ from: header, label: 'false' }]), ...breaks];
          } else {
            const junction = add('junction', 'DO', s.line);
            connect(pending, junction);
            loops.push({ header: junction, breaks: [] });
            const bodyEnd = seq(s.body, [{ from: junction }]);
            const c = add('loop', clip(`LOOP WHILE ${exprToText(s.cond)}`, 60), s.line);
            connect(bodyEnd, c);
            edges.push({ from: c, to: junction, label: 'true' });
            const { breaks } = loops.pop();
            pending = [{ from: c, label: 'false' }, ...breaks];
          }
          break;
        }
        case 'for':
        case 'foreach':
        case 'repeat': {
          if (s.k === 'for' && s.init?.length) {
            const init = add('block', s.init.map(stmtLabel).join('; '), s.line);
            nodes[nodes.length - 1].stmts = s.init.map(stmtLabel);
            connect(pending, init);
            pending = [{ from: init }];
          }
          const label = s.k === 'for' ? `FOR ${exprToText(s.cond)}` : s.k === 'foreach' ? `FOR EACH ${s.varName} IN ${exprToText(s.iter)}` : `REPEAT ${exprToText(s.count)} TIMES`;
          const header = add('loop', clip(label, 60), s.line);
          connect(pending, header);
          loops.push({ header, breaks: [] });
          let bodyEnd = seq(s.body, [{ from: header, label: 'true' }]);
          if (s.k === 'for' && s.update?.length && bodyEnd.length) {
            const upd = add('block', s.update.map(stmtLabel).join('; '), s.line);
            nodes[nodes.length - 1].stmts = s.update.map(stmtLabel);
            connect(bodyEnd, upd);
            bodyEnd = [{ from: upd }];
          }
          connect(bodyEnd.map((p) => ({ ...p, label: p.label || 'loop' })), header);
          const { breaks } = loops.pop();
          pending = [{ from: header, label: 'done' }, ...breaks];
          break;
        }
        case 'switch': {
          const sw = add('switch', clip(s.subject ? `SWITCH ${exprToText(s.subject)}` : s.verb === 'EVALUATE' ? 'EVALUATE TRUE' : 'SELECT', 60), s.line);
          connect(pending, sw);
          const ends = [];
          for (const c of s.cases) {
            const label = clip(c.tests.map((t) => (t.kind === 'range' ? `${exprToText(t.from)}..${exprToText(t.to)}` : t.kind === 'cmp' ? `${t.op} ${exprToText(t.value)}` : exprToText(t.value || t.cond))).join(', '), 28);
            ends.push(...seq(c.body, [{ from: sw, label }]));
          }
          if (s.default) ends.push(...seq(s.default, [{ from: sw, label: 'other' }]));
          else ends.push({ from: sw, label: 'no match' });
          pending = ends;
          break;
        }
        case 'try': {
          const t = add('junction', 'TRY', s.line);
          connect(pending, t);
          const bodyEnd = seq(s.body, [{ from: t }]);
          const handlerEnds = s.handlers.flatMap((h) => seq(h.body, [{ from: t, label: `catch ${clip(h.type || '', 20)}`.trim() }]));
          pending = s.finally ? seq(s.finally, [...bodyEnd, ...handlerEnds]) : [...bodyEnd, ...handlerEnds];
          break;
        }
        case 'block':
          pending = seq(s.body, pending);
          break;
        default:
          break;
      }
    }
    return pending;
  };

  const end = seq(proc.body, [{ from: entry }]);
  const completesNormally = end.length > 0;
  connect(end, exit);
  // Reachability inside the procedure
  const out = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) out.get(e.from)?.push(e.to);
  const seen = new Set([entry]);
  const stack = [entry];
  while (stack.length) {
    const id = stack.pop();
    for (const to of out.get(id) || []) {
      if (!seen.has(to)) {
        seen.add(to);
        stack.push(to);
      }
    }
  }
  for (const n of nodes) {
    n.reachable = seen.has(n.id);
    if (n.more) n.stmts.push(`… ${n.more} more`);
    if (n.kind === 'block' && n.stmts.length > 1) n.label = `${n.stmts[0]}  (+${n.stmts.length - 1})`;
  }
  return { nodes, edges, completesNormally, truncated };
}

// ---------------------------------------------------------------------------
// Whole-project analysis
// ---------------------------------------------------------------------------

function flattenData(items, path = [], out = []) {
  for (const d of items || []) {
    out.push({ item: d, path: [...path, d.name] });
    if (d.children) flattenData(d.children, [...path, d.name], out);
  }
  return out;
}

function callTargetsOf(stmt) {
  const targets = [];
  if (stmt.k === 'call' && !stmt.gosub) targets.push({ name: stmt.callee, thru: stmt.thru, external: stmt.external, kind: stmt.perform ? 'perform' : 'call', line: stmt.line, own: true });
  const scanExpr = (e) =>
    walkExpr(e, (x) => {
      if (x.k === 'call' && !x.builtin && !x.intrinsic) {
        if (x.fn.k === 'id') targets.push({ name: x.fn.name, kind: 'call', line: stmt.line });
        else if (x.fn.k === 'member') targets.push({ name: x.fn.prop, receiver: x.fn.obj, kind: 'method', line: stmt.line });
      }
      if (x.k === 'new') targets.push({ name: x.type, kind: 'new', line: stmt.line });
    });
  for (const key of ['value', 'cond', 'expr', 'init', 'subject', 'iter', 'count', 'target']) if (stmt[key]?.k) scanExpr(stmt[key]);
  for (const a of stmt.args || []) scanExpr(a);
  if (stmt.k === 'switch') for (const c of stmt.cases) for (const t of c.tests) ['value', 'cond', 'from', 'to'].forEach((k) => t[k] && scanExpr(t[k]));
  return targets;
}

const LEGACY_JAVA_TYPES = {
  Vector: 'List<T> (ArrayList)',
  Hashtable: 'Map<K,V> (HashMap / ConcurrentHashMap)',
  Enumeration: 'Iterator<T> / enhanced for-loop',
  StringBuffer: 'StringBuilder',
  Stack: 'Deque<T> (ArrayDeque)',
  Date: 'java.time (LocalDate / Instant)',
};

export function analyze(parsed) {
  const modules = parsed.flatMap((p) => p.modules);
  const findings = [];
  const addFinding = (severity, rule, message, where = {}) => findings.push({ severity, rule, message, ...where });

  const caseInsensitive = (lang) => lang === 'cobol' || lang === 'vb6';
  const procIndex = new Map(); // module name -> Map(name -> proc[])
  const moduleByName = new Map();
  for (const m of modules) {
    moduleByName.set(caseInsensitive(m.language) ? m.name.toUpperCase() : m.name, m);
    const idx = new Map();
    for (const p of m.procedures) {
      const key = caseInsensitive(m.language) ? p.name.toUpperCase() : p.name;
      if (!idx.has(key)) idx.set(key, []);
      idx.get(key).push(p);
    }
    procIndex.set(m.name, idx);
  }
  const lookup = (m, name) => procIndex.get(m.name)?.get(caseInsensitive(m.language) ? String(name).toUpperCase() : name)?.[0] || null;
  const findModule = (name, lang) => moduleByName.get(caseInsensitive(lang) ? String(name).toUpperCase() : name) || moduleByName.get(String(name).replace(/^.*[.:]/, '')) || null;

  // ----- call graph -----
  const nodes = [];
  const edges = [];
  const external = new Map();
  const procById = new Map();
  for (const m of modules) {
    for (const p of m.procedures) {
      procById.set(p.id, { proc: p, mod: m });
      nodes.push({ id: p.id, label: p.name, module: m.name, file: m.file, kind: p.kind, language: m.language, entry: false, reachable: false });
    }
  }
  const edgeKeys = new Set();
  const addEdge = (from, to, kind, lineNo) => {
    const key = `${from}->${to}:${kind}`;
    if (edgeKeys.has(key)) {
      const e = edges.find((x) => `${x.from}->${x.to}:${x.kind}` === key);
      e.count += 1;
      return;
    }
    edgeKeys.add(key);
    edges.push({ from, to, kind, line: lineNo, count: 1 });
  };
  const addExternal = (name, lang) => {
    const id = `external::${name}`;
    if (!external.has(id)) {
      external.set(id, { id, label: name, module: 'external', file: null, kind: 'external', language: lang, entry: false, reachable: true });
    }
    return id;
  };

  for (const m of modules) {
    const fieldTypes = new Map(m.dataItems.map((d) => [d.name, d.type?.name || d.type?.elem?.name]));
    for (const p of m.procedures) {
      const localTypes = new Map([...fieldTypes, ...p.params.map((x) => [x.name, x.type?.name || x.type?.elem?.name])]);
      walkStatements(p.body, (s) => {
        if (s.k === 'decl') localTypes.set(s.name, s.type?.name || s.type?.elem?.name);
      });
      walkStatements(p.body, (s) => {
        for (const t of callTargetsOf(s)) {
          if (t.kind === 'new') {
            const target = findModule(t.name, m.language);
            const ctor = target && target !== m ? target.procedures.find((q) => q.kind === 'constructor') : null;
            if (ctor) addEdge(p.id, ctor.id, 'new', t.line);
            continue;
          }
          if (t.kind === 'method') {
            const recv = t.receiver;
            let targetMod = null;
            if (recv?.k === 'id') {
              if (recv.name === 'this' || recv.name === 'Me') targetMod = m;
              else {
                const typeName = localTypes.get(recv.name);
                targetMod = typeName ? findModule(typeName, m.language) : findModule(recv.name, m.language);
              }
            }
            if (targetMod) {
              const q = lookup(targetMod, t.name);
              if (q) addEdge(p.id, q.id, 'call', t.line);
            }
            continue;
          }
          let q = lookup(m, t.name);
          if (!q && !t.external) {
            for (const other of modules) {
              if (other === m) continue;
              const cand = lookup(other, t.name);
              if (cand && cand.visibility !== 'private') {
                q = cand;
                break;
              }
            }
          }
          if (!q && m.language === 'cobol' && t.kind === 'call') {
            const prog = findModule(t.name, 'cobol');
            if (prog?.entry) q = procById.get(prog.entry)?.proc;
          }
          if (q) {
            addEdge(p.id, q.id, t.kind, t.line);
            if (t.thru) {
              const order = m.procedures;
              const from = order.indexOf(q);
              const to = order.findIndex((x) => x.name.toUpperCase() === String(t.thru).toUpperCase());
              for (let k = from + 1; k <= to && k > 0; k += 1) addEdge(p.id, order[k].id, 'thru', t.line);
            }
          } else if (t.own) {
            // Unresolved calls inside expressions are library functions; only statement-level calls become external nodes.
            addEdge(p.id, addExternal(t.name, m.language), t.external ? 'external' : t.kind, t.line);
          }
        }
      });
    }
  }

  // ----- per-procedure metrics & CFGs -----
  const cfgs = {};
  const procMetrics = [];
  const moduleData = new Map(modules.map((m) => [m.name, new Set(flattenData(m.dataItems).map((x) => x.item.name))]));
  const dataUse = new Map(); // `${module}::${name}` -> {reads:Set, writes:Set}
  const touch = (m, name, kind, procName) => {
    if (!moduleData.get(m.name)?.has(name)) return;
    const key = `${m.name}::${name}`;
    if (!dataUse.has(key)) dataUse.set(key, { reads: new Set(), writes: new Set() });
    dataUse.get(key)[kind].add(procName);
  };
  const conditionParents = new Map();
  for (const m of modules) {
    for (const { item } of flattenData(m.dataItems)) {
      for (const c of item.conditions || []) conditionParents.set(`${m.name}::${c.name}`, item.name);
    }
  }

  for (const m of modules) {
    for (const p of m.procedures) {
      const cfg = buildCfg(p);
      cfgs[p.id] = cfg;
      const cc = cyclomatic(p.body);
      const nesting = maxNesting(p.body);
      const statements = statementCount(p.body);
      const reads = new Set();
      const writes = new Set();
      const locals = new Set(p.params.map((x) => x.name));
      let gotoCount = 0;
      walkStatements(p.body, (s) => {
        if (s.k === 'decl') locals.add(s.name);
        if (s.k === 'goto') gotoCount += 1;
        const { defs, uses } = stmtDefsUses(s);
        for (const d of defs) {
          if (!locals.has(d)) {
            writes.add(d);
            touch(m, d, 'writes', p.name);
          }
        }
        for (const u of uses) {
          if (!locals.has(u)) {
            reads.add(u);
            touch(m, u, 'reads', p.name);
          }
        }
        if (s.k === 'for') {
          for (const x of [...s.init, ...s.update]) {
            const du = stmtDefsUses(x);
            du.defs.forEach((d) => !locals.has(d) && (writes.add(d), touch(m, d, 'writes', p.name)));
            du.uses.forEach((u) => !locals.has(u) && (reads.add(u), touch(m, u, 'reads', p.name)));
          }
        }
      });
      const unreachableBlocks = cfg.nodes.filter((n) => !n.reachable && n.kind !== 'exit');
      const lines = (p.loc.end || p.loc.start) - p.loc.start + 1;
      const risk = cc > 10 || gotoCount > 0 || unreachableBlocks.length ? 'high' : cc > 5 || nesting > 3 || statements > 40 ? 'medium' : 'low';
      procMetrics.push({
        id: p.id,
        name: p.name,
        module: m.name,
        file: m.file,
        language: m.language,
        kind: p.kind,
        visibility: p.visibility,
        params: p.params.map((x) => ({ name: x.name, type: describeType(x.type), legacyType: x.legacyType })),
        returns: p.returns ? describeType(p.returns) : null,
        loc: p.loc,
        lines,
        statements,
        complexity: cc,
        nesting,
        gotoCount,
        reads: [...reads].filter((x) => moduleData.get(m.name)?.has(x)).sort(),
        writes: [...writes].filter((x) => moduleData.get(m.name)?.has(x)).sort(),
        calls: [],
        calledBy: [],
        completesNormally: cfg.completesNormally,
        unreachableBlocks: unreachableBlocks.length,
        risk,
        suggestedName: toCamel(p.name),
        order: p.order ?? null,
      });
      for (const n of unreachableBlocks) {
        addFinding('warning', 'unreachable-code', `Unreachable statements in ${p.name}: "${n.label}"`, { file: m.file, line: n.line, procedure: p.id });
      }
      if (cc > 20) addFinding('critical', 'high-complexity', `${p.name} has cyclomatic complexity ${cc}; split it before translation`, { file: m.file, line: p.loc.start, procedure: p.id });
      else if (cc > 10) addFinding('warning', 'high-complexity', `${p.name} has cyclomatic complexity ${cc}`, { file: m.file, line: p.loc.start, procedure: p.id });
      if (nesting > 4) addFinding('info', 'deep-nesting', `${p.name} nests control structures ${nesting} levels deep`, { file: m.file, line: p.loc.start, procedure: p.id });
      if (statements > 60) addFinding('info', 'long-procedure', `${p.name} has ${statements} statements; consider extracting smaller functions`, { file: m.file, line: p.loc.start, procedure: p.id });
      walkStatements(p.body, (s) => {
        if (s.k === 'goto') addFinding('warning', 'goto', `GO TO ${s.label} in ${p.name} creates unstructured control flow`, { file: m.file, line: s.line, procedure: p.id });
        if (s.k === 'raw' && s.verb === 'ON ERROR' && s.errorMode === 'resume-next') addFinding('warning', 'on-error-resume-next', `On Error Resume Next in ${p.name} silently ignores runtime errors`, { file: m.file, line: s.line, procedure: p.id });
        if (s.k === 'raw' && s.verb === 'ALTER') addFinding('critical', 'alter', `ALTER in ${p.name} rewrites GO TO targets at runtime`, { file: m.file, line: s.line, procedure: p.id });
        if (s.k === 'noop' && s.verb === 'NEXT SENTENCE') addFinding('warning', 'next-sentence', `NEXT SENTENCE in ${p.name} jumps past the next period`, { file: m.file, line: s.line, procedure: p.id });
        if (s.k === 'call' && s.gosub) addFinding('warning', 'gosub', `GoSub in ${p.name}; convert to a private function`, { file: m.file, line: s.line, procedure: p.id });
        if (s.k === 'assign' && /^STR(N)?(CPY|CAT)$/.test(s.verb || '')) addFinding('warning', 'unsafe-string', `${s.verb.toLowerCase()} in ${p.name} can overflow a fixed buffer`, { file: m.file, line: s.line, procedure: p.id });
        if (s.k === 'raw' && !['ON ERROR', 'ALTER'].includes(s.verb) && s.note) addFinding('info', 'manual-review', `${s.note} (${p.name})`, { file: m.file, line: s.line, procedure: p.id });
        const scan = (e) =>
          walkExpr(e, (x) => {
            if (x.k === 'new' && ['Double', 'Integer', 'Long', 'Boolean', 'Float'].includes(x.type)) addFinding('info', 'deprecated-boxing', `new ${x.type}(...) in ${p.name}; use ${x.type}.valueOf or autoboxing`, { file: m.file, line: s.line, procedure: p.id });
          });
        for (const key of ['value', 'expr', 'init']) if (s[key]?.k) scan(s[key]);
      });
      if (p.isSynchronized) addFinding('info', 'synchronized', `${p.name} is synchronized; review thread-safety in the target design`, { file: m.file, line: p.loc.start, procedure: p.id });
    }
  }

  // ----- reachability -----
  const out = new Map();
  for (const e of edges) {
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from).push(e.to);
  }
  const roots = new Set();
  const hasCppMain = modules.some((m) => m.language === 'cpp' && m.entry);
  for (const m of modules) {
    if (m.entry) roots.add(m.entry);
    for (const p of m.procedures) {
      if (p.isEventHandler) roots.add(p.id);
      // Non-private Java methods and public VB6 procedures are callable from outside the project.
      if (m.language === 'java' && p.visibility !== 'private') roots.add(p.id);
      if (m.language === 'vb6' && p.visibility !== 'private') roots.add(p.id);
      if (m.language === 'cpp' && !hasCppMain && !p.isStatic) roots.add(p.id);
    }
    // COBOL fall-through: control continues into the next paragraph when one completes normally.
    if (m.language === 'cobol' && m.entry) {
      let idx = m.procedures.findIndex((p) => p.id === m.entry);
      while (idx >= 0 && idx < m.procedures.length - 1 && cfgs[m.procedures[idx].id]?.completesNormally) {
        const cur = m.procedures[idx];
        const nextP = m.procedures[idx + 1];
        if (cur.kind === 'section' || nextP.section) break;
        addEdge(cur.id, nextP.id, 'fall-through', cur.loc.end);
        addFinding('warning', 'fall-through', `Paragraph ${cur.name} does not end with STOP RUN/GOBACK and falls through into ${nextP.name}`, { file: m.file, line: cur.loc.end, procedure: cur.id });
        if (!out.has(cur.id)) out.set(cur.id, []);
        out.get(cur.id).push(nextP.id);
        idx += 1;
      }
    }
  }
  const reachable = new Set(roots);
  const stack = [...roots];
  while (stack.length) {
    const id = stack.pop();
    for (const to of out.get(id) || []) {
      if (!reachable.has(to)) {
        reachable.add(to);
        stack.push(to);
      }
    }
  }
  for (const n of nodes) {
    n.entry = roots.has(n.id);
    n.reachable = reachable.has(n.id);
  }
  const metricsById = new Map(procMetrics.map((x) => [x.id, x]));
  for (const e of edges) {
    const fromM = metricsById.get(e.from);
    const toM = metricsById.get(e.to);
    if (fromM) fromM.calls.push(toM ? toM.name : external.get(e.to)?.label || e.to);
    if (toM && fromM) toM.calledBy.push(fromM.name);
  }
  for (const pm of procMetrics) {
    pm.calls = [...new Set(pm.calls)];
    pm.calledBy = [...new Set(pm.calledBy)];
    pm.reachable = reachable.has(pm.id);
    pm.entry = roots.has(pm.id);
    if (!pm.reachable) {
      pm.risk = 'high';
      const what = pm.language === 'cobol' ? 'paragraph' : pm.kind;
      addFinding('warning', 'dead-code', `${what[0].toUpperCase()}${what.slice(1)} ${pm.name} is never ${pm.language === 'cobol' ? 'performed' : 'called'} from any entry point`, { file: pm.file, line: pm.loc.start, procedure: pm.id });
    }
  }

  // ----- data dictionary -----
  const dataDictionary = [];
  for (const m of modules) {
    for (const { item, path } of flattenData(m.dataItems)) {
      const use = dataUse.get(`${m.name}::${item.name}`) || { reads: new Set(), writes: new Set() };
      // Reads/writes through level-88 condition names count toward the parent.
      const readBy = [...use.reads];
      const writtenBy = [...use.writes];
      const isGroup = Boolean(item.children?.length);
      const childUsed = isGroup && flattenData(item.children).some(({ item: c }) => dataUse.has(`${m.name}::${c.name}`));
      const unused = !readBy.length && !writtenBy.length && !childUsed && !item.isConst;
      let suggestedType = describeType(item.type);
      const conds = item.conditions || [];
      if (conds.length === 2 && conds.every((c) => c.values.length === 1)) suggestedType = `Boolean (from 88-levels ${conds.map((c) => c.name).join(' / ')})`;
      else if (conds.length > 2) suggestedType = `Enum { ${conds.map((c) => toPascal(c.name)).join(', ')} }`;
      dataDictionary.push({
        name: item.name,
        path: path.join(' > '),
        module: m.name,
        file: m.file,
        line: item.line,
        scope: item.scope || 'field',
        level: item.level ?? null,
        legacyType: item.legacyType || (item.pic ? `PIC ${item.pic}` : null),
        type: item.type,
        typeLabel: describeType(item.type),
        initial: item.initial ? exprToText(item.initial) : null,
        isConst: Boolean(item.isConst),
        conditions: conds.map((c) => ({ name: c.name, values: c.values.map((v) => (v.from ? `${exprToText(v.from)} THRU ${exprToText(v.to)}` : exprToText(v))) })),
        readBy,
        writtenBy,
        unused,
        suggestedName: toCamel(item.name),
        suggestedType,
      });
      if (unused && !isGroup && item.name !== 'FILLER') addFinding('info', 'unused-data', `${item.name} is declared but never used`, { file: m.file, line: item.line });
      if (item.redefines) addFinding('info', 'redefines', `${item.name} REDEFINES ${item.redefines}; the memory overlay needs an explicit conversion`, { file: m.file, line: item.line });
      if (item.usage === 'COMP-3') addFinding('info', 'packed-decimal', `${item.name} is packed decimal (COMP-3); map to an exact decimal type`, { file: m.file, line: item.line });
      if (item.type?.t === 'object' && LEGACY_JAVA_TYPES[item.type.name] && m.language === 'java') addFinding('info', 'legacy-collection', `${item.name} uses ${item.type.name}; replace with ${LEGACY_JAVA_TYPES[item.type.name]}`, { file: m.file, line: item.line });
      if (m.language === 'vb6' && item.type?.t === 'unknown') addFinding('info', 'variant', `${item.name} is a Variant; give it an explicit type`, { file: m.file, line: item.line });
      if (m.language === 'cpp' && item.macro) addFinding('info', 'macro-constant', `#define ${item.name} should become a typed constant`, { file: m.file, line: item.line });
      if ((m.language === 'vb6' || m.language === 'cpp') && !item.isConst && (writtenBy.length > 1 || (writtenBy.length && readBy.some((r) => !writtenBy.includes(r))))) {
        addFinding('info', 'global-state', `${item.name} is shared mutable module state (written by ${writtenBy.join(', ')})`, { file: m.file, line: item.line });
      }
    }
    if (m.language === 'vb6' && !m.meta?.options?.some((o) => /explicit/i.test(o))) addFinding('warning', 'option-explicit', `${m.name} lacks Option Explicit; undeclared variables become Variants`, { file: m.file, line: 1 });
    if (m.language === 'java') {
      const seenTypes = new Set();
      for (const p of m.procedures) {
        walkStatements(p.body, (s) => {
          if (s.k === 'decl' && s.type?.t === 'object' && LEGACY_JAVA_TYPES[s.type.name] && !seenTypes.has(s.type.name)) {
            seenTypes.add(s.type.name);
            addFinding('info', 'legacy-collection', `${s.type.name} used in ${p.name}; replace with ${LEGACY_JAVA_TYPES[s.type.name]}`, { file: m.file, line: s.line, procedure: p.id });
          }
        });
      }
    }
    for (const d of m.diagnostics || []) addFinding(d.severity === 'error' ? 'critical' : 'info', 'parse', d.message, { file: m.file, line: d.line });
  }
  const decimalFields = dataDictionary.filter((d) => d.type?.t === 'decimal').length;

  // ----- summary -----
  const totalLines = parsed.reduce((a, p) => a + p.lines, 0);
  const statements = procMetrics.reduce((a, p) => a + p.statements, 0);
  const complexities = procMetrics.map((p) => p.complexity);
  const severityRank = { critical: 0, warning: 1, info: 2 };
  findings.sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || (a.file || '').localeCompare(b.file || '') || (a.line || 0) - (b.line || 0));
  const bySeverity = { critical: 0, warning: 0, info: 0 };
  for (const x of findings) bySeverity[x.severity] += 1;
  const hints = [];
  if (decimalFields) hints.push(`${decimalFields} fixed-point field(s): use BigDecimal / decimal / Decimal, never binary floating point, and keep the legacy truncation / ROUNDED behaviour.`);
  if (modules.some((m) => m.language === 'cobol')) hints.push('COBOL paragraphs become methods; WORKING-STORAGE becomes fields or a state object; OCCURS tables become arrays or lists of records.');
  if (modules.some((m) => m.language === 'vb6')) hints.push('VB6 arrays are 1-based here; shift indices when moving to 0-based collections. Function-name assignment becomes an explicit return.');
  if (modules.some((m) => m.language === 'java')) hints.push('Replace raw Hashtable/Vector with generic collections and remove manual boxing.');
  if (modules.some((m) => m.language === 'cpp')) hints.push('Replace fixed char buffers and strcpy with managed strings; replace printf with the target formatting API.');

  return {
    summary: {
      files: parsed.length,
      modules: modules.length,
      procedures: procMetrics.length,
      dataItems: dataDictionary.length,
      lines: totalLines,
      statements,
      avgComplexity: complexities.length ? Math.round((complexities.reduce((a, b) => a + b, 0) / complexities.length) * 10) / 10 : 0,
      maxComplexity: complexities.length ? Math.max(...complexities) : 0,
      entryPoints: nodes.filter((n) => n.entry).map((n) => n.id),
      deadProcedures: procMetrics.filter((p) => !p.reachable).map((p) => p.id),
      externalCalls: [...external.values()].map((x) => x.label),
      findings: bySeverity,
      languages: [...new Set(modules.map((m) => m.language))],
    },
    modules: modules.map((m) => ({ name: m.name, file: m.file, language: m.language, kind: m.kind, entry: m.entry, procedures: m.procedures.length, dataItems: flattenData(m.dataItems).length, imports: m.imports || [], meta: m.meta || {} })),
    procedures: procMetrics,
    callGraph: { nodes: [...nodes, ...external.values()], edges },
    // An array, not a map: procedure ids can contain dots, which MongoDB field names should avoid.
    cfgs: Object.entries(cfgs).map(([procedure, cfg]) => ({ procedure, ...cfg })),
    dataDictionary,
    findings,
    hints,
  };
}
