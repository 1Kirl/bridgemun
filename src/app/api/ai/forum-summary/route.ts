import { NextRequest, NextResponse } from "next/server";

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent";

type Line = { speaker?: string; text?: string };

type Body = {
  topic?: string;
  lines?: Line[];
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    const topic = body.topic?.trim() || "the agenda";
    const lines = Array.isArray(body.lines) ? body.lines : [];

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY is not configured" },
        { status: 500 },
      );
    }

    const transcript =
      lines.length > 0
        ? lines
            .map((l) => `[${l.speaker || "Speaker"}]: ${(l.text || "").slice(0, 2000)}`)
            .join("\n\n")
            .slice(0, 24000)
        : "(No discussion messages yet.)";

    const prompt = `Summarize this Model UN Global Discussion Feed on "${topic}" in 2–4 short bullet sentences for delegates before a vote. Capture main positions and tensions. Plain text, no markdown symbols. Always write in English, even if the feed is in another language.

${transcript}`;

    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 512 },
      }),
    });

    if (!res.ok) {
      const t = await res.text();
      console.error("forum-summary Gemini:", res.status, t);
      return NextResponse.json({ error: "Model request failed" }, { status: 502 });
    }

    const data = await res.json();
    const summary =
      data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text).join("")?.trim() ?? "";

    if (!summary) {
      return NextResponse.json({ error: "Empty model output" }, { status: 502 });
    }

    return NextResponse.json({ summary });
  } catch (e) {
    console.error("forum-summary:", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
