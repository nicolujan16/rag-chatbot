#!/usr/bin/env node
// Arma el JSON que espera la function `demo-seed` a partir de un archivo del
// corpus, para poder pasárselo a `functions invoke --data` sin escribir el
// texto a mano:
//
//   npx -y @insforge/cli functions invoke demo-seed \
//     --data "$(node scripts/demo-seed-payload.mjs demo-corpus/que-es-un-rag.md)"

import { readFileSync } from "node:fs";
import { basename } from "node:path";

const path = process.argv[2];

if (!path) {
  console.error("Uso: node scripts/demo-seed-payload.mjs <archivo.md>");
  process.exit(1);
}

const text = readFileSync(path, "utf8");

if (!text.trim()) {
  console.error(`${path} está vacío.`);
  process.exit(1);
}

process.stdout.write(JSON.stringify({ source: basename(path), text }));
