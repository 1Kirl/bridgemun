import { NextRequest, NextResponse } from "next/server";

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent";

type Body = {
  topic?: string;
  subtopic?: string;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    const topic = body.topic?.trim();
    if (!topic) {
      return NextResponse.json({ error: "topic required" }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY is not configured" },
        { status: 500 },
      );
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
