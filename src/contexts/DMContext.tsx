import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback, useMemo, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostr } from '@nostrify/react';
import { useAppContext } from '@/hooks/useAppContext';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { validateDMEvent } from '@/lib/dmUtils';
import { LOADING_PHASES, type LoadingPhase, PROTOCOL_MODE, type ProtocolMode } from '@/lib/dmConstants';
import { NSecSigner, type NostrEvent } from '@nostrify/nostrify';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import type { MessageProtocol } from '@/lib/dmConstants';
import { MESSAGE_PROTOCOL } from '@/lib/dmConstants';

// ============================================================================
// DM Types and Constants
// ============================================================================

interface ParticipantData {
  messages: DecryptedMessage[];
  lastActivity: number;
  lastMessage: DecryptedMessage | null;
  hasNIP4: boolean;
  hasNIP17: boolean;
}

type MessagesState = Map<string, ParticipantData>;

interface LastSyncData {
  nip4: number | null;
  nip17: number | null;
}

interface SubscriptionStatus {
  isNIP4Connected: boolean;
  isNIP17Connected: boolean;
}

interface ScanProgress {
  current: number;
  status: string;
}

interface ScanProgressState {
  nip4: ScanProgress | null;
  nip17: ScanProgress | null;
}

interface ConversationSummary {
  id: string;
  pubkey: string;
  lastMessage: DecryptedMessage | null;
  lastActivity: number;
  hasNIP4Messages: boolean;
  hasNIP17Messages: boolean;
  isKnown: boolean;
  isRequest: boolean;
  lastMessageFromUser: boolean;
}

interface MessageProcessingResult {
  lastMessageTimestamp?: number;
  messageCount: number;
}

interface DecryptionResult {
  decryptedContent: string;
  error?: string;
}

interface DecryptedMessage extends NostrEvent {
  decryptedContent?: string;
  error?: string;
  isSending?: boolean;
  clientFirstSeen?: number;
  sealEvent?: NostrEvent; // Store kind 13 seal for NIP-17 (only needs 1 decrypt instead of 2)
}

interface NIP17ProcessingResult {
  processedMessage: DecryptedMessage;
  conversationPartner: string;
  sealEvent: NostrEvent; // Return the seal so we can cache it
}

const DM_CONSTANTS = {
  DEBOUNCED_WRITE_DELAY: 15000,
  RECENT_MESSAGE_THRESHOLD: 5000,
  SUBSCRIPTION_OVERLAP_SECONDS: 10, // Overlap for subscriptions to catch race conditions
  SCAN_TOTAL_LIMIT: 20000,
  SCAN_BATCH_SIZE: 1000,
  NIP4_QUERY_TIMEOUT: 15000,
  NIP17_QUERY_TIMEOUT: 30000,
  ERROR_LOG_DEBOUNCE_DELAY: 2000,
} as const;

const SCAN_STATUS_MESSAGES = {
  NIP4_STARTING: 'Starting NIP-4 scan...',
  NIP17_STARTING: 'Starting NIP-17 scan...',
} as const;

const createErrorLogger = (name: string) => {
  let count = 0;
  let timeout: NodeJS.Timeout | null = null;

  return (_error: Error) => {
    count++;
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      if (count > 0) {
        console.error(`[DM] ${name} processing complete with ${count} errors`);
        count = 0;
      }
    }, DM_CONSTANTS.ERROR_LOG_DEBOUNCE_DELAY);
  };
};

const nip17ErrorLogger = createErrorLogger('NIP-17');

interface DMContextType {
  messages: MessagesState;
  isLoading: boolean;
  loadingPhase: LoadingPhase;
  isDoingInitialLoad: boolean;
  lastSync: LastSyncData;
  subscriptions: SubscriptionStatus;
  conversations: ConversationSummary[];
  sendMessage: (params: { 
    recipientPubkey: string; 
    content: string; 
    protocol?: MessageProtocol;
    attachments?: FileAttachment[];
  }) => Promise<void>;
  protocolMode: ProtocolMode;
  scanProgress: ScanProgressState;
  clearCacheAndRefetch: () => Promise<void>;
}

const DMContext = createContext<DMContextType | null>(null);

export function useDMContext(): DMContextType {
  const context = useContext(DMContext);
  if (!context) {
    throw new Error('useDMContext must be used within DMProvider');
  }
  return context;
}

const MESSAGES_PER_PAGE = 25;

export function useConversationMessages(conversationId: string) {
  const { messages: allMessages } = useDMContext();
  const [visibleCount, setVisibleCount] = useState(MESSAGES_PER_PAGE);

  const result = useMemo(() => {
    const conversationData = allMessages.get(conversationId);

    if (!conversationData) {
      return {
        messages: [],
        hasMoreMessages: false,
        totalCount: 0,
        lastMessage: null,
        lastActivity: 0,
      };
    }

    const totalMessages = conversationData.messages.length;
    const hasMore = totalMessages > visibleCount;
    
    // Return the most recent N messages (slice from the end)
    const visibleMessages = conversationData.messages.slice(-visibleCount);

    return {
      messages: visibleMessages,
      hasMoreMessages: hasMore,
      totalCount: totalMessages,
      lastMessage: conversationData.lastMessage,
      lastActivity: conversationData.lastActivity,
    };
  }, [allMessages, conversationId, visibleCount]);

  const loadEarlierMessages = useCallback(() => {
    setVisibleCount(prev => prev + MESSAGES_PER_PAGE);
  }, []);

  // Reset visible count when conversation changes
  useEffect(() => {
    setVisibleCount(MESSAGES_PER_PAGE);
  }, [conversationId]);

  return {
    ...result,
    loadEarlierMessages,
  };
}

export interface DMConfig {
  enabled?: boolean;
  protocolMode?: ProtocolMode;
}

interface DMProviderProps {
  children: ReactNode;
  config?: DMConfig;
}

// ============================================================================
// Message Sending Types and Helpers (Internal)
// ============================================================================

export interface FileAttachment {
  url: string;
  mimeType: string;
  size: number;
  name: string;
  tags: string[][];
}

/**
 * Prepare message content with file URLs appended
 */
function prepareMessageContent(content: string, attachments: FileAttachment[] = []): string {
  if (attachments.length === 0) return content;
  
  const fileUrls = attachments.map(file => file.url).join('\n');
  return content ? `${content}\n\n${fileUrls}` : fileUrls;
}

/**
 * Create imeta tags for file attachments (NIP-92)
 */
function createImetaTags(attachments: FileAttachment[] = []): string[][] {
  return attachments.map(file => {
    const imetaTag = ['imeta'];
    imetaTag.push(`url ${file.url}`);
    if (file.mimeType) imetaTag.push(`m ${file.mimeType}`);
    if (file.size) imetaTag.push(`size ${file.size}`);
    if (file.name) imetaTag.push(`alt ${file.name}`);

    // Add hash tags from file.tags
    file.tags.forEach(tag => {
      if (tag[0] === 'x') imetaTag.push(`x ${tag[1]}`);
      if (tag[0] === 'ox') imetaTag.push(`ox ${tag[1]}`);
    });

    return imetaTag;
  });
}

// ============================================================================
// DMProvider Component
// ============================================================================

export function DMProvider({ children, config }: DMProviderProps) {
  const { enabled = true, protocolMode = PROTOCOL_MODE.NIP17_ONLY } = config || {};
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { toast } = useToast();
  const { config: appConfig } = useAppContext();

  const userPubkey = useMemo(() => user?.pubkey, [user?.pubkey]);
  
  // Track relay URL to detect changes
  const previousRelayUrl = useRef<string>(appConfig.relayUrl);
  
  // Determine if NIP-17 is enabled based on protocol mode
  const enableNIP17 = protocolMode !== PROTOCOL_MODE.NIP04_ONLY;

  const [messages, setMessages] = useState<MessagesState>(new Map());
  const [lastSync, setLastSync] = useState<LastSyncData>({
    nip4: null,
    nip17: null
  });
  const [isLoading, setIsLoading] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>(LOADING_PHASES.IDLE);
  const [subscriptions, setSubscriptions] = useState<SubscriptionStatus>({
    isNIP4Connected: false,
    isNIP17Connected: false
  });
  const [hasInitialLoadCompleted, setHasInitialLoadCompleted] = useState(false);
  const [shouldSaveImmediately, setShouldSaveImmediately] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgressState>({
    nip4: null,
    nip17: null
  });

  const nip4SubscriptionRef = useRef<{ close: () => void } | null>(null);
  const nip17SubscriptionRef = useRef<{ close: () => void } | null>(null);
  const debouncedWriteRef = useRef<NodeJS.Timeout | null>(null);

  // ============================================================================
  // Internal Message Sending Mutations
  // ============================================================================

  // Send NIP-04 Message (internal)
  const sendNIP4Message = useMutation<NostrEvent, Error, { 
    recipientPubkey: string; 
    content: string;
    attachments?: FileAttachment[];
  }>({
    mutationFn: async ({ recipientPubkey, content, attachments = [] }) => {
      if (!user) {
        throw new Error('User is not logged in');
      }

      if (!user.signer.nip04) {
        throw new Error('NIP-04 encryption not available');
      }

      // Prepare content with file URLs
      const messageContent = prepareMessageContent(content, attachments);

      // Encrypt the content
      const encryptedContent = await user.signer.nip04.encrypt(recipientPubkey, messageContent);

      // Build tags with imeta tags for attachments
      const tags: string[][] = [
        ['p', recipientPubkey],
        ...createImetaTags(attachments)
      ];

      // Create and publish the event
      return await createEvent({
        kind: 4,
        content: encryptedContent,
        tags,
      });
    },
    onError: (error) => {
      console.error('[DM] Failed to send NIP-04 message:', error);
      toast({
        title: 'Failed to send message',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Send NIP-17 Message (internal)
  const sendNIP17Message = useMutation<NostrEvent, Error, { 
    recipientPubkey: string; 
    content: string;
    attachments?: FileAttachment[];
  }>({
    mutationFn: async ({ recipientPubkey, content, attachments = [] }) => {
      if (!user) {
        throw new Error('User is not logged in');
      }

      if (!user.signer.nip44) {
        throw new Error('NIP-44 encryption not available');
      }

      // Step 1: Create the inner Kind 14 Private Direct Message
      const now = Math.floor(Date.now() / 1000);
      
      // Generate randomized timestamps for gift wraps (NIP-59 metadata privacy)
      // Randomize within ±2 days to hide actual send time from relays
      const randomizeTimestamp = (baseTime: number) => {
        const twoDaysInSeconds = 2 * 24 * 60 * 60;
        const randomOffset = Math.floor(Math.random() * twoDaysInSeconds * 2) - twoDaysInSeconds;
        return baseTime + randomOffset;
      };

      // Prepare content with file URLs
      const messageContent = prepareMessageContent(content, attachments);

      // Build tags with imeta tags for attachments
      const tags: string[][] = [
        ['p', recipientPubkey],
        ...createImetaTags(attachments)
      ];

      // Use kind 15 for messages with file attachments, kind 14 for text-only
      const messageKind = (attachments && attachments.length > 0) ? 15 : 14;

      const privateMessage: Omit<NostrEvent, 'id' | 'sig'> = {
        kind: messageKind,
        pubkey: user.pubkey,
        created_at: now,
        tags,
        content: messageContent,
      };

      // Step 2: Create TWO Kind 13 Seal events (one for recipient, one for myself)
      const recipientSeal: Omit<NostrEvent, 'id' | 'sig'> = {
        kind: 13,
        pubkey: user.pubkey,
        created_at: now,
        tags: [],
        content: await user.signer.nip44.encrypt(recipientPubkey, JSON.stringify(privateMessage)),
      };

      const senderSeal: Omit<NostrEvent, 'id' | 'sig'> = {
        kind: 13,
        pubkey: user.pubkey,
        created_at: now,
        tags: [],
        content: await user.signer.nip44.encrypt(user.pubkey, JSON.stringify(privateMessage)),
      };

      // Step 3: Create TWO Kind 1059 Gift Wrap events
      // Per NIP-17/NIP-59: Gift wraps MUST be signed with random, ephemeral keys
      // to hide the sender's identity and provide - some - metadata privacy
      
      // Create random signers for each gift wrap
      const recipientRandomSigner = new NSecSigner(generateSecretKey());
      const senderRandomSigner = new NSecSigner(generateSecretKey());

      // Sign both gift wraps with random keys and randomized timestamps
      const [recipientGiftWrap, senderGiftWrap] = await Promise.all([
        recipientRandomSigner.sign({
          kind: 1059,
          pubkey: getPublicKey(recipientRandomSigner.privateKey),
          created_at: randomizeTimestamp(now),  // Randomized to hide real send time
          tags: [['p', recipientPubkey]],
          content: await recipientRandomSigner.nip44!.encrypt(recipientPubkey, JSON.stringify(recipientSeal)),
        }),
        senderRandomSigner.sign({
          kind: 1059,
          pubkey: getPublicKey(senderRandomSigner.privateKey),
          created_at: randomizeTimestamp(now),  // Randomized to hide real send time
          tags: [['p', user.pubkey]],
          content: await senderRandomSigner.nip44!.encrypt(user.pubkey, JSON.stringify(senderSeal)),
        }),
      ]);

      // Publish both to relays
      await Promise.all([
        nostr.event(recipientGiftWrap),
        nostr.event(senderGiftWrap),
      ]);

      return recipientGiftWrap;
    },
    onError: (error) => {
      console.error('[DM] Failed to send NIP-17 message:', error);
      toast({
        title: 'Failed to send message',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // ============================================================================
  // Message Loading and Processing
  // ============================================================================

  // Load past NIP-4 messages
  const loadPastNIP4Messages = useCallback(async (sinceTimestamp?: number) => {
    if (!user?.pubkey) return;

    let allMessages: NostrEvent[] = [];
    let processedMessages = 0;
    let currentSince = sinceTimestamp || 0;

    console.log('[DM] loadPastNIP4Messages called with sinceTimestamp:', sinceTimestamp, '(using:', currentSince, ')');

    setScanProgress(prev => ({ ...prev, nip4: { current: 0, status: SCAN_STATUS_MESSAGES.NIP4_STARTING } }));

    while (processedMessages < DM_CONSTANTS.SCAN_TOTAL_LIMIT) {
      const batchLimit = Math.min(DM_CONSTANTS.SCAN_BATCH_SIZE, DM_CONSTANTS.SCAN_TOTAL_LIMIT - processedMessages);

      const filters = [
        { kinds: [4], '#p': [user.pubkey], limit: batchLimit, since: currentSince },
        { kinds: [4], authors: [user.pubkey], limit: batchLimit, since: currentSince }
      ];

      try {
        const batchDMs = await nostr.query(filters, { signal: AbortSignal.timeout(DM_CONSTANTS.NIP4_QUERY_TIMEOUT) });
        const validBatchDMs = batchDMs.filter(validateDMEvent);

        if (validBatchDMs.length === 0) break;

        allMessages = [...allMessages, ...validBatchDMs];
        processedMessages += validBatchDMs.length;

        setScanProgress(prev => ({
          ...prev,
          nip4: {
            current: allMessages.length,
            status: `Batch ${Math.floor(processedMessages / DM_CONSTANTS.SCAN_BATCH_SIZE) + 1} complete: ${validBatchDMs.length} messages`
          }
        }));

        const oldestToMe = validBatchDMs.filter(m => m.pubkey !== user.pubkey).length > 0
          ? Math.min(...validBatchDMs.filter(m => m.pubkey !== user.pubkey).map(m => m.created_at))
          : Infinity;
        const oldestFromMe = validBatchDMs.filter(m => m.pubkey === user.pubkey).length > 0
          ? Math.min(...validBatchDMs.filter(m => m.pubkey === user.pubkey).map(m => m.created_at))
          : Infinity;

        const oldestInBatch = Math.min(oldestToMe, oldestFromMe);
        if (oldestInBatch !== Infinity) {
          currentSince = oldestInBatch;
        }

        if (validBatchDMs.length < batchLimit * 2) break;
      } catch (error) {
        console.error('[DM] NIP-4 Error in batch query:', error);
        break;
      }
    }

    setScanProgress(prev => ({ ...prev, nip4: null }));
    return allMessages;
  }, [user, nostr]);

  // Load past NIP-17 messages
  const loadPastNIP17Messages = useCallback(async (sinceTimestamp?: number) => {
    if (!user?.pubkey) return;

    let allNIP17Events: NostrEvent[] = [];
    let processedMessages = 0;
    
    // Adjust since timestamp to account for NIP-17 timestamp fuzzing (±2 days)
    // We need to query from (lastSync - 2 days) to catch messages with randomized past timestamps
    // This may fetch duplicates, but they're filtered by message ID in addMessageToState
    const TWO_DAYS_IN_SECONDS = 2 * 24 * 60 * 60;
    let currentSince = sinceTimestamp ? sinceTimestamp - TWO_DAYS_IN_SECONDS : 0;

    console.log('[DM] loadPastNIP17Messages called with sinceTimestamp:', sinceTimestamp, '(using:', currentSince, 'after adjusting for timestamp fuzzing)');

    setScanProgress(prev => ({ ...prev, nip17: { current: 0, status: SCAN_STATUS_MESSAGES.NIP17_STARTING } }));

    while (processedMessages < DM_CONSTANTS.SCAN_TOTAL_LIMIT) {
      const batchLimit = Math.min(DM_CONSTANTS.SCAN_BATCH_SIZE, DM_CONSTANTS.SCAN_TOTAL_LIMIT - processedMessages);

      const filters = [
        { kinds: [1059], '#p': [user.pubkey], limit: batchLimit, since: currentSince }
      ];

      try {
        const batchEvents = await nostr.query(filters, { signal: AbortSignal.timeout(DM_CONSTANTS.NIP17_QUERY_TIMEOUT) });

        if (batchEvents.length === 0) break;

        allNIP17Events = [...allNIP17Events, ...batchEvents];
        processedMessages += batchEvents.length;

        setScanProgress(prev => ({
          ...prev,
          nip17: {
            current: allNIP17Events.length,
            status: `Batch ${Math.floor(processedMessages / DM_CONSTANTS.SCAN_BATCH_SIZE) + 1} complete: ${batchEvents.length} messages`
          }
        }));

        if (batchEvents.length > 0) {
          const oldestInBatch = Math.min(...batchEvents.map(m => m.created_at));
          currentSince = oldestInBatch;
        }

        if (batchEvents.length < batchLimit) break;
      } catch (error) {
        console.error('[DM] NIP-17 Error in batch query:', error);
        break;
      }
    }

    setScanProgress(prev => ({ ...prev, nip17: null }));
    return allNIP17Events;
  }, [user, nostr]);

  // Query relays for messages
  const queryRelaysForMessagesSince = useCallback(async (protocol: MessageProtocol, sinceTimestamp?: number): Promise<MessageProcessingResult> => {
    if (protocol === MESSAGE_PROTOCOL.NIP17 && !enableNIP17) {
      return { lastMessageTimestamp: sinceTimestamp, messageCount: 0 };
    }

    if (!userPubkey) {
      return { lastMessageTimestamp: sinceTimestamp, messageCount: 0 };
    }

    if (protocol === MESSAGE_PROTOCOL.NIP04) {
      const fetchStartTime = performance.now();
      const messages = await loadPastNIP4Messages(sinceTimestamp);
      console.log(`[DM] ⏱️ NIP-04 fetch from relay took ${(performance.now() - fetchStartTime).toFixed(0)}ms`);

      if (messages && messages.length > 0) {
        const processStartTime = performance.now();
        const newState = new Map();

        for (const message of messages) {
          const isFromUser = message.pubkey === user?.pubkey;
          const recipientPTag = message.tags?.find(([name]) => name === 'p')?.[1];
          const otherPubkey = isFromUser ? recipientPTag : message.pubkey;

          if (!otherPubkey || otherPubkey === user?.pubkey) continue;

          const { decryptedContent, error } = await decryptNIP4Message(message, otherPubkey);

          const decryptedMessage: DecryptedMessage = {
            ...message,
            content: message.content,
            decryptedContent: decryptedContent,
            error: error,
          };

          const messageAge = Date.now() - (message.created_at * 1000);
          if (messageAge < 5000) {
            decryptedMessage.clientFirstSeen = Date.now();
          }

          if (!newState.has(otherPubkey)) {
            newState.set(otherPubkey, createEmptyParticipant());
          }

          const participant = newState.get(otherPubkey)!;
          participant.messages.push(decryptedMessage);
          participant.hasNIP4 = true;
        }

        newState.forEach(participant => {
          sortAndUpdateParticipantState(participant);
        });

        mergeMessagesIntoState(newState);
        console.log(`[DM] ⏱️ NIP-04 processing (decrypt + merge) took ${(performance.now() - processStartTime).toFixed(0)}ms`);

        const currentTime = Math.floor(Date.now() / 1000);
        setLastSync(prev => ({ ...prev, nip4: currentTime }));

        const newestMessage = messages.reduce((newest, msg) =>
          msg.created_at > newest.created_at ? msg : newest
        );
        return { lastMessageTimestamp: newestMessage.created_at, messageCount: messages.length };
      } else {
        // No new messages, but we still successfully queried relays - update lastSync
        const currentTime = Math.floor(Date.now() / 1000);
        setLastSync(prev => ({ ...prev, nip4: currentTime }));
        return { lastMessageTimestamp: sinceTimestamp, messageCount: 0 };
      }
    } else if (protocol === MESSAGE_PROTOCOL.NIP17) {
      const fetchStartTime = performance.now();
      const messages = await loadPastNIP17Messages(sinceTimestamp);
      console.log(`[DM] ⏱️ NIP-17 fetch from relay took ${(performance.now() - fetchStartTime).toFixed(0)}ms`);

      if (messages && messages.length > 0) {
        const processStartTime = performance.now();
        const newState = new Map();

        for (const giftWrap of messages) {
          const { processedMessage, conversationPartner, sealEvent } = await processNIP17GiftWrap(giftWrap);

          // Use the real message (kind 14) timestamp, not the randomized gift wrap timestamp
          const messageWithAnimation: DecryptedMessage = {
            ...processedMessage,
            content: giftWrap.content, // Keep original encrypted content for reference
            sealEvent, // Store just the seal (kind 13) - only 1 decrypt needed
          };

          // Use real message timestamp for recency check
          const messageAge = Date.now() - (processedMessage.created_at * 1000);
          if (messageAge < 5000) {
            messageWithAnimation.clientFirstSeen = Date.now();
          }

          if (!newState.has(conversationPartner)) {
            newState.set(conversationPartner, createEmptyParticipant());
          }

          newState.get(conversationPartner)!.messages.push(messageWithAnimation);
          newState.get(conversationPartner)!.hasNIP17 = true;
        }

        newState.forEach(participant => {
          sortAndUpdateParticipantState(participant);
        });

        mergeMessagesIntoState(newState);
        console.log(`[DM] ⏱️ NIP-17 processing (decrypt + merge) took ${(performance.now() - processStartTime).toFixed(0)}ms`);

        const currentTime = Math.floor(Date.now() / 1000);
        setLastSync(prev => ({ ...prev, nip17: currentTime }));

        const newestMessage = messages.reduce((newest, msg) =>
          msg.created_at > newest.created_at ? msg : newest
        );
        return { lastMessageTimestamp: newestMessage.created_at, messageCount: messages.length };
      } else {
        // No new messages, but we still successfully queried relays - update lastSync
        const currentTime = Math.floor(Date.now() / 1000);
        setLastSync(prev => ({ ...prev, nip17: currentTime }));
        return { lastMessageTimestamp: sinceTimestamp, messageCount: 0 };
      }
    }

    return { lastMessageTimestamp: sinceTimestamp, messageCount: 0 };
  }, [enableNIP17, userPubkey, loadPastNIP4Messages, loadPastNIP17Messages, user]);

  // Decrypt NIP-4 message
  const decryptNIP4Message = useCallback(async (event: NostrEvent, otherPubkey: string): Promise<DecryptionResult> => {
    try {
      if (user?.signer?.nip04) {
        const decryptedContent = await user.signer.nip04.decrypt(otherPubkey, event.content);
        return { decryptedContent };
      } else {
        return {
          decryptedContent: '',
          error: 'No NIP-04 decryption available'
        };
      }
    } catch (error) {
      console.error(`[DM] Failed to decrypt NIP-4 message ${event.id}:`, error);
      return {
        decryptedContent: '',
        error: 'Decryption failed'
      };
    }
  }, [user]);

  // Create empty participant
  const createEmptyParticipant = useCallback(() => ({
    messages: [],
    lastActivity: 0,
    lastMessage: null,
    hasNIP4: false,
    hasNIP17: false,
  }), []);

  // Sort and update participant state
  const sortAndUpdateParticipantState = useCallback((participant: { messages: DecryptedMessage[]; lastActivity: number; lastMessage: DecryptedMessage | null }) => {
    participant.messages.sort((a, b) => a.created_at - b.created_at);
    if (participant.messages.length > 0) {
      participant.lastActivity = participant.messages[participant.messages.length - 1].created_at;
      participant.lastMessage = participant.messages[participant.messages.length - 1];
    }
  }, []);

  // Merge messages into state
  const mergeMessagesIntoState = useCallback((newState: MessagesState) => {
    setMessages(prev => {
      const finalMap = new Map(prev);

      newState.forEach((value, key) => {
        const existing = finalMap.get(key);
        if (existing) {
          const existingMessageIds = new Set(existing.messages.map(msg => msg.id));
          const newMessages = value.messages.filter(msg => !existingMessageIds.has(msg.id));

          const mergedMessages = [...existing.messages, ...newMessages];
          mergedMessages.sort((a, b) => a.created_at - b.created_at);

          // Recalculate lastActivity and lastMessage after merging
          const lastMessage = mergedMessages.length > 0 ? mergedMessages[mergedMessages.length - 1] : null;
          const lastActivity = lastMessage ? lastMessage.created_at : existing.lastActivity;

          finalMap.set(key, {
            ...existing,
            messages: mergedMessages,
            lastActivity,
            lastMessage,
            hasNIP4: existing.hasNIP4 || value.hasNIP4,
            hasNIP17: existing.hasNIP17 || value.hasNIP17,
          });
        } else {
          finalMap.set(key, value);
        }
      });

      return finalMap;
    });
  }, []);

  // Add message to state
  const addMessageToState = useCallback((message: DecryptedMessage, conversationPartner: string, protocol: MessageProtocol) => {
    setMessages(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(conversationPartner);

      if (existing) {
        if (existing.messages.some(msg => msg.id === message.id)) {
          return prev;
        }

        const optimisticIndex = existing.messages.findIndex(msg =>
          msg.isSending &&
          msg.pubkey === message.pubkey &&
          msg.decryptedContent === message.decryptedContent &&
          Math.abs(msg.created_at - message.created_at) <= 30
        );

        let updatedMessages: DecryptedMessage[];
        if (optimisticIndex !== -1) {
          const existingMessage = existing.messages[optimisticIndex];
          updatedMessages = [...existing.messages];
          updatedMessages[optimisticIndex] = {
            ...message,
            created_at: existingMessage.created_at,
            clientFirstSeen: existingMessage.clientFirstSeen
          };
        } else {
          updatedMessages = [...existing.messages, message];
        }

        updatedMessages.sort((a, b) => a.created_at - b.created_at);

        const actualLastMessage = updatedMessages[updatedMessages.length - 1];

        newMap.set(conversationPartner, {
          ...existing,
          messages: updatedMessages,
          lastActivity: actualLastMessage.created_at,
          lastMessage: actualLastMessage,
          hasNIP4: protocol === MESSAGE_PROTOCOL.NIP04 ? true : existing.hasNIP4,
          hasNIP17: protocol === MESSAGE_PROTOCOL.NIP17 ? true : existing.hasNIP17,
        });
      } else {
        const newConversation = {
          messages: [message],
          lastActivity: message.created_at,
          lastMessage: message,
          hasNIP4: protocol === MESSAGE_PROTOCOL.NIP04,
          hasNIP17: protocol === MESSAGE_PROTOCOL.NIP17,
        };

        newMap.set(conversationPartner, newConversation);
      }

      return newMap;
    });
  }, []);

  // Process incoming NIP-4 message
  const processIncomingNIP4Message = useCallback(async (event: NostrEvent) => {
    if (!user?.pubkey) return;

    if (!validateDMEvent(event)) return;

    const isFromUser = event.pubkey === user.pubkey;
    const recipientPTag = event.tags?.find(([name]) => name === 'p')?.[1];
    const otherPubkey = isFromUser ? recipientPTag : event.pubkey;

    if (!otherPubkey || otherPubkey === user.pubkey) return;

    const { decryptedContent, error } = await decryptNIP4Message(event, otherPubkey);

    const decryptedMessage: DecryptedMessage = {
      ...event,
      content: event.content,
      decryptedContent: decryptedContent,
      error: error,
    };

    const messageAge = Date.now() - (event.created_at * 1000);
    if (messageAge < 5000) {
      decryptedMessage.clientFirstSeen = Date.now();
    }

    addMessageToState(decryptedMessage, otherPubkey, MESSAGE_PROTOCOL.NIP04);
  }, [user, decryptNIP4Message, addMessageToState]);

  // Process NIP-17 Gift Wrap
  const processNIP17GiftWrap = useCallback(async (event: NostrEvent): Promise<NIP17ProcessingResult> => {
    if (!user?.signer?.nip44) {
      return {
        processedMessage: {
          ...event,
          content: '',
          decryptedContent: '',
          error: 'No NIP-44 decryption available',
        },
        conversationPartner: event.pubkey,
        sealEvent: event, // Return the event itself as fallback
      };
    }

    try {
      const sealContent = await user.signer.nip44.decrypt(event.pubkey, event.content);
      const sealEvent = JSON.parse(sealContent) as NostrEvent;

      if (sealEvent.kind !== 13) {
        console.log(`[DM] ⚠️ NIP-17 INVALID SEAL - expected kind 13, got ${sealEvent.kind}`, {
          giftWrapId: event.id,
          sealKind: sealEvent.kind,
        });
        return {
          processedMessage: {
            ...event,
            content: '',
            decryptedContent: '',
            error: `Invalid Seal format - expected kind 13, got ${sealEvent.kind}`,
          },
          conversationPartner: event.pubkey,
          sealEvent: event, // Return the gift wrap as fallback
        };
      }

      const messageContent = await user.signer.nip44.decrypt(sealEvent.pubkey, sealEvent.content);
      const messageEvent = JSON.parse(messageContent) as NostrEvent;

      // Accept both kind 14 (text) and kind 15 (files/attachments)
      if (messageEvent.kind !== 14 && messageEvent.kind !== 15) {
        console.log(`[DM] ⚠️ NIP-17 MESSAGE WITH UNSUPPORTED INNER EVENT KIND:`, {
          giftWrapId: event.id,
          innerKind: messageEvent.kind,
          expectedKinds: [14, 15],
          sealPubkey: sealEvent.pubkey,
          messageEvent: messageEvent,
        });
        return {
          processedMessage: {
            ...event,
            content: '',
            decryptedContent: '',
            error: `Invalid message format - expected kind 14 or 15, got ${messageEvent.kind}`,
          },
          conversationPartner: event.pubkey,
          sealEvent, // Return the seal
        };
      }

      let conversationPartner: string;
      if (sealEvent.pubkey === user.pubkey) {
        const recipient = messageEvent.tags.find(([name]) => name === 'p')?.[1];
        if (!recipient || recipient === user.pubkey) {
          return {
            processedMessage: {
              ...event,
              content: '',
              decryptedContent: '',
              error: 'Invalid recipient - malformed p tag',
            },
            conversationPartner: event.pubkey,
            sealEvent, // Return the seal
          };
        } else {
          conversationPartner = recipient;
        }
      } else {
        conversationPartner = sealEvent.pubkey;
      }

      // console.log(`[DM] ✅ NIP-17 message processed successfully`, {
      //   giftWrapId: event.id,
      //   innerKind: messageEvent.kind, // 14 for text, 15 for files
      //   messageId: messageEvent.id,
      //   conversationPartner,
      // });

      return {
        processedMessage: {
          ...messageEvent,
          id: messageEvent.id || `missing-nip17-inner-${messageEvent.created_at}-${messageEvent.pubkey.substring(0, 8)}-${messageEvent.content.substring(0, 16)}`,
          content: event.content,
          decryptedContent: messageEvent.content,
        },
        conversationPartner,
        sealEvent, // Return the seal for caching
      };
    } catch (error) {
      nip17ErrorLogger(error as Error);
      return {
        processedMessage: {
          ...event,
          content: '',
          decryptedContent: '',
          error: 'Failed to decrypt or parse NIP-17 message',
        },
        conversationPartner: event.pubkey,
        sealEvent: event, // Return the gift wrap as fallback
      };
    }
  }, [user]);

  // Process incoming NIP-17 message
  const processIncomingNIP17Message = useCallback(async (event: NostrEvent) => {
    if (!user?.pubkey) return;

    if (event.kind !== 1059) return;

    const { processedMessage, conversationPartner, sealEvent } = await processNIP17GiftWrap(event);

    // Use the real message (kind 14) timestamp, not the randomized gift wrap timestamp
    const messageWithAnimation: DecryptedMessage = {
      ...processedMessage,
      content: event.content, // Keep original encrypted content for reference
      sealEvent, // Store just the seal (kind 13) - only 1 decrypt needed
    };

    // Use real message timestamp for recency check
    const messageAge = Date.now() - (processedMessage.created_at * 1000);
    if (messageAge < 5000) {
      messageWithAnimation.clientFirstSeen = Date.now();
    }

    addMessageToState(messageWithAnimation, conversationPartner, MESSAGE_PROTOCOL.NIP17);
  }, [user, processNIP17GiftWrap, addMessageToState]);

  // Start NIP-4 subscription
  const startNIP4Subscription = useCallback(async (sinceTimestamp?: number) => {
    if (!user?.pubkey || !nostr) return;

    if (nip4SubscriptionRef.current) {
      nip4SubscriptionRef.current.close();
    }

    try {
      let subscriptionSince = sinceTimestamp || Math.floor(Date.now() / 1000);
      if (!sinceTimestamp && lastSync.nip4) {
        subscriptionSince = lastSync.nip4 - DM_CONSTANTS.SUBSCRIPTION_OVERLAP_SECONDS;
      }

      const filters = [
        { kinds: [4], '#p': [user.pubkey], since: subscriptionSince },
        { kinds: [4], authors: [user.pubkey], since: subscriptionSince }
      ];

      const subscription = nostr.req(filters);
      let isActive = true;

      (async () => {
        try {
          for await (const msg of subscription) {
            if (!isActive) break;
            if (msg[0] === 'EVENT') {
              await processIncomingNIP4Message(msg[2]);
            }
          }
        } catch (error) {
          if (isActive) {
            console.error('[DM] NIP-4 subscription error:', error);
          }
        }
      })();

      nip4SubscriptionRef.current = {
        close: () => {
          isActive = false;
        }
      };

      setSubscriptions(prev => ({ ...prev, isNIP4Connected: true }));
    } catch (error) {
      console.error('[DM] Failed to start NIP-4 subscription:', error);
      setSubscriptions(prev => ({ ...prev, isNIP4Connected: false }));
    }
  }, [user, nostr, lastSync.nip4, processIncomingNIP4Message]);

  // Start NIP-17 subscription
  const startNIP17Subscription = useCallback(async (sinceTimestamp?: number) => {
    if (!user?.pubkey || !nostr || !enableNIP17) return;

    if (nip17SubscriptionRef.current) {
      nip17SubscriptionRef.current.close();
    }

    try {
      let subscriptionSince = sinceTimestamp || Math.floor(Date.now() / 1000);
      if (!sinceTimestamp && lastSync.nip17) {
        subscriptionSince = lastSync.nip17 - DM_CONSTANTS.SUBSCRIPTION_OVERLAP_SECONDS;
      }
      
      // Adjust for NIP-17 timestamp fuzzing (±2 days)
      // Subscribe from (lastSync - 2 days) to catch messages with randomized past timestamps
      const TWO_DAYS_IN_SECONDS = 2 * 24 * 60 * 60;
      subscriptionSince = subscriptionSince - TWO_DAYS_IN_SECONDS;

      const filters = [{
        kinds: [1059],
        '#p': [user.pubkey],
        since: subscriptionSince,
      }];

      const subscription = nostr.req(filters);
      let isActive = true;

      (async () => {
        try {
          for await (const msg of subscription) {
            if (!isActive) break;
            if (msg[0] === 'EVENT') {
              await processIncomingNIP17Message(msg[2]);
            }
          }
        } catch (error) {
          if (isActive) {
            console.error('[DM] NIP-17 subscription error:', error);
          }
        }
      })();

      nip17SubscriptionRef.current = {
        close: () => {
          isActive = false;
        }
      };

      setSubscriptions(prev => ({ ...prev, isNIP17Connected: true }));
    } catch (error) {
      console.error('[DM] Failed to start NIP-17 subscription:', error);
      setSubscriptions(prev => ({ ...prev, isNIP17Connected: false }));
    }
  }, [user, nostr, lastSync.nip17, enableNIP17, processIncomingNIP17Message]);

  // Load all cached messages at once (both protocols)
  const loadAllCachedMessages = useCallback(async (): Promise<{ nip4Since?: number; nip17Since?: number }> => {
    if (!userPubkey) return {};

    try {
      const dbReadStart = performance.now();
      const { readMessagesFromDB } = await import('@/lib/dmMessageStore');
      const cachedStore = await readMessagesFromDB(userPubkey, user?.signer);
      console.log(`[DM] ⏱️ IndexedDB read + decrypt took ${(performance.now() - dbReadStart).toFixed(0)}ms`);

      if (!cachedStore || Object.keys(cachedStore.participants).length === 0) {
        return {};
      }

      const filteredParticipants = enableNIP17
        ? cachedStore.participants
        : Object.fromEntries(
          Object.entries(cachedStore.participants).filter(([_, participant]) => !participant.hasNIP17)
        );

      const newState = new Map();
      let messageCount = 0;

      // Messages are already decrypted in the encrypted blob!
      // Just load them directly into state
      for (const [participantPubkey, participant] of Object.entries(filteredParticipants)) {
        const processedMessages = participant.messages.map(msg => {
          messageCount++;
          // Content is already decrypted, just add the decryptedContent field
          return {
            ...msg,
            id: msg.id || `missing-${msg.kind}-${msg.created_at}-${msg.pubkey.substring(0, 8)}-${msg.content?.substring(0, 16) || 'nocontent'}`,
            decryptedContent: msg.content, // Content is already plaintext
          } as NostrEvent & { decryptedContent?: string };
        });

        newState.set(participantPubkey, {
          messages: processedMessages,
          lastActivity: participant.lastActivity,
          lastMessage: processedMessages.length > 0 ? processedMessages[processedMessages.length - 1] : null,
          hasNIP4: participant.hasNIP4,
          hasNIP17: participant.hasNIP17,
        });
      }

      console.log(`[DM] ⏱️ Loaded ${messageCount} messages from encrypted cache (no re-decryption needed!)`);

      const setStateStart = performance.now();
      setMessages(newState);
      if (cachedStore.lastSync) {
        setLastSync(cachedStore.lastSync);
      }
      console.log(`[DM] ⏱️ Setting state took ${(performance.now() - setStateStart).toFixed(0)}ms`);

      return {
        nip4Since: cachedStore.lastSync?.nip4 || undefined,
        nip17Since: cachedStore.lastSync?.nip17 || undefined,
      };
    } catch (error) {
      console.error('[DM] Error loading cached messages:', error);
      return {};
    }
  }, [userPubkey, enableNIP17, user]);

  // Start message loading
  const startMessageLoading = useCallback(async () => {
    if (isLoading) return;

    const startTime = performance.now();
    console.log('[DM] ⏱️ Starting message loading...');

    setIsLoading(true);
    setLoadingPhase(LOADING_PHASES.CACHE);

    try {
      // ===== PHASE 1: Load cache and show immediately =====
      const cacheStartTime = performance.now();
      const { nip4Since, nip17Since } = await loadAllCachedMessages();
      console.log(`[DM] ⏱️ Cache load took ${(performance.now() - cacheStartTime).toFixed(0)}ms`);
      
      // Mark as completed BEFORE releasing isLoading to prevent re-trigger
      setHasInitialLoadCompleted(true);
      
      // Show cached messages immediately! Don't wait for relays
      setLoadingPhase(LOADING_PHASES.READY);
      setIsLoading(false);
      const cacheOnlyTime = performance.now() - startTime;
      console.log(`[DM] ⏱️ UI ready (cache only): ${cacheOnlyTime.toFixed(0)}ms`);

      // ===== PHASE 2: Query relays in background (non-blocking, parallel) =====
      console.log('[DM] 🔄 Querying relays in background...', { nip4Since, nip17Since });
      setLoadingPhase(LOADING_PHASES.RELAYS);

      const relayStartTime = performance.now();
      
      // Run NIP-04 and NIP-17 queries IN PARALLEL
      const [nip4Result, nip17Result] = await Promise.all([
        (async () => {
          const nip4StartTime = performance.now();
          const result = await queryRelaysForMessagesSince(MESSAGE_PROTOCOL.NIP04, nip4Since);
          console.log(`[DM] ⏱️ NIP-04 relay query took ${(performance.now() - nip4StartTime).toFixed(0)}ms (${result.messageCount} messages)`);
          return result;
        })(),
        enableNIP17 ? (async () => {
          const nip17StartTime = performance.now();
          const result = await queryRelaysForMessagesSince(MESSAGE_PROTOCOL.NIP17, nip17Since);
          console.log(`[DM] ⏱️ NIP-17 relay query took ${(performance.now() - nip17StartTime).toFixed(0)}ms (${result.messageCount} messages)`);
          return result;
        })() : Promise.resolve({ lastMessageTimestamp: undefined, messageCount: 0 })
      ]);

      const totalRelayTime = performance.now() - relayStartTime;
      console.log(`[DM] ⏱️ Total relay queries (parallel): ${totalRelayTime.toFixed(0)}ms`);

      const totalNewMessages = nip4Result.messageCount + (nip17Result?.messageCount || 0);
      if (totalNewMessages > 0) {
        setShouldSaveImmediately(true);
        console.log(`[DM] 📥 Received ${totalNewMessages} new messages from relays`);
      }

      // ===== PHASE 3: Setup subscriptions =====
      setLoadingPhase(LOADING_PHASES.SUBSCRIPTIONS);

      const subStartTime = performance.now();
      await Promise.all([
        startNIP4Subscription(nip4Result.lastMessageTimestamp),
        enableNIP17 ? startNIP17Subscription(nip17Result?.lastMessageTimestamp) : Promise.resolve()
      ]);
      console.log(`[DM] ⏱️ Subscriptions setup took ${(performance.now() - subStartTime).toFixed(0)}ms`);

      setLoadingPhase(LOADING_PHASES.READY);
      
      const totalTime = performance.now() - startTime;
      console.log(`[DM] ⏱️ Total loading time (cache + background sync): ${totalTime.toFixed(0)}ms`);
    } catch (error) {
      console.error('[DM] Error in message loading:', error);
      setHasInitialLoadCompleted(true);
      setLoadingPhase(LOADING_PHASES.READY);
      setIsLoading(false);
    }
  }, [loadAllCachedMessages, queryRelaysForMessagesSince, startNIP4Subscription, startNIP17Subscription, enableNIP17, isLoading]);

  // Clear cache and refetch from relays
  const clearCacheAndRefetch = useCallback(async () => {
    if (!enabled || !userPubkey) return;

    try {
      // Close existing subscriptions
      if (nip4SubscriptionRef.current) {
        nip4SubscriptionRef.current.close();
        nip4SubscriptionRef.current = null;
      }
      if (nip17SubscriptionRef.current) {
        nip17SubscriptionRef.current.close();
        nip17SubscriptionRef.current = null;
      }

      // Clear IndexedDB cache
      const { deleteMessagesFromDB } = await import('@/lib/dmMessageStore');
      await deleteMessagesFromDB(userPubkey);

      // Reset all state
      setMessages(new Map());
      setLastSync({ nip4: null, nip17: null });
      setSubscriptions({ isNIP4Connected: false, isNIP17Connected: false });
      setScanProgress({ nip4: null, nip17: null });
      setLoadingPhase(LOADING_PHASES.IDLE);
      
      // Trigger reload by setting hasInitialLoadCompleted to false
      setHasInitialLoadCompleted(false);
    } catch (error) {
      console.error('[DM] Error clearing cache:', error);
      throw error;
    }
  }, [enabled, userPubkey]);

  // Main effect to load messages
  useEffect(() => {
    if (!enabled || !userPubkey || hasInitialLoadCompleted || isLoading) return;
    startMessageLoading();
  }, [enabled, userPubkey, hasInitialLoadCompleted, isLoading, startMessageLoading]);

  // Cleanup effect
  useEffect(() => {
    if (!enabled) return;
    
    return () => {
      if (nip4SubscriptionRef.current) {
        nip4SubscriptionRef.current.close();
        nip4SubscriptionRef.current = null;
      }
      if (nip17SubscriptionRef.current) {
        nip17SubscriptionRef.current.close();
        nip17SubscriptionRef.current = null;
      }
    };
  }, [enabled, userPubkey]);

  // Cleanup subscriptions
  useEffect(() => {
    if (!enabled) return;
    
    return () => {
      if (nip4SubscriptionRef.current) {
        nip4SubscriptionRef.current.close();
      }
      if (nip17SubscriptionRef.current) {
        nip17SubscriptionRef.current.close();
      }
      if (debouncedWriteRef.current) {
        clearTimeout(debouncedWriteRef.current);
      }
      setSubscriptions({ isNIP4Connected: false, isNIP17Connected: false });
    };
  }, [enabled]);

  // Detect relay changes and reload messages
  useEffect(() => {
    const relayChanged = previousRelayUrl.current !== appConfig.relayUrl;
    
    console.log('[DM] Relay change check:', {
      previousRelay: previousRelayUrl.current,
      currentRelay: appConfig.relayUrl,
      relayChanged,
      enabled,
      userPubkey: !!userPubkey,
      hasInitialLoadCompleted
    });
    
    previousRelayUrl.current = appConfig.relayUrl;
    
    if (relayChanged && enabled && userPubkey && hasInitialLoadCompleted) {
      console.log('[DM] Relay changed, clearing cache and refetching...');
      clearCacheAndRefetch();
    }
  }, [enabled, userPubkey, appConfig.relayUrl, hasInitialLoadCompleted, clearCacheAndRefetch]);

  // Detect hard refresh shortcut (Ctrl+Shift+R / Cmd+Shift+R) to clear cache
  useEffect(() => {
    if (!enabled || !userPubkey) return;

    const handleHardRefresh = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'R' || e.key === 'r')) {
        try {
          sessionStorage.setItem('dm-clear-cache-on-load', 'true');
        } catch (error) {
          console.warn('[DM] SessionStorage unavailable, cache won\'t clear on hard refresh:', error);
        }
      }
    };

    window.addEventListener('keydown', handleHardRefresh);
    return () => window.removeEventListener('keydown', handleHardRefresh);
  }, [enabled, userPubkey]);

  // Clear cache after hard refresh
  useEffect(() => {
    if (!enabled || !userPubkey) return;

    try {
      const shouldClearCache = sessionStorage.getItem('dm-clear-cache-on-load');
      if (shouldClearCache) {
        console.log('[DM] Hard refresh detected, clearing cache and refetching messages...');
        sessionStorage.removeItem('dm-clear-cache-on-load');
        clearCacheAndRefetch();
      }
    } catch (error) {
      console.warn('[DM] Could not check sessionStorage for cache clear flag:', error);
    }
  }, [enabled, userPubkey, clearCacheAndRefetch]);

  // Conversations summary
  const conversations = useMemo(() => {
    const conversationsList: ConversationSummary[] = [];

    messages.forEach((participant, participantPubkey) => {
      if (!participant.messages.length) return;

      const userHasSentMessage = participant.messages.some(msg => msg.pubkey === user?.pubkey);
      const isKnown = userHasSentMessage;
      const isRequest = !userHasSentMessage;

      const lastMessage = participant.messages[participant.messages.length - 1];
      const isFromUser = lastMessage.pubkey === user?.pubkey;

      conversationsList.push({
        id: participantPubkey,
        pubkey: participantPubkey,
        lastMessage: participant.lastMessage,
        lastActivity: participant.lastActivity,
        hasNIP4Messages: participant.hasNIP4,
        hasNIP17Messages: participant.hasNIP17,
        isKnown: isKnown,
        isRequest: isRequest,
        lastMessageFromUser: isFromUser,
      });
    });

    return conversationsList.sort((a, b) => b.lastActivity - a.lastActivity);
  }, [messages, user?.pubkey]);

  // Write to store
  const writeAllMessagesToStore = useCallback(async () => {
    if (!userPubkey) return;

    try {
      const { writeMessagesToDB } = await import('@/lib/dmMessageStore');

      const messageStore = {
        participants: {} as Record<string, {
          messages: NostrEvent[];
          lastActivity: number;
          hasNIP4: boolean;
          hasNIP17: boolean;
        }>,
        lastSync: {
          nip4: lastSync.nip4,
          nip17: lastSync.nip17,
        }
      };

      messages.forEach((participant, participantPubkey) => {
        messageStore.participants[participantPubkey] = {
          messages: participant.messages.map(msg => {
            // Store decrypted messages with plaintext content
            // The entire store will be NIP-44 encrypted as one blob
            return {
              id: msg.id,
              pubkey: msg.pubkey,
              content: msg.decryptedContent || msg.content, // Store DECRYPTED content
              created_at: msg.created_at,
              kind: msg.kind,
              tags: msg.tags,
              sig: msg.sig,
            } as NostrEvent;
          }),
          lastActivity: participant.lastActivity,
          hasNIP4: participant.hasNIP4,
          hasNIP17: participant.hasNIP17,
        };
      });

      await writeMessagesToDB(userPubkey, messageStore, user?.signer);

      const currentTime = Math.floor(Date.now() / 1000);
      setLastSync(prev => ({
        nip4: prev.nip4 || currentTime,
        nip17: prev.nip17 || currentTime
      }));
    } catch (error) {
      console.error('[DM] Error writing messages to IndexedDB:', error);
    }
  }, [messages, userPubkey, lastSync, user?.signer]);

  // Trigger debounced write
  const triggerDebouncedWrite = useCallback(() => {
    if (debouncedWriteRef.current) {
      clearTimeout(debouncedWriteRef.current);
    }
    debouncedWriteRef.current = setTimeout(() => {
      writeAllMessagesToStore();
      debouncedWriteRef.current = null;
    }, DM_CONSTANTS.DEBOUNCED_WRITE_DELAY);
  }, [writeAllMessagesToStore]);

  // Watch messages and save
  useEffect(() => {
    if (!enabled || messages.size === 0) return;

    if (shouldSaveImmediately) {
      setShouldSaveImmediately(false);
      writeAllMessagesToStore();
    } else {
      triggerDebouncedWrite();
    }
  }, [enabled, messages, shouldSaveImmediately, writeAllMessagesToStore, triggerDebouncedWrite]);

  // Send message
  const sendMessage = useCallback(async (params: { 
    recipientPubkey: string; 
    content: string; 
    protocol?: MessageProtocol;
    attachments?: FileAttachment[];
  }) => {
    if (!enabled) return;
    
    const { recipientPubkey, content, protocol = MESSAGE_PROTOCOL.NIP04, attachments } = params;
    if (!userPubkey) return;

    const optimisticId = `optimistic-${Date.now()}-${Math.random()}`;
    const optimisticMessage: DecryptedMessage = {
      id: optimisticId,
      kind: protocol === MESSAGE_PROTOCOL.NIP04 ? 4 : 14, // Use kind 14 for NIP-17 (the real message kind)
      pubkey: userPubkey,
      created_at: Math.floor(Date.now() / 1000), // Real timestamp
      tags: [['p', recipientPubkey]],
      content: '',
      decryptedContent: content,
      sig: '',
      isSending: true,
      clientFirstSeen: Date.now(),
    };

    addMessageToState(optimisticMessage, recipientPubkey, protocol === MESSAGE_PROTOCOL.NIP04 ? MESSAGE_PROTOCOL.NIP04 : MESSAGE_PROTOCOL.NIP17);

    try {
      if (protocol === MESSAGE_PROTOCOL.NIP04) {
        await sendNIP4Message.mutateAsync({ recipientPubkey, content, attachments });
      } else if (protocol === MESSAGE_PROTOCOL.NIP17) {
        await sendNIP17Message.mutateAsync({ recipientPubkey, content, attachments });
      }
    } catch (error) {
      console.error(`[DM] Failed to send ${protocol} message:`, error);
    }
  }, [enabled, userPubkey, addMessageToState, sendNIP4Message, sendNIP17Message]);

  const isDoingInitialLoad = isLoading && (loadingPhase === LOADING_PHASES.CACHE || loadingPhase === LOADING_PHASES.RELAYS);

  const contextValue: DMContextType = {
    messages,
    isLoading,
    loadingPhase,
    isDoingInitialLoad,
    lastSync,
    conversations,
    sendMessage,
    protocolMode,
    scanProgress,
    subscriptions,
    clearCacheAndRefetch,
  };

  return (
    <DMContext.Provider value={contextValue}>
      {children}
    </DMContext.Provider>
  );
}

