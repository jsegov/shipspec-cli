import { z } from "zod";

export const ConversationEntrySchema = z
  .object({
    question: z.string(),
    answer: z.string(),
  })
  .strict();

export const InterviewQuestionSchema = z
  .object({
    id: z.string(),
    question: z.string(),
    type: z.enum(["select", "multiselect", "text"]),
    options: z.array(z.string()).optional(),
    required: z.boolean(),
  })
  .strict();

export const InterruptPayloadSchema = z.union([
  z
    .object({
      kind: z.literal("clarification"),
      questions: z.array(z.string()),
    })
    .strict(),
  z
    .object({
      kind: z.literal("document_review"),
      docType: z.enum(["prd", "spec", "report"]),
      content: z.string(),
      instructions: z.string().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("interview"),
      questions: z.array(InterviewQuestionSchema),
    })
    .strict(),
]);

export const RpcEventSchema = z.union([
  z
    .object({
      type: z.literal("status"),
      message: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("progress"),
      stage: z.string(),
      percent: z.number().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("token"),
      content: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("interrupt"),
      payload: InterruptPayloadSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("complete"),
      result: z.unknown(),
    })
    .strict(),
  z
    .object({
      type: z.literal("error"),
      code: z.string(),
      message: z.string(),
    })
    .strict(),
]);

export type ConversationEntry = z.infer<typeof ConversationEntrySchema>;
export type InterviewQuestion = z.infer<typeof InterviewQuestionSchema>;
export type InterruptPayload = z.infer<typeof InterruptPayloadSchema>;
export type RpcEvent = z.infer<typeof RpcEventSchema>;

export type RpcRequest =
  | {
      method: "ask.start";
      params: {
        question: string;
        history?: ConversationEntry[];
        reindex?: boolean;
        cloudOk?: boolean;
        localOnly?: boolean;
      };
    }
  | { method: "ask.cancel" }
  | {
      method: "planning.start";
      params: {
        idea: string;
        trackId?: string;
        reindex?: boolean;
        noSave?: boolean;
        cloudOk?: boolean;
        localOnly?: boolean;
      };
    }
  | { method: "planning.resume"; params: { trackId: string; response: unknown } }
  | {
      method: "productionalize.start";
      params: {
        context?: string;
        sessionId?: string;
        reindex?: boolean;
        enableScans?: boolean;
        categories?: string;
        cloudOk?: boolean;
        localOnly?: boolean;
        noSave?: boolean;
      };
    }
  | { method: "productionalize.resume"; params: { sessionId: string; response: unknown } }
  | { method: "connect"; params: { openrouterKey: string; tavilyKey?: string } }
  | { method: "model.list" }
  | { method: "model.current" }
  | { method: "model.set"; params: { model: string } };
