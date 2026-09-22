export type Role = "user" | "assistant";

/** Chunk recuperado por `match_documents`, tal como lo devuelve la function `ask`. */
export interface Source {
  id: number;
  source: string;
  chunk_index: number;
  similarity: number;
  excerpt: string;
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  sources?: Source[] | null;
  created_at?: string;
  /** Solo en cliente: el asistente todavía está esperando la respuesta. */
  pending?: boolean;
  failed?: boolean;
  /**
   * Solo en cliente: la respuesta acaba de llegar, se revela letra por letra.
   * Los mensajes que se leen del historial no lo llevan.
   */
  animate?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface StoredFile {
  id: number;
  name: string;
  bytes: number;
  chunks: number;
  created_at: string;
}

export interface Usage {
  questions_used: number;
  questions_limit: number;
  bytes_used: number;
  bytes_limit: number;
  file_bytes_limit: number;
  /** La cuenta es una demo descartable: cupo más alto y vida corta. */
  is_demo: boolean;
}

export interface AuthUser {
  id: string;
  email: string;
  name?: string | null;
}

export type UploadStatus = "reading" | "ingesting" | "done" | "error";

export interface Upload {
  id: string;
  name: string;
  status: UploadStatus;
  chunks?: number;
  error?: string;
}
