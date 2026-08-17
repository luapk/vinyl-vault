import { requireAuth } from './lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Signed-in callers only. This endpoint sends up to 2MB of text to Claude and
  // asks for 8192 tokens back, so leaving it open meant anyone who found the
  // URL could spend the project's Anthropic budget at will.
  const authUser = await requireAuth(req, res);
  if (!authUser) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const { records } = req.body || {};
  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'records array required' });
  }

  // Use integer indices instead of UUIDs -- reduces output tokens ~18x
  const inventory = records.map((r, i) => {
    const genreStr = Array.isArray(r.genres) && r.genres.length ? r.genres.slice(0, 3).join('/') : '';
    const parts = [`${r.artist} - ${r.title}`];
    if (r.year) parts.push(String(r.year));
    if (r.label) parts.push(r.label);
    if (genreStr) parts.push(genreStr);
    return `[${i}] ${parts.join(' | ')}`;
  }).join('\n');

  const systemPrompt = `You are a knowledgeable vinyl collector with deep expertise across electronic music, jazz, hip-hop, soul, and underground scenes. You have encyclopaedic knowledge of labels, producers, regional scenes, and the lineage connecting records.`;

  const userPrompt = `Study this collection and create smart crates grouping records in insightful, collector-meaningful ways.

Use as few crates as needed to meaningfully sort the collection -- 5 to 10 is ideal. Only create more if the collection genuinely spans many distinct worlds. Never pad with weak groupings just to reach a higher number.

Naming rules:
- Name crates as you would label a physical record crate: by sound, era, geography, scene, or artist lineage
- Good examples: "Detroit Lineage", "Slow Burners", "Bukem Blueprint", "Minimal Moods", "Drexciyan Depths", "Late-Night Sheffield", "Dusty Breaks", "Kode9 Orbit"
- Avoid DJ-deployment framing: no "weapons", "tools", "peak time", "floor fillers", "warm-up", "bangers"
- Avoid generic energy buckets: no "High Energy", "Chill Vibes", "Upbeat", "Mellow"
- Look for real connections: shared producers, regional scenes, eras, sub-genres, sonic texture, mood
- Each crate must have at least 2 records
- A record may appear in multiple crates if genuinely fitting
- Leave records unassigned rather than forcing weak groupings

Use the integer index from the inventory (the number in brackets) to reference records.

Respond ONLY with valid JSON:
{"crates":[{"name":"...","description":"One sentence on what unifies these.","indices":[0,1,5]}]}

Collection (format: [index] artist - title | year | label | genres):
${inventory}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8192,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      let msg = `Anthropic ${response.status}`;
      try { msg = JSON.parse(errText)?.error?.message || msg; } catch { msg = errText.slice(0, 200) || msg; }
      throw new Error(msg);
    }

    const data = await response.json();
    const textBlock = data.content?.find(b => b.type === 'text');
    if (!textBlock) throw new Error('No text in response');

    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in response');

    const parsed = JSON.parse(jsonMatch[0]);

    // Map integer indices back to record IDs
    const crates = (parsed.crates || []).map(crate => ({
      name: crate.name,
      description: crate.description,
      ids: (crate.indices || [])
        .filter(idx => idx >= 0 && idx < records.length)
        .map(idx => records[idx].id),
    }));

    return res.status(200).json({ crates });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Smart crates generation failed' });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '2mb' } },
};
