/**
 * Preguntas que el corpus de la demo sí puede contestar.
 *
 * Sirven de arranque para quien entra sin saber qué preguntarle, y de paso
 * muestran las dos cosas que tiene cargadas: la técnica y el autor.
 *
 * `label` es para la fila angosta que va sobre el campo de texto, donde no
 * entra la pregunta entera; `question` es lo que se manda en los dos casos.
 */
export interface DemoQuestion {
  label: string;
  question: string;
}

export const DEMO_QUESTIONS: DemoQuestion[] = [
  {
    label: "¿Qué es un RAG?",
    question: "¿Qué es un RAG y cuáles son sus dos etapas?",
  },
  {
    label: "¿Quién lo hizo?",
    question: "¿Quién es Nicolás Luján y qué tecnologías maneja?",
  },
  {
    label: "¿Cómo aísla los datos?",
    question: "¿Cómo hace este proyecto para aislar los documentos de cada usuario?",
  },
  {
    label: "¿Qué limitaciones tiene?",
    question: "¿Qué limitaciones conocidas tiene este chatbot?",
  },
];
