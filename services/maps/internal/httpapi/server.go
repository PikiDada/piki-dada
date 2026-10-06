// Package httpapi is the platform's internal API. Every product (Piki Dada today) talks to
// it with a bearer token; it is not exposed to the internet.
package httpapi

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"pikidada.com/mapsplatform/internal/osrm"
	"pikidada.com/mapsplatform/internal/store"
)

const (
	maxBodyBytes  = 1 << 20
	maxPings      = 1000
	maxPlaces     = 100
	maxRoutePoint = 25
)

// Store is the part of store.Store the API uses; an interface so handlers can be tested
// without a database.
type Store interface {
	Ping(ctx context.Context) error
	InsertPings(ctx context.Context, source string, pings []store.Ping) error
	RecordPlaces(ctx context.Context, source string, in []store.PlaceInput) error
	SearchPlaces(ctx context.Context, query string, limit int) ([]store.Place, error)
	Stats(ctx context.Context, minSamples int) (store.Stats, error)
}

type Router interface {
	Route(ctx context.Context, points []osrm.Point) (osrm.Route, error)
}

type Server struct {
	store      Store
	router     Router
	token      string
	minSamples int
	log        *slog.Logger
}

func New(s Store, r Router, token string, minSamples int, log *slog.Logger) http.Handler {
	srv := &Server{store: s, router: r, token: token, minSamples: minSamples, log: log}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", srv.health)
	mux.Handle("POST /v1/pings", srv.auth(srv.pings))
	mux.Handle("POST /v1/places", srv.auth(srv.recordPlaces))
	mux.Handle("GET /v1/places/search", srv.auth(srv.searchPlaces))
	mux.Handle("POST /v1/route", srv.auth(srv.route))
	mux.Handle("GET /v1/stats", srv.auth(srv.stats))
	return mux
}

func (s *Server) auth(next http.HandlerFunc) http.Handler {
	want := []byte("Bearer " + s.token)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got := []byte(r.Header.Get("Authorization"))
		if subtle.ConstantTimeCompare(got, want) != 1 {
			writeError(w, http.StatusUnauthorized, "missing or invalid token")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
		next(w, r)
	})
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	if err := s.store.Ping(r.Context()); err != nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

type pingsRequest struct {
	Source string `json:"source"`
	Pings  []struct {
		JourneyID  string    `json:"journeyId"`
		Lat        float64   `json:"lat"`
		Lng        float64   `json:"lng"`
		RecordedAt time.Time `json:"recordedAt"`
	} `json:"pings"`
}

func (s *Server) pings(w http.ResponseWriter, r *http.Request) {
	var req pingsRequest
	if !decode(w, r, &req) {
		return
	}
	if !validSource(req.Source) || len(req.Pings) == 0 || len(req.Pings) > maxPings {
		writeError(w, http.StatusBadRequest, "need a source and 1-1000 pings")
		return
	}
	latest := time.Now().Add(5 * time.Minute)
	pings := make([]store.Ping, 0, len(req.Pings))
	for _, p := range req.Pings {
		if p.JourneyID == "" || len(p.JourneyID) > 128 || !validPosition(p.Lat, p.Lng) ||
			p.RecordedAt.IsZero() || p.RecordedAt.After(latest) {
			writeError(w, http.StatusBadRequest, "invalid ping")
			return
		}
		pings = append(pings, store.Ping{
			JourneyID: p.JourneyID, Lat: p.Lat, Lng: p.Lng, RecordedAt: p.RecordedAt,
		})
	}
	if err := s.store.InsertPings(r.Context(), req.Source, pings); err != nil {
		s.fail(w, "storing pings", err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]int{"accepted": len(pings)})
}

type placesRequest struct {
	Source string `json:"source"`
	Places []struct {
		Label string  `json:"label"`
		Lat   float64 `json:"lat"`
		Lng   float64 `json:"lng"`
	} `json:"places"`
}

func (s *Server) recordPlaces(w http.ResponseWriter, r *http.Request) {
	var req placesRequest
	if !decode(w, r, &req) {
		return
	}
	if !validSource(req.Source) || len(req.Places) > maxPlaces {
		writeError(w, http.StatusBadRequest, "need a source and at most 100 places")
		return
	}
	in := make([]store.PlaceInput, 0, len(req.Places))
	for _, p := range req.Places {
		label := strings.TrimSpace(p.Label)
		if label == "" || len(label) > 200 || !validPosition(p.Lat, p.Lng) {
			writeError(w, http.StatusBadRequest, "invalid place")
			return
		}
		in = append(in, store.PlaceInput{Label: label, Lat: p.Lat, Lng: p.Lng})
	}
	if err := s.store.RecordPlaces(r.Context(), req.Source, in); err != nil {
		s.fail(w, "storing places", err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]int{"accepted": len(in)})
}

func (s *Server) searchPlaces(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	limit, err := strconv.Atoi(r.URL.Query().Get("limit"))
	if err != nil || limit < 1 || limit > 20 {
		limit = 8
	}
	if len(q) > 200 {
		writeError(w, http.StatusBadRequest, "query too long")
		return
	}
	results, err := s.store.SearchPlaces(r.Context(), q, limit)
	if err != nil {
		s.fail(w, "searching places", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"places": results})
}

type routeRequest struct {
	Points []osrm.Point `json:"points"`
}

func (s *Server) route(w http.ResponseWriter, r *http.Request) {
	var req routeRequest
	if !decode(w, r, &req) {
		return
	}
	if len(req.Points) < 2 || len(req.Points) > maxRoutePoint {
		writeError(w, http.StatusBadRequest, "need 2-25 points")
		return
	}
	for _, p := range req.Points {
		if !validPosition(p.Lat, p.Lng) {
			writeError(w, http.StatusBadRequest, "invalid point")
			return
		}
	}
	route, err := s.router.Route(r.Context(), req.Points)
	if err != nil {
		s.log.Warn("routing failed", "err", err)
		writeError(w, http.StatusBadGateway, "routing unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]float64{
		"distanceKm":  route.DistanceM / 1000,
		"durationMin": route.DurationS / 60,
	})
}

func (s *Server) stats(w http.ResponseWriter, r *http.Request) {
	st, err := s.store.Stats(r.Context(), s.minSamples)
	if err != nil {
		s.fail(w, "reading stats", err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (s *Server) fail(w http.ResponseWriter, what string, err error) {
	s.log.Error(what, "err", err)
	writeError(w, http.StatusInternalServerError, "internal error")
}

func validSource(s string) bool { return s != "" && len(s) <= 64 }

func validPosition(lat, lng float64) bool {
	return !math.IsNaN(lat) && !math.IsNaN(lng) &&
		lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}

func decode(w http.ResponseWriter, r *http.Request, out any) bool {
	if err := json.NewDecoder(r.Body).Decode(out); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeError(w, http.StatusRequestEntityTooLarge, "body too large")
		} else {
			writeError(w, http.StatusBadRequest, "invalid JSON")
		}
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
