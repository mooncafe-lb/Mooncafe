-- 006_order_tracking.sql : daily order numbers (restart at 1 every Beirut day), private tracking links, customer rating.
-- Additive only: new table + new nullable columns + new indexes. No DROP, no DELETE, no UPDATE: existing orders are not touched
-- (they keep their original date/time and simply have no daily number or tracking link).
-- Run order: after 005.

-- 1. One row per calendar day (Asia/Beirut). The application increments last_number with a single atomic statement
--    (INSERT ... ON CONFLICT (order_date) DO UPDATE ... RETURNING) inside the same transaction that saves the order,
--    so two orders arriving together can never receive the same number, and a failed order does not use up a number.
CREATE TABLE order_counters (
  order_date  date PRIMARY KEY,
  last_number integer NOT NULL CHECK (last_number >= 0)
);

-- 2. Order columns. created_at (already timestamptz, UTC instant) stays the exact timestamp; order_date is the Beirut calendar date
--    of that instant, stored separately so the day is never recomputed differently later.
ALTER TABLE orders ADD COLUMN order_date     date;
ALTER TABLE orders ADD COLUMN daily_number   integer CHECK (daily_number IS NULL OR daily_number > 0);
ALTER TABLE orders ADD COLUMN tracking_token text;
ALTER TABLE orders ADD COLUMN rating         smallint CHECK (rating IS NULL OR rating BETWEEN 1 AND 5);
ALTER TABLE orders ADD COLUMN rating_comment text NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN rated_at       timestamptz;

-- 3. Safety nets. The daily number alone is NOT unique (it repeats every day); (order_date, daily_number) is.
--    The tracking token is unique and is the only key the public tracking page accepts.
CREATE UNIQUE INDEX orders_tracking_token_uq    ON orders (tracking_token) WHERE tracking_token IS NOT NULL;
CREATE UNIQUE INDEX orders_order_date_number_uq ON orders (order_date, daily_number) WHERE daily_number IS NOT NULL;
CREATE INDEX orders_order_date_idx ON orders (order_date);
