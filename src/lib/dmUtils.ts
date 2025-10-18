import type { NostrEvent } from '@nostrify/nostrify';

/**
 * Validate that an event is a proper DM event
 */
export function validateDMEvent(event: NostrEvent): boolean {
  // Must be kind 4 (NIP-04 DM)
  if (event.kind !== 4) return false;

  // Must have a 'p' tag
  const hasRecipient = event.tags?.some(([name]) => name === 'p');
  if (!hasRecipient) return false;

  // Must have content (even if encrypted)
  if (!event.content) return false;

  return true;
}

/**
 * Get the recipient pubkey from a DM event
 */
export function getRecipientPubkey(event: NostrEvent): string | undefined {
  return event.tags?.find(([name]) => name === 'p')?.[1];
}

/**
 * Get the conversation partner pubkey from a DM event
 * (the other person in the conversation, not the current user)
 */
export function getConversationPartner(event: NostrEvent, userPubkey: string): string | undefined {
  const isFromUser = event.pubkey === userPubkey;
  
  if (isFromUser) {
    // If we sent it, the partner is the recipient
    return getRecipientPubkey(event);
  } else {
    // If they sent it, the partner is the author
    return event.pubkey;
  }
}
