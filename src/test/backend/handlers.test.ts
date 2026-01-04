import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// Mock the flow modules before importing handlers
vi.mock("../../flows/planning-flow.js", () => ({
  createPlanningSession: vi.fn(),
}));

vi.mock("../../flows/productionalize-flow.js", () => ({
  createProductionalizeSession: vi.fn(),
}));

vi.mock("../../flows/ask-flow.js", () => ({
  createAskContext: vi.fn(),
  askFlow: vi.fn(),
}));

vi.mock("../../flows/connect-flow.js", () => ({
  connectFlow: vi.fn(),
}));

vi.mock("../../flows/model-flow.js", () => ({
  currentModel: vi.fn(),
  listModels: vi.fn(() => []),
  setModel: vi.fn(),
}));

import { createRpcHandlers } from "../../backend/handlers/index.js";
import { createPlanningSession } from "../../flows/planning-flow.js";
import { createProductionalizeSession } from "../../flows/productionalize-flow.js";
import type { RpcEvent } from "../../backend/protocol.js";

describe("RPC handlers session cleanup on error", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("handlePlanningStart", () => {
    it("should cleanup session from map when start() throws", async () => {
      const mockSession = {
        trackId: "test-track-123",
        start: vi.fn(async function* (): AsyncGenerator<RpcEvent> {
          yield { type: "status", message: "Starting..." };
          await Promise.resolve();
          throw new Error("Simulated planning error");
        }),
        resume: vi.fn(),
      };

      (createPlanningSession as Mock).mockResolvedValue(mockSession);

      const handlers = createRpcHandlers();
      const events: RpcEvent[] = [];

      for await (const event of handlers.handleRequest({
        method: "planning.start",
        params: { idea: "test idea" },
      })) {
        events.push(event);
      }

      // Should yield a status event then an error event
      expect(events).toHaveLength(2);
      expect(events[0]?.type).toBe("status");
      expect(events[1]?.type).toBe("error");

      // Starting a new session should work (proving cleanup happened)
      const mockSession2 = {
        trackId: "test-track-456",
        start: vi.fn(async function* (): AsyncGenerator<RpcEvent> {
          await Promise.resolve();
          yield { type: "complete", result: {} };
        }),
        resume: vi.fn(),
      };

      (createPlanningSession as Mock).mockResolvedValue(mockSession2);

      const events2: RpcEvent[] = [];
      for await (const event of handlers.handleRequest({
        method: "planning.start",
        params: { idea: "test idea 2" },
      })) {
        events2.push(event);
      }

      expect(events2.some((e) => e.type === "complete")).toBe(true);
    });
  });

  describe("handlePlanningResume", () => {
    it("should cleanup session from map when resume() throws", async () => {
      const mockSession = {
        trackId: "test-track-789",
        start: vi.fn(async function* (): AsyncGenerator<RpcEvent> {
          await Promise.resolve();
          yield {
            type: "interrupt",
            payload: { kind: "clarification", questions: ["question?"] },
          };
        }),
        resume: vi.fn(async function* (): AsyncGenerator<RpcEvent> {
          yield { type: "status", message: "Resuming..." };
          await Promise.resolve();
          throw new Error("Simulated resume error");
        }),
      };

      (createPlanningSession as Mock).mockResolvedValue(mockSession);

      const handlers = createRpcHandlers();

      // Start session (will be interrupted)
      const startEvents: RpcEvent[] = [];
      for await (const event of handlers.handleRequest({
        method: "planning.start",
        params: { idea: "test idea" },
      })) {
        startEvents.push(event);
      }

      expect(startEvents.some((e) => e.type === "interrupt")).toBe(true);

      // Resume should throw and cleanup
      const resumeEvents: RpcEvent[] = [];
      for await (const event of handlers.handleRequest({
        method: "planning.resume",
        params: { trackId: "test-track-789", response: "answer" },
      })) {
        resumeEvents.push(event);
      }

      expect(resumeEvents).toHaveLength(2);
      expect(resumeEvents[0]?.type).toBe("status");
      expect(resumeEvents[1]?.type).toBe("error");

      // Session should be cleaned up - trying to resume again should fail with not_found
      const resumeEvents2: RpcEvent[] = [];
      for await (const event of handlers.handleRequest({
        method: "planning.resume",
        params: { trackId: "test-track-789", response: "answer" },
      })) {
        resumeEvents2.push(event);
      }

      expect(resumeEvents2).toHaveLength(1);
      expect(resumeEvents2[0]).toMatchObject({
        type: "error",
        code: "not_found",
      });
    });
  });

  describe("handleProductionalizeStart", () => {
    it("should cleanup session from map when start() throws", async () => {
      const mockSession = {
        sessionId: "test-session-123",
        start: vi.fn(async function* (): AsyncGenerator<RpcEvent> {
          yield { type: "status", message: "Starting..." };
          await Promise.resolve();
          throw new Error("Simulated productionalize error");
        }),
        resume: vi.fn(),
      };

      (createProductionalizeSession as Mock).mockResolvedValue(mockSession);

      const handlers = createRpcHandlers();
      const events: RpcEvent[] = [];

      for await (const event of handlers.handleRequest({
        method: "productionalize.start",
        params: {},
      })) {
        events.push(event);
      }

      // Should yield a status event then an error event
      expect(events).toHaveLength(2);
      expect(events[0]?.type).toBe("status");
      expect(events[1]?.type).toBe("error");

      // Starting a new session should work (proving cleanup happened)
      const mockSession2 = {
        sessionId: "test-session-456",
        start: vi.fn(async function* (): AsyncGenerator<RpcEvent> {
          await Promise.resolve();
          yield { type: "complete", result: {} };
        }),
        resume: vi.fn(),
      };

      (createProductionalizeSession as Mock).mockResolvedValue(mockSession2);

      const events2: RpcEvent[] = [];
      for await (const event of handlers.handleRequest({
        method: "productionalize.start",
        params: {},
      })) {
        events2.push(event);
      }

      expect(events2.some((e) => e.type === "complete")).toBe(true);
    });
  });

  describe("handleProductionalizeResume", () => {
    it("should cleanup session from map when resume() throws", async () => {
      const mockSession = {
        sessionId: "test-session-789",
        start: vi.fn(async function* (): AsyncGenerator<RpcEvent> {
          await Promise.resolve();
          yield {
            type: "interrupt",
            payload: { kind: "document_review", docType: "report", content: "review this" },
          };
        }),
        resume: vi.fn(async function* (): AsyncGenerator<RpcEvent> {
          yield { type: "status", message: "Resuming..." };
          await Promise.resolve();
          throw new Error("Simulated resume error");
        }),
      };

      (createProductionalizeSession as Mock).mockResolvedValue(mockSession);

      const handlers = createRpcHandlers();

      // Start session (will be interrupted)
      const startEvents: RpcEvent[] = [];
      for await (const event of handlers.handleRequest({
        method: "productionalize.start",
        params: {},
      })) {
        startEvents.push(event);
      }

      expect(startEvents.some((e) => e.type === "interrupt")).toBe(true);

      // Resume should throw and cleanup
      const resumeEvents: RpcEvent[] = [];
      for await (const event of handlers.handleRequest({
        method: "productionalize.resume",
        params: { sessionId: "test-session-789", response: "approved" },
      })) {
        resumeEvents.push(event);
      }

      expect(resumeEvents).toHaveLength(2);
      expect(resumeEvents[0]?.type).toBe("status");
      expect(resumeEvents[1]?.type).toBe("error");

      // Session should be cleaned up - trying to resume again should fail with not_found
      const resumeEvents2: RpcEvent[] = [];
      for await (const event of handlers.handleRequest({
        method: "productionalize.resume",
        params: { sessionId: "test-session-789", response: "approved" },
      })) {
        resumeEvents2.push(event);
      }

      expect(resumeEvents2).toHaveLength(1);
      expect(resumeEvents2[0]).toMatchObject({
        type: "error",
        code: "not_found",
      });
    });
  });
});
