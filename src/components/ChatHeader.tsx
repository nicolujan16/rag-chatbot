"use client";

import { Moon, PanelLeft, Sun } from "lucide-react";

interface ChatHeaderProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
}

export default function ChatHeader({
  sidebarOpen,
  onToggleSidebar,
  theme,
  onToggleTheme,
}: ChatHeaderProps) {
  return (
    <header className="sticky top-0 z-10 flex items-center gap-2 bg-bg px-3 py-2">
      {!sidebarOpen && (
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label="Mostrar panel"
          className="rounded-lg p-2 text-muted transition-colors hover:bg-hover hover:text-text"
        >
          <PanelLeft className="size-5" />
        </button>
      )}

      <h1 className="px-3 py-1.5 text-lg font-medium">RAG Chatbot</h1>

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === "dark" ? "Tema claro" : "Tema oscuro"}
          className="rounded-lg p-2 text-muted transition-colors hover:bg-hover hover:text-text"
        >
          {theme === "dark" ? (
            <Sun className="size-5" />
          ) : (
            <Moon className="size-5" />
          )}
        </button>
      </div>
    </header>
  );
}
