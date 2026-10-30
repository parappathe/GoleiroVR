// Os 5 adversários da Copa Noturna (times inventados). Sem navegador.
// style: jeito de bater (ver planShot em game.js). tell: o quanto o corpo do batedor entrega o
// lado antes do chute (0 = nada, 1 = bem visível; sempre sutil). fake: chance de o corpo mentir.
export const TEAMS = [
  {
    name: 'Trovão do Cerrado', short: 'TRO', batedor: 'Tonhão', style: 'forte', rodada: 'Primeira fase',
    kit: { shirt: '#f2c21b', trim: '#1d3f8f', shorts: '#1d3f8f', socks: '#f2c21b', skin: '#b97a4e', hair: '#1a120c' },
    desc: ['Chute forte e reto, de fora da área.', 'A bola chega rápido: clique cedo para mergulhar.'],
    shots: 6, maxGoals: 2, tell: 1.0, fake: 0,
  },
  {
    name: 'Unidos da Ventania', short: 'VEN', batedor: 'Zé Curvinha', style: 'curva', rodada: 'Oitavas de final',
    kit: { shirt: '#22a58f', trim: '#ffffff', shorts: '#ffffff', socks: '#22a58f', skin: '#e0b088', hair: '#5a3a1a' },
    desc: ['Bate com efeito: a bola sai para fora', 'e volta fechando no canto. Siga a curva.'],
    shots: 6, maxGoals: 2, tell: 0.8, fake: 0,
  },
  {
    name: 'Malandragem FC', short: 'MAL', batedor: 'Malandrinho', style: 'malandro', rodada: 'Quartas de final',
    kit: { shirt: '#7b2fb8', trim: '#ffd23a', shorts: '#2b1240', socks: '#7b2fb8', skin: '#8a5a3a', hair: '#0e0a08' },
    desc: ['Pênalti com paradinha: ele espera você se mexer', 'e bate no outro canto. Às vezes, cavadinha.'],
    shots: 6, maxGoals: 2, tell: 0.6, fake: 0.3,
  },
  {
    name: 'Tubarões do Mangue', short: 'TUB', batedor: 'Siri e Caranguejo', style: 'rebote', rodada: 'Semifinal',
    kit: { shirt: '#d9482b', trim: '#1b1b1b', shorts: '#1b1b1b', socks: '#d9482b', skin: '#d6a27a', hair: '#2a1a0a' },
    desc: ['Chute venenoso que espirra na luva.', 'O segundo atacante vem no rebote: volte rápido!'],
    shots: 6, maxGoals: 2, tell: 0.8, fake: 0,
  },
  {
    name: 'Imperial da Serra', short: 'IMP', batedor: 'Maestro Valdemar', style: 'falta', rodada: 'Final', final: true,
    kit: { shirt: '#f4f4f4', trim: '#c9a227', shorts: '#151515', socks: '#f4f4f4', skin: '#c08a60', hair: '#3a2614' },
    desc: ['4 faltas com barreira: a bola passa por cima e cai.', 'Depois, decisão por pênaltis: você também bate.'],
    shots: 4, maxGoals: 2, tell: 0.7, fake: 0.15,
  },
];

export const HOME = {
  name: 'Esperança FC', short: 'ESP',
  kit: { shirt: '#ff7a1a', trim: '#111111', shorts: '#111111', socks: '#ff7a1a', skin: '#c99068', hair: '#20140c' },
};
