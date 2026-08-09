import { buildAndDownloadPdf } from "./pdf-report.js";

const authView = document.getElementById("authView");
const dashboardView = document.getElementById("dashboardView");
const authMessage = document.getElementById("authMessage");
const accountMessage = document.getElementById("accountMessage");
const settingsMessage = document.getElementById("settingsMessage");
const todoMessage = document.getElementById("todoMessage");
const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const googleProfileForm = document.getElementById("googleProfileForm");
const loadingOverlay = document.getElementById("loadingOverlay");

let appState = null;
let popupReady = false;
let isSubmitting = false;
let countdownPaintTimer = null;

initPopup();

async function initPopup() {
  if (popupReady) return;
  popupReady = true;
  bindEvents();
  try {
    await refreshState();
  } catch (error) {
    showMessage(authMessage, error.message || String(error), "warning");
  }
}

function bindEvents() {
  document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    button.addEventListener("click", () => switchAuthMode(button.dataset.authMode));
  });

  document.querySelectorAll(".dashboard-tabs .tab-btn").forEach((button) => {
    button.addEventListener("click", () => switchPanel(button.dataset.panel));
  });

  document.getElementById("forgotPasswordLink")?.addEventListener("click", async (event) => {
    event.preventDefault();
    const email = document.getElementById("loginEmail")?.value?.trim() || "";
    if (!email) {
      showMessage(authMessage, "Please enter your email address first.", "warning");
      return;
    }
    await submitAction(async () => {
      await sendMessage("auth:forgotPassword", { email });
      showMessage(authMessage, "Password reset email sent. Check your inbox.", "success");
    });
  });

  loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitAction(async () => {
      const formData = new FormData(loginForm);
      await sendMessage("auth:loginManual", {
        email: formData.get("email"),
        password: formData.get("password")
      });
      loginForm.reset();
    });
  });

  registerForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitAction(async () => {
      const formData = new FormData(registerForm);
      await sendMessage("auth:registerManual", {
        name: formData.get("name"),
        email: formData.get("email"),
        password: formData.get("password"),
        confirmPassword: formData.get("confirmPassword"),
        dob: formData.get("dob")
      });
      registerForm.reset();
    });
  });

  googleProfileForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitAction(async () => {
      const email = document.getElementById("googleEmail")?.value || "";
      await sendMessage("auth:googleUpsert", {
        email,
        name: document.getElementById("googleName")?.value || "",
        dob: document.getElementById("googleDob")?.value || ""
      });
      googleProfileForm.reset();
      googleProfileForm.classList.add("hidden");
    });
  });

  document.getElementById("googleQuickAccess")?.addEventListener("click", async () => {
    clearMessage(authMessage);
    await submitAction(async () => {
      await sendMessage("auth:googleUpsert", {});
    });
  });

  document.getElementById("profileForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitAction(async () => {
      const formData = new FormData(document.getElementById("profileForm"));
      await sendMessage("auth:updateProfile", {
        name: formData.get("name") || "",
        dob: formData.get("dob") || "",
        photoUrl: formData.get("photoUrl") || ""
      });
      document.getElementById("profileForm")?.reset();
    }, accountMessage);
  });

  document.getElementById("deleteAccountBtn")?.addEventListener("click", async () => {
    await submitAction(async () => {
      await sendMessage("auth:deleteAccount", {});
    }, accountMessage);
  });

  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    await submitAction(async () => {
      await sendMessage("auth:logout");
    });
  });

  document.getElementById("startSessionBtn")?.addEventListener("click", async () => {
    await submitAction(async () => {
      await sendMessage("session:start", {});
    });
  });

  document.getElementById("pauseSessionBtn")?.addEventListener("click", async () => {
    await submitAction(async () => {
      await sendMessage("session:pause", {});
    });
  });

  document.getElementById("resumeSessionBtn")?.addEventListener("click", async () => {
    await submitAction(async () => {
      await sendMessage("session:resume", {});
    });
  });

  document.getElementById("stopSessionBtn")?.addEventListener("click", async () => {
    await submitAction(async () => {
      await sendMessage("session:stop", {});
    });
  });

  document.getElementById("openMonitorBtn")?.addEventListener("click", async () => {
    await submitAction(async () => {
      await sendMessage("app:openMonitor", {});
    });
  });

  document.getElementById("popupEnabledToggle")?.addEventListener("change", (event) => {
    updateSetting("popupEnabled", event.target.checked);
  });

  document.getElementById("audioEnabledToggle")?.addEventListener("change", (event) => {
    updateSetting("audioEnabled", event.target.checked);
  });

  document.getElementById("desktopNotificationsToggle")?.addEventListener("change", (event) => {
    updateSetting("desktopNotifications", event.target.checked);
  });

  document.getElementById("smartAutoStartToggle")?.addEventListener("change", (event) => {
    updateSetting("smartAutoStart", event.target.checked);
  });

  // --- Settings panel: goals, presets, pomodoro, schedule -------------
  document.getElementById("strictModeToggle")?.addEventListener("change", (event) => {
    updateSetting("strictMode", event.target.checked, settingsMessage);
  });
  document.getElementById("adaptiveShieldToggle")?.addEventListener("change", (event) => {
    updateSetting("adaptiveShield", event.target.checked, settingsMessage);
  });
  document.getElementById("goalReminderToggle")?.addEventListener("change", (event) => {
    updateSetting("goalReminderEnabled", event.target.checked, settingsMessage);
  });
  document.getElementById("autoBreakPromptToggle")?.addEventListener("change", (event) => {
    updateSetting("autoBreakPrompt", event.target.checked, settingsMessage);
  });
  document.getElementById("autoOpenMonitorToggle")?.addEventListener("change", (event) => {
    updateSetting("autoOpenMonitor", event.target.checked, settingsMessage);
  });
  document.getElementById("pomodoroEnabledToggle")?.addEventListener("change", (event) => {
    updateSetting("pomodoroEnabled", event.target.checked, settingsMessage);
  });
  document.getElementById("scheduleEnabledToggle")?.addEventListener("change", (event) => {
    updateSetting("scheduleEnabled", event.target.checked, settingsMessage);
  });

  document.getElementById("dailyGoalInput")?.addEventListener("change", (event) => {
    updateSetting("dailyGoalMinutes", Number(event.target.value), settingsMessage);
  });
  document.getElementById("breakReminderInput")?.addEventListener("change", (event) => {
    updateSetting("breakReminderMinutes", Number(event.target.value), settingsMessage);
  });
  document.getElementById("pomodoroFocusInput")?.addEventListener("change", (event) => {
    updateSetting("pomodoroFocusMinutes", Number(event.target.value), settingsMessage);
  });
  document.getElementById("pomodoroBreakInput")?.addEventListener("change", (event) => {
    updateSetting("pomodoroBreakMinutes", Number(event.target.value), settingsMessage);
  });
  document.getElementById("maxPhoneInput")?.addEventListener("change", (event) => {
    updateSetting("maxPhoneDetectionsPerDay", Number(event.target.value), settingsMessage);
  });
  document.getElementById("phoneSensitivityInput")?.addEventListener("input", (event) => {
    setText("phoneSensitivityValue", `${event.target.value}%`);
  });
  document.getElementById("phoneSensitivityInput")?.addEventListener("change", (event) => {
    updateSetting("phoneDetectionSensitivity", Number(event.target.value), settingsMessage);
  });
  document.getElementById("scheduleStartInput")?.addEventListener("change", (event) => {
    updateSetting("scheduleStart", event.target.value, settingsMessage);
  });
  document.getElementById("scheduleEndInput")?.addEventListener("change", (event) => {
    updateSetting("scheduleEnd", event.target.value, settingsMessage);
  });

const PRESET_DESCRIPTIONS = {
  deep: "Deep Focus: long, strict blocks for your hardest work — Pomodoro on, strict site blocking, 150m goal.",
  sprint: "Sprint: short, energetic bursts with quick breaks — Pomodoro on, warning mode, 90m goal.",
  review: "Review: relaxed, warning-only mode for light revision — Pomodoro off, 45m goal."
};

document.querySelectorAll(".preset-btn").forEach((button) => {
  button.addEventListener("click", async () => {
    setText("presetDescription", PRESET_DESCRIPTIONS[button.dataset.preset] || "");
    await submitAction(async () => {
      await sendMessage("session:applyPreset", { preset: button.dataset.preset });
    }, settingsMessage);
  });
});

  document.querySelectorAll("#scheduleDaysPicker .day-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const current = new Set((appState?.settings?.scheduleDays || []).map(Number));
      const day = Number(button.dataset.day);
      if (current.has(day)) {
        current.delete(day);
      } else {
        current.add(day);
      }
      updateSetting("scheduleDays", [...current], settingsMessage);
    });
  });

  document.getElementById("oauthInfoBtn")?.addEventListener("click", async () => {
    const box = document.getElementById("oauthInfoBox");
    if (!box) return;
    try {
      const response = await sendMessage("auth:getOAuthSetupInfo");
      const oauth = response.oauth || {};
      const clientIdConfigured = oauth.clientId && !oauth.clientId.includes("YOUR_");
      box.innerHTML = `
        <div class="oauth-row">
          <label>Extension ID</label>
          <code data-copy="${oauth.extensionId}">${oauth.extensionId}</code>
        </div>
        <div class="oauth-row">
          <label>Authorized redirect URI (add this exact value in Google Cloud Console)</label>
          <code data-copy="${oauth.redirectUri}">${oauth.redirectUri}</code>
        </div>
        <div class="oauth-row">
          <label>Client ID currently in manifest.json</label>
          <code data-copy="${oauth.clientId}">${clientIdConfigured ? oauth.clientId : "Not set yet"}</code>
        </div>
        <p style="margin:10px 2px 0;color:var(--muted);line-height:1.5;">
          Click any value to copy it. In Google Cloud Console, your OAuth client
          must be type <strong>"Web application"</strong> (not "Chrome
          Extension") with the redirect URI above added exactly as shown.
        </p>
      `;
      box.classList.remove("hidden");
      box.querySelectorAll("code").forEach((el) => {
        el.addEventListener("click", () => {
          navigator.clipboard?.writeText(el.dataset.copy || "").then(() => {
            const original = el.textContent;
            el.textContent = "Copied!";
            setTimeout(() => (el.textContent = original), 1000);
          });
        });
      });
    } catch (error) {
      showMessage(settingsMessage, error.message, "warning");
    }
  });

  document.getElementById("siteForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.getElementById("siteInput");
    const site = input?.value?.trim();
    if (!site) return;
    await submitAction(async () => {
      await sendMessage("whitelist:add", { site });
      if (input) input.value = "";
    }, settingsMessage);
  });

  // --- To-Do list -------------------------------------------------------
  document.getElementById("todoForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.getElementById("todoInput");
    const minutesInput = document.getElementById("todoMinutesInput");
    const text = input?.value?.trim();
    if (!text) return;
    await submitAction(async () => {
      await sendMessage("todo:add", {
        text,
        durationMinutes: Number(minutesInput?.value || 25)
      });
      if (input) input.value = "";
      if (minutesInput) minutesInput.value = "25";
    }, todoMessage);
  });

  document.getElementById("clearCompletedBtn")?.addEventListener("click", async () => {
    await submitAction(async () => {
      await sendMessage("todo:clearCompleted");
    }, todoMessage);
  });

  document.getElementById("exportJsonBtn")?.addEventListener("click", async () => {
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
      showMessage(accountMessage, error.message, "warning");
    }
  });

  document.getElementById("exportPdfBtn")?.addEventListener("click", async () => {
    try {
      const response = await sendMessage("app:getState");
      buildAndDownloadPdf(response.state);
    } catch (error) {
      showMessage(accountMessage, error.message, "warning");
    }
  });
}

async function submitAction(action, messageTarget = authMessage) {
  if (isSubmitting) {
    return;
  }
  clearMessage(messageTarget);
  isSubmitting = true;
  loadingOverlay?.classList.remove("hidden");
  try {
    await action();
    await refreshState();
  } catch (error) {
    const message = error.message || String(error);
    const offlineHint = /network|offline|failed to fetch|fetch/i.test(message)
      ? "You appear to be offline. Reconnect and try again."
      : message;
    showMessage(messageTarget, offlineHint, "warning");
  } finally {
    isSubmitting = false;
    loadingOverlay?.classList.add("hidden");
  }
}

async function refreshState() {
  const response = await sendMessage("app:getState");
  appState = response?.state || null;
  if (appState?.configError) {
    showMessage(authMessage, "⚠️ " + appState.configError, "warning");
  }
  render();
}

function render() {
  const loggedIn = Boolean(appState?.user);
  authView?.classList.toggle("hidden", loggedIn);
  dashboardView?.classList.toggle("hidden", !loggedIn);
  scheduleCountdownPaint(loggedIn);

  if (!loggedIn) {
    return;
  }

  const user = appState.user || {};
  const settings = appState.settings || {};
  const session = appState.session || {};
  const stats = appState.stats || {};
  const insights = appState.insights || {};

  const displayName = cleanDisplayName(user.name || user.email || "there");
  const focusedMinutes = Math.round((stats.today?.focusedMs || 0) / 60000);
  const distractionMinutes = Math.round((stats.today?.distractionMs || 0) / 60000);
  const violations = stats.today?.violations || 0;
  const streak = stats.streak || 0;
  const progress = Math.max(0, Math.min(100, stats.goalProgress || 0));

  setText("welcomeText", `Welcome back, ${displayName}`);
  setText("sessionHeadline", insights.detail || "Your session controls are ready.");

  const pill = document.getElementById("liveSessionPill");
  if (pill) {
    pill.textContent = session.active
      ? session.paused
        ? "Paused"
        : "Live"
      : "Idle";
    pill.className = `status-pill ${session.active ? (session.paused ? "paused" : "live") : "idle"}`;
  }

  setText("focusedMinutesStat", `${focusedMinutes}m`);
  setText("distractionMinutesStat", `${distractionMinutes}m`);
  setText("violationsStat", `${violations}`);
  setText("phoneDetectionsStat", `${stats.today?.phoneDetections || 0} / ${settings.maxPhoneDetectionsPerDay ?? 5}`);
  setText("streakStat", `${streak}d`);
  setText("goalProgressStat", `${progress}%`);
  const goalFill = document.getElementById("goalProgressFill");
  if (goalFill) goalFill.style.width = `${progress}%`;
  setText("insightTitle", insights.title || "Daily momentum is building.");
  setText("insightDetail", insights.detail || "Start a session and let the shield help you stay focused.");
  setText("presetStat", insights.presetLabel || "Deep Focus");
  setText("accountName", displayName);
  setText("accountEmail", user.email || "No email on file");
  setText("accountBadge", user.provider === "google" ? "Google" : "Email");
  const profileNameInput = document.getElementById("profileName");
  const profileDobInput = document.getElementById("profileDob");
  const profilePhotoInput = document.getElementById("profilePhotoUrl");
  if (profileNameInput) profileNameInput.value = user.name || "";
  if (profileDobInput) profileDobInput.value = user.dob || "";
  if (profilePhotoInput) profilePhotoInput.value = user.photoUrl || "";

  renderSessionButtons(session);
  renderWeeklyChart(stats.week || []);
  renderHeatmap(stats.heatmap || []);
  renderActivityLog(stats.recentEvents || [], stats.recentSessions || []);
  renderSiteList(settings.allowedSites || []);
  renderTodos(appState.todos || []);
  populateSettingToggles(settings);
}

function renderSessionButtons(session) {
  const start = document.getElementById("startSessionBtn");
  const pause = document.getElementById("pauseSessionBtn");
  const resume = document.getElementById("resumeSessionBtn");
  const stop = document.getElementById("stopSessionBtn");

  if (!start || !pause || !resume || !stop) {
    return;
  }

  start.classList.toggle("hidden", Boolean(session.active));
  pause.classList.toggle("hidden", !session.active || session.paused);
  resume.classList.toggle("hidden", !session.active || !session.paused);
  stop.classList.toggle("hidden", !session.active);
}

function renderWeeklyChart(series) {
  const container = document.getElementById("weekChart");
  if (!container) return;

  container.innerHTML = "";
  series.slice(0, 7).forEach((entry) => {
    const item = document.createElement("div");
    item.className = "chart-bar";
    const fill = document.createElement("div");
    fill.className = "chart-column";
    const bar = document.createElement("div");
    bar.className = "chart-fill";
    const height = Math.max(10, Math.min(100, Number(entry.focusedMinutes || 0)));
    bar.style.height = `${height}%`;
    fill.appendChild(bar);
    item.appendChild(fill);
    const label = document.createElement("strong");
    label.textContent = entry.label || "";
    const value = document.createElement("span");
    value.textContent = `${entry.focusedMinutes || 0}m`;
    item.appendChild(label);
    item.appendChild(value);
    container.appendChild(item);
  });
}

function renderHeatmap(cells) {
  const container = document.getElementById("heatmapGrid");
  if (!container) return;

  container.innerHTML = "";
  cells.slice(0, 30).forEach((cell) => {
    const item = document.createElement("div");
    item.className = `heat-cell level-${cell.level || 0}`;
    item.title = `${cell.label}: ${cell.focusedMinutes || 0}m`;
    item.textContent = cell.label?.split(" ").pop() || "";
    container.appendChild(item);
  });
}

function renderActivityLog(events, sessions) {
  const container = document.getElementById("activityLog");
  if (!container) return;

  const items = [];
  events.forEach((entry) => {
    items.push({
      type: "event",
      title: entry.level === "warning" ? "Alert" : "Activity",
      text: entry.message || "",
      time: formatTime(entry.timestamp)
    });
  });

  sessions.forEach((entry) => {
    items.push({
      type: "session",
      title: "Completed session",
      text: `${Math.round((entry.focusedMs || 0) / 60000)}m focused • ${entry.violations || 0} distractions`,
      time: formatTime(entry.startedAt)
    });
  });

  if (!items.length) {
    container.innerHTML = '<p class="empty-text">No activity yet. Start a session to build your first history.</p>';
    return;
  }

  container.innerHTML = "";
  items.slice(0, 10).forEach((item) => {
    const card = document.createElement("div");
    card.className = `activity-item ${item.type === "event" && item.title === "Alert" ? "warning" : "success"}`;
    card.innerHTML = `<strong>${item.title}</strong><p>${item.text}</p><span>${item.time}</span>`;
    container.appendChild(card);
  });
}

function switchAuthMode(mode) {
  document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.authMode === mode);
  });
  document.getElementById("loginForm")?.classList.toggle("active", mode === "login");
  document.getElementById("registerForm")?.classList.toggle("active", mode === "register");
  document.getElementById("googleProfileForm")?.classList.add("hidden");
  clearMessage(authMessage);
}

function switchPanel(panelId) {
  document.querySelectorAll(".dashboard-tabs .tab-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.panel === panelId);
  });
  document.querySelectorAll("#dashboardView .panel").forEach((panel) => {
    panel.classList.remove("hidden");
    panel.classList.toggle("active", panel.id === panelId);
  });
}

function populateSettingToggles(settings) {
  document.getElementById("popupEnabledToggle") && (document.getElementById("popupEnabledToggle").checked = Boolean(settings.popupEnabled));
  document.getElementById("audioEnabledToggle") && (document.getElementById("audioEnabledToggle").checked = Boolean(settings.audioEnabled));
  document.getElementById("desktopNotificationsToggle") && (document.getElementById("desktopNotificationsToggle").checked = Boolean(settings.desktopNotifications));
  document.getElementById("smartAutoStartToggle") && (document.getElementById("smartAutoStartToggle").checked = Boolean(settings.smartAutoStart));

  document.getElementById("strictModeToggle") && (document.getElementById("strictModeToggle").checked = Boolean(settings.strictMode));
  document.getElementById("adaptiveShieldToggle") && (document.getElementById("adaptiveShieldToggle").checked = Boolean(settings.adaptiveShield));
  document.getElementById("goalReminderToggle") && (document.getElementById("goalReminderToggle").checked = Boolean(settings.goalReminderEnabled));
  document.getElementById("autoBreakPromptToggle") && (document.getElementById("autoBreakPromptToggle").checked = Boolean(settings.autoBreakPrompt));
  document.getElementById("autoOpenMonitorToggle") && (document.getElementById("autoOpenMonitorToggle").checked = settings.autoOpenMonitor !== false);
  document.getElementById("pomodoroEnabledToggle") && (document.getElementById("pomodoroEnabledToggle").checked = Boolean(settings.pomodoroEnabled));
  document.getElementById("scheduleEnabledToggle") && (document.getElementById("scheduleEnabledToggle").checked = Boolean(settings.scheduleEnabled));

  setInputValueIfNotFocused("dailyGoalInput", settings.dailyGoalMinutes);
  setInputValueIfNotFocused("breakReminderInput", settings.breakReminderMinutes);
  setInputValueIfNotFocused("pomodoroFocusInput", settings.pomodoroFocusMinutes);
  setInputValueIfNotFocused("pomodoroBreakInput", settings.pomodoroBreakMinutes);
  setInputValueIfNotFocused("scheduleStartInput", settings.scheduleStart);
  setInputValueIfNotFocused("scheduleEndInput", settings.scheduleEnd);
  setInputValueIfNotFocused("maxPhoneInput", settings.maxPhoneDetectionsPerDay);
  setInputValueIfNotFocused("phoneSensitivityInput", settings.phoneDetectionSensitivity);
  setText("phoneSensitivityValue", `${settings.phoneDetectionSensitivity ?? 60}%`);

  const activeDays = new Set((settings.scheduleDays || []).map(Number));
  document.querySelectorAll("#scheduleDaysPicker .day-btn").forEach((button) => {
    button.classList.toggle("active", activeDays.has(Number(button.dataset.day)));
  });

  document.querySelectorAll(".preset-btn").forEach((button) => {
    button.classList.toggle("active-preset", button.dataset.preset === settings.focusPreset);
  });
  setText("presetDescription", PRESET_DESCRIPTIONS[settings.focusPreset] || PRESET_DESCRIPTIONS.deep);
}

function setInputValueIfNotFocused(id, value) {
  const el = document.getElementById(id);
  if (el && document.activeElement !== el) {
    el.value = value ?? "";
  }
}

function renderSiteList(sites) {
  const container = document.getElementById("siteList");
  if (!container) return;
  container.innerHTML = "";

  if (!sites.length) {
    container.innerHTML = '<p class="empty-text">No allowed sites yet — add one above.</p>';
    return;
  }

  sites.forEach((site) => {
    const tag = document.createElement("span");
    tag.className = "site-tag";
    tag.innerHTML = `<span>${site}</span>`;
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "×";
    removeBtn.setAttribute("aria-label", `Remove ${site}`);
    removeBtn.addEventListener("click", async () => {
      await submitAction(async () => {
        await sendMessage("whitelist:remove", { site });
      }, settingsMessage);
    });
    tag.appendChild(removeBtn);
    container.appendChild(tag);
  });
}

function renderTodosLegacy(todos) {
  const container = document.getElementById("todoList");
  const stats = document.getElementById("todoStats");
  if (!container) return;

  const done = todos.filter((t) => t.done).length;
  if (stats) {
    stats.textContent = todos.length ? `${done} of ${todos.length} done` : "No tasks yet — add your first one above.";
  }

  container.innerHTML = "";
  if (!todos.length) {
    container.innerHTML = '<p class="empty-text">Nothing on your list. Add a small, focused task to knock out this session.</p>';
    return;
  }

  todos.forEach((todo) => {
    const item = document.createElement("div");
    item.className = `todo-item${todo.done ? " done" : ""}`;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(todo.done);
    checkbox.addEventListener("change", async () => {
      await submitAction(async () => {
        await sendMessage("todo:toggle", { id: todo.id });
      }, todoMessage);
    });

    const label = document.createElement("span");
    label.textContent = todo.text;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "×";
    removeBtn.setAttribute("aria-label", `Remove ${todo.text}`);
    removeBtn.addEventListener("click", async () => {
      await submitAction(async () => {
        await sendMessage("todo:remove", { id: todo.id });
      }, todoMessage);
    });

    item.appendChild(checkbox);
    item.appendChild(label);
    item.appendChild(removeBtn);
    container.appendChild(item);
  });
}

function renderTodos(todos) {
  const container = document.getElementById("todoList");
  const stats = document.getElementById("todoStats");
  if (!container) return;

  const normalized = todos.map(normalizeTodoForUi);
  const done = normalized.filter((t) => t.done).length;
  const running = normalized.filter((t) => t.timerState === "running" && getTodoRemainingSeconds(t) > 0).length;
  if (stats) {
    stats.textContent = normalized.length
      ? `${done} of ${normalized.length} done${running ? ` • ${running} timer running` : ""}`
      : "No tasks yet - add your first one above.";
  }

  container.innerHTML = "";
  if (!normalized.length) {
    container.innerHTML = '<p class="empty-text">Nothing on your list. Add a small, focused task to knock out this session.</p>';
    return;
  }

  normalized.forEach((todo) => {
    const remainingSeconds = getTodoRemainingSeconds(todo);
    const totalSeconds = Math.max(60, Number(todo.durationMinutes || 25) * 60);
    const progress = Math.max(0, Math.min(100, ((totalSeconds - remainingSeconds) / totalSeconds) * 100));
    const item = document.createElement("div");
    item.className = `todo-item${todo.done ? " done" : ""}`;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "todo-checkbox";
    checkbox.checked = Boolean(todo.done);
    checkbox.addEventListener("change", async () => {
      await submitAction(async () => {
        await sendMessage("todo:toggle", { id: todo.id });
      }, todoMessage);
    });

    const main = document.createElement("div");
    main.className = "todo-main";
    const label = document.createElement("span");
    label.className = "todo-text";
    label.textContent = todo.text;
    const meta = document.createElement("div");
    meta.className = "todo-meta";
    meta.innerHTML = `<span class="todo-countdown">${formatCountdown(remainingSeconds)}</span><span>${todo.durationMinutes} min</span><span>${timerStateLabel(todo, remainingSeconds)}</span>`;
    const progressBar = document.createElement("div");
    progressBar.className = "todo-progress";
    progressBar.innerHTML = `<span style="width:${progress}%"></span>`;
    main.appendChild(label);
    main.appendChild(meta);
    main.appendChild(progressBar);

    const actions = document.createElement("div");
    actions.className = "todo-actions";
    const timerBtn = document.createElement("button");
    timerBtn.type = "button";
    timerBtn.className = "todo-action";
    timerBtn.textContent = todo.timerState === "running" && remainingSeconds > 0 ? "Pause" : "Start";
    timerBtn.disabled = Boolean(todo.done) || remainingSeconds <= 0;
    timerBtn.addEventListener("click", async () => {
      await submitAction(async () => {
        await sendMessage(todo.timerState === "running" ? "todo:pauseTimer" : "todo:startTimer", { id: todo.id });
      }, todoMessage);
    });

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "todo-action";
    resetBtn.textContent = "Reset";
    resetBtn.addEventListener("click", async () => {
      await submitAction(async () => {
        await sendMessage("todo:resetTimer", { id: todo.id });
      }, todoMessage);
    });

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "todo-action";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => renderTodoEditForm(item, todo));

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "todo-action todo-delete";
    removeBtn.textContent = "×";
    removeBtn.setAttribute("aria-label", `Remove ${todo.text}`);
    removeBtn.addEventListener("click", async () => {
      await submitAction(async () => {
        await sendMessage("todo:remove", { id: todo.id });
      }, todoMessage);
    });

    item.appendChild(checkbox);
    item.appendChild(main);
    actions.appendChild(timerBtn);
    actions.appendChild(resetBtn);
    actions.appendChild(editBtn);
    actions.appendChild(removeBtn);
    item.appendChild(actions);
    container.appendChild(item);
  });
}

function renderTodoEditForm(item, todo) {
  item.innerHTML = "";
  const form = document.createElement("form");
  form.className = "todo-edit-form";
  form.innerHTML = `
    <input name="text" maxlength="200" value="${escapeAttribute(todo.text)}" />
    <input name="durationMinutes" type="number" min="1" max="480" step="1" value="${todo.durationMinutes}" />
    <button type="submit" class="todo-action">Save</button>
    <button type="button" class="todo-action" data-cancel>Cancel</button>
  `;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    await submitAction(async () => {
      await sendMessage("todo:update", {
        id: todo.id,
        text: formData.get("text"),
        durationMinutes: Number(formData.get("durationMinutes") || todo.durationMinutes)
      });
    }, todoMessage);
  });
  form.querySelector("[data-cancel]")?.addEventListener("click", () => renderTodos(appState.todos || []));
  item.appendChild(form);
  form.querySelector("input")?.focus();
}

function scheduleCountdownPaint(enabled) {
  if (!enabled) {
    if (countdownPaintTimer) clearInterval(countdownPaintTimer);
    countdownPaintTimer = null;
    return;
  }
  if (countdownPaintTimer) return;
  countdownPaintTimer = setInterval(() => {
    if (appState?.todos) {
      renderTodos(appState.todos);
    }
  }, 1000);
}

function normalizeTodoForUi(todo) {
  const durationMinutes = Number.isFinite(Number(todo.durationMinutes)) ? Number(todo.durationMinutes) : 25;
  return {
    ...todo,
    durationMinutes,
    remainingSeconds: Number.isFinite(Number(todo.remainingSeconds)) ? Number(todo.remainingSeconds) : durationMinutes * 60,
    timerState: todo.timerState || "idle",
    timerStartedAt: todo.timerStartedAt || null
  };
}

function getTodoRemainingSeconds(todo) {
  const base = Math.max(0, Math.round(Number(todo.remainingSeconds || 0)));
  if (todo.timerState !== "running" || !todo.timerStartedAt) {
    return base;
  }
  const elapsed = Math.floor((Date.now() - Number(todo.timerStartedAt)) / 1000);
  return Math.max(0, base - elapsed);
}

function formatCountdown(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function timerStateLabel(todo, remainingSeconds) {
  if (todo.done) return "Done";
  if (remainingSeconds <= 0) return "Time up";
  if (todo.timerState === "running") return "Running";
  if (todo.timerState === "paused") return "Paused";
  return "Ready";
}

function escapeAttribute(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function updateSetting(key, value, messageTarget = accountMessage) {
  await submitAction(async () => {
    await sendMessage("settings:update", { [key]: value });
  }, messageTarget);
}

function showMessage(target, message, tone = "info") {
  if (!target) return;
  target.className = `message-box ${tone}`;
  target.textContent = message;
  target.classList.remove("hidden");
}

function clearMessage(target) {
  if (!target) return;
  target.textContent = "";
  target.classList.add("hidden");
}

async function sendMessage(type, payload = {}) {
  const runtime = globalThis.chrome?.runtime;
  if (!runtime?.sendMessage) {
    throw new Error("Extension runtime is unavailable in this context.");
  }

  const TIMEOUT_MS = 12000;
  const response = await Promise.race([
    runtime.sendMessage({ type, payload }),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("The extension didn't respond in time. Open chrome://extensions, click \"service worker\" under this extension, and check the Console tab for the real error.")),
        TIMEOUT_MS
      )
    ),
  ]);

  if (!response?.ok) {
    throw new Error(response?.error || "The extension action failed.");
  }
  return response;
}

function formatTime(timestamp) {
  if (!timestamp) return "Just now";
  const date = new Date(timestamp);
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function cleanDisplayName(value) {
  const text = String(value || "").trim();
  return text || "study champion";
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}
