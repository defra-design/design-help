# Design help — team connection platform

A [GOV.UK Prototype Kit](https://prototype-kit.service.gov.uk/docs) web application for connecting designers in your team for coaching, mentoring, design critiques, and mutual support.

**Source:** [defra-design/design-help on GitHub](https://github.com/defra-design/design-help)

We are using **AI-augmented coding** (e.g. Cursor and similar tools) to help develop and maintain this project, paired with human review and GOV.UK/Defra service patterns.

## What is implemented today

- **Stack:** Node.js, GOV.UK Prototype Kit, [GOV.UK Frontend](https://design-system.service.gov.uk/), **PostgreSQL** (via `pg`) for **users** and **profiles**
- **Sign-in:** Registration and sign-in for **@defra.gov.uk** addresses, with email verification via [GOV.UK Notify](https://www.notifications.service.gov.uk/) when `NOTIFY_*` variables are set; otherwise development fallbacks apply (see [GOVUK_NOTIFY_GUIDE.md](GOVUK_NOTIFY_GUIDE.md))
- **Sessions:** Server-side sessions stored in the database (PostgreSQL session store)
- **Data:** Profiles and accounts **persist in PostgreSQL** when you use a real database (e.g. on Heroku with [Heroku Postgres](https://devcenter.heroku.com/articles/heroku-postgresql)), not in JSON files on the app server

Legacy sample data may still sit under `app/data/` (e.g. for migration); **day-to-day data is the database** once configured.

## Features

- **Home** — quick links to find help by category (critiques, mentoring, accessibility, and so on)  
- **Browse** — all designers with skills and availability; optional text filter  
- **Profiles** — per-person pages  
- **Add / edit profile** — signed-in users complete their details (including availability)  
- **GDaD evidence (private)** — signed-in users can maintain STAR evidence across seven skills; evidence is not shown on browse/profile pages
- **GDaD scoring workflow** — review list, quick score-entry table, and per-skill detail review pages (access depends on role; see below)
- **GDaD CSV tools** — grade-specific template downloads and evidence import for designers; scoped admin scores export CSV
- **Admin — people and access** — allowlist, profiles, and (for Head of Design) grant or remove admin access
- **Admin — line management** — Head of Design identifies line managers, then assigns each team member a responsible manager
- **Defra branding refresh** — Defra DDTS header, updated green navigation and footer styling

## Admin and line management (Head of Design)

These tools appear in the **admin** navigation when you are signed in as an admin. Several screens are **Head of Design only** (allowlisted email, profile job title **Head of Design**, and `GDAD_HEAD_OF_DESIGN_EMAILS` — see [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)).

| Screen | Who | Purpose |
|--------|-----|---------|
| **People and access** | All admins | Add people to the allowlist, edit profiles, remove users. Head of Design can also **Make admin** / **Remove admin** for people on the list. |
| **Identify managers** | Head of Design | Tick who has line management responsibility. Only these people appear when assigning responsible managers. |
| **Responsible managers** | Head of Design | Choose each team member’s responsible manager (or leave unassigned). Removing someone as a line manager clears their team’s assignments. |
| **GDaD evidence** | Admins (scoped) | Review and score evidence — see GDaD access rules below. |
| **Long-term help** | All admins | View recorded long-term helping relationships. |

**Admin access types**

- **Service admins** — emails in `ADMIN_EMAILS` (or the built-in fallback list in code). Always have admin access; cannot be removed in the app (shown as **Service admin**).
- **App-granted admins** — stored in the `app_administrators` database table when Head of Design uses **Make admin**. Can be removed with **Remove admin**.

**GDaD review access (after managers are assigned)**

- **Head of Design** — can review and score everyone; full CSV export.
- **Line manager** — can review and score only people assigned to them as responsible manager.
- **Other admins** — can review and score only team members with **no** responsible manager yet (unassigned).
- **Designers** — can view and edit only their own evidence.

Sign-in treats email addresses as **case-insensitive** (e.g. `Name.Surname@defra.gov.uk` matches the stored lowercase address).

## Recent enhancements (May 2026)

- **Line management and scoped GDaD access** — `profile_line_manager`, `profile_manager_allocation`, and admin grant/revoke via `app_administrators`; logic in `app/lib/management-access.js` and `app/lib/admin-access.js`
- **Unit tests** — run `npm test` for access-rule checks (Node built-in test runner)
- Implemented full GDaD evidence journey (summary, per-skill edit, capability banding, grouped review queues)
- GDaD CSV import/export (grade templates, admin export)
- Case-insensitive email on sign-in and verification
- Defra DDTS branding (header, navigation, footer)

## Security and data handling

This app stores personal and potentially sensitive professional data (profiles, evidence text, scoring outcomes). Treat it as an internal service with controlled access and clear operational security. For reviewer-oriented **architecture and middleware order**, see [`ARCHITECTURE.md`](ARCHITECTURE.md).

### Current security posture

- Authentication and sessions are server-side (`passport` + PostgreSQL session store).
- Passwords are hashed with `bcrypt`.
- Registration is restricted to approved `@defra.gov.uk` addresses.
- GDaD evidence is separated from public browse/profile views.
- GDaD review/scoring routes are permission-gated by role and responsible-manager assignment.
- Extra admins granted by Head of Design are stored in PostgreSQL (`app_administrators`); service admins remain in `ADMIN_EMAILS`.

### Security recommendations (priority)

1. **Confirm GDaD and admin policy in code**
   - GDaD: designers own evidence only; line managers see assigned staff; other admins see unassigned staff; Head of Design sees all.
   - Protect assignment of the `Head of Design` job title to designated account(s) only.
   - Review who is in `ADMIN_EMAILS` and who Head of Design has granted admin access.

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

- **Node.js** **20.x** (see `engines` in [`package.json`](package.json)); use the same major version in CI and production images
- A running **PostgreSQL** instance and a **`.env`** in the project root (see [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) for variables such as `DATABASE_URL` and `SESSION_SECRET`)

### Install and run

```bash
npm install
npm run dev
```

The app is served at [http://localhost:3000](http://localhost:3000) by default.

Run automated checks for access-rule logic:

```bash
npm test
```

## Documentation index

| Document | Purpose |
| ---------- | --------- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | **How it works**: request flow, modules, auth model, hints for migrating hosting — for reviewers |
| [ROADMAP.md](ROADMAP.md) | **Status**: what’s delivered, ops checklist, hardening backlog, platform notes |
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
├── routes.js         # Main HTTP router: session, Passport, globals, routes; see ARCHITECTURE.md
├── lib/              # admin-access.js, management-access.js (permissions)
├── gdad/             # GDaD evidence, review, CSV (registered from routes.js)
├── views/            # Nunjucks/HTML pages
├── assets/           # JavaScript, Sass, images (e.g. favicon source)
├── db.js             # PostgreSQL pool
├── notify.js         # GOV.UK Notify helpers
└── config.json       # Service name + releaseVersion for footer
scripts/
├── init-db.js                    # Create tables (incl. line managers, allocations, app admins)
└── update-schema-verification.js  # Add verification columns to users
test/
└── *.test.js                     # Unit tests for admin and GDaD access rules
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
