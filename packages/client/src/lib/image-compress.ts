const SUPPORTED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

const MAX_DIMENSION = 2048;
const QUALITY = 0.85;
const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20MB
const MAX_TOTAL_SIZE_BYTES = 50 * 1024 * 1024; // 50MB total across all images

export interface CompressedImage {
  data: string; // base64 (no data: prefix)
  blob: Blob; // raw blob for preview URL (avoids base64 round-trip)
  mimeType: string;
  name: string;
  size: number; // compressed size in bytes
}

export function isSupportedImageType(type: string): boolean {
  return SUPPORTED_TYPES.has(type);
}

/**
 * Compress an image file: resize if too large, convert to JPEG/WebP for size.
 * Returns both base64-encoded data and a Blob for efficient preview.
 */
export async function compressImage(file: File): Promise<CompressedImage> {
  // GIFs: skip canvas compression (loses animation), just base64 encode
  if (file.type === "image/gif") {
    if (file.size > MAX_SIZE_BYTES) {
      throw new Error("Image too large (max 20MB)");
    }
    const base64 = await blobToBase64(file);
    return { data: base64, blob: file, mimeType: "image/gif", name: file.name, size: file.size };
  }

  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;

  let targetW = width;
  let targetH = height;

  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    const scale = MAX_DIMENSION / Math.max(width, height);
    targetW = Math.round(width * scale);
    targetH = Math.round(height * scale);
  }

  const outputType =
    file.type === "image/png" ? "image/png"
    : file.type === "image/webp" ? "image/webp"
    : "image/jpeg";

  let blob: Blob;

  // Use OffscreenCanvas if available, fall back to regular canvas
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(targetW, targetH);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to create canvas context");
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    bitmap.close();
    blob = await canvas.convertToBlob({ type: outputType, quality: QUALITY });
  } else {
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to create canvas context");
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    bitmap.close();
    blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Canvas toBlob failed"))),
        outputType,
        QUALITY,
      );
    });
  }

  if (blob.size > MAX_SIZE_BYTES) {
    throw new Error("Image too large (max 20MB)");
  }

  const base64 = await blobToBase64(blob);

  return { data: base64, blob, mimeType: outputType, name: file.name, size: blob.size };
}

/** Estimate total base64 payload size for a set of compressed images */
export function estimateTotalPayload(images: { size: number }[]): number {
  // base64 inflates by ~33%
  return images.reduce((sum, img) => sum + Math.ceil(img.size * 1.34), 0);
}

export function isTotalPayloadTooLarge(images: { size: number }[]): boolean {
  return estimateTotalPayload(images) > MAX_TOTAL_SIZE_BYTES;
}

/** Convert a Blob to base64 string (without data: URI prefix) using FileReader */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip "data:<mime>;base64," prefix
      const commaIdx = result.indexOf(",");
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error("Failed to read image"));
    reader.readAsDataURL(blob);
  });
}
