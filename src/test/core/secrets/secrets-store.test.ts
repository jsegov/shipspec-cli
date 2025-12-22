import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSecretsStore } from "../../../core/secrets/secrets-store.js";

// Mock keytar
const mockKeytar = {
  getPassword: vi.fn(),
  setPassword: vi.fn(),
  deletePassword: vi.fn(),
};

vi.mock("keytar", () => ({
  ...mockKeytar,
  default: mockKeytar,
}));

describe("SecretsStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should get a password from keytar", async () => {
    const store = createSecretsStore();
    mockKeytar.getPassword.mockResolvedValue("secret-value");

    const result = await store.get("TEST_KEY");

    expect(result).toBe("secret-value");
    expect(mockKeytar.getPassword).toHaveBeenCalledWith("ship-spec", "TEST_KEY");
  });

  it("should set a password in keytar", async () => {
    const store = createSecretsStore();
    mockKeytar.setPassword.mockResolvedValue(undefined);

    await store.set("TEST_KEY", "new-secret");

    expect(mockKeytar.setPassword).toHaveBeenCalledWith("ship-spec", "TEST_KEY", "new-secret");
  });

  it("should delete a password from keytar", async () => {
    const store = createSecretsStore();
    mockKeytar.deletePassword.mockResolvedValue(true);

    const result = await store.delete("TEST_KEY");

    expect(result).toBe(true);
    expect(mockKeytar.deletePassword).toHaveBeenCalledWith("ship-spec", "TEST_KEY");
  });
});
