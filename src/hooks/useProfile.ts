import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { ProfileModel } from "applesauce-core/models";
import type { ProfileContent } from "applesauce-core/helpers";

/**
 * Get a user's profile by their pubkey.
 * Automatically subscribes to profile updates.
 *
 * @param pubkey - The user's public key (hex format)
 * @returns The user's profile metadata, or undefined if not yet loaded
 *
 * @example
 * ```tsx
 * import { useProfile } from '@/hooks/useProfile';
 *
 * function UserCard({ pubkey }: { pubkey: string }) {
 *   const profile = useProfile(pubkey);
 *
 *   return (
 *     <div>
 *       <img src={profile?.picture} />
 *       <h3>{profile?.name ?? 'Anonymous'}</h3>
 *       <p>{profile?.about}</p>
 *     </div>
 *   );
 * }
 * ```
 */
export function useProfile(pubkey: string): ProfileContent | undefined {
  const store = useEventStore();

  const profile = use$(
    () => store.model(ProfileModel, pubkey),
    [pubkey, store]
  );

  return profile;
}

// Re-export for convenience
import { useActiveAccount } from "applesauce-react/hooks";

/**
 * Get the current user's own profile.
 * Convenience wrapper around useProfile that uses the logged-in account's pubkey.
 *
 * @example
 * ```tsx
 * import { useMyProfile } from '@/hooks/useProfile';
 * import { useAccount } from '@/hooks/useAccount';
 *
 * function ProfileSettings() {
 *   const account = useAccount();
 *   const profile = useMyProfile();
 *
 *   if (!account) return <LoginPrompt />;
 *
 *   return (
 *     <div>
 *       <h2>Edit Profile</h2>
 *       <input defaultValue={profile?.name} />
 *     </div>
 *   );
 * }
 * ```
 */
export function useMyProfile(): ProfileContent | undefined {
  const account = useActiveAccount();
  const pubkey = account?.pubkey;

  const profile = useProfile(pubkey || '');

  if (!account) {
    return undefined;
  }

  return profile;
}
