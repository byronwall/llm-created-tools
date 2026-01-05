import * as fs from "fs";
import * as path from "path";
import type { IndexHtmlTransformContext, PluginOption, ViteDevServer } from "vite";

type ConsoleMethod = "log" | "info" | "warn" | "error" | "debug";

export interface ConsoleCaptureOptions {
  logDir?: string;
  filePrefix?: string;
  methods?: ConsoleMethod[];
}

function safeSerialize(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    try {
      return String(value);
    } catch {
      return "[unserializable]";
    }
  }
}

function createConsoleCapturePlugin(options: ConsoleCaptureOptions = {}): PluginOption {
  const methods: ConsoleMethod[] = options.methods ?? ["log", "info", "warn", "error", "debug"];

  let logFilePath: string | null = null;
  let sessionId: string | null = null;

  const filePrefix = options.filePrefix ?? "console";
  let logDirResolved: string | null = null;
  let rootDirForSession: string | null = null;

  const ensureLogFile = (rootDir: string) => {
    if(!logDirResolved) {
      const logDir = options.logDir ?? "logs";
      logDirResolved = path.isAbsolute(logDir) ? logDir : path.resolve(rootDir, logDir);
      fs.mkdirSync(logDirResolved, { recursive: true });
      console.log("[consoleCapturePlugin] Log directory ensured:", logDirResolved);
    }

    if(!sessionId) {
      sessionId = new Date().toISOString().replace(/[:.]/g, "-");
      console.log("[consoleCapturePlugin] New sessionId created:", sessionId);
    }

    if(!logFilePath) {
      const fileName = `${filePrefix}-${sessionId}.jsonl`;
      logFilePath = path.join(logDirResolved!, fileName);
      fs.writeFileSync(logFilePath, "", { encoding: "utf-8" });
      console.log("[consoleCapturePlugin] Log file created at:", logFilePath);
    }

    return logFilePath!;
  };

  const writeLine = (rootDir: string, payload: Record<string, unknown>) => {
    const filePath = ensureLogFile(rootDir);
    const line = JSON.stringify(payload) + "\n";
    try {
      fs.appendFileSync(filePath, line, { encoding: "utf-8" });
    } catch (err) {
      console.error("[consoleCapturePlugin] Failed to write log line:", err);
    }
  };

  const patchServerConsole = (rootDir: string) => {
    const original: Partial<Record<ConsoleMethod, (...args: any[]) => void>> = {};

    methods.forEach((method) => {
      const orig = (console as any)[method]?.bind(console);
      if(!orig) return;
      original[method] = orig;
      (console as any)[method] = (...args: unknown[]) => {
        const ts = new Date().toISOString();
        const logEntry = { ts, level: method, origin: "server" as const, payload: safeSerialize(args), sessionId };
        writeLine(rootDir, logEntry);
        orig(...args);
      };
    });

    console.log("[consoleCapturePlugin] Server console patched.");
  };

  const clientPatchScript = (rootDir: string) => {
    // Load external client patch script and substitute placeholders
    // Resolve relative to the app root (which is `client/apps/modeler`)
    const assetPath = path.resolve(rootDir, "plugins/assets/console-capture.js");
    try {
      const src = fs.readFileSync(assetPath, "utf-8");
      return src
        .replace(/__METHODS__/g, JSON.stringify(methods))
        .replace(/__SESSION_ID__/g, JSON.stringify(sessionId));
    } catch (err) {
      console.warn("[consoleCapturePlugin] Failed to read client patch script:", assetPath, err);
      return "";
    }
  };

  const registerHmrListener = (server: ViteDevServer, rootDir: string) => {
    server.ws.on("console:log", (data: any) => {
      const entry = {
        ts: typeof data?.ts === "string" ? data.ts : new Date().toISOString(),
        level: data?.level ?? "log",
        origin: data?.origin ?? "client",
        payload: safeSerialize(data?.payload),
        stack: data?.stack ? safeSerialize(data.stack) : null,
        sessionId: data?.sessionId ?? sessionId,
        href: typeof data?.href === "string" ? data.href : undefined,
      };
      writeLine(rootDir, entry as Record<string, unknown>);
    });
    console.log("[consoleCapturePlugin] HMR listener for 'console:log' registered.");
  };

  return {
    name: "vite-console-capture",
    apply: "serve",

    resolveId(id) {
      if(id === "virtual:console-capture") return id;
    },

    load(id) {
      if(id === "virtual:console-capture") {
        const rootDir = rootDirForSession ?? process.cwd();
        const body = clientPatchScript(rootDir);
        return `// console capture virtual module\n${body}`;
      }
    },

    configResolved(config) {
      rootDirForSession = config.root;
      if(!rootDirForSession) {
        console.warn("[consoleCapturePlugin] No root in configResolved; logging may be disabled.");
        return;
      }
      ensureLogFile(rootDirForSession);
      console.log("[consoleCapturePlugin] Config resolved. Root:", rootDirForSession);
    },

    configureServer(server) {
      const rootDir = rootDirForSession ?? server.config.root;
      if(!rootDir) {
        console.warn("[consoleCapturePlugin] No rootDir available in configureServer; skipping setup.");
        return;
      }
      // Create a fresh session per dev-server start/restart so logs rotate
      sessionId = new Date().toISOString().replace(/[:.]/g, "-");
      logFilePath = null; // force new file creation
      console.log("[consoleCapturePlugin] Configuring dev server for console capture. New session:", sessionId);
      patchServerConsole(rootDir);
      registerHmrListener(server, rootDir);
    },

    transformIndexHtml(html: string, ctx?: IndexHtmlTransformContext) {
      if(!ctx?.server) return html;
      const rootDir = rootDirForSession ?? ctx.server.config.root;
      if(!rootDir) return html;
      // When the index HTML is transformed, it indicates a page load/reload.
      // Rotate the log file to start a new capture for this HMR-driven reload.
      sessionId = new Date().toISOString().replace(/[:.]/g, "-");
      logFilePath = null; // force creation of a new file for this session
      ensureLogFile(rootDir);
      return {
        html,
        tags: [
          {
            tag: "script",
            injectTo: "head",
            attrs: { type: "module", src: "/@id/virtual:console-capture" },
          },
        ],
      };
    },
  };
}

export default createConsoleCapturePlugin;
