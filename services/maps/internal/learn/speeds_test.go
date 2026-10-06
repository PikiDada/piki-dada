package learn

import (
	"encoding/json"
	"math"
	"testing"

	"pikidada.com/mapsplatform/internal/osrm"
)

// A trace of four points where OSRM dropped point 2 as noise (null tracepoint). Two legs
// remain: points 0->1 (500 m in 60 s = 30 km/h) and 1->3 (400 m in 120 s = 12 km/h).
const matchJSON = `{
  "code": "Ok",
  "tracepoints": [
    {"matchings_index": 0, "waypoint_index": 0},
    {"matchings_index": 0, "waypoint_index": 1},
    null,
    {"matchings_index": 0, "waypoint_index": 2}
  ],
  "matchings": [{
    "confidence": 0.9,
    "legs": [
      {"distance": 500, "annotation": {"nodes": [10, 11, 12]}},
      {"distance": 400, "annotation": {"nodes": [12, 13]}}
    ]
  }]
}`

func parse(t *testing.T, s string) *osrm.MatchResponse {
	t.Helper()
	var res osrm.MatchResponse
	if err := json.Unmarshal([]byte(s), &res); err != nil {
		t.Fatal(err)
	}
	return &res
}

func near(a, b float64) bool { return math.Abs(a-b) < 0.01 }

func TestObservedSpeedsUsesGPSTimestampsAcrossDroppedPoints(t *testing.T) {
	speeds := ObservedSpeeds(parse(t, matchJSON), []int64{0, 60, 90, 180}, 0.5)

	want := map[Segment]float64{
		{10, 11}: 30,
		{11, 12}: 30,
		{12, 13}: 12,
	}
	if len(speeds) != len(want) {
		t.Fatalf("got %d segments, want %d: %v", len(speeds), len(want), speeds)
	}
	for seg, kmh := range want {
		if !near(speeds[seg], kmh) {
			t.Errorf("segment %v: got %.2f km/h, want %.2f", seg, speeds[seg], kmh)
		}
	}
}

func TestObservedSpeedsSkipsLowConfidenceMatches(t *testing.T) {
	if got := ObservedSpeeds(parse(t, matchJSON), []int64{0, 60, 90, 180}, 0.95); len(got) != 0 {
		t.Fatalf("expected nothing from a low-confidence match, got %v", got)
	}
}

func TestObservedSpeedsIgnoresStandingStill(t *testing.T) {
	// 500 m over 20 minutes is 1.5 km/h: parked or waiting, not a road speed.
	got := ObservedSpeeds(parse(t, matchJSON), []int64{0, 1200, 1300, 1400}, 0.5)
	if _, ok := got[Segment{10, 11}]; ok {
		t.Fatalf("a near-stationary leg should not produce a speed: %v", got)
	}
}

func TestObservedSpeedsAveragesRepeatedSegmentsWithinOneTrace(t *testing.T) {
	res := parse(t, `{
	  "code": "Ok",
	  "tracepoints": [
	    {"matchings_index": 0, "waypoint_index": 0},
	    {"matchings_index": 0, "waypoint_index": 1},
	    {"matchings_index": 0, "waypoint_index": 2}
	  ],
	  "matchings": [{"confidence": 1, "legs": [
	    {"distance": 100, "annotation": {"nodes": [1, 2]}},
	    {"distance": 200, "annotation": {"nodes": [1, 2]}}
	  ]}]
	}`)
	// 100 m in 10 s = 36 km/h, then 200 m in 10 s = 72 km/h -> one reading of 54.
	got := ObservedSpeeds(res, []int64{0, 10, 20}, 0.5)
	if !near(got[Segment{1, 2}], 54) {
		t.Fatalf("got %.2f, want 54", got[Segment{1, 2}])
	}
}

func TestWindowsOverlapByOnePoint(t *testing.T) {
	trace := make([]osrm.TracePoint, 250)
	for i := range trace {
		trace[i].Unix = int64(i)
	}
	windows := Windows(trace, 100)
	if len(windows) != 3 {
		t.Fatalf("got %d windows, want 3", len(windows))
	}
	for i := 1; i < len(windows); i++ {
		prev := windows[i-1]
		if prev[len(prev)-1].Unix != windows[i][0].Unix {
			t.Errorf("window %d does not start where window %d ended", i, i-1)
		}
	}
	last := windows[len(windows)-1]
	if last[len(last)-1].Unix != 249 {
		t.Errorf("last point lost")
	}
}

func TestCleanDropsRepeatsAndBackwardsTime(t *testing.T) {
	p := func(lat float64, unix int64) osrm.TracePoint {
		return osrm.TracePoint{Point: osrm.Point{Lat: lat, Lng: 32.5}, Unix: unix}
	}
	// (0.30, 2) repeats the position; (0.32, 1) goes back in time.
	got := Clean([]osrm.TracePoint{p(0.30, 1), p(0.30, 2), p(0.31, 2), p(0.32, 1), p(0.33, 5)})
	if len(got) != 3 || got[0].Unix != 1 || got[1].Lat != 0.31 || got[2].Unix != 5 {
		t.Fatalf("unexpected cleaned trace: %+v", got)
	}
}
