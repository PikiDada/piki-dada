import { Injectable } from '@nestjs/common';
import { PricingSettings, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Every fare reads these, so they're cached briefly. An admin's change applies at once on the
// instance that saved it, and within this long everywhere else.
const CACHE_MS = 60_000;
const SETTINGS_ID = 1;

@Injectable()
export class PricingSettingsService {
  private cached?: { value: PricingSettings; at: number };

  constructor(private prisma: PrismaService) {}

  async get(): Promise<PricingSettings> {
    if (this.cached && Date.now() - this.cached.at < CACHE_MS) {
      return this.cached.value;
    }
    const value =
      (await this.prisma.pricingSettings.findUnique({
        where: { id: SETTINGS_ID },
      })) ??
      (await this.prisma.pricingSettings.create({ data: { id: SETTINGS_ID } }));
    this.cached = { value, at: Date.now() };
    return value;
  }

  async update(
    data: Omit<Prisma.PricingSettingsUpdateInput, 'id' | 'updatedAt'>,
  ): Promise<PricingSettings> {
    const value = await this.prisma.pricingSettings.upsert({
      where: { id: SETTINGS_ID },
      update: data,
      create: {
        ...(data as Prisma.PricingSettingsCreateInput),
        id: SETTINGS_ID,
      },
    });
    this.cached = { value, at: Date.now() };
    return value;
  }
}
