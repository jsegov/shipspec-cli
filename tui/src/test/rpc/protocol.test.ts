import { describe, expect, it } from "bun:test";
import {
  ConversationEntrySchema,
  InterviewQuestionSchema,
  InterruptPayloadSchema,
  RpcEventSchema,
} from "../../rpc/protocol.js";

describe("RpcEventSchema", () => {
  describe("status event", () => {
    it("parses valid status event", () => {
      const event = { type: "status", message: "Initializing..." } as const;
      const result = RpcEventSchema.safeParse(event);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(event);
      }
    });

    it("rejects status without message", () => {
      const event = { type: "status" };
      const result = RpcEventSchema.safeParse(event);
      expect(result.success).toBe(false);
    });

    it("rejects status with extra fields (strict mode)", () => {
      const event = { type: "status", message: "test", extra: "field" };
      const result = RpcEventSchema.safeParse(event);
      expect(result.success).toBe(false);
    });
  });

  describe("progress event", () => {
    it("parses progress with stage only", () => {
      const event = { type: "progress", stage: "indexing" };
      const result = RpcEventSchema.safeParse(event);
      expect(result.success).toBe(true);
    });

    it("parses progress with stage and percent", () => {
      const event = { type: "progress", stage: "indexing", percent: 50 } as const;
      const result = RpcEventSchema.safeParse(event);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(event);
      }
    });

    it("rejects progress without stage", () => {
      const event = { type: "progress", percent: 50 };
      const result = RpcEventSchema.safeParse(event);
      expect(result.success).toBe(false);
    });
  });

  describe("token event", () => {
    it("parses valid token event", () => {
      const event = { type: "token", content: "Hello" };
      const result = RpcEventSchema.safeParse(event);
      expect(result.success).toBe(true);
    });

    it("parses token with empty content", () => {
      const event = { type: "token", content: "" };
      const result = RpcEventSchema.safeParse(event);
      expect(result.success).toBe(true);
    });

    it("rejects token without content", () => {
      const event = { type: "token" };
      const result = RpcEventSchema.safeParse(event);
      expect(result.success).toBe(false);
    });
  });

  describe("interrupt event", () => {
    describe("clarification interrupt", () => {
      it("parses clarification interrupt", () => {
        const event = {
          type: "interrupt",
          payload: {
            kind: "clarification",
            questions: ["What is the target platform?"],
          },
        };
        const result = RpcEventSchema.safeParse(event);
        expect(result.success).toBe(true);
      });

      it("parses clarification with multiple questions", () => {
        const event = {
          type: "interrupt",
          payload: {
            kind: "clarification",
            questions: ["Question 1?", "Question 2?", "Question 3?"],
          },
        };
        const result = RpcEventSchema.safeParse(event);
        expect(result.success).toBe(true);
      });

      it("parses clarification with empty questions array", () => {
        const event = {
          type: "interrupt",
          payload: {
            kind: "clarification",
            questions: [],
          },
        };
        const result = RpcEventSchema.safeParse(event);
        expect(result.success).toBe(true);
      });
    });

    describe("document_review interrupt", () => {
      it("parses document_review interrupt", () => {
        const event = {
          type: "interrupt",
          payload: {
            kind: "document_review",
            docType: "prd",
            content: "# Product Requirements\n\nThis is the content.",
          },
        };
        const result = RpcEventSchema.safeParse(event);
        expect(result.success).toBe(true);
      });

      it("parses document_review with optional instructions", () => {
        const event = {
          type: "interrupt",
          payload: {
            kind: "document_review",
            docType: "spec",
            content: "# Technical Spec",
            instructions: "Please review for completeness",
          },
        };
        const result = RpcEventSchema.safeParse(event);
        expect(result.success).toBe(true);
      });

      it("parses all docType values", () => {
        const docTypes = ["prd", "spec", "report"] as const;
        for (const docType of docTypes) {
          const event = {
            type: "interrupt",
            payload: {
              kind: "document_review",
              docType,
              content: "content",
            },
          };
          const result = RpcEventSchema.safeParse(event);
          expect(result.success).toBe(true);
        }
      });

      it("rejects invalid docType", () => {
        const event = {
          type: "interrupt",
          payload: {
            kind: "document_review",
            docType: "invalid",
            content: "content",
          },
        };
        const result = RpcEventSchema.safeParse(event);
        expect(result.success).toBe(false);
      });
    });

    describe("interview interrupt", () => {
      it("parses interview interrupt with select question", () => {
        const event = {
          type: "interrupt",
          payload: {
            kind: "interview",
            questions: [
              {
                id: "q1",
                question: "What environment?",
                type: "select",
                options: ["production", "staging"],
                required: true,
              },
            ],
          },
        };
        const result = RpcEventSchema.safeParse(event);
        expect(result.success).toBe(true);
      });

      it("parses interview interrupt with multiselect question", () => {
        const event = {
          type: "interrupt",
          payload: {
            kind: "interview",
            questions: [
              {
                id: "q1",
                question: "Select features",
                type: "multiselect",
                options: ["auth", "logging", "caching"],
                required: false,
              },
            ],
          },
        };
        const result = RpcEventSchema.safeParse(event);
        expect(result.success).toBe(true);
      });

      it("parses interview interrupt with text question", () => {
        const event = {
          type: "interrupt",
          payload: {
            kind: "interview",
            questions: [
              {
                id: "q1",
                question: "Describe your use case",
                type: "text",
                required: true,
              },
            ],
          },
        };
        const result = RpcEventSchema.safeParse(event);
        expect(result.success).toBe(true);
      });

      it("parses interview with multiple questions", () => {
        const event = {
          type: "interrupt",
          payload: {
            kind: "interview",
            questions: [
              { id: "q1", question: "Q1", type: "text", required: true },
              {
                id: "q2",
                question: "Q2",
                type: "select",
                options: ["a", "b"],
                required: false,
              },
            ],
          },
        };
        const result = RpcEventSchema.safeParse(event);
        expect(result.success).toBe(true);
      });
    });
  });

  describe("complete event", () => {
    it("parses complete with null result", () => {
      const event = { type: "complete", result: null };
      const result = RpcEventSchema.safeParse(event);
      expect(result.success).toBe(true);
    });

    it("parses complete with object result", () => {
      const event = { type: "complete", result: { data: "value" } };
      const result = RpcEventSchema.safeParse(event);
      expect(result.success).toBe(true);
    });

    it("parses complete with string result", () => {
      const event = { type: "complete", result: "done" };
      const result = RpcEventSchema.safeParse(event);
      expect(result.success).toBe(true);
    });
  });

  describe("error event", () => {
    it("parses error with code and message", () => {
      const event = { type: "error", code: "E001", message: "Something failed" };
      const result = RpcEventSchema.safeParse(event);
      expect(result.success).toBe(true);
    });

    it("rejects error without code", () => {
      const event = { type: "error", message: "Something failed" };
      const result = RpcEventSchema.safeParse(event);
      expect(result.success).toBe(false);
    });

    it("rejects error without message", () => {
      const event = { type: "error", code: "E001" };
      const result = RpcEventSchema.safeParse(event);
      expect(result.success).toBe(false);
    });
  });

  describe("invalid events", () => {
    it("rejects unknown event type", () => {
      const event = { type: "unknown", data: "test" };
      const result = RpcEventSchema.safeParse(event);
      expect(result.success).toBe(false);
    });

    it("rejects event without type", () => {
      const event = { message: "test" };
      const result = RpcEventSchema.safeParse(event);
      expect(result.success).toBe(false);
    });

    it("rejects null", () => {
      const result = RpcEventSchema.safeParse(null);
      expect(result.success).toBe(false);
    });

    it("rejects non-object", () => {
      const result = RpcEventSchema.safeParse("not an object");
      expect(result.success).toBe(false);
    });
  });
});

describe("InterviewQuestionSchema", () => {
  it("validates required fields", () => {
    const question = {
      id: "q1",
      question: "What is your name?",
      type: "text",
      required: true,
    };
    const result = InterviewQuestionSchema.safeParse(question);
    expect(result.success).toBe(true);
  });

  it("accepts optional options array", () => {
    const question = {
      id: "q1",
      question: "Pick one",
      type: "select",
      options: ["a", "b", "c"],
      required: true,
    };
    const result = InterviewQuestionSchema.safeParse(question);
    expect(result.success).toBe(true);
  });

  it("accepts question without options", () => {
    const question = {
      id: "q1",
      question: "Enter text",
      type: "text",
      required: false,
    };
    const result = InterviewQuestionSchema.safeParse(question);
    expect(result.success).toBe(true);
  });

  it("rejects invalid type enum", () => {
    const question = {
      id: "q1",
      question: "Test",
      type: "invalid",
      required: true,
    };
    const result = InterviewQuestionSchema.safeParse(question);
    expect(result.success).toBe(false);
  });

  it("accepts all valid type values", () => {
    const types = ["select", "multiselect", "text"] as const;
    for (const type of types) {
      const question = {
        id: "q1",
        question: "Test",
        type,
        required: true,
      };
      const result = InterviewQuestionSchema.safeParse(question);
      expect(result.success).toBe(true);
    }
  });

  it("rejects missing required fields", () => {
    const partial = { id: "q1", question: "Test" };
    const result = InterviewQuestionSchema.safeParse(partial);
    expect(result.success).toBe(false);
  });
});

describe("InterruptPayloadSchema", () => {
  it("parses clarification payload", () => {
    const payload = { kind: "clarification", questions: ["Q1", "Q2"] };
    const result = InterruptPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("parses document_review payload", () => {
    const payload = { kind: "document_review", docType: "prd", content: "..." };
    const result = InterruptPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("parses interview payload", () => {
    const payload = {
      kind: "interview",
      questions: [{ id: "q1", question: "Q", type: "text", required: true }],
    };
    const result = InterruptPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("rejects unknown kind", () => {
    const payload = { kind: "unknown", data: "test" };
    const result = InterruptPayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });
});

describe("ConversationEntrySchema", () => {
  it("parses valid entry", () => {
    const entry = { question: "What is 2+2?", answer: "4" };
    const result = ConversationEntrySchema.safeParse(entry);
    expect(result.success).toBe(true);
  });

  it("rejects entry with missing question", () => {
    const entry = { answer: "4" };
    const result = ConversationEntrySchema.safeParse(entry);
    expect(result.success).toBe(false);
  });

  it("rejects entry with missing answer", () => {
    const entry = { question: "What is 2+2?" };
    const result = ConversationEntrySchema.safeParse(entry);
    expect(result.success).toBe(false);
  });

  it("rejects entry with extra fields (strict mode)", () => {
    const entry = { question: "Q", answer: "A", extra: "field" };
    const result = ConversationEntrySchema.safeParse(entry);
    expect(result.success).toBe(false);
  });

  it("accepts empty strings", () => {
    const entry = { question: "", answer: "" };
    const result = ConversationEntrySchema.safeParse(entry);
    expect(result.success).toBe(true);
  });
});
