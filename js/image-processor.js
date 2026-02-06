export class ImageProcessor {
  // Convert a File object to a base64 data URL
  static fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  // Get image dimensions from a data URL
  static getImageDimensions(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = dataUrl;
    });
  }

  // Draw red bounding boxes on image for detected keyword regions
  static async drawDetectionBoxes(dataUrl, detections) {
    const img = await this._loadImage(dataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');

    ctx.drawImage(img, 0, 0);

    for (const det of detections) {
      ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
      ctx.lineWidth = 3;
      ctx.strokeRect(det.x, det.y, det.width, det.height);

      ctx.fillStyle = 'rgba(255, 0, 0, 0.15)';
      ctx.fillRect(det.x, det.y, det.width, det.height);

      const label = `${det.keyword} (${Math.round(det.confidence * 100)}%)`;
      ctx.font = '14px Arial, sans-serif';
      const textMetrics = ctx.measureText(label);
      const labelHeight = 20;
      const labelY = det.y > labelHeight ? det.y - labelHeight : det.y + det.height;

      ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
      ctx.fillRect(det.x, labelY, textMetrics.width + 8, labelHeight);

      ctx.fillStyle = 'white';
      ctx.fillText(label, det.x + 4, labelY + 15);
    }

    return canvas.toDataURL('image/png');
  }

  // Apply Gaussian blur to detected regions using Canvas
  static async blurRegions(dataUrl, detections, blurRadius = 10) {
    const img = await this._loadImage(dataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');

    // Draw original image
    ctx.drawImage(img, 0, 0);

    // Blur each detection region
    for (const det of detections) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(det.x, det.y, det.width, det.height);
      ctx.clip();
      ctx.filter = `blur(${blurRadius}px)`;
      ctx.drawImage(img, 0, 0);
      ctx.restore();
    }

    return canvas.toDataURL('image/png');
  }

  // Trigger download of a single image
  static downloadImage(dataUrl, filename) {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Download multiple images as a ZIP file using JSZip
  static async downloadAllAsZip(images) {
    const zip = new JSZip();

    for (const { dataUrl, filename } of images) {
      const base64Data = dataUrl.split(',')[1];
      zip.file(filename, base64Data, { base64: true });
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'masked_images.zip';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  // Validate an image file (type and size)
  static validateFile(file) {
    const validTypes = ['image/png', 'image/jpeg', 'image/webp'];

    if (!validTypes.includes(file.type)) {
      return { valid: false, error: `Unsupported file type: ${file.type}. Use PNG, JPEG, or WebP.` };
    }
    return { valid: true };
  }

  // Internal: load image from data URL
  static _loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = dataUrl;
    });
  }
}
