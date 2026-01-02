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

export const InterruptResponseSchema = z.union([
  z.string(),
  z.record(z.string(), z.union([z.string(), z.array(z.string())])),
]);

export const RpcRequestSchema = z.union([
  z
    .object({
      method: z.literal("ask.start"),
      params: z
        .object({
          question: z.string(),
          history: z.array(ConversationEntrySchema).optional(),
          reindex: z.boolean().optional(),
          cloudOk: z.boolean().optional(),
          localOnly: z.boolean().optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      method: z.literal("ask.cancel"),
    })
    .strict(),
  z
    .object({
      method: z.literal("planning.start"),
      params: z
        .object({
          idea: z.string(),
          trackId: z.string().optional(),
          reindex: z.boolean().optional(),
          noSave: z.boolean().optional(),
          cloudOk: z.boolean().optional(),
          localOnly: z.boolean().optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      method: z.literal("planning.resume"),
      params: z
        .object({
          trackId: z.string(),
          response: InterruptResponseSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      method: z.literal("productionalize.start"),
      params: z
        .object({
          context: z.string().optional(),
          sessionId: z.string().optional(),
          reindex: z.boolean().optional(),
          enableScans: z.boolean().optional(),
          categories: z.string().optional(),
          cloudOk: z.boolean().optional(),
          localOnly: z.boolean().optional(),
          noSave: z.boolean().optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      method: z.literal("productionalize.resume"),
      params: z
        .object({
          sessionId: z.string(),
          response: InterruptResponseSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      method: z.literal("connect"),
      params: z
        .object({
          openrouterKey: z.string(),
          tavilyKey: z.string().optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      method: z.literal("model.list"),
    })
    .strict(),
  z
    .object({
      method: z.literal("model.current"),
    })
    .strict(),
  z
    .object({
      method: z.literal("model.set"),
      params: z
        .object({
          model: z.string(),
        })
        .strict(),
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
export type InterruptResponse = z.infer<typeof InterruptResponseSchema>;
export type RpcRequest = z.infer<typeof RpcRequestSchema>;
export type RpcEvent = z.infer<typeof RpcEventSchema>;
