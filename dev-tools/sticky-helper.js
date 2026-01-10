(() => {
  if (window.__stickyInspectorActive) {
    console.warn("[StickyInspector] Already running – aborting new instance.");
    return;
  }

  console.log("[StickyInspector] Initializing…");

  window.__stickyInspectorActive = true;

  // --- State ---
  let highlightEl = null;
  let labelEl = null;
  let currentTarget = null;

  // --- Utilities ---

  const createHighlighter = () => {
    const h = document.createElement("div");
    h.id = "__sticky_inspector_highlight";
    Object.assign(h.style, {
      position: "fixed",
      border: "2px solid #ff0000",
      background: "rgba(255, 0, 0, 0.08)",
      zIndex: 2147483647,
      pointerEvents: "none",
      boxSizing: "border-box",
      transition: "all 0.05s ease-out",
    });
    document.body.appendChild(h);
    return h;
  };

  const createLabel = () => {
    const l = document.createElement("div");
    l.id = "__sticky_inspector_label";
    Object.assign(l.style, {
      position: "fixed",
      padding: "4px 8px",
      fontFamily:
        "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontSize: "11px",
      background: "#ff0000",
      color: "#fff",
      borderRadius: "3px",
      zIndex: 2147483647,
      pointerEvents: "none",
      whiteSpace: "nowrap",
    });
    l.textContent = "StickyInspector: hover + click (Esc to cancel)";
    document.body.appendChild(l);
    return l;
  };

  const getDomPath = (el) => {
    if (!el || el === document.documentElement) return "html";
    const parts = [];
    let node = el;

    while (node && node !== document.documentElement) {
      let part = node.nodeName.toLowerCase();
      if (node.id) {
        part += "#" + node.id;
      } else {
        if (node.classList && node.classList.length) {
          part += "." + Array.from(node.classList).join(".");
        }
        const siblings = Array.from(node.parentNode?.children || []);
        const index = siblings.indexOf(node);
        if (index >= 0) {
          part += `:nth-child(${index + 1})`;
        }
      }
      parts.unshift(part);
      node = node.parentElement;
    }

    return "html > " + parts.join(" > ");
  };

  const cleanup = () => {
    console.log("[StickyInspector] Cleaning up listeners and overlays…");
    window.__stickyInspectorActive = false;

    document.removeEventListener("mousemove", handleMouseMove, true);
    document.removeEventListener("click", handleClick, true);
    document.removeEventListener("keydown", handleKeydown, true);

    if (highlightEl && highlightEl.parentNode) {
      highlightEl.parentNode.removeChild(highlightEl);
    }
    if (labelEl && labelEl.parentNode) {
      labelEl.parentNode.removeChild(labelEl);
    }

    highlightEl = null;
    labelEl = null;
    currentTarget = null;
  };

  const isInternalNode = (el) => {
    if (!el) return false;
    return (
      el.id === "__sticky_inspector_highlight" ||
      el.id === "__sticky_inspector_label" ||
      el.closest("#__sticky_inspector_highlight") ||
      el.closest("#__sticky_inspector_label")
    );
  };

  const findStickyAncestor = (startEl) => {
    let el = startEl;
    while (el && el !== document.documentElement) {
      const cs = getComputedStyle(el);
      if (cs.position === "sticky") {
        return { el, cs };
      }
      el = el.parentElement;
    }
    return null;
  };

  const hasAnyOffset = (cs) => {
    return (
      cs.top !== "auto" ||
      cs.bottom !== "auto" ||
      cs.left !== "auto" ||
      cs.right !== "auto"
    );
  };

  const inferAxis = (cs) => {
    const vertical = cs.top !== "auto" || cs.bottom !== "auto";
    const horizontal = cs.left !== "auto" || cs.right !== "auto";
    if (vertical && !horizontal) return "y";
    if (horizontal && !vertical) return "x";
    // Mixed or none: default to vertical (most common)
    return "y";
  };

  const getScrollAncestors = (el) => {
    const res = [];
    let node = el.parentElement;
    while (node && node !== document.documentElement) {
      const cs = getComputedStyle(node);
      const overflow = cs.overflow;
      const overflowX = cs.overflowX;
      const overflowY = cs.overflowY;
      res.push({ el: node, cs, overflow, overflowX, overflowY });
      node = node.parentElement;
    }
    const doc = document.scrollingElement || document.documentElement;
    res.push({
      el: doc,
      cs: getComputedStyle(doc),
      overflow: getComputedStyle(doc).overflow,
      overflowX: getComputedStyle(doc).overflowX,
      overflowY: getComputedStyle(doc).overflowY,
    });
    return res;
  };

  const hasTransformLike = (cs) => {
    return (
      (cs.transform && cs.transform !== "none") ||
      (cs.perspective && cs.perspective !== "none") ||
      (cs.filter && cs.filter !== "none") ||
      (cs.backdropFilter && cs.backdropFilter !== "none") ||
      (cs.willChange && cs.willChange.includes("transform"))
    );
  };

  const axisScrollProps = (axis, info) => {
    if (axis === "y") {
      return {
        overflowAxis: info.overflowY || info.overflow,
        size: info.el.clientHeight,
        scroll: info.el.scrollHeight,
      };
    }
    return {
      overflowAxis: info.overflowX || info.overflow,
      size: info.el.clientWidth,
      scroll: info.el.scrollWidth,
    };
  };

  const summarizeOverflow = (cs) => {
    return `overflow=${cs.overflow}, overflow-x=${cs.overflowX}, overflow-y=${cs.overflowY}`;
  };

  // --- Diagnostics core ---

  const runDiagnostics = (clickedEl) => {
    console.groupCollapsed(
      "%c[StickyInspector] Diagnostic report",
      "color:#ff0000;font-weight:bold;"
    );
    console.log("[StickyInspector] Clicked element:", clickedEl);

    const stickyInfo = findStickyAncestor(clickedEl);

    if (!stickyInfo) {
      console.warn(
        "[StickyInspector] No ancestor with position: sticky found for clicked element."
      );
      console.log("DOM path of clicked element:", getDomPath(clickedEl));
      console.groupEnd();
      return;
    }

    const stickyEl = stickyInfo.el;
    const stickyCS = stickyInfo.cs;
    const stickyRect = stickyEl.getBoundingClientRect();

    console.log("[StickyInspector] Sticky ancestor found:", stickyEl);
    console.log(
      "[StickyInspector] Sticky ancestor path:",
      getDomPath(stickyEl)
    );
    console.log("[StickyInspector] Sticky ancestor box:", stickyRect);
    console.log("[StickyInspector] Computed style snapshot:", {
      position: stickyCS.position,
      top: stickyCS.top,
      bottom: stickyCS.bottom,
      left: stickyCS.left,
      right: stickyCS.right,
      display: stickyCS.display,
      marginTop: stickyCS.marginTop,
      marginBottom: stickyCS.marginBottom,
      zIndex: stickyCS.zIndex,
    });

    const issues = [];
    const notes = [];

    // 1. Confirm computed position: sticky
    if (stickyCS.position !== "sticky") {
      issues.push({
        check: "Computed position is sticky",
        status: "FAIL",
        detail:
          "Computed position is not 'sticky'. Something (e.g., !important rule or media query) is overriding it.",
      });
    } else {
      notes.push("Computed position is correctly 'sticky'.");
    }

    // 2. Offsets
    if (!hasAnyOffset(stickyCS)) {
      issues.push({
        check: "Has at least one offset (top/bottom/left/right)",
        status: "FAIL",
        detail:
          "All of top/bottom/left/right are 'auto'. Position: sticky requires a non-auto offset.",
      });
    } else {
      notes.push(
        `Offsets: top=${stickyCS.top}, bottom=${stickyCS.bottom}, left=${stickyCS.left}, right=${stickyCS.right}.`
      );
    }

    // 3. Axis & scroll container analysis
    const axis = inferAxis(stickyCS);
    notes.push(
      `Inferred sticky axis: '${axis === "y" ? "vertical" : "horizontal"}'.`
    );

    const scrollAncestors = getScrollAncestors(stickyEl);

    const scrollInfo = scrollAncestors.map((info) => {
      const cs = getComputedStyle(info.el);
      const { overflowAxis, size, scroll } = axisScrollProps(axis, {
        el: info.el,
        overflow: cs.overflow,
        overflowX: cs.overflowX,
        overflowY: cs.overflowY,
      });
      return {
        el: info.el,
        cs,
        overflowAxis,
        size,
        scroll,
      };
    });

    const firstScrollable = scrollInfo.find(
      (x) => x.scroll > x.size + 1 // slight tolerance
    );

    if (!firstScrollable) {
      issues.push({
        check: "Scrollable container exists on sticky axis",
        status: "FAIL",
        detail:
          "No ancestor with scrollable content on the sticky axis. If nothing scrolls, the element cannot visibly 'stick'.",
      });
    } else {
      notes.push(
        `Nearest scroll container on axis: ${getDomPath(
          firstScrollable.el
        )} (${summarizeOverflow(firstScrollable.cs)}), client=${
          firstScrollable.size
        }, scroll=${firstScrollable.scroll}.`
      );
    }

    // 4. Ancestor overflow quirks
    const problematicOverflowAncestors = scrollInfo.filter((x) =>
      /(hidden|clip)/.test(x.overflowAxis)
    );

    if (problematicOverflowAncestors.length) {
      problematicOverflowAncestors.forEach((item) => {
        issues.push({
          check: "Ancestor overflow allows visible sticking",
          status: "WARN",
          detail:
            `Ancestor ${getDomPath(
              item.el
            )} has overflow on the sticky axis set to '${
              item.overflowAxis
            }'. ` + "Sticky will be constrained/clipped inside this box.",
        });
      });
    }

    // 5. Ancestor transforms
    const transformAncestors = scrollAncestors.filter((x) =>
      hasTransformLike(x.cs)
    );
    if (transformAncestors.length) {
      transformAncestors.forEach((item) => {
        issues.push({
          check: "Ancestor has transform/filter/perspective",
          status: "WARN",
          detail:
            `Ancestor ${getDomPath(
              item.el
            )} has transform/filter/perspective/will-change. ` +
            "This can create a new containing block and alter sticky behavior in some engines.",
        });
      });
    }

    // 6. Parent height relative to sticky height (common gotcha)
    const parent = stickyEl.parentElement;
    if (parent) {
      const parentRect = parent.getBoundingClientRect();
      const topOffset = parseFloat(stickyCS.top) || 0;
      if (
        axis === "y" &&
        parentRect.height <= stickyRect.height + topOffset + 1
      ) {
        issues.push({
          check: "Parent is tall enough for sticky to move",
          status: "WARN",
          detail:
            `Parent (${getDomPath(parent)}) is only ${parentRect.height.toFixed(
              2
            )}px tall vs sticky element ${stickyRect.height.toFixed(
              2
            )}px + top offset ${topOffset}px. ` +
            "There may be no visual room for the element to 'stick'.",
        });
      }
    }

    // 7. Display / position context notes
    if (stickyCS.display === "inline") {
      issues.push({
        check: "Display type suitable for sticky",
        status: "WARN",
        detail:
          "Element is 'display: inline'. Sticky can still work, but using block/inline-block/flex items is usually more predictable.",
      });
    }

    // 8. Positioning context (offsetParent insight)
    const offsetParent = stickyEl.offsetParent;
    if (offsetParent) {
      notes.push(
        `offsetParent: ${getDomPath(offsetParent)} (position=${
          getComputedStyle(offsetParent).position
        }).`
      );
    } else {
      notes.push("offsetParent: null (likely positioned relative to root).");
    }

    // --- Output ---

    console.groupCollapsed("[StickyInspector] Summary");
    console.log("Clicked element path:", getDomPath(clickedEl));
    console.log("Sticky ancestor path:", getDomPath(stickyEl));
    console.log(
      "Axis:",
      axis === "y" ? "vertical (top/bottom)" : "horizontal (left/right)"
    );
    console.log("Notes:");
    notes.forEach((n) => console.log("  •", n));
    console.groupEnd();

    console.groupCollapsed("[StickyInspector] Issues");
    if (!issues.length) {
      console.log(
        "No obvious red flags detected. Check layout and runtime style changes."
      );
    } else {
      console.table(
        issues.map((i) => ({
          Check: i.check,
          Status: i.status,
          Detail: i.detail,
        }))
      );
    }
    console.groupEnd();

    console.log(
      "[StickyInspector] Tip: Scroll the page/scroll container while watching this sticky element in the Elements panel to see if it moves inside some ancestor instead of the viewport."
    );

    console.groupEnd();
  };

  // --- Event handlers ---

  const handleMouseMove = (e) => {
    const target = e.target;
    if (!target || isInternalNode(target)) return;

    currentTarget = target;

    if (!highlightEl) {
      highlightEl = createHighlighter();
    }
    if (!labelEl) {
      labelEl = createLabel();
    }

    const rect = target.getBoundingClientRect();
    Object.assign(highlightEl.style, {
      top: rect.top + "px",
      left: rect.left + "px",
      width: rect.width + "px",
      height: rect.height + "px",
    });

    labelEl.textContent =
      "StickyInspector: " +
      getDomPath(target) +
      " (click to inspect, Esc to cancel)";
    const labelTop = Math.max(0, rect.top - 18);
    const labelLeft = Math.max(0, rect.left);
    Object.assign(labelEl.style, {
      top: labelTop + "px",
      left: labelLeft + "px",
    });
  };

  const handleClick = (e) => {
    if (!currentTarget || isInternalNode(e.target)) return;

    e.preventDefault();
    e.stopPropagation();

    console.log("[StickyInspector] Element selected. Running diagnostics…");
    const target = currentTarget;

    cleanup();
    runDiagnostics(target);
  };

  const handleKeydown = (e) => {
    if (e.key === "Escape") {
      console.log("[StickyInspector] Selection canceled by user (Esc).");
      e.stopPropagation();
      e.preventDefault();
      cleanup();
    }
  };

  // --- Wire up ---
  document.addEventListener("mousemove", handleMouseMove, true);
  document.addEventListener("click", handleClick, true);
  document.addEventListener("keydown", handleKeydown, true);

  console.log(
    "[StickyInspector] Active. Hover an element and click to inspect its sticky ancestor. Press Esc to cancel."
  );
})();
