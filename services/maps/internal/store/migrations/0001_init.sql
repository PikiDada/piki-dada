-- Raw GPS points, as received from every source product. Kept for a retention window (see
-- RAW_PING_RETENTION_DAYS) so traces can be re-learned if the matching logic improves.
CREATE TABLE pings (
    id          BIGSERIAL PRIMARY KEY,
    source      TEXT NOT NULL,
    journey_id  TEXT NOT NULL,
    lat         DOUBLE PRECISION NOT NULL,
    lng         DOUBLE PRECISION NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX pings_journey_idx ON pings (source, journey_id, recorded_at);
CREATE INDEX pings_received_idx ON pings (received_at);

-- One row per trip/delivery/etc. A journey is learned from once it has been quiet for a
-- while; processed_until marks how far, so pings arriving later (a long wait at a stop)
-- are learned from in a later pass without counting earlier stretches twice.
CREATE TABLE journeys (
    source            TEXT NOT NULL,
    journey_id        TEXT NOT NULL,
    first_ping_at     TIMESTAMPTZ NOT NULL,
    last_ping_at      TIMESTAMPTZ NOT NULL,
    ping_count        INTEGER NOT NULL,
    processed_until   TIMESTAMPTZ,
    segments_observed INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (source, journey_id)
);
CREATE INDEX journeys_last_ping_idx ON journeys (last_ping_at);

-- What the platform has learned: the observed speed on each directed road segment. Exported
-- to OSRM's speed file once enough journeys agree (see MIN_SEGMENT_SAMPLES).
CREATE TABLE segment_speeds (
    from_node  BIGINT NOT NULL,
    to_node    BIGINT NOT NULL,
    samples    INTEGER NOT NULL,
    speed_kmh  DOUBLE PRECISION NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (from_node, to_node)
);

-- The gazetteer. Position is the average of every time the place was picked, so it settles
-- on where people actually mean.
CREATE TABLE places (
    id            BIGSERIAL PRIMARY KEY,
    label         TEXT NOT NULL,
    normalized    TEXT NOT NULL,
    cell          TEXT NOT NULL,
    lat           DOUBLE PRECISION NOT NULL,
    lng           DOUBLE PRECISION NOT NULL,
    uses          INTEGER NOT NULL DEFAULT 1,
    sources       TEXT[] NOT NULL,
    first_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (normalized, cell)
);
CREATE INDEX places_prefix_idx ON places (normalized text_pattern_ops);

CREATE TABLE exports (
    id            BIGSERIAL PRIMARY KEY,
    segment_count INTEGER NOT NULL,
    exported_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
