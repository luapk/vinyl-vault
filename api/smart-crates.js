export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const { records } = req.body || {};
  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'records array required' });
  }

  const inventory = records.map(r => {
    const genreStr = Array.isArray(r.genres) && r.genres.length ? r.genres.slice(0, 3).join('/') : '';
    const parts = [`${r.artist} - ${r.title}`];
    if (r.year) parts.push(String(r.year));
    if (r.label) parts.push(r.label);
    if (genreStr) parts.push(genreStr);
    return `[${r.id}] ${parts.join(' | ')}`;
  }).join('\n');

  const systemPrompt = `You are a knowledgeable vinyl collector with deep expertise across electronic music, jazz, hip-hop, soul, and underground scenes. You have encyclopaedic knowledge of labels, producers, regional scenes, and the lineage connecting records.`;

  const userPrompt = `Study this collection and create up to 20 smart crates grouping records in insightful, collector-meaningful ways.

Naming rules:
- Name crates as you would label a physical record crate: by sound, era, geography, scene, or artist lineage
- Good examples: "Detroit Lineage", "Slow Burners", "Bukem Blueprint", "Minimal Moods", "Drexciyan Depths", "Late-Night Sheffield", "Dusty Breaks", "Kode9 Orbit"
- Avoid DJ-deployment framing: no "weapons", "tools", "peak time", "floor fillers", "warm-up", "bangers"
- Avoid generic energy buckets: no "High Energy", "Chill Vibes", "Upbeat", "Mellow"
- Look for real connections: shared producers, regional scenes, eras, sub-genres, sonic texture, mood
- Each crate must have at least 2 records
- A record may appear in multiple crates if genuinely fitting
- Leave records unassigned rather than forcing weak groupings

Respond ONLY with valid JSON:
{"crates":[{"name":"...","description":"One sentence on what unifies these.","ids":["id1","id2"]}]}

Collection (format: [id] artist - title | year | label | genres):
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
        max_tokens: 4096,
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

    const result = JSON.parse(jsonMatch[0]);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Smart crates generation failed' });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '2mb' } },
};
