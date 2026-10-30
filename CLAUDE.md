# GoleiroVR

Muralha: jogo de goleiro em VR para o Meta Quest 3 no navegador (WebXR), sem instalar nada. Você
fica no gol (7,32 m x 2,44 m) de um estádio à noite com refletores e defende com as duas mãos: as
luvas seguem os controles, o corpo real se estica e abaixa, e a velocidade da mão conta na
espalmada. Copa Noturna de 5 adversários (times inventados), cada um com um batedor de estilo
próprio; a final termina em pênaltis alternados, e aí você também bate. O corpo do batedor
entrega o lado antes do chute (de leve). Também joga no PC com mouse e teclado. Tudo em português.

## Como rodar / jogar

**No Quest:** abrir no navegador do óculos **https://parappathe.github.io/GoleiroVR/** (ou a
página inicial https://parappathe.github.io/) e apertar "Entrar em VR". Para atualizar o site:
commitar e rodar `python publicar.py GoleiroVR` na pasta `C:\claude code`. (Ainda não publicado.)

**No PC:** `python serve.py` nesta pasta e abrir `http://localhost:8811` (o painel de
visualização usa `.claude/launch.json`). O `serve.py` manda o navegador não guardar cache;
`python serve.py --https` serve para abrir no Quest pela rede de casa (porta 8443).

### Controles

| | VR (Quest) | PC |
|---|---|---|
| Defender | As luvas seguem as mãos. O braço é "esticado": a luva vai mais longe que a mão real (para cobrir o gol numa sala) | O mouse move as luvas num plano em frente ao gol; os pés andam pela linha e o braço tem alcance limitado |
| Mergulho | Tranco rápido da mão para o lado (mão já afastada do corpo): as luvas deslizam ~1,3 m para aquele lado por meio segundo | Clique ou Espaço: as luvas andam bem mais rápido e alcançam mais longe por 0,42 s; depois 0,45 s para levantar |
| Espalmar | Bater com a mão indo contra a bola devolve mais forte | (automático pela velocidade das luvas) |
| Bater o pênalti (final) | Segurar o gatilho (ou o aperto), fazer o gesto de arremesso/chute na direção do gol e soltar: direção e força vêm da mão | Mirar com o mouse, segurar o botão para dar força (barra embaixo) e soltar. Força demais isola; a mira treme mais com mais força. Q/E: efeito |
| Recentralizar | A ou X | |
| Pausa | B ou Y | Esc ou P |
| Menu | Apontar com o controle e gatilho (pinça no rastreamento de mãos) | Clique |
| FPS | Menu → FPS | Tecla F |

O controle vibra quando a bola bate na luva (mais forte quanto mais forte a bola), no corpo, na
trave, no mergulho e no chute. A torcida é sintetizada: batucada de fundo, "uuuh" na trave,
comemoração nas defesas e nos seus gols, lamento nos gols sofridos. Apito antes de cada chute.

### Regras e adversários

Cada partida é uma série de chutes do adversário; passa de fase quem sofrer no máximo 2 gols
(perdeu o terceiro, eliminado na hora). Bola na trave ou para fora conta como "pra fora". A copa
(em `js/teams.js`):

1. Primeira fase, **Trovão do Cerrado** (Tonhão): chute forte e reto de fora da área, 26-30 m/s.
2. Oitavas, **Unidos da Ventania** (Zé Curvinha): curva com efeito Magnus, sai para fora e fecha.
3. Quartas, **Malandragem FC** (Malandrinho): pênalti com paradinha. Se você se mexer mais de
   45 cm antes do chute, ele bate no outro canto; às vezes faz cavadinha. O corpo dele às vezes mente.
4. Semifinal, **Tubarões do Mangue** (Siri e Caranguejo): chute venenoso que espirra na luva; se
   a bola voltar para o campo (entre 5 e 17 m), o segundo atacante corre e chuta de primeira no
   canto longe de você. Bola que para perto do gol é sua.
5. Final, **Imperial da Serra** (Maestro Valdemar): 4 faltas de 19-23 m com barreira de 4 a
   9,15 m (que pula no chute) e a bola por cima, caindo no canto; passando delas, pênaltis
   alternados (eles começam): 5 para cada, acaba antes se um lado não alcança mais o outro, e
   morte súbita se empatar. O goleiro deles escolhe um canto antes do chute e não alcança o
   ângulo de cima.

Progresso salvo no navegador (localStorage, chave `goleirovr.v1`): até que partida liberou,
melhor resultado de cada partida e quantas copas ganhou.

## Como testar

- `node tests/run.js` (ou `npm test`): física (queda, arrasto, curva do efeito, topspin, quique,
  rolar), traves e rede (por dentro e por fora), luvas (rebote, espalmada com a velocidade da mão,
  bola rápida não atravessa), mira calculada, corpo do goleiro (mergulho, alcance), goleiro do
  computador (canto errado = gol, canto certo = defesa, ângulo de cima = gol), regras dos
  pênaltis, gesto de chute do VR, força demais isola, estilos (curva desvia, cavadinha aparece,
  barreira a 9,15 m que pula e é vencida por cima), paradinha (quem sai antes leva no outro
  canto) e as 5 partidas: robô goleiro vence todas em 6 sementes (inclusive os pênaltis da final,
  com o robô batedor), goleiro parado perde, gol vazio perde no terceiro gol. Tem que terminar com
  "Tudo certo". Não toca som.
- No navegador (console): `dev.loadLevel(3)` abre a partida 3 (1 a 5), `dev.autoplay = true` faz
  o robô defender e bater (e seguir para a próxima partida), `dev.advance(20)` avança 20 s na
  hora, `dev.state()` mostra tela, fase, etapa, lance, placar e pênaltis, `dev.shootout()` pula
  para os pênaltis da final, `dev.resetSave()` apaga o progresso. `window.muralha` tem `game`,
  `kb`, `save`, `startMatch`, `goMenu`.
- **Só dá para testar no óculos:** alcance e conforto das luvas "esticadas", o mergulho por
  tranco, gesto de pênalti, vibração, altura e posição do jogador no gol, leitura do telão e das
  placas, rastreamento de mãos, FPS.

## Estrutura

| Arquivo | O que tem |
|---|---|
| `index.html`, `css/style.css` | Página, botão "Entrar em VR", placar, texto grande, barra de força do PC |
| `js/math.js` | Vetores em arrays e sorteio com semente. Sem navegador |
| `js/physics.js` | Bola: gravidade, arrasto, Magnus, gramado, traves, rede, luvas e corpos (esferas/cápsulas com velocidade); previsão de onde a bola cruza um plano; mira (acha a direção para chegar num ponto com dada força e efeito). Sem navegador |
| `js/keeper.js` | `KeeperBody` (seu goleiro do PC e do robô: alvo, mergulho, alcance, colisores) e `CpuKeeper` (goleiro deles nos pênaltis). Sem navegador |
| `js/teams.js` | Os 5 adversários e o time da casa |
| `js/game.js` | `Game` (uma partida em passos de 1/240 s: preparo, apito, corrida, paradinha, voo, rebote, resultado; placar, eliminação, faltas, pênaltis), `Shootout`, planos de chute de cada estilo, barreira, gesto do VR. Sem navegador |
| `js/robot.js` | Robô goleiro (prevê e defende todo chute alcançável) e robô batedor. Usados pelos testes e pelo `dev.autoplay`. Sem navegador |
| `js/main.js` | Liga tudo: render, VR (luvas esticadas, mergulho, gesto de chute, vibração), mouse/teclado, menus, HUD, sons, `dev` |
| `js/scene.js` | Estádio (céu, gramado listrado, linhas, arquibancadas com torcida em shader, refletores, placas de LED, telão), gol e rede deformável, bola com rastro e sombras, jogadores montados por peças e animados, luvas |
| `js/ui.js` | Painel de menu 3D em canvas, placas de texto e o telão |
| `js/audio.js` | Sons sintetizados (torcida, batucada, apito, chute, luva, trave, rede, quique) |
| `js/save.js` | Progresso e opções salvos |
| `tests/run.js` | Testes |
| `serve.py` | Servidor local sem cache (porta 8811, `--https` para o Quest) |
| `vendor/three/three.module.js` | Three.js r170 (cópia local) |

Coordenadas (metros): linha do gol em z = 0, gol de x = -3,66 a 3,66 e até 2,44 de altura, rede
até z = 1,9; o campo fica em z < 0 (marca do pênalti em z = -11). As luvas do seu goleiro (PC)
ficam no plano z = -0,4; no VR a sua cabeça é posta em (0; z = -0,12) olhando para -z. Nos seus
pênaltis você fica em z = -12,4 olhando para +z e o goleiro deles fica em z = -0,3.

## Regras e convenções do projeto

- `math.js`, `physics.js`, `keeper.js`, `teams.js`, `game.js` e `robot.js` não podem usar
  navegador nem Three.js: os testes rodam no Node.
- `scene.js` desenha com as medidas de `physics.js` (gol, rede, bola), então o que se vê é o que colide.
- Adversário novo ou estilo mudado: mexer em `teams.js`/`planShot` e rodar `node tests/run.js`
  (o robô tem que vencer, o goleiro parado tem que perder).
- O jogo usa sorteio com semente: mesma semente, mesmos chutes (os testes dependem disso).

## Decisões

- Física própria (sem biblioteca): passo fixo de 1/240 s; bola a 34 m/s anda 14 cm por passo,
  menos que o raio da luva + bola (24 cm), então não atravessa.
- Arrasto 0,013 e Magnus 0,0042 (efeito de 60 rad/s a 25 m/s curva ~2 m numa falta).
- Luva devolve 45% (macia); a do chute venenoso da semifinal, 62% (espirra para o rebote).
- VR: braço "esticado" (até 30 cm igual, depois 2,6x) e altura ampliada acima de 1,45 m, porque
  numa sala ninguém mergulha 3 m. O mergulho é um tranco da mão para o lado. Só as luvas se
  esticam, a câmera nunca (para não enjoar).
- PC: câmera atrás do gol, olhando pela rede (rede mais transparente nessa vista); seu goleiro
  aparece meio transparente e as luvas por cima de tudo, para ver a bola.
- Os chutes adversários são sempre alcançáveis por um goleiro perfeito (o teste do robô garante);
  o difícil é reagir a tempo e não cair na paradinha.
- O goleiro do computador lê a bola "sem efeito" e escolhe um canto antes; o ângulo de cima fica
  fora do alcance dele, então o risco do seu pênalti é isolar ou tremer a mira.
- Desempenho de Quest: 3 luzes sem sombra (sombras são manchas no chão, uma por refletor para a
  bola), arquibancadas, linhas e torcida mescladas (a torcida é um shader só), jogadores com
  cor por vértice e um material, pixelRatio 1 no Quest, foveação ligada, sem pós-processamento.
- Porta do servidor local 8811.

## Pendências / problemas conhecidos

- Nada testado no Quest ainda: alcance das luvas esticadas, mergulho por tranco, gesto do
  pênalti (força e direção podem precisar de ajuste), vibração, altura do jogador no gol,
  leitura do telão e das placas no óculos, rastreamento de mãos (pinça) e FPS.
- A dificuldade foi calibrada pelo robô (que reage na hora); pode precisar de ajuste depois de
  jogar de verdade (velocidade dos chutes, tempo da paradinha, força do rebote).
- Na falta, o batedor às vezes fica escondido atrás da barreira na vista do gol (é o que
  acontece num jogo real, mas esconde a dica do corpo).
- Sem modelo dos controles: só as luvas aparecem nas mãos.
