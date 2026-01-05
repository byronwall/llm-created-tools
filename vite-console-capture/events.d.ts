import "vite/types/customEvent.d.ts";

declare module "vite/types/customEvent.d.ts" {
  interface CustomEventMap {
    "console:log": {
      ts: string;
      level: "log" | "info" | "warn" | "error" | "debug";
      origin: "client" | "server";
      payload: unknown;
      stack?: string | null;
      sessionId?: string | null;
      href?: string;
    };
  }
}
