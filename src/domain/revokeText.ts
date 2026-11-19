// Aviso de sucesso ao revogar (T-12 → T-11): RF-009.1, RF-009.1.2 (contas compartilhadas, com a contagem).
export function revokedMessage(label: string, kept: number, keptWith: string | null): string {
  return kept > 0
    ? `${label} revogada. ${kept} ${kept === 1 ? 'conta continua' : 'contas continuam'} no app, ligadas a ${keptWith}. O consentimento no Meu Pluggy continua ativo até você encerrar lá.`
    : `${label} revogada. Os dados dela foram apagados deste aparelho. O consentimento no Meu Pluggy continua ativo até você encerrar lá.`;
}
