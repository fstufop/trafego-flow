import { AiReportPayload } from '../interfaces/ai-provider.interface.js';

export function buildSystemPrompt(clientContext: string | null): string {
  const base =
    'Você é um assistente de marketing digital que escreve relatórios semanais para clientes de tráfego pago. ' +
    'Escreva na primeira pessoa do plural (nós, nossa equipe), com tom amigável e profissional. ' +
    'Use emojis moderadamente.';
  if (clientContext) {
    return `${base}\n\nContexto da estratégia do cliente: ${clientContext}`;
  }
  return base;
}

export function buildUserMessage(payload: AiReportPayload): string {
  return (
    `Gere o relatório semanal com base nos dados abaixo.\n` +
    `Inclua: saudação, identificação do período (semana ${payload.period.weekNumber}), avaliação geral, ` +
    `métricas principais, comparativo com semana anterior (se disponível), próximos passos e fechamento.\n\n` +
    `Dados: ${JSON.stringify(payload)}`
  );
}
