# Core Schema

Scroll to pan. This diagram is wide because the schema includes yearly
enrolment tables.

## Notes

-   Source fidelity notes: student_foreign_nri_profiles declares a
    foreign key from residency_status to
    core.students(residency_status), although that column is not shown
    as unique or primary key. active_national_enrolment_locks declares
    several foreign keys to individual enrolment partition columns and a
    composite-key parent using single-column references; these may not
    be valid executable PostgreSQL constraints. Those questionable links
    are omitted from the diagram. Enrolment tables and their explicitly
    declared student/institution/program/intake links are shown.

## ER Diagram

``` mermaid
erDiagram
    AUTH_USERS {
        uuid id PK
    }
    CORE_STUDENTS {
        uuid student_id PK
        character apaar_id UK
        USER_DEFINED apaar_verification_status
        timestamptz apaar_verified_at
        varchar full_name
        date date_of_birth
        varchar gender
        USER_DEFINED residency_status
        char nationality_country_code
        timestamptz created_at
        timestamptz updated_at
    }
    CORE_STUDENT_FOREIGN_NRI_PROFILES {
        uuid student_id PK, FK
        USER_DEFINED residency_status
        char country_of_citizenship
        bytea passport_number_enc
        bytea passport_fingerprint UK
        date passport_expiry
        varchar visa_type
        bytea frro_registration_no_enc
        bytea oci_card_no_enc
        bytea embassy_sponsorship_ref_enc
        smallint encryption_key_version
        timestamptz created_at
        timestamptz updated_at
    }
    CORE_STUDENT_ENROLMENTS {
        uuid enrolment_id PK
        character academic_year PK
        uuid student_id FK
        uuid institution_id FK
        uuid program_id FK
        uuid intake_approval_id FK
        USER_DEFINED seat_quota_type
        boolean is_supernumerary_seat
        smallint entry_year_of_study
        varchar roll_no
        date admission_date
        USER_DEFINED enrolment_status
        timestamptz status_changed_at
        uuid source_batch_id
        bigint source_record_id
        timestamptz verified_at
        timestamptz created_at
        timestamptz updated_at
    }
    CORE_STUDENT_ENROLMENTS_2024_25 {
        uuid enrolment_id PK
        character academic_year PK
        uuid student_id FK
        uuid institution_id FK
        uuid program_id FK
        uuid intake_approval_id FK
        USER_DEFINED seat_quota_type
        boolean is_supernumerary_seat
        smallint entry_year_of_study
        varchar roll_no
        date admission_date
        USER_DEFINED enrolment_status
        timestamptz status_changed_at
        uuid source_batch_id
        bigint source_record_id
        timestamptz verified_at
        timestamptz created_at
        timestamptz updated_at
    }
    CORE_STUDENT_ENROLMENTS_2025_26 {
        uuid enrolment_id PK
        character academic_year PK
        uuid student_id FK
        uuid institution_id FK
        uuid program_id FK
        uuid intake_approval_id FK
        USER_DEFINED seat_quota_type
        boolean is_supernumerary_seat
        smallint entry_year_of_study
        varchar roll_no
        date admission_date
        USER_DEFINED enrolment_status
        timestamptz status_changed_at
        uuid source_batch_id
        bigint source_record_id
        timestamptz verified_at
        timestamptz created_at
        timestamptz updated_at
    }
    CORE_STUDENT_ENROLMENTS_2026_27 {
        uuid enrolment_id PK
        character academic_year PK
        uuid student_id FK
        uuid institution_id FK
        uuid program_id FK
        uuid intake_approval_id FK
        USER_DEFINED seat_quota_type
        boolean is_supernumerary_seat
        smallint entry_year_of_study
        varchar roll_no
        date admission_date
        USER_DEFINED enrolment_status
        timestamptz status_changed_at
        uuid source_batch_id
        bigint source_record_id
        timestamptz verified_at
        timestamptz created_at
        timestamptz updated_at
    }
    CORE_STUDENT_ENROLMENTS_2027_28 {
        uuid enrolment_id PK
        character academic_year PK
        uuid student_id FK
        uuid institution_id FK
        uuid program_id FK
        uuid intake_approval_id FK
        USER_DEFINED seat_quota_type
        boolean is_supernumerary_seat
        smallint entry_year_of_study
        varchar roll_no
        date admission_date
        USER_DEFINED enrolment_status
        timestamptz status_changed_at
        uuid source_batch_id
        bigint source_record_id
        timestamptz verified_at
        timestamptz created_at
        timestamptz updated_at
    }
    CORE_STUDENT_ENROLMENTS_2028_29 {
        uuid enrolment_id PK
        character academic_year PK
        uuid student_id FK
        uuid institution_id FK
        uuid program_id FK
        uuid intake_approval_id FK
        USER_DEFINED seat_quota_type
        boolean is_supernumerary_seat
        smallint entry_year_of_study
        varchar roll_no
        date admission_date
        USER_DEFINED enrolment_status
        timestamptz status_changed_at
        uuid source_batch_id
        bigint source_record_id
        timestamptz verified_at
        timestamptz created_at
        timestamptz updated_at
    }
    CORE_STUDENT_ENROLMENTS_2029_30 {
        uuid enrolment_id PK
        character academic_year PK
        uuid student_id FK
        uuid institution_id FK
        uuid program_id FK
        uuid intake_approval_id FK
        USER_DEFINED seat_quota_type
        boolean is_supernumerary_seat
        smallint entry_year_of_study
        varchar roll_no
        date admission_date
        USER_DEFINED enrolment_status
        timestamptz status_changed_at
        uuid source_batch_id
        bigint source_record_id
        timestamptz verified_at
        timestamptz created_at
        timestamptz updated_at
    }
    CORE_STUDENT_ENROLMENTS_2030_31 {
        uuid enrolment_id PK
        character academic_year PK
        uuid student_id FK
        uuid institution_id FK
        uuid program_id FK
        uuid intake_approval_id FK
        USER_DEFINED seat_quota_type
        boolean is_supernumerary_seat
        smallint entry_year_of_study
        varchar roll_no
        date admission_date
        USER_DEFINED enrolment_status
        timestamptz status_changed_at
        uuid source_batch_id
        bigint source_record_id
        timestamptz verified_at
        timestamptz created_at
        timestamptz updated_at
    }
    CORE_ACTIVE_NATIONAL_ENROLMENT_LOCKS {
        uuid student_id PK, FK
        character apaar_id UK
        uuid institution_id FK
        uuid program_id FK
        character academic_year
        uuid enrolment_id UK
        timestamptz locked_at
    }
    CORE_STUDENT_ACCOUNTS {
        uuid user_id PK, FK
        uuid student_id FK, UK
        varchar link_method
        timestamptz linked_at
        timestamptz created_at
        timestamptz updated_at
    }
    CORE_ENROLMENT_STATUS_HISTORY {
        bigint history_id PK
        uuid enrolment_id
        character academic_year
        uuid student_id
        uuid institution_id
        USER_DEFINED from_status
        USER_DEFINED to_status
        uuid changed_by
        text request_id
        timestamptz changed_at
    }
    MASTER_INSTITUTIONS {
        uuid institution_id PK
    }
    MASTER_INSTITUTIONAL_PROGRAMS {
        uuid program_id PK
    }
    MASTER_PROGRAM_INTAKE_APPROVALS {
        uuid intake_approval_id PK
    }

    CORE_STUDENTS ||--o| CORE_STUDENT_FOREIGN_NRI_PROFILES : student_id
    CORE_STUDENTS ||--o{ CORE_STUDENT_ENROLMENTS : student_id
    CORE_STUDENTS ||--o{ CORE_STUDENT_ENROLMENTS_2024_25 : student_id
    CORE_STUDENTS ||--o{ CORE_STUDENT_ENROLMENTS_2025_26 : student_id
    CORE_STUDENTS ||--o{ CORE_STUDENT_ENROLMENTS_2026_27 : student_id
    CORE_STUDENTS ||--o{ CORE_STUDENT_ENROLMENTS_2027_28 : student_id
    CORE_STUDENTS ||--o{ CORE_STUDENT_ENROLMENTS_2028_29 : student_id
    CORE_STUDENTS ||--o{ CORE_STUDENT_ENROLMENTS_2029_30 : student_id
    CORE_STUDENTS ||--o{ CORE_STUDENT_ENROLMENTS_2030_31 : student_id
    MASTER_INSTITUTIONS ||--o{ CORE_STUDENT_ENROLMENTS : institution_id
    MASTER_INSTITUTIONS ||--o{ CORE_STUDENT_ENROLMENTS_2024_25 : institution_id
    MASTER_INSTITUTIONS ||--o{ CORE_STUDENT_ENROLMENTS_2025_26 : institution_id
    MASTER_INSTITUTIONS ||--o{ CORE_STUDENT_ENROLMENTS_2026_27 : institution_id
    MASTER_INSTITUTIONS ||--o{ CORE_STUDENT_ENROLMENTS_2027_28 : institution_id
    MASTER_INSTITUTIONS ||--o{ CORE_STUDENT_ENROLMENTS_2028_29 : institution_id
    MASTER_INSTITUTIONS ||--o{ CORE_STUDENT_ENROLMENTS_2029_30 : institution_id
    MASTER_INSTITUTIONS ||--o{ CORE_STUDENT_ENROLMENTS_2030_31 : institution_id
    MASTER_INSTITUTIONAL_PROGRAMS ||--o{ CORE_STUDENT_ENROLMENTS : program_id
    MASTER_INSTITUTIONAL_PROGRAMS ||--o{ CORE_STUDENT_ENROLMENTS_2024_25 : program_id
    MASTER_INSTITUTIONAL_PROGRAMS ||--o{ CORE_STUDENT_ENROLMENTS_2025_26 : program_id
    MASTER_INSTITUTIONAL_PROGRAMS ||--o{ CORE_STUDENT_ENROLMENTS_2026_27 : program_id
    MASTER_INSTITUTIONAL_PROGRAMS ||--o{ CORE_STUDENT_ENROLMENTS_2027_28 : program_id
    MASTER_INSTITUTIONAL_PROGRAMS ||--o{ CORE_STUDENT_ENROLMENTS_2028_29 : program_id
    MASTER_INSTITUTIONAL_PROGRAMS ||--o{ CORE_STUDENT_ENROLMENTS_2029_30 : program_id
    MASTER_INSTITUTIONAL_PROGRAMS ||--o{ CORE_STUDENT_ENROLMENTS_2030_31 : program_id
    MASTER_PROGRAM_INTAKE_APPROVALS ||--o{ CORE_STUDENT_ENROLMENTS : intake_approval_id
    MASTER_PROGRAM_INTAKE_APPROVALS ||--o{ CORE_STUDENT_ENROLMENTS_2024_25 : intake_approval_id
    MASTER_PROGRAM_INTAKE_APPROVALS ||--o{ CORE_STUDENT_ENROLMENTS_2025_26 : intake_approval_id
    MASTER_PROGRAM_INTAKE_APPROVALS ||--o{ CORE_STUDENT_ENROLMENTS_2026_27 : intake_approval_id
    MASTER_PROGRAM_INTAKE_APPROVALS ||--o{ CORE_STUDENT_ENROLMENTS_2027_28 : intake_approval_id
    MASTER_PROGRAM_INTAKE_APPROVALS ||--o{ CORE_STUDENT_ENROLMENTS_2028_29 : intake_approval_id
    MASTER_PROGRAM_INTAKE_APPROVALS ||--o{ CORE_STUDENT_ENROLMENTS_2029_30 : intake_approval_id
    MASTER_PROGRAM_INTAKE_APPROVALS ||--o{ CORE_STUDENT_ENROLMENTS_2030_31 : intake_approval_id
    AUTH_USERS ||--o| CORE_STUDENT_ACCOUNTS : user_id
    CORE_STUDENTS ||--o| CORE_STUDENT_ACCOUNTS : student_id
    CORE_STUDENTS ||--o| CORE_ACTIVE_NATIONAL_ENROLMENT_LOCKS : student_id
    MASTER_INSTITUTIONS ||--o{ CORE_ACTIVE_NATIONAL_ENROLMENT_LOCKS : institution_id
    MASTER_INSTITUTIONAL_PROGRAMS ||--o{ CORE_ACTIVE_NATIONAL_ENROLMENT_LOCKS : program_id
```
