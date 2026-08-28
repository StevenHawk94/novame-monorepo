const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict'), ts = require('typescript');
function load(file, imports = {}, globals = {}) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, console,
    require(name) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; }, ...globals });
  return module.exports;
}
function clock() {
  let now = 10000, next = 0;
  const timers = new Map();
  const globals = {
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } },
    setTimeout(fn, ms) { const id = ++next; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  return { globals, timers, advance(ms) {
    const end = now + ms;
    let count = 0;
    while (true) {
      const entry = [...timers].sort((a,b) => a[1].at - b[1].at)[0];
      if (!entry || entry[1].at > end) break;
      assert.ok(count++ < 1000, 'timer loop'); now = entry[1].at; timers.delete(entry[0]); entry[1].fn();
    }
    now = end;
  } };
}
function hooks() {
  const slots = [], effects = [];
  let cursor = 0;
  const react = {
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useState(initial) { const i = cursor++; slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, value => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; }]; },
    useCallback(fn, deps) { const i=cursor++, old=slots[i];
      if (!old || deps.some((v,n) => v !== old.deps[n])) slots[i] = { deps, fn }; return slots[i].fn; },
    useEffect(fn, deps) { const i=cursor++, old=slots[i];
      if (!old || deps.some((v,n) => v !== old.deps[n])) {
        const slot = slots[i] = { deps };
        effects.push(() => { old?.cleanup?.(); slot.cleanup=fn(); });
      } },
  };
  react.useLayoutEffect=react.useEffect;
  return { react, render(fn) { cursor=0; const result=fn(); effects.splice(0).forEach(fn=>fn()); return result; },
    unmount() { slots.forEach(slot=>slot?.cleanup?.()); } };
}
const deferred = () => { let resolve, reject; const promise = new Promise((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject}; };
module.exports = { load, clock, hooks, deferred, flush: () => new Promise(setImmediate) };
