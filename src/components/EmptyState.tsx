"use client";

import { Upload } from "lucide-react";

interface EmptyStateProps {
  onAttach: () => void;
  onAsk: (question: string) => void;
  hasSources: boolean;
  isDemo: boolean;
}

/**
 * Preguntas que el corpus de la demo sí puede contestar. Sirven de arranque
 * para quien entra sin saber qué preguntarle, y de paso muestran las dos cosas
 * que tiene cargadas: la técnica y el autor.
 */
const DEMO_QUESTIONS = [
  "¿Qué es un RAG y cuáles son sus dos etapas?",
  "¿Quién es Nicolás Luján y qué tecnologías maneja?",
  "¿Cómo hace este proyecto para aislar los documentos de cada usuario?",
  "¿Qué limitaciones conocidas tiene este chatbot?",
];

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
          {DEMO_QUESTIONS.map((question) => (
            <button
              key={question}
              type="button"
              onClick={() => onAsk(question)}
              className="rounded-full border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:bg-hover hover:text-text"
            >
              {question}
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
