package places

import "testing"

func TestNormalize(t *testing.T) {
	cases := map[string]string{
		"Acacia Mall, Kisementi":       "acacia mall kisementi",
		"  acacia   mall -- kisementi": "acacia mall kisementi",
		"Plot 12, Kampala Rd.":         "plot 12 kampala rd",
		"Café Javas":                   "café javas",
	}
	for in, want := range cases {
		if got := Normalize(in); got != want {
			t.Errorf("Normalize(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestCellMergesNearbyButNotDistantPoints(t *testing.T) {
	if Cell(0.31361, 32.58112) != Cell(0.31369, 32.58118) {
		t.Error("points a few metres apart should share a cell")
	}
	if Cell(0.3136, 32.5811) == Cell(0.0425, 32.4435) {
		t.Error("Kampala and Entebbe should not share a cell")
	}
}
