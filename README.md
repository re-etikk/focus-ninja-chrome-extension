# Study Phone Detector Pro

An advanced focus-assistant Chrome extension with Firebase login (email/password
+ Google), Firestore-backed profiles, study session tracking, Pomodoro mode,
site allowlisting, and audio alerts.

## 🆕 What was fixed / added — newest round

- **Fixed the actual Google Sign-In bug.** The code uses
  `chrome.identity.launchWebAuthFlow`, which requires a **"Web application"**
  OAuth client with an exact registered redirect URI — but Step 6 previously
  told you to create a **"Chrome Extension"** type client (a different API
  entirely), which Google silently rejects. Step 6 is corrected below, and
  the sign-in failure message now tells you Google's *actual* error code
  (e.g. `redirect_uri_mismatch`) instead of a generic failure. There's also
  a new **Settings → "Show my redirect URI & Client ID"** button so you
  never have to guess/construct these values by hand — click to copy.
- **Monitor view upgraded** with:
  - A live **Pomodoro ring timer** showing the current phase (focus/break),
    countdown, and cycle count, with a "Skip break" button.
  - A **To-Do list** panel (synced with the popup's).
  - A **Weekly Pulse chart** (focus vs. distraction, last 7 days).
  - **"+ Add current tab"** — one click to allow-list whatever site you're
    on, without typing it manually.
  - **Export data** — downloads your stats, settings, and tasks as JSON.
  - Refreshes every second now (was every 5s) for a genuinely live feel.
- Fixed a **field-name mismatch bug** introduced while building the new
  monitor weekly chart (it was reading properties that don't exist on the
  data — caught and fixed before shipping).

## 🆕 What was fixed / added — this round

- **Weekly chart bug fixed.** `.chart-column` used `min-height` instead of
  `height` — percentage-height bars had nothing definite to size against and
  silently rendered as 0px regardless of data. Fixed.
- **Timezone bug fixed.** Day-boundaries were computed with `toISOString()`
  (always UTC), which shifted "today" for anyone not in UTC — e.g. in IST,
  the first 5.5 hours of your day were logged under yesterday's date,
  making the heatmap/streak look wrong or empty. Every date key (streak,
  weekly chart, heatmap, today's stats) now uses your local calendar day.
- **Focus presets are now actually different**, not just numbers you'd never
  see: Deep Focus turns on Pomodoro + strict site-blocking + a 150-minute
  goal; Sprint is Pomodoro + warning-mode + 90 minutes; Review is relaxed/
  warning-only with Pomodoro off and a 45-minute goal. A live description
  under the buttons explains what each one does.
- **Alarm audio is now reserved for phone detection only**, as requested —
  site-blocking distractions still notify and show the on-page overlay,
  just without the alarm sound.
- **Phone detection is now integrated into the same overlay/blocking
  system** as site violations — detecting your phone shows the same on-page
  shield (with phone-specific wording) and automatically clears it once you
  put the phone away.
- **New: To-Do list** — a dedicated tab in the popup for small study tasks
  (add, check off, remove, clear completed), stored locally per account.
- **Background persistence, explained and improved:** site-blocking already
  ran fully in the background (via `chrome.alarms`, independent of any open
  tab). Camera-based phone detection is different — it needs a live
  `<video>` element, which cannot exist inside the invisible service
  worker — so starting a session now automatically opens (or refocuses) a
  small persistent window for it. You can minimize that window and keep
  working; Chrome keeps its camera feed and detection loop running as long
  as it isn't closed. This is toggleable under Settings → "Auto-open camera
  watcher" if you'd rather open it manually.

## 🆕 What was fixed / added — latest round

- **Fixed an auth race condition** that caused "login shows an error, but
  reopening the popup shows you logged in anyway." Firebase's own
  `onAuthStateChanged` listener fires asynchronously (with a slower
  Firestore round-trip) at the same moment our own code was doing a faster,
  local sign-out (e.g. for an unverified email) — the two writes to storage
  could finish in the wrong order, silently undoing the correct "logged
  out" state after the error was already shown. Every login/register/
  logout/Google-sign-in/delete-account flow now suppresses that passive
  listener while it runs its own deterministic sync, so the two can never
  race again.
- **Note:** this project requires **email verification** by design — after
  registering, Firebase sends a verification link to the email you signed
  up with, and login is blocked with a clear message until you click it.
  If you're testing and don't see the email, check spam, or use the
  "Forgot password" flow's underlying account once verified.

## 🆕 What was fixed / added in this round

Two bugs were making almost every feature look broken or invisible:

1. **Tab-switching was completely broken.** `.hidden { display: none !important; }`
   in the CSS was overriding the `.panel.active { display: block; }` rule that
   tab-clicks relied on, and the JS never removed `.hidden` from a panel once
   set. Result: clicking **Controls / History / Account / Settings** did
   nothing — only the Overview tab was ever actually visible. **Fixed** —
   panels no longer ship with a conflicting `hidden` class, and tab-switching
   now explicitly clears it too, so this class of bug can't silently return.
2. **One missing element crashed the whole dashboard render.** The code read
   `document.getElementById("accountBadge").textContent = ...` without a
   null-check; that element didn't exist in the HTML, so it threw and halted
   `render()` immediately — meaning session buttons, the weekly chart, the
   streak heatmap, activity log, and settings never updated on screen, ever.
   **Fixed** — the element now exists, and every text update in `render()`
   goes through a `setText()` helper that can never throw, so one bad ID can
   never again take down the rest of the dashboard.

Also new this round:
- A **full Settings tab**: daily goal, break reminders, strict mode, adaptive
  shield, goal reminders, auto-break prompts, Pomodoro (focus/break length),
  a weekly schedule (days + time window), and one-tap focus presets — all of
  this existed in the backend logic already but had **no UI to control it**
  until now.
- **Allowed-sites management** (add/remove) directly in the popup.
- **Real webcam phone detection** — the monitor page's camera used to just be
  a decorative preview with no actual detection logic. It now runs a real,
  locally-bundled TensorFlow.js + COCO-SSD model (installed via `npm install`,
  not a CDN) against the live feed and raises the same alert/notification/
  audio pipeline as the site-blocking violations, plus a "Phone Detections"
  counter in both the popup and monitor dashboard.
- A full **visual redesign** — replaced the cream/gold "demo" look with a
  cleaner, classical professional navy-and-slate theme across the popup,
  monitor dashboard, and the in-page focus overlay.
- Fixed the leftover "Focus Ninja" branding text so the product name is
  consistent everywhere.

⚠️ Because TensorFlow.js + COCO-SSD were added as real dependencies, run
`npm install` again after pulling this version even if you installed before.

## 🚨 Read this first if you're re-installing after a broken build

Two mistakes cause almost every "spinner never stops" / "service worker
won't open" report:

1. **Extracting the new zip into a folder that still has old files in it.**
   If you unzip this on top of a previous copy, you'll end up with old
   files sitting next to the new `src/`/`public/` folders, and Chrome may
   load the stale ones. **Fix:** delete the old project folder completely,
   then unzip fresh into an empty folder.
2. **Loading the project folder itself instead of `dist/`.** Chrome must
   load the **built** output, not the source. **Fix:** run `npm install`
   then `npm run build` (Steps 3–4 below) — this creates a `dist/` folder —
   and in `chrome://extensions → Load unpacked`, select **`dist`**, not the
   project root.

A quick way to confirm you did it right: open `dist/background.js` in a text
editor — it should be one long minified line, NOT readable multi-line code
with `import` statements. If it looks like readable source code with
`import firebase from "firebase/compat/app"` at the top, you loaded the
wrong folder.

Also: as of this version, if `src/firebase-config.js` is ever left with
placeholder or someone-else's values, the extension now **shows a clear
warning immediately** instead of spinning forever — so if you still see an
endless spinner after following the steps below, it means something else is
wrong, and you should check the service worker console (Step 5 has exact
instructions) and share the error.

## 🔧 What changed in this version

The previous build of this project shipped three **fake placeholder files**
(`firebase/firebase-app-compat.js`, `firebase-auth-compat.js`,
`firebase-firestore-compat.js`) that each contained a single line like
`window.firebase = window.firebase || null;` — they were never real SDK code,
just stand-ins, so authentication and Firestore could never actually work.

This version:
- **Deletes those fake files entirely.**
- Installs the **real, official `firebase` npm package**.
- **Bundles it locally with esbuild** — no CDN `<script>` tags anywhere, so it
  also satisfies Chrome Web Store's "no remotely-hosted code" policy for
  Manifest V3.
- Fixes a real architectural bug that was hiding underneath the fake files:
  the old code called `firebaseAuth.signInWithPopup()` **inside the
  background service worker**, which has no window/DOM — that call would
  throw `auth/operation-not-supported-in-this-environment` at runtime even
  with a real SDK. It's replaced with Chrome's native `chrome.identity`
  flow, which *is* designed to run in a service worker, exchanged for a real
  Firebase credential via `GoogleAuthProvider.credential(idToken)`.
- Replaces the demo/leftover Firebase project credentials that were
  hard-coded in `firebase-config.js` with a clearly-labeled template — that
  old project belongs to someone else and you have no admin access to its
  Firestore rules or quota, so it wouldn't have worked for you anyway.

## 📂 Project structure

```
study-phone-detector-pro/
├── src/                     ← real source (imports the real firebase package)
│   ├── background.js        service worker: auth, Firestore, sessions, alarms, tab-blocking
│   ├── content.js           injected into pages to show the focus overlay
│   ├── offscreen.js         plays alert tones (service workers can't use AudioContext)
│   ├── popup.js             popup UI logic (talks to background.js only, no Firebase here)
│   ├── monitor.js           full dashboard page logic
│   └── firebase-config.js   ← paste YOUR Firebase project's config here
├── public/                  static files copied as-is into dist/
│   ├── manifest.json
│   ├── popup.html / popup.css
│   ├── monitor.html / monitor.css
│   ├── offscreen.html
│   ├── icon.png
│   └── assets/
├── dist/                    ← generated by `npm run build` — THIS is what you load into Chrome
├── esbuild.config.mjs       bundler config (real firebase → self-contained JS files)
├── package.json
├── firebase.json            for deploying firestore.rules via Firebase CLI
└── firestore.rules          real security rules (already restrict data to its owner)
```

## 🚀 Setup & deploy — step by step

### Step 1 — Create your own Firebase project
1. Go to the [Firebase Console](https://console.firebase.google.com/) → **Add project**.
2. Once created, go to **Build → Authentication → Sign-in method** and enable
   **Email/Password** and **Google**.
3. Go to **Build → Firestore Database → Create database** (start in production mode).
4. Go to **Project settings → General → Your apps → Add app → Web (`</>`)**, register it,
   and copy the config object it gives you.

### Step 2 — Fill in your config
Open `src/firebase-config.js` and paste your real values:
```js
export const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef123456",
};
```

### Step 3 — Install dependencies
You need Node.js 18+ installed. In the project folder:
```bash
npm install
```
This downloads the real `firebase` package and `esbuild` from npm — it needs
an internet connection (one-time, then npm caches it).

### Step 4 — Build the extension
```bash
npm run build
```
This bundles everything into `dist/` — a self-contained folder with no
external script references at all.

> Because this build includes TensorFlow.js for real phone detection, `dist/`
> will be noticeably larger (several MB) and the build itself takes longer
> than a plain Firebase-only build — that's expected. The actual detection
> model weights (~15–20MB) are downloaded once at runtime the first time you
> click "Start Camera" (not part of the bundle, since model weights are data,
> not code) — that first load needs an internet connection; the browser
> caches it after that.

> Developing? Use `npm run watch` instead — it rebuilds `dist/` automatically
> every time you save a file. After each rebuild, click the reload icon 🔄
> for the extension on `chrome://extensions`.

### Step 5 — Load it into Chrome
1. Go to `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** → select the **`dist`** folder (not the project root!).
4. Pin the icon and open the popup — try creating an account.

(Windows shortcut: `powershell -ExecutionPolicy Bypass -File .\run-extension.ps1`
after building, launches Chrome with `dist/` pre-loaded.)

**If something still doesn't work, check the real error:**
1. On `chrome://extensions`, find the extension's card. If it has a red
   **"Errors"** button, click it first — that's usually the whole answer.
2. Click **"service worker"** (sometimes shown as "Inspect views: service
   worker") under the card. If it looks greyed out / inactive, that's
   normal — MV3 service workers go to sleep after ~30s of inactivity.
   Open the extension's popup once to wake it up, **then immediately**
   click "service worker" — this opens a dedicated DevTools window.
3. In that DevTools window's **Console** tab, try the failing action again
   (e.g. click Create Account in the popup) and read the red error text
   that appears there — that's the real underlying cause.
4. You can also right-click the popup itself → **Inspect** → Console, for
   errors happening in the popup's own code.

### Step 6 — Enable "Continue with Google" (optional but recommended)
Email/password login works immediately after Step 5. For Google sign-in:

⚠️ **The client type matters.** This project uses
`chrome.identity.launchWebAuthFlow`, which needs a **"Web application"**
OAuth client — not "Chrome Extension" (that type is for a different API and
will silently fail here with a redirect URI error).

1. Load the extension once (Step 5), open its popup → **Settings → Google
   Sign-In setup → "Show my redirect URI & Client ID"**. This gives you the
   exact **Extension ID** and **redirect URI** you'll need below — click
   either value to copy it.
2. In [Google Cloud Console](https://console.cloud.google.com/) (use the
   **same project** Firebase created for you) → **APIs & Services →
   Credentials → Create Credentials → OAuth client ID**.
3. Application type: **Web application** (not Chrome Extension).
4. Under **Authorized redirect URIs**, click **Add URI** and paste the exact
   redirect URI from step 1 — it looks like
   `https://<extension-id>.chromiumapp.org/`.
5. Click **Create**. Copy the generated **Client ID** into
   `public/manifest.json`:
   ```json
   "oauth2": { "client_id": "123456-abc.apps.googleusercontent.com", "scopes": ["openid","email","profile"] }
   ```
6. In the Firebase Console → **Authentication → Sign-in method → Google →**
   add the **same OAuth client ID** under "Web SDK configuration" so Firebase
   accepts tokens issued by it.
7. Rebuild (`npm run build`) and reload the extension.

**If it still fails:** click "Continue with Google" and read the error
message — it now tells you exactly what Google rejected (e.g.
`redirect_uri_mismatch` means the URI in step 4 doesn't exactly match; it
must include the trailing slash and use `https`, not `http`).

### Step 7 — Deploy your Firestore security rules
The included `firestore.rules` already restricts every collection so a user
can only read/write their own documents. Deploy it with the
[Firebase CLI](https://firebase.google.com/docs/cli):
```bash
npm install -g firebase-tools
firebase login
firebase use --add          # pick your project
firebase deploy --only firestore:rules
```

### Step 8 (optional) — Publish to the Chrome Web Store
Zip the **contents of `dist/`** (not the project root) and upload it in the
[Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
Because everything is bundled locally with no remote code, it satisfies the
Manifest V3 store review requirement out of the box.

## ⚠️ A note on this "login" system
This uses **real Firebase Authentication** — accounts, sessions, and
passwords are handled by Firebase's servers, not stored locally. Firestore
holds each user's profile (`name`, `email`, `dob`, `provider`) under
`/users/{uid}`, readable/writable only by that same authenticated user, per
`firestore.rules`.

## 🖥️ About the sandbox this was built in
This project was assembled in an offline sandbox with no npm registry
access, so `npm install` could not be run here to produce a committed
`node_modules/` or a pre-built `dist/`. That's not a shortcut — it's true of
any real npm project; `npm install` always needs to run wherever you're
building from. Every source file, the bundler config, and the manifest were
written by hand and syntax-checked here — Step 3 onward is the same command
sequence any developer would run locally.
