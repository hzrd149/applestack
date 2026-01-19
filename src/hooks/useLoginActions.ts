import { Accounts } from "applesauce-accounts";
import { ExtensionSigner, PrivateKeySigner } from "applesauce-signers";
import { accountManager } from "@/services/accounts";
import { nip19, getPublicKey } from "nostr-tools";
import { toast } from "@/hooks/useToast";

// NOTE: This file should not be edited except for adding new login methods.

/**
 * Provides actions for logging in with various Nostr signers.
 * Uses applesauce-accounts for multi-account management.
 */
export function useLoginActions() {
  return {
    /**
     * Login with a Nostr secret key (nsec).
     * Creates a PrivateKeyAccount and adds it to the account manager.
     */
    async nsec(nsec: string): Promise<void> {
      try {
        // Decode nsec to get secret key
        const decoded = nip19.decode(nsec);
        if (decoded.type !== "nsec") {
          throw new Error("Invalid nsec format");
        }

        // Create private key signer and account
        const secretKey = decoded.data; // Uint8Array
        const pubkeyHex = getPublicKey(secretKey);
        const signer = new PrivateKeySigner(secretKey);
        const account = new Accounts.PrivateKeyAccount(pubkeyHex, signer);

        // Add to account manager
        accountManager.addAccount(account);

        accountManager.setActive(account.pubkey);
      } catch (error) {
        console.error("Failed to login with nsec:", error);
        throw new Error("Invalid secret key");
      }
    },

    /**
     * Login with a NIP-46 "bunker://" URI (Nostr Connect).
     * Creates a NostrConnectAccount and adds it to the account manager.
     */
    async bunker(uri: string): Promise<void> {
      try {
        // Parse the bunker URI to get options
        // Format: bunker://pubkey?relay=wss://...&secret=...
        const url = new URL(uri);
        const remote = url.hostname || url.pathname.replace('//', '');
        
        if (!remote) {
          throw new Error("Invalid bunker URI: missing remote pubkey");
        }
        
        const relays = url.searchParams.getAll('relay');
        const secret = url.searchParams.get('secret');

        // Create Nostr Connect account with remote pubkey and options
        const options: { relays: string[]; secret?: string } = {
          relays: relays.length > 0 ? relays : ['wss://relay.nsec.app'],
        };
        if (secret) {
          options.secret = secret;
        }
        
        // @ts-expect-error - NostrConnectSigner type compatibility issue in v5
        const account = new Accounts.NostrConnectAccount(remote, options);

        // Add to account manager
        accountManager.addAccount(account);

        accountManager.setActive(account.pubkey);
      } catch (error) {
        console.error("Failed to login with bunker:", error);
        throw new Error("Failed to connect to remote signer");
      }
    },

    /**
     * Login with a NIP-07 browser extension.
     * Creates an ExtensionAccount and adds it to the account manager.
     */
    async extension(): Promise<void> {
      try {
        if (!('nostr' in window)) {
          throw new Error("Nostr extension not found. Please install a NIP-07 extension.");
        }

        // Get pubkey from extension first
        const pubkey = await window.nostr!.getPublicKey();

        // Check if this account is already logged in
        const existing = accountManager.getAccountForPubkey(pubkey);

        if (existing) {
          // Just switch to the existing account
          accountManager.setActive(existing.pubkey);
          toast({
            title: "Already logged in",
            description: "Switched to existing account",
          });
          return;
        }

        // Create extension account
        const signer = new ExtensionSigner();
        const account = new Accounts.ExtensionAccount(pubkey, signer);

        // Add to account manager
        accountManager.addAccount(account);

        accountManager.setActive(account.pubkey);
      } catch (error) {
        console.error("Failed to login with extension:", error);
        throw error;
      }
    },

    /**
     * Log out the current user.
     * Removes the active account from the account manager.
     */
    logout(): void {
      const activeAccount = accountManager.getActive();
      if (activeAccount) {
        accountManager.removeAccount(activeAccount.pubkey);
      }
    },
  };
}
