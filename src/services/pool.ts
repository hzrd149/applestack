import { RelayPool } from "applesauce-relay";
import type { NostrEvent } from "nostr-tools";
import { firstValueFrom } from "rxjs";
import { eventStore } from "./stores";
import { defaultRelays } from "./state";

/**
 * Global RelayPool instance for all relay connections.
 * Use this to query events and publish to relays.
 */
export const pool = new RelayPool();

/**
 * Publish an event to the configured relays.
 * Automatically adds the event to the local EventStore.
 *
 * @param event - The signed Nostr event to publish
 * @param relays - Optional array of relay URLs (uses defaultRelays if not provided)
 */
export async function publish(
  event: NostrEvent,
  relays?: string[]
): Promise<void> {
  console.log("Publishing event:", event);

  // Add to local store immediately for optimistic updates
  eventStore.add(event);

  // Use provided relays or default
  if (!relays) relays = defaultRelays.getValue();

  // Publish to relays
  await firstValueFrom(pool.event(relays, event));
}
