import { useGlobalSearchParams, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ReactNode, useEffect } from 'react';
import { BackHandler, Image, Platform, Pressable, ScrollView, View, ViewStyle, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DownloadApk } from './DownloadApk';
import { go, goBack, useHere } from './open';
import { play } from './sounds';
import { useLists, useStore } from './store';
import { FONT, SH, grad } from './theme';
import { Btn, Eq, Lcd, LcdText, Rise, T, WebSlop, useSkin } from './ui';

const logo = require('../assets/images/logo-small.png');

type Key = 'radar' | 'add' | 'import' | 'settings' | 'languages' | 'notifications' | 'skins' | 'streamer' | 'onboarding' | 'missing';
type Route = Exclude<Key, 'missing'>;
const PATH: Record<Route, string> = { radar: '/', add: '/add', import: '/import', settings: '/settings', languages: '/languages', notifications: '/notifications', skins: '/skins', streamer: '/streamer', onboarding: '/onboarding' };
const TITLES: Record<Key, string> = { streamer: 'Streamer', radar: 'Ao vivo', add: 'Adicionar', import: 'Importar seguidos', settings: 'Ajustes', languages: 'Idiomas', notifications: 'Notificações', skins: 'Skin', onboarding: 'Boas-vindas', missing: 'Página não encontrada' };
/** No header do celular, os títulos que não cabem. */
const SHORT: Partial<Record<Key, string>> = { import: 'Importar', missing: 'Não encontrada' };
const WEB_SUB: Partial<Record<Key, string>> = { add: 'Cole o link do canal ou busque pelo nome.', import: 'Traga quem você já segue.', settings: 'Conta e preferências.', languages: 'Quais línguas aparecem em Ao vivo.', notifications: 'Escolha de quem receber aviso.', skins: 'A carcaça do seu radar.' };

const keyOf = (path: string) => (Object.keys(PATH) as Route[]).find(k => PATH[k] === path);

/** Botões cromados da carcaça (abas, menu da web): som de toque + navegação. */
const tapGo = (href: string) => {
  play('tap');
  go(href);
};

/** Voltar (cromado, link da web larga, aba já acesa): som de toque + volta sem empilhar. */
const tapBack = (href: string) => {
  play('tap');
  goBack(href);
};

/**
 * Na web, o react-native-web não aciona com Enter um Pressable com role="link" (conta com o <a> do navegador):
 * espalhe isto nele para o teclado funcionar.
 */
export const enterKey = (fn: () => void) =>
  Platform.OS === 'web'
    ? ({
        onKeyDown: (e: { key: string; repeat: boolean }) => {
          if (e.key === 'Enter' && !e.repeat) fn();
        },
      } as object)
    : null;

export const useWide = () => {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' && width >= 900;
};

/** Onde estamos, o título e para onde o "voltar" leva. */
function useNav() {
  const pathname = usePathname();
  const { from, id } = useGlobalSearchParams<{ from?: string; id?: string }>();
  const onboarded = useStore(s => s.onboarded);
  const screen: Key = keyOf(pathname) ?? 'missing';
  const name = useStore(s => (screen === 'streamer' ? s.streams.find(x => x.id === id)?.name : undefined));
  const backTo =
    screen === 'streamer' ? (from === 'notifications' ? '/notifications' : from === 'add' ? '/add' : '/')
    : screen === 'import' ? (from === 'add' ? '/add' : from === 'onboarding' || from === 'radar' ? '/' : '/settings')
    // "Entrar" de Ajustes ou Notificações volta para lá; no primeiro uso, não há para onde voltar
    : screen === 'onboarding' ? (onboarded && (from === 'settings' || from === 'notifications') ? `/${from}` : null)
    : ['languages', 'notifications', 'skins'].includes(screen) ? '/settings'
    : null;
  // aba acesa no celular e item aceso no menu da web
  const tab: Key | null =
    screen === 'radar' || screen === 'add' ? screen
    : screen === 'streamer' ? (from === 'notifications' ? 'settings' : from === 'add' ? 'add' : 'radar')
    : screen === 'import' ? (from === 'add' ? 'add' : from === 'onboarding' || from === 'radar' ? 'radar' : 'settings')
    : screen === 'missing' ? null
    : 'settings';
  const menu: Key = screen === 'streamer' ? (from === 'notifications' ? 'notifications' : from === 'add' ? 'add' : 'radar') : screen;
  const plain = name ?? TITLES[screen];
  return { screen, from, plain, title: plain.toUpperCase(), short: (name ?? SHORT[screen] ?? plain).toUpperCase(), sub: WEB_SUB[screen], backTo, tab, menu };
}

/** Quantos dos seus estão ao vivo agora (em qualquer modo, sem filtro); o toque abre Seguindo. */
function LiveCounter({ big }: { big?: boolean }) {
  const s = useSkin();
  const { allLive } = useLists();
  // status que pode ter mudado (consulta falhou ou ficou velha) não conta como ao vivo
  const n = allLive.filter(x => !x.stale).length;
  // só sobrou status velho de quem estava ao vivo: "--" (00 diria que ninguém está)
  const unsure = !n && allLive.length > 0;
  const lcd = unsure ? '--' : String(n).padStart(2, '0');
  const open = () => {
    play('tap');
    useStore.setState({ view: 'following' });
    go('/');
  };
  const label =
    unsure ? 'Status de quem você segue ainda não confirmado. Abrir Seguindo'
    : n === 1 ? '1 streamer que você segue está ao vivo. Abrir Seguindo'
    : `${n} streamers que você segue estão ao vivo. Abrir Seguindo`;
  return (
    <Pressable role="button" aria-label={label} onPress={open} hitSlop={big ? undefined : 6} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
      <WebSlop n={big ? 0 : 6} />
      {big ? (
        <Lcd r={10} style={{ padding: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <View style={{ gap: 6 }}>
            <T s={10} w={600} ls={0.16} c={s.lcdFg}>SEGUINDO AO VIVO</T>
            <LcdText s={30}>{lcd}</LcdText>
          </View>
          <Eq color={s.lcdFg} h={30} w={5} bars={5} gap={3} still={!n} />
        </Lcd>
      ) : (
        <Lcd style={{ paddingVertical: 6, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <Eq color={s.lcdFg} h={14} still={!n} />
          <LcdText>{lcd}</LcdText>
        </Lcd>
      )}
    </Pressable>
  );
}

/** Voltar cromado de 36 px (header do celular e boas-vindas aberta por "Entrar"). */
export function BackButton({ to }: { to: string }) {
  const s = useSkin();
  return (
    <Pressable role="button" aria-label="Voltar" onPress={() => tapBack(to)} hitSlop={8} style={[grad(s.btn, s.btnFlat), { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', boxShadow: SH.bulb }]}>
      <WebSlop n={8} />
      <T s={22} c={s.btnInk} decorative style={{ lineHeight: 24, marginTop: -3, marginRight: 2 }}>‹</T>
    </Pressable>
  );
}

function Header() {
  const s = useSkin();
  const { short, backTo } = useNav();
  const top = useSafeAreaInsets().top;
  // altura fixa: com ou sem o voltar de 36 px, o conteúdo não pula
  return (
    <View style={[grad(s.frame, s.frameTop), { minHeight: top + 56, paddingTop: top + 8, paddingHorizontal: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 10, zIndex: 2, boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.28), 0 3px 10px rgba(0,0,0,0.16)' }]}>
      {backTo ? <BackButton to={backTo} /> : null}
      <T heading={1} font="brand" s={Platform.OS === 'ios' ? 17 : 16} ls={0.04} c={s.frameInk} lines={1} style={{ flex: 1 }}>{short}</T>
      <LiveCounter />
    </View>
  );
}

const TABS: [Route, string, string][] = [['radar', 'Ao vivo', '◉'], ['add', 'Adicionar', '+'], ['settings', 'Ajustes', '≡']];

function TabBar() {
  const s = useSkin();
  const { tab } = useNav();
  const bottom = useSafeAreaInsets().bottom;
  return (
    <View role="tablist" style={[grad(s.frame, s.frameTop), { paddingTop: 8, paddingHorizontal: 18, paddingBottom: Math.max(bottom, 10), flexDirection: 'row', justifyContent: 'space-around', gap: 8, zIndex: 2, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6), 0 -3px 10px rgba(0,0,0,0.14)' }]}>
      {TABS.map(([k, label, glyph]) => {
        const on = tab === k;
        // a aba acesa leva de volta ao começo dela (de Idiomas para Ajustes), sem empilhar
        return (
          <Pressable key={k} role="tab" aria-selected={on} aria-label={label} onPress={() => (on ? tapBack(PATH[k]) : tapGo(PATH[k]))} style={{ alignItems: 'center', gap: 4, minWidth: 64 }}>
            <View style={[grad(on ? s.btnOn : s.btn, on ? s.btnOnFlat : s.btnFlat), { width: Platform.OS === 'ios' || !on ? 40 : 64, height: 40, borderRadius: 999, alignItems: 'center', justifyContent: 'center', boxShadow: on ? SH.pressed : SH.bulb }]}>
              <T s={18} w={700} c={on ? s.btnOnInk : s.btnInk} decorative>{glyph}</T>
            </View>
            <T s={11} w={600} c={s.frameInk} decorative>{label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

const WEB_NAV: Route[] = ['radar', 'add', 'import', 'languages', 'notifications', 'skins', 'settings'];

/** Estado do Pressable na web (o react-native-web informa o hover). */
type Hover = { pressed: boolean; hovered?: boolean };

function Sidebar() {
  const s = useSkin();
  const { menu, screen } = useNav();
  const account = useStore(st => st.account);
  const hover = s.dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)';
  return (
    <View role="navigation" style={[grad(s.frame, s.frameTop), { width: 256, zIndex: 2, boxShadow: 'inset -1px 0 0 rgba(0,0,0,0.25), 4px 0 14px rgba(0,0,0,0.12)' }]}>
      {/* janela baixa (zoom, escala do sistema): o menu rola, e o espaçador continua levando o APK e a conta para o rodapé */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, gap: 22, paddingVertical: 24, paddingHorizontal: 16 }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 6 }}>
          <Image source={logo} alt="Logo do Multistreams" style={{ width: 34, height: 34, borderRadius: 17 }} />
          <T font="brand" s={13} ls={0.08} c={s.frameInk}>MULTISTREAMS</T>
        </View>
        <LiveCounter big />
        <View style={{ gap: 4 }}>
          {WEB_NAV.map(k => {
            const on = menu === k;
            // aceso por ser a origem do Detalhe: volta até ela; na própria tela, fica onde está (sem perder os parâmetros)
            const open = () => (!on ? tapGo(PATH[k]) : screen !== k ? tapBack(PATH[k]) : play('tap'));
            return (
              <Pressable
                key={k}
                role="link"
                {...(on ? ({ 'aria-current': 'page' } as object) : null)}
                {...enterKey(open)}
                onPress={open}
                style={(st: Hover) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, height: 42, paddingHorizontal: 12, borderRadius: 12, backgroundColor: on ? 'rgba(0,0,0,0.14)' : st.hovered ? hover : 'transparent', boxShadow: on ? 'inset 0 1px 3px rgba(0,0,0,0.3)' : undefined })}>
                <View style={[grad(on ? s.btnOn : s.btn, on ? s.btnOnFlat : s.btnFlat), { width: 14, height: 14, borderRadius: 7, boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.8), inset 0 -2px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.3)' }]} />
                <T s={14} w={600} c={s.frameInk}>{TITLES[k]}</T>
              </Pressable>
            );
          })}
        </View>
        <View style={{ flex: 1 }} />
        <DownloadApk variant="sidebar" />
        <Pressable role="link" aria-label={`${accountTitle(account?.provider)}. Abrir Ajustes`} {...enterKey(() => tapGo('/settings'))} onPress={() => tapGo('/settings')} style={[grad(s.btn, s.btnFlat), { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, paddingHorizontal: 12, borderRadius: 14, boxShadow: 'inset 0 2px 1px rgba(255,255,255,0.6), inset 0 -3px 6px rgba(0,0,0,0.2), 0 2px 5px rgba(0,0,0,0.2)' }]}>
          <AccountBadge size={30} />
          <View style={{ gap: 1, flex: 1 }}>
            <T s={13} w={700} c={s.btnInk}>{accountTitle(account?.provider)}</T>
            <T s={11} c={s.btnInk} lines={1}>{accountSub(!!account)}</T>
          </View>
        </Pressable>
      </ScrollView>
    </View>
  );
}

export const accountTitle = (p?: 'twitch' | 'google') => (p === 'twitch' ? 'Conectado com Twitch' : p === 'google' ? 'Conectado com Google' : 'Sem conta');
export const accountSub = (on: boolean) => (on ? 'Lista sincronizada entre aparelhos' : 'Lista salva só neste aparelho');

export function AccountBadge({ size }: { size: number }) {
  const p = useStore(s => s.account?.provider);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: p === 'twitch' ? '#7c3aed' : p === 'google' ? '#2f63d6' : '#8a8f98', alignItems: 'center', justifyContent: 'center' }}>
      <T s={size * 0.4} w={700} c="#fff" decorative>{p === 'twitch' ? 'T' : p === 'google' ? 'G' : '?'}</T>
    </View>
  );
}

/** Sempre montado: a região de status faz o leitor de tela ler cada aviso novo. Na web larga, centralizado no conteúdo. */
function Toast({ wide, left }: { wide: boolean; left: number }) {
  const s = useSkin();
  const toast = useStore(st => st.toast);
  const bottom = useSafeAreaInsets().bottom;
  return (
    <View role="status" aria-live="polite" style={{ position: 'absolute', left, right: 0, bottom: wide ? 28 : bottom + 96, alignItems: 'center', paddingHorizontal: 16, zIndex: 18, pointerEvents: 'none' }}>
      {toast ? (
        <Rise key={toast}>
          <Lcd r={14} style={{ paddingVertical: 12, paddingHorizontal: 16, boxShadow: '0 10px 26px rgba(0,0,0,0.35)' }}>
            <T s={13.5} w={600} c={s.lcdFg} glow={s.lcdGlow} center>{toast}</T>
          </Lcd>
        </Rise>
      ) : null}
    </View>
  );
}

/** Carcaça do app: header + tab bar cromados no celular; sidebar cromada na web larga. */
export function Shell({ children }: { children: ReactNode }) {
  const s = useSkin();
  const wide = useWide();
  const { backTo, plain, screen } = useNav();
  const bare = screen === 'onboarding';
  useHere();

  // título da aba do navegador por tela (a inicial mantém o título completo do index.html)
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    document.title = bare || screen === 'radar' ? 'Multistreams — quem está ao vivo na Twitch, YouTube e Kick' : `${plain} · Multistreams`;
  }, [bare, screen, plain]);

  // barra do navegador (celular) na cor do header e fundo da abertura na cor da skin (o index.html lê a skin salva)
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', s.frameTop);
    document.documentElement.style.setProperty('--boot-bg', s.panel);
  }, [s.frameTop, s.panel]);

  // voltar do Android: telas internas voltam para a de origem; as outras, para Ao vivo; o app só sai de Ao vivo
  // (e da boas-vindas do primeiro uso, que não tem para onde voltar)
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (backTo) {
        goBack(backTo);
        return true;
      }
      if (screen === 'radar' || screen === 'onboarding') {
        // sai daqui mesmo com telas empilhadas por baixo (um link recebido empilha): o voltar do expo-router mostraria a de baixo
        BackHandler.exitApp();
        return true;
      }
      goBack('/');
      return true;
    });
    return () => sub.remove();
  }, [backTo, screen]);

  return (
    <View style={{ flex: 1, backgroundColor: s.panel, flexDirection: wide && !bare ? 'row' : 'column' }}>
      <StatusBar style={s.dark ? 'light' : 'dark'} />
      {bare ? children : wide ? (
        <>
          <Sidebar />
          <View style={{ flex: 1 }}>{children}</View>
        </>
      ) : (
        <>
          <Header />
          <View style={{ flex: 1 }}>{children}</View>
          <TabBar />
        </>
      )}
      <Toast wide={wide} left={wide && !bare ? 256 : 0} />
    </View>
  );
}

type Action = { label: string; onPress: () => void };

/** Título em Michroma e subtítulo, só na web larga (no celular o título fica no header cromado). */
export function ScreenTitle({ action }: { action?: Action }) {
  const s = useSkin();
  const wide = useWide();
  const { title, sub, backTo } = useNav();
  if (!wide) return null;
  const dest = backTo ? TITLES[keyOf(backTo) ?? 'radar'] : null;
  return (
    <View style={{ gap: 8 }}>
      {backTo ? (
        <Pressable role="link" aria-label={`Voltar para ${dest}`} {...enterKey(() => tapBack(backTo))} onPress={() => tapBack(backTo)} hitSlop={6} style={{ alignSelf: 'flex-start' }}>
          {(st: Hover) => (
            <>
              <WebSlop n={6} />
              <T s={13} w={600} c={s.muted} style={st.hovered ? { textDecorationLine: 'underline' } : null}>‹ {dest}</T>
            </>
          )}
        </Pressable>
      ) : null}
      {/* altura do botão de ação (42 px, mais os 4 de baixo), com o título embaixo: a lista não desce quando ele aparece */}
      <View style={{ minHeight: 46, flexDirection: 'row', alignItems: 'flex-end', alignContent: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', paddingBottom: 4 }}>
        <View style={{ gap: 6 }}>
          <T heading={1} s={24} ls={0.04} style={{ fontFamily: FONT.brand }}>{title}</T>
          {sub ? <T s={14} c={s.muted}>{sub}</T> : null}
        </View>
        {action ? <Btn kind="accent" h={42} fs={14} label={action.label} onPress={action.onPress} /> : null}
      </View>
    </View>
  );
}

/** Espaçamento das telas: mais largo na web. */
export const usePad = () =>
  useWide() ? { paddingTop: 32, paddingHorizontal: 36, paddingBottom: 48 } : { paddingTop: 16, paddingHorizontal: 14, paddingBottom: 24 };

/** Coluna do conteúdo, centralizada: até 1080 px na web larga, ou `maxWidth` (que vale também fora dela). */
export const useColumn = (maxWidth?: number): ViewStyle => {
  const wide = useWide();
  return { width: '100%', maxWidth: maxWidth ?? (wide ? 1080 : undefined), alignSelf: 'center' };
};

/** Área rolável de cada tela. `maxWidth`: coluna mais estreita (título e conteúdo dividem a mesma). */
export function Screen({ children, action, maxWidth }: { children: ReactNode; action?: Action; maxWidth?: number }) {
  const s = useSkin();
  const col = useColumn(maxWidth);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: s.panel }} keyboardShouldPersistTaps="handled" contentContainerStyle={usePad()}>
      <View style={[col, { gap: 16 }]}>
        <ScreenTitle action={action} />
        {children}
      </View>
    </ScrollView>
  );
}
