# AX HTML Control Surface — a blessed, copy-paste-safe recipe

A canvas `html` node can be a live **AX control surface**: it emits AX interactions
(create work, request approval, steer the agent, …) and reflects the current AX board
back, all from inside the sandboxed iframe. The bridge is already injected for you —
you do **not** need to read `axToken` from the URL or hand-post `pmx-canvas-ax`
messages. Just opt the node in and use `window.PMX_AX`.

## Opt in

```js
// MCP / SDK
canvas_add_html_node({
  title: "AX Control Room",
  html: "<!-- see below -->",
  axCapabilities: { enabled: true, allowed: ["ax.work.create", "ax.steer"] },
});
// HTTP: POST /api/canvas/node  { type:"html", title, html, axCapabilities }  (top-level html + axCapabilities both accepted)
```

Without `axCapabilities.enabled = true`, `window.PMX_AX` is **not** injected — the node
renders but can't emit. `allowed` narrows what it may emit (never escalates the type's
ceiling). Flip an existing node on with `canvas_node({ action: "update", id, axCapabilities: { enabled: true, allowed: [...] } })`.

## Three footguns (this is why a hand-rolled node looks "inert")

1. **The iframe is sandboxed opaque-origin** (no `allow-same-origin`). `localStorage`,
   `sessionStorage`, and `document.cookie` **throw** — and an uncaught throw at script
   start aborts the whole script, so the node renders blank/inert. Keep state in plain
   JS variables (or `window.PMX_AX.state`); if you must touch storage, wrap it in
   `try/catch`.
2. **`window.PMX_AX.emit(type, payload)` is async.** It returns a Promise that resolves
   with the result once the canvas acks it. `await` it (or `.then` / `window.PMX_AX.on('ack', cb)`).
   Reading a result synchronously gets you `undefined`.
3. **`ax.steer` is recorded, not delivered.** A successful emit (`{ ok: true }`) means
   the steer was **queued** on the timeline — it does **not** wake or notify the active
   agent. A cooperating host adapter must drain the delivery queue and call its native
   send to create a visible turn (host-owned). Otherwise the steer is picked up on the
   human's next turn. Label steering buttons honestly ("Queued for the agent's next turn").

## Drop-in template (work + steer, with ack + live reflection)

```html
<style>
  body { font: 13px system-ui; margin: 0; padding: 12px; }
  button { cursor: pointer; }
  #s { margin-left: 8px; color: #6b7280; }
  ul { padding-left: 18px; }
</style>
<button id="add">+ Work item</button>
<button id="steer">Steer agent</button>
<span id="s"></span>
<ul id="q"></ul>
<script>
  // In-memory only — NO localStorage/sessionStorage/cookies (sandboxed: they throw).
  const $ = (id) => document.getElementById(id);
  const flash = (msg) => { $('s').textContent = msg; setTimeout(() => { $('s').textContent = ''; }, 1500); };

  function render(state) {
    const items = (state && state.workItems) || [];
    $('q').innerHTML = items.map((w) => '<li>[' + w.status + '] ' + w.title + '</li>').join('');
  }

  $('add').onclick = async () => {
    const r = await window.PMX_AX.emit('ax.work.create', { title: 'New task' });
    flash(r && r.ok ? 'queued ✓' : ('failed: ' + (r && (r.error || r.code))));
  };
  $('steer').onclick = async () => {
    const r = await window.PMX_AX.emit('ax.steer', { message: 'Prioritize the auth refactor' });
    // Honest: recorded/queued, NOT delivered to the live agent.
    flash(r && r.ok ? 'queued for next turn ✓' : 'failed');
  };

  // Reflect: seeded once at load, then live via the pmx-ax-update event.
  render(window.PMX_AX && window.PMX_AX.state);
  window.addEventListener('pmx-ax-update', (e) => render(e.detail));
</script>
```

## API surface (injected by PMX when opted in)

- `window.PMX_AX.emit(type, payload) → Promise<{ ok, primitive?, status?, code?, error? }>`
  — `ok:true` on accept; `ok:false` with `code`/`error` on reject; falls back to an
  `ax-ack-timeout` result after 10s so `await` never hangs.
- `window.PMX_AX.on('ack', (result, interaction) => …)` — also fires a `pmx-ax-ack`
  CustomEvent; use instead of `await` if you prefer a listener.
- `window.PMX_AX.state` — compact board snapshot `{ focus, workItems, approvalGates,
  reviewAnnotations, elicitations, modeRequests, policy }` (human review text redacted).
- `pmx-ax-update` window event — fires with the fresh snapshot on every AX change.

Allowed `type`s are gated per node capability (see the node-capability matrix in
`SKILL.md`). Emits are clamped to the surface's own node; the server re-validates every
interaction — the bridge is convenience, not a trust boundary.
