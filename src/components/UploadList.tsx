"use client";

import { AlertCircle, Check, FileText, Loader2, X } from "lucide-react";
import type { Upload } from "@/lib/types";

interface UploadListProps {
  uploads: Upload[];
  onDismiss: (id: string) => void;
}

const labels: Record<Upload["status"], string> = {
  reading: "Leyendo…",
  ingesting: "Generando embeddings…",
  done: "Listo",
  error: "Error",
};

export default function UploadList({ uploads, onDismiss }: UploadListProps) {
  if (uploads.length === 0) return null;

  return (
    <ul className="mb-2 flex flex-wrap gap-2">
      {uploads.map((upload) => (
        <li
          key={upload.id}
          className="flex max-w-sm items-center gap-2 rounded-xl border border-border bg-elevated px-3 py-2 text-xs"
          title={upload.error ?? labels[upload.status]}
        >
          {upload.status === "error" ? (
            <AlertCircle className="size-3.5 shrink-0 text-red-500" />
          ) : upload.status === "done" ? (
            <Check className="size-3.5 shrink-0 text-emerald-500" />
          ) : (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-muted" />
          )}

          <FileText className="size-3.5 shrink-0 text-muted" />
          <span className="truncate font-medium">{upload.name}</span>

          <span className="shrink-0 text-muted">
            {upload.status === "done"
              ? `${upload.chunks} chunk${upload.chunks === 1 ? "" : "s"}`
              : labels[upload.status]}
          </span>

          {(upload.status === "done" || upload.status === "error") && (
            <button
              type="button"
              onClick={() => onDismiss(upload.id)}
              aria-label={`Quitar ${upload.name} de la lista`}
              className="rounded p-0.5 text-muted transition-colors hover:bg-hover hover:text-text"
            >
              <X className="size-3.5" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
