import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { useNostr } from '@nostrify/react';
import { NSecSigner, type NostrEvent } from '@nostrify/nostrify';
import { generateSecretKey, getPublicKey } from 'nostr-tools';

// ============================================================================
// Types
// ============================================================================

interface FileAttachment {
  url: string;
  mimeType: string;
  size: number;
  name: string;
  tags: string[][];
}

interface SendNIP4MessageParams {
  recipientPubkey: string;
  content: string;
  attachments?: FileAttachment[];
}

interface SendNIP17MessageParams {
  recipientPubkey: string;
  content: string;
  attachments?: FileAttachment[];
}

interface UseSendDMReturn {
  sendNIP4Message: UseMutationResult<NostrEvent, Error, SendNIP4MessageParams>;
  sendNIP17Message: UseMutationResult<NostrEvent, Error, SendNIP17MessageParams>;
}

// ============================================================================
// Helper Functions
// ============================================================================

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
// Hook
// ============================================================================

export function useSendDM(): UseSendDMReturn {
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { nostr } = useNostr();
  const { toast } = useToast();

  // Send NIP-04 Message
  const sendNIP4Message = useMutation<NostrEvent, Error, SendNIP4MessageParams>({
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
      console.error('[useSendDM] Failed to send NIP-04 message:', error);
      toast({
        title: 'Failed to send message',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Send NIP-17 Message
  const sendNIP17Message = useMutation<NostrEvent, Error, SendNIP17MessageParams>({
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
      console.error('[useSendDM] Failed to send NIP-17 message:', error);
      toast({
        title: 'Failed to send message',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return {
    sendNIP4Message,
    sendNIP17Message,
  };
}
