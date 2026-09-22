"use client";

import { DEMO_QUESTIONS } from "@/lib/demo-questions";

interface SuggestionsProps {
  onAsk: (question: string) => void;
  disabled?: boolean;
}

/**
 * Fila angosta de preguntas de ejemplo, pensada para vivir arriba del campo de
 * texto sin robarle atención al chat.
 *
 * Usa las etiquetas cortas y no las preguntas enteras: en una sola línea, el
 * texto completo obligaría a scrollear de entrada.
 */
export default function Suggestions({ onAsk, disabled = false }: SuggestionsProps) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {DEMO_QUESTIONS.map((item) => (
        <button
          key={item.question}
          type="button"
          onClick={() => onAsk(item.question)}
          disabled={disabled}
          title={item.question}
          className="shrink-0 rounded-full border border-border px-3 py-1 text-xs text-muted transition-colors hover:bg-hover hover:text-text disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
