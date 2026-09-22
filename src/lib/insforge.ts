"use client";

import { createClient } from "@insforge/sdk";
import type { Conversation, Message, Source, StoredFile, Usage } from "./types";

const BASE_URL = process.env.NEXT_PUBLIC_INSFORGE_URL!;

export const insforge = createClient({
  baseUrl: BASE_URL,
  anonKey: process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY!,
});

/** Extensiones que el navegador puede leer como texto sin parseo extra. */
export const ACCEPTED_EXTENSIONS = [".txt", ".md", ".markdown", ".csv", ".json"];
export const ACCEPT_ATTRIBUTE = [...ACCEPTED_EXTENSIONS, "text/plain"].join(",");

/** Error de una edge function, con el código que manda el backend. */
export class ApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export interface IngestResult {
  source: string;
  model: string;
  bytes: number;
  chunks_inserted: number;
  bytes_used: number;
  bytes_limit: number;
}

export interface AskResult {
  answer: string;
  model: string;
  sources: Source[];
  usage?: { questions_used: number; questions_limit: number };
}

/**
 * `functions.invoke` adjunta solo el token del usuario, que es justo lo que
 * las functions validan. El SDK descarta los campos extra del cuerpo de error,
 * así que el backend manda el detalle de la cuota dentro de `message`.
 */
async function callFunction<T>(slug: string, body: unknown): Promise<T> {
  const { data, error } = await insforge.functions.invoke<T>(slug, { body });

  if (error) {
    throw new ApiError(
      error.message || `La function ${slug} falló.`,
      error.statusCode ?? 500,
      String(error.error ?? "unknown"),
    );
  }

  return data as T;
}

export function ingest(text: string, source: string): Promise<IngestResult> {
  return callFunction<IngestResult>("ingest", { text, source });
}

export function ask(question: string): Promise<AskResult> {
  return callFunction<AskResult>("ask", { question });
}

interface DemoAccount {
  email: string;
  password: string;
  files: number;
  chunks: number;
}

/**
 * Pide una cuenta de demostración e inicia sesión con ella.
 *
 * La function crea un usuario real y le copia el corpus de ejemplo, así que a
 * partir de acá la sesión es igual a cualquier otra: las mismas políticas RLS,
 * sus propios documentos y su propio historial. Las credenciales son de un solo
 * uso y no se guardan en ningún lado.
 */
export async function startDemo(): Promise<void> {
  const account = await callFunction<DemoAccount>("demo", {});

  const { error } = await insforge.auth.signInWithPassword({
    email: account.email,
    password: account.password,
  });

  if (error) throw new Error(error.message);
}

// ------------------------------------------------------------------ datos ---

function unwrap<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) {
    const error = result.error as { message?: string };
    throw new Error(error.message ?? String(result.error));
  }
  return (result.data ?? []) as T;
}

/**
 * El cupo se cuenta por IP, y la IP solo la ve el servidor: por eso esto es una
 * edge function y no una consulta directa a la base como el resto del panel.
 */
export function fetchUsage(): Promise<Usage> {
  return callFunction<Usage>("usage", {});
}

export async function listConversations(): Promise<Conversation[]> {
  return unwrap<Conversation[]>(
    await insforge.database
      .from("conversations")
      .select("id, title, created_at, updated_at")
      .order("updated_at", { ascending: false }),
  );
}

export async function listMessages(conversationId: string): Promise<Message[]> {
  return unwrap<Message[]>(
    await insforge.database
      .from("messages")
      .select("id, role, content, sources, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true }),
  );
}

export async function createConversation(
  ownerId: string,
  title: string,
): Promise<Conversation> {
  const rows = unwrap<Conversation[]>(
    await insforge.database
      .from("conversations")
      .insert([{ owner_id: ownerId, title }])
      .select(),
  );
  return rows[0];
}

export async function insertMessage(
  ownerId: string,
  conversationId: string,
  message: { role: "user" | "assistant"; content: string; sources?: Source[] },
): Promise<Message> {
  const rows = unwrap<Message[]>(
    await insforge.database
      .from("messages")
      .insert([
        {
          owner_id: ownerId,
          conversation_id: conversationId,
          role: message.role,
          content: message.content,
          sources: message.sources ?? null,
        },
      ])
      .select(),
  );
  return rows[0];
}

export async function deleteConversation(id: string): Promise<void> {
  unwrap(await insforge.database.from("conversations").delete().eq("id", id));
}

export async function listFiles(): Promise<StoredFile[]> {
  return unwrap<StoredFile[]>(
    await insforge.database
      .from("ingested_files")
      .select("id, name, bytes, chunks, created_at")
      .order("created_at", { ascending: false }),
  );
}

/** Borrar el archivo arrastra sus chunks por el FK y libera la cuota. */
export async function deleteFile(id: number): Promise<void> {
  unwrap(await insforge.database.from("ingested_files").delete().eq("id", id));
}

// ---------------------------------------------------------------- archivos ---

export function isAccepted(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    file.type.startsWith("text/") ||
    ACCEPTED_EXTENSIONS.some((extension) => name.endsWith(extension))
  );
}

export function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error(`No se pudo leer ${file.name}.`));
    reader.readAsText(file);
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
