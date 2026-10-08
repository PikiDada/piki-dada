import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { haversineKm } from '../common/geo';

// Client for the independent maps platform (services/maps). Piki Dada is one of its sources:
// it sends GPS traces and resolved addresses in, and asks it for routes. Unconfigured
// (MAPS_PLATFORM_URL unset) every call is a no-op, so local development needs nothing running.
//
// Ingestion is fire-and-forget by design: the platform learning from a trip must never slow a
// trip down or fail it. A ping lost to an outage costs a little learning, nothing more.

const SOURCE = 'pikidada';
const FLUSH_INTERVAL_MS = 5000;
const MAX_BATCH = 500;
const TIMEOUT_MS = 4000;
// A rider's position is only trusted as "where this place is" if it was reported this recently
// and lands this close to where the customer put the pin. Further away usually means the rider
// tapped Arrived early or late, or the customer met them somewhere else.
const POSITION_FRESH_MS = 2 * 60 * 1000;
const MAX_PLACE_OFFSET_KM = 0.3;

export interface LatLng {
  lat: number;
  lng: number;
}

interface PendingPing {
  journeyId: string;
  lat: number;
  lng: number;
  recordedAt: string;
}

@Injectable()
export class MapsPlatformService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MapsPlatformService.name);
  private readonly baseUrl?: string;
  private readonly token?: string;
  private pending: PendingPing[] = [];
  private lastPositions = new Map<string, LatLng & { at: number }>();
  private timer?: NodeJS.Timeout;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('MAPS_PLATFORM_URL')?.replace(/\/+$/, '');
    this.token = config.get<string>('MAPS_PLATFORM_TOKEN');
  }

  get enabled() {
    return !!this.baseUrl;
  }

  onModuleInit() {
    if (this.enabled) {
      this.timer = setInterval(() => void this.flushPings(), FLUSH_INTERVAL_MS);
    }
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.flushPings();
  }

  recordPing(journeyId: string, point: LatLng, recordedAt: Date) {
    if (!this.enabled) return;
    this.pending.push({
      journeyId,
      lat: point.lat,
      lng: point.lng,
      recordedAt: recordedAt.toISOString(),
    });
    if (this.pending.length >= MAX_BATCH) void this.flushPings();
  }

  // The rider's latest position on a journey, for learnPlace.
  notePosition(journeyId: string, point: LatLng, at: Date) {
    if (!this.enabled) return;
    this.lastPositions.set(journeyId, { ...point, at: at.getTime() });
    if (this.lastPositions.size > 5000) {
      const stale = Date.now() - 10 * 60 * 1000;
      for (const [id, p] of this.lastPositions) {
        if (p.at < stale) this.lastPositions.delete(id);
      }
    }
  }

  // Called when the rider arrives at a pickup, stop or drop-off. The gazetteer learns the
  // place's name at the rider's own GPS position, not the coordinates the customer's address
  // search returned: it is where people really meet, it is our own data, and Google's terms
  // don't allow keeping Google Places coordinates. While the platform isn't running, the same
  // places are derived from stored pings by scripts/replay-pings.ts.
  learnPlace(journeyId: string, label: string, booked: LatLng) {
    const position = this.lastPositions.get(journeyId);
    if (!position || Date.now() - position.at > POSITION_FRESH_MS) return;
    if (haversineKm(position, booked) > MAX_PLACE_OFFSET_KM) return;
    this.recordPlaces([{ label, lat: position.lat, lng: position.lng }]);
  }

  // Our own address search: places riders have actually reached, most-used first. Empty when
  // the platform isn't running, so callers fall back to Google.
  async searchPlaces(query: string): Promise<(LatLng & { label: string })[]> {
    if (!this.enabled || query.trim().length < 2) return [];
    try {
      const res = await axios.get<{ places?: (LatLng & { label: string })[] }>(
        `${this.baseUrl}/v1/places/search`,
        {
          params: { q: query, limit: 5 },
          timeout: 1500,
          headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
        },
      );
      return (res.data?.places ?? []).map(({ label, lat, lng }) => ({
        label,
        lat,
        lng,
      }));
    } catch (err) {
      this.warn('place search', err);
      return [];
    }
  }

  private recordPlaces(places: (LatLng & { label: string })[]) {
    // "Current location" is the booking page's label for a GPS fix, not a place name.
    const named = places.filter(
      (p) =>
        p.label.trim().length >= 3 &&
        p.label.trim().toLowerCase() !== 'current location',
    );
    if (!this.enabled || named.length === 0) return;
    void this.post('/v1/places', { source: SOURCE, places: named }).catch(
      (err: unknown) => this.warn('places', err),
    );
  }

  async route(
    points: LatLng[],
  ): Promise<{ distanceKm: number; durationMin: number } | null> {
    if (!this.enabled) return null;
    try {
      const res = await this.post<{ distanceKm: number; durationMin: number }>(
        '/v1/route',
        { points },
      );
      const { distanceKm, durationMin } = res.data ?? {};
      if (!Number.isFinite(distanceKm) || !Number.isFinite(durationMin)) {
        this.logger.warn('Maps platform returned an unparseable route');
        return null;
      }
      return { distanceKm, durationMin };
    } catch (err) {
      this.warn('route', err);
      return null;
    }
  }

  private async flushPings() {
    if (this.pending.length === 0) return;
    const batch = this.pending;
    this.pending = [];
    try {
      await this.post('/v1/pings', { source: SOURCE, pings: batch });
    } catch (err) {
      this.warn(`pings (${batch.length} dropped)`, err);
    }
  }

  private post<T = unknown>(path: string, body: unknown) {
    return axios.post<T>(`${this.baseUrl}${path}`, body, {
      timeout: TIMEOUT_MS,
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
    });
  }

  private warn(what: string, err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    this.logger.warn(`Maps platform ${what} failed: ${message}`);
  }
}
