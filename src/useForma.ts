import { useState, useEffect } from "react";
import type { EmbeddedViewSdk } from "forma-embedded-view-sdk";

/**
 * Dynamically loads the Forma SDK only when running inside the Forma host.
 * Returns null when running standalone (local dev preview).
 */
export function useForma() {
  const [forma, setForma] = useState<EmbeddedViewSdk | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("origin")) {
      // Not inside Forma host — stay in preview mode
      return;
    }
    import("forma-embedded-view-sdk/auto")
      .then((mod) => setForma(mod.Forma))
      .catch((err) =>
        setError(`Failed to load Forma SDK: ${err instanceof Error ? err.message : String(err)}`),
      );
  }, []);

  return { forma, error };
}
