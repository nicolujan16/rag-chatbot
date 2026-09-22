"use client";

import { Loader2, Play } from "lucide-react";
import { useState } from "react";
import { insforge, startDemo } from "@/lib/insforge";

export default function AuthScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"signin" | "demo" | null>(null);

  const run = async (kind: "signin" | "demo", action: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const signIn = () =>
    run("signin", async () => {
      const { error } = await insforge.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw new Error(error.message);
      onSignedIn();
    });

  const demo = () =>
    run("demo", async () => {
      await startDemo();
      onSignedIn();
    });

  return (
    <div className="flex h-full items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-center text-2xl font-semibold">RAG Chatbot</h1>
        <p className="mb-8 text-center text-sm text-muted">
          Chat privado sobre tus propios documentos.
        </p>

        <button
          type="button"
          onClick={demo}
          disabled={busy !== null}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-2.5 text-sm font-medium text-accent-fg transition-opacity disabled:opacity-50"
        >
          {busy === "demo" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Play className="size-4" />
          )}
          {busy === "demo" ? "Preparando la demo…" : "Probar demo"}
        </button>

        <p className="mt-3 text-center text-xs text-muted">
          Entrás a una cuenta temporal con documentos ya cargados sobre qué es un
          RAG, cómo funciona este proyecto y quién lo hizo. No pide datos y se
          borra sola.
        </p>

        <div className="my-6 flex items-center gap-3 text-xs text-muted">
          <span className="h-px flex-1 bg-border" />
          <span>o entrá con tu cuenta</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (busy === null) signIn();
          }}
        >
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@email.com"
            autoComplete="email"
            className="rounded-xl border border-border bg-elevated px-4 py-2.5 text-sm outline-none focus:border-muted"
          />
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Contraseña"
            autoComplete="current-password"
            className="rounded-xl border border-border bg-elevated px-4 py-2.5 text-sm outline-none focus:border-muted"
          />

          <button
            type="submit"
            disabled={busy !== null}
            className="mt-1 flex items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-sm font-medium transition-colors hover:bg-hover disabled:opacity-50"
          >
            {busy === "signin" && <Loader2 className="size-4 animate-spin" />}
            Entrar
          </button>
        </form>

        {/* El alta pública está cerrada en el backend, no solo escondida acá. */}
        <p className="mt-6 text-center text-xs text-muted">
          El registro está cerrado: las cuentas nuevas se crean a mano.
        </p>

        {error && (
          <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2 text-center text-xs text-red-500">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
