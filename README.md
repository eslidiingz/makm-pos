# MAKM POS

Mobile-first POS for a mala shop, built with Next.js 16, Elysia 2, Supabase, and Vercel.

## Start locally

1. Copy `.env.example` to `.env.local` and fill in the Supabase values. Generate `AUTH_COOKIE_SECRET` with `openssl rand -base64 32`.
2. Run `pnpm install`.
3. In Supabase SQL Editor, run `supabase/schema.sql`.
4. Configure Supabase Auth as described below.
5. Run `pnpm dev` and open `http://localhost:3100`.

## Platform Owner authentication

The v1 login flow presents a Thai mobile number and password. Elysia validates the configured owner phone and maps it to a server-only internal email, while Supabase Auth uses Email/Password underneath. This means the Phone provider, Twilio, and SMS are not required. Tokens are stored only in HttpOnly, SameSite=Strict cookies and the application enforces a 24-hour absolute session lifetime.

In **Supabase Dashboard → Authentication → Sign In / Providers**:

- Disable new user signups and anonymous sign-ins.
- Keep the Email provider enabled. The Phone provider may remain disabled.
- Set the minimum password length to 8.

Add `PLATFORM_OWNER_PHONE`, `PLATFORM_OWNER_AUTH_EMAIL`, and a random `PLATFORM_OWNER_TEMP_PASSWORD` of at least 16 characters to `.env.local`, then run:

```bash
pnpm auth:bootstrap-owner
```

The command is idempotent: if the phone already exists, it does not change its password or role. After a successful bootstrap, delete `PLATFORM_OWNER_TEMP_PASSWORD` from `.env.local`. The owner must change the temporary password on first login.

For an owner created before the internal-email login was introduced, run this once. It only adds and confirms the internal email; it does not change the password, role, or first-login state:

```bash
pnpm auth:migrate-owner-email
```

Routes:

- `/login` — Platform Owner login.
- `/change-password` — mandatory first-login password change.
- `/` — protected Owner dashboard.
- `/products` — category, menu, availability, ordering, and image management.
- `/pos` — protected order-entry screen.
- `/reports` — protected daily sales summary, profit summary, order history, and the monthly profit breakdown in Asia/Bangkok time.
- `/costs` — ingredients, purchase lots, per-menu recipes, and cost/profit per skewer.

## Checkout and daily sales

Checkout opens a final order summary before saving. The server validates the current catalog and prices, then writes the paid order and its item snapshots atomically through a service-role-only PostgreSQL RPC. A client request UUID makes retries and double-clicks idempotent. Successful sales appear in `/reports`, grouped by the selected Bangkok calendar date.

Existing Supabase projects should apply the numbered SQL files in `supabase/migrations/` in order. New local projects can use `supabase/schema.sql` as the current schema reference.

## Cost and profit

`/costs` answers the question the shop actually asks: *I bought 1 kg of pork belly for ฿180 and it
makes 20 skewers — what does one skewer cost me, and what do I earn on it?*

- **วัตถุดิบ** — each ingredient carries one unit. Its cost per unit is the weighted average across
  every purchase lot: `sum(total_cost) / sum(quantity)`. Until the first lot exists it is unknown, and
  the app shows `—` rather than ฿0 so a missing cost can never read as a free one.
- **การซื้อ** — a purchase lot is a date, a quantity and what was paid. The unit is stamped from the
  ingredient by a database trigger, and an ingredient's unit is locked once it has a lot: mixing a
  1 kg lot with a 1,000 g lot would skew the average by 1,000× with no error.
- **สูตรและกำไร** — a recipe line stores what the owner typed as an exact ratio, `batch_quantity`
  yielding `batch_yield` skewers. "1 กก. ทำได้ 20 ไม้" is 1/20 and "ใช้ 0.05 กก. ต่อไม้" is 0.05/1, so a
  yield of 3 stays exact instead of being rounded to 0.333333. A menu's cost per skewer is the sum of
  its lines, and is unknown unless every ingredient in the recipe has a lot.

Cost of goods sold is computed **at read time** from the current average, not snapshotted when the
sale happens. The shop logs its purchases in the evening, after that day's sales, so a sale-time
snapshot would freeze a cost that predates the very purchase meant to account for it. The trade-off
is deliberate: entering a purchase restates the profit of the periods that sold that ingredient.

`/reports` shows two different measurements side by side, and they must not be added together:

- **กำไรขั้นต้น** — revenue minus the cost of the skewers actually sold in the period.
- **กระแสเงินสด** — revenue minus what was spent on ingredients in the period. A month with a bulk
  purchase legitimately shows a low cash figure alongside a healthy gross figure.

Where some sold items have no computable cost, every surface reports how many skewers and how much
revenue are affected, because an unpriced menu would otherwise show a flattering near-100% margin.

Apply `supabase/migrations/202609020012_add_costing_schema.sql` before using the page. Its three
tables, two triggers and eight service-role RPCs are also in `supabase/schema.sql`.

## Product images on Cloudflare R2

Product images are cropped in the browser, converted to a square WebP, and uploaded directly to R2 through a five-minute presigned URL. Elysia validates and moves the pending object before attaching it to a product. Product/category management still works when R2 is not configured; only image upload is disabled.

1. In R2, use the existing `makm` bucket and connect a production custom domain.
2. Create an Object Read & Write API token scoped only to `makm`.
3. Add the five `R2_*` values from `.env.example` to `.env.local` and Vercel. `.env.local`
   already carries the block commented out; uncomment it once the values exist. A partially
   filled config counts as unconfigured, so fill all five or leave all five unset.

   `R2_PUBLIC_BASE_URL` is the exact prefix that serves objects over HTTP, and product image
   URLs are built as `<base-url>/<object-key>`:

   - It must include the scheme. `cdn.example.com` is resolved as a relative path by the
     browser, so a filled-in config with a schemeless value fails the boot instead of
     rendering broken image links.
   - A custom domain bound to this one bucket serves keys from its root:
     `https://cdn.example.com`.
   - A domain that fronts several buckets needs the bucket path segment as well:
     `https://cdn.example.com/makm`.

   Confirm the prefix before trusting it — the object exists in the bucket either way, so a
   wrong prefix only shows up as a broken image:

   ```bash
   curl -I https://cdn.example.com/makm/catalog/products/<product-id>/<file>.webp
   ```

4. Add this bucket CORS policy, replacing the production origin:

```json
[
  {
    "AllowedOrigins": ["http://localhost:3100", "http://192.168.1.41:3100", "https://your-production-origin.example"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

5. Add an R2 lifecycle rule that deletes objects under `catalog/pending/` after one day. Keep the `r2.dev` development URL disabled in production.

## Architecture

- `src/app`: Next.js UI and the `/api/*` route handler.
- `src/server/app.ts`: Elysia API, authentication/authorization guards, and protected endpoints. Exporting `App` lets Eden infer the API contract.
- `src/lib/eden.ts`: typed HTTP client, e.g. `api.orders.post(...)`.
- `src/lib/api-client.ts`: authenticated JSON requests with one automatic session-refresh retry.
- `src/server/orders`: order repository, Supabase RPC mapping, validation, and daily-report queries.
- `src/server/costing`: ingredient, purchase-lot and recipe repository, plus the profit report queries. Every cost, average and margin is computed in SQL numeric; TypeScript only coerces and formats, so a rounding rule cannot fork between the database and the API.
- `src/server/supabase.ts`: server-only Supabase publishable and admin clients.
- `src/proxy.ts`: optimistic cookie redirect only; authorization is enforced again by Elysia.

## Verification

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

## Preview presets

`preview-presets.json` records the viewport baselines used for POS design reviews:

- `ipad-pos-landscape`: 1024 × 768
- `ipad-pos-portrait`: 768 × 1024

## Deployment

Import the repository into Vercel, configure the environment variables from `.env.example`, and deploy. Vercel builds the Next app while Elysia runs inside its route handler.

Elysia 2 is currently beta, so versions are intentionally pinned instead of using a broad `^2` range. Upgrade deliberately after reviewing Elysia's migration notes.
