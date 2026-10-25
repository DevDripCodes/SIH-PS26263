BEGIN;

-- ============================================================================
-- ZONE 4: `trust.*` (Verifiable Credentials, Consent & Tamper-Evident Audit)
-- Depends on: master schema script, staging schema script, core schema script.
-- Requires PostgreSQL 14+ (CREATE OR REPLACE TRIGGER) - Supabase default.
-- Access model: backend-only (postgres / service_role). RLS ON with no policies.
--
-- VULNERABILITY REGISTER (each item is closed below and asserted in 04b_trust_tests.sql)
--   V01 Audit rows edited/deleted/truncated          -> triggers (ENABLE ALWAYS) + no UPDATE/DELETE/TRUNCATE grant
--   V02 Backend forges hash/seq/time/actor           -> BEFORE INSERT trigger computes ALL chain fields, overrides input
--   V03 Concurrent writers fork the chain            -> per-chain head row locked FOR UPDATE until commit, seq is PK
--   V04 Backend forges "system" audit events         -> reserved chains writable only from inside other triggers
--   V05 Tail truncation / head reset goes unnoticed  -> head guard (+1 only), verify_audit_chain, signed checkpoints
--   V06 Ambiguous hash input (field-boundary tricks) -> length-prefixed canonical encoding, payload frozen as text
--   V07 PII lands in an un-erasable ledger (DPDP)    -> forbidden-key guard, size cap, no free text in payloads, soft refs
--   V08 Credential issued by wrong institution       -> issuer must be nodal officer of THAT institution / its registrar
--   V09 Printed IDs differ from the registry         -> printed_apaar_id / roll copied from core by trigger, never trusted
--   V10 Credential type vs enrolment state abuse     -> degree only when GRADUATED, etc.; APAAR must be VERIFIED
--   V11 Issued credential content rewritten          -> only status columns mutable; no delete; hash UNIQUE
--   V12 Revoked credential resurrected / ghost state -> explicit state machine; SUPERSEDED only via re-issue
--   V13 Consent for someone else's credential (IDOR) -> scope credential must belong to the consenting student
--   V14 Backdated / indefinite / replayed consent    -> granted_at = now(), <= 1 year, artifact hash UNIQUE
--   V15 Minor's consent accepted (DPDP s.9)          -> guardian consent required when age < 18
--   V16 Verifier uses another org's consent          -> consent bound to grantee org; requester must be a member of org
--   V17 Existence oracle / ID enumeration            -> dual-ID checked BEFORE consent state; coarse public result; rate limit
--   V18 Revocation / withdrawal race (TOCTOU)        -> verify takes FOR SHARE on credential + consent rows
--   V19 Default privileges hand service_role ALL     -> explicit REVOKE ALL then minimal GRANT per table
--   V20 SECURITY DEFINER / search_path hijack        -> one definer function only, fixed search_path everywhere, no dynamic SQL
--   V21 Actor spoofing through pooled sessions       -> actor read from transaction-local GUC only (set_config(..., true))
-- ============================================================================

DO $$
BEGIN
    IF to_regclass('core.students') IS NULL
       OR to_regclass('core.student_enrolments') IS NULL
       OR to_regclass('master.user_profiles') IS NULL
       OR to_regclass('master.institutions') IS NULL THEN
        RAISE EXCEPTION 'trust schema: run the master, staging and core scripts first';
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. ENUM TYPES
-- ----------------------------------------------------------------------------

DO $$ BEGIN
    CREATE TYPE trust.credential_type_enum AS ENUM (
        'DEGREE_CERTIFICATE', 'DIPLOMA_CERTIFICATE', 'PROVISIONAL_CERTIFICATE',
        'SEMESTER_MARKSHEET', 'ENROLMENT_PROOF', 'TRANSFER_CERTIFICATE'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE trust.credential_status_enum AS ENUM ('ISSUED', 'SUSPENDED', 'REVOKED', 'SUPERSEDED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE trust.consent_purpose_enum AS ENUM (
        'EMPLOYMENT_VERIFICATION', 'HIGHER_EDUCATION_ADMISSION', 'SCHOLARSHIP_ELIGIBILITY',
        'GOVERNMENT_SCHEME_BENEFIT', 'DIGILOCKER_ISSUANCE'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE trust.consent_status_enum AS ENUM ('GRANTED', 'WITHDRAWN');   -- EXPIRED is derived from expires_at
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE trust.consent_channel_enum AS ENUM ('DIGILOCKER', 'STUDENT_APP', 'OTP_ESIGN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE trust.disclosure_category_enum AS ENUM (
        'CREDENTIAL_VALIDITY', 'PROGRAM_DETAILS', 'GRADES', 'ENROLMENT_STATUS'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE trust.verifier_org_type_enum AS ENUM (
        'EMPLOYER', 'BGV_AGENCY', 'EDUCATIONAL_INSTITUTION', 'GOVERNMENT_AGENCY', 'DIGILOCKER_PLATFORM'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE trust.verifier_org_status_enum AS ENUM ('PENDING', 'APPROVED', 'SUSPENDED', 'REVOKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE trust.verification_outcome_enum AS ENUM (
        'VERIFIED', 'NOT_FOUND', 'ID_MISMATCH', 'CONSENT_REQUIRED',
        'CREDENTIAL_REVOKED', 'CREDENTIAL_SUSPENDED', 'CREDENTIAL_SUPERSEDED', 'CREDENTIAL_OUTSIDE_VALIDITY',
        'ORG_NOT_APPROVED', 'REQUESTER_NOT_AUTHORISED', 'RATE_LIMITED'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- 2. SHARED HELPERS (every function pins search_path; none uses dynamic SQL)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trust.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

-- The acting user is passed by the backend with set_config('app.actor_user_id', '<uuid>', true) INSIDE the
-- transaction (is_local = true). Never use a session-level SET: Supavisor transaction pooling would leak it
-- to the next client that gets the same connection.
CREATE OR REPLACE FUNCTION trust.current_actor()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_raw TEXT := NULLIF(btrim(current_setting('app.actor_user_id', true)), '');
BEGIN
    IF v_raw IS NULL THEN
        RETURN NULL;
    END IF;
    IF v_raw !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
        RAISE EXCEPTION 'app.actor_user_id is not a valid UUID' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    RETURN v_raw::uuid;
END;
$$;

CREATE OR REPLACE FUNCTION trust.current_request_id()
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT left(NULLIF(btrim(current_setting('app.request_id', true)), ''), 100);
$$;

-- If the backend declared an actor for this transaction, any user id written into a row must be that actor.
CREATE OR REPLACE FUNCTION trust.assert_actor_matches(p_claimed UUID)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_actor UUID := trust.current_actor();
BEGIN
    IF v_actor IS NOT NULL AND p_claimed IS DISTINCT FROM v_actor THEN
        RAISE EXCEPTION 'user % does not match the session actor %', p_claimed, v_actor
            USING ERRCODE = 'insufficient_privilege';
    END IF;
END;
$$;

-- Issuing / changing a credential: nodal officer of THAT institution, or registrar of its affiliating body.
CREATE OR REPLACE FUNCTION trust.assert_institution_actor(p_user UUID, p_institution UUID, p_what TEXT)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    u master.user_profiles%ROWTYPE;
    v_body UUID;
BEGIN
    IF p_user IS NULL THEN
        RAISE EXCEPTION '%: an acting user is required', p_what USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO u FROM master.user_profiles up WHERE up.user_id = p_user AND up.is_active = TRUE;
    IF NOT FOUND THEN
        RAISE EXCEPTION '%: user % is not an active user and is not authorised', p_what, p_user
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF u.role = 'INSTITUTION_NODAL_OFFICER' AND u.institution_id = p_institution THEN
        RETURN;
    END IF;
    IF u.role = 'AFFILIATING_BODY_REGISTRAR' THEN
        SELECT i.affiliating_body_id INTO v_body FROM master.institutions i WHERE i.institution_id = p_institution;
        IF v_body IS NOT NULL AND u.affiliating_body_id = v_body THEN
            RETURN;
        END IF;
    END IF;
    RAISE EXCEPTION '%: user % is not authorised for institution %', p_what, p_user, p_institution
        USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE OR REPLACE FUNCTION trust.assert_aicte_officer(p_user UUID, p_what TEXT)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF p_user IS NULL OR NOT EXISTS (
        SELECT 1 FROM master.user_profiles up
         WHERE up.user_id = p_user AND up.is_active = TRUE
           AND up.role IN ('AICTE_SUPER_ADMIN', 'AICTE_REGIONAL_OFFICER')
    ) THEN
        RAISE EXCEPTION '%: user % is not authorised (AICTE officer required)', p_what, p_user
            USING ERRCODE = 'insufficient_privilege';
    END IF;
END;
$$;

-- Used by every append-only table (also fires for TRUNCATE).
CREATE OR REPLACE FUNCTION trust.forbid_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION '%.%: % is not allowed (append-only; rows are never updated, deleted or truncated)',
        TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

-- Length-prefixed field encoding: "3:abc;" (NULL = "~;"). Concatenation can never be re-split differently.
CREATE OR REPLACE FUNCTION trust._lp(p TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT CASE WHEN p IS NULL THEN '~;' ELSE octet_length(p)::text || ':' || p || ';' END;
$$;

-- Canonical hash of one audit row (v1):  sha256( prev_hash || utf8("trust.audit.v1;" || lp(field)... ) )
-- Timestamp = UTC, microseconds, fixed text format. Payload = the frozen payload_text column.
-- An external verifier can recompute this from an export of the table.
CREATE OR REPLACE FUNCTION trust.audit_digest(
    p_chain_key TEXT, p_seq BIGINT, p_prev_hash BYTEA, p_occurred_at TIMESTAMPTZ, p_event_type TEXT,
    p_actor_user_id UUID, p_actor_role TEXT, p_db_role TEXT, p_request_id TEXT,
    p_subject_type TEXT, p_subject_id UUID, p_institution_id UUID, p_payload_text TEXT)
RETURNS BYTEA
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT sha256(
        p_prev_hash || convert_to(
            'trust.audit.v1;'
            || trust._lp(p_chain_key)
            || trust._lp(p_seq::text)
            || trust._lp(to_char(p_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'))
            || trust._lp(p_event_type)
            || trust._lp(p_actor_user_id::text)
            || trust._lp(p_actor_role)
            || trust._lp(p_db_role)
            || trust._lp(p_request_id)
            || trust._lp(p_subject_type)
            || trust._lp(p_subject_id::text)
            || trust._lp(p_institution_id::text)
            || trust._lp(p_payload_text),
            'UTF8'));
$$;

-- ----------------------------------------------------------------------------
-- 3. TAMPER-EVIDENT AUDIT LEDGER
-- ----------------------------------------------------------------------------
-- Soft references only (no FK to users / institutions / students): an FK with ON DELETE SET NULL would try to
-- UPDATE an immutable row, and RESTRICT would block user deletion. IDs are pseudonymous; PII is never stored.

CREATE TABLE IF NOT EXISTS trust.audit_chain_heads (
    chain_key TEXT PRIMARY KEY CHECK (chain_key ~ '^[a-z_]{3,40}(:[0-9]{1,3})?$'),
    last_seq BIGINT NOT NULL CHECK (last_seq >= 0),
    last_hash BYTEA NOT NULL CHECK (octet_length(last_hash) = 32),
    last_occurred_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION trust.audit_heads_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.last_seq <> 0 THEN
            RAISE EXCEPTION 'audit_chain_heads: a new chain must start at seq 0' USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.chain_key <> OLD.chain_key OR NEW.last_seq <> OLD.last_seq + 1 THEN
            RAISE EXCEPTION 'audit_chain_heads: a head may only advance by exactly one' USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'audit_chain_heads: % is not allowed (append-only)', TG_OP
        USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE OR REPLACE TRIGGER trg_heads_guard
    BEFORE INSERT OR UPDATE OR DELETE ON trust.audit_chain_heads
    FOR EACH ROW EXECUTE FUNCTION trust.audit_heads_guard();
CREATE OR REPLACE TRIGGER trg_heads_no_truncate
    BEFORE TRUNCATE ON trust.audit_chain_heads
    FOR EACH STATEMENT EXECUTE FUNCTION trust.audit_heads_guard();

CREATE TABLE IF NOT EXISTS trust.immutable_audit_logs (
    chain_key TEXT NOT NULL,
    seq BIGINT NOT NULL CHECK (seq > 0),
    occurred_at TIMESTAMPTZ NOT NULL,
    event_type TEXT NOT NULL,
    actor_user_id UUID,
    actor_role master.user_role_enum,
    db_role TEXT NOT NULL,
    request_id TEXT,
    subject_type VARCHAR(40) NOT NULL,
    subject_id UUID,
    institution_id UUID,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    payload_text TEXT NOT NULL,
    prev_hash BYTEA NOT NULL CHECK (octet_length(prev_hash) = 32),
    row_hash BYTEA NOT NULL CHECK (octet_length(row_hash) = 32),

    PRIMARY KEY (chain_key, seq),
    CONSTRAINT chk_audit_event_type CHECK (event_type ~ '^[A-Z][A-Z0-9_]*(\.[A-Z0-9_]+)*$' AND length(event_type) <= 80),
    CONSTRAINT chk_audit_subject_type CHECK (subject_type ~ '^[A-Z][A-Z0-9_]*$'),
    CONSTRAINT chk_audit_payload_object CHECK (jsonb_typeof(payload) = 'object'),
    CONSTRAINT chk_audit_payload_text CHECK (payload_text::jsonb = payload)
);

CREATE INDEX IF NOT EXISTS idx_audit_subject
    ON trust.immutable_audit_logs(subject_type, subject_id, chain_key, seq) WHERE subject_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_actor
    ON trust.immutable_audit_logs(actor_user_id, occurred_at) WHERE actor_user_id IS NOT NULL;

-- The ONLY SECURITY DEFINER function in this schema: it must write the head table, which service_role cannot touch.
CREATE OR REPLACE FUNCTION trust.audit_chain_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    h trust.audit_chain_heads%ROWTYPE;
    v_actor UUID := trust.current_actor();
BEGIN
    IF NEW.chain_key IS NULL OR NEW.chain_key !~ '^[a-z_]{3,40}(:[0-9]{1,3})?$' THEN
        RAISE EXCEPTION 'immutable_audit_logs: invalid chain_key %', NEW.chain_key USING ERRCODE = 'check_violation';
    END IF;

    -- V04: database-generated chains can only be written from inside another trigger (depth >= 2).
    IF NEW.chain_key !~ '^app_' THEN
        IF pg_trigger_depth() < 2
           OR NEW.chain_key !~ '^(credentials|consents|verifier_orgs|verifications:[0-9]{1,2})$' THEN
            RAISE EXCEPTION 'audit chain % is reserved for database-generated events', NEW.chain_key
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;

    IF NEW.payload IS NULL THEN
        NEW.payload := '{}'::jsonb;
    END IF;
    IF octet_length(NEW.payload::text) > 16384 THEN
        RAISE EXCEPTION 'immutable_audit_logs: payload too large (max 16384 bytes)' USING ERRCODE = 'check_violation';
    END IF;
    -- V07: the ledger can never be erased, so personal data must never enter it.
    IF NEW.payload::text ~* '"(passport|visa|frro|aadhaar|aadhar|email|e_mail|mobile|phone|msisdn|full_name|first_name|last_name|middle_name|date_of_birth|dob|address|embassy|oci_card|name)[a-z0-9_]*"\s*:' THEN
        RAISE EXCEPTION 'immutable_audit_logs: payload contains a forbidden key (possible personal data)'
            USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO trust.audit_chain_heads (chain_key, last_seq, last_hash, last_occurred_at)
    VALUES (NEW.chain_key, 0, sha256(convert_to('GENESIS:' || NEW.chain_key, 'UTF8')), 'epoch'::timestamptz)
    ON CONFLICT (chain_key) DO NOTHING;

    -- V03: serialise writers of this chain until commit; seq therefore equals commit order and has no gaps.
    SELECT * INTO h FROM trust.audit_chain_heads x WHERE x.chain_key = NEW.chain_key FOR UPDATE;

    -- V02: every chain field is computed here; whatever the caller sent is discarded.
    NEW.seq := h.last_seq + 1;
    NEW.prev_hash := h.last_hash;
    NEW.occurred_at := GREATEST(clock_timestamp(), h.last_occurred_at);
    NEW.actor_user_id := v_actor;
    NEW.actor_role := (SELECT up.role FROM master.user_profiles up WHERE up.user_id = v_actor);
    NEW.db_role := session_user::text;
    NEW.request_id := trust.current_request_id();
    NEW.payload_text := NEW.payload::text;
    NEW.row_hash := trust.audit_digest(
        NEW.chain_key, NEW.seq, NEW.prev_hash, NEW.occurred_at, NEW.event_type,
        NEW.actor_user_id, NEW.actor_role::text, NEW.db_role, NEW.request_id,
        NEW.subject_type, NEW.subject_id, NEW.institution_id, NEW.payload_text);

    UPDATE trust.audit_chain_heads
       SET last_seq = NEW.seq, last_hash = NEW.row_hash, last_occurred_at = NEW.occurred_at, updated_at = now()
     WHERE chain_key = NEW.chain_key;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_audit_logs_chain
    BEFORE INSERT ON trust.immutable_audit_logs
    FOR EACH ROW EXECUTE FUNCTION trust.audit_chain_before_insert();
CREATE OR REPLACE TRIGGER trg_audit_logs_immutable
    BEFORE UPDATE OR DELETE ON trust.immutable_audit_logs
    FOR EACH ROW EXECUTE FUNCTION trust.forbid_mutation();
CREATE OR REPLACE TRIGGER trg_audit_logs_no_truncate
    BEFORE TRUNCATE ON trust.immutable_audit_logs
    FOR EACH STATEMENT EXECUTE FUNCTION trust.forbid_mutation();

-- Signed checkpoints: the backend signs (chain_key, up_to_seq, head_hash) with a KMS key the database never sees
-- and, ideally, also anchors it outside this database (object-lock bucket, transparency log, e-sign service).
-- This is what makes a full-chain rewrite by a database administrator detectable.
CREATE TABLE IF NOT EXISTS trust.audit_checkpoints (
    checkpoint_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    chain_key TEXT NOT NULL,
    up_to_seq BIGINT NOT NULL CHECK (up_to_seq > 0),
    head_hash BYTEA NOT NULL CHECK (octet_length(head_hash) = 32),
    signature BYTEA NOT NULL CHECK (octet_length(signature) BETWEEN 32 AND 1024),
    signing_key_id VARCHAR(200) NOT NULL,
    external_anchor_ref TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (chain_key, up_to_seq)
);

CREATE OR REPLACE FUNCTION trust.checkpoint_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_hash BYTEA;
BEGIN
    SELECT l.row_hash INTO v_hash FROM trust.immutable_audit_logs l
     WHERE l.chain_key = NEW.chain_key AND l.seq = NEW.up_to_seq;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'audit_checkpoints: no audit row % in chain %', NEW.up_to_seq, NEW.chain_key
            USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF v_hash <> NEW.head_hash THEN
        RAISE EXCEPTION 'audit_checkpoints: head_hash does not match the audit row' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_checkpoints_guard
    BEFORE INSERT ON trust.audit_checkpoints
    FOR EACH ROW EXECUTE FUNCTION trust.checkpoint_guard();
CREATE OR REPLACE TRIGGER trg_checkpoints_immutable
    BEFORE UPDATE OR DELETE ON trust.audit_checkpoints
    FOR EACH ROW EXECUTE FUNCTION trust.forbid_mutation();
CREATE OR REPLACE TRIGGER trg_checkpoints_no_truncate
    BEFORE TRUNCATE ON trust.audit_checkpoints
    FOR EACH STATEMENT EXECUTE FUNCTION trust.forbid_mutation();

-- Application-level audit writer. Chains starting with 'app_' are free-form; the reserved chains are rejected here
-- unless this is called from inside one of the triggers below.
CREATE OR REPLACE FUNCTION trust.log_audit_event(
    p_chain_key TEXT, p_event_type TEXT, p_subject_type TEXT,
    p_subject_id UUID DEFAULT NULL, p_institution_id UUID DEFAULT NULL, p_payload JSONB DEFAULT '{}'::jsonb)
RETURNS VOID
LANGUAGE sql
SET search_path = pg_catalog, pg_temp
AS $$
    INSERT INTO trust.immutable_audit_logs (chain_key, event_type, subject_type, subject_id, institution_id, payload)
    VALUES (p_chain_key, p_event_type, p_subject_type, p_subject_id, p_institution_id, COALESCE(p_payload, '{}'::jsonb));
$$;

-- Recomputes a range of one chain. Run it in slices for big chains: verify_audit_chain('credentials', 1, 100000).
CREATE OR REPLACE FUNCTION trust.verify_audit_chain(
    p_chain_key TEXT, p_from_seq BIGINT DEFAULT 1, p_to_seq BIGINT DEFAULT NULL)
RETURNS TABLE (ok BOOLEAN, rows_checked BIGINT, first_bad_seq BIGINT, reason TEXT)
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    r trust.immutable_audit_logs%ROWTYPE;
    v_prev BYTEA;
    v_next_seq BIGINT;
    v_count BIGINT := 0;
    v_head trust.audit_chain_heads%ROWTYPE;
    v_last_seq BIGINT;
BEGIN
    IF p_from_seq IS NULL OR p_from_seq < 1 THEN
        RAISE EXCEPTION 'verify_audit_chain: p_from_seq must be >= 1';
    END IF;

    IF p_from_seq = 1 THEN
        v_prev := sha256(convert_to('GENESIS:' || p_chain_key, 'UTF8'));
    ELSE
        SELECT l.row_hash INTO v_prev FROM trust.immutable_audit_logs l
         WHERE l.chain_key = p_chain_key AND l.seq = p_from_seq - 1;
        IF NOT FOUND THEN
            RETURN QUERY SELECT FALSE, 0::BIGINT, p_from_seq - 1, 'predecessor row is missing'::TEXT;
            RETURN;
        END IF;
    END IF;

    v_next_seq := p_from_seq;
    FOR r IN
        SELECT l.* FROM trust.immutable_audit_logs l
         WHERE l.chain_key = p_chain_key AND l.seq >= p_from_seq AND (p_to_seq IS NULL OR l.seq <= p_to_seq)
         ORDER BY l.seq
    LOOP
        IF r.seq <> v_next_seq THEN
            RETURN QUERY SELECT FALSE, v_count, v_next_seq, 'gap in sequence (rows were deleted)'::TEXT;
            RETURN;
        END IF;
        IF r.prev_hash <> v_prev THEN
            RETURN QUERY SELECT FALSE, v_count, r.seq, 'prev_hash does not link to the previous row'::TEXT;
            RETURN;
        END IF;
        IF r.payload_text::jsonb <> r.payload THEN
            RETURN QUERY SELECT FALSE, v_count, r.seq, 'payload differs from the hashed payload text'::TEXT;
            RETURN;
        END IF;
        IF r.row_hash <> trust.audit_digest(
               r.chain_key, r.seq, r.prev_hash, r.occurred_at, r.event_type,
               r.actor_user_id, r.actor_role::text, r.db_role, r.request_id,
               r.subject_type, r.subject_id, r.institution_id, r.payload_text) THEN
            RETURN QUERY SELECT FALSE, v_count, r.seq, 'row_hash mismatch (row content was altered)'::TEXT;
            RETURN;
        END IF;
        v_prev := r.row_hash;
        v_next_seq := v_next_seq + 1;
        v_count := v_count + 1;
    END LOOP;

    v_last_seq := v_next_seq - 1;

    IF p_to_seq IS NULL THEN
        SELECT h.* INTO v_head FROM trust.audit_chain_heads h WHERE h.chain_key = p_chain_key;
        IF NOT FOUND THEN
            IF v_last_seq > 0 THEN
                RETURN QUERY SELECT FALSE, v_count, v_last_seq, 'chain head row is missing'::TEXT;
                RETURN;
            END IF;
        ELSIF v_head.last_seq <> v_last_seq OR v_head.last_hash <> v_prev THEN
            RETURN QUERY SELECT FALSE, v_count, v_last_seq + 1,
                'chain head disagrees with the last row (tail removed or head altered)'::TEXT;
            RETURN;
        END IF;
        IF EXISTS (SELECT 1 FROM trust.audit_checkpoints c WHERE c.chain_key = p_chain_key AND c.up_to_seq > v_last_seq) THEN
            RETURN QUERY SELECT FALSE, v_count, v_last_seq + 1,
                'a checkpoint refers to rows that no longer exist (tail removed)'::TEXT;
            RETURN;
        END IF;
    END IF;

    IF EXISTS (
        SELECT 1 FROM trust.audit_checkpoints c
          JOIN trust.immutable_audit_logs l ON l.chain_key = c.chain_key AND l.seq = c.up_to_seq
         WHERE c.chain_key = p_chain_key AND c.up_to_seq BETWEEN p_from_seq AND v_last_seq
           AND c.head_hash <> l.row_hash
    ) THEN
        RETURN QUERY SELECT FALSE, v_count, NULL::BIGINT, 'a checkpoint hash disagrees with the audit row'::TEXT;
        RETURN;
    END IF;

    RETURN QUERY SELECT TRUE, v_count, NULL::BIGINT, 'ok'::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION trust.verify_all_audit_chains()
RETURNS TABLE (chain TEXT, ok BOOLEAN, rows_checked BIGINT, first_bad_seq BIGINT, reason TEXT)
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    k TEXT;
BEGIN
    FOR k IN SELECT h.chain_key FROM trust.audit_chain_heads h ORDER BY h.chain_key LOOP
        RETURN QUERY
            SELECT k, v.ok, v.rows_checked, v.first_bad_seq, v.reason FROM trust.verify_audit_chain(k) v;
    END LOOP;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. VERIFIER ORGANISATIONS (employers, BGV agencies, universities, DigiLocker)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS trust.verifier_organisations (
    verifier_org_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_type trust.verifier_org_type_enum NOT NULL,
    legal_name VARCHAR(300) NOT NULL CHECK (length(btrim(legal_name)) > 0),
    registration_type VARCHAR(20) NOT NULL CHECK (registration_type IN ('CIN', 'LLPIN', 'GSTIN', 'PAN', 'AICTE_ID', 'OTHER')),
    registration_no VARCHAR(50) NOT NULL CHECK (registration_no = upper(btrim(registration_no)) AND length(registration_no) > 0),
    contact_email VARCHAR(255) NOT NULL CHECK (contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
    status trust.verifier_org_status_enum NOT NULL DEFAULT 'PENDING',
    decided_by UUID,                         -- Soft reference to master.user_profiles (AICTE officer)
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (registration_type, registration_no),
    CONSTRAINT chk_verifier_org_decision CHECK (status = 'PENDING' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL))
);

CREATE OR REPLACE FUNCTION trust.verifier_org_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_mutable TEXT[] := ARRAY['contact_email', 'updated_at'];
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'PENDING' OR NEW.decided_by IS NOT NULL OR NEW.decided_at IS NOT NULL THEN
            RAISE EXCEPTION 'verifier_organisations: a new organisation must start as PENDING'
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;

    IF OLD.status = 'PENDING' THEN
        v_mutable := v_mutable || ARRAY['legal_name', 'org_type'];
    END IF;
    IF NEW.status <> OLD.status THEN
        v_mutable := v_mutable || ARRAY['status', 'decided_by', 'decided_at'];
    END IF;
    IF (to_jsonb(NEW) - v_mutable) IS DISTINCT FROM (to_jsonb(OLD) - v_mutable) THEN
        RAISE EXCEPTION 'verifier_organisations: identity columns are immutable' USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.status <> OLD.status THEN
        IF NOT (   (OLD.status = 'PENDING'   AND NEW.status IN ('APPROVED', 'REVOKED'))
                OR (OLD.status = 'APPROVED'  AND NEW.status IN ('SUSPENDED', 'REVOKED'))
                OR (OLD.status = 'SUSPENDED' AND NEW.status IN ('APPROVED', 'REVOKED'))) THEN
            RAISE EXCEPTION 'verifier_organisations: illegal status transition % -> %', OLD.status, NEW.status
                USING ERRCODE = 'check_violation';
        END IF;
        PERFORM trust.assert_actor_matches(NEW.decided_by);
        PERFORM trust.assert_aicte_officer(NEW.decided_by, 'decide verifier organisation');
        NEW.decided_at := now();
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_verifier_orgs_guard
    BEFORE INSERT OR UPDATE ON trust.verifier_organisations
    FOR EACH ROW EXECUTE FUNCTION trust.verifier_org_guard();
CREATE OR REPLACE TRIGGER trg_verifier_orgs_updated_at
    BEFORE UPDATE ON trust.verifier_organisations
    FOR EACH ROW EXECUTE FUNCTION trust.set_updated_at();
CREATE OR REPLACE TRIGGER trg_verifier_orgs_no_delete
    BEFORE DELETE ON trust.verifier_organisations
    FOR EACH ROW EXECUTE FUNCTION trust.forbid_mutation();
CREATE OR REPLACE TRIGGER trg_verifier_orgs_no_truncate
    BEFORE TRUNCATE ON trust.verifier_organisations
    FOR EACH STATEMENT EXECUTE FUNCTION trust.forbid_mutation();

-- Which login belongs to which organisation (stops a verifier user from acting under another org's consents).
CREATE TABLE IF NOT EXISTS trust.verifier_org_members (
    user_id UUID PRIMARY KEY REFERENCES master.user_profiles(user_id) ON DELETE CASCADE,
    verifier_org_id UUID NOT NULL REFERENCES trust.verifier_organisations(verifier_org_id) ON DELETE RESTRICT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_verifier_members_org ON trust.verifier_org_members(verifier_org_id) WHERE is_active;

CREATE OR REPLACE FUNCTION trust.verifier_member_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NOT EXISTS (SELECT 1 FROM master.user_profiles up
                        WHERE up.user_id = NEW.user_id AND up.is_active = TRUE AND up.role = 'EMPLOYER_VERIFIER') THEN
            RAISE EXCEPTION 'verifier_org_members: only active EMPLOYER_VERIFIER users can be members'
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF (to_jsonb(NEW) - ARRAY['is_active', 'updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['is_active', 'updated_at']) THEN
        RAISE EXCEPTION 'verifier_org_members: membership columns are immutable (deactivate and re-add instead)'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_verifier_members_guard
    BEFORE INSERT OR UPDATE ON trust.verifier_org_members
    FOR EACH ROW EXECUTE FUNCTION trust.verifier_member_guard();
CREATE OR REPLACE TRIGGER trg_verifier_members_updated_at
    BEFORE UPDATE ON trust.verifier_org_members
    FOR EACH ROW EXECUTE FUNCTION trust.set_updated_at();

-- ----------------------------------------------------------------------------
-- 5. trust.academic_credentials (W3C Verifiable Credentials, dual-ID)
-- ----------------------------------------------------------------------------
-- The database never holds signing keys: vc_document / proof_value are produced and signed app-side (KMS).
-- credential_hash = SHA-256 of the canonicalised (JCS) VC, computed app-side. Verifiers check the signature
-- against the issuer's public key; the database guarantees the stored copy cannot change after issuance.

CREATE TABLE IF NOT EXISTS trust.academic_credentials (
    credential_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),   -- Random v4: unguessable, safe inside QR codes
    student_id UUID NOT NULL REFERENCES core.students(student_id) ON DELETE RESTRICT,
    enrolment_id UUID NOT NULL,
    academic_year CHAR(7) NOT NULL,
    institution_id UUID NOT NULL REFERENCES master.institutions(institution_id) ON DELETE RESTRICT,
    program_id UUID NOT NULL REFERENCES master.institutional_programs(program_id) ON DELETE RESTRICT,

    credential_type trust.credential_type_enum NOT NULL,
    period_label VARCHAR(40) NOT NULL DEFAULT 'FINAL' CHECK (period_label ~ '^[A-Z0-9_-]{1,40}$'),

    -- Dual-ID printed on the credential. Filled from core.* by trigger; callers cannot choose them.
    printed_apaar_id CHAR(12) NOT NULL CHECK (printed_apaar_id ~ '^[0-9]{12}$'),
    printed_student_roll_id VARCHAR(50) NOT NULL CHECK (length(btrim(printed_student_roll_id)) > 0),

    issuer_did TEXT NOT NULL CHECK (issuer_did ~ '^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$'),
    verification_method TEXT NOT NULL CHECK (length(verification_method) BETWEEN 8 AND 500),
    proof_type VARCHAR(60) NOT NULL,
    proof_value TEXT NOT NULL CHECK (length(proof_value) BETWEEN 16 AND 20000),
    vc_document JSONB NOT NULL,
    credential_hash BYTEA NOT NULL CHECK (octet_length(credential_hash) = 32),

    status_list_id VARCHAR(100),             -- W3C Bitstring Status List reference (app-assigned)
    status_list_index INT CHECK (status_list_index >= 0),

    valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valid_until TIMESTAMPTZ,

    status trust.credential_status_enum NOT NULL DEFAULT 'ISSUED',
    status_reason TEXT,
    status_changed_at TIMESTAMPTZ,
    status_changed_by UUID,                  -- Soft reference (see ledger note above)
    supersedes_credential_id UUID REFERENCES trust.academic_credentials(credential_id) ON DELETE RESTRICT,

    issued_by UUID NOT NULL,                 -- Soft reference to master.user_profiles
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_credential_hash UNIQUE (credential_hash),
    CONSTRAINT uq_credential_status_slot UNIQUE (status_list_id, status_list_index),
    CONSTRAINT fk_credential_enrolment FOREIGN KEY (enrolment_id, academic_year)
        REFERENCES core.student_enrolments(enrolment_id, academic_year) ON DELETE RESTRICT,
    CONSTRAINT chk_credential_vc_shape CHECK (
        jsonb_typeof(vc_document) = 'object'
        AND vc_document ?& ARRAY['@context', 'type', 'issuer', 'credentialSubject']
        AND octet_length(vc_document::text) <= 262144
    ),
    CONSTRAINT chk_credential_validity CHECK (valid_until IS NULL OR valid_until > valid_from),
    CONSTRAINT chk_credential_status_list CHECK ((status_list_id IS NULL) = (status_list_index IS NULL)),
    CONSTRAINT chk_credential_not_self_superseding CHECK (supersedes_credential_id IS DISTINCT FROM credential_id),
    CONSTRAINT chk_credential_status_fields CHECK (
        status = 'ISSUED'
        OR (status_changed_at IS NOT NULL AND status_changed_by IS NOT NULL
            AND length(btrim(COALESCE(status_reason, ''))) >= 10)
    )
);

-- One live credential per slot (enrolment + type + period). Revoked / superseded ones free the slot.
CREATE UNIQUE INDEX IF NOT EXISTS uq_credentials_active_per_slot
    ON trust.academic_credentials(enrolment_id, academic_year, credential_type, period_label)
    WHERE status IN ('ISSUED', 'SUSPENDED');
CREATE INDEX IF NOT EXISTS idx_credentials_student ON trust.academic_credentials(student_id, status);
CREATE INDEX IF NOT EXISTS idx_credentials_institution ON trust.academic_credentials(institution_id, status, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_credentials_supersedes ON trust.academic_credentials(supersedes_credential_id)
    WHERE supersedes_credential_id IS NOT NULL;

CREATE OR REPLACE FUNCTION trust.credential_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    e core.student_enrolments%ROWTYPE;
    st core.students%ROWTYPE;
    old_c trust.academic_credentials%ROWTYPE;
    v_mutable TEXT[] := ARRAY['status', 'status_reason', 'status_changed_at', 'status_changed_by', 'updated_at'];
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- V08: who may issue
        PERFORM trust.assert_actor_matches(NEW.issued_by);
        PERFORM trust.assert_institution_actor(NEW.issued_by, NEW.institution_id, 'issue credential');

        IF NEW.status <> 'ISSUED' OR NEW.status_changed_at IS NOT NULL OR NEW.status_changed_by IS NOT NULL THEN
            RAISE EXCEPTION 'academic_credentials: a credential must be inserted as ISSUED' USING ERRCODE = 'check_violation';
        END IF;

        SELECT * INTO e FROM core.student_enrolments x
         WHERE x.enrolment_id = NEW.enrolment_id AND x.academic_year = NEW.academic_year;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'academic_credentials: enrolment % not found', NEW.enrolment_id
                USING ERRCODE = 'foreign_key_violation';
        END IF;
        IF e.student_id <> NEW.student_id OR e.institution_id <> NEW.institution_id OR e.program_id <> NEW.program_id THEN
            RAISE EXCEPTION 'academic_credentials: student / institution / program does not match its enrolment'
                USING ERRCODE = 'foreign_key_violation';
        END IF;

        SELECT * INTO st FROM core.students s WHERE s.student_id = NEW.student_id;
        IF NOT FOUND OR st.apaar_verification_status <> 'VERIFIED' THEN
            RAISE EXCEPTION 'academic_credentials: the student APAAR must be VERIFIED before a credential is issued'
                USING ERRCODE = 'check_violation';
        END IF;

        -- V10: credential type vs enrolment state (policy knobs - adjust here)
        IF NOT (   (NEW.credential_type IN ('DEGREE_CERTIFICATE', 'DIPLOMA_CERTIFICATE', 'PROVISIONAL_CERTIFICATE')
                    AND e.enrolment_status = 'GRADUATED')
                OR (NEW.credential_type = 'ENROLMENT_PROOF' AND e.enrolment_status = 'VERIFIED_ACTIVE')
                OR (NEW.credential_type = 'TRANSFER_CERTIFICATE' AND e.enrolment_status = 'TRANSFERRED_OUT')
                OR (NEW.credential_type = 'SEMESTER_MARKSHEET'
                    AND e.enrolment_status IN ('VERIFIED_ACTIVE', 'GRADUATED', 'TRANSFERRED_OUT'))) THEN
            RAISE EXCEPTION 'academic_credentials: % requires enrolment status that does not match (enrolment is %)',
                NEW.credential_type, e.enrolment_status USING ERRCODE = 'check_violation';
        END IF;

        -- V09: dual-ID always comes from the registry
        IF NEW.printed_apaar_id IS NOT NULL AND NEW.printed_apaar_id <> st.apaar_id THEN
            RAISE EXCEPTION 'academic_credentials: printed_apaar_id does not match the student record'
                USING ERRCODE = 'check_violation';
        END IF;
        NEW.printed_apaar_id := st.apaar_id;
        IF e.roll_no IS NULL THEN
            RAISE EXCEPTION 'academic_credentials: the enrolment has no roll number, so the dual-ID cannot be printed'
                USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.printed_student_roll_id IS NOT NULL AND NEW.printed_student_roll_id <> e.roll_no THEN
            RAISE EXCEPTION 'academic_credentials: printed_student_roll_id does not match the enrolment roll number'
                USING ERRCODE = 'check_violation';
        END IF;
        NEW.printed_student_roll_id := e.roll_no;

        NEW.issued_at := now();

        -- Re-issue: the superseded credential is retired here, in the same statement (V12)
        IF NEW.supersedes_credential_id IS NOT NULL THEN
            SELECT * INTO old_c FROM trust.academic_credentials o
             WHERE o.credential_id = NEW.supersedes_credential_id FOR UPDATE;
            IF NOT FOUND
               OR old_c.student_id <> NEW.student_id
               OR old_c.enrolment_id <> NEW.enrolment_id
               OR old_c.academic_year <> NEW.academic_year
               OR old_c.credential_type <> NEW.credential_type
               OR old_c.period_label <> NEW.period_label
               OR old_c.status NOT IN ('ISSUED', 'SUSPENDED') THEN
                RAISE EXCEPTION 'academic_credentials: cannot supersede that credential (must be the live credential of the same student, enrolment, type and period)'
                    USING ERRCODE = 'check_violation';
            END IF;
            UPDATE trust.academic_credentials
               SET status = 'SUPERSEDED',
                   status_reason = 'Superseded by credential ' || NEW.credential_id::text,
                   status_changed_by = NEW.issued_by
             WHERE credential_id = old_c.credential_id;
        END IF;
        RETURN NEW;
    END IF;

    -- UPDATE: only the status columns may change (V11); every other column, including future ones, is frozen.
    IF (to_jsonb(NEW) - v_mutable) IS DISTINCT FROM (to_jsonb(OLD) - v_mutable) THEN
        RAISE EXCEPTION 'academic_credentials: credential content is immutable after issuance'
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.status <> OLD.status THEN
        IF NOT (   (OLD.status = 'ISSUED'    AND NEW.status IN ('SUSPENDED', 'REVOKED', 'SUPERSEDED'))
                OR (OLD.status = 'SUSPENDED' AND NEW.status IN ('ISSUED', 'REVOKED', 'SUPERSEDED'))) THEN
            RAISE EXCEPTION 'academic_credentials: illegal status transition % -> %', OLD.status, NEW.status
                USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.status = 'SUPERSEDED' AND pg_trigger_depth() < 2 THEN
            RAISE EXCEPTION 'academic_credentials: a credential can be SUPERSEDED only by re-issuing it'
                USING ERRCODE = 'check_violation';
        END IF;
        PERFORM trust.assert_actor_matches(NEW.status_changed_by);
        PERFORM trust.assert_institution_actor(NEW.status_changed_by, NEW.institution_id, 'change credential status');
        NEW.status_changed_at := now();
    ELSIF NEW.status_reason IS DISTINCT FROM OLD.status_reason
          OR NEW.status_changed_at IS DISTINCT FROM OLD.status_changed_at
          OR NEW.status_changed_by IS DISTINCT FROM OLD.status_changed_by THEN
        RAISE EXCEPTION 'academic_credentials: status details can change only together with the status'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_credentials_guard
    BEFORE INSERT OR UPDATE ON trust.academic_credentials
    FOR EACH ROW EXECUTE FUNCTION trust.credential_guard();
CREATE OR REPLACE TRIGGER trg_credentials_updated_at
    BEFORE UPDATE ON trust.academic_credentials
    FOR EACH ROW EXECUTE FUNCTION trust.set_updated_at();
CREATE OR REPLACE TRIGGER trg_credentials_no_delete
    BEFORE DELETE ON trust.academic_credentials
    FOR EACH ROW EXECUTE FUNCTION trust.forbid_mutation();
CREATE OR REPLACE TRIGGER trg_credentials_no_truncate
    BEFORE TRUNCATE ON trust.academic_credentials
    FOR EACH STATEMENT EXECUTE FUNCTION trust.forbid_mutation();

-- ----------------------------------------------------------------------------
-- 6. trust.student_consents (DPDP Act / DigiLocker consent artefacts)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS trust.student_consents (
    consent_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES core.students(student_id) ON DELETE RESTRICT,
    grantee_org_id UUID NOT NULL REFERENCES trust.verifier_organisations(verifier_org_id) ON DELETE RESTRICT,
    purpose trust.consent_purpose_enum NOT NULL,

    -- Explicit scope only: one credential, or all credentials. No NULL-means-everything.
    scope_credential_id UUID REFERENCES trust.academic_credentials(credential_id) ON DELETE RESTRICT,
    scope_all_credentials BOOLEAN NOT NULL DEFAULT FALSE,
    disclosure_scope trust.disclosure_category_enum[] NOT NULL CHECK (cardinality(disclosure_scope) BETWEEN 1 AND 8),

    consent_text_version VARCHAR(30) NOT NULL,                  -- Notice version the student saw
    grant_channel trust.consent_channel_enum NOT NULL,
    consent_artifact_hash BYTEA NOT NULL CHECK (octet_length(consent_artifact_hash) = 32),
    guardian_consent BOOLEAN NOT NULL DEFAULT FALSE,
    guardian_artifact_hash BYTEA CHECK (guardian_artifact_hash IS NULL OR octet_length(guardian_artifact_hash) = 32),

    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),              -- Forced to now() by trigger
    expires_at TIMESTAMPTZ NOT NULL,
    status trust.consent_status_enum NOT NULL DEFAULT 'GRANTED',
    withdrawn_at TIMESTAMPTZ,
    withdrawn_channel trust.consent_channel_enum,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_consent_artifact UNIQUE (consent_artifact_hash),   -- replay protection
    CONSTRAINT chk_consent_scope CHECK ((scope_credential_id IS NOT NULL) <> scope_all_credentials),
    CONSTRAINT chk_consent_expiry CHECK (expires_at > granted_at),
    CONSTRAINT chk_consent_guardian CHECK (NOT guardian_consent OR guardian_artifact_hash IS NOT NULL),
    CONSTRAINT chk_consent_withdrawal CHECK (
        (status = 'GRANTED'   AND withdrawn_at IS NULL     AND withdrawn_channel IS NULL)
        OR (status = 'WITHDRAWN' AND withdrawn_at IS NOT NULL AND withdrawn_channel IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_consents_lookup
    ON trust.student_consents(student_id, grantee_org_id, purpose) WHERE status = 'GRANTED';
CREATE INDEX IF NOT EXISTS idx_consents_scope_credential
    ON trust.student_consents(scope_credential_id) WHERE scope_credential_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_consents_grantee ON trust.student_consents(grantee_org_id, status);

CREATE OR REPLACE FUNCTION trust.consent_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_dob DATE;
    v_org_status trust.verifier_org_status_enum;
    v_cred_student UUID;
    v_cred_status trust.credential_status_enum;
    v_adult_cutoff DATE;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'GRANTED' THEN
            RAISE EXCEPTION 'student_consents: a consent must be inserted as GRANTED' USING ERRCODE = 'check_violation';
        END IF;

        SELECT s.date_of_birth INTO v_dob FROM core.students s WHERE s.student_id = NEW.student_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'student_consents: student not found' USING ERRCODE = 'foreign_key_violation';
        END IF;

        SELECT o.status INTO v_org_status FROM trust.verifier_organisations o
         WHERE o.verifier_org_id = NEW.grantee_org_id FOR SHARE;
        IF NOT FOUND OR v_org_status <> 'APPROVED' THEN
            RAISE EXCEPTION 'student_consents: the grantee organisation is not approved' USING ERRCODE = 'check_violation';
        END IF;

        -- V13: the scoped credential must belong to the student who is consenting
        IF NEW.scope_credential_id IS NOT NULL THEN
            SELECT a.student_id, a.status INTO v_cred_student, v_cred_status
              FROM trust.academic_credentials a WHERE a.credential_id = NEW.scope_credential_id;
            IF NOT FOUND OR v_cred_student <> NEW.student_id THEN
                RAISE EXCEPTION 'student_consents: the scoped credential does not belong to this student'
                    USING ERRCODE = 'check_violation';
            END IF;
            IF v_cred_status <> 'ISSUED' THEN
                RAISE EXCEPTION 'student_consents: the scoped credential is not in ISSUED state'
                    USING ERRCODE = 'check_violation';
            END IF;
        END IF;

        -- V14: the database clock decides when a consent starts; consents are short-lived
        NEW.granted_at := now();
        IF NEW.expires_at <= NEW.granted_at OR NEW.expires_at > NEW.granted_at + interval '1 year' THEN
            RAISE EXCEPTION 'student_consents: expiry must be in the future and at most 1 year after the grant'
                USING ERRCODE = 'check_violation';
        END IF;

        -- V15: a student under 18 needs verifiable guardian consent
        v_adult_cutoff := ((now() AT TIME ZONE 'Asia/Kolkata')::date - interval '18 years')::date;
        IF v_dob > v_adult_cutoff AND NOT NEW.guardian_consent THEN
            RAISE EXCEPTION 'student_consents: guardian consent is required for a student under 18'
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;

    -- UPDATE: withdrawal only
    IF (to_jsonb(NEW) - ARRAY['status', 'withdrawn_at', 'withdrawn_channel', 'updated_at'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'withdrawn_at', 'withdrawn_channel', 'updated_at']) THEN
        RAISE EXCEPTION 'student_consents: consent content is immutable (withdraw and grant a new consent instead)'
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> OLD.status THEN
        IF NOT (OLD.status = 'GRANTED' AND NEW.status = 'WITHDRAWN') THEN
            RAISE EXCEPTION 'student_consents: illegal consent transition % -> %', OLD.status, NEW.status
                USING ERRCODE = 'check_violation';
        END IF;
        NEW.withdrawn_at := now();
    ELSIF NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at OR NEW.withdrawn_channel IS DISTINCT FROM OLD.withdrawn_channel THEN
        RAISE EXCEPTION 'student_consents: illegal consent transition (withdrawal details are fixed)'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_consents_guard
    BEFORE INSERT OR UPDATE ON trust.student_consents
    FOR EACH ROW EXECUTE FUNCTION trust.consent_guard();
CREATE OR REPLACE TRIGGER trg_consents_updated_at
    BEFORE UPDATE ON trust.student_consents
    FOR EACH ROW EXECUTE FUNCTION trust.set_updated_at();
CREATE OR REPLACE TRIGGER trg_consents_no_delete
    BEFORE DELETE ON trust.student_consents
    FOR EACH ROW EXECUTE FUNCTION trust.forbid_mutation();
CREATE OR REPLACE TRIGGER trg_consents_no_truncate
    BEFORE TRUNCATE ON trust.student_consents
    FOR EACH STATEMENT EXECUTE FUNCTION trust.forbid_mutation();

-- ----------------------------------------------------------------------------
-- 7. trust.employer_verification_logs (append-only; also the student's "who looked at my data" record)
-- ----------------------------------------------------------------------------
-- Stores only whether the presented IDs matched, never the presented values (they may be guesses or PII).

CREATE TABLE IF NOT EXISTS trust.employer_verification_logs (
    verification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    verifier_org_id UUID NOT NULL REFERENCES trust.verifier_organisations(verifier_org_id) ON DELETE RESTRICT,
    requested_by UUID NOT NULL,              -- Soft reference to master.user_profiles
    purpose trust.consent_purpose_enum NOT NULL,
    credential_id UUID NOT NULL,             -- Soft reference: the id the verifier typed in; it may not exist
    student_id UUID,                         -- Soft reference: resolved internally, never shown to the verifier
    consent_id UUID REFERENCES trust.student_consents(consent_id) ON DELETE RESTRICT,
    outcome trust.verification_outcome_enum NOT NULL,
    apaar_id_matched BOOLEAN,
    roll_id_matched BOOLEAN,
    client_fingerprint BYTEA CHECK (client_fingerprint IS NULL OR octet_length(client_fingerprint) = 32),   -- HMAC'd app-side

    CONSTRAINT chk_verification_verified_has_consent CHECK (outcome <> 'VERIFIED' OR consent_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_vlogs_org_time ON trust.employer_verification_logs(verifier_org_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_vlogs_student_time ON trust.employer_verification_logs(student_id, requested_at DESC)
    WHERE student_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vlogs_credential ON trust.employer_verification_logs(credential_id);
CREATE INDEX IF NOT EXISTS idx_vlogs_failures ON trust.employer_verification_logs(verifier_org_id, requested_at DESC)
    WHERE outcome IN ('NOT_FOUND', 'ID_MISMATCH');

CREATE OR REPLACE TRIGGER trg_vlogs_immutable
    BEFORE UPDATE OR DELETE ON trust.employer_verification_logs
    FOR EACH ROW EXECUTE FUNCTION trust.forbid_mutation();
CREATE OR REPLACE TRIGGER trg_vlogs_no_truncate
    BEFORE TRUNCATE ON trust.employer_verification_logs
    FOR EACH STATEMENT EXECUTE FUNCTION trust.forbid_mutation();

-- ----------------------------------------------------------------------------
-- 8. API FUNCTIONS (called by the Node.js backend with service_role)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trust.set_credential_status(
    p_credential_id UUID, p_new_status trust.credential_status_enum, p_actor UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    UPDATE trust.academic_credentials
       SET status = p_new_status, status_reason = p_reason, status_changed_by = p_actor
     WHERE credential_id = p_credential_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'set_credential_status: credential % not found', p_credential_id;
    END IF;
END;
$$;

-- p_student_id is the student resolved from the caller's session, so one student cannot withdraw another's consent.
CREATE OR REPLACE FUNCTION trust.withdraw_consent(
    p_consent_id UUID, p_student_id UUID, p_channel trust.consent_channel_enum)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_status trust.consent_status_enum;
BEGIN
    SELECT k.status INTO v_status FROM trust.student_consents k
     WHERE k.consent_id = p_consent_id AND k.student_id = p_student_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'withdraw_consent: consent not found';
    END IF;
    IF v_status <> 'GRANTED' THEN
        RAISE EXCEPTION 'withdraw_consent: illegal consent transition (already %)', v_status;
    END IF;
    UPDATE trust.student_consents
       SET status = 'WITHDRAWN', withdrawn_channel = p_channel
     WHERE consent_id = p_consent_id;
END;
$$;

-- One atomic call: authenticate requester -> rate limit -> credential -> dual-ID -> consent -> state -> log.
-- The employer only receives a coarse result; the precise outcome is stored in the log.
CREATE OR REPLACE FUNCTION trust.verify_credential(
    p_credential_id UUID, p_verifier_org_id UUID, p_requested_by UUID,
    p_purpose trust.consent_purpose_enum, p_presented_apaar_id TEXT, p_presented_roll_id TEXT,
    p_client_fingerprint BYTEA DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    c_max_failures CONSTANT INT := 20;
    c_window CONSTANT INTERVAL := interval '1 hour';
    v_org_status trust.verifier_org_status_enum;
    cred trust.academic_credentials%ROWTYPE;
    cons trust.student_consents%ROWTYPE;
    v_outcome trust.verification_outcome_enum;
    v_apaar_ok BOOLEAN;
    v_roll_ok BOOLEAN;
    v_id UUID;
    v_public TEXT;
BEGIN
    SELECT o.status INTO v_org_status FROM trust.verifier_organisations o WHERE o.verifier_org_id = p_verifier_org_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'verify_credential: unknown verifier organisation %', p_verifier_org_id;
    END IF;
    IF v_org_status <> 'APPROVED' THEN
        v_outcome := 'ORG_NOT_APPROVED';
    END IF;

    -- V16: the requester must be an active member of the organisation it claims to act for
    IF v_outcome IS NULL AND NOT EXISTS (
        SELECT 1 FROM trust.verifier_org_members m
          JOIN master.user_profiles up ON up.user_id = m.user_id AND up.is_active = TRUE
         WHERE m.user_id = p_requested_by AND m.verifier_org_id = p_verifier_org_id AND m.is_active = TRUE
    ) THEN
        v_outcome := 'REQUESTER_NOT_AUTHORISED';
    END IF;

    -- V17: bound the guessing rate per organisation
    IF v_outcome IS NULL AND (
        SELECT count(*) FROM trust.employer_verification_logs l
         WHERE l.verifier_org_id = p_verifier_org_id
           AND l.requested_at > clock_timestamp() - c_window
           AND l.outcome IN ('NOT_FOUND', 'ID_MISMATCH')
    ) >= c_max_failures THEN
        v_outcome := 'RATE_LIMITED';
    END IF;

    -- V18: FOR SHARE makes a concurrent revoke / withdraw either finish first or wait for this call
    IF v_outcome IS NULL THEN
        SELECT * INTO cred FROM trust.academic_credentials a WHERE a.credential_id = p_credential_id FOR SHARE;
        IF NOT FOUND THEN
            v_outcome := 'NOT_FOUND';
        END IF;
    END IF;

    -- V17: both printed IDs must match before anything about consent or status is revealed
    IF v_outcome IS NULL THEN
        v_apaar_ok := (p_presented_apaar_id IS NOT NULL AND p_presented_apaar_id = cred.printed_apaar_id::text);
        v_roll_ok := (p_presented_roll_id IS NOT NULL
                      AND upper(btrim(p_presented_roll_id)) = upper(btrim(cred.printed_student_roll_id)));
        IF NOT (v_apaar_ok AND v_roll_ok) THEN
            v_outcome := 'ID_MISMATCH';
        END IF;
    END IF;

    IF v_outcome IS NULL THEN
        SELECT * INTO cons FROM trust.student_consents k
         WHERE k.student_id = cred.student_id
           AND k.grantee_org_id = p_verifier_org_id
           AND k.purpose = p_purpose
           AND k.status = 'GRANTED'
           AND k.granted_at <= now() AND k.expires_at > now()
           AND (k.scope_all_credentials OR k.scope_credential_id = cred.credential_id)
           AND 'CREDENTIAL_VALIDITY'::trust.disclosure_category_enum = ANY (k.disclosure_scope)
         ORDER BY k.expires_at DESC
         LIMIT 1
         FOR SHARE;
        IF NOT FOUND THEN
            v_outcome := 'CONSENT_REQUIRED';
        END IF;
    END IF;

    IF v_outcome IS NULL THEN
        IF cred.status = 'REVOKED' THEN
            v_outcome := 'CREDENTIAL_REVOKED';
        ELSIF cred.status = 'SUSPENDED' THEN
            v_outcome := 'CREDENTIAL_SUSPENDED';
        ELSIF cred.status = 'SUPERSEDED' THEN
            v_outcome := 'CREDENTIAL_SUPERSEDED';
        ELSIF cred.valid_from > now() OR (cred.valid_until IS NOT NULL AND cred.valid_until <= now()) THEN
            v_outcome := 'CREDENTIAL_OUTSIDE_VALIDITY';
        ELSE
            v_outcome := 'VERIFIED';
        END IF;
    END IF;

    INSERT INTO trust.employer_verification_logs (
        verifier_org_id, requested_by, purpose, credential_id, student_id, consent_id,
        outcome, apaar_id_matched, roll_id_matched, client_fingerprint)
    VALUES (
        p_verifier_org_id, p_requested_by, p_purpose, p_credential_id, cred.student_id, cons.consent_id,
        v_outcome, v_apaar_ok, v_roll_ok, p_client_fingerprint)
    RETURNING verification_id INTO v_id;

    v_public := CASE v_outcome
        WHEN 'VERIFIED' THEN 'VERIFIED'
        WHEN 'CONSENT_REQUIRED' THEN 'CONSENT_REQUIRED'
        WHEN 'RATE_LIMITED' THEN 'RATE_LIMITED'
        WHEN 'ORG_NOT_APPROVED' THEN 'NOT_AUTHORISED'
        WHEN 'REQUESTER_NOT_AUTHORISED' THEN 'NOT_AUTHORISED'
        WHEN 'CREDENTIAL_REVOKED' THEN 'NOT_VALID'
        WHEN 'CREDENTIAL_SUSPENDED' THEN 'NOT_VALID'
        WHEN 'CREDENTIAL_SUPERSEDED' THEN 'NOT_VALID'
        WHEN 'CREDENTIAL_OUTSIDE_VALIDITY' THEN 'NOT_VALID'
        ELSE 'NOT_VERIFIED'                       -- NOT_FOUND and ID_MISMATCH look identical to the caller
    END;

    RETURN jsonb_build_object('result', v_public, 'verification_id', v_id)
        || CASE WHEN v_outcome = 'VERIFIED'
                THEN jsonb_build_object('credential_type', cred.credential_type,
                                        'issued_at', cred.issued_at,
                                        'institution_id', cred.institution_id,
                                        'disclosure_scope', to_jsonb(cons.disclosure_scope))
                ELSE '{}'::jsonb END;
END;
$$;

-- ----------------------------------------------------------------------------
-- 9. AUTOMATIC AUDIT TRIGGERS (the app cannot "forget" to log)
-- ----------------------------------------------------------------------------
-- Payloads carry ids, enums, hashes and counters only. Free text (status reasons) is stored as a SHA-256 digest.
-- A transaction should write to ONE audit chain; if it must touch several, take them in alphabetical order.

CREATE OR REPLACE FUNCTION trust.credential_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM trust.log_audit_event('credentials', 'CREDENTIAL.ISSUED', 'CREDENTIAL', NEW.credential_id, NEW.institution_id,
            jsonb_build_object('credential_type', NEW.credential_type, 'student_id', NEW.student_id,
                               'enrolment_id', NEW.enrolment_id, 'credential_hash', encode(NEW.credential_hash, 'hex'),
                               'supersedes', NEW.supersedes_credential_id, 'issued_by', NEW.issued_by));
    ELSIF NEW.status <> OLD.status THEN
        PERFORM trust.log_audit_event('credentials', 'CREDENTIAL.STATUS_CHANGED', 'CREDENTIAL', NEW.credential_id, NEW.institution_id,
            jsonb_build_object('from', OLD.status, 'to', NEW.status, 'changed_by', NEW.status_changed_by,
                               'reason_sha256', encode(sha256(convert_to(COALESCE(NEW.status_reason, ''), 'UTF8')), 'hex')));
    END IF;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER trg_credentials_audit
    AFTER INSERT OR UPDATE ON trust.academic_credentials
    FOR EACH ROW EXECUTE FUNCTION trust.credential_audit();

CREATE OR REPLACE FUNCTION trust.consent_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM trust.log_audit_event('consents', 'CONSENT.GRANTED', 'CONSENT', NEW.consent_id, NULL,
            jsonb_build_object('student_id', NEW.student_id, 'grantee_org_id', NEW.grantee_org_id, 'purpose', NEW.purpose,
                               'scope_credential_id', NEW.scope_credential_id, 'scope_all', NEW.scope_all_credentials,
                               'expires_at', NEW.expires_at, 'guardian_consent', NEW.guardian_consent,
                               'artifact_hash', encode(NEW.consent_artifact_hash, 'hex')));
    ELSIF NEW.status <> OLD.status THEN
        PERFORM trust.log_audit_event('consents', 'CONSENT.WITHDRAWN', 'CONSENT', NEW.consent_id, NULL,
            jsonb_build_object('student_id', NEW.student_id, 'grantee_org_id', NEW.grantee_org_id,
                               'channel', NEW.withdrawn_channel));
    END IF;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER trg_consents_audit
    AFTER INSERT OR UPDATE ON trust.student_consents
    FOR EACH ROW EXECUTE FUNCTION trust.consent_audit();

CREATE OR REPLACE FUNCTION trust.verifier_org_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM trust.log_audit_event('verifier_orgs', 'VERIFIER_ORG.REGISTERED', 'VERIFIER_ORG', NEW.verifier_org_id, NULL,
            jsonb_build_object('org_type', NEW.org_type, 'registration_type', NEW.registration_type,
                               'registration_no', NEW.registration_no));
    ELSIF NEW.status <> OLD.status THEN
        PERFORM trust.log_audit_event('verifier_orgs', 'VERIFIER_ORG.STATUS_CHANGED', 'VERIFIER_ORG', NEW.verifier_org_id, NULL,
            jsonb_build_object('from', OLD.status, 'to', NEW.status, 'decided_by', NEW.decided_by));
    END IF;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER trg_verifier_orgs_audit
    AFTER INSERT OR UPDATE ON trust.verifier_organisations
    FOR EACH ROW EXECUTE FUNCTION trust.verifier_org_audit();

-- Verification traffic is the busiest stream: spread it over 16 chains so writers do not queue on one head row.
CREATE OR REPLACE FUNCTION trust.verification_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    PERFORM trust.log_audit_event(
        'verifications:' || (hashtextextended(NEW.verifier_org_id::text, 0) & 15)::text,
        'VERIFICATION.' || NEW.outcome::text, 'VERIFICATION', NEW.verification_id, NULL,
        jsonb_build_object('verifier_org_id', NEW.verifier_org_id, 'requested_by', NEW.requested_by,
                           'purpose', NEW.purpose, 'credential_id', NEW.credential_id,
                           'student_id', NEW.student_id, 'consent_id', NEW.consent_id));
    RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER trg_vlogs_audit
    AFTER INSERT ON trust.employer_verification_logs
    FOR EACH ROW EXECUTE FUNCTION trust.verification_audit();

-- ----------------------------------------------------------------------------
-- 10. ACCESS CONTROL (backend-only: RLS ON, no policies, minimal grants)
-- ----------------------------------------------------------------------------
-- The master script's ALTER DEFAULT PRIVILEGES hands service_role ALL on every new table (V19). Strip it first,
-- then grant back only what each table needs. The head table gets SELECT only: just the definer trigger writes it.

ALTER TABLE trust.audit_chain_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust.immutable_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust.audit_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust.verifier_organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust.verifier_org_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust.academic_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust.student_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust.employer_verification_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA trust FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE ON trust.verifier_organisations, trust.academic_credentials, trust.student_consents TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON trust.verifier_org_members TO service_role;
GRANT SELECT, INSERT ON trust.employer_verification_logs, trust.immutable_audit_logs, trust.audit_checkpoints TO service_role;
GRANT SELECT ON trust.audit_chain_heads TO service_role;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA trust FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA trust TO postgres, service_role;

-- V01 / V02: integrity triggers must also fire when a session sets session_replication_role = replica.
DO $$
DECLARE
    t RECORD;
BEGIN
    FOR t IN
        SELECT c.relname AS table_name, g.tgname AS trigger_name
          FROM pg_trigger g
          JOIN pg_class c ON c.oid = g.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'trust' AND NOT g.tgisinternal
    LOOP
        EXECUTE format('ALTER TABLE trust.%I ENABLE ALWAYS TRIGGER %I', t.table_name, t.trigger_name);
    END LOOP;
END $$;

COMMIT;