import Parser from "web-tree-sitter";
import { randomUUID } from "crypto";
import { CodeChunk } from "../types/index.js";
import {
  getLanguageFromExtension,
  LANGUAGE_REGISTRY,
  type SupportedLanguage,
} from "./language-registry.js";
import { createParser } from "./tree-sitter.js";

export interface ChunkOptions {
  includeComments?: boolean;
  minChunkSize?: number;
  maxChunkSize?: number;
}

export class SemanticChunker {
  constructor(private options: ChunkOptions = {}) {}

  async chunkFile(filepath: string, content: string): Promise<CodeChunk[]> {
    if (!content.trim()) {
      return [];
    }

    const lang = getLanguageFromExtension(filepath);
    if (!lang) {
      throw new Error(`Unsupported language for file: ${filepath}`);
    }

    const parser = await createParser(lang);
    const tree = parser.parse(content);
    const config = LANGUAGE_REGISTRY[lang];

    const chunks: CodeChunk[] = [];

    const parserLanguage = parser.getLanguage();
    const functionQuery = parserLanguage.query(config.queries.functions);
    const classQuery = parserLanguage.query(config.queries.classes);
    const interfaceQuery = config.queries.interfaces
      ? parserLanguage.query(config.queries.interfaces)
      : null;

    const captures: {
      node: Parser.SyntaxNode;
      type: "function" | "class" | "interface" | "method";
      name?: string;
    }[] = [];

    const funcMatches = functionQuery.matches(tree.rootNode);
    for (const match of funcMatches) {
      const funcCapture = match.captures.find((c) => c.name === "func");
      const nameCapture = match.captures.find((c) => c.name === "name");
      if (funcCapture) {
        const name = nameCapture
          ? content.slice(nameCapture.node.startIndex, nameCapture.node.endIndex)
          : undefined;
        captures.push({
          node: funcCapture.node,
          type: funcCapture.node.type === "method_definition" ? "method" : "function",
          name,
        });
      }
    }

    const classMatches = classQuery.matches(tree.rootNode);
    for (const match of classMatches) {
      const classCapture = match.captures.find((c) => c.name === "class");
      const nameCapture = match.captures.find((c) => c.name === "name");
      if (classCapture) {
        const name = nameCapture
          ? content.slice(nameCapture.node.startIndex, nameCapture.node.endIndex)
          : undefined;
        captures.push({
          node: classCapture.node,
          type: "class",
          name,
        });
      }
    }

    if (interfaceQuery) {
      const interfaceMatches = interfaceQuery.matches(tree.rootNode);
      for (const match of interfaceMatches) {
        const interfaceCapture = match.captures.find((c) => c.name === "interface");
        const nameCapture = match.captures.find((c) => c.name === "name");
        if (interfaceCapture) {
          const name = nameCapture
            ? content.slice(nameCapture.node.startIndex, nameCapture.node.endIndex)
            : undefined;
          captures.push({
            node: interfaceCapture.node,
            type: "interface",
            name,
          });
        }
      }
    }

    // Sort captures by start position
    captures.sort((a, b) => a.node.startIndex - b.node.startIndex);

    // Convert captures to CodeChunk objects
    for (const capture of captures) {
      const node = capture.node;
      let startLine = node.startPosition.row;
      const endLine = node.endPosition.row;

      let chunkContent = content.slice(node.startIndex, node.endIndex);

      if (this.options.includeComments ?? true) {
        const comments = this.extractPrecedingComments(
          content,
          node,
          config.commentPrefix,
          lang
        );
        if (comments) {
          const commentLines = comments.split("\n").length;
          startLine = Math.max(0, startLine - commentLines);
          chunkContent = comments + "\n" + chunkContent;
        }
      }

      // Apply size filters
      const chunkSize = chunkContent.length;
      if (
        this.options.minChunkSize &&
        chunkSize < this.options.minChunkSize
      ) {
        continue;
      }

      if (this.options.maxChunkSize && chunkSize > this.options.maxChunkSize) {
        const lines = chunkContent.split("\n");
        const maxLines = Math.floor(
          (this.options.maxChunkSize / chunkSize) * lines.length
        );
        for (let i = 0; i < lines.length; i += maxLines) {
          const chunkLines = lines.slice(i, i + maxLines);
          const subchunkLinesCount = chunkLines.length;
          chunks.push({
            id: randomUUID(),
            content: chunkLines.join("\n"),
            filepath,
            startLine: startLine + i,
            endLine: Math.min(startLine + i + subchunkLinesCount - 1, endLine),
            language: lang,
            type: capture.type,
            symbolName: capture.name,
          });
        }
        continue;
      }

      chunks.push({
        id: randomUUID(),
        content: chunkContent,
        filepath,
        startLine,
        endLine,
        language: lang,
        type: capture.type,
        symbolName: capture.name,
      });
    }

    return chunks;
  }

  private extractPrecedingComments(
    sourceCode: string,
    node: Parser.SyntaxNode,
    commentPrefix: string,
    language: SupportedLanguage
  ): string | null {
    const beforeNode = sourceCode.slice(0, node.startIndex);
    const lines = beforeNode.split("\n");

    // For Python, check for docstrings first
    if (language === "python") {
      const lastLine = lines[lines.length - 1] ?? "";
      const trimmed = lastLine.trim();
      if (
        trimmed.startsWith('"""') ||
        trimmed.startsWith("'''") ||
        trimmed.startsWith('r"""') ||
        trimmed.startsWith("r'''")
      ) {
        const docstringStart = beforeNode.lastIndexOf(trimmed);
        if (docstringStart !== -1) {
          const afterStart = sourceCode.slice(docstringStart);
          const docstringEnd = afterStart.indexOf(trimmed.slice(0, 3), 3);
          if (docstringEnd !== -1) {
            return sourceCode.slice(
              docstringStart,
              docstringStart + docstringEnd + trimmed.slice(0, 3).length
            );
          }
        }
      }
    }

    const commentLines: string[] = [];
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (line === undefined) continue;
      
      const trimmed = line.trim();
      const isEmpty = trimmed === "";

      if (
        trimmed.startsWith(commentPrefix) ||
        trimmed.startsWith("/*") ||
        trimmed.startsWith("*") ||
        trimmed.startsWith("/**") ||
        isEmpty
      ) {
        if (!isEmpty) {
          commentLines.unshift(line);
        } else if (commentLines.length > 0) {
          commentLines.unshift(line);
        }
      } else {
        break;
      }
    }

    return commentLines.length > 0 ? commentLines.join("\n") : null;
  }
}
