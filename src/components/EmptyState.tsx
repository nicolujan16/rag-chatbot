"use client";

import { Upload } from "lucide-react";
import { DEMO_QUESTIONS } from "@/lib/demo-questions";

interface EmptyStateProps {
  onAttach: () => void;
  onAsk: (question: string) => void;
  hasSources: boolean;
  isDemo: boolean;
}

export default function EmptyState({
  onAttach,
  onAsk,
  hasSources,
  isDemo,
}: EmptyStateProps) {
  return (
    <div className="pb-6 text-center">
      <h1 className="mb-3 text-3xl font-semibold">
        {hasSources ? "¿Qué querés saber?" : "Empezá subiendo documentos"}
      </h1>

      <p className="mx-auto mb-6 max-w-md text-sm text-muted">
        {isDemo
          ? "Esta cuenta ya tiene documentos cargados sobre qué es un RAG, cómo está hecho este proyecto y quién lo hizo. También podés subir los tuyos."
          : hasSources
            ? "Respondo solo con lo que esté en los documentos que subiste."
            : "Las respuestas salen únicamente de tus archivos. Subí uno o varios .txt, .md, .csv o .json para armar la base."}
      </p>

      {isDemo && (
        <div className="mx-auto mb-6 flex max-w-xl flex-wrap justify-center gap-2">
          {DEMO_QUESTIONS.map((item) => (
            <button
              key={item.question}
              type="button"
              onClick={() => onAsk(item.question)}
              className="rounded-full border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:bg-hover hover:text-text"
            >
              {item.question}
            </button>
          ))}
        </div>
      )}

      {!hasSources && (
        <button
          type="button"
          onClick={onAttach}
          className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm transition-colors hover:bg-hover"
        >
          <Upload className="size-4" />
          Elegir archivos
        </button>
      )}
    </div>
  );
}
