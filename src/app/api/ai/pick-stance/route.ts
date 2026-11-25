import { NextRequest, NextResponse } from "next/server";

type Body = {
  topic?: string;
  subtopic?: string;
  countryName?: string;
  pro?: { text?: string; rationale?: string };
  con?: { text?: string; rationale?: string };
};

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    const { topic, subtopic, countryName, pro, con } = body;
    if (!topic?.trim() || !countryName?.trim() || !pro?.text?.trim() || !con?.text?.trim()) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY is not configured" }, { status: 500 });
    }

    const prompt = `You are assisting a Model UN moderator. For delegate "${countryName}" on topic "${topic}"${
      subtopic?.trim() ? ` (focus: ${subtopic.trim()})` : ""
    }, choose which prepared speech better fits this delegation's likely position for publication into the live feed.

Reply with ONLY a JSON object: {"stance":"pro"} or {"stance":"con"} — no markdown.

PRO speech:
${pro.text.slice(0, 8000)}

CON speech:
${con.text.slice(0, 8000)}`;

    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 64 },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("pick-stance Gemini error:", res.status, errText);
      return NextResponse.json({ error: "Model request failed" }, { status: 502 });
    }

    const data = await res.json();
    const raw =
      data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text).join("") ?? "";
    const m = raw.match(/\{\s*"stance"\s*:\s*"([^"]+)"\s*\}/i) || raw.match(/pro|con/i);
    let stance: "pro" | "con" = "pro";
    if (m) {
      const s = (m[1] || m[0]).toLowerCase();
      if (s.includes("con")) stance = "con";
      else if (s.includes("pro")) stance = "pro";
    }

    return NextResponse.json({ stance });
  } catch (e) {
    console.error("pick-stance:", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
