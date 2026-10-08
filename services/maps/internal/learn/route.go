package learn

import "pikidada.com/mapsplatform/internal/osrm"

// RouteSegments lists the road segments of a route's legs that are worth looking up a
// learned speed for, without repeats. Legs whose annotation is malformed are skipped, the
// same way AdjustDuration skips them.
func RouteSegments(legs []osrm.RouteLeg) []Segment {
	seen := map[Segment]bool{}
	var out []Segment
	for _, leg := range legs {
		if !wellFormed(leg.Annotation) {
			continue
		}
		nodes := leg.Annotation.Nodes
		for i := 0; i+1 < len(nodes); i++ {
			seg := Segment{From: nodes[i], To: nodes[i+1]}
			if seg.From == seg.To || seen[seg] {
				continue
			}
			seen[seg] = true
			out = append(out, seg)
		}
	}
	return out
}

// AdjustDuration re-times a route with learned speeds: each segment that has one (in
// learned, km/h) takes its distance at that speed instead of OSRM's estimate; every other
// segment keeps OSRM's time.
//
// It starts from OSRM's whole-route duration and swaps out only the learned segments' times,
// rather than summing the segments, because OSRM's per-segment durations leave out turn
// penalties that its total includes. With nothing learned it returns exactly OSRM's duration.
//
// learnedShare is the fraction (0-1) of the route's distance timed from learned speeds, so
// callers can tell how much of the answer is OSRM's guess.
func AdjustDuration(route osrm.Route, learned map[Segment]float64) (durationS, learnedShare float64) {
	durationS = route.DurationS
	var totalM, learnedM float64
	for _, leg := range route.Legs {
		a := leg.Annotation
		if !wellFormed(a) {
			continue
		}
		// Nodes has one more entry than Distance and Duration: segment i runs from node i to
		// node i+1. Pairs are only taken within a leg: the gap between one leg's last node
		// and the next leg's first is not a road segment.
		for i, metres := range a.Distance {
			totalM += metres
			kmh := learned[Segment{From: a.Nodes[i], To: a.Nodes[i+1]}]
			if kmh <= 0 {
				continue
			}
			durationS += metres/kmh*3.6 - a.Duration[i]
			learnedM += metres
		}
	}
	if durationS < 0 {
		// Only reachable with an inconsistent OSRM response; don't price a negative trip.
		return route.DurationS, 0
	}
	if totalM > 0 {
		learnedShare = min(learnedM/totalM, 1)
	}
	return durationS, learnedShare
}

// wellFormed reports whether an annotation has one distance and one duration per pair of
// nodes. Anything else can't be lined up with the nodes, so the leg is left to OSRM.
func wellFormed(a osrm.RouteAnnotation) bool {
	return len(a.Nodes) >= 2 && len(a.Distance) == len(a.Nodes)-1 && len(a.Duration) == len(a.Distance)
}
