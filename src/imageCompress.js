// Client-side image prep before upload:
//   1. HEIC/HEIF (iPhone default) is ALWAYS converted to JPEG — it's Apple-only,
//      so this makes photos viewable everywhere. (Runs on iOS Safari, where the
//      photo originates and the canvas can decode HEIC.)
//   2. Otherwise, capped compression: only oversized photos are downscaled;
//      anything within the caps uploads untouched.
// Any failure falls back to the original file, so it can never block an upload.

const MAX_DIM = 3000; // longest side, px
const MAX_BYTES = 4.5 * 1024 * 1024; // ~4.5 MB
const JPEG_QUALITY = 0.85;

export async function maybeCompressImage(file) {
  try {
    if (!file || typeof file.type !== 'string' || !file.type.startsWith('image/')) return file;
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;

    const isHeic = /image\/(heic|heif)/i.test(file.type) || /\.(heic|heif)$/i.test(file.name || '');

    // Decode with EXIF orientation applied so we don't rotate the photo.
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
    if (!bmp) return file;

    const longest = Math.max(bmp.width, bmp.height);
    // HEIC must always be re-encoded (compatibility); others only if oversized.
    if (!isHeic && longest <= MAX_DIM && file.size <= MAX_BYTES) {
      bmp.close?.();
      return file;
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
    if (!blob) return file;
    // For non-HEIC, keep the original if the JPEG isn't actually smaller. For
    // HEIC we always take the JPEG even if larger — compatibility is the point.
    if (!isHeic && blob.size >= file.size) return file;
    const name = (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}
