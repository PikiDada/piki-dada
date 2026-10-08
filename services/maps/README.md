# Maps platform

An internal maps service, independent of any one product. Piki Dada is its first user; any
later product calls the same API. It does three jobs:

- **Routing**: distance and duration between points, from self-hosted OSRM.
- **Learning road speeds**: products send GPS traces from real journeys. The platform
  map-matches them to the road network, measures how fast vehicles actually travel on each
  road segment, and feeds those speeds back into OSRM. Routing improves with every journey.
- **Address gazetteer**: products send every address a customer picks. The platform builds
  its own address search from them, so it depends less on Google Places over time.

## How the learning loop works

1. A product posts GPS pings for a journey (`POST /v1/pings`), batched.
2. When a journey has been quiet for `JOURNEY_IDLE_MINUTES`, the background worker
   map-matches its trace against OSRM (`/match`, in windows of 100 points).
3. For each stretch between two matched points, speed = road distance ÷ GPS time. That speed
   is credited to every road segment (pair of OSM nodes) on the stretch. Readings under
   2 km/h (parked, waiting at a stop) or over 100 km/h (GPS error) are dropped.
4. Each segment keeps a running average; after `MAX_SAMPLE_WEIGHT` samples it becomes a
   moving average, so it still tracks real change.
5. Every hour, the all-day speeds of segments seen on at least `MIN_SEGMENT_SAMPLES` journeys are written to
   `/traffic/speeds.csv` in OSRM's segment-speed format.
6. Every night at 00:00 UTC (03:00 Kampala) the OSRM container applies that file
   (`osrm-customize --segment-speed-file`) and restarts routing (`deploy/osrm/run.sh`).

Raw pings are deleted after `RAW_PING_RETENTION_DAYS`; learned speeds and places are kept.

## Time of day

Kampala's roads are much slower at rush hour than at midday, so speeds are also learned per
time band. The bands are in Kampala time (UTC+3, no daylight saving) and are defined in one
place, `internal/learn/bands.go`:

| Band | Hours |
|---|---|
| 0 | all day |
| 1 | night, 21:00–06:00 |
| 2 | morning rush, 06:00–10:00 |
| 3 | midday, 10:00–16:00 |
| 4 | evening rush, 16:00–21:00 |

- **Learning**: every stretch updates two rows in `segment_speeds` for each segment it
  covers: band 0 (the all-day speed, as before) and the band of the stretch's time, taken at
  the midpoint of its two GPS timestamps. Both use the same running/moving average and
  `MAX_SAMPLE_WEIGHT` cap.
- **OSRM** holds one speed per segment, and one dataset keeps RAM low, so the speed file
  contains band 0 (all-day) speeds only. The band speeds never go into OSRM.
- **Routing**: `POST /v1/route` asks OSRM for the route with per-segment annotations, then
  looks up the departure band's speeds for all its segments in one query. A segment seen on
  at least `MIN_SEGMENT_SAMPLES` journeys in that band takes its distance at the band speed;
  every other segment keeps OSRM's time. OSRM's turn penalties are kept. If the lookup fails
  the response falls back to OSRM's plain duration. A whole route is timed for the band it
  departs in, even if a long trip runs into the next band.

## API

All `/v1` endpoints need `Authorization: Bearer <API_TOKEN>`. The service is internal only.

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/health` | none, no token | `{"status":"ok"}` when the database is reachable |
| POST | `/v1/pings` | `{source, pings: [{journeyId, lat, lng, recordedAt}]}`, up to 1000 | `202 {accepted}` |
| POST | `/v1/places` | `{source, places: [{label, lat, lng}]}`, up to 100 | `202 {accepted}` |
| GET | `/v1/places/search` | `?q=acacia&limit=8` | `{places: [{label, lat, lng, uses}]}` |
| POST | `/v1/route` | `{points: [{lat, lng}, ...], departAt?}`, 2–25 points in visiting order | `{distanceKm, durationMin, timeBand, learnedShare}` |
| GET | `/v1/stats` | none | counts of pings, journeys learned, segments observed and in routing (all-day speeds), places, last export |

`source` names the product (Piki Dada sends `pikidada`). `journeyId` is any id unique within
that source (Piki Dada sends `trip:<id>` and `delivery:<id>`). Products should never send
personal data: no names, phone numbers or user ids.

For `/v1/route`, `departAt` is optional (RFC3339, e.g. `2026-10-05T18:00:00+03:00`) and
defaults to now. `durationMin` is timed for that departure's band (see "Time of day"),
`timeBand` is the band used (1–4) and `learnedShare` is the fraction (0–1) of the route's
distance timed from speeds learned for that band; the rest is OSRM's all-day estimate.
Callers that only read `distanceKm` and `durationMin` need no change.

## Configuration

| Variable | Default | |
|---|---|---|
| `API_TOKEN` | required | Shared secret with the products |
| `OSRM_URL` | required | e.g. `http://osrm:5000` |
| `DATABASE_URL` | empty | Postgres URL; when empty the standard `PG*` variables are used. The database is created on first start. |
| `LISTEN_ADDR` | `:8080` | |
| `SPEED_FILE` | `/traffic/speeds.csv` | Shared with the OSRM container |
| `JOURNEY_IDLE_MINUTES` | `10` | |
| `MIN_SEGMENT_SAMPLES` | `3` | |
| `MAX_SAMPLE_WEIGHT` | `50` | |
| `MATCH_RADIUS_METRES` | `20` | Expected GPS error |
| `RAW_PING_RETENTION_DAYS` | `180` | |

## Development

```sh
go test ./...
go vet ./...
```

The tests need no database or OSRM. The Docker image is the static binary (about 11 MB) on
distroless; `docker-compose.yml` caps the container at 128 MB.
