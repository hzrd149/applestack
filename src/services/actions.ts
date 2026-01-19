import { ActionRunner } from "applesauce-actions";
import { EventFactory } from "applesauce-factory";
import { eventStore } from "./stores";
import { publish } from "./pool";
import { accountManager } from "./accounts";

/**
 * Get the current active account's signer.
 * Throws if no account is logged in.
 */
function getActiveSigner() {
  const account = accountManager.getActiveAccount();
  if (!account) {
    throw new Error("No account is currently logged in");
  }
  return account.signer;
}

/**
 * Global EventFactory instance for creating signed events.
 * Uses the active account's signer.
 */
export const factory = new EventFactory({
  signer: getActiveSigner,
});

/**
 * Global ActionRunner instance for executing pre-built Nostr actions.
 * Examples: FollowUser, CreateNote, UpdateProfile, etc.
 *
 * Usage:
 * ```ts
 * import { runner } from '@/services/actions';
 * import { CreateNote } from 'applesauce-actions/actions';
 *
 * await runner.run(CreateNote, 'Hello Nostr!');
 * ```
 */
export const runner = new ActionRunner(eventStore, factory, publish);
