import { CSSProperties, ReactNode } from 'react';
import { AbsoluteFill, Easing, interpolate, random, useCurrentFrame } from 'remotion';
import { BEAT, FONT, s } from './ui';

export const easeOut = Easing.bezier(0.2, 0.9, 0.3, 1);
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);

/** 0 → 1 entre dois instantes (em segundos). */
export const ramp = (f: number, from: number, to: number, ease = easeOut) =>
  interpolate(f, [s(from), s(to)], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
export const between = (f: number, a: number, b: number) => f >= s(a) && f < s(b);

/** Pulso que decai depois de cada instante da lista (para flashes, tremidas e "socos" de zoom). */
export const hit = (f: number, times: number[], decay = 0.25) => {
  let v = 0;
  for (const t of times) {
    const d = (f - s(t)) / (decay * 30);
    if (d >= 0 && d < 4) v = Math.max(v, Math.exp(-d * 2.5));
  }
  return v;
};

/** Pulso a cada batida (120 BPM), só a partir de `from`. */
export const beatPulse = (f: number, from = 2) => (f < s(from) ? 0 : Math.exp(-((f % BEAT) / BEAT) * 5));

/** Tremida de câmera proporcional a `amount` (0–1). */
export const shake = (f: number, amount: number) =>
  amount <= 0.01 ? '' : `translate(${(random(`x${f}`) - 0.5) * 36 * amount}px, ${(random(`y${f}`) - 0.5) * 36 * amount}px)`;

/** Pose de câmera/objeto: interpolada entre quadros-chave (em segundos). */
export interface Pose {
  x: number;
  y: number;
  s: number;
  rx: number;
  ry: number;
  rz: number;
}
export function pose(f: number, keys: [number, Partial<Pose>][]): Pose {
  const base: Pose = { x: 0, y: 0, s: 1, rx: 0, ry: 0, rz: 0 };
  const full = keys.map(([t, p]) => [t, { ...base, ...p }] as [number, Pose]);
  const ts = full.map(([t]) => s(t));
  const out = { ...base };
  (Object.keys(base) as (keyof Pose)[]).forEach(k => {
    out[k] = ts.length === 1 ? full[0][1][k] : interpolate(f, ts, full.map(([, p]) => p[k]), { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeInOut });
  });
  return out;
}
export const poseCss = (p: Pose) => `translate(${p.x}px, ${p.y}px) rotateX(${p.rx}deg) rotateY(${p.ry}deg) rotateZ(${p.rz}deg) scale(${p.s})`;

/** Título em Michroma com acabamento cromado. */
export function Headline({ children, size = 64, style }: { children: ReactNode; size?: number; style?: CSSProperties }) {
  return (
    <div
      style={{
        fontFamily: FONT.brand, fontSize: size, letterSpacing: '.04em', textAlign: 'center', lineHeight: 1.08, textTransform: 'uppercase', whiteSpace: 'nowrap',
        background: 'linear-gradient(180deg,#ffffff 0%,#d6d9de 38%,#8d939c 52%,#eef0f3 70%,#b3b8c0 100%)', WebkitBackgroundClip: 'text', color: 'transparent',
        filter: 'drop-shadow(0 4px 12px rgba(0,0,0,.7))', ...style,
      }}>
      {children}
    </div>
  );
}

/** Palavras que entram uma por batida, com "soco" de escala. Cada item: [palavra, quando entra]. */
export function Kinetic({ words, until, top = 150, size = 92, sub, subAt }: { words: [string, number][]; until: number; top?: number; size?: number; sub?: string; subAt?: number }) {
  const f = useCurrentFrame();
  if (!between(f, words[0][1] - 0.01, until)) return null;
  const out = ramp(f, until - 0.2, until);
  return (
    <div style={{ position: 'absolute', top, left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, opacity: 1 - out, transform: `translateY(${-out * 30}px)` }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', columnGap: size * 0.4, rowGap: 6, padding: '0 50px' }}>
        {words.map(([w, at]) => {
          const p = ramp(f, at, at + 0.18);
          if (f < s(at)) return null;
          return (
            <div key={w + at} style={{ transform: `scale(${1.6 - 0.6 * p})`, opacity: p }}>
              <Headline size={Math.min(size, 980 / (w.length * 0.92))}>{w}</Headline>
            </div>
          );
        })}
      </div>
      {sub && subAt !== undefined && f >= s(subAt) ? (
        <div style={{ fontFamily: FONT.ui, fontWeight: 700, fontSize: 36, color: '#c9d1dc', opacity: ramp(f, subAt, subAt + 0.3), transform: `translateY(${(1 - ramp(f, subAt, subAt + 0.3)) * 20}px)` }}>{sub}</div>
      ) : null}
    </div>
  );
}

/** Raios saindo do centro, girando (entrada e transições). */
export function SpeedLines({ opacity, inward }: { opacity: number; inward?: boolean }) {
  const f = useCurrentFrame();
  if (opacity <= 0.01) return null;
  return (
    <AbsoluteFill style={{ opacity }}>
      <svg width="1080" height="1920" viewBox="-540 -960 1080 1920">
        {Array.from({ length: 48 }, (_, i) => {
          const a = (i / 48) * Math.PI * 2 + f * 0.004;
          const len = 300 + random(`l${i}`) * 700;
          const off = ((f * (inward ? -38 : 38) + random(`o${i}`) * 1400) % 1400 + 1400) % 1400;
          const r1 = 80 + off, r2 = r1 + len * 0.35;
          return <line key={i} x1={Math.cos(a) * r1} y1={Math.sin(a) * r1} x2={Math.cos(a) * r2} y2={Math.sin(a) * r2} stroke="#62ff9f" strokeOpacity={0.15 + random(`a${i}`) * 0.35} strokeWidth={2 + random(`w${i}`) * 3} strokeLinecap="round" />;
        })}
      </svg>
    </AbsoluteFill>
  );
}

/** "Pixels" verdes subindo devagar no fundo. */
export function Particles({ opacity }: { opacity: number }) {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ opacity }}>
      {Array.from({ length: 36 }, (_, i) => {
        const x = random(`px${i}`) * 1080;
        const speed = 0.6 + random(`ps${i}`) * 1.8;
        const y = 1980 - ((f * speed + random(`py${i}`) * 2000) % 2100);
        const size = 4 + random(`pz${i}`) * 8;
        return <div key={i} style={{ position: 'absolute', left: x, top: y, width: size, height: size, background: '#62ff9f', opacity: 0.25 + random(`po${i}`) * 0.5, boxShadow: '0 0 10px rgba(98,255,159,.8)' }} />;
      })}
    </AbsoluteFill>
  );
}

/** Anel de choque saindo do centro num impacto. */
export function Shockwave({ at, y = 960 }: { at: number; y?: number }) {
  const f = useCurrentFrame();
  const p = ramp(f, at, at + 0.6, Easing.out(Easing.cubic));
  if (p <= 0 || p >= 1) return null;
  const r = 120 + p * 900;
  return <div style={{ position: 'absolute', left: 540 - r, top: y - r, width: r * 2, height: r * 2, borderRadius: '50%', border: `${10 * (1 - p)}px solid rgba(98,255,159,${0.8 * (1 - p)})`, boxShadow: `0 0 40px rgba(98,255,159,${0.5 * (1 - p)})` }} />;
}

/** Flash branco nos impactos. */
export function Flash({ times, strength = 0.7 }: { times: number[]; strength?: number }) {
  const f = useCurrentFrame();
  const v = hit(f, times, 0.12) * strength;
  return v > 0.01 ? <AbsoluteFill style={{ background: '#fff', opacity: v, mixBlendMode: 'screen' }} /> : null;
}
