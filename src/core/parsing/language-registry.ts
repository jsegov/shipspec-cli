import { extname } from "path";

export type SupportedLanguage =
  | "typescript"
  | "javascript"
  | "python"
  | "go"
  | "rust";

export interface LanguageConfig {
  extensions: string[];
  wasmName: string;
  queries: {
    functions: string;
    classes: string;
    interfaces?: string;
  };
  commentPrefix: string;
}

export const LANGUAGE_REGISTRY: Record<SupportedLanguage, LanguageConfig> = {
  typescript: {
    extensions: [".ts", ".tsx"],
    wasmName: "typescript",
    queries: {
      functions: `
        (function_declaration
          name: (identifier) @name) @func
        
        (lexical_declaration
          (variable_declarator
            name: (identifier) @name
            value: (arrow_function))) @func

        (method_definition
          name: (property_identifier) @name) @func
      `,
      classes: "(class_declaration name: (type_identifier) @name) @class",
      interfaces: "(interface_declaration name: (type_identifier) @name) @interface",
    },
    commentPrefix: "//",
  },
  javascript: {
    extensions: [".js", ".jsx", ".mjs"],
    wasmName: "javascript",
    queries: {
      functions: `
        (function_declaration
          name: (identifier) @name) @func
        
        (lexical_declaration
          (variable_declarator
            name: (identifier) @name
            value: (arrow_function))) @func

        (method_definition
          name: (property_identifier) @name) @func
      `,
      classes: "(class_declaration name: (identifier) @name) @class",
    },
    commentPrefix: "//",
  },
  python: {
    extensions: [".py"],
    wasmName: "python",
    queries: {
      functions: "(function_definition name: (identifier) @name) @func",
      classes: "(class_definition name: (identifier) @name) @class",
    },
    commentPrefix: "#",
  },
  go: {
    extensions: [".go"],
    wasmName: "go",
    queries: {
      functions: `
        (function_declaration
          name: (identifier) @name) @func
        (method_declaration
          name: (field_identifier) @name) @func
      `,
      classes: "(type_declaration (type_spec name: (type_identifier) @name type: (struct_type))) @class",
    },
    commentPrefix: "//",
  },
  rust: {
    extensions: [".rs"],
    wasmName: "rust",
    queries: {
      functions: "(function_item name: (identifier) @name) @func",
      classes: `
        (struct_item name: (type_identifier) @name) @class
        (enum_item name: (type_identifier) @name) @class
        (trait_item name: (type_identifier) @name) @class
      `,
    },
    commentPrefix: "//",
  },
};

export function getLanguageFromExtension(
  filepath: string
): SupportedLanguage | null {
  const ext = extname(filepath).toLowerCase();
  for (const [lang, config] of Object.entries(LANGUAGE_REGISTRY)) {
    if (config.extensions.includes(ext)) {
      return lang as SupportedLanguage;
    }
  }
  return null;
}
