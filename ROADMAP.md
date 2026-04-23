# Design Help — deployment and product roadmap

This document is a step-by-step plan to run the app on [Heroku](https://heroku.com), use **real email** for verification (via [GOV.UK Notify](https://www.notifications.service.gov.uk/)), and keep **persistent data** in PostgreSQL. It also lists loose ends to tidy up.

**Related docs:** [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) (Defra / Heroku Postgres), [GOVUK_NOTIFY_GUIDE.md](GOVUK_NOTIFY_GUIDE.md) (email template and API keys), [TECHNICAL_OVERVIEW.md](TECHNICAL_OVERVIEW.md) (how the app fits together).

---

## Current status (snapshot)

| Area | State |
|------|--------|
| **Heroku** | The `Procfile` and `npm start` are appropriate. The app is intended to be deployed as a web dyno. |
| **Data persistence** | **PostgreSQL** stores `users` and `profiles` (and sessions). Data survives app restarts when you use a hosted database (e.g. Heroku Postgres), not the server’s temporary filesystem. |
| **Email authentication** | The **flow** exists (register → code → verify → login), but the “email” is still **simulated in server logs** until GOV.UK Notify is wired in code. See [GOVUK_NOTIFY_GUIDE.md](GOVUK_NOTIFY_GUIDE.md) for the intended approach. |
| **Documentation** | [HEROKU_DEPLOYMENT.md](HEROKU_DEPLOYMENT.md) is **out of date** (it describes an older JSON / basic-auth style setup). Prefer **this roadmap** and [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) until HEROKU_DEPLOYMENT is revised. |
| **Loose ends** | Session storage needs a `session` table (or `createTableIfMissing` in code); a fresh database must be initialised with the provided scripts; full user columns may require running the schema update script after `init-db`. |

---

## Phase A — Get it running on Heroku (baseline)

**Goal:** The app opens in a browser, the database is attached, and startup errors are resolved.

1. **Heroku app and GitHub**  
   - Create or use a Heroku app, connect the [defra-design/design-help](https://github.com/defra-design/design-help) repository, and deploy from your main branch (or the branch you use).

2. **Add a database**  
   - In Heroku: **Resources** → add **Heroku Postgres** (plan according to your organisation).  
   - Heroku sets **`DATABASE_URL`** automatically. The app reads this; you do not paste it into the source code.

3. **Config vars (Settings → Reveal config vars)**  
   - **`NODE_ENV`** = `production`  
   - **`SESSION_SECRET`** = a long random string (kept private). Used to sign session cookies.  
   - After Phase C, add **Notify** keys (below).

4. **One-off database setup (after the first successful deploy)**  
   With the [Heroku CLI](https://devcenter.heroku.com/articles/heroku-cli) (replace `YOUR_APP_NAME`):

   ```bash
   heroku run node scripts/init-db.js -a YOUR_APP_NAME
   heroku run node scripts/update-schema-verification.js -a YOUR_APP_NAME
   ```

   This creates/updates tables for users, profiles, and verification-related columns.

5. **Session table**  
   - Either enable **`createTableIfMissing: true`** for the PostgreSQL session store in code, or create the `session` table with SQL and run it once.  
   - Without a `session` table, sign-in and session-based features can fail on a clean database.

6. **Smoke test**  
   - Open the Heroku URL, try register and login.  
   - If something fails, use **More → View logs** in Heroku or `heroku logs --tail`—errors like "relation does not exist" usually mean a missing table or script not run.

**Checkpoint:** App loads, database scripts completed without error, and you can go through registration (even if the verification code only appears in logs until Notify is live).

---

## Phase B — Confirm persistent data (not files on the app server)

**Goal:** No reliance on the dyno’s ephemeral disk for real data.

1. Treat the Heroku dyno as **stateless**; all important data should live in **Postgres** (users, profiles, sessions in the database).  
2. Decide as a team whether to document **manual** `heroku run` after first deploy, or add automation (e.g. release phase)—either is fine; document the chosen approach.  
3. Keep **one** authoritative deployment document (e.g. [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)) and align or archive misleading pages.

**Checkpoint:** Everyone agrees: accounts and profiles live in the database, not in JSON files on the server.

---

## Phase C — Real email (GOV.UK Notify)

**Goal:** New users receive a real email with a verification code.

1. In **GOV.UK Notify** (with appropriate org access), create the template and API key as described in [GOVUK_NOTIFY_GUIDE.md](GOVUK_NOTIFY_GUIDE.md) (e.g. `((code))` in the template body).  
2. **Heroku config vars** (and local `.env` for testing, not committed to git):  
   - `NOTIFY_API_KEY`  
   - `NOTIFY_TEMPLATE_ID`  
3. **Implementation tasks for developers**  
   - Add the `notifications-node-client` dependency.  
   - In `app/routes.js`, replace the **“EMAIL SIMULATION”** / console block with a real `sendEmail` call (see the guide for a starting snippet).  
   - If sending fails, return a clear error to the user.  
   - For local development, keep console logging when Notify keys are absent so work can continue without Notify.  
4. **UX:** Avoid showing a debug verification code in the page in production; restrict that behaviour to local/dev only if still needed.

**Checkpoint:** Registering on Heroku with a real `@defra.gov.uk` address sends an email; verification completes and sign-in works.

---

## Phase D — Tidy loose ends

1. **HEROKU_DEPLOYMENT.md** — Update or replace so it no longer describes JSON-only data or the old `USE_AUTH` / shared password model if those are not used.  
2. **README.md** — Short pointer to this roadmap, Heroku, Postgres, and Notify.  
3. **Secrets** — Never commit `.env`; confirm `.gitignore` includes it.  
4. **Node version** — Match [Heroku’s Node support](https://devcenter.heroku.com/articles/nodejs-support#specifying-a-node-js-version) to the version in `package.json` `engines` (e.g. Node 20).  
5. **Optional later** — Rate limits on auth routes, monitoring, admin tooling, etc.

---

## How configuration fits together (plain terms)

- **Config vars in Heroku** are settings the app reads when it runs in the cloud: database connection (via `DATABASE_URL`), session secret, Notify API key, and so on.  
- **A local `.env` file** is the same idea for your machine when you run `npm run dev`.  
- **PostgreSQL** is a separate service: the app connects using the URL Heroku provides; that is what makes data **persist** across restarts.  
- **GOV.UK Notify** is a separate service: the app calls it with the API key to send verification (and any future) emails.

---

## Suggested work breakdown (e.g. GitHub issues)

1. **Heroku + Postgres + `SESSION_SECRET` + `NODE_ENV` + run `init-db` and schema update + session table**  
2. **Wire Notify + registration flow + remove production debug code**  
3. **Documentation pass (HEROKU_DEPLOYMENT, README) and any release checklist**

This roadmap should be revisited as features ship and docs converge.
