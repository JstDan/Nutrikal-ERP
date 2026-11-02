// Injected into every page while recording (never part of the app):
// a cursor dot that follows the mouse, a ring on each click, a highlight
// box around the element being explained, and masked e-mail addresses.
(() => {
  if (window.__nkOverlay) return;
  window.__nkOverlay = true;
  const install = () => {
    const css = document.createElement("style");
    css.textContent = `
      #nk-cursor { position: fixed; z-index: 2147483647; width: 22px; height: 22px; margin: -11px 0 0 -11px;
        border-radius: 50%; background: rgba(215, 44, 13, .85); border: 2px solid #fff;
        box-shadow: 0 0 0 1px rgba(34,40,49,.4); pointer-events: none; transition: transform .08s; left: -50px; top: -50px; }
      .nk-ring { position: fixed; z-index: 2147483646; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%;
        border: 3px solid #D72C0D; pointer-events: none; animation: nk-ring .6s ease-out forwards; }
      @keyframes nk-ring { to { transform: scale(3.2); opacity: 0; } }
      nextjs-portal { display: none !important; }
      #nk-highlight { position: fixed; z-index: 2147483645; pointer-events: none; border: 3px solid #7BC74D; border-radius: 6px;
        box-shadow: 0 0 0 9999px rgba(34,40,49,.18); transition: all .35s ease; display: none; }
    `;
    document.documentElement.appendChild(css);
    const dot = document.createElement("div");
    dot.id = "nk-cursor";
    document.documentElement.appendChild(dot);
    const hl = document.createElement("div");
    hl.id = "nk-highlight";
    document.documentElement.appendChild(hl);
    const last = window.__nkMouse;
    if (last) { dot.style.left = last.x + "px"; dot.style.top = last.y + "px"; }
    document.addEventListener("mousemove", (e) => {
      window.__nkMouse = { x: e.clientX, y: e.clientY };
      dot.style.left = e.clientX + "px"; dot.style.top = e.clientY + "px";
    }, true);
    document.addEventListener("mousedown", (e) => {
      dot.style.transform = "scale(.7)";
      const r = document.createElement("div");
      r.className = "nk-ring"; r.style.left = e.clientX + "px"; r.style.top = e.clientY + "px";
      document.documentElement.appendChild(r);
      setTimeout(() => r.remove(), 700);
    }, true);
    document.addEventListener("mouseup", () => { dot.style.transform = ""; }, true);

    // Mask e-mail addresses anywhere on the page
    const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
    const mask = (root) => {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (EMAIL.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(EMAIL, "•••@•••");
        EMAIL.lastIndex = 0;
      }
      root.querySelectorAll?.("input").forEach((i) => { if (EMAIL.test(i.value) && i.type !== "email") i.value = i.value.replace(EMAIL, "•••@•••"); EMAIL.lastIndex = 0; });
    };
    mask(document.body);
    new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => n.nodeType === 1 && mask(n)))).observe(document.body, { childList: true, subtree: true });
  };
  if (document.body) install(); else document.addEventListener("DOMContentLoaded", install);

  window.__nkHighlight = (rect) => {
    const hl = document.getElementById("nk-highlight");
    if (!hl) return;
    if (!rect) { hl.style.display = "none"; return; }
    const pad = 8;
    Object.assign(hl.style, { display: "block", left: rect.x - pad + "px", top: rect.y - pad + "px",
      width: rect.width + pad * 2 + "px", height: rect.height + pad * 2 + "px" });
  };
})();
