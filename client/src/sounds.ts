import { AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { useStore } from './store';

const SOURCES = {
  tap: require('../assets/sounds/tap.mp3'),
  on: require('../assets/sounds/switch-on.mp3'),
  off: require('../assets/sounds/switch-off.mp3'),
  startup: require('../assets/sounds/startup.mp3'),
};
type Sound = keyof typeof SOURCES;

/** Sons de interface ficam baixos; a abertura toca uma vez só, mais presente. */
const VOLUME: Record<Sound, number> = { tap: 0.45, on: 0.35, off: 0.35, startup: 0.8 };

const players: Partial<Record<Sound, AudioPlayer>> = {};
let ready = false;

/**
 * Toca um som do app. Os de interface (toque, liga/desliga) só tocam com "Sons dos botões"
 * ligado em Ajustes. Nunca quebra a tela se o áudio falhar.
 */
export function play(sound: Sound) {
  if (sound !== 'startup' && !useStore.getState().uiSounds) return;
  try {
    if (!ready) {
      ready = true;
      // respeita o modo silencioso e não interrompe música ou live tocando em outro app
      void setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' }).catch(() => {});
    }
    const p = (players[sound] ??= createAudioPlayer(SOURCES[sound]));
    p.volume = VOLUME[sound];
    void p.seekTo(0);
    p.play();
  } catch {
    // som é enfeite: se não tocar, segue a vida
  }
}
