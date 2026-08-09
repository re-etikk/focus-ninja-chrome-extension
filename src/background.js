// Real, official Firebase SDK — bundled by esbuild at build time (see
// esbuild.config.mjs / `npm run build`). No CDN, no stub files: these are
// the actual "firebase" npm package's compat entry points, which provide
// the same v8-style API (firebase.auth(), firebase.firestore(), ...) that
// the rest of this file already uses, backed by the real modular SDK.
import firebase from "firebase/compat/app";
import "firebase/compat/auth";
import "firebase/compat/firestore";
import { firebaseConfig } from "./firebase-config.js";

const STORAGE_KEYS = {
  settings: "settings",
  auth: "auth",
  session: "session",
  stats: "stats",
  todos: "todos"
};

// --- Config guard -----------------------------------------------------
// A misconfigured (placeholder, or someone else's leftover) firebaseConfig
// used to fail silently deep inside a network call, leaving the popup
// spinning forever with no error. This checks BEFORE any Firebase call is
// ever made and, if invalid, makes every auth/data action fail instantly
// with a clear, visible message instead.
const KNOWN_PLACEHOLDER_MARKERS = ["PASTE_YOUR_", "focus-ninja-fb13c", "AIzaSyAj72FpngukxLMstwo"];
function detectConfigProblem(config) {
  if (!config || typeof config !== "object") {
    return "firebase-config.js did not export a config object.";
  }
  const required = ["apiKey", "authDomain", "projectId", "appId"];
  const missing = required.filter((key) => !config[key]);
  if (missing.length) {
    return `firebase-config.js is missing: ${missing.join(", ")}.`;
  }
  const serialized = JSON.stringify(config);
  const usedPlaceholder = KNOWN_PLACEHOLDER_MARKERS.find((marker) => serialized.includes(marker));
  if (usedPlaceholder) {
    return "src/firebase-config.js still has placeholder or leftover demo-project values, not your own Firebase project's config. Create your own project at https://console.firebase.google.com, copy its config into src/firebase-config.js, then run \"npm run build\" again.";
  }
  return null;
}

const firebaseConfigError = detectConfigProblem(firebaseConfig);

const firebaseApp = firebaseConfigError ? null : (firebase.apps.length ? firebase.app() : firebase.initializeApp(firebaseConfig));
const firebaseAuth = firebaseApp ? firebase.auth() : null;
const firestoreDb = firebaseApp ? firebase.firestore() : null;

if (firebaseConfigError) {
  console.error("[StudyPhoneDetector] Firebase is not configured correctly:", firebaseConfigError);
}

// Firebase's onAuthStateChanged fires asynchronously (with its own Firestore
// round-trip) any time sign-in/sign-out happens — including in the middle of
// our own manual login/register/logout functions below, which also call
// syncAuthStateFromFirebaseUser explicitly and deterministically. Without a
// guard, both paths write to chrome.storage.local independently and can
// finish in the wrong order (e.g. an unverified-email login correctly signs
// itself back out, but the listener's slower "signed in" write lands after
// it and silently undoes it — the popup shows an error, yet a reopen shows
// you logged in anyway). Any function that manages its own auth transition
// sets this flag first and clears it in a `finally` once its own sync call
// has completed, so the passive listener sits out that entire operation.
let authListenerSuppressed = false;

if (firebaseAuth && firestoreDb) {
  firebaseAuth.onAuthStateChanged(async (user) => {
    if (authListenerSuppressed) return;
    await syncAuthStateFromFirebaseUser(user);
  });
}

const DEFAULT_SETTINGS = {
  popupEnabled: true,
  audioEnabled: true,
  strictMode: true,
  desktopNotifications: true,
  breakReminderMinutes: 45,
  dailyGoalMinutes: 120,
  continueGraceSeconds: 90,
  violationCooldownSeconds: 25,
  scheduleEnabled: false,
  scheduleDays: [1, 2, 3, 4, 5],
  scheduleStart: "18:00",
  scheduleEnd: "20:00",
  pomodoroEnabled: true,
  pomodoroFocusMinutes: 25,
  pomodoroBreakMinutes: 5,
  adaptiveShield: true,
  smartAutoStart: false,
  smartFocusAssist: true,
  goalReminderEnabled: true,
  autoBreakPrompt: true,
  autoOpenMonitor: true,
  focusPreset: "deep",
  maxPhoneDetectionsPerDay: 5,
  phoneDetectionSensitivity: 60,
  allowedSites: [
    "khanacademy.org",
    "coursera.org",
    "wikipedia.org",
    "developer.mozilla.org",
    "docs.google.com",
    "youtube.com",
    "chat.openai.com"
  ]
};

const DEFAULT_SESSION = {
  active: false,
  paused: false,
  startedAt: null,
  pausedAt: null,
  totalPausedMs: 0,
  focusedMs: 0,
  distractionMs: 0,
  violationCount: 0,
  lastViolationAt: 0,
  lastViolationUrl: "",
  phoneDetections: 0,
  lastPhoneDetectionAt: 0,
  breakReminderSentAt: 0,
  graceUntil: 0,
  lastTickAt: 0,
  autoStarted: false,
  pomodoroPhase: "focus",
  pomodoroPhaseStartedAt: 0,
  pomodoroCycle: 1
};

const DEFAULT_STATS = {
  daily: {},
  recentEvents: [],
  sessionHistory: []
};

bootstrap();

chrome.runtime.onInstalled.addListener(() => {
  bootstrap();
});

chrome.runtime.onStartup.addListener(() => {
  bootstrap();
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await safeGetTab(tabId);
  if (tab) {
    await evaluateTab(tab, { countViolation: true, source: "tab-activated" });
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" || changeInfo.url) {
    await evaluateTab(tab || (await safeGetTab(tabId)), {
      countViolation: true,
      source: "tab-updated"
    });
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "focus-tick") {
    await handleFocusTick();
  }
  if (alarm.name === "schedule-tick") {
    await handleScheduleTick();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((response) => sendResponse({ ok: true, ...response }))
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    });
  return true;
});

async function bootstrap() {
  try {
    await ensureDefaults();
    await chrome.alarms.create("focus-tick", { periodInMinutes: 1 });
    await chrome.alarms.create("schedule-tick", { periodInMinutes: 1 });
    if (firebaseAuth) {
      await syncAuthStateFromFirebaseUser(firebaseAuth.currentUser);
    }
    await syncBadge();
  } catch (error) {
    console.error("Failed to initialize extension background state:", error);
  }
}

async function handleMessage(message, sender) {
  const type = message?.type;
  switch (type) {
    case "app:getState":
      return { state: await getAppState() };
    case "auth:getOAuthSetupInfo":
      return {
        state: await getAppState(),
        oauth: {
          extensionId: chrome.runtime.id,
          redirectUri: chrome.identity.getRedirectURL(),
          clientId: chrome.runtime.getManifest()?.oauth2?.client_id || ""
        }
      };
    case "app:openMonitor":
      await openMonitorPage();
      return { state: await getAppState() };
    case "auth:registerManual":
      await registerManualUser(message.payload || {});
      return { state: await getAppState() };
    case "auth:loginManual":
      await loginManualUser(message.payload || {});
      return { state: await getAppState() };
    case "auth:googleUpsert":
      await upsertGoogleUser(message.payload || {});
      return { state: await getAppState() };
    case "auth:logout":
      await logoutUser();
      return { state: await getAppState() };
    case "auth:forgotPassword":
      await sendPasswordReset(message.payload?.email || "");
      return { state: await getAppState() };
    case "auth:updateProfile":
      await updateProfile(message.payload || {});
      return { state: await getAppState() };
    case "auth:deleteAccount":
      await deleteAccount();
      return { state: await getAppState() };
    case "settings:update":
      await updateSettings(message.payload || {});
      await reevaluateActiveTab();
      return { state: await getAppState() };
    case "whitelist:add":
      await addAllowedSite(message.payload?.site || "");
      await reevaluateActiveTab();
      return { state: await getAppState() };
    case "whitelist:remove":
      await removeAllowedSite(message.payload?.site || "");
      await reevaluateActiveTab();
      return { state: await getAppState() };
    case "todo:add":
      await addTodo(message.payload || {});
      return { state: await getAppState() };
    case "todo:update":
      await updateTodo(message.payload || {});
      return { state: await getAppState() };
    case "todo:toggle":
      await toggleTodo(message.payload?.id || "");
      return { state: await getAppState() };
    case "todo:startTimer":
      await startTodoTimer(message.payload?.id || "");
      return { state: await getAppState() };
    case "todo:pauseTimer":
      await pauseTodoTimer(message.payload?.id || "");
      return { state: await getAppState() };
    case "todo:resetTimer":
      await resetTodoTimer(message.payload?.id || "");
      return { state: await getAppState() };
    case "todo:remove":
      await removeTodo(message.payload?.id || "");
      return { state: await getAppState() };
    case "todo:clearCompleted":
      await clearCompletedTodos();
      return { state: await getAppState() };
    case "session:start":
      await startSession();
      await reevaluateActiveTab();
      return { state: await getAppState() };
    case "session:pause":
      await pauseSession();
      return { state: await getAppState() };
    case "session:resume":
      await resumeSession();
      await reevaluateActiveTab();
      return { state: await getAppState() };
    case "session:stop":
      await stopSession("Focus session stopped.");
      return { state: await getAppState() };
    case "session:continueGrace":
      await allowTemporaryBypass();
      return { state: await getAppState() };
    case "session:skipBreak":
      await skipPomodoroBreak();
      return { state: await getAppState() };
    case "session:applyPreset":
      await applyFocusPreset(message.payload?.preset || "deep");
      return { state: await getAppState() };
    case "audio:play":
      await playAlert(message.payload?.reason || "manual-test");
      return { state: await getAppState() };
    case "audio:stop":
      await stopAlert();
      return { state: await getAppState() };
    case "phone:detected":
      await recordPhoneDetection(message.payload?.confidence || 0);
      return { state: await getAppState() };
    case "phone:cleared":
      await clearPhoneOverlay();
      return { state: await getAppState() };
    case "tab:evaluateCurrent":
      await evaluateTab(sender.tab, { countViolation: false, source: "content-ping" });
      return { state: await getAppState() };
    default:
      return { ignored: true };
  }
}

async function ensureDefaults() {
  const snapshot = await chrome.storage.local.get(Object.values(STORAGE_KEYS));
  const settings = { ...DEFAULT_SETTINGS, ...(snapshot.settings || {}) };
  const auth = {
    cachedProfile: snapshot.auth?.cachedProfile || snapshot.auth?.users?.[0] || null,
    lastSyncedAt: snapshot.auth?.lastSyncedAt || 0
  };
  const session = { ...DEFAULT_SESSION, ...(snapshot.session || {}) };
  const stats = {
    daily: snapshot.stats?.daily || {},
    recentEvents: Array.isArray(snapshot.stats?.recentEvents) ? snapshot.stats.recentEvents : [],
    sessionHistory: Array.isArray(snapshot.stats?.sessionHistory) ? snapshot.stats.sessionHistory : []
  };
  const todos = normalizeTodos(snapshot.todos);

  await chrome.storage.local.set({ settings, auth, session, stats, todos });
}

async function getAppState() {
  await ensureDefaults();
  const { settings, auth, session, stats, todos } = await chrome.storage.local.get(
    Object.values(STORAGE_KEYS)
  );
  const currentUser = buildCurrentUserView(getFirebaseAuthUser(), auth.cachedProfile);
  const todayKey = getDateKey();
  const todayStats = {
    ...createDailyStat(),
    ...(stats.daily[todayKey] || {})
  };
  const streak = computeStreak(stats.daily, settings.dailyGoalMinutes);
  const liveSession = buildLiveSession(session, settings);
  const goalProgress = computeGoalProgress(todayStats.focusedMs, settings.dailyGoalMinutes);

  return {
    configError: firebaseConfigError,
    settings,
    session: liveSession,
    user: currentUser,
    todos: normalizeTodos(todos).sort((a, b) => Number(a.done) - Number(b.done) || b.createdAt - a.createdAt),
    insights: buildInsights({
      today: todayStats,
      streak,
      goalProgress,
      focusScore: computeFocusScore(todayStats, settings.dailyGoalMinutes, streak),
      settings,
      session: liveSession,
      user: currentUser
    }),
    stats: {
      today: todayStats,
      streak,
      goalProgress,
      focusScore: computeFocusScore(todayStats, settings.dailyGoalMinutes, streak),
      recentEvents: stats.recentEvents.slice(0, 12),
      recentSessions: stats.sessionHistory.slice(0, 8),
      week: buildWeeklySeries(stats.daily),
      heatmap: buildHeatmap(stats.daily, settings.dailyGoalMinutes)
    }
  };
}

async function registerManualUser(payload) {
  const name = cleanText(payload.name);
  const email = normalizeEmail(payload.email);
  const password = String(payload.password || "");
  const confirmPassword = String(payload.confirmPassword || "");
  const dob = String(payload.dob || "");

  if (!name || name.length < 2) {
    throw new Error("Please enter a valid full name.");
  }
  if (!email || !email.includes("@")) {
    throw new Error("Please enter a valid email address.");
  }
  if (password.length < 6) {
    throw new Error("Password must be at least 6 characters long.");
  }
  if (password !== confirmPassword) {
    throw new Error("Password confirmation does not match.");
  }
  if (!dob) {
    throw new Error("Date of birth is required.");
  }

  if (!firebaseAuth) {
    throw new Error(firebaseConfigError || "Firebase Auth is not available in this build.");
  }

  authListenerSuppressed = true;
  try {
    const credential = await firebaseAuth.createUserWithEmailAndPassword(email, password);
    await safeEnsureFirebaseProfile(credential.user, {
      name,
      email,
      dob,
      provider: "email"
    });
    await credential.user.sendEmailVerification();
    await firebaseAuth.signOut();
    await syncAuthStateFromFirebaseUser(null);
    await appendEvent("success", "Account created. Please verify your email before signing in.");
  } catch (error) {
    throw new Error(mapAuthError(error));
  } finally {
    authListenerSuppressed = false;
  }
}

async function loginManualUser(payload) {
  const email = normalizeEmail(payload.email);
  const password = String(payload.password || "");

  if (!email || !password) {
    throw new Error("Email and password are required.");
  }

  if (!firebaseAuth) {
    throw new Error(firebaseConfigError || "Firebase Auth is not available in this build.");
  }

  authListenerSuppressed = true;
  try {
    const credential = await firebaseAuth.signInWithEmailAndPassword(email, password);
    if (!credential.user.emailVerified) {
      await credential.user.sendEmailVerification();
      await firebaseAuth.signOut();
      await syncAuthStateFromFirebaseUser(null);
      throw new Error("Please verify your email before logging in. A fresh verification email has been sent.");
    }
    await syncAuthStateFromFirebaseUser(credential.user);
    await appendEvent("info", "Logged in successfully.");
  } catch (error) {
    throw new Error(mapAuthError(error));
  } finally {
    authListenerSuppressed = false;
  }
}

async function upsertGoogleUser(payload) {
  const email = normalizeEmail(payload.email);
  const name = cleanText(payload.name);
  const dob = String(payload.dob || "");

  if (!firebaseAuth || !firestoreDb) {
    throw new Error(firebaseConfigError || "Firebase Auth is not available in this build.");
  }

  authListenerSuppressed = true;
  try {
    // NOTE: firebase.auth().signInWithPopup() cannot run here — a Manifest V3
    // service worker has no window/DOM to open a popup from, so that call
    // would throw "auth/operation-not-supported-in-this-environment" at
    // runtime even though the SDK itself is real. Instead we get a Google ID
    // token via Chrome's native identity API (which is designed to work from
    // a service worker) and exchange it for a real Firebase credential —
    // this is Google's documented pattern for Firebase Auth in extensions.
    const idToken = await getGoogleIdToken();
    const credential = firebase.auth.GoogleAuthProvider.credential(idToken);
    const result = await firebaseAuth.signInWithCredential(credential);
    const user = result.user;

    await safeEnsureFirebaseProfile(user, {
      name: name || user.displayName || "",
      email: email || user.email || "",
      dob,
      provider: "google"
    });
    await syncAuthStateFromFirebaseUser(user);
    await appendEvent("success", "Google quick access completed.");
  } catch (error) {
    throw new Error(mapAuthError(error));
  } finally {
    authListenerSuppressed = false;
  }
}

// Runs Google's OAuth "implicit" flow through chrome.identity.launchWebAuthFlow
// and returns the resulting id_token (a signed JWT Firebase can verify
// directly — no server of your own required). Requires GOOGLE_OAUTH_CLIENT_ID
// to be set in manifest.json's "oauth2.client_id" (see README).
function getGoogleIdToken() {
  return new Promise((resolve, reject) => {
    const redirectUri = chrome.identity.getRedirectURL();
    const nonce = crypto.randomUUID();
    const clientId = chrome.runtime.getManifest()?.oauth2?.client_id;
    if (!clientId || clientId.includes("YOUR_")) {
      reject(new Error("Google sign-in isn't configured yet — add your OAuth Client ID under \"oauth2.client_id\" in manifest.json (see README)."));
      return;
    }
    const authUrl =
      "https://accounts.google.com/o/oauth2/v2/auth" +
      `?client_id=${encodeURIComponent(clientId)}` +
      "&response_type=id_token" +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent("openid email profile")}` +
      `&nonce=${encodeURIComponent(nonce)}` +
      "&prompt=select_account";

    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (redirectUrl) => {
      if (chrome.runtime.lastError || !redirectUrl) {
        const message = chrome.runtime.lastError?.message || "";
        if (message.includes("did not approve") || message.includes("cancel")) {
          reject(new Error("Google sign-in was cancelled."));
        } else {
          reject(new Error(message || "Google sign-in was cancelled or blocked by the browser."));
        }
        return;
      }

      const url = new URL(redirectUrl);
      const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
      const queryParams = url.searchParams;
      const errorCode = hashParams.get("error") || queryParams.get("error");
      if (errorCode) {
        const description = hashParams.get("error_description") || queryParams.get("error_description") || "";
        reject(new Error(googleOAuthErrorHint(errorCode, description)));
        return;
      }

      const idToken = hashParams.get("id_token");
      if (!idToken) {
        reject(new Error("Google did not return an ID token. Double-check your OAuth client is type \"Web application\" (not \"Chrome Extension\") with the exact redirect URI registered — see README → Step 6."));
        return;
      }
      resolve(idToken);
    });
  });
}

// Translates Google's raw OAuth error codes into an actionable message,
// since "redirect_uri_mismatch" or "invalid_client" mean nothing to most
// people but point at one specific setup step to fix.
function googleOAuthErrorHint(code, description) {
  const redirectUri = chrome.identity.getRedirectURL();
  switch (code) {
    case "redirect_uri_mismatch":
      return `Google rejected the redirect URI. In Google Cloud Console, edit your OAuth client (type must be "Web application") and add this exact URI under "Authorized redirect URIs": ${redirectUri}`;
    case "invalid_client":
      return "Google says this Client ID is invalid or the wrong type. It must be a \"Web application\" OAuth client, not \"Chrome Extension\" — see README → Step 6.";
    case "access_denied":
      return "You declined the Google sign-in prompt.";
    case "invalid_request":
      return `Google rejected the sign-in request${description ? `: ${description}` : "."} Double-check the OAuth client configuration in README → Step 6.`;
    default:
      return `Google sign-in failed (${code})${description ? `: ${description}` : ""}.`;
  }
}

async function logoutUser() {
  await stopSession("Focus session ended on logout.");
  authListenerSuppressed = true;
  try {
    if (firebaseAuth) {
      await firebaseAuth.signOut();
    }
    await syncAuthStateFromFirebaseUser(null);
    await appendEvent("info", "Signed out.");
  } finally {
    authListenerSuppressed = false;
  }
}

async function sendPasswordReset(email) {
  const targetEmail = normalizeEmail(email);
  if (!targetEmail || !targetEmail.includes("@")) {
    throw new Error("Please provide a valid email address.");
  }

  if (!firebaseAuth) {
    throw new Error(firebaseConfigError || "Firebase Auth is not available in this build.");
  }

  try {
    await firebaseAuth.sendPasswordResetEmail(targetEmail);
    await appendEvent("info", `Password reset email sent to ${targetEmail}.`);
  } catch (error) {
    throw new Error(mapAuthError(error));
  }
}

async function updateProfile(payload) {
  if (!firebaseAuth?.currentUser) {
    throw new Error("Please sign in before updating your profile.");
  }

  const name = cleanText(payload.name || "");
  const dob = String(payload.dob || "");
  const photoUrl = String(payload.photoUrl || "").trim();

  if (!name && !dob && !photoUrl) {
    throw new Error("Please provide at least one profile change.");
  }

  try {
    const profileUpdates = {};
    if (name) {
      profileUpdates.displayName = name;
    }
    if (photoUrl) {
      profileUpdates.photoURL = photoUrl;
    }
    if (Object.keys(profileUpdates).length) {
      await firebaseAuth.currentUser.updateProfile(profileUpdates);
    }

    const profile = await safeEnsureFirebaseProfile(firebaseAuth.currentUser, {
      name: name || firebaseAuth.currentUser.displayName || "",
      email: firebaseAuth.currentUser.email || "",
      dob: dob || "",
      photoUrl: photoUrl || firebaseAuth.currentUser.photoURL || "",
      provider: firebaseAuth.currentUser.providerData?.[0]?.providerId || "firebase"
    });
    await syncAuthStateFromFirebaseUser(firebaseAuth.currentUser);
    await appendEvent("info", "Profile updated.");
    return profile;
  } catch (error) {
    throw new Error(mapAuthError(error));
  }
}

async function deleteAccount() {
  if (!firebaseAuth?.currentUser) {
    throw new Error("No active account found.");
  }

  authListenerSuppressed = true;
  try {
    await firebaseAuth.currentUser.delete();
    await syncAuthStateFromFirebaseUser(null);
    await appendEvent("warning", "Account deleted.");
  } catch (error) {
    throw new Error(mapAuthError(error));
  } finally {
    authListenerSuppressed = false;
  }
}

async function updateSettings(patch) {
  const { settings } = await chrome.storage.local.get("settings");
  const next = {
    ...settings,
    ...patch
  };

  if (Array.isArray(patch.allowedSites)) {
    next.allowedSites = uniqueHosts(patch.allowedSites);
  }

  next.breakReminderMinutes = clampNumber(next.breakReminderMinutes, 15, 180, 45);
  next.dailyGoalMinutes = clampNumber(next.dailyGoalMinutes, 30, 600, 120);
  next.continueGraceSeconds = clampNumber(next.continueGraceSeconds, 30, 600, 90);
  next.violationCooldownSeconds = clampNumber(next.violationCooldownSeconds, 10, 300, 25);
  next.smartAutoStart = Boolean(patch.smartAutoStart);
  next.smartFocusAssist = patch.smartFocusAssist !== false;
  next.goalReminderEnabled = patch.goalReminderEnabled !== false;
  next.autoBreakPrompt = patch.autoBreakPrompt !== false;
  next.focusPreset = getPresetConfig(patch.focusPreset || next.focusPreset || "deep").id;
  next.scheduleDays = Array.isArray(next.scheduleDays)
    ? [...new Set(next.scheduleDays.map(Number).filter((day) => day >= 0 && day <= 6))]
    : DEFAULT_SETTINGS.scheduleDays;
  next.scheduleStart = normalizeTime(next.scheduleStart, DEFAULT_SETTINGS.scheduleStart);
  next.scheduleEnd = normalizeTime(next.scheduleEnd, DEFAULT_SETTINGS.scheduleEnd);
  next.pomodoroFocusMinutes = clampNumber(next.pomodoroFocusMinutes, 15, 90, 25);
  next.pomodoroBreakMinutes = clampNumber(next.pomodoroBreakMinutes, 3, 30, 5);

  await chrome.storage.local.set({ settings: next });
  await appendEvent("info", "Study preferences updated.");
}

async function addAllowedSite(site) {
  const host = normalizeHost(site);
  if (!host) {
    throw new Error("Please enter a valid website host.");
  }

  const { settings } = await chrome.storage.local.get("settings");
  settings.allowedSites = uniqueHosts([host, ...(settings.allowedSites || [])]);
  await chrome.storage.local.set({ settings });
  await appendEvent("success", `${host} added to allowed sites.`);
}

async function removeAllowedSite(site) {
  const host = normalizeHost(site);
  const { settings } = await chrome.storage.local.get("settings");
  settings.allowedSites = (settings.allowedSites || []).filter((item) => item !== host);
  await chrome.storage.local.set({ settings });
  await appendEvent("info", `${host} removed from allowed sites.`);
}

async function addTodo(payload) {
  const clean = cleanText(payload.text);
  if (!clean) {
    throw new Error("Please enter a task.");
  }
  if (clean.length > 200) {
    throw new Error("Keep tasks under 200 characters.");
  }
  const durationMinutes = clampNumber(payload.durationMinutes, 1, 480, 25);

  const { todos } = await chrome.storage.local.get("todos");
  const list = normalizeTodos(todos);
  list.unshift({
    id: crypto.randomUUID(),
    text: clean,
    done: false,
    durationMinutes,
    remainingSeconds: durationMinutes * 60,
    timerState: "idle",
    timerStartedAt: null,
    createdAt: Date.now()
  });
  await chrome.storage.local.set({ todos: list });
}

async function updateTodo(payload) {
  const id = String(payload.id || "");
  const clean = cleanText(payload.text);
  if (!id) return;
  if (!clean) {
    throw new Error("Please enter a task.");
  }
  if (clean.length > 200) {
    throw new Error("Keep tasks under 200 characters.");
  }
  const nextDuration = clampNumber(payload.durationMinutes, 1, 480, 25);
  const { todos } = await chrome.storage.local.get("todos");
  const list = normalizeTodos(todos);
  const target = list.find((item) => item.id === id);
  if (!target) return;

  const previousDurationSeconds = Number(target.durationMinutes || 25) * 60;
  const liveRemaining = getTodoRemainingSeconds(target);
  const wasPristine = liveRemaining === previousDurationSeconds || target.timerState === "idle";
  target.text = clean;
  target.durationMinutes = nextDuration;
  target.remainingSeconds = wasPristine ? nextDuration * 60 : Math.min(liveRemaining, nextDuration * 60);
  target.timerState = target.remainingSeconds <= 0 ? "complete" : "idle";
  target.timerStartedAt = null;
  target.updatedAt = Date.now();
  await chrome.storage.local.set({ todos: list });
}

async function toggleTodo(id) {
  const { todos } = await chrome.storage.local.get("todos");
  const list = normalizeTodos(todos);
  const target = list.find((item) => item.id === id);
  if (!target) return;
  target.done = !target.done;
  target.completedAt = target.done ? Date.now() : null;
  if (target.done && target.timerState === "running") {
    target.remainingSeconds = getTodoRemainingSeconds(target);
    target.timerState = "paused";
    target.timerStartedAt = null;
  }
  await chrome.storage.local.set({ todos: list });
}

async function startTodoTimer(id) {
  const { todos } = await chrome.storage.local.get("todos");
  const list = normalizeTodos(todos);
  const target = list.find((item) => item.id === id);
  if (!target || target.done) return;
  target.remainingSeconds = Math.max(1, getTodoRemainingSeconds(target));
  target.timerState = "running";
  target.timerStartedAt = Date.now();
  await chrome.storage.local.set({ todos: list });
}

async function pauseTodoTimer(id) {
  const { todos } = await chrome.storage.local.get("todos");
  const list = normalizeTodos(todos);
  const target = list.find((item) => item.id === id);
  if (!target) return;
  target.remainingSeconds = getTodoRemainingSeconds(target);
  target.timerState = target.remainingSeconds <= 0 ? "complete" : "paused";
  target.timerStartedAt = null;
  await chrome.storage.local.set({ todos: list });
}

async function resetTodoTimer(id) {
  const { todos } = await chrome.storage.local.get("todos");
  const list = normalizeTodos(todos);
  const target = list.find((item) => item.id === id);
  if (!target) return;
  target.remainingSeconds = Number(target.durationMinutes || 25) * 60;
  target.timerState = "idle";
  target.timerStartedAt = null;
  await chrome.storage.local.set({ todos: list });
}

async function removeTodo(id) {
  const { todos } = await chrome.storage.local.get("todos");
  const list = normalizeTodos(todos);
  await chrome.storage.local.set({ todos: list.filter((item) => item.id !== id) });
}

async function clearCompletedTodos() {
  const { todos } = await chrome.storage.local.get("todos");
  const list = normalizeTodos(todos);
  await chrome.storage.local.set({ todos: list.filter((item) => !item.done) });
}

async function startSession(options = {}) {
  const state = await getAppState();
  if (!state.user) {
    throw new Error("Please log in before starting a study session.");
  }
  if (state.session.active) {
    throw new Error("A focus session is already running.");
  }

  const preset = getPresetConfig(options.preset || state.settings.focusPreset || "deep");
  const session = {
    ...DEFAULT_SESSION,
    active: true,
    startedAt: Date.now(),
    lastTickAt: Date.now(),
    pomodoroPhaseStartedAt: Date.now(),
    autoStarted: Boolean(options.autoStarted),
    focusPreset: preset.id
  };

  await chrome.storage.local.set({ session });
  await appendEvent("success", options.autoStarted ? "Smart focus session started automatically." : `Focus session started in ${preset.label.toLowerCase()} mode.`);
  await syncBadge();

  // Site-blocking itself runs truly in the background via chrome.alarms
  // regardless of any open tab. Camera-based phone detection is different —
  // it needs a live <video> element, which cannot exist inside the
  // invisible service worker — so we open (or focus) a small persistent
  // window for it automatically. You can minimize this window; Chrome keeps
  // its JS (and the camera feed) running as long as it isn't closed.
  if (state.settings.autoOpenMonitor !== false) {
    await openMonitorWidget();
  }
}

async function pauseSession() {
  const { session } = await chrome.storage.local.get("session");
  if (!session.active) {
    throw new Error("No active session to pause.");
  }
  if (session.paused) {
    throw new Error("Session is already paused.");
  }

  session.paused = true;
  session.pausedAt = Date.now();
  session.lastTickAt = 0;
  await chrome.storage.local.set({ session });
  await stopAlert();
  await clearAllOverlays();
  await appendEvent("warning", "Focus session paused.");
  await syncBadge();
}

async function resumeSession() {
  const { session } = await chrome.storage.local.get("session");
  if (!session.active) {
    throw new Error("No active session to resume.");
  }
  if (!session.paused) {
    throw new Error("Session is already running.");
  }

  session.totalPausedMs += Date.now() - Number(session.pausedAt || Date.now());
  session.paused = false;
  session.pausedAt = null;
  session.lastTickAt = Date.now();
  await chrome.storage.local.set({ session });
  await appendEvent("info", "Focus session resumed.");
  await syncBadge();
}

async function stopSession(reason) {
  const { session, stats, settings } = await chrome.storage.local.get(["session", "stats", "settings"]);
  const wasActive = Boolean(session.active);

  if (wasActive && session.startedAt) {
    const liveSession = buildLiveSession(session, settings);
    const historyEntry = {
      id: crypto.randomUUID(),
      startedAt: session.startedAt,
      endedAt: Date.now(),
      elapsedMs: liveSession.elapsedMs,
      focusedMs: session.focusedMs,
      distractionMs: session.distractionMs,
      violations: session.violationCount,
      goalMet: session.focusedMs >= settings.dailyGoalMinutes * 60000
    };
    stats.sessionHistory.unshift(historyEntry);
    stats.sessionHistory = stats.sessionHistory.slice(0, 60);
    await chrome.storage.local.set({ stats });
  }

  await chrome.storage.local.set({
    session: {
      ...DEFAULT_SESSION
    }
  });

  await clearAllOverlays();
  await stopAlert();
  await syncBadge();

  if (wasActive) {
    await appendEvent("info", reason || "Focus session stopped.");
  }
}

async function allowTemporaryBypass() {
  const { session, settings } = await chrome.storage.local.get(["session", "settings"]);
  if (!session.active || session.paused) {
    return;
  }

  session.graceUntil = Date.now() + settings.continueGraceSeconds * 1000;
  await chrome.storage.local.set({ session });
  await stopAlert();
  await clearAllOverlays();
  await appendEvent("info", `Temporary allowance enabled for ${settings.continueGraceSeconds} seconds.`);
}

async function handleFocusTick() {
  const { settings, session } = await chrome.storage.local.get(["settings", "session"]);
  if (!session.active || session.paused) {
    await syncBadge();
    return;
  }

  const now = Date.now();
  const elapsedMs = Math.min(2 * 60 * 1000, Math.max(0, now - Number(session.lastTickAt || now)));
  session.lastTickAt = now;

  if (settings.pomodoroEnabled && advancePomodoro(session, settings, now)) {
    await chrome.storage.local.set({ session });
    await syncBadge();
    return;
  }

  if (session.pomodoroPhase === "break") {
    await chrome.storage.local.set({ session });
    await syncBadge();
    return;
  }

  const activeTab = await getActiveTab();
  const allowed = isAllowedStudyUrl(activeTab?.url, settings.allowedSites);

  if (allowed) {
    session.focusedMs += elapsedMs;
    await updateDailyStats({ focusedMsDelta: elapsedMs });
  } else {
    session.distractionMs += elapsedMs;
    await updateDailyStats({ distractionMsDelta: elapsedMs });
  }

  if (shouldSendBreakReminder(session, settings)) {
    session.breakReminderSentAt = Date.now();
    await maybeNotify(
      settings,
      "Time for a quick break",
      `You have been in focus mode for ${Math.round(session.focusedMs / 60000)} minutes.`
    );
    await appendEvent("warning", "Break reminder sent.");
  }

  await chrome.storage.local.set({ session });
  await syncBadge();
}

async function handleScheduleTick() {
  const { settings, session } = await chrome.storage.local.get(["settings", "session"]);
  if (!settings.scheduleEnabled || !getFirebaseAuthUser()) {
    return;
  }

  const withinWindow = isWithinSchedule(new Date(), settings);
  if (withinWindow && !session.active) {
    await startSession({ autoStarted: true });
    await reevaluateActiveTab();
    return;
  }
  if (!withinWindow && session.active && session.autoStarted) {
    await stopSession("Scheduled focus window ended automatically.");
  }
}

function advancePomodoro(session, settings, now) {
  const phaseMinutes = session.pomodoroPhase === "break"
    ? settings.pomodoroBreakMinutes
    : settings.pomodoroFocusMinutes;
  const phaseStartedAt = Number(session.pomodoroPhaseStartedAt || now);
  if (now - phaseStartedAt < phaseMinutes * 60000) {
    return false;
  }

  if (session.pomodoroPhase === "focus") {
    session.pomodoroPhase = "break";
    session.pomodoroPhaseStartedAt = now;
    session.lastTickAt = now;
    stopAlert().catch(() => undefined);
    clearAllOverlays().catch(() => undefined);
    maybeNotify(settings, "Pomodoro focus block complete", `Take a ${settings.pomodoroBreakMinutes}-minute reset.`).catch(() => undefined);
    appendEvent("success", "Pomodoro focus block complete. Break started.").catch(() => undefined);
    return true;
  }

  session.pomodoroPhase = "focus";
  session.pomodoroPhaseStartedAt = now;
  session.pomodoroCycle += 1;
  session.lastTickAt = now;
  maybeNotify(settings, "Back to focus", `Pomodoro cycle ${session.pomodoroCycle} is starting.`).catch(() => undefined);
  appendEvent("info", `Pomodoro break ended. Cycle ${session.pomodoroCycle} started.`).catch(() => undefined);
  reevaluateActiveTab().catch(() => undefined);
  return true;
}

async function skipPomodoroBreak() {
  const { settings, session } = await chrome.storage.local.get(["settings", "session"]);
  if (!session.active || session.pomodoroPhase !== "break") {
    throw new Error("There is no active Pomodoro break to skip.");
  }
  session.pomodoroPhase = "focus";
  session.pomodoroPhaseStartedAt = Date.now();
  session.lastTickAt = Date.now();
  session.pomodoroCycle += 1;
  await chrome.storage.local.set({ session });
  await appendEvent("info", `Pomodoro break skipped. Cycle ${session.pomodoroCycle} started.`);
  await maybeNotify(settings, "Back to focus", "Your next focus block has started.");
  await reevaluateActiveTab();
}

async function applyFocusPreset(presetId = "deep") {
  const preset = getPresetConfig(presetId);
  const { settings } = await chrome.storage.local.get("settings");
  const next = {
    ...settings,
    focusPreset: preset.id,
    pomodoroEnabled: preset.pomodoroEnabled,
    pomodoroFocusMinutes: preset.pomodoroFocusMinutes,
    pomodoroBreakMinutes: preset.pomodoroBreakMinutes,
    continueGraceSeconds: preset.continueGraceSeconds,
    breakReminderMinutes: preset.breakReminderMinutes,
    dailyGoalMinutes: preset.dailyGoalMinutes,
    strictMode: preset.strictMode,
    adaptiveShield: preset.adaptiveShield
  };
  await chrome.storage.local.set({ settings: next });
  await reevaluateActiveTab();
  await appendEvent("info", `${preset.label} preset activated — ${preset.description}`);
}

async function evaluateTab(tab, options = {}) {
  if (!tab || typeof tab.id !== "number") {
    return;
  }

  const { settings, session } = await chrome.storage.local.get(["settings", "session"]);
  if (!session.active) {
    if (settings.smartAutoStart && (await maybeAutoStartSession(tab, settings))) {
      return;
    }
    await sendToTab(tab.id, { type: "overlay:hide" });
    return;
  }

  if (session.paused) {
    await sendToTab(tab.id, { type: "overlay:hide" });
    return;
  }

  const now = Date.now();
  if (session.graceUntil && now < session.graceUntil) {
    await sendToTab(tab.id, { type: "overlay:hide" });
    return;
  }

  const allowed = isAllowedStudyUrl(tab.url, settings.allowedSites);
  if (allowed) {
    await sendToTab(tab.id, { type: "overlay:hide" });
    return;
  }

  const activeTab = await getActiveTab();
  if (!activeTab || activeTab.id !== tab.id) {
    return;
  }

  if (options.countViolation) {
    await recordViolation(tab.url, options.source || "unknown");
  }

  if (settings.popupEnabled) {
    await sendToTab(tab.id, {
      type: "overlay:show",
      payload: {
        host: normalizeHost(tab.url) || "this site",
        strictMode: settings.strictMode || (settings.adaptiveShield && session.violationCount >= 3),
        adaptiveLock: !settings.strictMode && settings.adaptiveShield && session.violationCount >= 3,
        graceSeconds: settings.continueGraceSeconds
      }
    });
  } else {
    await sendToTab(tab.id, { type: "overlay:hide" });
  }
}

async function recordViolation(url, source) {
  const { settings, session } = await chrome.storage.local.get(["settings", "session"]);
  const now = Date.now();
  if (session.graceUntil && now < session.graceUntil) {
    return;
  }

  const cooldownMs = (settings.violationCooldownSeconds || 25) * 1000;
  if (now - Number(session.lastViolationAt || 0) < cooldownMs) {
    return;
  }

  session.violationCount += 1;
  session.lastViolationAt = now;
  session.lastViolationUrl = url || "";
  await chrome.storage.local.set({ session });
  await updateDailyStats({ violationDelta: 1 });
  await maybeNotify(
    settings,
    "Study mode warning",
    `Distraction detected on ${normalizeHost(url) || "a blocked page"}.`
  );
  await appendEvent("warning", `Distraction detected from ${source}.`);

  // Alarm audio is reserved specifically for phone detection (see
  // recordPhoneDetection below) — site-blocking distractions still notify
  // and show the on-page overlay, just without the alarm sound.
  await syncBadge();
}

async function recordPhoneDetection(confidence) {
  const { settings, session, stats } = await chrome.storage.local.get(["settings", "session", "stats"]);
  const now = Date.now();

  const cooldownMs = (settings.violationCooldownSeconds || 25) * 1000;
  if (now - Number(session.lastPhoneDetectionAt || 0) < cooldownMs) {
    return;
  }

  const todayKey = getDateKey(now);
  const todayCountBefore = stats.daily?.[todayKey]?.phoneDetections || 0;
  const tolerance = Number.isFinite(settings.maxPhoneDetectionsPerDay) ? settings.maxPhoneDetectionsPerDay : 5;
  const withinTolerance = todayCountBefore < tolerance;

  session.lastPhoneDetectionAt = now;
  session.phoneDetections = (session.phoneDetections || 0) + 1;
  await chrome.storage.local.set({ session });
  await updateDailyStats({ phoneDetectionDelta: 1 });

  if (withinTolerance) {
    // Within your allowed daily amount — logged quietly, no alarm/overlay.
    // This is the "itni baar chale to koi baat nahi" allowance.
    await appendEvent(
      "info",
      `Phone seen briefly (${todayCountBefore + 1}/${tolerance} today) — within your allowed limit, no alert raised.`
    );
    await syncBadge();
    return;
  }

  await appendEvent(
    "warning",
    `Phone detected in camera view (confidence ${Math.round((confidence || 0) * 100)}%) — this is over today's allowed limit of ${tolerance}.`
  );
  await maybeNotify(
    settings,
    "Phone detected — over today's limit",
    `You've gone over your daily allowance of ${tolerance} phone check-ins. Put it away to stay focused.`
  );

  if (settings.audioEnabled) {
    await playAlert("phone-detected");
  }

  const activeTab = await getActiveTab();
  if (activeTab?.id) {
    await sendToTab(activeTab.id, {
      type: "overlay:show",
      payload: {
        reason: "phone",
        strictMode: Boolean(settings.strictMode),
        adaptiveLock: false,
        graceSeconds: settings.continueGraceSeconds || 90
      }
    });
  }

  await syncBadge();
}

async function clearPhoneOverlay() {
  const activeTab = await getActiveTab();
  if (activeTab?.id) {
    await sendToTab(activeTab.id, { type: "overlay:hide" });
  }
}

async function playAlert(reason) {
  const { settings } = await chrome.storage.local.get("settings");
  if (!settings.audioEnabled) {
    return;
  }

  await ensureOffscreenDocument();
  await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "audio:play",
    payload: { reason }
  });
}

async function stopAlert() {
  try {
    await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "audio:stop"
    });
  } catch (error) {
    return;
  }
}

async function ensureOffscreenDocument() {
  if (chrome.offscreen?.hasDocument) {
    const exists = await chrome.offscreen.hasDocument();
    if (exists) {
      return;
    }
  }

  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Play study session warning tones."
    });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (!text.includes("single offscreen document")) {
      throw error;
    }
  }
}

async function updateDailyStats({
  focusedMsDelta = 0,
  distractionMsDelta = 0,
  violationDelta = 0,
  phoneDetectionDelta = 0
}) {
  const { stats } = await chrome.storage.local.get("stats");
  const key = getDateKey();
  const current = {
    ...createDailyStat(),
    ...(stats.daily[key] || {})
  };

  current.focusedMs += focusedMsDelta;
  current.distractionMs += distractionMsDelta;
  current.violations += violationDelta;
  current.phoneDetections += phoneDetectionDelta;
  current.updatedAt = Date.now();
  stats.daily[key] = current;
  await chrome.storage.local.set({ stats });
}

async function appendEvent(level, message) {
  const { stats } = await chrome.storage.local.get("stats");
  const entry = {
    id: crypto.randomUUID(),
    level,
    message,
    timestamp: Date.now()
  };

  stats.recentEvents.unshift(entry);
  stats.recentEvents = stats.recentEvents.slice(0, 50);
  await chrome.storage.local.set({ stats });
}

async function maybeNotify(settings, title, message) {
  if (!settings.desktopNotifications) {
    return;
  }

  try {
    await chrome.notifications.create({
      type: "basic",
      iconUrl: "icon.png",
      title,
      message
    });
  } catch (error) {
    return;
  }
}

async function clearAllOverlays() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map((tab) => {
      if (typeof tab.id === "number") {
        return sendToTab(tab.id, { type: "overlay:hide" });
      }
      return Promise.resolve();
    })
  );
}

async function reevaluateActiveTab() {
  const tab = await getActiveTab();
  if (tab) {
    await evaluateTab(tab, { countViolation: false, source: "reevaluate" });
  }
}

async function syncBadge() {
  const { session } = await chrome.storage.local.get("session");
  let text = "OFF";
  let color = "#1c5b4f";

  if (session.active && session.paused) {
    text = "PAUSE";
    color = "#304a7c";
  } else if (session.active) {
    text = "ON";
    color = "#d4552d";
  }

  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
}

async function openMonitorPage() {
  const monitorUrl = chrome.runtime.getURL("monitor.html");
  const existing = await chrome.tabs.query({ url: monitorUrl });
  if (existing[0]?.id) {
    await chrome.tabs.update(existing[0].id, { active: true });
    if (existing[0].windowId) {
      await chrome.windows.update(existing[0].windowId, { focused: true, state: "normal" });
    }
    return;
  }

  await chrome.tabs.create({ url: monitorUrl });
}

// Opens (or re-focuses) the monitor as a small standalone window rather
// than a full browser tab, so it can sit alongside your other work and
// keep the camera detection loop alive even when minimized.
async function openMonitorWidget() {
  const monitorUrl = chrome.runtime.getURL("monitor.html");
  const existing = await chrome.tabs.query({ url: monitorUrl });
  if (existing[0]?.id) {
    if (existing[0].windowId) {
      await chrome.windows.update(existing[0].windowId, { focused: true, state: "normal" });
    }
    await chrome.tabs.update(existing[0].id, { active: true });
    return;
  }

  await chrome.windows.create({
    url: monitorUrl,
    type: "popup",
    width: 900,
    height: 720
  });
}

function shouldSendBreakReminder(session, settings) {
  if (!session.focusedMs || !settings.breakReminderMinutes) {
    return false;
  }

  const elapsedMinutes = Math.floor(session.focusedMs / 60000);
  if (elapsedMinutes < settings.breakReminderMinutes) {
    return false;
  }

  if (!session.breakReminderSentAt) {
    return true;
  }

  return Date.now() - session.breakReminderSentAt >= settings.breakReminderMinutes * 60000;
}

async function maybeAutoStartSession(tab, settings) {
  if (!tab?.url || !settings.smartAutoStart) {
    return false;
  }

  if (!isAllowedStudyUrl(tab.url, settings.allowedSites)) {
    return false;
  }

  if (settings.scheduleEnabled && !isWithinSchedule(new Date(), settings)) {
    return false;
  }

  await startSession({ autoStarted: true, preset: settings.focusPreset });
  return true;
}

function buildLiveSession(session, settings = DEFAULT_SETTINGS) {
  const now = Date.now();
  const pausedLiveMs =
    Number(session.totalPausedMs || 0) +
    (session.paused && session.pausedAt ? now - session.pausedAt : 0);
  const pomodoroDurationMs = session.pomodoroPhase === "break"
    ? settings.pomodoroBreakMinutes * 60000
    : settings.pomodoroFocusMinutes * 60000;

  return {
    ...session,
    elapsedMs: session.active && session.startedAt ? Math.max(0, now - session.startedAt - pausedLiveMs) : 0,
    graceRemainingSeconds: session.graceUntil ? Math.max(0, Math.ceil((session.graceUntil - now) / 1000)) : 0,
    pomodoroRemainingSeconds: session.active && session.pomodoroPhaseStartedAt
      ? Math.max(0, Math.ceil((pomodoroDurationMs - (now - session.pomodoroPhaseStartedAt)) / 1000))
      : 0
  };
}

function computeGoalProgress(focusedMs, goalMinutes) {
  return Math.max(0, Math.min(100, Math.round((focusedMs / (goalMinutes * 60000)) * 100)));
}

function buildInsights(payload) {
  const { today, settings, session, streak, focusScore } = payload;
  const focusMinutes = Math.round((today.focusedMs || 0) / 60000);
  const distractionMinutes = Math.round((today.distractionMs || 0) / 60000);
  const goalMinutes = Number(settings.dailyGoalMinutes || 120);
  const remaining = Math.max(0, goalMinutes - focusMinutes);
  const preset = getPresetConfig(settings.focusPreset || "deep");

  let title = "Daily momentum is building.";
  let detail = `You have logged ${focusMinutes} focused minutes today and are ${remaining} minutes from your goal.`;
  let tone = "info";
  let action = "Stay consistent and keep the session flowing.";

  if (!session.active) {
    if (focusMinutes >= goalMinutes) {
      title = "Goal unlocked.";
      detail = `You already hit ${goalMinutes} minutes today. Great job keeping your focus strong.`;
      tone = "success";
      action = "Take a short reset or continue with lighter review work.";
    } else if (remaining <= 30) {
      title = "You are close to your target.";
      detail = `A short focused block of ${Math.min(25, remaining)} minutes could finish the day strong.`;
      tone = "warning";
      action = "Launch a quick sprint and close the gap.";
    } else {
      title = "Ready for a fresh focus block.";
      detail = `Your ${preset.label.toLowerCase()} preset is ready to keep the day productive.`;
      tone = "info";
      action = "Start a session and let the smart shield guide you.";
    }
  } else if (session.paused) {
    title = "Session paused.";
    detail = `You have ${focusMinutes} focused minutes so far. Resume when you are ready to continue.`;
    tone = "warning";
    action = "Resume and pick up from where you left off.";
  } else if (session.graceRemainingSeconds > 0) {
    title = "Grace window active.";
    detail = `You have ${session.graceRemainingSeconds}s left to stay on the current page before the shield tightens.`;
    tone = "warning";
    action = "Use that time wisely or return to a study site.";
  } else if (distractionMinutes > 0) {
    title = "Distraction pressure detected.";
    detail = `You spent ${distractionMinutes} minutes off-task today. Return to your approved sites and recover momentum.`;
    tone = "warning";
    action = "Close the distraction and restart the next focus block.";
  } else {
    title = "Flow state is strong.";
    detail = `Your current focus score is ${focusScore}. Keep the streak alive and stay on plan.`;
    tone = "success";
    action = "Continue your current block and protect your streak.";
  }

  return {
    score: focusScore,
    streak,
    remainingMinutes: remaining,
    presetLabel: preset.label,
    title,
    detail,
    tone,
    action,
    focusMinutes,
    distractionMinutes
  };
}

function getPresetConfig(presetId = "deep") {
  const presets = {
    deep: {
      id: "deep",
      label: "Deep Focus",
      description: "Long, strict blocks for your hardest work.",
      pomodoroEnabled: true,
      pomodoroFocusMinutes: 45,
      pomodoroBreakMinutes: 10,
      continueGraceSeconds: 45,
      breakReminderMinutes: 50,
      dailyGoalMinutes: 150,
      strictMode: true,
      adaptiveShield: true
    },
    sprint: {
      id: "sprint",
      label: "Sprint",
      description: "Short, energetic bursts with quick breaks.",
      pomodoroEnabled: true,
      pomodoroFocusMinutes: 25,
      pomodoroBreakMinutes: 5,
      continueGraceSeconds: 60,
      breakReminderMinutes: 25,
      dailyGoalMinutes: 90,
      strictMode: false,
      adaptiveShield: true
    },
    review: {
      id: "review",
      label: "Review",
      description: "Relaxed, warning-only mode for light revision.",
      pomodoroEnabled: false,
      pomodoroFocusMinutes: 20,
      pomodoroBreakMinutes: 3,
      continueGraceSeconds: 120,
      breakReminderMinutes: 20,
      dailyGoalMinutes: 45,
      strictMode: false,
      adaptiveShield: false
    }
  };

  return presets[presetId] || presets.deep;
}

function computeFocusScore(day, goalMinutes, streak) {
  const goalRatio = Math.min(1.25, day.focusedMs / (goalMinutes * 60000));
  const base = Math.round(goalRatio * 80);
  const streakBonus = Math.min(12, streak * 2);
  const distractionPenalty = Math.min(28, Math.round(day.distractionMs / 60000));
  const violationPenalty = Math.min(24, day.violations * 4);
  return Math.max(0, Math.min(100, base + streakBonus - distractionPenalty - violationPenalty));
}

function isAllowedStudyUrl(url, allowedSites) {
  const host = normalizeHost(url);
  if (!host) {
    return true;
  }

  return (allowedSites || []).some((site) => {
    const normalized = normalizeHost(site);
    return host === normalized || host.endsWith(`.${normalized}`);
  });
}

function normalizeHost(input) {
  if (!input) {
    return "";
  }

  try {
    const candidate = input.includes("://") ? input : `https://${input}`;
    return new URL(candidate).hostname.replace(/^www\./, "").trim().toLowerCase();
  } catch (error) {
    return String(input)
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0]
      .trim()
      .toLowerCase();
  }
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeTodos(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.map((item) => {
    const durationMinutes = clampNumber(item.durationMinutes, 1, 480, 25);
    const remainingSeconds = Number.isFinite(Number(item.remainingSeconds))
      ? Math.max(0, Math.min(durationMinutes * 60, Math.round(Number(item.remainingSeconds))))
      : durationMinutes * 60;
    const timerState = ["idle", "running", "paused", "complete"].includes(item.timerState)
      ? item.timerState
      : "idle";

    return {
      id: item.id || crypto.randomUUID(),
      text: cleanText(item.text) || "Untitled task",
      done: Boolean(item.done),
      durationMinutes,
      remainingSeconds,
      timerState: item.done ? "paused" : timerState,
      timerStartedAt: timerState === "running" ? Number(item.timerStartedAt || Date.now()) : null,
      createdAt: Number(item.createdAt || Date.now()),
      updatedAt: item.updatedAt || null,
      completedAt: item.completedAt || null
    };
  });
}

function getTodoRemainingSeconds(todo) {
  const base = Math.max(0, Number(todo.remainingSeconds || 0));
  if (todo.timerState !== "running" || !todo.timerStartedAt) {
    return base;
  }
  const elapsed = Math.floor((Date.now() - Number(todo.timerStartedAt)) / 1000);
  return Math.max(0, base - elapsed);
}

function uniqueHosts(items) {
  return [...new Set((items || []).map((item) => normalizeHost(item)).filter(Boolean))];
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

function normalizeTime(value, fallback) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ""));
  if (!match) {
    return fallback;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 ? `${match[1]}:${match[2]}` : fallback;
}

function isWithinSchedule(now, settings) {
  const days = Array.isArray(settings.scheduleDays) ? settings.scheduleDays : [];
  if (!days.includes(now.getDay())) {
    return false;
  }
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [startHours, startMinutes] = normalizeTime(settings.scheduleStart, "00:00").split(":").map(Number);
  const [endHours, endMinutes] = normalizeTime(settings.scheduleEnd, "00:00").split(":").map(Number);
  const start = startHours * 60 + startMinutes;
  const end = endHours * 60 + endMinutes;
  if (start === end) {
    return false;
  }
  return start < end
    ? currentMinutes >= start && currentMinutes < end
    : currentMinutes >= start || currentMinutes < end;
}

function createDailyStat() {
  return {
    focusedMs: 0,
    distractionMs: 0,
    violations: 0,
    phoneDetections: 0,
    updatedAt: 0
  };
}

function getDateKey(timestamp = Date.now()) {
  return localDateKey(new Date(timestamp));
}

// toISOString() always uses UTC, which silently shifts "today"'s bucket for
// anyone not in UTC (e.g. IST is +5:30 — the first 5.5 hours of the local
// day were being logged under yesterday's key). This builds the key from
// the date's local calendar fields instead, so "today" always matches what
// the clock on the wall says.
function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function computeStreak(daily, goalMinutes) {
  let streak = 0;
  const cursor = new Date();

  while (true) {
    const key = localDateKey(cursor);
    const day = daily[key];
    if (!day || day.focusedMs < goalMinutes * 60000) {
      break;
    }
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

function buildWeeklySeries(daily) {
  const result = [];
  for (let index = 6; index >= 0; index -= 1) {
    const cursor = new Date();
    cursor.setDate(cursor.getDate() - index);
    const key = localDateKey(cursor);
    const value = {
      ...createDailyStat(),
      ...(daily[key] || {})
    };
    result.push({
      key,
      label: cursor.toLocaleDateString(undefined, { weekday: "short" }),
      focusedMinutes: Math.round(value.focusedMs / 60000),
      distractionMinutes: Math.round(value.distractionMs / 60000),
      violations: value.violations
    });
  }
  return result;
}

function buildHeatmap(daily, goalMinutes) {
  const cells = [];
  for (let index = 29; index >= 0; index -= 1) {
    const cursor = new Date();
    cursor.setDate(cursor.getDate() - index);
    const key = localDateKey(cursor);
    const value = {
      ...createDailyStat(),
      ...(daily[key] || {})
    };
    const ratio = goalMinutes ? value.focusedMs / (goalMinutes * 60000) : 0;
    let level = 0;
    if (ratio >= 1) {
      level = 4;
    } else if (ratio >= 0.75) {
      level = 3;
    } else if (ratio >= 0.4) {
      level = 2;
    } else if (ratio > 0) {
      level = 1;
    }

    cells.push({
      key,
      label: cursor.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      focusedMinutes: Math.round(value.focusedMs / 60000),
      level
    });
  }
  return cells;
}

// Firebase Auth remains the source of truth for identity.
// Local storage is used only for cached profile data and extension settings/session state.
async function syncAuthStateFromFirebaseUser(user) {
  if (!firestoreDb) {
    const { auth } = await chrome.storage.local.get("auth");
    auth.cachedProfile = null;
    auth.lastSyncedAt = Date.now();
    await chrome.storage.local.set({ auth });
    return;
  }

  try {
    if (!user) {
      const { auth } = await chrome.storage.local.get("auth");
      auth.cachedProfile = null;
      auth.lastSyncedAt = Date.now();
      await chrome.storage.local.set({ auth });
      return;
    }

    const profile = await ensureFirebaseProfile(user, {});
    const { auth } = await chrome.storage.local.get("auth");
    auth.cachedProfile = profile;
    auth.lastSyncedAt = Date.now();
    await chrome.storage.local.set({ auth });
    await syncBadge();
  } catch (error) {
    console.error("Failed to sync Firebase auth state:", error);
  }
}

// Wraps ensureFirebaseProfile so a Firestore permission/rules problem (e.g.
// firestore.rules was never deployed — see README Step 7) can NEVER turn an
// otherwise-successful sign-in into a scary "login failed" error. Firebase
// Auth's own session is independent of Firestore; if the profile write
// fails, we log it and fall back to building the profile from the auth
// user object directly (name/email/photo are already available there for
// Google sign-in) instead of blocking the whole login.
async function safeEnsureFirebaseProfile(user, patch = {}) {
  try {
    return await ensureFirebaseProfile(user, patch);
  } catch (error) {
    console.error("[StudyPhoneDetector] Firestore profile sync failed (auth itself still succeeded):", error);
    await appendEvent(
      "warning",
      "Signed in, but couldn't save your profile to Firestore — check that firestore.rules is deployed (README Step 7)."
    );
    return {
      id: patch.id || user?.uid || crypto.randomUUID(),
      provider: patch.provider || "firebase",
      name: patch.name || user?.displayName || "",
      email: patch.email || user?.email || "",
      dob: patch.dob || "",
      photoUrl: patch.photoUrl || user?.photoURL || "",
      createdAt: Date.now(),
      lastLoginAt: Date.now()
    };
  }
}

async function ensureFirebaseProfile(user, patch = {}) {
  if (!firestoreDb || !user?.uid) {
    return {
      id: patch.id || user?.uid || crypto.randomUUID(),
      provider: patch.provider || "firebase",
      name: patch.name || user?.displayName || "",
      email: patch.email || user?.email || "",
      dob: patch.dob || "",
      createdAt: Date.now(),
      lastLoginAt: Date.now()
    };
  }

  const ref = firestoreDb.collection("users").doc(user.uid);
  const snapshot = await ref.get();
  const profile = {
    id: user.uid,
    uid: user.uid,
    provider: patch.provider || snapshot.data()?.provider || (user.providerData?.[0]?.providerId || "firebase"),
    name: patch.name || snapshot.data()?.name || user.displayName || "",
    email: patch.email || snapshot.data()?.email || user.email || "",
    dob: patch.dob || snapshot.data()?.dob || "",
    photoUrl: patch.photoUrl || snapshot.data()?.photoUrl || user.photoURL || "",
    createdAt: snapshot.data()?.createdAt || Date.now(),
    lastLoginAt: Date.now()
  };

  await ref.set(profile, { merge: true });
  return profile;
}

function mapAuthError(error) {
  const code = error?.code || "";
  switch (code) {
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/user-not-found":
      return "No account found for this email.";
    case "auth/wrong-password":
      return "Incorrect password. Please try again.";
    case "auth/email-already-in-use":
      return "An account with this email already exists.";
    case "auth/weak-password":
      return "Password should be at least 6 characters long.";
    case "auth/network-request-failed":
      return "Network error. Please check your connection and try again.";
    case "auth/popup-closed-by-user":
      return "Google sign-in popup was closed. Please try again.";
    case "auth/popup-blocked":
      return "Pop-up was blocked. Please allow pop-ups and try again.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a moment and try again.";
    case "auth/unavailable":
      return "Firebase Auth is temporarily unavailable. Please try again shortly.";
    default:
      return error?.message || "Authentication failed. Please try again.";
  }
}

function buildCurrentUserView(firebaseUser, cachedProfile = null) {
  if (!firebaseUser) {
    return null;
  }

  const profile = cachedProfile || {};
  return {
    id: firebaseUser.uid,
    uid: firebaseUser.uid,
    provider: profile.provider || firebaseUser.providerData?.[0]?.providerId || "firebase",
    name: profile.name || firebaseUser.displayName || "",
    email: profile.email || firebaseUser.email || "",
    dob: profile.dob || "",
    photoUrl: profile.photoUrl || firebaseUser.photoURL || "",
    createdAt: profile.createdAt || Date.now(),
    lastLoginAt: profile.lastLoginAt || Date.now()
  };
}

function getFirebaseAuthUser() {
  return firebaseAuth?.currentUser || null;
}

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs[0] || null;
}

async function safeGetTab(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch (error) {
    return null;
  }
}

async function sendToTab(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    return;
  }
}
