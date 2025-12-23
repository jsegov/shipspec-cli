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

// Keytar implementation
export class KeytarSecretsStore implements SecretsStore {
  private readonly service = "ship-spec";

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
export function createSecretsStore(): SecretsStore {
  return new KeytarSecretsStore();
}
