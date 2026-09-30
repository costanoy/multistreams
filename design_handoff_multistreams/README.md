# Handoff: Multistreams — app (iOS, Android, Web)

## Overview
Multistreams junta Twitch, YouTube e Kick e mostra, numa lista única, quais streamers que o usuário acompanha estão ao vivo agora. Não é multi-view: tocar numa live abre a plataforma original. Este pacote cobre todas as telas do lançamento: onboarding/login opcional, Ao vivo (lista + offline), Adicionar (link/busca), Importar seguidos, Detalhe do streamer, Ajustes, Idiomas, Notificações, Skins, estados vazios/erro e o mock de push.

Contexto de produto, stack e notas de API estão em `Brief Multistreams.md` (incluso). Stack alvo: **Expo (React Native + TypeScript, expo-router)**, Supabase, worker em Railway/Fly, Expo Notifications, Reanimated + Skia para efeitos.

## About the Design Files
Os arquivos deste pacote são **referências de design feitas em HTML** — protótipos que mostram aparência e comportamento, **não código de produção para copiar**. A tarefa é **recriar essas telas no ambiente Expo/React Native** do projeto, usando seus padrões (expo-router, StyleSheet/NativeWind, Reanimated, Skia). Abra `Multistreams.dc.html` num navegador (servido por HTTP local, ex. `npx serve .`) para ver todas as telas lado a lado e clicáveis. `MultistreamsApp.dc.html` é o app em si; aceita props `platform` (ios|android|web), `layout`, `skin` e `start` (tela inicial).

## Fidelity
**High-fidelity.** Cores, tipografia, espaçamentos, raios, sombras, textos e interações são finais. Recriar fielmente. Dados (streamers, thumbnails, avatares) são fictícios/placeholder.

## ⚠ Mudanças em relação ao brief
1. **Ordenação:** NÃO é mais "línguas primeiro, depois viewers". Agora é **só por viewers (desc)**. As línguas viraram um **filtro** (checkboxes): só aparecem lives nas línguas marcadas.
2. **Padrão de línguas:** marcadas por padrão = língua do aparelho (`navigator.language` / `expo-localization`) + inglês. Ordem da lista de línguas: língua local, inglês, depois as demais.
3. **Mínimo 1 língua marcada:** desmarcar a última é bloqueado, com toast "Mantenha pelo menos uma língua marcada".
4. **Layout escolhido: "Destaque"** — a live com mais viewers aparece como card grande no topo; o resto em lista compacta. (Os layouts "Lista" e "Telas" continuam no protótipo só como referência — não implementar.)
5. Título da aba principal: **"Ao vivo"** (não "Radar").
6. Tocar num streamer **offline** abre o **perfil dele na plataforma** (deep link), não uma tela interna. O Detalhe do streamer é acessado pela tela de Notificações.

## Screens / Views

Estrutura mobile (iOS/Android): status bar → **header cromado** (título Michroma + contador LCD de lives) → conteúdo rolável (padding 16px 14px 24px, gap 16) → **tab bar cromada** (Ao vivo · Adicionar · Ajustes). Web: **sidebar cromada 256px** (logo, LCD "AO VIVO AGORA", nav, card de conta) + conteúdo max-width 1080px, padding 32px 36px 48px, título 24px Michroma + subtítulo 14px.

Telas com botão voltar (círculo cromado 36px, "‹"): Importar, Idiomas, Notificações, Skin, Detalhe.

### 1. Onboarding / Login
- Fundo: gradiente cromado da skin. Coluna centralizada, max 400px, gap 22.
- Logo redondo 128px (`assets/logo-round.png`) com drop-shadow 0 8 16 rgba(0,0,0,.3).
- "MULTISTREAMS" Michroma 22px, letter-spacing .08em. Abaixo, pastilha LCD "TWITCH YOUTUBE KICK" (DSEG14 11px).
- H1 28px/1.1 bold: "Quem está ao vivo agora, numa lista só." Sub 15px/1.4: "Seus streamers da Twitch, do YouTube e da Kick em uma lista, do mais assistido para o menos, nas línguas que você escolher."
- Botões pill 50px, gap 10: "Entrar com Twitch" (#7c3aed/branco), "Entrar com Google" (#fff/#1a1c21), "Continuar sem conta" (botão cromado).
- Nota 12.5px: "Sem conta, a lista fica salva neste aparelho. Com conta: sincronização, push e importação de quem você já segue."
- Após login → Ao vivo; ~2,2s depois dispara o push de exemplo (só no protótipo).

### 2. Ao vivo (tela principal)
- Linha de topo: "{N} CANAIS NO AR" (12px, 700, tracking .14em, muted) à esquerda; à direita pill "PT, EN ▾" (resumo das línguas marcadas: até 3 códigos; >3 → "PT, EN +2"; todas → "Todas").
- **Painel de línguas (dropdown inline)** ao tocar na pill: card 14px radius, padding 8, anima entrada (translateY 30→0, opacity, .2s). Título "MOSTRAR LIVES EM" (11px). Grid de checkboxes 2 col (mobile) / 4 col (web), linhas 32px, checkbox 16px radius 5, nome 12.5px 600, número de lives ao vivo à direita (10.5px). Filtra a lista instantaneamente.
- **Card destaque** (live #1): moldura cromada radius 22, padding 10/10/14; thumbnail 16:9 radius 14; badge "AO VIVO" com equalizador (canto sup. esq., fundo rgba(0,0,0,.72)); viewers em LCD (canto inf. dir., DSEG14 16px). Abaixo: nome 18px bold + chip da plataforma + código de língua; título 14px; categoria 12.5px muted.
- **Linhas** (lives #2+): card radius 14, padding 8/10/8/8, gap 12. Thumb 96px (148px web) 16:9 radius 8 com anel `bezelRing`. Coluna: equalizador (3 barras 3px) + nome 15px bold + chip plataforma 16px ("T"/"Y"/"K"); título 13px; "categoria · LÍNGUA" 11.5px. À direita LCD viewers (DSEG14 13px + "VIEWERS" 8px).
- **Offline:** botão cromado 44px "OFFLINE · N ▸", **recolhido por padrão**. Expandido: linhas com avatar 36px (grayscale .6), nome + chip, "ao vivo há X dias", botão pill "Aviso ligado"/"Avisar". Tocar na linha → abre perfil na plataforma. Tocar no botão → alterna aviso (não propaga).
- Tocar numa live → abre no app da plataforma. No protótipo: toast LCD "Abrindo {nome} no app da Twitch…".
- Estado vazio de filtro: "Ninguém ao vivo nas línguas marcadas. Marque mais línguas para ver outras lives."

### 3. Estados vazios / erro
- **Nenhum streamer** (lista vazia): LCD grande "00" com equalizador apagado dentro de moldura cromada; "Nenhum streamer ainda" 22px; "Adicione quem você acompanha e a gente avisa quem está no ar, em qualquer plataforma."; botões "Colar link de um canal" (accent) e "Importar da Twitch ou YouTube" (cromado).
- **Sem conexão:** faixa LCD no topo da lista: "SEM CONEXAO" (DSEG14 âmbar #ffb347, glow) + "Mostrando o status das {hora}. Pode ter mudado." + botão "Tentar agora". A lista continua visível com o último status em cache.
- **Link não reconhecido** (tela Adicionar, quando o texto parece URL mas não é Twitch/YouTube/Kick): card com pastilha LCD "ERRO" âmbar, "Link não reconhecido", explicação, 3 formatos aceitos em monospace (`twitch.tv/nome`, `youtube.com/@handle`, `kick.com/nome`) e botão "Buscar pelo nome" (limpa o campo).

### 4. Adicionar
- Campo 48px radius 14, placeholder "Cole o link ou busque pelo nome", botão limpar ×.
- Vazio: chips "EXPERIMENTE COLAR" com links de exemplo; 3 cards explicativos (Colar o link / Buscar pelo nome / **Importar seguidos ›** → tela Importar).
- **Detecção de link** (regex): `twitch.tv/{x}`, `youtube.com/@{x}` ou `youtu.be/{x}`, `kick.com/{x}`. Mostra "Link da Twitch detectado", card com avatar 48, nome, seguidores; seletor "Idioma do streamer" (chips das 4 primeiras línguas) e botão "Adicionar" (vira "Já está na lista" se duplicado).
- **Busca por nome:** segmented Twitch/YouTube/Kick; no YouTube, dica "busque pelo **@handle**…"; resultados com botão Adicionar.
- Após adicionar: toast "{nome} adicionado · {Plataforma}".

### 5. Importar seguidos
- Card Twitch e card YouTube: "Entrar com Twitch"/"Entrar com Google" → lista de canais com checkboxes (marcados por padrão; os já existentes aparecem "já na lista" desabilitados) → "Importar N canais" → estado "Importado" + botão "Rever". Toast "N canais importados da Twitch".
- Card Kick: "Sem importação. Adicione pelo link do canal." + botão "Colar link".

### 6. Detalhe do streamer (via Notificações)
- Cabeçalho cromado: avatar 92px em aro cromado (grayscale .5 se offline), nome 22px + chip da plataforma, handle/URL 13px, LCD "AO VIVO 12.4K" (verde + equalizador) ou "OFFLINE" (cinza #8a9199), linha "Última live: há X dias".
- Se ao vivo: card com thumb 120px + título + categoria.
- Botão principal na cor da plataforma: "Assistir no app da X" / "Abrir canal no app da X".
- Card de ajustes: switch "Avisar quando entrar ao vivo"; "Idioma do streamer" (chips de 6 línguas) — usado como fallback quando a API não informa idioma.
- "Remover da lista" (texto #d23b3b) → confirmação inline: "Remover {nome}? Você para de receber avisos deste canal." [Cancelar] [Remover]. Após remover volta à tela anterior + toast.

### 7. Ajustes
- Card de conta cromado (avatar 44, "Conectado com Twitch/Google" ou "Sem conta", sub, botão Entrar/Sair).
- Lista: Idiomas (resumo), Notificações ("X de Y"), Skin (nome), Importar seguidos.

### 8. Idiomas
- Texto: "A aba Ao vivo mostra só as lives nas línguas marcadas, sempre de quem tem mais viewers para quem tem menos."
- Botões "Só as minhas" (local + inglês) e "Marcar todas".
- Lista de checkboxes (mesma lógica do painel, linhas 50px, 1 col mobile / auto-fill 220px web). Línguas: pt, en, es, fr, de, it, ja, ko (ordem: local, en, demais).

### 9. Notificações
- Sem conta: banner "Push precisa de conta…" + "Entrar".
- Switch geral "Avisar quando entrarem ao vivo" + "X de Y streamers com aviso". Desligado → lista com opacity .45.
- Lista por streamer (**só das línguas marcadas**): avatar 32, nome, chip, switch 46×27. Tocar na linha → Detalhe.
- "Enviar notificação de teste" (só protótipo).

### 10. Skin
- Grid de 3 tiles (1 col mobile / 3 web): mini-preview (barra cromada com 2 botões + LCD "12.4K", painel com 2 barras). Selecionado: anel 3px accent + tag "EM USO". Troca aplica no app inteiro na hora. Nota: "Mais skins chegam com o plano pago."

### 11. Push (mock)
- iOS: banner topo, radius 22, fundo rgba(250,250,252,.86) + blur 16. Android: radius 18, #f4f5f8. Web: canto inf. dir., 360px, radius 14.
- Ícone do app 38px + cabeçalho (ícone monocromático 12px + "MULTISTREAMS" · "agora"), "{nome} está ao vivo", "{título} · {Plataforma}". Tocar → abre a live.
- Android: ícone monocromático 14px aparece na status bar ao lado do relógio.
- Real: Expo Notifications; Android small icon = `assets/icon-mono-white.png`.

## Interactions & Behavior
- Navegação: tabs (mobile) / sidebar (web). Aba ativa = botão cromado "pressionado" (btnOn + sombra inset). Android: pill ativa 64px de largura; iOS: 40px circular.
- Equalizador: barras com `scaleY` 0.2→1, origin bottom, `ease-in-out` alternate infinite, durações .6–.9s com delays negativos diferentes (−.15, −.3, −.4, −.5s). Reanimated no app.
- Entradas: push desce (translateY −120%→0, .4s cubic-bezier(.2,.9,.3,1.2)); toasts/cards sobem (30px→0, .25s ease-out).
- Switches: knob anima `left` .18s.
- Toasts: somem após 2,2s; "Abrindo…" após 1,9s; push após 5,2s.
- Hover (web): linhas/cards ganham sombra `0 0 0 1px rgba(0,0,0,.18), 0 4px 12px rgba(0,0,0,.1)`.

## State Management
- `streams[]`: { id, name, handle?, plat: twitch|youtube|kick, lang, live, viewers, title, cat, lastLiveAt, notify }.
- `langs: string[]` (filtro; mínimo 1) — persistir (local sem conta / Supabase com conta).
- `skin: prata|azul|preto` — persistir.
- `account: null|twitch|google`, `notifyAll: boolean`, `offlineOpen` (default false), `langPanelOpen`.
- Derivados: `live = streams.filter(live && langs.includes(lang)).sort(viewers desc)`; `offline = streams.filter(!live).sort(lastLiveAt desc)`.
- Status ao vivo vem do backend (worker faz polling por canal + EventSub). Em falha de rede, mostrar cache + banner "Sem conexão".

## Design Tokens

Fontes (Google Fonts / jsDelivr): **Chakra Petch** 400–700 (UI), **Michroma** (títulos/marca, caixa alta, tracking .04–.08em), **DSEG14 Classic Bold** (números LCD; fallback VT323).
Escala: 28 (H1 onboarding), 24 (título web), 22, 18, 17/16 (header mobile), 15 (corpo/nomes), 14, 13.5, 13, 12.5, 12, 11.5, 11, 10 (labels uppercase tracking .14em).

Raios: 999 (pills), 22 (cards cromados), 18, 16, 14 (cards/linhas), 12, 10, 8, 6, 5, 4. Aparelho iOS 50, Android 34.

Sombras-chave:
- Botão/moldura cromada: `inset 0 2px 1px rgba(255,255,255,.8), inset 0 -3px 5px rgba(0,0,0,.25), 0 2px 4px rgba(0,0,0,.2)`
- Pressionado: `inset 0 2px 5px rgba(0,0,0,.35), 0 1px 0 rgba(255,255,255,.6)`
- LCD: `inset 0 1px 4px rgba(0,0,0,.9), 0 1px 0 rgba(255,255,255,.55)`
- Card lista: `0 0 0 1px {line}, 0 1px 2px rgba(0,0,0,.06)`

Plataformas: Twitch #7c3aed / branco · YouTube #e11d2a / branco · Kick #53fc18 / #0b0b0b. Âmbar de erro #ffb347. Vermelho destrutivo #d23b3b.

### Skins
| token | Cromado prata | Azul metálico | Preto fosco |
|---|---|---|---|
| frame (gradiente 180°) | #f7f8f9 0, #d6d9de 24, #f0f1f3 48, #b3b8c0 74, #dcdfe3 90, #c4c8ce 100 | #e8f0ff 0, #a9c2ef 24, #dae6fc 48, #7394d4 74, #b5cbf2 90, #8eaae0 100 | #3a3c41 0, #242529 32, #2d2f33 60, #151618 100 |
| frameTop (status bar) | #f7f8f9 | #e8f0ff | #3a3c41 |
| frameInk / frameMuted | #16181d / #454a53 | #08142e / #1d3264 | #eceef2 / #a6aab3 |
| panel (fundo) | #eceef1 | #e3e9f4 | #131417 |
| card | #ffffff | #fbfcff | #1d1e22 |
| line | rgba(20,24,32,.10) | rgba(16,36,80,.12) | rgba(255,255,255,.09) |
| ink / muted | #15171c / #5a606b | #0d172e / #475775 | #eef0f3 / #9ba1ab |
| lcdBg (gradiente) | #08120d→#0e1d15 | #03101c→#08192b | #030603→#081008 |
| lcdFg / glow | #62ff9f / 0 0 6px rgba(98,255,159,.7) | #6fd6ff / 0 0 6px rgba(111,214,255,.8) | #8dff5c / 0 0 6px rgba(141,255,92,.65) |
| btn (radial 35% 28%) | #fff 0, #e4e6ea 40, #a4a9b1 100 | #fff 0, #c8d8f7 40, #6283c7 100 | #63666c 0, #34363a 45, #18191b 100 |
| btnOn (aba ativa) | #e3f6ff, #8ec5f0 45, #3a73b4 | #fff5dc, #ffc86e 45, #c27812 | #e4ffd6, #8dff5c 45, #2e8612 |
| btnInk / btnOnInk | #16181d / #06203d | #08142e / #3a2100 | #eceef2 / #0b2002 |
| accent / accentInk | #2f63d6 / #fff | #1f4bb0 / #fff | #8dff5c / #0b1a05 |
| field | #f7f8fa | #f4f7fd | #232428 |
| eq (equalizador lista) | #12a150 | #1476c8 | #8dff5c |
| swOn / swOff | #2f63d6 / #b9bdc4 | #1f4bb0 / #aab7cf | #6fd13f / #45474d |
| bezelRing | #c6c9cf | #9fb6e4 | #3a3c41 |

## Assets
- `assets/logo.png` — logo original do Canva (fundo branco).
- `assets/logo-round.png` — logo recortado em círculo, fundo transparente, 512px. Usar para ícone do app / onboarding / sidebar.
- `assets/icon-mono-white.png` / `icon-mono-black.png` — ícone monocromático 256px transparente. Branco = small icon de notificação Android (gerar 24/36/48/72/96px).
- Thumbnails e avatares: placeholders — no app vêm das APIs das plataformas.
- Ainda faltam: logo horizontal final (web) e SVGs vetoriais limpos.

## Files
- `Multistreams.dc.html` — canvas com todas as telas/plataformas/skins (1a–1i, 2a–2d).
- `MultistreamsApp.dc.html` — o app (template + lógica em classe JS no mesmo arquivo; ver `SKINS`, `PLAT`, `detect()`, `renderVals()`).
- `support.js` — runtime necessário para abrir os HTMLs.
- `Brief Multistreams.md` — brief de produto e técnico.
