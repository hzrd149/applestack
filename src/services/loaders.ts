import {
  createEventLoaderForStore,
  createReactionsLoader,
  createAddressLoader,
} from "applesauce-loaders/loaders";
import { COMMENT_KIND } from "applesauce-core/helpers";
import { pool } from "./pool";
import { eventStore } from "./stores";
import { cacheRequest } from "./cache";
import { lookupRelays, defaultRelays } from "./state";

/**
 * Create unified event loader for the EventStore.
 * This automatically loads events that are referenced but not in the store yet.
 *
 * Features:
 * - Automatic batching of event requests
 * - Follows relay hints from events
 * - Checks IndexedDB cache first
 * - Queries lookup relays for missing events
 */
createEventLoaderForStore(eventStore, pool, {
  cacheRequest,
  lookupRelays: lookupRelays.getValue(),
  extraRelays: defaultRelays,
  followRelayHints: true,
  bufferTime: 1000, // Batch requests within 1 second
});

/**
 * Loader for addressable events (NIP-33).
 * Used for loading articles, profiles, and other replaceable events.
 */
export const addressLoader = createAddressLoader(pool, {
  cacheRequest,
  extraRelays: defaultRelays,
  eventStore,
  lookupRelays: lookupRelays.getValue(),
});

/**
 * Loader for reactions (kind 7).
 * Efficiently loads and caches reactions for events.
 */
export const reactionsLoader = createReactionsLoader(pool, {
  cacheRequest,
  eventStore,
});

/**
 * Loader for comments (NIP-22, kind 1111).
 * Loads all comments for a given event.
 */
export const commentsLoader = createAddressLoader(pool, {
  cacheRequest,
  eventStore,
  kinds: [COMMENT_KIND],
  lookupRelays: lookupRelays.getValue(),
});

// Attach loaders to the event store for automatic loading
eventStore.eventLoader = createEventLoaderForStore(eventStore, pool, {
  cacheRequest,
  lookupRelays: lookupRelays.getValue(),
  followRelayHints: true,
});
eventStore.addressableLoader = addressLoader;
eventStore.replaceableLoader = addressLoader;
