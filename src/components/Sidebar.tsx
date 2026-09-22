"use client";

import { FileText, LogOut, PanelLeft, Search, SquarePen, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { formatBytes } from "@/lib/insforge";
import type { AuthUser, Conversation, StoredFile, Usage } from "@/lib/types";

interface SidebarProps {
  conversations: Conversation[];
  files: StoredFile[];
  usage: Usage | null;
  user: AuthUser;
  activeId: string | null;
  open: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onDeleteConversation: (id: string) => void;
  onDeleteFile: (file: StoredFile) => void;
  onSignOut: () => void;
}

const DAY = 24 * 60 * 60 * 1000;
const groupOrder = ["Hoy", "Ayer", "Últimos 7 días", "Anteriores"];

/** Agrupa por antigüedad real de la conversación, no por una etiqueta fija. */
function groupFor(iso: string): string {
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const at = new Date(iso).getTime();
  if (at >= startOfToday) return "Hoy";
  if (at >= startOfToday - DAY) return "Ayer";
  if (at >= startOfToday - 7 * DAY) return "Últimos 7 días";
  return "Anteriores";
}

export default function Sidebar({
  conversations,
  files,
  usage,
  user,
  activeId,
  open,
  onToggle,
  onSelect,
  onNewChat,
  onDeleteConversation,
  onDeleteFile,
  onSignOut,
}: SidebarProps) {
  const [query, setQuery] = useState("");

  const grouped = useMemo(() => {
    const term = query.trim().toLowerCase();
    const matches = term
      ? conversations.filter((c) => c.title.toLowerCase().includes(term))
      : conversations;

    return groupOrder
      .map((group) => ({
        group,
        items: matches.filter((c) => groupFor(c.updated_at) === group),
      }))
      .filter((section) => section.items.length > 0);
  }, [conversations, query]);

  const storagePercent = usage
    ? Math.min(100, (usage.bytes_used / usage.bytes_limit) * 100)
    : 0;
  const questionsLeft = usage
    ? Math.max(0, usage.questions_limit - usage.questions_used)
    : 0;
  const isDemo = usage?.is_demo ?? false;

  return (
    <>
      {/* Capa oscura detrás del panel en pantallas chicas */}
      {open && (
        <button
          type="button"
          aria-label="Cerrar panel"
          onClick={onToggle}
          className="fixed inset-0 z-20 bg-black/40 md:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-[280px] shrink-0 flex-col bg-surface transition-transform duration-200 md:static md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full md:w-0 md:overflow-hidden"
        }`}
      >
        <div className="flex items-center justify-between px-3 py-3">
          <button
            type="button"
            onClick={onToggle}
            aria-label="Ocultar panel"
            className="rounded-lg p-2 text-muted transition-colors hover:bg-hover hover:text-text"
          >
            <PanelLeft className="size-5" />
          </button>
          <button
            type="button"
            onClick={onNewChat}
            aria-label="Chat nuevo"
            className="rounded-lg p-2 text-muted transition-colors hover:bg-hover hover:text-text"
          >
            <SquarePen className="size-5" />
          </button>
        </div>

        <nav className="px-3">
          <button
            type="button"
            onClick={onNewChat}
            className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-hover"
          >
            <SquarePen className="size-4 text-muted" />
            Chat nuevo
          </button>

          {conversations.length > 0 && (
            <div className="mt-1 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors focus-within:bg-hover hover:bg-hover">
              <Search className="size-4 shrink-0 text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar chats"
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted"
              />
            </div>
          )}
        </nav>

        <div className="mt-4 flex-1 overflow-y-auto px-3 pb-4">
          {conversations.length === 0 && (
            <p className="px-2 py-2 text-sm text-muted">Todavía no hay chats.</p>
          )}

          {conversations.length > 0 && grouped.length === 0 && (
            <p className="px-2 py-2 text-sm text-muted">Sin resultados.</p>
          )}

          {grouped.map((section) => (
            <section key={section.group} className="mb-4">
              <h2 className="px-2 pb-1 text-xs font-medium text-muted">
                {section.group}
              </h2>
              <ul>
                {section.items.map((conversation) => (
                  <li key={conversation.id} className="group/item relative">
                    <button
                      type="button"
                      onClick={() => onSelect(conversation.id)}
                      className={`w-full truncate rounded-lg py-2 pl-2 pr-8 text-left text-sm transition-colors ${
                        conversation.id === activeId ? "bg-hover" : "hover:bg-hover"
                      }`}
                    >
                      {conversation.title}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteConversation(conversation.id)}
                      aria-label={`Borrar chat ${conversation.title}`}
                      className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted opacity-0 transition-opacity hover:text-red-500 group-hover/item:opacity-100"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {files.length > 0 && (
          <div className="max-h-56 overflow-y-auto border-t border-border px-3 py-3">
            <h2 className="px-2 pb-1 text-xs font-medium text-muted">
              Documentos ({files.length})
            </h2>
            <ul>
              {files.map((file) => (
                <li
                  key={file.id}
                  className="group/file flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-hover"
                >
                  <FileText className="size-3.5 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate" title={file.name}>
                    {file.name}
                  </span>
                  <span className="shrink-0 text-xs text-muted">
                    {formatBytes(file.bytes)}
                  </span>
                  <button
                    type="button"
                    onClick={() => onDeleteFile(file)}
                    aria-label={`Borrar ${file.name}`}
                    className="shrink-0 rounded p-0.5 text-muted opacity-0 transition-opacity hover:text-red-500 group-hover/file:opacity-100"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {usage && (
          <div className="border-t border-border px-5 py-3 text-xs">
            <div className="flex items-center justify-between text-muted">
              <span>Preguntas hoy</span>
              <span className={questionsLeft === 0 ? "text-red-500" : "text-text"}>
                {usage.questions_used} / {usage.questions_limit}
              </span>
            </div>

            <div className="mt-2 flex items-center justify-between text-muted">
              <span>Almacenamiento</span>
              <span className={storagePercent >= 100 ? "text-red-500" : "text-text"}>
                {formatBytes(usage.bytes_used)} / {formatBytes(usage.bytes_limit)}
              </span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-border">
              <div
                className={`h-full rounded-full transition-all ${
                  storagePercent >= 100 ? "bg-red-500" : "bg-muted"
                }`}
                style={{ width: `${storagePercent}%` }}
              />
            </div>
          </div>
        )}

        <div className="border-t border-border p-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold uppercase text-accent-fg">
              {isDemo ? "D" : (user.name ?? user.email).slice(0, 1)}
            </span>
            <span className="min-w-0 flex-1">
              {/* En demo, el email es un uuid descartable: no aporta nada. */}
              <span className="block truncate text-sm" title={user.email}>
                {isDemo ? "Cuenta de demostración" : (user.name ?? user.email)}
              </span>
              {isDemo ? (
                <span className="block truncate text-xs text-muted">
                  Temporal, se borra sola
                </span>
              ) : (
                user.name && (
                  <span className="block truncate text-xs text-muted">
                    {user.email}
                  </span>
                )
              )}
            </span>
            <button
              type="button"
              onClick={onSignOut}
              aria-label="Cerrar sesión"
              title="Cerrar sesión"
              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-hover hover:text-text"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
