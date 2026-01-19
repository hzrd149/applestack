import { useCallback, useState } from "react";
import { useAccount } from "./useAccount";
import { factory } from "@/services/actions";
import { publish } from "@/services/pool";
import type { EventBlueprint, Operation } from "applesauce-factory";
import type { NostrEvent } from "nostr-tools";
import { addTag } from "applesauce-factory/operations/tags";

/**
 * Hook for publishing events using blueprints and operations.
 * Automatically adds client tag and handles signing.
 *
 * @example
 * ```tsx
 * import { usePublish } from '@/hooks/usePublish';
 * import { NoteBlueprint } from 'applesauce-common/blueprints';
 *
 * function PostForm() {
 *   const { publishEvent, isPending } = usePublish();
 *
 *   const handleSubmit = async () => {
 *     await publishEvent(NoteBlueprint('Hello Nostr!'));
 *   };
 *
 *   return <button onClick={handleSubmit} disabled={isPending}>Post</button>;
 * }
 * ```
 */
export function usePublish() {
  const account = useAccount();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const publishEvent = useCallback(
    async (blueprint: EventBlueprint, ...operations: Operation[]): Promise<NostrEvent> => {
      if (!account) {
        throw new Error("User is not logged in");
      }

      setIsPending(true);
      setError(null);

      try {
        // Add client tag if on HTTPS
        const ops: Operation[] = [...operations];
        if (location.protocol === "https:") {
          ops.push(addTag(["client", location.hostname]));
        }

        // Create and sign event
        const event = await factory.create(blueprint, ...ops);

        // Publish to relays
        await publish(event);

        console.log("Event published successfully:", event);
        return event;
      } catch (err) {
        const error = err instanceof Error ? err : new Error("Failed to publish event");
        setError(error);
        console.error("Failed to publish event:", error);
        throw error;
      } finally {
        setIsPending(false);
      }
    },
    [account]
  );

  return {
    publishEvent,
    mutateAsync: publishEvent, // Compatibility with old API
    isPending,
    isLoading: isPending,
    error,
  };
}

/**
 * Alias for usePublish for backward compatibility.
 * @deprecated Use usePublish instead
 */
export function useNostrPublish() {
  return usePublish();
}
