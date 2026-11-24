import React, { useState } from 'react';
import { Download, Archive, Trash2 } from 'lucide-react';
import { formatCurrency } from '../engine/rouletteConstants';
import {
  exportSessionsToCSV,
  exportSessionsToJSON,
} from '../storage/sessionStorage';
import {
  CurrencyCode,
  SessionRecord,
  WalkForwardSummary,
} from '../types/roulette';

interface HistoryBacktestViewProps {
  currentEquityCurve: Array<{ spinIndex: number; balance: number; number: number }>;
  currentWalkForward: WalkForwardSummary;
  currentCurrency: CurrencyCode;
  archivedSessions: SessionRecord[];
  onArchiveCurrentSession: () => void;
  onClearArchive: () => void;
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const HistoryBacktestView: React.FC<HistoryBacktestViewProps> = ({
  currentEquityCurve,
  currentWalkForward,
  currentCurrency,
  archivedSessions,
  onArchiveCurrentSession,
  onClearArchive,
}) => {
  const [selectedSessionId, setSelectedSessionId] = useState<string>('current');

  const selectedArchived = archivedSessions.find((s) => s.id === selectedSessionId);
  const equityData = selectedArchived
    ? selectedArchived.equityCurve
    : currentEquityCurve;
  const walkForward = selectedArchived
    ? selectedArchived.walkForward
    : currentWalkForward;
  const currency = selectedArchived ? selectedArchived.currency : currentCurrency;

  // Build SVG polyline for equity/drawdown chart
  const chartW = 720;
  const chartH = 210;
  const padX = 44;
  const padY = 20;

  const balances = equityData.map((p) => p.balance);
  const minBal = balances.length > 0 ? Math.min(...balances) * 0.98 : 0;
  const maxBal = balances.length > 0 ? Math.max(...balances) * 1.02 : 100;
  const span = Math.max(1, maxBal - minBal);

  const pointsStr = equityData
    .map((pt, idx) => {
      const x =
        padX +
        (equityData.length > 1
          ? (idx / (equityData.length - 1)) * (chartW - padX * 2)
          : 0);
      const y =
        chartH - padY - ((pt.balance - minBal) / span) * (chartH - padY * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const startBal = equityData[0]?.balance ?? 0;
  const startY =
    chartH - padY - ((startBal - minBal) / span) * (chartH - padY * 2);

  return (
    <div className="space-y-6">
      {/* Header & Export Actions */}
      <div className="bg-[#111827] border border-slate-800 rounded-xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-100">
            Histórico Persistente, Drawdown & Backtesting por Mercado
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Avaliação cronológica walk-forward sem vazamento de dados futuros · Exportação completa CSV/JSON
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onArchiveCurrentSession}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-xs font-medium text-slate-200 whitespace-nowrap cursor-pointer"
          >
            <Archive className="w-3.5 h-3.5" />
            Arquivar Sessão Atual
          </button>

          <button
            type="button"
            onClick={() =>
              downloadBlob(
                exportSessionsToCSV(archivedSessions),
                `roletalab_sessoes_${new Date().toISOString().slice(0, 10)}.csv`,
                'text/csv;charset=utf-8;'
              )
            }
            disabled={archivedSessions.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-xs font-semibold text-white whitespace-nowrap cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Exportar CSV
          </button>

          <button
            type="button"
            onClick={() =>
              downloadBlob(
                exportSessionsToJSON(archivedSessions),
                `roletalab_sessoes_${new Date().toISOString().slice(0, 10)}.json`,
                'application/json'
              )
            }
            disabled={archivedSessions.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-xs font-medium text-slate-200 whitespace-nowrap cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Exportar JSON
          </button>
        </div>
      </div>

      {/* Equity Curve & Market Accuracy Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Equity / Drawdown Curve */}
        <div className="lg:col-span-7 bg-[#111827] border border-slate-800 rounded-xl p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-100">
              Curva de Saldo & Drawdown ({selectedArchived ? selectedArchived.tableName : 'Sessão Atual'})
            </h3>
            <select
              value={selectedSessionId}
              onChange={(e) => setSelectedSessionId(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none"
            >
              <option value="current">Sessão Atual ao Vivo</option>
              {archivedSessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.tableName} · {new Date(s.startedAt).toLocaleString('pt-PT')}
                </option>
              ))}
            </select>
          </div>

          {equityData.length <= 1 ? (
            <div className="h-52 flex items-center justify-center border border-dashed border-slate-800 rounded-lg text-xs text-slate-500">
              Registe pelo menos 2 giros na sessão para visualizar a evolução de banca e drawdown.
            </div>
          ) : (
            <div className="w-full overflow-x-auto">
              <svg
                viewBox={`0 0 ${chartW} ${chartH}`}
                className="w-full h-52 select-none"
              >
                {/* Baseline */}
                <line
                  x1={padX}
                  y1={startY}
                  x2={chartW - padX}
                  y2={startY}
                  stroke="#334155"
                  strokeDasharray="4 4"
                  strokeWidth="1"
                />
                {/* Curve */}
                <polyline
                  fill="none"
                  stroke="#10B981"
                  strokeWidth="2.2"
                  points={pointsStr}
                />
                {/* Labels */}
                <text
                  x={8}
                  y={padY + 4}
                  fill="#94A3B8"
                  fontSize="10"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {formatCurrency(maxBal, currency)}
                </text>
                <text
                  x={8}
                  y={chartH - padY}
                  fill="#94A3B8"
                  fontSize="10"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {formatCurrency(minBal, currency)}
                </text>
              </svg>
            </div>
          )}
        </div>

        {/* Walk-Forward Per-Market Comparison */}
        <div className="lg:col-span-5 bg-[#111827] border border-slate-800 rounded-xl p-4 sm:p-5 space-y-3">
          <h3 className="text-sm font-semibold text-slate-100">
            Taxa de Acerto por Mercado (Mesa 0s vs Sessão)
          </h3>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2 text-left font-medium">Mercado</th>
                  <th className="py-2 text-right font-medium">Mesa (0s)</th>
                  <th className="py-2 text-right font-medium">Sessão</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {walkForward.tablePerMarket.map((tm, idx) => {
                  const sm = walkForward.sessionPerMarket[idx];
                  return (
                    <tr key={tm.market} className="hover:bg-slate-900/40">
                      <td className="py-2 text-slate-200">{tm.label}</td>
                      <td className="py-2 text-right font-mono text-slate-300">
                        {tm.attempts > 0
                          ? `${tm.accuracyPct.toFixed(1)}% (${tm.hits}/${tm.attempts})`
                          : '—'}
                      </td>
                      <td className="py-2 text-right font-mono text-emerald-400">
                        {sm && sm.attempts > 0
                          ? `${sm.accuracyPct.toFixed(1)}% (${sm.hits}/${sm.attempts})`
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Archived Sessions Table */}
      <div className="bg-[#111827] border border-slate-800 rounded-xl p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-100">
            Sessões Arquivadas ({archivedSessions.length})
          </h3>
          {archivedSessions.length > 0 && (
            <button
              type="button"
              onClick={onClearArchive}
              className="inline-flex items-center gap-1 text-xs text-red-400 hover:text-red-300 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Limpar Arquivo
            </button>
          )}
        </div>

        {archivedSessions.length === 0 ? (
          <p className="text-xs text-slate-400 py-4">
            Nenhuma sessão arquivada ainda. As sessões são arquivadas automaticamente ao detetar uma troca de mesa ou ao clicar em &ldquo;Arquivar Sessão Atual&rdquo;.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2 text-left font-medium">Mesa / Casa</th>
                  <th className="py-2 text-left font-medium">Data</th>
                  <th className="py-2 text-right font-medium">Giros Sessão</th>
                  <th className="py-2 text-right font-medium">Acerto Sessão</th>
                  <th className="py-2 text-right font-medium">Saldo Final</th>
                  <th className="py-2 text-right font-medium">Resultado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {archivedSessions.map((s) => {
                  const pnl = s.finalBankroll - s.initialBankroll;
                  return (
                    <tr
                      key={s.id}
                      onClick={() => setSelectedSessionId(s.id)}
                      className="hover:bg-slate-900/50 cursor-pointer"
                    >
                      <td className="py-2.5 text-slate-200 font-medium">
                        {s.tableName}
                      </td>
                      <td className="py-2.5 text-slate-400 font-mono">
                        {new Date(s.startedAt).toLocaleString('pt-PT')}
                      </td>
                      <td className="py-2.5 text-right font-mono text-slate-300">
                        {s.sessionSpins.length}
                      </td>
                      <td className="py-2.5 text-right font-mono text-slate-300">
                        {s.walkForward.sessionAttempts > 0
                          ? `${s.walkForward.sessionAccuracyPct.toFixed(1)}%`
                          : '—'}
                      </td>
                      <td className="py-2.5 text-right font-mono text-slate-200">
                        {formatCurrency(s.finalBankroll, s.currency)}
                      </td>
                      <td
                        className={`py-2.5 text-right font-mono font-semibold ${
                          pnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {pnl >= 0 ? '+' : ''}
                        {formatCurrency(pnl, s.currency)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
