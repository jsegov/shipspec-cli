import { Command } from "commander";

export const ingestCommand = new Command("ingest")
  .description("Index the codebase into the vector store")
  .action(() => {
    console.log("Ingest command - to be implemented in Phase 5");
  });
