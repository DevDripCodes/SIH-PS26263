-- ============================================================================
-- 06_patch_v1_1.sql : PATCH for scripts 01 (master) .. 05 (analytics)
-- Target: Supabase / PostgreSQL 14+ (needs CREATE OR REPLACE TRIGGER, pg_trigger.tgparentid = PG13+)
-- Run as the schema owner (postgres), AFTER scripts 01-05.  Safe to re-run.
--
-- STATUS: written from a static review. It has NOT been executed against a database.
--         Run it on a staging copy first, then run your own test suites (04b / 05b) and
--         `SELECT * FROM master.verify_security_baseline();` (empty result = all controls in place).
--
-- WHAT THIS PATCH DOES
--   B1  Staging: adds resolved_student_id / resolved_admission_date (Stage 4 could not run without them)
--   A   Anomaly enum: adds DUPLICATE_ROLL_NO_IN_PROGRAM, QUOTA_RESIDENCY_MISMATCH (own transaction)
--   B3  Master: composite FK program<->institution, NRI <= sanctioned CHECK, counter guard trigger,
--       audit of cap changes, master.quota_residency_rules (data-driven quota<->residency rules)
--   B4  Master RLS: region / registrar scoped helper, pinned search_path
--   B5  Core: stricter enrolment_guard, lock-delete guard, student_accounts, partition maintenance,
--       enrolment_status_history, identity-change audit
--   B6  Stage 4: promote_program_batch v1.1 (NRI inside sanctioned pool, quota<->residency check,
--       idempotent re-uploads, correct enum) and promote_batch (idempotent)
--   B7  Trust: actor contract is mandatory (fail closed)
--   B8  Staging: two-stage PII retention (purge_batch_identity, run_retention)
--   B9  Privileges: strip TRUNCATE/REFERENCES/TRIGGER (+ selected DELETE) from service_role,
--       revoke PUBLIC/anon/authenticated EXECUTE on all functions, ENABLE ALWAYS on integrity triggers
--   B10 master.verify_security_baseline() self-check
--
-- NOT CHANGED (needs a business or architecture decision, see the reference doc, section 13):
--   counters never decrement on withdrawal; part-time/ODL exemption from the national lock;
--   audit-chain sharding for credentials/consents; HMAC vs plain SHA-256 chain; DPDP erasure design;
--   dedicated least-privilege DB roles (patch still assumes service_role).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PART A (own transaction): enum values can be used only after this COMMIT
-- ----------------------------------------------------------------------------
BEGIN;
ALTER TYPE staging.anomaly_code_enum ADD VALUE IF NOT EXISTS 'DUPLICATE_ROLL_NO_IN_PROGRAM';
ALTER TYPE staging.anomaly_code_enum ADD VALUE IF NOT EXISTS 'QUOTA_RESIDENCY_MISMATCH';
COMMIT;

-- ----------------------------------------------------------------------------
-- PART B
-- ----------------------------------------------------------------------------
BEGIN;

-- B0. Pre-flight ---------------------------------------------------------------
DO $$
BEGIN
    IF to_regclass('master.program_intake_approvals') IS NULL
       OR to_regclass('staging.staging_enrolment_records') IS NULL
       OR to_regclass('core.student_enrolments') IS NULL
       OR to_regclass('trust.immutable_audit_logs') IS NULL
       OR to_regprocedure('trust.forbid_mutation()') IS NULL
       OR to_regprocedure('trust.log_audit_event(text,text,text,uuid,uuid,jsonb)') IS NULL THEN
        RAISE EXCEPTION 'patch 06: run scripts 01-05 first';
    END IF;
    PERFORM 'DUPLICATE_ROLL_NO_IN_PROGRAM'::staging.anomaly_code_enum;
    PERFORM 'QUOTA_RESIDENCY_MISMATCH'::staging.anomaly_code_enum;
END $$;

-- ============================================================================
-- B1. STAGING: columns Stage 4 depends on
-- ============================================================================
ALTER TABLE staging.staging_enrolment_records
    ADD COLUMN IF NOT EXISTS resolved_student_id UUID,       -- soft reference to core.students (no FK by design)
    ADD COLUMN IF NOT EXISTS resolved_admission_date DATE;   -- parsed from raw_admission_date by Worker #1

ALTER TABLE staging.submission_batches
    ADD COLUMN IF NOT EXISTS identity_purged_at TIMESTAMPTZ; -- set by staging.purge_batch_identity()

-- ============================================================================
-- B3. MASTER: integrity, counter guard, audit, quota<->residency rules
-- ============================================================================

-- 3.1 A program and its intake approval must belong to the SAME institution.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'uq_programs_id_institution'
                      AND conrelid = 'master.institutional_programs'::regclass) THEN
        ALTER TABLE master.institutional_programs
            ADD CONSTRAINT uq_programs_id_institution UNIQUE (program_id, institution_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'fk_intake_program_institution'
                      AND conrelid = 'master.program_intake_approvals'::regclass) THEN
        ALTER TABLE master.program_intake_approvals
            ADD CONSTRAINT fk_intake_program_institution
            FOREIGN KEY (program_id, institution_id)
            REFERENCES master.institutional_programs (program_id, institution_id) ON DELETE RESTRICT
            NOT VALID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'chk_intake_nri_within_sanctioned'
                      AND conrelid = 'master.program_intake_approvals'::regclass) THEN
        ALTER TABLE master.program_intake_approvals
            ADD CONSTRAINT chk_intake_nri_within_sanctioned
            CHECK (approved_nri_seats <= approved_sanctioned_intake) NOT VALID;
    END IF;

    -- Existing rows are validated now; if legacy data violates a rule you get a NOTICE and fix the rows, then
    -- run: ALTER TABLE master.program_intake_approvals VALIDATE CONSTRAINT <name>;
    BEGIN
        ALTER TABLE master.program_intake_approvals VALIDATE CONSTRAINT fk_intake_program_institution;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'fk_intake_program_institution left NOT VALID (existing rows violate it): %', SQLERRM;
    END;
    BEGIN
        ALTER TABLE master.program_intake_approvals VALIDATE CONSTRAINT chk_intake_nri_within_sanctioned;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'chk_intake_nri_within_sanctioned left NOT VALID (existing rows violate it): %', SQLERRM;
    END;
END $$;

-- 3.2 Counters may only INCREASE within the approved caps (lowering a cap later never blocks other updates).
--     NRI seats live inside the sanctioned pool, so regular + NRI is checked against the sanctioned intake.
CREATE OR REPLACE FUNCTION master.intake_counter_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF (NEW.actual_regular_enrolled > OLD.actual_regular_enrolled OR NEW.actual_nri_enrolled > OLD.actual_nri_enrolled)
       AND NEW.actual_regular_enrolled + NEW.actual_nri_enrolled > NEW.approved_sanctioned_intake THEN
        RAISE EXCEPTION 'program_intake_approvals %: regular + NRI enrolments (%) would exceed the sanctioned intake (%)',
            NEW.intake_approval_id, NEW.actual_regular_enrolled + NEW.actual_nri_enrolled, NEW.approved_sanctioned_intake
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.actual_nri_enrolled > OLD.actual_nri_enrolled AND NEW.actual_nri_enrolled > NEW.approved_nri_seats THEN
        RAISE EXCEPTION 'program_intake_approvals %: NRI enrolments would exceed the approved NRI seats', NEW.intake_approval_id
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.actual_tfw_enrolled > OLD.actual_tfw_enrolled AND NEW.actual_tfw_enrolled > NEW.approved_supernumerary_tfw THEN
        RAISE EXCEPTION 'program_intake_approvals %: TFW enrolments would exceed the approved cap', NEW.intake_approval_id
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.actual_fn_oci_ciwgc_enrolled > OLD.actual_fn_oci_ciwgc_enrolled
       AND NEW.actual_fn_oci_ciwgc_enrolled > NEW.approved_supernumerary_fn_oci_ciwgc THEN
        RAISE EXCEPTION 'program_intake_approvals %: FN/OCI/CIWGC enrolments would exceed the approved cap', NEW.intake_approval_id
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.actual_pmsss_enrolled > OLD.actual_pmsss_enrolled AND NEW.actual_pmsss_enrolled > NEW.approved_supernumerary_pmsss THEN
        RAISE EXCEPTION 'program_intake_approvals %: PMSSS enrolments would exceed the approved cap', NEW.intake_approval_id
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.actual_ews_enrolled > OLD.actual_ews_enrolled AND NEW.actual_ews_enrolled > NEW.approved_supernumerary_ews THEN
        RAISE EXCEPTION 'program_intake_approvals %: EWS enrolments would exceed the approved cap', NEW.intake_approval_id
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.actual_lateral_enrolled > OLD.actual_lateral_enrolled AND NEW.actual_lateral_enrolled > NEW.approved_lateral_entry_seats THEN
        RAISE EXCEPTION 'program_intake_approvals %: lateral-entry enrolments would exceed the approved cap', NEW.intake_approval_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_intake_counter_guard
    BEFORE UPDATE ON master.program_intake_approvals
    FOR EACH ROW EXECUTE FUNCTION master.intake_counter_guard();

-- 3.3 Tamper-evident record of every change to caps / lock flag / cut-off (ids and numbers only, no PII).
CREATE OR REPLACE FUNCTION master.intake_caps_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF (NEW.approved_sanctioned_intake, NEW.approved_nri_seats, NEW.approved_supernumerary_tfw,
        NEW.approved_supernumerary_fn_oci_ciwgc, NEW.approved_supernumerary_pmsss, NEW.approved_supernumerary_ews,
        NEW.approved_lateral_entry_seats, NEW.is_locked_by_aicte, NEW.eoa_letter_ref_no, NEW.admission_cutoff_date)
       IS DISTINCT FROM
       (OLD.approved_sanctioned_intake, OLD.approved_nri_seats, OLD.approved_supernumerary_tfw,
        OLD.approved_supernumerary_fn_oci_ciwgc, OLD.approved_supernumerary_pmsss, OLD.approved_supernumerary_ews,
        OLD.approved_lateral_entry_seats, OLD.is_locked_by_aicte, OLD.eoa_letter_ref_no, OLD.admission_cutoff_date) THEN
        PERFORM trust.log_audit_event('app_master', 'INTAKE.CAPS_CHANGED', 'INTAKE_APPROVAL',
            NEW.intake_approval_id, NEW.institution_id,
            jsonb_build_object(
                'academic_year', NEW.academic_year,
                'old', jsonb_build_object('sanctioned', OLD.approved_sanctioned_intake, 'nri', OLD.approved_nri_seats,
                        'tfw', OLD.approved_supernumerary_tfw, 'fn_oci_ciwgc', OLD.approved_supernumerary_fn_oci_ciwgc,
                        'pmsss', OLD.approved_supernumerary_pmsss, 'ews', OLD.approved_supernumerary_ews,
                        'lateral', OLD.approved_lateral_entry_seats, 'locked', OLD.is_locked_by_aicte,
                        'eoa_ref', OLD.eoa_letter_ref_no, 'cutoff', OLD.admission_cutoff_date),
                'new', jsonb_build_object('sanctioned', NEW.approved_sanctioned_intake, 'nri', NEW.approved_nri_seats,
                        'tfw', NEW.approved_supernumerary_tfw, 'fn_oci_ciwgc', NEW.approved_supernumerary_fn_oci_ciwgc,
                        'pmsss', NEW.approved_supernumerary_pmsss, 'ews', NEW.approved_supernumerary_ews,
                        'lateral', NEW.approved_lateral_entry_seats, 'locked', NEW.is_locked_by_aicte,
                        'eoa_ref', NEW.eoa_letter_ref_no, 'cutoff', NEW.admission_cutoff_date)));
    END IF;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER trg_intake_caps_audit
    AFTER UPDATE ON master.program_intake_approvals
    FOR EACH ROW EXECUTE FUNCTION master.intake_caps_audit();

-- 3.4 Quota <-> residency rules (data-driven). A quota WITH rows is restricted to the listed residency
--     statuses; a quota WITHOUT rows is unrestricted.
--     !! The seed below is a starting point. Confirm it against the current AICTE Approval Process Handbook. !!
CREATE TABLE IF NOT EXISTS master.quota_residency_rules (
    seat_quota_type  master.seat_quota_type_enum   NOT NULL,
    residency_status master.residency_status_enum  NOT NULL,
    PRIMARY KEY (seat_quota_type, residency_status)
);

INSERT INTO master.quota_residency_rules (seat_quota_type, residency_status) VALUES
    ('NRI_QUOTA', 'NRI'), ('NRI_QUOTA', 'OCI'), ('NRI_QUOTA', 'PIO'),
    ('SUPERNUMERARY_FN_OCI_CIWGC', 'FOREIGN_NATIONAL'), ('SUPERNUMERARY_FN_OCI_CIWGC', 'OCI'),
    ('SUPERNUMERARY_FN_OCI_CIWGC', 'CIWGC')
ON CONFLICT DO NOTHING;

ALTER TABLE master.quota_residency_rules ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- B4. MASTER RLS: region / registrar aware, pinned search_path
--     NOTE: authenticated has no table grants on master.*, so these policies are inert until you deliberately
--     grant SELECT. They are corrected so that granting never over-exposes a region.
-- ============================================================================
ALTER FUNCTION master.current_user_institution_id() SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION master.current_user_role()           SET search_path = pg_catalog, pg_temp;

CREATE OR REPLACE FUNCTION master.can_read_institution(p_institution_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    u master.user_profiles%ROWTYPE;
    v_region TEXT;
    v_body UUID;
BEGIN
    SELECT * INTO u FROM master.user_profiles up WHERE up.user_id = auth.uid() AND up.is_active = TRUE;
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    IF u.role = 'AICTE_SUPER_ADMIN' THEN
        RETURN TRUE;
    END IF;
    IF u.role = 'INSTITUTION_NODAL_OFFICER' THEN
        RETURN u.institution_id IS NOT NULL AND u.institution_id = p_institution_id;
    END IF;
    SELECT i.aicte_region, i.affiliating_body_id INTO v_region, v_body
      FROM master.institutions i WHERE i.institution_id = p_institution_id;
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    IF u.role = 'AICTE_REGIONAL_OFFICER' THEN
        RETURN u.aicte_region IS NOT NULL AND u.aicte_region = v_region;
    END IF;
    IF u.role = 'AFFILIATING_BODY_REGISTRAR' THEN
        RETURN u.affiliating_body_id IS NOT NULL AND u.affiliating_body_id = v_body;
    END IF;
    RETURN FALSE;
END;
$$;

DROP POLICY IF EXISTS pol_institutions_read ON master.institutions;
DROP POLICY IF EXISTS pol_programs_read ON master.institutional_programs;
DROP POLICY IF EXISTS pol_intake_read ON master.program_intake_approvals;

CREATE POLICY pol_institutions_read ON master.institutions
    FOR SELECT TO authenticated USING (master.can_read_institution(institution_id));
CREATE POLICY pol_programs_read ON master.institutional_programs
    FOR SELECT TO authenticated USING (master.can_read_institution(institution_id));
CREATE POLICY pol_intake_read ON master.program_intake_approvals
    FOR SELECT TO authenticated USING (master.can_read_institution(institution_id));

-- ============================================================================
-- B5. CORE
-- ============================================================================

-- 5.1 enrolment_guard v1.1: + quota<->residency invariant on INSERT, + admission_date / entry year immutable
CREATE OR REPLACE FUNCTION core.enrolment_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_res master.residency_status_enum;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NOT EXISTS (
            SELECT 1 FROM master.program_intake_approvals a
            WHERE a.intake_approval_id = NEW.intake_approval_id
              AND a.program_id = NEW.program_id
              AND a.institution_id = NEW.institution_id
              AND a.academic_year = NEW.academic_year
        ) THEN
            RAISE EXCEPTION 'core.student_enrolments: intake_approval_id % does not match institution/program/year of this enrolment', NEW.intake_approval_id
                USING ERRCODE = 'foreign_key_violation';
        END IF;
        IF EXISTS (SELECT 1 FROM master.quota_residency_rules q WHERE q.seat_quota_type = NEW.seat_quota_type) THEN
            SELECT s.residency_status INTO v_res FROM core.students s WHERE s.student_id = NEW.student_id;
            IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM master.quota_residency_rules q
                                         WHERE q.seat_quota_type = NEW.seat_quota_type AND q.residency_status = v_res) THEN
                RAISE EXCEPTION 'core.student_enrolments: quota % is not open to residency status %', NEW.seat_quota_type, v_res
                    USING ERRCODE = 'check_violation';
            END IF;
        END IF;
    ELSE
        IF NEW.academic_year <> OLD.academic_year OR NEW.student_id <> OLD.student_id
           OR NEW.institution_id <> OLD.institution_id OR NEW.program_id <> OLD.program_id
           OR NEW.intake_approval_id <> OLD.intake_approval_id OR NEW.seat_quota_type <> OLD.seat_quota_type
           OR NEW.admission_date <> OLD.admission_date OR NEW.entry_year_of_study <> OLD.entry_year_of_study THEN
            RAISE EXCEPTION 'core.student_enrolments: identity, placement, quota and admission columns are immutable'
                USING ERRCODE = 'check_violation';
        END IF;
        IF OLD.enrolment_status <> NEW.enrolment_status THEN
            IF NEW.enrolment_status = 'VERIFIED_ACTIVE' THEN
                RAISE EXCEPTION 'core.student_enrolments: cannot re-activate an ended enrolment (create a new one via Stage 4)'
                    USING ERRCODE = 'check_violation';
            END IF;
            NEW.status_changed_at := NOW();
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- 5.2 A national lock may not disappear while its enrolment is still ACTIVE (checked at commit).
CREATE OR REPLACE FUNCTION core.guard_lock_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM core.student_enrolments e
                WHERE e.enrolment_id = OLD.enrolment_id AND e.academic_year = OLD.academic_year
                  AND e.enrolment_status = 'VERIFIED_ACTIVE')
       AND NOT EXISTS (SELECT 1 FROM core.active_national_enrolment_locks l WHERE l.enrolment_id = OLD.enrolment_id) THEN
        RAISE EXCEPTION 'core.active_national_enrolment_locks: lock for active enrolment % was removed', OLD.enrolment_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_locks_guard_delete ON core.active_national_enrolment_locks;
CREATE CONSTRAINT TRIGGER trg_locks_guard_delete
    AFTER DELETE ON core.active_national_enrolment_locks
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION core.guard_lock_delete();

-- 5.3 Link between a Supabase login (role STUDENT) and the national student record.
--     Backend resolves p_student_id for trust.withdraw_consent() / consent grants from this table.
CREATE TABLE IF NOT EXISTS core.student_accounts (
    user_id     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    student_id  UUID NOT NULL UNIQUE REFERENCES core.students(student_id) ON DELETE RESTRICT,
    link_method VARCHAR(20) NOT NULL CHECK (link_method IN ('DIGILOCKER', 'OTP_ESIGN', 'ADMIN_VERIFIED')),
    linked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION core.student_account_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NOT EXISTS (SELECT 1 FROM master.user_profiles up
                        WHERE up.user_id = NEW.user_id AND up.is_active = TRUE AND up.role = 'STUDENT') THEN
            RAISE EXCEPTION 'student_accounts: user must be an active STUDENT profile' USING ERRCODE = 'check_violation';
        END IF;
    ELSIF (to_jsonb(NEW) - ARRAY['updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['updated_at']) THEN
        RAISE EXCEPTION 'student_accounts: link is immutable (unlink and re-link instead)' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_student_accounts_guard
    BEFORE INSERT OR UPDATE ON core.student_accounts
    FOR EACH ROW EXECUTE FUNCTION core.student_account_guard();
CREATE OR REPLACE TRIGGER trg_student_accounts_updated_at
    BEFORE UPDATE ON core.student_accounts
    FOR EACH ROW EXECUTE FUNCTION master.set_updated_at();

CREATE OR REPLACE FUNCTION core.student_id_for_user(p_user_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT a.student_id FROM core.student_accounts a WHERE a.user_id = p_user_id;
$$;

ALTER TABLE core.student_accounts ENABLE ROW LEVEL SECURITY;

-- 5.4 Partition maintenance: current academic year -1 .. +p_years_ahead (labels like 2026-27)
CREATE OR REPLACE FUNCTION core.ensure_enrolment_partitions(p_years_ahead INT DEFAULT 3)
RETURNS SETOF TEXT
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_start INT := EXTRACT(YEAR FROM (now() AT TIME ZONE 'Asia/Kolkata'))::int - 1;
    y INT;
BEGIN
    IF p_years_ahead IS NULL OR p_years_ahead NOT BETWEEN 0 AND 10 THEN
        RAISE EXCEPTION 'ensure_enrolment_partitions: p_years_ahead must be between 0 and 10';
    END IF;
    FOR y IN v_start .. (v_start + 1 + p_years_ahead) LOOP
        RETURN NEXT core.create_enrolment_partition(y::text || '-' || lpad(((y + 1) % 100)::text, 2, '0'));
    END LOOP;
END;
$$;

-- 5.5 Append-only enrolment status history + audit event
CREATE TABLE IF NOT EXISTS core.enrolment_status_history (
    history_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    enrolment_id   UUID NOT NULL,
    academic_year  CHAR(7) NOT NULL,
    student_id     UUID NOT NULL,
    institution_id UUID NOT NULL,
    from_status    core.enrolment_status_enum NOT NULL,
    to_status      core.enrolment_status_enum NOT NULL,
    changed_by     UUID,                                  -- soft reference, from app.actor_user_id
    request_id     TEXT,
    changed_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_enrol_hist_enrolment ON core.enrolment_status_history (enrolment_id, changed_at);
CREATE INDEX IF NOT EXISTS idx_enrol_hist_student   ON core.enrolment_status_history (student_id, changed_at);

CREATE OR REPLACE TRIGGER trg_enrol_hist_immutable
    BEFORE UPDATE OR DELETE ON core.enrolment_status_history
    FOR EACH ROW EXECUTE FUNCTION trust.forbid_mutation();
CREATE OR REPLACE TRIGGER trg_enrol_hist_no_truncate
    BEFORE TRUNCATE ON core.enrolment_status_history
    FOR EACH STATEMENT EXECUTE FUNCTION trust.forbid_mutation();

CREATE OR REPLACE FUNCTION core.enrolment_status_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF NEW.enrolment_status <> OLD.enrolment_status THEN
        INSERT INTO core.enrolment_status_history (enrolment_id, academic_year, student_id, institution_id,
                                                   from_status, to_status, changed_by, request_id)
        VALUES (NEW.enrolment_id, NEW.academic_year, NEW.student_id, NEW.institution_id,
                OLD.enrolment_status, NEW.enrolment_status, trust.current_actor(), trust.current_request_id());
        PERFORM trust.log_audit_event('app_core', 'ENROLMENT.STATUS_CHANGED', 'ENROLMENT',
            NEW.enrolment_id, NEW.institution_id,
            jsonb_build_object('from', OLD.enrolment_status, 'to', NEW.enrolment_status,
                               'student_id', NEW.student_id, 'academic_year', NEW.academic_year));
    END IF;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER trg_enrolments_status_log
    AFTER UPDATE OF enrolment_status ON core.student_enrolments
    FOR EACH ROW EXECUTE FUNCTION core.enrolment_status_log();

ALTER TABLE core.enrolment_status_history ENABLE ROW LEVEL SECURITY;

-- 5.6 Identity changes are audited by FIELD NAME only (never the values)
CREATE OR REPLACE FUNCTION core.student_identity_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_fields TEXT[] := ARRAY[]::TEXT[];
BEGIN
    IF NEW.apaar_id IS DISTINCT FROM OLD.apaar_id THEN v_fields := array_append(v_fields, 'apaar_id'); END IF;
    IF NEW.apaar_verification_status IS DISTINCT FROM OLD.apaar_verification_status THEN
        v_fields := array_append(v_fields, 'apaar_verification_status'); END IF;
    IF NEW.full_name IS DISTINCT FROM OLD.full_name THEN v_fields := array_append(v_fields, 'full_name'); END IF;
    IF NEW.date_of_birth IS DISTINCT FROM OLD.date_of_birth THEN v_fields := array_append(v_fields, 'date_of_birth'); END IF;
    IF NEW.gender IS DISTINCT FROM OLD.gender THEN v_fields := array_append(v_fields, 'gender'); END IF;
    IF NEW.residency_status IS DISTINCT FROM OLD.residency_status THEN v_fields := array_append(v_fields, 'residency_status'); END IF;
    IF NEW.nationality_country_code IS DISTINCT FROM OLD.nationality_country_code THEN
        v_fields := array_append(v_fields, 'nationality_country_code'); END IF;

    IF cardinality(v_fields) > 0 THEN
        PERFORM trust.log_audit_event('app_core', 'STUDENT.IDENTITY_CHANGED', 'STUDENT', NEW.student_id, NULL,
                                      jsonb_build_object('fields', to_jsonb(v_fields)));
    END IF;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER trg_students_identity_audit
    AFTER UPDATE ON core.students
    FOR EACH ROW EXECUTE FUNCTION core.student_identity_audit();

-- ============================================================================
-- B6. STAGE 4 v1.1
--   * uses resolved_student_id / resolved_admission_date (now exist)
--   * DUPLICATE_ROLL_NO_IN_PROGRAM is a real enum value
--   * quota <-> residency check (master.quota_residency_rules)
--   * already-enrolled rows (same student, institution, program, year, quota) are accepted as no-ops
--     (re-uploading a corrected file no longer quarantines the 980 good rows)
--   * NRI seats are part of the sanctioned pool: NRI <= approved_nri_seats AND regular + NRI <= sanctioned
-- ============================================================================

CREATE OR REPLACE FUNCTION core.promote_program_batch(p_batch_id UUID, p_program_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_batch       staging.submission_batches%ROWTYPE;
    v_intake      master.program_intake_approvals%ROWTYPE;
    v_found       BOOLEAN;
    v_cutoff      DATE;
    v_promoted    INT := 0;
    v_existing    INT := 0;
    v_quarantined INT := 0;
    v_by_code     JSONB := '{}'::jsonb;
    n_regular INT := 0; n_nri INT := 0; n_tfw INT := 0; n_fn INT := 0;
    n_pmsss INT := 0; n_ews INT := 0; n_lateral INT := 0;
BEGIN
    -- 0. Batch + program intake -------------------------------------------------
    SELECT * INTO v_batch FROM staging.submission_batches WHERE batch_id = p_batch_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'promote_program_batch: batch % not found', p_batch_id;
    END IF;
    IF v_batch.status NOT IN ('L2_COMPLETED', 'L3_PROCESSING') THEN
        RAISE EXCEPTION 'promote_program_batch: batch % is in status % (expected L2_COMPLETED or L3_PROCESSING)', p_batch_id, v_batch.status;
    END IF;
    IF v_batch.status = 'L2_COMPLETED' THEN
        UPDATE staging.submission_batches
           SET status = 'L3_PROCESSING', processing_started_at = COALESCE(processing_started_at, NOW())
         WHERE batch_id = p_batch_id AND status = 'L2_COMPLETED';
    END IF;

    -- Row lock: serialises every concurrent upload that targets this program + year
    SELECT * INTO v_intake FROM master.program_intake_approvals a
     WHERE a.program_id = p_program_id
       AND a.academic_year = v_batch.academic_year
       AND a.institution_id = v_batch.institution_id
     FOR UPDATE;
    v_found := FOUND;

    IF NOT v_found OR v_intake.is_locked_by_aicte THEN
        WITH hit AS (
            UPDATE staging.staging_enrolment_records r
               SET validation_status = 'QUARANTINED', rejected_at_level = 3
             WHERE r.batch_id = p_batch_id AND r.resolved_program_id = p_program_id AND r.validation_status = 'L2_VERIFIED'
            RETURNING r.record_id, r.institution_id, r.raw_program_code
        )
        INSERT INTO staging.validation_anomalies (batch_id, record_id, institution_id, anomaly_code, validation_level,
                                                  field_name, offending_value, message, fix_hint)
        SELECT p_batch_id, h.record_id, h.institution_id,
               (CASE WHEN v_found THEN 'PROGRAM_LOCKED_BY_AICTE' ELSE 'PROGRAM_NOT_APPROVED_FOR_YEAR' END)::staging.anomaly_code_enum,
               3, 'raw_program_code', h.raw_program_code,
               CASE WHEN v_found THEN 'Program intake is locked by AICTE; no further admissions can be promoted.'
                    ELSE 'No AICTE intake approval exists for this program, institution and academic year.' END,
               'Contact the AICTE regional office to confirm the Extension of Approval for this program and year.'
          FROM hit h;
        GET DIAGNOSTICS v_quarantined = ROW_COUNT;
        RETURN jsonb_build_object('batch_id', p_batch_id, 'program_id', p_program_id, 'promoted', 0,
                                  'already_enrolled', 0, 'quarantined', v_quarantined,
                                  'by_code', jsonb_build_object(CASE WHEN v_found THEN 'PROGRAM_LOCKED_BY_AICTE' ELSE 'PROGRAM_NOT_APPROVED_FOR_YEAR' END, v_quarantined));
    END IF;

    v_cutoff := (v_intake.admission_cutoff_date AT TIME ZONE 'Asia/Kolkata')::DATE;

    -- 1a. Identity not present in core.students -----------------------------------
    WITH hit AS (
        UPDATE staging.staging_enrolment_records r
           SET validation_status = 'QUARANTINED', rejected_at_level = 2
         WHERE r.batch_id = p_batch_id AND r.resolved_program_id = p_program_id AND r.validation_status = 'L2_VERIFIED'
           AND (r.resolved_student_id IS NULL
                OR NOT EXISTS (SELECT 1 FROM core.students s WHERE s.student_id = r.resolved_student_id))
        RETURNING r.record_id, r.institution_id, r.raw_apaar_id
    )
    INSERT INTO staging.validation_anomalies (batch_id, record_id, institution_id, anomaly_code, validation_level,
                                              field_name, offending_value, message, fix_hint)
    SELECT p_batch_id, h.record_id, h.institution_id, 'APAAR_NOT_FOUND', 2, 'raw_apaar_id', h.raw_apaar_id,
           'Student is not present in the verified national registry.',
           'Re-submit this row once APAAR verification succeeds for the student.'
      FROM hit h;

    -- 1b. APAAR revoked ----------------------------------------------------------
    WITH hit AS (
        UPDATE staging.staging_enrolment_records r
           SET validation_status = 'QUARANTINED', rejected_at_level = 2
          FROM core.students s
         WHERE r.batch_id = p_batch_id AND r.resolved_program_id = p_program_id AND r.validation_status = 'L2_VERIFIED'
           AND s.student_id = r.resolved_student_id AND s.apaar_verification_status = 'REVOKED'
        RETURNING r.record_id, r.institution_id, r.raw_apaar_id
    )
    INSERT INTO staging.validation_anomalies (batch_id, record_id, institution_id, anomaly_code, validation_level,
                                              field_name, offending_value, message, fix_hint)
    SELECT p_batch_id, h.record_id, h.institution_id, 'APAAR_INACTIVE', 2, 'raw_apaar_id', h.raw_apaar_id,
           'The APAAR id of this student has been revoked.',
           'Ask the student to obtain a valid APAAR id before enrolment.'
      FROM hit h;

    -- 1c. Missing quota type -----------------------------------------------------
    WITH hit AS (
        UPDATE staging.staging_enrolment_records r
           SET validation_status = 'QUARANTINED', rejected_at_level = 3
         WHERE r.batch_id = p_batch_id AND r.resolved_program_id = p_program_id AND r.validation_status = 'L2_VERIFIED'
           AND r.resolved_quota_type IS NULL
        RETURNING r.record_id, r.institution_id, r.raw_seat_quota_type
    )
    INSERT INTO staging.validation_anomalies (batch_id, record_id, institution_id, anomaly_code, validation_level,
                                              field_name, offending_value, message, fix_hint)
    SELECT p_batch_id, h.record_id, h.institution_id, 'INVALID_SEAT_QUOTA_TYPE', 3, 'raw_seat_quota_type', h.raw_seat_quota_type,
           'Seat quota type could not be resolved.', 'Use one of the approved seat quota types and re-submit.'
      FROM hit h;

    -- 1c2. Quota not open to the student's residency status (NEW) -------------------
    WITH hit AS (
        UPDATE staging.staging_enrolment_records r
           SET validation_status = 'QUARANTINED', rejected_at_level = 3
          FROM core.students s
         WHERE r.batch_id = p_batch_id AND r.resolved_program_id = p_program_id AND r.validation_status = 'L2_VERIFIED'
           AND s.student_id = r.resolved_student_id
           AND EXISTS (SELECT 1 FROM master.quota_residency_rules q WHERE q.seat_quota_type = r.resolved_quota_type)
           AND NOT EXISTS (SELECT 1 FROM master.quota_residency_rules q
                            WHERE q.seat_quota_type = r.resolved_quota_type AND q.residency_status = s.residency_status)
        RETURNING r.record_id, r.institution_id, r.raw_seat_quota_type, r.resolved_quota_type, s.residency_status
    )
    INSERT INTO staging.validation_anomalies (batch_id, record_id, institution_id, anomaly_code, validation_level,
                                              field_name, offending_value, message, fix_hint, details)
    SELECT p_batch_id, h.record_id, h.institution_id, 'QUOTA_RESIDENCY_MISMATCH', 3, 'raw_seat_quota_type', h.raw_seat_quota_type,
           'This seat quota is not open to the residency status verified for the student.',
           'Admit the student under the quota that matches the verified residency status, or correct the residency documents.',
           jsonb_build_object('quota', h.resolved_quota_type, 'student_residency', h.residency_status)
      FROM hit h;

    -- 1f. Same student twice in this program of the batch -------------------------
    WITH dup AS (
        SELECT r.record_id,
               row_number() OVER (PARTITION BY r.resolved_student_id ORDER BY r.source_row_number) AS rn
          FROM staging.staging_enrolment_records r
         WHERE r.batch_id = p_batch_id AND r.resolved_program_id = p_program_id AND r.validation_status = 'L2_VERIFIED'
    ), hit AS (
        UPDATE staging.staging_enrolment_records r
           SET validation_status = 'QUARANTINED', rejected_at_level = 3
          FROM dup d
         WHERE r.record_id = d.record_id AND d.rn > 1
        RETURNING r.record_id, r.institution_id, r.raw_apaar_id
    )
    INSERT INTO staging.validation_anomalies (batch_id, record_id, institution_id, anomaly_code, validation_level,
                                              field_name, offending_value, message, fix_hint)
    SELECT p_batch_id, h.record_id, h.institution_id, 'DUPLICATE_APAAR_IN_BATCH', 3, 'raw_apaar_id', h.raw_apaar_id,
           'The same student appears more than once for this program in this upload.',
           'Keep a single row per student.'
      FROM hit h;

    -- 1h. Already enrolled (same student / institution / program / year / quota): idempotent no-op (NEW) ------
    WITH ex AS (
        SELECT r.record_id, e.enrolment_id
          FROM staging.staging_enrolment_records r
          JOIN core.student_enrolments e
            ON e.student_id = r.resolved_student_id
           AND e.program_id = p_program_id
           AND e.institution_id = r.institution_id
           AND e.academic_year = r.academic_year
           AND e.seat_quota_type = r.resolved_quota_type
           AND e.enrolment_status = 'VERIFIED_ACTIVE'
         WHERE r.batch_id = p_batch_id AND r.resolved_program_id = p_program_id AND r.validation_status = 'L2_VERIFIED'
    ), upd AS (
        UPDATE staging.staging_enrolment_records r
           SET validation_status = 'VALID', promoted_enrolment_id = ex.enrolment_id, promoted_at = NOW()
          FROM ex
         WHERE r.record_id = ex.record_id
        RETURNING r.record_id
    )
    SELECT count(*) INTO v_existing FROM upd;

    -- 1d. Missing admission date -------------------------------------------------
    WITH hit AS (
        UPDATE staging.staging_enrolment_records r
           SET validation_status = 'QUARANTINED', rejected_at_level = 3
         WHERE r.batch_id = p_batch_id AND r.resolved_program_id = p_program_id AND r.validation_status = 'L2_VERIFIED'
           AND r.resolved_admission_date IS NULL
        RETURNING r.record_id, r.institution_id, r.raw_admission_date
    )
    INSERT INTO staging.validation_anomalies (batch_id, record_id, institution_id, anomaly_code, validation_level,
                                              field_name, offending_value, message, fix_hint)
    SELECT p_batch_id, h.record_id, h.institution_id, 'MISSING_REQUIRED_FIELD', 3, 'raw_admission_date', h.raw_admission_date,
           'Admission date is missing or unreadable.', 'Provide the admission date as YYYY-MM-DD and re-submit.'
      FROM hit h;

    -- 1e. Admission after the AICTE cut-off date ----------------------------------
    WITH hit AS (
        UPDATE staging.staging_enrolment_records r
           SET validation_status = 'QUARANTINED', rejected_at_level = 3
         WHERE r.batch_id = p_batch_id AND r.resolved_program_id = p_program_id AND r.validation_status = 'L2_VERIFIED'
           AND r.resolved_admission_date > v_cutoff
        RETURNING r.record_id, r.institution_id, r.resolved_admission_date
    )
    INSERT INTO staging.validation_anomalies (batch_id, record_id, institution_id, anomaly_code, validation_level,
                                              field_name, offending_value, message, fix_hint, details)
    SELECT p_batch_id, h.record_id, h.institution_id, 'ADMISSION_AFTER_CUTOFF', 3, 'raw_admission_date',
           h.resolved_admission_date::TEXT,
           'Admission date is after the AICTE admission cut-off for this program.',
           'Admissions after the cut-off need explicit AICTE permission.',
           jsonb_build_object('admission_date', h.resolved_admission_date, 'cutoff_date', v_cutoff)
      FROM hit h;

    -- 1g. Roll number already used (in this upload, or by another ACTIVE student of the program/year)
    WITH cand AS (
        SELECT r.record_id, r.resolved_student_id, r.academic_year,
               NULLIF(btrim(r.raw_roll_no), '') AS roll,
               row_number() OVER (PARTITION BY NULLIF(btrim(r.raw_roll_no), '') ORDER BY r.source_row_number) AS rn
          FROM staging.staging_enrolment_records r
         WHERE r.batch_id = p_batch_id AND r.resolved_program_id = p_program_id AND r.validation_status = 'L2_VERIFIED'
    ), hit AS (
        UPDATE staging.staging_enrolment_records r
           SET validation_status = 'QUARANTINED', rejected_at_level = 3
          FROM cand c
         WHERE r.record_id = c.record_id AND c.roll IS NOT NULL
           AND (c.rn > 1
                OR EXISTS (SELECT 1 FROM core.student_enrolments e
                            WHERE e.academic_year = c.academic_year AND e.program_id = p_program_id
                              AND e.roll_no = c.roll AND e.enrolment_status = 'VERIFIED_ACTIVE'
                              AND e.student_id <> c.resolved_student_id))
        RETURNING r.record_id, r.institution_id, r.raw_roll_no
    )
    INSERT INTO staging.validation_anomalies (batch_id, record_id, institution_id, anomaly_code, validation_level,
                                              field_name, offending_value, message, fix_hint)
    SELECT p_batch_id, h.record_id, h.institution_id, 'DUPLICATE_ROLL_NO_IN_PROGRAM', 3, 'raw_roll_no', h.raw_roll_no,
           'This roll number is already used by another student of this program and year.',
           'Assign a unique roll number and re-submit.'
      FROM hit h;

    -- 2. National lock ------------------------------------------------------------
    UPDATE staging.staging_enrolment_records r
       SET promoted_enrolment_id = gen_random_uuid()          -- reserved id, cleared again if the row is quarantined
     WHERE r.batch_id = p_batch_id AND r.resolved_program_id = p_program_id AND r.validation_status = 'L2_VERIFIED';

    INSERT INTO core.active_national_enrolment_locks (student_id, institution_id, program_id, academic_year, enrolment_id)
    SELECT r.resolved_student_id, r.institution_id, p_program_id, r.academic_year, r.promoted_enrolment_id
      FROM staging.staging_enrolment_records r
     WHERE r.batch_id = p_batch_id AND r.resolved_program_id = p_program_id AND r.validation_status = 'L2_VERIFIED'
     ORDER BY r.resolved_student_id                           -- same order everywhere => fewer lock-order deadlocks
    ON CONFLICT (student_id) DO NOTHING;

    WITH hit AS (
        UPDATE staging.staging_enrolment_records r
           SET validation_status = 'QUARANTINED', rejected_at_level = 3, promoted_enrolment_id = NULL
         WHERE r.batch_id = p_batch_id AND r.resolved_program_id = p_program_id AND r.validation_status = 'L2_VERIFIED'
           AND NOT EXISTS (SELECT 1 FROM core.active_national_enrolment_locks l WHERE l.enrolment_id = r.promoted_enrolment_id)
        RETURNING r.record_id, r.institution_id, r.raw_apaar_id, r.resolved_student_id
    )
    INSERT INTO staging.validation_anomalies (batch_id, record_id, institution_id, anomaly_code, validation_level,
                                              field_name, offending_value, message, fix_hint,
                                              conflicting_institution_id, details)
    SELECT p_batch_id, h.record_id, h.institution_id, 'CROSS_INSTITUTION_DUPLICATE_ENROLMENT', 3, 'raw_apaar_id', h.raw_apaar_id,
           'Student already holds an active full-time enrolment.',
           'The student must graduate, withdraw or transfer out of the existing enrolment first.',
           l.institution_id,
           jsonb_build_object('existing_program_id', l.program_id, 'existing_academic_year', l.academic_year,
                              'same_institution', l.institution_id = h.institution_id)
      FROM hit h
      LEFT JOIN core.active_national_enrolment_locks l ON l.student_id = h.resolved_student_id;

    -- 3a. NRI sub-cap --------------------------------------------------------------
    WITH ranked AS (
        SELECT r.record_id, r.institution_id, r.promoted_enrolment_id AS eid, r.raw_seat_quota_type,
               row_number() OVER (ORDER BY r.source_row_number) AS rn
          FROM staging.staging_enrolment_records r
         WHERE r.batch_id = p_batch_id AND r.resolved_program_id = p_program_id AND r.validation_status = 'L2_VERIFIED'
           AND r.resolved_quota_type = 'NRI_QUOTA'
    ), over_cap AS (
        SELECT k.* FROM ranked k
         WHERE k.rn > GREATEST(v_intake.approved_nri_seats - v_intake.actual_nri_enrolled, 0)
    ), del_locks AS (
        DELETE FROM core.active_national_enrolment_locks l USING over_cap o WHERE l.enrolment_id = o.eid
        RETURNING l.enrolment_id
    ), upd AS (
        UPDATE staging.staging_enrolment_records r
           SET validation_status = 'QUARANTINED', rejected_at_level = 3, promoted_enrolment_id = NULL
          FROM over_cap o WHERE r.record_id = o.record_id
        RETURNING r.record_id
    )
    INSERT INTO staging.validation_anomalies (batch_id, record_id, institution_id, anomaly_code, validation_level,
                                              field_name, offending_value, message, fix_hint, details)
    SELECT p_batch_id, o.record_id, o.institution_id, 'EXCEEDS_NRI_QUOTA', 3, 'raw_seat_quota_type', o.raw_seat_quota_type,
           'Approved NRI seat cap for this program is exhausted.',
           'Reduce NRI admissions or request an AICTE intake revision.',
           jsonb_build_object('quota', 'NRI_QUOTA', 'approved', v_intake.approved_nri_seats,
                              'already_enrolled', v_intake.actual_nri_enrolled,
                              'remaining_before_batch', GREATEST(v_intake.approved_nri_seats - v_intake.actual_nri_enrolled, 0))
      FROM over_cap o;

    -- 3b. Sanctioned pool = regular + NRI (NRI seats are inside the sanctioned intake) ---------
    WITH ranked AS (
        SELECT r.record_id, r.institution_id, r.promoted_enrolment_id AS eid, r.raw_seat_quota_type,
               r.resolved_quota_type AS q,
               row_number() OVER (ORDER BY r.source_row_number) AS rn
          FROM staging.staging_enrolment_records r
         WHERE r.batch_id = p_batch_id AND r.resolved_program_id = p_program_id AND r.validation_status = 'L2_VERIFIED'
           AND r.resolved_quota_type IN ('REGULAR_SANCTIONED', 'NRI_QUOTA')
    ), over_cap AS (
        SELECT k.* FROM ranked k
         WHERE k.rn > GREATEST(v_intake.approved_sanctioned_intake
                               - v_intake.actual_regular_enrolled - v_intake.actual_nri_enrolled, 0)
    ), del_locks AS (
        DELETE FROM core.active_national_enrolment_locks l USING over_cap o WHERE l.enrolment_id = o.eid
        RETURNING l.enrolment_id
    ), upd AS (
        UPDATE staging.staging_enrolment_records r
           SET validation_status = 'QUARANTINED', rejected_at_level = 3, promoted_enrolment_id = NULL
          FROM over_cap o WHERE r.record_id = o.record_id
        RETURNING r.record_id
    )
    INSERT INTO staging.validation_anomalies (batch_id, record_id, institution_id, anomaly_code, validation_level,
                                              field_name, offending_value, message, fix_hint, details)
    SELECT p_batch_id, o.record_id, o.institution_id, 'EXCEEDS_SANCTIONED_INTAKE', 3, 'raw_seat_quota_type', o.raw_seat_quota_type,
           'The sanctioned intake (regular + NRI seats) for this program is exhausted.',
           'Reduce admissions or request an AICTE intake revision.',
           jsonb_build_object('quota', o.q, 'sanctioned', v_intake.approved_sanctioned_intake,
                              'regular_enrolled', v_intake.actual_regular_enrolled,
                              'nri_enrolled', v_intake.actual_nri_enrolled,
                              'remaining_before_batch',
                              GREATEST(v_intake.approved_sanctioned_intake - v_intake.actual_regular_enrolled - v_intake.actual_nri_enrolled, 0))
      FROM over_cap o;

    -- 3c. Supernumerary buckets and lateral entry (each has its own cap) -------------
    WITH caps (q, approved, actual, code) AS (
        VALUES
        ('SUPERNUMERARY_TFW'::master.seat_quota_type_enum,          v_intake.approved_supernumerary_tfw,            v_intake.actual_tfw_enrolled,           'EXCEEDS_SUPERNUMERARY_TFW'::staging.anomaly_code_enum),
        ('SUPERNUMERARY_FN_OCI_CIWGC'::master.seat_quota_type_enum, v_intake.approved_supernumerary_fn_oci_ciwgc,  v_intake.actual_fn_oci_ciwgc_enrolled,  'EXCEEDS_SUPERNUMERARY_FN_OCI_CIWGC'::staging.anomaly_code_enum),
        ('SUPERNUMERARY_PMSSS'::master.seat_quota_type_enum,        v_intake.approved_supernumerary_pmsss,          v_intake.actual_pmsss_enrolled,         'EXCEEDS_SUPERNUMERARY_PMSSS'::staging.anomaly_code_enum),
        ('SUPERNUMERARY_EWS'::master.seat_quota_type_enum,          v_intake.approved_supernumerary_ews,            v_intake.actual_ews_enrolled,           'EXCEEDS_SUPERNUMERARY_EWS'::staging.anomaly_code_enum),
        ('LATERAL_ENTRY'::master.seat_quota_type_enum,              v_intake.approved_lateral_entry_seats,          v_intake.actual_lateral_enrolled,       'EXCEEDS_LATERAL_ENTRY_INTAKE'::staging.anomaly_code_enum)
    ), ranked AS (
        SELECT r.record_id, r.institution_id, r.resolved_quota_type AS q, r.promoted_enrolment_id AS eid, r.raw_seat_quota_type,
               row_number() OVER (PARTITION BY r.resolved_quota_type ORDER BY r.source_row_number) AS rn
          FROM staging.staging_enrolment_records r
         WHERE r.batch_id = p_batch_id AND r.resolved_program_id = p_program_id AND r.validation_status = 'L2_VERIFIED'
    ), over_cap AS (
        SELECT k.*, c.approved, c.actual, c.code
          FROM ranked k JOIN caps c ON c.q = k.q
         WHERE k.rn > GREATEST(c.approved - c.actual, 0)
    ), del_locks AS (
        DELETE FROM core.active_national_enrolment_locks l USING over_cap o WHERE l.enrolment_id = o.eid
        RETURNING l.enrolment_id
    ), upd AS (
        UPDATE staging.staging_enrolment_records r
           SET validation_status = 'QUARANTINED', rejected_at_level = 3, promoted_enrolment_id = NULL
          FROM over_cap o WHERE r.record_id = o.record_id
        RETURNING r.record_id
    )
    INSERT INTO staging.validation_anomalies (batch_id, record_id, institution_id, anomaly_code, validation_level,
                                              field_name, offending_value, message, fix_hint, details)
    SELECT p_batch_id, o.record_id, o.institution_id, o.code, 3, 'raw_seat_quota_type', o.raw_seat_quota_type,
           'Approved seat cap for this quota is exhausted.',
           'Reduce admissions in this quota or request an AICTE intake revision.',
           jsonb_build_object('quota', o.q, 'approved', o.approved, 'already_enrolled', o.actual,
                              'remaining_before_batch', GREATEST(o.approved - o.actual, 0))
      FROM over_cap o;

    -- 4. Promote ------------------------------------------------------------------
    WITH ins AS (
        INSERT INTO core.student_enrolments (enrolment_id, academic_year, student_id, institution_id, program_id,
                                             intake_approval_id, seat_quota_type, entry_year_of_study, roll_no,
                                             admission_date, enrolment_status, source_batch_id, source_record_id)
        SELECT r.promoted_enrolment_id, r.academic_year, r.resolved_student_id, r.institution_id, p_program_id,
               v_intake.intake_approval_id, r.resolved_quota_type,
               CASE WHEN r.resolved_quota_type = 'LATERAL_ENTRY' THEN 2 ELSE 1 END,
               NULLIF(btrim(r.raw_roll_no), ''), r.resolved_admission_date, 'VERIFIED_ACTIVE', p_batch_id, r.record_id
          FROM staging.staging_enrolment_records r
         WHERE r.batch_id = p_batch_id AND r.resolved_program_id = p_program_id AND r.validation_status = 'L2_VERIFIED'
        RETURNING seat_quota_type, source_record_id
    ), mark AS (
        UPDATE staging.staging_enrolment_records r
           SET validation_status = 'VALID', promoted_at = NOW()
          FROM ins WHERE r.record_id = ins.source_record_id
        RETURNING r.record_id
    )
    SELECT count(*) FILTER (WHERE ins.seat_quota_type = 'REGULAR_SANCTIONED'),
           count(*) FILTER (WHERE ins.seat_quota_type = 'NRI_QUOTA'),
           count(*) FILTER (WHERE ins.seat_quota_type = 'SUPERNUMERARY_TFW'),
           count(*) FILTER (WHERE ins.seat_quota_type = 'SUPERNUMERARY_FN_OCI_CIWGC'),
           count(*) FILTER (WHERE ins.seat_quota_type = 'SUPERNUMERARY_PMSSS'),
           count(*) FILTER (WHERE ins.seat_quota_type = 'SUPERNUMERARY_EWS'),
           count(*) FILTER (WHERE ins.seat_quota_type = 'LATERAL_ENTRY')
      INTO n_regular, n_nri, n_tfw, n_fn, n_pmsss, n_ews, n_lateral
      FROM ins;

    v_promoted := n_regular + n_nri + n_tfw + n_fn + n_pmsss + n_ews + n_lateral;

    IF v_promoted > 0 THEN
        UPDATE master.program_intake_approvals
           SET actual_regular_enrolled      = actual_regular_enrolled + n_regular,
               actual_nri_enrolled          = actual_nri_enrolled + n_nri,
               actual_tfw_enrolled          = actual_tfw_enrolled + n_tfw,
               actual_fn_oci_ciwgc_enrolled = actual_fn_oci_ciwgc_enrolled + n_fn,
               actual_pmsss_enrolled        = actual_pmsss_enrolled + n_pmsss,
               actual_ews_enrolled          = actual_ews_enrolled + n_ews,
               actual_lateral_enrolled      = actual_lateral_enrolled + n_lateral
         WHERE intake_approval_id = v_intake.intake_approval_id;
    END IF;

    -- Summary for the worker (anomalies written by THIS call carry this transaction's timestamp)
    SELECT COALESCE(jsonb_object_agg(x.code, x.c), '{}'::jsonb), COALESCE(sum(x.c), 0)::INT
      INTO v_by_code, v_quarantined
      FROM (SELECT a.anomaly_code::TEXT AS code, count(*) AS c
              FROM staging.validation_anomalies a
              JOIN staging.staging_enrolment_records r ON r.record_id = a.record_id
             WHERE a.batch_id = p_batch_id AND r.resolved_program_id = p_program_id
               AND a.created_at = transaction_timestamp()
             GROUP BY a.anomaly_code) x;

    RETURN jsonb_build_object('batch_id', p_batch_id, 'program_id', p_program_id,
                              'promoted', v_promoted, 'already_enrolled', v_existing,
                              'quarantined', v_quarantined, 'by_code', v_by_code,
                              'by_quota', jsonb_build_object('regular', n_regular, 'nri', n_nri, 'tfw', n_tfw,
                                                             'fn_oci_ciwgc', n_fn, 'pmsss', n_pmsss, 'ews', n_ews,
                                                             'lateral', n_lateral));
END;
$$;

-- promote_batch: a retry after success returns the final state instead of raising
CREATE OR REPLACE FUNCTION core.promote_batch(p_batch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_status staging.batch_status_enum;
    v_prog UUID;
    v_results JSONB := '[]'::jsonb;
    v_final staging.batch_status_enum;
BEGIN
    SELECT status INTO v_status FROM staging.submission_batches WHERE batch_id = p_batch_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'promote_batch: batch % not found', p_batch_id;
    END IF;
    IF v_status IN ('COMPLETED', 'COMPLETED_WITH_ANOMALIES') THEN
        RETURN jsonb_build_object('batch_id', p_batch_id, 'status', v_status, 'programs', '[]'::jsonb,
                                  'already_finalised', TRUE);
    END IF;
    IF v_status NOT IN ('L2_COMPLETED', 'L3_PROCESSING') THEN
        RAISE EXCEPTION 'promote_batch: batch % is in status % (expected L2_COMPLETED or L3_PROCESSING)', p_batch_id, v_status;
    END IF;
    UPDATE staging.submission_batches
       SET status = 'L3_PROCESSING', processing_started_at = COALESCE(processing_started_at, NOW())
     WHERE batch_id = p_batch_id AND status = 'L2_COMPLETED';

    -- Rows whose program never resolved
    WITH hit AS (
        UPDATE staging.staging_enrolment_records r
           SET validation_status = 'QUARANTINED', rejected_at_level = 3
         WHERE r.batch_id = p_batch_id AND r.validation_status = 'L2_VERIFIED' AND r.resolved_program_id IS NULL
        RETURNING r.record_id, r.institution_id, r.raw_program_code
    )
    INSERT INTO staging.validation_anomalies (batch_id, record_id, institution_id, anomaly_code, validation_level,
                                              field_name, offending_value, message, fix_hint)
    SELECT p_batch_id, h.record_id, h.institution_id, 'UNKNOWN_PROGRAM', 3, 'raw_program_code', h.raw_program_code,
           'Program code could not be matched to an AICTE-approved program of this institution.',
           'Use the AICTE course id of an approved program and re-submit.'
      FROM hit h;

    -- One program at a time, in a stable order. The worker must retry on SQLSTATE 40P01 (deadlock).
    FOR v_prog IN
        SELECT DISTINCT r.resolved_program_id
          FROM staging.staging_enrolment_records r
         WHERE r.batch_id = p_batch_id AND r.validation_status = 'L2_VERIFIED' AND r.resolved_program_id IS NOT NULL
         ORDER BY 1
    LOOP
        v_results := v_results || jsonb_build_array(core.promote_program_batch(p_batch_id, v_prog));
    END LOOP;

    v_final := core.finalize_batch(p_batch_id);
    RETURN jsonb_build_object('batch_id', p_batch_id, 'status', v_final, 'programs', v_results);
END;
$$;

-- ============================================================================
-- B7. TRUST: the actor contract is mandatory (fail closed)
--     Backend: SELECT set_config('app.actor_user_id', '<uuid>', true), set_config('app.request_id', '<id>', true)
--     at the start of EVERY transaction that issues/revokes credentials, decides verifier orgs, grants consents
--     or verifies credentials. (Rollback: restore the previous trust.assert_actor_matches from script 04.)
-- ============================================================================

CREATE OR REPLACE FUNCTION trust.assert_actor_matches(p_claimed UUID)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_actor UUID := trust.current_actor();
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'app.actor_user_id must be set (set_config(..., true)) for this operation'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_claimed IS DISTINCT FROM v_actor THEN
        RAISE EXCEPTION 'user % does not match the session actor %', p_claimed, v_actor
            USING ERRCODE = 'insufficient_privilege';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION trust.require_actor_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF trust.current_actor() IS NULL THEN
        RAISE EXCEPTION '%.%: app.actor_user_id must be set for this operation', TG_TABLE_SCHEMA, TG_TABLE_NAME
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION trust.vlog_actor_check()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    PERFORM trust.assert_actor_matches(NEW.requested_by);
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_consents_require_actor
    BEFORE INSERT ON trust.student_consents
    FOR EACH ROW EXECUTE FUNCTION trust.require_actor_on_insert();
CREATE OR REPLACE TRIGGER trg_vlogs_require_actor
    BEFORE INSERT ON trust.employer_verification_logs
    FOR EACH ROW EXECUTE FUNCTION trust.vlog_actor_check();

-- ============================================================================
-- B8. STAGING: two-stage PII retention
--     stage 1 (staging.purge_batch_pii, existing): passports, visa, FRRO, OCI, sponsor ref, email, mobile, payload
--     stage 2 (below): name, DOB, gender, APAAR (raw + normalised), roll, nationality, category, residency
--     Retention periods are POLICY: the defaults (30 / 180 days) are placeholders until your DPO decides.
-- ============================================================================

CREATE OR REPLACE FUNCTION staging.purge_batch_identity(p_batch_id UUID)
RETURNS BIGINT
LANGUAGE plpgsql
SET search_path = staging, pg_temp
AS $$
DECLARE
    v_status staging.batch_status_enum;
    v_pii TIMESTAMPTZ;
    v_rows BIGINT;
BEGIN
    SELECT status, pii_purged_at INTO v_status, v_pii FROM staging.submission_batches WHERE batch_id = p_batch_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'purge_batch_identity: batch % not found', p_batch_id;
    END IF;
    IF v_status NOT IN ('COMPLETED', 'COMPLETED_WITH_ANOMALIES', 'FAILED', 'CANCELLED') THEN
        RAISE EXCEPTION 'purge_batch_identity: batch % is still in status % (must be finished)', p_batch_id, v_status;
    END IF;
    IF v_pii IS NULL THEN
        PERFORM staging.purge_batch_pii(p_batch_id);
    END IF;

    UPDATE staging.staging_enrolment_records
       SET raw_apaar_id = NULL, normalised_apaar_id = NULL, raw_full_name = NULL, raw_date_of_birth = NULL,
           raw_gender = NULL, raw_roll_no = NULL, raw_nationality = NULL, raw_social_category = NULL,
           raw_residency_status = NULL, abc_response_ref = NULL
     WHERE batch_id = p_batch_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;

    UPDATE staging.submission_batches SET identity_purged_at = NOW() WHERE batch_id = p_batch_id;
    RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION staging.run_retention(p_pii_days INT DEFAULT 30, p_identity_days INT DEFAULT 180)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = staging, pg_temp
AS $$
DECLARE
    b RECORD;
    n_pii INT := 0;
    n_id INT := 0;
BEGIN
    IF p_pii_days IS NULL OR p_identity_days IS NULL OR p_pii_days < 1 OR p_identity_days < p_pii_days THEN
        RAISE EXCEPTION 'run_retention: need 1 <= p_pii_days <= p_identity_days';
    END IF;

    FOR b IN SELECT s.batch_id FROM staging.submission_batches s
              WHERE s.status IN ('COMPLETED', 'COMPLETED_WITH_ANOMALIES', 'FAILED', 'CANCELLED')
                AND s.pii_purged_at IS NULL
                AND COALESCE(s.completed_at, s.updated_at) < now() - make_interval(days => p_pii_days)
              ORDER BY s.uploaded_at LOOP
        PERFORM staging.purge_batch_pii(b.batch_id);
        n_pii := n_pii + 1;
    END LOOP;

    FOR b IN SELECT s.batch_id FROM staging.submission_batches s
              WHERE s.status IN ('COMPLETED', 'COMPLETED_WITH_ANOMALIES', 'FAILED', 'CANCELLED')
                AND s.identity_purged_at IS NULL
                AND COALESCE(s.completed_at, s.updated_at) < now() - make_interval(days => p_identity_days)
              ORDER BY s.uploaded_at LOOP
        PERFORM staging.purge_batch_identity(b.batch_id);
        n_id := n_id + 1;
    END LOOP;

    RETURN jsonb_build_object('pii_purged_batches', n_pii, 'identity_purged_batches', n_id);
END;
$$;

-- ============================================================================
-- B10. SELF-CHECK (run in CI and after every deploy; empty result = all controls in place)
-- ============================================================================
CREATE OR REPLACE FUNCTION master.verify_security_baseline()
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
    FOR r IN SELECT c.oid, n.nspname, c.relname, c.relrowsecurity
               FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname IN ('master', 'staging', 'core', 'trust', 'analytics') AND c.relkind IN ('r', 'p') LOOP
        IF NOT r.relrowsecurity THEN
            problem := format('RLS is disabled on %s.%s', r.nspname, r.relname); RETURN NEXT;
        END IF;
        FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
            IF has_table_privilege(v_role, r.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') THEN
                problem := format('role %s has table privileges on %s.%s', v_role, r.nspname, r.relname); RETURN NEXT;
            END IF;
        END LOOP;
        IF has_table_privilege('service_role', r.oid, 'TRUNCATE') THEN
            problem := format('service_role can TRUNCATE %s.%s', r.nspname, r.relname); RETURN NEXT;
        END IF;
    END LOOP;

    FOR r IN SELECT p.oid, n.nspname, p.proname, p.proconfig, p.proowner, p.proacl
               FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname IN ('master', 'staging', 'core', 'trust', 'analytics') AND p.prokind = 'f' LOOP
        IF EXISTS (SELECT 1 FROM aclexplode(COALESCE(r.proacl, acldefault('f', r.proowner))) a
                    WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
            problem := format('PUBLIC can execute %s.%s', r.nspname, r.proname); RETURN NEXT;
        END IF;
        IF has_function_privilege('anon', r.oid, 'EXECUTE') THEN
            problem := format('anon can execute %s.%s', r.nspname, r.proname); RETURN NEXT;
        END IF;
        IF has_function_privilege('authenticated', r.oid, 'EXECUTE')
           AND NOT (r.nspname = 'master' AND r.proname IN ('current_user_institution_id', 'current_user_role', 'can_read_institution')) THEN
            problem := format('authenticated can execute %s.%s', r.nspname, r.proname); RETURN NEXT;
        END IF;
        IF r.proconfig IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(r.proconfig) cfg WHERE cfg LIKE 'search_path=%') THEN
            problem := format('%s.%s does not pin search_path', r.nspname, r.proname); RETURN NEXT;
        END IF;
    END LOOP;
END;
$$;

-- ============================================================================
-- B9. PRIVILEGES AND TRIGGER HARDENING (runs after every object above exists)
-- ============================================================================

-- 9.1 service_role keeps the DML it needs, but cannot TRUNCATE, add triggers/FKs, or delete reference data.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA master, staging, core FROM service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA master, staging, core REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM service_role;

REVOKE DELETE ON master.institutions, master.institutional_programs, master.program_intake_approvals,
                 master.affiliating_bodies, core.students FROM service_role;

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT c.oid::regclass AS rel
               FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'core' AND c.relkind IN ('r', 'p') AND c.relname LIKE 'student\_enrolments%' LOOP
        EXECUTE format('REVOKE DELETE ON %s FROM service_role', r.rel);
    END LOOP;
END $$;

-- append-only / immutable new tables
REVOKE UPDATE, DELETE ON core.enrolment_status_history FROM service_role;
REVOKE UPDATE ON core.student_accounts FROM service_role;
REVOKE INSERT, UPDATE, DELETE ON master.quota_residency_rules FROM service_role;   -- rules change through migrations

-- 9.2 No function is executable by PUBLIC / anon / authenticated, except the three RLS helpers.
--     (Future functions: end every migration with the same two statements; the schema-level
--      ALTER DEFAULT PRIVILEGES in script 05 cannot remove PUBLIC's implicit EXECUTE.)
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA master, staging, core, trust FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA master, staging, core, trust TO postgres, service_role;
GRANT EXECUTE ON FUNCTION master.current_user_institution_id(), master.current_user_role(),
                          master.can_read_institution(UUID) TO authenticated;

REVOKE USAGE ON SCHEMA staging, core, trust FROM authenticated;

-- 9.3 Integrity triggers must also fire under session_replication_role = replica.
--     Restore note: logical restores (pg_dump / pg_restore) now run these triggers; prefer PITR / physical restores.
DO $$
DECLARE
    t RECORD;
BEGIN
    FOR t IN
        SELECT n.nspname AS schema_name, c.relname AS table_name, g.tgname AS trigger_name
          FROM pg_trigger g
          JOIN pg_class c ON c.oid = g.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname IN ('master', 'core', 'trust')
           AND NOT g.tgisinternal AND g.tgparentid = 0 AND g.tgenabled <> 'A'
    LOOP
        BEGIN
            EXECUTE format('ALTER TABLE %I.%I ENABLE ALWAYS TRIGGER %I', t.schema_name, t.table_name, t.trigger_name);
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'could not set ENABLE ALWAYS on %.% (%): %', t.schema_name, t.table_name, t.trigger_name, SQLERRM;
        END;
    END LOOP;
END $$;

-- 9.4 Partitions for the current academic year -1 .. +4
SELECT core.ensure_enrolment_partitions(4);

-- 9.5 Report anything still open
DO $$
DECLARE
    p TEXT;
    n INT := 0;
BEGIN
    FOR p IN SELECT problem FROM master.verify_security_baseline() LOOP
        RAISE NOTICE 'SECURITY BASELINE: %', p;
        n := n + 1;
    END LOOP;
    RAISE NOTICE 'security baseline problems: %', n;
END $$;

COMMIT;

-- ============================================================================
-- OPTIONAL SCHEDULING (Supabase pg_cron). Adjust times / retention to policy, then run once by hand.
--   SELECT cron.schedule('analytics-refresh',   '*/15 * * * *', $$SELECT analytics.refresh_all()$$);
--   SELECT cron.schedule('staging-retention',   '30 2 * * *',   $$SELECT staging.run_retention(30, 180)$$);
--   SELECT cron.schedule('enrol-partitions',    '0 3 1 * *',    $$SELECT core.ensure_enrolment_partitions(4)$$);
--   SELECT cron.schedule('security-baseline',   '0 4 * * *',    $$SELECT * FROM master.verify_security_baseline()$$);
-- ============================================================================