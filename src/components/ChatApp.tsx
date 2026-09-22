"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ChatHeader from "@/components/ChatHeader";
import ChatMessage from "@/components/ChatMessage";
import Composer from "@/components/Composer";
import EmptyState from "@/components/EmptyState";
import Sidebar from "@/components/Sidebar";
import UploadList from "@/components/UploadList";
import {
  ACCEPT_ATTRIBUTE,
  ApiError,
  ask,
  createConversation,
  deleteConversation,
  deleteFile,
  fetchUsage,
  formatBytes,
  ingest,
  insertMessage,
  isAccepted,
  listConversations,
  listFiles,
  listMessages,
  readAsText,
} from "@/lib/insforge";
import { useMediaQuery } from "@/lib/use-media-query";
import type {
  AuthUser,
  Conversation,
  Message,
  StoredFile,
  Upload,
  Usage,
} from "@/lib/types";

interface ChatAppProps {
  user: AuthUser;
  onSignOut: () => void;
}

export default function ChatApp({ user, onSignOut }: ChatAppProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [busy, setBusy] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Conversación cuyos mensajes ya están en pantalla. Evita que el efecto
  // recargue (y pise) los mensajes optimistas de una conversación recién creada.
  const loadedIdRef = useRef<string | null>(null);

  const isMobile = useMediaQuery("(max-width: 767px)");
  const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");
  const [sidebarOverride, setSidebarOverride] = useState<boolean | null>(null);
  const [themeOverride, setThemeOverride] = useState<"light" | "dark" | null>(null);

  const sidebarOpen = sidebarOverride ?? !isMobile;
  const theme = themeOverride ?? (prefersDark ? "dark" : "light");

  const loadSidebar = useCallback(
    () => Promise.all([listConversations(), listFiles(), fetchUsage()]),
    [],
  );

  const applySidebar = useCallback(
    ([nextConversations, nextFiles, nextUsage]: [
      Conversation[],
      StoredFile[],
      Usage,
    ]) => {
      setConversations(nextConversations);
      setFiles(nextFiles);
      setUsage(nextUsage);
    },
    [],
  );

  const reloadSidebar = useCallback(
    () =>
      loadSidebar()
        .then(applySidebar)
        // El panel lateral es secundario: si falla, el chat sigue usable.
        .catch(() => {}),
    [loadSidebar, applySidebar],
  );

  useEffect(() => {
    void reloadSidebar();
  }, [reloadSidebar]);

  useEffect(() => {
    // activeId null significa chat nuevo; quien lo pone ya limpió los mensajes.
    if (activeId === null || loadedIdRef.current === activeId) return;

    let cancelled = false;
    void listMessages(activeId).then((rows) => {
      if (cancelled) return;
      loadedIdRef.current = activeId;
      setMessages(rows);
    });

    return () => {
      cancelled = true;
    };
  }, [activeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const startNewChat = () => {
    loadedIdRef.current = null;
    setActiveId(null);
    setMessages([]);
  };

  const toggleSidebar = () => setSidebarOverride(!sidebarOpen);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setThemeOverride(next);
    document.documentElement.dataset.theme = next;
  };

  const patchMessage = (id: string, patch: Partial<Message>) =>
    setMessages((prev) =>
      prev.map((message) => (message.id === id ? { ...message, ...patch } : message)),
    );

  const send = async (question: string) => {
    const pendingId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", content: question },
      { id: pendingId, role: "assistant", content: "", pending: true },
    ]);
    setBusy(true);

    try {
      let conversationId = activeId;

      if (!conversationId) {
        const conversation = await createConversation(
          user.id,
          question.slice(0, 60),
        );
        conversationId = conversation.id;
        // Marcá como cargada antes de activarla: si no, el efecto la releería
        // de la base y borraría los mensajes que acabamos de pintar.
        loadedIdRef.current = conversationId;
        setActiveId(conversationId);
        setConversations((prev) => [conversation, ...prev]);
      }

      await insertMessage(user.id, conversationId, {
        role: "user",
        content: question,
      });

      const result = await ask(question);

      const stored = await insertMessage(user.id, conversationId, {
        role: "assistant",
        content: result.answer,
        sources: result.sources,
      });

      patchMessage(pendingId, {
        id: stored.id,
        content: result.answer,
        sources: result.sources,
        pending: false,
      });

      if (result.usage) {
        setUsage((prev) =>
          prev
            ? { ...prev, questions_used: result.usage!.questions_used }
            : prev,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      patchMessage(pendingId, { content: message, pending: false, failed: true });

      // Un 429 significa que el contador ya cambió: traelo del backend.
      if (err instanceof ApiError && err.status === 429) {
        void fetchUsage().then(setUsage).catch(() => {});
      }
    } finally {
      setBusy(false);
    }
  };

  const patchUpload = (id: string, patch: Partial<Upload>) =>
    setUploads((prev) =>
      prev.map((upload) => (upload.id === id ? { ...upload, ...patch } : upload)),
    );

  /**
   * Ingesta secuencial: cada archivo se lee, se manda a la function `ingest`
   * y espera su turno, para no disparar N pedidos de embeddings en paralelo.
   */
  const handleFiles = async (selected: File[]) => {
    const entries = selected.map((file) => ({
      file,
      upload: {
        id: crypto.randomUUID(),
        name: file.name,
        status: isAccepted(file) ? ("reading" as const) : ("error" as const),
        error: isAccepted(file) ? undefined : "Formato no soportado.",
      } satisfies Upload,
    }));

    setUploads((prev) => [...prev, ...entries.map((entry) => entry.upload)]);

    for (const { file, upload } of entries) {
      if (upload.status === "error") continue;

      try {
        const text = await readAsText(file);
        if (!text.trim()) {
          patchUpload(upload.id, { status: "error", error: "El archivo está vacío." });
          continue;
        }

        patchUpload(upload.id, { status: "ingesting" });
        const result = await ingest(text, file.name);
        patchUpload(upload.id, { status: "done", chunks: result.chunks_inserted });
      } catch (err) {
        let message = err instanceof Error ? err.message : String(err);

        // El límite por archivo lo conoce la UI: completá el mensaje con él.
        if (err instanceof ApiError && err.code === "file_too_large" && usage) {
          message = `${file.name} pesa más que el máximo de ${formatBytes(usage.file_bytes_limit)} por archivo.`;
        }

        patchUpload(upload.id, { status: "error", error: message });
      }
    }

    await reloadSidebar();
  };

  const removeConversation = async (id: string) => {
    await deleteConversation(id);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) startNewChat();
  };

  const removeFile = async (file: StoredFile) => {
    await deleteFile(file.id);
    await reloadSidebar();
  };

  const openFilePicker = () => fileInputRef.current?.click();

  const outOfQuestions = usage
    ? usage.questions_used >= usage.questions_limit
    : false;

  const composer = (
    <>
      <UploadList
        uploads={uploads}
        onDismiss={(id) =>
          setUploads((prev) => prev.filter((upload) => upload.id !== id))
        }
      />
      <Composer
        onSend={send}
        onAttach={openFilePicker}
        busy={busy}
        disabled={outOfQuestions}
        placeholder={
          outOfQuestions
            ? `Llegaste a las ${usage?.questions_limit} preguntas de hoy`
            : "Preguntá sobre tus documentos"
        }
      />
    </>
  );

  return (
    <div className="flex h-full min-h-0">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPT_ATTRIBUTE}
        className="hidden"
        onChange={(e) => {
          const selected = Array.from(e.target.files ?? []);
          if (selected.length > 0) void handleFiles(selected);
          // Permite volver a elegir el mismo archivo más adelante.
          e.target.value = "";
        }}
      />

      <Sidebar
        conversations={conversations}
        files={files}
        usage={usage}
        user={user}
        activeId={activeId}
        open={sidebarOpen}
        onToggle={toggleSidebar}
        onSelect={setActiveId}
        onNewChat={startNewChat}
        onDeleteConversation={(id) => void removeConversation(id)}
        onDeleteFile={(file) => void removeFile(file)}
        onSignOut={onSignOut}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <ChatHeader
          sidebarOpen={sidebarOpen}
          onToggleSidebar={toggleSidebar}
          theme={theme}
          onToggleTheme={toggleTheme}
        />

        {messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-4">
            <div className="w-full max-w-3xl">
              <EmptyState onAttach={openFilePicker} hasSources={files.length > 0} />
              {composer}
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-4">
              <div className="mx-auto flex max-w-3xl flex-col gap-8 py-6">
                {messages.map((message) => (
                  <ChatMessage key={message.id} message={message} />
                ))}
                <div ref={bottomRef} />
              </div>
            </div>

            <div className="px-4 pb-4">
              <div className="mx-auto max-w-3xl">
                {composer}
                <p className="pt-2 text-center text-xs text-muted">
                  Las respuestas salen solo de tus documentos. Verificá los datos
                  importantes.
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
