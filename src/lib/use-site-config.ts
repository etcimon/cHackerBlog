"use client";

/**
 * Client hook exposing the public site configuration (a subset of SiteSettings
 * plus integration flags) fetched once from GET /api/settings. The in-flight
 * promise is memoized at module scope so many article cards mounting at once
 * share a single request.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import type { PublicSettings } from "@/lib/types";

let cache: PublicSettings | null = null;
let inflight: Promise<PublicSettings> | null = null;

function load(): Promise<PublicSettings> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = api
      .get<PublicSettings>("/api/settings")
      .then((data) => {
        cache = data;
        return data;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function useSiteConfig(): PublicSettings | null {
  const [config, setConfig] = useState<PublicSettings | null>(cache);

  useEffect(() => {
    let active = true;
    load()
      .then((data) => {
        if (active) setConfig(data);
      })
      .catch(() => {
        /* settings are best-effort on the client; ignore fetch errors */
      });
    return () => {
      active = false;
    };
  }, []);

  return config;
}
