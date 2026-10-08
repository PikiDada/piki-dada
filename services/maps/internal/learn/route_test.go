package learn

import (
	"testing"

	"pikidada.com/mapsplatform/internal/osrm"
)

func leg(nodes []int64, metres, seconds []float64) osrm.RouteLeg {
	return osrm.RouteLeg{Annotation: osrm.RouteAnnotation{Nodes: nodes, Distance: metres, Duration: seconds}}
}

// Two legs, 1->2->3 then 3->4. OSRM's total (130 s) is more than the segments' sum (110 s)
// because it includes turn penalties.
func testRoute() osrm.Route {
	return osrm.Route{
		DistanceM: 1000,
		DurationS: 130,
		Legs: []osrm.RouteLeg{
			leg([]int64{1, 2, 3}, []float64{300, 200}, []float64{30, 20}),
			leg([]int64{3, 4}, []float64{500}, []float64{60}),
		},
	}
}

func TestAdjustDurationWithNothingLearnedIsOSRMs(t *testing.T) {
	d, share := AdjustDuration(testRoute(), nil)
	if d != 130 || share != 0 {
		t.Fatalf("got %.2f s, share %.2f; want OSRM's 130 s and 0", d, share)
	}
}

func TestAdjustDurationSwapsInLearnedSegments(t *testing.T) {
	// 300 m at 18 km/h is 60 s instead of 30; 500 m at 36 km/h is 50 s instead of 60.
	d, share := AdjustDuration(testRoute(), map[Segment]float64{
		{1, 2}: 18,
		{3, 4}: 36,
		{2, 1}: 1, // the opposite direction: a different segment, must not be used
	})
	if want := 130.0 + 30 - 10; !near(d, want) {
		t.Errorf("duration: got %.2f s, want %.2f", d, want)
	}
	if !near(share, 0.8) {
		t.Errorf("learned share: got %.2f, want 0.80", share)
	}
}

func TestAdjustDurationDoesNotPairNodesAcrossLegs(t *testing.T) {
	r := osrm.Route{DurationS: 100, Legs: []osrm.RouteLeg{
		leg([]int64{1, 2}, []float64{100}, []float64{50}),
		leg([]int64{3, 4}, []float64{100}, []float64{50}),
	}}
	// 2->3 is where one leg ends and the next starts, not a segment of the route.
	d, share := AdjustDuration(r, map[Segment]float64{{2, 3}: 1})
	if d != 100 || share != 0 {
		t.Fatalf("got %.2f s, share %.2f", d, share)
	}
	segs := RouteSegments(r.Legs)
	if len(segs) != 2 || segs[0] != (Segment{1, 2}) || segs[1] != (Segment{3, 4}) {
		t.Fatalf("route segments: %v", segs)
	}
}

func TestAdjustDurationLeavesMalformedLegsToOSRM(t *testing.T) {
	r := osrm.Route{DurationS: 100, Legs: []osrm.RouteLeg{
		// As many distances as nodes: can't be lined up, so the whole leg is skipped.
		leg([]int64{1, 2}, []float64{100, 100}, []float64{50, 50}),
		leg([]int64{5, 6}, []float64{100}, []float64{40}),
	}}
	learned := map[Segment]float64{{1, 2}: 1, {5, 6}: 18} // 100 m at 18 km/h = 20 s
	d, share := AdjustDuration(r, learned)
	if !near(d, 80) || !near(share, 1) {
		t.Fatalf("got %.2f s, share %.2f; want 80 s, share 1", d, share)
	}
	if segs := RouteSegments(r.Legs); len(segs) != 1 || segs[0] != (Segment{5, 6}) {
		t.Fatalf("route segments: %v", segs)
	}
}

func TestRouteSegmentsSkipsRepeatsAndStandstills(t *testing.T) {
	segs := RouteSegments([]osrm.RouteLeg{
		leg([]int64{1, 1, 2}, []float64{0, 10}, []float64{0, 1}),
		leg([]int64{1, 2}, []float64{10}, []float64{1}),
	})
	if len(segs) != 1 || segs[0] != (Segment{1, 2}) {
		t.Fatalf("got %v", segs)
	}
}
