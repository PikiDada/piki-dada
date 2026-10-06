// Command mapsd runs the maps platform: an internal API for routing, GPS trace ingestion and
// address search, plus the background loop that learns road speeds from those traces and
// feeds them back into OSRM.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"pikidada.com/mapsplatform/internal/httpapi"
	"pikidada.com/mapsplatform/internal/osrm"
	"pikidada.com/mapsplatform/internal/store"
	"pikidada.com/mapsplatform/internal/worker"
)

func main() {
	// The runtime image has no shell or curl, so Docker's healthcheck runs the binary itself.
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		os.Exit(healthcheck())
	}

	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(log); err != nil {
		log.Error("exiting", "err", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	token := os.Getenv("API_TOKEN")
	osrmURL := os.Getenv("OSRM_URL")
	if token == "" || osrmURL == "" {
		return errors.New("API_TOKEN and OSRM_URL are required")
	}
	minSamples := envInt("MIN_SEGMENT_SAMPLES", 3)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// DATABASE_URL, or the standard PG* variables when it's empty.
	db, err := store.Open(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		return fmt.Errorf("opening database: %w", err)
	}
	defer db.Close()

	router := osrm.New(osrmURL, envInt("MATCH_RADIUS_METRES", 20))

	worker.New(db, router, worker.Config{
		IdleAfter:     time.Duration(envInt("JOURNEY_IDLE_MINUTES", 10)) * time.Minute,
		MinSamples:    minSamples,
		MaxWeight:     envInt("MAX_SAMPLE_WEIGHT", 50),
		MinConfidence: 0.5,
		SpeedFile:     envString("SPEED_FILE", "/traffic/speeds.csv"),
		Retention:     time.Duration(envInt("RAW_PING_RETENTION_DAYS", 180)) * 24 * time.Hour,
	}, log).Run(ctx)

	srv := &http.Server{
		Addr:              envString("LISTEN_ADDR", ":8080"),
		Handler:           httpapi.New(db, router, token, minSamples, log),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	errs := make(chan error, 1)
	go func() { errs <- srv.ListenAndServe() }()
	log.Info("maps platform listening", "addr", srv.Addr)

	select {
	case err := <-errs:
		return err
	case <-ctx.Done():
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return srv.Shutdown(shutdown)
}

func healthcheck() int {
	addr := envString("LISTEN_ADDR", ":8080")
	client := &http.Client{Timeout: 3 * time.Second}
	res, err := client.Get("http://localhost" + addr + "/health")
	if err != nil {
		return 1
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}

func envString(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	if v, err := strconv.Atoi(os.Getenv(key)); err == nil && v > 0 {
		return v
	}
	return fallback
}
