/**
 * CyclePieChart.tsx
 *
 * Renders a donut-style pie chart divided into 4 menstrual cycle phases:
 *   • Menstrual   — Red    (#EF4444)
 *   • Follicular  — Green  (#22C55E)
 *   • Ovulation   — Yellow (#EAB308)
 *   • Luteal      — Blue   (#3B82F6)
 *
 * A triangle needle rotates to mark the current cycle day.
 * The center displays the day number and current phase name.
 */

import React from 'react';
import { View, Text } from 'react-native';
import Svg, {
  Circle,
  G,
  Path,
  Polygon,
  Text as SvgText,
} from 'react-native-svg';

// ─── Phase configuration ──────────────────────────────────────────────────────

interface Segments {
  menstrual: number;
  follicular: number;
  ovulation: number;
  luteal: number;
}

interface Props {
  segments: Segments;
  cycleDay: number;
  avgLength: number;
  phase: string;
}

const PHASE_CONFIG = [
  { key: 'menstrual'  as const, label: 'Menstrual',    color: '#EF4444' },
  { key: 'follicular' as const, label: 'Follicular',   color: '#22C55E' },
  { key: 'ovulation'  as const, label: 'Ovulation',    color: '#EAB308' },
  { key: 'luteal'     as const, label: 'Luteal',       color: '#3B82F6' },
] as const;

// ─── SVG helpers ──────────────────────────────────────────────────────────────

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  // 0° starts at top (12 o'clock), increases clockwise
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeSlice(
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  startDeg: number,
  endDeg: number,
): string {
  // Clamp tiny arcs to avoid degenerate paths
  const delta = endDeg - startDeg;
  if (delta < 0.01) return '';

  const outerStart = polarToCartesian(cx, cy, outerR, startDeg);
  const outerEnd   = polarToCartesian(cx, cy, outerR, endDeg);
  const innerStart = polarToCartesian(cx, cy, innerR, startDeg);
  const innerEnd   = polarToCartesian(cx, cy, innerR, endDeg);
  const large = delta > 180 ? 1 : 0;

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerR} ${outerR} 0 ${large} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerR} ${innerR} 0 ${large} 0 ${innerStart.x} ${innerStart.y}`,
    'Z',
  ].join(' ');
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CyclePieChart({ segments, cycleDay, avgLength, phase }: Props) {
  const SIZE   = 240;
  const CX     = SIZE / 2;
  const CY     = SIZE / 2;
  const OUTER  = 95;   // outer radius of donut
  const INNER  = 52;   // inner radius (hole)
  const NEEDLE_LEN = OUTER + 14; // needle tip extends beyond the chart

  // Current day angle — day 1 = 0° (top), increases clockwise
  const safeDay    = Math.max(1, cycleDay);
  const safeLength = Math.max(14, avgLength);
  const dayAngle   = ((safeDay - 1) / safeLength) * 360;

  // Needle triangle tip point
  const needleTip = polarToCartesian(CX, CY, NEEDLE_LEN, dayAngle);
  // Needle base — two points perpendicular to the needle direction
  const BASE_R = 5;
  const BASE_DIST = INNER - 4;

  // Tip = needleTip; base points are left/right of needle at BASE_DIST from center
  const perp = polarToCartesian(CX, CY, BASE_R, dayAngle + 90);
  const perpNeg = polarToCartesian(CX, CY, BASE_R, dayAngle - 90);
  const baseCenter = polarToCartesian(CX, CY, BASE_DIST, dayAngle);
  const bL = { x: baseCenter.x + (perp.x - CX), y: baseCenter.y + (perp.y - CY) };
  const bR = { x: baseCenter.x + (perpNeg.x - CX), y: baseCenter.y + (perpNeg.y - CY) };

  // Build slices
  let cumulative = 0;
  const slices = PHASE_CONFIG.map((phase) => {
    const proportion = segments[phase.key] ?? 0;
    const startDeg = cumulative * 360;
    cumulative += proportion;
    const endDeg = cumulative * 360;
    return { ...phase, startDeg, endDeg, proportion };
  });

  // Outer glow circle for needle tip
  const glowR = 8;
  const glowColor = '#1e293b';

  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>

        {/* ── Phase slices (donut) ───────────────────────────────── */}
        <G>
          {slices.map((slice) => {
            if (slice.proportion < 0.001) return null;
            const d = describeSlice(CX, CY, OUTER, INNER, slice.startDeg, slice.endDeg);
            return (
              <Path
                key={slice.key}
                d={d}
                fill={slice.color}
                opacity={0.92}
              />
            );
          })}
        </G>

        {/* ── Thin white separator lines between phases ─────────── */}
        {slices.map((slice) => {
          if (slice.proportion < 0.001) return null;
          const p1 = polarToCartesian(CX, CY, INNER,  slice.startDeg);
          const p2 = polarToCartesian(CX, CY, OUTER, slice.startDeg);
          return (
            <Path
              key={`sep_${slice.key}`}
              d={`M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`}
              stroke="white"
              strokeWidth={2}
            />
          );
        })}

        {/* ── Donut hole ────────────────────────────────────────── */}
        <Circle cx={CX} cy={CY} r={INNER} fill="white" />

        {/* ── Needle triangle ───────────────────────────────────── */}
        {/* Shadow halo */}
        <Circle
          cx={needleTip.x}
          cy={needleTip.y}
          r={glowR + 2}
          fill="rgba(0,0,0,0.15)"
        />
        {/* Triangle body */}
        <Polygon
          points={`${needleTip.x},${needleTip.y} ${bL.x},${bL.y} ${bR.x},${bR.y}`}
          fill={glowColor}
        />
        {/* Tip dot */}
        <Circle cx={needleTip.x} cy={needleTip.y} r={glowR} fill={glowColor} />
        {/* Center pivot dot */}
        <Circle cx={CX} cy={CY} r={5} fill={glowColor} />

        {/* ── Center text ───────────────────────────────────────── */}
        <SvgText
          x={CX}
          y={CY - 10}
          textAnchor="middle"
          fontSize={14}
          fontWeight="bold"
          fill="#1e293b"
        >
          Day {safeDay}
        </SvgText>
        <SvgText
          x={CX}
          y={CY + 8}
          textAnchor="middle"
          fontSize={9.5}
          fill="#7c3aed"
          fontWeight="600"
        >
          {phase.replace('Estimated ', 'Est. ')}
        </SvgText>
        <SvgText
          x={CX}
          y={CY + 22}
          textAnchor="middle"
          fontSize={9}
          fill="#94a3b8"
        >
          of ~{safeLength}d
        </SvgText>

      </Svg>

      {/* ── Legend ──────────────────────────────────────────────────── */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: 4, gap: 8 }}>
        {PHASE_CONFIG.map(({ label, color }) => (
          <View key={label} style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 4 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color, marginRight: 4 }} />
            <Text style={{ fontSize: 11, color: '#64748b' }}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
