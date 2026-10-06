// Package learn turns raw GPS traces into what the platform knows about the road network:
// observed travel speeds per road segment, which are fed back into OSRM.
package learn

import (
	"sort"

	"pikidada.com/mapsplatform/internal/osrm"
)

const (
	// Below this the vehicle is parked, waiting at a stop or stuck at a gate, not "travelling
	// slowly": counting it would drag segment speeds towards zero.
	minSpeedKmh = 2
	// Above this the reading is GPS error, not a boda.
	maxSpeedKmh = 100
	// Legs shorter than this are dominated by GPS jitter.
	minLegMetres = 10
)

// Segment is a directed OSM road segment between two adjacent nodes.
type Segment struct {
	From int64
	To   int64
}

// ObservedSpeeds returns, for every road segment the matched trace passed along, the speed
// the vehicle actually travelled at, measured from the GPS timestamps (not OSRM's own
// estimate). When one trace passes a segment several times the readings are averaged, so a
// single journey counts once per segment.
//
// unixAt[i] is the timestamp of input point i of the trace that produced res.
func ObservedSpeeds(res *osrm.MatchResponse, unixAt []int64, minConfidence float64) map[Segment]float64 {
	sums := map[Segment]float64{}
	counts := map[Segment]int{}

	for m, matching := range res.Matchings {
		if matching.Confidence < minConfidence {
			continue
		}
		inputs := matchedInputs(res.Tracepoints, m)
		for k, leg := range matching.Legs {
			if k+1 >= len(inputs) {
				break
			}
			seconds := unixAt[inputs[k+1]] - unixAt[inputs[k]]
			if seconds <= 0 || leg.Distance < minLegMetres {
				continue
			}
			kmh := leg.Distance / float64(seconds) * 3.6
			if kmh < minSpeedKmh || kmh > maxSpeedKmh {
				continue
			}
			nodes := leg.Annotation.Nodes
			for i := 0; i+1 < len(nodes); i++ {
				if nodes[i] == nodes[i+1] {
					continue
				}
				seg := Segment{From: nodes[i], To: nodes[i+1]}
				sums[seg] += kmh
				counts[seg]++
			}
		}
	}

	speeds := make(map[Segment]float64, len(sums))
	for seg, sum := range sums {
		speeds[seg] = sum / float64(counts[seg])
	}
	return speeds
}

// matchedInputs lists the input-point indexes that matching m kept, in route order. Leg k of
// that matching runs from the k-th to the (k+1)-th of them.
func matchedInputs(tracepoints []*osrm.Tracepoint, m int) []int {
	type kept struct{ input, waypoint int }
	var points []kept
	for i, tp := range tracepoints {
		if tp != nil && tp.MatchingsIndex == m {
			points = append(points, kept{i, tp.WaypointIndex})
		}
	}
	sort.Slice(points, func(a, b int) bool { return points[a].waypoint < points[b].waypoint })
	inputs := make([]int, len(points))
	for i, p := range points {
		inputs[i] = p.input
	}
	return inputs
}

// Windows splits a trace into chunks OSRM will accept, overlapping by one point so the
// stretch between chunks is not lost.
func Windows(trace []osrm.TracePoint, size int) [][]osrm.TracePoint {
	if len(trace) <= size {
		return [][]osrm.TracePoint{trace}
	}
	var out [][]osrm.TracePoint
	for start := 0; start < len(trace)-1; start += size - 1 {
		end := start + size
		if end > len(trace) {
			end = len(trace)
		}
		out = append(out, trace[start:end])
		if end == len(trace) {
			break
		}
	}
	return out
}

// Clean drops points OSRM cannot use: a timestamp that doesn't move forward (OSRM requires
// strictly increasing timestamps), or an exact repeat of the previous position.
func Clean(trace []osrm.TracePoint) []osrm.TracePoint {
	out := make([]osrm.TracePoint, 0, len(trace))
	for _, p := range trace {
		if n := len(out); n > 0 {
			prev := out[n-1]
			if p.Unix <= prev.Unix || p.Point == prev.Point {
				continue
			}
		}
		out = append(out, p)
	}
	return out
}
