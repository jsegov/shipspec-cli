import { describe, it, expect } from "vitest";
import {
  getLanguageFromExtension,
  LANGUAGE_REGISTRY,
  type SupportedLanguage,
} from "../../../core/parsing/language-registry.js";

describe("language-registry", () => {
  describe("getLanguageFromExtension", () => {
    it("returns 'typescript' for .ts extension", () => {
      expect(getLanguageFromExtension("file.ts")).toBe("typescript");
      expect(getLanguageFromExtension("path/to/file.ts")).toBe("typescript");
    });

    it("returns 'typescript' for .tsx extension", () => {
      expect(getLanguageFromExtension("file.tsx")).toBe("typescript");
      expect(getLanguageFromExtension("component.tsx")).toBe("typescript");
    });

    it("returns 'javascript' for .js extension", () => {
      expect(getLanguageFromExtension("file.js")).toBe("javascript");
      expect(getLanguageFromExtension("script.js")).toBe("javascript");
    });

    it("returns 'javascript' for .jsx extension", () => {
      expect(getLanguageFromExtension("file.jsx")).toBe("javascript");
      expect(getLanguageFromExtension("component.jsx")).toBe("javascript");
    });

    it("returns 'javascript' for .mjs extension", () => {
      expect(getLanguageFromExtension("file.mjs")).toBe("javascript");
      expect(getLanguageFromExtension("module.mjs")).toBe("javascript");
    });

    it("returns 'python' for .py extension", () => {
      expect(getLanguageFromExtension("file.py")).toBe("python");
      expect(getLanguageFromExtension("script.py")).toBe("python");
    });

    it("returns 'go' for .go extension", () => {
      expect(getLanguageFromExtension("file.go")).toBe("go");
      expect(getLanguageFromExtension("main.go")).toBe("go");
    });

    it("returns 'rust' for .rs extension", () => {
      expect(getLanguageFromExtension("file.rs")).toBe("rust");
      expect(getLanguageFromExtension("lib.rs")).toBe("rust");
    });

    it("returns null for unsupported extensions", () => {
      expect(getLanguageFromExtension("file.json")).toBeNull();
      expect(getLanguageFromExtension("file.yaml")).toBeNull();
      expect(getLanguageFromExtension("file.md")).toBeNull();
      expect(getLanguageFromExtension("file.txt")).toBeNull();
      expect(getLanguageFromExtension("file")).toBeNull();
    });

    it("is case insensitive", () => {
      expect(getLanguageFromExtension("file.TS")).toBe("typescript");
      expect(getLanguageFromExtension("file.TSX")).toBe("typescript");
      expect(getLanguageFromExtension("file.JS")).toBe("javascript");
      expect(getLanguageFromExtension("file.PY")).toBe("python");
      expect(getLanguageFromExtension("file.GO")).toBe("go");
      expect(getLanguageFromExtension("file.RS")).toBe("rust");
    });

    it("handles files without extensions", () => {
      expect(getLanguageFromExtension("file")).toBeNull();
      expect(getLanguageFromExtension("path/to/file")).toBeNull();
    });
  });

  describe("LANGUAGE_REGISTRY", () => {
    const supportedLanguages: SupportedLanguage[] = [
      "typescript",
      "javascript",
      "python",
      "go",
      "rust",
    ];

    it("has entries for all supported languages", () => {
      for (const lang of supportedLanguages) {
        expect(LANGUAGE_REGISTRY[lang]).toBeDefined();
      }
    });

    it("has valid extension arrays for each language", () => {
      for (const lang of supportedLanguages) {
        const config = LANGUAGE_REGISTRY[lang];
        expect(Array.isArray(config.extensions)).toBe(true);
        expect(config.extensions.length).toBeGreaterThan(0);
      }
    });

    it("has valid wasmName for each language", () => {
      for (const lang of supportedLanguages) {
        const config = LANGUAGE_REGISTRY[lang];
        expect(typeof config.wasmName).toBe("string");
        expect(config.wasmName.length).toBeGreaterThan(0);
      }
    });

    it("has valid query strings for functions", () => {
      for (const lang of supportedLanguages) {
        const config = LANGUAGE_REGISTRY[lang];
        expect(typeof config.queries.functions).toBe("string");
        expect(config.queries.functions.length).toBeGreaterThan(0);
      }
    });

    it("has valid query strings for classes", () => {
      for (const lang of supportedLanguages) {
        const config = LANGUAGE_REGISTRY[lang];
        expect(typeof config.queries.classes).toBe("string");
        expect(config.queries.classes.length).toBeGreaterThan(0);
      }
    });

    it("has interfaces query for TypeScript", () => {
      expect(LANGUAGE_REGISTRY.typescript.queries.interfaces).toBeDefined();
      expect(typeof LANGUAGE_REGISTRY.typescript.queries.interfaces).toBe(
        "string"
      );
    });

    it("has valid commentPrefix for each language", () => {
      for (const lang of supportedLanguages) {
        const config = LANGUAGE_REGISTRY[lang];
        expect(typeof config.commentPrefix).toBe("string");
        expect(config.commentPrefix.length).toBeGreaterThan(0);
      }
    });

    it("TypeScript has correct extensions", () => {
      expect(LANGUAGE_REGISTRY.typescript.extensions).toContain(".ts");
      expect(LANGUAGE_REGISTRY.typescript.extensions).toContain(".tsx");
    });

    it("JavaScript has correct extensions", () => {
      expect(LANGUAGE_REGISTRY.javascript.extensions).toContain(".js");
      expect(LANGUAGE_REGISTRY.javascript.extensions).toContain(".jsx");
      expect(LANGUAGE_REGISTRY.javascript.extensions).toContain(".mjs");
    });

    it("Python has correct extensions", () => {
      expect(LANGUAGE_REGISTRY.python.extensions).toContain(".py");
    });

    it("Go has correct extensions", () => {
      expect(LANGUAGE_REGISTRY.go.extensions).toContain(".go");
    });

    it("Rust has correct extensions", () => {
      expect(LANGUAGE_REGISTRY.rust.extensions).toContain(".rs");
    });
  });
});
