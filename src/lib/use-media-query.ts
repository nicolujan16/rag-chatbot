"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Se suscribe a una media query sin romper la hidratación: en el servidor y
 * durante el primer render devuelve `false`, y React re-renderiza con el valor
 * real apenas termina de hidratar.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
