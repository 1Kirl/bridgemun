import { NextRequest, NextResponse } from "next/server";
import { withErrors } from "@/server/auth";
import { guardLegacyAi } from "@/server/legacyAiGuard";

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent";

type Body = {
  topic?: string;
  subtopic?: string;
};

async function handle(req: NextRequest, apiKey: string) {
  try {
    const body = (await req.json()) as Body;
    const topic = body.topic?.trim();
    if (!topic) {
      return NextResponse.json({ error: "topic required" }, { status: 400 });
    }

    const sub = body.subtopic?.trim();
    const prompt = `Write a single paragraph (120–200 words) Model UN draft resolution operative section on "${topic}"${
      sub ? ` with focus: "${sub}".` : "."
    } Formal UN tone, no markdown, no bullet characters. One paragraph only. Always write in English.`;

    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.35, maxOutputTokens: 1024 },
      }),
    });

    if (!res.ok) {
      const t = await res.text();
      console.error("resolution-draft Gemini:", res.status, t);
      return NextResponse.json({ error: "Model request failed" }, { status: 502 });
    }

    const data = await res.json();
    const text =
      data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text).join("")?.trim() ?? "";

    if (!text) {
      return NextResponse.json({ error: "Empty model output" }, { status: 502 });
    }

    return NextResponse.json({ text });
  } catch (e) {
    console.error("resolution-draft:", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/** Legacy Gemini route (previous developer). Auth + owner + quota guarded; replaced in Phase 5. */
export const POST = withErrors(async (req: NextRequest) => {
  const peek = (await req.clone().json().catch(() => ({}))) as { forumId?: unknown };
  const { apiKey } = await guardLegacyAi(req, peek.forumId);
  return handle(req, apiKey);
});
