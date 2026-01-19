import { openDB, addEvents, getEventsForFilters } from "nostr-idb";
import type { Filter } from "applesauce-core/helpers";
import { persistEventsToCache } from "applesauce-core/helpers";
import { eventStore } from "./stores";

/**
 * IndexedDB cache for storing events locally.
 * This provides offline support and faster initial loads.
 */
export const cache = await openDB();

/**
 * Request events from the IndexedDB cache.
 * Used by event loaders to check cache before querying relays.
 */
export function cacheRequest(filters: Filter[]) {
  return getEventsForFilters(cache, filters);
}

/**
 * Automatically persist new events from the EventStore to IndexedDB.
 * This keeps the cache up-to-date as events are added.
 */
persistEventsToCache(eventStore, (events) => addEvents(cache, events));
