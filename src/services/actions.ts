import { ActionHub, Actions } from "applesauce-actions";
import { eventStore } from "./stores";
import { pool } from "./pool";
import { accountManager } from "./accounts";

/**
 * Global ActionHub instance for executing pre-built Nostr actions.
 * In applesauce v5, Actions are run through ActionHub which manages
 * user context, signing, and publishing automatically.
 *
 * Usage:
 * ```ts
 * import { actionHub } from '@/services/actions';
 * import { Actions } from 'applesauce-actions';
 *
 * const user = actionHub.getUser(pubkey);
 * await user.run(Actions.UpdateProfile, { name: 'Alice' });
 * ```
 */
export const actionHub = new ActionHub({
  store: eventStore,
  pool,
  accountManager,
});

// Export Actions for convenience
export { Actions };
