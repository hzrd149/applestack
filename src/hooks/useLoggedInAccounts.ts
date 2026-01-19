import { useAccounts, useActiveAccount } from "applesauce-react/hooks";
import { useProfile } from "./useProfile";
import type { NostrMetadata } from "applesauce-core/helpers";
import { accountManager } from "@/services/accounts";

export interface Account {
  id: string;
  pubkey: string;
  metadata: NostrMetadata;
  label?: string;
}

/**
 * Get all logged-in accounts with their profile metadata.
 * Uses applesauce-accounts for multi-account management.
 */
export function useLoggedInAccounts() {
  const accounts = useAccounts();
  const activeAccount = useActiveAccount();

  // Map accounts to include profile metadata
  const authors: Account[] = accounts.map((account) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const profile = useProfile(account.pubkey);

    return {
      id: account.pubkey, // Use pubkey as ID for consistency
      pubkey: account.pubkey,
      metadata: profile ?? {},
      label: account.label,
    };
  });

  // Current user is the active account
  const currentUser: Account | undefined = (() => {
    if (!activeAccount) return undefined;

    const author = authors.find((a) => a.pubkey === activeAccount.pubkey);
    return author ?? {
      id: activeAccount.pubkey,
      pubkey: activeAccount.pubkey,
      metadata: {},
      label: activeAccount.label,
    };
  })();

  // Other users are all accounts except the current one
  const otherUsers = authors.filter((a) => a.pubkey !== activeAccount?.pubkey);

  return {
    authors,
    currentUser,
    otherUsers,
    setLogin: (id: string) => {
      accountManager.setActiveAccount(id);
    },
    removeLogin: (id: string) => {
      accountManager.removeAccount(id);
    },
  };
}
