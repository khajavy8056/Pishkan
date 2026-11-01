-- ---------------------------------------------------------------------------
-- Pishkan — manual PostgreSQL provisioning
--
-- The installer runs the equivalent statements automatically and generates a
-- random password. Use this file only for a manual/temporary setup, and replace
-- the placeholder password before running it.
--
--   sudo -u postgres psql -f deploy/postgres/setup.sql
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP on

-- 1. Dedicated, unprivileged role. Never run the API as the postgres superuser.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pishkan') THEN
    CREATE ROLE pishkan LOGIN PASSWORD 'CHANGE_ME_STRONG_RANDOM_PASSWORD';
  END IF;
END
$$;

-- 2. Database owned by the application role.
SELECT 'CREATE DATABASE pishkan OWNER pishkan'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'pishkan')\gexec

-- 3. Tighten the schema so other roles cannot read customer documents.
\connect pishkan
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO pishkan;

-- 4. Verify (should print the role and database you just ensured).
SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname = 'pishkan';
SELECT datname, pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = 'pishkan';
