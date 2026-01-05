(function() {
  if(typeof window === "undefined") return;
  try {
    var methods = __METHODS__;
    var originalConsole = window.console || {};
    var sessionId = __SESSION_ID__;
    var payloadLimit = (typeof __PAYLOAD_LIMIT__ !== "undefined" && __PAYLOAD_LIMIT__ != null)
      ? __PAYLOAD_LIMIT__
      : 10 * 1024; // default 10kb

    function safeSerialize(value) {
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

    function sendLog(level, args) {
      if(!import.meta || !import.meta.hot) return;
      // Capture stack and remove leading 'Error' line added by creating an Error
      var rawStack = (new Error()).stack || null;
      var cleanedStack = rawStack;
      try {
        if(typeof rawStack === "string") {
          var lines = rawStack.split("\n");
          // Remove header line like 'Error'
          if(lines.length && /^\s*Error\s*$/.test(lines[0])) {
            lines.shift();
          }
          // Filter out frames from the monkey patch itself, trim whitespace, and strip leading 'at'
          var filtered = [];
          // Helper to normalize URLs: drop host, remove `t=` query param, keep path and :line:col
          function normalizeUrlSegment(seg) {
            try {
              var s = String(seg);
              // Capture URL and optional :line:col suffix in one regex
              var m = s.match(/(https?:\/\/[^\s)]+?)(?::(\d+):(\d+))?(?=[)\s]|$)/i);
              if(!m) return seg; // nothing to normalize
              var fullMatch = m[0];
              var urlStr = m[1];
              var lineStr = m[2] ? ":" + m[2] : "";
              var colStr = m[3] ? ":" + m[3] : "";

              // Drop scheme+host, keep path+query
              var pathWithQuery = urlStr.replace(/^https?:\/\/[^/]+/, "");
              var qIndex = pathWithQuery.indexOf("?");
              var pathname = qIndex >= 0 ? pathWithQuery.slice(0, qIndex) : pathWithQuery;
              var query = qIndex >= 0 ? pathWithQuery.slice(qIndex + 1) : "";

              // Remove t=... param from query while keeping others
              if(query) {
                var params = query.split("&").filter(function(p) {
                  return !/^t=/.test(p);
                });
                query = params.join("&");
              }

              var rebuilt = pathname + (query ? ("?" + query) : "") + lineStr + colStr;
              // Prefer starting at /src/ if present
              var srcIndex = rebuilt.indexOf("/src/");
              if(srcIndex >= 0) {
                rebuilt = rebuilt.slice(srcIndex);
              }

              // Replace the original matched segment (including any :line:col) with our rebuilt
              return s.replace(fullMatch, rebuilt);
            } catch (_) {
              return seg;
            }
          }
          for(var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if(typeof line !== "string") continue;
            // Skip frames originating from the capture patch itself
            var isPatchFrame = /virtual:console-capture/.test(line) || /window\.console\.<computed>/.test(line);
            if(isPatchFrame) continue;

            // Normalize whitespace
            var tline = String(line).trim();
            if(!tline) continue; // drop empty lines

            // Remove common 'at' prefix for higher signal
            if(/^at\b/.test(tline)) {
              tline = tline.replace(/^at\b\s*/i, "");
            }

            // Normalize URL segments to drop host and `t=` param
            tline = normalizeUrlSegment(tline);

            filtered.push(tline);
          }
          cleanedStack = filtered.join("\n");
        }
      } catch (_) {
        cleanedStack = rawStack; // fall back to original if anything goes wrong
      }
      // Helper: build a concise description of values' structure (keys/types)
      function describeValue(val) {
        var type = typeof val;
        if(val === null) return { type: "null" };
        if(type === "undefined") return { type: "undefined" };
        if(type === "string") return { type: "string", length: val.length };
        if(type === "number" || type === "bigint") return { type: type };
        if(type === "boolean") return { type: "boolean" };
        if(type === "function") return { type: "function" };
        if(Array.isArray(val)) {
          // Summarize arrays without deep traversal
          return { type: "array", length: val.length };
        }
        // Object-like: list top-level keys only
        try {
          var keys = Object.keys(val);
          return { type: "object", keys: keys };
        } catch (_) {
          return { type: "object" };
        }
      }

      function buildBoundedPayload(rawArgs) {
        var serialized = safeSerialize(rawArgs);
        var json = "";
        try {
          json = JSON.stringify(serialized);
        } catch (_) {
          json = "";
        }
        if(json && json.length <= payloadLimit) {
          return serialized;
        }
        // Too large: return keys/types summary and warning
        var summary;
        try {
          if(Array.isArray(serialized)) {
            summary = serialized.map(describeValue);
          } else {
            summary = describeValue(serialized);
          }
        } catch (_) {
          summary = { type: "unknown" };
        }
        return {
          summary: summary,
          __warning: "payload truncated: size " + (json ? json.length : "unknown") + " > limit " + payloadLimit
            + " bytes",
        };
      }

      var payload = {
        ts: new Date().toISOString(),
        level: level,
        origin: "client",
        payload: buildBoundedPayload(args),
        stack: cleanedStack,
        sessionId: sessionId,
        href: window.location && window.location.href,
      };
      try {
        import.meta.hot.send("console:log", payload);
      } catch (e) {
        try {
          originalConsole.error("[consoleCapturePlugin] Failed to send console log via HMR:", e);
        } catch (_) {}
      }
    }

    methods.forEach(function(method) {
      var orig = originalConsole[method];
      if(typeof orig !== "function") return;
      window.console[method] = function() {
        var args = Array.prototype.slice.call(arguments);
        sendLog(method, args);
        return orig.apply(originalConsole, args);
      };
    });

    originalConsole.log("[consoleCapturePlugin] Client console patched (HMR channel).");
  } catch (err) {
    try {
      console.error("[consoleCapturePlugin] Failed to patch client console:", err);
    } catch (_) {}
  }
})();
