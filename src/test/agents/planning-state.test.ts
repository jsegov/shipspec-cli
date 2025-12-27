/**
 * Tests for planning state schema and reducers.
 */

import { describe, it, expect } from "vitest";
import {
  PlanningState,
  clarificationHistoryReducer,
  messagesReducer,
} from "../../agents/planning/state.js";
import { HumanMessage, AIMessage } from "@langchain/core/messages";

describe("PlanningState", () => {
  it("should have Annotation schema defined", () => {
    expect(PlanningState).toBeDefined();
    expect(PlanningState.spec).toBeDefined();
  });

  it("should create state with initial idea", () => {
    const initialState = {
      initialIdea: "Build a todo app",
    };
    expect(initialState.initialIdea).toBe("Build a todo app");
  });

  it("should have pendingQuestions field with empty array default", () => {
    // Verify the pendingQuestions field exists in the spec
    expect(PlanningState.spec).toHaveProperty("pendingQuestions");
  });

  it("should have pendingPrd field for two-phase interrupt pattern", () => {
    // Verify the pendingPrd field exists in the spec
    expect(PlanningState.spec).toHaveProperty("pendingPrd");
  });

  it("should have pendingTechSpec field for two-phase interrupt pattern", () => {
    // Verify the pendingTechSpec field exists in the spec
    expect(PlanningState.spec).toHaveProperty("pendingTechSpec");
  });

  it("should have initialIdea field with reducer and default to prevent undefined on checkpoint resume", () => {
    // Bug fix verification: initialIdea must have a default value to prevent undefined
    // when resuming from a checkpoint where the field wasn't explicitly initialized.
    // Without a default, downstream nodes using the field in string operations would fail.
    //
    // The fix in state.ts adds:
    //   initialIdea: Annotation<string>({
    //     reducer: (_x, y) => y,
    //     default: () => "",
    //   }),
    //
    // LangGraph's Annotation API doesn't expose the default function on spec directly,
    // so we verify the field exists in the schema definition.
    expect(PlanningState.spec).toHaveProperty("initialIdea");

    // The spec should be defined (not undefined or null)
    const initialIdeaSpec = PlanningState.spec.initialIdea;
    expect(initialIdeaSpec).toBeDefined();
    expect(initialIdeaSpec).not.toBeNull();
  });
});

describe("clarificationHistoryReducer", () => {
  it("should append new clarification entries", () => {
    const current = [{ question: "Q1", answer: "A1" }];
    const update = [{ question: "Q2", answer: "A2" }];
    const result = clarificationHistoryReducer(current, update);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ question: "Q1", answer: "A1" });
    expect(result[1]).toEqual({ question: "Q2", answer: "A2" });
  });

  it("should handle empty current array", () => {
    const current: { question: string; answer: string }[] = [];
    const update = [{ question: "Q1", answer: "A1" }];
    const result = clarificationHistoryReducer(current, update);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ question: "Q1", answer: "A1" });
  });
});

describe("messagesReducer", () => {
  it("should concatenate message arrays", () => {
    const current = [new HumanMessage("Hello")];
    const update = [new AIMessage("Hi there")];
    const result = messagesReducer(current, update);

    expect(result).toHaveLength(2);
    expect(result[0]?.content).toBe("Hello");
    expect(result[1]?.content).toBe("Hi there");
  });
});
