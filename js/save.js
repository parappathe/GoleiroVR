// Progresso e opções, salvos no navegador.
const KEY = 'goleirovr.v1';
const DEFAULTS = {
  unlocked: 0,      // até que partida da copa já chegou (0 a 4)
  results: {},      // por partida: { won: true, saves: 5, goals: 1 } (melhor resultado)
  titles: 0,        // copas ganhas
  sound: true,
  fps: false,
};

export function loadSave() {
  try {
    const s = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
    if (typeof s.results !== 'object' || !s.results) s.results = {};
    s.unlocked = Math.max(0, Math.min(4, s.unlocked | 0));
    return s;
  } catch { return { ...DEFAULTS, results: {} }; }
}

export function storeSave(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* sem armazenamento: segue sem salvar */ }
}
