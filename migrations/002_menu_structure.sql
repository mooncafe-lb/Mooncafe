-- 002_menu_structure.sql : menu structure, sizes, choices, order history, store settings.
-- Additive only: no DROP, no DELETE of existing data. All text values below are seed values
-- stored in the database, editable from the Admin Dashboard, never overwritten by code.

-- 1. Category images
ALTER TABLE categories ADD COLUMN image_id integer REFERENCES images(id) ON DELETE SET NULL;

-- 2. Image metadata + optimized thumbnail (all new columns are nullable)
ALTER TABLE images ADD COLUMN sha256        text;
ALTER TABLE images ADD COLUMN byte_size     integer;
ALTER TABLE images ADD COLUMN thumb         bytea;
ALTER TABLE images ADD COLUMN original_name text;
CREATE INDEX images_sha256_idx ON images (sha256);

-- 3. products.price_lbp becomes a legacy column (kept, no longer used).
--    Prices move to product_sizes so Medium/Large and "price not set" work.
ALTER TABLE products ALTER COLUMN price_lbp DROP NOT NULL;

CREATE TABLE product_sizes (
  id           serial PRIMARY KEY,
  product_id   integer NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name_ar      text NOT NULL,
  name_en      text NOT NULL,
  price_lbp    bigint CHECK (price_lbp IS NULL OR price_lbp > 0),  -- NULL = price not set
  is_available boolean NOT NULL DEFAULT true,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_sizes_product_idx ON product_sizes (product_id, sort_order);

-- Keep any product that already exists: give it one "Regular" size carrying its old price.
INSERT INTO product_sizes (product_id, name_ar, name_en, price_lbp, sort_order)
SELECT p.id, 'عادي', 'Regular', NULLIF(p.price_lbp, 0), 0
FROM products p
WHERE NOT EXISTS (SELECT 1 FROM product_sizes s WHERE s.product_id = p.id);

-- 4. Choices and extras
CREATE TABLE option_groups (
  id          serial PRIMARY KEY,
  product_id  integer NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name_ar     text NOT NULL,
  name_en     text NOT NULL,
  selection   text NOT NULL DEFAULT 'single' CHECK (selection IN ('single', 'multiple')),
  is_required boolean NOT NULL DEFAULT false,
  max_choices integer CHECK (max_choices IS NULL OR max_choices >= 1),
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX option_groups_product_idx ON option_groups (product_id, sort_order);

CREATE TABLE option_choices (
  id              serial PRIMARY KEY,
  group_id        integer NOT NULL REFERENCES option_groups(id) ON DELETE CASCADE,
  name_ar         text NOT NULL,
  name_en         text NOT NULL,
  price_delta_lbp bigint NOT NULL DEFAULT 0 CHECK (price_delta_lbp >= 0),
  is_available    boolean NOT NULL DEFAULT true,
  sort_order      integer NOT NULL DEFAULT 0
);
CREATE INDEX option_choices_group_idx ON option_choices (group_id, sort_order);

-- 5. Orders: size snapshot, instructions, duplicate-submit protection, stored message
ALTER TABLE order_items ADD COLUMN size_name_ar         text;
ALTER TABLE order_items ADD COLUMN size_name_en         text;
ALTER TABLE order_items ADD COLUMN special_instructions text NOT NULL DEFAULT '';

ALTER TABLE orders ADD COLUMN request_id       uuid UNIQUE;
ALTER TABLE orders ADD COLUMN whatsapp_message text;
ALTER TABLE orders ADD COLUMN language         text NOT NULL DEFAULT 'ar' CHECK (language IN ('ar', 'en'));

CREATE TABLE order_status_history (
  id         bigserial PRIMARY KEY,
  order_id   bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status     text NOT NULL,
  changed_by integer REFERENCES admins(id) ON DELETE SET NULL,
  note       text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_status_history_order_idx ON order_status_history (order_id, created_at);

INSERT INTO order_status_history (order_id, status, created_at)
SELECT id, status, created_at FROM orders;

-- 6. Settings. New keys never overwrite existing ones.
INSERT INTO settings (key, value) VALUES
  ('store_status', '{"mode":"auto","timezone":"Asia/Beirut","closed_message_ar":"نحن مغلقون حالياً. يمكنك تصفح القائمة والطلب عند الافتتاح.","closed_message_en":"We are currently closed. You can browse the menu and order when we open."}'),
  ('opening_hours', '{"mon":[],"tue":[],"wed":[],"thu":[],"fri":[],"sat":[],"sun":[]}'),
  ('social', '{"instagram":"mooncafe.lb"}')
ON CONFLICT (key) DO NOTHING;

-- Existing values win (right-hand side of ||); only missing keys are added.
UPDATE settings SET value = '{"enabled":true,"message_template":""}'::jsonb || value, updated_at = now() WHERE key = 'whatsapp';

-- Move the seeded default color to the approved brand yellow, but only if nobody changed it.
UPDATE settings SET value = jsonb_set(value, '{primary_color}', '"#FFC000"'), updated_at = now()
WHERE key = 'branding' AND value->>'primary_color' = '#E3AE1F';

UPDATE settings SET value =
  '{"secondary_color":"#000000","surface_color":"#121212","text_on_dark":"#FFFFFF","text_on_primary":"#000000","font_ar":"Cairo","font_en":"Poppins","hero_image_id":null}'::jsonb || value, updated_at = now()
WHERE key = 'branding';

-- Fill store details from the printed menu, only where still empty.
UPDATE settings SET value = value
  || CASE WHEN COALESCE(value->>'address', '')    = '' THEN '{"address":"Sibline, Wadi El Zayneh, near Daoud Al Ali School"}'::jsonb ELSE '{}'::jsonb END
  || CASE WHEN COALESCE(value->>'address_ar', '') = '' THEN '{"address_ar":"صبلين، وادي الزينة، قرب مدرسة داود العلي"}'::jsonb ELSE '{}'::jsonb END
  || CASE WHEN COALESCE(value->>'phone', '')      = '' THEN '{"phone":"78 964 984"}'::jsonb ELSE '{}'::jsonb END,
  updated_at = now()
WHERE key = 'store';
