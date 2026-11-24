import { HSVProfile, HSVRange, HSVSampleVote, RouletteColor } from '../types/roulette';

export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rf = r / 255;
  const gf = g / 255;
  const bf = b / 255;
  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === rf) {
      h = 60 * (((gf - bf) / delta) % 6);
    } else if (max === gf) {
      h = 60 * ((bf - rf) / delta + 2);
    } else {
      h = 60 * ((rf - gf) / delta + 4);
    }
  }
  if (h < 0) h += 360;

  const s = max === 0 ? 0 : delta / max;
  const v = max;
  return { h, s, v };
}

function matchesHueRange(h: number, min: number, max: number): boolean {
  if (min <= max) {
    return h >= min && h <= max;
  }
  // Wrap-around (e.g., Red 332..360 or 0..22)
  return h >= min || h <= max;
}

function matchesHSVRange(
  hsv: { h: number; s: number; v: number },
  range: HSVRange,
  ignoreHue = false
): boolean {
  const satOk = hsv.s >= range.satMin && hsv.s <= range.satMax;
  const valOk = hsv.v >= range.valMin && hsv.v <= range.valMax;
  if (!satOk || !valOk) return false;
  if (ignoreHue) return true;
  return matchesHueRange(hsv.h, range.hueMin, range.hueMax);
}

/**
 * Samples 8 border/corner points around a detected number cell to determine its pill background color.
 * Ignores white/bright gold highlights (`sat < 0.14 && val > 0.72`).
 * Requires >= 2 clear votes to commit GREEN/RED/BLACK, otherwise returns null (indeterminate).
 */
export function sampleCellBorderColor(
  imageData: ImageData,
  cellRect: { x: number; y: number; width: number; height: number },
  profile: HSVProfile
): HSVSampleVote {
  const { data, width, height } = imageData;
  const padX = Math.max(2, Math.round(cellRect.width * 0.12));
  const padY = Math.max(2, Math.round(cellRect.height * 0.14));

  const cx = Math.round(cellRect.x + cellRect.width / 2);
  const cy = Math.round(cellRect.y + cellRect.height / 2);

  const leftX = Math.max(0, Math.round(cellRect.x + padX));
  const rightX = Math.min(width - 1, Math.round(cellRect.x + cellRect.width - padX));
  const topY = Math.max(0, Math.round(cellRect.y + padY));
  const bottomY = Math.min(height - 1, Math.round(cellRect.y + cellRect.height - padY));

  const samplePoints: Array<[number, number]> = [
    [leftX, cy],
    [rightX, cy],
    [cx, topY],
    [cx, bottomY],
    [leftX, topY],
    [rightX, topY],
    [leftX, bottomY],
    [rightX, bottomY],
  ];

  let greenVotes = 0;
  let redVotes = 0;
  let blackVotes = 0;
  let ignoredBright = 0;

  for (const [px, py] of samplePoints) {
    const idx = (py * width + px) * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const hsv = rgbToHsv(r, g, b);

    // Ignore bright white digits or golden active border ring
    if (hsv.s < 0.14 && hsv.v > 0.72) {
      ignoredBright++;
      continue;
    }

    if (matchesHSVRange(hsv, profile.green)) {
      greenVotes++;
    } else if (matchesHSVRange(hsv, profile.red)) {
      redVotes++;
    } else if (hsv.s <= profile.black.satMax || hsv.v <= profile.black.valMax) {
      blackVotes++;
    }
  }

  let resolvedColor: RouletteColor | null = null;
  const maxVotes = Math.max(greenVotes, redVotes, blackVotes);
  if (maxVotes >= 2) {
    if (greenVotes === maxVotes && greenVotes > redVotes && greenVotes > blackVotes) {
      resolvedColor = 'GREEN';
    } else if (redVotes === maxVotes && redVotes > blackVotes) {
      resolvedColor = 'RED';
    } else if (blackVotes === maxVotes) {
      resolvedColor = 'BLACK';
    }
  }

  return {
    greenVotes,
    redVotes,
    blackVotes,
    ignoredBright,
    resolvedColor,
  };
}

/**
 * Interactive Eyedropper calibration: updates the HSV range for GREEN, RED, or BLACK
 * around the clicked pixel with safe tolerance margins.
 */
export function calibrateProfileFromPixel(
  current: HSVProfile,
  target: RouletteColor,
  r: number,
  g: number,
  b: number
): HSVProfile {
  const { h, s, v } = rgbToHsv(r, g, b);
  const next: HSVProfile = {
    ...current,
    calibratedSamples: current.calibratedSamples + 1,
  };

  if (target === 'GREEN') {
    next.green = {
      hueMin: Math.max(60, Math.round(h - 35)),
      hueMax: Math.min(185, Math.round(h + 35)),
      satMin: Math.max(0.18, Number((s - 0.28).toFixed(2))),
      satMax: 1,
      valMin: Math.max(0.12, Number((v - 0.28).toFixed(2))),
      valMax: 1,
    };
  } else if (target === 'RED') {
    const hMin = (h - 22 + 360) % 360;
    const hMax = (h + 22) % 360;
    next.red = {
      hueMin: Math.round(hMin),
      hueMax: Math.round(hMax),
      satMin: Math.max(0.2, Number((s - 0.3).toFixed(2))),
      satMax: 1,
      valMin: Math.max(0.14, Number((v - 0.3).toFixed(2))),
      valMax: 1,
    };
  } else {
    next.black = {
      hueMin: 0,
      hueMax: 360,
      satMin: 0,
      satMax: Math.min(0.42, Number(Math.max(0.24, s + 0.16).toFixed(2))),
      valMin: 0,
      valMax: Math.min(0.45, Number(Math.max(0.26, v + 0.16).toFixed(2))),
    };
  }

  return next;
}
