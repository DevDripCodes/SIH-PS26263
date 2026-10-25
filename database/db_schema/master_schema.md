# Master Schema

Scroll to pan. Use browser zoom to adjust display size.

## Notes

-   The supplied SQL contains a duplicated constraint name and a likely
    invalid foreign key: fk_intake_program_institution references
    master.institutional_programs(institution_id), which is not the
    declared primary key of that table. The diagram shows the intended
    program and institution relationships based on the separately
    declared constraints; it does not draw that questionable duplicate
    FK.

## ER Diagram

``` mermaid
erDiagram
    AUTH_USERS {
        uuid id PK
    }
    MASTER_AFFILIATING_BODIES {
        uuid affiliating_body_id PK
        varchar aishe_code UK
        varchar body_name
        varchar body_type
        char state_code
        varchar nad_issuer_id
        boolean is_active
        timestamptz created_at
        timestamptz updated_at
    }
    MASTER_INSTITUTIONS {
        uuid institution_id PK
        varchar aicte_permanent_id UK
        varchar aishe_code UK
        uuid affiliating_body_id FK
        varchar institution_name
        USER_DEFINED institution_category
        varchar aicte_region
        char state_code
        varchar district_name
        char pin_code
        boolean is_minority_institution
        boolean is_women_only
        varchar approval_status
        varchar nodal_officer_email
        varchar nodal_officer_phone
        jsonb metadata
        timestamptz created_at
        timestamptz updated_at
    }
    MASTER_USER_PROFILES {
        uuid user_id PK, FK
        USER_DEFINED role
        uuid institution_id FK
        uuid affiliating_body_id FK
        varchar aicte_region
        varchar full_name
        varchar official_designation
        boolean is_active
        timestamptz created_at
        timestamptz updated_at
    }
    MASTER_INSTITUTIONAL_PROGRAMS {
        uuid program_id PK
        uuid institution_id FK
        varchar aicte_course_id UK
        USER_DEFINED program_level
        USER_DEFINED program_shift
        varchar program_broad_discipline
        varchar course_name
        numeric duration_years
        boolean is_nba_accredited
        date nba_valid_upto
        boolean is_active
        timestamptz created_at
        timestamptz updated_at
    }
    MASTER_PROGRAM_INTAKE_APPROVALS {
        uuid intake_approval_id PK
        uuid program_id FK
        uuid institution_id FK
        character academic_year
        varchar eoa_letter_ref_no
        date eoa_issue_date
        integer approved_sanctioned_intake
        integer approved_nri_seats
        integer approved_supernumerary_tfw
        integer approved_supernumerary_fn_oci_ciwgc
        integer approved_supernumerary_pmsss
        integer approved_supernumerary_ews
        integer approved_lateral_entry_seats
        integer actual_regular_enrolled
        integer actual_nri_enrolled
        integer actual_tfw_enrolled
        integer actual_fn_oci_ciwgc_enrolled
        integer actual_pmsss_enrolled
        integer actual_ews_enrolled
        integer actual_lateral_enrolled
        timestamptz admission_cutoff_date
        boolean is_locked_by_aicte
        timestamptz created_at
        timestamptz updated_at
    }
    MASTER_QUOTA_RESIDENCY_RULES {
        USER_DEFINED seat_quota_type PK
        USER_DEFINED residency_status PK
    }

    MASTER_AFFILIATING_BODIES o|--o{ MASTER_INSTITUTIONS : affiliating_body_id
    AUTH_USERS ||--|| MASTER_USER_PROFILES : user_id
    MASTER_INSTITUTIONS o|--o{ MASTER_USER_PROFILES : institution_id
    MASTER_AFFILIATING_BODIES o|--o{ MASTER_USER_PROFILES : affiliating_body_id
    MASTER_INSTITUTIONS ||--o{ MASTER_INSTITUTIONAL_PROGRAMS : institution_id
    MASTER_INSTITUTIONAL_PROGRAMS ||--o{ MASTER_PROGRAM_INTAKE_APPROVALS : program_id
    MASTER_INSTITUTIONS ||--o{ MASTER_PROGRAM_INTAKE_APPROVALS : institution_id
```
