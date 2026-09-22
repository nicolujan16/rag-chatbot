"use client";

import { Loader2 } from "lucide-react";
import AuthScreen from "@/components/AuthScreen";
import ChatApp from "@/components/ChatApp";
import { useAuth } from "@/lib/use-auth";

export default function Page() {
  const { user, loading, refresh, signOut } = useAuth();

  // En una carga fría la sesión se rehidrata contra el backend: sin esta
  // espera, un usuario con sesión válida vería el login por un instante.
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted" />
      </div>
    );
  }

  if (!user) {
    return <AuthScreen onSignedIn={() => void refresh()} />;
  }

  return <ChatApp user={user} onSignOut={() => void signOut()} />;
}
