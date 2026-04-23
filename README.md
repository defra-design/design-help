We are using **AI-augmented coding** (e.g. Cursor and similar tools) to help develop and maintain this project—pairing those assistants with human review and service patterns from GOV.UK and Defra.

# Design Help — team connection platform

A [GOV.UK Prototype Kit](https://prototype-kit.service.gov.uk/docs) web application for connecting designers in your team for coaching, mentoring, design critiques, and mutual support.

**Source:** [defra-design/design-help on GitHub](https://github.com/defra-design/design-help)

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
|----------|---------|
| [ROADMAP.md](ROADMAP.md) | **Plan** to run on Heroku, enable real email (Notify), persist data, and clean up loose ends |
| [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) | Heroku Postgres, config vars, one-off `init-db` and schema steps |
| [GOVUK_NOTIFY_GUIDE.md](GOVUK_NOTIFY_GUIDE.md) | Notify template, API key, and how your code will send verification emails |
| [TECHNICAL_OVERVIEW.md](TECHNICAL_OVERVIEW.md) | Plain-English view of how the app, database, and security fit together |
| [USER_GUIDE.md](USER_GUIDE.md) | End-user oriented notes where applicable |
| [HEROKU_DEPLOYMENT.md](HEROKU_DEPLOYMENT.md) | **Legacy / needs refresh**—do not follow it as the main guide until it is updated to match Postgres + app auth; use **ROADMAP.md** and **DEPLOYMENT_GUIDE.md** instead |

## Project structure (overview)

```
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
