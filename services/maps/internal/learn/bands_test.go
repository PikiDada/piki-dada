package learn

import (
	"testing"
	"time"
)

func TestBandAtBoundariesInKampalaTime(t *testing.T) {
	eat := time.FixedZone("EAT", 3*60*60)
	at := func(h, m, s int) time.Time { return time.Date(2026, 10, 5, h, m, s, 0, eat) }
	cases := []struct {
		t    time.Time
		want int
	}{
		{at(0, 0, 0), BandNight},
		{at(5, 59, 59), BandNight},
		{at(6, 0, 0), BandMorningRush},
		{at(9, 59, 59), BandMorningRush},
		{at(10, 0, 0), BandMidday},
		{at(15, 59, 59), BandMidday},
		{at(16, 0, 0), BandEveningRush},
		{at(20, 59, 59), BandEveningRush},
		{at(21, 0, 0), BandNight},
		{at(23, 59, 59), BandNight},
	}
	for _, c := range cases {
		if got := BandAt(c.t); got != c.want {
			t.Errorf("%s: got band %d, want %d", c.t.Format("15:04:05"), got, c.want)
		}
	}
}

func TestBandAtConvertsFromUTC(t *testing.T) {
	cases := []struct {
		utc  string
		want int
	}{
		{"2026-10-05T03:00:00Z", BandMorningRush}, // 06:00 in Kampala
		{"2026-10-05T02:59:59Z", BandNight},       // 05:59:59
		{"2026-10-05T13:00:00Z", BandEveningRush}, // 16:00
		{"2026-10-05T18:00:00Z", BandNight},       // 21:00
		{"2026-10-05T22:30:00Z", BandNight},       // 01:30 the next day
		{"2026-10-05T11:00:00+03:00", BandMidday}, // an offset already in Kampala time
	}
	for _, c := range cases {
		ts, err := time.Parse(time.RFC3339, c.utc)
		if err != nil {
			t.Fatal(err)
		}
		if got := BandAt(ts); got != c.want {
			t.Errorf("%s: got band %d, want %d", c.utc, got, c.want)
		}
	}
}
