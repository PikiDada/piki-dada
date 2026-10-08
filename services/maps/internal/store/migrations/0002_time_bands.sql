-- Speeds are now learned per time of day as well as for the whole day (see learn/bands.go
-- for the bands). Band 0 is the all-day speed, the only one exported to OSRM's speed file, so
-- everything learned before this migration stays exactly what it was.
ALTER TABLE segment_speeds ADD COLUMN band SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE segment_speeds DROP CONSTRAINT segment_speeds_pkey;
ALTER TABLE segment_speeds ADD PRIMARY KEY (from_node, to_node, band);
