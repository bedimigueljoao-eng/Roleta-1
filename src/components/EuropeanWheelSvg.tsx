import React, { useState } from 'react';
import {
  EUROPEAN_WHEEL_SEQUENCE,
  getNumberColor,
} from '../engine/rouletteConstants';
import { NumberStat } from '../types/roulette';

interface EuropeanWheelSvgProps {
  lastNumber: number | null;
  anchorNumber: number | null;
  anchorNeighbors: number[];
  chipNumbers: number[];
  masterTargetNumbers: number[];
  numberStats: NumberStat[];
  onNumberClick?: (num: number) => void;
}

export const EuropeanWheelSvg: React.FC<EuropeanWheelSvgProps> = ({
  lastNumber,
  anchorNumber,
  anchorNeighbors,
  chipNumbers,
  masterTargetNumbers,
  numberStats,
  onNumberClick,
}) => {
  const [hoveredNum, setHoveredNum] = useState<number | null>(null);

  const cx = 180;
  const cy = 180;
  const outerR = 166;
  const numberOuterR = 152;
  const numberInnerR = 112;
  const pocketInnerR = 96;
  const total = 37;
  const sliceAngle = (2 * Math.PI) / total;

  const chipSet = new Set(chipNumbers);
  const neighborSet = new Set(anchorNeighbors);
  const masterSet = new Set(masterTargetNumbers);

  const polarToCartesian = (r: number, angleRad: number) => ({
    x: cx + r * Math.cos(angleRad),
    y: cy + r * Math.sin(angleRad),
  });

  const createArcPath = (
    rIn: number,
    rOut: number,
    startAngle: number,
    endAngle: number
  ) => {
    const p1 = polarToCartesian(rOut, startAngle);
    const p2 = polarToCartesian(rOut, endAngle);
    const p3 = polarToCartesian(rIn, endAngle);
    const p4 = polarToCartesian(rIn, startAngle);
    return [
      `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
      `A ${rOut} ${rOut} 0 0 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
      `L ${p3.x.toFixed(2)} ${p3.y.toFixed(2)}`,
      `A ${rIn} ${rIn} 0 0 0 ${p4.x.toFixed(2)} ${p4.y.toFixed(2)}`,
      'Z',
    ].join(' ');
  };

  const inspected = hoveredNum !== null ? numberStats[hoveredNum] : lastNumber !== null ? numberStats[lastNumber] : null;

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-full max-w-[360px] aspect-square">
        <svg
          viewBox="0 0 360 360"
          className="w-full h-full select-none"
          role="img"
          aria-label="Roda Física da Roleta Europeia"
        >
          {/* Outer wooden/dark bezel */}
          <circle
            cx={cx}
            cy={cy}
            r={outerR}
            fill="#0F172A"
            stroke="#334155"
            strokeWidth="2"
          />
          <circle
            cx={cx}
            cy={cy}
            r={numberOuterR + 4}
            fill="none"
            stroke="#475569"
            strokeWidth="1"
            strokeDasharray="2 4"
          />

          {/* 37 Pockets */}
          {EUROPEAN_WHEEL_SEQUENCE.map((num, idx) => {
            const centerAngle = -Math.PI / 2 + idx * sliceAngle;
            const startAngle = centerAngle - sliceAngle / 2;
            const endAngle = centerAngle + sliceAngle / 2;

            const color = getNumberColor(num);
            const isLast = num === lastNumber;
            const isAnchor = num === anchorNumber;
            const isNeighbor = neighborSet.has(num);
            const isChip = chipSet.has(num);
            const isMaster = masterSet.has(num);
            const isHovered = num === hoveredNum;

            const baseFill =
              color === 'GREEN'
                ? '#15803D'
                : color === 'RED'
                ? '#B91C1C'
                : '#111827';

            const innerFill =
              isChip || isNeighbor
                ? color === 'GREEN'
                  ? '#16A34A'
                  : color === 'RED'
                  ? '#DC2626'
                  : '#1E293B'
                : '#0B0F17';

            const labelPos = polarToCartesian((numberOuterR + numberInnerR) / 2, centerAngle);
            const chipPos = polarToCartesian((numberInnerR + pocketInnerR) / 2, centerAngle);
            const rotDeg = (centerAngle * 180) / Math.PI + 90;

            return (
              <g
                key={num}
                className="cursor-pointer transition-opacity duration-150"
                onMouseEnter={() => setHoveredNum(num)}
                onMouseLeave={() => setHoveredNum(null)}
                onClick={() => onNumberClick?.(num)}
              >
                {/* Number band */}
                <path
                  d={createArcPath(numberInnerR, numberOuterR, startAngle, endAngle)}
                  fill={baseFill}
                  stroke={isHovered ? '#F8FAFC' : isLast ? '#F59E0B' : '#334155'}
                  strokeWidth={isHovered || isLast ? 1.8 : 0.7}
                  opacity={masterSet.size > 0 && !isMaster && !isChip && !isNeighbor && !isLast ? 0.65 : 1}
                />

                {/* Inner pocket band */}
                <path
                  d={createArcPath(pocketInnerR, numberInnerR, startAngle, endAngle)}
                  fill={innerFill}
                  stroke={isNeighbor ? '#10B981' : '#1E293B'}
                  strokeWidth={isNeighbor ? 1.4 : 0.6}
                />

                {/* Number label */}
                <text
                  x={labelPos.x}
                  y={labelPos.y}
                  fill="#F8FAFC"
                  fontSize="10.5"
                  fontWeight={isLast || isAnchor ? '700' : '600'}
                  fontFamily="JetBrains Mono, monospace"
                  textAnchor="middle"
                  dominantBaseline="central"
                  transform={`rotate(${rotDeg}, ${labelPos.x.toFixed(2)}, ${labelPos.y.toFixed(2)})`}
                >
                  {num}
                </text>

                {/* Chip marker on inner pocket */}
                {isChip && (
                  <circle
                    cx={chipPos.x}
                    cy={chipPos.y}
                    r={4.5}
                    fill="#10B981"
                    stroke="#ECFDF5"
                    strokeWidth="1.2"
                  />
                )}

                {/* Last ball marker */}
                {isLast && (
                  <circle
                    cx={polarToCartesian(numberOuterR - 5, centerAngle).x}
                    cy={polarToCartesian(numberOuterR - 5, centerAngle).y}
                    r={3.5}
                    fill="#FBBF24"
                    stroke="#0B0F17"
                    strokeWidth="1"
                  />
                )}
              </g>
            );
          })}

          {/* Center hub */}
          <circle
            cx={cx}
            cy={cy}
            r={pocketInnerR - 4}
            fill="#0B0F17"
            stroke="#1E293B"
            strokeWidth="1.5"
          />
          <circle
            cx={cx}
            cy={cy}
            r={54}
            fill="#111827"
            stroke="#334155"
            strokeWidth="1"
          />

          {/* Center Readout */}
          {inspected ? (
            <g textAnchor="middle">
              <text
                x={cx}
                y={cy - 18}
                fill="#94A3B8"
                fontSize="10"
                fontFamily="Plus Jakarta Sans, sans-serif"
              >
                {hoveredNum !== null ? 'Inspecionar' : 'Último Giro'}
              </text>
              <text
                x={cx}
                y={cy + 6}
                fill={
                  inspected.color === 'GREEN'
                    ? '#4ADE80'
                    : inspected.color === 'RED'
                    ? '#F87171'
                    : '#F8FAFC'
                }
                fontSize="26"
                fontWeight="700"
                fontFamily="JetBrains Mono, monospace"
              >
                {inspected.number}
              </text>
              <text
                x={cx}
                y={cy + 26}
                fill="#94A3B8"
                fontSize="10"
                fontFamily="JetBrains Mono, monospace"
              >
                {inspected.count}x · Atraso {inspected.currentDelay}
              </text>
            </g>
          ) : (
            <g textAnchor="middle">
              <text
                x={cx}
                y={cy - 4}
                fill="#94A3B8"
                fontSize="11"
                fontFamily="Plus Jakarta Sans, sans-serif"
              >
                Roleta Europeia
              </text>
              <text
                x={cx}
                y={cy + 14}
                fill="#64748B"
                fontSize="10"
                fontFamily="JetBrains Mono, monospace"
              >
                Clique p/ registar
              </text>
            </g>
          )}
        </svg>
      </div>

      {/* Compact legend below wheel */}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400" />
          Último giro
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500" />
          Fichas / Âncora ±2
        </span>
        <span className="text-slate-500">Clique no número para registar</span>
      </div>
    </div>
  );
};
