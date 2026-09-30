# Brief: Multistreams

Sep 28, 2026 · @Vini

## O que é

Multistreams é um app que junta Twitch, YouTube e Kick em um só lugar e mostra quais dos streamers favoritos do usuário estão ao vivo agora.

Não é um multi-view (assistir várias lives ao mesmo tempo). O foco é ser um **radar**: uma lista única que mostra quem está online, em qualquer uma das três plataformas.

Lançamento completo desde o início: **web + app nativo Android + app nativo iOS**.

## Fluxo de trabalho

1. Claude (conversa): fechar escopo, funcionalidades e decisões técnicas. **Concluído.**
2. Claude Design: desenhar as telas (web, Android e iOS).
3. Claude Code: implementar.

## Plataformas de streaming (escopo inicial)

- Twitch
- YouTube
- Kick

## Funcionalidades

- **Lista de acompanhados:** o usuário cadastra os streamers que segue, indicando a plataforma de cada um.
- **Adicionar streamers de três formas:**
  - colar o link do canal (o app detecta a plataforma sozinho);
  - buscar pelo nome (no YouTube, incentivar o @handle);
  - importar quem já segue na Twitch e as inscrições do YouTube, via login com essas contas. Kick fica manual.
- **Ao vivo:** mostra título da live, jogo/categoria, thumbnail e número de viewers.
- **Abrir a live:** tocar em um streamer abre a live na plataforma original (no app da plataforma, se instalado).
- **Ordenação:**
  1. Primeiro pelas línguas de preferência do usuário (ele escolhe e ordena suas línguas).
  2. Depois pela quantidade de viewers, do maior para o menor.
- **Offline:** seção "Offline" abaixo dos ao vivo, recolhida por padrão, com "ao vivo há X dias".
- **Notificações push:** aviso quando um streamer entra ao vivo, com liga/desliga por streamer.

## Decisões fechadas

| Tema | Decisão |
| --- | --- |
| Plataforma | Web + app nativo Android + app nativo iOS, todos no lançamento |
| Conta | Login opcional. Sem conta, a lista fica salva no dispositivo. Com conta: sincronização entre aparelhos, push e importação de seguidos |
| Push | Sim, com toggle por streamer |
| Offline | Aparecem abaixo dos ao vivo, em seção recolhida |
| Adicionar streamers | Link do canal, busca por nome e importação |
| Modelo de negócio | Gratuito no lançamento. Depois, plano pago (mais streamers, notificação mais rápida, sincronização). Sem anúncios |

## Arquitetura e stack

Um único código em **Expo (React Native + TypeScript, com expo-router)** gera os apps iOS, Android e a versão web. Isso mantém o lançamento nas três frentes viável sem manter três projetos.

&#91;embedded content: arquitetura · apps, backend, worker, push e APIs\]

- **Backend:** Supabase (Postgres + autenticação) para contas, listas e status ao vivo.
- **Worker:** processo contínuo em Railway ou Fly faz o polling e recebe os webhooks do EventSub. Serverless (tipo Vercel) não serve para isso.
- **Push:** Expo Notifications, que entrega via APNs (iOS) e FCM (Android).
- **Regra de custo:** o polling é feito **por canal, não por usuário**. Se mil pessoas seguem o mesmo streamer, ele é consultado uma vez só. Isso controla a cota do YouTube e o custo de servidor.
- **Lojas:** publicar no iOS exige conta Apple Developer; no Android, conta Google Play Console.

## Notas técnicas por plataforma

- **Twitch:** API oficial Helix. "Get Streams" consulta até 100 canais por chamada e retorna o idioma da live. EventSub (stream.online / stream.offline) avisa em tempo real quem entrou ou saiu do ar. Importação de seguidos via login com Twitch.
- **YouTube:** YouTube Data API v3, com atenção à cota diária. Evitar search.list (custo alto). Usar o feed RSS do canal para pegar vídeos recentes e checar com videos.list (liveStreamingDetails) se estão ao vivo. Para achar canais, preferir o @handle (channels.list com forHandle). O idioma nem sempre vem preenchido. Importação de inscrições via login com Google.
- **Kick:** API pública oficial, mais nova e menos estável. Precisa registrar um app para ter credenciais.
- **Idioma:** quando a plataforma não informar o idioma da live, usar o idioma cadastrado para o streamer como fallback.

## Identidade visual

- **Nome:** Multistreams.
- **Logo** em criação no Canva: visual moderno e tech, remetendo a várias transmissões convergindo para um lugar, com indicador de "ao vivo".
- Precisa funcionar como ícone de app (iOS e Android), logo horizontal do site e ícone de notificação.

## Direção visual: Y2K cromado

O app segue a estética Y2K cromada das skins de Winamp, fugindo do padrão escuro e chapado dos apps de streaming.

- **Moldura cromada:** metal brilhante, reflexos e botões bulbosos formam a "carcaça" do player. As thumbnails das lives aparecem como a tela dentro dela.
- **Indicador de ao vivo:** barrinhas de equalizador pulsando ao lado de quem está no ar, no lugar da bolinha vermelha genérica.
- **Viewers em LCD:** números em fonte de segmentos, com brilho verde ou azul, como o contador do Winamp.
- **Skins:** o usuário escolhe a skin do app (ex.: cromado prata, azul metálico, preto fosco). Skins extras podem fazer parte do plano pago.
- **Equilíbrio:** cromado na moldura, nos botões e na navegação; a lista em si fica mais limpa, para manter a leitura fácil.
- **Viabilidade técnica:** efeitos e animações (reflexos, equalizador) com Reanimated e Skia no Expo.
