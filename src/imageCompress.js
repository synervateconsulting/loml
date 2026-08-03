// Capped image compression. Only oversized photos are touched — anything at or
// under the caps uploads at original quality — so this shrinks the outliers
// most likely to fail on weak signal without degrading normal photos. Any
// failure falls back to the original file, so it can never block an upload.

const MAX_DIM = 3000; // longest side, px
const MAX_BYTES = 4.5 * 1024 * 1024; // ~4.5 MB
const JPEG_QUALITY = 0.85;

export async function maybeCompressImage(file) {
  try {
    if (!file || typeof file.type !== 'string' || !file.type.startsWith('image/')) return file;
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;

    // Decode with EXIF orientation applied so we don't rotate the photo.
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
    if (!bmp) return file;

    const longest = Math.max(bmp.width, bmp.height);
    if (longest <= MAX_DIM && file.size <= MAX_BYTES) {
      bmp.close?.();
      return file; // within caps — leave it exactly as-is
    }

    const scale = Math.min(1, MAX_DIM / longest);
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bmp.close?.();
      return file;
    }
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!blob || blob.size >= file.size) return file; // no real gain — keep original
    const name = (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}
