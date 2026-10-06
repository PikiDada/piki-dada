package learn

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWriteSpeedFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "traffic", "speeds.csv")
	err := WriteSpeedFile(path, []SegmentSpeed{
		{Segment{10, 11}, 23.6},
		{Segment{11, 12}, 0.2},
	})
	if err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if want := "10,11,24\n11,12,1\n"; string(got) != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}
