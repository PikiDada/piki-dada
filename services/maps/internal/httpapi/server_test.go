package httpapi

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"pikidada.com/mapsplatform/internal/osrm"
	"pikidada.com/mapsplatform/internal/store"
)

type fakeStore struct {
	pings  []store.Ping
	places []store.PlaceInput
}

func (f *fakeStore) Ping(context.Context) error { return nil }
func (f *fakeStore) InsertPings(_ context.Context, _ string, p []store.Ping) error {
	f.pings = append(f.pings, p...)
	return nil
}
func (f *fakeStore) RecordPlaces(_ context.Context, _ string, p []store.PlaceInput) error {
	f.places = append(f.places, p...)
	return nil
}
func (f *fakeStore) SearchPlaces(context.Context, string, int) ([]store.Place, error) {
	return []store.Place{}, nil
}
func (f *fakeStore) Stats(context.Context, int) (store.Stats, error) { return store.Stats{}, nil }

type fakeRouter struct{ got []osrm.Point }

func (f *fakeRouter) Route(_ context.Context, p []osrm.Point) (osrm.Route, error) {
	f.got = p
	return osrm.Route{DistanceM: 12000, DurationS: 1500}, nil
}

func setup() (http.Handler, *fakeStore, *fakeRouter) {
	st, rt := &fakeStore{}, &fakeRouter{}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	return New(st, rt, "secret", 3, log), st, rt
}

func do(h http.Handler, method, path, token, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestRejectsWrongToken(t *testing.T) {
	h, st, _ := setup()
	rec := do(h, "POST", "/v1/pings", "wrong",
		`{"source":"pikidada","pings":[{"journeyId":"trip:1","lat":0.3,"lng":32.5,"recordedAt":"2026-10-05T09:00:00Z"}]}`)
	if rec.Code != http.StatusUnauthorized || len(st.pings) != 0 {
		t.Fatalf("got %d with %d pings stored", rec.Code, len(st.pings))
	}
}

func TestHealthNeedsNoToken(t *testing.T) {
	h, _, _ := setup()
	if rec := do(h, "GET", "/health", "", ""); rec.Code != http.StatusOK {
		t.Fatalf("got %d", rec.Code)
	}
}

func TestStoresValidPings(t *testing.T) {
	h, st, _ := setup()
	rec := do(h, "POST", "/v1/pings", "secret",
		`{"source":"pikidada","pings":[{"journeyId":"trip:1","lat":0.3,"lng":32.5,"recordedAt":"2026-10-05T09:00:00Z"}]}`)
	if rec.Code != http.StatusAccepted || len(st.pings) != 1 {
		t.Fatalf("got %d with %d pings stored: %s", rec.Code, len(st.pings), rec.Body)
	}
}

func TestRejectsImpossiblePosition(t *testing.T) {
	h, st, _ := setup()
	rec := do(h, "POST", "/v1/pings", "secret",
		`{"source":"pikidada","pings":[{"journeyId":"trip:1","lat":95,"lng":32.5,"recordedAt":"2026-10-05T09:00:00Z"}]}`)
	if rec.Code != http.StatusBadRequest || len(st.pings) != 0 {
		t.Fatalf("got %d", rec.Code)
	}
}

func TestRouteReturnsKmAndMinutes(t *testing.T) {
	h, _, rt := setup()
	rec := do(h, "POST", "/v1/route", "secret",
		`{"points":[{"lat":0.31,"lng":32.58},{"lat":0.33,"lng":32.57},{"lat":0.36,"lng":32.62}]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("got %d: %s", rec.Code, rec.Body)
	}
	if len(rt.got) != 3 {
		t.Fatalf("router got %d points", len(rt.got))
	}
	if want := `{"distanceKm":12,"durationMin":25}`; strings.TrimSpace(rec.Body.String()) != want {
		t.Fatalf("got %s, want %s", rec.Body, want)
	}
}
