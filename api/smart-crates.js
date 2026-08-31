import { requireAuth } from './lib/auth.js';
import { requireTier } from './lib/tier.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Signed-in callers only. This endpoint sends up to 2MB of text to Claude and
  // asks for 8192 tokens back, so leaving it open meant anyone who found the
  // URL could spend the project's Anthropic budget at will.
  const authUser = await requireAuth(req, res);
  if (!authUser) return;

  // Selector and up. This is the only gate on the spending: hiding the button
  // would leave the endpoint open to anyone holding a token, and one call is
  // up to 2MB in and 8192 tokens out.
  if (!await requireTier('smartCrates', authUser.id, res)) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  // mode 'unfiled': `records` holds only the records that sit in no crate, and
  // `existingCrates` describes the crates already on the shelf. The model files
  // into those first and invents a new crate only where nothing fits. Default
  // 'full' is the original behaviour: sort the whole collection from scratch.
  const { records, existingCrates, mode } = req.body || {};
  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'records array required' });
  }
  const known = (Array.isArray(existingCrates) ? existingCrates : [])
    .filter(c => c && typeof c.name === 'string' && c.name.trim())
    .map(c => ({ name: c.name.trim(), description: typeof c.description === 'string' ? c.description : '' }));
  const incremental = mode === 'unfiled' && known.length > 0;

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

  const crateList = known.map(c => `- "${c.name}"${c.description ? `: ${c.description}` : ''}`).join('\n');

  // Filing pass. The records below are the ones with no crate at all, so the
  // job is placement rather than a re-think of the whole collection.
  const incrementalPrompt = `These records from a vinyl collection are not filed in any crate. The collection already has these crates:

${crateList}

File each record into the crate where it genuinely belongs.

Rules:
- Prefer an existing crate. Reuse its name EXACTLY as written above, character for character.
- Only create a new crate when two or more of these records share something real and none of the existing crates fit. A new crate needs at least 2 records.
- A record may go in more than one crate if it genuinely fits both.
- Leave a record unfiled rather than forcing it somewhere weak. An unfiled record is a fine outcome.
- Do not rename, merge or restructure the existing crates.

New crates, if you make any, follow the same naming rules:`;

  const fullPrompt = `Study this collection and create smart crates grouping records in insightful, collector-meaningful ways.

Use as few crates as needed to meaningfully sort the collection -- 5 to 10 is ideal. Only create more if the collection genuinely spans many distinct worlds. Never pad with weak groupings just to reach a higher number.

Naming rules:`;

  const namingRules = `- Name crates as you would label a physical record crate: by sound, era, geography, scene, or artist lineage
- Good examples: "Detroit Lineage", "Slow Burners", "Bukem Blueprint", "Minimal Moods", "Drexciyan Depths", "Late-Night Sheffield", "Dusty Breaks", "Kode9 Orbit"
- Avoid DJ-deployment framing: no "weapons", "tools", "peak time", "floor fillers", "warm-up", "bangers"
- Avoid generic energy buckets: no "High Energy", "Chill Vibes", "Upbeat", "Mellow"
- Look for real connections: shared producers, regional scenes, eras, sub-genres, sonic texture, mood`;

  // Membership rules differ by mode. "At least 2 records" is right when building
  // crates from nothing, and wrong when filing into a crate that already exists:
  // one new arrival belonging in "Detroit Lineage" should just go there.
  const fullRules = `
- Each crate must have at least 2 records
- A record may appear in multiple crates if genuinely fitting
- Leave records unassigned rather than forcing weak groupings`;

  const userPrompt = `${incremental ? incrementalPrompt : fullPrompt}
${namingRules}${incremental ? '' : fullRules}

Use the integer index from the inventory (the number in brackets) to reference records.

Respond ONLY with valid JSON, listing every crate you are placing records into (existing or new):
{"crates":[{"name":"...","description":"One sentence on what unifies these.","indices":[0,1,5]}]}

${incremental ? 'Unfiled records' : 'Collection'} (format: [index] artist - title | year | label | genres):
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

    // A response cut off at max_tokens leaves the JSON unterminated, and the
    // greedy brace match below then hands JSON.parse something invalid. That
    // surfaced as an unreadable parse error rather than the real problem, which
    // is that the collection is too big for one pass.
    if (data.stop_reason === 'max_tokens') {
      throw new Error('Your collection is too large to sort in one pass. Sorting unfiled records only should work.');
    }

    const textBlock = data.content?.find(b => b.type === 'text');
    if (!textBlock) throw new Error('No text in response');

    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in response');

    const parsed = JSON.parse(jsonMatch[0]);

    // Snap a returned name back onto an existing crate when it differs only in
    // case or surrounding space. Otherwise a near miss quietly creates "detroit
    // lineage" alongside "Detroit Lineage".
    const byLower = new Map(known.map(c => [c.name.toLowerCase(), c.name]));
    const canonical = (name) => byLower.get(String(name || '').trim().toLowerCase()) || name;

    // Map integer indices back to record IDs
    const crates = (parsed.crates || []).map(crate => ({
      name: canonical(crate.name),
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
