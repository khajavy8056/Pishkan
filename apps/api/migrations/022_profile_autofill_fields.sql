-- ============================================================================
-- 022_profile_autofill_fields.sql
--
-- Extra identity/banking fields on the customer profile that service forms
-- ask for again and again (father's name for ثنا/سجام, birth-certificate
-- number for ثبت احوال services, IBAN/bank for loans and subsidies). Storing
-- them once lets the service form offer one-click autofill from the profile
-- instead of making the customer retype the same facts on every request.
-- All columns are nullable and purely additive.
-- ============================================================================

ALTER TABLE customer_profiles ADD COLUMN father_name TEXT;
ALTER TABLE customer_profiles ADD COLUMN birth_certificate_no TEXT;
ALTER TABLE customer_profiles ADD COLUMN birth_place TEXT;
ALTER TABLE customer_profiles ADD COLUMN landline TEXT;
ALTER TABLE customer_profiles ADD COLUMN iban TEXT;
ALTER TABLE customer_profiles ADD COLUMN bank_name TEXT;
ALTER TABLE customer_profiles ADD COLUMN card_number TEXT;
