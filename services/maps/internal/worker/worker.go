// Package worker runs the platform's self-improvement loop in the background:
//
//  1. learn: once a journey goes quiet, map-match its GPS trace and fold the observed road
//     speeds into segment_speeds;
//  2. export: write the speeds enough journeys agree on to OSRM's speed file, which the OSRM
//     container applies daily (deploy/osrm/run.sh);
//  3. prune: drop raw pings past their retention window.
package worker

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"pikidada.com/mapsplatform/internal/learn"
	"pikidada.com/mapsplatform/internal/osrm"
	"pikidada.com/mapsplatform/internal/store"
)

type Config struct {
	// A journey is learned from after this long without new pings.
	IdleAfter time.Duration
	// Segments need this many journeys before OSRM uses the learned speed.
	MinSamples int
	// Cap on a segment's averaging weight; see store.RecordLearning.
	MaxWeight     int
	MinConfidence float64
	SpeedFile     string
	Retention     time.Duration
}

type Worker struct {
	store *store.Store
	osrm  *osrm.Client
	cfg   Config
	log   *slog.Logger
}

func New(s *store.Store, o *osrm.Client, cfg Config, log *slog.Logger) *Worker {
	return &Worker{store: s, osrm: o, cfg: cfg, log: log}
}

func (w *Worker) Run(ctx context.Context) {
	go every(ctx, time.Minute, w.learnPending)
	go every(ctx, time.Hour, w.export)
	go every(ctx, 24*time.Hour, w.prune)
}

func every(ctx context.Context, interval time.Duration, fn func(context.Context)) {
	fn(ctx)
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			fn(ctx)
		}
	}
}

func (w *Worker) learnPending(ctx context.Context) {
	journeys, err := w.store.JourneysToLearn(ctx, time.Now().Add(-w.cfg.IdleAfter), 20)
	if err != nil {
		w.log.Error("listing journeys to learn", "err", err)
		return
	}
	for _, j := range journeys {
		if err := w.learnJourney(ctx, j); err != nil {
			// Most likely OSRM is down or restarting; the journey stays pending and is
			// retried next pass, so stop here instead of failing every journey in turn.
			w.log.Warn("learning paused", "journey", j.JourneyID, "err", err)
			return
		}
	}
}

func (w *Worker) learnJourney(ctx context.Context, j store.JourneyRef) error {
	trace, latest, err := w.store.Trace(ctx, j)
	if err != nil {
		return err
	}
	if len(trace) == 0 {
		// Its pings were pruned before it was learned; nothing left to learn from.
		return w.store.RecordLearning(ctx, j, time.Now(), nil, w.cfg.MaxWeight)
	}

	sums := map[learn.Segment]float64{}
	counts := map[learn.Segment]int{}
	for _, window := range learn.Windows(learn.Clean(trace), osrm.MaxMatchPoints) {
		if len(window) < 2 {
			continue
		}
		res, err := w.osrm.Match(ctx, window)
		if errors.Is(err, osrm.ErrNoMatch) {
			continue
		}
		if err != nil {
			return err
		}
		unix := make([]int64, len(window))
		for i, p := range window {
			unix[i] = p.Unix
		}
		for seg, kmh := range learn.ObservedSpeeds(res, unix, w.cfg.MinConfidence) {
			sums[seg] += kmh
			counts[seg]++
		}
	}

	speeds := make(map[learn.Segment]float64, len(sums))
	for seg, sum := range sums {
		speeds[seg] = sum / float64(counts[seg])
	}
	if err := w.store.RecordLearning(ctx, j, latest, speeds, w.cfg.MaxWeight); err != nil {
		return err
	}
	w.log.Info("learned from journey", "source", j.Source, "journey", j.JourneyID,
		"points", len(trace), "segments", len(speeds))
	return nil
}

func (w *Worker) export(ctx context.Context) {
	rows, err := w.store.SpeedsForExport(ctx, w.cfg.MinSamples)
	if err != nil {
		w.log.Error("reading speeds to export", "err", err)
		return
	}
	// No file at all leaves OSRM on its default profile speeds.
	if len(rows) == 0 {
		return
	}
	if err := learn.WriteSpeedFile(w.cfg.SpeedFile, rows); err != nil {
		w.log.Error("writing OSRM speed file", "path", w.cfg.SpeedFile, "err", err)
		return
	}
	if err := w.store.RecordExport(ctx, len(rows)); err != nil {
		w.log.Error("recording export", "err", err)
	}
	w.log.Info("exported learned speeds", "segments", len(rows), "path", w.cfg.SpeedFile)
}

func (w *Worker) prune(ctx context.Context) {
	n, err := w.store.PrunePings(ctx, time.Now().Add(-w.cfg.Retention))
	if err != nil {
		w.log.Error("pruning pings", "err", err)
		return
	}
	if n > 0 {
		w.log.Info("pruned raw pings", "count", n)
	}
}
