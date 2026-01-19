import { AccountManager, Accounts } from "applesauce-accounts";

/**
 * Global AccountManager instance for multi-account support.
 * Handles adding, removing, and switching between Nostr accounts.
 */
export const accountManager = new AccountManager();

// Register common account types (Extension, PrivateKey, NostrConnect, etc.)
Accounts.registerCommonAccountTypes(accountManager);

/**
 * Load saved accounts from localStorage on startup.
 * Note: Only account metadata is saved, not private keys.
 * Users must re-login with their signer on each session.
 */
function loadSavedAccounts() {
  const savedAccounts = localStorage.getItem("accounts");
  if (savedAccounts) {
    try {
      const accounts = JSON.parse(savedAccounts);
      // Accounts will be restored when user logs in
      console.log("Found saved account metadata:", accounts);
    } catch (error) {
      console.error("Failed to parse saved accounts", error);
    }
  }
}

// AccountManager v5 doesn't have event listeners, save manually when needed
// TODO: Implement proper persistence strategy

// Load accounts on initialization
loadSavedAccounts();
