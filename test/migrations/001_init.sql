-- 001_init.sql : Moon Cafe base schema

CREATE TABLE admins (
  id            serial PRIMARY KEY,
  email         text NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
CREATE UNIQUE INDEX admins_email_lower_idx ON admins (lower(email));

CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE images (
  id         serial PRIMARY KEY,
  mime       text NOT NULL,
  data       bytea NOT NULL,
  width      integer,
  height     integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE categories (
  id         serial PRIMARY KEY,
  name_ar    text NOT NULL,
  name_en    text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_visible boolean NOT NULL DEFAULT true,
  is_sample  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id             serial PRIMARY KEY,
  category_id    integer NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name_ar        text NOT NULL,
  name_en        text NOT NULL,
  description_ar text NOT NULL DEFAULT '',
  description_en text NOT NULL DEFAULT '',
  price_lbp      bigint NOT NULL CHECK (price_lbp >= 0),
  image_id       integer REFERENCES images(id) ON DELETE SET NULL,
  options        jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_available   boolean NOT NULL DEFAULT true,
  is_visible     boolean NOT NULL DEFAULT true,
  is_sample      boolean NOT NULL DEFAULT false,
  sort_order     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_category_idx ON products (category_id, sort_order);

CREATE TABLE orders (
  id               bigserial PRIMARY KEY,
  public_code      text NOT NULL UNIQUE,
  customer_name    text NOT NULL,
  phone            text NOT NULL,
  fulfillment      text NOT NULL CHECK (fulfillment IN ('delivery', 'pickup')),
  address          text NOT NULL DEFAULT '',
  latitude         double precision,
  longitude        double precision,
  notes            text NOT NULL DEFAULT '',
  subtotal_lbp     bigint NOT NULL CHECK (subtotal_lbp >= 0),
  delivery_fee_lbp bigint NOT NULL DEFAULT 0 CHECK (delivery_fee_lbp >= 0),
  total_lbp        bigint NOT NULL CHECK (total_lbp >= 0),
  -- 'whatsapp_prepared' = the message was generated for the customer to send.
  -- It does NOT mean the café received anything; staff change the status manually.
  status           text NOT NULL DEFAULT 'whatsapp_prepared'
                   CHECK (status IN ('whatsapp_prepared', 'confirmed', 'preparing', 'completed', 'cancelled')),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_created_idx ON orders (created_at DESC);

CREATE TABLE order_items (
  id             bigserial PRIMARY KEY,
  order_id       bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id     integer REFERENCES products(id) ON DELETE SET NULL,
  name_ar        text NOT NULL,
  name_en        text NOT NULL,
  options        jsonb NOT NULL DEFAULT '[]'::jsonb,
  unit_price_lbp bigint NOT NULL CHECK (unit_price_lbp >= 0),
  quantity       integer NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  line_total_lbp bigint NOT NULL CHECK (line_total_lbp >= 0)
);
CREATE INDEX order_items_order_idx ON order_items (order_id);

INSERT INTO settings (key, value) VALUES
  ('store',     '{"name_en":"Moon Cafe","name_ar":"","tagline_ar":"نحنا والقمر جيران","address":"","phone":"","hours":""}'),
  ('whatsapp',  '{"number":"+96178964984"}'),
  ('delivery',  '{"delivery_enabled":true,"pickup_enabled":true,"delivery_fee_lbp":0,"min_order_lbp":0,"note_ar":"","note_en":""}'),
  ('branding',  '{"primary_color":"#E3AE1F","logo_image_id":null}')
ON CONFLICT (key) DO NOTHING;
