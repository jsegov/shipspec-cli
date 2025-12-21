import { describe, it } from "vitest";
import { readFile } from "fs/promises";
import { join } from "path";
import { ALL_ENV_VARS } from "../../config/env-vars.js";

describe("Environment Variable Documentation Parity", () => {
  it("should have all env vars documented in .env.example", async () => {
    const envExamplePath = join(process.cwd(), ".env.example");
    const content = await readFile(envExamplePath, "utf-8");

    const missingVars: string[] = [];

    for (const varName of ALL_ENV_VARS) {
      // Check if variable name appears in file (either as VAR= or # VAR=)
      const regex = new RegExp(`^\\s*#?\\s*${varName}\\s*=`, "m");
      if (!regex.test(content)) {
        missingVars.push(varName);
      }
    }

    if (missingVars.length > 0) {
      throw new Error(
        `.env.example is missing the following environment variables:\n` +
          missingVars.map((v) => `  - ${v}`).join("\n") +
          `\n\nPlease add these to .env.example with appropriate comments.`
      );
    }
  });

  it("should have all env vars documented in AGENTS.md", async () => {
    const agentsPath = join(process.cwd(), "AGENTS.md");
    const content = await readFile(agentsPath, "utf-8");

    const missingVars: string[] = [];

    for (const varName of ALL_ENV_VARS) {
      // Check if variable name appears in the Key Environment Variables section
      if (!content.includes(varName)) {
        missingVars.push(varName);
      }
    }

    if (missingVars.length > 0) {
      throw new Error(
        `AGENTS.md is missing documentation for the following environment variables:\n` +
          missingVars.map((v) => `  - ${v}`).join("\n") +
          `\n\nPlease add these to the "Key Environment Variables" section.`
      );
    }
  });

  it("should not have undocumented env vars in .env.example", async () => {
    const envExamplePath = join(process.cwd(), ".env.example");
    const content = await readFile(envExamplePath, "utf-8");

    // Extract all variable names from .env.example (lines like VAR= or # VAR=)
    const varRegex = /^\s*#?\s*([A-Z_][A-Z0-9_]*)\s*=/gm;
    const foundVars = new Set<string>();
    let match;

    while ((match = varRegex.exec(content)) !== null) {
      const varName = match[1];
      if (varName) {
        foundVars.add(varName);
      }
    }

    const undocumentedVars = Array.from(foundVars).filter(
      (v) => !(ALL_ENV_VARS as readonly string[]).includes(v)
    );

    if (undocumentedVars.length > 0) {
      throw new Error(
        `.env.example contains variables not in the canonical list:\n` +
          undocumentedVars.map((v) => `  - ${v}`).join("\n") +
          `\n\nPlease add these to src/config/env-vars.ts or remove from .env.example.`
      );
    }
  });
});
