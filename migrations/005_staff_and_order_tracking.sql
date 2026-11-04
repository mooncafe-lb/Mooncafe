-- 005_staff_and_order_tracking.sql : staff accounts with roles, who handles each order, and a full activity log.
-- Additive: no DROP TABLE/COLUMN, no DELETE, no UPDATE. Existing rows keep their values.
-- Two CHECK constraints are replaced by wider ones (admins.role and orders.status): see section 3.
-- Run order: after 004 (admins.role is created there).

-- 1. Staff accounts: real name, username, creator, last activity. Existing admins keep working:
--    role 'owner' (the default 004 gave them) stays valid and is treated as Super Admin by the application.
ALTER TABLE admins ALTER COLUMN email DROP NOT NULL;
ALTER TABLE admins ADD COLUMN username         text;
ALTER TABLE admins ADD COLUMN full_name        text NOT NULL DEFAULT '';
ALTER TABLE admins ADD COLUMN last_activity_at timestamptz;
ALTER TABLE admins ADD COLUMN created_by       integer REFERENCES admins(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX admins_username_lower_idx ON admins (lower(username)) WHERE username IS NOT NULL;

-- 2. Who is responsible for each order (the name is also copied, so history survives a deleted account).
ALTER TABLE orders ADD COLUMN assigned_to   integer REFERENCES admins(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN assigned_name text NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN assigned_at   timestamptz;
CREATE INDEX orders_assigned_idx ON orders (assigned_to, status);

-- 3. Wider CHECK constraints for admins.role and orders.status.
--    The constraints to replace are found from the catalog by the COLUMN they restrict: a CHECK that involves
--    exactly that one column (pg_constraint.conkey), whatever its name or text. CHECKs on other columns are never touched.
--    Nothing is changed if the data does not fit the new lists; the block then stops with an error and the whole
--    migration run is rolled back. Row counts and the number of unrelated CHECKs are verified at the end.
DO $$
DECLARE
  c record;
  role_col smallint;
  status_col smallint;
  admins_before bigint;
  orders_before bigint;
  other_admin_checks bigint;
  other_order_checks bigint;
BEGIN
  SELECT count(*) INTO admins_before FROM admins;
  SELECT count(*) INTO orders_before FROM orders;

  SELECT attnum INTO role_col   FROM pg_attribute WHERE attrelid = 'admins'::regclass AND attname = 'role'   AND NOT attisdropped;
  SELECT attnum INTO status_col FROM pg_attribute WHERE attrelid = 'orders'::regclass AND attname = 'status' AND NOT attisdropped;
  IF role_col IS NULL THEN
    RAISE EXCEPTION '[005] admins.role does not exist (migration 004 must run first). Nothing was changed.';
  END IF;
  IF status_col IS NULL THEN
    RAISE EXCEPTION '[005] orders.status does not exist. Nothing was changed.';
  END IF;

  IF EXISTS (SELECT 1 FROM admins WHERE role NOT IN ('owner', 'super_admin', 'manager', 'staff')) THEN
    RAISE EXCEPTION '[005] an admin has a role outside owner/super_admin/manager/staff. Nothing was changed.';
  END IF;
  IF EXISTS (SELECT 1 FROM orders WHERE status NOT IN ('whatsapp_prepared', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled')) THEN
    RAISE EXCEPTION '[005] an order has a status outside the new list. Nothing was changed.';
  END IF;

  -- CHECK constraints on other columns: counted now, must be the same at the end
  SELECT count(*) INTO other_admin_checks FROM pg_constraint
    WHERE conrelid = 'admins'::regclass AND contype = 'c' AND conkey IS DISTINCT FROM ARRAY[role_col];
  SELECT count(*) INTO other_order_checks FROM pg_constraint
    WHERE conrelid = 'orders'::regclass AND contype = 'c' AND conkey IS DISTINCT FROM ARRAY[status_col];

  -- admins.role: drop any existing CHECK that restricts only role, then add the wider one
  FOR c IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'admins'::regclass AND contype = 'c' AND conkey = ARRAY[role_col]
  LOOP
    EXECUTE format('ALTER TABLE admins DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE admins ADD CONSTRAINT admins_role_check CHECK (role IN ('owner', 'super_admin', 'manager', 'staff'));

  -- orders.status: drop any existing CHECK that restricts only status, then add the wider one
  FOR c IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'orders'::regclass AND contype = 'c' AND conkey = ARRAY[status_col]
  LOOP
    EXECUTE format('ALTER TABLE orders DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE orders ADD CONSTRAINT orders_status_check
    CHECK (status IN ('whatsapp_prepared', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled'));

  -- verification: exactly one CHECK per column now, others untouched, no rows lost
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid = 'admins'::regclass AND contype = 'c' AND conkey = ARRAY[role_col]) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION '[005] admins.role must have exactly one CHECK constraint after the change';
  END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid = 'orders'::regclass AND contype = 'c' AND conkey = ARRAY[status_col]) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION '[005] orders.status must have exactly one CHECK constraint after the change';
  END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid = 'admins'::regclass AND contype = 'c' AND conkey IS DISTINCT FROM ARRAY[role_col]) IS DISTINCT FROM other_admin_checks THEN
    RAISE EXCEPTION '[005] a CHECK constraint on another admins column was changed';
  END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid = 'orders'::regclass AND contype = 'c' AND conkey IS DISTINCT FROM ARRAY[status_col]) IS DISTINCT FROM other_order_checks THEN
    RAISE EXCEPTION '[005] a CHECK constraint on another orders column was changed';
  END IF;
  IF (SELECT count(*) FROM admins) IS DISTINCT FROM admins_before OR (SELECT count(*) FROM orders) IS DISTINCT FROM orders_before THEN
    RAISE EXCEPTION '[005] row counts changed';
  END IF;
END $$;

-- 4. Activity log: what happened, who did it (name copied at that moment), and who it concerned.
ALTER TABLE order_status_history ADD COLUMN event       text NOT NULL DEFAULT 'status';
ALTER TABLE order_status_history ADD COLUMN actor_name  text NOT NULL DEFAULT '';
ALTER TABLE order_status_history ADD COLUMN target_name text NOT NULL DEFAULT '';
ALTER TABLE order_status_history ADD CONSTRAINT order_status_history_event_check
  CHECK (event IN ('created', 'status', 'claimed', 'assigned', 'released', 'note'));
CREATE INDEX order_status_history_actor_idx ON order_status_history (changed_by, created_at);
