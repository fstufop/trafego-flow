import { AiReportPayload, InsightsSummary } from '../interfaces/ai-provider.interface.js';
import { ClientProfileType } from '../../clients/enums/client-profile-type.enum.js';

function fmtBRL(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtInt(value: number): string {
  return value.toLocaleString('pt-BR');
}

function fmtPct(numerator: number, denominator: number): string {
  if (denominator === 0) return 'N/D';
  return `${((numerator / denominator) * 100).toFixed(1).replace('.', ',')}%`;
}

const PROFILE_CONTEXT: Record<ClientProfileType, string> = {
  [ClientProfileType.SITE_SALES]:
    'O cliente tem e-commerce (Venda por Site). O relatório separa campanhas de captação (aquisição de público) das campanhas de funil de vendas com conversão no site.',
  [ClientProfileType.MESSAGE_SALES]:
    'O cliente trabalha com atendimento por mensagem (WhatsApp/Instagram Direct). O relatório destaca alcance, conversas iniciadas no direct e investimento.',
  [ClientProfileType.LIVE_SALES]:
    'O cliente trabalha com vendas por live. O relatório destaca alcance, visualizações da live e investimento.',
};

export function buildSystemPrompt(
  profile: ClientProfileType,
  clientContext: string | null,
): string {
  const lines = [
    'Você é um gestor de tráfego pago que envia relatórios semanais para seus clientes pelo WhatsApp.',
    '',
    'Regras obrigatórias — nunca quebre nenhuma delas:',
    '- Escreva na primeira pessoa do singular para os próximos passos: "vou realizar", "vou ajustar", "vou otimizar"',
    '- Tom: amigável, direto e profissional — sem exageros, sem palavras em maiúsculas por ênfase',
    '- Proibido: emojis de qualquer tipo',
    '- Proibido: markdown (não use #, *, _, -, listas com hífen ou asterisco)',
    '- Formato: texto puro compatível com WhatsApp (apenas quebras de linha)',
    '- Números: formato brasileiro — R$ 1.234,56 para valores monetários; 10.611 para inteiros',
    '- Foco em resultados positivos: quando métricas caem, enquadre como oportunidade ou ajuste de estratégia, nunca como fracasso. Se todos os indicadores caíram, comece com algo como "Essa semana ajustamos a estratégia para melhores resultados nas próximas semanas"',
    '- Próximos passos: sempre específicos com base nos dados do relatório — nunca genéricos',
    '',
    PROFILE_CONTEXT[profile],
  ];

  if (clientContext) {
    lines.push('', `Contexto estratégico do cliente: ${clientContext}`);
  }

  return lines.join('\n');
}

function header(weekNumber: number, since: string, until: string): string[] {
  return [
    'Preencha apenas os trechos marcados com [PREENCHER]. Não altere nada mais — o formato, os números e os rótulos estão corretos.',
    '',
    '---',
    'Olá!',
    '',
    `Feedback Semanal — Semana ${weekNumber}`,
    `${since} a ${until}`,
    '',
    '[PREENCHER: 1-2 frases avaliando o desempenho geral da semana de forma positiva. Se métricas caíram, enquadre como ajuste de estratégia.]',
    '',
  ];
}

function footer(deltas: Record<string, number | null>, clientContext: string | null, previous: InsightsSummary | null): string[] {
  const hasDeltas = Object.keys(deltas).length > 0;
  const lines: string[] = [];

  if (hasDeltas) {
    lines.push('[PREENCHER: 1 frase destacando o comparativo mais relevante com a semana anterior. Foque no positivo.]');
    lines.push('');
  }

  lines.push(
    'Próximos passos:',
    '[PREENCHER: 2-3 frases específicas sobre o que será feito na próxima semana, usando "vou". Baseie-se nos dados e no contexto do cliente.]',
    '',
    'Qualquer dúvida estou à disposição!',
    '---',
    '',
    'Dados de referência para os próximos passos:',
  );

  if (clientContext) lines.push(`Contexto do cliente: ${clientContext}`);
  if (hasDeltas) {
    lines.push(`Variações semana anterior: ${JSON.stringify(deltas)}`);
    if (previous) {
      lines.push(`Principais métricas semana anterior: alcance ${fmtInt(previous.reach)}, investimento R$ ${fmtBRL(previous.spend)}`);
    }
  }

  return lines;
}

function buildSiteSalesMessage(payload: AiReportPayload): string {
  const { period, acquisition, sales, deltas, clientContext, previous } = payload;
  const lines: string[] = header(period.weekNumber, period.since, period.until);

  if (acquisition) {
    lines.push('Campanha de Captação:');
    lines.push(`Investimento: R$ ${fmtBRL(acquisition.spend)}`);
    if (acquisition.clicks > 0) lines.push(`Cliques: ${fmtInt(acquisition.clicks)}`);
    lines.push('');
  }

  if (sales) {
    lines.push('Campanhas de Venda:');
    lines.push(`Investimento: R$ ${fmtBRL(sales.spend)}`);
    lines.push('');
    lines.push('Funil de Vendas:');
    lines.push(`Cliques no anúncio: ${fmtInt(sales.clicks)}`);
    if (sales.pageViews > 0) {
      lines.push(`↓ ${fmtPct(sales.pageViews, sales.clicks)}`);
      lines.push(`Visitas à página: ${fmtInt(sales.pageViews)}`);
    }
    if (sales.contentViews > 0) {
      lines.push(`↓ ${fmtPct(sales.contentViews, sales.pageViews)}`);
      lines.push(`Visualizações de conteúdo: ${fmtInt(sales.contentViews)}`);
    }
    if (sales.addToCart > 0) {
      lines.push(`↓ ${fmtPct(sales.addToCart, sales.contentViews)}`);
      lines.push(`Carrinho: ${fmtInt(sales.addToCart)}`);
    }
    if (sales.checkoutInitiated > 0) {
      lines.push(`↓ ${fmtPct(sales.checkoutInitiated, sales.addToCart)}`);
      lines.push(`Finalização de compra: ${fmtInt(sales.checkoutInitiated)}`);
    }
    if (sales.purchases > 0) {
      lines.push(`↓ ${fmtPct(sales.purchases, sales.checkoutInitiated)}`);
      lines.push(`Compras: ${fmtInt(sales.purchases)}`);
      lines.push('');
      lines.push(`Conversão geral (clique → compra): ${fmtPct(sales.purchases, sales.clicks)}`);
    }
    lines.push('');
  }

  lines.push(...footer(deltas, clientContext, previous));
  return lines.join('\n');
}

function buildMessageSalesMessage(payload: AiReportPayload): string {
  const { period, current, deltas, clientContext, previous } = payload;
  const lines: string[] = header(period.weekNumber, period.since, period.until);

  lines.push(`Investimento: R$ ${fmtBRL(current.spend)}`);
  if (current.reach > 0) lines.push(`Alcance: ${fmtInt(current.reach)} pessoas impactadas`);
  if (current.messagesStarted > 0) lines.push(`Conversas iniciadas: ${fmtInt(current.messagesStarted)} novos contatos no direct`);
  if (current.clicks > 0) lines.push(`Cliques nos anúncios: ${fmtInt(current.clicks)}`);
  lines.push('');

  lines.push(...footer(deltas, clientContext, previous));
  return lines.join('\n');
}

function buildLiveSalesMessage(payload: AiReportPayload): string {
  const { period, current, deltas, clientContext, previous } = payload;
  const lines: string[] = header(period.weekNumber, period.since, period.until);

  lines.push(`Investimento: R$ ${fmtBRL(current.spend)}`);
  if (current.reach > 0) lines.push(`Alcance: ${fmtInt(current.reach)} pessoas impactadas`);
  if (current.liveViews > 0) lines.push(`Visualizações da live: ${fmtInt(current.liveViews)}`);
  if (current.clicks > 0) lines.push(`Cliques nos anúncios: ${fmtInt(current.clicks)}`);
  if (current.purchases > 0) lines.push(`Compras: ${fmtInt(current.purchases)}`);
  lines.push('');

  lines.push(...footer(deltas, clientContext, previous));
  return lines.join('\n');
}

export function buildUserMessage(payload: AiReportPayload): string {
  switch (payload.clientProfile) {
    case ClientProfileType.MESSAGE_SALES:
      return buildMessageSalesMessage(payload);
    case ClientProfileType.LIVE_SALES:
      return buildLiveSalesMessage(payload);
    default:
      return buildSiteSalesMessage(payload);
  }
}
