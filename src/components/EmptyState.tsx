"use client";

import { Upload } from "lucide-react";

interface EmptyStateProps {
  onAttach: () => void;
  hasSources: boolean;
}

export default function EmptyState({ onAttach, hasSources }: EmptyStateProps) {
  return (
    <div className="pb-6 text-center">
      <h1 className="mb-3 text-3xl font-semibold">
        {hasSources ? "¿Qué querés saber?" : "Empezá subiendo documentos"}
      </h1>

      <p className="mx-auto mb-6 max-w-md text-sm text-muted">
        {hasSources
          ? "Respondo solo con lo que esté en los documentos que subiste."
          : "Las respuestas salen únicamente de tus archivos. Subí uno o varios .txt, .md, .csv o .json para armar la base."}
      </p>

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
