import { FrameSignature } from '../types/roulette';

/**
 * Computes a 64-bit difference hash (dHash) over a 9x8 luminance grid
 * within a specified sub-rectangle of an ImageData buffer (< 1ms).
 */
function computeRegionDHash64(
  data: Uint8ClampedArray,
  imgWidth: number,
  imgHeight: number,
  regionStartX: number,
  regionWidth: number
): bigint {
  const cols = 9;
  const rows = 8;
  const grid = new Float32Array(cols * rows);

  for (let r = 0; r < rows; r++) {
    const sy = Math.min(imgHeight - 1, Math.floor(((r + 0.5) / rows) * imgHeight));
    for (let c = 0; c < cols; c++) {
      const sx = Math.min(
        imgWidth - 1,
        Math.floor(regionStartX + ((c + 0.5) / cols) * regionWidth)
      );
      const offset = (sy * imgWidth + sx) * 4;
      const lum =
        (77 * data[offset] + 150 * data[offset + 1] + 29 * data[offset + 2]) >> 8;
      grid[r * cols + c] = lum;
    }
  }

  let hash = 0n;
  let bit = 0n;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols - 1; c++) {
      if (grid[r * cols + c] > grid[r * cols + c + 1]) {
        hash |= 1n << bit;
      }
      bit++;
    }
  }
  return hash;
}

/**
 * Computes global dHash (64-bit), left-edge dHash (first 35% of ROI width, 64-bit),
 * and meanLuma on the ROI ImageData in < 1 ms.
 */
export function computeFrameSignature(
  imageData: ImageData,
  timestamp = performance.now()
): FrameSignature {
  const { data, width, height } = imageData;

  const dHash = computeRegionDHash64(data, width, height, 0, width);
  const edgeWidth = Math.max(9, Math.floor(width * 0.35));
  const leftEdgeHash = computeRegionDHash64(data, width, height, 0, edgeWidth);

  // Fast strided mean luma sampling
  const step = Math.max(1, Math.floor((width * height) / 512));
  let lumaSum = 0;
  let count = 0;
  for (let i = 0; i < width * height; i += step) {
    const off = i * 4;
    lumaSum += (77 * data[off] + 150 * data[off + 1] + 29 * data[off + 2]) >> 8;
    count++;
  }
  const meanLuma = count > 0 ? lumaSum / count : 0;

  return {
    dHash,
    leftEdgeHash,
    meanLuma,
    timestamp,
  };
}

export function hammingDistance64(a: bigint, b: bigint): number {
  let x = a ^ b;
  let dist = 0;
  while (x > 0n) {
    dist += Number(x & 1n);
    x >>= 1n;
  }
  return dist;
}

export function evaluateSignatureTrigger(
  prev: FrameSignature | null,
  curr: FrameSignature,
  lastOcrRunTimestamp: number,
  heartbeatMs = 1250
): {
  shouldRun: boolean;
  reason: string;
  globalHamming: number;
  leftEdgeHamming: number;
  lumaDiff: number;
} {
  if (!prev) {
    return {
      shouldRun: true,
      reason: 'Primeiro frame da sessão',
      globalHamming: 64,
      leftEdgeHamming: 64,
      lumaDiff: 255,
    };
  }

  const globalHamming = hammingDistance64(prev.dHash, curr.dHash);
  const leftEdgeHamming = hammingDistance64(prev.leftEdgeHash, curr.leftEdgeHash);
  const lumaDiff = Math.abs(curr.meanLuma - prev.meanLuma);
  const elapsedSinceOcr = curr.timestamp - lastOcrRunTimestamp;

  if (globalHamming >= 2) {
    return {
      shouldRun: true,
      reason: `Alteração global dHash (${globalHamming} bits)`,
      globalHamming,
      leftEdgeHamming,
      lumaDiff,
    };
  }

  if (leftEdgeHamming >= 2) {
    return {
      shouldRun: true,
      reason: `Novo número na borda esquerda (${leftEdgeHamming} bits)`,
      globalHamming,
      leftEdgeHamming,
      lumaDiff,
    };
  }

  if (lumaDiff >= 3) {
    return {
      shouldRun: true,
      reason: `Variação de luminância (${lumaDiff.toFixed(1)})`,
      globalHamming,
      leftEdgeHamming,
      lumaDiff,
    };
  }

  if (elapsedSinceOcr >= heartbeatMs) {
    return {
      shouldRun: true,
      reason: `Heartbeat periódico (${Math.round(elapsedSinceOcr)}ms)`,
      globalHamming,
      leftEdgeHamming,
      lumaDiff,
    };
  }

  return {
    shouldRun: false,
    reason: 'Frame estático (descartado < 1ms)',
    globalHamming,
    leftEdgeHamming,
    lumaDiff,
  };
}
