# Stationery Hub

Simple stationery e-commerce demo inspired by Amazon/Flipkart. Frontend is plain HTML/CSS/JS served by a Node.js + Express API with a SQLite-backed product/catalogue database. Prices display in INR.

## Features

- Marketplace-style storefront with hero promos, category pills, curated bundles, testimonials, FAQs, and CTA sections.
- Real login/register flows backed by the Express API with in-memory users + sessions.
 - Cart drawer with quantity management, checkout form, and minimum 2-unit bulk enforcement.
- Guest cart mode so visitors can add items before logging in; contents sync automatically after authentication.
- My Orders modal, public order tracking widget, bulk quote request form, and newsletter capture.
- Responsive design (General Sans/Space Grotesk) with smooth scrolling, badges, and toast notifications.

## Requirements

- Node.js 18+

## Setup

```bash
npm install
```

## Run in dev mode

```bash
npm run dev
```

Server runs at [http://localhost:3000](http://localhost:3000) and serves the frontend from `/public`.

## Supplier console

- Supplier pages: `/supplier.html`, `/supplier-products.html`, `/supplier-orders.html`, `/supplier-csv.html`
- Configure supplier access in `.env` using `SUPPLIER_EMAIL` and `SUPPLIER_PASSWORD`.
- Supplier login is rate-limited (10 attempts / 10 minutes per IP).

## Reports & exports

- Products CSV export on the Products page.
- Orders CSV export and queue CSV export on the Orders page.
- Analytics CSV export + server-side scheduled email (SMTP required) on the Overview page.

## Build/Start

```bash
npm start
```

## Tests

```bash
npm test
```

## Admin schedules page

- Visit `/admin-schedules.html` and login with an admin user.
- Admin users have `role = admin` in the `users` table.
- The page manages SMTP export schedules for analytics reports.

## Production hosting checklist

- Set environment variables on your server:
  - `NODE_ENV=production`
  - `PORT` (optional, defaults to `3000`)
  - `JWT_SECRET` (required in production; use a long, random string)
  - `CORS_ORIGIN` (optional; e.g. `https://your-domain.com` to lock CORS to your site)
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (required for scheduled exports)
  - `SMTP_SECURE` (optional, `true`/`false`, defaults to `false`)
  - `SMTP_FROM` (optional, defaults to `SMTP_USER`)

- Install dependencies in production:
  - `npm install --production`

- Start the app:
  - `npm start`

- Ensure the `server/db` folder is writable; the SQLite file `stationery.db` is stored there.

## API

- `GET /api/products?q=` – list products with optional search
- `GET /api/products/:id` – fetch single product
- `GET /api/cart` – current cart
- `POST /api/cart` – add item `{ productId, quantity }`
- `PUT /api/cart/:productId` – set quantity (0 removes)
- `DELETE /api/cart/:productId` – remove item
 - `POST /api/orders` – place bulk order from current cart (min 2 units required)
- `GET /api/orders/:id` – track an order by ID
- `POST /api/auth/register` – create user & auto-login
- `POST /api/auth/login` – authenticate user and receive session id
- `POST /api/auth/logout` – invalidate current session
- `GET /api/auth/me` – fetch the logged in user
- `GET /api/user/orders` – view authenticated user's order history

Data and cart are in-memory; restart clears cart and orders.
