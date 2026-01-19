import { useCallback, useSyncExternalStore } from "react";
import { theme as themeObservable } from "@/services/state";

export type Theme = "light" | "dark";

/**
 * Hook to get and set the active theme.
 * Uses RxJS observable from services/state.
 * @returns Theme context with theme and setTheme
 */
export function useTheme(): { theme: Theme; setTheme: (theme: Theme) => void } {
  // Subscribe to the theme observable using React's built-in sync external store
  const theme = useSyncExternalStore(
    (callback) => {
      const subscription = themeObservable.subscribe(callback);
      return () => subscription.unsubscribe();
    },
    () => themeObservable.getValue()
  );

  const setTheme = useCallback((newTheme: Theme) => {
    themeObservable.next(newTheme);
  }, []);

  return {
    theme,
    setTheme,
  };
}