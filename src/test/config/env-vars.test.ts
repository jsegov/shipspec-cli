import { describe, it, expect } from "vitest";
import { ENV_VAR_NAMES, ALL_ENV_VARS } from "../../config/env-vars.js";

describe("Environment variable definitions", () => {
  it("should include SHIPSPEC_DEBUG_DIAGNOSTICS_ACK", () => {
    expect(ENV_VAR_NAMES.SHIPSPEC_DEBUG_DIAGNOSTICS_ACK).toBe("SHIPSPEC_DEBUG_DIAGNOSTICS_ACK");
    expect(ALL_ENV_VARS).toContain("SHIPSPEC_DEBUG_DIAGNOSTICS_ACK");
  });
});
