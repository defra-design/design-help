# Design help — deployment roadmap (trimmed)

This is the short deployment plan and current status.  
Detailed run commands live in [`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md) and Notify setup in [`GOVUK_NOTIFY_GUIDE.md`](GOVUK_NOTIFY_GUIDE.md).

## Current status

| Area | State |
| --- | --- |
| Heroku readiness | App structure is deployable (`Procfile` + `npm start`). |
| Data persistence | Users/profiles/sessions are PostgreSQL-backed. |
| Auth flow | Register/verify/login flow exists. |
| Notify | Still the main remaining deployment step in environments where real email is required. |
| Docs | `DEPLOYMENT_GUIDE.md` is the primary step-by-step deployment doc. |

## Implementation checklist

1. **Heroku baseline**
   - App connected to repo
   - Heroku Postgres attached
   - `NODE_ENV=production`, `SESSION_SECRET` set

2. **Initialise database**
   - Run:

   ```bash
   heroku run node scripts/init-db.js -a YOUR_APP_NAME
   heroku run node scripts/update-schema-verification.js -a YOUR_APP_NAME
   ```

   - Confirm session table exists (or is auto-created)

3. **Wire GOV.UK Notify**
   - Set `NOTIFY_API_KEY` and `NOTIFY_TEMPLATE_ID`
   - Ensure production uses real email send path

4. **Smoke test**
   - Register, verify, login, edit profile
   - Confirm data persists across dyno restarts

## Remaining backlog

- Complete/validate Notify in target environments.
- Keep deployment docs aligned (avoid duplicate conflicting instructions).
- Optional hardening: rate-limits, monitoring, release automation.
