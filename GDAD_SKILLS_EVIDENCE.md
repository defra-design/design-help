# GDaD skills evidence — implementation status and next steps

This is the trimmed working plan for GDaD evidence.

## 1) Baseline / rollback

- Pre-feature baseline tag: `release-2026.05.01.3`
- Quick rollback branch:

```bash
git fetch origin tag release-2026.05.01.3
git checkout -b rollback/pre-gdad release-2026.05.01.3
```

## 2) Product rules (current)

- Seven skills, STAR evidence, private to owner + admin reviewers.
- Official score is Head-of-Design-only: `1`, `2`, `3`.
- Capability level uses best six scores from seven.
- Eligibility excludes:
  - `Accessibility Specialist (SEO)`
  - `Senior Accessibility Specialist (Grade 7)`
  - `Resource Manager`
  - `Senior Resource Manager`

## 3) Delivered (in app)

### Core data and access

- `gdad_evidence_items` table in use.
- Owner can edit evidence; only the designated Head of Design account can set official scores.
- GDaD data is not shown on public browse/profile views.

### Designer experience

- `GET /my-gdad-evidence` summary table (skill, expected level, graded level, score).
- Per-skill edit route: `GET/POST /my-gdad-evidence/:skillKey`.
- Capability panel with best-six total and capability level.
- CSV import flow:
  - `GET/POST /my-gdad-evidence/import-csv`
  - STAR fields imported from template format.
- Grade templates downloadable:
  - `/gdad-reference/template-seo.csv`
  - `/gdad-reference/template-g7.csv`
  - `/gdad-reference/template-g6.csv`

### Reviewer/admin experience

- Review index with grouped status:
  - no/incomplete evidence
  - evidence unscored
  - scored evidence
- Per-person scoring table:
  - `GET/POST /review/gdad-evidence/:userId`
- Per-skill review page:
  - `GET/POST /review/gdad-evidence/:userId/:skillKey`
- Admin CSV export:
  - `GET /review/gdad-evidence/export.csv`
  - output aligned to `reference/Export.csv`
- Admins can review all evidence; score editing is restricted to designated Head of Design account(s).

## 4) Confirmed scoring/banding rule

- Use six highest scores from seven.
- Total range: `6..18`.
- Capability levels:

| Capability level | Rating | Total |
| --- | --- | --- |
| 1 | Developing | 6–8 |
| 2 | Proficient Level 1 | 9–11 |
| 3 | Proficient Level 2 | 12–13 |
| 4 | Proficient Level 3 | 14–15 |
| 5 | Accomplished Level 1 | 16–17 |
| 6 | Accomplished Level 2 | 18 |

## 5) Remaining work (short backlog)

1. **Governance decision:** confirm export access model:
   - admin-only (current), or
   - head-of-design-only via allowlist parity with score editing.
2. **CSV import hardening:** optional preview/confirm step before save.
3. **Audit trail:** optional score/evidence change history.
4. **Docs cleanup:** align README/DEPLOYMENT/GDaD docs with final access rules.
5. **Optional later:** xlsx upload/export if still required.

## 6) Key files

- `app/gdad/constants.js`
- `app/gdad/routes.js`
- `app/gdad/csv-import.js`
- `app/views/my-gdad-evidence-summary.html`
- `app/views/my-gdad-evidence-import.html`
- `app/views/review-gdad-index.html`
- `app/views/admin-gdad-evidence.html`
- `app/views/admin-gdad-evidence-skill.html`
