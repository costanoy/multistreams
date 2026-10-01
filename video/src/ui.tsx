import { loadFont as loadLocal } from '@remotion/fonts';
import { loadFont as loadChakra } from '@remotion/google-fonts/ChakraPetch';
import { loadFont as loadMichroma } from '@remotion/google-fonts/Michroma';
import { CSSProperties, ReactNode } from 'react';
import { Img, staticFile, useCurrentFrame } from 'remotion';

export const FPS = 30;
/** 120 BPM: uma batida a cada 0,5 s (15 quadros), um compasso a cada 2 s. */
export const BEAT = 15;
export const s = (sec: number) => Math.round(sec * FPS);

const chakra = loadChakra('normal', { weights: ['400', '600', '700'], subsets: ['latin', 'latin-ext'] }).fontFamily;
const michroma = loadMichroma('normal', { subsets: ['latin'] }).fontFamily;
void loadLocal({ family: 'DSEG14', url: staticFile('fonts/DSEG14Classic-Bold.ttf') });
export const FONT = { ui: chakra, brand: michroma, lcd: 'DSEG14' };

// ---- skins do app (as mesmas cores do client/src/theme.ts) ----
export type SkinKey = 'prata' | 'azul' | 'preto';
export const SKINS = {
  prata: {
    frame: 'linear-gradient(180deg,#f7f8f9 0%,#d6d9de 24%,#f0f1f3 48%,#b3b8c0 74%,#dcdfe3 90%,#c4c8ce 100%)',
    frameInk: '#16181d', frameMuted: '#454a53', panel: '#eceef1', card: '#ffffff', line: 'rgba(20,24,32,.10)', ink: '#15171c', muted: '#5a606b',
    lcdBg: 'linear-gradient(180deg,#08120d,#0e1d15)', lcdFg: '#62ff9f', lcdGlow: '0 0 6px rgba(98,255,159,.7)',
    btn: 'radial-gradient(circle at 35% 28%,#fff 0%,#e4e6ea 40%,#a4a9b1 100%)', btnOn: 'radial-gradient(circle at 35% 28%,#e3f6ff 0%,#8ec5f0 45%,#3a73b4 100%)',
    btnInk: '#16181d', accent: '#2f63d6', accentInk: '#fff', field: '#f7f8fa', eq: '#12a150', bezelRing: '#c6c9cf',
  },
  azul: {
    frame: 'linear-gradient(180deg,#e8f0ff 0%,#a9c2ef 24%,#dae6fc 48%,#7394d4 74%,#b5cbf2 90%,#8eaae0 100%)',
    frameInk: '#08142e', frameMuted: '#1d3264', panel: '#e3e9f4', card: '#fbfcff', line: 'rgba(16,36,80,.12)', ink: '#0d172e', muted: '#475775',
    lcdBg: 'linear-gradient(180deg,#03101c,#08192b)', lcdFg: '#6fd6ff', lcdGlow: '0 0 6px rgba(111,214,255,.8)',
    btn: 'radial-gradient(circle at 35% 28%,#fff 0%,#c8d8f7 40%,#6283c7 100%)', btnOn: 'radial-gradient(circle at 35% 28%,#fff5dc 0%,#ffc86e 45%,#c27812 100%)',
    btnInk: '#08142e', accent: '#1f4bb0', accentInk: '#fff', field: '#f4f7fd', eq: '#1476c8', bezelRing: '#9fb6e4',
  },
  preto: {
    frame: 'linear-gradient(180deg,#3a3c41 0%,#242529 32%,#2d2f33 60%,#151618 100%)',
    frameInk: '#eceef2', frameMuted: '#a6aab3', panel: '#131417', card: '#1d1e22', line: 'rgba(255,255,255,.09)', ink: '#eef0f3', muted: '#9ba1ab',
    lcdBg: 'linear-gradient(180deg,#030603,#081008)', lcdFg: '#8dff5c', lcdGlow: '0 0 6px rgba(141,255,92,.65)',
    btn: 'radial-gradient(circle at 35% 28%,#63666c 0%,#34363a 45%,#18191b 100%)', btnOn: 'radial-gradient(circle at 35% 28%,#e4ffd6 0%,#8dff5c 45%,#2e8612 100%)',
    btnInk: '#eceef2', accent: '#8dff5c', accentInk: '#0b1a05', field: '#232428', eq: '#8dff5c', bezelRing: '#3a3c41',
  },
};
export type Skin = (typeof SKINS)['prata'];

export const SH = {
  bulb: 'inset 0 2px 1px rgba(255,255,255,.8), inset 0 -3px 5px rgba(0,0,0,.25), 0 2px 4px rgba(0,0,0,.2)',
  lcd: 'inset 0 1px 4px rgba(0,0,0,.9), 0 1px 0 rgba(255,255,255,.55)',
  frame: 'inset 0 2px 1px rgba(255,255,255,.8), inset 0 -3px 6px rgba(0,0,0,.25), 0 8px 20px rgba(0,0,0,.18)',
};

export const fmt = (n: number) => (n >= 1000 ? (n / 1000).toFixed(1).replace('.0', '') + 'K' : String(n));

/** Equalizador: barras pulsando no tempo da música. */
export function Eq({ color, h = 12, w = 3, bars = 3, gap = 2, glow, still }: { color: string; h?: number; w?: number; bars?: number; gap?: number; glow?: string; still?: boolean }) {
  const f = useCurrentFrame();
  const speeds = [0.21, 0.16, 0.27, 0.19, 0.23];
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap, height: h, flexShrink: 0 }}>
      {speeds.slice(0, bars).map((sp, i) => (
        <div key={i} style={{ width: w, height: '100%', background: color, boxShadow: glow, transformOrigin: 'bottom', transform: `scaleY(${still ? 0.2 : 0.2 + 0.8 * Math.abs(Math.sin(f * sp + i * 1.3))})` }} />
      ))}
    </div>
  );
}

/** Números e palavras em fonte de LCD (cada palavra separada: a DSEG não tem espaço largo). */
export const LcdText = ({ children, size, color, glow }: { children: string; size: number; color: string; glow?: string }) => (
  <div style={{ display: 'flex', gap: size * 0.55, fontFamily: FONT.lcd, fontSize: size, color, textShadow: glow, lineHeight: 1 }}>
    {children.split(' ').map((w, i) => <span key={i}>{w}</span>)}
  </div>
);

export const Lcd = ({ skin, children, style }: { skin: Skin; children: ReactNode; style?: CSSProperties }) => (
  <div style={{ background: skin.lcdBg, borderRadius: 8, boxShadow: SH.lcd, ...style }}>{children}</div>
);

// ---- logos das plataformas (mesmos desenhos do app) ----
const TWITCH = 'M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z';
const KICK = 'M5 5h4.5v14H5z M9.5 10.25h3.25v3.5H9.5z M12.75 7.5h3v3h-3z M15.75 5H19v2.5h-3.25z M12.75 13.5h3v3h-3z M15.75 16.5H19V19h-3.25z';
export type Plat = 'twitch' | 'youtube' | 'kick';
export const PLAT_NAME: Record<Plat, string> = { twitch: 'Twitch', youtube: 'YouTube', kick: 'Kick' };

export function PlatLogo({ plat, size }: { plat: Plat; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0, display: 'block' }}>
      {plat === 'twitch' ? (
        <>
          <rect width="24" height="24" rx="5.5" fill="#9146ff" />
          <g transform="translate(4.5 4.5) scale(0.625)"><path d={TWITCH} fill="#fff" /></g>
        </>
      ) : plat === 'youtube' ? (
        <>
          <rect y="3.5" width="24" height="17" rx="5.5" fill="#ff0000" />
          <path d="M9.6 8.2v7.6l6.4-3.8z" fill="#fff" />
        </>
      ) : (
        <>
          <rect width="24" height="24" rx="5.5" fill="#0b0b0b" />
          <path d={KICK} fill="#53fc18" />
        </>
      )}
    </svg>
  );
}

export const Logo = ({ size, style }: { size: number; style?: CSSProperties }) => (
  <Img src={staticFile('logo-round.png')} style={{ width: size, height: size, borderRadius: '50%', ...style }} />
);

/**
 * Miniatura de live, abstrata (cenário de jogo sugerido com formas). Os streamers do vídeo são
 * fictícios: não usamos rosto nem transmissão de ninguém de verdade.
 */
export function Thumb({ hue, width, radius, kind = 0 }: { hue: number; width: number; radius: number; kind?: number }) {
  const h = width * 0.5625;
  return (
    <div style={{ width, height: h, borderRadius: radius, overflow: 'hidden', position: 'relative', flexShrink: 0, background: `linear-gradient(160deg,hsl(${hue} 55% 38%),hsl(${(hue + 40) % 360} 60% 16%))` }}>
      {kind % 3 === 0 ? (
        // horizonte com montanhas
        <>
          <div style={{ position: 'absolute', left: '-10%', right: '-10%', bottom: 0, height: '45%', background: `hsl(${(hue + 180) % 360} 35% 22%)`, clipPath: 'polygon(0 60%,18% 20%,34% 55%,52% 10%,70% 50%,86% 25%,100% 55%,100% 100%,0 100%)' }} />
          <div style={{ position: 'absolute', right: '18%', top: '16%', width: h * 0.22, height: h * 0.22, borderRadius: '50%', background: `hsl(${(hue + 60) % 360} 90% 70%)`, boxShadow: `0 0 ${h * 0.2}px hsl(${(hue + 60) % 360} 90% 60%)` }} />
        </>
      ) : kind % 3 === 1 ? (
        // pista em perspectiva
        <div style={{ position: 'absolute', inset: 0, background: `repeating-linear-gradient(90deg,transparent 0 18%,hsla(${(hue + 200) % 360},80%,70%,.35) 18% 19%)`, transform: 'perspective(120px) rotateX(55deg) translateY(30%)', transformOrigin: 'bottom' }} />
      ) : (
        // "câmera" de conversa: silhueta + overlay
        <>
          <div style={{ position: 'absolute', left: '30%', bottom: '-12%', width: '40%', height: '80%', borderRadius: '50% 50% 10% 10%', background: `hsl(${(hue + 30) % 360} 30% 12%)` }} />
          <div style={{ position: 'absolute', left: '40%', top: '18%', width: '20%', height: '34%', borderRadius: '50%', background: `hsl(${(hue + 30) % 360} 30% 14%)` }} />
        </>
      )}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(160deg,rgba(255,255,255,.25) 0%,rgba(255,255,255,0) 40%)' }} />
    </div>
  );
}

export interface Live {
  name: string;
  plat: Plat;
  viewers: number;
  title: string;
  cat: string;
  hue: number;
}

/** Linha da lista de lives, como no app. */
export function Row({ live, skin, featured, kind }: { live: Live; skin: Skin; featured?: boolean; kind: number }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: featured ? '8px 10px 8px 8px' : '7px 9px 7px 7px', borderRadius: featured ? 16 : 13,
        background: featured ? skin.frame : skin.card,
        boxShadow: featured ? SH.frame : `0 0 0 1px ${skin.line}, 0 1px 2px rgba(0,0,0,.06)`,
      }}>
      <div style={{ boxShadow: featured ? 'inset 0 0 0 2px rgba(0,0,0,.5)' : `0 0 0 2px ${skin.bezelRing}`, borderRadius: 8 }}>
        <Thumb hue={live.hue} width={featured ? 118 : 92} radius={8} kind={kind} />
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Eq color={featured ? skin.lcdFg : skin.eq} h={11} />
          <div style={{ fontFamily: FONT.ui, fontWeight: 700, fontSize: 14.5, color: featured ? skin.frameInk : skin.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{live.name}</div>
          <PlatLogo plat={live.plat} size={15} />
        </div>
        <div style={{ fontFamily: FONT.ui, fontSize: 12.5, color: featured ? skin.frameInk : skin.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{live.title}</div>
        <div style={{ fontFamily: FONT.ui, fontSize: 11, color: featured ? skin.frameMuted : skin.muted }}>{live.cat} · PT</div>
      </div>
      <Lcd skin={skin} style={{ padding: '6px 7px 5px', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, minWidth: 50 }}>
        <LcdText size={13} color={skin.lcdFg} glow={skin.lcdGlow}>{fmt(live.viewers)}</LcdText>
        <div style={{ fontFamily: FONT.ui, fontWeight: 700, fontSize: 7.5, letterSpacing: '.14em', color: skin.lcdFg }}>VIEWERS</div>
      </Lcd>
    </div>
  );
}
