import { logger } from "firebase-functions";
import type {
  ProviderDriverStanding,
  ProviderRace,
  ProviderRaceResult,
  RaceStatus,
} from "./types";
import schedule2026 from "./schedule-2026.json";
import standings2026 from "./standings-2026.json";
import result2026CookOutClash from "./results-2026-cook-out-clash.json";

export interface NascarDataProvider {
  readonly name: string;
  fetchSchedule(seasonYear: number): Promise<ProviderRace[]>;
  fetchStandings(seasonYear: number): Promise<ProviderDriverStanding[]>;
  fetchRaceResult(
    raceKey: string,
    seasonYear: number,
  ): Promise<ProviderRaceResult | null>;
}

class HttpJsonProvider implements NascarDataProvider {
  readonly name = "http-json-provider";

  constructor(
    private readonly baseUrl: string,
    private readonly apiToken?: string,
  ) {}

  private async request<T>(path: string): Promise<T> {
    const headers: Record<string, string> = {};
    if (this.apiToken) {
      headers.Authorization = `Bearer ${this.apiToken}`;
    }

    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      headers,
    });
    if (!response.ok) {
      throw new Error(`Provider request failed (${response.status}): ${path}`);
    }
    return (await response.json()) as T;
  }

  async fetchSchedule(seasonYear: number): Promise<ProviderRace[]> {
    return this.request<ProviderRace[]>(`/schedule?seasonYear=${seasonYear}`);
  }

  async fetchStandings(seasonYear: number): Promise<ProviderDriverStanding[]> {
    return this.request<ProviderDriverStanding[]>(`/standings?seasonYear=${seasonYear}`);
  }

  async fetchRaceResult(
    raceKey: string,
    seasonYear: number,
  ): Promise<ProviderRaceResult | null> {
    return this.request<ProviderRaceResult | null>(
      `/results/${encodeURIComponent(raceKey)}?seasonYear=${seasonYear}`,
    );
  }
}

class StaticFallbackProvider implements NascarDataProvider {
  readonly name = "static-fallback-provider";

  async fetchSchedule(seasonYear: number): Promise<ProviderRace[]> {
    if (seasonYear === 2026) {
      return schedule2026 as ProviderRace[];
    }
    return [
      {
        id: `${seasonYear}-daytona-500`,
        name: "Daytona 500",
        track: "Daytona International Speedway",
        weekIndex: 1,
        startTimeIso: `${seasonYear}-02-16T19:30:00.000Z`,
        status: "scheduled",
      },
      {
        id: `${seasonYear}-atlanta`,
        name: "Ambetter Health 400",
        track: "Atlanta Motor Speedway",
        weekIndex: 2,
        startTimeIso: `${seasonYear}-02-23T20:00:00.000Z`,
        status: "scheduled",
      },
      {
        id: `${seasonYear}-las-vegas`,
        name: "Pennzoil 400",
        track: "Las Vegas Motor Speedway",
        weekIndex: 3,
        startTimeIso: `${seasonYear}-03-09T20:30:00.000Z`,
        status: "scheduled",
      },
    ];
  }

  async fetchStandings(seasonYear: number): Promise<ProviderDriverStanding[]> {
    if (seasonYear === 2026) {
      return standings2026 as ProviderDriverStanding[];
    }
    return [];
  }

  async fetchRaceResult(
    raceKey: string,
    seasonYear: number,
  ): Promise<ProviderRaceResult | null> {
    if (seasonYear === 2026 && raceKey === "2026-cook-out-clash") {
      return result2026CookOutClash as ProviderRaceResult;
    }
    return {
      raceKey,
      status: "completed",
      points: [],
    };
  }
}

export function normalizeRaceStatus(status: string | undefined): RaceStatus {
  if (status === "completed" || status === "locked" || status === "scheduled") {
    return status;
  }
  return "scheduled";
}

export function getProvider(): NascarDataProvider {
  const baseUrl = process.env.NASCAR_PROVIDER_BASE_URL;
  const token = process.env.NASCAR_PROVIDER_TOKEN;

  if (baseUrl) {
    logger.info("Using HTTP NASCAR provider", { baseUrl });
    return new HttpJsonProvider(baseUrl, token);
  }

  logger.warn(
    "NASCAR_PROVIDER_BASE_URL is missing. Falling back to static provider with minimal data.",
  );
  return new StaticFallbackProvider();
}
