const OVERLAY_ID = "study-phone-detector-overlay";

initContent();

function initContent() {
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "overlay:show") {
      showOverlay(message.payload || {});
    }
    if (message?.type === "overlay:hide") {
      hideOverlay();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      pingBackground();
    }
  });

  window.addEventListener("focus", () => {
    pingBackground();
  });

  pingBackground();
}

function pingBackground() {
  chrome.runtime.sendMessage({ type: "tab:evaluateCurrent" }).catch(() => undefined);
}

function showOverlay(payload) {
  let overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) {
    overlay = buildOverlay();
    document.documentElement.appendChild(overlay);
  }

  const host = payload.host || "this page";
  const heading = overlay.querySelector("[data-role='heading']");
  const detail = overlay.querySelector("[data-role='detail']");
  const strictNote = overlay.querySelector("[data-role='strict-note']");
  const continueButton = overlay.querySelector("[data-action='continue']");

  if (payload.reason === "phone") {
    heading.textContent = "Phone detected";
    detail.textContent = "Your phone was spotted in the camera view.";
  } else {
    heading.textContent = "Back to study mode";
    detail.textContent = `${host} is outside your current focus whitelist.`;
  }
  strictNote.textContent = payload.strictMode
    ? (payload.adaptiveLock
      ? "Adaptive Shield locked this page after repeated distractions. Return to a study site or end the session."
      : payload.reason === "phone"
        ? "Strict mode is on — put your phone away to dismiss this automatically."
        : "Strict mode is on, so this page is being actively blocked until you return to a study site or stop the session.")
    : "Warning mode is on. This page remains usable, but the extension will keep tracking distractions.";
  continueButton.style.display = payload.strictMode ? "none" : "inline-flex";
  continueButton.textContent = `Allow ${payload.graceSeconds || 90}s`;

  overlay.style.pointerEvents = payload.strictMode ? "auto" : "none";
  overlay.style.background = payload.strictMode ? "rgba(14,17,15,0.76)" : "transparent";
  overlay.style.backdropFilter = payload.strictMode ? "blur(10px)" : "none";
  overlay.querySelector("[data-role='panel']").style.pointerEvents = "auto";
  overlay.style.display = "flex";
}

function hideOverlay() {
  const overlay = document.getElementById(OVERLAY_ID);
  if (overlay) {
    overlay.style.display = "none";
  }
}

function buildOverlay() {
  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:2147483647",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "padding:24px",
    "background:rgba(14,17,15,0.76)",
    "backdrop-filter:blur(10px)"
  ].join(";");

  const panel = document.createElement("div");
  panel.dataset.role = "panel";
  panel.style.cssText = [
    "width:min(540px,96vw)",
    "border-radius:16px",
    "padding:28px",
    "background:#ffffff",
    "color:#172033",
    "box-shadow:0 24px 60px rgba(0,0,0,0.28)",
    "font-family:Inter,Segoe UI,system-ui,sans-serif"
  ].join(";");

  panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px;">
      <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#5b6478;font-weight:700;">Focus shield active</div>
      <div style="padding:7px 12px;border-radius:999px;background:#24406e;color:#fff;font-size:11.5px;font-weight:700;">Study lock</div>
    </div>
    <h1 data-role="heading" style="margin:0 0 10px;font-size:24px;font-weight:700;line-height:1.15;letter-spacing:-0.01em;">Back to study mode</h1>
    <p data-role="detail" style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#5b6478;"></p>
    <p data-role="strict-note" style="margin:0 0 22px;font-size:12.5px;line-height:1.6;color:#5b6478;"></p>
    <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;">
      <button data-action="continue" style="border:none;border-radius:10px;padding:13px 14px;background:#3b5a94;color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">Allow 90s</button>
      <button data-action="mute" style="border:none;border-radius:10px;padding:13px 14px;background:#172033;color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">Stop alert audio</button>
      <button data-action="stop" style="border:none;border-radius:10px;padding:13px 14px;background:#9c3b3b;color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">End study session</button>
    </div>
  `;

  panel.querySelector("[data-action='continue']").addEventListener("click", () => {
    chrome.runtime
      .sendMessage({ type: "session:continueGrace" })
      .then(() => hideOverlay())
      .catch(() => undefined);
  });

  panel.querySelector("[data-action='mute']").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "audio:stop" }).catch(() => undefined);
  });

  panel.querySelector("[data-action='stop']").addEventListener("click", () => {
    chrome.runtime
      .sendMessage({ type: "session:stop" })
      .then(() => hideOverlay())
      .catch(() => undefined);
  });

  overlay.appendChild(panel);
  return overlay;
}
