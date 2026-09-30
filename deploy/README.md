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
3. **Set rDNS/PTR**: Hetzner Cloud console → your server → Networking → the IPv4 address →
   set reverse DNS to `mail.pikidada.com`. This must match `POSTFIX_myhostname` in
   `docker-compose.yml` — mismatched rDNS is one of the most common reasons self-hosted mail
   gets rejected outright.
4. **Confirm outbound port 25 isn't blocked**: most providers don't block it, but Hetzner
   occasionally does for brand-new accounts as an anti-abuse measure — if so, open a support
   ticket asking them to unblock it for your project before relying on mail delivery.
5. **Clone the repo onto the server** (e.g. to `/opt/pikidada`), then:
   ```sh
   cp .env.example .env                     # fill in POSTGRES_*, MINIO_*, NEXT_PUBLIC_*
   cp apps/api/.env.example apps/api/.env    # fill in every secret/key it lists
   ```
6. **DNS records to add now** (safe before cutover — doesn't affect the current live site):
   - SPF: TXT on `pikidada.com` → `v=spf1 mx a:mail.pikidada.com -all`
   - DMARC: TXT on `_dmarc.pikidada.com` → `v=DMARC1; p=quarantine; rua=mailto:you@pikidada.com`
   - DKIM: can't be added until the `postfix` container has started once and generated a
     key — see step 2 under Phase 1.

## Phase 1 — Dry run (still no impact on the live site)

1. `docker compose up -d postgres minio postfix` (bring up just the stateful/mail services
   first).
2. Read the generated DKIM key and add it to DNS:
   ```sh
   docker compose exec postfix cat /etc/opendkim/keys/pikidada.com/mail.txt
   ```
   Add its contents as a TXT record on `mail._domainkey.pikidada.com`.
3. Restore a copy of production data to test against (never point this at the live Supabase
   instance in this phase):
   ```sh
   pg_dump "$SUPABASE_DATABASE_URL" | docker compose exec -T postgres psql -U "$POSTGRES_USER" "$POSTGRES_DB"
   ```
4. `docker compose up -d --build` (build and start `api`, `web`, `caddy` too).
5. `docker compose exec api npx prisma migrate deploy` if migrations haven't run yet.
6. Smoke test for real: register a fresh account, confirm the verification email actually
   arrives (check spam), run the raw email through [mail-tester.com](https://www.mail-tester.com)
   and aim for as close to 10/10 as possible before trusting this for real users, log in, take
   a test trip end-to-end, log into `/admin`.

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
- `ufw allow 80,443,22/tcp && ufw enable` (or equivalent) so nothing but SSH and the reverse
  proxy is reachable from the internet.
