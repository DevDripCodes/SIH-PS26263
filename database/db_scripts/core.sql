BEGIN;

-- ============================================================================
-- ZONE 3: `core.*` (Golden Repository Zone)
-- Depends on: master schema script, staging schema script (v3: needs
--   staging_enrolment_records.resolved_student_id / resolved_admission_date).
-- Access model: backend-only (postgres / service_role). RLS ON with no policies.
--
-- Design notes
--   * National lock is keyed on student_id (PK), with apaar_id UNIQUE alongside.
--     Foreign Nationals awaiting APAAR have no apaar_id, so apaar_id alone cannot
--     guard them. student_id is the person-level key; apaar_id stays unique too.
--   * Sensitive proofs (passport, FRRO, OCI card, sponsorship) are stored as
--     BYTEA ciphertext produced APP-SIDE (envelope encryption / KMS). The DB never
--     sees the key. passport_fingerprint = HMAC-SHA256(country || passport_no),
--     computed app-side, gives de-duplication without decrypting.
--   * Stage 4 = core.promote_program_batch() (atomic unit, one program) and
--     core.promote_batch() (loops programs + finalizes the batch).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ENUM TYPES
-- ----------------------------------------------------------------------------

DO $$ BEGIN
    CREATE TYPE core.apaar_verification_status_enum AS ENUM (
        'VERIFIED',
        'EXEMPT_FOREIGN_PROVISIONAL',   -- Foreign National awaiting APAAR issuance
        'REVOKED'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE core.enrolment_status_enum AS ENUM (
        'VERIFIED_ACTIVE',
        'GRADUATED',
        'DROPPED_OUT',
        'TRANSFERRED_OUT',
        'WITHDRAWN'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- 2. core.students (verified identity)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS core.students (
    student_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    apaar_id CHAR(12) UNIQUE CHECK (apaar_id ~ '^[0-9]{12}$'),
    apaar_verification_status core.apaar_verification_status_enum NOT NULL,
    apaar_verified_at TIMESTAMPTZ,
    full_name VARCHAR(200) NOT NULL CHECK (length(btrim(full_name)) > 0),
    date_of_birth DATE NOT NULL CHECK (date_of_birth >= DATE '1930-01-01'),
    gender VARCHAR(10) CHECK (gender IN ('MALE', 'FEMALE', 'OTHER')),
    residency_status master.residency_status_enum NOT NULL DEFAULT 'INDIAN_RESIDENT',
    nationality_country_code CHAR(2) CHECK (nationality_country_code ~ '^[A-Z]{2}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (student_id, residency_status),   -- Target of the profile composite FK

    -- Only a Foreign National may exist without an APAAR id, and only provisionally
    CONSTRAINT chk_students_apaar_state CHECK (
        (apaar_verification_status = 'VERIFIED' AND apaar_id IS NOT NULL AND apaar_verified_at IS NOT NULL)
        OR (apaar_verification_status = 'EXEMPT_FOREIGN_PROVISIONAL' AND residency_status = 'FOREIGN_NATIONAL')
        OR (apaar_verification_status = 'REVOKED' AND apaar_id IS NOT NULL)
    )
);

CREATE TRIGGER trg_students_updated_at
    BEFORE UPDATE ON core.students
    FOR EACH ROW EXECUTE FUNCTION master.set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. core.student_foreign_nri_profiles (mandatory 1-to-1 for non-resident students)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS core.student_foreign_nri_profiles (
    student_id UUID PRIMARY KEY,
    residency_status master.residency_status_enum NOT NULL,
    country_of_citizenship CHAR(2) NOT NULL CHECK (country_of_citizenship ~ '^[A-Z]{2}$'),

    passport_number_enc BYTEA NOT NULL,                 -- App-side ciphertext
    passport_fingerprint BYTEA NOT NULL CHECK (octet_length(passport_fingerprint) = 32),
    passport_expiry DATE,
    visa_type VARCHAR(50),
    frro_registration_no_enc BYTEA,                     -- App-side ciphertext
    oci_card_no_enc BYTEA,                              -- App-side ciphertext
    embassy_sponsorship_ref_enc BYTEA,                  -- App-side ciphertext
    encryption_key_version SMALLINT NOT NULL DEFAULT 1,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (passport_fingerprint),

    -- Profile category always equals the student's category (cannot drift)
    CONSTRAINT fk_profile_student FOREIGN KEY (student_id, residency_status)
        REFERENCES core.students(student_id, residency_status)
        ON UPDATE CASCADE ON DELETE CASCADE,

    CONSTRAINT chk_profile_non_resident CHECK (residency_status <> 'INDIAN_RESIDENT'),

    -- Category-specific proofs (passport is required for every category)
    CONSTRAINT chk_profile_required_proofs CHECK (
        residency_status IN ('NRI', 'PIO')
        OR (residency_status = 'OCI' AND oci_card_no_enc IS NOT NULL)
        OR (residency_status = 'FOREIGN_NATIONAL' AND (visa_type IS NOT NULL OR frro_registration_no_enc IS NOT NULL))
        OR (residency_status = 'CIWGC' AND embassy_sponsorship_ref_enc IS NOT NULL)
    )
);

CREATE TRIGGER trg_foreign_profiles_updated_at
    BEFORE UPDATE ON core.student_foreign_nri_profiles
    FOR EACH ROW EXECUTE FUNCTION master.set_updated_at();

-- A non-resident student MUST have a profile by commit time (deferred: both rows may be inserted together)
CREATE OR REPLACE FUNCTION core.enforce_profile_presence()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_student_id UUID := CASE WHEN TG_OP = 'DELETE' THEN OLD.student_id ELSE NEW.student_id END;
    v_res master.residency_status_enum;
BEGIN
    SELECT s.residency_status INTO v_res FROM core.students s WHERE s.student_id = v_student_id;
    IF FOUND AND v_res <> 'INDIAN_RESIDENT'
       AND NOT EXISTS (SELECT 1 FROM core.student_foreign_nri_profiles p WHERE p.student_id = v_student_id) THEN
        RAISE EXCEPTION 'core.students: % student % requires a row in core.student_foreign_nri_profiles', v_res, v_student_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_students_require_profile
    AFTER INSERT OR UPDATE OF residency_status ON core.students
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION core.enforce_profile_presence();

CREATE CONSTRAINT TRIGGER trg_profile_delete_requires_resident
    AFTER DELETE ON core.student_foreign_nri_profiles
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION core.enforce_profile_presence();

-- ----------------------------------------------------------------------------
-- 4. core.student_enrolments (PARTITIONED BY LIST (academic_year))
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS core.student_enrolments (
    enrolment_id UUID NOT NULL DEFAULT gen_random_uuid(),
    academic_year CHAR(7) NOT NULL CHECK (academic_year ~ '^[0-9]{4}-[0-9]{2}$'),
    student_id UUID NOT NULL REFERENCES core.students(student_id) ON DELETE RESTRICT,
    institution_id UUID NOT NULL REFERENCES master.institutions(institution_id) ON DELETE RESTRICT,
    program_id UUID NOT NULL REFERENCES master.institutional_programs(program_id) ON DELETE RESTRICT,
    intake_approval_id UUID NOT NULL REFERENCES master.program_intake_approvals(intake_approval_id) ON DELETE RESTRICT,

    seat_quota_type master.seat_quota_type_enum NOT NULL,
    is_supernumerary_seat BOOLEAN GENERATED ALWAYS AS (
        seat_quota_type IN ('SUPERNUMERARY_TFW', 'SUPERNUMERARY_FN_OCI_CIWGC', 'SUPERNUMERARY_PMSSS',
                            'SUPERNUMERARY_EWS', 'LATERAL_ENTRY')
    ) STORED,
    entry_year_of_study SMALLINT NOT NULL DEFAULT 1 CHECK (entry_year_of_study BETWEEN 1 AND 6),
    roll_no VARCHAR(50),
    admission_date DATE NOT NULL,

    enrolment_status core.enrolment_status_enum NOT NULL DEFAULT 'VERIFIED_ACTIVE',
    status_changed_at TIMESTAMPTZ,

    source_batch_id UUID,                    -- Soft pointers back to staging (no FK: staging is purgeable)
    source_record_id BIGINT,
    verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (enrolment_id, academic_year),
    CONSTRAINT chk_lateral_entry_year CHECK ((seat_quota_type = 'LATERAL_ENTRY') = (entry_year_of_study = 2))
) PARTITION BY LIST (academic_year);

CREATE INDEX IF NOT EXISTS idx_enrol_inst_year ON core.student_enrolments(institution_id, academic_year);
CREATE INDEX IF NOT EXISTS idx_enrol_program_year ON core.student_enrolments(program_id, academic_year);
CREATE INDEX IF NOT EXISTS idx_enrol_student ON core.student_enrolments(student_id);
CREATE INDEX IF NOT EXISTS idx_enrol_source_batch ON core.student_enrolments(source_batch_id) WHERE source_batch_id IS NOT NULL;
-- A roll number is unique per program per year among ACTIVE enrolments
CREATE UNIQUE INDEX IF NOT EXISTS uq_enrol_active_roll
    ON core.student_enrolments(academic_year, program_id, roll_no)
    WHERE roll_no IS NOT NULL AND enrolment_status = 'VERIFIED_ACTIVE';

CREATE TRIGGER trg_enrolments_updated_at
    BEFORE UPDATE ON core.student_enrolments
    FOR EACH ROW EXECUTE FUNCTION master.set_updated_at();

-- 4.1 Guard: institution/program/year must match the intake approval; identity columns are immutable;
--     an ended enrolment can never be re-activated (a new enrolment must go through Stage 4).
CREATE OR REPLACE FUNCTION core.enrolment_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
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
    ELSE
        IF NEW.academic_year <> OLD.academic_year OR NEW.student_id <> OLD.student_id
           OR NEW.institution_id <> OLD.institution_id OR NEW.program_id <> OLD.program_id
           OR NEW.intake_approval_id <> OLD.intake_approval_id OR NEW.seat_quota_type <> OLD.seat_quota_type THEN
            RAISE EXCEPTION 'core.student_enrolments: identity, placement and quota columns are immutable'
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

CREATE TRIGGER trg_enrolments_guard
    BEFORE INSERT OR UPDATE ON core.student_enrolments
    FOR EACH ROW EXECUTE FUNCTION core.enrolment_guard();

-- 4.2 Partition helper (new academic years are one call away)
CREATE OR REPLACE FUNCTION core.create_enrolment_partition(p_academic_year TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_name TEXT;
BEGIN
    IF p_academic_year !~ '^[0-9]{4}-[0-9]{2}$' THEN
        RAISE EXCEPTION 'create_enrolment_partition: academic year must look like 2026-27, got %', p_academic_year;
    END IF;
    v_name := 'student_enrolments_' || replace(p_academic_year, '-', '_');
    EXECUTE format('CREATE TABLE IF NOT EXISTS core.%I PARTITION OF core.student_enrolments FOR VALUES IN (%L)',
                   v_name, p_academic_year);
    -- Partitions are queried directly by some tools; RLS on the parent does not cover them
    EXECUTE format('ALTER TABLE core.%I ENABLE ROW LEVEL SECURITY', v_name);
    EXECUTE format('REVOKE ALL ON core.%I FROM PUBLIC, anon, authenticated', v_name);
    RETURN v_name;
END;
$$;

SELECT core.create_enrolment_partition(y)
FROM unnest(ARRAY['2024-25', '2025-26', '2026-27', '2027-28']) AS y;

-- ----------------------------------------------------------------------------
-- 5. core.active_national_enrolment_locks (one row per active full-time student)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS core.active_national_enrolment_locks (
    student_id UUID PRIMARY KEY REFERENCES core.students(student_id) ON DELETE RESTRICT,
    apaar_id CHAR(12) UNIQUE,                -- Always copied from core.students by trigger
    institution_id UUID NOT NULL REFERENCES master.institutions(institution_id) ON DELETE RESTRICT,
    program_id UUID NOT NULL REFERENCES master.institutional_programs(program_id) ON DELETE RESTRICT,
    academic_year CHAR(7) NOT NULL,
    enrolment_id UUID NOT NULL UNIQUE,
    locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Deferred: Stage 4 inserts the lock first (to detect duplicates), the enrolment second
    CONSTRAINT fk_lock_enrolment FOREIGN KEY (enrolment_id, academic_year)
        REFERENCES core.student_enrolments(enrolment_id, academic_year)
        ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS idx_locks_institution ON core.active_national_enrolment_locks(institution_id);

CREATE OR REPLACE FUNCTION core.lock_fill_apaar()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    SELECT s.apaar_id INTO NEW.apaar_id FROM core.students s WHERE s.student_id = NEW.student_id;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_locks_fill_apaar
    BEFORE INSERT ON core.active_national_enrolment_locks
    FOR EACH ROW EXECUTE FUNCTION core.lock_fill_apaar();

-- 5.1 Ending an enrolment releases the lock (graduate / drop-out / transfer / withdraw)
CREATE OR REPLACE FUNCTION core.release_lock_on_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF OLD.enrolment_status = 'VERIFIED_ACTIVE' AND NEW.enrolment_status <> 'VERIFIED_ACTIVE' THEN
        DELETE FROM core.active_national_enrolment_locks WHERE enrolment_id = NEW.enrolment_id;
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_enrolments_release_lock
    AFTER UPDATE OF enrolment_status ON core.student_enrolments
    FOR EACH ROW EXECUTE FUNCTION core.release_lock_on_status_change();

-- 5.2 Every ACTIVE enrolment must hold a matching national lock at commit time
--     (re-reads the CURRENT row: a deferred event may carry a stale NEW).
CREATE OR REPLACE FUNCTION core.enforce_active_enrolment_lock()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    e core.student_enrolments%ROWTYPE;
BEGIN
    SELECT * INTO e FROM core.student_enrolments x
     WHERE x.enrolment_id = NEW.enrolment_id AND x.academic_year = NEW.academic_year;
    IF FOUND AND e.enrolment_status = 'VERIFIED_ACTIVE' AND NOT EXISTS (
        SELECT 1 FROM core.active_national_enrolment_locks l
         WHERE l.enrolment_id = e.enrolment_id AND l.student_id = e.student_id
           AND l.institution_id = e.institution_id AND l.program_id = e.program_id
    ) THEN
        RAISE EXCEPTION 'core.student_enrolments: active enrolment % has no matching national lock', e.enrolment_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_enrolments_require_lock
    AFTER INSERT OR UPDATE OF enrolment_status ON core.student_enrolments
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION core.enforce_active_enrolment_lock();

-- ----------------------------------------------------------------------------
-- 6. STAGE 4 : core.promote_program_batch()  (atomic unit: ONE program of ONE batch)
-- ----------------------------------------------------------------------------
-- Everything below runs in the CALLER'S transaction, so it is all-or-nothing.
-- Order of work:
--   0. validate batch, lock the program's intake row (FOR UPDATE)  -> serialises uploads per program
--   1. static quarantines (identity, quota, dates, duplicates, roll numbers)
--   2. take national locks, ordered by student_id (consistent order = no deadlocks);
--      students already locked anywhere are quarantined as duplicates
--   3. enforce quota caps in source-row order; over-cap rows release their locks
--   4. insert enrolments, mark staging VALID, bump the master counters
-- The Node worker publishes the Redis event AFTER this call commits.

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
       AND a.institution_id = v_batch.institution_id      -- a batch can never fill another college's program
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
                                  'quarantined', v_quarantined,
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
     ORDER BY r.resolved_student_id                           -- same order everywhere => no lock-order deadlocks
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

    -- 3. Quota caps (source-row order decides who gets the remaining seats) -------
    WITH caps (q, approved, actual, code) AS (
        VALUES
        ('REGULAR_SANCTIONED'::master.seat_quota_type_enum,       v_intake.approved_sanctioned_intake,            v_intake.actual_regular_enrolled,       'EXCEEDS_SANCTIONED_INTAKE'::staging.anomaly_code_enum),
        ('NRI_QUOTA'::master.seat_quota_type_enum,                v_intake.approved_nri_seats,                    v_intake.actual_nri_enrolled,           'EXCEEDS_NRI_QUOTA'::staging.anomaly_code_enum),
        ('SUPERNUMERARY_TFW'::master.seat_quota_type_enum,        v_intake.approved_supernumerary_tfw,            v_intake.actual_tfw_enrolled,           'EXCEEDS_SUPERNUMERARY_TFW'::staging.anomaly_code_enum),
        ('SUPERNUMERARY_FN_OCI_CIWGC'::master.seat_quota_type_enum, v_intake.approved_supernumerary_fn_oci_ciwgc, v_intake.actual_fn_oci_ciwgc_enrolled, 'EXCEEDS_SUPERNUMERARY_FN_OCI_CIWGC'::staging.anomaly_code_enum),
        ('SUPERNUMERARY_PMSSS'::master.seat_quota_type_enum,      v_intake.approved_supernumerary_pmsss,          v_intake.actual_pmsss_enrolled,         'EXCEEDS_SUPERNUMERARY_PMSSS'::staging.anomaly_code_enum),
        ('SUPERNUMERARY_EWS'::master.seat_quota_type_enum,        v_intake.approved_supernumerary_ews,            v_intake.actual_ews_enrolled,           'EXCEEDS_SUPERNUMERARY_EWS'::staging.anomaly_code_enum),
        ('LATERAL_ENTRY'::master.seat_quota_type_enum,            v_intake.approved_lateral_entry_seats,          v_intake.actual_lateral_enrolled,       'EXCEEDS_LATERAL_ENTRY_INTAKE'::staging.anomaly_code_enum)
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
                              'promoted', v_promoted, 'quarantined', v_quarantined, 'by_code', v_by_code,
                              'by_quota', jsonb_build_object('regular', n_regular, 'nri', n_nri, 'tfw', n_tfw,
                                                             'fn_oci_ciwgc', n_fn, 'pmsss', n_pmsss, 'ews', n_ews,
                                                             'lateral', n_lateral));
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. core.finalize_batch() / core.promote_batch()
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION core.finalize_batch(p_batch_id UUID)
RETURNS staging.batch_status_enum
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_status staging.batch_status_enum;
    v_total INT; v_l1 INT; v_l2 INT; v_l3 INT; v_valid INT; v_open INT;
    v_final staging.batch_status_enum;
BEGIN
    SELECT status INTO v_status FROM staging.submission_batches WHERE batch_id = p_batch_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'finalize_batch: batch % not found', p_batch_id;
    END IF;
    IF v_status NOT IN ('L2_COMPLETED', 'L3_PROCESSING') THEN
        RAISE EXCEPTION 'finalize_batch: batch % is in status % (expected L2_COMPLETED or L3_PROCESSING)', p_batch_id, v_status;
    END IF;

    SELECT count(*),
           count(*) FILTER (WHERE validation_status = 'REJECTED'),
           count(*) FILTER (WHERE validation_status = 'QUARANTINED' AND rejected_at_level = 2),
           count(*) FILTER (WHERE validation_status = 'QUARANTINED' AND rejected_at_level = 3),
           count(*) FILTER (WHERE validation_status = 'VALID'),
           count(*) FILTER (WHERE validation_status IN ('PENDING', 'L1_PASSED', 'L2_VERIFIED'))
      INTO v_total, v_l1, v_l2, v_l3, v_valid, v_open
      FROM staging.staging_enrolment_records WHERE batch_id = p_batch_id;

    IF v_open > 0 THEN
        RAISE EXCEPTION 'finalize_batch: batch % still has % unprocessed rows', p_batch_id, v_open;
    END IF;

    v_final := CASE WHEN v_valid = v_total THEN 'COMPLETED' ELSE 'COMPLETED_WITH_ANOMALIES' END;

    UPDATE staging.submission_batches
       SET total_rows = v_total, l1_rejected_rows = v_l1, l2_quarantined_rows = v_l2,
           l3_quarantined_rows = v_l3, promoted_rows = v_valid,
           status = v_final, completed_at = NOW()
     WHERE batch_id = p_batch_id;
    RETURN v_final;
END;
$$;

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

    -- One program at a time, in a stable order (consistent lock order across concurrent batches)
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

-- ----------------------------------------------------------------------------
-- 8. ACCESS CONTROL (backend-only: RLS ON, no policies, no grants to API roles)
-- ----------------------------------------------------------------------------

ALTER TABLE core.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.student_foreign_nri_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.student_enrolments ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.active_national_enrolment_locks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON core.students, core.student_foreign_nri_profiles,
              core.student_enrolments, core.active_national_enrolment_locks
    FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION core.promote_program_batch(UUID, UUID),
                       core.promote_batch(UUID),
                       core.finalize_batch(UUID),
                       core.create_enrolment_partition(TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION core.promote_program_batch(UUID, UUID),
                          core.promote_batch(UUID),
                          core.finalize_batch(UUID),
                          core.create_enrolment_partition(TEXT)
    TO postgres, service_role;

COMMIT;