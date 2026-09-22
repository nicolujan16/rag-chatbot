"use client";

import { useCallback, useEffect, useState } from "react";
import { insforge } from "./insforge";
import type { AuthUser } from "./types";

/**
 * En el navegador el access token vive solo en memoria: en una carga fría el
 * SDK rehidrata la sesión contra el backend usando la cookie httpOnly de
 * refresh. Por eso `loading` importa — al principio no hay usuario todavía
 * aunque la sesión sea válida.
 */
export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data, error } = await insforge.auth.getCurrentUser();
    const next = error ? null : ((data?.user as AuthUser | undefined) ?? null);
    setUser(next);
    setLoading(false);
    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;

    void insforge.auth.getCurrentUser().then(({ data, error }) => {
      if (cancelled) return;
      setUser(error ? null : ((data?.user as AuthUser | undefined) ?? null));
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = useCallback(async () => {
    await insforge.auth.signOut();
    setUser(null);
  }, []);

  return { user, loading, refresh, signOut };
}
