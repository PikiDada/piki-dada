package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"pikidada.com/mapsplatform/internal/learn"
	"pikidada.com/mapsplatform/internal/osrm"
	"pikidada.com/mapsplatform/internal/store"
)

type fakeStore struct {
	pings  []store.Ping
	places []store.PlaceInput
	// Learned speeds by band, and what BandSpeeds was last asked.
	speeds    map[int]map[learn.Segment]float64
	speedsErr error
	gotBand   int
	gotSegs   []learn.Segment
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
func (f *fakeStore) BandSpeeds(_ context.Context, segs []learn.Segment, band, _ int) (map[learn.Segment]float64, error) {
	f.gotSegs, f.gotBand = segs, band
	return f.speeds[band], f.speedsErr
}

type fakeRouter struct{ got []osrm.Point }

func (f *fakeRouter) Route(_ context.Context, p []osrm.Point) (osrm.Route, error) {
	f.got = p
	// 12 km in 25 min. The first leg's single segment, 1->2, is 6 km taking OSRM 600 s.
	return osrm.Route{DistanceM: 12000, DurationS: 1500, Legs: []osrm.RouteLeg{
		{Annotation: osrm.RouteAnnotation{Nodes: []int64{1, 2}, Distance: []float64{6000}, Duration: []float64{600}}},
		{Annotation: osrm.RouteAnnotation{Nodes: []int64{2, 3}, Distance: []float64{6000}, Duration: []float64{900}}},
	}}, nil
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
	var got map[string]float64
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got["distanceKm"] != 12 || got["durationMin"] != 25 || got["learnedShare"] != 0 {
		t.Fatalf("got %s", rec.Body)
	}
	if b := got["timeBand"]; b < 1 || b > 4 {
		t.Fatalf("timeBand %v, want 1-4", b)
	}
}

func TestRouteUsesSpeedsLearnedForTheDepartureBand(t *testing.T) {
	h, st, _ := setup()
	st.speeds = map[int]map[learn.Segment]float64{
		// Evening rush: 1->2 crawls at 12 km/h, so 6 km takes 30 min instead of 10.
		learn.BandEveningRush: {{From: 1, To: 2}: 12},
		learn.BandMidday:      {{From: 1, To: 2}: 60},
	}
	rec := do(h, "POST", "/v1/route", "secret",
		`{"points":[{"lat":0.31,"lng":32.58},{"lat":0.33,"lng":32.57}],"departAt":"2026-10-05T15:00:00Z"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("got %d: %s", rec.Code, rec.Body)
	}
	if st.gotBand != learn.BandEveningRush { // 18:00 in Kampala
		t.Fatalf("looked up band %d", st.gotBand)
	}
	if len(st.gotSegs) != 2 {
		t.Fatalf("looked up segments %v", st.gotSegs)
	}
	if want := `{"distanceKm":12,"durationMin":45,"timeBand":4,"learnedShare":0.5}`; strings.TrimSpace(rec.Body.String()) != want {
		t.Fatalf("got %s, want %s", rec.Body, want)
	}
}

func TestRouteFallsBackToOSRMWhenLookupFails(t *testing.T) {
	h, st, _ := setup()
	st.speedsErr = errors.New("database down")
	rec := do(h, "POST", "/v1/route", "secret",
		`{"points":[{"lat":0.31,"lng":32.58},{"lat":0.33,"lng":32.57}],"departAt":"2026-10-05T08:00:00+03:00"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("got %d: %s", rec.Code, rec.Body)
	}
	if want := `{"distanceKm":12,"durationMin":25,"timeBand":2,"learnedShare":0}`; strings.TrimSpace(rec.Body.String()) != want {
		t.Fatalf("got %s, want %s", rec.Body, want)
	}
}

func TestRouteRejectsBadDepartAt(t *testing.T) {
	h, _, _ := setup()
	rec := do(h, "POST", "/v1/route", "secret",
		`{"points":[{"lat":0.31,"lng":32.58},{"lat":0.33,"lng":32.57}],"departAt":"6pm"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("got %d: %s", rec.Code, rec.Body)
	}
}
