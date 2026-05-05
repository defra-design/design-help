# Design help — status and remaining work

This file records **what is already in place**, **routine operations**, and **what is left** (hardening, platform choices). Detailed deploy steps remain in [`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md); architecture for reviewers is in [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Delivered (baseline)

These items were on the earlier implementation checklist and are **done** at the codebase level:

| Theme | Delivered |
| --- | --- |
| **Hosting shape** | `Procfile` + `npm start`; app runs as a standard GOV.UK Prototype Kit Node process |
| **Database** | Users, profiles, sessions, GDaD data in PostgreSQL (`app/db.js`, scripts under `scripts/`) |
| **Identity** | Register → verify → login (`passport-local`, bcrypt, session store in Postgres) |
| **Email** | GOV.UK Notify wired in code (`app/notify.js`); verification and feedback paths when env vars set — see [`GOVUK_NOTIFY_GUIDE.md`](GOVUK_NOTIFY_GUIDE.md) |
| **Product surface** | Browse, profiles, offers/requests, admin tools, GDaD evidence/import/review/export |
| **Public pages** | `/about`, `/how-it-has-been-built`, `/feedback` available without sign-in (see `PUBLIC_WITHOUT_SIGN_IN_*` in `app/routes.js`) |
| **Docs** | Deployment, Notify, technical overview, architecture note, user-context docs |

## Operations (ongoing)

- **Environment checklist:** `NODE_ENV`, `DATABASE_URL`, `SESSION_SECRET`, Notify keys/template IDs as per [`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md)
- **After deploy:** run or confirm schema/init scripts remain valid for fresh databases
- **Backups:** Rely on the hosting provider’s Postgres backup story (today often Heroku Postgres)
- **Keep docs honest:** Bump `releaseVersion` in `app/config.json` when merging releasable changes (see [`AGENTS.md`](AGENTS.md))

## Hardening and assurance (recommended next)

Suggested priorities are aligned with [`README.md`](README.md) § Security recommendations and with [`ARCHITECTURE.md`](ARCHITECTURE.md):

- CSRF tokens on mutating POSTs
- Rate limiting on auth and verification surfaces
- Verification code expiry and attempt limits; session/cookie hardening review
- Audit logging for sensitive admin and scoring actions
- Dependency and container image scanning in CI
- Light assurance pack (data retention, access review, incident contact) before wider reliance

Treat **penetration testing / formal threat modelling** as out of scope for the current prototype stance unless governance requires it (`/how-it-has-been-built` documents that honestly).

## Platform strategy

- **Today:** Often deployed on Heroku-style PaaS with attached Postgres — see deployment guide.
- **Future:** Moving to Defra core delivery platform (or similar) is mainly **rehosting the same artefact** (`npm start`), **managed Postgres + secrets**, and **organisational SSL/network policy**; see the “Migrating hosting” section in [`ARCHITECTURE.md`](ARCHITECTURE.md).
