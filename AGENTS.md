# AGENTS.md

Quick reference for building small demos in this repo.

## Paths / imports

- JS helpers: `./helpers.js` (ES module, named exports)
- Shared styles: `./app.css`

Minimal template (serve over HTTP so module imports work):

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Demo</title>

    <link rel="stylesheet" href="./app.css" />

    <!-- Prefer static styles here (easy to review). -->
    <style>
      #app .pill {
        border-style: dashed;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="card">
        <div class="card-h">
          <h2>Demo</h2>
          <div class="row">
            <span class="badge" id="status">Idle</span>
            <button class="btn primary" id="run">Run</button>
          </div>
        </div>
        <div class="card-b">
          <div id="app" class="stack"></div>
          <div class="sep"></div>
          <div class="hint">Tip: keep UI small and readable.</div>
        </div>
      </div>
    </div>

    <script type="module">
      import { $, ready, el, debounce, store } from "./helpers.js";

      ready(() => {
        const app = $("#app");
        const status = $("#status");
        const clicks = store.get("demo:clicks", 0);

        app.append(
          el("div", { class: "row" }, [
            el("span", { class: "pill" }, `Clicks: ${clicks}`),
            el(
              "button",
              {
                class: "btn",
                id: "inc",
                onClick: debounce(150, () => {
                  const next = store.get("demo:clicks", 0) + 1;
                  store.set("demo:clicks", next);
                  status.textContent = "Saved";
                }),
              },
              "Increment",
            ),
          ]),
        );
      });
    </script>
  </body>
</html>
```

## JS helpers (`./helpers.js`)

All exports are named exports.

### DOM queries

- `$(sel, root = document) => Element | null` — `querySelector`
- `$$(sel, root = document) => Element[]` — `querySelectorAll` as array

### DOM ready

- `ready(fn) => void` — run now or on `DOMContentLoaded` (once)

### Element builder

- `el(tag, attrs = {}, children = []) => HTMLElement`
  - Attr special cases: `class`, `style` object, `onX` event (e.g. `onClick`)
  - `children`: node/string or array; strings become text nodes

### CSS variables

- `cssVar(name, value?, root = document.documentElement) => string`
  - Get computed `--name` if `value` omitted; set if provided
  - `name` can be `"bg"` or `"--bg"`

### Timing / rate limiting

- `debounce(ms, fn) => (...args) => void` — call after `ms` idle

### Tiny reactive state

- `signal(initial) => { get, set, subscribe }`
  - `get() => value`
  - `set(next) => void` — updates value and notifies subscribers (no-op if `Object.is(next, value)`)
  - `subscribe(fn, { immediate = true } = {}) => unsubscribeFn`
    - Calls `fn(value)` immediately by default
    - Returns an `unsubscribe()` function

Example:

```js
import { signal } from "./helpers.js";

const count = signal(0);
const unsubscribe = count.subscribe((v) => console.log("count:", v));

count.set(1); // logs: count: 1
unsubscribe();
```

### Local storage

- `store.get(key, fallback = null) => any` — JSON read with safe fallback
- `store.set(key, value) => void` — JSON write
- `store.del(key) => void` — remove key

### DX add-ons

- `injectCSS(id = "lab-style") => (cssText) => string` — create/update a `<style>` tag

Prefer `<style>` in the document `<head>` for static rules (easier to review). Use `injectCSS()`/`setCSS()` only for dynamic CSS that changes based on state (sliders, live previews, theme toggles), and keep that injected CSS small and clearly derived from data.

- `measure(label, fn) => any` — logs duration; returns `fn()` result

- `rafLoop(fn) => stopFn` — calls `fn(t)` each RAF; `stopFn()` cancels

### Debug helpers

- `hasDebug() => boolean`
  - Always returns `true` in this repo (debug is always enabled).

- `makeLogger(namespace = "app", enabled = false) => (...args) => void`
  - Namespaced `console.log` gated by `enabled`.

- `installGlobalErrorHandlers({ namespace = "app", enabled = true, onError?, onRejection? } = {}) => () => void`
  - Hooks `window.error` + `unhandledrejection` (helpful while prototyping).
  - Returns an uninstall function.

## Styles (`./app.css`)

`app.css` is intentionally “app-agnostic”: tokens + composable components + a few utilities.

### Design tokens (CSS variables)

Preferred override is CSS variables (see `:root` in `app.css`):

- Surfaces: `--bg`, `--panel`, `--surface-2`, `--surface-3`, `--surface-4`
- Text: `--ink`, `--ink2`, `--muted`
- Borders: `--border`, `--border2`, `--border-hover`
- Brand + states: `--brand*`, `--danger*`, `--ok*`, `--tint-*`
- Radii/shadows: `--radius`, `--radius2`, `--shadow`, `--shadow2`
- Fonts: `--sans`, `--mono`

Typical override pattern (global):

```css
:root {
  --bg: #0b1020;
  --panel: #0f172a;
  --ink: #e5e7eb;
  --muted: #9ca3af;
  --border: rgba(255, 255, 255, 0.12);
}
```

Scoped override pattern (only inside a container):

```css
.theme-dark {
  --bg: #0b1020;
  --panel: #0f172a;
  --ink: #e5e7eb;
}
```

### Components / layout primitives

- `.container` — centered page container
- `.card` + `.card-h` + `.card-b` — standard panel layout
- `.row` — horizontal flex row (wrap + gaps)
- `.stack` — vertical stack (gaps)
- `.sep` — divider
- `.muted`, `.hint` — secondary text

### Buttons

- `.btn` base button
- Variants:
  - Primary: `.btn.primary`
  - Danger: `.btn.danger`
  - OK: `.btn.ok`
  - Small: `.btn.small`

Expected usage:

```html
<button class="btn primary">Save</button>
<button class="btn danger small">Delete</button>
```

### Badges / pills

- `.badge`
  - Small status tag.
  - State: `.badge.saved`.
- `.pill`
  - Small, subtle chip.

### Fields / forms

- `.field`
  - Wrap a label + input/select/textarea.
- `.field label`
  - Label styling.
- `.field ...`
  - Inputs share consistent borders/radius/padding.

### Code output

- `.codebox`
  - Monospace, scrollable preformatted output box.

### Modal

- `.modal` (overlay; hidden by default)
- `.modal.on` (show)
- `.modal .sheet`, `.sheet-h`, `.sheet-b` (modal panel structure)

### Checkbox row

- `.chk`
  - Inline checkbox + label.

### Utilities

Prefer these over inline styles:

- Visibility: `.hidden`
- Spacing: `.mt-10`, `.mt-18`
- Min width: `.minw-160`, `.minw-220`, `.minw-240`, `.minw-260`
- Flex: `.flex-1`
- Row alignment: `.row-between` (use with `.row`)
- Text sizing: `.section-title`, `.h2-sm`, `.label-sm`

## Usage + overriding guidance (for demos)

- Compose primitives: `container` → `card` → `row/stack` → `field/btn/badge`.
- Override via tokens: set CSS variables on `:root` or a scoped theme wrapper.
- For one-offs, prefer a `<style>` tag in `<head>` (reviewable) or scoped CSS variables; use `injectCSS()`/`setCSS()` only when the CSS must be regenerated dynamically.
- Keep overrides shallow and local (scope to a demo container).
