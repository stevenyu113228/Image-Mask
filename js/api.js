import { PROMPT_TEMPLATES } from './config.js';

export class ApiError extends Error {
  constructor(message, type, statusCode) {
    super(message);
    this.name = 'ApiError';
    this.type = type; // 'cors' | 'auth' | 'rate_limit' | 'parse' | 'network' | 'unknown'
    this.statusCode = statusCode;
  }
}

export class ApiClient {
  constructor(config) {
    this.config = config;
    this._abortController = null;
  }

  async detectKeywords(dataUrl, keywords, width, height) {
    this._abortController = new AbortController();

    const prompt = PROMPT_TEMPLATES.detectKeywords(keywords, width, height);
    const body = {
      model: this.config.modelA,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      temperature: 0.1,
      max_tokens: 4096,
    };

    const data = await this._callApi('/v1/chat/completions', body);
    const rawText = data.choices[0].message.content;

    let parsed;
    try {
      parsed = this._parseJsonResponse(rawText);
    } catch {
      // Retry up to 2 times with a correction prompt
      const messages = [
        ...body.messages,
        { role: 'assistant', content: rawText },
        {
          role: 'user',
          content:
            'Your previous response was not valid JSON. Please return ONLY valid JSON in this exact format, with no other text:\n{ "detections": [{ "keyword": "...", "text": "...", "x": 0, "y": 0, "width": 0, "height": 0, "confidence": 0.0 }] }',
        },
      ];

      for (let retry = 0; retry < 2; retry++) {
        const retryBody = { ...body, messages };
        const retryData = await this._callApi(
          '/v1/chat/completions',
          retryBody
        );
        const retryText = retryData.choices[0].message.content;

        try {
          parsed = this._parseJsonResponse(retryText);
          break;
        } catch {
          if (retry === 1) {
            throw new ApiError(
              'Failed to parse detection response as JSON after retries',
              'parse'
            );
          }
          messages.push(
            { role: 'assistant', content: retryText },
            {
              role: 'user',
              content:
                'Still not valid JSON. Return ONLY a JSON object with a "detections" array. No markdown, no explanation.',
            }
          );
        }
      }
    }

    // Clamp coordinates to image dimensions
    if (parsed && parsed.detections) {
      parsed.detections = parsed.detections.map((d) => ({
        ...d,
        x: Math.max(0, Math.min(d.x, width)),
        y: Math.max(0, Math.min(d.y, height)),
        width: Math.max(0, Math.min(d.width, width - Math.max(0, d.x))),
        height: Math.max(0, Math.min(d.height, height - Math.max(0, d.y))),
      }));
    }

    return parsed;
  }

  async maskImage(dataUrl, detections, keywords, attempt = 0) {
    this._abortController = new AbortController();

    const prompt =
      attempt > 0
        ? PROMPT_TEMPLATES.maskRegionsRetry(detections, keywords, attempt)
        : PROMPT_TEMPLATES.maskRegions(detections, keywords);

    const body = {
      model: this.config.modelB,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      temperature: 1.0,
      modalities: ['image', 'text'],
      image_config: {},
    };

    const data = await this._callApi('/v1/chat/completions', body);

    const imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!imageUrl) {
      throw new ApiError(
        'No image returned in masking response',
        'parse'
      );
    }

    return imageUrl;
  }

  async _callApi(endpoint, body) {
    const url = `${this.config.apiBaseUrl}${endpoint}`;
    const maxRetries = 3;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: this._abortController?.signal,
        });

        if (!response.ok) {
          if (response.status === 401) {
            throw new ApiError(
              'Invalid API key. Please check your configuration.',
              'auth',
              401
            );
          }

          if (response.status === 429) {
            if (attempt < maxRetries) {
              const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
              await new Promise((resolve) => setTimeout(resolve, delay));
              continue;
            }
            throw new ApiError(
              'Rate limit exceeded. Please try again later.',
              'rate_limit',
              429
            );
          }

          let errorMessage;
          try {
            const errorData = await response.json();
            errorMessage =
              errorData.error?.message || `HTTP ${response.status}`;
          } catch {
            errorMessage = `HTTP ${response.status}: ${response.statusText}`;
          }

          throw new ApiError(errorMessage, 'unknown', response.status);
        }

        return await response.json();
      } catch (err) {
        if (err instanceof ApiError) throw err;

        if (err.name === 'AbortError') {
          throw new ApiError('Request was cancelled', 'network');
        }

        if (err instanceof TypeError || err.message?.includes('Failed to fetch')) {
          throw new ApiError(
            'Network error. This may be a CORS issue if using a browser, or the API endpoint may be unreachable.',
            'cors'
          );
        }

        throw new ApiError(
          err.message || 'An unexpected error occurred',
          'network'
        );
      }
    }
  }

  _parseJsonResponse(text) {
    // Strip markdown code fences if present
    let cleaned = text.trim();
    const fenceMatch = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
    if (fenceMatch) {
      cleaned = fenceMatch[1].trim();
    }

    return JSON.parse(cleaned);
  }

  abort() {
    this._abortController?.abort();
  }
}
