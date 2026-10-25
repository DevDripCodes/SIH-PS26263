BEGIN;

-- ============================================================================
-- ZONE 5: `analytics.*` (Pre-aggregated Dashboards, backend-only, scope-enforced)
-- Depends on: master, staging, core and trust scripts (needs trust.current_actor, trust.forbid_mutation).
-- Access model: backend-only. NOBODY (anon / authenticated / service_role) can SELECT a materialized view directly.
--   Materialized views cannot carry RLS, so every read goes through a SECURITY DEFINER function that resolves the
--   caller from the transaction-local actor (set_config('app.actor_user_id', '<uuid>', true)) and filters by scope.
--
-- VULNERABILITY REGISTER (each item is closed below and asserted in 05b_analytics_tests.sql)
--   A01 Matview has no RLS -> direct SELECT leaks every institution  -> no grants; reads only via scoped functions
--   A02 Default privileges hand service_role ALL (script 1)          -> default privileges revoked, REVOKE ALL on every relation
--   A03 Functions are EXECUTE-able by PUBLIC by default              -> explicit REVOKE + allow-list GRANT to service_role
--   A04 No actor / inactive user / wrong role                        -> fail closed (exception), never "see everything"
--   A05 NULL scope column turns a filter into "match all"            -> role-specific scope, NULL = no match; regional officer without region denied
--   A06 Out-of-scope institution id passed as a filter              -> empty result (no error), so ids cannot be probed
--   A07 Student-level / PII columns reaching dashboards              -> aggregates only; test scans every matview column name
--   A08 Small-cell re-identification on public figures               -> public_national_summary: k>=10 suppression + rounding to 5
--   A09 SQL injection through dashboard filters                      -> typed params, year regex, no dynamic SQL in read paths
--   A10 Unbounded result sets / offsets                              -> limit clamped to 1..500, offset clamped 0..100000, statement_timeout 10s
--   A11 REFRESH CONCURRENTLY impossible without unique index         -> unique index on every matview (no NULL-able key columns)
--   A12 Refresh storms / DoS                                         -> advisory lock, 30s throttle per view, force only for super admin
--   A13 Refresh by an unauthorised user                              -> actor (if any) must be AICTE_SUPER_ADMIN
--   A14 Refresh log tampering                                        -> append-only triggers (ENABLE ALWAYS), no direct grants
--   A15 Stale numbers shown as live                                  -> every row carries computed_at; get_freshness()
--   A16 Counter drift between master counters and core truth         -> mv_quota_reconciliation
--   A17 Divide by zero in fill percentages                           -> NULLIF everywhere
--   A18 Day buckets off by 5h30 (UTC vs IST)                         -> all day / month buckets use Asia/Kolkata
--   A19 SECURITY DEFINER search_path hijack                          -> every function pins search_path = pg_catalog, pg_temp; all names qualified
--   A20 Error text leaking data                                      -> refresh log stores SQLSTATE only, never the message
--   A21 Seat accounting blind spot (NRI is inside the sanctioned pool) -> over_sanctioned_flag (regular + NRI > sanctioned)
-- ============================================================================

DO $$
BEGIN
    IF to_regclass('core.student_enrolments') IS NULL OR to_regclass('core.students') IS NULL
       OR to_regclass('staging.submission_batches') IS NULL OR to_regclass('staging.validation_anomalies') IS NULL
       OR to_regclass('trust.academic_credentials') IS NULL OR to_regclass('trust.employer_verification_logs') IS NULL
       OR to_regclass('master.program_intake_approvals') IS NULL
       OR to_regprocedure('trust.forbid_mutation()') IS NULL OR to_regprocedure('trust.current_actor()') IS NULL THEN
        RAISE EXCEPTION 'analytics schema: run the master, staging, core and trust scripts first';
    END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS analytics;

-- A02 / A03: strip what script 1 handed out, and make FUTURE objects closed by default.
REVOKE ALL ON SCHEMA analytics FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA analytics TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA analytics REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA analytics REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA analytics REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 1. MATERIALIZED VIEWS (aggregates only; no student-level or contact columns)
-- ----------------------------------------------------------------------------

-- 1.1 Seat utilisation per programme intake approval
DROP MATERIALIZED VIEW IF EXISTS analytics.mv_seat_utilisation CASCADE;
CREATE MATERIALIZED VIEW analytics.mv_seat_utilisation AS
SELECT a.intake_approval_id, a.academic_year,
       i.institution_id, i.institution_name, i.aicte_region::text AS aicte_region, i.state_code::text AS state_code,
       i.affiliating_body_id,
       p.program_id, p.aicte_course_id, p.course_name, p.program_level, p.program_shift,
       a.approved_sanctioned_intake, a.actual_regular_enrolled,
       a.approved_nri_seats, a.actual_nri_enrolled,
       a.approved_supernumerary_tfw, a.actual_tfw_enrolled,
       a.approved_supernumerary_fn_oci_ciwgc, a.actual_fn_oci_ciwgc_enrolled,
       a.approved_supernumerary_pmsss, a.actual_pmsss_enrolled,
       a.approved_supernumerary_ews, a.actual_ews_enrolled,
       a.approved_lateral_entry_seats, a.actual_lateral_enrolled,
       (a.actual_regular_enrolled + a.actual_nri_enrolled) AS sanctioned_pool_enrolled,
       ROUND(100.0 * (a.actual_regular_enrolled + a.actual_nri_enrolled) / NULLIF(a.approved_sanctioned_intake, 0), 1) AS sanctioned_fill_pct,
       ((a.actual_regular_enrolled + a.actual_nri_enrolled) > a.approved_sanctioned_intake) AS over_sanctioned_flag,
       (a.approved_nri_seats > CEIL(0.05 * a.approved_sanctioned_intake)
        OR a.approved_supernumerary_tfw > CEIL(0.05 * a.approved_sanctioned_intake)
        OR a.approved_supernumerary_fn_oci_ciwgc > CEIL(0.15 * a.approved_sanctioned_intake)) AS policy_cap_flag,
       a.is_locked_by_aicte, a.admission_cutoff_date,
       now() AS computed_at
  FROM master.program_intake_approvals a
  JOIN master.institutional_programs p ON p.program_id = a.program_id
  JOIN master.institutions i ON i.institution_id = a.institution_id
WITH DATA;
CREATE UNIQUE INDEX uq_mv_seat_util ON analytics.mv_seat_utilisation (intake_approval_id);
CREATE INDEX ix_mv_seat_util_scope ON analytics.mv_seat_utilisation (academic_year, institution_id);

-- 1.2 Enrolment counts by quota / residency / status (counts only)
DROP MATERIALIZED VIEW IF EXISTS analytics.mv_enrolment_summary CASCADE;
CREATE MATERIALIZED VIEW analytics.mv_enrolment_summary AS
SELECT e.academic_year, e.institution_id, e.program_id, e.seat_quota_type, s.residency_status, e.enrolment_status,
       i.aicte_region::text AS aicte_region, i.affiliating_body_id, p.program_level,
       count(*)::bigint AS enrolment_count,
       now() AS computed_at
  FROM core.student_enrolments e
  JOIN core.students s ON s.student_id = e.student_id
  JOIN master.institutions i ON i.institution_id = e.institution_id
  JOIN master.institutional_programs p ON p.program_id = e.program_id
 GROUP BY e.academic_year, e.institution_id, e.program_id, e.seat_quota_type, s.residency_status, e.enrolment_status,
          i.aicte_region, i.affiliating_body_id, p.program_level
WITH DATA;
CREATE UNIQUE INDEX uq_mv_enrol_sum ON analytics.mv_enrolment_summary
    (academic_year, institution_id, program_id, seat_quota_type, residency_status, enrolment_status);

-- 1.3 Upload pipeline health per institution per IST day
DROP MATERIALIZED VIEW IF EXISTS analytics.mv_pipeline_daily CASCADE;
CREATE MATERIALIZED VIEW analytics.mv_pipeline_daily AS
SELECT b.institution_id, b.academic_year, (b.uploaded_at AT TIME ZONE 'Asia/Kolkata')::date AS upload_day_ist,
       i.aicte_region::text AS aicte_region, i.affiliating_body_id,
       count(*)::bigint AS batches,
       count(*) FILTER (WHERE b.status IN ('COMPLETED', 'COMPLETED_WITH_ANOMALIES'))::bigint AS batches_finished,
       count(*) FILTER (WHERE b.status IN ('FAILED', 'CANCELLED'))::bigint AS batches_failed,
       count(*) FILTER (WHERE b.status NOT IN ('COMPLETED', 'COMPLETED_WITH_ANOMALIES', 'FAILED', 'CANCELLED'))::bigint AS batches_in_flight,
       COALESCE(sum(b.total_rows) FILTER (WHERE b.status IN ('COMPLETED', 'COMPLETED_WITH_ANOMALIES')), 0)::bigint AS rows_finished,
       COALESCE(sum(b.l1_rejected_rows) FILTER (WHERE b.status IN ('COMPLETED', 'COMPLETED_WITH_ANOMALIES')), 0)::bigint AS l1_rejected_rows,
       COALESCE(sum(b.l2_quarantined_rows) FILTER (WHERE b.status IN ('COMPLETED', 'COMPLETED_WITH_ANOMALIES')), 0)::bigint AS l2_quarantined_rows,
       COALESCE(sum(b.l3_quarantined_rows) FILTER (WHERE b.status IN ('COMPLETED', 'COMPLETED_WITH_ANOMALIES')), 0)::bigint AS l3_quarantined_rows,
       COALESCE(sum(b.promoted_rows) FILTER (WHERE b.status IN ('COMPLETED', 'COMPLETED_WITH_ANOMALIES')), 0)::bigint AS promoted_rows,
       ROUND(100.0 * sum(b.promoted_rows) FILTER (WHERE b.status IN ('COMPLETED', 'COMPLETED_WITH_ANOMALIES'))
             / NULLIF(sum(b.total_rows) FILTER (WHERE b.status IN ('COMPLETED', 'COMPLETED_WITH_ANOMALIES')), 0), 1) AS promotion_rate_pct,
       ROUND(avg(EXTRACT(EPOCH FROM (b.completed_at - b.processing_started_at)))
             FILTER (WHERE b.completed_at IS NOT NULL AND b.processing_started_at IS NOT NULL)::numeric, 1) AS avg_processing_seconds,
       now() AS computed_at
  FROM staging.submission_batches b
  JOIN master.institutions i ON i.institution_id = b.institution_id
 GROUP BY b.institution_id, b.academic_year, (b.uploaded_at AT TIME ZONE 'Asia/Kolkata')::date, i.aicte_region, i.affiliating_body_id
WITH DATA;
CREATE UNIQUE INDEX uq_mv_pipeline_daily ON analytics.mv_pipeline_daily (institution_id, academic_year, upload_day_ist);

-- 1.4 Anomaly hot-spots (codes and counts only; offending_value is never aggregated)
DROP MATERIALIZED VIEW IF EXISTS analytics.mv_anomaly_summary CASCADE;
CREATE MATERIALIZED VIEW analytics.mv_anomaly_summary AS
SELECT a.institution_id, b.academic_year, date_trunc('month', a.created_at AT TIME ZONE 'Asia/Kolkata')::date AS month_ist,
       a.anomaly_code, a.severity, a.validation_level, a.is_resolved,
       i.aicte_region::text AS aicte_region, i.affiliating_body_id,
       count(*)::bigint AS anomaly_count,
       count(DISTINCT a.record_id)::bigint AS affected_rows,
       now() AS computed_at
  FROM staging.validation_anomalies a
  JOIN staging.submission_batches b ON b.batch_id = a.batch_id
  JOIN master.institutions i ON i.institution_id = a.institution_id
 GROUP BY a.institution_id, b.academic_year, date_trunc('month', a.created_at AT TIME ZONE 'Asia/Kolkata')::date,
          a.anomaly_code, a.severity, a.validation_level, a.is_resolved, i.aicte_region, i.affiliating_body_id
WITH DATA;
CREATE UNIQUE INDEX uq_mv_anomaly_summary ON analytics.mv_anomaly_summary
    (institution_id, academic_year, month_ist, anomaly_code, severity, validation_level, is_resolved);

-- 1.5 Credential inventory
DROP MATERIALIZED VIEW IF EXISTS analytics.mv_credential_status CASCADE;
CREATE MATERIALIZED VIEW analytics.mv_credential_status AS
SELECT c.institution_id, c.academic_year, c.credential_type, c.status,
       i.aicte_region::text AS aicte_region, i.affiliating_body_id,
       count(*)::bigint AS credential_count,
       max(c.issued_at) AS last_issued_at,
       now() AS computed_at
  FROM trust.academic_credentials c
  JOIN master.institutions i ON i.institution_id = c.institution_id
 GROUP BY c.institution_id, c.academic_year, c.credential_type, c.status, i.aicte_region, i.affiliating_body_id
WITH DATA;
CREATE UNIQUE INDEX uq_mv_credential_status ON analytics.mv_credential_status (institution_id, academic_year, credential_type, status);

-- 1.6 National verification traffic (no organisation or student identity, org TYPE only)
DROP MATERIALIZED VIEW IF EXISTS analytics.mv_verification_daily CASCADE;
CREATE MATERIALIZED VIEW analytics.mv_verification_daily AS
SELECT (l.requested_at AT TIME ZONE 'Asia/Kolkata')::date AS day_ist, o.org_type, l.purpose, l.outcome,
       count(*)::bigint AS verification_count,
       count(DISTINCT l.verifier_org_id)::bigint AS distinct_orgs,
       now() AS computed_at
  FROM trust.employer_verification_logs l
  JOIN trust.verifier_organisations o ON o.verifier_org_id = l.verifier_org_id
 GROUP BY (l.requested_at AT TIME ZONE 'Asia/Kolkata')::date, o.org_type, l.purpose, l.outcome
WITH DATA;
CREATE UNIQUE INDEX uq_mv_verification_daily ON analytics.mv_verification_daily (day_ist, org_type, purpose, outcome);

-- 1.7 Reconciliation: master counters vs the truth in core.student_enrolments (all statuses, since counters never decrement)
DROP MATERIALIZED VIEW IF EXISTS analytics.mv_quota_reconciliation CASCADE;
CREATE MATERIALIZED VIEW analytics.mv_quota_reconciliation AS
WITH c AS (
    SELECT e.intake_approval_id,
           count(*) FILTER (WHERE e.seat_quota_type = 'REGULAR_SANCTIONED')       AS n_regular,
           count(*) FILTER (WHERE e.seat_quota_type = 'NRI_QUOTA')                AS n_nri,
           count(*) FILTER (WHERE e.seat_quota_type = 'SUPERNUMERARY_TFW')        AS n_tfw,
           count(*) FILTER (WHERE e.seat_quota_type = 'SUPERNUMERARY_FN_OCI_CIWGC') AS n_fn,
           count(*) FILTER (WHERE e.seat_quota_type = 'SUPERNUMERARY_PMSSS')      AS n_pmsss,
           count(*) FILTER (WHERE e.seat_quota_type = 'SUPERNUMERARY_EWS')        AS n_ews,
           count(*) FILTER (WHERE e.seat_quota_type = 'LATERAL_ENTRY')            AS n_lateral
      FROM core.student_enrolments e GROUP BY e.intake_approval_id)
SELECT a.intake_approval_id, a.academic_year, a.institution_id,
       i.aicte_region::text AS aicte_region, i.affiliating_body_id,
       (a.actual_regular_enrolled      - COALESCE(c.n_regular, 0))::int AS drift_regular,
       (a.actual_nri_enrolled          - COALESCE(c.n_nri, 0))::int     AS drift_nri,
       (a.actual_tfw_enrolled          - COALESCE(c.n_tfw, 0))::int     AS drift_tfw,
       (a.actual_fn_oci_ciwgc_enrolled - COALESCE(c.n_fn, 0))::int      AS drift_fn_oci_ciwgc,
       (a.actual_pmsss_enrolled        - COALESCE(c.n_pmsss, 0))::int   AS drift_pmsss,
       (a.actual_ews_enrolled          - COALESCE(c.n_ews, 0))::int     AS drift_ews,
       (a.actual_lateral_enrolled      - COALESCE(c.n_lateral, 0))::int AS drift_lateral,
       (a.actual_regular_enrolled <> COALESCE(c.n_regular, 0) OR a.actual_nri_enrolled <> COALESCE(c.n_nri, 0)
        OR a.actual_tfw_enrolled <> COALESCE(c.n_tfw, 0) OR a.actual_fn_oci_ciwgc_enrolled <> COALESCE(c.n_fn, 0)
        OR a.actual_pmsss_enrolled <> COALESCE(c.n_pmsss, 0) OR a.actual_ews_enrolled <> COALESCE(c.n_ews, 0)
        OR a.actual_lateral_enrolled <> COALESCE(c.n_lateral, 0)) AS has_drift,
       now() AS computed_at
  FROM master.program_intake_approvals a
  JOIN master.institutions i ON i.institution_id = a.institution_id
  LEFT JOIN c ON c.intake_approval_id = a.intake_approval_id
WITH DATA;
CREATE UNIQUE INDEX uq_mv_quota_recon ON analytics.mv_quota_reconciliation (intake_approval_id);

-- ----------------------------------------------------------------------------
-- 2. REFRESH LOG (append-only)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS analytics.refresh_log (
    refresh_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    view_name TEXT NOT NULL CHECK (view_name ~ '^mv_[a-z_]+$'),
    started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('OK', 'FAILED')),
    triggered_by UUID,                       -- soft reference to the actor, NULL for system / cron
    error_sqlstate CHAR(5),                  -- A20: SQLSTATE only, never the message text
    CHECK (finished_at >= started_at)
);
CREATE INDEX IF NOT EXISTS idx_refresh_log_view ON analytics.refresh_log (view_name, finished_at DESC) WHERE status = 'OK';

CREATE OR REPLACE TRIGGER trg_refresh_log_immutable
    BEFORE UPDATE OR DELETE ON analytics.refresh_log
    FOR EACH ROW EXECUTE FUNCTION trust.forbid_mutation();
CREATE OR REPLACE TRIGGER trg_refresh_log_no_truncate
    BEFORE TRUNCATE ON analytics.refresh_log
    FOR EACH STATEMENT EXECUTE FUNCTION trust.forbid_mutation();

-- ----------------------------------------------------------------------------
-- 3. INTERNAL HELPERS (callable only by the owner, i.e. from inside the definer functions)
-- ----------------------------------------------------------------------------

-- A04 / A05: resolve the caller; fail closed. Exactly one scope dimension is populated per role.
CREATE OR REPLACE FUNCTION analytics.current_scope()
RETURNS TABLE (s_all BOOLEAN, s_institution_id UUID, s_region TEXT, s_body_id UUID)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_actor UUID := trust.current_actor();
    u master.user_profiles%ROWTYPE;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'analytics: an acting user is required' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO u FROM master.user_profiles up WHERE up.user_id = v_actor AND up.is_active = TRUE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'analytics: not an active user' USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF u.role = 'AICTE_SUPER_ADMIN' THEN
        RETURN QUERY SELECT TRUE, NULL::uuid, NULL::text, NULL::uuid;
    ELSIF u.role = 'AICTE_REGIONAL_OFFICER' AND u.aicte_region IS NOT NULL THEN
        RETURN QUERY SELECT FALSE, NULL::uuid, u.aicte_region::text, NULL::uuid;
    ELSIF u.role = 'AFFILIATING_BODY_REGISTRAR' AND u.affiliating_body_id IS NOT NULL THEN
        RETURN QUERY SELECT FALSE, NULL::uuid, NULL::text, u.affiliating_body_id;
    ELSIF u.role = 'INSTITUTION_NODAL_OFFICER' AND u.institution_id IS NOT NULL THEN
        RETURN QUERY SELECT FALSE, u.institution_id, NULL::text, NULL::uuid;
    ELSE
        RAISE EXCEPTION 'analytics: this role has no analytics access' USING ERRCODE = 'insufficient_privilege';
    END IF;
END;
$$;

-- A08: small-cell suppression + rounding for anything that may leave the AICTE officer audience.
CREATE OR REPLACE FUNCTION analytics.suppress_small(p_n BIGINT, p_k INT DEFAULT 10)
RETURNS BIGINT
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT CASE WHEN p_n IS NULL OR p_n < p_k THEN NULL ELSE (round(p_n / 5.0) * 5)::bigint END;
$$;

CREATE OR REPLACE FUNCTION analytics.check_year(p_year TEXT)
RETURNS VOID
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF p_year IS NULL OR p_year !~ '^[0-9]{4}-[0-9]{2}$' THEN
        RAISE EXCEPTION 'analytics: academic year must look like 2026-27' USING ERRCODE = 'invalid_parameter_value';
    END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. READ API (SECURITY DEFINER, scope-filtered, bounded). The ONLY way to read the matviews.
--    Scope predicate (identical everywhere):
--      sc.s_all OR m.institution_id = sc.s_institution_id OR m.aicte_region = sc.s_region OR m.affiliating_body_id = sc.s_body_id
--    NULL = no match, so a missing scope value can never widen access.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION analytics.get_seat_utilisation(
    p_academic_year TEXT, p_institution_id UUID DEFAULT NULL, p_only_flagged BOOLEAN DEFAULT FALSE,
    p_limit INT DEFAULT 100, p_offset INT DEFAULT 0)
RETURNS SETOF analytics.mv_seat_utilisation
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET statement_timeout = '10s'
AS $$
DECLARE sc RECORD;
BEGIN
    SELECT * INTO sc FROM analytics.current_scope();
    PERFORM analytics.check_year(p_academic_year);
    RETURN QUERY
    SELECT m.* FROM analytics.mv_seat_utilisation m
     WHERE m.academic_year = p_academic_year
       AND (sc.s_all OR m.institution_id = sc.s_institution_id OR m.aicte_region = sc.s_region OR m.affiliating_body_id = sc.s_body_id)
       AND (p_institution_id IS NULL OR m.institution_id = p_institution_id)
       AND (NOT COALESCE(p_only_flagged, FALSE) OR m.over_sanctioned_flag OR m.policy_cap_flag)
     ORDER BY m.institution_name, m.course_name, m.intake_approval_id
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500) OFFSET LEAST(GREATEST(COALESCE(p_offset, 0), 0), 100000);
END;
$$;

CREATE OR REPLACE FUNCTION analytics.get_enrolment_summary(
    p_academic_year TEXT, p_institution_id UUID DEFAULT NULL, p_limit INT DEFAULT 100, p_offset INT DEFAULT 0)
RETURNS SETOF analytics.mv_enrolment_summary
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET statement_timeout = '10s'
AS $$
DECLARE sc RECORD;
BEGIN
    SELECT * INTO sc FROM analytics.current_scope();
    PERFORM analytics.check_year(p_academic_year);
    RETURN QUERY
    SELECT m.* FROM analytics.mv_enrolment_summary m
     WHERE m.academic_year = p_academic_year
       AND (sc.s_all OR m.institution_id = sc.s_institution_id OR m.aicte_region = sc.s_region OR m.affiliating_body_id = sc.s_body_id)
       AND (p_institution_id IS NULL OR m.institution_id = p_institution_id)
     ORDER BY m.institution_id, m.program_id, m.seat_quota_type, m.residency_status, m.enrolment_status
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500) OFFSET LEAST(GREATEST(COALESCE(p_offset, 0), 0), 100000);
END;
$$;

CREATE OR REPLACE FUNCTION analytics.get_pipeline_daily(
    p_from DATE, p_to DATE, p_institution_id UUID DEFAULT NULL, p_limit INT DEFAULT 100, p_offset INT DEFAULT 0)
RETURNS SETOF analytics.mv_pipeline_daily
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET statement_timeout = '10s'
AS $$
DECLARE sc RECORD;
BEGIN
    SELECT * INTO sc FROM analytics.current_scope();
    IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 366 THEN
        RAISE EXCEPTION 'analytics: date range must be valid and at most 366 days' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    RETURN QUERY
    SELECT m.* FROM analytics.mv_pipeline_daily m
     WHERE m.upload_day_ist BETWEEN p_from AND p_to
       AND (sc.s_all OR m.institution_id = sc.s_institution_id OR m.aicte_region = sc.s_region OR m.affiliating_body_id = sc.s_body_id)
       AND (p_institution_id IS NULL OR m.institution_id = p_institution_id)
     ORDER BY m.upload_day_ist DESC, m.institution_id, m.academic_year
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500) OFFSET LEAST(GREATEST(COALESCE(p_offset, 0), 0), 100000);
END;
$$;

CREATE OR REPLACE FUNCTION analytics.get_anomaly_summary(
    p_academic_year TEXT, p_institution_id UUID DEFAULT NULL, p_only_unresolved BOOLEAN DEFAULT FALSE,
    p_limit INT DEFAULT 100, p_offset INT DEFAULT 0)
RETURNS SETOF analytics.mv_anomaly_summary
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET statement_timeout = '10s'
AS $$
DECLARE sc RECORD;
BEGIN
    SELECT * INTO sc FROM analytics.current_scope();
    PERFORM analytics.check_year(p_academic_year);
    RETURN QUERY
    SELECT m.* FROM analytics.mv_anomaly_summary m
     WHERE m.academic_year = p_academic_year
       AND (sc.s_all OR m.institution_id = sc.s_institution_id OR m.aicte_region = sc.s_region OR m.affiliating_body_id = sc.s_body_id)
       AND (p_institution_id IS NULL OR m.institution_id = p_institution_id)
       AND (NOT COALESCE(p_only_unresolved, FALSE) OR NOT m.is_resolved)
     ORDER BY m.anomaly_count DESC, m.institution_id, m.month_ist DESC, m.anomaly_code
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500) OFFSET LEAST(GREATEST(COALESCE(p_offset, 0), 0), 100000);
END;
$$;

CREATE OR REPLACE FUNCTION analytics.get_credential_status(
    p_academic_year TEXT, p_institution_id UUID DEFAULT NULL, p_limit INT DEFAULT 100, p_offset INT DEFAULT 0)
RETURNS SETOF analytics.mv_credential_status
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET statement_timeout = '10s'
AS $$
DECLARE sc RECORD;
BEGIN
    SELECT * INTO sc FROM analytics.current_scope();
    PERFORM analytics.check_year(p_academic_year);
    RETURN QUERY
    SELECT m.* FROM analytics.mv_credential_status m
     WHERE m.academic_year = p_academic_year
       AND (sc.s_all OR m.institution_id = sc.s_institution_id OR m.aicte_region = sc.s_region OR m.affiliating_body_id = sc.s_body_id)
       AND (p_institution_id IS NULL OR m.institution_id = p_institution_id)
     ORDER BY m.institution_id, m.credential_type, m.status
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500) OFFSET LEAST(GREATEST(COALESCE(p_offset, 0), 0), 100000);
END;
$$;

-- National traffic: AICTE officers only (super admin or regional officer).
CREATE OR REPLACE FUNCTION analytics.get_verification_daily(
    p_from DATE, p_to DATE, p_limit INT DEFAULT 100, p_offset INT DEFAULT 0)
RETURNS SETOF analytics.mv_verification_daily
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET statement_timeout = '10s'
AS $$
DECLARE sc RECORD;
BEGIN
    SELECT * INTO sc FROM analytics.current_scope();
    IF NOT (sc.s_all OR sc.s_region IS NOT NULL) THEN
        RAISE EXCEPTION 'analytics: verification traffic is restricted to AICTE officers' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 366 THEN
        RAISE EXCEPTION 'analytics: date range must be valid and at most 366 days' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    RETURN QUERY
    SELECT m.* FROM analytics.mv_verification_daily m
     WHERE m.day_ist BETWEEN p_from AND p_to
     ORDER BY m.day_ist DESC, m.org_type, m.purpose, m.outcome
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500) OFFSET LEAST(GREATEST(COALESCE(p_offset, 0), 0), 100000);
END;
$$;

-- Counter-vs-truth drift. Super admin sees all; regional officers see their region.
CREATE OR REPLACE FUNCTION analytics.get_quota_reconciliation(
    p_academic_year TEXT, p_only_drift BOOLEAN DEFAULT TRUE, p_limit INT DEFAULT 100, p_offset INT DEFAULT 0)
RETURNS SETOF analytics.mv_quota_reconciliation
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET statement_timeout = '10s'
AS $$
DECLARE sc RECORD;
BEGIN
    SELECT * INTO sc FROM analytics.current_scope();
    IF NOT (sc.s_all OR sc.s_region IS NOT NULL) THEN
        RAISE EXCEPTION 'analytics: reconciliation is restricted to AICTE officers' USING ERRCODE = 'insufficient_privilege';
    END IF;
    PERFORM analytics.check_year(p_academic_year);
    RETURN QUERY
    SELECT m.* FROM analytics.mv_quota_reconciliation m
     WHERE m.academic_year = p_academic_year
       AND (sc.s_all OR m.aicte_region = sc.s_region)
       AND (NOT COALESCE(p_only_drift, TRUE) OR m.has_drift)
     ORDER BY m.institution_id, m.intake_approval_id
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500) OFFSET LEAST(GREATEST(COALESCE(p_offset, 0), 0), 100000);
END;
$$;

-- Public-safe national figures (no actor needed; the backend may serve them on an unauthenticated page).
-- Grain is FIXED (year x level x residency) so callers cannot difference overlapping slices; cells < 10 are hidden.
CREATE OR REPLACE FUNCTION analytics.public_national_summary(p_academic_year TEXT)
RETURNS TABLE (academic_year TEXT, program_level master.program_level_enum,
               residency_status master.residency_status_enum, active_enrolments_approx BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET statement_timeout = '10s'
AS $$
BEGIN
    PERFORM analytics.check_year(p_academic_year);
    RETURN QUERY
    SELECT m.academic_year::text, m.program_level, m.residency_status,
           analytics.suppress_small(sum(m.enrolment_count)::bigint)
      FROM analytics.mv_enrolment_summary m
     WHERE m.academic_year = p_academic_year AND m.enrolment_status = 'VERIFIED_ACTIVE'
     GROUP BY m.academic_year, m.program_level, m.residency_status
     ORDER BY m.program_level, m.residency_status;
END;
$$;

-- A15: how old is each dashboard?
CREATE OR REPLACE FUNCTION analytics.get_freshness()
RETURNS TABLE (view_name TEXT, last_ok_at TIMESTAMPTZ, age_seconds NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE sc RECORD;
BEGIN
    SELECT * INTO sc FROM analytics.current_scope();
    RETURN QUERY
    SELECT v.name::text, max(l.finished_at),
           ROUND(EXTRACT(EPOCH FROM (clock_timestamp() - max(l.finished_at)))::numeric, 0)
      FROM unnest(ARRAY['mv_seat_utilisation', 'mv_enrolment_summary', 'mv_pipeline_daily', 'mv_anomaly_summary',
                        'mv_credential_status', 'mv_verification_daily', 'mv_quota_reconciliation']) AS v(name)
      LEFT JOIN analytics.refresh_log l ON l.view_name = v.name AND l.status = 'OK'
     GROUP BY v.name ORDER BY v.name;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. REFRESH API
-- ----------------------------------------------------------------------------
-- Called by the BullMQ worker (system, no actor) or by a super admin. View names are a hard-coded list, never input.
-- Each view refreshes in its own subtransaction, so one failure does not abort the rest.
-- NOTE: views are refreshed one after another, so two views can differ by a few seconds. Compare computed_at if it matters.

CREATE OR REPLACE FUNCTION analytics.refresh_all(p_force BOOLEAN DEFAULT FALSE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET statement_timeout = '10min'
AS $$
DECLARE
    c_throttle CONSTANT INTERVAL := interval '30 seconds';
    c_views CONSTANT TEXT[] := ARRAY['mv_seat_utilisation', 'mv_enrolment_summary', 'mv_pipeline_daily',
                                     'mv_anomaly_summary', 'mv_credential_status', 'mv_verification_daily',
                                     'mv_quota_reconciliation'];
    v_actor UUID := trust.current_actor();
    v_name TEXT;
    v_last TIMESTAMPTZ;
    v_t0 TIMESTAMPTZ;
    v_status TEXT;
    v_state TEXT;
    v_result JSONB := '{}'::jsonb;
BEGIN
    IF v_actor IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM master.user_profiles up
         WHERE up.user_id = v_actor AND up.is_active = TRUE AND up.role = 'AICTE_SUPER_ADMIN') THEN
        RAISE EXCEPTION 'analytics.refresh_all: only an AICTE super admin or the system may refresh' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF COALESCE(p_force, FALSE) AND v_actor IS NULL THEN
        RAISE EXCEPTION 'analytics.refresh_all: force requires an acting super admin' USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF NOT pg_try_advisory_xact_lock(hashtextextended('analytics.refresh_all', 0)) THEN
        RETURN jsonb_build_object('status', 'SKIPPED_LOCKED');
    END IF;

    FOREACH v_name IN ARRAY c_views LOOP
        SELECT max(l.finished_at) INTO v_last FROM analytics.refresh_log l WHERE l.view_name = v_name AND l.status = 'OK';
        IF NOT COALESCE(p_force, FALSE) AND v_last IS NOT NULL AND v_last > clock_timestamp() - c_throttle THEN
            v_result := v_result || jsonb_build_object(v_name, 'THROTTLED');
            CONTINUE;
        END IF;

        v_t0 := clock_timestamp();
        v_state := NULL;
        BEGIN
            EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.%I', v_name);
            v_status := 'OK';
        EXCEPTION WHEN OTHERS THEN
            v_status := 'FAILED';
            v_state := SQLSTATE;
        END;

        INSERT INTO analytics.refresh_log (view_name, started_at, finished_at, status, triggered_by, error_sqlstate)
        VALUES (v_name, v_t0, clock_timestamp(), v_status, v_actor, v_state);
        v_result := v_result || jsonb_build_object(v_name, v_status);
    END LOOP;

    RETURN jsonb_build_object('status', 'DONE', 'views', v_result);
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. SELF-CHECK (run in CI and after every deploy): returns one row per failed control; empty = all good
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION analytics.verify_analytics_security()
RETURNS TABLE (problem TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    r RECORD;
    v_role TEXT;
BEGIN
    FOR r IN SELECT c.oid, c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'analytics' AND c.relkind IN ('r', 'm', 'v') LOOP
        FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
            IF has_table_privilege(v_role, r.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') THEN
                problem := format('role %s has table privileges on analytics.%s', v_role, r.relname); RETURN NEXT;
            END IF;
        END LOOP;
        IF r.relkind = 'm' AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = r.oid AND i.indisunique AND i.indpred IS NULL) THEN
            problem := format('matview analytics.%s has no unique index (cannot REFRESH CONCURRENTLY)', r.relname); RETURN NEXT;
        END IF;
    END LOOP;

    FOR r IN SELECT p.oid, p.proname, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'analytics' LOOP
        IF has_function_privilege('anon', r.oid, 'EXECUTE') OR has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN
            problem := format('anon/authenticated can execute analytics.%s', r.proname); RETURN NEXT;
        END IF;
        IF r.proconfig IS NULL OR NOT ('search_path=pg_catalog, pg_temp' = ANY (r.proconfig)) THEN
            problem := format('analytics.%s does not pin search_path', r.proname); RETURN NEXT;
        END IF;
    END LOOP;

    FOR r IN SELECT a.attrelid::regclass::text AS rel, a.attname FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
               JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'analytics' AND c.relkind = 'm' AND a.attnum > 0 AND NOT a.attisdropped
                AND a.attname ~* '(apaar|passport|email|mobile|phone|dob|birth|offending|(^|_)roll(_|$)|full_name|student_id|oci_card|frro|aadhaar)' LOOP
        problem := format('personal-data-looking column %s.%s', r.rel, r.attname); RETURN NEXT;
    END LOOP;
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. ACCESS CONTROL
-- ----------------------------------------------------------------------------

ALTER TABLE analytics.refresh_log ENABLE ROW LEVEL SECURITY;      -- matviews cannot have RLS; that is why they have no grants

REVOKE ALL ON ALL TABLES IN SCHEMA analytics FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA analytics FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA analytics FROM PUBLIC, anon, authenticated, service_role;

-- Public API for the Node.js backend (allow-list). current_scope / suppress_small / check_year stay owner-only.
GRANT EXECUTE ON FUNCTION
    analytics.get_seat_utilisation(TEXT, UUID, BOOLEAN, INT, INT),
    analytics.get_enrolment_summary(TEXT, UUID, INT, INT),
    analytics.get_pipeline_daily(DATE, DATE, UUID, INT, INT),
    analytics.get_anomaly_summary(TEXT, UUID, BOOLEAN, INT, INT),
    analytics.get_credential_status(TEXT, UUID, INT, INT),
    analytics.get_verification_daily(DATE, DATE, INT, INT),
    analytics.get_quota_reconciliation(TEXT, BOOLEAN, INT, INT),
    analytics.public_national_summary(TEXT),
    analytics.get_freshness(),
    analytics.refresh_all(BOOLEAN),
    analytics.verify_analytics_security()
TO service_role;

-- A14: integrity triggers must also fire under session_replication_role = replica.
ALTER TABLE analytics.refresh_log ENABLE ALWAYS TRIGGER trg_refresh_log_immutable;
ALTER TABLE analytics.refresh_log ENABLE ALWAYS TRIGGER trg_refresh_log_no_truncate;

COMMIT;