"use client";

import { Loader2, Play } from "lucide-react";
import { useState } from "react";
import { startDemo } from "@/lib/insforge";

/**
 * Entrada única a la aplicación.
 *
 * El registro está cerrado en el backend y el formulario de contraseña está
 * desactivado por ahora, así que la demo es la única puerta. Para volver a
 * habilitar el acceso con cuenta hay que reponer el formulario acá y llamar a
 * `insforge.auth.signInWithPassword`; el backend ya lo soporta.
 */
export default function AuthScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const demo = async () => {
    setBusy(true);
    setError(null);
    try {
      await startDemo();
      onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-center text-2xl font-semibold">RAG Chatbot</h1>
        <p className="mb-8 text-center text-sm text-muted">
          Un chat que responde solo con lo que dicen sus documentos, y que admite
          no saber.
        </p>

        <button
          type="button"
          onClick={demo}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3 text-sm font-medium text-accent-fg transition-opacity disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Play className="size-4" />
          )}
          {busy ? "Preparando la demo…" : "Probar demo"}
        </button>

        <p className="mt-4 text-center text-xs leading-relaxed text-muted">
          Entrás a una cuenta temporal con documentos ya cargados sobre qué es un
          RAG, cómo funciona este proyecto y quién lo hizo. También podés subir
          los tuyos. No pide datos y se borra sola.
        </p>

        <p className="mt-6 text-center text-xs text-muted">
          5 preguntas por día por dirección IP.
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
