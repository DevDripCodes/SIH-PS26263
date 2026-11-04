-- Synthetic AICTE-style reference data for local development only.
-- Run AFTER database/db_scripts/core.sql and database/db_scripts/integrate.sql.
-- All IDs and contact details are fictional. This script does not create auth.users.
BEGIN;

INSERT INTO master.affiliating_bodies
  (affiliating_body_id, aishe_code, body_name, body_type, state_code, nad_issuer_id)
VALUES
  ('a1000000-0000-4000-8000-000000000001', 'SYN-AISHE-001', 'Dakshin Technical University (Synthetic)', 'TECHNICAL_UNIVERSITY', 'KA', 'SYN-NAD-001'),
  ('a1000000-0000-4000-8000-000000000002', 'SYN-AISHE-002', 'Western Plains State Board (Synthetic)', 'STATE_BOARD', 'MH', 'SYN-NAD-002')
ON CONFLICT (affiliating_body_id) DO NOTHING;

INSERT INTO master.institutions
  (institution_id, aicte_permanent_id, aishe_code, affiliating_body_id, institution_name,
   institution_category, aicte_region, state_code, district_name, pin_code,
   is_minority_institution, is_women_only, approval_status, nodal_officer_email, nodal_officer_phone, metadata)
VALUES
  ('b1000000-0000-4000-8000-000000000001', 'SYN-1-9000000001', 'SYN-INST-001', 'a1000000-0000-4000-8000-000000000001', 'Deccan Valley Institute of Technology (Synthetic)', 'AFFILIATED_COLLEGE', 'SOUTH', 'KA', 'Mysuru', '570001', FALSE, FALSE, 'EOA_GRANTED', 'nodal001@example.invalid', '+910000000001', '{"synthetic":true,"fixture":"dev-v1"}'),
  ('b1000000-0000-4000-8000-000000000002', 'SYN-1-9000000002', 'SYN-INST-002', 'a1000000-0000-4000-8000-000000000001', 'Coastal Ridge College of Engineering (Synthetic)', 'AFFILIATED_COLLEGE', 'SOUTH', 'KA', 'Mangaluru', '575001', FALSE, FALSE, 'EOA_GRANTED', 'nodal002@example.invalid', '+910000000002', '{"synthetic":true,"fixture":"dev-v1"}'),
  ('b1000000-0000-4000-8000-000000000003', 'SYN-1-9000000003', 'SYN-INST-003', 'a1000000-0000-4000-8000-000000000002', 'Western Plains Polytechnic (Synthetic)', 'AUTONOMOUS_INSTITUTE', 'WEST', 'MH', 'Nashik', '422001', FALSE, FALSE, 'EOA_GRANTED', 'nodal003@example.invalid', '+910000000003', '{"synthetic":true,"fixture":"dev-v1"}')
ON CONFLICT (institution_id) DO NOTHING;

INSERT INTO master.institutional_programs
  (program_id, institution_id, aicte_course_id, program_level, program_shift, program_broad_discipline, course_name, duration_years, is_nba_accredited, is_active)
VALUES
  ('c1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'SYN-KA-001-CSE', 'UG_DEGREE', 'FIRST_SHIFT', 'ENGINEERING_AND_TECHNOLOGY', 'B.Tech Computer Science and Engineering', 4, TRUE, TRUE),
  ('c1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001', 'SYN-KA-001-ECE', 'UG_DEGREE', 'FIRST_SHIFT', 'ENGINEERING_AND_TECHNOLOGY', 'B.Tech Electronics and Communication Engineering', 4, FALSE, TRUE),
  ('c1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000002', 'SYN-KA-002-CSE', 'UG_DEGREE', 'FIRST_SHIFT', 'ENGINEERING_AND_TECHNOLOGY', 'B.E. Computer Science and Engineering', 4, FALSE, TRUE),
  ('c1000000-0000-4000-8000-000000000004', 'b1000000-0000-4000-8000-000000000003', 'SYN-MH-003-DIP', 'DIPLOMA', 'FIRST_SHIFT', 'ENGINEERING_AND_TECHNOLOGY', 'Diploma in Computer Engineering', 3, FALSE, TRUE)
ON CONFLICT (program_id) DO NOTHING;

INSERT INTO master.program_intake_approvals
  (intake_approval_id, program_id, institution_id, academic_year, eoa_letter_ref_no, eoa_issue_date,
   approved_sanctioned_intake, approved_nri_seats, approved_supernumerary_tfw,
   approved_supernumerary_fn_oci_ciwgc, approved_supernumerary_pmsss, approved_supernumerary_ews,
   approved_lateral_entry_seats, admission_cutoff_date, is_locked_by_aicte)
VALUES
  ('d1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', '2026-27', 'SYN-EOA-2026-001', '2026-04-15', 60, 3, 3, 5, 2, 3, 12, '2026-09-30 23:59:59+05:30', FALSE),
  ('d1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001', '2026-27', 'SYN-EOA-2026-002', '2026-04-15', 60, 3, 3, 5, 2, 3, 12, '2026-09-30 23:59:59+05:30', FALSE),
  ('d1000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000002', '2026-27', 'SYN-EOA-2026-003', '2026-04-16', 60, 3, 3, 5, 2, 3, 12, '2026-09-30 23:59:59+05:30', FALSE),
  ('d1000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000004', 'b1000000-0000-4000-8000-000000000003', '2026-27', 'SYN-EOA-2026-004', '2026-04-17', 60, 3, 3, 5, 0, 3, 0, '2026-09-30 23:59:59+05:30', FALSE)
ON CONFLICT (program_id, academic_year) DO NOTHING;

COMMIT;
