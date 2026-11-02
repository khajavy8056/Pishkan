-- ============================================================================
-- 025_delivery_modes.sql
--
-- Direct delivery is the default: the executor hands the finished work to
-- the customer and the request completes immediately. For special services
-- the office can require a main-manager approval before the result becomes
-- visible to the customer.
-- ============================================================================

ALTER TABLE services ADD COLUMN requires_manager_approval INTEGER NOT NULL DEFAULT 0;
