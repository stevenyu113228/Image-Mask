import { DEFAULT_CONFIG, LOCAL_STORAGE_KEY } from './config.js';
import { ApiClient, ApiError } from './api.js';
import { ImageProcessor } from './image-processor.js';
import { PptxProcessor } from './pptx-processor.js';

class ImageMaskApp {
  constructor() {
    this.config = { ...DEFAULT_CONFIG };
    this.images = []; // { id, file, name, dataUrl, width, height, status, detections, annotatedUrl, maskedUrl, error, pptxGroupId, pptxPath, pptxDisplayName }
    this.isProcessing = false;
    this.apiClient = null;
    this.idCounter = 0;
    this.pptxGroups = {}; // groupId → { id, fileName, zip, entryIds[], status }
    this.pptxGroupCounter = 0;
  }

  init() {
    this.loadConfig();
    this.bindEvents();
    this.populateSettingsUI();
  }

  // ── Config ──

  loadConfig() {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) {
        this.config = { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
      }
    } catch {
      this.config = { ...DEFAULT_CONFIG };
    }
    this.apiClient = new ApiClient(this.config);
  }

  saveConfig() {
    this.config.apiBaseUrl = document.getElementById('apiBaseUrl').value.trim() || DEFAULT_CONFIG.apiBaseUrl;
    this.config.apiKey = document.getElementById('apiKey').value.trim();
    this.config.modelA = document.getElementById('modelA').value.trim();
    this.config.keywords = document.getElementById('keywords').value.trim() || DEFAULT_CONFIG.keywords;
    this.config.blockSize = parseInt(document.getElementById('blockSize').value, 10) || DEFAULT_CONFIG.blockSize;
    this.config.maxRetries = parseInt(document.getElementById('maxRetries').value, 10) || DEFAULT_CONFIG.maxRetries;
    this.config.concurrency = Math.max(1, Math.min(20, parseInt(document.getElementById('concurrency').value, 10) || DEFAULT_CONFIG.concurrency));

    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(this.config));
    this.apiClient = new ApiClient(this.config);
    this.showToast('Settings saved', 'success');
  }

  resetConfig() {
    this.config = { ...DEFAULT_CONFIG };
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    this.apiClient = new ApiClient(this.config);
    this.populateSettingsUI();
    this.showToast('Settings reset to defaults', 'info');
  }

  populateSettingsUI() {
    document.getElementById('apiBaseUrl').value = this.config.apiBaseUrl;
    document.getElementById('apiKey').value = this.config.apiKey;
    document.getElementById('modelA').value = this.config.modelA;
    document.getElementById('keywords').value = this.config.keywords;
    document.getElementById('blockSize').value = this.config.blockSize;
    document.getElementById('maxRetries').value = this.config.maxRetries;
    document.getElementById('concurrency').value = this.config.concurrency;
  }

  // ── Events ──

  bindEvents() {
    // Settings sidebar
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');

    const toggleSidebar = () => {
      sidebar.classList.toggle('open');
      overlay.classList.toggle('visible');
    };

    document.getElementById('settingsToggle').addEventListener('click', toggleSidebar);
    document.getElementById('settingsToggle2').addEventListener('click', toggleSidebar);
    overlay.addEventListener('click', toggleSidebar);

    document.getElementById('saveConfigBtn').addEventListener('click', () => this.saveConfig());
    document.getElementById('resetConfigBtn').addEventListener('click', () => this.resetConfig());

    // API key show/hide
    document.getElementById('toggleApiKey').addEventListener('click', () => {
      const input = document.getElementById('apiKey');
      input.type = input.type === 'password' ? 'text' : 'password';
    });

    // File upload
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('drag-over');
    });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      if (e.dataTransfer.files.length) {
        this.handleImageUpload(e.dataTransfer.files);
      }
    });
    fileInput.addEventListener('change', () => {
      if (fileInput.files.length) {
        this.handleImageUpload(fileInput.files);
        fileInput.value = '';
      }
    });

    // Action buttons
    document.getElementById('processBtn').addEventListener('click', () => this.processAllImages());
    document.getElementById('cancelBtn').addEventListener('click', () => this.cancelProcessing());
    document.getElementById('downloadAllBtn').addEventListener('click', () => this.downloadAll());
    document.getElementById('clearAllBtn').addEventListener('click', () => this.clearAll());

    // Lightbox
    const lightbox = document.getElementById('lightbox');
    lightbox.querySelector('.lightbox-close').addEventListener('click', () => {
      lightbox.hidden = true;
    });
    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox) lightbox.hidden = true;
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !lightbox.hidden) lightbox.hidden = true;
    });
  }

  // ── Image Upload ──

  async handleImageUpload(files) {
    for (const file of files) {
      if (PptxProcessor.isPptx(file)) {
        await this.handlePptxUpload(file);
        continue;
      }

      const validation = ImageProcessor.validateFile(file);
      if (!validation.valid) {
        this.showToast(validation.error, 'error');
        continue;
      }

      try {
        const dataUrl = await ImageProcessor.fileToBase64(file);
        const { width, height } = await ImageProcessor.getImageDimensions(dataUrl);

        const entry = {
          id: ++this.idCounter,
          file,
          name: file.name,
          dataUrl,
          width,
          height,
          status: 'pending',
          detections: null,
          annotatedUrl: null,
          maskedUrl: null,
          error: null,
          pptxGroupId: null,
          pptxPath: null,
          pptxDisplayName: null,
        };

        this.images.push(entry);
        this.renderQueueCard(entry);
      } catch (err) {
        this.showToast(`Failed to load ${file.name}: ${err.message}`, 'error');
      }
    }
    this.updateActionButtons();
    this.updateEmptyStates();
  }

  async handlePptxUpload(file) {
    try {
      const { zip, images, skippedCount } = await PptxProcessor.extractImages(file);

      if (images.length === 0) {
        const msg = skippedCount > 0
          ? `${file.name}: No raster images found (${skippedCount} non-raster file(s) skipped)`
          : `${file.name}: No images found in PPTX`;
        this.showToast(msg, 'warning');
        return;
      }

      const groupId = `pptx_${++this.pptxGroupCounter}`;
      const group = {
        id: groupId,
        fileName: file.name,
        zip,
        entryIds: [],
        status: 'pending',
      };
      this.pptxGroups[groupId] = group;

      for (const img of images) {
        const imageName = img.path.split('/').pop();
        const entry = {
          id: ++this.idCounter,
          file: null,
          name: imageName,
          dataUrl: img.dataUrl,
          width: img.width,
          height: img.height,
          status: 'pending',
          detections: null,
          annotatedUrl: null,
          maskedUrl: null,
          error: null,
          pptxGroupId: groupId,
          pptxPath: img.path,
          pptxDisplayName: `${file.name} > ${imageName}`,
        };

        group.entryIds.push(entry.id);
        this.images.push(entry);
        this.renderQueueCard(entry);
      }

      let msg = `${file.name}: Extracted ${images.length} image(s)`;
      if (skippedCount > 0) msg += ` (${skippedCount} non-raster skipped)`;
      this.showToast(msg, 'success');
    } catch (err) {
      this.showToast(`Failed to load ${file.name}: ${err.message}`, 'error');
    }
  }

  // ── Processing Pipeline ──

  async processAllImages() {
    if (this.isProcessing) return;
    if (!this.config.apiKey) {
      this.showToast('Please configure your API key in Settings', 'error');
      return;
    }
    if (!this.config.modelA) {
      this.showToast('Please configure Model A in Settings', 'error');
      return;
    }

    const pending = this.images.filter((img) => img.status === 'pending' || img.status === 'error');
    if (pending.length === 0) {
      this.showToast('No images to process', 'info');
      return;
    }

    this.isProcessing = true;
    this.updateActionButtons();

    const concurrency = this.config.concurrency || 1;
    let index = 0;

    const runNext = async () => {
      while (index < pending.length && this.isProcessing) {
        const entry = pending[index++];
        await this.processImage(entry);
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, pending.length) }, () => runNext());
    await Promise.all(workers);

    this.isProcessing = false;
    this.updateActionButtons();

    // Update PPTX group statuses
    for (const group of Object.values(this.pptxGroups)) {
      const entries = this.images.filter((img) => group.entryIds.includes(img.id));
      const allDone = entries.every((e) => e.status === 'done');
      const anyDone = entries.some((e) => e.status === 'done');
      if (allDone) {
        group.status = 'done';
      } else if (anyDone) {
        group.status = 'partial';
      }
    }

    const doneCount = this.images.filter((img) => img.status === 'done').length;
    if (doneCount > 0) {
      this.showToast(`Processed ${doneCount} image(s)`, 'success');
    }
  }

  async processImage(entry) {
    try {
      // Step 1: Detect keywords
      this.updateEntryStatus(entry, 'detecting');
      const result = await this.apiClient.detectKeywords(
        entry.dataUrl,
        this.config.keywords,
        entry.width,
        entry.height
      );

      entry.detections = result.detections || [];

      if (entry.detections.length === 0) {
        this.showToast(`No keywords found in ${entry.name}`, 'info');
        this.updateEntryStatus(entry, 'done');
        entry.maskedUrl = entry.dataUrl;
        this.renderResultCard(entry);
        return;
      }

      // Step 2: Draw detection boxes overlay
      entry.annotatedUrl = await ImageProcessor.drawDetectionBoxes(
        entry.dataUrl,
        entry.detections
      );
      this.updateQueueCardThumb(entry);

      // Step 3: Blur detected regions on canvas
      this.updateEntryStatus(entry, 'masking');
      entry.maskedUrl = await ImageProcessor.blurRegions(
        entry.dataUrl,
        entry.detections,
        this.config.blockSize
      );

      this.updateEntryStatus(entry, 'done');
      this.renderResultCard(entry);
    } catch (err) {
      entry.error = err.message || 'Unknown error';
      this.updateEntryStatus(entry, 'error');

      if (err instanceof ApiError) {
        this.showToast(`${entry.name}: ${err.message}`, 'error');
      } else {
        this.showToast(`${entry.name}: ${err.message}`, 'error');
      }
    }
  }

  cancelProcessing() {
    this.isProcessing = false;
    this.apiClient.abort();
    this.updateActionButtons();
    this.showToast('Processing cancelled', 'warning');
  }

  // ── Download ──

  async downloadAll() {
    const completed = this.images.filter((img) => img.status === 'done' && img.maskedUrl);

    if (completed.length === 0) {
      this.showToast('No processed images to download', 'info');
      return;
    }

    // Separate standalone images from PPTX-sourced images
    const standalone = completed.filter((img) => !img.pptxGroupId);
    const pptxEntries = completed.filter((img) => img.pptxGroupId);

    // Collect unique PPTX groups that have at least one completed entry
    const pptxGroupIds = [...new Set(pptxEntries.map((e) => e.pptxGroupId))];

    // Build PPTX blobs
    const pptxBlobs = [];
    for (const groupId of pptxGroupIds) {
      const group = this.pptxGroups[groupId];
      if (!group) continue;

      // Build replacements map: only replace images that succeeded
      const replacements = new Map();
      for (const entry of pptxEntries.filter((e) => e.pptxGroupId === groupId)) {
        if (entry.maskedUrl && entry.pptxPath) {
          replacements.set(entry.pptxPath, entry.maskedUrl);
        }
      }

      if (replacements.size > 0) {
        try {
          const blob = await PptxProcessor.reassemble(group.zip, replacements);
          pptxBlobs.push({ blob, fileName: group.fileName });
        } catch (err) {
          this.showToast(`Failed to reassemble ${group.fileName}: ${err.message}`, 'error');
        }
      }
    }

    const hasStandalone = standalone.length > 0;
    const hasPptx = pptxBlobs.length > 0;

    if (!hasStandalone && hasPptx && pptxBlobs.length === 1) {
      // Only one PPTX, no standalone images → download PPTX directly
      PptxProcessor.downloadPptx(pptxBlobs[0].blob, pptxBlobs[0].fileName);
    } else if (hasStandalone && !hasPptx) {
      // Only standalone images → existing behavior
      const items = standalone.map((img) => ({
        dataUrl: img.maskedUrl,
        filename: `masked_${img.name}`,
      }));
      if (items.length === 1) {
        ImageProcessor.downloadImage(items[0].dataUrl, items[0].filename);
      } else {
        ImageProcessor.downloadAllAsZip(items);
      }
    } else {
      // Mixed or multiple PPTXs → bundle everything into a ZIP
      const zip = new JSZip();

      for (const img of standalone) {
        const base64Data = img.maskedUrl.split(',')[1];
        zip.file(`masked_${img.name}`, base64Data, { base64: true });
      }

      for (const { blob, fileName } of pptxBlobs) {
        const baseName = fileName.replace(/\.pptx$/i, '');
        zip.file(`masked_${baseName}.pptx`, blob);
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'masked_results.zip';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }
  }

  clearAll() {
    this.images = [];
    this.idCounter = 0;
    this.pptxGroups = {};
    this.pptxGroupCounter = 0;
    document.getElementById('imageQueue').innerHTML = '';
    document.getElementById('resultsGallery').innerHTML = '';
    this.updateActionButtons();
    this.updateEmptyStates();
  }

  // ── UI Rendering ──

  renderQueueCard(entry) {
    const queue = document.getElementById('imageQueue');

    const card = document.createElement('div');
    card.className = 'queue-card';
    card.dataset.id = entry.id;
    if (entry.pptxGroupId) card.dataset.pptx = '';

    const img = document.createElement('img');
    img.className = 'queue-card-thumb';
    img.src = entry.dataUrl;
    img.alt = entry.pptxDisplayName || entry.name;
    img.addEventListener('click', () => this.openLightbox(entry.annotatedUrl || entry.dataUrl));

    const info = document.createElement('div');
    info.className = 'queue-card-info';

    const name = document.createElement('span');
    name.className = 'queue-card-name';
    name.textContent = entry.pptxDisplayName || entry.name;
    name.title = entry.pptxDisplayName || entry.name;

    const badgeWrap = document.createElement('div');
    badgeWrap.style.display = 'flex';
    badgeWrap.style.gap = '4px';
    badgeWrap.style.flexShrink = '0';

    if (entry.pptxGroupId) {
      const pptxBadge = document.createElement('span');
      pptxBadge.className = 'badge badge-pptx';
      pptxBadge.textContent = 'PPTX';
      badgeWrap.appendChild(pptxBadge);
    }

    const badge = document.createElement('span');
    badge.className = `badge badge-${entry.status} badge-status`;
    badge.textContent = entry.status;
    badgeWrap.appendChild(badge);

    info.appendChild(name);
    info.appendChild(badgeWrap);
    card.appendChild(img);
    card.appendChild(info);
    queue.appendChild(card);
  }

  updateQueueCardThumb(entry) {
    const card = document.querySelector(`.queue-card[data-id="${entry.id}"]`);
    if (!card) return;
    const img = card.querySelector('.queue-card-thumb');
    if (img && entry.annotatedUrl) {
      img.src = entry.annotatedUrl;
    }
  }

  updateEntryStatus(entry, status) {
    entry.status = status;
    const card = document.querySelector(`.queue-card[data-id="${entry.id}"]`);
    if (!card) return;

    const badge = card.querySelector('.badge-status');
    if (badge) {
      badge.className = `badge badge-${status} badge-status`;
      badge.textContent = status;
    }
  }

  renderResultCard(entry) {
    const gallery = document.getElementById('resultsGallery');

    // Remove existing result for this entry if re-processing
    const existing = gallery.querySelector(`.result-card[data-id="${entry.id}"]`);
    if (existing) existing.remove();

    const card = document.createElement('div');
    card.className = 'result-card';
    card.dataset.id = entry.id;
    if (entry.pptxGroupId) card.dataset.pptx = '';

    const images = document.createElement('div');
    images.className = 'result-card-images';

    // Before (annotated or original)
    const beforeCol = document.createElement('div');
    const beforeLabel = document.createElement('div');
    beforeLabel.className = 'result-card-label';
    beforeLabel.textContent = entry.annotatedUrl ? 'Detected' : 'Original';
    const beforeImg = document.createElement('img');
    beforeImg.className = 'result-card-img';
    beforeImg.src = entry.annotatedUrl || entry.dataUrl;
    beforeImg.alt = 'Before';
    beforeImg.addEventListener('click', () => this.openLightbox(beforeImg.src));
    beforeCol.appendChild(beforeImg);
    beforeCol.appendChild(beforeLabel);

    // After (masked)
    const afterCol = document.createElement('div');
    const afterLabel = document.createElement('div');
    afterLabel.className = 'result-card-label';
    afterLabel.textContent = 'Masked';
    const afterImg = document.createElement('img');
    afterImg.className = 'result-card-img';
    afterImg.src = entry.maskedUrl || entry.dataUrl;
    afterImg.alt = 'After';
    afterImg.addEventListener('click', () => this.openLightbox(afterImg.src));
    afterCol.appendChild(afterImg);
    afterCol.appendChild(afterLabel);

    images.appendChild(beforeCol);
    images.appendChild(afterCol);

    const footer = document.createElement('div');
    footer.className = 'result-card-footer';

    const nameWrap = document.createElement('div');
    nameWrap.className = 'result-card-name-wrap';

    if (entry.pptxGroupId) {
      const pptxBadge = document.createElement('span');
      pptxBadge.className = 'badge badge-pptx';
      pptxBadge.textContent = 'PPTX';
      nameWrap.appendChild(pptxBadge);
    }

    const name = document.createElement('span');
    name.className = 'result-card-name';
    name.textContent = entry.pptxDisplayName || entry.name;
    name.title = entry.pptxDisplayName || entry.name;
    nameWrap.appendChild(name);

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'result-card-download';
    downloadBtn.title = 'Download masked PNG';
    downloadBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>PNG</span>`;
    downloadBtn.addEventListener('click', () => {
      if (entry.maskedUrl) {
        ImageProcessor.downloadImage(entry.maskedUrl, `masked_${entry.name}`);
      }
    });

    footer.appendChild(nameWrap);
    footer.appendChild(downloadBtn);

    card.appendChild(images);
    card.appendChild(footer);
    gallery.appendChild(card);

    this.updateActionButtons();
    this.updateEmptyStates();
  }

  updateActionButtons() {
    const hasImages = this.images.length > 0;
    const hasPending = this.images.some((img) => img.status === 'pending' || img.status === 'error');
    const hasDone = this.images.some((img) => img.status === 'done' && img.maskedUrl);

    document.getElementById('processBtn').disabled = this.isProcessing || !hasPending;
    document.getElementById('cancelBtn').disabled = !this.isProcessing;
    document.getElementById('downloadAllBtn').disabled = !hasDone;
    document.getElementById('clearAllBtn').disabled = this.isProcessing || !hasImages;

    // Update download button label based on content type
    const dlBtn = document.getElementById('downloadAllBtn');
    const hasStandalone = this.images.some((img) => !img.pptxGroupId);
    const hasPptx = Object.keys(this.pptxGroups).length > 0;
    const pptxOnly = hasPptx && !hasStandalone;
    const label = pptxOnly ? 'Download PPTX' : 'Download All';
    // Find the last text node (after the SVG icon) and update it
    for (let i = dlBtn.childNodes.length - 1; i >= 0; i--) {
      if (dlBtn.childNodes[i].nodeType === Node.TEXT_NODE && dlBtn.childNodes[i].textContent.trim()) {
        dlBtn.childNodes[i].textContent = ` ${label}`;
        break;
      }
    }
  }

  // ── Empty States & Counters ──

  updateEmptyStates() {
    const queueCount = this.images.length;
    const resultsCount = this.images.filter((img) => img.status === 'done').length;

    const queueEmpty = document.getElementById('queueEmpty');
    const resultsEmpty = document.getElementById('resultsEmpty');
    const queueCountEl = document.getElementById('queueCount');
    const resultsCountEl = document.getElementById('resultsCount');

    if (queueEmpty) queueEmpty.classList.toggle('hidden', queueCount > 0);
    if (resultsEmpty) resultsEmpty.classList.toggle('hidden', resultsCount > 0);

    if (queueCountEl) {
      queueCountEl.textContent = queueCount;
      queueCountEl.classList.toggle('visible', queueCount > 0);
    }
    if (resultsCountEl) {
      resultsCountEl.textContent = resultsCount;
      resultsCountEl.classList.toggle('visible', resultsCount > 0);
    }
  }

  // ── Lightbox ──

  openLightbox(src) {
    const lightbox = document.getElementById('lightbox');
    lightbox.querySelector('.lightbox-img').src = src;
    lightbox.hidden = false;
  }

  // ── Toast Notifications ──

  showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('removing');
      toast.addEventListener('animationend', () => toast.remove());
    }, 4000);
  }
}

// Initialize on DOM ready
const app = new ImageMaskApp();
app.init();
