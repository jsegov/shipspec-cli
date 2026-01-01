import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProductionalizeStateType } from "../../../../agents/productionalize/state.js";

// Mock the interrupt function
vi.mock("@langchain/langgraph", () => ({
  interrupt: vi.fn(),
}));

// Import after mocking
import { createReportReviewerNode } from "../../../../agents/productionalize/nodes/report-reviewer.js";
import { interrupt } from "@langchain/langgraph";

describe("Report Reviewer Node", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should skip review in non-interactive mode", () => {
    const node = createReportReviewerNode();
    const state = {
      interactiveMode: false,
      finalReport: "# Report",
      reportApproved: false,
    } as unknown as ProductionalizeStateType;

    const result = node(state);

    expect(result).toEqual({ reportApproved: true });
    expect(interrupt).not.toHaveBeenCalled();
  });

  it("should skip review if already approved", () => {
    const node = createReportReviewerNode();
    const state = {
      interactiveMode: true,
      finalReport: "# Report",
      reportApproved: true,
    } as unknown as ProductionalizeStateType;

    const result = node(state);

    expect(result).toEqual({});
    expect(interrupt).not.toHaveBeenCalled();
  });

  it("should approve when user types 'approve'", () => {
    vi.mocked(interrupt).mockReturnValue("approve");

    const node = createReportReviewerNode();
    const state = {
      interactiveMode: true,
      finalReport: "# Report",
      reportApproved: false,
    } as unknown as ProductionalizeStateType;

    const result = node(state);

    expect(result).toEqual({
      reportApproved: true,
      reportFeedback: "",
      reportNeedsReview: false,
    });
  });

  it("should approve when user types 'yes'", () => {
    vi.mocked(interrupt).mockReturnValue("yes");

    const node = createReportReviewerNode();
    const state = {
      interactiveMode: true,
      finalReport: "# Report",
      reportApproved: false,
    } as unknown as ProductionalizeStateType;

    const result = node(state);

    expect(result).toEqual({
      reportApproved: true,
      reportFeedback: "",
      reportNeedsReview: false,
    });
  });

  it("should treat empty input as approval (regression: prevents infinite loop)", () => {
    // Regression test: Empty input used to fall through to feedback handling,
    // setting reportFeedback="" which the aggregator ignored (hasUserFeedback=false),
    // causing an infinite regenerate-review cycle.
    vi.mocked(interrupt).mockReturnValue("");

    const node = createReportReviewerNode();
    const state = {
      interactiveMode: true,
      finalReport: "# Report",
      reportApproved: false,
    } as unknown as ProductionalizeStateType;

    const result = node(state);

    expect(result).toEqual({
      reportApproved: true,
      reportFeedback: "",
      reportNeedsReview: false,
    });
  });

  it("should treat whitespace-only input as approval", () => {
    // Whitespace-only input should also be treated as approval
    vi.mocked(interrupt).mockReturnValue("   \n\t  ");

    const node = createReportReviewerNode();
    const state = {
      interactiveMode: true,
      finalReport: "# Report",
      reportApproved: false,
    } as unknown as ProductionalizeStateType;

    const result = node(state);

    expect(result).toEqual({
      reportApproved: true,
      reportFeedback: "",
      reportNeedsReview: false,
    });
  });

  it("should store feedback when user provides non-empty feedback", () => {
    vi.mocked(interrupt).mockReturnValue("Please add more security details");

    const node = createReportReviewerNode();
    const state = {
      interactiveMode: true,
      finalReport: "# Report",
      reportApproved: false,
    } as unknown as ProductionalizeStateType;

    const result = node(state);

    expect(result).toEqual({
      reportApproved: false,
      reportFeedback: "Please add more security details",
      reportNeedsReview: false,
    });
  });

  it("should throw error if interrupt returns non-string", () => {
    vi.mocked(interrupt).mockReturnValue(123);

    const node = createReportReviewerNode();
    const state = {
      interactiveMode: true,
      finalReport: "# Report",
      reportApproved: false,
    } as unknown as ProductionalizeStateType;

    expect(() => node(state)).toThrow("Invalid interrupt response: expected string feedback");
  });

  it("should approve when no report is available", () => {
    const node = createReportReviewerNode();
    const state = {
      interactiveMode: true,
      finalReport: "",
      reportApproved: false,
    } as unknown as ProductionalizeStateType;

    const result = node(state);

    expect(result).toEqual({ reportApproved: true });
    expect(interrupt).not.toHaveBeenCalled();
  });
});
