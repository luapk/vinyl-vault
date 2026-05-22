// Vercel serverless function: proxies Claude Vision calls so the API key never reaches the browser.
// Reads ANTHROPIC_API_KEY from Vercel environment variables.

const PROMPT = `Analyse this photo of a vinyl record sleeve. Return ONLY valid JSON (no markdown fences, no preamble) in this exact shape:

{
  "identified": boolean,
  "confidence": "high" | "medium" | "low",
  "artist": string,
  "title": string,
  "label": string | null,
  "catalogNumber": string | null,
  "year": number | null,
  "country": string | null,
  "format": string | null,
  "genres": [string],
  "tracklist": [
    {
      "position": string,
      "title": string,
      "duration": string,
      "bpm": number,
      "key": string,
      "energy": number
    }
  ],
  "suggestedBoxes": [string],
  "notes": string
}

Context: this is for an electronic music archive and DJ planning tool. Most records will be electronic (house, techno, ambient, IDM, electro, drum & bass, dub, breaks, downtempo).

position uses vinyl side notation: "A1", "A2", "B1", "B2", etc.
duration in "M:SS" format.
bpm: realistic for the genre/era - not generic. Round to whole number.
key: valid Camelot notation only - "1A" through "12A" (minor) or "1B" through "12B" (major).
energy: float 0.0-1.0 reflecting dancefloor energy.
suggestedBoxes: 2-3 short evocative crate names that fit this record. Examples: "Deep House Workouts", "4am Closers", "Detroit Lineage", "Dub Techno Continuum", "Peak-Time Weapons". Be specific to THIS record, not generic.

If you recognise the release: use the real tracklist with researched BPM/key estimates.
If unidentified: set identified=false, best-guess artist/title from any visible text, generate a plausible tracklist from label/era/genre cues.

In production, BPM/key come from Spotify Audio Features. Here, your best informed estimate.

Return ONLY the JSON object, nothing else.`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "Server misconfigured: ANTHROPIC_API_KEY not set in Vercel environment variables.",
    });
  }

  const { image, mediaType } = req.body || {};

  if (!image) {
    return res.status(400).json({ error: "Missing image data" });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType || "image/jpeg",
                  data: image,
                },
              },
              { type: "text", text: PROMPT },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({
        error: `Anthropic API error: ${errText.slice(0, 500)}`,
      });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
}

// Configure Vercel function to allow larger request bodies for image uploads
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "5mb",
    },
  },
};
