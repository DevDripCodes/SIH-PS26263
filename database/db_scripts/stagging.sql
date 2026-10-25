BEGIN;

-- ============================================================================
-- ZONE 2: `staging.*` (Landing & Quarantine Zone)
-- Depends on: 01_master_schema.sql (master.institutions, master.user_profiles,
--             master.seat_quota_type_enum, master.residency_status_enum,
--             master.set_updated_at(), master.current_user_*())
-- Design rules:
--   * ZERO foreign keys to core.* (dirty data must never be coupled to the golden repo)
--   * All raw_* columns are TEXT so 100% of an upload lands, even malformed rows
--   * Child rows are tied to their batch by COMPOSITE foreign keys, so a row can never
--     carry a different institution / academic year than the batch it belongs to
--   * Backend-only access: no grants / policies for anon or authenticated (RLS stays ON
--     as deny-by-default). Only postgres / service_role touch these tables.
--   * Normalised / resolved_* columns are filled in later by BullMQ workers
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. STAGING ENUM TYPES
-- ----------------------------------------------------------------------------

DO $$ BEGIN
    CREATE TYPE staging.submission_source_enum AS ENUM (
        'CSV_UPLOAD',
        'EXCEL_UPLOAD',
        'ERP_API'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE staging.batch_status_enum AS ENUM (
        'UPLOADED',                 -- Stage 1: rows landed, job enqueued (HTTP 202 returned)
        'L1_PROCESSING',            -- Stage 2: syntax / category / intra-batch checks
        'L1_COMPLETED',
        'L2_PROCESSING',            -- Stage 3: APAAR / ABC identity verification
        'L2_COMPLETED',
        'L3_PROCESSING',            -- Stage 4: quota + national lock + promotion
        'COMPLETED',                -- All rows promoted
        'COMPLETED_WITH_ANOMALIES', -- Some rows promoted, some quarantined/rejected
        'FAILED',                   -- Infrastructure / unrecoverable error
        'CANCELLED'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE staging.record_validation_status_enum AS ENUM (
        'PENDING',      -- Landed, not yet validated
        'L1_PASSED',    -- Syntax / category / intra-batch OK
        'L2_VERIFIED',  -- APAAR verified against ABC / DigiLocker
        'REJECTED',     -- Failed L1 (institution must fix & re-submit)
        'QUARANTINED',  -- Failed L2 or L3 (identity mismatch, quota, duplicate enrolment)
        'VALID'         -- Promoted to core.student_enrolments
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE staging.anomaly_severity_enum AS ENUM (
        'ERROR',    -- Row blocked from promotion
        'WARNING'   -- Row proceeds, flagged for AICTE review
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Extend later with: ALTER TYPE staging.anomaly_code_enum ADD VALUE 'NEW_CODE';
DO $$ BEGIN
    CREATE TYPE staging.anomaly_code_enum AS ENUM (
        -- L1: syntax, category, intra-batch
        'MISSING_REQUIRED_FIELD',
        'MISSING_APAAR_ID',
        'INVALID_APAAR_FORMAT',
        'INVALID_DATE_OF_BIRTH',
        'INVALID_RESIDENCY_STATUS',
        'INVALID_SEAT_QUOTA_TYPE',
        'OCI_FN_STATUS_CONFLICT',
        'MISSING_PASSPORT_DETAILS',
        'MISSING_OCI_DETAILS',
        'MISSING_EMBASSY_SPONSORSHIP',
        'DUPLICATE_APAAR_IN_BATCH',
        'DUPLICATE_ROLL_NO_IN_BATCH',
        'UNKNOWN_PROGRAM',
        'PROGRAM_NOT_APPROVED_FOR_YEAR',
        -- L2: APAAR / ABC identity verification
        'APAAR_NOT_FOUND',
        'APAAR_INACTIVE',
        'APAAR_DEMOGRAPHIC_MISMATCH',
        'ABC_VERIFICATION_UNAVAILABLE',
        -- L3: quota + national lock
        'EXCEEDS_SANCTIONED_INTAKE',
        'EXCEEDS_NRI_QUOTA',
        'EXCEEDS_SUPERNUMERARY_TFW',
        'EXCEEDS_SUPERNUMERARY_FN_OCI_CIWGC',
        'EXCEEDS_SUPERNUMERARY_PMSSS',
        'EXCEEDS_SUPERNUMERARY_EWS',
        'EXCEEDS_LATERAL_ENTRY_INTAKE',
        'CROSS_INSTITUTION_DUPLICATE_ENROLMENT',
        'ADMISSION_AFTER_CUTOFF',
        'PROGRAM_LOCKED_BY_AICTE'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- 2. staging.submission_batches (one row per upload / ERP push)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS staging.submission_batches (
    batch_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID NOT NULL REFERENCES master.institutions(institution_id) ON DELETE RESTRICT,
    academic_year CHAR(7) NOT NULL CHECK (academic_year ~ '^[0-9]{4}-[0-9]{2}$'),
    submitted_by UUID REFERENCES master.user_profiles(user_id) ON DELETE SET NULL,

    source_channel staging.submission_source_enum NOT NULL,
    original_filename VARCHAR(255),
    file_sha256 CHAR(64),                    -- Detects accidental re-uploads of the same file
    file_size_bytes BIGINT CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),

    status staging.batch_status_enum NOT NULL DEFAULT 'UPLOADED',
    bullmq_job_id VARCHAR(100),
    failure_reason TEXT,

    -- Progress counters (updated by workers; drive the real-time dashboard split)
    total_rows INT NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
    l1_rejected_rows INT NOT NULL DEFAULT 0 CHECK (l1_rejected_rows >= 0),
    l2_quarantined_rows INT NOT NULL DEFAULT 0 CHECK (l2_quarantined_rows >= 0),
    l3_quarantined_rows INT NOT NULL DEFAULT 0 CHECK (l3_quarantined_rows >= 0),
    promoted_rows INT NOT NULL DEFAULT 0 CHECK (promoted_rows >= 0),

    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processing_started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    pii_purged_at TIMESTAMPTZ,               -- Set by staging.purge_batch_pii()
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Targets for composite FKs from child tables
    UNIQUE (batch_id, institution_id),
    UNIQUE (batch_id, institution_id, academic_year),
    -- Counters can never claim more rows than were uploaded
    CONSTRAINT chk_batch_counters_within_total CHECK (
        l1_rejected_rows + l2_quarantined_rows + l3_quarantined_rows + promoted_rows <= total_rows
    )
);

CREATE INDEX IF NOT EXISTS idx_batches_inst_year_status
    ON staging.submission_batches(institution_id, academic_year, status);
CREATE INDEX IF NOT EXISTS idx_batches_status_uploaded
    ON staging.submission_batches(status, uploaded_at);
CREATE INDEX IF NOT EXISTS idx_batches_file_sha256
    ON staging.submission_batches(institution_id, file_sha256) WHERE file_sha256 IS NOT NULL;

CREATE TRIGGER trg_submission_batches_updated_at
    BEFORE UPDATE ON staging.submission_batches
    FOR EACH ROW EXECUTE FUNCTION master.set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. staging.staging_enrolment_records (raw rows, bulk-loaded via COPY FROM STDIN)
-- ----------------------------------------------------------------------------
-- BIGINT identity (not UUID) keeps COPY fast and indexes small for millions of rows.
-- institution_id / academic_year are denormalised from the batch for RLS + worker speed.

CREATE TABLE IF NOT EXISTS staging.staging_enrolment_records (
    record_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    batch_id UUID NOT NULL,
    institution_id UUID NOT NULL,            -- Must match the batch (composite FK below)
    academic_year CHAR(7) NOT NULL CHECK (academic_year ~ '^[0-9]{4}-[0-9]{2}$'),
    source_row_number INT NOT NULL CHECK (source_row_number > 0),

    -- ---- RAW INPUT (everything TEXT; never trust the uploader) ----
    raw_apaar_id TEXT,
    raw_full_name TEXT,
    raw_date_of_birth TEXT,
    raw_gender TEXT,
    raw_email TEXT,
    raw_mobile TEXT,
    raw_roll_no TEXT,
    raw_program_code TEXT,                   -- Maps to master.institutional_programs.aicte_course_id
    raw_admission_date TEXT,
    raw_social_category TEXT,                -- GEN / EWS / SC / ST / OBC etc.
    raw_residency_status TEXT,
    raw_seat_quota_type TEXT,
    raw_is_fn TEXT,                          -- Foreign National flag
    raw_is_oci_status TEXT,                  -- OCI flag (mutually exclusive with raw_is_fn)
    raw_nationality TEXT,
    raw_passport_no TEXT,                    -- Sensitive: purged after batch completes
    raw_passport_expiry TEXT,
    raw_visa_type TEXT,
    raw_frro_reg_no TEXT,
    raw_oci_card_no TEXT,
    raw_embassy_sponsor_ref TEXT,
    raw_payload JSONB,                       -- Any extra / unmapped ERP fields

    -- ---- NORMALISED / RESOLVED (filled by Workers #1 and #2) ----
    normalised_apaar_id CHAR(12) CHECK (normalised_apaar_id IS NULL OR normalised_apaar_id ~ '^[0-9]{12}$'),
    resolved_program_id UUID,                -- Soft reference to master.institutional_programs (no FK)
    resolved_intake_approval_id UUID,        -- Soft reference to master.program_intake_approvals (no FK)
    resolved_residency_status master.residency_status_enum,
    resolved_quota_type master.seat_quota_type_enum,

    -- ---- L2 IDENTITY VERIFICATION RESULT ----
    abc_verified_at TIMESTAMPTZ,
    abc_name_similarity NUMERIC(4,3) CHECK (abc_name_similarity IS NULL OR abc_name_similarity BETWEEN 0 AND 1),
    abc_response_ref VARCHAR(100),           -- Reference to ABC / DigiLocker response for audit

    -- ---- PIPELINE STATE ----
    validation_status staging.record_validation_status_enum NOT NULL DEFAULT 'PENDING',
    rejected_at_level SMALLINT CHECK (rejected_at_level IS NULL OR rejected_at_level BETWEEN 1 AND 3),
    promoted_enrolment_id UUID,              -- Soft pointer to core.student_enrolments (NO FK by design)
    promoted_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (batch_id, source_row_number),
    UNIQUE (record_id, batch_id),            -- Target for the anomalies composite FK

    -- Row can only belong to a batch of the SAME institution + academic year
    CONSTRAINT fk_record_batch_scope FOREIGN KEY (batch_id, institution_id, academic_year)
        REFERENCES staging.submission_batches(batch_id, institution_id, academic_year) ON DELETE CASCADE,

    -- Pipeline state must be internally consistent (explicit IS NOT NULL: a NULL inside CHECK would pass)
    CONSTRAINT chk_record_state_consistent CHECK (
        (validation_status = 'REJECTED'    AND rejected_at_level IS NOT NULL AND rejected_at_level = 1)
        OR (validation_status = 'QUARANTINED' AND rejected_at_level IS NOT NULL AND rejected_at_level IN (2, 3))
        OR (validation_status = 'VALID' AND rejected_at_level IS NULL
            AND promoted_at IS NOT NULL AND promoted_enrolment_id IS NOT NULL)
        OR (validation_status IN ('PENDING', 'L1_PASSED', 'L2_VERIFIED') AND rejected_at_level IS NULL)
    )
);

-- Worker access paths (kept deliberately lean to protect COPY throughput)
CREATE INDEX IF NOT EXISTS idx_staging_rec_batch_status
    ON staging.staging_enrolment_records(batch_id, validation_status);
CREATE INDEX IF NOT EXISTS idx_staging_rec_batch_apaar
    ON staging.staging_enrolment_records(batch_id, raw_apaar_id) WHERE raw_apaar_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_staging_rec_batch_roll
    ON staging.staging_enrolment_records(batch_id, raw_roll_no) WHERE raw_roll_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_staging_rec_l3_group
    ON staging.staging_enrolment_records(batch_id, resolved_program_id, resolved_quota_type)
    WHERE validation_status = 'L2_VERIFIED';

CREATE TRIGGER trg_staging_enrolment_records_updated_at
    BEFORE UPDATE ON staging.staging_enrolment_records
    FOR EACH ROW EXECUTE FUNCTION master.set_updated_at();

-- ----------------------------------------------------------------------------
-- 4. staging.validation_anomalies (structured, actionable errors per row)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS staging.validation_anomalies (
    anomaly_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    batch_id UUID NOT NULL,
    record_id BIGINT NOT NULL,
    institution_id UUID NOT NULL,            -- Denormalised for dashboards; must match the batch (composite FK below)

    anomaly_code staging.anomaly_code_enum NOT NULL,
    severity staging.anomaly_severity_enum NOT NULL DEFAULT 'ERROR',
    validation_level SMALLINT NOT NULL CHECK (validation_level BETWEEN 1 AND 3),

    field_name VARCHAR(100),
    offending_value TEXT,                    -- Workers must NOT store passport/OCI/contact values here (purge also clears it)
    message TEXT NOT NULL,                   -- Human-readable reason shown on the institution dashboard
    fix_hint TEXT,                           -- Exact action the nodal officer must take
    conflicting_institution_id UUID REFERENCES master.institutions(institution_id) ON DELETE SET NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,  -- e.g. {"similarity": 0.62, "cap": 60, "attempted": 63}

    is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,
    resolved_by UUID REFERENCES master.user_profiles(user_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Anomaly must point at a record OF THE SAME batch, and the batch must belong to that institution
    CONSTRAINT fk_anomaly_record_batch FOREIGN KEY (record_id, batch_id)
        REFERENCES staging.staging_enrolment_records(record_id, batch_id) ON DELETE CASCADE,
    CONSTRAINT fk_anomaly_batch_scope FOREIGN KEY (batch_id, institution_id)
        REFERENCES staging.submission_batches(batch_id, institution_id) ON DELETE CASCADE,
    CONSTRAINT chk_anomaly_resolved CHECK (is_resolved = (resolved_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_anomalies_batch_code
    ON staging.validation_anomalies(batch_id, anomaly_code);
CREATE INDEX IF NOT EXISTS idx_anomalies_record
    ON staging.validation_anomalies(record_id);
CREATE INDEX IF NOT EXISTS idx_anomalies_inst_created
    ON staging.validation_anomalies(institution_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_anomalies_unresolved
    ON staging.validation_anomalies(institution_id, anomaly_code) WHERE is_resolved = FALSE;

-- ----------------------------------------------------------------------------
-- 5. PII RETENTION HELPER (raw passport / OCI / contact data must not linger)
-- Only allowed once the batch is finished, so it can never starve a running worker.
-- Clears the raw columns AND any copies in validation_anomalies.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION staging.purge_batch_pii(p_batch_id UUID)
RETURNS BIGINT
LANGUAGE plpgsql
SET search_path = staging, pg_temp
AS $$
DECLARE
    v_status staging.batch_status_enum;
    v_rows BIGINT;
BEGIN
    SELECT status INTO v_status FROM staging.submission_batches WHERE batch_id = p_batch_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'purge_batch_pii: batch % not found', p_batch_id;
    END IF;
    IF v_status NOT IN ('COMPLETED', 'COMPLETED_WITH_ANOMALIES', 'FAILED', 'CANCELLED') THEN
        RAISE EXCEPTION 'purge_batch_pii: batch % is still in status % (must be finished)', p_batch_id, v_status;
    END IF;

    UPDATE staging.staging_enrolment_records
    SET raw_passport_no = NULL,
        raw_passport_expiry = NULL,
        raw_visa_type = NULL,
        raw_frro_reg_no = NULL,
        raw_oci_card_no = NULL,
        raw_embassy_sponsor_ref = NULL,
        raw_email = NULL,
        raw_mobile = NULL,
        raw_payload = NULL
    WHERE batch_id = p_batch_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;

    UPDATE staging.validation_anomalies
    SET offending_value = NULL,
        details = details - ARRAY['passport', 'passport_no', 'passport_expiry', 'visa_type', 'frro_reg_no',
                                  'oci_card_no', 'embassy_sponsor_ref', 'email', 'mobile']
    WHERE batch_id = p_batch_id;

    UPDATE staging.submission_batches
    SET pii_purged_at = NOW()
    WHERE batch_id = p_batch_id;

    RETURN v_rows;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. ACCESS CONTROL (backend-only design: dashboards go through the Node.js API + Redis)
-- RLS ON with NO policies = deny-by-default for any non-bypass role.
-- ----------------------------------------------------------------------------

ALTER TABLE staging.submission_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE staging.staging_enrolment_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE staging.validation_anomalies ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON staging.submission_batches,
              staging.staging_enrolment_records,
              staging.validation_anomalies FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION staging.purge_batch_pii(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION staging.purge_batch_pii(UUID) TO postgres, service_role;

COMMIT;