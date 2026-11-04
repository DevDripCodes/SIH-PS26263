# Synthetic enrolment fixtures

These fixtures are fictional development data for this repository's AICTE-style enrolment pipeline. They are intended for an isolated Supabase development project. Names, APAAR-shaped numbers, passport-like values, email addresses, phone numbers, institution codes and issuer references are invented; `example.invalid` is a reserved non-deliverable domain. Do not use these values with real identity services.

## What goes where

| File | Load method | Purpose |
| --- | --- | --- |
| `seed_reference_data.sql` | Supabase SQL Editor, as the schema owner | Adds synthetic affiliating bodies, institutions, programs and 2026-27 intake approvals to `master`. |
| `enrolments_inst_001.csv` | Upload through the app's Data Upload page while signed in as that institution's nodal officer | 30 raw enrolment rows for the synthetic Deccan Valley Institute. The app creates its `staging.submission_batches` row and imports rows into `staging.staging_enrolment_records`. |
| `enrolments_inst_002.csv` | Upload through the app's Data Upload page while signed in as that institution's nodal officer | 11 rows for synthetic Coastal Ridge College, including a repeated APAAR-shaped ID to exercise cross-institution duplicate handling after the first batch is promoted. |

The CSVs use the app's canonical upload headers. Do not paste the upload CSVs into `core.student_enrolments` or `master`; the rows intentionally include invalid values that should be retained in `staging` and reported by validation. Supabase's table CSV import is not the supported ingestion path here: it bypasses batch creation, file fingerprints, source-row tracking and the validation queue. If you need to exercise the UI, these files are the CSV upload inputs.

## Setup

1. Use an isolated development Supabase project. Apply the existing schema scripts in the order documented in `database/db_architecture.md` (master, staging, core, trust, analytics, then `integrate.sql`). Run `ingestion_patch.sql` only if you also want the web-form channel; these fixtures use CSV uploads.
2. In SQL Editor, run `seed_reference_data.sql` after the schema scripts. It is transaction-wrapped and uses fixed fixture IDs; it creates no `auth.users` rows and no user profiles.
3. Create/login as test nodal users through Supabase Auth, then add their `master.user_profiles` rows with `INSTITUTION_NODAL_OFFICER` role and the corresponding institution IDs below. Auth user IDs must come from that dev project's `auth.users`; never copy production auth IDs.
4. Upload each CSV separately from its matching institution account. The 2026-27 intake approvals are attached to all listed programs.

| Institution | Fixture UUID | Institution code | Program code(s) |
| --- | --- | --- | --- |
| Deccan Valley Institute of Technology | `b1000000-0000-4000-8000-000000000001` | `SYN-1-9000000001` | `SYN-KA-001-CSE`, `SYN-KA-001-ECE` |
| Coastal Ridge College of Engineering | `b1000000-0000-4000-8000-000000000002` | `SYN-1-9000000002` | `SYN-KA-002-CSE` |
| Western Plains Polytechnic | `b1000000-0000-4000-8000-000000000003` | `SYN-1-9000000003` | `SYN-MH-003-DIP` |

## Scenarios covered

- Normal UG admissions across two courses; EWS, NRI, OCI, PIO, foreign national, CIWGC, TFW, PMSSS and lateral-entry categories.
- Missing and malformed APAAR values (including Excel scientific notation), invalid dates/residency/quota, and an unknown program.
- Duplicate APAAR and roll number inside one upload; the same APAAR-shaped ID in two institutions for the L3 national-lock/cross-institution path.
- Contradictory foreign-national/OCI flags; missing passport and OCI-card details; EWS quota/category mismatch.
- Admission after the configured cutoff; unusual gender value (warning path); malformed optional mobile value for future/adjacent input checks; enough NRI candidates at the second institution to exceed its seeded quota if they reach promotion.

Exact stage behavior depends on enabled services. L1 validation can be exercised with the local app. L2 identity lookup needs a test/mock APAAR registry adapter; otherwise synthetic IDs should be expected to be rejected or marked unavailable by a live registry. L3 scenarios require L2-approved data and maker-checker approval. The second CSV's cross-institution collision is meaningful only after the first matching identity has been promoted. Some scenario rows are intentionally blocked before later stages, so this is a mixed-quality intake fixture rather than a promise that every row reaches promotion.

The first CSV includes passport and contact-shaped values to exercise ingestion and PII-retention flows. They are fake. Use the app's normal purge/retention behavior when testing completed batches; do not leave uploaded raw PII-shaped fields in a shared environment.
