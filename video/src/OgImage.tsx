import { AbsoluteFill } from 'remotion';
import { Headline } from './fx';
import { Eq, FONT, Lcd, LcdText, Logo, PlatLogo, SKINS } from './ui';

/** Imagem de prévia de link (Open Graph, 1200×630): o que aparece ao compartilhar o site. */
export function OgImage() {
  const skin = SKINS.prata;
  return (
    <AbsoluteFill style={{ background: 'radial-gradient(90% 120% at 30% 40%, #12203a 0%, #070b14 60%, #020306 100%)', fontFamily: FONT.ui }}>
      <AbsoluteFill
        style={{
          opacity: 0.12,
          backgroundImage: 'linear-gradient(rgba(98,255,159,.8) 2px, transparent 2px), linear-gradient(90deg, rgba(98,255,159,.8) 2px, transparent 2px)',
          backgroundSize: '60px 60px',
        }}
      />
      <AbsoluteFill style={{ background: 'radial-gradient(40% 60% at 22% 50%, rgba(98,255,159,.22) 0%, transparent 70%)' }} />
      <div style={{ position: 'absolute', left: 70, top: 0, bottom: 0, display: 'flex', alignItems: 'center' }}>
        <Logo size={380} style={{ filter: 'drop-shadow(0 0 50px rgba(98,255,159,.5))' }} />
      </div>
      <div style={{ position: 'absolute', left: 500, right: 60, top: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 26 }}>
        <Headline size={52} style={{ textAlign: 'left', letterSpacing: '.06em' }}>Multistreams</Headline>
        <div style={{ fontSize: 46, fontWeight: 700, lineHeight: 1.15, color: '#eef0f3' }}>Quem está ao vivo agora, numa lista só.</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <PlatLogo plat="twitch" size={64} />
          <PlatLogo plat="youtube" size={64} />
          <PlatLogo plat="kick" size={64} />
          <Lcd skin={skin} style={{ marginLeft: 10, height: 64, padding: '0 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <Eq color={skin.lcdFg} glow={skin.lcdGlow} h={34} w={7} bars={5} gap={5} />
            <LcdText size={30} color={skin.lcdFg} glow={skin.lcdGlow}>8733</LcdText>
          </Lcd>
        </div>
      </div>
    </AbsoluteFill>
  );
}
