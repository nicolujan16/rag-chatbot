"use client";

import { Check, Copy, FileText, Loader2 } from "lucide-react";
import { useState } from "react";
import Markdown from "@/components/Markdown";
import type { Message } from "@/lib/types";

export default function ChatMessage({ message }: { message: Message }) {
  const [copied, setCopied] = useState(false);

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap rounded-3xl bg-bubble px-5 py-2.5 text-[15px] leading-7">
          {message.content}
        </div>
      </div>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Sin permiso de portapapeles no hay nada que hacer; no rompas el chat.
    }
  };

  return (
    <div className="flex gap-4">
      <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full border border-border text-xs font-semibold">
        IA
      </span>

      <div className="min-w-0 flex-1">
        {message.pending ? (
          <div className="flex items-center gap-2 py-1 text-muted">
            <Loader2 className="size-4 animate-spin" />
            <span className="text-sm">Buscando en tus documentos…</span>
          </div>
        ) : message.failed ? (
          // Un mensaje de error es texto plano nuestro: no lo pases por Markdown.
          <div className="whitespace-pre-wrap text-[15px] leading-7 text-red-500">
            {message.content}
          </div>
        ) : (
          <Markdown content={message.content} />
        )}

        {message.sources && message.sources.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-medium text-muted">
              Fuentes ({message.sources.length})
            </p>
            <div className="flex flex-wrap gap-2">
              {message.sources.map((source) => (
                <span
                  key={source.id}
                  title={source.excerpt}
                  className="flex max-w-xs items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs"
                >
                  <FileText className="size-3.5 shrink-0 text-muted" />
                  <span className="truncate">{source.source}</span>
                  <span className="shrink-0 text-muted">
                    #{source.chunk_index} · {source.similarity.toFixed(3)}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}

        {!message.pending && !message.failed && (
          <div className="mt-2 flex items-center gap-1 text-muted">
            <button
              type="button"
              onClick={copy}
              aria-label="Copiar respuesta"
              title="Copiar respuesta"
              className="rounded-lg p-1.5 transition-colors hover:bg-hover hover:text-text"
            >
              {copied ? (
                <Check className="size-4 text-emerald-500" />
              ) : (
                <Copy className="size-4" />
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
