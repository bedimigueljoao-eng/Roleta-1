import {
  BankrollConfig,
  ConfidenceTier,
  MarketRegimeReport,
  MarketScoreCandidate,
  MasterBetDecision,
  RouletteAnalysis,
} from '../types/roulette';
import { EUROPEAN_HOUSE_EDGE_PCT } from './rouletteConstants';

function classifyTier(score: number): ConfidenceTier {
  if (score >= 70) return 'Alta';
  if (score >= 42) return 'Média';
  return 'Baixa';
}

export function computeMasterBet(
  analysis: RouletteAnalysis,
  regime: MarketRegimeReport,
  bankroll: BankrollConfig,
  ocrConfidence = 0.92
): MasterBetDecision {
  const n = analysis.totalCombined;
  // Fast minimum sample activates at >= 4 spins
  const sampleFactor = n < 4 ? 0 : Math.min(1, 0.58 + (n - 4) * 0.035);
  const ocrFactor = Math.min(1, Math.max(0.65, ocrConfidence));

  // 1. Score Cor
  const colorStreak = Math.max(
    analysis.colors.red.currentStreak,
    analysis.colors.black.currentStreak
  );
  const colorDelay = Math.max(
    analysis.colors.red.currentDelay,
    analysis.colors.black.currentDelay
  );
  const colorTotal = analysis.colors.red.totalHits + analysis.colors.black.totalHits;
  const colorDev =
    colorTotal > 0
      ? (Math.abs(analysis.colors.red.totalHits - analysis.colors.black.totalHits) /
          colorTotal) *
        40
      : 0;
  const corScore = Math.min(
    100,
    Math.round((28 + colorStreak * 8.5 + colorDelay * 3.5 + colorDev) * sampleFactor * ocrFactor)
  );

  // 2. Score Par / Ímpar
  const parityStreak = Math.max(
    analysis.parity.even.currentStreak,
    analysis.parity.odd.currentStreak
  );
  const parityDelay = Math.max(
    analysis.parity.even.currentDelay,
    analysis.parity.odd.currentDelay
  );
  const parityTotal = analysis.parity.even.totalHits + analysis.parity.odd.totalHits;
  const parityDev =
    parityTotal > 0
      ? (Math.abs(analysis.parity.even.totalHits - analysis.parity.odd.totalHits) /
          parityTotal) *
        38
      : 0;
  const paridadeScore = Math.min(
    100,
    Math.round((26 + parityStreak * 8 + parityDelay * 3.5 + parityDev) * sampleFactor * ocrFactor)
  );

  // 3. Score Dúzia em Atraso
  const maxDozDelay = Math.max(...analysis.dozens.map((d) => d.currentDelay));
  const minDozHits = Math.min(...analysis.dozens.map((d) => d.totalHits));
  const expectedDozHits = n / 3;
  const dozDev = n > 0 ? Math.max(0, (expectedDozHits - minDozHits) / Math.max(1, n)) * 45 : 0;
  const duziaScore = Math.min(
    100,
    Math.round((24 + maxDozDelay * 6.8 + dozDev) * sampleFactor * ocrFactor)
  );

  // 4. Score Vizinhos ±2
  const anchorStat =
    analysis.anchorNumber !== null ? analysis.numberStats[analysis.anchorNumber] : null;
  const anchorScoreRaw = anchorStat ? anchorStat.recencyScore : 0;
  const transitionStrength = analysis.topTransitions[0]?.count ?? 0;
  const vizinhosScore = Math.min(
    100,
    Math.round(
      (26 + anchorScoreRaw * 9.5 + transitionStrength * 7.5) * sampleFactor * ocrFactor
    )
  );

  const rawCandidates: MarketScoreCandidate[] = [
    {
      market: 'COR',
      label: 'Cor (Reversão)',
      targetLabel: analysis.suggestedTargets.COR.label,
      targetNumbers: analysis.suggestedTargets.COR.numbers,
      score: corScore,
    },
    {
      market: 'PARIDADE',
      label: 'Par / Ímpar',
      targetLabel: analysis.suggestedTargets.PARIDADE.label,
      targetNumbers: analysis.suggestedTargets.PARIDADE.numbers,
      score: paridadeScore,
    },
    {
      market: 'DUZIA',
      label: 'Dúzia em Atraso',
      targetLabel: analysis.suggestedTargets.DUZIA.label,
      targetNumbers: analysis.suggestedTargets.DUZIA.numbers,
      score: duziaScore,
    },
    {
      market: 'VIZINHOS',
      label: 'Âncora & Vizinhos ±2',
      targetLabel: analysis.suggestedTargets.VIZINHOS.label,
      targetNumbers: analysis.suggestedTargets.VIZINHOS.numbers,
      score: vizinhosScore,
    },
  ];
  const candidates = rawCandidates.sort((a, b) => b.score - a.score);

  const best = candidates[0];
  const tier = classifyTier(best.score);

  // Daily Stop-Loss / Stop-Win check
  const pnlPct =
    bankroll.initialBankroll > 0
      ? ((bankroll.currentBankroll - bankroll.initialBankroll) / bankroll.initialBankroll) * 100
      : 0;

  let blockReason: string | null = null;
  if (n < 4) {
    blockReason = `A aguardar amostra mínima rápida (${n}/4 giros lidos).`;
  } else if (pnlPct <= -bankroll.stopLossPct) {
    blockReason = `Stop-Loss diário atingido (${pnlPct.toFixed(1)}% ≤ -${bankroll.stopLossPct}%). Sessão protegida.`;
  } else if (pnlPct >= bankroll.stopWinPct) {
    blockReason = `Meta de Stop-Win atingida (+${pnlPct.toFixed(1)}% ≥ +${bankroll.stopWinPct}%). Lucro protegido.`;
  } else if (regime.isBlocked) {
    blockReason =
      regime.sampleSize < 12
        ? `NÃO APOSTAR — Amostra em consolidação (${regime.sampleSize}/12 rodadas para desbloqueio de entropia).`
        : `NÃO APOSTAR — IMPREVISIBILIDADE ELEVADA (${regime.unpredictabilityPct}% > ${bankroll.unpredictabilityThresholdPct}%).`;
  } else if (best.score < 50) {
    blockReason = `Sinal fraco (${best.score}/100 < 50). A aguardar confluência mais forte.`;
  }

  const action = blockReason === null && best.score >= 50 ? 'APOSTAR' : 'AGUARDAR';
  const unitMultiplier = action === 'AGUARDAR' ? 0 : best.score >= 75 ? 1.25 : 1.0;

  const isMultiChip = best.market === 'VIZINHOS';
  const rawStake = isMultiChip
    ? analysis.chipSuggestion.totalStake * (best.score >= 75 ? 1.25 : 1)
    : bankroll.baseUnit * unitMultiplier;

  const maxAllowed = bankroll.currentBankroll * 0.25;
  const recommendedStake =
    action === 'AGUARDAR' ? 0 : Math.min(rawStake, maxAllowed);

  return {
    action,
    tier,
    score: best.score,
    primaryMarket: best.market,
    targetLabel: best.targetLabel,
    targetNumbers: best.targetNumbers,
    unitMultiplier,
    recommendedStake,
    blockReason,
    candidates,
    houseEdgePct: EUROPEAN_HOUSE_EDGE_PCT,
  };
}
