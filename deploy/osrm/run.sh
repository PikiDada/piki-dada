#!/bin/sh
# Entrypoint for the osrm service. Applies the road speeds the maps platform has learned from
# real trips (/traffic/speeds.csv, written by services/maps), then serves routes. Repeats every
# day at 00:00 UTC (03:00 in Kampala), so routing keeps improving as the platform learns.
#
# OSRM is briefly down while speeds are applied; Piki Dada's pricing falls back to Google
# Routes for those minutes.
set -eu

DATA=/data/uganda-latest.osrm
SPEEDS=/traffic/speeds.csv
pid=""

stop() {
	[ -n "$pid" ] && kill "$pid" 2>/dev/null && wait "$pid" 2>/dev/null
	exit 0
}
trap stop TERM INT

while true; do
	if [ -s "$SPEEDS" ]; then
		echo "Applying learned speeds for $(wc -l < "$SPEEDS") road segments"
		# Each run starts from the extracted base data, so speeds never compound.
		osrm-customize "$DATA" --segment-speed-file "$SPEEDS" \
			|| echo "osrm-customize failed; serving the previous data"
	fi

	# --mmap reads the routing data from disk on demand instead of loading it all into RAM.
	osrm-routed --algorithm mld --mmap "$DATA" &
	pid=$!

	next=$(( ($(date -u +%s) / 86400 + 1) * 86400 ))
	while [ "$(date -u +%s)" -lt "$next" ]; do
		# `sleep & wait` rather than plain sleep, so a stop signal is handled immediately.
		sleep 60 &
		wait $! || true
		# If the router died, exit so Docker's restart policy brings it back now rather
		# than routing staying down until tomorrow's cycle.
		if ! kill -0 "$pid" 2>/dev/null; then
			echo "osrm-routed exited unexpectedly"
			exit 1
		fi
	done

	kill "$pid" 2>/dev/null || true
	wait "$pid" 2>/dev/null || true
	pid=""
done
