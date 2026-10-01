import { Composition, Still } from 'remotion';
import { OgImage } from './OgImage';
import { Promo } from './Promo';
import { FPS } from './ui';

/** Vídeo de divulgação: vertical 1080×1920, 46 s (a música inteira, até o fim do fade out). */
export const Root = () => (
  <>
    <Composition id="Promo" component={Promo} durationInFrames={46 * FPS} fps={FPS} width={1080} height={1920} />
    <Still id="OgImage" component={OgImage} width={1200} height={630} />
  </>
);
