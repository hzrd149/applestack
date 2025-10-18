import { openDB, type IDBPDatabase } from 'idb';
import type { NostrEvent } from '@nostrify/nostrify';

// ============================================================================
// IndexedDB Schema
// ============================================================================

const DB_NAME = 'nostr-dm-store';
const DB_VERSION = 1;
const STORE_NAME = 'messages';

interface StoredParticipant {
  messages: NostrEvent[];
  lastActivity: number;
  hasNIP4: boolean;
  hasNIP17: boolean;
}

export interface MessageStore {
  participants: Record<string, StoredParticipant>;
  lastSync: {
    nip4: number | null;
    nip17: number | null;
  };
}

// ============================================================================
// Database Operations
// ============================================================================

/**
 * Open the IndexedDB database
 */
async function openDatabase(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Create the messages store if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    },
  });
}

/**
 * Write messages to IndexedDB for a specific user
 */
export async function writeMessagesToDB(
  userPubkey: string,
  messageStore: MessageStore
): Promise<void> {
  try {
    const db = await openDatabase();
    await db.put(STORE_NAME, messageStore, userPubkey);
  } catch (error) {
    console.error('[MessageStore] Error writing to IndexedDB:', error);
    throw error;
  }
}

/**
 * Read messages from IndexedDB for a specific user
 */
export async function readMessagesFromDB(
  userPubkey: string
): Promise<MessageStore | undefined> {
  try {
    const db = await openDatabase();
    const data = await db.get(STORE_NAME, userPubkey);
    return data as MessageStore | undefined;
  } catch (error) {
    console.error('[MessageStore] Error reading from IndexedDB:', error);
    throw error;
  }
}

/**
 * Delete messages from IndexedDB for a specific user
 */
export async function deleteMessagesFromDB(userPubkey: string): Promise<void> {
  try {
    const db = await openDatabase();
    await db.delete(STORE_NAME, userPubkey);
  } catch (error) {
    console.error('[MessageStore] Error deleting from IndexedDB:', error);
    throw error;
  }
}

/**
 * Clear all messages from IndexedDB
 */
export async function clearAllMessages(): Promise<void> {
  try {
    const db = await openDatabase();
    await db.clear(STORE_NAME);
  } catch (error) {
    console.error('[MessageStore] Error clearing IndexedDB:', error);
    throw error;
  }
}
