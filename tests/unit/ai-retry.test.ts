import { describe, expect, it } from "vitest";
import { isTransient } from "@/server/ai/orchestrator";

describe("transient provider errors (one retry)", () => {
  it("retries overload, 5xx, 429, timeouts and network failures only", () => {
    for (const e of ["openai_http_503:server_is_overloaded", "openai_http_500:", "openai_http_429:rate_limit_exceeded", "openai_timeout", "openai_network"]) expect(isTransient(e)).toBe(true);
    for (const e of ["openai_http_400:invalid_request", "openai_http_401:", "validation_failed", "openai_bad_json", "budget exceeded: llm_calls (forum)"]) expect(isTransient(e)).toBe(false);
  });
});
