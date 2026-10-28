-- Additive upgrade: no existing customer, invoice or transaction is removed.
CREATE TABLE IF NOT EXISTS cities (
 id TEXT PRIMARY KEY, province TEXT NOT NULL, name TEXT NOT NULL,
 is_active INTEGER NOT NULL DEFAULT 1, UNIQUE(province, name)
);
INSERT INTO cities (id,province,name) VALUES ('tehran','تهران','تهران'),('mashhad','خراسان رضوی','مشهد'),('isfahan','اصفهان','اصفهان'),('shiraz','فارس','شیراز'),('tabriz','آذربایجان شرقی','تبریز'),('karaj','البرز','کرج'),('qom','قم','قم'),('ahvaz','خوزستان','اهواز'),('kerman','کرمان','کرمان'),('rasht','گیلان','رشت'),('yazd','یزد','یزد'),('kermanshah','کرمانشاه','کرمانشاه') ON CONFLICT(id) DO NOTHING;
ALTER TABLE customer_profiles ADD COLUMN first_name TEXT;
ALTER TABLE customer_profiles ADD COLUMN last_name TEXT;
ALTER TABLE customer_profiles ADD COLUMN city_id TEXT REFERENCES cities(id);
ALTER TABLE services ADD COLUMN coverage TEXT NOT NULL DEFAULT 'nationwide';
CREATE TABLE IF NOT EXISTS service_cities (
 service_id TEXT NOT NULL REFERENCES services(id), city_id TEXT NOT NULL REFERENCES cities(id),
 PRIMARY KEY(service_id,city_id)
);
ALTER TABLE services ADD COLUMN urgent_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE services ADD COLUMN urgent_percent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE services ADD COLUMN urgent_days INTEGER NOT NULL DEFAULT 1;
ALTER TABLE services ADD COLUMN urgent_capacity INTEGER NOT NULL DEFAULT 0;
ALTER TABLE requests ADD COLUMN urgent_fee INTEGER NOT NULL DEFAULT 0;
ALTER TABLE otp_codes ADD COLUMN account_kind TEXT NOT NULL DEFAULT 'customer';
CREATE TABLE IF NOT EXISTS financial_operations (
 operation_key TEXT PRIMARY KEY, created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_invoice_sequence_number ON invoices(number);
ALTER TABLE payments ADD COLUMN gateway_sandbox INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_authority ON payments(gateway_authority) WHERE gateway_authority IS NOT NULL;
