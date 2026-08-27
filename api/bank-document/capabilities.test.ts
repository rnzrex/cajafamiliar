import { describe, expect, it, vi } from "vitest";
import handler, { readBankDocumentCapabilities } from "./capabilities.js";

describe("bank document integrated AI capabilities", () => {
  it("reports integrated AI unavailable without a Gemini key", () => {
    expect(readBankDocumentCapabilities({})).toEqual({
      integratedAiAvailable: false,
      provider: "gemini",
      model: "gemini-3.5-flash-lite",
    });
  });

  it("reports availability with a fake key without returning the secret", () => {
    const secret = "fake-gemini-secret-for-test";
    const capabilities = readBankDocumentCapabilities({ GEMINI_API_KEY: secret });
    expect(capabilities.integratedAiAvailable).toBe(true);
    expect(JSON.stringify(capabilities)).not.toContain(secret);
  });

  it("serves only the safe capability shape", () => {
    const json = vi.fn();
    const response = { status: vi.fn().mockReturnThis(), json };
    handler({ method: "GET" }, response);
    expect(response.status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ provider: "gemini", model: "gemini-3.5-flash-lite" }));
    expect(JSON.stringify(json.mock.calls[0]?.[0] ?? {})).not.toMatch(/GEMINI_API_KEY|secret|fake-gemini-secret/i);
  });

  it("rejects non-GET methods", () => {
    const json = vi.fn();
    const response = { status: vi.fn().mockReturnThis(), json };
    handler({ method: "POST" }, response);
    expect(response.status).toHaveBeenCalledWith(405);
    expect(json).toHaveBeenCalledWith({ ok: false, error: "method_not_allowed" });
  });
});
