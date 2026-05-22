function extractDiscogsReleaseIds(urls) {
  const ids = new Set();
  for (const url of urls) {
    if (!url.includes('discogs.com')) continue;
    const match = url.match(/\/release\/(\d+)/);
    if (match) ids.add(match[1]);
  }
  return [...ids];
}

// Single API call: TEXT_DETECTION + WEB_DETECTION combined.
// Returns { ocrText, releaseIds } so callers can use OCR for interpretation
// and web matches for Discogs ID cross-reference.
export async function analyzeImage(imageBase64, apiKey) {
  const response = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          image: { content: imageBase64 },
          features: [
            { type: 'TEXT_DETECTION', maxResults: 1 },
            { type: 'WEB_DETECTION', maxResults: 10 },
          ],
        }],
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Vision ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  const resp = data.responses?.[0];

  const ocrText = resp?.fullTextAnnotation?.text?.replace(/\n/g, ' ').trim() || null;

  const detection = resp?.webDetection;
  const allUrls = [
    ...(detection?.pagesWithMatchingImages || []).map(p => p.url),
    ...(detection?.fullMatchingImages || []).map(i => i.url),
    ...(detection?.partialMatchingImages || []).map(i => i.url),
  ];
  const releaseIds = extractDiscogsReleaseIds(allUrls);

  return { ocrText, releaseIds };
}

// Kept for any callers that only need web detection
export async function webDetectDiscogs(imageBase64, apiKey) {
  const { releaseIds } = await analyzeImage(imageBase64, apiKey);
  return { releaseIds };
}
