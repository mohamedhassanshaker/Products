import { describe, expect, it } from "vitest";
import { detectImageType, MAX_BRAND_ASSET_BYTES, readPngDimensions } from "./brand-asset.js";

/** A minimal, real, valid 1x1 PNG — the exact bytes a browser's `<canvas>.toBlob()`
 *  would produce for a 1x1 transparent pixel, not a hand-typed fixture (this file's
 *  own "prove it against the real byte shape" discipline, matching `tasks/lessons.md`'s
 *  repeated warning against hand-typed fixtures standing in for a real format). */
const ONE_BY_ONE_PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
);

const REAL_WEBP_RIFF_HEADER = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
]);

const REAL_ICO_HEADER = Uint8Array.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x10, 0x10]);

describe("detectImageType", () => {
  it("recognises a real PNG by its full 8-byte signature", () => {
    expect(detectImageType(ONE_BY_ONE_PNG)).toEqual({ mimeType: "image/png", extension: "png" });
  });

  it("recognises a real WEBP by its RIFF/WEBP container markers", () => {
    expect(detectImageType(REAL_WEBP_RIFF_HEADER)).toEqual({
      mimeType: "image/webp",
      extension: "webp",
    });
  });

  it("recognises a real ICO by its reserved/type header", () => {
    expect(detectImageType(REAL_ICO_HEADER)).toEqual({
      mimeType: "image/x-icon",
      extension: "ico",
    });
  });

  it("rejects an SVG document even though the DB CHECK constraint would allow the MIME type — see this module's own XSS reasoning", () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(detectImageType(svg)).toBeNull();
  });

  it("rejects a JPEG (not in CK_BrandAssets_mimeAllowed's vocabulary at all)", () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
    expect(detectImageType(jpeg)).toBeNull();
  });

  it("rejects an .html file wearing a .png extension — content, never a name, decides the type", () => {
    const html = new TextEncoder().encode("<html><body>not an image</body></html>");
    expect(detectImageType(html)).toBeNull();
  });

  it("rejects an empty buffer and a truncated signature without throwing", () => {
    expect(detectImageType(new Uint8Array())).toBeNull();
    expect(detectImageType(Uint8Array.from([0x89, 0x50]))).toBeNull();
  });
});

describe("readPngDimensions", () => {
  it("reads the real IHDR width/height of a genuine 1x1 PNG", () => {
    expect(readPngDimensions(ONE_BY_ONE_PNG)).toEqual({ width: 1, height: 1 });
  });

  it("returns null for a non-PNG buffer", () => {
    expect(readPngDimensions(REAL_WEBP_RIFF_HEADER)).toBeNull();
  });
});

describe("MAX_BRAND_ASSET_BYTES", () => {
  it("mirrors CK_BrandAssets_byteSize's real 1 MiB ceiling verbatim", () => {
    expect(MAX_BRAND_ASSET_BYTES).toBe(1_048_576);
  });
});
