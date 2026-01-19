import { ExtensionSigner, PasswordSigner } from "applesauce-signers";
import { NostrConnectSigner } from "applesauce-signers";
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
     * Creates a PasswordSigner and adds it to the account manager.
     */
    async nsec(nsec: string): Promise<void> {
      try {
        // Decode nsec to get secret key
        const decoded = nip19.decode(nsec);
        if (decoded.type !== "nsec") {
          throw new Error("Invalid nsec format");
        }

        // Create password signer with the secret key
        const signer = new PasswordSigner(decoded.data);

        // Get pubkey
        const pubkey = await signer.getPublicKey();

        // Add to account manager
        accountManager.addAccount({
          pubkey,
          signer,
          label: "Secret Key",
        });

        accountManager.setActiveAccount(pubkey);
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
        // Create Nostr Connect signer
        const signer = new NostrConnectSigner(uri);

        // Connect and get pubkey
        await signer.connect();
        const pubkey = await signer.getPublicKey();

        // Add to account manager
        accountManager.addAccount({
          pubkey,
          signer,
          label: "Remote Signer",
        });

        accountManager.setActiveAccount(pubkey);
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
        if (!window.nostr) {
          throw new Error("Nostr extension not found. Please install a NIP-07 extension.");
        }

        // Create extension signer
        const signer = new ExtensionSigner();

        // Get pubkey
        const pubkey = await signer.getPublicKey();

        // Check if this account is already logged in
        const existingAccounts = accountManager.getAccounts();
        const existing = existingAccounts.find((acc) => acc.pubkey === pubkey);

        if (existing) {
          // Just switch to the existing account
          accountManager.setActiveAccount(pubkey);
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
          label: "Extension",
        });

        accountManager.setActiveAccount(pubkey);
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
      const activeAccount = accountManager.getActiveAccount();
      if (activeAccount) {
        accountManager.removeAccount(activeAccount.pubkey);
      }
    },
  };
}
