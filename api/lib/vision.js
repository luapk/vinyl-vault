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
  "notes": string,
  "rawText": string
}

rawText: Transcribe every character of text visible in the image EXACTLY as printed. Read numbers digit by digit — if you see "012" write "012" not "02" or "002", if you see "PM-012" write "PM-012" not "PM-002". Include everything: release title, individual track names, label name, catalogue number, matrix text, side markings, all other text. Space-separate. This is the primary search input — character accuracy matters more than anything else.

catalogNumber: The alphanumeric release code on the label, e.g. "WAP63", "PM-012", "DOM-001", "R&S AM12 93". Often printed small near the edge or centre hole. Read it character by character — do not skip or round digits. If found, it is the single most reliable search key.

title: The EP or LP name — NOT individual track names. Vinyl labels typically list several track titles (side A tracks, side B tracks). Those are tracks on the record, not the release title. The release title is the main EP/LP heading distinct from the track listing.

artist: The performing artist. On minimal underground labels the imprint name (e.g. "PURPOSE MAKER", "WARP", "R&S") is the record label, not the artist. Mix or remix credits (e.g. "C. Craig's Mind Mix", "DJ Stingray Remix", "remixed by X", "X mix", "X's edit") are NOT the artist — they identify who remixed or mixed the track, not who originally performed it. Only populate artist if a performing artist is clearly and separately labeled. If the only name visible is a mix/remix credit, return "".

label: The record label or imprint name, e.g. "Purpose Maker", "Warp", "Tresor". Different from the artist.

If the outer sleeve has no text, look for the circular paper disc label in the image — it always has text.

Context: electronic music archive. Most records: house, techno, ambient, IDM, electro, drum & bass, dub, breaks, downtempo.

genres: 2-4 genre/style tags.
suggestedBoxes: 2-3 short evocative crate names specific to THIS record. Examples: "Deep House Workouts", "4am Closers", "Detroit Lineage", "Dub Techno Continuum", "Peak-Time Weapons".
notes: one sentence max, notable attributes or caveats.

Return ONLY the JSON object, nothing else.`;

// Shared Claude caller with retry logic for transient 500/529 (overloaded) errors.
// 15s timeout per attempt, 1 retry = worst-case 31s. The previous 25s * 3 = 78s
// budget exceeded the 50s client batch timeout, causing 100% batch failure when
// the Anthropic API was under load.
async function callClaude(body, apiKey, maxRetries = 1) {
  let delay = 1000;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response;
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      // Network/timeout: retry transient failures with backoff, else surface.
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
        continue;
      }
      throw err;
    }

    if (response.ok) return response.json();

    const errText = await response.text();
    const status = response.status;

    // Retry only on transient server-side failures
    if ((status === 529 || status === 500) && attempt < maxRetries) {
      await new Promise(r => setTimeout(r, delay));
      delay *= 2;
      continue;
    }

    // Parse Anthropic error structure for a cleaner message
    let msg = `Anthropic ${status}`;
    try {
      const parsed = JSON.parse(errText);
      msg = parsed?.error?.message || parsed?.error || msg;
    } catch { msg = errText.slice(0, 200) || msg; }
    throw new Error(msg);
  }
}

export async function identifyFromImage(image, mediaType, apiKey) {
  const data = await callClaude({
    model: 'claude-sonnet-4-6',
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
  }, apiKey);

  const textBlock = data.content?.find(b => b.type === 'text');
  if (!textBlock) throw new Error('No text response from Vision');

  let raw = textBlock.text.trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  return JSON.parse(raw);
}

const TEXT_PROMPT = (ocrText) => `The following text was extracted by OCR from a vinyl record label. Use it to identify the release.

OCR text: "${ocrText}"

Return ONLY valid JSON (no markdown fences) in this exact shape:

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
  "notes": string,
  "rawText": string
}

title: The EP or LP name. Track names listed on labels are individual tracks, not the release title.
artist: The performing artist. Label imprint names (e.g. "PURPOSE MAKER", "WARP") are labels, not artists. Mix or remix credits (e.g. "C. Craig's Mind Mix", "remixed by X", "X's edit") are NOT the artist. Return "" if no artist is clearly labeled separately from any mix credit.
label: The record label or imprint.
catalogNumber: The alphanumeric release code, e.g. "PM-012", "WAP63". Read digits exactly as given.
rawText: Copy the OCR text verbatim.

Use your knowledge to identify the release if you recognise it. Context: electronic music archive — house, techno, ambient, IDM, electro, drum & bass, dub, downtempo.
genres: 2-4 tags. suggestedBoxes: 2-3 evocative crate names. notes: one sentence max.

Return ONLY the JSON object.`;

export async function identifyFromText(ocrText, apiKey) {
  const data = await callClaude({
    model: 'claude-sonnet-4-6',
    max_tokens: 1200,
    messages: [{ role: 'user', content: TEXT_PROMPT(ocrText) }],
  }, apiKey);

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
      signal: AbortSignal.timeout(4000),
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
