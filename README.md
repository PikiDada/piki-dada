# Piki Dada — rides and deliveries in Kampala

Boda, Economy and Comfort rides plus parcel delivery, with passenger, rider and admin apps in one website.

## Stack

| Layer | Tech |
|---|---|
| Web | Next.js 16 (App Router, static export), React 19, Tailwind, Zustand. One app with `/passenger`, `/driver` and `/admin` sections |
| API | NestJS 11, Socket.IO gateway for live trip and delivery tracking |
| Database | PostgreSQL via Prisma 6 (Supabase today, our own Postgres on Hetzner after the move) |
| Maps platform | Go service in `services/maps`, with OSRM and its own address gazetteer. Learns road speeds from completed trips. See [services/maps/README.md](services/maps/README.md) |
| Routing for fares | Google Routes first, then the maps platform, then straight line × an admin-set factor |
| Auth | JWT access token + rotating refresh cookie, Google OAuth |
| Payments | Cash, Stripe, Flutterwave, rider wallet ledger |
| Notifications | In-app feed, web push, FCM. Email over SMTP (SendGrid as fallback) |
| File storage | The server's disk on Hetzner (a Docker volume served as files.pikidada.com, backed up nightly); Supabase Storage until the move |

## Docs

- [docs/pricing-stops-coupons.md](docs/pricing-stops-coupons.md): how fares, stops, waiting fees, coupons and rider earnings work, and what the admin can change
- [docs/api-reference.md](docs/api-reference.md): every API route, who can call it, and the live-update events
- [deploy/README.md](deploy/README.md): moving to Hetzner, plus the Cloudflare DNS and Gmail email steps
- [services/maps/README.md](services/maps/README.md): the maps platform and its learning loop
- [SOCKET_IO_TESTING.md](SOCKET_IO_TESTING.md): testing the live-update connection by hand

## Repo layout

```
apps/api        NestJS API (Prisma schema and migrations in apps/api/prisma)
apps/web        Next.js website
services/maps   Go maps platform
deploy          Hetzner setup: Caddy, OSRM, backups
scripts         One-off scripts (backups, moving stored files)
tests           Playwright end-to-end tests
```

## Local development

```bash
pnpm install

# apps/api/.env — copy from .env.example and fill in real values
pnpm --filter api exec prisma migrate dev
pnpm --filter api exec prisma db seed
pnpm dev:api      # NestJS on PORT from .env (4000 if unset)

# apps/web/.env.local — copy from .env.example
pnpm dev:web      # Next.js on :3000
```

The seed creates pricing rules for BODA, ECONOMY and COMFORT and a `WELCOME10` coupon. Register through `/register` to make a passenger or rider account. To make an admin, promote an existing user from `/admin/users`, or for the very first admin, set the role in Prisma Studio.

Checks that CI runs on every push (`.github/workflows/ci.yml`):

```bash
pnpm --filter api exec eslint "{src,apps,libs,test}/**/*.ts" && pnpm --filter api test && pnpm --filter api build
pnpm --filter web lint && pnpm --filter web exec tsc --noEmit && pnpm --filter web build
cd services/maps && gofmt -l . && go vet ./... && go test ./...
```

## Hosting

**Today:** the website is on Vercel (`www.pikidada.com`), the API on Render (`api.pikidada.com`), and the database and file storage on Supabase.

**Planned:** everything on one Hetzner server with docker-compose and Caddy, following [deploy/README.md](deploy/README.md). After that move, Supabase, Render, Vercel and Cloudinary are no longer needed.

### Keeping the Render API warm

Render's free tier sleeps the service after 15 minutes idle. Until the Hetzner move, two pingers hit `GET /health`:

1. **Supabase `pg_cron` (primary).** A job named `keep-api-warm` runs every 5 minutes inside the production database:
   ```sql
   SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'keep-api-warm';
   SELECT status, start_time FROM cron.job_run_details ORDER BY start_time DESC LIMIT 5;
   SELECT cron.unschedule('keep-api-warm');  -- to remove
   ```
2. **GitHub Actions (`.github/workflows/keep-alive.yml`, backup).** Pings every 10 minutes, but GitHub sometimes delays scheduled runs by hours.

If the API address changes, update **both**. A stale address fails silently.

## Not built yet

- Apple Sign-In, phone OTP, and direct MTN/Airtel mobile money (Flutterwave covers mobile money for now)
- Fleet owner and dispatcher portals, scheduled rides, bidding, loyalty and referrals, SOS
