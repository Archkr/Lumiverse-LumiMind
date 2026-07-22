import { describe, expect, it } from "vitest";
import { redactDiagnosticCredentials } from "./diagnostics";

describe("developer diagnostic credential redaction", () => {
  it("redacts credential fields without hiding story secrets or diagnostic limits", () => {
    expect(redactDiagnosticCredentials({
      api_key: "key-1",
      openaiApiKey: "key-2",
      authorization: "Bearer key-3",
      nested: { access_token: "key-4", clientSecret: "key-5", password: "key-6" },
      has_api_key: true,
      stateTokenBudget: 8000,
      startingSecrets: ["The door is unlocked"],
    })).toEqual({
      api_key: "[REDACTED]",
      openaiApiKey: "[REDACTED]",
      authorization: "[REDACTED]",
      nested: { access_token: "[REDACTED]", clientSecret: "[REDACTED]", password: "[REDACTED]" },
      has_api_key: true,
      stateTokenBudget: 8000,
      startingSecrets: ["The door is unlocked"],
    });
  });
});
