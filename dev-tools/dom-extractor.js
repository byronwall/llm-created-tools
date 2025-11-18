// TODO: add link to ChatGPT session

(() => {
  if (window.__domExtractorActive) {
    console.log("[DOM Extractor] Deactivating existing session.");
    if (typeof window.__domExtractorCleanup === "function") {
      window.__domExtractorCleanup();
    }
    return;
  }

  console.log(
    "[DOM Extractor] Activating. Move mouse to highlight, click to extract, Esc to cancel."
  );

  window.__domExtractorActive = true;

  let currentElement = null;

  // Overlay for highlighting
  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.zIndex = "2147483647";
  overlay.style.pointerEvents = "none";
  overlay.style.border = "2px solid rgba(0, 140, 255, 0.9)";
  overlay.style.background = "rgba(0, 140, 255, 0.15)";
  overlay.style.boxSizing = "border-box";
  overlay.style.transition = "all 0.02s ease-out";

  const label = document.createElement("div");
  label.style.position = "fixed";
  label.style.zIndex = "2147483647";
  label.style.pointerEvents = "none";
  label.style.background = "rgba(0, 0, 0, 0.8)";
  label.style.color = "#fff";
  label.style.fontFamily = "monospace";
  label.style.fontSize = "11px";
  label.style.padding = "2px 4px";
  label.style.borderRadius = "3px";
  label.style.whiteSpace = "nowrap";

  document.body.appendChild(overlay);
  document.body.appendChild(label);

  function describeElement(el) {
    if (!el) return "<none>";
    const parts = [el.tagName.toLowerCase()];
    if (el.id) parts.push("#" + el.id);
    if (el.classList && el.classList.length) {
      parts.push("." + Array.from(el.classList).join("."));
    }
    return parts.join("");
  }

  function updateOverlay(target) {
    if (!target || target === document.documentElement || target === document) {
      overlay.style.width = "0px";
      overlay.style.height = "0px";
      label.textContent = "";
      return;
    }

    const rect = target.getBoundingClientRect();
    overlay.style.left = rect.left + "px";
    overlay.style.top = rect.top + "px";
    overlay.style.width = rect.width + "px";
    overlay.style.height = rect.height + "px";

    label.textContent = describeElement(target);
    let labelX = rect.left;
    let labelY = rect.top - 18;
    if (labelY < 0) {
      labelY = rect.top + rect.height + 4;
    }
    label.style.left = labelX + "px";
    label.style.top = labelY + "px";
  }

  function copyComputedStyle(src, dst) {
    const computed = window.getComputedStyle(src);
    const cssText = [];
    for (const prop of computed) {
      const value = computed.getPropertyValue(prop);
      const priority = computed.getPropertyPriority(prop);
      if (value) {
        cssText.push(`${prop}: ${value}${priority ? " !" + priority : ""};`);
      }
    }
    dst.style.cssText = cssText.join(" ");
  }

  function copyAttributes(src, dst) {
    for (const attr of src.attributes) {
      if (attr.name.toLowerCase() === "style") continue;
      dst.setAttribute(attr.name, attr.value);
    }
  }

  function cloneTreeWithStyles(srcNode, targetDoc) {
    if (srcNode.nodeType === Node.TEXT_NODE) {
      return targetDoc.createTextNode(srcNode.textContent);
    }

    if (srcNode.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }

    const clone = targetDoc.createElement(srcNode.tagName);
    copyAttributes(srcNode, clone);
    copyComputedStyle(srcNode, clone);

    for (const child of srcNode.childNodes) {
      const childClone = cloneTreeWithStyles(child, targetDoc);
      if (childClone) clone.appendChild(childClone);
    }

    return clone;
  }

  function buildAncestorChain(el) {
    const chain = [];
    let current = el;
    while (
      current &&
      current !== document.body &&
      current !== document.documentElement
    ) {
      chain.unshift(current);
      current = current.parentElement;
    }
    return chain;
  }

  function extractElement(el) {
    console.log("[DOM Extractor] Extracting element:", describeElement(el));

    const win = window.open("", "_blank");
    if (!win) {
      console.warn(
        "[DOM Extractor] Failed to open new window (popup blocker?)."
      );
      return;
    }

    const doc = win.document;
    doc.open();
    doc.write(
      "<!doctype html><html><head><title>Extracted DOM</title></head><body></body></html>"
    );
    doc.close();

    const html = doc.documentElement;
    const body = doc.body;

    html.style.height = "100%";
    body.style.margin = "0";
    body.style.minHeight = "100%";
    body.style.boxSizing = "border-box";
    body.style.display = "block";

    const base = doc.createElement("base");
    base.setAttribute("href", window.location.href);
    doc.head.appendChild(base);

    const chain = buildAncestorChain(el);
    let parentForSubtree = body;

    if (chain.length > 1) {
      for (let i = 0; i < chain.length - 1; i++) {
        const srcAncestor = chain[i];
        const placeholder = doc.createElement(srcAncestor.tagName);
        copyAttributes(srcAncestor, placeholder);
        copyComputedStyle(srcAncestor, placeholder);
        parentForSubtree.appendChild(placeholder);
        parentForSubtree = placeholder;
      }
    }

    const subtreeClone = cloneTreeWithStyles(el, doc);
    if (subtreeClone) {
      parentForSubtree.appendChild(subtreeClone);
    }

    console.log("[DOM Extractor] Extraction complete. Check the new window.");
  }

  function cleanup() {
    console.log("[DOM Extractor] Cleaning up.");
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    overlay.remove();
    label.remove();
    window.__domExtractorActive = false;
    window.__domExtractorCleanup = null;
  }

  function pickCurrent() {
    if (!currentElement) {
      console.warn("[DOM Extractor] No element under cursor to extract.");
      return;
    }
    cleanup();
    extractElement(currentElement);
  }

  function onMouseMove(e) {
    const target = e.target;
    if (!(target instanceof Element)) return;
    currentElement = target;
    updateOverlay(target);
  }

  function onClick(e) {
    // Capture-phase handler; prevent the page from seeing the click.
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();
    console.log("[DOM Extractor] Click detected, extracting current element.");
    pickCurrent();
  }

  function onKeyDown(e) {
    if (e.key === "Escape") {
      console.log("[DOM Extractor] Cancelled with Esc.");
      cleanup();
      return;
    }
    if (e.key === "Enter") {
      console.log("[DOM Extractor] Enter pressed, extracting current element.");
      e.preventDefault();
      pickCurrent();
    }
  }

  document.addEventListener("mousemove", onMouseMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);

  window.__domExtractorCleanup = cleanup;
})();
