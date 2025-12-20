import { Embeddings } from "@langchain/core/embeddings";
import { LanceDBManager } from "./vector-store.js";
import { CodeChunk } from "../types/index.js";
import { Table } from "@lancedb/lancedb";

export class DocumentRepository {
  private readonly tableName = "code_chunks";

  constructor(
    private vectorStore: LanceDBManager,
    private embeddings: Embeddings,
    private dimensions: number
  ) {}

  async addDocuments(chunks: CodeChunk[]): Promise<void> {
    if (chunks.length === 0) return;

    const contents = chunks.map((c) => c.content);
    const vectors = await this.embeddings.embedDocuments(contents);

    const table = await this.getTable();
    const records = chunks.map((chunk, i) => ({
      ...chunk,
      vector: vectors[i],
    }));

    await table.add(records);
  }

  async similaritySearch(query: string, k = 10): Promise<CodeChunk[]> {
    const queryVector = await this.embeddings.embedQuery(query);
    const table = await this.getTable();

    const results = await table
      .vectorSearch(queryVector)
      .limit(k)
      .toArray();

    return results.map((record) => this.recordToCodeChunk(record as Record<string, unknown>));
  }

  async hybridSearch(query: string, k = 10): Promise<CodeChunk[]> {
    const table = await this.getTable();
    const queryVector = await this.embeddings.embedQuery(query);

    const results = await table
      .search(queryVector, "hybrid")
      .limit(k)
      .toArray();

    return results.map((record) => this.recordToCodeChunk(record as Record<string, unknown>));
  }

  async deleteByFilepath(filepath: string): Promise<void> {
    const table = await this.getTable();
    const escaped = filepath.replace(/'/g, "''");
    await table.delete(`filepath = '${escaped}'`);
  }

  private async getTable(): Promise<Table> {
    return this.vectorStore.getOrCreateTable(this.tableName, this.dimensions);
  }

  private recordToCodeChunk(record: Record<string, unknown>): CodeChunk {
    const { vector: _vector, _distance, ...chunk } = record;
    return chunk as unknown as CodeChunk;
  }
}
