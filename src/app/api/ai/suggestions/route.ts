import { NextRequest, NextResponse } from "next/server";

type FeedEntry = {
  userName?: string;
  text?: string;
  sourceType?: "human" | "ai";
  countryName?: string;
  countryCode?: string;
};

type GenerateSuggestionBody = {
  forumId?: string;
  topic?: string;
  subtopic?: string;
  countryCode?: string;
  countryName?: string;
  /** Full discussion feed in chronological order (oldest first). */
  recentSpeeches?: FeedEntry[];
  roleProfile?: string;
};

const MAX_CHARS_PER_SPEECH = 4000;
const MAX_TOTAL_FEED_CHARS = 88000;

function buildDiscussionTranscript(speeches: FeedEntry[]): {
  transcript: string;
  includedCount: number;
  omittedCount: number;
  truncatedBySize: boolean;
} {
  const nonempty = speeches
    .map((s) => ({
      ...s,
      text: (s.text || "").trim().slice(0, MAX_CHARS_PER_SPEECH),
    }))
    .filter((s) => s.text.length > 0);

  const lines: string[] = [];
  let total = 0;
  let includedCount = 0;
  let truncatedBySize = false;

  for (const s of nonempty) {
    const who =
      [s.countryName, s.userName].filter(Boolean).join(" · ") ||
      s.userName ||
      "Speaker";
    const tag = s.sourceType === "ai" ? "AI delegate" : "Delegate";
    const line = `[${tag}] ${who}: ${s.text}`;
    const addLen = line.length + 2;
    if (total + addLen > MAX_TOTAL_FEED_CHARS) {
      truncatedBySize = true;
      break;
    }
    lines.push(line);
    total += addLen;
    includedCount += 1;
  }

  const omittedCount = nonempty.length - includedCount;
  return {
    transcript:
      lines.length > 0
        ? lines.join("\n\n")
        : "No messages in the Global Discussion Feed yet.",
    includedCount,
    omittedCount,
    truncatedBySize,
  };
}

type Candidate = {
  stance: "pro" | "con";
  text: string;
  rationale: string;
};

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent";

/** Accept several JSON shapes the model may return. */
function pickNestedBlock(raw: unknown): { text: string; rationale: string } | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const t = raw.trim();
    return t ? { text: t, rationale: "" } : null;
  }
  if (typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const text =
    (typeof o.text === "string" && o.text.trim()) ||
    (typeof o.speech === "string" && o.speech.trim()) ||
    (typeof o.statement === "string" && o.statement.trim()) ||
    "";
  const rationale =
    (typeof o.rationale === "string" && o.rationale.trim()) ||
    (typeof o.reason === "string" && o.reason.trim()) ||
    (typeof o.justification === "string" && o.justification.trim()) ||
    "";
  if (!text) return null;
  return { text, rationale: rationale || "" };
}

function extractProConBlocks(parsed: Record<string, unknown>): {
  pro: unknown;
  con: unknown;
} {
  const get = (k: string) =>
    parsed[k] ??
    parsed[k.toUpperCase()] ??
    parsed[k.charAt(0).toUpperCase() + k.slice(1)];

  let pro = get("pro");
  let con = get("con");

  if (pro == null && con == null && Array.isArray(parsed.candidates)) {
    for (const row of parsed.candidates) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const stance = String(r.stance || r.side || "").toLowerCase();
      if (stance === "pro" || stance === "support" || stance === "yes")
        pro = r.text != null ? { text: r.text, rationale: r.rationale } : r;
      if (stance === "con" || stance === "oppose" || stance === "no")
        con = r.text != null ? { text: r.text, rationale: r.rationale } : r;
    }
  }

  return { pro, con };
}

function normalizeCandidate(
  raw: unknown,
  stance: "pro" | "con",
  topic: string,
  countryName: string,
  feedSnippet: string,
): Candidate {
  const picked = pickNestedBlock(raw);
  if (picked && picked.text.length >= 80) {
    return {
      stance,
      text: picked.text,
      rationale: picked.rationale || "Model-provided rationale.",
    };
  }

  const label = stance === "pro" ? "supportive" : "critical or cautious";
  const hint = feedSnippet.slice(0, 280).replace(/\s+/g, " ").trim();
  return {
    stance,
    text:
      picked?.text ||
      `As ${countryName}, we take a ${label} position on aspects of "${topic}" raised in the current debate${
        hint ? ` — including points such as: ${hint}` : ""
      }. We urge the committee to weigh humanitarian and economic spillovers, proportionality under international law, and verified diplomatic channels before further escalation.`,
    rationale:
      picked?.rationale ||
      (picked?.text && picked.text.length < 80
        ? "Short model output expanded with topic/feed-aware fallback."
        : "Fallback: model JSON was missing or too short for this stance."),
  };
}

function buildGenericFallback(
  topic: string,
  countryName: string,
  reason: string,
): Candidate[] {
  return [
    {
      stance: "pro",
      text: `As ${countryName}, we support a collaborative approach on "${topic}" with measurable milestones and shared accountability.`,
      rationale: reason,
    },
    {
      stance: "con",
      text: `As ${countryName}, we urge caution on "${topic}" and request phased implementation to protect national stability and fairness.`,
      rationale: reason,
    },
  ];
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as GenerateSuggestionBody;
    const {
      forumId,
      topic,
      subtopic,
      countryCode,
      countryName,
      recentSpeeches = [],
      roleProfile = "",
    } = body;

    if (!forumId || !topic || !countryCode || !countryName) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY is not configured" },
        { status: 500 },
      );
    }

    const { transcript, includedCount, omittedCount, truncatedBySize } =
      buildDiscussionTranscript(recentSpeeches);

    const lastFeedText = [...recentSpeeches]
      .reverse()
      .map((s) => (s.text || "").trim())
      .find((t) => t.length > 0);
    const feedSnippet = (lastFeedText || "").slice(0, 500);

    let feedNote = "";
    if (includedCount > 0) {
      const bits = [
        `${includedCount} message(s) in chronological order`,
        omittedCount > 0
          ? `${omittedCount} later message(s) skipped (input size limit)`
          : null,
        truncatedBySize && omittedCount === 0
          ? "Feed cut at size limit"
          : null,
      ].filter(Boolean);
      feedNote = `\n(Feed context: ${bits.join("; ")}.)`;
    }

    const focusLine =
      typeof subtopic === "string" && subtopic.trim().length > 0
        ? `Forum subtopic (narrow focus): ${subtopic.trim()}`
        : "";

    const prompt = `
You are generating Model UN delegate statements for a moderator who will pick one to publish into the live feed.

Forum topic: ${topic}
${focusLine}
Delegate country: ${countryName} (${countryCode.toUpperCase()})
Country profile (optional): ${roleProfile || "No custom profile provided."}

Global Discussion Feed (chronological — primary evidence):${feedNote}

${transcript}

Return ONLY a single JSON object (no markdown fences, no commentary) with exactly these keys:
{
  "pro": { "text": "string", "rationale": "string" },
  "con": { "text": "string", "rationale": "string" }
}

Content rules:
- **Always write every "text" and "rationale" in English**, regardless of the language used in the discussion feed. Even if delegates spoke Korean or another language, translate the substance and respond in English only.
- Each "text" must read as a full delegate intervention: **at least 4 sentences**, roughly **130–240 words**.
- **pro.text**: argue for a coherent position that favours concrete multilateral steps implied by the feed (mediation, SC mandates, humanitarian corridors, sanctions calibration, freedom of navigation assurances, fact-finding, etc.) when those ideas are plausible from the debate.
- **con.text**: argue a genuinely **different** line — stress risks, verification gaps, proportionality, escalation control, sovereignty concerns, or phased sequencing — without copying phrasing from pro.text.
- Across **both** speeches, explicitly reflect **at least two distinct** specifics from the feed (e.g. Hormuz, oil prices, civilians, nuclear proliferation framing, third-party mediation).
- **rationale** (each): 1–2 sentences on why ${countryName} would plausibly take that line given alliances, trade, energy, or regional security.
- Tone: formal UN delegate. No markdown, no bullet characters inside JSON strings.
`.trim();

    const responseJsonSchema = {
      type: "object",
      properties: {
        pro: {
          type: "object",
          description:
            "Arguments favouring concrete multilateral or diplomatic steps implied by the debate.",
          properties: {
            text: {
              type: "string",
              description:
                "Full delegate speech in English, multiple sentences, grounded in the feed (130–240 words).",
            },
            rationale: {
              type: "string",
              description: "Why this country would plausibly take this supportive line.",
            },
          },
          required: ["text", "rationale"],
        },
        con: {
          type: "object",
          description:
            "Arguments for restraint, verification, proportionality, or opposing escalatory steps; must differ in substance from pro.",
          properties: {
            text: {
              type: "string",
              description:
                "Full delegate speech, multiple sentences, grounded in the feed; must not paraphrase pro.text.",
            },
            rationale: {
              type: "string",
              description: "Why this country would plausibly take this cautious or opposing line.",
            },
          },
          required: ["text", "rationale"],
        },
      },
      required: ["pro", "con"],
    };

    const geminiRes = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema,
          temperature: 0.65,
          maxOutputTokens: 4096,
        },
        contents: [{ parts: [{ text: prompt }] }],
      }),
    });

    if (!geminiRes.ok) {
      const errorText = await geminiRes.text();
      const isQuota =
        geminiRes.status === 429 ||
        errorText.includes("RESOURCE_EXHAUSTED") ||
        errorText.includes("quota");
      const reason = isQuota
        ? "Fallback generated due to Gemini quota exhaustion."
        : `Fallback generated due to Gemini upstream error (${geminiRes.status}).`;
      return NextResponse.json({
        forumId,
        countryCode,
        countryName,
        candidates: buildGenericFallback(topic, countryName, reason),
        model: "fallback-local",
        warning: errorText.slice(0, 240),
      });
    }

    const geminiData = await geminiRes.json();
    const rawText: string =
      geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";

    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      const start = rawText.indexOf("{");
      const end = rawText.lastIndexOf("}");
      if (start >= 0 && end > start) {
        try {
          parsed = JSON.parse(rawText.slice(start, end + 1)) as Record<string, unknown>;
        } catch {
          parsed = {};
        }
      } else {
        parsed = {};
      }
    }

    const { pro: rawPro, con: rawCon } = extractProConBlocks(parsed);

    const candidates: Candidate[] = [
      normalizeCandidate(rawPro, "pro", topic, countryName, feedSnippet),
      normalizeCandidate(rawCon, "con", topic, countryName, feedSnippet),
    ];

    return NextResponse.json({
      forumId,
      countryCode,
      countryName,
      candidates,
      model: "gemini-3-flash-preview",
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Unexpected error", details: String(error) },
      { status: 500 },
    );
  }
}
