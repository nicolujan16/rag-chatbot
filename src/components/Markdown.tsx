"use client";

import "katex/dist/katex.min.css";
import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

/**
 * Renderiza la respuesta del modelo como Markdown.
 *
 * Sin `rehype-raw` a propósito: react-markdown ignora el HTML crudo por
 * defecto, y el texto viene de un LLM que repite lo que dicen documentos
 * subidos por el usuario. Habilitarlo sería dejar pasar HTML de terceros.
 */
export default function Markdown({ content }: { content: string }) {
  return (
    <div className="text-[15px] leading-7 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          p: (props) => <p className="my-3" {...props} />,

          h1: (props) => (
            <h1 className="mb-3 mt-6 text-xl font-semibold" {...props} />
          ),
          h2: (props) => (
            <h2 className="mb-2 mt-5 text-lg font-semibold" {...props} />
          ),
          h3: (props) => (
            <h3 className="mb-2 mt-4 text-base font-semibold" {...props} />
          ),
          h4: (props) => (
            <h4 className="mb-2 mt-4 text-sm font-semibold" {...props} />
          ),

          ul: (props) => (
            <ul className="my-3 list-disc space-y-1 pl-6" {...props} />
          ),
          ol: (props) => (
            <ol className="my-3 list-decimal space-y-1 pl-6" {...props} />
          ),
          li: (props) => <li className="pl-1" {...props} />,

          a: (props) => (
            <a
              className="underline underline-offset-2 hover:text-muted"
              target="_blank"
              rel="noopener noreferrer"
              {...props}
            />
          ),

          strong: (props) => <strong className="font-semibold" {...props} />,

          blockquote: (props) => (
            <blockquote
              className="my-3 border-l-2 border-border pl-4 text-muted"
              {...props}
            />
          ),

          hr: () => <hr className="my-5 border-border" />,

          // El bloque ya viene envuelto en <pre>; acá solo se distingue el
          // código en línea, que no lleva fondo propio dentro del bloque.
          code: ({ className, ...props }: ComponentPropsWithoutRef<"code">) => {
            const isBlock = /language-/.test(className ?? "");
            return isBlock ? (
              <code className={`${className ?? ""} font-mono text-[13px]`} {...props} />
            ) : (
              <code
                className="rounded bg-bubble px-1.5 py-0.5 font-mono text-[13px]"
                {...props}
              />
            );
          },

          pre: (props) => (
            <pre
              className="my-3 overflow-x-auto rounded-xl border border-border bg-bubble p-3 text-[13px] leading-6"
              {...props}
            />
          ),

          table: (props) => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full border-collapse text-sm" {...props} />
            </div>
          ),
          th: (props) => (
            <th
              className="border border-border bg-bubble px-3 py-1.5 text-left font-medium"
              {...props}
            />
          ),
          td: (props) => (
            <td className="border border-border px-3 py-1.5 align-top" {...props} />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
