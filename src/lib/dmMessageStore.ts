import { openDB, type IDBPDatabase } from 'idb';
import type { NostrEvent } from '@nostrify/nostrify';

// ============================================================================
// IndexedDB Schema
// ============================================================================

// Use domain-based naming to avoid conflicts between apps on same domain
const getDBName = () => {
  // Use hostname for unique DB per app (e.g., 'nostr-dm-store-localhost', 'nostr-dm-store-myapp.com')
  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'default';
  return `nostr-dm-store-${hostname}`;
};
const DB_NAME = getDBName();
const DB_VERSION = 1;
const STORE_NAME = 'messages';

// Signer interface for NIP-44 encryption/decryption
interface NIP44Signer {
  encrypt(pubkey: string, plaintext: string): Promise<string>;
  decrypt(pubkey: string, ciphertext: string): Promise<string>;
}

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

// Wrapper for encrypted storage
interface EncryptedStore {
  encrypted: true;
  data: string; // NIP-44 encrypted MessageStore JSON
}

// Type guard to check if data is encrypted
function isEncryptedStore(data: unknown): data is EncryptedStore {
  return (
    typeof data === 'object' &&
    data !== null &&
    'encrypted' in data &&
    (data as EncryptedStore).encrypted === true
  );
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
 * If signer is provided, encrypts the entire store with NIP-44
 */
export async function writeMessagesToDB(
  userPubkey: string,
  messageStore: MessageStore,
  signer?: { nip44?: NIP44Signer }
): Promise<void> {
  try {
    const db = await openDatabase();
    
    // If signer is available, encrypt the entire store
    if (signer?.nip44) {
      const plaintext = JSON.stringify(messageStore);
      const encrypted = await signer.nip44.encrypt(userPubkey, plaintext);
      
      const encryptedStore: EncryptedStore = {
        encrypted: true,
        data: encrypted,
      };
      
      await db.put(STORE_NAME, encryptedStore, userPubkey);
      console.log('[MessageStore] ✅ Encrypted cache saved');
    } else {
      // Fallback: save unencrypted (for backward compatibility)
      await db.put(STORE_NAME, messageStore, userPubkey);
      console.log('[MessageStore] ⚠️ Unencrypted cache saved (no signer)');
    }
  } catch (error) {
    console.error('[MessageStore] Error writing to IndexedDB:', error);
    throw error;
  }
}

/**
 * Read messages from IndexedDB for a specific user
 * If data is encrypted, decrypts it using the provided signer
 */
export async function readMessagesFromDB(
  userPubkey: string,
  signer?: { nip44?: NIP44Signer }
): Promise<MessageStore | undefined> {
  try {
    const db = await openDatabase();
    const data = await db.get(STORE_NAME, userPubkey);
    
    if (!data) {
      return undefined;
    }
    
    // Check if data is encrypted
    if (isEncryptedStore(data)) {
      if (!signer?.nip44) {
        console.error('[MessageStore] ❌ Encrypted cache found but no signer available');
        return undefined;
      }
      
      try {
        const decrypted = await signer.nip44.decrypt(userPubkey, data.data);
        const messageStore = JSON.parse(decrypted) as MessageStore;
        console.log('[MessageStore] ✅ Decrypted cache loaded');
        return messageStore;
      } catch (error) {
        console.error('[MessageStore] ❌ Failed to decrypt cache:', error);
        return undefined;
      }
    }
    
    // Backward compatibility: unencrypted cache
    console.log('[MessageStore] ⚠️ Loaded unencrypted cache (old format)');
    return data as MessageStore;
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
