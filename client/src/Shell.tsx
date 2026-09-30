import { useGlobalSearchParams, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ReactNode, useEffect } from 'react';
import { BackHandler, Image, Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { go } from './open';
import { useLiveCards, useStore } from './store';
import { FONT, SH, grad } from './theme';
import { Btn, Eq, Lcd, LcdText, Rise, T, useSkin } from './ui';

const logo = require('../assets/images/logo-round.png');

type Key = 'radar' | 'add' | 'import' | 'settings' | 'languages' | 'notifications' | 'skins' | 'streamer';
const PATH: Record<Key, string> = { radar: '/', add: '/add', import: '/import', settings: '/settings', languages: '/languages', notifications: '/notifications', skins: '/skins', streamer: '/streamer' };
const TITLES: Record<Key, string> = { streamer: 'Streamer', radar: 'Ao vivo', add: 'Adicionar', import: 'Importar seguidos', settings: 'Ajustes', languages: 'Idiomas', notifications: 'Notificações', skins: 'Skin' };
const WEB_SUB: Partial<Record<Key, string>> = { radar: 'Quem está no ar agora, do mais assistido para o menos.', add: 'Cole o link do canal ou busque pelo nome.', import: 'Traga quem você já segue.', settings: 'Conta e preferências.', languages: 'Quais línguas aparecem em Ao vivo.', notifications: 'Escolha de quem receber aviso.', skins: 'A carcaça do seu radar.' };

export const useWide = () => {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' && width >= 900;
};

/** Onde estamos, o título e para onde o "voltar" leva. */
function useNav() {
  const pathname = usePathname();
  const { from, id } = useGlobalSearchParams<{ from?: string; id?: string }>();
  const screen = (Object.keys(PATH) as Key[]).find(k => PATH[k] === pathname) ?? 'radar';
  const name = useStore(s => (screen === 'streamer' ? s.streams.find(x => x.id === id)?.name : undefined));
  const backTo =
    screen === 'streamer' ? (from === 'notifications' ? '/notifications' : '/')
    : screen === 'import' ? (from === 'add' ? '/add' : '/settings')
    : ['languages', 'notifications', 'skins'].includes(screen) ? '/settings'
    : null;
  const tab: Key =
    screen === 'radar' || screen === 'add' ? screen
    : screen === 'streamer' ? (from === 'notifications' ? 'settings' : 'radar')
    : screen === 'import' && from === 'add' ? 'add'
    : 'settings';
  return { screen, title: (name ?? TITLES[screen]).toUpperCase(), sub: WEB_SUB[screen], backTo, tab };
}

function LiveCounter({ big }: { big?: boolean }) {
  const s = useSkin();
  const n = String(useLiveCards().length).padStart(2, '0');
  if (big) {
    return (
      <Lcd r={10} style={{ padding: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <View style={{ gap: 6 }}>
          <T s={10} w={600} ls={0.16} c={s.lcdFg}>AO VIVO AGORA</T>
          <LcdText s={30}>{n}</LcdText>
        </View>
        <Eq color={s.lcdFg} h={30} w={5} bars={5} gap={3} />
      </Lcd>
    );
  }
  return (
    <Lcd style={{ paddingVertical: 6, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 7 }}>
      <Eq color={s.lcdFg} h={14} />
      <LcdText>{n}</LcdText>
    </Lcd>
  );
}

function Header() {
  const s = useSkin();
  const { title, backTo } = useNav();
  const top = useSafeAreaInsets().top;
  return (
    <View style={[grad(s.frame, s.frameTop), { paddingTop: top + 8, paddingHorizontal: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 10, zIndex: 2, boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.28), 0 3px 10px rgba(0,0,0,0.16)' }]}>
      {backTo ? (
        <Pressable onPress={() => go(backTo)} hitSlop={8} style={[grad(s.btn, s.btnFlat), { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', boxShadow: SH.bulb }]}>
          <T s={22} c={s.btnInk} style={{ lineHeight: 24, marginTop: -3, marginRight: 2 }}>‹</T>
        </Pressable>
      ) : null}
      <T font="brand" s={Platform.OS === 'ios' ? 17 : 16} ls={0.04} c={s.frameInk} lines={1} style={{ flex: 1 }}>{title}</T>
      <LiveCounter />
    </View>
  );
}

const TABS: [Key, string, string][] = [['radar', 'Ao vivo', '◉'], ['add', 'Adicionar', '+'], ['settings', 'Ajustes', '≡']];

function TabBar() {
  const s = useSkin();
  const { tab } = useNav();
  const bottom = useSafeAreaInsets().bottom;
  return (
    <View style={[grad(s.frame, s.frameTop), { paddingTop: 8, paddingHorizontal: 18, paddingBottom: Math.max(bottom, 10), flexDirection: 'row', justifyContent: 'space-around', gap: 8, zIndex: 2, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6), 0 -3px 10px rgba(0,0,0,0.14)' }]}>
      {TABS.map(([k, label, glyph]) => {
        const on = tab === k;
        return (
          <Pressable key={k} onPress={() => go(PATH[k])} style={{ alignItems: 'center', gap: 4, minWidth: 64 }}>
            <View style={[grad(on ? s.btnOn : s.btn, on ? s.btnOnFlat : s.btnFlat), { width: Platform.OS === 'ios' || !on ? 40 : 64, height: 40, borderRadius: 999, alignItems: 'center', justifyContent: 'center', boxShadow: on ? SH.pressed : SH.bulb }]}>
              <T s={18} w={700} c={on ? s.btnOnInk : s.btnInk}>{glyph}</T>
            </View>
            <T s={11} w={600} c={s.frameInk}>{label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

const WEB_NAV: Key[] = ['radar', 'add', 'import', 'languages', 'notifications', 'skins'];

function Sidebar() {
  const s = useSkin();
  const { screen } = useNav();
  const account = useStore(st => st.account);
  return (
    <View style={[grad(s.frame, s.frameTop), { width: 256, gap: 22, paddingVertical: 24, paddingHorizontal: 16, zIndex: 2, boxShadow: 'inset -1px 0 0 rgba(0,0,0,0.25), 4px 0 14px rgba(0,0,0,0.12)' }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 6 }}>
        <Image source={logo} style={{ width: 34, height: 34, borderRadius: 17 }} />
        <T font="brand" s={13} ls={0.08} c={s.frameInk}>MULTISTREAMS</T>
      </View>
      <LiveCounter big />
      <View style={{ gap: 4 }}>
        {WEB_NAV.map(k => {
          const on = screen === k;
          return (
            <Pressable key={k} onPress={() => go(PATH[k])} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, height: 42, paddingHorizontal: 12, borderRadius: 12, backgroundColor: on ? 'rgba(0,0,0,0.14)' : 'transparent', boxShadow: on ? 'inset 0 1px 3px rgba(0,0,0,0.3)' : undefined }}>
              <View style={[grad(on ? s.btnOn : s.btn, on ? s.btnOnFlat : s.btnFlat), { width: 14, height: 14, borderRadius: 7, boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.8), inset 0 -2px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.3)' }]} />
              <T s={14} w={600} c={s.frameInk}>{TITLES[k]}</T>
            </Pressable>
          );
        })}
      </View>
      <View style={{ flex: 1 }} />
      <Pressable onPress={() => go('/settings')} style={[grad(s.btn, s.btnFlat), { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, paddingHorizontal: 12, borderRadius: 14, boxShadow: 'inset 0 2px 1px rgba(255,255,255,0.6), inset 0 -3px 6px rgba(0,0,0,0.2), 0 2px 5px rgba(0,0,0,0.2)' }]}>
        <AccountBadge size={30} />
        <View style={{ gap: 1, flex: 1 }}>
          <T s={13} w={700} c={s.btnInk}>{accountTitle(account?.provider)}</T>
          <T s={11} c={s.btnInk} lines={1}>{accountSub(!!account)}</T>
        </View>
      </Pressable>
    </View>
  );
}

export const accountTitle = (p?: 'twitch' | 'google') => (p === 'twitch' ? 'Conectado com Twitch' : p === 'google' ? 'Conectado com Google' : 'Sem conta');
export const accountSub = (on: boolean) => (on ? 'Lista sincronizada entre aparelhos' : 'Lista salva só neste aparelho');

export function AccountBadge({ size }: { size: number }) {
  const p = useStore(s => s.account?.provider);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: p === 'twitch' ? '#7c3aed' : p === 'google' ? '#2f63d6' : '#8a8f98', alignItems: 'center', justifyContent: 'center' }}>
      <T s={size * 0.4} w={700} c="#fff">{p === 'twitch' ? 'T' : p === 'google' ? 'G' : '?'}</T>
    </View>
  );
}

function Toast({ wide }: { wide: boolean }) {
  const s = useSkin();
  const toast = useStore(st => st.toast);
  const bottom = useSafeAreaInsets().bottom;
  if (!toast) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: wide ? 28 : bottom + 96, alignItems: 'center', paddingHorizontal: 16, zIndex: 18 }}>
      <Rise key={toast}>
        <Lcd r={14} style={{ paddingVertical: 12, paddingHorizontal: 16, boxShadow: '0 10px 26px rgba(0,0,0,0.35)' }}>
          <T s={13.5} w={600} c={s.lcdFg} glow={s.lcdGlow} center>{toast}</T>
        </Lcd>
      </Rise>
    </View>
  );
}

/** Carcaça do app: header + tab bar cromados no celular; sidebar cromada na web larga. */
export function Shell({ children }: { children: ReactNode }) {
  const s = useSkin();
  const wide = useWide();
  const pathname = usePathname();
  const { backTo } = useNav();
  const bare = pathname === '/onboarding';

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!backTo) return false;
      go(backTo);
      return true;
    });
    return () => sub.remove();
  }, [backTo]);

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
      <Toast wide={wide} />
    </View>
  );
}

/** Área rolável de cada tela. Na web larga, leva o título em Michroma e o subtítulo. */
export function Screen({ children, action }: { children: ReactNode; action?: { label: string; onPress: () => void } }) {
  const s = useSkin();
  const wide = useWide();
  const { title, sub } = useNav();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: s.panel }} keyboardShouldPersistTaps="handled" contentContainerStyle={wide ? { paddingTop: 32, paddingHorizontal: 36, paddingBottom: 48 } : { paddingTop: 16, paddingHorizontal: 14, paddingBottom: 24 }}>
      <View style={{ width: '100%', maxWidth: wide ? 1080 : undefined, alignSelf: 'center', gap: 16 }}>
        {wide ? (
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', paddingBottom: 4 }}>
            <View style={{ gap: 6 }}>
              <T s={24} ls={0.04} style={{ fontFamily: FONT.brand }}>{title}</T>
              {sub ? <T s={14} c={s.muted}>{sub}</T> : null}
            </View>
            {action ? <Btn kind="accent" h={42} fs={14} label={action.label} onPress={action.onPress} /> : null}
          </View>
        ) : null}
        {children}
      </View>
    </ScrollView>
  );
}
