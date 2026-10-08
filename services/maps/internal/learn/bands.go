package learn

import "time"

// Time bands: Kampala's roads are far slower at rush hour than at midday, so speeds are
// learned per band as well as for the whole day. This is the one place the bands are
// defined; the database stores the band number (segment_speeds.band), so changing the hours
// here changes what new observations mean, and renumbering would mix up what was learned.
//
// Hours are Kampala local time (UTC+3, no daylight saving). Each band starts on its hour and
// runs up to, not including, the next band's start.
const (
	// BandAllDay is every observation regardless of time: the speed OSRM itself routes with.
	BandAllDay = 0
	// BandNight is 21:00-06:00.
	BandNight = 1
	// BandMorningRush is 06:00-10:00.
	BandMorningRush = 2
	// BandMidday is 10:00-16:00.
	BandMidday = 3
	// BandEveningRush is 16:00-21:00.
	BandEveningRush = 4
)

// kampala is a fixed offset rather than time.LoadLocation("Africa/Kampala"): Uganda has no
// daylight saving, and the runtime image (distroless) carries no time zone database.
var kampala = time.FixedZone("EAT", 3*60*60)

// BandAt returns the time band (1-4, never BandAllDay) that t falls in, in Kampala time.
func BandAt(t time.Time) int {
	switch h := t.In(kampala).Hour(); {
	case h >= 21 || h < 6:
		return BandNight
	case h < 10:
		return BandMorningRush
	case h < 16:
		return BandMidday
	default:
		return BandEveningRush
	}
}
