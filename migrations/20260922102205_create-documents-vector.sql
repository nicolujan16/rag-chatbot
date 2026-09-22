-- RAG: almacenamiento de chunks con embeddings y búsqueda por similitud coseno.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE public.documents (
  id BIGSERIAL PRIMARY KEY,
  content TEXT NOT NULL,
  source TEXT NOT NULL,
  embedding vector(1536) NOT NULL,
  chunk_index INT NOT NULL DEFAULT 0,
  embedding_model TEXT NOT NULL DEFAULT 'openai/text-embedding-3-small',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- La tabla se lee y escribe solo desde las edge functions con el cliente admin.
-- RLS queda activa sin políticas permisivas: anon y authenticated no ven filas.
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

CREATE INDEX documents_source_idx ON public.documents (source);

CREATE INDEX documents_embedding_hnsw_idx
ON public.documents
USING hnsw (embedding vector_cosine_ops);

-- Devuelve los chunks más parecidos con su score de similitud coseno (0..1).
-- SECURITY INVOKER: corre con el rol del llamador, así que RLS sigue aplicando.
CREATE OR REPLACE FUNCTION public.match_documents(
  query_embedding vector(1536),
  match_count INT DEFAULT 5,
  match_threshold DOUBLE PRECISION DEFAULT 0.0
)
RETURNS TABLE (
  id BIGINT,
  content TEXT,
  source TEXT,
  chunk_index INT,
  similarity DOUBLE PRECISION
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    d.id,
    d.content,
    d.source,
    d.chunk_index,
    1 - (d.embedding <=> query_embedding) AS similarity
  FROM public.documents d
  WHERE 1 - (d.embedding <=> query_embedding) >= match_threshold
  ORDER BY d.embedding <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_documents(vector, INT, DOUBLE PRECISION)
TO authenticated;
