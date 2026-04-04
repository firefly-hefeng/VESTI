/**
 * Local Terminal Data Provider
 * Connects to VESTI-CLI API (vesti serve) to fetch local AI terminal conversations.
 * Gracefully degrades when the CLI server is not running.
 */

import type { Conversation, Message, Platform } from "../types";

const DEFAULT_LOCAL_API_BASE = "http://localhost:3000";
const PING_TIMEOUT_MS = 2000;
const FETCH_TIMEOUT_MS = 5000;

// Cache availability to avoid repeated failed requests
let cachedAvailability: { available: boolean; checkedAt: number } | null = null;
const AVAILABILITY_CACHE_MS = 30_000; // Re-check every 30s

function getApiBase(): string {
  // Could be configurable in the future
  return DEFAULT_LOCAL_API_BASE;
}

/**
 * Check if the local terminal API is available.
 * Results are cached for 30 seconds to avoid hammering a non-existent server.
 */
export async function isLocalTerminalAvailable(): Promise<boolean> {
  if (
    cachedAvailability &&
    Date.now() - cachedAvailability.checkedAt < AVAILABILITY_CACHE_MS
  ) {
    return cachedAvailability.available;
  }

  try {
    const res = await fetch(`${getApiBase()}/api/vesti/ping`, {
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    });
    const available = res.ok;
    cachedAvailability = { available, checkedAt: Date.now() };
    return available;
  } catch {
    cachedAvailability = { available: false, checkedAt: Date.now() };
    return false;
  }
}

/**
 * Force re-check availability (e.g., after user clicks "reconnect").
 */
export function resetAvailabilityCache(): void {
  cachedAvailability = null;
}

/**
 * The raw conversation format returned by VESTI-CLI compat API.
 * Extends the standard Conversation with local terminal metadata.
 */
interface LocalTerminalConversation extends Conversation {
  _source: "local_terminal";
  _cli_id: string;
  _cli_platform: string;
  _project_path?: string;
  _model?: string;
  _tool_call_count?: number;
}

/**
 * Fetch conversations from local terminal.
 * Returns empty array if the API is unavailable.
 */
export async function fetchLocalConversations(opts?: {
  limit?: number;
  platform?: Platform;
}): Promise<LocalTerminalConversation[]> {
  try {
    const available = await isLocalTerminalAvailable();
    if (!available) return [];

    const params = new URLSearchParams();
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.platform) params.set("platform", opts.platform);

    const res = await fetch(
      `${getApiBase()}/api/vesti/conversations?${params.toString()}`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
    );

    if (!res.ok) return [];

    const data = (await res.json()) as {
      conversations: LocalTerminalConversation[];
    };
    return data.conversations || [];
  } catch {
    return [];
  }
}

/**
 * Fetch messages for a specific local terminal conversation.
 */
export async function fetchLocalMessages(
  cliId: string
): Promise<Message[]> {
  try {
    const res = await fetch(
      `${getApiBase()}/api/vesti/conversations/${encodeURIComponent(cliId)}/messages`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
    );
    if (!res.ok) return [];

    const data = (await res.json()) as { messages: Message[] };
    return data.messages || [];
  } catch {
    return [];
  }
}

/**
 * Fetch local terminal stats.
 */
export async function fetchLocalStats(): Promise<{
  totalConversations: number;
  totalMessages: number;
} | null> {
  try {
    const available = await isLocalTerminalAvailable();
    if (!available) return null;

    const res = await fetch(`${getApiBase()}/api/vesti/stats`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;

    return (await res.json()) as {
      totalConversations: number;
      totalMessages: number;
    };
  } catch {
    return null;
  }
}
