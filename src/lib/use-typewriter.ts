"use client";

import { useEffect, useState } from "react";

/** Velocidad de revelado. Rápida: acompaña la lectura, no la frena. */
const CHARS_PER_SECOND = 900;

/** Ningún texto tarda más que esto, por largo que sea. */
const MAX_DURATION_MS = 2500;

/**
 * Cada cuánto se repinta. A 30 ms se ve continuo y deja la mitad de renders
 * que un requestAnimationFrame, que acá importa porque cada paso vuelve a
 * parsear el Markdown completo.
 */
const TICK_MS = 30;

/**
 * Revela `text` de a poco, para que una respuesta que llegó entera se lea como
 * si estuviera escribiéndose.
 *
 * Es puro efecto visual: el backend no hace streaming, la respuesta ya está
 * completa en memoria cuando esto arranca.
 *
 * Con `enabled` en false devuelve el texto entero de una. Así los mensajes que
 * vienen del historial aparecen instantáneos: volver a tipear una conversación
 * vieja cada vez que se abre sería insufrible.
 */
export function useTypewriter(text: string, enabled: boolean): {
  revealed: string;
  typing: boolean;
} {
  // Se decide en el primer render y no cambia: si `enabled` se apagara a mitad
  // de camino, el texto daría un salto en vez de terminar de escribirse.
  //
  // En el servidor no hay matchMedia, así que ahí nunca anima. No genera
  // desajuste de hidratación porque `animate` solo lo pone el cliente, al
  // recibir una respuesta.
  const [animating] = useState(
    () =>
      enabled &&
      typeof window !== "undefined" &&
      !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );

  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!animating || text.length === 0) return;

    // Al menos la velocidad nominal, y más rápido si hace falta para no pasarse
    // de MAX_DURATION_MS.
    const step = Math.max(
      Math.round((CHARS_PER_SECOND * TICK_MS) / 1000),
      Math.ceil(text.length / (MAX_DURATION_MS / TICK_MS)),
    );

    // El contador vive en el closure y no en el updater: así `setCount` queda
    // puro y React puede reejecutar el efecto sin que el avance se duplique.
    let revealed = 0;

    const id = setInterval(() => {
      revealed += step;
      setCount(revealed);
      if (revealed >= text.length) clearInterval(id);
    }, TICK_MS);

    return () => clearInterval(id);
  }, [animating, text]);

  const done = !animating || count >= text.length;

  return {
    revealed: done ? text : text.slice(0, count),
    typing: !done,
  };
}
