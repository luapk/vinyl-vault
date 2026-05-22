import { identifyFromImage } from './lib/vision.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const { image, mediaType } = req.body || {};
  if (!image) return res.status(400).json({ error: 'Missing image data' });

  try {
    const result = await identifyFromImage(image, mediaType, apiKey);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '5mb' } },
};
