import { createWorker, OEM, PSM, Worker } from 'tesseract.js';
import {
  CasinoLayoutPreset,
  FrameSignature,
  OCRCellBox,
  OCRDetection,
  OCRFrameResult,
  RouletteColor,
} from '../types/roulette';
import { BLACK_NUMBERS, getNumberColor, RED_NUMBERS } from '../engine/rouletteConstants';
import { computeFrameSignature, evaluateSignatureTrigger } from './frameSignature';
import { sampleCellBorderColor } from './hsvColorClassifier';
import { preprocessROI, segmentCellsForTesseract } from './imagePreprocess';

let workerPromise: Promise<Worker> | null = null;

async function getOcrWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker('eng', OEM.LSTM_ONLY);
      await worker.setParameters({
        tessedit_char_whitelist: '0123456789',
        tessedit_pageseg_mode: PSM.SINGLE_WORD,
      });
      return worker;
    })();
  }
  return workerPromise;
}

export async function terminateOcrWorker(): Promise<void> {
  if (workerPromise) {
    const w = await workerPromise;
    await w.terminate();
    workerPromise = null;
  }
}

function validateNumberAndColor(
  rawText: string,
  hsvColor: RouletteColor | null,
  rawConfidence: number
): {
  valid: boolean;
  number: number | null;
  color: RouletteColor | null;
  confidence: number;
  rejectedReason?: string;
} {
  const cleaned = rawText.trim();

  // Reject multiplier tokens containing x, X, ×, . or empty
  if (!cleaned) {
    return { valid: false, number: null, color: hsvColor, confidence: 0, rejectedReason: 'Texto vazio' };
  }
  if (/[xX×.]/.test(cleaned)) {
    return {
      valid: false,
      number: null,
      color: hsvColor,
      confidence: 0,
      rejectedReason: `Token multiplicador rejeitado ("${cleaned}")`,
    };
  }

  // Handle "O" / "o" read on GREEN pill
  let parsedStr = cleaned;
  if (/^[Oo]$/.test(cleaned) && hsvColor === 'GREEN') {
    parsedStr = '0';
  }

  const digitsOnly = parsedStr.replace(/\D/g, '');
  if (digitsOnly.length === 0 || digitsOnly.length > 2) {
    return {
      valid: false,
      number: null,
      color: hsvColor,
      confidence: 0,
      rejectedReason: `Mais de 2 dígitos ou inválido ("${cleaned}")`,
    };
  }

  const num = Number.parseInt(digitsOnly, 10);
  if (Number.isNaN(num) || num < 0 || num > 36) {
    return {
      valid: false,
      number: null,
      color: hsvColor,
      confidence: 0,
      rejectedReason: `Fora do intervalo 0–36 (${num})`,
    };
  }

  // Strict Cross-Validation Number <-> Color
  if (hsvColor === 'GREEN' && num !== 0) {
    return {
      valid: false,
      number: null,
      color: hsvColor,
      confidence: 0,
      rejectedReason: `Conflito: fundo GREEN mas número ${num} ≠ 0`,
    };
  }
  if (num === 0 && hsvColor !== 'GREEN') {
    return {
      valid: false,
      number: null,
      color: hsvColor,
      confidence: 0,
      rejectedReason: `Conflito: número 0 exige fundo GREEN (lido ${hsvColor ?? 'null'})`,
    };
  }
  if (hsvColor === 'RED' && !RED_NUMBERS.has(num)) {
    return {
      valid: false,
      number: null,
      color: hsvColor,
      confidence: 0,
      rejectedReason: `Conflito: fundo RED mas ${num} é Preto`,
    };
  }
  if (hsvColor === 'BLACK' && !BLACK_NUMBERS.has(num)) {
    return {
      valid: false,
      number: null,
      color: hsvColor,
      confidence: 0,
      rejectedReason: `Conflito: fundo BLACK mas ${num} é Vermelho`,
    };
  }

  // If color == null (golden border blocked sample), accept 1..36 with reduced confidence
  const confNorm = Math.min(1, Math.max(0, rawConfidence / 100));
  const finalConfidence = hsvColor === null ? confNorm * 0.78 : confNorm;
  const resolvedColor = hsvColor ?? getNumberColor(num);

  return {
    valid: true,
    number: num,
    color: resolvedColor,
    confidence: finalConfidence,
  };
}

/**
 * Spatial row selection & overlap deduplication (Step 4)
 */
function selectMainRowAndDeduplicate(
  boxes: OCRCellBox[],
  roiHeight: number,
  newestOnLeft: boolean
): OCRDetection[] {
  const validBoxes = boxes.filter((b) => {
    if (b.number === null) return false;
    if (b.height < 7) return false;
    if (b.height > 0.92 * roiHeight) return false;
    if (b.width > 1.85 * roiHeight) return false;
    return true;
  });

  if (validBoxes.length === 0) return [];

  // Group by vertical proximity |centerY_a - centerY_b| <= max(12, 0.24 * roiH)
  const yThresh = Math.max(12, 0.24 * roiHeight);
  const rows: OCRCellBox[][] = [];

  for (const box of validBoxes) {
    const cy = box.y + box.height / 2;
    let placed = false;
    for (const row of rows) {
      const refCy = row[0].y + row[0].height / 2;
      if (Math.abs(cy - refCy) <= yThresh) {
        row.push(box);
        placed = true;
        break;
      }
    }
    if (!placed) rows.push([box]);
  }

  // Select row with highest count of pills
  rows.sort((a, b) => b.length - a.length);
  const mainRow = rows[0];

  // Order by X (ascending if newestOnLeft, descending if newestOnRight)
  mainRow.sort((a, b) => (newestOnLeft ? a.x - b.x : b.x - a.x));

  // Deduplicate overlapping boxes < max(10, 0.52 * boxHeight)
  const deduped: OCRCellBox[] = [];
  for (const box of mainRow) {
    const minDist = Math.max(10, 0.52 * box.height);
    const hasOverlap = deduped.some((existing) => Math.abs(existing.x - box.x) < minDist);
    if (!hasOverlap) deduped.push(box);
  }

  return deduped.map((b) => ({
    number: b.number!,
    color: b.color,
    confidence: b.confidence,
    box: { x: b.x, y: b.y, width: b.width, height: b.height },
  }));
}

export class RouletteOcrPipeline {
  private prevSignature: FrameSignature | null = null;
  private lastOcrRunTimestamp = 0;

  public resetSignature(): void {
    this.prevSignature = null;
    this.lastOcrRunTimestamp = 0;
  }

  public async processFrame(
    source: HTMLVideoElement | HTMLCanvasElement,
    preset: CasinoLayoutPreset,
    forceRun = false
  ): Promise<OCRFrameResult> {
    const t0 = performance.now();

    const roi = preprocessROI(source, preset.roi, preset.multiplierMode);
    if (!roi) {
      return {
        timestamp: Date.now(),
        processingMs: performance.now() - t0,
        skippedBySignature: true,
        signatureReason: 'Fonte de vídeo/canvas sem dimensões válidas',
        globalHamming: 0,
        leftEdgeHamming: 0,
        lumaDiff: 0,
        detections: [],
        allBoxes: [],
        roiWidth: 0,
        roiHeight: 0,
      };
    }

    // 1. Fast <1ms Frame Signature Anti-Lag Filter
    const currSig = computeFrameSignature(roi.colorImageData, t0);
    const trigger = evaluateSignatureTrigger(
      this.prevSignature,
      currSig,
      this.lastOcrRunTimestamp,
      1250
    );

    if (!forceRun && !trigger.shouldRun) {
      return {
        timestamp: Date.now(),
        processingMs: performance.now() - t0,
        skippedBySignature: true,
        signatureReason: trigger.reason,
        globalHamming: trigger.globalHamming,
        leftEdgeHamming: trigger.leftEdgeHamming,
        lumaDiff: trigger.lumaDiff,
        detections: [],
        allBoxes: [],
        clahePreviewDataUrl: roi.claheDataUrl,
        roiWidth: roi.roiWidth,
        roiHeight: roi.roiHeight,
      };
    }

    this.prevSignature = currSig;
    this.lastOcrRunTimestamp = t0;

    // 2. Segment cells & run Tesseract.js + parallel HSV border voting
    const cells = segmentCellsForTesseract(roi, preset.expectedCells);
    const worker = await getOcrWorker();

    const allBoxes: OCRCellBox[] = [];

    for (const cell of cells) {
      const hsvVotes = sampleCellBorderColor(
        roi.colorImageData,
        { x: cell.x, y: cell.y, width: cell.width, height: cell.height },
        preset.hsvProfile
      );

      let rawText = '';
      let rawConf = 0;
      try {
        const res = await worker.recognize(cell.tesseractCanvas);
        rawText = res.data.text ?? '';
        rawConf = res.data.confidence ?? 0;
      } catch {
        rawText = '';
        rawConf = 0;
      }

      const validation = validateNumberAndColor(
        rawText,
        hsvVotes.resolvedColor,
        rawConf
      );

      allBoxes.push({
        index: cell.index,
        x: cell.x,
        y: cell.y,
        width: cell.width,
        height: cell.height,
        rawText: rawText.trim(),
        number: validation.valid ? validation.number : null,
        color: validation.color,
        confidence: validation.confidence,
        rejectedReason: validation.rejectedReason,
        hsvVotes,
        invertedPreviewDataUrl: cell.previewDataUrl,
      });
    }

    // 3. Row selection & deduplication
    const detections = selectMainRowAndDeduplicate(
      allBoxes,
      roi.roiHeight,
      preset.newestOnLeft
    );

    return {
      timestamp: Date.now(),
      processingMs: performance.now() - t0,
      skippedBySignature: false,
      signatureReason: forceRun ? 'Execução manual forçada' : trigger.reason,
      globalHamming: trigger.globalHamming,
      leftEdgeHamming: trigger.leftEdgeHamming,
      lumaDiff: trigger.lumaDiff,
      detections,
      allBoxes,
      clahePreviewDataUrl: roi.claheDataUrl,
      roiWidth: roi.roiWidth,
      roiHeight: roi.roiHeight,
    };
  }
}
