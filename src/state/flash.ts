// Mensagem de uma só leitura entre telas (ex.: "Sua conta e seus dados foram excluídos." em T-01).
let pending: Record<string, string | undefined> = {};

export function setFlash(key: string, message: string) {
  pending[key] = message;
}

export function takeFlash(key: string): string | undefined {
  const m = pending[key];
  delete pending[key];
  return m;
}

export function clearFlashes() {
  pending = {};
}
