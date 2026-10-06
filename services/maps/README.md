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
5. Every hour, segments seen on at least `MIN_SEGMENT_SAMPLES` journeys are written to
   `/traffic/speeds.csv` in OSRM's segment-speed format.
6. Every night at 00:00 UTC (03:00 Kampala) the OSRM container applies that file
   (`osrm-customize --segment-speed-file`) and restarts routing (`deploy/osrm/run.sh`).

Raw pings are deleted after `RAW_PING_RETENTION_DAYS`; learned speeds and places are kept.

## API

All `/v1` endpoints need `Authorization: Bearer <API_TOKEN>`. The service is internal only.

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/health` | none, no token | `{"status":"ok"}` when the database is reachable |
| POST | `/v1/pings` | `{source, pings: [{journeyId, lat, lng, recordedAt}]}`, up to 1000 | `202 {accepted}` |
| POST | `/v1/places` | `{source, places: [{label, lat, lng}]}`, up to 100 | `202 {accepted}` |
| GET | `/v1/places/search` | `?q=acacia&limit=8` | `{places: [{label, lat, lng, uses}]}` |
| POST | `/v1/route` | `{points: [{lat, lng}, ...]}`, 2–25 points in visiting order | `{distanceKm, durationMin}` |
| GET | `/v1/stats` | none | counts of pings, journeys learned, segments observed and in routing, places, last export |

`source` names the product (Piki Dada sends `pikidada`). `journeyId` is any id unique within
that source (Piki Dada sends `trip:<id>` and `delivery:<id>`). Products should never send
personal data: no names, phone numbers or user ids.

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
