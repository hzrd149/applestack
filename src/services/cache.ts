import type { Filter } from "applesauce-core/helpers";
import { persistEventsToCache } from "applesauce-core/helpers";
import { eventStore } from "./stores";

/**
 * IndexedDB cache for storing events locally.
 * Initialized lazily on first access.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cache: any | null = null;

/**
 * Initialize the IndexedDB cache.
 * Only initializes once and only in browsers (not in test environments).
 */
async function initializeCache() {
  if (cache) return cache;
  
  if (typeof indexedDB === "undefined") {
    return null;
  }

  try {
    const { openDB, addEvents } = await import("nostr-idb");
    cache = await openDB();

    // Set up automatic persistence
    persistEventsToCache(eventStore, (events) => addEvents(cache, events));

    return cache;
  } catch (error) {
    console.error("Failed to initialize IndexedDB cache:", error);
    return null;
  }
}

/**
 * Request events from the IndexedDB cache.
 * Used by event loaders to check cache before querying relays.
 * Returns empty array if cache is not available.
 */
export async function cacheRequest(filters: Filter[]) {
  const db = await initializeCache();
  if (!db) return [];

  const { getEventsForFilters } = await import("nostr-idb");
  return getEventsForFilters(db, filters);
}

// Initialize cache on module load (browser only)
if (typeof indexedDB !== "undefined") {
  initializeCache().catch((err) => {
    console.error("Failed to initialize cache:", err);
  });
}
