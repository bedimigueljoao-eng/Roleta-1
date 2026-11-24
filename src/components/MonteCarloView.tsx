import React, { useMemo, useState } from 'react';
import { Play } from 'lucide-react';
import { runMonteCarloComparison } from '../engine/monteCarloSimulator';
import { EUROPEAN_HOUSE_EDGE_PCT, formatCurrency } from '../engine/rouletteConstants';
import {
  CurrencyCode,
  MonteCarloConfig,
  StrategySimResult,
} from '../types/roulette';

interface MonteCarloViewProps {
  currency: CurrencyCode;
  defaultBankroll: number;
  defaultUnit: number;
  defaultStopLossPct: number;
  defaultStopWinPct: number;
}

const STRATEGY_COLORS = ['#10B981', '#38BDF8', '#F59E0B'];

export const MonteCarloView: React.FC<MonteCarloViewProps> = ({
  currency,
  defaultBankroll,
  defaultUnit,
  defaultStopLossPct,
  defaultStopWinPct,
}) => {
  const [config, setConfig] = useState<MonteCarloConfig>({
    initialBankroll: defaultBankroll,
    baseUnit: defaultUnit,
    spinsPerSession: 120,
    simulations: 400,
    stopLossPct: defaultStopLossPct,
    stopWinPct: defaultStopWinPct,
    tableMaxBet: defaultUnit * 32,
    betType: 'EVEN_MONEY',
  });

  const [seedTick, setSeedTick] = useState(0);

  const results: StrategySimResult[] = useMemo(() => {
    void seedTick;
    return runMonteCarloComparison(config);
  }, [config, seedTick]);

  // Build multi-line SVG chart for median trajectories
  const chartW = 760;
  const chartH = 240;
  const padX = 52;
  const padY = 24;

  const allY = results.flatMap((r) => r.sampleTrajectory);
  const minY = Math.min(...allY, config.initialBankroll * (1 - config.stopLossPct / 100));
  const maxY = Math.max(...allY, config.initialBankroll * (1 + config.stopWinPct / 100));
  const spanY = Math.max(1, maxY - minY);

  const toPoints = (arr: number[]) =>
    arr
      .map((val, idx) => {
        const x =
          padX + (arr.length > 1 ? (idx / (arr.length - 1)) * (chartW - padX * 2) : 0);
        const y = chartH - padY - ((val - minY) / spanY) * (chartH - padY * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

  const initY =
    chartH -
    padY -
    ((config.initialBankroll - minY) / spanY) * (chartH - padY * 2);

  return (
    <div className="space-y-6">
      <div className="bg-[#111827] border border-slate-800 rounded-xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Simulador Monte Carlo Anti-Ruína (Roleta Europeia · House Edge {EUROPEAN_HOUSE_EDGE_PCT.toFixed(2)}%)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Compara Flat Betting, D&apos;Alembert e Martingale com Teto para quantificar o impacto matemático do Zero (1/37) antes de jogar.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSeedTick((t) => t + 1)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white cursor-pointer whitespace-nowrap"
          >
            <Play className="w-3.5 h-3.5" />
            Executar Simulação ({config.simulations}×)
          </button>
        </div>

        {/* Simulation Parameters */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 text-xs">
          <label className="bg-slate-900/70 border border-slate-800 rounded-lg px-3 py-2">
            <span className="text-slate-400 block">Banca Inicial</span>
            <input
              type="number"
              min={100}
              value={config.initialBankroll}
              onChange={(e) =>
                setConfig((c) => ({ ...c, initialBankroll: Math.max(100, Number(e.target.value) || 100) }))
              }
              className="mt-1 w-full bg-transparent font-mono text-slate-100 focus:outline-none"
            />
          </label>
          <label className="bg-slate-900/70 border border-slate-800 rounded-lg px-3 py-2">
            <span className="text-slate-400 block">Unidade Base</span>
            <input
              type="number"
              min={1}
              value={config.baseUnit}
              onChange={(e) =>
                setConfig((c) => ({ ...c, baseUnit: Math.max(1, Number(e.target.value) || 1) }))
              }
              className="mt-1 w-full bg-transparent font-mono text-slate-100 focus:outline-none"
            />
          </label>
          <label className="bg-slate-900/70 border border-slate-800 rounded-lg px-3 py-2">
            <span className="text-slate-400 block">Teto da Mesa</span>
            <input
              type="number"
              min={config.baseUnit}
              value={config.tableMaxBet}
              onChange={(e) =>
                setConfig((c) => ({ ...c, tableMaxBet: Math.max(c.baseUnit, Number(e.target.value) || c.baseUnit) }))
              }
              className="mt-1 w-full bg-transparent font-mono text-slate-100 focus:outline-none"
            />
          </label>
          <label className="bg-slate-900/70 border border-slate-800 rounded-lg px-3 py-2">
            <span className="text-slate-400 block">Giros / Sessão</span>
            <input
              type="number"
              min={20}
              max={500}
              value={config.spinsPerSession}
              onChange={(e) =>
                setConfig((c) => ({
                  ...c,
                  spinsPerSession: Math.max(20, Math.min(500, Number(e.target.value) || 100)),
                }))
              }
              className="mt-1 w-full bg-transparent font-mono text-slate-100 focus:outline-none"
            />
          </label>
          <label className="bg-slate-900/70 border border-slate-800 rounded-lg px-3 py-2">
            <span className="text-slate-400 block">Stop-Loss (%)</span>
            <input
              type="number"
              min={5}
              max={95}
              value={config.stopLossPct}
              onChange={(e) =>
                setConfig((c) => ({
                  ...c,
                  stopLossPct: Math.max(5, Math.min(95, Number(e.target.value) || 15)),
                }))
              }
              className="mt-1 w-full bg-transparent font-mono text-slate-100 focus:outline-none"
            />
          </label>
          <label className="bg-slate-900/70 border border-slate-800 rounded-lg px-3 py-2">
            <span className="text-slate-400 block">Stop-Win (%)</span>
            <input
              type="number"
              min={5}
              max={200}
              value={config.stopWinPct}
              onChange={(e) =>
                setConfig((c) => ({
                  ...c,
                  stopWinPct: Math.max(5, Math.min(200, Number(e.target.value) || 25)),
                }))
              }
              className="mt-1 w-full bg-transparent font-mono text-slate-100 focus:outline-none"
            />
          </label>
          <label className="bg-slate-900/70 border border-slate-800 rounded-lg px-3 py-2">
            <span className="text-slate-400 block">Mercado</span>
            <select
              value={config.betType}
              onChange={(e) =>
                setConfig((c) => ({
                  ...c,
                  betType: e.target.value as MonteCarloConfig['betType'],
                }))
              }
              className="mt-1 w-full bg-slate-900 text-slate-100 focus:outline-none"
            >
              <option value="EVEN_MONEY">Cor / Par (18/37)</option>
              <option value="DOZEN">Dúzia (12/37)</option>
              <option value="STRAIGHT_NEIGHBORS_5">5 Vizinhos (5/37)</option>
            </select>
          </label>
        </div>
      </div>

      {/* Median Equity Trajectory SVG */}
      <div className="bg-[#111827] border border-slate-800 rounded-xl p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-100">
            Trajetória Mediana de Banca ao Longo de {config.spinsPerSession} Giros
          </h3>
          <div className="flex flex-wrap items-center gap-4 text-xs">
            {results.map((r, i) => (
              <span key={r.strategyName} className="flex items-center gap-1.5 text-slate-300">
                <span
                  className="inline-block w-3 h-0.5"
                  style={{ backgroundColor: STRATEGY_COLORS[i] }}
                />
                {r.strategyName}
              </span>
            ))}
          </div>
        </div>

        <div className="w-full overflow-x-auto">
          <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full h-60 select-none">
            <line
              x1={padX}
              y1={initY}
              x2={chartW - padX}
              y2={initY}
              stroke="#475569"
              strokeDasharray="4 4"
              strokeWidth="1"
            />
            {results.map((r, i) => (
              <polyline
                key={r.strategyName}
                fill="none"
                stroke={STRATEGY_COLORS[i]}
                strokeWidth="2.2"
                points={toPoints(r.sampleTrajectory)}
              />
            ))}
            <text
              x={6}
              y={padY + 4}
              fill="#94A3B8"
              fontSize="10"
              fontFamily="JetBrains Mono, monospace"
            >
              {formatCurrency(maxY, currency)}
            </text>
            <text
              x={6}
              y={initY + 3}
              fill="#CBD5E1"
              fontSize="10"
              fontFamily="JetBrains Mono, monospace"
            >
              Inicial
            </text>
            <text
              x={6}
              y={chartH - padY}
              fill="#94A3B8"
              fontSize="10"
              fontFamily="JetBrains Mono, monospace"
            >
              {formatCurrency(minY, currency)}
            </text>
          </svg>
        </div>
      </div>

      {/* Comparison Matrix */}
      <div className="bg-[#111827] border border-slate-800 rounded-xl p-4 sm:p-5 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400">
              <th className="py-2.5 text-left font-medium">Estratégia</th>
              <th className="py-2.5 text-right font-medium">Prob. Ruína / Stop-Loss</th>
              <th className="py-2.5 text-right font-medium">Prob. Stop-Win</th>
              <th className="py-2.5 text-right font-medium">Saldo Médio Final</th>
              <th className="py-2.5 text-right font-medium">Drawdown Máx. Médio</th>
              <th className="py-2.5 text-right font-medium">Retorno Esperado (EV)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {results.map((r, idx) => (
              <tr key={r.strategyName} className="hover:bg-slate-900/40">
                <td className="py-3 font-medium text-slate-100 flex items-center gap-2">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-sm"
                    style={{ backgroundColor: STRATEGY_COLORS[idx] }}
                  />
                  {r.strategyName}
                </td>
                <td className="py-3 text-right font-mono text-red-400">
                  {r.ruinProbabilityPct.toFixed(1)}%
                </td>
                <td className="py-3 text-right font-mono text-emerald-400">
                  {r.stopWinProbabilityPct.toFixed(1)}%
                </td>
                <td className="py-3 text-right font-mono text-slate-200">
                  {formatCurrency(r.avgFinalBankroll, currency)}
                </td>
                <td className="py-3 text-right font-mono text-amber-400">
                  -{r.avgMaxDrawdownPct.toFixed(1)}%
                </td>
                <td
                  className={`py-3 text-right font-mono font-semibold ${
                    r.expectedValuePct >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {r.expectedValuePct >= 0 ? '+' : ''}
                  {r.expectedValuePct.toFixed(2)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-[11px] text-slate-400 leading-relaxed">
          Nota Matemática: Nenhuma progressão altera a esperança matemática negativa da Roleta Europeia (−2.70% por unidade apostada devido ao Zero). A Martingale reduz a frequência de perdas pequenas à custa de um risco de cauda elevado ao atingir o teto da mesa ou o Stop-Loss.
        </p>
      </div>
    </div>
  );
};
