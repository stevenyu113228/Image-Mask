# Image Mask Tool

A pure frontend web application that detects and blurs specified keywords in images using AI vision models via OpenAI-compatible Chat Completions API. Supports both standalone images and PPTX files.

## Features

- **AI-Powered Keyword Detection** — Uses a vision model to locate text keywords within images, including keywords embedded in URLs, emails, and longer strings
- **Canvas-Based Blurring** — Applies Gaussian blur to detected regions entirely client-side
- **PPTX Support** — Upload `.pptx` files directly; images are extracted, processed, and reassembled into a downloadable modified PPTX
- **Concurrent Processing** — Process multiple images in parallel (configurable, default 5)
- **Batch Operations** — Upload, process, and download multiple images/PPTXs at once
- **Zero Backend** — Everything runs in the browser. No server required.

## Getting Started

1. Open `index.html` in a browser (or serve it with any static file server)
2. Click the gear icon to open **Settings**
3. Configure:
   - **API Base URL** — Your OpenAI-compatible API endpoint
   - **API Key** — Your API key
   - **Vision Model** — Model name for keyword detection (e.g., `gpt-4o`)
   - **Keywords** — Comma-separated keywords to detect and mask
4. Click **Save**
5. Upload images or PPTX files via drag-and-drop or file picker
6. Click **Process All**
7. Download results individually (PNG) or all at once

## Architecture

```
index.html          — UI shell (sidebar, dropzone, queue, gallery, lightbox)
style.css           — Styling
js/
  config.js         — Default config, localStorage key, prompt templates
  api.js            — ApiClient (detectKeywords, maskImage), ApiError
  image-processor.js — Static utilities (base64, canvas blur, download, zip)
  pptx-processor.js — PPTX extract/reassemble via JSZip
  app.js            — Main orchestrator (state, events, processing pipeline)
```

## API Format

The tool uses the OpenAI Chat Completions API format:

- **Detection (Model A)** — Vision model with `temperature: 0.1`, returns JSON bounding boxes in `message.content`
- **Masking** — Done client-side via HTML5 Canvas blur (no second API call needed)

## PPTX Workflow

1. Upload a `.pptx` file — raster images (`png`, `jpeg`, `jpg`, `gif`, `bmp`) are extracted from `ppt/media/`
2. Non-raster files (EMF, WMF, SVG, TIFF) are skipped (count shown in toast)
3. Each extracted image appears in the queue with a `PPTX` badge and `filename.pptx > imageN.ext` label
4. Processing uses the same detect → blur pipeline as standalone images
5. **Download All** becomes **Download PPTX** — reassembles the PPTX with masked images replacing originals

## Configuration

| Setting | Default | Description |
|---|---|---|
| API Base URL | `https://api.openai.com` | OpenAI-compatible API endpoint |
| API Key | — | API authentication key |
| Vision Model | — | Model for keyword detection |
| Keywords | `aaa, bbb` | Comma-separated keywords to mask |
| Blur Radius | `10` | Gaussian blur strength (px) |
| Max Retries | `3` | API call retry limit |
| Concurrent Processing | `5` | Number of images processed in parallel |

Settings are persisted in `localStorage`.

## Dependencies

- [JSZip 3.10.1](https://stuk.github.io/jszip/) (loaded via CDN) — ZIP handling for PPTX and batch downloads
- [Inter font](https://fonts.google.com/specimen/Inter) (loaded via Google Fonts)

No build step, no npm, no bundler.

## Browser Support

Any modern browser with ES modules, Canvas API, and Fetch API support (Chrome, Firefox, Safari, Edge).

## License

MIT
