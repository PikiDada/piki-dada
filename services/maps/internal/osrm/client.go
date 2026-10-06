// Package osrm talks to the self-hosted OSRM routing engine: routes for pricing, and
// map-matching of GPS traces for learning real road speeds.
package osrm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// MaxMatchPoints is osrm-routed's default --max-matching-size. Longer traces are matched in
// overlapping windows of this size.
const MaxMatchPoints = 100

// ErrNoMatch means OSRM could not snap the trace to any road. Not a failure of the service:
// the trace simply teaches nothing.
var ErrNoMatch = errors.New("osrm: trace could not be matched to the road network")

type Point struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

type TracePoint struct {
	Point
	Unix int64
}

type Client struct {
	baseURL string
	http    *http.Client
	// GPS error tolerance in metres for map-matching. OSRM's default (5 m) is tighter than
	// typical phone GPS between Kampala's buildings.
	matchRadiusM int
}

func New(baseURL string, matchRadiusM int) *Client {
	return &Client{
		baseURL:      strings.TrimRight(baseURL, "/"),
		http:         &http.Client{Timeout: 10 * time.Second},
		matchRadiusM: matchRadiusM,
	}
}

type Route struct {
	DistanceM float64
	DurationS float64
}

func (c *Client) Route(ctx context.Context, points []Point) (Route, error) {
	var body struct {
		Code    string `json:"code"`
		Message string `json:"message"`
		Routes  []struct {
			Distance float64 `json:"distance"`
			Duration float64 `json:"duration"`
		} `json:"routes"`
	}
	url := fmt.Sprintf("%s/route/v1/driving/%s?overview=false", c.baseURL, coords(points))
	if err := c.getJSON(ctx, url, &body); err != nil {
		return Route{}, err
	}
	if body.Code != "Ok" || len(body.Routes) == 0 {
		return Route{}, fmt.Errorf("osrm route: %s %s", body.Code, body.Message)
	}
	return Route{DistanceM: body.Routes[0].Distance, DurationS: body.Routes[0].Duration}, nil
}

// MatchResponse is the part of OSRM's /match response the learner needs.
type MatchResponse struct {
	Code        string        `json:"code"`
	Message     string        `json:"message"`
	Tracepoints []*Tracepoint `json:"tracepoints"`
	Matchings   []Matching    `json:"matchings"`
}

// Tracepoint is nil (JSON null) for input points OSRM dropped as noise.
type Tracepoint struct {
	MatchingsIndex int `json:"matchings_index"`
	WaypointIndex  int `json:"waypoint_index"`
}

type Matching struct {
	Confidence float64 `json:"confidence"`
	Legs       []Leg   `json:"legs"`
}

// Leg runs between two consecutive matched points. Annotation.Nodes are the OSM node ids it
// passes through, so consecutive pairs are the road segments OSRM's speed file is keyed by.
type Leg struct {
	Distance   float64 `json:"distance"`
	Annotation struct {
		Nodes []int64 `json:"nodes"`
	} `json:"annotation"`
}

func (c *Client) Match(ctx context.Context, trace []TracePoint) (*MatchResponse, error) {
	points := make([]Point, len(trace))
	stamps := make([]string, len(trace))
	radii := make([]string, len(trace))
	for i, p := range trace {
		points[i] = p.Point
		stamps[i] = strconv.FormatInt(p.Unix, 10)
		radii[i] = strconv.Itoa(c.matchRadiusM)
	}
	url := fmt.Sprintf(
		"%s/match/v1/driving/%s?timestamps=%s&radiuses=%s&annotations=nodes&overview=false&gaps=split&tidy=true",
		c.baseURL, coords(points), strings.Join(stamps, ";"), strings.Join(radii, ";"),
	)
	var body MatchResponse
	if err := c.getJSON(ctx, url, &body); err != nil {
		return nil, err
	}
	switch body.Code {
	case "Ok":
		return &body, nil
	case "NoMatch", "NoSegment":
		return nil, ErrNoMatch
	default:
		return nil, fmt.Errorf("osrm match: %s %s", body.Code, body.Message)
	}
}

// getJSON decodes OSRM's body even on 4xx, because "NoMatch" arrives as HTTP 400 with a JSON
// code; only transport failures and 5xx count as errors.
func (c *Client) getJSON(ctx context.Context, url string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	res, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 500 {
		msg, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		return fmt.Errorf("osrm: HTTP %d: %s", res.StatusCode, msg)
	}
	return json.NewDecoder(res.Body).Decode(out)
}

// OSRM wants lng,lat -- the reverse of everything else here.
func coords(points []Point) string {
	parts := make([]string, len(points))
	for i, p := range points {
		parts[i] = strconv.FormatFloat(p.Lng, 'f', 6, 64) + "," + strconv.FormatFloat(p.Lat, 'f', 6, 64)
	}
	return strings.Join(parts, ";")
}
