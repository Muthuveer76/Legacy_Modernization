import { toCamel, toPascal, toSnake, words } from '../analyzer.js';
import { walkStatements } from '../ir.js';

// Builds a target-neutral "unit" (one modern class per legacy module) with names chosen
// for the target language, plus the symbol tables the printers use to resolve references.

const RESERVED = {
  java: 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while var record yield out',
  python: 'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield print input len str int float list dict type id sum max min round out',
  typescript: 'break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with let static yield await implements interface package private protected public any number string boolean out',
  csharp: 'abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while record var',
};

const RESERVED_SETS = Object.fromEntries(Object.entries(RESERVED).map(([k, v]) => [k, new Set(v.split(' '))]));

export function namer(target) {
  const reserved = RESERVED_SETS[target];
  const safe = (n) => (reserved.has(n) ? `${n}Value` : n);
  const upperSnake = (n) => (words(n).join('_') || 'VALUE').toUpperCase();
  if (target === 'python') {
    return { cls: (n) => safe(toPascal(n)), field: (n) => safe(toSnake(n)), recordField: (n) => safe(toSnake(n)), method: (n) => safe(toSnake(n)), local: (n) => safe(toSnake(n)), constant: upperSnake };
  }
  if (target === 'csharp') {
    return { cls: (n) => safe(toPascal(n)), field: (n) => safe(toCamel(n)), recordField: (n) => safe(toPascal(n)), method: (n) => safe(toPascal(n)), local: (n) => safe(toCamel(n)), constant: (n) => safe(toPascal(n)) };
  }
  return { cls: (n) => safe(toPascal(n)), field: (n) => safe(toCamel(n)), recordField: (n) => safe(toCamel(n)), method: (n) => safe(toCamel(n)), local: (n) => safe(toCamel(n)), constant: upperSnake };
}

function pluralize(name) {
  if (/(s|x|z|ch|sh)$/i.test(name)) return `${name}es`;
  if (/[^aeiou]y$/i.test(name)) return `${name.slice(0, -1)}ies`;
  return `${name}s`;
}

function singular(name) {
  return String(name).replace(/[-_](TABLE|TBL|LIST|ARRAY|ARR|ENTRY|ENTRIES|REC|RECORD)$/i, '');
}

export function caseKey(lang) {
  return lang === 'cobol' || lang === 'vb6' ? (n) => String(n).toUpperCase() : (n) => String(n);
}

function uniqueIn(set, base) {
  let n = base;
  let i = 2;
  while (set.has(n)) {
    n = `${base}${i}`;
    i += 1;
  }
  set.add(n);
  return n;
}

function constNumber(mod, name) {
  const d = mod.dataItems.find((x) => x.name === name && x.initial?.k === 'num');
  return d ? Number(d.initial.v) : null;
}

export function buildUnit(mod, analysis, target) {
  const nm = namer(target);
  const key = caseKey(mod.language);
  const classNames = new Set();
  const memberNames = new Set();
  const symbols = new Map();
  const unit = {
    mod,
    language: mod.language,
    legacyName: mod.name,
    className: uniqueIn(classNames, nm.cls(mod.name.replace(/\./g, '_'))),
    fields: [],
    records: [],
    methods: [],
    // Java static { ... } blocks; each printer emits them in its own static-initialization form.
    staticInits: [],
    symbols,
    recordsByName: new Map(),
    notes: [],
    usesStopRun: false,
    runSequence: [],
  };

  // ---- records (VB6 Type, C/C++ struct) ----
  const addRecord = (legacyName, fields) => {
    const rec = { name: uniqueIn(classNames, nm.cls(singular(legacyName))), legacyName, fields: [], fieldMap: new Map() };
    const used = new Set();
    for (const f of fields) {
      const name = uniqueIn(used, nm.recordField(f.name));
      rec.fields.push({ name, legacyName: f.name, type: f.type, init: f.initial || null, comment: f.legacyType || f.pic || '' });
      rec.fieldMap.set(key(f.name), { name, type: f.type });
    }
    unit.records.push(rec);
    unit.recordsByName.set(key(legacyName), rec);
    return rec;
  };
  for (const t of mod.types || []) {
    if (t.kind === 'record') addRecord(t.name, t.fields);
  }

  // ---- fields ----
  if (mod.language === 'cobol') {
    const visit = (item, ctx) => {
      if (item.name === 'FILLER' && !item.children?.length) return;
      if (item.children?.length && !item.occurs) {
        symbols.set(key(item.name), { kind: 'group', legacy: item });
        item.children.forEach((c) => visit(c, ctx));
        return;
      }
      if (item.children?.length && item.occurs) {
        const rec = { name: uniqueIn(classNames, nm.cls(singular(item.name))), legacyName: item.name, fields: [], fieldMap: new Map() };
        unit.records.push(rec);
        unit.recordsByName.set(key(item.name), rec);
        const fieldName = uniqueIn(ctx.used, pluralize((ctx.inRecord ? nm.recordField : nm.field)(singular(item.name))));
        const type = { t: 'array', elem: { t: 'record', name: rec.name }, length: item.occurs };
        ctx.container.push({ name: fieldName, legacyName: item.name, type, init: null, comment: `${item.name} OCCURS ${item.occurs}`, recordArray: rec.name });
        const step = { name: fieldName, occurs: true, lower: 1 };
        symbols.set(key(item.name), { kind: 'field', name: fieldName, type, path: [...ctx.path, step], inRecord: ctx.inRecord });
        const recCtx = { container: rec.fields, path: [...ctx.path, step], inRecord: true, used: new Set() };
        item.children.forEach((c) => visit(c, recCtx));
        return;
      }
      const fieldName = uniqueIn(ctx.used, (ctx.inRecord ? nm.recordField : nm.field)(item.name));
      const field = {
        name: fieldName,
        legacyName: item.name,
        type: item.type,
        init: item.initial || null,
        comment: `${item.name}${item.legacyType ? ` ${item.legacyType}` : ''}${item.conditions?.length ? ` (88: ${item.conditions.map((c) => c.name).join(', ')})` : ''}`,
      };
      ctx.container.push(field);
      symbols.set(key(item.name), { kind: 'field', name: fieldName, type: item.type, path: [...ctx.path, { name: fieldName, occurs: Boolean(item.occurs), lower: 1 }], inRecord: ctx.inRecord });
    };
    const top = { container: unit.fields, path: [], inRecord: false, used: memberNames };
    mod.dataItems.forEach((d) => visit(d, top));
    // Record field maps for member resolution
    for (const rec of unit.records) for (const f of rec.fields) rec.fieldMap.set(key(f.legacyName), { name: f.name, type: f.type });
  } else {
    for (const d of mod.dataItems) {
      const isConst = Boolean(d.isConst);
      const name = uniqueIn(memberNames, isConst && d.initial ? nm.constant(d.name) : nm.field(d.name));
      let type = d.type;
      if (type?.t === 'array' && type.length == null && type.sizeExpr) {
        const n = constNumber(mod, type.sizeExpr);
        if (n != null) type = { ...type, length: n };
      }
      if (type?.t === 'array' && type.elem?.t === 'object' && unit.recordsByName.has(key(type.elem.name))) {
        type = { ...type, elem: { t: 'record', name: unit.recordsByName.get(key(type.elem.name)).name } };
      }
      if (type?.t === 'object' && unit.recordsByName.has(key(type.name))) type = { t: 'record', name: unit.recordsByName.get(key(type.name)).name };
      const field = { name, legacyName: d.name, type, init: d.initial || null, isConst: isConst && Boolean(d.initial), isStatic: Boolean(d.isStatic), visibility: d.visibility, comment: d.legacyType || '' };
      unit.fields.push(field);
      const lower = type?.t === 'array' ? type.lower ?? 0 : 0;
      symbols.set(key(d.name), { kind: field.isConst ? 'const' : 'field', name, type, path: [{ name, occurs: type?.t === 'array', lower }], isStatic: field.isStatic || field.isConst });
    }
  }

  // ---- methods ----
  const procMetrics = new Map((analysis?.procedures || []).map((p) => [p.id, p]));
  for (const p of mod.procedures) {
    const isInit = p.kind === 'initializer';
    const isEntry = mod.entry === p.id;
    const isPrivate = p.visibility === 'private' || mod.language === 'cobol';
    const legacyName = p.name.replace(/^.*::/, '');
    // A C/VB6 main becomes run(); every class also gets a static entry point that calls it.
    let baseName = isEntry && /^main$/i.test(legacyName) && mod.language !== 'java' ? nm.method('run') : nm.method(legacyName);
    if (target === 'python' && isPrivate && !isEntry) baseName = `_${baseName}`;
    const overloadable = target === 'java' || target === 'csharp';
    const existing = unit.methods.find((m) => m.name === baseName);
    // A static C# Main would compete with the host's entry point.
    if (target === 'csharp' && baseName === 'Main' && p.isStatic) baseName = 'RunMain';
    let name;
    if (p.kind === 'constructor') name = 'constructor';
    else if (isInit) name = 'staticInit';
    else if (overloadable && existing && existing.legacy.params.length !== p.params.length) name = baseName;
    else name = uniqueIn(memberNames, baseName);
    const usedLocals = new Set([...memberNames]);
    const locals = new Map();
    const params = p.params.map((x) => {
      const pn = uniqueIn(usedLocals, nm.local(x.name));
      locals.set(key(x.name), { kind: 'local', name: pn, type: x.type });
      return { name: pn, legacyName: x.name, type: x.type, byRef: x.byRef, legacyType: x.legacyType };
    });
    walkStatements(p.body, (s) => {
      if (s.k === 'decl' && !locals.has(key(s.name))) locals.set(key(s.name), { kind: 'local', name: uniqueIn(usedLocals, nm.local(s.name)), type: s.type });
      if (s.k === 'foreach' && !locals.has(key(s.varName))) locals.set(key(s.varName), { kind: 'local', name: uniqueIn(usedLocals, nm.local(s.varName)), type: s.varType || { t: 'unknown' } });
      if (s.k === 'for') for (const init of s.init) if (init.k === 'decl' && !locals.has(key(init.name))) locals.set(key(init.name), { kind: 'local', name: uniqueIn(usedLocals, nm.local(init.name)), type: init.type });
    });
    let returnVar = null;
    walkStatements(p.body, (s) => {
      if (s.returnValue) returnVar = returnVar || uniqueIn(usedLocals, target === 'python' ? 'result' : 'result');
    });
    (isInit ? unit.staticInits : unit.methods).push({
      legacy: p,
      name,
      params,
      returns: p.returns,
      locals,
      returnVar,
      visibility: isPrivate && !isEntry ? 'private' : 'public',
      isStatic: Boolean(p.isStatic) && mod.language === 'java',
      isEntry,
      isConstructor: p.kind === 'constructor',
      metrics: procMetrics.get(p.id) || null,
    });
    if (isInit) continue;
    symbols.set(`proc:${key(p.name)}`, { kind: 'method', name, returns: p.returns, legacy: p });
  }

  // COBOL: STOP RUN outside the entry paragraph needs a non-local exit.
  if (mod.language === 'cobol') {
    for (const m of unit.methods) {
      walkStatements(m.legacy.body, (s) => {
        if (s.k === 'exit' && s.scope === 'program' && !m.isEntry) unit.usesStopRun = true;
      });
      if (m.isEntry) {
        const body = m.legacy.body;
        walkStatements(body, (s) => {
          if (s.k === 'exit' && s.scope === 'program' && s !== body[body.length - 1]) unit.usesStopRun = true;
        });
      }
    }
    // run() replays the fall-through chain the analyzer found.
    const fall = (analysis?.callGraph?.edges || []).filter((e) => e.kind === 'fall-through');
    const entry = unit.methods.find((m) => m.isEntry);
    if (entry) {
      unit.runSequence.push(entry.name);
      let cur = entry.legacy.id;
      for (;;) {
        const e = fall.find((x) => x.from === cur);
        if (!e) break;
        const next = unit.methods.find((m) => m.legacy.id === e.to);
        if (!next) break;
        unit.runSequence.push(next.name);
        cur = e.to;
      }
    }
  } else {
    // A legacy Java static main(String[]) stays the entry point as-is.
    const entry = unit.methods.find((m) => m.isEntry);
    if (entry && !(mod.language === 'java' && entry.isStatic)) unit.runSequence.push(entry.name);
  }
  return unit;
}
