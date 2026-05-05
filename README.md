# Design Help — team connection platform

A [GOV.UK Prototype Kit](https://prototype-kit.service.gov.uk/docs) web application for connecting designers in your team for coaching, mentoring, design critiques, and mutual support.

**Source:** [defra-design/design-help on GitHub](https://github.com/defra-design/design-help)

We are using **AI-augmented coding** (e.g. Cursor and similar tools) to help develop and maintain this project, paired with human review and GOV.UK/Defra service patterns.

## What is implemented today

- **Stack:** Node.js, GOV.UK Prototype Kit, [GOV.UK Frontend](https://design-system.service.gov.uk/), **PostgreSQL** (via `pg`) for **users** and **profiles**
- **Sign-in:** Registration and sign-in for **@defra.gov.uk** addresses, with email verification (verification is **still partly simulated in logs** until [GOV.UK Notify](https://www.notifications.service.gov.uk/) is wired—see [ROADMAP.md](ROADMAP.md))
- **Sessions:** Server-side sessions stored in the database (PostgreSQL session store)
- **Data:** Profiles and accounts **persist in PostgreSQL** when you use a real database (e.g. on Heroku with [Heroku Postgres](https://devcenter.heroku.com/articles/heroku-postgresql)), not in JSON files on the app server

Legacy sample data may still sit under `app/data/` (e.g. for migration); **day-to-day data is the database** once configured.

## Features

- **Home** — quick links to find help by category (critiques, mentoring, accessibility, and so on)  
- **Browse** — all designers with skills and availability; optional text filter  
- **Profiles** — per-person pages  
- **Add / edit profile** — signed-in users complete their details (including availability)  
- **GDaD evidence (private)** — signed-in users can maintain STAR evidence across seven skills; evidence is not shown on browse/profile pages
- **GDaD scoring workflow** — admin review list, quick score-entry table, and per-skill detail review pages
- **GDaD CSV tools** — grade-specific template downloads and evidence import for designers; admin scores export CSV
- **Defra branding refresh** — Defra DDTS header, updated green navigation and footer styling

## Recent enhancements (May 2026)

- Implemented full GDaD evidence journey:
  - evidence summary, per-skill edit, expected/graded level display, capability banding (best six of seven scores)
  - reviewer journey with grouped queues (no/incomplete evidence, unscored evidence, scored evidence)
  - admin quick score table plus per-skill detailed review pages
- Added import/export support:
  - designer CSV upload from fixed template format
  - grade-specific blank templates (`SEO`, `G7`, `G6`)
  - admin CSV export aligned with `reference/Export.csv`
- Added role gating for GDaD applicability (including exclusion of non-applicable roles)
- Restricted GDaD scoring to designated Head of Design account(s)
- Introduced tiered GDaD permissions:
  - designers can only view/edit their own evidence
  - admins can review all users' evidence
  - only Head of Design can save official scores
- Updated app branding to Defra DDTS styling (header, navigation, footer)

## Security and data handling

This app stores personal and potentially sensitive professional data (profiles, evidence text, scoring outcomes). Treat it as an internal service with controlled access and clear operational security.

### Current security posture

- Authentication and sessions are server-side (`passport` + PostgreSQL session store).
- Passwords are hashed with `bcrypt`.
- Registration is restricted to approved `@defra.gov.uk` addresses.
- GDaD evidence is separated from public browse/profile views.
- GDaD review/scoring routes are permission-gated.

### Security recommendations (priority)

1. **Confirm GDaD access policy in code**
   - Keep GDaD evidence owner-only for designers, admin-only for cross-user review, and Head-of-Design-only for scoring.
   - Protect assignment of the `Head of Design` job title to designated account(s) only.

2. **Add CSRF protection**
   - Add CSRF tokens to all state-changing POST routes (profile edits, admin actions, GDaD scoring/import).

3. **Add rate limiting on auth endpoints**
   - Apply per-IP (and optionally per-account) throttling on login, register, and verification/resend endpoints.

4. **Harden verification and sessions**
   - Add verification code expiry and attempt limits.
   - Set explicit cookie hardening (`httpOnly`, `sameSite`) and rotate session on login.

5. **Strengthen admin assurance**
   - Add audit logs for sensitive admin actions (scoring, profile deletion, allowlist changes).
   - Remove default/fallback privileged emails in production environments.

6. **Complete a light assurance pack before wider rollout**
   - Data retention statement, access review cadence, incident contact route, and routine dependency patching.

## Getting started (local)

### Prerequisites

- **Node.js** v16, v18, v20, or v22 (the kit does not officially support v24+ yet)
- A running **PostgreSQL** instance and a **`.env`** in the project root (see [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) and [ROADMAP.md](ROADMAP.md) for variables such as `DATABASE_URL` and `SESSION_SECRET`)

### Install and run

```bash
npm install
npm run dev
```

The app is served at [http://localhost:3000](http://localhost:3000) by default.

## Documentation index

| Document | Purpose |
| ---------- | --------- |
| [ROADMAP.md](ROADMAP.md) | **Plan** to run on Heroku, enable real email (Notify), persist data, and clean up loose ends |
| [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) | Heroku Postgres, config vars, one-off `init-db` and schema steps |
| [GOVUK_NOTIFY_GUIDE.md](GOVUK_NOTIFY_GUIDE.md) | Notify template, API key, and how your code will send verification emails |
| [TECHNICAL_OVERVIEW.md](TECHNICAL_OVERVIEW.md) | Plain-English view of how the app, database, and security fit together |
| [USER_NEED_CONTEXT.md](USER_NEED_CONTEXT.md) | Product intent, user need, and context for why this app is being used |
| [USER_GUIDE.md](USER_GUIDE.md) | End-user oriented notes where applicable |
| [HEROKU_DEPLOYMENT.md](HEROKU_DEPLOYMENT.md) | **Legacy / needs refresh**—do not follow it as the main guide until it is updated to match Postgres + app auth; use **ROADMAP.md** and **DEPLOYMENT_GUIDE.md** instead |

## Project structure (overview)

```text
app/
├── data/              # Sample / migration JSON (not the live store on production)
├── routes.js         # HTTP routes, auth, profile logic
├── views/            # Nunjucks/HTML pages
├── assets/          # JavaScript, Sass
├── db.js            # PostgreSQL connection pool
└── config.json
scripts/
├── init-db.js                    # Create tables, optional JSON migration
└── update-schema-verification.js  # Add verification columns to users
```

## Using the application (short)

1. **Register** with a **@defra.gov.uk** email and complete **email verification** (in development the code may be shown in the terminal or page as a stand-in for Notify).  
2. **Add or update your profile** at `/add-profile` after you are signed in.  
3. **Browse** at `/browse` and open individual **profiles** from the list.  
4. For **new filter links** on the home page, add rows in `app/views/index.html` pointing at `/browse?filter=...` as already done for other categories.  

**Custom styling:** add or override in `app/assets/sass/application.scss`.

## Support

- GOV.UK Prototype Kit: [https://prototype-kit.service.gov.uk/docs](https://prototype-kit.service.gov.uk/docs)

## Licence

See [LICENCE.txt](LICENCE.txt)
