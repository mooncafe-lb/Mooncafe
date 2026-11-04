-- 005_staff_and_order_tracking.sql : staff accounts with roles, who handles each order, and a full activity log.
-- Additive: no DROP TABLE/COLUMN, no DELETE, existing rows keep their values.
-- (Two constraints are relaxed/replaced by wider ones: admins.email may be empty, and orders.status accepts two more values.)

-- 1. Staff accounts: real name, username, creator, last activity. Existing admins keep working
--    (role 'owner' is treated as Super Admin by the application).
ALTER TABLE admins ALTER COLUMN email DROP NOT NULL;
ALTER TABLE admins ADD COLUMN username         text;
ALTER TABLE admins ADD COLUMN full_name        text NOT NULL DEFAULT '';
ALTER TABLE admins ADD COLUMN last_activity_at timestamptz;
ALTER TABLE admins ADD COLUMN created_by       integer REFERENCES admins(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX admins_username_lower_idx ON admins (lower(username)) WHERE username IS NOT NULL;
ALTER TABLE admins ADD CONSTRAINT admins_role_check CHECK (role IN ('owner', 'super_admin', 'manager', 'staff'));

-- 2. Who is responsible for each order (the name is also copied, so history survives a deleted account).
ALTER TABLE orders ADD COLUMN assigned_to   integer REFERENCES admins(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN assigned_name text NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN assigned_at   timestamptz;
CREATE INDEX orders_assigned_idx ON orders (assigned_to, status);

-- 3. Two more order stages: ready, out_for_delivery. The old CHECK is found by what it contains, then replaced by a wider one.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'orders'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%whatsapp_prepared%'
  LOOP
    EXECUTE format('ALTER TABLE orders DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('whatsapp_prepared', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled'));

-- 4. Activity log: what happened, who did it (name copied at that moment), and who it concerned.
ALTER TABLE order_status_history ADD COLUMN event       text NOT NULL DEFAULT 'status';
ALTER TABLE order_status_history ADD COLUMN actor_name  text NOT NULL DEFAULT '';
ALTER TABLE order_status_history ADD COLUMN target_name text NOT NULL DEFAULT '';
ALTER TABLE order_status_history ADD CONSTRAINT order_status_history_event_check
  CHECK (event IN ('created', 'status', 'claimed', 'assigned', 'released', 'note'));
CREATE INDEX order_status_history_actor_idx ON order_status_history (changed_by, created_at);
