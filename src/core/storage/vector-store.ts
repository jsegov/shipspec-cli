import * as lancedb from "@lancedb/lancedb";
import * as arrow from "apache-arrow";
import { logger } from "../../utils/logger.js";
import { Table, Index } from "@lancedb/lancedb";

export class LanceDBManager {
  private db: lancedb.Connection | null = null;
  private connectionPromise: Promise<lancedb.Connection> | null = null;
  private readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async connect(): Promise<lancedb.Connection> {
    if (this.db) return this.db;
    if (this.connectionPromise) return this.connectionPromise;

    const connPromise = lancedb.connect(this.dbPath);
    this.connectionPromise = connPromise;

    try {
      this.db = await connPromise;
      return this.db;
    } catch (error) {
      this.connectionPromise = null;
      throw error;
    }
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

  private tablePromises: Map<string, { promise: Promise<Table>; dimensions: number }> = new Map();
  private tableSerializationChains: Map<string, Promise<any>> = new Map();

  getOrCreateTable(tableName: string, dimensions: number): Promise<Table> {
    const cached = this.tablePromises.get(tableName);
    if (cached && cached.dimensions === dimensions) {
      return cached.promise;
    }

    const previousChain = this.tableSerializationChains.get(tableName) || Promise.resolve();

    // Create the promise and store it in caches immediately and synchronously.
    // This prevents any other call in the same or subsequent event loop ticks
    // from initiating a redundant or conflicting operation for the same table.
    let resolveTable: (table: Table) => void;
    let rejectTable: (err: any) => void;
    const tablePromise = new Promise<Table>((res, rej) => {
      resolveTable = res;
      rejectTable = rej;
    });

    this.tablePromises.set(tableName, { promise: tablePromise, dimensions });
    this.tableSerializationChains.set(tableName, tablePromise);

    // Start the async operation chain
    (async () => {
      try {
        // Always wait for the previous operation on this table to finish
        await previousChain.catch(() => {});

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
            const newTable = await this.createTable(tableName, dimensions);
            resolveTable(newTable);
            return;
          }

          resolveTable(table);
          return;
        }

        const createdTable = await this.createTable(tableName, dimensions);
        resolveTable(createdTable);
      } catch (error) {
        // Clean up from the cache on failure to allow future retries.
        // The serialization chain is preserved as it's still needed by pending operations.
        if (this.tablePromises.get(tableName)?.promise === tablePromise) {
          this.tablePromises.delete(tableName);
        }
        rejectTable(error);
      }
    })();

    return tablePromise;
  }

  private async createTable(tableName: string, dimensions: number): Promise<Table> {
    const db = await this.connect();
    const schema = this.createCodeChunkSchema(dimensions);
    const table = await db.createTable(tableName, [], { schema });
    
    await table.createIndex("content", { config: Index.fts() });
    
    return table;
  }
}
