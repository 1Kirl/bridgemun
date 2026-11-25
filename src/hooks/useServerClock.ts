"use client";

import { useEffect, useState } from "react";

/**
 * Estimates (server time − local time) so every client counts down to the same server deadline,
 * regardless of the local clock. Takes the lowest-latency of a few samples and re-syncs periodically.
 */
export function useServerClock() {
  const [offsetMs, setOffsetMs] = useState(0);
  const [synced, setSynced] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      let best: { rtt: number; offset: number } | null = null;
      for (let i = 0; i < 3; i++) {
        const t0 = Date.now();
        try {
          const res = await fetch("/api/time", { cache: "no-store" });
          const { now } = (await res.json()) as { now: number };
          const t1 = Date.now();
          const rtt = t1 - t0;
          const offset = now - (t0 + rtt / 2);
          if (!best || rtt < best.rtt) best = { rtt, offset };
        } catch {
          /* keep previous offset */
        }
      }
      if (!cancelled && best) {
        setOffsetMs(Math.round(best.offset));
        setSynced(true);
      }
    };
    void sync();
    const resync = setInterval(sync, 5 * 60_000);
    const ticker = setInterval(() => setTick((x) => x + 1), 250);
    return () => {
      cancelled = true;
      clearInterval(resync);
      clearInterval(ticker);
    };
  }, []);

  return { now: () => Date.now() + offsetMs, offsetMs, synced };
}
