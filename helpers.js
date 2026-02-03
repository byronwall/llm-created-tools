// -----------------------------
// micro helpers (baseline)
// -----------------------------
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) =>
  Array.from(root.querySelectorAll(sel));

export const ready = (fn) =>
  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", fn, { once: true })
    : fn();

export const el = (tag, attrs = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "class") node.className = String(v);
    else if (k === "style" && typeof v === "object")
      Object.assign(node.style, v);
    else if (k.startsWith("on") && typeof v === "function")
      // Allow ergonomic props like onClick/onInput/onChange.
      // DOM event names are lowercase ("click", "input", ...).
      node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, String(v));
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    node.append(
      child?.nodeType ? child : document.createTextNode(String(child)),
    );
  }
  return node;
};

export const cssVar = (name, value, root = document.documentElement) => {
  if (!name.startsWith("--")) name = `--${name}`;
  if (value === undefined)
    return getComputedStyle(root).getPropertyValue(name).trim();
  root.style.setProperty(name, String(value));
  return value;
};

export const debounce = (ms, fn) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};

// Tiny reactive primitive: set() notifies subscribers.
// Use this for derived UI text (CSS blocks, preview lines, etc.).
export const signal = (initial) => {
  let value = initial;
  const subs = new Set();
  return {
    get: () => value,
    set: (next) => {
      if (Object.is(next, value)) return;
      value = next;
      for (const fn of subs) fn(value);
    },
    subscribe: (fn, { immediate = true } = {}) => {
      subs.add(fn);
      if (immediate) fn(value);
      return () => subs.delete(fn);
    },
  };
};

export const store = {
  get: (k, fallback = null) => {
    try {
      const v = localStorage.getItem(k);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
  del: (k) => localStorage.removeItem(k),
};

// -----------------------------
// DX add-ons for CSS labs
// -----------------------------

// Live <style> tag you can update
export const injectCSS = (id = "lab-style") => {
  let style = document.getElementById(id);
  if (!style) {
    style = el("style", { id });
    document.head.append(style);
  }
  return (cssText) => {
    style.textContent = cssText;
    return cssText;
  };
};

// Quick perf timing
export const measure = (label, fn) => {
  const t0 = performance.now();
  const out = fn();
  const dt = performance.now() - t0;
  console.log(`[measure] ${label}: ${dt.toFixed(2)}ms`);
  return out;
};

// Tiny RAF loop helper (useful for animation experiments)
export const rafLoop = (fn) => {
  let raf = 0;
  let running = true;
  const tick = (t) => {
    if (!running) return;
    fn(t);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => {
    running = false;
    cancelAnimationFrame(raf);
  };
};

// -----------------------------
// debug helpers
// -----------------------------

// Repo-wide dev default: debug is always enabled.
// (No query-param gating; keep demos deterministic.)
export const hasDebug = () => true;

// Small namespaced logger. Use with `const log = makeLogger("demo", hasDebug());`.
export const makeLogger = (namespace = "app", enabled = false) => {
  const prefix = `[${namespace}]`;
  return (...args) => enabled && console.log(prefix, ...args);
};

// Install global error hooks (useful during prototyping).
// Returns an uninstall function.
export const installGlobalErrorHandlers = ({
  namespace = "app",
  enabled = true,
  onError,
  onRejection,
} = {}) => {
  if (!enabled) return () => {};
  const prefix = `[${namespace}]`;

  const onWindowError = (e) => {
    try {
      console.warn(prefix, "window.error", e?.message || e);
    } finally {
      onError?.(e);
    }
  };

  const onUnhandledRejection = (e) => {
    try {
      console.warn(prefix, "unhandledrejection", e?.reason || e);
    } finally {
      onRejection?.(e);
    }
  };

  window.addEventListener("error", onWindowError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);

  return () => {
    window.removeEventListener("error", onWindowError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
};
