package learn

import (
	"bufio"
	"fmt"
	"math"
	"os"
	"path/filepath"
)

type SegmentSpeed struct {
	Segment
	SpeedKmh float64
}

// WriteSpeedFile writes OSRM's segment speed format (from_osm_node,to_osm_node,km/h), which
// osrm-customize applies over the profile's default speeds. Written to a temp file and
// renamed into place, so OSRM never reads a half-written file.
func WriteSpeedFile(path string, rows []SegmentSpeed) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".speeds-*.csv")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())

	w := bufio.NewWriter(tmp)
	for _, r := range rows {
		// OSRM takes whole km/h; never 0, which it would read as "road closed".
		kmh := math.Max(1, math.Round(r.SpeedKmh))
		if _, err := fmt.Fprintf(w, "%d,%d,%d\n", r.From, r.To, int(kmh)); err != nil {
			tmp.Close()
			return err
		}
	}
	if err := w.Flush(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmp.Name(), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}
