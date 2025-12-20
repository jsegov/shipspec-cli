import { MemorySaver } from "@langchain/langgraph-checkpoint";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";

export type CheckpointerType = "memory" | "sqlite";

export function createCheckpointer(
  type: CheckpointerType,
  dbPath?: string
): BaseCheckpointSaver {
  if (type === "sqlite") {
    if (!dbPath) {
      throw new Error("SQLite checkpointer requires a database path");
    }
    return SqliteSaver.fromConnString(dbPath);
  }
  return new MemorySaver();
}

