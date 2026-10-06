# Deploying Piki Dada on Hetzner

Everything that can be prepared from inside this repo is done: `docker-compose.yml`,
`Caddyfile`, `.env.example` (root, for Compose) and `apps/api/.env.example` (for the API).
The steps below need your Hetzner account, your domain's DNS, and hands-on-the-server
access — none of that is something that can be done from here. Full context and rationale
for each decision is in the approved migration plan; this is the condensed checklist.

## Phase 0 — Provision & prep

1. **Create the server**: Hetzner Cloud → new server, ~2 vCPU / 4GB RAM, Ubuntu 24.04 LTS,
   in a region close to your users if offered (otherwise any EU region is fine).
2. **Install Docker**: `curl -fsSL https://get.docker.com | sh` (includes the `docker compose`
   plugin on modern Ubuntu).
3. **Clone the repo onto the server** (e.g. to `/opt/pikidada`), then:
   ```sh
   cp .env.example .env                     # fill in POSTGRES_*, MINIO_*, MAPS_PLATFORM_TOKEN, NEXT_PUBLIC_*
   cp apps/api/.env.example apps/api/.env    # fill in every secret/key it lists
   ```
4. **Email is Amazon SES, not self-hosted** — do this independently of the server/DNS steps
   below, since SES doesn't care which host your API runs on: verify `pikidada.com` in the SES
   console (it gives you exact SPF/DKIM records — confirm they show "verified" there, don't
   just assume), request production access, create SMTP credentials, fill in `SMTP_*` in
   `apps/api/.env`. See that file's comments for the full rundown.
5. **OSRM (self-hosted routing, optional but recommended)**: run the one-time data-prep
   commands in `docker-compose.yml`'s comment on the `osrm` service. Nothing else to set:
   the maps service talks to it, and the API talks to the maps service. Not required for
   Phase 1/2 below — pricing falls back to Google Routes (or a straight-line estimate)
   automatically until it's up, so it's fine to do this after cutover once the site is stable.
6. **Maps platform** (`services/maps`, Go): needs only `MAPS_PLATFORM_TOKEN` in the root
   `.env` (any long random string: `openssl rand -hex 32`). It creates its own `maps`
   database on first start and starts learning from the first trip. See
   `services/maps/README.md` for how it works.

## Phase 1 — Dry run (still no impact on the live site)

1. `docker compose up -d postgres minio` (bring up just the stateful services first).
2. Restore a copy of production data to test against (never point this at the live Supabase
   instance in this phase):
   ```sh
   pg_dump "$SUPABASE_DATABASE_URL" | docker compose exec -T postgres psql -U "$POSTGRES_USER" "$POSTGRES_DB"
   ```
3. `docker compose up -d --build` (build and start `api`, `maps` and `caddy` too; the website
   is built into the Caddy image as static files, so there's no separate web container).
4. `docker compose exec api npx prisma migrate deploy` if migrations haven't run yet.
5. Smoke test for real: register a fresh account, confirm the verification email actually
   arrives (check spam), log in, take a test trip end-to-end, log into `/admin`.

## Phase 2 — Cutover (the maintenance window)

Pick a low-traffic time (late night, Kampala time).

1. Take a final `pg_dump` from Supabase and restore it the same way as step 3 above, so the
   new database has everything up to the moment of cutover.
2. Re-point DNS:
   - `api.pikidada.com` → the Hetzner server's IP (was the Render/Cloudflare CNAME)
   - `pikidada.com` and `www.pikidada.com` → the Hetzner server's IP (was Vercel)
   - `files.pikidada.com` → the Hetzner server's IP (new record, for MinIO document previews)
3. Wait for DNS to propagate, then confirm Caddy issued certificates for all four hostnames:
   `docker compose logs caddy | grep -i certificate`
4. Re-run the same smoke test as Phase 1, against the real domain this time.

## Phase 3 — Decommission (after a few stable days)

- Cancel the Render service, remove the Vercel project.
- Let the SendGrid trial lapse (no action needed) or delete the account.
- Remove `.github/workflows/keep-alive.yml` — no longer relevant once off Render.
- Keep the Supabase project paused (not deleted) for a short rollback window before deleting
  it for good.
- Leave Cloudinary as-is — old driver-document links keep resolving from its free tier at no
  ongoing cost; nothing new writes there after the MinIO switch.

## Ongoing

- Add `deploy/pg-backup.sh` to root's crontab (see the comment at the top of that file for
  the exact line) — self-hosted Postgres has no automatic backups the way Supabase did.
- `docker compose logs -f` / `docker compose ps` are your new Render dashboard.
- **Memory**: each service has a `mem_limit` in `docker-compose.yml`, sized for a 4 GB
  server (about 2.9 GB in total). After a week of real traffic, check actual usage with
  `docker stats --no-stream` and adjust; OSRM's figure is the least certain until measured.
  If everything sits well under its limit, a smaller server may be enough.
- **Is the maps platform learning?**
  `docker compose exec api node -e "fetch('http://maps:8080/v1/stats',{headers:{Authorization:'Bearer '+process.env.MAPS_PLATFORM_TOKEN}}).then(r=>r.json()).then(console.log)"`
  shows journeys learned, road segments with observed speeds, and how many of those OSRM
  now routes with. The OSRM container applies newly learned speeds every night at 03:00
  Kampala time (`docker compose logs osrm`).
- `ufw allow 80,443,22/tcp && ufw enable` (or equivalent) so nothing but SSH and the reverse
  proxy is reachable from the internet.
