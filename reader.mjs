// A small reader for the part of the draft these descriptors use. It refuses (throws) instead of guessing.
import { AbiCoder, FunctionFragment, ParamType, getAddress, id } from 'ethers';
const coder = AbiCoder.defaultAbiCoder();

export class Refused extends Error {}
const refuse = (why) => { throw new Refused(why); };

const decodeTuple = (params, hex) => {
  let values;
  try { values = coder.decode(params, hex); } catch { refuse('input does not decode as ' + params.map((p) => p.format('sighash')).join(',')); }
  return Object.fromEntries(params.map((p, i) => [p.name, named(p, values[i])]));
};
// ethers results -> plain objects keyed by the names of the descriptor
function named(p, v) {
  if (p.baseType === 'array') return [...v].map((x) => named(p.arrayChildren, x));
  if (p.baseType === 'tuple') return Object.fromEntries(p.components.map((c, i) => [c.name, named(c, v[i])]));
  return v;
}

// --- custom encoding -------------------------------------------------------------------------------------------
function layout(node, cur) {
  const take = (n) => { if (cur.pos + n > cur.buf.length) refuse('custom encoding: not enough bytes'); const b = cur.buf.subarray(cur.pos, cur.pos + n); cur.pos += n; return b; };
  const hex = (b) => '0x' + b.toString('hex');
  switch (node.type) {
    case 'uint': return BigInt(hex(take(node.bytes)));
    case 'address': { const b = take(node.bytes); if (node.bytes === 32 && b.subarray(0, 12).some((x) => x)) refuse('dirty address'); return hex(b.subarray(-20)); }
    case 'sequence': { const out = []; while (cur.pos < cur.buf.length) out.push(layout(node.element, cur)); return out; }
    case 'object': return Object.fromEntries(node.entries.map((e) => [e.name, layout(e.schema, cur)]));
    default: refuse('layout ' + node.type);
  }
}
function customEncoding(params, hexValue) {
  const cur = { buf: Buffer.from(hexValue.slice(2), 'hex'), pos: 0 };
  const v = layout(params, cur);
  if (cur.pos !== cur.buf.length) refuse('custom encoding: bytes left over');
  return v;
}

// --- paths ------------------------------------------------------------------------------------------------------
// #. = function arguments, ~. = payload of the current case, @. = transaction. `.[$index]` is the position in the
// iteration that the current field belongs to.
function resolve(path, scope) {
  let root, rest;
  if (path.startsWith('#.')) [root, rest] = [scope.args, path.slice(2)];
  else if (path.startsWith('~.')) [root, rest] = [scope.local, path.slice(2)];
  else if (path.startsWith('@.')) [root, rest] = [scope.tx, path.slice(2)];
  else [root, rest] = [scope.local ?? scope.args, path];
  let vals = [root];
  for (const part of rest.split('.')) {
    const m = part.match(/^\[(.*)\]$/);
    if (!m) vals = vals.map((v) => (v && typeof v === 'object' && part in v ? v[part] : refuse('path ' + path)));
    else if (m[1] === '') vals = vals.flatMap((v) => v);
    else { const i = m[1] === '$index' ? scope.index : Number(m[1]); vals = vals.map((v) => { const x = v.at(i); if (x === undefined) refuse('index out of range in ' + path); return x; }); }
  }
  return rest.includes('[]') ? vals : vals[0];
}

// --- formats ----------------------------------------------------------------------------------------------------
const trim = (x) => x.replace(/\.?0+$/, '');
function units(v, decimals) {
  const s = v.toString().padStart(decimals + 1, '0');
  return decimals ? trim(s.slice(0, -decimals) + '.' + s.slice(-decimals)) || '0' : s;
}
function format(f, value, scope, env) {
  const p = f.params ?? {};
  switch (f.format ?? 'raw') {
    case 'tokenAmount': {
      let token = p.token ?? resolve(p.tokenPath, scope);
      if (Array.isArray(token)) token = token[scope.each]; // tokenPath and path iterate the same array
      token = token.toLowerCase();
      const meta = token === p.nativeCurrencyAddress?.toLowerCase() ? env.native : env.token(token);
      const symbol = meta?.symbol ?? `(unknown token ${token})`;
      if (p.threshold && value >= BigInt(p.threshold)) return `${p.message} ${symbol}`;
      return `${units(value, meta?.decimals ?? 0)} ${symbol}`;
    }
    case 'amount':
      if (p.threshold && value >= BigInt(p.threshold)) return p.message;
      return `${units(value, env.native.decimals)} ${env.native.symbol}`;
    case 'addressName': {
      const a = value.toLowerCase();
      if (env.registry) return getAddress(p.senderAddress?.some((x) => x.toLowerCase() === a) ? scope.tx.from : a);
      if (p.senderAddress?.some((x) => x.toLowerCase() === a) || a === scope.tx.from.toLowerCase()) return 'You';
      if (a === '0x0000000000000000000000000000000000000002' || a === scope.tx.to.toLowerCase()) return 'Uniswap router'; // not expressible today, see README
      if (p.types?.includes('token') && env.token(a)) return env.token(a).symbol;
      return value;
    }
    case 'date': if (value > 8640000000000n) return 'timestamp ' + value; // beyond what a date can show, e.g. type(uint48).max
      if (env.registry) return new Date(Number(value) * 1000).toISOString().slice(0, 19).replace('T', ' ') + 'Z';
      return new Date(Number(value) * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    case 'unit': return `${units(value, p.decimals)}${p.base}`;
    default: return String(value);
  }
}
const same = (a, b) => (typeof a === 'boolean' || typeof b === 'boolean' ? a === b : String(a).toLowerCase() === String(b).toLowerCase());

// --- rendering --------------------------------------------------------------------------------------------------
function key(value) {
  if (typeof value === 'boolean') return value ? '0x01' : '0x00';
  return '0x' + BigInt(value).toString(16).padStart(2, '0');
}
function show(fields, scope, env, out) {
  for (const f of fields) {
    if (f.format === 'customEncoding') continue; // decoded before the fields, see prepare()
    if (f.switch) { showSwitch(f, scope, env, out); continue; }
    if (f.interaction) { interaction(f.interaction, scope, env, out); continue; }
    if (f.visible === 'never') continue;
    const value = resolve(f.path, scope);
    (Array.isArray(value) ? value : [value]).forEach((v, each) => {
      if (f.visible?.ifNotIn?.some((x) => same(x, v))) return;
      out.push({ label: f.label, value: format(f, v, { ...scope, each }, env) });
    });
  }
}
// customEncoding fields replace the raw bytes they describe, so that paths can go through them.
function prepare(fields, root) {
  for (const f of fields) if (f.format === 'customEncoding') {
    const name = f.path.replace(/^[~#]\./, '');
    root[name] = customEncoding(f.params, root[name]);
  }
}
function pick(sw, scope) {
  let v = resolve(sw.expression.path, scope);
  if (sw.expression.mask) v = BigInt(v) & BigInt(sw.expression.mask);
  const c = sw.cases[key(v)] ?? sw.cases.$default;
  if (c === undefined || c === 'reject') refuse('no case for ' + key(v) + ' in ' + sw.expression.path);
  return c;
}
function showSwitch(f, scope, env, out) {
  const value = resolve(f.path, scope);
  if (!f.path.endsWith('.[]')) { const c = pick(f.switch, scope); out.push({ label: f.label, value: format({ ...f, ...c }, value, scope, env) }); return; }
  const tags = resolve(f.switch.expression.path.replace('.[$index]', ''), scope);
  if (tags.length !== value.length) refuse('as many tags as inputs expected'); // the router reverts (LengthMismatch)
  value.forEach((payload, index) => {
    const inner = { ...scope, index };
    const [signature, spec] = Object.entries(pick(f.switch, inner))[0];
    const params = ParamType.from(`tuple${signature}`).components;
    inner.local = decodeTuple(params, payload);
    prepare(spec.fields, inner.local);
    const step = []; show(spec.fields, inner, env, step);
    out.push({ label: spec.intent, group: f.label, steps: step });
  });
}

// A call the contract builds itself. Only calls to the contract being described are followed: the format is
// looked up in the same descriptor, and the arguments are the decoded values, not bytes.
const MAX_DEPTH = 4;
function interaction(i, scope, env, out) {
  const to = resolve(i.to, scope);
  if (String(to).toLowerCase() !== scope.tx.to.toLowerCase()) refuse('interaction with another contract');
  if ((scope.depth ?? 0) >= MAX_DEPTH) refuse('interactions nested too deep');
  const wanted = FunctionFragment.from('function ' + i.signature).format('sighash');
  const found = Object.entries(scope.descriptor.display.formats).find(([s]) => FunctionFragment.from('function ' + s).format('sighash') === wanted);
  if (!found) refuse('no format for ' + i.signature);
  const fn = FunctionFragment.from('function ' + found[0]);
  // deep copy: prepare() replaces raw bytes by their decoded form
  const args = structuredClone(Object.fromEntries(fn.inputs.map((p, k) => [p.name, resolve(i.args[k].path, scope)])));
  // the inner call carries no native value of its own
  const inner = { ...scope, tx: { ...scope.tx, value: 0n }, args, local: undefined, index: undefined, depth: (scope.depth ?? 0) + 1 };
  prepare(found[1].fields, inner.args);
  show(found[1].fields, inner, env, out);
}

export function render(descriptor, tx, env) {
  for (const [signature, spec] of Object.entries(descriptor.display.formats)) {
    const fn = FunctionFragment.from('function ' + signature);
    if (id(fn.format('sighash')).slice(0, 10) !== tx.input.slice(0, 10)) continue;
    const scope = { descriptor, tx: { ...tx, value: BigInt(tx.value) }, args: decodeTuple([...fn.inputs], '0x' + tx.input.slice(10)) };
    prepare(spec.fields, scope.args);
    const out = []; show(spec.fields, scope, env, out);
    return { intent: spec.intent, fields: out };
  }
  refuse('unknown selector');
}
