// Affiliate link builder for a single artist/title lookup.
// Used by the client for on-demand link generation (e.g. record detail panels).
//
// Required env vars (set in Vercel dashboard):
//   AWIN_AFFILIATE_ID  -- your Awin publisher ID (awin.com > Account > Publisher ID)
//   AWIN_RT_MID        -- Rough Trade merchant ID on Awin (find after joining the programme)
//   AWIN_BLEEP_MID     -- Bleep merchant ID on Awin (find after joining the programme)
//
// Without the env vars the endpoint still works -- it returns direct (non-affiliated) search
// links so the UI never breaks while you're setting up accounts.

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const { artist = '', title = '' } = req.query;
  if (!artist && !title) return res.status(400).json({ error: 'artist or title required' });

  res.json({ stores: buildStoreLinks(artist, title) });
}

export function buildStoreLinks(artist, title) {
  const q      = encodeURIComponent([artist, title].filter(Boolean).join(' '));
  const awinId = process.env.AWIN_AFFILIATE_ID;
  const rtMid  = process.env.AWIN_RT_MID;
  const blMid  = process.env.AWIN_BLEEP_MID;

  function awin(mid, target) {
    if (!awinId || !mid) return target;
    return `https://www.awin1.com/cread.php?awinmid=${mid}&awinaffid=${awinId}&ckck=1&p=${encodeURIComponent(target)}`;
  }

  return [
    {
      key:  'roughTrade',
      name: 'Rough Trade',
      url:  awin(rtMid, `https://www.roughtrade.com/gb/search?q=${q}`),
    },
    {
      key:  'bleep',
      name: 'Bleep',
      url:  awin(blMid, `https://bleep.com/search#q=${q}`),
    },
  ];
}
