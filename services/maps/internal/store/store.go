// Package store is the maps platform's own Postgres database. It is deliberately separate
// from any product's database: the platform outlives and serves more than one product.
package store

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"pikidada.com/mapsplatform/internal/learn"
	"pikidada.com/mapsplatform/internal/osrm"
	"pikidada.com/mapsplatform/internal/places"
)

//go:embed migrations/*.sql
var migrations embed.FS

type Store struct {
	db *pgxpool.Pool
}

// Open connects using dsn, or the standard PG* environment variables when dsn is empty,
// creating the database on first start and applying any pending migrations.
func Open(ctx context.Context, dsn string) (*Store, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, err
	}
	// The platform's load is small and bursty; a few connections leave Postgres's limited
	// slots on a small server to the products.
	cfg.MaxConns = 4

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "3D000" { // invalid_catalog_name
			return nil, err
		}
		if err := createDatabase(ctx, cfg.ConnConfig); err != nil {
			return nil, fmt.Errorf("creating database %q: %w", cfg.ConnConfig.Database, err)
		}
		if pool, err = pgxpool.NewWithConfig(ctx, cfg); err != nil {
			return nil, err
		}
	}

	s := &Store{db: pool}
	if err := s.migrate(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("migrating: %w", err)
	}
	return s, nil
}

func (s *Store) Close() { s.db.Close() }

func (s *Store) Ping(ctx context.Context) error { return s.db.Ping(ctx) }

func createDatabase(ctx context.Context, target *pgx.ConnConfig) error {
	admin := target.Copy()
	admin.Database = "postgres"
	conn, err := pgx.ConnectConfig(ctx, admin)
	if err != nil {
		return err
	}
	defer conn.Close(ctx)
	_, err = conn.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{target.Database}.Sanitize())
	return err
}

func (s *Store) migrate(ctx context.Context) error {
	if _, err := s.db.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`); err != nil {
		return err
	}
	names, err := fs.Glob(migrations, "migrations/*.sql")
	if err != nil {
		return err
	}
	sort.Strings(names)
	for _, name := range names {
		var done bool
		if err := s.db.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)`, name,
		).Scan(&done); err != nil {
			return err
		}
		if done {
			continue
		}
		sql, err := migrations.ReadFile(name)
		if err != nil {
			return err
		}
		if err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, string(sql)); err != nil {
				return err
			}
			_, err := tx.Exec(ctx, `INSERT INTO schema_migrations (version) VALUES ($1)`, name)
			return err
		}); err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}
	}
	return nil
}

type Ping struct {
	JourneyID  string
	Lat, Lng   float64
	RecordedAt time.Time
}

func (s *Store) InsertPings(ctx context.Context, source string, pings []Ping) error {
	type span struct {
		first, last time.Time
		count       int
	}
	journeys := map[string]*span{}
	rows := make([][]any, len(pings))
	for i, p := range pings {
		rows[i] = []any{source, p.JourneyID, p.Lat, p.Lng, p.RecordedAt}
		j := journeys[p.JourneyID]
		if j == nil {
			j = &span{first: p.RecordedAt, last: p.RecordedAt}
			journeys[p.JourneyID] = j
		}
		if p.RecordedAt.Before(j.first) {
			j.first = p.RecordedAt
		}
		if p.RecordedAt.After(j.last) {
			j.last = p.RecordedAt
		}
		j.count++
	}

	return pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		if _, err := tx.CopyFrom(ctx, pgx.Identifier{"pings"},
			[]string{"source", "journey_id", "lat", "lng", "recorded_at"},
			pgx.CopyFromRows(rows)); err != nil {
			return err
		}
		batch := &pgx.Batch{}
		for id, j := range journeys {
			batch.Queue(`
				INSERT INTO journeys (source, journey_id, first_ping_at, last_ping_at, ping_count)
				VALUES ($1, $2, $3, $4, $5)
				ON CONFLICT (source, journey_id) DO UPDATE SET
					first_ping_at = LEAST(journeys.first_ping_at, EXCLUDED.first_ping_at),
					last_ping_at  = GREATEST(journeys.last_ping_at, EXCLUDED.last_ping_at),
					ping_count    = journeys.ping_count + EXCLUDED.ping_count`,
				source, id, j.first, j.last, j.count)
		}
		return tx.SendBatch(ctx, batch).Close()
	})
}

type JourneyRef struct {
	Source, JourneyID string
	ProcessedUntil    *time.Time
}

// JourneysToLearn returns journeys with unlearned pings that have been quiet since idleSince,
// i.e. the trip is over (or paused long enough to learn what it has so far).
func (s *Store) JourneysToLearn(ctx context.Context, idleSince time.Time, limit int) ([]JourneyRef, error) {
	rows, err := s.db.Query(ctx, `
		SELECT source, journey_id, processed_until FROM journeys
		WHERE last_ping_at < $1
		  AND (processed_until IS NULL OR last_ping_at > processed_until)
		ORDER BY last_ping_at
		LIMIT $2`, idleSince, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (JourneyRef, error) {
		var j JourneyRef
		err := r.Scan(&j.Source, &j.JourneyID, &j.ProcessedUntil)
		return j, err
	})
}

// Trace returns the journey's pings from where learning last stopped, plus the exact time of
// the newest one (the point to mark learned up to). The boundary point is included so the
// stretch from it to the next new point is learned too.
func (s *Store) Trace(ctx context.Context, j JourneyRef) ([]osrm.TracePoint, time.Time, error) {
	since := time.Time{}
	if j.ProcessedUntil != nil {
		since = *j.ProcessedUntil
	}
	rows, err := s.db.Query(ctx, `
		SELECT lat, lng, recorded_at FROM pings
		WHERE source = $1 AND journey_id = $2 AND recorded_at >= $3
		ORDER BY recorded_at, id`, j.Source, j.JourneyID, since)
	if err != nil {
		return nil, time.Time{}, err
	}
	var latest time.Time
	trace, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (osrm.TracePoint, error) {
		var p osrm.TracePoint
		var at time.Time
		err := r.Scan(&p.Lat, &p.Lng, &at)
		p.Unix = at.Unix()
		if at.After(latest) {
			latest = at
		}
		return p, err
	})
	return trace, latest, err
}

// RecordLearning folds one journey's observed speeds into what the platform knows, and marks
// the journey learned up to `until`, in one transaction so a crash can't count it twice.
//
// Each segment's speed is a running average until it has maxWeight samples, then a moving
// average with that weight: early on every journey matters, and later the estimate still
// follows real change (a road resurfaced, a new junction) instead of freezing.
func (s *Store) RecordLearning(ctx context.Context, j JourneyRef, until time.Time,
	speeds map[learn.Segment]float64, maxWeight int) error {
	return pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		batch := &pgx.Batch{}
		for seg, kmh := range speeds {
			batch.Queue(`
				INSERT INTO segment_speeds (from_node, to_node, samples, speed_kmh)
				VALUES ($1, $2, 1, $3)
				ON CONFLICT (from_node, to_node) DO UPDATE SET
					samples    = segment_speeds.samples + 1,
					speed_kmh  = segment_speeds.speed_kmh
					           + (EXCLUDED.speed_kmh - segment_speeds.speed_kmh)
					           / LEAST(segment_speeds.samples + 1, $4),
					updated_at = now()`,
				seg.From, seg.To, kmh, maxWeight)
		}
		batch.Queue(`
			UPDATE journeys SET processed_until = $3, segments_observed = segments_observed + $4
			WHERE source = $1 AND journey_id = $2`,
			j.Source, j.JourneyID, until, len(speeds))
		return tx.SendBatch(ctx, batch).Close()
	})
}

func (s *Store) SpeedsForExport(ctx context.Context, minSamples int) ([]learn.SegmentSpeed, error) {
	rows, err := s.db.Query(ctx, `
		SELECT from_node, to_node, speed_kmh FROM segment_speeds
		WHERE samples >= $1 ORDER BY from_node, to_node`, minSamples)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (learn.SegmentSpeed, error) {
		var sp learn.SegmentSpeed
		err := r.Scan(&sp.From, &sp.To, &sp.SpeedKmh)
		return sp, err
	})
}

func (s *Store) RecordExport(ctx context.Context, segments int) error {
	_, err := s.db.Exec(ctx, `INSERT INTO exports (segment_count) VALUES ($1)`, segments)
	return err
}

func (s *Store) PrunePings(ctx context.Context, before time.Time) (int64, error) {
	tag, err := s.db.Exec(ctx, `DELETE FROM pings WHERE received_at < $1`, before)
	return tag.RowsAffected(), err
}

type PlaceInput struct {
	Label    string
	Lat, Lng float64
}

func (s *Store) RecordPlaces(ctx context.Context, source string, in []PlaceInput) error {
	batch := &pgx.Batch{}
	for _, p := range in {
		normalized := places.Normalize(p.Label)
		if len(normalized) < 3 {
			continue
		}
		batch.Queue(`
			INSERT INTO places (label, normalized, cell, lat, lng, sources)
			VALUES ($1, $2, $3, $4, $5, ARRAY[$6::text])
			ON CONFLICT (normalized, cell) DO UPDATE SET
				lat          = (places.lat * places.uses + EXCLUDED.lat) / (places.uses + 1),
				lng          = (places.lng * places.uses + EXCLUDED.lng) / (places.uses + 1),
				uses         = places.uses + 1,
				sources      = CASE WHEN $6 = ANY (places.sources) THEN places.sources
				                    ELSE array_append(places.sources, $6) END,
				last_used_at = now()`,
			p.Label, normalized, places.Cell(p.Lat, p.Lng), p.Lat, p.Lng, source)
	}
	if batch.Len() == 0 {
		return nil
	}
	return s.db.SendBatch(ctx, batch).Close()
}

type Place struct {
	Label string  `json:"label"`
	Lat   float64 `json:"lat"`
	Lng   float64 `json:"lng"`
	Uses  int     `json:"uses"`
}

// SearchPlaces matches the query against the start of any word, most-used places first.
// Normalize leaves only letters, digits and spaces, so the query can't carry LIKE wildcards.
func (s *Store) SearchPlaces(ctx context.Context, query string, limit int) ([]Place, error) {
	q := places.Normalize(query)
	if q == "" {
		return []Place{}, nil
	}
	rows, err := s.db.Query(ctx, `
		SELECT label, lat, lng, uses FROM places
		WHERE normalized LIKE $1 || '%' OR normalized LIKE '% ' || $1 || '%'
		ORDER BY uses DESC, last_used_at DESC
		LIMIT $2`, q, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Place])
}

type Stats struct {
	Pings              int64      `json:"pings"`
	Journeys           int64      `json:"journeys"`
	JourneysLearned    int64      `json:"journeysLearned"`
	SegmentsObserved   int64      `json:"segmentsObserved"`
	SegmentsInRouting  int64      `json:"segmentsInRouting"`
	Places             int64      `json:"places"`
	LastExportAt       *time.Time `json:"lastExportAt"`
	LastExportSegments *int64     `json:"lastExportSegments"`
}

// Stats shows whether the platform is actually learning: segmentsInRouting is how many road
// segments OSRM now routes with observed speeds instead of guesses.
func (s *Store) Stats(ctx context.Context, minSamples int) (Stats, error) {
	var st Stats
	err := s.db.QueryRow(ctx, `
		SELECT
			(SELECT count(*) FROM pings),
			(SELECT count(*) FROM journeys),
			(SELECT count(*) FROM journeys WHERE processed_until IS NOT NULL),
			(SELECT count(*) FROM segment_speeds),
			(SELECT count(*) FROM segment_speeds WHERE samples >= $1),
			(SELECT count(*) FROM places),
			(SELECT exported_at FROM exports ORDER BY id DESC LIMIT 1),
			(SELECT segment_count FROM exports ORDER BY id DESC LIMIT 1)`, minSamples,
	).Scan(&st.Pings, &st.Journeys, &st.JourneysLearned, &st.SegmentsObserved,
		&st.SegmentsInRouting, &st.Places, &st.LastExportAt, &st.LastExportSegments)
	return st, err
}
