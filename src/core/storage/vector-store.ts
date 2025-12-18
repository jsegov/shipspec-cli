import * as lancedb from "@lancedb/lancedb";
import * as arrow from "apache-arrow";
import { logger } from "../../utils/logger.js";
import { Table, Index } from "@lancedb/lancedb";

export class LanceDBManager {
  private db: lancedb.Connection | null = null;
  private readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async connect(): Promise<lancedb.Connection> {
    if (!this.db) {
      this.db = await lancedb.connect(this.dbPath);
    }
    return this.db;
  }

  private createCodeChunkSchema(dimensions: number): arrow.Schema {
    return new arrow.Schema([
      new arrow.Field("id", new arrow.Utf8()),
      new arrow.Field("content", new arrow.Utf8()),
      new arrow.Field("filepath", new arrow.Utf8()),
      new arrow.Field("startLine", new arrow.Int32()),
      new arrow.Field("endLine", new arrow.Int32()),
      new arrow.Field("language", new arrow.Utf8()),
      new arrow.Field("type", new arrow.Utf8()),
      new arrow.Field("symbolName", new arrow.Utf8(), true),
      new arrow.Field(
        "vector",
        new arrow.FixedSizeList(dimensions, new arrow.Field("item", new arrow.Float32()))
      ),
    ]);
  }

  async getOrCreateTable(tableName: string, dimensions: number): Promise<Table> {
    const db = await this.connect();
    const tableNames = await db.tableNames();

    if (tableNames.includes(tableName)) {
      const table = await db.openTable(tableName);
      const schema = await table.schema();
      
      const vectorField = schema.fields.find((f) => f.name === "vector");
      const existingDims = (vectorField?.type as arrow.FixedSizeList)?.listSize;

      if (existingDims !== dimensions) {
        logger.warn(
          `Dimension mismatch for table '${tableName}': recreating with ${dimensions} dims.`
        );
        await db.dropTable(tableName);
        return this.createTable(tableName, dimensions);
      }

      return table;
    }

    return this.createTable(tableName, dimensions);
  }

  private async createTable(tableName: string, dimensions: number): Promise<Table> {
    const db = await this.connect();
    const schema = this.createCodeChunkSchema(dimensions);
    const table = await db.createTable(tableName, [], { schema });
    
    await table.createIndex("content", { config: Index.fts() });
    
    return table;
  }
}
