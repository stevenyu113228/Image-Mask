export const LOCAL_STORAGE_KEY = 'imageMaskConfig';

export const DEFAULT_CONFIG = {
  apiBaseUrl: 'https://api.openai.com',
  apiKey: '',
  modelA: '',
  modelB: '',
  keywords: 'aaa, bbb',
  blockSize: 10,
  maxRetries: 3,
  concurrency: 5,
};

export const PROMPT_TEMPLATES = {
  detectKeywords(keywords, width, height) {
    return `Find ALL visible occurrences of these keywords in the image (case-insensitive): ${keywords}

Search rules:
- Scan EVERY piece of text in the image: titles, labels, body text, URLs, email addresses, watermarks, footers, small print, and overlays.
- A keyword match includes the keyword appearing as a standalone word OR as a substring within a longer string (e.g., "tomofun" matches inside "www.tomofun.com" or "tomofun2024").
- The bounding box MUST cover ONLY the keyword itself, not the entire surrounding string. For example, in "www.tomofun.com", the box should tightly wrap just "tomofun".
- Check all regions of the image carefully, including corners, edges, and areas with low contrast or small font sizes.
- Report EVERY occurrence. If the same keyword appears 3 times, return 3 separate detections.

Image dimensions: ${width}x${height} pixels.
Coordinate system: origin is top-left corner, x increases to the right, y increases downward. All values in pixels.

Respond with JSON only, no other text:
{
  "detections": [
    {
      "keyword": "the matched keyword",
      "text": "the keyword as it appears in the image",
      "x": <left edge x coordinate>,
      "y": <top edge y coordinate>,
      "width": <bounding box width in pixels>,
      "height": <bounding box height in pixels>,
      "confidence": <0.0 to 1.0>
    }
  ]
}

If no matching keywords are found, return: { "detections": [] }`;
  },

  maskRegions(detections, keywords) {
    const regionList = detections
      .map(
        (d, i) =>
          `  Region ${i + 1}: "${d.text}" at (x=${d.x}, y=${d.y}, width=${d.width}, height=${d.height})`
      )
      .join('\n');

    return `Apply a heavy mosaic/pixelation effect over the following text regions in this image. The keywords being masked are: ${keywords}

Regions to mask:
${regionList}

Requirements:
- The text in each region must be completely unreadable after masking.
- Use strong pixelation or mosaic that fully obscures the text.
- Keep ALL other content in the image completely unchanged.
- Do not crop, resize, or alter anything outside the specified regions.
- Return the modified image.`;
  },

  maskRegionsRetry(detections, keywords, attempt) {
    const regionList = detections
      .map(
        (d, i) =>
          `  Region ${i + 1}: "${d.text}" at (x=${d.x}, y=${d.y}, width=${d.width}, height=${d.height})`
      )
      .join('\n');

    return `IMPORTANT: Previous masking attempt ${attempt} was insufficient. Text is still readable. Apply a MUCH MORE AGGRESSIVE mosaic/pixelation effect over these text regions. The keywords being masked are: ${keywords}

Regions to mask:
${regionList}

Critical requirements:
- Use MAXIMUM strength pixelation or mosaic. The text MUST be completely destroyed and unreadable.
- Extend the masking area slightly beyond each region boundary to ensure full coverage.
- Make the blocked regions completely opaque - no partial transparency.
- Keep ALL other content in the image completely unchanged.
- Do not crop, resize, or alter anything outside the specified regions.
- Return the modified image.`;
  },
};
