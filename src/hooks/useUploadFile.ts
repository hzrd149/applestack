import { useState, useCallback } from "react";
import { useAccount } from "./useAccount";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import type { EventTemplate } from "nostr-tools";

/**
 * Hook for uploading files to Blossom servers.
 * Returns NIP-94 compatible tags.
 */
export function useUploadFile() {
  const account = useAccount();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mutateAsync = useCallback(
    async (file: File): Promise<string[][]> => {
      if (!account) {
        throw new Error("Must be logged in to upload files");
      }

      setIsPending(true);
      setError(null);

      try {
        // List of Blossom servers to try
        const servers = [
          "https://blossom.primal.net/",
          "https://cdn.satellite.earth/",
        ];

        // Calculate file hash
        const fileBytes = new Uint8Array(await file.arrayBuffer());
        const hash = bytesToHex(sha256(fileBytes));

        // Try each server until one succeeds
        let uploadedUrl: string | null = null;

        for (const server of servers) {
          try {
            // Create upload auth event (Blossom requires this)
            const authTemplate: EventTemplate = {
              kind: 24242,
              content: `Upload ${file.name}`,
              tags: [
                ["t", "upload"],
                ["x", hash],
                ["size", file.size.toString()],
              ],
              created_at: Math.floor(Date.now() / 1000),
            };

            const authEvent = await account.signer.signEvent(authTemplate);

            // Upload file with auth
            const formData = new FormData();
            formData.append("file", file);

            const response = await fetch(`${server}upload`, {
              method: "PUT",
              headers: {
                Authorization: `Nostr ${btoa(JSON.stringify(authEvent))}`,
              },
              body: formData,
            });

            if (!response.ok) {
              throw new Error(`Upload failed: ${response.statusText}`);
            }

            const result = await response.json();
            uploadedUrl = result.url || `${server}${hash}`;
            break; // Success, exit loop
          } catch (err) {
            console.warn(`Failed to upload to ${server}:`, err);
            continue; // Try next server
          }
        }

        if (!uploadedUrl) {
          throw new Error("Failed to upload to any server");
        }

        // Return NIP-94 compatible tags
        const tags: string[][] = [
          ["url", uploadedUrl],
          ["m", file.type],
          ["x", hash],
          ["size", file.size.toString()],
        ];

        return tags;
      } catch (err) {
        const error = err instanceof Error ? err : new Error("Failed to upload file");
        setError(error);
        console.error("Upload failed:", error);
        throw error;
      } finally {
        setIsPending(false);
      }
    },
    [account]
  );

  return {
    mutateAsync,
    isPending,
    error,
  };
}