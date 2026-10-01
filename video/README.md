# Vídeo de divulgação

Vídeo vertical (1080×1920, 46 s) feito em código com [Remotion](https://www.remotion.dev). Usa a música inteira (`public/music.wav`, 120 BPM) e cada cena começa num compasso de 2 s. O roteiro está no topo de `src/Promo.tsx`.

```bash
npm install
npm run studio   # abre o editor no navegador para ver e ajustar
npm run render   # gera out/multistreams-promo.mp4
```

Os streamers e as miniaturas do vídeo são fictícios: nenhuma pessoa ou transmissão real aparece.

O arquivo entregue também passou por um ajuste de volume (−14 LUFS, padrão das redes) e de faixa de cor:

```bash
ffmpeg -i out/multistreams-promo.mp4 -vf "scale=in_range=full:out_range=tv,format=yuv420p" -c:v libx264 -preset slow -crf 18 -movflags +faststart -af "loudnorm=I=-14:TP=-1.5:LRA=11,alimiter=limit=0.84:level=disabled" -c:a aac -b:a 256k out/final.mp4
```

Licença: o Remotion é gratuito para pessoas físicas e empresas de até 3 pessoas; acima disso exige licença paga.
