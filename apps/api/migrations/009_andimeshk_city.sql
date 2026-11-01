-- Add Andimeshk as a selectable customer/service city without modifying existing city records.
INSERT INTO cities (id, province, name) VALUES ('andimeshk', 'خوزستان', 'اندیمشک') ON CONFLICT DO NOTHING;
