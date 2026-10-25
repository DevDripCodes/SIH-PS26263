-- ============================================================================
-- 07_ingestion_patch.sql : source channel for the manual-entry web form
-- Run as postgres AFTER 06 (integrate.sql). Safe to re-run.
--
-- The backend writes source_channel = 'WEB_FORM' for students keyed in through
-- the institution portal form (POST /api/v1/ingestion/form). CSV and Excel
-- uploads keep using CSV_UPLOAD / EXCEL_UPLOAD.
-- ============================================================================

ALTER TYPE staging.submission_source_enum ADD VALUE IF NOT EXISTS 'WEB_FORM';
