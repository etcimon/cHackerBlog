/**
 * IP geolocation lookup with Redis caching (category "ipgeo").
 * The provider endpoint is configurable via IPGEO_ENDPOINT and uses {ip}
 * substitution. Failures return null rather than throwing.
 */
import { env } from "@/lib/env";
import { remember } from "@/lib/cache";

export interface GeoInfo {
  ip: string;
  country?: string;
  region?: string;
  city?: string;
  org?: string;
}

export async function lookupGeo(ip: string): Promise<GeoInfo | null> {
  if (!ip || ip === "0.0.0.0") return null;
  return remember<GeoInfo | null>("ipgeo", ip, async () => {
    try {
      const url = env.IPGEO_ENDPOINT.replace("{ip}", encodeURIComponent(ip));
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return null;
      const data = (await res.json()) as Record<string, unknown>;
      return {
        ip,
        country: (data.country_name ?? data.country) as string | undefined,
        region: (data.region ?? data.region_code) as string | undefined,
        city: data.city as string | undefined,
        org: (data.org ?? data.asn) as string | undefined,
      };
    } catch {
      return null;
    }
  });
}
