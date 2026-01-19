import { ExtensionSigner, PrivateKeySigner, NostrConnectSigner } from "applesauce-signers";
import { accountManager } from "@/services/accounts";
import { nip19 } from "nostr-tools";
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
     * Creates a PrivateKeySigner and adds it to the account manager.
     */
    async nsec(nsec: string): Promise<void> {
      try {
        // Decode nsec to get secret key
        const decoded = nip19.decode(nsec);
        if (decoded.type !== "nsec") {
          throw new Error("Invalid nsec format");
        }

        // Create private key signer with the secret key
        const signer = new PrivateKeySigner(decoded.data);

        // Get pubkey
        const pubkey = await signer.getPublicKey();

        // Add to account manager
        accountManager.addAccount({
          pubkey,
          signer,
        });

        accountManager.setActive(pubkey);
      } catch (error) {
        console.error("Failed to login with nsec:", error);
        throw new Error("Invalid secret key");
      }
    },

    /**
     * Login with a NIP-46 "bunker://" URI (Nostr Connect).
     * Creates a NostrConnectSigner and adds it to the account manager.
     */
    async bunker(uri: string): Promise<void> {
      try {
        // Parse the bunker URI to get options
        // Format: bunker://pubkey?relay=wss://...&secret=...
        const url = new URL(uri);
        const remote = url.hostname || url.pathname.replace('//', '');
        const relays = url.searchParams.getAll('relay');
        const secret = url.searchParams.get('secret') || undefined;

        // Create Nostr Connect signer with options
        const signer = new NostrConnectSigner({
          relays: relays.length > 0 ? relays : ['wss://relay.nsec.app'],
          remote,
          secret,
        });

        // Get pubkey (NostrConnectSigner should handle connection internally)
        const pubkey = await signer.getPublicKey();

        // Add to account manager
        accountManager.addAccount({
          pubkey,
          signer,
        });

        accountManager.setActive(pubkey);
      } catch (error) {
        console.error("Failed to login with bunker:", error);
        throw new Error("Failed to connect to remote signer");
      }
    },

    /**
     * Login with a NIP-07 browser extension.
     * Creates an ExtensionSigner and adds it to the account manager.
     */
    async extension(): Promise<void> {
      try {
        if (!('nostr' in window)) {
          throw new Error("Nostr extension not found. Please install a NIP-07 extension.");
        }

        // Create extension signer
        const signer = new ExtensionSigner();

        // Get pubkey
        const pubkey = await signer.getPublicKey();

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

        // Add to account manager
        accountManager.addAccount({
          pubkey,
          signer,
        });

        accountManager.setActive(pubkey);
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
