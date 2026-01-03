import { sanitizeError } from "../../utils/logger.js";
import { CliRuntimeError, CliUsageError } from "../../cli/errors.js";
import type { RpcEvent, RpcRequest } from "../protocol.js";
import { askFlow, createAskContext, type AskContext } from "../../flows/ask-flow.js";
import { createPlanningSession, type PlanningSession } from "../../flows/planning-flow.js";
import {
  createProductionalizeSession,
  type ProductionalizeSession,
} from "../../flows/productionalize-flow.js";
import { connectFlow } from "../../flows/connect-flow.js";
import { currentModel, listModels, setModel } from "../../flows/model-flow.js";

interface AskContextCache {
  context: AskContext;
  reindex: boolean;
  cloudOk: boolean;
  localOnly: boolean;
}

function toErrorEvent(error: unknown, codeOverride?: string): RpcEvent {
  if (codeOverride) {
    return { type: "error", code: codeOverride, message: sanitizeError(error) };
  }

  if (error instanceof CliUsageError) {
    return { type: "error", code: "usage_error", message: sanitizeError(error) };
  }

  if (error instanceof CliRuntimeError) {
    return { type: "error", code: "runtime_error", message: error.toPublicString() };
  }

  return { type: "error", code: "unknown_error", message: sanitizeError(error) };
}

export function createRpcHandlers() {
  const planningSessions = new Map<string, PlanningSession>();
  const productionalizeSessions = new Map<string, ProductionalizeSession>();
  let askAbortController: AbortController | null = null;
  let askContextCache: AskContextCache | null = null;

  const getAskContext = async (reindex: boolean, cloudOk: boolean, localOnly: boolean) => {
    // Cache is only valid if all flags match.
    // A mismatch in cloudOk/localOnly could bypass consent checks or localOnly validation.
    if (
      askContextCache &&
      !reindex &&
      !askContextCache.reindex &&
      askContextCache.cloudOk === cloudOk &&
      askContextCache.localOnly === localOnly
    ) {
      return askContextCache.context;
    }

    const context = await createAskContext({
      reindex,
      cloudOk,
      localOnly,
    });
    askContextCache = { context, reindex, cloudOk, localOnly };
    return context;
  };

  const handleAskStart = async function* (
    params: Extract<RpcRequest, { method: "ask.start" }>["params"]
  ): AsyncGenerator<RpcEvent> {
    if (askAbortController) {
      yield { type: "error", code: "busy", message: "Ask session already running." };
      return;
    }

    askAbortController = new AbortController();

    try {
      const context = await getAskContext(
        params.reindex ?? false,
        params.cloudOk ?? false,
        params.localOnly ?? false
      );
      const stream = askFlow({
        question: params.question,
        history: params.history,
        context,
        abortSignal: askAbortController.signal,
      });
      for await (const event of stream) {
        yield event;
      }
    } catch (err) {
      if (askAbortController.signal.aborted) {
        yield toErrorEvent(err, "canceled");
      } else {
        yield toErrorEvent(err);
      }
    } finally {
      askAbortController = null;
    }
  };

  const handleAskCancel = function* (): Generator<RpcEvent> {
    if (!askAbortController) {
      yield { type: "status", message: "No active ask session." };
      return;
    }
    askAbortController.abort();
    yield { type: "status", message: "Canceled ask session." };
  };

  const handlePlanningStart = async function* (
    params: Extract<RpcRequest, { method: "planning.start" }>["params"]
  ): AsyncGenerator<RpcEvent> {
    try {
      const session = await createPlanningSession({
        idea: params.idea,
        trackId: params.trackId,
        reindex: params.reindex,
        noSave: params.noSave,
        cloudOk: params.cloudOk,
        localOnly: params.localOnly,
      });
      planningSessions.set(session.trackId, session);

      for await (const event of session.start()) {
        if (event.type === "complete") {
          planningSessions.delete(session.trackId);
        }
        yield event;
      }
    } catch (err) {
      yield toErrorEvent(err);
    }
  };

  const handlePlanningResume = async function* (
    params: Extract<RpcRequest, { method: "planning.resume" }>["params"]
  ): AsyncGenerator<RpcEvent> {
    const session = planningSessions.get(params.trackId);
    if (!session) {
      yield {
        type: "error",
        code: "not_found",
        message: `No active planning session for track ${params.trackId}.`,
      };
      return;
    }

    try {
      for await (const event of session.resume(params.response)) {
        if (event.type === "complete") {
          planningSessions.delete(params.trackId);
        }
        yield event;
      }
    } catch (err) {
      yield toErrorEvent(err);
    }
  };

  const handleProductionalizeStart = async function* (
    params: Extract<RpcRequest, { method: "productionalize.start" }>["params"]
  ): AsyncGenerator<RpcEvent> {
    try {
      const session = await createProductionalizeSession({
        context: params.context,
        sessionId: params.sessionId,
        reindex: params.reindex,
        enableScans: params.enableScans,
        categories: params.categories,
        cloudOk: params.cloudOk,
        localOnly: params.localOnly,
        noSave: params.noSave,
      });
      productionalizeSessions.set(session.sessionId, session);

      for await (const event of session.start()) {
        if (event.type === "complete") {
          productionalizeSessions.delete(session.sessionId);
        }
        yield event;
      }
    } catch (err) {
      yield toErrorEvent(err);
    }
  };

  const handleProductionalizeResume = async function* (
    params: Extract<RpcRequest, { method: "productionalize.resume" }>["params"]
  ): AsyncGenerator<RpcEvent> {
    const session = productionalizeSessions.get(params.sessionId);
    if (!session) {
      yield {
        type: "error",
        code: "not_found",
        message: `No active productionalize session for ${params.sessionId}.`,
      };
      return;
    }

    try {
      for await (const event of session.resume(params.response)) {
        if (event.type === "complete") {
          productionalizeSessions.delete(params.sessionId);
        }
        yield event;
      }
    } catch (err) {
      yield toErrorEvent(err);
    }
  };

  const handleConnect = async function* (
    params: Extract<RpcRequest, { method: "connect" }>["params"]
  ): AsyncGenerator<RpcEvent> {
    try {
      const result = await connectFlow({
        openrouterKey: params.openrouterKey,
        tavilyKey: params.tavilyKey,
      });
      yield { type: "complete", result };
    } catch (err) {
      yield toErrorEvent(err);
    }
  };

  const handleModelList = function* (): Generator<RpcEvent> {
    yield { type: "complete", result: listModels() };
  };

  const handleModelCurrent = async function* (): AsyncGenerator<RpcEvent> {
    try {
      const model = await currentModel();
      yield { type: "complete", result: { model } };
    } catch (err) {
      yield toErrorEvent(err);
    }
  };

  const handleModelSet = async function* (
    params: Extract<RpcRequest, { method: "model.set" }>["params"]
  ): AsyncGenerator<RpcEvent> {
    try {
      const model = await setModel(params.model);
      yield { type: "complete", result: { model } };
    } catch (err) {
      yield toErrorEvent(err);
    }
  };

  return {
    async *handleRequest(request: RpcRequest): AsyncGenerator<RpcEvent> {
      switch (request.method) {
        case "ask.start":
          yield* handleAskStart(request.params);
          return;
        case "ask.cancel":
          yield* handleAskCancel();
          return;
        case "planning.start":
          yield* handlePlanningStart(request.params);
          return;
        case "planning.resume":
          yield* handlePlanningResume(request.params);
          return;
        case "productionalize.start":
          yield* handleProductionalizeStart(request.params);
          return;
        case "productionalize.resume":
          yield* handleProductionalizeResume(request.params);
          return;
        case "connect":
          yield* handleConnect(request.params);
          return;
        case "model.list":
          yield* handleModelList();
          return;
        case "model.current":
          yield* handleModelCurrent();
          return;
        case "model.set":
          yield* handleModelSet(request.params);
          return;
        default: {
          const _exhaustive: never = request;
          yield {
            type: "error",
            code: "method_not_found",
            message: "Unknown method.",
          };
          return;
        }
      }
    },
  };
}
