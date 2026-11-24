import {
  BankrollConfig,
  MarketAccuracyMetric,
  MarketId,
  SpinEntry,
  SpinMarketEvaluation,
  WalkForwardSummary,
} from '../types/roulette';
import { ALL_MARKETS, MARKET_LABELS } from './rouletteConstants';
import { analyzeRoulette } from './rouletteEngine';

const DEFAULT_BANKROLL: BankrollConfig = {
  initialBankroll: 100000,
  currentBankroll: 100000,
  baseUnit: 1000,
  stopLossPct: 15,
  stopWinPct: 25,
  currency: 'AOA',
  unpredictabilityThresholdPct: 60,
  strategyProfile: 'VIZINHOS',
};

/**
 * Evaluates a single outcome number against the 7 market target sets that were active BEFORE the spin.
 */
export function evaluateTargetsAgainstNumber(
  targetsBeforeSpin: Record<MarketId, { label: string; numbers: number[] }>,
  outcomeNumber: number,
  primaryMarket: MarketId = 'COR'
): SpinMarketEvaluation {
  const results = {} as Record<MarketId, boolean | null>;

  for (const m of ALL_MARKETS) {
    const targetNums = targetsBeforeSpin[m]?.numbers ?? [];
    if (targetNums.length === 0) {
      results[m] = null;
    } else {
      results[m] = targetNums.includes(outcomeNumber);
    }
  }

  return {
    results,
    primaryHit: results[primaryMarket] ?? null,
  };
}

/**
 * Immediate 0-second Walk-Forward Backtest on the table strip (up to last 30 numbers).
 * Strictly chronological: for each spin i, predicts using only 0..i-1 (zero future leakage).
 */
export function computeImmediateTableBacktest(
  learnedBackupSpins: SpinEntry[],
  maxLookback = 30
): {
  tableHits: number;
  tableAttempts: number;
  tableAccuracyPct: number;
  tablePerMarket: MarketAccuracyMetric[];
} {
  // learnedBackupSpins has index 0 = newest. Reverse to chronological oldest -> newest.
  const chronological = [...learnedBackupSpins].slice(0, maxLookback).reverse();

  const hitsByMarket: Record<MarketId, number> = {
    COR: 0,
    PARIDADE: 0,
    ALTO_BAIXO: 0,
    DUZIA: 0,
    COLUNA: 0,
    VIZINHOS: 0,
    SETOR: 0,
  };
  const attemptsByMarket: Record<MarketId, number> = {
    COR: 0,
    PARIDADE: 0,
    ALTO_BAIXO: 0,
    DUZIA: 0,
    COLUNA: 0,
    VIZINHOS: 0,
    SETOR: 0,
  };

  // Need at least 3 prior numbers before testing index i
  if (chronological.length >= 4) {
    for (let i = 3; i < chronological.length; i++) {
      // History prior to i, formatted newest-first
      const priorNewestFirst = chronological.slice(0, i).reverse();
      const analysisBefore = analyzeRoulette([], priorNewestFirst, DEFAULT_BANKROLL);
      const outcome = chronological[i].number;
      const evalRes = evaluateTargetsAgainstNumber(analysisBefore.suggestedTargets, outcome);

      for (const m of ALL_MARKETS) {
        const res = evalRes.results[m];
        if (res !== null) {
          attemptsByMarket[m]++;
          if (res) hitsByMarket[m]++;
        }
      }
    }
  }

  let tableHits = 0;
  let tableAttempts = 0;
  const tablePerMarket: MarketAccuracyMetric[] = ALL_MARKETS.map((m) => {
    const h = hitsByMarket[m];
    const a = attemptsByMarket[m];
    tableHits += h;
    tableAttempts += a;
    return {
      market: m,
      label: MARKET_LABELS[m],
      hits: h,
      attempts: a,
      accuracyPct: a > 0 ? (h / a) * 100 : 0,
    };
  });

  return {
    tableHits,
    tableAttempts,
    tableAccuracyPct: tableAttempts > 0 ? (tableHits / tableAttempts) * 100 : 0,
    tablePerMarket,
  };
}

/**
 * Combines 0s Table Walk-Forward Backtest with Live Session Walk-Forward Evaluations.
 */
export function buildWalkForwardSummary(
  sessionSpins: SpinEntry[],
  learnedBackupSpins: SpinEntry[]
): WalkForwardSummary {
  const tableRes = computeImmediateTableBacktest(learnedBackupSpins, 30);

  const sessionHitsByMarket: Record<MarketId, number> = {
    COR: 0,
    PARIDADE: 0,
    ALTO_BAIXO: 0,
    DUZIA: 0,
    COLUNA: 0,
    VIZINHOS: 0,
    SETOR: 0,
  };
  const sessionAttemptsByMarket: Record<MarketId, number> = {
    COR: 0,
    PARIDADE: 0,
    ALTO_BAIXO: 0,
    DUZIA: 0,
    COLUNA: 0,
    VIZINHOS: 0,
    SETOR: 0,
  };

  for (const spin of sessionSpins) {
    if (!spin.evaluation) continue;
    for (const m of ALL_MARKETS) {
      const val = spin.evaluation.results[m];
      if (val !== null && val !== undefined) {
        sessionAttemptsByMarket[m]++;
        if (val) sessionHitsByMarket[m]++;
      }
    }
  }

  let sessionHits = 0;
  let sessionAttempts = 0;
  const sessionPerMarket: MarketAccuracyMetric[] = ALL_MARKETS.map((m) => {
    const h = sessionHitsByMarket[m];
    const a = sessionAttemptsByMarket[m];
    sessionHits += h;
    sessionAttempts += a;
    return {
      market: m,
      label: MARKET_LABELS[m],
      hits: h,
      attempts: a,
      accuracyPct: a > 0 ? (h / a) * 100 : 0,
    };
  });

  return {
    ...tableRes,
    sessionHits,
    sessionAttempts,
    sessionAccuracyPct: sessionAttempts > 0 ? (sessionHits / sessionAttempts) * 100 : 0,
    sessionPerMarket,
  };
}
