import { ImageProcessor } from './image-processor.js';

const RASTER_EXTENSIONS = new Set(['png', 'jpeg', 'jpg', 'gif', 'bmp']);
const MAX_PPTX_SIZE = 100 * 1024 * 1024; // 100 MB

export class PptxProcessor {
  /**
   * Check if a file is a PPTX based on extension or MIME type.
   */
  static isPptx(file) {
    if (file.name.toLowerCase().endsWith('.pptx')) return true;
    if (file.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return true;
    return false;
  }

  /**
   * Extract raster images from a PPTX file.
   * Returns { zip, images: [{ path, dataUrl, width, height }], skippedCount }
   */
  static async extractImages(file) {
    if (file.size > MAX_PPTX_SIZE) {
      throw new Error(`PPTX file too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Maximum is 100MB.`);
    }

    const zip = await JSZip.loadAsync(file);
    const images = [];
    let skippedCount = 0;

    const mediaFiles = [];
    zip.forEach((relativePath, entry) => {
      if (relativePath.startsWith('ppt/media/') && !entry.dir) {
        mediaFiles.push({ path: relativePath, entry });
      }
    });

    for (const { path, entry } of mediaFiles) {
      const ext = path.split('.').pop().toLowerCase();
      if (!RASTER_EXTENSIONS.has(ext)) {
        skippedCount++;
        continue;
      }

      const blob = await entry.async('blob');
      const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
      const dataUrl = await this._blobToDataUrl(blob, mimeType);
      const { width, height } = await ImageProcessor.getImageDimensions(dataUrl);

      images.push({ path, dataUrl, width, height });
    }

    return { zip, images, skippedCount };
  }

  /**
   * Replace image data in the zip and generate a new PPTX blob.
   * replacements: Map<path, dataUrl>
   */
  static async reassemble(zip, replacements) {
    for (const [path, dataUrl] of replacements) {
      const base64Data = dataUrl.split(',')[1];
      // Always write as PNG binary data; PowerPoint reads binary headers not extensions
      zip.file(path, base64Data, { base64: true });
    }

    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
  }

  /**
   * Trigger browser download of a PPTX blob.
   */
  static downloadPptx(blob, originalName) {
    const baseName = originalName.replace(/\.pptx$/i, '');
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `masked_${baseName}.pptx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /**
   * Convert a Blob to a data URL with a specific MIME type.
   */
  static _blobToDataUrl(blob, mimeType) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        // If the blob MIME type doesn't match, rebuild the data URL with the correct type
        const result = reader.result;
        if (mimeType && !result.startsWith(`data:${mimeType}`)) {
          const base64 = result.split(',')[1];
          resolve(`data:${mimeType};base64,${base64}`);
        } else {
          resolve(result);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read blob'));
      reader.readAsDataURL(blob);
    });
  }
}
