import { AccountManager } from "applesauce-accounts";

/**
 * Global AccountManager instance for multi-account support.
 * Handles adding, removing, and switching between Nostr accounts.
 */
export const accountManager = new AccountManager();

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

/**
 * Save accounts to localStorage.
 * Only saves metadata (pubkey, label), not signers.
 */
function saveAccounts() {
  const accounts = accountManager.getAccounts();
  const accountsData = accounts.map((acc) => ({
    pubkey: acc.pubkey,
    label: acc.label,
  }));
  localStorage.setItem("accounts", JSON.stringify(accountsData));
}

// Listen for account changes and save
accountManager.on("add", saveAccounts);
accountManager.on("remove", saveAccounts);
accountManager.on("switch", saveAccounts);

// Load accounts on initialization
loadSavedAccounts();
