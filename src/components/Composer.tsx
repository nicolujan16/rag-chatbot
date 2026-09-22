"use client";

import { ArrowUp, Paperclip } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface ComposerProps {
  onSend: (text: string) => void;
  onAttach: () => void;
  busy?: boolean;
  /** Sin cupo diario: se puede seguir subiendo archivos, no preguntar. */
  disabled?: boolean;
  placeholder?: string;
}

export default function Composer({
  onSend,
  onAttach,
  busy = false,
  disabled = false,
  placeholder = "Preguntá sobre tus documentos",
}: ComposerProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // El textarea crece con el contenido hasta un tope y después scrollea.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  const submit = () => {
    const text = value.trim();
    if (!text || busy || disabled) return;
    onSend(text);
    setValue("");
  };

  return (
    <div className="rounded-[28px] border border-border bg-elevated px-3 py-2 shadow-sm">
      <textarea
        ref={textareaRef}
        rows={1}
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={placeholder}
        className="block max-h-[200px] w-full resize-none bg-transparent px-2 py-2 text-[15px] leading-6 outline-none placeholder:text-muted"
      />

      <div className="flex items-center justify-between pt-1">
        <button
          type="button"
          onClick={onAttach}
          aria-label="Subir documentos"
          title="Subir documentos (.txt, .md, .csv, .json)"
          className="rounded-full p-2 text-muted transition-colors hover:bg-hover hover:text-text"
        >
          <Paperclip className="size-5" />
        </button>

        <button
          type="button"
          onClick={submit}
          disabled={!value.trim() || busy || disabled}
          aria-label="Enviar"
          className="flex size-9 items-center justify-center rounded-full bg-accent text-accent-fg transition-opacity disabled:opacity-25"
        >
          <ArrowUp className="size-5" />
        </button>
      </div>
    </div>
  );
}
