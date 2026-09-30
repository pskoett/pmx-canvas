import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CanvasError, createCanvas, joinSession } from "@github/copilot-sdk/extension";
import { createSteeringDeliveryPump } from "./steering-delivery.mjs";

const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(EXTENSION_DIR, "../../..");
const DEFAULT_PORT = 4313;
const MAX_AX_CONTEXT_CHARS = 16_000;
const MANAGED_START_TIMEOUT_MS = 10_000;
const HEALTH_TIMEOUT_MS = 500;
const STEERING_WAIT_MS = 30_000;

let copilotSession;
let steeringDeliveryPump;
let managedProcess = null;
let managedBaseUrl = null;
let managedWorkspaceRoot = null;
let managedPort = null;
const managedLogs = [];
const panelServers = new Map();
// Canvas actions are invoked separately from `open`, and their context can
// omit the canvas input. Keep the server selected for each visible instance so
// an action cannot fall back to the process/default port behind the panel.
const panelTargets = new Map();

function normalizeBaseUrl(value) {
    if (typeof value !== "string" || value.trim() === "") return null;
    try {
        const url = new URL(value.trim());
        if (url.protocol !== "http:" && url.protocol !== "https:") return null;
        url.pathname = url.pathname.replace(/\/$/, "");
        url.search = "";
        url.hash = "";
        return url.toString().replace(/\/$/, "");
    } catch {
        return null;
    }
}

function normalizePort(value) {
    if (typeof value !== "string" && typeof value !== "number") return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.floor(parsed);
}

function preferredPort(input) {
    return normalizePort(input?.port) ??
        normalizePort(process.env.PMX_CANVAS_PORT) ??
        normalizePort(process.env.PMX_WEB_CANVAS_PORT) ??
        DEFAULT_PORT;
}

function candidateBaseUrls(input) {
    const explicit = normalizeBaseUrl(input?.serverUrl) ?? normalizeBaseUrl(process.env.PMX_CANVAS_URL);
    if (explicit) return [{ baseUrl: explicit, explicit: true }];

    const port = preferredPort(input);
    return [
        { baseUrl: `http://127.0.0.1:${port}`, explicit: false },
        { baseUrl: `http://localhost:${port}`, explicit: false },
    ];
}

function workspaceRootFrom(ctxOrInput) {
    const inputWorkspace = typeof ctxOrInput?.input?.workspaceRoot === "string" ? ctxOrInput.input.workspaceRoot : null;
    const sessionWorkspace = typeof ctxOrInput?.session?.workingDirectory === "string" ? ctxOrInput.session.workingDirectory : null;
    const currentWorkspace = typeof copilotSession?.workspacePath === "string" ? copilotSession.workspacePath : null;
    return resolve(inputWorkspace ?? sessionWorkspace ?? currentWorkspace ?? PROJECT_ROOT);
}

function workspaceMatches(health, workspaceRoot) {
    if (!health || typeof health.workspace !== "string") return false;
    return resolve(health.workspace) === resolve(workspaceRoot);
}

function delay(ms) {
    return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function fetchJson(baseUrl, path, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        signal: AbortSignal.timeout(options.timeoutMs ?? HEALTH_TIMEOUT_MS),
    });
    if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
    }
    return await response.json();
}

async function probeServer(baseUrl, workspaceRoot, options = {}) {
    try {
        const health = await fetchJson(baseUrl, "/health", { timeoutMs: options.timeoutMs ?? HEALTH_TIMEOUT_MS });
        const workspaceOk = options.allowWorkspaceMismatch === true || workspaceMatches(health, workspaceRoot);
        return {
            ok: Boolean(health?.ok) && workspaceOk,
            baseUrl,
            health,
            workspaceOk,
            error: workspaceOk ? null : `PMX server belongs to ${health?.workspace ?? "another workspace"}`,
        };
    } catch (error) {
        return {
            ok: false,
            baseUrl,
            health: null,
            workspaceOk: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

async function isPortAvailable(port) {
    return await new Promise((resolveAvailable) => {
        const server = createNetServer();
        server.once("error", () => resolveAvailable(false));
        server.once("listening", () => {
            server.close(() => resolveAvailable(true));
        });
        server.listen(port, "127.0.0.1");
    });
}

async function pickManagedPort(startPort) {
    for (let port = startPort; port < startPort + 20; port += 1) {
        if (await isPortAvailable(port)) return port;
    }
    throw new Error(`No available PMX Canvas port found near ${startPort}`);
}

function captureManagedLog(chunk) {
    const text = chunk.toString("utf8").trim();
    if (!text) return;
    managedLogs.push(text);
    while (managedLogs.length > 20) managedLogs.shift();
}

function stopManagedServer() {
    if (managedProcess && managedProcess.exitCode === null && !managedProcess.killed) {
        managedProcess.kill("SIGTERM");
    }
    managedProcess = null;
    managedBaseUrl = null;
    managedWorkspaceRoot = null;
    managedPort = null;
}

function managedCommand(workspaceRoot, port) {
    const sourceEntry = resolve(workspaceRoot, "src/cli/index.ts");
    const localBin = resolve(workspaceRoot, "node_modules/.bin/pmx-canvas");
    if (existsSync(sourceEntry)) {
        return {
            command: "bun",
            args: ["run", "src/cli/index.ts", "--no-open", `--port=${port}`],
        };
    }
    if (existsSync(localBin)) {
        return {
            command: localBin,
            args: ["--no-open", `--port=${port}`],
        };
    }
    return {
        command: "pmx-canvas",
        args: ["--no-open", `--port=${port}`],
    };
}

async function startManagedServer(workspaceRoot, input) {
    if (managedProcess && managedBaseUrl && managedWorkspaceRoot === workspaceRoot) {
        const probe = await probeServer(managedBaseUrl, workspaceRoot, { allowWorkspaceMismatch: false });
        if (probe.ok) return probe;
    }

    stopManagedServer();
    const port = await pickManagedPort(preferredPort(input));
    const baseUrl = `http://127.0.0.1:${port}`;
    const managed = managedCommand(workspaceRoot, port);
    let managedError = null;
    managedLogs.length = 0;
    managedProcess = spawn(managed.command, managed.args, {
        cwd: workspaceRoot,
        env: {
            ...process.env,
            PMX_CANVAS_DISABLE_BROWSER_OPEN: "1",
            PMX_WEB_CANVAS_PORT: String(port),
        },
        stdio: ["ignore", "pipe", "pipe"],
    });
    managedBaseUrl = baseUrl;
    managedWorkspaceRoot = workspaceRoot;
    managedPort = port;
    managedProcess.stdout?.on("data", captureManagedLog);
    managedProcess.stderr?.on("data", captureManagedLog);
    managedProcess.once("error", (error) => {
        managedError = error;
        captureManagedLog(Buffer.from(error.message));
    });
    managedProcess.once("exit", () => {
        managedProcess = null;
        managedBaseUrl = null;
        managedWorkspaceRoot = null;
        managedPort = null;
    });

    const startedAt = Date.now();
    while (Date.now() - startedAt < MANAGED_START_TIMEOUT_MS) {
        const probe = await probeServer(baseUrl, workspaceRoot, {
            allowWorkspaceMismatch: false,
            timeoutMs: HEALTH_TIMEOUT_MS,
        });
        if (probe.ok) return probe;
        if (managedError) throw managedError;
        if (!managedProcess || managedProcess.exitCode !== null) break;
        await delay(250);
    }

    const tail = managedLogs.slice(-4).join("\n");
    throw new Error(`PMX Canvas did not become healthy on port ${port}.${tail ? `\n${tail}` : ""}`);
}

async function resolvePmxServer(ctxOrInput, options = {}) {
    const workspaceRoot = workspaceRootFrom(ctxOrInput);
    const input = ctxOrInput?.input ?? ctxOrInput ?? {};
    const allowWorkspaceMismatch = input?.allowWorkspaceMismatch === true;
    for (const candidate of candidateBaseUrls(input)) {
        const probe = await probeServer(candidate.baseUrl, workspaceRoot, {
            allowWorkspaceMismatch,
        });
        if (probe.ok) return probe;
    }

    if (options.autoStart === false || input?.autoStart === false) {
        return {
            ok: false,
            baseUrl: null,
            health: null,
            workspaceOk: false,
            error: "No matching PMX Canvas server is running.",
        };
    }

    return await startManagedServer(workspaceRoot, input);
}

async function resolvePanelTarget(ctx, options = {}) {
    const selected = panelTargets.get(ctx?.instanceId);
    if (!selected) {
        const panel = panelServers.get(ctx?.instanceId);
        if (!panel) return await resolvePmxServer(ctx, options);
        // A fallback panel still owns its original target. Action inputs may
        // contain neither that URL nor its workspace, so never rediscover from them.
        const resolved = await resolvePmxServer({
            input: { ...panel.entry.input, ...(options.autoStart === true ? { autoStart: true } : {}) },
            session: { workingDirectory: panel.entry.workspaceRoot },
        }, options);
        panel.entry.pmx = resolved;
        rememberPanelTarget(ctx, resolved);
        return resolved;
    }

    const probe = await probeServer(selected.baseUrl, selected.workspaceRoot, {
        timeoutMs: options.timeoutMs ?? 2_000,
    });
    if (probe.ok) return probe;
    return {
        ...probe,
        baseUrl: null,
        error: `The displayed PMX Canvas target is no longer valid: ${probe.error ?? "health check failed"}. Action withheld.`,
    };
}

function rememberPanelTarget(ctx, pmx) {
    if (!ctx?.instanceId || !pmx?.ok || !pmx.baseUrl) return;
    panelTargets.set(ctx.instanceId, {
        baseUrl: pmx.baseUrl,
        workspaceRoot: pmx.health.workspace,
    });
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

function renderShell(entry) {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>PMX Canvas</title>
    <style>
      body {
        margin: 0;
        background: var(--background-color-default, #0d1117);
        color: var(--text-color-default, #f0f6fc);
        font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      }
      .shell {
        max-width: 560px;
        margin: 12vh auto;
        padding: 24px;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 24px;
      }
      p { line-height: 1.6; overflow-wrap: anywhere; }
      .workspace {
        color: var(--text-color-muted, #8b949e);
        font-size: 13px;
      }
      .error {
        color: var(--true-color-red, #ff7b72);
        min-height: 24px;
      }
      button {
        border: 1px solid var(--border-color-default, #6e7681);
        border-radius: 8px;
        background: var(--background-color-muted, #21262d);
        color: inherit;
        font: inherit;
        cursor: pointer;
        min-height: 40px;
        padding: 8px 16px;
      }
      button:hover, button:focus-visible {
        border-color: var(--color-focus-outline, #2f81f7);
      }
      button:disabled { opacity: 0.6; cursor: wait; }
    </style>
  </head>
  <body>
    <main class="shell">
      <h1>Connect to PMX Canvas</h1>
      <p>The workbench is not connected yet. Home and recent boards will appear when the server is available.</p>
      <p class="workspace">Workspace: ${escapeHtml(entry.workspaceRoot)}</p>
      <p class="workspace">Server: ${escapeHtml(candidateBaseUrls(entry.input)[0].baseUrl)}</p>
      <p id="connection-status" class="error" role="status">${escapeHtml(entry.pmx?.error ?? "Checking connection…")}</p>
      <div class="actions">
        <button type="button" onclick="connect(false)">Check connection</button>
        <button type="button" onclick="connect(true)">Start server</button>
      </div>
      <p class="workspace">This page checks for the server automatically. Start server launches a local server for this workspace.</p>
    </main>
    <script>
      let busy = false;
      let timer;
      async function connect(start) {
        if (busy) return;
        busy = true;
        clearTimeout(timer);
        const buttons = document.querySelectorAll('button');
        buttons.forEach(button => button.disabled = true);
        const status = document.getElementById('connection-status');
        status.textContent = start ? 'Starting server…' : 'Checking connection…';
        try {
          const response = await fetch(start ? '/start' : '/status', { method: start ? 'POST' : 'GET', cache: 'no-store' });
          const target = await response.json();
          if (response.ok && target.ok && target.baseUrl) {
            // Load the real workbench at its own origin, including its token,
            // Home, boards, and relative API paths. The shell is not a proxy.
            window.location.replace(target.baseUrl + '/workbench?theme=light');
            return;
          }
          status.textContent = target.error || 'No matching PMX Canvas server is running.';
        } catch (error) {
          status.textContent = 'Connection check failed. Reopen the canvas if the adapter has stopped.';
        }
        busy = false;
        buttons.forEach(button => button.disabled = false);
        timer = setTimeout(() => connect(false), 2000);
      }
      connect(false);
    </script>
  </body>
</html>`;
}

async function readRequestJson(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (chunks.length === 0) return {};
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function verifiedEntryTarget(entry) {
    if (!entry.pmx?.ok || !entry.pmx.baseUrl) return { ok: false, baseUrl: null, error: "PMX Canvas server is unavailable." };
    const probe = await probeServer(entry.pmx.baseUrl, entry.pmx.health.workspace, {
        timeoutMs: 2_000,
    });
    if (probe.ok) return probe;
    return {
        ...probe,
        baseUrl: null,
        error: `The displayed PMX Canvas target is no longer valid: ${probe.error ?? "health check failed"}. Action withheld.`,
    };
}

function jsonResponse(res, statusCode, body) {
    res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
}

async function startPanelServer(instanceId, ctx, pmx) {
    const entry = { pmx, workspaceRoot: workspaceRootFrom(ctx), input: ctx.input ?? {} };
    const server = createHttpServer(async (req, res) => {
        try {
            const url = new URL(req.url ?? "/", "http://127.0.0.1");
            if (req.method === "GET" && url.pathname === "/") {
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
                res.end(renderShell(entry));
                return;
            }
            if (req.method === "POST" && url.pathname === "/start") {
                const latest = await resolvePanelTarget({ instanceId }, { autoStart: true });
                jsonResponse(res, 200, latest);
                return;
            }
            if (req.method === "GET" && url.pathname === "/status") {
                const latest = await resolvePanelTarget({ instanceId }, { autoStart: false });
                jsonResponse(res, 200, latest);
                return;
            }
            if (req.method === "GET" && url.pathname === "/context") {
                const target = await verifiedEntryTarget(entry);
                if (!target.ok || !target.baseUrl) {
                    jsonResponse(res, 409, target);
                    return;
                }
                const context = await getAxContext(target.baseUrl, entry.workspaceRoot, entry.input);
                jsonResponse(res, 200, context);
                return;
            }
            if (req.method === "POST" && url.pathname === "/focus") {
                const body = await readRequestJson(req);
                const target = await verifiedEntryTarget(entry);
                if (!target.ok || !target.baseUrl) {
                    jsonResponse(res, 409, target);
                    return;
                }
                const result = await setAxFocus(target.baseUrl, entry.workspaceRoot, entry.input, body.nodeIds);
                jsonResponse(res, 200, result);
                return;
            }
            if (req.method === "POST" && url.pathname === "/send") {
                const body = await readRequestJson(req);
                if (typeof body.prompt !== "string" || body.prompt.trim() === "") {
                    jsonResponse(res, 400, { ok: false, error: "prompt is required" });
                    return;
                }
                await copilotSession?.send({ prompt: body.prompt });
                // Explicit user instruction from the panel → mirror onto the AX
                // timeline as a steering message (fire-and-forget).
                const target = await verifiedEntryTarget(entry);
                if (target.ok && target.baseUrl) {
                    void fetchJson(target.baseUrl, "/api/canvas/ax/steer", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ message: body.prompt, source: "copilot" }),
                        timeoutMs: 2_000,
                    }).catch(() => {});
                }
                jsonResponse(res, 200, { ok: true });
                return;
            }
            jsonResponse(res, 404, { ok: false, error: "Not found" });
        } catch (error) {
            jsonResponse(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
    });
    await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return { server, url: `http://127.0.0.1:${port}/`, entry };
}

async function getAxContext(baseUrl, workspaceRoot, input = {}, options = {}) {
    const resolved = baseUrl
        ? { ok: true, baseUrl }
        : await resolvePmxServer({ input, session: { workingDirectory: workspaceRoot } }, { autoStart: false });
    if (!resolved.ok || !resolved.baseUrl) {
        return { ok: false, error: resolved.error ?? "PMX Canvas server is unavailable." };
    }
    // A proxied read is one this extension records itself with what it actually
    // injected (after truncation), so the server does not record it again.
    const headers = { "x-pmx-source": "copilot", ...(options.proxied ? { "x-pmx-proxied-read": "1" } : {}) };
    return await fetchJson(resolved.baseUrl, "/api/canvas/ax/context", { headers, timeoutMs: 2_000 });
}

function deliveredPinnedIds(pinnedNodeIds, payloadText) {
    const pinned = new Set(pinnedNodeIds);
    const delivered = new Set();
    const objectStarts = [];
    let inString = false;
    let escaped = false;
    for (let index = 0; index < payloadText.length; index += 1) {
        const character = payloadText[index];
        if (inString) {
            if (escaped) escaped = false;
            else if (character === "\\") escaped = true;
            else if (character === '"') inString = false;
            continue;
        }
        if (character === '"') {
            inString = true;
        } else if (character === "{") {
            objectStarts.push(index);
        } else if (character === "}" && objectStarts.length > 0) {
            const start = objectStarts.pop();
            try {
                const value = JSON.parse(payloadText.slice(start, index + 1));
                if (value && !Array.isArray(value) && typeof value === "object" &&
                    Object.hasOwn(value, "id") && typeof value.id === "string" && pinned.has(value.id)) {
                    delivered.add(value.id);
                }
            } catch {
                // An inner object may be complete even when its containing object was clipped.
            }
        }
    }
    return pinnedNodeIds.filter((id) => delivered.has(id));
}

/** Records what the per-prompt hook injected, so delivery is measured on what Copilot received. */
async function recordInjectedContext(baseUrl, context, injected) {
    const pinnedNodeIds = Array.isArray(context?.pinned?.nodeIds) ? context.pinned.nodeIds : [];
    const text = injected ?? "";
    try {
        await fetchJson(baseUrl, "/api/canvas/ax/context-reads", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-pmx-source": "copilot" },
            body: JSON.stringify({
                channel: "adapter",
                resource: "copilot:prompt-context",
                source: "copilot",
                consumer: "copilot",
                boardId: context.boardId,
                pinnedNodeIds,
                // Same rule as the server (context-reads.ts): a node object with that id, not a bare id list.
                deliveredNodeIds: deliveredPinnedIds(pinnedNodeIds, text),
                bytes: Buffer.byteLength(text, "utf-8"),
            }),
            timeoutMs: 1_500,
        });
    } catch {
        // Instrumentation must never block the prompt.
    }
}

async function getAxStatus(ctx) {
    const resolved = await resolvePanelTarget(ctx, { autoStart: false });
    if (!resolved.ok || !resolved.baseUrl) return { ok: false, server: resolved };
    const state = await fetchJson(resolved.baseUrl, "/api/canvas/ax?includeContext=false", { timeoutMs: 2_000 });
    return { ok: true, server: resolved, ax: state };
}

async function setAxFocus(baseUrl, workspaceRoot, input = {}, nodeIds = []) {
    const resolved = baseUrl
        ? { ok: true, baseUrl }
        : await resolvePmxServer({ input, session: { workingDirectory: workspaceRoot } });
    if (!resolved.ok || !resolved.baseUrl) {
        throw new CanvasError("pmx_unavailable", resolved.error ?? "PMX Canvas server is unavailable.");
    }
    return await fetchJson(resolved.baseUrl, "/api/canvas/ax/focus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeIds: Array.isArray(nodeIds) ? nodeIds : [], source: "copilot" }),
        timeoutMs: 2_000,
    });
}

// POST a host-agnostic AX record to the canvas with the copilot source label.
// Resolves the server first so the action returns an actionable error when the
// canvas is unavailable, then maps the neutral primitive over plain HTTP.
async function postAxRecord(ctx, path, payload) {
    const resolved = await resolvePanelTarget(ctx, { autoStart: false });
    if (!resolved.ok || !resolved.baseUrl) {
        return { ok: false, error: resolved.error ?? "PMX Canvas server is unavailable." };
    }
    try {
        return await fetchJson(resolved.baseUrl, path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, source: "copilot" }),
            timeoutMs: 2_000,
        });
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}

// Agent presence (rail-chrome-v2): the Copilot session attaches itself so the
// canvas shows its cursor + phase chip, and the server attributes the agent's
// MCP/HTTP writes to this session. Best-effort and never blocking the host.
async function postPresence(workspaceRoot, payload, options = {}) {
    try {
        const resolved = await resolvePmxServer(
            { input: {}, session: { workingDirectory: workspaceRoot } },
            { autoStart: false },
        );
        if (!resolved.ok || !resolved.baseUrl) return false;
        await fetchJson(resolved.baseUrl, "/api/canvas/ax/presence", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ source: "copilot", label: "GitHub Copilot", ...payload }),
            timeoutMs: options.timeoutMs ?? 1_500,
        });
        return true;
    } catch {
        return false;
    }
}

async function getCopilotPresence() {
    try {
        const resolved = await resolvePmxServer(
            { input: {}, session: { workingDirectory: PROJECT_ROOT } },
            { autoStart: false },
        );
        if (!resolved.ok || !resolved.baseUrl) return null;
        const snapshot = await fetchJson(resolved.baseUrl, "/api/canvas/ax/presence", { timeoutMs: 1_500 });
        if (!Array.isArray(snapshot.presences)) return null;
        return (
            snapshot.presences.find(
                (presence) =>
                    presence?.sessionId === "copilot" ||
                    (presence?.source === "copilot" && presence?.agentId == null),
            ) ?? null
        );
    } catch {
        return null;
    }
}

// Fire-and-forget mirror of a copilot-originated action onto the AX timeline.
// Never throws — adapter UX must not depend on the canvas being reachable.
function recordCopilotSteering(ctx, message) {
    void postAxRecord(ctx, "/api/canvas/ax/steer", { message }).catch(() => {});
}

async function claimCopilotSteering(consumer) {
    const workspaceRoot = PROJECT_ROOT;
    const resolved = await resolvePmxServer(
        { input: {}, session: { workingDirectory: workspaceRoot } },
        { autoStart: false },
    );
    if (!resolved.ok || !resolved.baseUrl) {
        throw new Error(resolved.error ?? "PMX Canvas server is unavailable.");
    }
    const delivery = await fetchJson(
        resolved.baseUrl,
        `/api/canvas/ax/delivery/pending?consumer=${encodeURIComponent(consumer)}&limit=1&order=oldest&waitMs=${STEERING_WAIT_MS}`,
        { timeoutMs: STEERING_WAIT_MS + 2_000 },
    );
    return Array.isArray(delivery.pending) ? delivery.pending : [];
}

async function markCopilotSteering(id, consumer) {
    const workspaceRoot = PROJECT_ROOT;
    const resolved = await resolvePmxServer(
        { input: {}, session: { workingDirectory: workspaceRoot } },
        { autoStart: false },
    );
    if (!resolved.ok || !resolved.baseUrl) {
        throw new Error(resolved.error ?? "PMX Canvas server is unavailable.");
    }
    await fetchJson(resolved.baseUrl, `/api/canvas/ax/delivery/${encodeURIComponent(id)}/mark`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consumer }),
        timeoutMs: 2_000,
    });
}

let lastSteeringDeliveryError = null;
function reportSteeringDeliveryError(error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === lastSteeringDeliveryError) return;
    lastSteeringDeliveryError = message;
    process.stderr.write(`[pmx-canvas] Copilot steering delivery retrying: ${message}\n`);
}

async function getAxTimeline(ctx, limit) {
    const resolved = await resolvePanelTarget(ctx, { autoStart: false });
    if (!resolved.ok || !resolved.baseUrl) return { ok: false, error: resolved.error };
    const query = typeof limit === "number" && limit > 0 ? `?limit=${limit}` : "";
    return await fetchJson(resolved.baseUrl, `/api/canvas/ax/timeline${query}`, { timeoutMs: 2_000 });
}

function hasUsefulAxContext(context) {
    return Boolean(context?.pinned?.count > 0 || context?.focus?.nodeIds?.length > 0);
}

function formatAdditionalContext(context, baseUrl) {
    if (!hasUsefulAxContext(context)) return null;
    const json = JSON.stringify(context, null, 2);
    const clipped = json.length > MAX_AX_CONTEXT_CHARS
        ? `${json.slice(0, MAX_AX_CONTEXT_CHARS)}\n...<truncated>`
        : json;
    return [
        "PMX Canvas AX context from the visible workbench.",
        "Treat pinned nodes and focused nodes as human-selected working context when relevant.",
        `Server: ${baseUrl}`,
        clipped,
    ].join("\n");
}

const pmxCanvas = createCanvas({
    id: "pmx-canvas",
    displayName: "PMX Canvas",
    description: "Open the PMX Canvas workbench and bridge AX pinned/focused context into Copilot.",
    inputSchema: {
        type: "object",
        properties: {
            serverUrl: { type: "string", description: "Optional existing PMX Canvas server URL." },
            port: { type: "integer", minimum: 1, description: "Preferred PMX Canvas server port." },
            autoStart: { type: "boolean", description: "Start PMX Canvas if no matching server is running." },
            allowWorkspaceMismatch: { type: "boolean", description: "Allow connecting to a PMX server from another workspace." },
            workspaceRoot: { type: "string", description: "Workspace root for server discovery/startup." },
        },
        additionalProperties: false,
    },
    actions: [
        {
            name: "status",
            description: "Return PMX Canvas server and AX state without serialized node context. Use get_ax_context for full pinned/focused context.",
            handler: async (ctx) => await getAxStatus(ctx),
        },
        {
            name: "get_ax_context",
            description: "Return the current PMX Canvas AX pinned and focused context.",
            handler: async (ctx) => {
                const resolved = await resolvePanelTarget(ctx, { autoStart: false });
                if (!resolved.ok || !resolved.baseUrl) return { ok: false, error: resolved.error };
                return await getAxContext(resolved.baseUrl, workspaceRootFrom(ctx), ctx.input ?? {});
            },
        },
        {
            name: "focus_nodes",
            description: "Set PMX Canvas AX focus to the provided node IDs using Copilot as the source.",
            inputSchema: {
                type: "object",
                properties: {
                    nodeIds: {
                        type: "array",
                        items: { type: "string" },
                    },
                },
                required: ["nodeIds"],
                additionalProperties: false,
            },
            handler: async (ctx) => {
                const resolved = await resolvePanelTarget(ctx, { autoStart: false });
                if (!resolved.ok || !resolved.baseUrl) {
                    throw new CanvasError("pmx_unavailable", resolved.error ?? "PMX Canvas server is unavailable.");
                }
                return await setAxFocus(resolved.baseUrl, workspaceRootFrom(ctx), ctx.input ?? {}, ctx.input?.nodeIds);
            },
        },
        {
            name: "send_instruction",
            description: "Send a prompt from the PMX Canvas adapter into the active Copilot session.",
            inputSchema: {
                type: "object",
                properties: {
                    prompt: { type: "string" },
                },
                required: ["prompt"],
                additionalProperties: false,
            },
            handler: async (ctx) => {
                const prompt = typeof ctx.input?.prompt === "string" ? ctx.input.prompt.trim() : "";
                if (!prompt) throw new CanvasError("prompt_required", "prompt is required");
                await copilotSession?.send({ prompt });
                // Mirror the explicit user instruction onto the AX timeline as a
                // steering message (fire-and-forget). This is an explicit action
                // flow, never a sync from the prompt hook.
                recordCopilotSteering(ctx, prompt);
                return { ok: true };
            },
        },
        {
            name: "add_work_item",
            description: "Add a canvas-bound PMX AX work item (visible task/plan/status) from Copilot.",
            inputSchema: {
                type: "object",
                properties: {
                    title: { type: "string" },
                    status: { type: "string", enum: ["todo", "in-progress", "blocked", "done", "cancelled"] },
                    detail: { type: "string" },
                    nodeIds: { type: "array", items: { type: "string" } },
                },
                required: ["title"],
                additionalProperties: false,
            },
            handler: async (ctx) => await postAxRecord(ctx, "/api/canvas/ax/work", {
                title: ctx.input?.title,
                ...(ctx.input?.status ? { status: ctx.input.status } : {}),
                ...(ctx.input?.detail ? { detail: ctx.input.detail } : {}),
                ...(Array.isArray(ctx.input?.nodeIds) ? { nodeIds: ctx.input.nodeIds } : {}),
            }),
        },
        {
            name: "request_approval",
            description: "Request human approval before a high-impact action via a PMX AX approval gate.",
            inputSchema: {
                type: "object",
                properties: {
                    title: { type: "string" },
                    detail: { type: "string" },
                    action: { type: "string" },
                    nodeIds: { type: "array", items: { type: "string" } },
                },
                required: ["title"],
                additionalProperties: false,
            },
            handler: async (ctx) => await postAxRecord(ctx, "/api/canvas/ax/approval", {
                title: ctx.input?.title,
                ...(ctx.input?.detail ? { detail: ctx.input.detail } : {}),
                ...(ctx.input?.action ? { action: ctx.input.action } : {}),
                ...(Array.isArray(ctx.input?.nodeIds) ? { nodeIds: ctx.input.nodeIds } : {}),
            }),
        },
        {
            name: "resolve_approval",
            description: "Resolve a pending PMX AX approval gate (approved or rejected).",
            inputSchema: {
                type: "object",
                properties: {
                    id: { type: "string" },
                    decision: { type: "string", enum: ["approved", "rejected"] },
                    resolution: { type: "string" },
                },
                required: ["id", "decision"],
                additionalProperties: false,
            },
            handler: async (ctx) => await postAxRecord(
                ctx,
                `/api/canvas/ax/approval/${encodeURIComponent(String(ctx.input?.id ?? ""))}/resolve`,
                {
                    decision: ctx.input?.decision,
                    ...(ctx.input?.resolution ? { resolution: ctx.input.resolution } : {}),
                },
            ),
        },
        {
            name: "add_review_annotation",
            description: "Add a canvas-bound PMX AX review annotation (comment/finding) anchored to a node, file, or region.",
            inputSchema: {
                type: "object",
                properties: {
                    body: { type: "string" },
                    kind: { type: "string", enum: ["comment", "finding"] },
                    severity: { type: "string", enum: ["info", "warning", "error"] },
                    anchorType: { type: "string", enum: ["node", "file", "region"] },
                    nodeId: { type: "string" },
                    file: { type: "string" },
                },
                required: ["body"],
                additionalProperties: false,
            },
            handler: async (ctx) => await postAxRecord(ctx, "/api/canvas/ax/review", {
                body: ctx.input?.body,
                ...(ctx.input?.kind ? { kind: ctx.input.kind } : {}),
                ...(ctx.input?.severity ? { severity: ctx.input.severity } : {}),
                ...(ctx.input?.anchorType ? { anchorType: ctx.input.anchorType } : {}),
                ...(ctx.input?.nodeId ? { nodeId: ctx.input.nodeId } : {}),
                ...(ctx.input?.file ? { file: ctx.input.file } : {}),
            }),
        },
        {
            name: "get_timeline",
            description: "Read the bounded PMX AX timeline (events, evidence, steering) for diagnostics and continuity.",
            inputSchema: {
                type: "object",
                properties: {
                    limit: { type: "integer", minimum: 1, maximum: 200 },
                },
                additionalProperties: false,
            },
            handler: async (ctx) => await getAxTimeline(ctx, ctx.input?.limit),
        },
        {
            name: "report_capability",
            description: "Report this Copilot host/session capability to the canvas for AX diagnostics.",
            inputSchema: {
                type: "object",
                properties: {
                    canvas: { type: "boolean" },
                    hooks: { type: "boolean" },
                    tools: { type: "boolean" },
                    sessionMessaging: { type: "boolean" },
                    permissions: { type: "boolean" },
                    files: { type: "boolean" },
                    uiPrompts: { type: "boolean" },
                },
                additionalProperties: false,
            },
            handler: async (ctx) => {
                const resolved = await resolvePanelTarget(ctx, { autoStart: false });
                if (!resolved.ok || !resolved.baseUrl) {
                    return { ok: false, error: resolved.error ?? "PMX Canvas server is unavailable." };
                }
                try {
                    return await fetchJson(resolved.baseUrl, "/api/canvas/ax/host-capability", {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            host: "copilot",
                            canvas: ctx.input?.canvas === true,
                            hooks: ctx.input?.hooks === true,
                            tools: ctx.input?.tools === true,
                            sessionMessaging: ctx.input?.sessionMessaging === true,
                            permissions: ctx.input?.permissions === true,
                            files: ctx.input?.files === true,
                            uiPrompts: ctx.input?.uiPrompts === true,
                            source: "copilot",
                        }),
                        timeoutMs: 2_000,
                    });
                } catch (error) {
                    return { ok: false, error: error instanceof Error ? error.message : String(error) };
                }
            },
        },
    ],
    open: async (ctx) => {
        panelTargets.delete(ctx.instanceId);
        let pmx;
        try {
            pmx = await resolvePmxServer(ctx);
        } catch (error) {
            pmx = {
                ok: false,
                baseUrl: null,
                health: null,
                workspaceOk: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }

        if (pmx.ok && pmx.baseUrl) {
            rememberPanelTarget(ctx, pmx);
            const fallbackPanel = panelServers.get(ctx.instanceId);
            if (fallbackPanel) {
                panelServers.delete(ctx.instanceId);
                await new Promise((resolveClose) => fallbackPanel.server.close(() => resolveClose()));
            }
            return {
                title: "PMX Canvas",
                status: "Connected",
                url: `${pmx.baseUrl}/workbench?theme=light`,
            };
        }

        let panel = panelServers.get(ctx.instanceId);
        if (!panel) {
            panel = await startPanelServer(ctx.instanceId, ctx, pmx);
            panelServers.set(ctx.instanceId, panel);
        } else {
            panel.entry.pmx = pmx;
            panel.entry.workspaceRoot = workspaceRootFrom(ctx);
            panel.entry.input = ctx.input ?? {};
        }
        rememberPanelTarget(ctx, pmx);
        return {
            title: "PMX Canvas",
            status: pmx.ok ? "Connected" : "Needs server",
            url: panel.url,
        };
    },
    onClose: async (ctx) => {
        panelTargets.delete(ctx.instanceId);
        const panel = panelServers.get(ctx.instanceId);
        if (!panel) return;
        panelServers.delete(ctx.instanceId);
        await new Promise((resolveClose) => panel.server.close(() => resolveClose()));
    },
});

copilotSession = await joinSession({
    canvases: [pmxCanvas],
    hooks: {
        onUserPromptSubmitted: async (input) => {
            const workspaceRoot = resolve(input?.workingDirectory ?? copilotSession?.workspacePath ?? PROJECT_ROOT);
            // A submitted prompt means the agent is about to think: attach (idempotent)
            // and flip the phase. The agent's subsequent canvas writes reach the server
            // as MCP/HTTP tool calls and are attributed to this session.
            void postPresence(workspaceRoot, { attached: true, phase: "thinking", detail: null });
            const resolved = await resolvePmxServer({ input: {}, session: { workingDirectory: workspaceRoot } }, { autoStart: false });
            if (!resolved.ok || !resolved.baseUrl) return undefined;
            const context = await getAxContext(resolved.baseUrl, workspaceRoot, {}, { proxied: true });
            const additionalContext = formatAdditionalContext(context, resolved.baseUrl);
            void recordInjectedContext(resolved.baseUrl, context, additionalContext);
            return additionalContext ? { additionalContext } : undefined;
        },
    },
});

steeringDeliveryPump = createSteeringDeliveryPump({
    consumer: "copilot",
    claim: claimCopilotSteering,
    send: async (message) => await copilotSession.send({ prompt: message }),
    mark: markCopilotSteering,
    getPresence: getCopilotPresence,
    setPresence: async (patch) => await postPresence(PROJECT_ROOT, patch),
    shouldSend: (() => {
        const startedAt = Date.now();
        return (steering) => Date.parse(steering.createdAt) >= startedAt;
    })(),
    pause: delay,
    onError: reportSteeringDeliveryError,
});
void steeringDeliveryPump.start();

// Attach the session as soon as the host joins (the canvas may not be running
// yet — the prompt hook above re-attaches lazily in that case).
void postPresence(resolve(copilotSession?.workspacePath ?? PROJECT_ROOT), { attached: true });

// Real context window (rail-chrome-v2): Copilot emits `session.usage_info`
// with the live token count and the model's window after each turn. Report it
// on the presence so the board's top-bar meter shows the agent's ACTUAL window
// instead of the pinned-context estimate. Root agent only — sub-agent events
// carry an `agentId` and have their own windows. Coalesced to one POST per
// 500ms: a turn can emit several usage events back to back.
let usageFlush = null;
let pendingUsage = null;
function reportContextUsage(event) {
    const data = event?.data;
    if (event?.agentId || !data || typeof data.currentTokens !== "number" || typeof data.tokenLimit !== "number" || data.tokenLimit <= 0) {
        return;
    }
    pendingUsage = { used: Math.max(0, Math.round(data.currentTokens)), total: Math.round(data.tokenLimit) };
    if (usageFlush) return;
    usageFlush = setTimeout(() => {
        usageFlush = null;
        const usage = pendingUsage;
        pendingUsage = null;
        if (usage) void postPresence(resolve(copilotSession?.workspacePath ?? PROJECT_ROOT), { contextUsage: usage });
    }, 500);
}
if (typeof copilotSession?.on === "function") {
    try {
        copilotSession.on("session.usage_info", reportContextUsage);
    } catch {
        // An SDK without the event keeps the estimate — the meter says so.
    }
}

async function shutdown() {
    steeringDeliveryPump?.stop();
    // Detach the presence first so the canvas returns to the quiet board the
    // moment the host goes away, then stop any managed server. The whole
    // detach is capped at 800ms (server probing + the POST) so a host with a
    // short SIGTERM grace window can never be held past it.
    await Promise.race([
        postPresence(resolve(copilotSession?.workspacePath ?? PROJECT_ROOT), { attached: false }, { timeoutMs: 500 }),
        delay(800),
    ]);
    stopManagedServer();
    process.exit(0);
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
