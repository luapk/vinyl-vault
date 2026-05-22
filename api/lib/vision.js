const PROMPT = `Analyse this photo of a vinyl record sleeve or label. Return ONLY valid JSON (no markdown fences, no preamble) in this exact shape:

{
  "identified": boolean,
  "confidence": "high" | "medium" | "low",
  "artist": string,
  "title": string,
  "label": string | null,
  "catalogNumber": string | null,
  "year": number | null,
  "country": string | null,
  "genres": [string],
  "suggestedBoxes": [string],
  "notes": string
}

VINYL LABEL ANATOMY — read this carefully before extracting fields:
The circular paper label in the centre of a vinyl disc has a strict hierarchy:
  - label: the record company / imprint name. Often the most visually prominent text — large, stylised, at the top or centre of the label. Examples: "Warp", "Tresor", "Planet E", "Domina", "R&S", "XL". This is the PUBLISHER, not the artist. Do NOT put this in the artist field.
  - artist: the musician or producer who made the record. Usually smaller text beneath or alongside the title.
  - title: the release or track name.
  - catalogNumber: an alphanumeric code printed on the label, often at the bottom or edge — e.g. "WAP63", "DOM-001", "R&S AM12 93", "TL-001". This is the MOST RELIABLE search key. Extract it even if partially obscured or rotated. It is NOT the same as the label name.

If the photo shows a generic sleeve with no text (art-only outer sleeve), look for the disc label in the image — it always has text.
If you can read any alphanumeric catalogue number, always set catalogNumber even if uncertain of other fields.

Context: electronic music archive. Most records: house, techno, ambient, IDM, electro, drum & bass, dub, breaks, downtempo.

genres: 2-4 genre/style tags.
suggestedBoxes: 2-3 short evocative crate names specific to THIS record. Examples: "Deep House Workouts", "4am Closers", "Detroit Lineage", "Dub Techno Continuum", "Peak-Time Weapons".
notes: one sentence max, notable attributes or caveats.

If you recognise the release, use real metadata. If unidentified, best-guess from any visible text.

Return ONLY the JSON object, nothing else.`;

export async function identifyFromImage(image, mediaType, apiKey) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 600,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: image },
            },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error: ${errText.slice(0, 300)}`);
  }

  const data = await response.json();
  const textBlock = data.content?.find(b => b.type === 'text');
  if (!textBlock) throw new Error('No text response from Vision');

  let raw = textBlock.text.trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  return JSON.parse(raw);
}

export async function generateCrateSuggestions(release, apiKey) {
  const { artist, title, label, year, genres } = release;
  const context = [
    artist && `Artist: ${artist}`,
    title && `Title: ${title}`,
    label && `Label: ${label}`,
    year && `Year: ${year}`,
    genres?.length && `Genres: ${genres.join(', ')}`,
  ].filter(Boolean).join('\n');

  const prompt = `${context}

Give 2-3 short evocative DJ crate names for this specific record. Be precise to this artist/era/sound, not generic. Good examples: "Detroit Lineage", "4am Closers", "Dub Techno Continuum", "Warp Catalogue Essentials", "Peak-Time Weapons".

Return ONLY a JSON array of strings. Example: ["Name One", "Name Two"]`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) return [];
    const data = await response.json();
    const text = data.content?.[0]?.text?.trim() || '[]';
    const raw = text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    return JSON.parse(raw);
  } catch {
    return [];
  }
}
