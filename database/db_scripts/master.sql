BEGIN;

-- 1. Enable Required PostgreSQL Extensions in Supabase (`extensions` schema)
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "btree_gist" WITH SCHEMA extensions;

-- 2. Create the 5 Segregated Database Schemas (Zones)
CREATE SCHEMA IF NOT EXISTS master;     -- Zone 1: AICTE Institutions, Programs & Approved Intake Caps
CREATE SCHEMA IF NOT EXISTS staging;    -- Zone 2: Bulk CSV/API Landing & Anomaly Quarantine
CREATE SCHEMA IF NOT EXISTS core;       -- Zone 3: Verified APAAR Students, Enrolments & National Locks
CREATE SCHEMA IF NOT EXISTS trust;      -- Zone 4: W3C Verifiable Credentials, Consents & Audit Ledger
CREATE SCHEMA IF NOT EXISTS analytics;  -- Zone 5: Pre-aggregated Materialized Views for Dashboards

-- 3. Grant Schema Usage to Supabase Roles (Node.js Backend uses `postgres` / `service_role`)
GRANT USAGE ON SCHEMA master, staging, core, trust, analytics TO postgres, service_role, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA master, staging, core, trust, analytics
    GRANT ALL ON TABLES TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA master, staging, core, trust, analytics
    GRANT ALL ON SEQUENCES TO postgres, service_role;

-- ============================================================================
-- 4. GLOBAL ENUM TYPES (Placed in `master` schema for cross-zone reference)
-- ============================================================================

DO $$ BEGIN
    CREATE TYPE master.user_role_enum AS ENUM (
        'AICTE_SUPER_ADMIN',
        'AICTE_REGIONAL_OFFICER',
        'AFFILIATING_BODY_REGISTRAR',
        'INSTITUTION_NODAL_OFFICER',
        'EMPLOYER_VERIFIER',
        'STUDENT'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE master.institution_category_enum AS ENUM (
        'CENTRAL_UNIVERSITY',
        'STATE_UNIVERSITY',
        'DEEMED_TO_BE_UNIVERSITY',
        'PRIVATE_UNIVERSITY',
        'AUTONOMOUS_INSTITUTE',
        'AFFILIATED_COLLEGE',
        'PGDM_STANDALONE'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE master.program_level_enum AS ENUM (
        'DIPLOMA',
        'POST_DIPLOMA',
        'UG_DEGREE',
        'PG_DEGREE',
        'PGDM',
        'FELLOWSHIP_PHD'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE master.program_shift_enum AS ENUM (
        'FIRST_SHIFT',
        'SECOND_SHIFT',
        'PART_TIME',
        'ODL_ONLINE'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE master.residency_status_enum AS ENUM (
        'INDIAN_RESIDENT',
        'NRI',              -- Non-Resident Indian
        'OCI',              -- Overseas Citizen of India
        'PIO',              -- Person of Indian Origin
        'FOREIGN_NATIONAL', -- Foreign National (FN)
        'CIWGC'             -- Children of Indian Workers in Gulf Countries
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE master.seat_quota_type_enum AS ENUM (
        'REGULAR_SANCTIONED',           -- Base Approved Intake
        'NRI_QUOTA',                    -- Approved NRI seats (up to 5% within sanctioned intake)
        'SUPERNUMERARY_TFW',            -- Tuition Fee Waiver (up to 5% supernumerary)
        'SUPERNUMERARY_FN_OCI_CIWGC',   -- Foreign National / OCI / CIWGC (up to 15% supernumerary)
        'SUPERNUMERARY_PMSSS',          -- PM Special Scholarship Scheme
        'SUPERNUMERARY_EWS',            -- EWS Supernumerary
        'LATERAL_ENTRY'                 -- 2nd Year Lateral Entry
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Shared `updated_at` trigger function
CREATE OR REPLACE FUNCTION master.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- ============================================================================
-- 5. ZONE 1 TABLES (`master.*`): INSTITUTIONS, PROGRAMS & APPROVED INTAKE CAPS
-- ============================================================================

-- 5.1 Affiliating Universities / Boards (Degree/Diploma Awarding Bodies)
CREATE TABLE IF NOT EXISTS master.affiliating_bodies (
    affiliating_body_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aishe_code VARCHAR(20) UNIQUE NOT NULL,
    body_name VARCHAR(255) NOT NULL,
    body_type VARCHAR(50) NOT NULL CHECK (body_type IN ('TECHNICAL_UNIVERSITY', 'STATE_BOARD', 'AUTONOMOUS_PGDM_BOARD', 'UNIVERSITY')),
    state_code CHAR(2) NOT NULL,
    nad_issuer_id VARCHAR(50), -- DigiLocker / NAD Issuer ID for Verifiable Credentials
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_affiliating_bodies_updated_at
    BEFORE UPDATE ON master.affiliating_bodies
    FOR EACH ROW EXECUTE FUNCTION master.set_updated_at();

-- 5.2 AICTE-Approved Institutions
CREATE TABLE IF NOT EXISTS master.institutions (
    institution_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aicte_permanent_id VARCHAR(30) UNIQUE NOT NULL, -- e.g., '1-1092837465'
    aishe_code VARCHAR(20) UNIQUE,
    affiliating_body_id UUID REFERENCES master.affiliating_bodies(affiliating_body_id) ON DELETE RESTRICT,
    institution_name VARCHAR(300) NOT NULL,
    institution_category master.institution_category_enum NOT NULL,
    aicte_region VARCHAR(30) NOT NULL CHECK (aicte_region IN (
        'NORTH', 'NORTH_WEST', 'SOUTH', 'SOUTH_WEST', 'CENTRAL', 'EAST', 'WEST', 'SOUTH_CENTRAL'
    )),
    state_code CHAR(2) NOT NULL,
    district_name VARCHAR(100) NOT NULL,
    pin_code CHAR(6) NOT NULL,
    is_minority_institution BOOLEAN NOT NULL DEFAULT FALSE,
    is_women_only BOOLEAN NOT NULL DEFAULT FALSE,
    approval_status VARCHAR(30) NOT NULL DEFAULT 'EOA_GRANTED'
        CHECK (approval_status IN ('EOA_GRANTED', 'NO_ADMISSION', 'WITHDRAWN', 'SUSPENDED')),
    nodal_officer_email VARCHAR(255) NOT NULL,
    nodal_officer_phone VARCHAR(20) NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_institutions_region_state ON master.institutions(aicte_region, state_code);

CREATE TRIGGER trg_institutions_updated_at
    BEFORE UPDATE ON master.institutions
    FOR EACH ROW EXECUTE FUNCTION master.set_updated_at();

-- 5.3 Supabase Auth User Profile Mapping (`auth.users` -> Institution / AICTE Role)
CREATE TABLE IF NOT EXISTS master.user_profiles (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role master.user_role_enum NOT NULL,
    institution_id UUID REFERENCES master.institutions(institution_id) ON DELETE SET NULL,
    affiliating_body_id UUID REFERENCES master.affiliating_bodies(affiliating_body_id) ON DELETE SET NULL,
    aicte_region VARCHAR(30),
    full_name VARCHAR(200) NOT NULL,
    official_designation VARCHAR(100),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_user_profiles_updated_at
    BEFORE UPDATE ON master.user_profiles
    FOR EACH ROW EXECUTE FUNCTION master.set_updated_at();

-- Helper functions for Supabase Row-Level Security (RLS)
CREATE OR REPLACE FUNCTION master.current_user_institution_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = master, public
AS $$
    SELECT institution_id FROM master.user_profiles WHERE user_id = auth.uid() AND is_active = TRUE;
$$;

CREATE OR REPLACE FUNCTION master.current_user_role()
RETURNS master.user_role_enum
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = master, public
AS $$
    SELECT role FROM master.user_profiles WHERE user_id = auth.uid() AND is_active = TRUE;
$$;

-- 5.4 Institutional Programs (Courses approved by AICTE)
CREATE TABLE IF NOT EXISTS master.institutional_programs (
    program_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID NOT NULL REFERENCES master.institutions(institution_id) ON DELETE RESTRICT,
    aicte_course_id VARCHAR(40) UNIQUE NOT NULL,
    program_level master.program_level_enum NOT NULL,
    program_shift master.program_shift_enum NOT NULL DEFAULT 'FIRST_SHIFT',
    program_broad_discipline VARCHAR(100) NOT NULL, -- e.g., 'ENGINEERING_AND_TECHNOLOGY', 'MANAGEMENT_PGDM'
    course_name VARCHAR(250) NOT NULL,
    duration_years NUMERIC(3,1) NOT NULL CHECK (duration_years BETWEEN 1.0 AND 6.0),
    is_nba_accredited BOOLEAN NOT NULL DEFAULT FALSE,
    nba_valid_upto DATE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (institution_id, program_level, program_shift, course_name)
);

CREATE INDEX IF NOT EXISTS idx_programs_institution ON master.institutional_programs(institution_id);

CREATE TRIGGER trg_programs_updated_at
    BEFORE UPDATE ON master.institutional_programs
    FOR EACH ROW EXECUTE FUNCTION master.set_updated_at();

-- 5.5 Annual AICTE Program Intake Approvals (The Quota Enforcement Matrix)
CREATE TABLE IF NOT EXISTS master.program_intake_approvals (
    intake_approval_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id UUID NOT NULL REFERENCES master.institutional_programs(program_id) ON DELETE RESTRICT,
    institution_id UUID NOT NULL REFERENCES master.institutions(institution_id) ON DELETE RESTRICT,
    academic_year CHAR(7) NOT NULL CHECK (academic_year ~ '^[0-9]{4}-[0-9]{2}$'),
    eoa_letter_ref_no VARCHAR(100) NOT NULL,
    eoa_issue_date DATE NOT NULL,

    -- Approved Seat Caps (Set by AICTE EoA)
    approved_sanctioned_intake INT NOT NULL CHECK (approved_sanctioned_intake >= 0),
    approved_nri_seats INT NOT NULL DEFAULT 0 CHECK (approved_nri_seats >= 0),
    approved_supernumerary_tfw INT NOT NULL DEFAULT 0 CHECK (approved_supernumerary_tfw >= 0),
    approved_supernumerary_fn_oci_ciwgc INT NOT NULL DEFAULT 0 CHECK (approved_supernumerary_fn_oci_ciwgc >= 0),
    approved_supernumerary_pmsss INT NOT NULL DEFAULT 0 CHECK (approved_supernumerary_pmsss >= 0),
    approved_supernumerary_ews INT NOT NULL DEFAULT 0 CHECK (approved_supernumerary_ews >= 0),
    approved_lateral_entry_seats INT NOT NULL DEFAULT 0 CHECK (approved_lateral_entry_seats >= 0),

    -- Real-Time Verified Enrolment Counters (Incremented atomically during Stage 4 promotion)
    actual_regular_enrolled INT NOT NULL DEFAULT 0 CHECK (actual_regular_enrolled >= 0),
    actual_nri_enrolled INT NOT NULL DEFAULT 0 CHECK (actual_nri_enrolled >= 0),
    actual_tfw_enrolled INT NOT NULL DEFAULT 0 CHECK (actual_tfw_enrolled >= 0),
    actual_fn_oci_ciwgc_enrolled INT NOT NULL DEFAULT 0 CHECK (actual_fn_oci_ciwgc_enrolled >= 0),
    actual_pmsss_enrolled INT NOT NULL DEFAULT 0 CHECK (actual_pmsss_enrolled >= 0),
    actual_ews_enrolled INT NOT NULL DEFAULT 0 CHECK (actual_ews_enrolled >= 0),
    actual_lateral_enrolled INT NOT NULL DEFAULT 0 CHECK (actual_lateral_enrolled >= 0),

    admission_cutoff_date TIMESTAMPTZ NOT NULL,
    is_locked_by_aicte BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (program_id, academic_year)
);

CREATE INDEX IF NOT EXISTS idx_intake_inst_year ON master.program_intake_approvals(institution_id, academic_year);

CREATE TRIGGER trg_intake_approvals_updated_at
    BEFORE UPDATE ON master.program_intake_approvals
    FOR EACH ROW EXECUTE FUNCTION master.set_updated_at();

-- ============================================================================
-- 6. ROW-LEVEL SECURITY (RLS) FOR ZONE 1 (`master.*`)
-- ============================================================================
ALTER TABLE master.affiliating_bodies ENABLE ROW LEVEL SECURITY;
ALTER TABLE master.institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE master.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE master.institutional_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE master.program_intake_approvals ENABLE ROW LEVEL SECURITY;

-- Institutions can view their own institution, programs, and intake approvals;
-- AICTE admins can view all.
CREATE POLICY pol_institutions_read ON master.institutions
    FOR SELECT TO authenticated
    USING (
        institution_id = master.current_user_institution_id()
        OR master.current_user_role() IN ('AICTE_SUPER_ADMIN', 'AICTE_REGIONAL_OFFICER')
    );

CREATE POLICY pol_programs_read ON master.institutional_programs
    FOR SELECT TO authenticated
    USING (
        institution_id = master.current_user_institution_id()
        OR master.current_user_role() IN ('AICTE_SUPER_ADMIN', 'AICTE_REGIONAL_OFFICER')
    );

CREATE POLICY pol_intake_read ON master.program_intake_approvals
    FOR SELECT TO authenticated
    USING (
        institution_id = master.current_user_institution_id()
        OR master.current_user_role() IN ('AICTE_SUPER_ADMIN', 'AICTE_REGIONAL_OFFICER')
    );
COMMIT; 