# Deploying Piki Dada on Hetzner

Piki Dada runs on a Hetzner server shared with the owner's other apps. The shared parts
(HTTPS front door, Postgres, backups, deploy scripts) are in
**github.com/arihosolomon/hetzner-box**, whose MOVING.md says when Piki Dada moves relative to
the other apps. This guide is Piki Dada's part: `docker-compose.yml`, `Caddyfile`,
`.env.example` (root, for Compose) and `apps/api/.env.example` (for the API).

## Start these early (they take days, not minutes)

| What | Why it can't wait | Where |
|---|---|---|
| **Amazon SES production access** | New SES accounts can only email verified addresses until AWS approves production access, which can take a day or more. Without it, riders and passengers get no verification or receipt emails after the move | Phase 0 step 5 |
| **Hetzner account** | New accounts are sometimes asked for ID verification before a server can be created | hetzner.com |
| **Hetzner Storage Box** (BX11, the smallest, is plenty) | Off-server home for nightly backups. Supabase backed up for you; on Hetzner nothing does unless this is set up | the box README ("Backups") |
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
   step 5), and drop SendGrid/Brevo from it when they're no longer used.
5. **Test:** from another address, send to `support@pikidada.com` and confirm it arrives in
   Gmail. To reply *as* that address, add it in Gmail → Settings → Accounts → "Send mail as",
   using a sending service's SMTP login (Brevo or SendGrid now, SES later).

From here on, every DNS change in this guide (Phase 2) happens in Cloudflare.

## Phase 0 — The shared server and Piki Dada's place on it

Piki Dada shares one Hetzner server with the owner's other apps. The shared parts (the front
door with HTTPS, Postgres, backups, deploy scripts) live in the box repo,
**github.com/arihosolomon/hetzner-box**; this repo only holds what is Piki Dada's own.

1. **Set up the server** following the box repo's README ("Setting up the server"), if it
   isn't already. It includes the Storage Box for backups.
2. **Cloudflare for pikidada.com:** set SSL/TLS mode to **Full (strict)**, then create an
   **Origin Certificate** for `pikidada.com, *.pikidada.com` (SSL/TLS → Origin Server) and save
   it on the server as `/srv/certs/pikidada.com.pem` and `/srv/certs/pikidada.com.key`. Leave the
   DNS records as they are for now: the live site keeps running on Vercel and Render.
3. **Register Piki Dada** (on the server, in /srv/box): `bin/add-app.sh pikidada`. It creates
   the `pikidada` login with the `pikidada` and `pikidada_maps` databases (note the password it
   prints), sets up the deploy key for this repo, and clones it to `/srv/apps/pikidada`.
4. **Settings**, in `/srv/apps/pikidada`:
   ```sh
   cp .env.example .env                     # PIKIDADA_DB_PASSWORD, MAPS_PLATFORM_TOKEN, NEXT_PUBLIC_*
   cp apps/api/.env.example apps/api/.env    # every secret/key it lists
   ```
   In `apps/api/.env`: `DATABASE_URL` and `DIRECT_URL` are both
   `postgresql://pikidada:<that password>@postgres:5432/pikidada`, and `UPLOADS_PUBLIC_URL` is
   `https://files.pikidada.com`. Uploaded files are kept on the server's disk (the `uploads`
   volume), so there's no storage service to set up.
5. **Email is Amazon SES, not self-hosted**: verify `pikidada.com` in the SES console (it
   gives you exact SPF/DKIM records; confirm they show "verified" there), request production
   access, create SMTP credentials, fill in `SMTP_*` in `apps/api/.env`. See that file's
   comments for the full rundown.
6. **OSRM (self-hosted routing):** run the one-time data-prep commands in
   `docker-compose.yml`'s comment on the `osrm` service, from `/srv/apps/pikidada`, then set
   `COMPOSE_PROFILES="routing"` in `.env` and deploy again. Not needed for the move itself:
   OSRM stays off until then, and pricing uses Google Routes first anyway, so this can wait
   until the site is stable.

## Phase 1 — Dry run (still no impact on the live site)

1. **Copy production data to test with.** `SUPABASE_DB_URL` is the `DIRECT_URL` from the
   current API settings (Supabase's session pooler, port 5432). Only the app's own tables
   (`public`) are copied: Supabase's internal parts (its auth, storage and cron schemas) don't
   exist on plain Postgres and aren't used by the app. The dump runs in a Postgres 17
   container to match Supabase's version (17.6), and the restore stops at the first error
   instead of carrying on with half the data:
   ```sh
   docker run --rm postgres:17-alpine pg_dump "$SUPABASE_DB_URL" \
       --schema=public --no-owner --no-privileges \
     | docker exec -i postgres psql -v ON_ERROR_STOP=1 -U pikidada -d pikidada
   ```
2. **Start Piki Dada:** `/srv/box/bin/deploy.sh pikidada`. It builds the API, maps platform
   and website, runs the database migrations, waits until everything is healthy, and reloads
   the front door (Piki Dada's site file, `edge/sites/pikidada.caddy`, is already in the box
   repo).
3. **Test it before DNS changes**, from your computer, by pointing the domains at the server
   for your machine only: add `<server IP> pikidada.com www.pikidada.com api.pikidada.com
   files.pikidada.com` to your hosts file (Windows: `C:\Windows\System32\drivers\etc\hosts`).
   The browser will warn about the certificate (an origin certificate is only trusted by
   Cloudflare); accept it for the test. Register a fresh account, confirm the verification
   email arrives (check spam), log in, take a test trip end to end, log into `/admin`, upload
   a rider document. Remove the hosts lines afterwards.
4. **Test the backups now, not after something breaks:** run `/srv/box/bin/backup.sh`, check
   the files arrived on the Storage Box, and restore the `pikidada` database once as a drill
   (box README, "Backups").

## Phase 2 — Cutover (the maintenance window)

Pick the quietest hour (late night, Kampala time). Anything booked on the old system after
step 1 isn't copied.

1. **Copy the final data.** Stop the new API, empty the dry-run data, restore exactly as in
   Phase 1, and note the time (the ping replay below needs it):
   ```sh
   cd /srv/apps/pikidada && docker compose -p pikidada stop api
   docker exec -i postgres psql -U pikidada -d pikidada -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
   # ...the pg_dump | psql command from Phase 1 step 1...
   date -u +%Y-%m-%dT%H:%M:%SZ
   docker compose -p pikidada start api
   ```
2. **Move uploaded files off Supabase**, only after that final restore, since a later restore
   would bring the old links back. `scripts/migrate-storage.ts` copies every file from
   Supabase Storage into the `uploads` volume, then rewrites the database's file links to
   `files.pikidada.com`. It only rewrites if every file copied, and is safe to re-run (values
   from the current API settings; `DATABASE_URL` is the new `postgres:5432` one):
   ```sh
   docker run --rm --network db -v /srv/apps/pikidada:/app -w /app -v pikidada_uploads:/uploads \
     -e SUPABASE_URL=... -e SUPABASE_SERVICE_ROLE_KEY=... -e DATABASE_URL=... \
     -e UPLOAD_DIR=/uploads -e UPLOADS_PUBLIC_URL=https://files.pikidada.com \
     node:22 sh -c "npm i --no-save @supabase/supabase-js pg >/dev/null && npx -y tsx scripts/migrate-storage.ts"
   ```
3. **Replay the stored GPS pings into the maps platform** so it learns from every trip since
   launch. `REPLAY_BEFORE` is the time noted in step 1; pings after it were sent live. Run it
   once, the same way:
   ```sh
   docker create --name oneoff --network db -v /srv/apps/pikidada:/app -w /app \
     -e DATABASE_URL="postgresql://pikidada:<password>@postgres:5432/pikidada" \
     -e MAPS_PLATFORM_URL=http://maps:8080 -e MAPS_PLATFORM_TOKEN=<from .env> \
     -e REPLAY_BEFORE=<time from step 1> \
     node:22 sh -c "npm i --no-save pg >/dev/null && npx -y tsx scripts/replay-pings.ts"
   docker network connect pikidada_default oneoff && docker start -a oneoff; docker rm oneoff
   ```
4. **Point DNS at the server**, in Cloudflare, every record **proxied** (orange cloud), since the
   front door expects requests through Cloudflare:
   - `pikidada.com` and `www`: A record → the server's IP (was Vercel)
   - `api`: A record → the server's IP (was a CNAME to piki-dada-api-xgen.onrender.com)
   - `files`: A record → the server's IP (new)

   Proxied records switch within about a minute.
5. **Re-run the Phase 1 smoke test** against the real domain, without the hosts-file lines, and
   open a rider document in `/admin` to confirm it loads from `files.pikidada.com`.

**If something goes wrong:** point the records back at Vercel (`A 216.198.79.1` for `@`,
`CNAME 33b12cfc90f84edd.vercel-dns-017.com` for `www`) and Render (`api` CNAME
`piki-dada-api-xgen.onrender.com`), grey cloud, and the old system is live again within
minutes. Bookings made on the new server in between would need copying back by hand, so
decide quickly.

## Phase 3 — Decommission (after a few stable days)

After this, the app no longer depends on Supabase, Render, Vercel or Cloudinary.

- Cancel the Render service and remove both Vercel projects (`piki-dada-web` and
  `piki-dada-api`).
- Delete the files only those hosts used: `render.yaml`, `apps/web/vercel.json`, and
  `.github/workflows/keep-alive.yml` (it pings Render to keep it awake).
- Let the SendGrid trial lapse (no action needed) or delete the account.
- Keep the Supabase project paused (not deleted) for a short rollback window, then delete it.
  Before deleting, confirm no file links still point at it (expect 0):
  `docker exec postgres psql -U pikidada -d pikidada -c "SELECT count(*) FROM \"Document\" WHERE \"fileUrl\" LIKE '%supabase.co%'"`
- Close the Cloudinary account: nothing in the database links to it (checked 6 Oct 2026; all
  documents were on Supabase Storage, which step 2 of the cutover moves to the server).
- Remove `*.supabase.co` and `res.cloudinary.com` from the image sources in the Caddyfile's
  Content-Security-Policy.

## Ongoing

- **Deploy** the latest `main`: `/srv/box/bin/deploy.sh pikidada`.
- **Logs and status:** `docker compose -p pikidada logs -f --tail 100` and
  `docker compose -p pikidada ps` (from `/srv/apps/pikidada`) are the new Render dashboard.
- **Backups** are the box's nightly job: Piki Dada's two databases, its uploaded files (the
  `pikidada_uploads` volume) and its settings files, in `/srv/backups/pikidada/` and on the
  Storage Box. Restoring is in the box README.
- **Memory:** Piki Dada's containers are allowed about 2.15 GB in total, 1.5 GB of it for
  OSRM, within the server's budget in the box README. After a week of real traffic, compare
  with `docker stats --no-stream`.
- **Is the maps platform learning?**
  `docker compose -p pikidada exec api node -e "fetch('http://maps:8080/v1/stats',{headers:{Authorization:'Bearer '+process.env.MAPS_PLATFORM_TOKEN}}).then(r=>r.json()).then(console.log)"`
  shows journeys learned, road segments with observed speeds, and how many of those OSRM
  now routes with. The OSRM container applies newly learned speeds every night at 03:00
  Kampala time (`docker compose -p pikidada logs osrm`).

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
   `NEXT_PUBLIC_MAP_PROVIDER="osm"` in `/srv/apps/pikidada/.env`, then `/srv/box/bin/deploy.sh pikidada`.
   `NEXT_PUBLIC_MAP_TILES_URL` defaults to `/tiles/uganda.pmtiles` on the same site; the map's
   fonts and icons (`NEXT_PUBLIC_MAP_GLYPHS_URL`, `NEXT_PUBLIC_MAP_SPRITE_URL`) default to
   Protomaps' public copies on GitHub Pages. All four are described in `apps/web/.env.example`.
4. **To update the map data** later, extract a fresh file under a new name (e.g.
   `uganda-2027-01.pmtiles`), point `NEXT_PUBLIC_MAP_TILES_URL` at it and rebuild: browsers
   cache tiles for a week, and a file replaced in place would mix old and new pieces.
5. **To switch back**, empty `NEXT_PUBLIC_MAP_PROVIDER` (or set it to `"google"`) and run
   `/srv/box/bin/deploy.sh pikidada` again. The map file can stay where it is.
