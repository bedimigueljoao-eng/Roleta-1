import { OCRDetection, ReconciliationEvent } from '../types/roulette';

/**
 * Layer 3: Temporal Reconciliation State Machine
 * Aligns incoming OCR strips against confirmedStrip to prevent duplicate spins
 * during OCR oscillation, capture missed spins (shift +1..+4), and detect table switches.
 */
export class TemporalReconciler {
  private confirmedStrip: number[] = [];
  private pendingCandidate: {
    firstNum: number;
    strip: OCRDetection[];
    count: number;
  } | null = null;
  private unrelatedStripCount = 0;

  public getConfirmedStrip(): number[] {
    return [...this.confirmedStrip];
  }

  public reset(): void {
    this.confirmedStrip = [];
    this.pendingCandidate = null;
    this.unrelatedStripCount = 0;
  }

  public reconcile(detections: OCRDetection[]): ReconciliationEvent {
    if (detections.length === 0) {
      return {
        type: 'NO_CHANGE',
        spins: [],
        isFullStrip: false,
        shift: 0,
        avgConfidence: 0,
        message: 'Nenhuma célula válida detetada neste frame.',
      };
    }

    const newNums = detections.map((d) => d.number);
    const avgConfidence =
      detections.reduce((acc, d) => acc + d.confidence, 0) / detections.length;

    // 1. Initial State (confirmedStrip empty)
    if (this.confirmedStrip.length === 0) {
      if (detections.length >= 4 && avgConfidence >= 0.78) {
        this.confirmedStrip = newNums;
        this.pendingCandidate = null;
        this.unrelatedStripCount = 0;
        return {
          type: 'FULL_STRIP',
          spins: detections,
          isFullStrip: true,
          shift: 0,
          avgConfidence,
          message: `Faixa inicial confirmada (${detections.length} números, ${(
            avgConfidence * 100
          ).toFixed(0)}% conf.) → Contexto da Mesa.`,
        };
      }

      // Otherwise wait for 2 consecutive reads with same 1st number
      if (
        this.pendingCandidate &&
        this.pendingCandidate.firstNum === newNums[0] &&
        detections.length >= 3
      ) {
        this.confirmedStrip = newNums;
        this.pendingCandidate = null;
        this.unrelatedStripCount = 0;
        return {
          type: 'FULL_STRIP',
          spins: detections,
          isFullStrip: true,
          shift: 0,
          avgConfidence,
          message: `Faixa inicial confirmada em 2 leituras (${detections.length} números) → Contexto da Mesa.`,
        };
      }

      this.pendingCandidate = {
        firstNum: newNums[0],
        strip: detections,
        count: 1,
      };
      return {
        type: 'PENDING_CONFIRMATION',
        spins: [],
        isFullStrip: false,
        shift: 0,
        avgConfidence,
        message: 'A confirmar faixa inicial na próxima leitura...',
      };
    }

    // 2. Identical strip check
    const isIdentical =
      newNums.length === this.confirmedStrip.length &&
      newNums.every((v, idx) => v === this.confirmedStrip[idx]);

    if (isIdentical) {
      this.pendingCandidate = null;
      this.unrelatedStripCount = 0;
      return {
        type: 'NO_CHANGE',
        spins: [],
        isFullStrip: false,
        shift: 0,
        avgConfidence,
        message: 'Faixa idêntica à confirmada.',
      };
    }

    // 3. Negative Shift Alignment (shift = 0 to -3):
    // Checks if newStrip starts from index 0..3 of confirmedStrip (e.g. leftmost pill missed by OCR)
    for (let negOffset = 0; negOffset <= 3; negOffset++) {
      const overlapLen = Math.min(
        newNums.length,
        this.confirmedStrip.length - negOffset
      );
      if (overlapLen >= 3) {
        let matches = 0;
        for (let i = 0; i < overlapLen; i++) {
          if (newNums[i] === this.confirmedStrip[negOffset + i]) matches++;
        }
        const allowedMismatch = overlapLen >= 4 ? overlapLen - 1 : overlapLen;
        if (matches >= 3 && matches >= allowedMismatch) {
          this.pendingCandidate = null;
          this.unrelatedStripCount = 0;
          return {
            type: 'NEGATIVE_SHIFT_IGNORED',
            spins: [],
            isFullStrip: false,
            shift: -negOffset,
            avgConfidence,
            message: `Mesma faixa estacionária (alinhamento -${negOffset}, ${matches}/${overlapLen} coinc.) — giro duplicado evitado.`,
          };
        }
      }
    }

    // 4. Positive Shift Alignment (shift = +1 to +4 — New Spins!)
    for (let shift = 1; shift <= 4; shift++) {
      const overlapLen = Math.min(
        newNums.length - shift,
        this.confirmedStrip.length
      );
      if (overlapLen >= 3) {
        let matches = 0;
        for (let i = 0; i < overlapLen; i++) {
          if (newNums[shift + i] === this.confirmedStrip[i]) matches++;
        }
        if (matches >= 3 && matches >= overlapLen - (overlapLen >= 5 ? 1 : 0)) {
          const newSpins = detections.slice(0, shift);

          if (matches >= 3 && avgConfidence >= 0.74) {
            this.confirmedStrip = newNums;
            this.pendingCandidate = null;
            this.unrelatedStripCount = 0;
            return {
              type: 'NEW_SPINS',
              spins: newSpins,
              isFullStrip: false,
              shift,
              avgConfidence,
              message: `Commit imediato (+${shift} giro${shift > 1 ? 's' : ''}): [${newSpins
                .map((s) => s.number)
                .join(', ')}]`,
            };
          }

          // Low confidence: require 2 consecutive agreeing reads
          if (
            this.pendingCandidate &&
            this.pendingCandidate.firstNum === newNums[0]
          ) {
            this.confirmedStrip = newNums;
            this.pendingCandidate = null;
            this.unrelatedStripCount = 0;
            return {
              type: 'NEW_SPINS',
              spins: newSpins,
              isFullStrip: false,
              shift,
              avgConfidence,
              message: `Commit confirmado em 2 leituras (+${shift}): [${newSpins
                .map((s) => s.number)
                .join(', ')}]`,
            };
          }

          this.pendingCandidate = {
            firstNum: newNums[0],
            strip: detections,
            count: 1,
          };
          return {
            type: 'PENDING_CONFIRMATION',
            spins: [],
            isFullStrip: false,
            shift,
            avgConfidence,
            message: `Novo giro candidato [${newSpins
              .map((s) => s.number)
              .join(', ')}] — a aguardar 2ª leitura (conf. ${(
              avgConfidence * 100
            ).toFixed(0)}%).`,
          };
        }
      }
    }

    // 5. Table / Dealer Switch Detection
    this.unrelatedStripCount++;
    if (
      this.unrelatedStripCount >= 2 &&
      detections.length >= 4 &&
      avgConfidence >= 0.75
    ) {
      this.confirmedStrip = newNums;
      this.pendingCandidate = null;
      this.unrelatedStripCount = 0;
      return {
        type: 'TABLE_SWITCH',
        spins: detections,
        isFullStrip: true,
        shift: 0,
        avgConfidence,
        message: `Troca de mesa detetada (${detections.length} novos números sem interseção). Sessão anterior arquivada.`,
      };
    }

    return {
      type: 'PENDING_CONFIRMATION',
      spins: [],
      isFullStrip: false,
      shift: 0,
      avgConfidence,
      message: `Leitura sem alinhamento (${this.unrelatedStripCount}/2 para troca de mesa).`,
    };
  }
}
