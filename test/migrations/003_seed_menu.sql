-- 003_seed_menu.sql : initial menu. Source: the supplied Moon Cafe menu image.
-- All names are stored in the database and editable from the Admin Dashboard.
-- Runs ONLY if there are no categories and no products yet; otherwise it does nothing.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM categories) OR EXISTS (SELECT 1 FROM products) THEN
    RAISE NOTICE '[seed] menu data already exists, seed skipped';
    RETURN;
  END IF;

  INSERT INTO categories (name_ar, name_en, sort_order) VALUES
    ('القهوة',   'Coffee',    1),
    ('لاتيه',    'Latte',     2),
    ('ميلك شيك', 'Milkshake', 3),
    ('فرابيه',   'Frappe',    4),
    ('سموذي',    'Smoothie',  5);

  CREATE TEMP TABLE _seed (cat text, ord int, name text, med bigint, lrg bigint) ON COMMIT DROP;
  INSERT INTO _seed VALUES
    ('Coffee',1,'Espresso',NULL,NULL), ('Coffee',2,'Cappuccino',NULL,NULL), ('Coffee',3,'Americano',NULL,NULL),
    ('Coffee',4,'Mocha',NULL,NULL),    ('Coffee',5,'Hot Chocolate',NULL,NULL),
    ('Latte',1,'Latte',250000,350000), ('Latte',2,'Spanish',250000,350000), ('Latte',3,'Caramel Macchiato',250000,350000),
    ('Latte',4,'Moon Caramel',250000,350000), ('Latte',5,'Blue Vanilla',250000,350000),
    ('Latte',6,'White Berry',250000,350000), ('Latte',7,'Chocolate Passion',250000,350000),
    ('Milkshake',1,'Caramel',250000,350000), ('Milkshake',2,'Crunchy Lotus',250000,350000),
    ('Milkshake',3,'Double Chocolate',250000,350000), ('Milkshake',4,'Matcha',250000,350000),
    ('Milkshake',5,'Snickers',250000,350000), ('Milkshake',6,'Bounty',250000,350000),
    ('Milkshake',7,'Oreo',250000,350000), ('Milkshake',8,'Nutella',250000,350000),
    ('Milkshake',9,'Brownie',250000,350000), ('Milkshake',10,'Vanilla',250000,350000),
    ('Milkshake',11,'Strawberry',250000,350000),
    ('Frappe',1,'Caramel',250000,350000), ('Frappe',2,'Salted Caramel',250000,350000), ('Frappe',3,'Vanilla',250000,350000),
    ('Frappe',4,'Mocha',250000,350000),   ('Frappe',5,'Tiramisu',250000,350000),       ('Frappe',6,'Pistachio',250000,350000),
    ('Smoothie',1,'Mango',200000,300000), ('Smoothie',2,'Passion Mango',200000,300000), ('Smoothie',3,'Peach',200000,300000),
    ('Smoothie',4,'Mixed Berry',200000,300000), ('Smoothie',5,'Tropical Fruit',200000,300000);

  -- Arabic name starts as the same menu name (the printed menu is English); editable in the admin.
  INSERT INTO products (category_id, name_ar, name_en, price_lbp, sort_order)
  SELECT c.id, s.name, s.name, NULL::bigint, s.ord
  FROM _seed s JOIN categories c ON c.name_en = s.cat;

  -- Coffee: one size, price NOT set. Everything else: Medium + Large with menu prices.
  INSERT INTO product_sizes (product_id, name_ar, name_en, price_lbp, sort_order)
  SELECT p.id, 'عادي', 'Regular', NULL::bigint, 0
  FROM _seed s JOIN categories c ON c.name_en = s.cat
  JOIN products p ON p.category_id = c.id AND p.name_en = s.name
  WHERE s.cat = 'Coffee';

  INSERT INTO product_sizes (product_id, name_ar, name_en, price_lbp, sort_order)
  SELECT p.id, 'وسط', 'Medium', s.med, 0
  FROM _seed s JOIN categories c ON c.name_en = s.cat
  JOIN products p ON p.category_id = c.id AND p.name_en = s.name
  WHERE s.cat IS DISTINCT FROM 'Coffee'
  UNION ALL
  SELECT p.id, 'كبير', 'Large', s.lrg, 1
  FROM _seed s JOIN categories c ON c.name_en = s.cat
  JOIN products p ON p.category_id = c.id AND p.name_en = s.name
  WHERE s.cat IS DISTINCT FROM 'Coffee';

  -- Choices printed on the menu (all price difference 0: the menu lists none).
  CREATE TEMP TABLE _choices (cat text, prod text, grp_en text, grp_ar text, req boolean, gord int,
                              ch_en text, ch_ar text, cord int) ON COMMIT DROP;
  INSERT INTO _choices VALUES
    ('Coffee','Mocha','Type','النوع',true,1,'Dark','داكن',1),
    ('Coffee','Mocha','Type','النوع',true,1,'White','أبيض',2),
    ('Frappe','Mocha','Type','النوع',true,1,'Dark','داكن',1),
    ('Frappe','Mocha','Type','النوع',true,1,'White','أبيض',2),
    ('Coffee','Hot Chocolate','Flavor','النكهة',true,1,'Chocolate','شوكولا',1),
    ('Coffee','Hot Chocolate','Flavor','النكهة',true,1,'Blueberry','توت أزرق',2),
    ('Coffee','Hot Chocolate','Flavor','النكهة',true,1,'Strawberry','فراولة',3),
    ('Latte','Latte','Flavor','النكهة',false,2,'Caramel','كراميل',1),
    ('Latte','Latte','Flavor','النكهة',false,2,'Vanilla','فانيلا',2),
    ('Latte','Latte','Flavor','النكهة',false,2,'Hazelnut','بندق',3),
    ('Latte','Latte','Flavor','النكهة',false,2,'Mocha','موكا',4),
    ('Latte','Latte','Flavor','النكهة',false,2,'Tiramisu','تيراميسو',5),
    ('Milkshake','Matcha','Flavor','النكهة',false,1,'Passion Fruit','باشن فروت',1),
    ('Milkshake','Matcha','Flavor','النكهة',false,1,'Strawberry','فراولة',2),
    ('Milkshake','Matcha','Flavor','النكهة',false,1,'Mango','مانجو',3),
    ('Milkshake','Matcha','Flavor','النكهة',false,1,'Caramel','كراميل',4);

  -- The Latte section is "Hot, Iced": every latte gets a required Hot/Iced choice.
  INSERT INTO _choices
  SELECT 'Latte', p.name_en, 'Temperature', 'الحرارة', true, 1, t.en, t.ar, t.o
  FROM products p JOIN categories c ON c.id = p.category_id
  CROSS JOIN (VALUES ('Hot','ساخن',1), ('Iced','مثلج',2)) AS t(en, ar, o)
  WHERE c.name_en = 'Latte';

  INSERT INTO option_groups (product_id, name_ar, name_en, selection, is_required, sort_order)
  SELECT DISTINCT p.id, x.grp_ar, x.grp_en, 'single'::text, x.req, x.gord
  FROM _choices x JOIN categories c ON c.name_en = x.cat
  JOIN products p ON p.category_id = c.id AND p.name_en = x.prod;

  INSERT INTO option_choices (group_id, name_ar, name_en, sort_order)
  SELECT g.id, x.ch_ar, x.ch_en, x.cord
  FROM _choices x JOIN categories c ON c.name_en = x.cat
  JOIN products p ON p.category_id = c.id AND p.name_en = x.prod
  JOIN option_groups g ON g.product_id = p.id AND g.name_en = x.grp_en;

  -- ===========================================================================
  -- INTEGRITY CHECKS
  -- The lists below are typed separately from the seed lists above, straight from the
  -- printed menu, so a typo or drift in one copy is caught by the other. Every check raises
  -- an exception on mismatch. The migration runner then rolls back the WHOLE run
  -- (002, 003 and the migration record), so no partial menu can ever remain.
  -- ===========================================================================
  CREATE TEMP TABLE _expected (cat text, ord int, name text, med bigint, lrg bigint) ON COMMIT DROP;
  INSERT INTO _expected VALUES
    ('Coffee',1,'Espresso',NULL,NULL), ('Coffee',2,'Cappuccino',NULL,NULL), ('Coffee',3,'Americano',NULL,NULL),
    ('Coffee',4,'Mocha',NULL,NULL), ('Coffee',5,'Hot Chocolate',NULL,NULL),
    ('Latte',1,'Latte',250000,350000), ('Latte',2,'Spanish',250000,350000), ('Latte',3,'Caramel Macchiato',250000,350000),
    ('Latte',4,'Moon Caramel',250000,350000), ('Latte',5,'Blue Vanilla',250000,350000),
    ('Latte',6,'White Berry',250000,350000), ('Latte',7,'Chocolate Passion',250000,350000),
    ('Milkshake',1,'Caramel',250000,350000), ('Milkshake',2,'Crunchy Lotus',250000,350000),
    ('Milkshake',3,'Double Chocolate',250000,350000), ('Milkshake',4,'Matcha',250000,350000),
    ('Milkshake',5,'Snickers',250000,350000), ('Milkshake',6,'Bounty',250000,350000),
    ('Milkshake',7,'Oreo',250000,350000), ('Milkshake',8,'Nutella',250000,350000),
    ('Milkshake',9,'Brownie',250000,350000), ('Milkshake',10,'Vanilla',250000,350000),
    ('Milkshake',11,'Strawberry',250000,350000),
    ('Frappe',1,'Caramel',250000,350000), ('Frappe',2,'Salted Caramel',250000,350000),
    ('Frappe',3,'Vanilla',250000,350000), ('Frappe',4,'Mocha',250000,350000),
    ('Frappe',5,'Tiramisu',250000,350000), ('Frappe',6,'Pistachio',250000,350000),
    ('Smoothie',1,'Mango',200000,300000), ('Smoothie',2,'Passion Mango',200000,300000),
    ('Smoothie',3,'Peach',200000,300000), ('Smoothie',4,'Mixed Berry',200000,300000),
    ('Smoothie',5,'Tropical Fruit',200000,300000);

  -- One row per option group: choices (and their sort_order values) are '|'-separated in display order.
  CREATE TEMP TABLE _expected_options (cat text, prod text, grp text, grp_ar text, req boolean, sel text,
                                       gord int, en text, ar text, so text) ON COMMIT DROP;
  INSERT INTO _expected_options VALUES
    ('Coffee','Mocha','Type','النوع',true,'single',1,'Dark|White','داكن|أبيض','1|2'),
    ('Frappe','Mocha','Type','النوع',true,'single',1,'Dark|White','داكن|أبيض','1|2'),
    ('Coffee','Hot Chocolate','Flavor','النكهة',true,'single',1,'Chocolate|Blueberry|Strawberry','شوكولا|توت أزرق|فراولة','1|2|3'),
    ('Latte','Latte','Temperature','الحرارة',true,'single',1,'Hot|Iced','ساخن|مثلج','1|2'),
    ('Latte','Latte','Flavor','النكهة',false,'single',2,'Caramel|Vanilla|Hazelnut|Mocha|Tiramisu','كراميل|فانيلا|بندق|موكا|تيراميسو','1|2|3|4|5'),
    ('Latte','Spanish','Temperature','الحرارة',true,'single',1,'Hot|Iced','ساخن|مثلج','1|2'),
    ('Latte','Caramel Macchiato','Temperature','الحرارة',true,'single',1,'Hot|Iced','ساخن|مثلج','1|2'),
    ('Latte','Moon Caramel','Temperature','الحرارة',true,'single',1,'Hot|Iced','ساخن|مثلج','1|2'),
    ('Latte','Blue Vanilla','Temperature','الحرارة',true,'single',1,'Hot|Iced','ساخن|مثلج','1|2'),
    ('Latte','White Berry','Temperature','الحرارة',true,'single',1,'Hot|Iced','ساخن|مثلج','1|2'),
    ('Latte','Chocolate Passion','Temperature','الحرارة',true,'single',1,'Hot|Iced','ساخن|مثلج','1|2'),
    ('Milkshake','Matcha','Flavor','النكهة',false,'single',1,'Passion Fruit|Strawberry|Mango|Caramel','باشن فروت|فراولة|مانجو|كراميل','1|2|3|4');

  -- (0) The expected lists themselves must be complete.
  IF (SELECT count(*) FROM _expected) IS DISTINCT FROM 34 THEN
    RAISE EXCEPTION '[seed check] internal: the expected product list must have 34 rows';
  END IF;
  IF (SELECT count(*) FROM (SELECT DISTINCT cat, name FROM _expected) d) IS DISTINCT FROM 34 THEN
    RAISE EXCEPTION '[seed check] internal: the expected product list has duplicate rows';
  END IF;
  IF (SELECT count(*) FROM _expected_options) IS DISTINCT FROM 12 THEN
    RAISE EXCEPTION '[seed check] internal: the expected option group list must have 12 rows';
  END IF;

  -- NULL safety: every IF compares with IS DISTINCT FROM, and flags/text are tested with
  -- IS [NOT] DISTINCT FROM, so a NULL can never make a check silently pass.
  -- Note: matches are counted as DISTINCT expected rows, so one duplicated row can never
  -- "cover" for a missing one (the totals checked separately make the match one-to-one).

  -- (1) Categories: exactly these 5, names (Arabic and English), order, visible.
  IF (SELECT count(*) FROM categories) IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION '[seed check] expected exactly 5 categories';
  END IF;
  IF (SELECT count(DISTINCT want.en) FROM categories c
      JOIN (VALUES ('Coffee','القهوة',1), ('Latte','لاتيه',2), ('Milkshake','ميلك شيك',3),
                   ('Frappe','فرابيه',4), ('Smoothie','سموذي',5)) AS want(en, ar, ord)
        ON want.en = c.name_en AND want.ar = c.name_ar AND want.ord = c.sort_order
      WHERE c.is_visible IS NOT DISTINCT FROM TRUE AND c.image_id IS NULL) IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION '[seed check] category names, order or visibility are wrong';
  END IF;

  -- (2) Products: the 34 names must match the menu exactly, per category and in order.
  --     Missing, extra, renamed, duplicated or moved-to-another-category products all fail here.
  IF (SELECT count(*) FROM products) IS DISTINCT FROM 34 THEN
    RAISE EXCEPTION '[seed check] expected exactly 34 products';
  END IF;
  IF (SELECT count(DISTINCT e.cat || '|' || e.name) FROM products p
      JOIN categories c ON c.id = p.category_id
      JOIN _expected e ON e.cat = c.name_en AND e.ord = p.sort_order AND e.name = p.name_en
      WHERE p.name_ar IS NOT DISTINCT FROM e.name) IS DISTINCT FROM 34 THEN
    RAISE EXCEPTION '[seed check] product names do not match the menu (missing, extra, renamed or misplaced)';
  END IF;
  IF (SELECT count(*) FROM (
        SELECT c.name_en AS cat, count(*) AS n
        FROM products p JOIN categories c ON c.id = p.category_id GROUP BY c.name_en) a
      JOIN (VALUES ('Coffee',5), ('Latte',7), ('Milkshake',11), ('Frappe',6), ('Smoothie',5)) AS want(cat, n)
        ON want.cat = a.cat AND want.n = a.n) IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION '[seed check] product counts per category are wrong';
  END IF;
  IF (SELECT count(*) FROM products
      WHERE price_lbp IS NOT NULL
         OR description_ar IS DISTINCT FROM '' OR description_en IS DISTINCT FROM ''
         OR image_id IS NOT NULL
         OR is_available IS DISTINCT FROM TRUE
         OR is_visible IS DISTINCT FROM TRUE
         OR is_sample IS DISTINCT FROM FALSE) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '[seed check] products must start with no legacy price, no description, no image, available and visible';
  END IF;

  -- (3) + (4) Sizes and prices, checked product by product.
  --     Each product's full size list is built as one string and compared with what the menu allows:
  --       Coffee   -> exactly one size: Regular, price NULL, sort_order 0
  --       others   -> exactly two sizes: Medium (sort_order 0) then Large (sort_order 1),
  --                   with that product's own prices
  --     The actual sort_order values are part of the compared text (NULL shows up as 'NULL').
  --     A missing, duplicated, extra, misnamed or mispriced size makes the string differ.
  IF (SELECT count(*) FROM product_sizes) IS DISTINCT FROM 63 THEN
    RAISE EXCEPTION '[seed check] expected exactly 63 sizes (5 Regular + 29 products x Medium and Large)';
  END IF;
  IF (SELECT count(*) FROM product_sizes WHERE is_available IS DISTINCT FROM TRUE) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '[seed check] all seeded sizes must be available';
  END IF;
  IF (SELECT count(DISTINCT e.cat || '|' || e.name) FROM (
        SELECT c.name_en AS cat, p.name_en AS prod, p.sort_order AS ord,
               string_agg(coalesce(s.name_en, '<NULL>') || '/' || coalesce(s.name_ar, '<NULL>')
                          || ':' || coalesce(s.price_lbp::text, 'NULL')
                          || '@' || coalesce(s.sort_order::text, 'NULL'),
                          ',' ORDER BY s.sort_order, s.id) AS sizes
        FROM products p
        JOIN categories c ON c.id = p.category_id
        JOIN product_sizes s ON s.product_id = p.id
        GROUP BY c.name_en, p.name_en, p.id, p.sort_order) a
      JOIN _expected e ON e.cat = a.cat AND e.name = a.prod AND e.ord = a.ord
       AND a.sizes IS NOT DISTINCT FROM CASE WHEN e.cat = 'Coffee'
                          THEN 'Regular/عادي:NULL@0'
                          ELSE 'Medium/وسط:' || e.med || '@0,Large/كبير:' || e.lrg || '@1' END) IS DISTINCT FROM 34 THEN
    RAISE EXCEPTION '[seed check] a product has a missing, duplicated, extra or wrongly priced size';
  END IF;

  -- (5) Option groups and choices: exactly the 12 expected groups and 30 choices, nothing else.
  IF (SELECT count(*) FROM option_groups) IS DISTINCT FROM 12 THEN
    RAISE EXCEPTION '[seed check] expected exactly 12 option groups';
  END IF;
  IF (SELECT count(*) FROM option_choices) IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION '[seed check] expected exactly 30 option choices';
  END IF;
  IF (SELECT count(*) FROM option_choices
      WHERE price_delta_lbp IS DISTINCT FROM 0 OR is_available IS DISTINCT FROM TRUE) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '[seed check] seeded choices must have no extra charge and be available';
  END IF;
  -- Every group is compared on product, category, names (Arabic and English), required flag,
  -- selection type, position, its ordered list of choices (English and Arabic) AND the exact
  -- sort_order value of every choice (1|2|3...): no duplicates, gaps, extras or NULLs.
  IF (SELECT count(DISTINCT w.cat || '|' || w.prod || '|' || w.grp) FROM (
        SELECT c.name_en AS cat, p.name_en AS prod, g.name_en AS grp, g.name_ar AS grp_ar,
               g.is_required AS req, g.selection AS sel, g.sort_order AS gord,
               string_agg(coalesce(ch.name_en, '<NULL>'), '|' ORDER BY ch.sort_order, ch.id) AS en,
               string_agg(coalesce(ch.name_ar, '<NULL>'), '|' ORDER BY ch.sort_order, ch.id) AS ar,
               string_agg(coalesce(ch.sort_order::text, 'NULL'), '|' ORDER BY ch.sort_order, ch.id) AS so
        FROM option_groups g
        JOIN products p ON p.id = g.product_id
        JOIN categories c ON c.id = p.category_id
        JOIN option_choices ch ON ch.group_id = g.id
        GROUP BY c.name_en, p.name_en, g.id, g.name_en, g.name_ar, g.is_required, g.selection, g.sort_order) a
      JOIN _expected_options w
        ON w.cat = a.cat AND w.prod = a.prod AND w.grp = a.grp
       AND w.grp_ar IS NOT DISTINCT FROM a.grp_ar AND w.req IS NOT DISTINCT FROM a.req
       AND w.sel IS NOT DISTINCT FROM a.sel AND w.gord IS NOT DISTINCT FROM a.gord
       AND w.en IS NOT DISTINCT FROM a.en AND w.ar IS NOT DISTINCT FROM a.ar
       AND w.so IS NOT DISTINCT FROM a.so) IS DISTINCT FROM 12 THEN
    RAISE EXCEPTION '[seed check] an option group or choice is missing, extra, misnamed or linked to the wrong product';
  END IF;
  -- Explicit guarantee for the Latte section: all 7 have a required Hot/Iced group.
  IF (SELECT count(DISTINCT p.id) FROM products p JOIN categories c ON c.id = p.category_id
      JOIN option_groups g ON g.product_id = p.id AND g.name_en = 'Temperature'
                          AND g.is_required IS NOT DISTINCT FROM TRUE
      WHERE c.name_en = 'Latte') IS DISTINCT FROM 7 THEN
    RAISE EXCEPTION '[seed check] every Latte product needs a required Hot/Iced choice';
  END IF;
END $$;
