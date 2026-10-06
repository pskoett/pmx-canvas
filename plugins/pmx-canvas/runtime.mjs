import { execFile } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";

export const runtimeVersion = JSON.parse(readFileSync(new URL("./runtime.json", import.meta.url), "utf8")).version;
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(runtimeVersion)) {
    throw new Error("PMX Canvas runtime.json must contain an exact package version.");
}

export function canonicalWorkspace(path) {
    const directory = realpathSync(resolve(path));
    if (!statSync(directory).isDirectory()) throw new Error("PMX Canvas workspace must be a directory.");
    return directory;
}

export function runtimeCommand() {
    return { command: "bun", args: ["x", "--bun", `pmx-canvas@${runtimeVersion}`] };
}

export function preferredPort(input = {}) {
    const port = Number(input.port ?? process.env.PMX_CANVAS_PORT ?? process.env.PMX_WEB_CANVAS_PORT ?? 4313);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PMX Canvas port must be between 1 and 65535.");
    return port;
}

export function explicitServerUrl(input = {}) {
    const value = input.serverUrl ?? process.env.PMX_CANVAS_URL;
    if (!value) return null;
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("PMX Canvas server URL must use HTTP or HTTPS.");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
}

const NO_SERVER = "No matching PMX Canvas server is running.";

export async function probePmxServer(baseUrl, workspaceRoot, input = {}, fetchImpl = fetch) {
    let response;
    try {
        response = await fetchImpl(`${baseUrl}/health`, { signal: AbortSignal.timeout(500) });
    } catch {
        // Nothing answered (refused, timed out). The raw fetch error ("fetch failed") is not
        // actionable; a reachable server's own failure below is reported verbatim.
        return { ok: false, baseUrl, health: null, workspaceOk: false, error: NO_SERVER };
    }
    try {
        if (!response.ok) throw new Error(`Health check returned HTTP ${response.status}.`);
        const health = await response.json();
        const workspaceOk = typeof health.workspace === "string" &&
            (input.allowWorkspaceMismatch === true || canonicalWorkspace(health.workspace) === canonicalWorkspace(workspaceRoot));
        return {
            ok: health.ok === true && workspaceOk,
            baseUrl,
            health,
            workspaceOk,
            error: workspaceOk ? null : `PMX server belongs to ${health.workspace ?? "an unknown workspace"}.`,
        };
    } catch (error) {
        return { ok: false, baseUrl, health: null, workspaceOk: false, error: error.message };
    }
}

function daemonPorts(workspaceRoot) {
    try {
        return readdirSync(resolve(workspaceRoot, ".pmx-canvas"))
            .map((name) => /^daemon-(\d+)\.pid$/.exec(name))
            .filter(Boolean)
            .map((match) => Number(match[1]))
            .filter((port) => port > 0 && port <= 65535)
            .sort((a, b) => a - b);
    } catch (error) {
        if (error.code === "ENOENT") return [];
        throw error;
    }
}

export async function findPmxServer(workspaceRoot, input = {}, fetchImpl = fetch) {
    const explicit = explicitServerUrl(input);
    if (explicit) return await probePmxServer(explicit, workspaceRoot, input, fetchImpl);
    const port = preferredPort(input);
    // Daemon pid filenames locate arbitrary ports; health, not the pid file, proves ownership.
    const ports = [...new Set([...daemonPorts(workspaceRoot), port, ...Array.from({ length: 9 }, (_, i) => 4313 + i)])];
    const results = await Promise.all(ports.map((candidate) =>
        probePmxServer(`http://127.0.0.1:${candidate}`, workspaceRoot, input, fetchImpl)));
    return results.find((result) => result.ok) ??
        { ok: false, baseUrl: null, health: null, workspaceOk: false, error: NO_SERVER };
}

async function portAvailable(port) {
    return await new Promise((resolveAvailable) => {
        const server = createServer();
        server.once("error", () => resolveAvailable(false));
        server.listen(port, "127.0.0.1", () => server.close(() => resolveAvailable(true)));
    });
}

export async function ensurePmxServer(workspaceRoot, input = {}, command = runtimeCommand()) {
    workspaceRoot = canonicalWorkspace(workspaceRoot);
    const existing = await findPmxServer(workspaceRoot, input);
    if (existing.ok || input.autoStart === false) return existing;
    if (explicitServerUrl(input)) throw new Error(existing.error);

    const directory = resolve(workspaceRoot, ".pmx-canvas");
    const lock = resolve(directory, "plugin-start.lock");
    mkdirSync(directory, { recursive: true });
    const deadline = Date.now() + 75_000;
    while (Date.now() < deadline) {
        let fd;
        try {
            fd = openSync(lock, "wx");
        } catch (error) {
            if (error.code !== "EEXIST") throw error;
            try {
                const pid = Number(readFileSync(lock, "utf8"));
                if (Number.isInteger(pid) && pid > 0) {
                    try {
                        process.kill(pid, 0);
                    } catch (signalError) {
                        if (signalError.code !== "ESRCH") throw signalError;
                        rmSync(lock);
                        continue;
                    }
                } else if (Date.now() - statSync(lock).mtimeMs > 5_000) {
                    rmSync(lock);
                    continue;
                }
            } catch (lockError) {
                if (lockError.code === "ENOENT") continue;
                throw lockError;
            }
            const server = await findPmxServer(workspaceRoot, input);
            if (server.ok) return server;
            await new Promise((resolveWait) => setTimeout(resolveWait, 250));
            continue;
        }
        try {
            try {
                writeFileSync(fd, String(process.pid));
            } finally {
                closeSync(fd);
            }
            const server = await findPmxServer(workspaceRoot, input);
            if (server.ok) return server;
            return await startPmxServer(workspaceRoot, input, command);
        } finally {
            rmSync(lock, { force: true });
        }
    }
    throw new Error("Timed out waiting for another PMX Canvas plugin startup.");
}

async function startPmxServer(workspaceRoot, input, command) {
    const firstPort = preferredPort(input);
    let port;
    for (let candidate = firstPort; candidate < Math.min(firstPort + 20, 65536); candidate++) {
        // Another starter may have claimed this port since discovery.
        const probe = await probePmxServer(`http://127.0.0.1:${candidate}`, workspaceRoot);
        if (probe.ok) return probe;
        if (await portAvailable(candidate)) {
            port = candidate;
            break;
        }
    }
    if (!port) throw new Error(`No free PMX Canvas port near ${firstPort}.`);

    // serve --daemon owns the exclusive spawn lock and outlives either client.
    let startupError;
    try {
        await new Promise((resolveStart, rejectStart) => execFile(command.command, [
            ...command.args, "serve", "--daemon", "--no-open", `--port=${port}`,
        ], {
            cwd: workspaceRoot,
            env: { ...process.env, PMX_CANVAS_WORKSPACE_ROOT: workspaceRoot, PMX_CANVAS_DISABLE_BROWSER_OPEN: "1" },
            timeout: 60_000,
            maxBuffer: 1024 * 1024,
        }, (error, stdout, stderr) => {
            if (error) rejectStart(new Error(`PMX Canvas startup failed: ${stderr || stdout || error.message}`));
            else resolveStart();
        }));
    } catch (error) {
        startupError = error;
    }
    // A concurrent starter can win the lock. Only verified health makes that a success.
    for (let attempt = 0; attempt < (startupError ? 40 : 1); attempt++) {
        const result = await findPmxServer(workspaceRoot, input);
        if (result.ok) return result;
        if (startupError?.message.includes("ENOENT")) break;
        await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    }
    throw startupError ?? new Error("PMX Canvas started but its workspace health check failed.");
}
