import "server-only";

export type LlmMessage = { role: "system" | "user"; content: string };
export type LlmRequest<T> = {
  model: string;
  schemaName: string;
  /** JSON Schema (strict mode: every property required, additionalProperties false). */
  schema: Record<string, unknown>;
  messages: LlmMessage[];
  maxOutputTokens: number;
  /** Server-side validation of the parsed JSON; return null to reject. */
  validate: (x: unknown) => T | null;
};
export type LlmResult<T> =
  | { ok: true; data: T; usage: { input: number; output: number }; model: string }
  | { ok: false; error: string; usage?: { input: number; output: number } };

export interface LlmProvider {
  readonly name: string;
  generate<T>(req: LlmRequest<T>): Promise<LlmResult<T>>;
}

/** OpenAI Responses API with Structured Outputs (json_schema, strict). */
export class OpenAILlm implements LlmProvider {
  readonly name = "openai";
  constructor(
    private apiKey: string,
    private fetchImpl: typeof fetch = fetch,
    private timeoutMs = 45_000,
  ) {}

  async generate<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        signal: ctrl.signal,
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: req.model,
          input: req.messages.map((m) => ({ role: m.role, content: m.content })),
          max_output_tokens: req.maxOutputTokens,
          text: { format: { type: "json_schema", name: req.schemaName, schema: req.schema, strict: true } },
        }),
      });
      const body = (await res.json().catch(() => ({}))) as OpenAIResponse;
      const usage = { input: body.usage?.input_tokens ?? 0, output: body.usage?.output_tokens ?? 0 };
      if (!res.ok) return { ok: false, error: `openai_http_${res.status}:${body.error?.code ?? body.error?.type ?? ""}`, usage };
      const text = extractText(body);
      if (!text) return { ok: false, error: `openai_empty:${body.status ?? ""}`, usage };
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return { ok: false, error: "openai_bad_json", usage };
      }
      const data = req.validate(parsed);
      if (data === null) return { ok: false, error: "validation_failed", usage };
      return { ok: true, data, usage, model: body.model ?? req.model };
    } catch (e) {
      return { ok: false, error: (e as Error).name === "AbortError" ? "openai_timeout" : "openai_network" };
    } finally {
      clearTimeout(timer);
    }
  }
}

type OpenAIResponse = {
  model?: string;
  status?: string;
  output_text?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string; refusal?: string }> }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { code?: string; type?: string };
};

function extractText(b: OpenAIResponse): string | null {
  if (typeof b.output_text === "string" && b.output_text) return b.output_text;
  for (const o of b.output ?? []) {
    for (const c of o.content ?? []) if (c.type === "output_text" && c.text) return c.text;
  }
  return null;
}

/** Deterministic test double: answers from a script function. Marked so it is never mistaken for OpenAI. */
export class ScriptedLlm implements LlmProvider {
  readonly name = "scripted-mock";
  calls: Array<{ schemaName: string; messages: LlmMessage[] }> = [];
  constructor(private script: (schemaName: string, messages: LlmMessage[]) => unknown | Promise<unknown>) {}
  async generate<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    this.calls.push({ schemaName: req.schemaName, messages: req.messages });
    const raw = await this.script(req.schemaName, req.messages);
    if (raw instanceof Error) return { ok: false, error: raw.message };
    const data = req.validate(raw);
    return data === null ? { ok: false, error: "validation_failed" } : { ok: true, data, usage: { input: 100, output: 50 }, model: this.name };
  }
}
