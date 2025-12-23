import { createHash } from "node:crypto";

// Interface for abstraction (allows swapping implementations)
export interface SecretsStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<boolean>;
}

interface KeytarModule {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
  default?: KeytarModule;
}

// Keytar implementation with per-project namespacing
export class KeytarSecretsStore implements SecretsStore {
  private readonly service: string;

  constructor(serviceSuffix?: string) {
    this.service = serviceSuffix ? `ship-spec:${serviceSuffix}` : "ship-spec";
  }

  private async getKeytar(): Promise<KeytarModule> {
    const keytar = (await import("keytar")) as unknown as KeytarModule;
    return keytar.default ?? keytar;
  }

  async get(key: string): Promise<string | null> {
    const kt = await this.getKeytar();
    return kt.getPassword(this.service, key);
  }

  async set(key: string, value: string): Promise<void> {
    const kt = await this.getKeytar();
    await kt.setPassword(this.service, key, value);
  }

  async delete(key: string): Promise<boolean> {
    const kt = await this.getKeytar();
    return kt.deletePassword(this.service, key);
  }
}

// Factory function
export function createSecretsStore(projectRoot?: string): SecretsStore {
  // Use project root hash as namespace (stable per-project identifier)
  let suffix: string | undefined;
  if (projectRoot) {
    // Use Node.js built-in crypto for hashing
    suffix = createHash("sha256").update(projectRoot).digest("hex").slice(0, 16);
  }
  return new KeytarSecretsStore(suffix);
}
