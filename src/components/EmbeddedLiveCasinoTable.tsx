import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Play, RotateCw, Trash2 } from 'lucide-react';
import {
  BLACK_NUMBERS,
  EUROPEAN_WHEEL_SEQUENCE,
  formatCurrency,
  getDozen,
  getNumberColor,
  RED_NUMBERS,
} from '../engine/rouletteConstants';
import { CasinoLayoutPreset, CurrencyCode } from '../types/roulette';

interface EmbeddedLiveCasinoTableProps {
  activePreset: CasinoLayoutPreset;
  currency: CurrencyCode;
  casinoCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  onBetSettled?: (stake: number, payout: number, outcomeNum: number) => void;
}

type BetTargetKey =
  | `N_${number}`
  | 'RED'
  | 'BLACK'
  | 'EVEN'
  | 'ODD'
  | 'LOW'
  | 'HIGH'
  | 'DOZ1'
  | 'DOZ2'
  | 'DOZ3';

const CHIP_VALUES = [500, 1000, 2500, 5000, 10000];

const INITIAL_STRIP = [23, 8, 14, 36, 5, 29, 11, 21, 4, 19, 32, 0];

export const EmbeddedLiveCasinoTable: React.FC<EmbeddedLiveCasinoTableProps> = ({
  activePreset,
  currency,
  casinoCanvasRef,
  onBetSettled,
}) => {
  const [stripNumbers, setStripNumbers] = useState<number[]>(INITIAL_STRIP);
  const [selectedChip, setSelectedChip] = useState<number>(1000);
  const [placedBets, setPlacedBets] = useState<Partial<Record<BetTargetKey, number>>>({});
  const [isSpinning, setIsSpinning] = useState(false);
  const [autoSpin, setAutoSpin] = useState(false);
  const [lastOutcome, setLastOutcome] = useState<{
    num: number;
    won: number;
    staked: number;
  } | null>(null);
  const [multipliers, setMultipliers] = useState<Record<number, number>>({
    17: 100,
    23: 50,
    0: 250,
  });

  // Render the top casino video/history strip canvas in real time so OCR reads exact pixels
  const drawCasinoStripCanvas = useCallback(() => {
    const canvas = casinoCanvasRef.current;
    if (!canvas) return;
    canvas.width = 960;
    canvas.height = 112;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Dark casino stream bar background
    ctx.fillStyle = '#080C14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Subtle header separator
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(0, 0, canvas.width, 20);
    ctx.fillStyle = '#94A3B8';
    ctx.font = '600 11px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      `Stream Mesa Europeia · ${activePreset.name}${
        activePreset.multiplierMode ? ' · Lightning' : ''
      }`,
      14,
      10
    );

    const cellsCount = activePreset.expectedCells;
    const stripX = 14;
    const stripY = 26;
    const stripW = canvas.width - 28;
    const stripH = 76;
    const cellW = stripW / cellsCount;

    const visibleNums = activePreset.newestOnLeft
      ? stripNumbers.slice(0, cellsCount)
      : [...stripNumbers.slice(0, cellsCount)].reverse();

    for (let i = 0; i < visibleNums.length; i++) {
      const num = visibleNums[i];
      const color = getNumberColor(num);
      const pad = 4;
      const px = stripX + i * cellW + pad;
      const py = stripY + pad;
      const pw = cellW - pad * 2;
      const ph = activePreset.multiplierMode ? stripH * 0.64 - pad : stripH - pad * 2;

      ctx.fillStyle =
        color === 'GREEN' ? '#15803D' : color === 'RED' ? '#B91C1C' : '#18181B';
      ctx.beginPath();
      ctx.roundRect(px, py, pw, ph, 6);
      ctx.fill();

      const isNewest = activePreset.newestOnLeft
        ? i === 0
        : i === visibleNums.length - 1;
      if (isNewest) {
        ctx.strokeStyle = '#FBBF24';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      ctx.fillStyle = '#FFFFFF';
      ctx.font = `700 ${Math.max(18, Math.round(ph * 0.56))}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(num), px + pw / 2, py + ph / 2 + 1);

      // Lightning / Inferno sub-badge when multiplier mode is active
      if (activePreset.multiplierMode && multipliers[num]) {
        ctx.fillStyle = '#CA8A04';
        ctx.fillRect(px + 3, py + ph + 3, pw - 6, stripH * 0.25);
        ctx.fillStyle = '#FEF08A';
        ctx.font = '700 11px "JetBrains Mono", monospace';
        ctx.fillText(`${multipliers[num]}x`, px + pw / 2, py + ph + stripH * 0.15);
      }
    }
  }, [activePreset, casinoCanvasRef, multipliers, stripNumbers]);

  useEffect(() => {
    drawCasinoStripCanvas();
  }, [drawCasinoStripCanvas]);

  const placeBet = (key: BetTargetKey) => {
    if (isSpinning) return;
    setPlacedBets((prev) => ({
      ...prev,
      [key]: (prev[key] ?? 0) + selectedChip,
    }));
  };

  const clearBets = () => {
    if (isSpinning) return;
    setPlacedBets({});
  };

  const totalStake = Object.values(placedBets).reduce<number>(
    (acc, v) => acc + (v ?? 0),
    0
  );

  const settleBetsForOutcome = useCallback(
    (outcome: number, currentBets: Partial<Record<BetTargetKey, number>>) => {
      let totalReturn = 0;
      let staked = 0;

      for (const [k, amt] of Object.entries(currentBets)) {
        const betAmt = amt ?? 0;
        if (betAmt <= 0) continue;
        staked += betAmt;

        if (k.startsWith('N_')) {
          const targetNum = Number(k.slice(2));
          if (targetNum === outcome) {
            const mult =
              activePreset.multiplierMode && multipliers[outcome]
                ? multipliers[outcome]
                : 35;
            totalReturn += betAmt * (mult + 1);
          }
        } else if (k === 'RED' && RED_NUMBERS.has(outcome)) {
          totalReturn += betAmt * 2;
        } else if (k === 'BLACK' && BLACK_NUMBERS.has(outcome)) {
          totalReturn += betAmt * 2;
        } else if (k === 'EVEN' && outcome > 0 && outcome % 2 === 0) {
          totalReturn += betAmt * 2;
        } else if (k === 'ODD' && outcome > 0 && outcome % 2 === 1) {
          totalReturn += betAmt * 2;
        } else if (k === 'LOW' && outcome >= 1 && outcome <= 18) {
          totalReturn += betAmt * 2;
        } else if (k === 'HIGH' && outcome >= 19 && outcome <= 36) {
          totalReturn += betAmt * 2;
        } else if (k === 'DOZ1' && getDozen(outcome) === 1) {
          totalReturn += betAmt * 3;
        } else if (k === 'DOZ2' && getDozen(outcome) === 2) {
          totalReturn += betAmt * 3;
        } else if (k === 'DOZ3' && getDozen(outcome) === 3) {
          totalReturn += betAmt * 3;
        }
      }

      return { totalReturn, staked };
    },
    [activePreset.multiplierMode, multipliers]
  );

  const spinWheel = useCallback(() => {
    if (isSpinning) return;
    setIsSpinning(true);

    // Refresh random lightning multipliers before ball lands
    if (activePreset.multiplierMode) {
      const mPool = [50, 100, 150, 200, 250, 500];
      const nextMults: Record<number, number> = {};
      for (let i = 0; i < 3; i++) {
        const n = EUROPEAN_WHEEL_SEQUENCE[Math.floor(Math.random() * 37)];
        nextMults[n] = mPool[Math.floor(Math.random() * mPool.length)];
      }
      setMultipliers(nextMults);
    }

    const betsSnapshot = { ...placedBets };
    window.setTimeout(() => {
      const outcome =
        EUROPEAN_WHEEL_SEQUENCE[
          Math.floor(Math.random() * EUROPEAN_WHEEL_SEQUENCE.length)
        ];
      const { totalReturn, staked } = settleBetsForOutcome(outcome, betsSnapshot);

      setStripNumbers((prev) => [outcome, ...prev.slice(0, 19)]);
      setLastOutcome({ num: outcome, won: totalReturn, staked });
      if (staked > 0) {
        onBetSettled?.(staked, totalReturn, outcome);
      }
      setIsSpinning(false);
    }, 650);
  }, [activePreset.multiplierMode, isSpinning, onBetSettled, placedBets, settleBetsForOutcome]);

  useEffect(() => {
    if (!autoSpin) return;
    const id = window.setInterval(() => {
      spinWheel();
    }, 5500);
    return () => window.clearInterval(id);
  }, [autoSpin, spinWheel]);

  const betRows = [
    [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36],
    [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35],
    [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34],
  ];

  return (
    <div className="w-full h-full flex flex-col bg-[#080C14] text-slate-100 overflow-y-auto">
      {/* Live Casino History Strip Canvas (OCR reads this exact region via ROI) */}
      <div className="w-full border-b border-slate-800/90 bg-[#080C14]">
        <canvas
          ref={casinoCanvasRef}
          className="w-full h-[96px] sm:h-[112px] block object-fill"
        />
      </div>

      {/* Interactive Casino Betting Area inside Embedded Browser */}
      <div className="flex-1 p-3 sm:p-4 space-y-3 bg-gradient-to-b from-[#0A1612] to-[#080C14]">
        {/* Chip Selector & Spin Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-400 mr-1">Fichas:</span>
            {CHIP_VALUES.map((val) => (
              <button
                key={val}
                type="button"
                onClick={() => setSelectedChip(val)}
                className={`px-2 py-1 rounded-full font-mono text-[11px] font-semibold border transition-colors cursor-pointer ${
                  selectedChip === val
                    ? 'bg-amber-500 text-slate-950 border-amber-300'
                    : 'bg-slate-900 text-slate-200 border-slate-700 hover:border-slate-500'
                }`}
              >
                {val >= 1000 ? `${val / 1000}k` : val}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {lastOutcome && (
              <span className="text-xs font-mono text-slate-300">
                Saiu{' '}
                <strong
                  className={
                    getNumberColor(lastOutcome.num) === 'GREEN'
                      ? 'text-emerald-400'
                      : getNumberColor(lastOutcome.num) === 'RED'
                      ? 'text-red-400'
                      : 'text-white'
                  }
                >
                  {lastOutcome.num}
                </strong>
                {lastOutcome.staked > 0 && (
                  <span
                    className={
                      lastOutcome.won > 0 ? 'text-emerald-400 ml-1.5' : 'text-red-400 ml-1.5'
                    }
                  >
                    ({lastOutcome.won > 0
                      ? `+${formatCurrency(lastOutcome.won, currency)}`
                      : `-${formatCurrency(lastOutcome.staked, currency)}`})
                  </span>
                )}
              </span>
            )}

            <span className="text-xs font-mono text-amber-300">
              Aposta: {formatCurrency(totalStake, currency)}
            </span>

            <button
              type="button"
              onClick={clearBets}
              disabled={isSpinning || totalStake === 0}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-xs text-slate-300 cursor-pointer"
            >
              <Trash2 className="w-3 h-3" />
              Limpar
            </button>

            <button
              type="button"
              onClick={() => setAutoSpin((a) => !a)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded border text-xs font-medium cursor-pointer ${
                autoSpin
                  ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300'
                  : 'border-slate-700 bg-slate-900 text-slate-300'
              }`}
            >
              <RotateCw className={`w-3 h-3 ${autoSpin ? 'animate-spin' : ''}`} />
              Auto-Giro
            </button>

            <button
              type="button"
              onClick={spinWheel}
              disabled={isSpinning}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-semibold text-white cursor-pointer"
            >
              <Play className="w-3 h-3" />
              {isSpinning ? 'A Girar...' : 'Girar Roleta'}
            </button>
          </div>
        </div>

        {/* Clickable Betting Felt inside the Embedded Browser */}
        <div className="overflow-x-auto">
          <div className="min-w-[540px] space-y-1 select-none">
            <div className="grid grid-cols-[44px_1fr] border border-emerald-900/70 rounded overflow-hidden">
              <button
                type="button"
                onClick={() => placeBet('N_0')}
                className="relative flex items-center justify-center bg-emerald-800/80 hover:bg-emerald-700 border-r border-emerald-900/70 font-mono text-sm font-bold text-white cursor-pointer"
              >
                0
                {(placedBets['N_0'] ?? 0) > 0 && (
                  <span className="absolute bottom-1 px-1 rounded bg-amber-400 text-[9px] text-slate-950 font-bold">
                    {placedBets['N_0']}
                  </span>
                )}
              </button>

              <div className="grid grid-cols-12">
                {betRows.flat().map((num) => {
                  const col = getNumberColor(num);
                  const betVal = placedBets[`N_${num}`] ?? 0;
                  return (
                    <button
                      key={num}
                      type="button"
                      onClick={() => placeBet(`N_${num}`)}
                      className={`relative h-9 flex items-center justify-center border border-emerald-950/70 font-mono text-xs font-semibold text-white cursor-pointer transition-colors ${
                        col === 'RED'
                          ? 'bg-red-800/85 hover:bg-red-700'
                          : 'bg-slate-900/90 hover:bg-slate-800'
                      }`}
                    >
                      {num}
                      {betVal > 0 && (
                        <span className="absolute -top-0.5 right-0.5 px-1 rounded-sm bg-amber-400 text-[8px] font-bold text-slate-950">
                          {betVal >= 1000 ? `${betVal / 1000}k` : betVal}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Dozens & Even-money outside bets */}
            <div className="grid grid-cols-[44px_1fr]">
              <div />
              <div className="space-y-1">
                <div className="grid grid-cols-3 gap-1">
                  {(
                    [
                      ['DOZ1', '1ª Dúzia (1–12)'],
                      ['DOZ2', '2ª Dúzia (13–24)'],
                      ['DOZ3', '3ª Dúzia (25–36)'],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => placeBet(key)}
                      className="h-7 rounded border border-emerald-900/70 bg-slate-900/80 hover:bg-slate-800 text-[11px] font-medium text-slate-200 flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <span>{label}</span>
                      {(placedBets[key] ?? 0) > 0 && (
                        <span className="px-1 rounded bg-amber-400 text-[9px] font-mono font-bold text-slate-950">
                          {placedBets[key]}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-6 gap-1">
                  {(
                    [
                      ['LOW', '1–18', 'bg-slate-900/80'],
                      ['EVEN', 'Par', 'bg-slate-900/80'],
                      ['RED', 'Vermelho', 'bg-red-900/80'],
                      ['BLACK', 'Preto', 'bg-slate-950'],
                      ['ODD', 'Ímpar', 'bg-slate-900/80'],
                      ['HIGH', '19–36', 'bg-slate-900/80'],
                    ] as const
                  ).map(([key, label, bg]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => placeBet(key)}
                      className={`h-7 rounded border border-emerald-900/70 ${bg} hover:brightness-125 text-[11px] font-medium text-slate-100 flex items-center justify-center gap-1 cursor-pointer`}
                    >
                      <span>{label}</span>
                      {(placedBets[key] ?? 0) > 0 && (
                        <span className="px-1 rounded bg-amber-400 text-[9px] font-mono font-bold text-slate-950">
                          {placedBets[key]}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
