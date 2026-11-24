import {
  BankrollConfig,
  ChipStrategyProfile,
  ChipSuggestion,
  ExternalMarketStat,
  MarketId,
  NumberStat,
  RouletteAnalysis,
  SectorName,
  SectorStat,
  SpinEntry,
} from '../types/roulette';
import {
  BLACK_NUMBERS,
  EUROPEAN_WHEEL_SEQUENCE,
  getColumn,
  getDozen,
  getNumberColor,
  getWheelNeighbors,
  RED_NUMBERS,
  WHEEL_SECTORS,
} from './rouletteConstants';

function buildExternalStat(
  label: string,
  numbersChronologicalNewestFirst: number[],
  predicate: (n: number) => boolean
): ExternalMarketStat {
  let totalHits = 0;
  let hitsLast20 = 0;
  let currentDelay = 0;
  let delayLocked = false;
  let currentStreak = 0;
  let streakLocked = false;
  let maxStreak = 0;
  let runningStreak = 0;

  for (let i = 0; i < numbersChronologicalNewestFirst.length; i++) {
    const n = numbersChronologicalNewestFirst[i];
    const hit = predicate(n);

    if (hit) {
      totalHits++;
      if (i < 20) hitsLast20++;
      if (!delayLocked) delayLocked = true;
      if (!streakLocked) currentStreak++;
      runningStreak++;
      if (runningStreak > maxStreak) maxStreak = runningStreak;
    } else {
      if (!delayLocked) currentDelay++;
      streakLocked = true;
      runningStreak = 0;
    }
  }

  return {
    label,
    currentStreak,
    maxStreak,
    currentDelay,
    hitsLast20,
    totalHits,
  };
}

export function analyzeRoulette(
  sessionSpins: SpinEntry[],
  learnedBackupSpins: SpinEntry[],
  bankroll: BankrollConfig,
  profileOverride?: ChipStrategyProfile
): RouletteAnalysis {
  const combined = [...sessionSpins, ...learnedBackupSpins];
  const nums = combined.map((s) => s.number);
  const totalCombined = nums.length;
  const lastNumber = totalCombined > 0 ? nums[0] : null;
  const profile = profileOverride ?? bankroll.strategyProfile;

  // 1. Per-number statistics (0..36)
  const counts = new Array<number>(37).fill(0);
  const currentDelays = new Array<number>(37).fill(totalCombined);
  const maxDelays = new Array<number>(37).fill(0);
  const lastSeenIdx = new Array<number>(37).fill(-1);

  // Scan oldest -> newest for exact maxDelay
  for (let revIdx = totalCombined - 1; revIdx >= 0; revIdx--) {
    const n = nums[revIdx];
    const chronoIdx = totalCombined - 1 - revIdx;
    if (n >= 0 && n <= 36) {
      counts[n]++;
      const gap = lastSeenIdx[n] === -1 ? chronoIdx : chronoIdx - lastSeenIdx[n] - 1;
      if (gap > maxDelays[n]) maxDelays[n] = gap;
      lastSeenIdx[n] = chronoIdx;
    }
  }

  // Current delay (from index 0 newest)
  for (let num = 0; num <= 36; num++) {
    const firstIdx = nums.indexOf(num);
    currentDelays[num] = firstIdx === -1 ? totalCombined : firstIdx;
    if (currentDelays[num] > maxDelays[num]) {
      maxDelays[num] = currentDelays[num];
    }
  }

  // 2. Markov Order-1 Transitions (from lastNumber)
  const transitions = new Array<number>(37).fill(0);
  let totalTransitionsFromLast = 0;
  if (lastNumber !== null && totalCombined >= 2) {
    // nums[i] happened immediately after nums[i + 1]
    for (let i = 0; i < totalCombined - 1; i++) {
      if (nums[i + 1] === lastNumber) {
        const nextNum = nums[i];
        if (nextNum >= 0 && nextNum <= 36) {
          transitions[nextNum]++;
          totalTransitionsFromLast++;
        }
      }
    }
  }

  // 3. Anchor & Wheel Neighbors ±2 Scoring (last 25 spins weighted by recency)
  const recencyScores = new Array<number>(37).fill(0);
  const windowSize = Math.min(25, totalCombined);
  if (windowSize > 0) {
    for (let idx = 0; idx < windowSize; idx++) {
      const n = nums[idx];
      const w = (windowSize - idx) / windowSize;
      recencyScores[n] += 1.2 * w;
      const nb1 = getWheelNeighbors(n, 1);
      for (const adj of nb1) {
        if (adj !== n) recencyScores[adj] += 0.35 * w;
      }
      const nb2 = getWheelNeighbors(n, 2);
      for (const adj of nb2) {
        if (adj !== n && !nb1.includes(adj)) recencyScores[adj] += 0.28 * w;
      }
    }
  }

  for (let n = 0; n <= 36; n++) {
    recencyScores[n] += 1.6 * transitions[n];
  }

  const numberStats: NumberStat[] = Array.from({ length: 37 }, (_, n) => ({
    number: n,
    color: getNumberColor(n),
    count: counts[n],
    relativePct: totalCombined > 0 ? (counts[n] / totalCombined) * 100 : 0,
    currentDelay: currentDelays[n],
    maxDelay: maxDelays[n],
    markovScore: transitions[n],
    recencyScore: recencyScores[n],
  }));

  const hotNumbers = [...numberStats]
    .sort((a, b) => b.count - a.count || a.currentDelay - b.currentDelay)
    .slice(0, 6);

  const coldNumbers = [...numberStats]
    .sort((a, b) => b.currentDelay - a.currentDelay || a.count - b.count)
    .slice(0, 6);

  let anchorNumber: number | null = null;
  let anchorNeighbors: number[] = [];
  if (totalCombined > 0) {
    const bestAnchor = [...numberStats].sort((a, b) => b.recencyScore - a.recencyScore)[0];
    anchorNumber = bestAnchor.number;
    anchorNeighbors = getWheelNeighbors(anchorNumber, 2);
  }

  const topTransitions = numberStats
    .filter((s) => s.markovScore > 0)
    .sort((a, b) => b.markovScore - a.markovScore || b.recencyScore - a.recencyScore)
    .slice(0, 5)
    .map((s) => ({
      number: s.number,
      count: s.markovScore,
      pct: totalTransitionsFromLast > 0 ? (s.markovScore / totalTransitionsFromLast) * 100 : 0,
    }));

  // 4. External Markets
  const redStat = buildExternalStat('Vermelho', nums, (n) => RED_NUMBERS.has(n));
  const blackStat = buildExternalStat('Preto', nums, (n) => BLACK_NUMBERS.has(n));
  const zeroCount = counts[0];
  const zeroPct = totalCombined > 0 ? (zeroCount / totalCombined) * 100 : 0;

  const evenStat = buildExternalStat('Par', nums, (n) => n > 0 && n % 2 === 0);
  const oddStat = buildExternalStat('Ímpar', nums, (n) => n > 0 && n % 2 === 1);

  const lowStat = buildExternalStat('1–18 (Baixo)', nums, (n) => n >= 1 && n <= 18);
  const highStat = buildExternalStat('19–36 (Alto)', nums, (n) => n >= 19 && n <= 36);

  const dozens: [ExternalMarketStat, ExternalMarketStat, ExternalMarketStat] = [
    buildExternalStat('1ª Dúzia (1–12)', nums, (n) => getDozen(n) === 1),
    buildExternalStat('2ª Dúzia (13–24)', nums, (n) => getDozen(n) === 2),
    buildExternalStat('3ª Dúzia (25–36)', nums, (n) => getDozen(n) === 3),
  ];

  const columns: [ExternalMarketStat, ExternalMarketStat, ExternalMarketStat] = [
    buildExternalStat('Coluna 1', nums, (n) => getColumn(n) === 1),
    buildExternalStat('Coluna 2', nums, (n) => getColumn(n) === 2),
    buildExternalStat('Coluna 3', nums, (n) => getColumn(n) === 3),
  ];

  // 5. Wheel Sectors (normalized density over last 24 spins or all if < 24)
  const sectorWindow = nums.slice(0, Math.min(24, nums.length));
  const sectors: SectorStat[] = (Object.keys(WHEEL_SECTORS) as SectorName[]).map((name) => {
    const sectorNums = WHEEL_SECTORS[name];
    const hits = sectorWindow.filter((n) => sectorNums.includes(n)).length;
    const density = sectorWindow.length > 0 ? hits / sectorNums.length : 0;
    const firstHitIdx = nums.findIndex((n) => sectorNums.includes(n));
    return {
      name,
      numbers: sectorNums,
      hits,
      density,
      currentDelay: firstHitIdx === -1 ? totalCombined : firstHitIdx,
    };
  });

  const dominantSector =
    totalCombined > 0
      ? [...sectors].sort((a, b) => b.density - a.density || a.currentDelay - b.currentDelay)[0]
      : null;

  // 6. Suggested targets for each of the 7 markets (used by Walk-Forward & UI)
  // Color: revert if streak >= 3 or deficit in last 12
  const last12 = nums.slice(0, Math.min(12, nums.length));
  const red12 = last12.filter((n) => RED_NUMBERS.has(n)).length;
  const black12 = last12.filter((n) => BLACK_NUMBERS.has(n)).length;
  const suggestRed =
    blackStat.currentStreak >= 3
      ? true
      : redStat.currentStreak >= 3
      ? false
      : red12 <= black12;

  const even12 = last12.filter((n) => n > 0 && n % 2 === 0).length;
  const odd12 = last12.filter((n) => n > 0 && n % 2 === 1).length;
  const suggestEven =
    oddStat.currentStreak >= 3
      ? true
      : evenStat.currentStreak >= 3
      ? false
      : even12 <= odd12;

  const low12 = last12.filter((n) => n >= 1 && n <= 18).length;
  const high12 = last12.filter((n) => n >= 19 && n <= 36).length;
  const suggestLow =
    highStat.currentStreak >= 3
      ? true
      : lowStat.currentStreak >= 3
      ? false
      : low12 <= high12;

  const delayedDozen = [...dozens].sort((a, b) => b.currentDelay - a.currentDelay)[0];
  const delayedDozenIdx = dozens.indexOf(delayedDozen) + 1;
  const delayedDozenNums = Array.from({ length: 12 }, (_, i) => (delayedDozenIdx - 1) * 12 + i + 1);

  const delayedColumn = [...columns].sort((a, b) => b.currentDelay - a.currentDelay)[0];
  const delayedColumnIdx = columns.indexOf(delayedColumn) + 1;
  const delayedColumnNums = Array.from({ length: 36 }, (_, i) => i + 1).filter(
    (n) => getColumn(n) === delayedColumnIdx
  );

  const suggestedTargets: Record<MarketId, { label: string; numbers: number[] }> = {
    COR: {
      label: suggestRed ? 'Vermelho' : 'Preto',
      numbers: Array.from(suggestRed ? RED_NUMBERS : BLACK_NUMBERS),
    },
    PARIDADE: {
      label: suggestEven ? 'Par' : 'Ímpar',
      numbers: Array.from({ length: 36 }, (_, i) => i + 1).filter((n) =>
        suggestEven ? n % 2 === 0 : n % 2 === 1
      ),
    },
    ALTO_BAIXO: {
      label: suggestLow ? '1–18 (Baixo)' : '19–36 (Alto)',
      numbers: Array.from({ length: 18 }, (_, i) => (suggestLow ? i + 1 : i + 19)),
    },
    DUZIA: {
      label: delayedDozen.label,
      numbers: delayedDozenNums,
    },
    COLUNA: {
      label: delayedColumn.label,
      numbers: delayedColumnNums,
    },
    VIZINHOS: {
      label:
        anchorNumber !== null
          ? `Âncora ${anchorNumber} (±2)`
          : 'Âncora & Vizinhos ±2',
      numbers: anchorNeighbors,
    },
    SETOR: {
      label: dominantSector ? dominantSector.name : 'Voisins du Zéro',
      numbers: dominantSector ? dominantSector.numbers : WHEEL_SECTORS['Voisins du Zéro'],
    },
  };

  // 7. Chip Suggestion with 25% Bankroll Cap
  const chipSuggestion = buildChipSuggestion(
    profile,
    anchorNeighbors,
    topTransitions.map((t) => t.number),
    hotNumbers.map((h) => h.number),
    dominantSector,
    bankroll
  );

  return {
    totalCombined,
    sessionCount: sessionSpins.length,
    contextCount: learnedBackupSpins.length,
    lastNumber,
    numberStats,
    hotNumbers,
    coldNumbers,
    anchorNumber,
    anchorNeighbors,
    topTransitions,
    colors: {
      red: redStat,
      black: blackStat,
      zeroCount,
      zeroPct,
    },
    parity: {
      even: evenStat,
      odd: oddStat,
    },
    halves: {
      low: lowStat,
      high: highStat,
    },
    dozens,
    columns,
    sectors,
    dominantSector,
    chipSuggestion,
    suggestedTargets,
  };
}

function buildChipSuggestion(
  profile: ChipStrategyProfile,
  anchorNeighbors: number[],
  transitionNums: number[],
  hotNums: number[],
  dominantSector: SectorStat | null,
  bankroll: BankrollConfig
): ChipSuggestion {
  let rawNums: number[] = [];
  let description = '';

  if (profile === 'VIZINHOS') {
    const set = new Set<number>([...anchorNeighbors, ...transitionNums.slice(0, 2)]);
    rawNums = Array.from(set).slice(0, 7);
    description = 'Vizinhos ±2 da Âncora + Top 2 transições Markov';
  } else if (profile === 'SETORES') {
    const secNums = dominantSector?.numbers ?? WHEEL_SECTORS['Jeu Zéro'];
    rawNums = secNums.slice(0, 8);
    description = `Cobertura direta do setor dominante (${dominantSector?.name ?? 'Jeu Zéro'})`;
  } else {
    const center3 = anchorNeighbors.slice(1, 4);
    const set = new Set<number>([...center3, ...hotNums.slice(0, 3), 0]);
    rawNums = Array.from(set).slice(0, 7);
    description = 'Equilibrado: 3 vizinhos centrais + 3 quentes + proteção 0';
  }

  if (rawNums.length === 0) {
    rawNums = [...EUROPEAN_WHEEL_SEQUENCE.slice(0, 5)];
  }

  const maxAllowedStake = Math.max(0, bankroll.currentBankroll * 0.25);
  const unit = Math.max(1, bankroll.baseUnit);
  let chipCount = rawNums.length;
  let capped = false;

  if (chipCount * unit > maxAllowedStake && maxAllowedStake > 0) {
    const maxChips = Math.max(1, Math.floor(maxAllowedStake / unit));
    if (maxChips < chipCount) {
      rawNums = rawNums.slice(0, maxChips);
      chipCount = rawNums.length;
      capped = true;
    }
  }

  const effectiveUnit =
    chipCount * unit > maxAllowedStake && maxAllowedStake > 0
      ? Math.floor(maxAllowedStake / Math.max(1, chipCount))
      : unit;

  if (effectiveUnit < unit) capped = true;

  return {
    profile,
    numbers: rawNums,
    chipCount,
    unitValue: effectiveUnit,
    totalStake: chipCount * effectiveUnit,
    cappedByBankroll: capped,
    description,
  };
}
