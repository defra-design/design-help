# GDaD skills evidence — stable release, rollback, and implementation plan

This document records the **git tag** created before building the GDaD skills evidence feature, **how to roll back**, and the **planned implementation** (aligned with the GDS GDaD skills framework and the skills matrix in `reference/`).

---

## 1. Stable release and rollback

### Tag

| Item | Value |
|------|--------|
| **Tag name** | `release-2026.05.01.3` |
| **App version** (at tag) | `2026.05.01.3` in `app/config.json` |
| **Purpose** | Baseline commit before GDaD skills evidence work; use for rollback or comparison |

The tag is pushed to **GitHub** (`origin`). It only includes **committed** files at that point (e.g. untracked files under `reference/` were not part of the tag unless committed separately).

### Inspect the snapshot (detached HEAD)

```bash
git fetch origin tag release-2026.05.01.3
git checkout release-2026.05.01.3
```

### Branch from the tag (e.g. hotfix or deploy)

```bash
git checkout -b rollback/pre-gdad release-2026.05.01.3
```

### Reset `main` to this release (destructive — coordinate first)

```bash
git checkout main
git reset --hard release-2026.05.01.3
git push --force-with-lease origin main
```

Force-pushing `main` rewrites shared history. Prefer deploying a **specific commit SHA** or opening a **revert PR** unless the team agrees to reset `main`.

### Production / Heroku

Deploy the **commit** the tag points to (SHA from `git rev-parse release-2026.05.01.3`) if you need the live app to match this baseline, or roll forward with normal deploys after the new feature ships.

---

## 2. Product intent (summary)

- Designers maintain **seven pieces of evidence** in **free text**, using a **STAR** structure, mapped to the **seven GDaD skills** in the published framework.
- Evidence is **private**: visible only to **that designer** and **admins / head-of-profession scorers** — not on public browse or team directory cards.
- **Official scores** (1 = below standard, 2 = at standard, 3 = above standard) are entered **only** by the head of profession and/or admins, after review with the designer; designers see those scores when set.
- **Reference:** skills matrix by grade (SEO / G7 / G6) — see `reference/GDaD_2026-05-02_07-40-08.png` and [GDS / GDaD material on GOV.UK](https://www.gov.uk/) for canonical wording.

**Clarify before build:** If designers should not enter “official” scores at all, scope the UI to **evidence text** plus optional **draft self-reflection** only; **official** scores remain scorer-only.

### Who gets GDaD evidence (role gate)

The published **GDaD skills framework** and the seven-skill matrix target **interaction and service design** progression (e.g. SEO / G7 / G6 against those roles). **Accessibility consultants are not on the GDaD framework today** — inclusion is **planned for the future**.

**Product rule:** Do **not** offer GDaD skills evidence (nav link, “My GDaD evidence”, admin scoring for that person) for job titles that are **accessibility specialist / consultant** roles only.

In this app, those are the profile **role** values (see `allowedRoles` in `app/routes.js`):

- `Accessibility Specialist (SEO)`
- `Senior Accessibility Specialist (Grade 7)`

Everyone else in `allowedRoles` who follows the **interaction / service design** GDaD path should get the feature when it ships. Revisit this gate when Defra / GDS publishes **GDaD-aligned standards for accessibility professionals** and update the doc + code together.

**Implementation note:** Gate by **stored profile `role`** (or a dedicated flag if roles split later). Admins viewing a user whose role is one of the two accessibility titles should **not** see GDaD evidence admin actions for that user (or show a short explanation: “GDaD evidence is not applicable for this role yet”).

---

## 3. Implementation plan

### 3.1 Data model (Postgres)

**Preferred: normalised table** (e.g. `gdad_evidence_items`):

- `id`, `user_id` (FK → `users`)
- `skill_key` — stable enum for the **seven** skills, e.g.  
  `design_communication`, `designing_for_everyone`, `designing_strategically`, `designing_together`, `evidence_based_design`, `iterative_design`, `leading_design`
- `evidence_text` — `TEXT` (STAR narrative; generous max length + optional character count in UI)
- `evidence_updated_at`
- **Official scoring (scorers only):**  
  - `official_score` — `SMALLINT` **NULL** until scored; values **1, 2, 3** when set  
  - `scored_by_user_id` (FK, nullable), `scored_at` (timestamptz, nullable)
- Optional: `review_notes` (admin-only internal note)
- **Unique:** `(user_id, skill_key)` — one row per skill per person

**Optional:** `gdad_evidence_audit` — append-only audit of changes (who changed evidence or scores, when).

**Optional:** store **`current_grade`** (`SEO` | `G7` | `G6`) on profile or alongside evidence so the UI can show **expected standard** copy for the right grade column.

**Wide-table alternative:** one row per user with seven text columns and seven score columns — quicker MVP, harder to extend.

### 3.2 Access control

- **Read** evidence + official scores: `session user` is **owner** **OR** **admin** **OR** optional **`GDAD_SCORER_EMAILS`** (comma-separated env list for head of profession / deputies).
- **Write evidence:** **owner only** (not other designers).
- **Write official scores:** **admin or GDaD scorers only** — reject or ignore score fields from designer POST bodies.
- **Never** expose this data on **browse**, **public profile**, or shared JSON for those pages.

Use route middleware (e.g. `ensureEvidenceOwnerOrAdmin`, `ensureGdAdScorer`) and **re-check in POST handlers**.

### 3.3 Roles

- Reuse **`ADMIN_EMAILS`** for admins.
- Add **`GDAD_SCORER_EMAILS`** (or similar) for people allowed to set **official** scores without being full admin — keeps “only myself or nominated scorers” explicit.

### 3.4 Reference content in the app

- Ship **structured copy** (JSON or small module) for the seven skill names and SEO/G7/G6 **expected standards** text (from GOV.UK / your matrix) for read-only display next to each field — don’t rely on the PNG alone (accessibility and versioning).

### 3.5 UI (suggested)

**Role gate:** Only show GDaD evidence entry points for users whose profile **role** is **not** an accessibility-only title (see **Who gets GDaD evidence** above). Hide nav link and routes for excluded roles; return 404 or a clear “not applicable” page if accessed directly.

**Designer**

- New area e.g. **“My GDaD evidence”** (signed-in nav): seven sections or an accordion; STAR **textarea** per skill; save draft.
- Show **grade-appropriate** standard text per skill.
- Show **official score** per skill when set (read-only labels: below / at / above standard).
- Optional: “Ready for review” flag or timestamp.

**Admin / scorer**

- Admin (or dedicated) screen: pick user → same seven skills → read evidence → set **1 / 2 / 3** → save.
- Optional later: Notify email when submitted for review.

### 3.6 Validation

- Server: `official_score` ∈ `{1,2,3}` or `NULL`.
- Length limits and sanitisation on `evidence_text` as for other profile text.

### 3.7 Phasing

| Phase | Scope |
|--------|--------|
| **MVP** | Table + migrations; designer CRUD for seven texts; owner + admin/scorer read; scoring UI for scorers only; no leakage to public views. |
| **Next** | **Scores review** + **information layers** (§5.1, §5.5); **banding** (§5.2); **evidence template import** CSV/XLSX without storing files (§5.6); exports: **head-of-design CSV** (§5.3) and **admin Excel scores table** (§5.7). |
| **V2** | Audit log; “submitted for review”; Notify hook. |
| **V3** | **File uploads** (PDF etc.) — needs **durable object storage** (not Heroku local disk); virus scan and Defra security sign-off. |

### 3.8 Compliance and risk (short)

- Treat as **sensitive professional data**; agree **retention**, access, and whether a **DPIA** or security review is required.
- Backups include this data — same posture as other profile data.

### 3.9 Codebase touchpoints (this repo)

- **`app/routes.js`** — new routes under e.g. `/my-gdad-evidence`, `/admin/.../gdad-evidence`.
- **Views** — new templates; GOV.UK components, character count, error summary.
- **`scripts/`** or SQL migration — create tables; align with existing `init-db` / deploy practices.

### 3.10 First technical slice

1. Freeze **`skill_key`** strings and **grade** enum.  
2. Add **`gdad_evidence_items`** (+ migration).  
3. Ship **one skill end-to-end** (text + scorer score), then replicate for all seven.

---

## 4. Related files

| File | Role |
|------|------|
| `reference/GDaD_2026-05-02_07-40-08.png` | Visual matrix (SEO / G7 / G6 × seven skills) |
| `AGENTS.md` | Release versioning (`YYYY.MM.DD.N` in `app/config.json`) when shipping |

When this feature ships, bump **`releaseVersion`** in `app/config.json` and document any new **config vars** (e.g. `GDAD_SCORER_EMAILS`) in `DEPLOYMENT_GUIDE.md` or a short subsection here.

### Implemented routes (MVP)

| Route | Who |
|-------|-----|
| `GET/POST /my-gdad-evidence` | Signed-in designer (GDaD-applicable job title only) — edit STAR evidence |
| `GET /review/gdad-evidence` | Admin or `GDAD_SCORER_EMAILS` — list eligible people |
| `GET/POST /review/gdad-evidence/:userId` | Admin or scorers — read evidence, set scores |

The **DDaT capability framework** site shows role pages (e.g. [service designer](https://ddat-capability-framework.service.gov.uk/role/service-designer)) with tables of skills by level; this app uses a **three-column band** (working / practitioner / expert) plus links to each skill anchor for alignment.

---

## 5. Next phase — scores review, banding, head-of-design export

This section is the **implementation plan** for features agreed after MVP. Build order can follow: **scores review UI** → **banding rules + UI** → **CSV export** (or banding first if data model must land before the review screen).

### 5.1 Per-designer scores review

**Goal:** A dedicated **scores review** view for each GDaD-applicable designer (likely alongside or evolving `/review/gdad-evidence/:userId`).

**Content:**

- List **all seven** skill titles (same `skill_key` set as elsewhere).
- For each skill, show the **current official score** using the existing 1 / 2 / 3 semantics **or** an explicit **Unscored** (or “Not yet scored”) state when `official_score` is null.
- Keep evidence text accessible from the same journey if scorers still need context (existing evidence + score form may be merged or linked).

**Access:** Same as today for scoring — **admin** and **`GDAD_SCORER_EMAILS`** (unless product narrows this later).

### 5.2 Banding (six skills from seven)

**Goal:** **Banding** places the designer in an overall band using the **best six** of the **seven** official skill scores.

**Confirmed rule (from supplied scoring image):**

- Use the **six highest** official scores (scores are 1, 2, or 3).
- Compute `total` (sum of best six; min 6, max 18) and optional `average = total / 6`.
- Map totals to capability levels:

| Capability level | Capability rating | Total score (best 6) | Average boundary |
|------------------|-------------------|----------------------|------------------|
| 1 | Developing | 6–8 | 1.00–1.49 |
| 2 | Proficient Level 1 | 9–11 | 1.50–1.99 |
| 3 | Proficient Level 2 | 12–13 | 2.00–2.32 |
| 4 | Proficient Level 3 | 14–15 | 2.33–2.65 |
| 5 | Accomplished Level 1 | 16–17 | 2.66–2.99 |
| 6 | Accomplished Level 2 | 18 | 3.00 |

Banding is available only when at least **six skills** have an official score.

**Implementation directions (draft):**

- Persisting explicit “included in banding” flags is **not required** for this rule because best-six selection is deterministic (sort descending and take first six).
- Store or compute **derived band** (and optionally **numeric aggregate**) server-side for export and display; avoid inconsistent client-only totals.
- Show on the scores review screen: per-skill score, **included in banding** (yes/no), and **computed band** / **interim total** once rules are coded.

**Depends on:** Uploaded banding spec from the head of profession / design.

### 5.3 CSV export — all designers’ final scores (head of design only)

**Goal:** Download a **CSV** listing **all designers** (GDaD-eligible path) with **final** scoring / banding outcomes suitable for reporting.

**Access control — strict:**

- Available **only** to **head of design** (not all scorers, not all admins unless head of design is also admin).
- Implement via env allowlist, e.g. **`GDAD_HEAD_OF_DESIGN_EMAILS`** — comma-separated `@defra.gov.uk` addresses (same pattern as `GDAD_SCORER_EMAILS`). Document in `DEPLOYMENT_GUIDE.md` when shipped.
- Return **403** for everyone else, including admins not on the list.

**CSV content (draft — refine when banding exists):**

- Identifiers: e.g. name, email, user id (minimise PII in line with retention policy).
- Per-skill official scores and/or **final band** / **aggregate** columns as defined in §5.2.
- One row per designer; include only eligible roles (same gate as GDaD evidence).

**Route (planned):** e.g. `GET /review/gdad-evidence/export.csv` or `/admin/gdad-scores-export` — **GET**, `Content-Type: text/csv`, `Content-Disposition: attachment`.

### 5.4 Config and compliance

- New **`GDAD_HEAD_OF_DESIGN_EMAILS`** (or agreed name) — required for export feature; empty = export disabled or 403 for all.
- Treat CSV as **sensitive**; same retention and assurance posture as §3.8.

### 5.5 Information design — input vs review at individual level

**Goal:** Designers and reviewers see the **appropriate layer** of information on **one user at a time** — enough to submit or score without drowning in unrelated context.

| Audience | Primary goals | Information to show (high level) |
|----------|----------------|----------------------------------|
| **Designer** (own evidence) | Enter STAR text; understand expected level | Job-related **expected standard** (working / practitioner / expert) per skill; link to DDaT skill + role page; **official score** only when set, with plain labels; clear **“not yet scored”** when null. |
| **Scorer / admin** (someone else’s record) | Read evidence; set 1–2–3 consistently | **Who** (name, job title, framework role band); **scores at a glance** (all seven skills: evidence present / absent, current official score or not set); then **per-skill** blocks with full expected-standard text, evidence text, and score control. |

**UX direction:** Keep a **summary layer** (overview table or list) above long-form content on the review screen; keep designer **overview** page (`/my-gdad-evidence`) as the map, **per-skill** page for writing. Revisit after user testing (e.g. separate “scores only” view vs single page — see §5.1).

**Special case — Head of Design self-review (agreed):**

- Allow **Head of Design** to open and save scores on **their own** review route (`/review/gdad-evidence/:selfUserId`) for in-person moderation with their manager.
- This does **not** grant broader scorer permissions across other users.
- At a later date, manager-specific delegated access can be added (for example via a dedicated allowlist env var) without changing this self-only rule.

### 5.6 Evidence import from a fixed-layout spreadsheet (no file storage)

**Goal:** Support people who complete a **Defra template** (Excel with consistent cells or a CSV export of that layout). **Upload once** → **extract skill text** → **persist only** structured evidence in **`gdad_evidence_items`** — **do not** store the uploaded file on disk or in the database.

**Feasibility:** **Yes.** Typical pattern:

1. **Download** — serve a **template** (`.csv` and/or `.xlsx`) with one column (or cell range) per `skill_key`, fixed headers; optional row for instructions.
2. **Upload** — `POST` `multipart/form-data`; read file into a **Buffer** in memory only.
3. **Parse** — **CSV:** `csv-parse` / fast-csv. **Excel:** `exceljs` or `xlsx` (SheetJS) **read** from buffer; map named columns or fixed cell addresses to **`skill_key`**, trim text, enforce max length server-side as for manual entry.
4. **Validate** — reject unknown columns, wrong MIME if strict, oversized files (set a sane limit, e.g. 2–5 MB).
5. **Write** — `upsert` evidence rows for **`req.user`** (designer importing **their own** evidence only unless you later allow admin surrogate upload).
6. **Discard** — buffer goes out of scope; no temp files (or secure delete if written for streaming).

**Operational notes:**

- Virus scanning of uploads may be required for production estates — confirm with assurance.
- Optionally **dry-run preview** (“we will save these seven cells — Confirm”) before commit.
- **Access:** Signed-in GDaD-applicable user; same gate as `/my-gdad-evidence`.

### 5.7 Admin export — scores table as Excel (.xlsx)

**Goal:** An **admin** tool that exports **everyone’s scores** (and agreed identifiers) as a **table** downloadable as **Excel**. **Column layout and headers** — **product to supply** a sample table or spreadsheet; implementation maps SQL → sheet.

**Possible scope (TBD until format arrives):**

- One sheet or multiple (e.g. summary + seven skill columns wide).
- Rows: GDaD-eligible designers only (same role gate).
- Cells: identity columns, seven official scores (or blanks), timestamps, computed band once §5.2 exists.

**Access — clarify with sponsors:**

- **Option A:** All **`ADMIN_EMAILS`** (operations / reporting inside support team).
- **Option B:** Same as **`GDAD_HEAD_OF_DESIGN_EMAILS`** only — stricter parity with §5.3 reporting.
- **Option C:** Admins export **operational** extract; HoD retains separate **management** CSV (§5.3).

**Technical:** Prefer **`exceljs`** or **`Writable`** workbook stream → `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`; avoid storing file on disk; treat as sensitive data (HTTPS, logging discipline).

**Relationship to §5.3:** §5.3 is the **narrow** head-of-design export (`GDAD_HEAD_OF_DESIGN_EMAILS`). §5.7 is the **broader** admin table Excel — reconcile access rules so they are not contradictory.

---

## 6. Related files (update)

Section **4** table still applies; add when implementing §5:

| File / area | Role |
|-------------|------|
| `app/gdad/` | Banding calculation, export query, middleware for head-of-design |
| New migration / columns | Banding participation flags, cached band label or aggregate if needed |
| `DEPLOYMENT_GUIDE.md` | `GDAD_HEAD_OF_DESIGN_EMAILS` |
| Evidence import routes + parse | Multipart handlers, CSV/Xlsx mapping to `skill_key`, optional template download |
| Admin Excel export route | Aggregate query → `.xlsx` stream; access per §5.7 |

**When §5.6 ships:** document **request body limit** (`express` / reverse proxy, e.g. Heroku nginx) so large spreadsheets do not truncate silently.

When you have the **admin table structure** or the **import template**, add a short **appendix** to this doc or attach the sample filename under **`reference/`** (optional) so implementers freeze column names.
