# Piki Dada — Ride-Hailing Platform (MVP)

A ride-hailing platform for Uganda (Boda/Economy/Comfort rides), built as a free-tier-first MVP. See `prisma/schema.prisma` for the data model and the codebase structure below.

## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 14 (App Router), Tailwind, one app with `/passenger`, `/driver`, `/admin` route groups |
| Backend | NestJS, Socket.IO gateway for realtime trip tracking |
| Database | PostgreSQL (Neon) via Prisma |
| Auth | JWT + refresh tokens, Google OAuth |
| Payments | Stripe + Flutterwave (sandbox), cash, wallet ledger |
| Notifications | In-app feed, FCM push (backend-ready), Resend email |
| Storage | Cloudinary (driver documents, vehicle photos) |

## Local development

```bash
pnpm install

# apps/api/.env — copy from .env.example and fill in real values
pnpm --filter api exec prisma migrate dev
pnpm --filter api exec prisma db seed
pnpm dev:api      # NestJS on :4001

# apps/web/.env.local — copy from .env.example
pnpm dev:web      # Next.js on :3000
```

Default seed data: pricing rules for BODA/ECONOMY/COMFORT and a `WELCOME10` coupon. Register a user via `/register` to create your first passenger/driver account; the first `ADMIN` role user must currently be created the same way (no separate admin invite flow in this MVP — register with role `ADMIN` directly, or update a user's role via Prisma Studio).

## Required external accounts (all free tier)

| Service | Used for | Where to get it |
|---|---|---|
| Neon | Postgres database | neon.tech |
| Google Cloud | Maps JS SDK, Places, Distance Matrix, OAuth | console.cloud.google.com (requires billing card on file, stays in free credit) |
| Cloudinary | Driver document/photo storage | cloudinary.com |
| Stripe | Card payments (test mode) | dashboard.stripe.com |
| Flutterwave | Mobile money payments (test mode) | dashboard.flutterwave.com |
| Resend | Transactional email | resend.com |
| Firebase | Push notifications (FCM) | console.firebase.google.com — generate a service account JSON under Project Settings → Service Accounts |
| Render | API hosting | render.com |
| Vercel | Frontend hosting | vercel.com |

All of these have placeholder values wired into `apps/api/.env` right now — the app boots and runs fully on cash payments without any of them, and degrades gracefully (logs a warning, skips the feature) if Stripe/Firebase keys are missing or invalid.

## Deployment checklist

1. **Push to GitHub** — create a new repo and push this project (`git init`, `git add -A`, `git commit`, then push to a new GitHub repo).
2. **Neon** — if not already using the dev database, create a production Neon project and grab its connection string.
3. **Render (API)**
   - New → Web Service → connect the GitHub repo
   - Render will detect `render.yaml` at the repo root — review the blueprint and click Apply
   - Fill in the env vars marked `sync: false` in `render.yaml` (DATABASE_URL, Cloudinary/Stripe/Flutterwave/Resend/Firebase keys, CORS_ORIGIN = your Vercel URL once known)
   - First deploy runs `prisma migrate deploy` automatically (baked into the Docker `CMD`)
4. **Vercel (Web)**
   - New Project → import the same GitHub repo
   - Set **Root Directory** to `apps/web`
   - Add env vars: `NEXT_PUBLIC_API_URL` (your Render service URL), `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`
5. **Update CORS** — once you know the Vercel URL, set `CORS_ORIGIN` on Render to match (and `GOOGLE_CALLBACK_URL` if using Google login)
6. **DNS** — point `app.<yourdomain>` (CNAME) to Vercel and `api.<yourdomain>` (CNAME) to Render once you're ready to move off the default `*.vercel.app` / `*.onrender.com` URLs. No cPanel changes needed — cPanel hosting can't run this stack (see prior conversation notes on shared hosting limits).
7. **Seed production data** — run `pnpm --filter api exec prisma db seed` once against the production `DATABASE_URL` (e.g. from your local machine with the prod connection string temporarily in `.env`, or via Render's shell).

## Keeping the API warm

Render's free tier sleeps the service after 15 minutes idle, making the next request take 15s+.
Two independent pingers hit `GET /health` to prevent this:

1. **Supabase `pg_cron` (primary)** — a job named `keep-api-warm` runs every 5 minutes directly in
   the production Postgres instance, using `pg_net` to call the health endpoint. This is the reliable
   one: it fires on schedule with no external service or account needed.

   Inspect or change it with SQL against the production DB:
   ```sql
   SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'keep-api-warm';
   SELECT status, start_time FROM cron.job_run_details ORDER BY start_time DESC LIMIT 5;
   SELECT cron.unschedule('keep-api-warm');  -- to remove
   ```

2. **GitHub Actions (`.github/workflows/keep-alive.yml`, backup)** — same ping every 10 minutes.
   Treat this as best-effort only: GitHub delays scheduled workflows under load, sometimes by hours.

If the API URL ever changes, **both** pingers must be updated — a stale hostname here fails silently.

## Known MVP limitations (documented, not bugs)

- Apple Sign-In, Phone OTP, MTN/Airtel direct integration: deferred (cost money to set up — see auth/payments decisions made during build)
- No Fleet Owner / Dispatcher portals, AI matching, bidding pricing, scheduled/multi-stop rides, loyalty/referrals, SOS — all explicitly out of scope for this MVP pass
- Render free tier cold-starts after 15 min idle — mitigated by the keep-warm pingers above, but a cold start is still possible if both pingers fail
