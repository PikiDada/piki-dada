# Deploying Piki Dada on Hetzner

Everything that can be prepared from inside this repo is done: `docker-compose.yml`,
`Caddyfile`, `.env.example` (root, for Compose) and `apps/api/.env.example` (for the API).
The steps below need your Hetzner account, your domain's DNS, and hands-on-the-server
access — none of that is something that can be done from here. Full context and rationale
for each decision is in the approved migration plan; this is the condensed checklist.

## Start these early (they take days, not minutes)

| What | Why it can't wait | Where |
|---|---|---|
| **Amazon SES production access** | New SES accounts can only email verified addresses until AWS approves production access, which can take a day or more. Without it, riders and passengers get no verification or receipt emails after the move | Phase 0 step 4 |
| **Hetzner account** | New accounts are sometimes asked for ID verification before a server can be created | hetzner.com |
| **Hetzner Storage Box** (BX11, the smallest, is plenty) | Off-server home for nightly backups. Supabase backed up for you; on Hetzner nothing does unless this is set up | "Backups and restoring" below |
| **DNS on Cloudflare** | Every cutover step is a DNS change; on Cloudflare they take effect in minutes. Also fixes incoming email | Next section |
| **Lower DNS TTLs** to 5 minutes, a day before the cutover | So the switch reaches everyone fast, and switching back is fast too | Cloudflare, on the `@`, `www` and `api` records |
| **Payment webhooks** | Stripe and Flutterwave must call `https://api.pikidada.com/payments/webhooks/...`, not an `onrender.com` address, or payments stop confirming after the move | Stripe and Flutterwave dashboards |
| **Google sign-in** | The OAuth redirect must be `https://api.pikidada.com/auth/google/callback` (same rule) | Google Cloud console, Credentials |

## Before Hetzner: DNS to Cloudflare, incoming email to Gmail

Independent of the server move, and worth doing first: it fixes incoming email, which is
broken today. The MX record says "deliver to pikidada.com", and pikidada.com points at
Vercel, which doesn't accept email. After this, mail to any @pikidada.com address you
create is forwarded to pikidada8@gmail.com by Cloudflare Email Routing (free). DNS for
pikidada.com is currently hosted by the cPanel provider (ns1/ns2.crystalcloudhost.net).

1. **Save old mail first.** In cPanel → Email Accounts, check for existing mailboxes. That
   server still holds whatever arrived before email broke; export anything worth keeping
   (webmail.pikidada.com) before cancelling cPanel hosting later.
2. **Add pikidada.com to Cloudflare** (free plan). Cloudflare scans and imports existing
   records. Compare its list against the table below and add anything it missed. Set every
   record to **DNS only** (grey cloud): Vercel and Render issue their own certificates.

   Records found on 7 Oct 2026 (the provider refuses a full listing, so check your SendGrid
   and Brevo dashboards under sender/domain authentication for any others, such as a
   SendGrid `em…` CNAME):

   | Name | Type | Value | Keep? |
   |---|---|---|---|
   | `pikidada.com` | A | 216.198.79.1 (Vercel) | Keep until Hetzner |
   | `www` | CNAME | 33b12cfc90f84edd.vercel-dns-017.com | Keep until Hetzner |
   | `api` | CNAME | piki-dada-api-xgen.onrender.com | Keep until Hetzner |
   | `s1._domainkey`, `s2._domainkey` | CNAME | s1/s2.domainkey.u111877761.wl012.sendgrid.net | Keep: SendGrid signing |
   | `brevo1._domainkey`, `brevo2._domainkey` | CNAME | b1/b2.pikidada-com.dkim.brevo.com | Keep: Brevo signing |
   | `pikidada.com` | TXT | `brevo-code:…`, `b03c01001@smtp-brevo.com` | Keep: Brevo verification |
   | `mail` | TXT | `xsmtpsib-…` | Keep: Brevo verification |
   | `_dmarc` | TXT | `v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com` | Keep |
   | `pikidada.com` | TXT | `v=spf1 +a +mx +ip4:172.93.110.104 ~all` | **Replace** (step 4) |
   | `pikidada.com` | MX | `0 pikidada.com` | **Delete** (step 4 adds Cloudflare's) |
   | `cpanel`, `webmail` | A | 172.93.110.104 | Keep until old mail is exported |
   | `whm`, `webdisk`, `cpcalendars`, `cpcontacts`, `autoconfig`, `autodiscover`, `ftp` | A | 172.93.110.104 | Drop (cPanel only) |
   | `_autodiscover._tcp` | SRV | cpanelemaildiscovery.cpanel.net | Drop (cPanel only) |
   | `default._domainkey`, `_cpanel-dcv-test-record`, `_acme-challenge` | TXT | cPanel / old certificate checks | Drop |

3. **Switch nameservers** at the registrar where pikidada.com is registered (possibly the same
   provider as cPanel) to the two Cloudflare gives you. With the records copied, nothing goes
   down; the change takes from minutes to a day to spread.
4. **Turn on Email Routing** (Cloudflare → Email → Email Routing): add pikidada8@gmail.com as
   the destination (Gmail receives a confirmation link), then create the addresses you want
   (e.g. `support@`, `info@`) or a catch-all. Let Cloudflare add its MX records, delete the
   old `0 pikidada.com` MX, and keep **one** SPF record that covers both receiving and every
   service that sends as @pikidada.com:

   ```
   v=spf1 include:_spf.mx.cloudflare.net include:sendgrid.net include:spf.brevo.com ~all
   ```

   Add `include:amazonses.com` once Amazon SES sends the app's email (Hetzner, Phase 0
   step 4), and drop SendGrid/Brevo from it when they're no longer used.
5. **Test:** from another address, send to `support@pikidada.com` and confirm it arrives in
   Gmail. To reply *as* that address, add it in Gmail → Settings → Accounts → "Send mail as",
   using a sending service's SMTP login (Brevo or SendGrid now, SES later).

From here on, every DNS change in this guide (Phase 2) happens in Cloudflare.

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
2. Restore a copy of production data to test against. `SUPABASE_DB_URL` is the
   `DIRECT_URL` from the current API settings (Supabase's session pooler, port 5432). Only the
   app's own tables (`public`) are copied: Supabase's internal parts (its auth, storage and
   cron schemas) don't exist on plain Postgres and aren't used by the app. The dump runs in a
   Postgres 17 container to match Supabase's version (17.6), and the restore stops at the
   first error instead of carrying on with half the data:
   ```sh
   docker run --rm postgres:17-alpine pg_dump "$SUPABASE_DB_URL"        --schema=public --no-owner --no-privileges      | docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" "$POSTGRES_DB"
   ```
3. `docker compose up -d --build` (build and start `api`, `maps` and `caddy` too; the website
   is built into the Caddy image as static files, so there's no separate web container).
4. `docker compose exec api npx prisma migrate deploy` if migrations haven't run yet.
5. Smoke test for real: register a fresh account, confirm the verification email actually
   arrives (check spam), log in, take a test trip end-to-end, log into `/admin`, and upload a
   rider document to check file storage works.
6. **Test the backups now, not after something breaks**: run `deploy/backup.sh` once, check
   the files arrived on the Storage Box, and do the restore drill in "Backups and restoring".

## Phase 2 — Cutover (the maintenance window)

Pick a low-traffic time (late night, Kampala time).

1. Copy the final data. Anything booked on the old system after this point isn't copied,
   which is why this runs at the quietest hour. Stop the new API, empty the dry-run data,
   then restore exactly as in Phase 1 step 2, and note the time (the ping replay below needs
   it):
   ```sh
   docker compose stop api
   docker compose exec -T postgres psql -U "$POSTGRES_USER" "$POSTGRES_DB"      -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
   # ...the pg_dump | psql command from Phase 1 step 2...
   date -u +%Y-%m-%dT%H:%M:%SZ
   docker compose start api
   ```
2. **Move uploaded files off Supabase** — only after that final restore, since a later
   restore would bring the old links back. `scripts/migrate-storage.ts` copies every file
   from Supabase Storage into MinIO, then rewrites the database's file links to
   `files.pikidada.com`. It only rewrites if every file copied, and is safe to re-run. See
   the usage block at the top of the script; `DATABASE_URL` there must be the new
   self-hosted Postgres.
   **Replay the stored GPS pings into the maps platform** so it learns from every trip
   since launch, not just from today. Use the time you took the final `pg_dump` (step 1)
   as `REPLAY_BEFORE`: pings after that were sent live. Run it once. Neither Postgres nor
   the maps service is exposed outside Docker, so run it on the compose network
   (`docker network ls` shows its name, usually `<folder>_default`), after `set -a; . ./.env; set +a`
   so the variables below are filled in:
   ```bash
   docker run --rm --network <folder>_default -v "$PWD":/app -w /app \
     -e DATABASE_URL="postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@postgres:5432/pikidada" \
     -e MAPS_PLATFORM_URL=http://maps:8080 -e MAPS_PLATFORM_TOKEN="$MAPS_PLATFORM_TOKEN" \
     -e REPLAY_BEFORE=<final dump time, e.g. 2026-11-01T21:00:00Z> \
     node:22 sh -c "npm i --no-save pg >/dev/null && npx -y tsx scripts/replay-pings.ts"
   ```
3. Re-point DNS:
   - `api.pikidada.com` → the Hetzner server's IP (currently a CNAME to piki-dada-api-xgen.onrender.com)
   - `pikidada.com` and `www.pikidada.com` → the Hetzner server's IP (was Vercel)
   - `files.pikidada.com` → the Hetzner server's IP (new record, for MinIO document previews)
4. Wait for DNS to propagate, then confirm Caddy issued certificates for all four hostnames:
   `docker compose logs caddy | grep -i certificate`
5. Re-run the same smoke test as Phase 1, against the real domain this time, and open a
   driver document in `/admin` to confirm it now loads from `files.pikidada.com`.

## Phase 3 — Decommission (after a few stable days)

After this, the app no longer depends on Supabase, Render, Vercel or Cloudinary.

- Cancel the Render service and remove both Vercel projects (`piki-dada-web` and
  `piki-dada-api`).
- Delete the files only those hosts used: `render.yaml`, `apps/web/vercel.json`, and
  `.github/workflows/keep-alive.yml` (it pings Render to keep it awake).
- Let the SendGrid trial lapse (no action needed) or delete the account.
- Keep the Supabase project paused (not deleted) for a short rollback window, then delete it.
  Before deleting, confirm no file links still point at it (expect 0):
  `docker compose exec -T postgres psql -U "$POSTGRES_USER" "$POSTGRES_DB" -c "SELECT count(*) FROM \"Document\" WHERE \"fileUrl\" LIKE '%supabase.co%'"`
- Close the Cloudinary account: nothing in the database links to it (checked 6 Oct 2026; all
  documents were on Supabase Storage, which step 2 of the cutover moves to MinIO).
- Remove `*.supabase.co` and `res.cloudinary.com` from the image sources in the Caddyfile's
  Content-Security-Policy.

## Ongoing

- Backups run nightly from cron; see "Backups and restoring" below.
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

## Backups and restoring

`deploy/backup.sh` copies, every night, everything that can't be rebuilt: the app's database,
the maps platform's database (what it has learned about Kampala), and every uploaded file. It
keeps 14 days on the server and copies everything to the Storage Box.

**Set up (once):**
1. Order a Hetzner Storage Box and turn on SSH support in its settings.
2. On the server: `ssh-keygen -t ed25519` (no passphrase), then install the key on the box:
   `cat ~/.ssh/id_ed25519.pub | ssh -p 23 uXXXXXX@uXXXXXX.your-storagebox.de install-ssh-key`
3. In the root `.env`: `BACKUP_REMOTE="uXXXXXX@uXXXXXX.your-storagebox.de:pikidada"`, and
   create that folder: `ssh -p 23 uXXXXXX@uXXXXXX.your-storagebox.de mkdir pikidada`.
4. `crontab -e` and add: `0 1 * * * /opt/pikidada/deploy/backup.sh >> /var/log/pikidada-backup.log 2>&1`
5. Run it once by hand and check it ends with "copied to ...".

**Restore drill** (do it once in the dry run; it's also the real procedure):
```sh
# Database (replace the file name with the dump you want; pikidada_* is the app, maps_* the maps platform)
docker compose stop api
docker compose exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists   < /var/backups/pikidada/db/pikidada_2026-11-02_0100.dump
docker compose start api

# Files
docker compose run --rm --no-deps -v /var/backups/pikidada/files:/backup --entrypoint /bin/sh minio-init -c   'mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" && mc mirror --overwrite /backup local/driver-documents'
```
If the server itself is lost, first copy the backups back from the Storage Box:
`rsync -a -e "ssh -p 23" uXXXXXX@uXXXXXX.your-storagebox.de:pikidada/ /var/backups/pikidada/`

## Our own map display (optional switch)

The trip maps can be drawn from OpenStreetMap data on this server instead of by Google. It's
off by default; nothing changes until you build the web app with the switch on. Address
search (Google Places) and pricing are unaffected either way.

> **Don't switch while address search still uses Google Places for the chosen location:**
> Google's terms don't allow showing Google Places results on a non-Google map. Switch once
> addresses come from our own gazetteer (or Google results are no longer plotted).

1. **Make the Uganda map file** with the [`pmtiles` CLI](https://github.com/protomaps/go-pmtiles/releases)
   (one binary). Pick the newest daily world build listed at https://build.protomaps.com
   (named like `20261007.pmtiles`) and cut Uganda out of it; only the needed parts are
   downloaded, and the result is a few hundred MB at most:
   `pmtiles extract https://build.protomaps.com/20261007.pmtiles uganda.pmtiles --bbox=29.5,-1.5,35.1,4.3`
2. **Put it on the server** in `./data/tiles/` next to `docker-compose.yml`
   (`mkdir -p data/tiles && mv uganda.pmtiles data/tiles/`). Caddy serves it at
   `https://pikidada.com/tiles/uganda.pmtiles`; no restart needed. Check with
   `curl -sI -H 'Range: bytes=0-99' https://pikidada.com/tiles/uganda.pmtiles` (expect `206`).
3. **Turn it on** in the root `.env` and rebuild the website:
   `NEXT_PUBLIC_MAP_PROVIDER="osm"`, then `docker compose up -d --build caddy`.
   `NEXT_PUBLIC_MAP_TILES_URL` defaults to `/tiles/uganda.pmtiles` on the same site; the map's
   fonts and icons (`NEXT_PUBLIC_MAP_GLYPHS_URL`, `NEXT_PUBLIC_MAP_SPRITE_URL`) default to
   Protomaps' public copies on GitHub Pages. All four are described in `apps/web/.env.example`.
4. **To update the map data** later, extract a fresh file under a new name (e.g.
   `uganda-2027-01.pmtiles`), point `NEXT_PUBLIC_MAP_TILES_URL` at it and rebuild: browsers
   cache tiles for a week, and a file replaced in place would mix old and new pieces.
5. **To switch back**, empty `NEXT_PUBLIC_MAP_PROVIDER` (or set it to `"google"`) and run
   `docker compose up -d --build caddy` again. The map file can stay where it is.
