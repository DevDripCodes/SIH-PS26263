# Staging Schema

Pan with scrollbars; zoom with browser controls (Ctrl + / Ctrl -).

## Notes

-   Review note: the supplied SQL declares foreign keys from
    staging_enrolment_records.institution_id and academic_year to
    non-primary-key columns in submission_batches. Those referenced
    columns are not declared UNIQUE in the supplied schema, so those
    constraints may not be executable in PostgreSQL as written. The
    diagram preserves the declared relationships for review.

## ER Diagram

``` mermaid
erDiagram
    MASTER_INSTITUTIONS {
        uuid institution_id PK
    }
    MASTER_USER_PROFILES {
        uuid user_id PK
    }
    STAGING_SUBMISSION_BATCHES {
        uuid batch_id PK
        uuid institution_id FK
        character academic_year
        uuid submitted_by FK
        USER_DEFINED source_channel
        varchar original_filename
        character file_sha256
        bigint file_size_bytes
        USER_DEFINED status
        varchar bullmq_job_id
        text failure_reason
        integer total_rows
        integer l1_rejected_rows
        integer l2_quarantined_rows
        integer l3_quarantined_rows
        integer promoted_rows
        timestamptz uploaded_at
        timestamptz processing_started_at
        timestamptz completed_at
        timestamptz pii_purged_at
        timestamptz created_at
        timestamptz updated_at
        timestamptz identity_purged_at
    }
    STAGING_ENROLMENT_RECORDS {
        bigint record_id PK
        uuid batch_id FK
        uuid institution_id FK
        character academic_year FK
        integer source_row_number
        text raw_apaar_id
        text raw_full_name
        text raw_date_of_birth
        text raw_gender
        text raw_email
        text raw_mobile
        text raw_roll_no
        text raw_program_code
        text raw_admission_date
        text raw_social_category
        text raw_residency_status
        text raw_seat_quota_type
        text raw_is_fn
        text raw_is_oci_status
        text raw_nationality
        text raw_passport_no
        text raw_passport_expiry
        text raw_visa_type
        text raw_frro_reg_no
        text raw_oci_card_no
        text raw_embassy_sponsor_ref
        jsonb raw_payload
        character normalised_apaar_id
        uuid resolved_program_id
        uuid resolved_intake_approval_id
        USER_DEFINED resolved_residency_status
        USER_DEFINED resolved_quota_type
        timestamptz abc_verified_at
        numeric abc_name_similarity
        varchar abc_response_ref
        USER_DEFINED validation_status
        smallint rejected_at_level
        uuid promoted_enrolment_id
        timestamptz promoted_at
        timestamptz created_at
        timestamptz updated_at
        uuid resolved_student_id
        date resolved_admission_date
    }
    STAGING_VALIDATION_ANOMALIES {
        bigint anomaly_id PK
        uuid batch_id FK
        bigint record_id FK
        uuid institution_id FK
        USER_DEFINED anomaly_code
        USER_DEFINED severity
        smallint validation_level
        varchar field_name
        text offending_value
        text message
        text fix_hint
        uuid conflicting_institution_id FK
        jsonb details
        boolean is_resolved
        timestamptz resolved_at
        uuid resolved_by FK
        timestamptz created_at
    }

    MASTER_INSTITUTIONS ||--o{ STAGING_SUBMISSION_BATCHES : institution_id
    MASTER_USER_PROFILES o|--o{ STAGING_SUBMISSION_BATCHES : submitted_by

    STAGING_SUBMISSION_BATCHES ||--o{ STAGING_ENROLMENT_RECORDS : batch_id
    STAGING_SUBMISSION_BATCHES ||--o{ STAGING_ENROLMENT_RECORDS : institution_id_constraint
    STAGING_SUBMISSION_BATCHES ||--o{ STAGING_ENROLMENT_RECORDS : academic_year_constraint

    STAGING_ENROLMENT_RECORDS ||--o{ STAGING_VALIDATION_ANOMALIES : record_id
    STAGING_ENROLMENT_RECORDS ||--o{ STAGING_VALIDATION_ANOMALIES : batch_id_constraint
    STAGING_SUBMISSION_BATCHES ||--o{ STAGING_VALIDATION_ANOMALIES : batch_id
    STAGING_SUBMISSION_BATCHES ||--o{ STAGING_VALIDATION_ANOMALIES : institution_id_constraint

    MASTER_INSTITUTIONS ||--o{ STAGING_VALIDATION_ANOMALIES : conflicting_institution_id
    MASTER_USER_PROFILES o|--o{ STAGING_VALIDATION_ANOMALIES : resolved_by
```
