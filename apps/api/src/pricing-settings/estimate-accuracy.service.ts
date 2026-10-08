import { Injectable } from '@nestjs/common';
import { PricingSettings, RideType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PricingSettingsService } from './pricing-settings.service';
import { bandSql, TIME_BANDS, type TimeBand } from '../common/time-bands';

// How far the routing estimates are from what really happened, per ride type (deliveries as
// one kind) and time of day, measured on our own completed trips. It drives two things:
//  - the /admin/estimate-accuracy report, including how the maps platform's shadow quotes
//    compare (the evaluation of whether it can replace Google);
//  - the optional correction of Google's durations (see PricingSettings.durationCorrection*).
//
// Medians, not averages: one trip where the rider forgot to tap Complete would drag an average
// a long way. Only Google-priced trips count, and rides with a stop never reached are left out
// because their estimate covered more road than was driven.

const WINDOW_DAYS = 60;
const CACHE_MS = 60 * 60 * 1000;

export type EstimateKind = RideType | 'DELIVERY';

export interface AccuracyRow {
  kind: EstimateKind;
  band: TimeBand;
  trips: number;
  // actual / Google, so 1.3 = trips took 30% longer than Google said.
  durationRatio: number | null;
  distanceRatio: number | null;
  // The same against the maps platform's shadow quote, on the trips that have one.
  mapsTrips: number;
  mapsDurationRatio: number | null;
  mapsDistanceRatio: number | null;
}

type Settings = Pick<
  PricingSettings,
  | 'durationCorrectionEnabled'
  | 'durationCorrectionMinTrips'
  | 'durationCorrectionMax'
>;

// The factor Google's duration would be multiplied by for this row: 1 until there are enough
// trips to trust, and never further from 1 than the admin's cap.
export function correctionFactor(
  row: AccuracyRow | undefined,
  settings: Settings,
): number {
  if (!row?.durationRatio || row.trips < settings.durationCorrectionMinTrips) {
    return 1;
  }
  const max = Math.max(1, settings.durationCorrectionMax);
  const factor = Math.min(max, Math.max(1 / max, row.durationRatio));
  return Math.round(factor * 100) / 100;
}

const ratios = (actual: string, estimate: string, alias: string) =>
  `percentile_cont(0.5) WITHIN GROUP (ORDER BY ${actual} / ${estimate})
     FILTER (WHERE ${actual} > 0 AND ${estimate} > 0) AS "${alias}"`;

function accuracySql(opts: {
  table: string;
  kind: string;
  startColumn: string;
  doneStatus: string;
  extraWhere?: string;
}) {
  const start = `t."${opts.startColumn}"`;
  return `
    SELECT ${opts.kind} AS kind, ${bandSql(start)} AS band,
      count(*)::int AS trips,
      ${ratios('t."actualDurationMin"', '(t."durationMin" / t."durationFactor")', 'durationRatio')},
      ${ratios('t."actualDistanceKm"', 't."distanceKm"', 'distanceRatio')},
      count(t."mapsDurationMin")::int AS "mapsTrips",
      ${ratios('t."actualDurationMin"', 't."mapsDurationMin"', 'mapsDurationRatio')},
      ${ratios('t."actualDistanceKm"', 't."mapsDistanceKm"', 'mapsDistanceRatio')}
    FROM "${opts.table}" t
    WHERE t.status = '${opts.doneStatus}'
      AND t."routeSource" = 'GOOGLE'
      AND t."actualDurationMin" > 0
      AND ${start} > (now() AT TIME ZONE 'UTC') - interval '${WINDOW_DAYS} days'
      ${opts.extraWhere ?? ''}
    GROUP BY 1, 2`;
}

const TRIPS_SQL = accuracySql({
  table: 'Trip',
  kind: 't."rideType"::text',
  startColumn: 'startedAt',
  doneStatus: 'COMPLETED',
  extraWhere: `AND NOT EXISTS (
    SELECT 1 FROM "TripStop" s WHERE s."tripId" = t.id AND s."arrivedAt" IS NULL)`,
});

const DELIVERIES_SQL = accuracySql({
  table: 'Delivery',
  kind: `'DELIVERY'`,
  startColumn: 'pickedUpAt',
  doneStatus: 'DELIVERED',
});

@Injectable()
export class EstimateAccuracyService {
  private cached?: { rows: AccuracyRow[]; at: number };

  constructor(
    private prisma: PrismaService,
    private pricingSettings: PricingSettingsService,
  ) {}

  // Always fresh: for the admin report.
  async measure(): Promise<AccuracyRow[]> {
    const [trips, deliveries] = await Promise.all([
      this.prisma.$queryRawUnsafe<AccuracyRow[]>(TRIPS_SQL),
      this.prisma.$queryRawUnsafe<AccuracyRow[]>(DELIVERIES_SQL),
    ]);
    const rows = [...trips, ...deliveries].map((r) => ({
      ...r,
      band: Number(r.band) as TimeBand,
    }));
    this.cached = { rows, at: Date.now() };
    return rows;
  }

  // Multiplier for a Google duration booked now. Cached for an hour: it moves slowly, and every
  // fare quote asks for it.
  async durationFactor(kind: EstimateKind, band: TimeBand): Promise<number> {
    const settings = await this.pricingSettings.get();
    if (!settings.durationCorrectionEnabled) return 1;
    try {
      if (!this.cached || Date.now() - this.cached.at > CACHE_MS) {
        await this.measure();
      }
    } catch {
      return 1; // a failed measurement must never block a booking
    }
    const row = this.cached?.rows.find(
      (r) => r.kind === kind && r.band === band,
    );
    return correctionFactor(row, settings);
  }

  async report() {
    const [rows, settings] = await Promise.all([
      this.measure(),
      this.pricingSettings.get(),
    ]);
    return {
      windowDays: WINDOW_DAYS,
      bands: TIME_BANDS,
      settings: {
        durationCorrectionEnabled: settings.durationCorrectionEnabled,
        durationCorrectionMinTrips: settings.durationCorrectionMinTrips,
        durationCorrectionMax: settings.durationCorrectionMax,
      },
      rows: rows.map((r) => ({
        ...r,
        // What the correction would be (or is, when enabled) for this ride type and time.
        factor: correctionFactor(r, settings),
      })),
    };
  }
}
