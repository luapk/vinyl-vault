export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const gelatoApiKey = process.env.GELATO_API_KEY;
  if (!gelatoApiKey) {
    return res.status(200).json({ error: 'not_configured', message: 'Gelato API key not configured' });
  }

  // TODO: Implement Gelato Print API order
  // Docs: https://dashboard.gelato.com/docs
  // Product: sleeve label (85 x 54 mm, ~3.35 x 2.13 in)
  return res.status(200).json({ error: 'not_configured', message: 'Gelato integration coming soon' });
}
