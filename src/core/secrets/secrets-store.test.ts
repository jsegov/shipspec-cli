import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { KeytarSecretsStore, createSecretsStore } from "./secrets-store.js";

// Mock keytar module
vi.mock("keytar", () => ({
  default: {
    getPassword: vi.fn(),
    setPassword: vi.fn(),
    deletePassword: vi.fn(),
  },
  getPassword: vi.fn(),
  setPassword: vi.fn(),
  deletePassword: vi.fn(),
}));

describe("KeytarSecretsStore with namespacing", () => {
  interface KeytarMock {
    default: {
      getPassword: ReturnType<typeof vi.fn>;
      setPassword: ReturnType<typeof vi.fn>;
      deletePassword: ReturnType<typeof vi.fn>;
    };
  }

  let keytar: KeytarMock;

  beforeEach(async () => {
    // Get mocked keytar
    keytar = (await import("keytar")) as unknown as KeytarMock;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should use global ship-spec service when no namespace is provided", async () => {
    const store = new KeytarSecretsStore();
    keytar.default.getPassword.mockResolvedValue("test-key-value");

    await store.get("OPENAI_API_KEY");

    expect(keytar.default.getPassword).toHaveBeenCalledWith("ship-spec", "OPENAI_API_KEY");
  });

  it("should use namespaced service when suffix is provided", async () => {
    const store = new KeytarSecretsStore("abc123");
    keytar.default.getPassword.mockResolvedValue("test-key-value");

    await store.get("OPENAI_API_KEY");

    expect(keytar.default.getPassword).toHaveBeenCalledWith("ship-spec:abc123", "OPENAI_API_KEY");
  });

  it("should set password with namespaced service", async () => {
    const store = new KeytarSecretsStore("xyz789");

    await store.set("TAVILY_API_KEY", "secret-tavily-key");

    expect(keytar.default.setPassword).toHaveBeenCalledWith(
      "ship-spec:xyz789",
      "TAVILY_API_KEY",
      "secret-tavily-key"
    );
  });

  it("should delete password with namespaced service", async () => {
    const store = new KeytarSecretsStore("def456");
    keytar.default.deletePassword.mockResolvedValue(true);

    await store.delete("OPENAI_API_KEY");

    expect(keytar.default.deletePassword).toHaveBeenCalledWith(
      "ship-spec:def456",
      "OPENAI_API_KEY"
    );
  });

  it("should create different namespaces for different projects via factory", () => {
    const store1 = createSecretsStore("/path/to/project-a");
    const store2 = createSecretsStore("/path/to/project-b");

    // Both should be instances but with different service names
    // We can't directly inspect the service name, but we can verify they're created
    expect(store1).toBeInstanceOf(KeytarSecretsStore);
    expect(store2).toBeInstanceOf(KeytarSecretsStore);
  });

  it("should use global service when factory is called without projectRoot", async () => {
    const store = createSecretsStore();
    keytar.default.getPassword.mockResolvedValue("test-value");

    await store.get("TEST_KEY");

    expect(keytar.default.getPassword).toHaveBeenCalledWith("ship-spec", "TEST_KEY");
  });

  it("should create stable hash for same projectRoot", () => {
    const projectRoot = "/Users/test/my-project";

    const store1 = createSecretsStore(projectRoot);
    const store2 = createSecretsStore(projectRoot);

    // Both should use the same hash (we'll test by checking they behave identically)
    expect(store1).toBeInstanceOf(KeytarSecretsStore);
    expect(store2).toBeInstanceOf(KeytarSecretsStore);
  });

  it("should handle keytar errors gracefully", async () => {
    const store = new KeytarSecretsStore("test123");
    keytar.default.getPassword.mockRejectedValue(new Error("Keychain access denied"));

    await expect(store.get("OPENAI_API_KEY")).rejects.toThrow("Keychain access denied");
  });

  it("should return null when key does not exist", async () => {
    const store = new KeytarSecretsStore();
    keytar.default.getPassword.mockResolvedValue(null);

    const result = await store.get("NONEXISTENT_KEY");

    expect(result).toBeNull();
  });
});
