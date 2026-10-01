import { Audio } from '@remotion/media';
import { ReactNode } from 'react';
import { AbsoluteFill, Easing, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Flash, Headline, Kinetic, Particles, Shockwave, SpeedLines, beatPulse, between, hit, pose, poseCss, ramp, shake } from './fx';
import { AddScreen, AppScreen, Notification, T, TOP, WebScreen, skinAt } from './screens';
import { Eq, FONT, Lcd, LcdText, Logo, PlatLogo, PLAT_NAME, Plat, Row, SKINS, SkinKey, s } from './ui';

/*
 * Roteiro (120 BPM: batida a cada 0,5 s, compasso a cada 2 s)
 *  0–2   raios convergindo, logo acendendo        2     DROP: logo bate, flash, onda de choque
 *  4–6   MULTISTREAMS letra a letra               6–10  Twitch, YouTube e Kick batem e viram uma lista
 * 10–14  celular entra girando, zoom no contador, lives em cascata
 * 14–18  rolagem infinita                         18–20 zoom: Mais/Menos espectadores
 * 20–24  zoom nos filtros (idioma, categoria)     24–28 Adicionar: link digitado, detectado, adicionado
 * 28–30  notificação + celular vibrando           30–34 as três skins; depois trocando a cada batida
 * 34–38  web + celular                            38–42 montagem: um corte por batida
 * 42–46  logo final + fade junto com a música
 */

const CUTS = [38, 38.5, 39, 39.5, 40, 40.5, 41, 41.5];
const SLAMS = [2, 6, 6.5, 7, 42];

// ---------------- som ----------------

const Sfx = ({ at, src, volume = 0.8 }: { at: number; src: string; volume?: number }) => (
  <Sequence from={Math.max(0, s(at))} layout="none">
    <Audio src={staticFile(`sfx/${src}`)} volume={volume} />
  </Sequence>
);

function Soundtrack() {
  const typing = [24.45, 24.65, 24.85, 25.05, 25.25, 25.45];
  return (
    <>
      <Audio src={staticFile('music.wav')} volume={0.85} />
      <Sfx at={0.2} src="brilho.mp3" volume={0.7} />
      <Sfx at={2.0} src="impacto.mp3" volume={0.75} />
      {[6, 6.5, 7].map(t => <Sfx key={t} at={t - 0.44} src="cards.mp3" volume={0.9} />)}
      <Sfx at={8.5 - 0.5} src="logos.mp3" volume={0.9} />
      {[6, 18, 24, 30, 34, 38].map(t => <Sfx key={t} at={t - 0.52} src="transicao.mp3" volume={0.45} />)}
      <Sfx at={10.0 - 0.61} src="celular.mp3" volume={0.8} />
      <Sfx at={T.count[0]} src="contador.mp3" volume={0.55} />
      {[12.5, 12.75, 13, 13.25].map(t => <Sfx key={t} at={t - 0.44} src="cards.mp3" volume={0.45} />)}
      <Sfx at={T.asc} src="tap.mp3" volume={0.9} />
      {[20.35, 20.55, 20.75, 22.35, 22.55].map(t => <Sfx key={t} at={t} src="tap.mp3" volume={0.35} />)}
      <Sfx at={T.langCheck} src="switch-on.mp3" volume={0.85} />
      <Sfx at={T.catCheck} src="switch-on.mp3" volume={0.85} />
      {typing.map(t => <Sfx key={t} at={t} src="tap.mp3" volume={0.3} />)}
      <Sfx at={27} src="tap.mp3" volume={0.9} />
      <Sfx at={27.05} src="cards.mp3" volume={0.5} />
      <Sfx at={T.notify[0]} src="notification.wav" volume={0.9} />
      {[32, 32.5, 33, 33.5].map(t => <Sfx key={t} at={t} src="switch-on.mp3" volume={0.7} />)}
      {CUTS.slice(1).map(t => <Sfx key={t} at={t} src="tap.mp3" volume={0.6} />)}
      <Sfx at={42.0} src="impacto.mp3" volume={0.9} />
      <Sfx at={42.6} src="brilho.mp3" volume={0.5} />
    </>
  );
}

// ---------------- fundo ----------------

function Backdrop() {
  const f = useCurrentFrame();
  const pulse = beatPulse(f, 2);
  return (
    <AbsoluteFill style={{ background: 'radial-gradient(120% 80% at 50% 30%, #12203a 0%, #070b14 55%, #020306 100%)' }}>
      <AbsoluteFill
        style={{
          opacity: (0.1 + 0.08 * pulse) * ramp(f, 1, 3),
          backgroundImage: 'linear-gradient(rgba(98,255,159,.8) 2px, transparent 2px), linear-gradient(90deg, rgba(98,255,159,.8) 2px, transparent 2px)',
          backgroundSize: '90px 90px', backgroundPosition: `0 ${(f * 2) % 90}px`,
        }}
      />
      <Particles opacity={ramp(f, 2, 3)} />
      <AbsoluteFill style={{ background: `radial-gradient(60% 40% at 50% 50%, rgba(98,255,159,${0.08 + 0.14 * pulse}) 0%, transparent 70%)` }} />
    </AbsoluteFill>
  );
}

// ---------------- abertura ----------------

function Intro() {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (f >= s(6.05)) return null;
  const slam = spring({ frame: f - s(2), fps, config: { damping: 11, stiffness: 180 } });
  const before = interpolate(f, [0, s(2)], [0.3, 0.75], { extrapolateRight: 'clamp', easing: Easing.in(Easing.quad) });
  const scale = f < s(2) ? before : interpolate(slam, [0, 1], [1.5, 1]);
  const up = ramp(f, 3.6, 4.1);
  const out = ramp(f, 5.75, 6.05, Easing.in(Easing.quad));
  const sweep = interpolate(f, [s(0.3), s(1.7)], [-1, 1.4], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const spin = interpolate(f, [0, s(2)], [-40, 0], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const letters = 'MULTISTREAMS';
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: 1 - out, transform: `scale(${1 + out * 0.6})` }}>
      <SpeedLines opacity={(1 - ramp(f, 1.6, 2.1)) * ramp(f, 0, 0.6)} inward />
      <Shockwave at={2} />
      <div style={{ position: 'relative', transform: `translateY(${-300 * up}px) scale(${scale * (1 - 0.3 * up)}) rotate(${spin}deg)`, opacity: ramp(f, 0, 1.2, Easing.linear) }}>
        <Logo size={460} style={{ filter: `drop-shadow(0 0 ${40 + 60 * hit(f, [2], 0.4)}px rgba(98,255,159,.6))` }} />
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', overflow: 'hidden', mixBlendMode: 'screen' }}>
          <div style={{ position: 'absolute', top: '-20%', bottom: '-20%', width: '30%', left: `${sweep * 100}%`, background: 'linear-gradient(90deg,transparent,rgba(255,255,255,.8),transparent)', transform: 'skewX(-18deg)' }} />
        </div>
      </div>
      {/* letras caindo uma a cada 1/8 de batida */}
      <div style={{ position: 'absolute', top: 1080, display: 'flex' }}>
        {letters.split('').map((ch, i) => {
          const at = 4 + i * 0.0625 * 2;
          const p = ramp(f, at, at + 0.2, Easing.out(Easing.back(2)));
          return (
            <div key={i} style={{ transform: `translateY(${(1 - p) * -160}px)`, opacity: Math.min(1, p * 2) }}>
              <Headline size={84} style={{ letterSpacing: '.08em' }}>{ch}</Headline>
            </div>
          );
        })}
      </div>
      <div style={{ position: 'absolute', top: 1230, opacity: ramp(f, 5.5, 5.75), transform: `scale(${1.3 - 0.3 * ramp(f, 5.5, 5.75)})` }}>
        <Lcd skin={SKINS.prata} style={{ padding: '16px 26px' }}>
          <LcdText size={30} color={SKINS.prata.lcdFg} glow={SKINS.prata.lcdGlow}>TWITCH YOUTUBE KICK</LcdText>
        </Lcd>
      </div>
    </AbsoluteFill>
  );
}

const PLATS: Plat[] = ['twitch', 'youtube', 'kick'];

function Platforms() {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!between(f, 6, 10.2)) return null;
  const merge = ramp(f, 8, 8.5);
  const out = ramp(f, 9.7, 10.1, Easing.in(Easing.quad));
  const from = [{ x: -900, y: 0 }, { x: 0, y: -1200 }, { x: 900, y: 0 }];
  const spread = [{ x: -310, y: 60 }, { x: 0, y: 60 }, { x: 310, y: 60 }];
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: 1 - out, transform: `scale(${1 - out * 0.3})` }}>
      <Kinetic words={[['TWITCH', 6], ['YOUTUBE', 6.5], ['KICK', 7]]} until={7.95} size={70} top={360} />
      <Kinetic words={[['NUMA', 8.5], ['LISTA', 9], ['SÓ', 9.5]]} until={10.1} size={92} top={330} />
      {PLATS.map((p, i) => {
        const inn = spring({ frame: f - s(6 + i * 0.5), fps, config: { damping: 9, stiffness: 200 } });
        const x = interpolate(inn, [0, 1], [from[i].x, spread[i].x]) * (1 - merge) + -170 * merge;
        const y = interpolate(inn, [0, 1], [from[i].y, spread[i].y]) * (1 - merge) + (-110 + i * 150) * merge;
        const size = (250 - 140 * merge) * (1 + 0.15 * hit(f, [6 + i * 0.5], 0.2));
        return (
          <div key={p} style={{ position: 'absolute', transform: `translate(${x}px, ${y}px) rotate(${(1 - inn) * (i - 1) * 40}deg)`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
            <div style={{ filter: 'drop-shadow(0 10px 30px rgba(0,0,0,.6))' }}><PlatLogo plat={p} size={size} /></div>
            <div style={{ fontFamily: FONT.ui, fontWeight: 700, fontSize: 38, color: '#e9edf2', opacity: 1 - merge, height: 44 * (1 - merge) }}>{PLAT_NAME[p]}</div>
          </div>
        );
      })}
      {[0, 1, 2].map(i => (
        <div key={i} style={{ position: 'absolute', left: '50%', top: '50%', transform: `translate(${-170 + 75}px, ${-110 + i * 150 - 23}px)`, display: 'flex', alignItems: 'center', gap: 18, opacity: merge }}>
          <Eq color={SKINS.prata.lcdFg} glow={SKINS.prata.lcdGlow} h={46} w={9} gap={5} />
          <div style={{ width: (300 - i * 60) * ramp(f, 8.2 + i * 0.12, 8.6 + i * 0.12), height: 26, borderRadius: 13, background: 'linear-gradient(180deg,#f7f8f9,#b3b8c0)' }} />
        </div>
      ))}
    </AbsoluteFill>
  );
}

// ---------------- o celular ----------------

/** Pontos da tela do celular (em px do vídeo, a partir do centro do aparelho) para os zooms. */
const ZOOM = {
  counter: { x: -473, y: 1150, s: 2.2 },
  segment: { x: 0, y: 730, s: 1.9 },
  panel: { x: 0, y: 260, s: 1.7 },
  input: { x: 0, y: 665, s: 1.8 },
  card: { x: 0, y: 140, s: 1.45 },
  notify: { x: 0, y: 700, s: 1.6 },
};
const REST = { y: 150, s: 0.92 };

function PhoneFrame({ children, skin = 'prata' as SkinKey }: { children: ReactNode; skin?: SkinKey }) {
  const metal: Record<SkinKey, string> = {
    prata: 'linear-gradient(160deg,#f7f8f9 0%,#9aa0a9 30%,#eef0f3 55%,#7d838c 80%,#d6d9de 100%)',
    azul: 'linear-gradient(160deg,#e8f0ff 0%,#7394d4 30%,#dae6fc 55%,#4f6fb0 80%,#b5cbf2 100%)',
    preto: 'linear-gradient(160deg,#5a5d63 0%,#1c1d20 30%,#44464b 55%,#111214 80%,#34363a 100%)',
  };
  return (
    <div style={{ padding: 14, borderRadius: 74, background: metal[skin], boxShadow: '0 40px 90px rgba(0,0,0,.6), inset 0 2px 2px rgba(255,255,255,.6)' }}>
      <div style={{ width: 390 * 1.55, height: 800 * 1.55, borderRadius: 60, overflow: 'hidden', background: '#000' }}>
        <div style={{ transform: 'scale(1.55)', transformOrigin: 'top left' }}>{children}</div>
      </div>
    </div>
  );
}

function Phone() {
  const f = useCurrentFrame();
  if (!between(f, 9.5, 38.1)) return null;
  const p = pose(f, [
    [9.5, { y: 1700, ry: 85, s: 0.8, rz: 10 }],
    [10.35, { ...REST, ry: -14, rz: -3 }],
    [10.9, { ...REST, ry: -6 }],
    [11.2, ZOOM.counter],
    [12.25, ZOOM.counter],
    [12.6, { ...REST, ry: 10, rz: 2 }],
    [14.4, { ...REST, s: 0.88, ry: -14, rz: -2 }],
    [16, { ...REST, s: 0.88, ry: 14, rz: 2 }],
    [17.7, { ...REST, s: 0.9, ry: -4 }],
    [18.15, ZOOM.segment],
    [19.4, ZOOM.segment],
    [19.75, { ...REST }],
    [20.1, ZOOM.panel],
    [21.7, ZOOM.panel],
    [21.95, { ...REST, s: 1.1, y: 250 }],
    [22.15, ZOOM.panel],
    [23.7, ZOOM.panel],
    [23.85, { ...REST, ry: 0 }],
    [24.0, { ...REST, ry: 90 }],
    [24.2, { ...REST, ry: 0 }],
    [24.45, ZOOM.input],
    [25.6, ZOOM.input],
    [26.0, ZOOM.card],
    [27.4, ZOOM.card],
    [27.7, { ...REST }],
    [27.85, { ...REST, ry: 0 }],
    [28.0, { ...REST, ry: -90 }],
    [28.15, { ...REST, ry: 0 }],
    [28.4, ZOOM.notify],
    [29.6, ZOOM.notify],
    [29.95, { ...REST, s: 0.8, y: 200 }],
    [31.7, { ...REST, s: 0.8, y: 200 }],
    [32.1, { ...REST, s: 0.95, ry: -10 }],
    [33.9, { ...REST, s: 0.95, ry: 10 }],
    [34.4, { x: 250, y: 470, s: 0.5, ry: -22, rz: 4 }],
    [37.6, { x: 230, y: 450, s: 0.52, ry: -14, rz: 2 }],
    [38.1, { x: 1400, y: 450, s: 0.5, ry: -60 }],
  ]);
  const add = between(f, 24, 28);
  const buzz = hit(f, [T.notify[0]], 0.5) * 0.9; // celular vibrando com o push
  return (
    <div style={{ position: 'absolute', left: '50%', top: 1040, transformStyle: 'preserve-3d', transform: `translate(-50%, -50%) ${shake(f, buzz)} ${poseCss(p)}` }}>
      <PhoneFrame skin={skinAt(f)}>{add ? <AddScreen f={f} /> : <AppScreen f={f} />}</PhoneFrame>
    </div>
  );
}

/** 30–32 s: as três skins lado a lado. */
function SkinTrio() {
  const f = useCurrentFrame();
  if (!between(f, 29.9, 32.2)) return null;
  const open = ramp(f, 30, 30.45, Easing.out(Easing.back(1.4)));
  const close = ramp(f, 31.7, 32.1, Easing.in(Easing.cubic));
  const k = open * (1 - close);
  return (
    <>
      {(['azul', 'preto'] as SkinKey[]).map((sk, i) => {
        const dir = i === 0 ? -1 : 1;
        return (
          <div key={sk} style={{ position: 'absolute', left: '50%', top: 1040, transform: `translate(-50%, -50%) translate(${dir * 330 * k}px, ${190 + 40 * k}px) rotateY(${-dir * 28 * k}deg) rotateZ(${dir * 6 * k}deg) scale(${0.62 + 0.04 * k})`, opacity: k }}>
            <PhoneFrame skin={sk}><AppScreen f={f} skinKey={sk} force="top" /></PhoneFrame>
          </div>
        );
      })}
    </>
  );
}

/** 34–38 s: a versão web entrando. */
function Web() {
  const f = useCurrentFrame();
  if (!between(f, 34.2, 38.1)) return null;
  const inn = ramp(f, 34.4, 34.9, Easing.out(Easing.back(1.2)));
  const out = ramp(f, 37.6, 38.05, Easing.in(Easing.cubic));
  return (
    <div style={{ position: 'absolute', left: '50%', top: 860, transform: `translate(-50%, -50%) translateX(${(1 - inn) * -1300 - out * 1300}px) perspective(1600px) rotateY(${12 - 4 * inn}deg) scale(0.96)` }}>
      <WebScreen />
    </div>
  );
}

// ---------------- montagem final ----------------

function Montage() {
  const f = useCurrentFrame();
  if (!between(f, 38, 42)) return null;
  const i = Math.min(7, Math.floor((f - s(38)) / 15));
  const local = (f - s(CUTS[i])) / 15; // 0 → 1 dentro do corte
  const punch = 1.25 - 0.25 * Math.min(1, local * 3);
  const words = ['AO VIVO', 'TWITCH', 'YOUTUBE', 'KICK', 'MAIS VISTOS', 'CATEGORIAS', 'AVISOS', 'SKINS'];
  const skin = SKINS.prata;
  const content = [
    <Lcd key="lcd" skin={skin} style={{ padding: '40px 60px', borderRadius: 30, display: 'flex', alignItems: 'center', gap: 40 }}>
      <Eq color={skin.lcdFg} glow={skin.lcdGlow} h={150} w={26} bars={4} gap={12} />
      <LcdText size={190} color={skin.lcdFg} glow="0 0 20px rgba(98,255,159,.8)">8733</LcdText>
    </Lcd>,
    <PlatLogo key="t" plat="twitch" size={520} />,
    <PlatLogo key="y" plat="youtube" size={560} />,
    <PlatLogo key="k" plat="kick" size={520} />,
    <div key="row" style={{ width: 390, transform: 'scale(2.4)' }}><Row live={TOP[0]} skin={skin} featured kind={0} /></div>,
    <div key="gta" style={{ transform: 'scale(1.35)' }}><PhoneFrame><AppScreen f={f} force="gta" /></PhoneFrame></div>,
    <div key="push" style={{ transform: 'scale(2.4)' }}><Notification f={f} always /></div>,
    <div key="skins" style={{ display: 'flex', gap: 30, transform: 'scale(0.6)' }}>
      {(['azul', 'prata', 'preto'] as SkinKey[]).map(k => <PhoneFrame key={k} skin={k}><AppScreen f={f} skinKey={k} force="top" /></PhoneFrame>)}
    </div>,
  ][i];
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <SpeedLines opacity={0.6} />
      <div style={{ transform: `scale(${punch}) rotate(${(i % 2 ? 1 : -1) * 3 * (1 - Math.min(1, local * 3))}deg)`, marginTop: 120 }}>{content}</div>
      <div style={{ position: 'absolute', top: 210, left: 0, right: 0, transform: `scale(${1.4 - 0.4 * Math.min(1, local * 4)})` }}>
        <Headline size={Math.min(110, 980 / (words[i].length * 0.92))}>{words[i]}</Headline>
      </div>
    </AbsoluteFill>
  );
}

// ---------------- final ----------------

function Outro() {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (f < s(42)) return null;
  const slam = spring({ frame: f - s(42), fps, config: { damping: 11, stiffness: 170 } });
  const sweep = interpolate(f, [s(42.6), s(43.8)], [-1, 1.4], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const fade = ramp(f, 44.6, 46, Easing.linear);
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: 1 - fade }}>
      <SpeedLines opacity={0.7 * (1 - ramp(f, 42, 43))} />
      <Shockwave at={42} y={820} />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 46, transform: 'translateY(-60px)' }}>
        <div style={{ position: 'relative', transform: `scale(${interpolate(slam, [0, 1], [2.2, 1])})`, opacity: Math.min(1, slam * 3) }}>
          <Logo size={460} style={{ filter: 'drop-shadow(0 0 70px rgba(98,255,159,.55))' }} />
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', overflow: 'hidden', mixBlendMode: 'screen' }}>
            <div style={{ position: 'absolute', top: '-20%', bottom: '-20%', width: '30%', left: `${sweep * 100}%`, background: 'linear-gradient(90deg,transparent,rgba(255,255,255,.8),transparent)', transform: 'skewX(-18deg)' }} />
          </div>
        </div>
        <Headline size={70} style={{ letterSpacing: '.08em', opacity: ramp(f, 42.5, 42.8), transform: `scale(${1.3 - 0.3 * ramp(f, 42.5, 42.8)})` }}>MULTISTREAMS</Headline>
        <div style={{ fontFamily: FONT.ui, fontWeight: 700, fontSize: 46, color: '#eef0f3', textAlign: 'center', lineHeight: 1.2, whiteSpace: 'pre-line', opacity: ramp(f, 43, 43.3), transform: `translateY(${(1 - ramp(f, 43, 43.3)) * 30}px)` }}>
          {'Quem está ao vivo agora,\nnuma lista só.'}
        </div>
        <Lcd skin={SKINS.prata} style={{ padding: '16px 28px', opacity: ramp(f, 43.5, 43.8) }}>
          <LcdText size={30} color={SKINS.prata.lcdFg} glow={SKINS.prata.lcdGlow}>WEB ANDROID IOS</LcdText>
        </Lcd>
      </div>
    </AbsoluteFill>
  );
}

/** Legendas do trecho do celular, uma palavra por batida. */
function Captions() {
  return (
    <>
      <Kinetic words={[['TODO', 10.5], ['MUNDO', 11], ['AO VIVO', 11.5]]} sub="Twitch, YouTube e Kick" subAt={12} until={14} />
      <Kinetic words={[['LISTA', 14], ['INFINITA', 14.5]]} sub="milhares de lives agora" subAt={15} until={18} />
      <Kinetic words={[['MAIS', 18.5], ['OU', 18.75], ['MENOS', 19]]} sub="espectadores, você escolhe" subAt={19.25} until={20} />
      <Kinetic words={[['SEU', 20], ['IDIOMA', 20.5]]} until={22} />
      <Kinetic words={[['SEU', 22], ['JOGO', 22.5]]} until={24} />
      <Kinetic words={[['COLE', 24.25], ['O', 24.5], ['LINK', 24.75]]} sub="e o canal entra na lista" subAt={26} until={28} />
      <Kinetic words={[['AVISA', 28.25], ['NA', 28.5], ['HORA', 28.75]]} until={30} />
      <Kinetic words={[['ESCOLHA', 30], ['SUA', 30.5], ['SKIN', 31]]} until={34} />
      <Kinetic words={[['WEB', 34.5], ['ANDROID', 35], ['IOS', 35.5]]} sub="o mesmo app em todo lugar" subAt={36} until={38} top={150} size={80} />
    </>
  );
}

export function Promo() {
  const f = useCurrentFrame();
  // "soco" leve em cada batida depois que o groove fica cheio, e tremida nos impactos
  const bump = 1 + 0.012 * beatPulse(f, 10) * (f < s(42) ? 1 : 0);
  const quake = hit(f, SLAMS, 0.3) * 0.8;
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <Backdrop />
      <AbsoluteFill style={{ transform: `${shake(f, quake)} scale(${bump})` }}>
        <Intro />
        <Platforms />
        <SkinTrio />
        <Web />
        <Phone />
        {/* faixa escura no topo para as legendas lerem bem por cima dos zooms */}
        {between(f, 10, 34) ? <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(2,4,8,.85) 0%, rgba(2,4,8,.55) 22%, transparent 34%)' }} /> : null}
        <Captions />
        <Montage />
        <Outro />
      </AbsoluteFill>
      <Flash times={[2, 42]} strength={0.8} />
      <Flash times={[6, 6.5, 7, 10, 18, 24, 28, 30, 34, ...CUTS]} strength={0.25} />
      <AbsoluteFill style={{ background: '#000', opacity: ramp(f, 45, 46, Easing.linear) }} />
      <Soundtrack />
    </AbsoluteFill>
  );
}
