import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CanvasError, createCanvas, joinSession } from "@github/copilot-sdk/extension";

const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(EXTENSION_DIR, "../../..");
const DEFAULT_PORT = 4313;
const MAX_AX_CONTEXT_CHARS = 16_000;
const MANAGED_START_TIMEOUT_MS = 10_000;
const HEALTH_TIMEOUT_MS = 500;

let copilotSession;
let managedProcess = null;
let managedBaseUrl = null;
let managedWorkspaceRoot = null;
let managedPort = null;
const managedLogs = [];
const panelServers = new Map();

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
            allowWorkspaceMismatch: candidate.explicit || allowWorkspaceMismatch,
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

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

function renderShell(instanceId, entry) {
    const status = entry.pmx?.ok ? "Connected" : "Not connected";
    const frameSrc = entry.pmx?.baseUrl ? `${entry.pmx.baseUrl}/workbench` : "about:blank";
    const error = entry.pmx?.error ? `<p class="error">${escapeHtml(entry.pmx.error)}</p>` : "";
    return `<!doctype html>
<html>
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
        display: grid;
        grid-template-rows: auto 1fr;
        height: 100vh;
      }
      header {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 12px;
        border-bottom: 1px solid var(--border-color-default, #30363d);
        background: var(--background-color-muted, rgba(22, 27, 34, 0.95));
      }
      strong { font-weight: var(--font-weight-semibold, 600); }
      .status {
        color: var(--text-color-muted, #8b949e);
        font-size: var(--text-body-small, 12px);
      }
      .error {
        margin: 0;
        color: var(--true-color-red, #ff7b72);
        font-size: var(--text-body-small, 12px);
      }
      button {
        border: 1px solid var(--border-color-default, #30363d);
        border-radius: 8px;
        background: var(--background-color-default, #0d1117);
        color: inherit;
        cursor: pointer;
        padding: 6px 10px;
      }
      button:hover {
        border-color: var(--color-focus-outline, #2f81f7);
      }
      iframe {
        width: 100%;
        height: 100%;
        border: 0;
        background: #0d1117;
      }
      .spacer { flex: 1; }
    </style>
  </head>
  <body>
    <div class="shell">
      <header>
        <strong>PMX Canvas</strong>
        <span class="status">${escapeHtml(status)}${entry.pmx?.baseUrl ? ` · ${escapeHtml(entry.pmx.baseUrl)}` : ""}</span>
        ${error}
        <span class="spacer"></span>
        <button type="button" onclick="refreshContext()">Refresh AX</button>
        <button type="button" onclick="startServer()">Start server</button>
      </header>
      <iframe title="PMX Canvas workbench" src="${escapeHtml(frameSrc)}"></iframe>
    </div>
    <script>
      async function startServer() {
        await fetch('/start', { method: 'POST' });
        window.location.reload();
      }
      async function refreshContext() {
        const response = await fetch('/context');
        const context = await response.json();
        window.parent.postMessage({ type: 'pmx-canvas-ax-context', instanceId: ${JSON.stringify(instanceId)}, context }, '*');
      }
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
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
                res.end(renderShell(instanceId, entry));
                return;
            }
            if (req.method === "POST" && url.pathname === "/start") {
                entry.pmx = await resolvePmxServer({ input: entry.input, session: { workingDirectory: entry.workspaceRoot } });
                jsonResponse(res, 200, entry.pmx);
                return;
            }
            if (req.method === "GET" && url.pathname === "/status") {
                const latest = await resolvePmxServer({ input: entry.input, session: { workingDirectory: entry.workspaceRoot } }, { autoStart: false });
                entry.pmx = latest.ok ? latest : entry.pmx;
                jsonResponse(res, 200, latest);
                return;
            }
            if (req.method === "GET" && url.pathname === "/context") {
                const context = await getAxContext(entry.pmx?.baseUrl, entry.workspaceRoot, entry.input);
                jsonResponse(res, 200, context);
                return;
            }
            if (req.method === "POST" && url.pathname === "/focus") {
                const body = await readRequestJson(req);
                const result = await setAxFocus(entry.pmx?.baseUrl, entry.workspaceRoot, entry.input, body.nodeIds);
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

async function getAxContext(baseUrl, workspaceRoot, input = {}) {
    const resolved = baseUrl
        ? { ok: true, baseUrl }
        : await resolvePmxServer({ input, session: { workingDirectory: workspaceRoot } }, { autoStart: false });
    if (!resolved.ok || !resolved.baseUrl) {
        return { ok: false, error: resolved.error ?? "PMX Canvas server is unavailable." };
    }
    return await fetchJson(resolved.baseUrl, "/api/canvas/ax/context", { timeoutMs: 2_000 });
}

async function getAxStatus(ctx) {
    const resolved = await resolvePmxServer(ctx, { autoStart: false });
    if (!resolved.ok || !resolved.baseUrl) return { ok: false, server: resolved };
    const state = await fetchJson(resolved.baseUrl, "/api/canvas/ax", { timeoutMs: 2_000 });
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
            description: "Return PMX Canvas server and AX state status for this workspace.",
            handler: async (ctx) => await getAxStatus(ctx),
        },
        {
            name: "get_ax_context",
            description: "Return the current PMX Canvas AX pinned and focused context.",
            handler: async (ctx) => {
                const resolved = await resolvePmxServer(ctx, { autoStart: false });
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
            handler: async (ctx) => await setAxFocus(null, workspaceRootFrom(ctx), ctx.input ?? {}, ctx.input?.nodeIds),
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
                return { ok: true };
            },
        },
    ],
    open: async (ctx) => {
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
            const fallbackPanel = panelServers.get(ctx.instanceId);
            if (fallbackPanel) {
                panelServers.delete(ctx.instanceId);
                await new Promise((resolveClose) => fallbackPanel.server.close(() => resolveClose()));
            }
            return {
                title: "PMX Canvas",
                status: "Connected",
                url: `${pmx.baseUrl}/workbench`,
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
        return {
            title: "PMX Canvas",
            status: pmx.ok ? "Connected" : "Needs server",
            url: panel.url,
        };
    },
    onClose: async (ctx) => {
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
            const resolved = await resolvePmxServer({ input: {}, session: { workingDirectory: workspaceRoot } }, { autoStart: false });
            if (!resolved.ok || !resolved.baseUrl) return undefined;
            const context = await getAxContext(resolved.baseUrl, workspaceRoot, {});
            const additionalContext = formatAdditionalContext(context, resolved.baseUrl);
            return additionalContext ? { additionalContext } : undefined;
        },
    },
});

process.once("SIGTERM", () => {
    stopManagedServer();
    process.exit(0);
});
process.once("SIGINT", () => {
    stopManagedServer();
    process.exit(0);
});
