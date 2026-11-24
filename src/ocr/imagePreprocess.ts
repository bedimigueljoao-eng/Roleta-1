import { ROIRect } from '../types/roulette';

export interface PreprocessedROI {
  colorCanvas: HTMLCanvasElement;
  colorImageData: ImageData;
  claheCanvas: HTMLCanvasElement;
  claheDataUrl: string;
  roiWidth: number;
  roiHeight: number;
}

export interface SegmentedCell {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  tesseractCanvas: HTMLCanvasElement;
  previewDataUrl: string;
}

/**
 * Applies fast luminance grayscale `(77*R + 150*G + 29*B) >> 8` and
 * local CLAHE (4x2 tile grid, clipFactor = 2.6) onto a canvas.
 */
function applyGrayscaleAndCLAHE(
  srcImageData: ImageData,
  tilesX = 4,
  tilesY = 2,
  clipFactor = 2.6
): Uint8ClampedArray {
  const { width, height, data } = srcImageData;
  const totalPixels = width * height;
  const gray = new Uint8ClampedArray(totalPixels);

  for (let i = 0; i < totalPixels; i++) {
    const off = i * 4;
    gray[i] = (77 * data[off] + 150 * data[off + 1] + 29 * data[off + 2]) >> 8;
  }

  const tileW = Math.max(8, Math.ceil(width / tilesX));
  const tileH = Math.max(8, Math.ceil(height / tilesY));
  const luts: Uint8Array[][] = [];

  for (let ty = 0; ty < tilesY; ty++) {
    const rowLuts: Uint8Array[] = [];
    const y0 = ty * tileH;
    const y1 = Math.min(height, y0 + tileH);

    for (let tx = 0; tx < tilesX; tx++) {
      const x0 = tx * tileW;
      const x1 = Math.min(width, x0 + tileW);
      const hist = new Uint32Array(256);
      const area = Math.max(1, (x1 - x0) * (y1 - y0));

      for (let y = y0; y < y1; y++) {
        const rowOff = y * width;
        for (let x = x0; x < x1; x++) {
          hist[gray[rowOff + x]]++;
        }
      }

      // Contrast limiting & redistribution
      const clipLimit = Math.max(1, Math.floor((clipFactor * area) / 256));
      let excess = 0;
      for (let b = 0; b < 256; b++) {
        if (hist[b] > clipLimit) {
          excess += hist[b] - clipLimit;
          hist[b] = clipLimit;
        }
      }
      const redist = Math.floor(excess / 256);
      const rem = excess % 256;
      for (let b = 0; b < 256; b++) {
        hist[b] += redist + (b < rem ? 1 : 0);
      }

      // Build CDF LUT
      const lut = new Uint8Array(256);
      let cdf = 0;
      for (let b = 0; b < 256; b++) {
        cdf += hist[b];
        lut[b] = Math.min(255, Math.round((cdf * 255) / area));
      }
      rowLuts.push(lut);
    }
    luts.push(rowLuts);
  }

  // Bilinear tile interpolation
  const out = new Uint8ClampedArray(totalPixels);
  for (let y = 0; y < height; y++) {
    const gy = ((y + 0.5) / tileH) - 0.5;
    const ty0 = Math.max(0, Math.min(tilesY - 1, Math.floor(gy)));
    const ty1 = Math.max(0, Math.min(tilesY - 1, ty0 + 1));
    const fy = Math.max(0, Math.min(1, gy - ty0));

    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      const gx = ((x + 0.5) / tileW) - 0.5;
      const tx0 = Math.max(0, Math.min(tilesX - 1, Math.floor(gx)));
      const tx1 = Math.max(0, Math.min(tilesX - 1, tx0 + 1));
      const fx = Math.max(0, Math.min(1, gx - tx0));

      const v = gray[rowOff + x];
      const c00 = luts[ty0][tx0][v];
      const c10 = luts[ty0][tx1][v];
      const c01 = luts[ty1][tx0][v];
      const c11 = luts[ty1][tx1][v];

      const top = c00 + (c10 - c00) * fx;
      const bot = c01 + (c11 - c01) * fx;
      out[rowOff + x] = Math.round(top + (bot - top) * fy);
    }
  }

  return out;
}

/**
 * Crops the active ROI from video or canvas, applies smart 2x upscale if height < 120px,
 * and computes CLAHE grayscale image while keeping parallel color canvas for HSV sampling.
 */
export function preprocessROI(
  source: HTMLVideoElement | HTMLCanvasElement,
  roi: ROIRect,
  multiplierMode: boolean
): PreprocessedROI | null {
  const srcW =
    source instanceof HTMLVideoElement ? source.videoWidth : source.width;
  const srcH =
    source instanceof HTMLVideoElement ? source.videoHeight : source.height;

  if (srcW <= 0 || srcH <= 0) return null;

  const sx = Math.max(0, Math.round(roi.leftRatio * srcW));
  const sy = Math.max(0, Math.round(roi.topRatio * srcH));
  const sw = Math.max(16, Math.min(srcW - sx, Math.round(roi.widthRatio * srcW)));
  const rawSh = Math.max(12, Math.min(srcH - sy, Math.round(roi.heightRatio * srcH)));

  // In Multiplier mode (Lightning / XXXtreme), keep upper 70% to crop out bottom 50x-500x badges
  const sh = multiplierMode ? Math.max(12, Math.round(rawSh * 0.7)) : rawSh;

  // Smart scaling: 2x upscale only if ROI height < 120px
  const scale = sh < 120 ? 2 : 1;
  const dstW = sw * scale;
  const dstH = sh * scale;

  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = dstW;
  colorCanvas.height = dstH;
  const colorCtx = colorCanvas.getContext('2d', { willReadFrequently: true });
  if (!colorCtx) return null;

  colorCtx.imageSmoothingEnabled = true;
  colorCtx.imageSmoothingQuality = 'high';
  colorCtx.drawImage(source, sx, sy, sw, sh, 0, 0, dstW, dstH);

  const colorImageData = colorCtx.getImageData(0, 0, dstW, dstH);
  const claheGray = applyGrayscaleAndCLAHE(colorImageData, 4, 2, 2.6);

  const claheCanvas = document.createElement('canvas');
  claheCanvas.width = dstW;
  claheCanvas.height = dstH;
  const claheCtx = claheCanvas.getContext('2d', { willReadFrequently: true });
  if (!claheCtx) return null;

  const claheImg = claheCtx.createImageData(dstW, dstH);
  for (let i = 0; i < claheGray.length; i++) {
    const val = claheGray[i];
    const off = i * 4;
    claheImg.data[off] = val;
    claheImg.data[off + 1] = val;
    claheImg.data[off + 2] = val;
    claheImg.data[off + 3] = 255;
  }
  claheCtx.putImageData(claheImg, 0, 0);

  return {
    colorCanvas,
    colorImageData,
    claheCanvas,
    claheDataUrl: claheCanvas.toDataURL('image/png'),
    roiWidth: dstW,
    roiHeight: dstH,
  };
}

/**
 * Segments horizontal pill cells using vertical projection energy (with uniform fallback),
 * upscales each cell 2.5x, adds an 8px white border, and inverts white digits on dark pills
 * into crisp #000000 black text on #FFFFFF white background for maximum Tesseract accuracy.
 */
export function segmentCellsForTesseract(
  roi: PreprocessedROI,
  expectedCells: number
): SegmentedCell[] {
  const { claheCanvas, roiWidth, roiHeight } = roi;
  const ctx = claheCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];

  const imgData = ctx.getImageData(0, 0, roiWidth, roiHeight).data;

  // Vertical projection energy (variance/edge contrast per column)
  const colEnergy = new Float32Array(roiWidth);
  for (let x = 0; x < roiWidth; x++) {
    let sum = 0;
    let brightCount = 0;
    for (let y = Math.floor(roiHeight * 0.15); y < Math.floor(roiHeight * 0.85); y++) {
      const lum = imgData[(y * roiWidth + x) * 4];
      sum += lum;
      if (lum > 180) brightCount++;
    }
    colEnergy[x] = sum / Math.max(1, roiHeight * 0.7) + brightCount * 4;
  }

  // Uniform cell slice refined slightly by local energy minima near boundaries
  const approxCellW = roiWidth / Math.max(1, expectedCells);
  const cells: SegmentedCell[] = [];

  for (let i = 0; i < expectedCells; i++) {
    let x0 = Math.round(i * approxCellW);
    let x1 = Math.round((i + 1) * approxCellW);

    // Search +/- 12% around internal boundaries for lowest energy valley
    if (i > 0) {
      const searchRad = Math.max(2, Math.floor(approxCellW * 0.12));
      let bestX = x0;
      let minE = Infinity;
      for (let sx = Math.max(1, x0 - searchRad); sx <= Math.min(roiWidth - 2, x0 + searchRad); sx++) {
        if (colEnergy[sx] < minE) {
          minE = colEnergy[sx];
          bestX = sx;
        }
      }
      x0 = bestX;
    }
    if (i < expectedCells - 1) {
      const searchRad = Math.max(2, Math.floor(approxCellW * 0.12));
      let bestX = x1;
      let minE = Infinity;
      for (let sx = Math.max(x0 + 4, x1 - searchRad); sx <= Math.min(roiWidth - 1, x1 + searchRad); sx++) {
        if (colEnergy[sx] < minE) {
          minE = colEnergy[sx];
          bestX = sx;
        }
      }
      x1 = bestX;
    }

    const cellW = Math.max(8, x1 - x0);
    const cellY = Math.round(roiHeight * 0.08);
    const cellH = Math.max(8, Math.round(roiHeight * 0.84));

    // Upscale 2.5x + 8px white border + invert light text on dark background -> black on white
    const upScale = 2.5;
    const border = 8;
    const innerW = Math.round(cellW * upScale);
    const innerH = Math.round(cellH * upScale);

    const outCanvas = document.createElement('canvas');
    outCanvas.width = innerW + border * 2;
    outCanvas.height = innerH + border * 2;
    const outCtx = outCanvas.getContext('2d', { willReadFrequently: true });
    if (!outCtx) continue;

    outCtx.fillStyle = '#FFFFFF';
    outCtx.fillRect(0, 0, outCanvas.width, outCanvas.height);

    outCtx.imageSmoothingEnabled = true;
    outCtx.imageSmoothingQuality = 'high';
    outCtx.drawImage(
      claheCanvas,
      x0,
      cellY,
      cellW,
      cellH,
      border,
      border,
      innerW,
      innerH
    );

    // Inspect center luminance vs outer ring to invert light-on-dark into black-on-white
    const cellPix = outCtx.getImageData(border, border, innerW, innerH);
    const d = cellPix.data;
    let totalLum = 0;
    for (let p = 0; p < d.length; p += 4) {
      totalLum += d[p];
    }
    const meanCellLum = totalLum / (innerW * innerH);
    const shouldInvert = meanCellLum < 155; // Dark pill with white/bright digits

    for (let p = 0; p < d.length; p += 4) {
      const lum = d[p];
      const val = shouldInvert ? 255 - lum : lum;
      // Soft contrast stretch without harsh binary haloing
      const stretched = val < 95 ? 0 : val > 185 ? 255 : Math.round(((val - 95) / 90) * 255);
      d[p] = stretched;
      d[p + 1] = stretched;
      d[p + 2] = stretched;
      d[p + 3] = 255;
    }
    outCtx.putImageData(cellPix, border, border);

    cells.push({
      index: i,
      x: x0,
      y: cellY,
      width: cellW,
      height: cellH,
      tesseractCanvas: outCanvas,
      previewDataUrl: outCanvas.toDataURL('image/png'),
    });
  }

  return cells;
}
