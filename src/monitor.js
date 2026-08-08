import * as tf from "@tensorflow/tfjs";
import * as cocoSsd from "@tensorflow-models/coco-ssd";
import { buildAndDownloadPdf } from "./pdf-report.js";

const cameraPreview = document.getElementById("cameraPreview");
const cameraPlaceholder = document.getElementById("cameraPlaceholder");
const toggleCameraBtn = document.getElementById("toggleCameraBtn");
const detectionBadge = document.getElementById("detectionBadge");

let monitorState = null;
let cameraStream = null;
let cameraEnabled = false;
let detectionModel = null;
let detectionTimer = null;
let lastLocalDetectionAt = 0;
const DETECTION_INTERVAL_MS = 1200;
const LOCAL_DEBOUNCE_MS = 4000;

initMonitor();

async function initMonitor() {
  bindMonitorEvents();
  await refreshMonitor();
  setInterval(() => {
    refreshMonitor().catch(() => undefined);
  }, 1000);
}

function bindMonitorEvents() {
  toggleCameraBtn?.addEventListener("click", async () => {
    if (cameraEnabled) {
      stopCamera();
      return;
    }
    await startCamera();
  });

  document.getElementById("monitorStartBtn")?.addEventListener("click", () => runMonitorAction("session:start"));
  document.getElementById("monitorPauseBtn")?.addEventListener("click", () => runMonitorAction("session:pause"));
  document.getElementById("monitorResumeBtn")?.addEventListener("click", () => runMonitorAction("session:resume"));
  document.getElementById("monitorStopBtn")?.addEventListener("click", () => runMonitorAction("session:stop"));
  document.getElementById("monitorAudioBtn")?.addEventListener("click", () => runMonitorAction("audio:play", { reason: "manual-test" }));
  document.getElementById("monitorAudioStopBtn")?.addEventListener("click", () => runMonitorAction("audio:stop"));
  document.getElementById("monitorLogoutBtn")?.addEventListener("click", async () => {
    if (!confirm("Log out? Your active session (if any) will be ended.")) return;
    try {
      stopCamera();
      await sendMessage("auth:logout");
      document.getElementById("monitorHeadline").textContent = "Logged out — you can close this window and click the extension icon to log back in.";
      document.body.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:24px;">
        <div>
          <h1 style="margin-bottom:10px;">You're logged out</h1>
          <p style="color:var(--muted);">Close this window and click the StudyGuard icon in your toolbar to log back in.</p>
        </div>
      </div>`;
    } catch (error) {
      document.getElementById("monitorHeadline").textContent = error.message || String(error);
    }
  });

  document.getElementById("skipBreakBtn")?.addEventListener("click", () => runMonitorAction("session:skipBreak"));

  document.getElementById("monitorTodoForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.getElementById("monitorTodoInput");
    const text = input?.value?.trim();
    if (!text) return;
    await runMonitorAction("todo:add", { text });
    if (input) input.value = "";
  });

  document.getElementById("addCurrentTabBtn")?.addEventListener("click", async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab?.url) throw new Error("Couldn't read the active tab's URL.");
      const host = new URL(tab.url).hostname.replace(/^www\./, "");
      await runMonitorAction("whitelist:add", { site: host });
    } catch (error) {
      document.getElementById("monitorHeadline").textContent = error.message || String(error);
    }
  });

  document.getElementById("exportPdfBtn")?.addEventListener("click", async () => {
    try {
      const response = await sendMessage("app:getState");
      buildAndDownloadPdf(response.state);
    } catch (error) {
      document.getElementById("monitorHeadline").textContent = error.message || String(error);
    }
  });

  document.getElementById("exportDataBtn")?.addEventListener("click", async () => {
    try {
      const response = await sendMessage("app:getState");
      const state = response.state;
      const payload = {
        exportedAt: new Date().toISOString(),
        stats: state.stats,
        settings: state.settings,
        todos: state.todos
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `study-phone-detector-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      document.getElementById("monitorHeadline").textContent = error.message || String(error);
    }
  });
}

async function runMonitorAction(type, payload = {}) {
  try {
    await sendMessage(type, payload);
    await refreshMonitor();
  } catch (error) {
    document.getElementById("monitorHeadline").textContent = error.message || String(error);
  }
}

async function refreshMonitor() {
  const response = await sendMessage("app:getState");
  monitorState = response.state;
  renderMonitor();
}

function renderMonitor() {
  if (!monitorState) {
    return;
  }

  const { user, session, settings, stats } = monitorState;
  document.getElementById("monitorHeadline").textContent = user
    ? `${user.name}, your study environment is ready.`
    : "Please log in from the extension popup to use monitor mode.";

  renderMonitorPill(session);

  document.getElementById("monitorFocusedToday").textContent = formatMinutes(stats.today.focusedMs);
  document.getElementById("monitorSessionTime").textContent = formatDuration(session.elapsedMs);
  document.getElementById("monitorDistraction").textContent = formatMinutes(stats.today.distractionMs);
  document.getElementById("monitorViolations").textContent = String(stats.today.violations || 0);
  document.getElementById("monitorPhoneDetections").textContent = `${stats.today.phoneDetections || 0} / ${settings.maxPhoneDetectionsPerDay ?? 5}`;
  document.getElementById("monitorInsightTitle").textContent = monitorState.insights?.title || "Ready for a focused block.";
  document.getElementById("monitorInsightDetail").textContent = monitorState.insights?.detail || "Your assistant is waiting for the next signal.";

  renderMonitorSites(settings.allowedSites || []);
  renderMonitorActivity(stats.recentEvents || []);
  renderPomodoro(session, settings);
  renderMonitorTodos(monitorState.todos || []);
  renderMonitorWeekChart(stats.week || []);
}

function renderMonitorPill(session) {
  const pill = document.getElementById("monitorStatePill");
  if (!session.active) {
    pill.textContent = "Idle";
    pill.className = "state-pill idle";
    return;
  }
  if (session.paused) {
    pill.textContent = "Paused";
    pill.className = "state-pill paused";
    return;
  }
  if (session.graceRemainingSeconds > 0) {
    pill.textContent = `Grace ${session.graceRemainingSeconds}s`;
    pill.className = "state-pill grace";
    return;
  }
  pill.textContent = "Live";
  pill.className = "state-pill live";
}

function renderMonitorSites(sites) {
  const container = document.getElementById("monitorSites");
  container.innerHTML = "";

  if (!sites.length) {
    container.innerHTML = `<div class="site-pill">No allowed sites configured yet.</div>`;
    return;
  }

  sites.forEach((site) => {
    const item = document.createElement("div");
    item.className = "site-pill";
    item.textContent = site;
    container.appendChild(item);
  });
}

function renderMonitorActivity(events) {
  const container = document.getElementById("monitorActivity");
  container.innerHTML = "";

  if (!events.length) {
    container.innerHTML = `<div class="site-pill">No activity yet.</div>`;
    return;
  }

  events.slice(0, 6).forEach((event) => {
    const item = document.createElement("article");
    item.className = "activity-card";
    item.innerHTML = `
      <strong>${titleCase(event.level || "info")}</strong>
      <p>${event.message}</p>
      <span>${new Date(event.timestamp).toLocaleString()}</span>
    `;
    container.appendChild(item);
  });
}

const RING_CIRCUMFERENCE = 2 * Math.PI * 52;

function renderPomodoro(session, settings) {
  const ringFill = document.getElementById("pomodoroRingFill");
  const timeLeftEl = document.getElementById("pomodoroTimeLeft");
  const phaseLabelEl = document.getElementById("pomodoroPhaseLabel");
  const cycleLabelEl = document.getElementById("pomodoroCycleLabel");
  const statusTextEl = document.getElementById("pomodoroStatusText");
  const skipBtn = document.getElementById("skipBreakBtn");
  if (!ringFill || !timeLeftEl) return;

  if (!settings.pomodoroEnabled) {
    timeLeftEl.textContent = "Off";
    phaseLabelEl.textContent = "Pomodoro";
    ringFill.style.strokeDashoffset = String(RING_CIRCUMFERENCE);
    ringFill.classList.remove("break");
    statusTextEl.textContent = "Pomodoro is off for the current preset. Switch to Deep Focus or Sprint in Settings to enable it.";
    skipBtn.style.display = "none";
    return;
  }

  if (!session.active) {
    timeLeftEl.textContent = "--:--";
    phaseLabelEl.textContent = "Focus";
    ringFill.style.strokeDashoffset = String(RING_CIRCUMFERENCE);
    ringFill.classList.remove("break");
    statusTextEl.textContent = "Start a session to begin your Pomodoro cycle.";
    skipBtn.style.display = "none";
    cycleLabelEl.textContent = "Cycle 1";
    return;
  }

  const isBreak = session.pomodoroPhase === "break";
  const phaseMinutes = isBreak ? settings.pomodoroBreakMinutes : settings.pomodoroFocusMinutes;
  const phaseMs = phaseMinutes * 60000;
  const startedAt = Number(session.pomodoroPhaseStartedAt || Date.now());
  const elapsed = session.paused ? Number(session.pausedAt || Date.now()) - startedAt : Date.now() - startedAt;
  const remainingMs = Math.max(0, phaseMs - elapsed);
  const progress = phaseMs > 0 ? Math.min(1, elapsed / phaseMs) : 0;

  const minutes = Math.floor(remainingMs / 60000);
  const seconds = Math.floor((remainingMs % 60000) / 1000);
  timeLeftEl.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  phaseLabelEl.textContent = isBreak ? "Break" : "Focus";
  cycleLabelEl.textContent = `Cycle ${session.pomodoroCycle || 1}`;
  ringFill.classList.toggle("break", isBreak);
  ringFill.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - progress));

  statusTextEl.textContent = session.paused
    ? "Session paused — resume to continue the cycle."
    : isBreak
      ? "Break time — step away from the screen. It'll switch back to focus automatically."
      : "Deep in a focus block. Stay on an allowed site until the timer ends.";
  skipBtn.style.display = isBreak && !session.paused ? "inline-flex" : "none";
}

function renderMonitorTodos(todos) {
  const container = document.getElementById("monitorTodoList");
  if (!container) return;
  container.innerHTML = "";

  if (!todos.length) {
    container.innerHTML = `<div class="site-pill">No tasks yet — add one above.</div>`;
    return;
  }

  todos.slice(0, 12).forEach((todo) => {
    const item = document.createElement("div");
    item.className = `todo-item${todo.done ? " done" : ""}`;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(todo.done);
    checkbox.addEventListener("change", () => runMonitorAction("todo:toggle", { id: todo.id }));

    const label = document.createElement("span");
    label.textContent = todo.text;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", () => runMonitorAction("todo:remove", { id: todo.id }));

    item.appendChild(checkbox);
    item.appendChild(label);
    item.appendChild(removeBtn);
    container.appendChild(item);
  });
}

function renderMonitorWeekChart(series) {
  const container = document.getElementById("monitorWeekChart");
  if (!container) return;
  container.innerHTML = "";

  const maxMinutes = Math.max(...series.map((day) => (day.focusedMinutes || 0) + (day.distractionMinutes || 0)), 1);

  series.slice(0, 7).forEach((day) => {
    const focusedPct = Math.max(4, Math.round(((day.focusedMinutes || 0) / maxMinutes) * 100));
    const distractionPct = Math.round(((day.distractionMinutes || 0) / maxMinutes) * 100);
    const bar = document.createElement("div");
    bar.className = "chart-bar";
    bar.innerHTML = `
      <div class="chart-column">
        <div class="chart-fill" style="height:${focusedPct}%"></div>
        <div class="chart-fill distraction" style="height:${distractionPct}%"></div>
      </div>
      <strong>${day.focusedMinutes || 0}m</strong>
      <span>${day.label || ""}</span>
    `;
    container.appendChild(bar);
  });
}

async function startCamera() {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });
    cameraPreview.srcObject = cameraStream;
    cameraPreview.style.display = "block";
    cameraPlaceholder.style.display = "none";
    cameraEnabled = true;
    toggleCameraBtn.textContent = "Stop Camera";
    setDetectionBadge("loading", "Loading detection model…");
    await ensureDetectionModel();
    setDetectionBadge("watching", "Watching for your phone…");
    detectionTimer = setInterval(runDetectionTick, DETECTION_INTERVAL_MS);
  } catch (error) {
    cameraPlaceholder.textContent = "Camera permission nahi mila. Browser permission allow karke dubara try karo.";
  }
}

async function ensureDetectionModel() {
  if (detectionModel) return detectionModel;
  detectionModel = await cocoSsd.load({ base: "lite_mobilenet_v2" });
  return detectionModel;
}

let phoneCurrentlyVisible = false;

async function runDetectionTick() {
  if (!cameraEnabled || !detectionModel || cameraPreview.readyState < 2) {
    return;
  }
  let predictions = [];
  try {
    predictions = await detectionModel.detect(cameraPreview);
  } catch (error) {
    return;
  }

  const threshold = (monitorState?.settings?.phoneDetectionSensitivity ?? 60) / 100;
  const phone = predictions.find((p) => p.class === "cell phone" && p.score >= threshold);
  if (phone) {
    setDetectionBadge("alert", `Phone detected (${Math.round(phone.score * 100)}%)`);
    const now = Date.now();
    if (!phoneCurrentlyVisible || now - lastLocalDetectionAt > LOCAL_DEBOUNCE_MS) {
      lastLocalDetectionAt = now;
      phoneCurrentlyVisible = true;
      runMonitorAction("phone:detected", { confidence: phone.score });
    }
  } else {
    if (phoneCurrentlyVisible) {
      phoneCurrentlyVisible = false;
      runMonitorAction("phone:cleared", {});
    }
    setDetectionBadge("watching", "Watching for your phone…");
  }
}

function setDetectionBadge(state, text) {
  if (!detectionBadge) return;
  detectionBadge.textContent = text;
  detectionBadge.className = `detection-badge ${state}`;
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
  }
  cameraStream = null;
  cameraEnabled = false;
  cameraPreview.srcObject = null;
  cameraPreview.style.display = "none";
  cameraPlaceholder.style.display = "grid";
  cameraPlaceholder.textContent = "Camera preview is off.";
  toggleCameraBtn.textContent = "Start Camera";
  if (detectionTimer) {
    clearInterval(detectionTimer);
    detectionTimer = null;
  }
  setDetectionBadge("idle", "Detection paused");
}

async function sendMessage(type, payload = {}) {
  const TIMEOUT_MS = 15000;
  const response = await Promise.race([
    chrome.runtime.sendMessage({ type, payload }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("The extension didn't respond in time. Check the service worker console.")), TIMEOUT_MS)
    )
  ]);
  if (!response?.ok) {
    throw new Error(response?.error || "Unknown extension error.");
  }
  return response;
}

function formatMinutes(ms) {
  return `${Math.round(Number(ms || 0) / 60000)}m`;
}

function formatDuration(ms) {
  const totalMinutes = Math.round(Number(ms || 0) / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) {
    return `${minutes}m`;
  }
  return `${hours}h ${minutes}m`;
}

function titleCase(text) {
  return String(text || "")
    .split(/\s|-/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
