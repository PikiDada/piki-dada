// Package places is the platform's own gazetteer: every address a customer picks in any
// product is recorded, so address search improves with use and depends less on Google.
package places

import (
	"fmt"
	"math"
	"strings"
	"unicode"
)

// Normalize makes labels comparable: lower case, punctuation as spaces, single spaces.
// "Acacia Mall, Kisementi" and "acacia mall kisementi" become the same entry.
func Normalize(label string) string {
	var b strings.Builder
	space := false
	for _, r := range strings.ToLower(label) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			if space && b.Len() > 0 {
				b.WriteByte(' ')
			}
			b.WriteRune(r)
			space = false
		} else {
			space = true
		}
	}
	return b.String()
}

// Cell buckets a position into a roughly 100 m grid square, so the same name picked a few
// metres apart merges into one place, while "Shell petrol station" in two towns stays two.
func Cell(lat, lng float64) string {
	return fmt.Sprintf("%d:%d", int(math.Floor(lat*1000)), int(math.Floor(lng*1000)))
}
