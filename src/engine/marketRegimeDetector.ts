import { MarketRegimeReport, SpinEntry } from '../types/roulette';
import { BLACK_NUMBERS, getDozen, RED_NUMBERS } from './rouletteConstants';

function calcWindowEntropyMetrics(nums: number[]) {
  const n = nums.length;
  if (n === 0) {
    return {
      shannonPct: 100,
      uniqueRatioPct: 100,
      alternationRatePct: 0,
      zeroPct: 0,
      trendlessPenalty: 0,
    };
  }

  // 1. Normalized Shannon Entropy on the 3 Dozens (D1, D2, D3)
  const dozCounts = [0, 0, 0];
  let dozTotal = 0;
  for (const num of nums) {
    const d = getDozen(num);
    if (d !== null) {
      dozCounts[d - 1]++;
      dozTotal++;
    }
  }

  let shannonPct = 100;
  if (dozTotal > 0) {
    let h = 0;
    for (const c of dozCounts) {
      if (c > 0) {
        const p = c / dozTotal;
        h -= p * Math.log2(p);
      }
    }
    const maxH = Math.log2(3);
    shannonPct = Math.min(100, Math.max(0, (h / maxH) * 100));
  }

  // 2. Unique numbers ratio: uniqueCount / min(37, n)
  const uniqueCount = new Set(nums).size;
  const uniqueRatioPct = (uniqueCount / Math.min(37, n)) * 100;

  // 3. Color alternation rate & trendless equilibrium
  let redCount = 0;
  let blackCount = 0;
  let alternations = 0;
  let colorTransitions = 0;
  let prevColor: 'RED' | 'BLACK' | null = null;

  for (const num of nums) {
    const col = RED_NUMBERS.has(num) ? 'RED' : BLACK_NUMBERS.has(num) ? 'BLACK' : null;
    if (col === 'RED') redCount++;
    if (col === 'BLACK') blackCount++;
    if (col !== null) {
      if (prevColor !== null) {
        colorTransitions++;
        if (col !== prevColor) alternations++;
      }
      prevColor = col;
    }
  }

  const alternationRatePct =
    colorTransitions > 0 ? (alternations / colorTransitions) * 100 : 50;

  const colorTotal = redCount + blackCount;
  const colorImbalance =
    colorTotal > 0 ? Math.abs(redCount - blackCount) / colorTotal : 0;

  let trendlessPenalty = 0;
  if (colorTotal >= 8 && colorImbalance <= 0.12) {
    trendlessPenalty += 12; // Tied Red/Black without clear bias
  }
  if (alternationRatePct > 75 && colorTransitions >= 6) {
    trendlessPenalty += 18; // Chaotic ping-pong alternation
  }

  // 4. Anomalous Zero excess (expected 2.70%)
  const zeroCount = nums.filter((x) => x === 0).length;
  const zeroPct = (zeroCount / n) * 100;

  return {
    shannonPct,
    uniqueRatioPct,
    alternationRatePct,
    zeroPct,
    trendlessPenalty,
  };
}

export function detectMarketRegime(
  combinedSpins: SpinEntry[],
  thresholdPct = 60
): MarketRegimeReport {
  const nums = combinedSpins.map((s) => s.number);
  const n = nums.length;

  const w20 = calcWindowEntropyMetrics(nums.slice(0, 20));
  const w50 = calcWindowEntropyMetrics(nums.slice(0, 50));
  const w100 = calcWindowEntropyMetrics(nums.slice(0, 100));

  // Weighted combination: 55% last 20 + 30% last 50 + 15% last 100
  const shannonEntropyPct =
    0.55 * w20.shannonPct + 0.30 * w50.shannonPct + 0.15 * w100.shannonPct;

  const uniqueRatioPct =
    0.55 * w20.uniqueRatioPct +
    0.30 * w50.uniqueRatioPct +
    0.15 * w100.uniqueRatioPct;

  const alternationRatePct = w20.alternationRatePct;
  const zeroExcessPct = w20.zeroPct;

  // Base unpredictability score from entropy & dispersion
  let unpredictabilityPct =
    0.45 * shannonEntropyPct +
    0.35 * uniqueRatioPct +
    0.20 * w20.trendlessPenalty * 3.33;

  // Anomalous Zero excess penalty (expected = 2.70%)
  if (zeroExcessPct >= 8.0) {
    unpredictabilityPct += 22;
  } else if (zeroExcessPct >= 5.5) {
    unpredictabilityPct += 10;
  }

  unpredictabilityPct = Math.round(Math.min(100, Math.max(0, unpredictabilityPct)));

  const reasons: string[] = [];
  if (n < 12) {
    reasons.push(`Amostra insuficiente (${n}/12 rodadas mínimas para validar regime).`);
  }
  if (shannonEntropyPct >= 88) {
    reasons.push(
      `Entropia de Shannon elevada nas dúzias (${shannonEntropyPct.toFixed(0)}%) — distribuição uniforme sem viés.`
    );
  }
  if (uniqueRatioPct >= 82 && n >= 12) {
    reasons.push(
      `Alta dispersão de números únicos (${uniqueRatioPct.toFixed(0)}%) sem repetição de âncoras.`
    );
  }
  if (alternationRatePct > 75 && n >= 8) {
    reasons.push(
      `Alternância caótica Vermelho/Preto (${alternationRatePct.toFixed(0)}% > 75%).`
    );
  }
  if (zeroExcessPct >= 5.5 && n >= 10) {
    reasons.push(
      `Excesso anómalo do Zero (${zeroExcessPct.toFixed(1)}% vs 2.70% esperado).`
    );
  }
  if (unpredictabilityPct > thresholdPct && reasons.length === 0) {
    reasons.push(
      `Índice de imprevisibilidade (${unpredictabilityPct}%) acima do limite (${thresholdPct}%).`
    );
  }

  const isBlocked = n < 12 || unpredictabilityPct > thresholdPct;

  return {
    unpredictabilityPct,
    isBlocked,
    shannonEntropyPct,
    uniqueRatioPct,
    alternationRatePct,
    zeroExcessPct,
    reasons,
    sampleSize: n,
  };
}
