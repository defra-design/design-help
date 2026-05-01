# Agent guidance — Design Help

Use this document when assisting with **Design Help**, a GOV.UK Prototype Kit app (Node.js, PostgreSQL). Keep advice aligned with public-sector service patterns and team wellbeing.

---

## Service standard and assurance

Design and implementation choices should aim toward **[GOV.UK Service Standard](https://www.gov.uk/service-manual/service-standard)** expectations: user needs first, multidisciplinary effort, iterative delivery, usable and accessible interfaces, cohesive end-to-end journeys, resilient operations, transparent failure handling where appropriate to users, privacy and security-conscious handling of data.

When proposing shortcuts (e.g. simulated email, placeholders), spell out **risk to standard / live readiness** and what would be needed later.

---

## Resilience

Favour behaviours that degrade safely:

- **Errors:** Prefer clear handling and logging over silent failures. Avoid brittle assumptions about database, sessions, Notify, or network.
- **Data:** Respect validation at boundaries; avoid losing user work where the kit or patterns allow recovery messaging.
- **Ops:** Assume deployment targets (e.g. Heroku) may restart processes; sessions and DB connectivity should behave predictably after configuration changes.

Prefer small, reviewable changes that do not widen failure surfaces without reason.

---

## Accessibility (WCAG) and GOV.UK patterns

Treat **maximum practical WCAG conformance** as a requirement:

- Prefer **[GOV.UK Design System](https://design-system.service.gov.uk/)** and **[PROTOTYPE Kit](https://prototype-kit.service.gov.uk/docs)**/`govuk-frontend` components over bespoke HTML/CSS unless there is no suitable component.
- Use correct **semantic structure** (`h1`–`h6` order, landmarks, lists, buttons vs links).
- Ensure **keyboard** use, **visible focus**, **colour contrast**, **form labels, hints, errors** linked via `aria-describedby`, and meaningful **`name`/`accessible names`** where applicable.
- Do not weaken accessibility “for speed”; if unsure, cite **WCAG 2.2** considerations and propose a compliant pattern before inventing markup.

Accessibility fixes are never optional polish when they affect journeys that ship to users.

---

## Psychological safety of the design team

The product connects designers for critique, mentoring, and support:

- Prefer **neutral, respectful, inclusive** language in UI copy and admin flows; avoid shaming, blame, or surveillance tone.
- Be careful with **visibility of personal data** (profiles, contact paths, admin lists): default to **least exposure** and clear purpose.
- When adding moderation, reporting, or admin tools, frame them as **support and safety**, not punishment by default.
- In code review style (for the agent): be direct and kind; avoid dismissive phrasing about people’s work or choices.

---

## Working with the maintainer (low-code context)

The primary maintainer is **not a full-time developer**. When making recommendations or changes:

- **Explain briefly** what you changed and *why* in plain language, not jargon-only summaries.
- Offer **clear options** (e.g. A / B / C) with trade-offs: risk, effort, standard alignment, accessibility impact.
- Prefer **incremental steps** over large unexplained refactors.
- Flag anything that needs **manual verification** (browser, assistive tech, Notify, DB migration) explicitly.

---

## Project facts (quick reference)

- **Stack:** GOV.UK Prototype Kit, GOV.UK Frontend (see `app/config.json` for plugin flags), PostgreSQL via `pg`, server-side sessions.
- **Canonical docs:** [README.md](README.md), [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md), [ROADMAP.md](ROADMAP.md).

### Release version (when pushing to `main`)

- The deployable version string lives in **`app/config.json`** as **`releaseVersion`**.
- Use a **dated** id: **`YYYY.MM.DD.N`** (year, month, day, then a dot and a daily sequence number `N` starting at `1` for the first release that day, incrementing for additional releases the same day).
- **Bump `releaseVersion`** in the same commit as releasable changes, then push to **`main`**. The footer shows **Version:** from this value (`res.locals.appVersion` in `app/routes.js`).

When instructions here conflict with an explicit **user instruction in the current task**, follow the user for that task and note the tension if it matters for standard, safety, or accessibility.
