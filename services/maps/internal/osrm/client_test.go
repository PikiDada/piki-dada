package osrm

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMatchSendsLngLatTimestampsAndRadii(t *testing.T) {
	var gotPath, gotQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotQuery = r.URL.Path, r.URL.RawQuery
		w.Write([]byte(`{"code":"Ok","tracepoints":[],"matchings":[]}`))
	}))
	defer srv.Close()

	_, err := New(srv.URL, 20).Match(context.Background(), []TracePoint{
		{Point{Lat: 0.3136, Lng: 32.5811}, 100},
		{Point{Lat: 0.3354, Lng: 32.5695}, 160},
	})
	if err != nil {
		t.Fatal(err)
	}
	if want := "/match/v1/driving/32.581100,0.313600;32.569500,0.335400"; gotPath != want {
		t.Errorf("path %q, want %q", gotPath, want)
	}
	for _, part := range []string{"timestamps=100;160", "radiuses=20;20", "annotations=nodes"} {
		if !strings.Contains(gotQuery, part) {
			t.Errorf("query %q missing %q", gotQuery, part)
		}
	}
}

func TestMatchTreatsNoMatchAsNothingLearned(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"code":"NoMatch","message":"Could not match the trace."}`))
	}))
	defer srv.Close()

	_, err := New(srv.URL, 20).Match(context.Background(), []TracePoint{{}, {}})
	if !errors.Is(err, ErrNoMatch) {
		t.Fatalf("got %v, want ErrNoMatch", err)
	}
}

func TestServerErrorIsAnError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer srv.Close()

	_, err := New(srv.URL, 20).Route(context.Background(), []Point{{}, {}})
	if err == nil || errors.Is(err, ErrNoMatch) {
		t.Fatalf("got %v, want a server error", err)
	}
}
