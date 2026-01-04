import { describe, expect, it } from "bun:test";
import { findSlashCommand, slashCommands } from "../../commands/registry.js";

describe("findSlashCommand", () => {
  describe("basic command matching", () => {
    it("returns null for non-slash input", () => {
      expect(findSlashCommand("connect")).toBeNull();
      expect(findSlashCommand("hello world")).toBeNull();
    });

    it("returns null for empty input after slash", () => {
      expect(findSlashCommand("/")).toBeNull();
      expect(findSlashCommand("/   ")).toBeNull();
    });

    it("finds command by exact name", () => {
      const result = findSlashCommand("/connect");
      expect(result).not.toBeNull();
      if (!result) return;
      expect(result.command.name).toBe("connect");
      expect(result.args).toEqual([]);
    });

    it("finds all registered commands by name", () => {
      const commands = ["connect", "model", "help", "clear", "exit"];
      for (const name of commands) {
        const result = findSlashCommand(`/${name}`);
        expect(result).not.toBeNull();
        if (!result) continue;
        expect(result.command.name).toBe(name);
      }
    });
  });

  describe("alias matching", () => {
    it("finds production-readiness-review by alias /prr", () => {
      const result = findSlashCommand("/prr");
      expect(result).not.toBeNull();
      if (!result) return;
      expect(result.command.name).toBe("production-readiness-review");
      expect(result.args).toEqual([]);
    });

    it("finds exit by alias /quit", () => {
      const result = findSlashCommand("/quit");
      expect(result).not.toBeNull();
      if (!result) return;
      expect(result.command.name).toBe("exit");
      expect(result.args).toEqual([]);
    });
  });

  describe("argument extraction", () => {
    it("extracts single argument after command name", () => {
      const result = findSlashCommand("/model list");
      expect(result).not.toBeNull();
      if (!result) return;
      expect(result.command.name).toBe("model");
      expect(result.args).toEqual(["list"]);
    });

    it("extracts multiple arguments", () => {
      const result = findSlashCommand("/model set gemini-flash");
      expect(result).not.toBeNull();
      if (!result) return;
      expect(result.command.name).toBe("model");
      expect(result.args).toEqual(["set", "gemini-flash"]);
    });

    it("handles multiple spaces between arguments", () => {
      const result = findSlashCommand("/model   set   gemini-flash");
      expect(result).not.toBeNull();
      if (!result) return;
      expect(result.args).toEqual(["set", "gemini-flash"]);
    });

    it("handles trailing whitespace", () => {
      const result = findSlashCommand("/connect   ");
      expect(result).not.toBeNull();
      if (!result) return;
      expect(result.command.name).toBe("connect");
      expect(result.args).toEqual([]);
    });

    it("handles leading whitespace after slash", () => {
      const result = findSlashCommand("/  connect");
      expect(result).not.toBeNull();
      if (!result) return;
      expect(result.command.name).toBe("connect");
    });

    it("extracts context argument for production-readiness-review", () => {
      const result = findSlashCommand("/prr some context here");
      expect(result).not.toBeNull();
      if (!result) return;
      expect(result.command.name).toBe("production-readiness-review");
      expect(result.args).toEqual(["some", "context", "here"]);
    });
  });

  describe("unknown commands", () => {
    it("returns null for unknown command", () => {
      expect(findSlashCommand("/unknown")).toBeNull();
      expect(findSlashCommand("/foo bar")).toBeNull();
    });
  });

  describe("case sensitivity", () => {
    it("is case-insensitive for command names", () => {
      const result = findSlashCommand("/CONNECT");
      expect(result).not.toBeNull();
      if (!result) return;
      expect(result.command.name).toBe("connect");
    });

    it("is case-insensitive for mixed case", () => {
      const result = findSlashCommand("/Model list");
      expect(result).not.toBeNull();
      if (!result) return;
      expect(result.command.name).toBe("model");
    });
  });

  describe("slashCommands array", () => {
    it("contains expected number of commands", () => {
      expect(slashCommands.length).toBeGreaterThanOrEqual(6);
    });

    it("all commands have required properties", () => {
      for (const cmd of slashCommands) {
        expect(cmd.name).toBeDefined();
        expect(typeof cmd.name).toBe("string");
        expect(cmd.description).toBeDefined();
        expect(cmd.usage).toBeDefined();
        expect(typeof cmd.run).toBe("function");
      }
    });
  });
});
