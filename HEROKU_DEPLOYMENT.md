# Heroku deployment (Design help)

This app uses **Passport** sign-in, **PostgreSQL** for data, **sessions in Postgres**, and **GOV.UK Notify** for verification emails in production.

## What to set on Heroku (config vars)

| Variable | Purpose |
|----------|---------|
| `NODE_ENV` | `production` — **required** (enables secure cookies, turns off local auth bypass, requires Notify for new registrations) |
| `DATABASE_URL` | Set automatically when you add **Heroku Postgres** |
| `SESSION_SECRET` | Long random string (e.g. `openssl rand -hex 32`) |
| `NOTIFY_API_KEY` | From [GOV.UK Notify](https://www.notifications.service.gov.uk/) → API integration |
| `NOTIFY_TEMPLATE_ID` | Email template that includes `((code))` — see [GOVUK_NOTIFY_GUIDE.md](GOVUK_NOTIFY_GUIDE.md) |
| `APPROVED_EMAILS` | Comma-separated `@defra.gov.uk` addresses allowed to register (plus any you add in the admin UI in the DB) |
| `ADMIN_EMAILS` | Optional: comma-separated addresses that get admin access (defaults exist in code; set this to override in production) |

Example (replace values):

```bash
heroku config:set NODE_ENV=production
heroku config:set SESSION_SECRET="$(openssl rand -hex 32)"
heroku config:set NOTIFY_API_KEY="your-notify-key"
heroku config:set NOTIFY_TEMPLATE_ID="your-template-id"
heroku config:set APPROVED_EMAILS="you.1@defra.gov.uk,you.2@defra.gov.uk"
```

**Notify trial mode** only delivers to team addresses you have invited in the Notify service; add testers there.

**Email verification in production:** if `NOTIFY_API_KEY` and `NOTIFY_TEMPLATE_ID` are missing, **new registrations are blocked** with a clear error (so you never get “stuck” with no way to receive a code). Locally, without those vars, the app still **logs the code to the console** and can show a dev-only code on the verify page when `NODE_ENV` is not `production`.

**Auth bypass:** in production, the dev “bypass” login is off. In local dev it stays on unless you set `AUTH_BYPASS=false`.

## One-off: database and schema

After deploy, run (replace `YOUR_APP`):

```bash
heroku run node scripts/init-db.js -a YOUR_APP
heroku run node scripts/update-schema-verification.js -a YOUR_APP
```

Ensure Heroku has Postgres attached so `DATABASE_URL` is set.

## Deploy

Push to the branch Heroku is tracking (often `main`). The `Procfile` runs the GOV.UK Prototype Kit listener.

## Smoke test on Heroku

1. Open the app URL; you should get the public home page or login, not a generic password wall (the old `USE_AUTH` + shared password flow is not used in this app).
2. **Register** with an email that exists in `approved_emails` (or in `APPROVED_EMAILS` so it is seeded) and a password.
3. You should **receive a real email** with a 6-digit code; enter it and land on the app **signed in** (no dev-only code on the page in production).
4. **Sign in** again after logout using the same email and password; unverified accounts cannot sign in (Passport enforces `is_verified`).

---

## Legacy note

Earlier prototypes sometimes used `USE_AUTH` and a **single shared** username/password in front of the app. **This repository does not use that** for the current Passport/Defra email flow. Ignore old guides that only mention `USE_AUTH` and non-database profiles.

The **Add profile** and database-backed data **do** persist on Heroku as long as you use the Heroku **Postgres** add-on, not the old in-memory story.
