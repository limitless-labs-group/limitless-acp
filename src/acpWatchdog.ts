import { logger } from "./logger.js";

const ACP_API = process.env.ACP_API_URL || "https://api.acp.virtuals.io";

/**
 * ACP marks an agent online while its event stream is connected, and search
 * only returns online agents — so losing the stream silently makes the agent
 * invisible. The SDK's SSE transport closes without surfacing fatal errors,
 * which also empties the event loop and exits the process with code 0.
 *
 * This watchdog polls the platform's own view of our online status (the
 * authoritative signal), keeps the event loop alive, and exits non-zero when
 * we are genuinely offline so the supervisor restarts us. Unreachable-API
 * checks are skipped rather than counted, so a network blip is not a restart.
 */

export type WatchdogState = {
  online: boolean | null;
  lastCheckedAt: string | null;
  consecutiveOffline: number;
};

const ONLINE_SENTINEL_YEAR = 2100;

function isOnlineSentinel(lastActiveAt: string | undefined): boolean {
  if (!lastActiveAt) return false;
  const t = new Date(lastActiveAt);
  return (
    !Number.isNaN(t.getTime()) && t.getUTCFullYear() >= ONLINE_SENTINEL_YEAR
  );
}

export function startAcpWatchdog(options: {
  agentWalletAddress: string;
  intervalMs?: number;
  offlineTolerance?: number;
  onFatal?: () => void;
}): WatchdogState {
  const {
    agentWalletAddress,
    intervalMs = 60_000,
    offlineTolerance = 2,
    onFatal = () => process.exit(1),
  } = options;

  const state: WatchdogState = {
    online: null,
    lastCheckedAt: null,
    consecutiveOffline: 0,
  };

  const check = async () => {
    let online: boolean;
    try {
      const res = await fetch(
        `${ACP_API}/agents/wallet/${agentWalletAddress}`,
        { signal: AbortSignal.timeout(15_000) },
      );
      if (!res.ok) throw new Error(`status ${res.status}`);
      const body = (await res.json()) as { data?: { lastActiveAt?: string } };
      online = isOnlineSentinel(body.data?.lastActiveAt);
    } catch (err) {
      // Can't reach the API: unknown, not offline. Don't count it.
      logger.warn({ err }, "Watchdog check failed (skipping)");
      return;
    }

    state.online = online;
    state.lastCheckedAt = new Date().toISOString();

    if (online) {
      if (state.consecutiveOffline > 0) {
        logger.info("ACP stream healthy again — agent is discoverable");
      }
      state.consecutiveOffline = 0;
      return;
    }

    state.consecutiveOffline += 1;
    logger.error(
      { consecutiveOffline: state.consecutiveOffline, offlineTolerance },
      "ACP reports this agent OFFLINE — it is not discoverable in search",
    );

    if (state.consecutiveOffline >= offlineTolerance) {
      logger.fatal(
        "ACP event stream is down; exiting so the supervisor restarts a " +
          "healthy instance",
      );
      onFatal();
    }
  };

  // Unref'd would let the process exit; we want this to hold it open.
  setInterval(() => void check(), intervalMs);
  void check();

  return state;
}
