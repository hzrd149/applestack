import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback, useMemo, useRef } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useSendDM } from '@/hooks/useSendDM';
import { useNostr } from '@nostrify/react';
import { validateDMEvent } from '@/lib/dmUtils';
import { LOADING_PHASES, type LoadingPhase, PROTOCOL_MODE, type ProtocolMode } from '@/lib/dmConstants';
import type { NostrEvent } from '@nostrify/nostrify';
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
}

interface NIP17ProcessingResult {
  processedMessage: DecryptedMessage;
  conversationPartner: string;
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
  sendMessage: (params: { recipientPubkey: string; content: string; protocol?: MessageProtocol }) => Promise<void>;
  protocolMode: ProtocolMode;
  scanProgress: ScanProgressState;
  clearCacheAndReload: () => Promise<void>;
}

const DMContext = createContext<DMContextType | null>(null);

export function useDMContext(): DMContextType {
  const context = useContext(DMContext);
  if (!context) {
    throw new Error('useDMContext must be used within DMProvider');
  }
  return context;
}

export function useConversationMessages(conversationId: string) {
  const { messages: allMessages } = useDMContext();

  return useMemo(() => {
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

    return {
      messages: conversationData.messages,
      hasMoreMessages: false,
      totalCount: conversationData.messages.length,
      lastMessage: conversationData.lastMessage,
      lastActivity: conversationData.lastActivity,
    };
  }, [allMessages, conversationId]);
}

interface DMProviderProps {
  children: ReactNode;
  protocolMode?: ProtocolMode;
}

export function DMProvider({ children, protocolMode = PROTOCOL_MODE.NIP17_ONLY }: DMProviderProps) {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { sendNIP4Message, sendNIP17Message } = useSendDM();

  const userPubkey = useMemo(() => user?.pubkey, [user?.pubkey]);
  
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

  // Load past NIP-4 messages
  const loadPastNIP4Messages = useCallback(async (sinceTimestamp?: number) => {
    if (!user?.pubkey) return;

    let allMessages: NostrEvent[] = [];
    let processedMessages = 0;
    let currentSince = sinceTimestamp || 0;

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
    let currentSince = sinceTimestamp || 0;

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

  // Load cached messages
  const loadPreviousCachedMessages = useCallback(async (protocol: MessageProtocol): Promise<number | undefined> => {
    if (protocol === MESSAGE_PROTOCOL.NIP17 && !enableNIP17) return undefined;
    if (!userPubkey) return undefined;

    try {
      let sinceTimestamp: number | undefined;
      try {
        const { readMessagesFromDB } = await import('@/lib/dmMessageStore');
        const cachedStore = await readMessagesFromDB(userPubkey);

        if (cachedStore && Object.keys(cachedStore.participants).length > 0) {
          const filteredParticipants = enableNIP17
            ? cachedStore.participants
            : Object.fromEntries(
              Object.entries(cachedStore.participants).filter(([_, participant]) => !participant.hasNIP17)
            );

          if (protocol === MESSAGE_PROTOCOL.NIP04 && cachedStore.lastSync.nip4) {
            sinceTimestamp = cachedStore.lastSync.nip4;
          } else if (protocol === MESSAGE_PROTOCOL.NIP17 && cachedStore.lastSync.nip17) {
            sinceTimestamp = cachedStore.lastSync.nip17;
          }

          const newState = new Map();
          for (const [participantPubkey, participant] of Object.entries(filteredParticipants)) {
            const processedMessages = await Promise.all(participant.messages.map(async (msg) => {
              if (msg.kind === 4) {
                const isFromUser = msg.pubkey === user?.pubkey;
                const recipientPTag = msg.tags?.find(([name]) => name === 'p')?.[1];
                const otherPubkey = isFromUser ? recipientPTag : msg.pubkey;

                if (otherPubkey && otherPubkey !== user?.pubkey) {
                  const { decryptedContent, error } = await decryptNIP4Message(msg, otherPubkey);
                  return {
                    ...msg,
                    content: msg.content,
                    decryptedContent: decryptedContent,
                    error: error,
                  } as NostrEvent & { decryptedContent?: string; error?: string };
                }
              } else if (msg.kind === 1059) {
                const { processedMessage } = await processNIP17GiftWrap(msg);
                return {
                  ...msg,
                  decryptedContent: processedMessage.decryptedContent,
                  error: processedMessage.error,
                } as NostrEvent & { decryptedContent?: string; error?: string };
              }
              return msg;
            }));

            newState.set(participantPubkey, {
              messages: processedMessages,
              lastActivity: participant.lastActivity,
              lastMessage: processedMessages.length > 0 ? processedMessages[processedMessages.length - 1] : null,
              hasNIP4: participant.hasNIP4,
              hasNIP17: participant.hasNIP17,
            });
          }

          setMessages(newState);

          if (cachedStore.lastSync) {
            setLastSync(cachedStore.lastSync);
          }
        }
      } catch (error) {
        console.error('[DM] Error reading from IndexedDB:', error);
      }

      return sinceTimestamp;
    } catch (error) {
      console.error(`[DM] Error in Stage 1 for ${protocol}:`, error);
      return undefined;
    }
  }, [enableNIP17, userPubkey]);

  // Query relays for messages
  const queryRelaysForMessagesSince = useCallback(async (protocol: MessageProtocol, sinceTimestamp?: number): Promise<MessageProcessingResult> => {
    if (protocol === MESSAGE_PROTOCOL.NIP17 && !enableNIP17) {
      return { lastMessageTimestamp: sinceTimestamp, messageCount: 0 };
    }

    if (!userPubkey) {
      return { lastMessageTimestamp: sinceTimestamp, messageCount: 0 };
    }

    if (protocol === MESSAGE_PROTOCOL.NIP04) {
      const messages = await loadPastNIP4Messages(sinceTimestamp);

      if (messages && messages.length > 0) {
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
      const messages = await loadPastNIP17Messages(sinceTimestamp);

      if (messages && messages.length > 0) {
        const newState = new Map();

        for (const giftWrap of messages) {
          const { processedMessage, conversationPartner } = await processNIP17GiftWrap(giftWrap);

          const messageWithAnimation: DecryptedMessage = {
            ...giftWrap,
            decryptedContent: processedMessage.decryptedContent,
            error: processedMessage.error,
          };

          const messageAge = Date.now() - (giftWrap.created_at * 1000);
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
  }, [enableNIP17, userPubkey, loadPastNIP4Messages, loadPastNIP17Messages]);

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

          finalMap.set(key, {
            ...existing,
            messages: mergedMessages,
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
      };
    }

    try {
      const sealContent = await user.signer.nip44.decrypt(event.pubkey, event.content);
      const sealEvent = JSON.parse(sealContent) as NostrEvent;

      if (sealEvent.kind !== 13) {
        return {
          processedMessage: {
            ...event,
            content: '',
            decryptedContent: '',
            error: `Invalid Seal format - expected kind 13, got ${sealEvent.kind}`,
          },
          conversationPartner: event.pubkey,
        };
      }

      const messageContent = await user.signer.nip44.decrypt(sealEvent.pubkey, sealEvent.content);
      const messageEvent = JSON.parse(messageContent) as NostrEvent;

      if (messageEvent.kind !== 14) {
        return {
          processedMessage: {
            ...event,
            content: '',
            decryptedContent: '',
            error: `Invalid message format - expected kind 14, got ${messageEvent.kind}`,
          },
          conversationPartner: event.pubkey,
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
          };
        } else {
          conversationPartner = recipient;
        }
      } else {
        conversationPartner = sealEvent.pubkey;
      }

      return {
        processedMessage: {
          ...messageEvent,
          content: event.content,
          decryptedContent: messageEvent.content,
        },
        conversationPartner,
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
      };
    }
  }, [user]);

  // Process incoming NIP-17 message
  const processIncomingNIP17Message = useCallback(async (event: NostrEvent) => {
    if (!user?.pubkey) return;

    if (event.kind !== 1059) return;

    const { processedMessage, conversationPartner } = await processNIP17GiftWrap(event);

    const messageWithAnimation: DecryptedMessage = {
      ...event,
      decryptedContent: processedMessage.decryptedContent,
      error: processedMessage.error,
    };

    const messageAge = Date.now() - (event.created_at * 1000);
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

  // Start message loading
  const startMessageLoading = useCallback(async () => {
    if (isLoading) return;

    setIsLoading(true);
    setLoadingPhase(LOADING_PHASES.CACHE);

    try {
      const nip4SinceTimestamp = await loadPreviousCachedMessages(MESSAGE_PROTOCOL.NIP04);
      const nip17SinceTimestamp = enableNIP17 ? await loadPreviousCachedMessages(MESSAGE_PROTOCOL.NIP17) : undefined;

      setLoadingPhase(LOADING_PHASES.RELAYS);

      const nip4Result = await queryRelaysForMessagesSince(MESSAGE_PROTOCOL.NIP04, nip4SinceTimestamp);

      let nip17Result: { lastMessageTimestamp?: number; messageCount: number } | undefined;
      if (enableNIP17) {
        nip17Result = await queryRelaysForMessagesSince(MESSAGE_PROTOCOL.NIP17, nip17SinceTimestamp);
      }

      const totalNewMessages = nip4Result.messageCount + (nip17Result?.messageCount || 0);
      if (totalNewMessages > 0) {
        setShouldSaveImmediately(true);
      }

      setLoadingPhase(LOADING_PHASES.SUBSCRIPTIONS);

      await startNIP4Subscription(nip4Result.lastMessageTimestamp);
      if (enableNIP17) {
        await startNIP17Subscription(nip17Result?.lastMessageTimestamp);
      }

      setHasInitialLoadCompleted(true);
      setLoadingPhase(LOADING_PHASES.READY);
    } catch (error) {
      console.error('[DM] Error in message loading:', error);
      setLoadingPhase(LOADING_PHASES.READY);
    } finally {
      setIsLoading(false);
    }
  }, [loadPreviousCachedMessages, queryRelaysForMessagesSince, startNIP4Subscription, startNIP17Subscription, enableNIP17]);

  // Main effect to load messages
  useEffect(() => {
    if (!userPubkey || hasInitialLoadCompleted || isLoading) return;
    startMessageLoading();
  }, [userPubkey, hasInitialLoadCompleted, isLoading]);

  // Cleanup effect
  useEffect(() => {
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
  }, [userPubkey]);

  // Cleanup subscriptions
  useEffect(() => {
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
  }, []);

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
          messages: participant.messages.map(msg => ({
            id: msg.id,
            pubkey: msg.pubkey,
            content: msg.content,
            created_at: msg.created_at,
            kind: msg.kind,
            tags: msg.tags,
            sig: msg.sig,
          } as NostrEvent)),
          lastActivity: participant.lastActivity,
          hasNIP4: participant.hasNIP4,
          hasNIP17: participant.hasNIP17,
        };
      });

      await writeMessagesToDB(userPubkey, messageStore);

      const currentTime = Math.floor(Date.now() / 1000);
      setLastSync(prev => ({
        nip4: prev.nip4 || currentTime,
        nip17: prev.nip17 || currentTime
      }));
    } catch (error) {
      console.error('[DM] Error writing messages to IndexedDB:', error);
    }
  }, [messages, userPubkey, lastSync]);

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
    if (messages.size === 0) return;

    if (shouldSaveImmediately) {
      setShouldSaveImmediately(false);
      writeAllMessagesToStore();
    } else {
      triggerDebouncedWrite();
    }
  }, [messages, shouldSaveImmediately, writeAllMessagesToStore, triggerDebouncedWrite]);

  // Send message
  const sendMessage = useCallback(async (params: { recipientPubkey: string; content: string; protocol?: MessageProtocol }) => {
    const { recipientPubkey, content, protocol = MESSAGE_PROTOCOL.NIP04 } = params;
    if (!userPubkey) return;

    const optimisticId = `optimistic-${Date.now()}-${Math.random()}`;
    const optimisticMessage: DecryptedMessage = {
      id: optimisticId,
      kind: protocol === MESSAGE_PROTOCOL.NIP04 ? 4 : 1059,
      pubkey: userPubkey,
      created_at: Math.floor(Date.now() / 1000),
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
        await sendNIP4Message.mutateAsync({ recipientPubkey, content });
      } else if (protocol === MESSAGE_PROTOCOL.NIP17) {
        await sendNIP17Message.mutateAsync({ recipientPubkey, content });
      }
    } catch (error) {
      console.error(`[DM] Failed to send ${protocol} message:`, error);
    }
  }, [userPubkey, addMessageToState, sendNIP4Message, sendNIP17Message]);

  const clearCacheAndReload = useCallback(async () => {
    if (!userPubkey) return;

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
  }, [userPubkey]);

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
    clearCacheAndReload,
  };

  return (
    <DMContext.Provider value={contextValue}>
      {children}
    </DMContext.Provider>
  );
}

