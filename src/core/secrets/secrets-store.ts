import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";

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
  let suffix: string | undefined;
  if (projectRoot) {
    const normalized = resolve(projectRoot);

    let canonical: string;
    try {
      canonical = realpathSync(normalized);
    } catch {
      canonical = normalized;
    }

    if (canonical.endsWith(sep) && canonical.length > 1) {
      canonical = canonical.slice(0, -1);
    }

    suffix = createHash("sha256").update(canonical).digest("hex").slice(0, 16);
  }
  return new KeytarSecretsStore(suffix);
}
