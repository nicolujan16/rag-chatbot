"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { insforge } from "@/lib/insforge";

type Mode = "signin" | "signup" | "verify";

export default function AuthScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const signIn = () =>
    run(async () => {
      const { error } = await insforge.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw new Error(error.message);
      onSignedIn();
    });

  const signUp = () =>
    run(async () => {
      const { data, error } = await insforge.auth.signUp({
        email: email.trim(),
        password,
        name: name.trim() || undefined,
      });
      if (error) throw new Error(error.message);

      // El backend exige verificación por código: pasá a pedir los 6 dígitos.
      if (data?.requireEmailVerification) {
        setNotice(`Te mandamos un código de 6 dígitos a ${email.trim()}.`);
        setMode("verify");
        return;
      }
      onSignedIn();
    });

  const verify = () =>
    run(async () => {
      const { error } = await insforge.auth.verifyEmail({
        email: email.trim(),
        otp: otp.trim(),
      });
      if (error) throw new Error(error.message);
      onSignedIn();
    });

  const resend = () =>
    run(async () => {
      const { error } = await insforge.auth.resendVerificationEmail({
        email: email.trim(),
      });
      if (error) throw new Error(error.message);
      setNotice("Código reenviado.");
    });

  return (
    <div className="flex h-full items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-center text-2xl font-semibold">RAG Chatbot</h1>
        <p className="mb-8 text-center text-sm text-muted">
          Chat privado sobre tus propios documentos.
        </p>

        {mode !== "verify" && (
          <div className="mb-6 flex rounded-full border border-border p-1">
            {(["signin", "signup"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setMode(option);
                  setError(null);
                  setNotice(null);
                }}
                className={`flex-1 rounded-full py-1.5 text-sm transition-colors ${
                  mode === option ? "bg-accent text-accent-fg" : "hover:bg-hover"
                }`}
              >
                {option === "signin" ? "Iniciar sesión" : "Crear cuenta"}
              </button>
            ))}
          </div>
        )}

        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (busy) return;
            if (mode === "signin") signIn();
            else if (mode === "signup") signUp();
            else verify();
          }}
        >
          {mode === "verify" ? (
            <>
              <label className="text-sm text-muted" htmlFor="otp">
                Código de verificación
              </label>
              <input
                id="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                className="rounded-xl border border-border bg-elevated px-4 py-2.5 text-center text-lg tracking-[0.4em] outline-none focus:border-muted"
              />
            </>
          ) : (
            <>
              {mode === "signup" && (
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nombre (opcional)"
                  autoComplete="name"
                  className="rounded-xl border border-border bg-elevated px-4 py-2.5 text-sm outline-none focus:border-muted"
                />
              )}
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
                placeholder="Contraseña (mínimo 6 caracteres)"
                autoComplete={
                  mode === "signup" ? "new-password" : "current-password"
                }
                className="rounded-xl border border-border bg-elevated px-4 py-2.5 text-sm outline-none focus:border-muted"
              />
            </>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-1 flex items-center justify-center gap-2 rounded-xl bg-accent py-2.5 text-sm font-medium text-accent-fg transition-opacity disabled:opacity-50"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {mode === "signin"
              ? "Entrar"
              : mode === "signup"
                ? "Crear cuenta"
                : "Verificar"}
          </button>
        </form>

        {mode === "verify" && (
          <div className="mt-4 flex justify-between text-xs">
            <button
              type="button"
              onClick={resend}
              disabled={busy}
              className="text-muted underline-offset-2 hover:underline"
            >
              Reenviar código
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("signin");
                setError(null);
                setNotice(null);
              }}
              className="text-muted underline-offset-2 hover:underline"
            >
              Volver
            </button>
          </div>
        )}

        {notice && <p className="mt-4 text-center text-xs text-muted">{notice}</p>}
        {error && (
          <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2 text-center text-xs text-red-500">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
