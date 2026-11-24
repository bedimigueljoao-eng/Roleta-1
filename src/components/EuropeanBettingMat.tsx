import React from 'react';
import {
  formatCurrency,
  getNumberColor,
  WHEEL_SECTORS,
} from '../engine/rouletteConstants';
import {
  ChipSuggestion,
  CurrencyCode,
  MasterBetDecision,
  SectorName,
} from '../types/roulette';

interface EuropeanBettingMatProps {
  lastNumber: number | null;
  masterBet: MasterBetDecision;
  chipSuggestion: ChipSuggestion;
  dominantSectorName: SectorName | null;
  currency: CurrencyCode;
  onNumberClick: (num: number) => void;
}

// Standard European table rows (top row: 3,6..36; middle: 2,5..35; bottom: 1,4..34)
const TABLE_ROWS: number[][] = [
  [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36],
  [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35],
  [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34],
];

export const EuropeanBettingMat: React.FC<EuropeanBettingMatProps> = ({
  lastNumber,
  masterBet,
  chipSuggestion,
  dominantSectorName,
  currency,
  onNumberClick,
}) => {
  const chipSet = new Set(chipSuggestion.numbers);
  const masterSet = new Set(masterBet.targetNumbers);
  const isTargetHighlighted = (num: number) => masterSet.has(num);

  const renderNumberCell = (num: number) => {
    const color = getNumberColor(num);
    const hasChip = chipSet.has(num);
    const isMaster = isTargetHighlighted(num);
    const isLast = lastNumber === num;

    const bgClass =
      color === 'GREEN'
        ? 'bg-emerald-800/80 hover:bg-emerald-700'
        : color === 'RED'
        ? 'bg-red-800/85 hover:bg-red-700'
        : 'bg-slate-900 hover:bg-slate-800';

    const ringClass = isLast
      ? 'ring-2 ring-amber-400 ring-inset'
      : hasChip
      ? 'ring-2 ring-emerald-400 ring-inset'
      : isMaster
      ? 'ring-1 ring-sky-400/80 ring-inset'
      : '';

    return (
      <button
        key={num}
        type="button"
        onClick={() => onNumberClick(num)}
        title={`Registar número ${num}`}
        className={`relative h-11 flex items-center justify-center border border-slate-700/70 text-sm font-mono font-semibold text-slate-100 transition-colors cursor-pointer select-none ${bgClass} ${ringClass}`}
      >
        <span>{num}</span>
        {hasChip && (
          <span
            className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 border border-slate-950"
            aria-label="Ficha sugerida"
          />
        )}
      </button>
    );
  };

  const outsideLabelActive = (label: string) =>
    masterBet.action === 'APOSTAR' &&
    masterBet.targetLabel.toLowerCase().includes(label.toLowerCase());

  return (
    <div className="w-full space-y-3">
      {/* Betting Felt Grid */}
      <div className="overflow-x-auto pb-1">
        <div className="min-w-[560px] select-none">
          <div className="grid grid-cols-[52px_1fr_52px] gap-0 border border-slate-700/80 rounded-lg overflow-hidden bg-[#0B121E]">
            {/* Zero Column */}
            <button
              type="button"
              onClick={() => onNumberClick(0)}
              title="Registar número 0"
              className={`relative flex items-center justify-center border-r border-slate-700/80 bg-emerald-800/80 hover:bg-emerald-700 text-base font-mono font-bold text-white cursor-pointer transition-colors ${
                lastNumber === 0
                  ? 'ring-2 ring-amber-400 ring-inset'
                  : chipSet.has(0)
                  ? 'ring-2 ring-emerald-400 ring-inset'
                  : ''
              }`}
            >
              0
              {chipSet.has(0) && (
                <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border border-slate-950" />
              )}
            </button>

            {/* 3x12 Main Grid */}
            <div className="grid grid-cols-12">
              {TABLE_ROWS.flat().map((num) => renderNumberCell(num))}
            </div>

            {/* 2:1 Columns */}
            <div className="grid grid-rows-3 border-l border-slate-700/80">
              {[3, 2, 1].map((colIdx) => {
                const active = outsideLabelActive(`Coluna ${colIdx}`);
                return (
                  <div
                    key={colIdx}
                    className={`h-11 flex items-center justify-center border-b last:border-b-0 border-slate-700/70 text-xs font-mono ${
                      active
                        ? 'bg-emerald-500/20 text-emerald-300 font-semibold'
                        : 'bg-slate-900/60 text-slate-400'
                    }`}
                  >
                    C{colIdx}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Dozens Row */}
          <div className="grid grid-cols-[52px_1fr_52px] mt-1">
            <div />
            <div className="grid grid-cols-3 gap-1">
              {[
                { label: '1ª Dúzia (1–12)', key: '1ª Dúzia' },
                { label: '2ª Dúzia (13–24)', key: '2ª Dúzia' },
                { label: '3ª Dúzia (25–36)', key: '3ª Dúzia' },
              ].map((d) => {
                const active = outsideLabelActive(d.key);
                return (
                  <div
                    key={d.key}
                    className={`h-9 flex items-center justify-center rounded border text-xs font-medium transition-colors ${
                      active
                        ? 'border-emerald-500/70 bg-emerald-500/15 text-emerald-300'
                        : 'border-slate-800 bg-slate-900/50 text-slate-400'
                    }`}
                  >
                    {d.label}
                  </div>
                );
              })}
            </div>
            <div />
          </div>

          {/* Even Money Outside Bets Row */}
          <div className="grid grid-cols-[52px_1fr_52px] mt-1">
            <div />
            <div className="grid grid-cols-6 gap-1">
              {[
                { label: '1–18', match: '1–18' },
                { label: 'Par', match: 'Par' },
                { label: 'Vermelho', match: 'Vermelho', colorCls: 'text-red-400' },
                { label: 'Preto', match: 'Preto', colorCls: 'text-slate-200' },
                { label: 'Ímpar', match: 'Ímpar' },
                { label: '19–36', match: '19–36' },
              ].map((item) => {
                const active = outsideLabelActive(item.match);
                return (
                  <div
                    key={item.label}
                    className={`h-9 flex items-center justify-center rounded border text-xs font-medium ${
                      active
                        ? 'border-emerald-500/70 bg-emerald-500/15 text-emerald-300 font-semibold'
                        : `border-slate-800 bg-slate-900/50 ${item.colorCls ?? 'text-slate-400'}`
                    }`}
                  >
                    {item.label}
                  </div>
                );
              })}
            </div>
            <div />
          </div>
        </div>
      </div>

      {/* Racetrack Sectors & Chip Placement Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-800/80">
        <div>
          <p className="text-xs text-slate-400 mb-1.5">Setores da Roda (Racetrack)</p>
          <div className="grid grid-cols-2 gap-1.5">
            {(Object.keys(WHEEL_SECTORS) as SectorName[]).map((sector) => {
              const isDom = dominantSectorName === sector;
              return (
                <div
                  key={sector}
                  className={`px-2.5 py-1.5 rounded border text-xs flex items-center justify-between ${
                    isDom
                      ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300'
                      : 'border-slate-800 bg-slate-900/40 text-slate-400'
                  }`}
                >
                  <span className="truncate">{sector}</span>
                  <span className="font-mono text-[11px] text-slate-500 ml-1">
                    {WHEEL_SECTORS[sector].length}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col justify-between bg-slate-900/50 border border-slate-800 rounded-lg px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-400">
              Fichas Sugeridas ({chipSuggestion.profile})
            </span>
            <span className="text-xs font-mono text-emerald-400 font-semibold">
              {chipSuggestion.chipCount} fichas · {formatCurrency(chipSuggestion.totalStake, currency)}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5 font-mono text-xs">
            {chipSuggestion.numbers.map((n) => {
              const c = getNumberColor(n);
              return (
                <span
                  key={n}
                  className={`w-6 h-6 inline-flex items-center justify-center rounded text-[11px] font-semibold ${
                    c === 'GREEN'
                      ? 'bg-emerald-700 text-white'
                      : c === 'RED'
                      ? 'bg-red-700 text-white'
                      : 'bg-slate-800 text-slate-100 border border-slate-700'
                  }`}
                >
                  {n}
                </span>
              );
            })}
          </div>
          <p className="mt-1.5 text-[11px] text-slate-400 leading-snug">
            {chipSuggestion.description}
            {chipSuggestion.cappedByBankroll && ' (Limitado a 25% da banca)'}
          </p>
        </div>
      </div>
    </div>
  );
};
