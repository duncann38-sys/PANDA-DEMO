# Panda — Complete System Handover

**Last updated:** 16 August 2026
**Owner:** Duncan Nyanzi, Founder & CEO — duncan@pandaindustry.co
**Company:** Panda Tech Industries Ltd (Company No. 15572716) — pandaindustry.co

---

## 0. How to read this document

This is a full plain-English + technical handover for the Panda system. It's written so that **both a non-technical founder and a developer** can follow it. It leaves nothing out.

- If you're a **developer**, sections 3–11 and 15–16 are your build/deploy reference.
- If you're **Duncan / non-technical**, read sections 1–2 first (the big picture), then dip into the rest.
- **Security note:** this document lists variable *names*, URLs, and non-secret IDs (like Stripe Price IDs). It deliberately **does not** contain any secret keys (Stripe secret key, webhook secret, GitHub token, Firebase private key). Those live only inside Vercel's environment variables and must never be committed to any repo or pasted into chats.

---

## 1. What Panda is (the big picture)

Panda has **two connected products**:

1. **A consumer app** — a mobile web app (PWA) that helps 18–30-year-olds find the best places to eat, drink and go out, anywhere in the world, and (roadmap) spend on a controlled, hospitality-only credit line. It is live and in use across several countries.

2. **A B2B partner system** — a self-serve website where venues (restaurants, bars) pay a monthly subscription to be **promoted** ("sponsored") inside the consumer app. This is the near-term, high-margin revenue line.

**One-line positioning (always use this):**
> "Panda is creating a responsible credit and payments layer for hospitality, beginning with controlled, hospitality-only credit for younger consumers."

**Rules of language:** Always describe Panda as a **fintech first**. Never use the term "BNPL". "Banging" is a product/section name (see §7), never a badge.

---

## 2. The system in one picture (plain English)

Think of it as a few simple parts talking to each other:

- **The app** (what users see) reads venues **live from Google**, and reads a small **"notepad"** file that says which venues are sponsored.
- **The portal** (what venues use) lets a venue sign up and pay through **Stripe**.
- When a venue pays, **Stripe tells a small backend** ("webhook"), which **writes that venue into the notepad**. The app then shows them promoted. When they cancel, the webhook removes them.
- Separately, whenever a sponsored venue is **seen / tapped / acted on** in the app, the app sends an **event** to the backend, which stores it in a database (**Firestore**). The portal dashboard reads those events back to show the venue real results.

So there are three "brains":
- **Google** = provides the actual venue content (names, photos, hours, distance).
- **Stripe** = handles the money (subscriptions, the 7-day free trial, cards).
- **Firestore** = stores analytics events (who saw/opened/acted).

And two small "glue" files:
- **`sponsored.json`** = the notepad of who's sponsored (name + tier only).
- The **webhook** = the automatic pen that writes to the notepad when money moves.

---

## 3. Repositories & hosting map

There are **three** separate codebases, each hosted differently. Keeping them straight is important.

| Name | Type | Hosted on | Live URL | What it holds |
|---|---|---|---|---|
| **PANDA-DEMO** | Public repo | **GitHub Pages** (static files) | `https://duncann38-sys.github.io/PANDA-DEMO/` | The consumer app + the partner portal + the sponsored "notepad" + icons |
| **panda-partners-api** | Private repo | **Vercel** (serverless functions) | `https://panda-partners-api.vercel.app` | The backend: Stripe checkout, billing portal, webhook, analytics track/read |
| **panda-ai-proxy** | Private repo (pre-existing) | **Vercel** | `https://panda-ai-proxy.vercel.app/api/panda-ai` | Proxies Google Places (venue search) + Panda AI (Gemini/Vertex). Holds the Google keys server-side. |

**Key rule:** GitHub Pages can only serve **static files** (HTML/JS/JSON/images). It **cannot** run server code or hold secret keys. That's why the backend (which needs Stripe's secret key) lives on **Vercel**, not GitHub Pages.

### PANDA-DEMO file list
```
index.html                 ← the consumer app (single-file vanilla JS PWA)
partner-portal.html        ← the partner portal (single-file)
sponsored.json             ← the "notepad" of sponsored venues
manifest.json              ← PWA manifest (install metadata)
sw.js                      ← service worker (app-shell caching, offline install)
venues.json                ← optional venue data file (written by a GitHub Action)
icon-192.png               ← PWA icons
icon-512.png
icon-512-maskable.png
apple-touch-icon.png
scripts/fetch-data.js      ← data-fetch script for the GitHub Action
.github/workflows/         ← GitHub Action that refreshes venues.json daily
```

### panda-partners-api file list
```
api/create-checkout-session.js   ← creates a Stripe Checkout (subscription + 7-day trial)
api/create-portal-session.js     ← opens the Stripe billing portal for a venue
api/stripe-webhook.js            ← receives Stripe events → writes sponsored.json
api/track.js                     ← receives analytics events → writes to Firestore
api/analytics.js                 ← reads Firestore → returns a venue's numbers
package.json                     ← dependencies: stripe ^16, firebase-admin ^12
README.md                        ← setup notes
```

---

## 4. Third-party services & accounts

| Service | Used for | Plan/notes |
|---|---|---|
| **GitHub** (`duncann38-sys`) | Source code + GitHub Pages hosting for PANDA-DEMO | Free |
| **Vercel** (`duncann38-sys`, Hobby) | Hosts the two serverless backends | Hobby (free) tier |
| **Stripe** ("Panda Tech") | Subscriptions, 7-day trial, cards, billing portal | Currently in **Test mode**. Switch to Live for real money. |
| **Firebase / Cloud Firestore** (project `panda-partners`) | Analytics events database | **Spark (free)** plan. Firestore DB in region `eur3` (Europe), production mode. |
| **Google Cloud** (project `applied-range-505314-h7`) | Places API (venue data) + Vertex AI / Gemini (Panda AI) | **Billing ~£173 outstanding → currently throttled.** This blocks live app data + AI. |
| **BigDataCloud** | Reverse-geocoding (turns GPS into a city name in the app) | Free client-side endpoint |

**Google service account used by the proxy:** `panda-ai@applied-range-505314-h7.iam.gserviceaccount.com` (lives in the panda-ai-proxy Vercel project).
**Firebase service account used by the backend:** `firebase-adminsdk-…@panda-partners.iam.gserviceaccount.com` (its JSON key is pasted into the `FIREBASE_SERVICE_ACCOUNT` env var on panda-partners-api).

---

## 5. The consumer app (`index.html`)

A **single-file, no-build, vanilla-JavaScript Progressive Web App** hosted on GitHub Pages. Everything (HTML, CSS, JS) is in one file, edited via the GitHub web UI. GitHub Pages is the source of truth; you update by replacing the whole file.

### 5.1 Core features built
- **PWA install** — `manifest.json` + `sw.js` + icons make it installable full-screen with no browser chrome.
- **Login screen** (Google / Apple buttons — **demo mode**, not real OAuth yet) + a "dancing panda" welcome animation; login persists via localStorage.
- **Settings sheet** + "Share Panda on WhatsApp".
- **Panda Credit screen** — a virtual card visual with a Mastercard mark; CTA "Join the waiting list".
- **City auto-detection** — uses the browser's GPS + BigDataCloud reverse-geocode to show "Welcome back · <city>". (Previously hardcoded "London" — now dynamic worldwide.)
- **Venue discovery** — pulls real venues from Google Places via the `panda-ai-proxy` (`venuesOnly` mode), with a **ring-widening search** (expands the radius outward up to ~4.8km until enough venues are found).
- **Panda AI concierge** — a Gemini/Vertex-powered chat (via the proxy). The system prompt is cheeky/budget/vibe-aware/worldwide and injects the user's **city, name, and saved spots** for personalization.
- **Photo performance** — list thumbnails request small (160px) images; full images load on the detail view; fade-in.
- **Filters** — price ("Any price") and sort ("Nearest first" / "Top rated").
- **Suggestions feed** — the main discovery list.
- **"Banging" trending row** — a curated "what's hot" row, pulled from Google by popularity (rating × review count). **"Banging" is the section name and the paid tier name — it is not a badge.**
- **Panda Shuffle** ("Plan my night/lunch") — auto-builds an itinerary of stops with walk-times and a routed map.

### 5.2 The sponsored system (how paid venues get promoted)

**Config constants (top of the script):**
```js
const SPONSORED_URL     = "./sponsored.json";  // the notepad
const SPONSORED_TTL_MIN = 8;                   // cache the notepad for 8 minutes
const SPONSOR_REACH_M   = 3000;                // sponsored shown to anyone within ~3km (≈40 min walk)
const ANALYTICS_ENDPOINT = "https://panda-partners-api.vercel.app/api/track";
```

**How it works, step by step:**
1. `loadSponsored()` fetches `sponsored.json` on load and caches it in `localStorage` under `panda_sponsored_cache` for 8 minutes. This keeps read volume tiny (≈1 read per app open) so it scales to thousands of venues cheaply.
2. `applySponsored(data)` builds two lookup maps: by `place_id` and by lowercase `name`.
3. `sponsorTier(v)` returns `"banging"`, `"discovery"`, or `null` for a venue, matching by place_id **or** exact name.
4. `sponsorEligible(v)` returns the tier **only if** the venue is within `SPONSOR_REACH_M` (3km). This is the "widen the catchment but cap it" rule — a sponsored venue reaches anyone within ~40 min walk, not just the nearest few, but not the whole city.
5. **Suggestions feed:** `interleaveSponsored(list)` pulls eligible sponsored venues out and re-inserts them at **every 5th slot** (positions 5, 10, 15…). They are **not** stacked at the top — they're woven in so they feel discovered, not advertised.
6. **Banging trending row:** `renderTrend()` inserts **banging-tier** eligible sponsors into the trending row too (offset interleave). This is why Banging = "double visibility" (Suggestions **and** trending) and costs more.
7. **Visual treatment ("medium"):** a sponsored card gets a small **"Promoted"** label + a gold left-edge accent + a soft gold background tint (CSS classes `.promoted`, `.promoted-card`, and `.vpromo` for the trending row). No card ever displays the word "Banging".

**Important matching nuance:** the notepad stores a **name** (and optionally a `place_id`). The app matches a sponsored entry to a live Google venue by exact name or place_id. If the name a venue typed in the portal doesn't exactly match Google's name for that venue, the promotion won't attach. **Using `place_id` avoids this** (the portal already captures place_id when the owner picks a Google result).

### 5.3 Analytics capture (how the app proves ROI)

The app fires events **only for sponsored venues** (their paid ROI):

| Event | When it fires |
|---|---|
| `impression` | A sponsored card actually scrolls ≥50% into view (via `IntersectionObserver`) — one per venue per session |
| `detail_open` | The user taps to open the venue's detail page |
| `menu_click` / `booking_click` / `directions_click` / `call_click` | The user taps an action on the detail page (menu/website, OpenTable, directions, call) |
| `visit` | **Reserved, not implemented** — for future GPS proof-of-visit (see §14) |

**Each event carries:** `type`, `ts` (timestamp), `venueId` (place_id), `venue` (name), `tier`, `area` (a **coarse** ~1km grid — the user's GPS rounded to 2 decimal places, never a precise point — privacy-preserving), `city`, and `distM` (distance in metres).

**Buffering/flush:** events queue in `localStorage` under `panda_evq`, and are flushed to `ANALYTICS_ENDPOINT` every 15 seconds and on `visibilitychange` (using `navigator.sendBeacon` when the tab hides). If the endpoint is unreachable, events stay queued — nothing is lost and nothing breaks.

---

## 6. The partner portal (`partner-portal.html`)

A **single-file, premium dark-themed** self-serve website hosted on GitHub Pages at `.../PANDA-DEMO/partner-portal.html`. Fonts: **Space Grotesk** (display) + **Inter** (body). Palette: deep forest green + gold.

### 6.1 CONFIG block (top of the script — set these to change behaviour)
```js
const CONFIG = {
  CHECKOUT_ENDPOINT: "https://panda-partners-api.vercel.app/api/create-checkout-session",
  PORTAL_ENDPOINT:   "https://panda-partners-api.vercel.app/api/create-portal-session",
  PLACES_ENDPOINT:   "https://panda-ai-proxy.vercel.app/api/panda-ai",   // venue search reuses the app proxy (no key in this page)
  ANALYTICS_READ:    "https://panda-partners-api.vercel.app/api/analytics",
  MAPS_KEY:          "",       // unused — venue search goes via the proxy
  GOOGLE_CLIENT_ID:  "",       // unused — auth is demo mode
  PRICES: { /* display strings per tier per interval */ },
  DEFAULT_INTERVAL: "monthly"
};
```

### 6.2 The signup flow (what a venue does)
1. **Sign up** — email + password, or a Google button (**demo mode** — it just proceeds; no real OAuth).
2. **Find your venue** — a search box that calls the proxy's `venuesOnly` endpoint and shows up to 6 real Google results with addresses. The owner taps theirs. The **place_id** is captured behind the scenes.
3. **Confirm address** — an **editable** address field appears, pre-filled from Google, so the owner can fix/adjust the exact wording. Their edited address wins.
4. **Choose visibility** — tier (**Discovery** / **Banging**) + billing interval (**Monthly / 6 months / 12 months**), all with a **7-day free trial**. A "How you'll appear" preview section shows two real example images (see §6.5).
5. **Contact details** (captured here so it exports cleanly from Stripe): **Contact name** (required), **Phone** (required), **Venue type/cuisine** (optional), **How did you hear about Panda?** (dropdown).
6. **Start 7-day free trial** → redirects to real **Stripe Checkout**. Card collected now; £0 charged today; first charge on day 7.
7. On return: `?status=success` → dashboard; `?status=cancel` → toast, no charge.

### 6.3 The dashboard
- **Funnel:** three stat cards — **Seen → Opened → Acted** (honest wording; "Acted" = "tapped to book / get directions", **not** a confirmed physical visit).
- **"Times shown" chart** with a **Week / Month / Year** toggle.
- **"Busiest time of day" chart** — highlights the peak window (helps a venue aim offers).
- **Your locations** list — each location is its own subscription.
- **Live vs demo:** `liveAnalytics()` fetches `/api/analytics?venueId=<place_id>`; if real events exist it replaces the demo numbers, otherwise the demo figures show. **The demo numbers are placeholders until real traffic flows.**

### 6.4 Billing, settings, multi-location
- **Billing page:** a **trial countdown** (days left + the exact next-charge date & amount), the current plan, a **card-on-file** status row (card is saved securely with Stripe — we never store card numbers ourselves), and a **Manage billing** button that opens the Stripe billing portal.
- **Settings:** contact + venue details; **Swap venue** (reopens the venue search to remap the listing); **Log out**.
- **Log out** is also a **visible button in the top bar** (not just buried in settings).
- **Multi-location:** a "+ Add location" modal repeats the full search → editable address → billing interval → tier flow. Each location becomes its **own** Stripe subscription. Locations are stored in `localStorage` under `panda_locations`.

### 6.5 The "How you'll appear" previews
Two real example images are **embedded inline** (base64) inside `partner-portal.html` and shown on the plan screen:
- The **Suggestions feed** with a venue lifted and badged "Promoted".
- A **venue listing** (Bentley's) shown promoted.
Because they're inlined, there are **no separate image files to upload** — they travel inside the portal HTML.

### 6.6 Demo mode
The portal works fully **without** the backend, using `localStorage` (`panda_partner`, `panda_sub`, `panda_locations`). Signup/dashboard/settings are all clickable. **Only the actual payment** requires the live backend. This is ideal for demos: you can show the whole flow, and it only charges when Stripe is wired.

---

## 7. The word "Banging" (avoid confusion)

"Banging" means **two connected things**, and neither is a badge:
1. The **"Banging" section** in the app = the trending/hot-list row (pulled from Google by popularity).
2. The **"Banging" tier** = the premium paid tier. Buying it puts a venue in the **Suggestions feed AND the Banging trending row** = "double visibility" = higher price.

The lower tier, **Discovery**, only promotes in the Suggestions feed.
On a card, paid placement is labelled **"Promoted"** — never "Banging".

---

## 8. The backend API (`panda-partners-api` on Vercel)

Five serverless functions. Each file in `/api` becomes an endpoint at `https://panda-partners-api.vercel.app/api/<filename>`.

### 8.1 `create-checkout-session.js`
- **Input (POST JSON):** `tier`, `interval`, `email`, `venueName`, `venueAddress`, `placeId`, `contactName`, `phone`, `venueType`, `referral`, `successUrl`, `cancelUrl`.
- **Logic:** maps `tier + interval` → a Stripe **Price ID** (from env vars); creates a Stripe Checkout Session in `subscription` mode with `trial_period_days: 7`; sets `customer_creation: 'always'`; attaches all fields as **metadata** on both the session and the subscription; after creation, updates the Stripe **customer** with the contact `name` + `phone` (so they appear as proper columns in Stripe → Customers → Export CSV).
- **Output:** `{ url }` (the Stripe-hosted checkout page). The portal redirects there.
- CORS restricted to `ALLOWED_ORIGIN`.

### 8.2 `create-portal-session.js`
- **Input:** `email` (or `customerId`).
- **Logic:** finds the Stripe customer by email, creates a **billing portal** session.
- **Output:** `{ url }` — where the venue manages/cancels their subscription.

### 8.3 `stripe-webhook.js` (the automation)
- **Security:** verifies the Stripe signature using `STRIPE_WEBHOOK_SECRET` and the **raw** request body (`bodyParser` disabled). A missing/incorrect secret returns HTTP 400 ("signature error").
- **Events handled:**
  - `checkout.session.completed` and `invoice.payment_succeeded` → `setSponsored(on = true)`
  - `customer.subscription.trial_will_end` → logs (hook here to send a reminder email)
  - `invoice.payment_failed` and `customer.subscription.deleted` → `setSponsored(on = false)`
- **`setSponsored()`** writes to **`sponsored.json` in the PANDA-DEMO repo** via the GitHub Contents API: it reads the current file, **upserts or removes** the venue (matched by `placeId` or `name`), and commits. Requires `GH_TOKEN`, `GH_REPO`, optional `GH_PATH` (default `sponsored.json`) and `GH_BRANCH` (default `main`). If `GH_TOKEN`/`GH_REPO` are absent, it just logs (manual mode).
- **To move to a database later:** replace the body of `setSponsored()` with a DB write — nothing else changes.

### 8.4 `track.js` (analytics write)
- **Input:** `{ events: [ … ] }` (batches up to 200).
- **Logic:** validates event `type` against an allow-list, writes each to the Firestore **`events`** collection using `firebase-admin` (credentials from `FIREBASE_SERVICE_ACCOUNT`). Stores `type`, `venueId`, `venue`, `tier`, `city`, `area` (coarse), `distM`, `ts`, and a `day` string.
- **Output:** `{ ok: true, stored: <n> }`.

### 8.5 `analytics.js` (analytics read)
- **Input:** `GET ?venueId=<place_id>`.
- **Logic:** reads the last **7 days** of that venue's events from Firestore and aggregates: `impressions`, `taps`, `conversions`, `byDay` (Mon–Sun), and `areas` (counts by city).
- **Output:** JSON consumed by the portal dashboard.

---

## 9. Data stores

### 9.1 `sponsored.json` (the "notepad")
Lives in PANDA-DEMO. Small (hundreds of bytes). Holds only **name + tier** (+ optional place_id) per venue. Written by the webhook (auto) and/or by hand. Read by the app (cached 8 min). It does **not** hold venue photos/details — those come live from Google. Current shape:
```json
{
  "updated": "2026-08-16T20:00:00.000Z",
  "note": "…",
  "venues": [
    { "name": "Dishoom", "place_id": "", "tier": "banging" },
    { "name": "Bentley's Oyster Bar & Grill", "place_id": "", "tier": "banging" },
    { "name": "Nine Elms Tavern", "place_id": "", "tier": "discovery" }
  ]
}
```
> Note: Bentley's and Nine Elms were added by hand for demo/screenshots; Dishoom was auto-added by the webhook during testing. For a clean production file, keep only real paying venues.

### 9.2 Firestore `events` collection
Project `panda-partners`, database `(default)`, region `eur3`. One document per analytics event. Auto-created on first write. Free-tier limits (~50k reads / 20k writes per day) are ample thanks to batching + the 8-minute cache on the read side.

### 9.3 `venues.json`
Optional venue dataset in PANDA-DEMO, refreshed by a scheduled **GitHub Action** (`.github/workflows/…` + `scripts/fetch-data.js`). Used as a fallback/seed data source.

---

## 10. Environment variables (complete reference)

### 10.1 On **panda-partners-api** (Vercel → Project → Environment Variables)
| Name | Value / example | Secret? |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_…` (use `sk_live_…` for live) | **YES** |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` (from the webhook endpoint's page) | **YES** |
| `ALLOWED_ORIGIN` | `https://duncann38-sys.github.io` | no |
| `PORTAL_URL` | `https://duncann38-sys.github.io/PANDA-DEMO/partner-portal.html` | no |
| `PRICE_DISCOVERY_MONTHLY` | `price_1U51VfAUFhT4AGVauwyQZ4oC` | no |
| `PRICE_DISCOVERY_6M` | `price_1U51UxAUFhT4AGVa2rTfEDXI` | no |
| `PRICE_DISCOVERY_12M` | `price_1U51UxAUFhT4AGVayu9fqbIJ` | no |
| `PRICE_BANGING_MONTHLY` | `price_1U51dSAUFhT4AGVa2ON2nyeo` | no |
| `PRICE_BANGING_6M` | `price_1U51ciAUFhT4AGVaM7UPO8Ry` | no |
| `PRICE_BANGING_12M` | `price_1U51ciAUFhT4AGVaLrBz3nMF` | no |
| `FIREBASE_SERVICE_ACCOUNT` | the entire Firebase service-account JSON, on one line | **YES** |
| `GH_TOKEN` | fine-grained GitHub PAT with **Contents: Read/Write** on PANDA-DEMO | **YES** |
| `GH_REPO` | `duncann38-sys/PANDA-DEMO` | no |
| `GH_PATH` *(optional)* | `sponsored.json` (default) | no |
| `GH_BRANCH` *(optional)* | `main` (default) | no |

> ⚠️ **Any change to an env var requires a redeploy** on Vercel (Deployments → ⋯ → Redeploy) before it takes effect. This has bitten us twice — remember it.

### 10.2 On **panda-ai-proxy** (pre-existing Vercel project)
Holds the Google credentials (Places key + Vertex service account for project `applied-range-505314-h7`). These power venue search and Panda AI. Not part of the partner build, but the app and portal both depend on this proxy being up.

---

## 11. Stripe configuration

- **Account:** "Panda Tech". Built and tested in **Test mode**.
- **Products:** `Panda Discovery`, `Panda Banging`.
- **6 recurring Prices** (Test mode IDs are in §10.1). Amounts:

| Tier | Monthly | 6-month | 12-month |
|---|---|---|---|
| **Discovery** | £99/mo | £534 / 6 mo (£89/mo, −10%) | £950 / yr (£79/mo, −20%) |
| **Banging** | £250/mo | £1,350 / 6 mo (£225/mo, −10%) | £2,400 / yr (£200/mo, −20%) |

All start with a **7-day free trial** (card collected up front; £0 today; first charge day 7).

- **Webhook endpoint:** `https://panda-partners-api.vercel.app/api/stripe-webhook`
  - Payload style: **Snapshot**; scope: **Your account**; API version `2026-02-25.clover`.
  - Subscribed events: `checkout.session.completed`, `invoice.payment_succeeded`, `invoice.payment_failed`, `customer.subscription.trial_will_end`, `customer.subscription.deleted`.
  - Its **signing secret** (`whsec_…`) is stored in Vercel as `STRIPE_WEBHOOK_SECRET`.

**Proven end-to-end (test mode):** a test checkout (card `4242 4242 4242 4242`) created a real Customer + a **trialing** subscription + a £0 "Paid" invoice; the webhook returned **200 OK**; and it **auto-wrote the venue into `sponsored.json`**.

---

## 12. The complete data flows

### 12.1 "Venue pays → shows promoted" (fully automatic)
```
Venue fills portal → Stripe Checkout (7-day trial) → payment succeeds
   → Stripe fires checkout.session.completed
   → panda-partners-api /api/stripe-webhook (verifies signature)
   → setSponsored() commits the venue into sponsored.json (GitHub API)
   → the app loads sponsored.json (cached 8 min) and ranks that venue Promoted
Cancel / failed payment → webhook → setSponsored(off) → venue removed
```

### 12.2 "User sees/acts → venue sees results" (analytics)
```
App shows a sponsored card (scrolls into view) → fires impression
User taps it → detail_open ; taps book/menu/directions/call → conversion
   → events buffered in localStorage, flushed every 15s to /api/track
   → track.js writes them to Firestore (events collection)
Portal dashboard → /api/analytics?venueId=… → reads last 7 days → shows Seen/Opened/Acted
```

---

## 13. Pricing & revenue model

### 13.1 Partner (B2B) revenue — the near-term line
Illustrative at **1,000 venues**:
- 100% Discovery: **£99,000/mo = £1.19M ARR**
- 100% Banging: **£250,000/mo = £3.0M ARR**
- Realistic 70/30 mix: **£144,300/mo = £1.73M ARR**

This is a **self-serve SaaS** line (Stripe website, no underwriting, no FCA dependency), so it can scale quickly and de-risks the model. It's high-margin and recurring.

### 13.2 Consumer credit — the fintech core (roadmap/parallel)
- **£300** hospitality-only virtual **Mastercard**, MCC-locked to hospitality spend.
- Repaid over **3 monthly instalments of £100**, with a **flat 12% fee (£36)**.
- Repayment timing: first payment **30 days after funds**, then 3 equal instalments every 30 days.
- **Zero balance-sheet risk** via **SteadyPay** (FCA-regulated underwriting) and **Railsr / Equals Money** (Mastercard BIN issuance).
- Demand evidence: a **500-person study across 20+ UK universities**.

---

## 14. Known limitations & honest notes (read before pitching)

1. **Google billing (~£173) is unpaid → Places + Vertex are throttled.** Until it's cleared, the app's **venue feed, Panda AI, and real analytics events do not serve/flow live data.** This is the single biggest blocker. Everything is built and waiting; it just needs this paid.
2. **Stripe is still in Test mode.** No real money can be taken until it's flipped to Live (see §16).
3. **Dashboard numbers are demo placeholders** until real events flow. The funnel labels/structure are real; the figures are not yet. Do **not** present them to a venue as real.
4. **Proof-of-visit is NOT built.** Confirming a customer physically *arrived* needs background GPS + explicit GDPR consent, which browsers restrict — it belongs in a **native app**. The `visit` event type is reserved for it. Pitch it as the **roadmap differentiator**; today's provable claim is the **intent funnel** up to "tapped to book / get directions".
5. **Age/gender demographics are deliberately not captured.** They're not knowable from Google, and collecting them from users carries privacy/consent weight. Lean on the intent funnel (by area + time) instead — it's cleaner and stronger.
6. **Auth is demo mode** in both the app and the portal (localStorage, no real Google/Apple OAuth). Fine for demos; needs real auth before charging at scale.
7. **`sponsored.json` write race:** the file can be edited by hand *and* by the webhook. A simultaneous edit could overwrite one change. Negligible at current volume; disappears entirely when analytics/sponsors move to Firestore.
8. **Sponsored name-matching:** promotion attaches only if the portal's venue name matches Google's (or the place_id is used). Prefer place_id.

---

## 15. How to deploy / update each piece

### 15.1 The app or portal (PANDA-DEMO)
- Edit is done by **replacing the whole file** via the GitHub web UI (Add file → Upload files, or the pencil edit). GitHub Pages auto-serves within ~1 minute.
- Files that matter most: `index.html` (app), `partner-portal.html` (portal), `sponsored.json` (notepad).

### 15.2 The backend (panda-partners-api)
- Push a change to the repo (or edit a file on GitHub) → **Vercel auto-deploys**.
- **Only one file changes at a time usually.** For example, capturing contact fields changed only `api/create-checkout-session.js`.
- **Env var changes require a manual redeploy** (Deployments → ⋯ → Redeploy).

### 15.3 The proxy (panda-ai-proxy)
- Pre-existing Vercel project. The app and portal both call it for venue search / AI. Keep it running.

---

## 16. Remaining steps to go fully live

Nothing more needs to be **built**. Two switches remain:

### 16.1 Pay the Google Cloud bill (~£173)
Clears the throttle → the app feed, Panda AI, and real analytics events all start flowing at once.

### 16.2 Flip Stripe from Test → Live (~15 min)
Test and Live are separate worlds; the Test price IDs won't work in Live. Steps:
1. In Stripe, switch to **Live mode**.
2. Re-create the two Products and **6 Prices** (same amounts) → copy the **6 new live Price IDs**.
3. Create a **new webhook** in Live mode pointing at the same URL (`…/api/stripe-webhook`), same 5 events → copy its **live signing secret** (`whsec_…`).
4. In Vercel (panda-partners-api), swap the env vars to live values: `STRIPE_SECRET_KEY` → `sk_live_…`, the 6 `PRICE_*` → the live IDs, `STRIPE_WEBHOOK_SECRET` → the live `whsec_…`.
5. **Redeploy.** Test once with a real card (small/refunded) to confirm.

---

## 17. Roadmap / future ideas

- **GPS proof-of-visit** (native app + consent) — the Meta-beating differentiator.
- **Admin dashboard** — a login-protected page for Panda staff to see/export all venues (currently: export from Stripe → Customers → CSV, which already carries contact name, phone, and metadata).
- **Move sponsored + analytics fully to Firestore** — removes the JSON file and its write-race; the app reads a single cached Firestore doc instead of `sponsored.json`.
- **Real Google/Apple OAuth** for both app and portal.
- **Sponsored scarcity** — sell a limited number of Banging slots per area to increase value (rather than capping impressions).
- **African credit bureau** built on Panda repayment data (long-term vision; UK launch as proof of concept).

---

## 18. Company & fundraise context (for a technical hire / due diligence)

- **Entity:** Panda Tech Industries Ltd (Company No. 15572716). Founder & CEO: Duncan Nyanzi.
- **Raise:** £250k on £5M pre-money, SEIS/EIS eligible. (Confirm SEIS/EIS headroom with the accountant.)
- **Advisors:** Ike Udechuku, Robin Knox, Nick Beal, Mike Bristow.
- **Confirmed partners/rails:** SteadyPay (MSA signed), Equals Money (PMA), HSBC Innovation Banking, Flashpoint Capital, Railsr.
- **Live traction:** consumer app in use across several countries (e.g. UK, Sweden, Cyprus, Armenia, Romania, US).

---

## 19. Glossary (plain English)

- **PWA** — a website that installs like an app (full-screen, offline-capable).
- **Serverless function** — a small backend script (on Vercel) that runs on demand at a URL. No server to manage.
- **Webhook** — an automatic "phone call" Stripe makes to your backend when something happens (e.g. a payment).
- **Metadata** — extra labels you attach to a Stripe object (customer/subscription) so you can store & export custom info.
- **place_id** — Google's unique ID for a specific venue. More reliable than matching by name.
- **Firestore** — Google's cloud database (part of Firebase). Here it stores analytics events.
- **Env var (environment variable)** — a setting/secret stored on the hosting platform (Vercel), not in the code.
- **Spark plan** — Firebase's free tier.
- **Test mode / Live mode (Stripe)** — a sandbox with fake cards vs. real money. Separate keys and IDs.

---

## 20. Change log — what was built (chronological summary)

- **App foundations:** single-file PWA; install/manifest/service worker/icons; login screen + welcome animation; settings + WhatsApp share; Panda Credit screen; city auto-detection; Google Places venue discovery via proxy with ring-widening search; Panda AI concierge (Gemini/Vertex) with personalization; photo performance fixes; Suggestions + "Banging" trending; Panda Shuffle itinerary.
- **Sponsored system:** `sponsored.json` notepad; 8-minute cache; match by place_id/name; 3km reach cap; every-5th-slot interleave in Suggestions; banging inserts into the trending row; "Promoted" label + gold treatment.
- **Analytics capture:** impression (IntersectionObserver) / detail_open / conversion events; coarse area + city + distance + time; localStorage buffer; 15s + sendBeacon flush to `/api/track`.
- **Partner portal:** premium dark UI; signup; real Google venue search via proxy; editable address; 3 billing intervals; 7-day trial; contact/phone/venue-type/referral capture; dashboard funnel (Seen→Opened→Acted); Week/Month/Year + busiest-time charts; billing page with trial countdown, next-charge, card status; settings; working Swap venue; visible Log out; multi-location add flow; inline "how you'll appear" previews.
- **Backend (Vercel):** `create-checkout-session` (subscription + trial + metadata + customer name/phone); `create-portal-session`; `stripe-webhook` (verifies signature; writes sponsored.json via GitHub API); `track` (writes Firestore); `analytics` (reads Firestore).
- **Infrastructure set up & proven:** Stripe products + 6 prices + webhook (200 OK); GitHub fine-grained token wired so the webhook auto-updates `sponsored.json` (proven with Dishoom); Firebase project `panda-partners` + Firestore (eur3, production) + service account; analytics write proven (`{ok:true, stored:3}`).
- **Docs/assets produced:** Investor Overview PDF, Tech Stack PDF, app walkthrough video, Partner Portal setup guide, and this handover.

---

*End of handover. Keep this file in the repo (e.g. `PANDA_HANDOVER.md`) and update it at the end of each working session so it never falls out of date.*
