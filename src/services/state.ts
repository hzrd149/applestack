import { BehaviorSubject } from "rxjs";

/**
 * Default relay list for querying events.
 * Users can customize this in settings.
 */
export const defaultRelays = new BehaviorSubject<string[]>([
  "wss://relay.ditto.pub",
  "wss://relay.nostr.band",
  "wss://relay.damus.io",
]);

/**
 * Lookup relays for finding user relay hints (NIP-65, profile relays, etc.)
 * These are used by the event loaders to find events more efficiently.
 */
export const lookupRelays = new BehaviorSubject<string[]>([
  "wss://purplepag.es/",
  "wss://index.hzrd149.com/",
]);

/**
 * Theme state - either 'light' or 'dark'.
 * Persists to localStorage and updates document class.
 */
export const theme = new BehaviorSubject<"light" | "dark">(
  (localStorage.getItem("theme") as "light" | "dark") ?? "light"
);

// Auto-persist theme changes and update DOM
theme.subscribe((value) => {
  localStorage.setItem("theme", value);
  document.documentElement.classList.toggle("dark", value === "dark");
});

/**
 * Relay metadata state for NIP-65 relay configuration.
 * Stores user's read/write relay preferences.
 */
export interface RelayMetadata {
  relays: Array<{ url: string; read: boolean; write: boolean }>;
  updatedAt: number;
}

export const relayMetadata = new BehaviorSubject<RelayMetadata>({
  relays: defaultRelays.getValue().map((url) => ({ url, read: true, write: true })),
  updatedAt: 0,
});

// Auto-persist relay metadata
relayMetadata.subscribe((value) => {
  localStorage.setItem("relayMetadata", JSON.stringify(value));
});

// Load initial relay metadata from localStorage
const savedRelayMetadata = localStorage.getItem("relayMetadata");
if (savedRelayMetadata) {
  try {
    const parsed = JSON.parse(savedRelayMetadata);
    relayMetadata.next(parsed);
    // Update defaultRelays with saved relay list
    defaultRelays.next(parsed.relays.map((r: { url: string }) => r.url));
  } catch (error) {
    console.error("Failed to parse saved relay metadata", error);
  }
}
