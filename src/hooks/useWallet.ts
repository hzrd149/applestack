import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNWC } from '@/hooks/useNWCContext';
import type { WebLNProvider } from '@webbtc/webln-types';

export interface WalletStatus {
  hasWebLN: boolean;
  hasNWC: boolean;
  webln: WebLNProvider | null;
  activeNWC: ReturnType<typeof useNWC>['getActiveConnection'] extends () => infer T ? T : null;
  preferredMethod: 'nwc' | 'webln' | 'manual';
}

export function useWallet() {
  const [webln, setWebln] = useState<WebLNProvider | null>(null);
  const { connections, getActiveConnection } = useNWC();

  // Get the active connection directly - no memoization to avoid stale state
  const activeNWC = getActiveConnection();

  // Detect WebLN synchronously on mount
  useEffect(() => {
    const webLn = (globalThis as { webln?: WebLNProvider }).webln;
    setWebln(webLn || null);
  }, []);

  // Calculate status values reactively
  const hasNWC = useMemo(() => {
    return connections.length > 0 && connections.some(c => c.isConnected);
  }, [connections]);

  // Determine preferred payment method
  const preferredMethod: WalletStatus['preferredMethod'] = activeNWC
    ? 'nwc'
    : webln
    ? 'webln'
    : 'manual';

  const status: WalletStatus = {
    hasWebLN: !!webln,
    hasNWC,
    webln,
    activeNWC,
    preferredMethod,
  };

  return status;
}