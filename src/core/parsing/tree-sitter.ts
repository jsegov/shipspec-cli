import Parser from "web-tree-sitter";
import { readFile } from "fs/promises";
import { createRequire } from "module";
import type { SupportedLanguage } from "./language-registry.js";

const require = createRequire(import.meta.url);

let parserInitialized = false;

export async function initTreeSitter(): Promise<void> {
  if (parserInitialized) return;

  await Parser.init();
  parserInitialized = true;
}

export async function loadLanguage(
  language: SupportedLanguage
): Promise<Parser.Language> {
  await initTreeSitter();

  const wasmPath = require.resolve(
    `tree-sitter-wasms/out/tree-sitter-${language}.wasm`
  );
  const langBuffer = await readFile(wasmPath);
  return Parser.Language.load(langBuffer);
}

export async function createParser(
  language: SupportedLanguage
): Promise<Parser> {
  await initTreeSitter();

  const parser = new Parser();
  const lang = await loadLanguage(language);
  parser.setLanguage(lang);
  return parser;
}
