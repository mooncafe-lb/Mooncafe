# Moon Cafe / مون كافيه

Ordering website for Moon Cafe (Lebanon): customer site (Arabic first, English), tray with fly-in animation,
checkout that sends a ready WhatsApp message, and an admin dashboard at `/admin`.

Stack: Node 20+, Express, PostgreSQL (Render). No build step. Start: `npm start` (`node server/index.js`).

## Render settings

| Setting | Value |
|---|---|
| Build command | `yarn` (or `npm install`) |
| Start command | `node server/index.js` (or `npm start`) |
| Environment | `DATABASE_URL`, `SESSION_SECRET` (32+ chars), `SETUP_TOKEN`, `NODE_ENV=production`, `MIGRATION_MODE=hold` |

`PORT` is provided by Render. Never commit a real `.env`.

## Database migrations (safe by default)

`MIGRATION_MODE` decides what happens at startup:

* `hold` (default): read-only check, pending migrations are **not** applied. The site still shows the built-in menu.
* `dry-run`: runs pending migrations inside a transaction and **rolls back**; read the result in the Render logs.
  (PostgreSQL sequence counters are not rolled back, so ids may skip numbers later. Harmless.)
* `apply`: applies pending migrations permanently. Use only after a clean dry-run, then set it back to `hold`.

Migrations: `001` base schema, `002` menu structure, `003` menu seed (34 products, Coffee unpriced),
`004` admin sessions, `005` staff accounts, order assignment and activity log. Never edit an applied migration:
add a new numbered file. All of 002-005 are additive (no DROP TABLE/COLUMN, no DELETE).

## First run

1. Set `SETUP_TOKEN` in Render, deploy, open `/admin`, create the admin (needs migrations applied).
2. Dashboard: set the opening hours (the cafe is CLOSED until hours or a manual override exist), set Coffee prices
   (products without a price show "Price coming soon" and cannot be ordered), upload product photos.

## Staff, roles and order tracking (dashboard at `/admin`)

| Role | Can do |
|---|---|
| Super Admin | everything: menu, settings, brand, WhatsApp, users (add/edit/disable/delete), orders |
| Manager | all orders (assign, release, update), staff dashboard, add/edit staff accounts. No menu, no site settings, no deleting users, cannot create managers |
| Staff | see orders, receive an order ("استلام الطلب"), update status **only of their own orders**, return their own order to the queue |

* Sign-in is by username or email. Every account has a real full name; that name is written on the order and in the
  log at the moment of each action (it stays readable even if the account is deleted later).
* Order stages: new, received, preparing, ready, out for delivery, delivered/done, cancelled.
* The order page shows "Responsible employee" and the full activity log (created, received by, assigned to,
  every status change with the person and the time). The Staff tab shows, per employee, current orders, orders handled,
  last activity and past orders.
* Permissions are checked on the server on every request (`server/lib/permissions.js`); the browser only hides buttons.
  The last active Super Admin cannot be disabled, demoted or deleted; nobody can disable or delete their own account.

## Rules enforced on the server

* Orders are rejected (HTTP 409) while the cafe is closed, WhatsApp ordering is off, or delivery/pickup is off.
* Prices are always recalculated from the database; products without a price cannot be ordered (HTTP 422).
* Admin: scrypt password hashing, hashed session tokens, HttpOnly + SameSite=Strict cookie, lockout after 5 wrong
  passwords, CSRF header check, rate limits on login/setup/orders.

## Tests

`npm test` (Node's built-in runner; `sharp` must be installed). The tests build a SQLite database from the real
migration files and run the real customer and admin code in a fake browser. They do not replace a check on the real
PostgreSQL database (use `MIGRATION_MODE=dry-run`) or a look on a real phone.
