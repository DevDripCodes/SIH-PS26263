# Trust Schema

Audit chain · Credentials · Consent · Verifier organisations · Employer
verification

## Notes

-   Constraint caveat: The provided SQL includes multiple questionable
    enrolment foreign keys that reference individual columns of
    composite-key or partitioned enrolment tables, plus a duplicated
    constraint name on the foreign-NRI profile. These uncertain links
    are not drawn. Only the straightforward declared relationships are
    shown; audit chain and checkpoint tables have no explicit foreign
    keys in the supplied SQL.

## ER Diagram

``` mermaid
erDiagram
    MASTER_USER_PROFILES {
        uuid user_id PK
    }
    AUTH_USERS {
        uuid id PK
    }
    CORE_STUDENTS {
        uuid student_id PK
    }
    CORE_STUDENT_ENROLMENTS {
        uuid enrolment_id
        character academic_year
    }
    CORE_STUDENT_ENROLMENTS_2024_25 {
        uuid enrolment_id
        character academic_year
    }
    CORE_STUDENT_ENROLMENTS_2025_26 {
        uuid enrolment_id
        character academic_year
    }
    CORE_STUDENT_ENROLMENTS_2026_27 {
        uuid enrolment_id
        character academic_year
    }
    CORE_STUDENT_ENROLMENTS_2027_28 {
        uuid enrolment_id
        character academic_year
    }
    CORE_STUDENT_ENROLMENTS_2028_29 {
        uuid enrolment_id
        character academic_year
    }
    CORE_STUDENT_ENROLMENTS_2029_30 {
        uuid enrolment_id
        character academic_year
    }
    CORE_STUDENT_ENROLMENTS_2030_31 {
        uuid enrolment_id
        character academic_year
    }
    TRUST_AUDIT_CHAIN_HEADS {
        text chain_key PK
        bigint last_seq
        bytea last_hash
        timestamptz last_occurred_at
        timestamptz updated_at
    }
    TRUST_IMMUTABLE_AUDIT_LOGS {
        text chain_key PK
        bigint seq PK
        timestamptz occurred_at
        text event_type
        uuid actor_user_id
        USER_DEFINED actor_role
        text db_role
        text request_id
        varchar subject_type
        uuid subject_id
        uuid institution_id
        jsonb payload
        text payload_text
        bytea prev_hash
        bytea row_hash
    }
    TRUST_AUDIT_CHECKPOINTS {
        bigint checkpoint_id PK
        text chain_key
        bigint up_to_seq
        bytea head_hash
        bytea signature
        varchar signing_key_id
        text external_anchor_ref
        timestamptz created_at
    }
    TRUST_VERIFIER_ORGANISATIONS {
        uuid verifier_org_id PK
        USER_DEFINED org_type
        varchar legal_name
        varchar registration_type
        varchar registration_no
        varchar contact_email
        USER_DEFINED status
        uuid decided_by
        timestamptz decided_at
        timestamptz created_at
        timestamptz updated_at
    }
    TRUST_VERIFIER_ORG_MEMBERS {
        uuid user_id PK, FK
        uuid verifier_org_id FK
        boolean is_active
        timestamptz created_at
        timestamptz updated_at
    }
    TRUST_ACADEMIC_CREDENTIALS {
        uuid credential_id PK
        uuid student_id FK
        uuid enrolment_id
        character academic_year
        uuid institution_id FK
        uuid program_id FK
        USER_DEFINED credential_type
        varchar period_label
        character printed_apaar_id
        varchar printed_student_roll_id
        text issuer_did
        text verification_method
        varchar proof_type
        text proof_value
        jsonb vc_document
        bytea credential_hash UK
        varchar status_list_id
        integer status_list_index
        timestamptz valid_from
        timestamptz valid_until
        USER_DEFINED status
        text status_reason
        timestamptz status_changed_at
        uuid status_changed_by
        uuid supersedes_credential_id FK
        uuid issued_by
        timestamptz issued_at
        timestamptz created_at
        timestamptz updated_at
    }
    TRUST_STUDENT_CONSENTS {
        uuid consent_id PK
        uuid student_id FK
        uuid grantee_org_id FK
        USER_DEFINED purpose
        uuid scope_credential_id FK
        boolean scope_all_credentials
        ARRAY disclosure_scope
        varchar consent_text_version
        USER_DEFINED grant_channel
        bytea consent_artifact_hash UK
        boolean guardian_consent
        bytea guardian_artifact_hash
        timestamptz granted_at
        timestamptz expires_at
        USER_DEFINED status
        timestamptz withdrawn_at
        USER_DEFINED withdrawn_channel
        timestamptz created_at
        timestamptz updated_at
    }
    TRUST_EMPLOYER_VERIFICATION_LOGS {
        uuid verification_id PK
        timestamptz requested_at
        uuid verifier_org_id FK
        uuid requested_by
        USER_DEFINED purpose
        uuid credential_id
        uuid student_id
        uuid consent_id FK
        USER_DEFINED outcome
        boolean apaar_id_matched
        boolean roll_id_matched
        bytea client_fingerprint
    }

    MASTER_USER_PROFILES ||--o{ TRUST_VERIFIER_ORG_MEMBERS : user_id
    TRUST_VERIFIER_ORGANISATIONS ||--o{ TRUST_VERIFIER_ORG_MEMBERS : verifier_org_id
    CORE_STUDENTS ||--o{ TRUST_ACADEMIC_CREDENTIALS : student_id
    TRUST_ACADEMIC_CREDENTIALS o|--o{ TRUST_ACADEMIC_CREDENTIALS : supersedes_credential_id
    CORE_STUDENTS ||--o{ TRUST_STUDENT_CONSENTS : student_id
    TRUST_VERIFIER_ORGANISATIONS ||--o{ TRUST_STUDENT_CONSENTS : grantee_org_id
    TRUST_ACADEMIC_CREDENTIALS o|--o{ TRUST_STUDENT_CONSENTS : scope_credential_id
    TRUST_VERIFIER_ORGANISATIONS ||--o{ TRUST_EMPLOYER_VERIFICATION_LOGS : verifier_org_id
    TRUST_STUDENT_CONSENTS o|--o{ TRUST_EMPLOYER_VERIFICATION_LOGS : consent_id
```
