const SUPPORTED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

const MAX_DIMENSION = 2048;
const QUALITY = 0.85;
const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20MB

export interface CompressedImage {
  data: string; // base64 (no data: prefix)
  mimeType: string;
  name: string;
}

export function isSupportedImageType(type: string): boolean {
  return SUPPORTED_TYPES.has(type);
}

/**
 * Compress an image file: resize if too large, convert to JPEG/WebP for size.
 * Returns base64-encoded data without the data: URI prefix.
 */
export async function compressImage(file: File): Promise<CompressedImage> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;

  let targetW = width;
  let targetH = height;

  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    const scale = MAX_DIMENSION / Math.max(width, height);
    targetW = Math.round(width * scale);
    targetH = Math.round(height * scale);
  }

  // GIFs: skip canvas compression (loses animation), just base64 encode
  if (file.type === "image/gif") {
    bitmap.close();
    const buf = await file.arrayBuffer();
    const base64 = arrayBufferToBase64(buf);
    if (buf.byteLength > MAX_SIZE_BYTES) {
      throw new Error("Image too large (max 20MB)");
    }
    return { data: base64, mimeType: "image/gif", name: file.name };
  }

  const canvas = new OffscreenCanvas(targetW, targetH);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, targetW, targetH);
  bitmap.close();

  // Try to produce a reasonably-sized output
  const outputType =
    file.type === "image/png" ? "image/png" : "image/jpeg";
  const blob = await canvas.convertToBlob({
    type: outputType,
    quality: QUALITY,
  });

  if (blob.size > MAX_SIZE_BYTES) {
    throw new Error("Image too large (max 20MB)");
  }

  const buf = await blob.arrayBuffer();
  const base64 = arrayBufferToBase64(buf);

  return {
    data: base64,
    mimeType: outputType,
    name: file.name,
  };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
