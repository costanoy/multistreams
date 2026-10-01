import { Easing } from 'remotion';
import { between, ramp } from './fx';
import { Eq, FONT, Lcd, LcdText, Live, Logo, PlatLogo, Row, SH, SKINS, Skin, SkinKey, s } from './ui';

// streamers fictícios (nenhum é uma pessoa real)
export const TOP: Live[] = [
  { name: 'luminara', plat: 'twitch', viewers: 18420, title: 'Speedrun any%: tentando abaixo de 30 min', cat: 'Celeste', hue: 280 },
  { name: 'Nico Turbo', plat: 'youtube', viewers: 12100, title: 'Montando um PC só com peças de 2003', cat: 'Ciência e tecnologia', hue: 18 },
  { name: 'ravenfall', plat: 'kick', viewers: 9800, title: 'ranked até o diamante', cat: 'VALORANT', hue: 150 },
  { name: 'mariaflux', plat: 'twitch', viewers: 6240, title: 'Café, conversa e planos da semana', cat: 'Just Chatting', hue: 45 },
  { name: 'PixelTia', plat: 'kick', viewers: 4100, title: 'pixel art + lofi, desenhando seus pets', cat: 'Arte', hue: 330 },
  { name: 'vale.gg', plat: 'youtube', viewers: 2870, title: 'Reagindo aos setups de vocês', cat: 'Jogos', hue: 200 },
  { name: 'Le Soleil', plat: 'twitch', viewers: 2410, title: 'Mario 64 sem dano', cat: 'Super Mario 64', hue: 38 },
  { name: 'kurokami', plat: 'kick', viewers: 1980, title: 'torneio da comunidade', cat: 'Splatoon 3', hue: 355 },
  { name: 'OldSchoolAna', plat: 'youtube', viewers: 1520, title: 'jogando fitas de locadora', cat: 'Jogos', hue: 100 },
  { name: 'marlo', plat: 'twitch', viewers: 1210, title: 'xadrez valendo inscrito', cat: 'Chess', hue: 60 },
];
export const LOW: Live[] = [
  { name: 'zeroping', plat: 'twitch', viewers: 0, title: 'primeira live! bora', cat: 'Minecraft', hue: 110 },
  { name: 'bea.plays', plat: 'kick', viewers: 1, title: 'zerando o jogo do zero', cat: 'Hollow Knight', hue: 260 },
  { name: 'tiltproof', plat: 'twitch', viewers: 1, title: 'treino de mira 1h', cat: 'Counter-Strike', hue: 20 },
  { name: 'arcadia_rei', plat: 'youtube', viewers: 2, title: 'fliperama raiz', cat: 'Jogos', hue: 300 },
  { name: 'Bruno Bits', plat: 'kick', viewers: 3, title: 'consertando um Game Boy', cat: 'Ciência e tecnologia', hue: 190 },
  { name: 'kaizo_ken', plat: 'twitch', viewers: 4, title: 'fase impossível, tentativa 412', cat: 'Super Mario Maker 2', hue: 0 },
];
export const GTA: Live[] = [
  { name: 'ravenfall', plat: 'kick', viewers: 21300, title: 'RP na cidade: dia 40', cat: 'Grand Theft Auto V', hue: 210 },
  { name: 'luminara', plat: 'twitch', viewers: 15800, title: 'polícia x ladrão no servidor', cat: 'Grand Theft Auto V', hue: 30 },
  { name: 'Nico Turbo', plat: 'youtube', viewers: 7400, title: 'testando os carros mais lentos', cat: 'Grand Theft Auto V', hue: 120 },
  { name: 'mariaflux', plat: 'kick', viewers: 3900, title: 'primeiro dia no RP', cat: 'Grand Theft Auto V', hue: 350 },
  { name: 'PixelTia', plat: 'twitch', viewers: 2100, title: 'corrida de táxi mais longa', cat: 'Grand Theft Auto V', hue: 60 },
  { name: 'kaizo_ken', plat: 'youtube', viewers: 1300, title: 'só de bicicleta pela cidade', cat: 'Grand Theft Auto V', hue: 260 },
];

/** Roteiro da tela "Ao vivo" (segundos do vídeo). */
export const T = {
  count: [11, 12.4] as const,
  cascade: 12.5,
  scroll: [14, 18] as const,
  asc: 18.5,
  langPanel: [20, 21.9] as const,
  langCheck: 21.2,
  catPanel: [22, 23.9] as const,
  catCheck: 23,
  add: [24, 28] as const,
  notify: [28.25, 29.9] as const,
};

export const skinAt = (f: number): SkinKey => {
  // 32–34 s: troca de skin a cada batida
  if (between(f, 32, 34)) return (['azul', 'preto', 'prata', 'azul', 'preto', 'prata'] as SkinKey[])[Math.floor((f - s(32)) / 10) % 6];
  return 'prata';
};

function Header({ skin, title, count }: { skin: Skin; title: string; count: number }) {
  return (
    <div style={{ background: skin.frame, padding: '44px 16px 12px', display: 'flex', alignItems: 'center', gap: 10, boxShadow: 'inset 0 -1px 0 rgba(0,0,0,.28), 0 3px 10px rgba(0,0,0,.16)', zIndex: 2, position: 'relative' }}>
      <div style={{ flex: 1, fontFamily: FONT.brand, fontSize: 17, letterSpacing: '.04em', color: skin.frameInk }}>{title}</div>
      <Lcd skin={skin} style={{ padding: '6px 9px', display: 'flex', alignItems: 'center', gap: 7 }}>
        <Eq color={skin.lcdFg} h={14} />
        <LcdText size={15} color={skin.lcdFg} glow={skin.lcdGlow}>{String(count).padStart(2, '0')}</LcdText>
      </Lcd>
    </div>
  );
}

function TabBar({ skin, active }: { skin: Skin; active: number }) {
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: skin.frame, padding: '8px 18px 20px', display: 'flex', justifyContent: 'space-around', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.6), 0 -3px 10px rgba(0,0,0,.14)', zIndex: 4 }}>
      {[['◉', 'Ao vivo'], ['+', 'Adicionar'], ['≡', 'Ajustes']].map(([g, l], i) => {
        const on = i === active;
        return (
          <div key={l} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div style={{ width: on ? 64 : 40, height: 40, borderRadius: 999, background: on ? skin.btnOn : skin.btn, boxShadow: on ? 'inset 0 2px 5px rgba(0,0,0,.35)' : SH.bulb, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, color: skin.btnInk, fontFamily: FONT.ui }}>{g}</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: skin.frameInk, fontFamily: FONT.ui }}>{l}</div>
          </div>
        );
      })}
    </div>
  );
}

/** Tela "Ao vivo" do app (390×800), animada pelo quadro do vídeo. `force` congela um estado (para a montagem final). */
export function AppScreen({ f, skinKey, force }: { f: number; skinKey?: SkinKey; force?: 'top' | 'gta' }) {
  const skin = SKINS[skinKey ?? skinAt(f)];
  const asc = !force && between(f, T.asc, T.langPanel[0]);
  const gta = force === 'gta' || (!force && f >= s(T.catCheck));
  const count = force ? 8733 : Math.round(8733 * ramp(f, T.count[0], T.count[1], Easing.out(Easing.quad)));
  const total = gta ? 412 : count;
  const list = gta ? GTA : asc ? LOW : TOP;
  const startAt = force ? -1 : gta ? T.catCheck + 0.1 : asc ? T.asc + 0.1 : T.cascade;
  // rolagem infinita: a lista corre para baixo e volta (14–18 s), com borrão de movimento
  const scrollAt = (ff: number) =>
    force ? 0 : 1500 * (ramp(ff, T.scroll[0], T.scroll[0] + 1.6, Easing.inOut(Easing.quad)) - ramp(ff, T.scroll[1] - 1.4, T.scroll[1], Easing.inOut(Easing.quad)));
  const scroll = scrollAt(f);
  const blur = Math.min(7, Math.abs(scroll - scrollAt(f - 1)) / 8);
  const rows = asc || gta ? list : [...list, ...TOP, ...TOP];

  return (
    <div style={{ width: 390, height: 800, background: skin.panel, display: 'flex', flexDirection: 'column', fontFamily: FONT.ui, overflow: 'hidden', position: 'relative' }}>
      <Header skin={skin} title="AO VIVO" count={total} />
      <div style={{ padding: '14px 12px 0', display: 'flex', flexDirection: 'column', gap: 12, position: 'relative', zIndex: 2, background: skin.panel }}>
        <div style={{ display: 'flex', padding: 3, gap: 3, borderRadius: 12, background: skin.frame, boxShadow: 'inset 0 1px 3px rgba(0,0,0,.25)' }}>
          {[['Mais espectadores', !asc], ['Menos espectadores', asc], ['Seguindo', false]].map(([label, on], i) => (
            <div key={i} style={{ flex: i === 2 ? 0.75 : 1.1, height: 32, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', background: on ? skin.card : 'transparent', boxShadow: on ? '0 1px 3px rgba(0,0,0,.2)' : 'none', fontSize: 11.5, fontWeight: 600, color: on ? skin.ink : skin.frameInk }}>{label}</div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.14em', color: skin.muted }}>{total.toLocaleString('pt-BR')} CANAIS NO AR</div>
          <div style={{ display: 'flex', gap: 5 }}>
            {['Todas', 'PT', gta ? 'GTA V' : 'Categorias'].map((p, i) => (
              <div key={p} style={{ fontSize: 11, fontWeight: 600, color: skin.ink, padding: '4px 9px', borderRadius: 999, background: skin.card, border: `1px solid ${i === 2 && gta ? skin.accent : skin.line}` }}>{p} ▾</div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ position: 'relative', padding: '0 12px', flex: 1 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, transform: `translateY(${-scroll}px)`, filter: blur > 0.3 ? `blur(${blur}px)` : undefined }}>
          {rows.map((live, i) => {
            const t = startAt < 0 ? 1 : ramp(f, startAt + Math.min(i, 6) * 0.25, startAt + Math.min(i, 6) * 0.25 + 0.3);
            return (
              <div key={`${live.name}-${i}-${asc}-${gta}`} style={{ opacity: t, transform: `translateX(${(1 - t) * 120}px)` }}>
                <Row live={live} skin={skin} featured={i === 0 && !asc} kind={i} />
              </div>
            );
          })}
        </div>
        {!force ? <Panels f={f} skin={skin} /> : null}
      </div>
      <TabBar skin={skin} active={0} />
      {!force ? <Notification f={f} /> : null}
    </div>
  );
}

/** Painéis de idioma e de categoria, com a busca sendo digitada. */
function Panels({ f, skin }: { f: number; skin: Skin }) {
  const lang = between(f, T.langPanel[0], T.langPanel[1]);
  const cat = between(f, T.catPanel[0], T.catPanel[1]);
  if (!lang && !cat) return null;
  const [a, b] = lang ? T.langPanel : T.catPanel;
  const inn = ramp(f, a, a + 0.2);
  const out = ramp(f, b - 0.2, b);
  const query = lang ? 'port' : 'gta';
  const typed = query.slice(0, Math.floor(query.length * ramp(f, a + 0.3, a + 0.9, Easing.linear)));
  const checked = f >= s(lang ? T.langCheck : T.catCheck);
  const rows: [string, string][] = lang
    ? (typed.length >= 2 ? [['Português', '']] : [['Português', ''], ['English', ''], ['Español', ''], ['日本語', '']])
    : typed.length >= 2 ? [['Grand Theft Auto V', '84K']] : [['Grand Theft Auto V', '84K'], ['Just Chatting', '33K'], ['IRL', '19K'], ['VALORANT', '12K']];
  return (
    <div style={{ position: 'absolute', top: 0, left: 12, right: 12, zIndex: 3, opacity: inn * (1 - out), transform: `translateY(${(1 - inn) * 24}px)`, background: skin.card, borderRadius: 14, boxShadow: `0 0 0 1px ${skin.line}, 0 10px 24px rgba(0,0,0,.25)`, padding: 9, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.14em', color: skin.muted }}>{lang ? 'MOSTRAR LIVES EM' : 'MOSTRAR SÓ ESTAS CATEGORIAS'}</div>
      <div style={{ height: 32, borderRadius: 9, background: skin.field, boxShadow: `inset 0 1px 3px rgba(0,0,0,.1), 0 0 0 1px ${skin.line}`, display: 'flex', alignItems: 'center', padding: '0 10px', fontSize: 13, color: typed ? skin.ink : skin.muted }}>
        {typed || (lang ? 'Buscar língua' : 'Buscar categoria ou jogo')}
        {typed && Math.floor(f / 8) % 2 ? <span style={{ width: 1.5, height: 16, background: skin.ink, marginLeft: 1 }} /> : null}
      </div>
      {rows.map(([name, n], i) => {
        const on = i === 0 && checked;
        return (
          <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, height: 32, padding: '0 7px', borderRadius: 9, background: on ? skin.field : 'transparent' }}>
            <div style={{ width: 16, height: 16, borderRadius: 5, background: on ? skin.accent : 'transparent', border: on ? 'none' : `1.5px solid ${skin.muted}`, color: skin.accentInk, fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${on ? 1 + 0.4 * (1 - ramp(f, lang ? T.langCheck : T.catCheck, (lang ? T.langCheck : T.catCheck) + 0.2)) : 1})` }}>{on ? '✓' : ''}</div>
            <div style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: skin.ink }}>{name}</div>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: skin.muted }}>{n}</div>
          </div>
        );
      })}
    </div>
  );
}

/** Push "está ao vivo", descendo do topo. */
export function Notification({ f, always }: { f: number; always?: boolean }) {
  const [a, b] = T.notify;
  if (!always && !between(f, a - 0.1, b + 0.3)) return null;
  const inn = always ? 1 : ramp(f, a, a + 0.35, Easing.bezier(0.2, 0.9, 0.3, 1.2));
  const out = always ? 0 : ramp(f, b - 0.2, b + 0.2);
  return (
    <div style={{ position: always ? 'relative' : 'absolute', top: always ? 0 : 40, left: always ? 0 : 8, right: always ? 0 : 8, width: always ? 374 : undefined, zIndex: 9, transform: `translateY(${(inn - 1) * 130 - out * 130}%)`, background: 'rgba(250,250,252,.95)', borderRadius: 22, padding: '12px 14px', boxShadow: '0 10px 30px rgba(0,0,0,.35)', display: 'flex', gap: 12, alignItems: 'flex-start', color: '#15171c', fontFamily: FONT.ui }}>
      <Logo size={38} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, fontWeight: 600, color: '#565b66', letterSpacing: '.02em' }}><span>MULTISTREAMS</span><span>agora</span></div>
        <div style={{ fontSize: 14, fontWeight: 700 }}>luminara está ao vivo</div>
        <div style={{ fontSize: 13 }}>Speedrun any%: tentando abaixo de 30 min · Twitch</div>
      </div>
    </div>
  );
}

/** Tela "Adicionar": o link sendo colado/digitado, o canal detectado e o botão. */
export function AddScreen({ f }: { f: number }) {
  const skin = SKINS.prata;
  const [a] = T.add;
  const url = 'twitch.tv/luminara';
  const typed = url.slice(0, Math.floor(url.length * ramp(f, a + 0.4, a + 1.6, Easing.linear)));
  const detected = f >= s(a + 1.75);
  const card = ramp(f, a + 1.75, a + 2.05);
  const press = f >= s(a + 3) ? 1 - 0.08 * Math.exp(-((f - s(a + 3)) / 4)) : 1;
  const added = f >= s(a + 3);
  const toast = ramp(f, a + 3.05, a + 3.3);
  return (
    <div style={{ width: 390, height: 800, background: skin.panel, fontFamily: FONT.ui, position: 'relative', overflow: 'hidden' }}>
      <Header skin={skin} title="ADICIONAR" count={8733} />
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', height: 48, borderRadius: 14, background: skin.field, boxShadow: `inset 0 2px 4px rgba(0,0,0,.12), 0 0 0 1px ${skin.line}`, padding: '0 14px', fontSize: 15, color: typed ? skin.ink : skin.muted }}>
          {typed || 'Cole o link ou busque pelo nome'}
          {typed && !detected && Math.floor(f / 8) % 2 ? <span style={{ width: 1.5, height: 18, background: skin.ink, marginLeft: 1 }} /> : null}
        </div>
        {detected ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, opacity: card, transform: `translateY(${(1 - card) * 30}px)` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: skin.ink }}><PlatLogo plat="twitch" size={18} /> Link da Twitch detectado</div>
            <div style={{ background: skin.card, borderRadius: 16, padding: 14, boxShadow: `0 0 0 1px ${skin.line}, 0 4px 12px rgba(0,0,0,.06)`, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'linear-gradient(135deg,hsl(280 60% 55%),hsl(320 60% 35%))', color: '#fff', fontWeight: 700, fontSize: 19, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>L</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: skin.ink }}>luminara</div>
                  <div style={{ fontSize: 12.5, color: skin.muted }}>Twitch · 12 mil seguidores</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {['Português', 'English', 'Español'].map((l, i) => (
                  <div key={l} style={{ height: 32, padding: '0 12px', borderRadius: 999, display: 'flex', alignItems: 'center', fontSize: 12.5, fontWeight: 600, background: i === 0 ? skin.accent : skin.field, color: i === 0 ? skin.accentInk : skin.ink, boxShadow: i === 0 ? 'none' : `0 0 0 1px ${skin.line}` }}>{l}</div>
                ))}
              </div>
              <div style={{ height: 46, borderRadius: 999, background: added ? skin.field : skin.accent, color: added ? skin.muted : skin.accentInk, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 600, transform: `scale(${press})`, boxShadow: added ? 'none' : 'inset 0 2px 1px rgba(255,255,255,.35), inset 0 -3px 6px rgba(0,0,0,.25)' }}>{added ? 'Já está na lista' : 'Adicionar'}</div>
            </div>
          </div>
        ) : null}
      </div>
      {toast > 0 ? (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 110, display: 'flex', justifyContent: 'center', opacity: toast, transform: `translateY(${(1 - toast) * 30}px)` }}>
          <Lcd skin={skin} style={{ borderRadius: 14, padding: '12px 16px' }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: skin.lcdFg, textShadow: skin.lcdGlow }}>luminara adicionado · Twitch</div>
          </Lcd>
        </div>
      ) : null}
      <TabBar skin={skin} active={1} />
    </div>
  );
}

/** A versão web: janela de navegador com a sidebar cromada. */
export function WebScreen() {
  const skin = SKINS.prata;
  return (
    <div style={{ width: 1000, height: 640, borderRadius: 18, overflow: 'hidden', background: skin.panel, fontFamily: FONT.ui, display: 'flex', flexDirection: 'column', boxShadow: '0 40px 90px rgba(0,0,0,.6), 0 0 0 2px rgba(255,255,255,.15)' }}>
      <div style={{ height: 40, background: 'linear-gradient(180deg,#e9ebee,#cfd3d8)', display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px' }}>
        {['#ff5f57', '#febc2e', '#28c840'].map(c => <div key={c} style={{ width: 13, height: 13, borderRadius: '50%', background: c }} />)}
        <div style={{ flex: 1, height: 24, marginLeft: 20, borderRadius: 8, background: 'rgba(255,255,255,.75)' }} />
      </div>
      <div style={{ flex: 1, display: 'flex' }}>
        <div style={{ width: 220, background: skin.frame, padding: '20px 14px', display: 'flex', flexDirection: 'column', gap: 18, boxShadow: 'inset -1px 0 0 rgba(0,0,0,.25)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Logo size={30} /><div style={{ fontFamily: FONT.brand, fontSize: 11.5, letterSpacing: '.08em', color: skin.frameInk }}>MULTISTREAMS</div></div>
          <Lcd skin={skin} style={{ padding: '10px 12px', borderRadius: 10, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ fontSize: 9, letterSpacing: '.16em', fontWeight: 600, color: skin.lcdFg }}>AO VIVO AGORA</div>
              <LcdText size={24} color={skin.lcdFg} glow={skin.lcdGlow}>8733</LcdText>
            </div>
            <Eq color={skin.lcdFg} h={24} w={4} bars={5} gap={3} />
          </Lcd>
          {['Ao vivo', 'Adicionar', 'Importar seguidos', 'Idiomas', 'Notificações', 'Skin'].map((n, i) => (
            <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 10, height: 30, padding: '0 10px', borderRadius: 10, background: i === 0 ? 'rgba(0,0,0,.14)' : 'transparent', fontSize: 13, fontWeight: 600, color: skin.frameInk }}>
              <div style={{ width: 12, height: 12, borderRadius: '50%', background: i === 0 ? skin.btnOn : skin.btn, boxShadow: SH.bulb }} />{n}
            </div>
          ))}
        </div>
        <div style={{ flex: 1, padding: '24px 26px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontFamily: FONT.brand, fontSize: 20, letterSpacing: '.04em', color: skin.ink }}>AO VIVO</div>
          {TOP.slice(0, 5).map((l, i) => <Row key={l.name} live={l} skin={skin} featured={i === 0} kind={i} />)}
        </div>
      </div>
    </div>
  );
}
