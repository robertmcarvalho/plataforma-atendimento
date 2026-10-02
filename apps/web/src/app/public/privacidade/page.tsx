import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Política de Privacidade',
  description: 'Política de Privacidade — Flux Farma / Aethera',
};

export default function PrivacidadePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-sm leading-relaxed text-slate-800">
      <h1 className="mb-2 text-2xl font-semibold text-slate-900">Política de Privacidade</h1>
      <p className="mb-8 text-slate-600">Última atualização: 9 de junho de 2026</p>

      <section className="mb-8 space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">1. Quem somos</h2>
        <p>
          Esta política descreve o tratamento de dados pessoais pela <strong>Flux Farma</strong> (operadora de
          logística para farmácias), por meio da plataforma <strong>Aethera</strong>, incluindo atendimento via
          WhatsApp Business API.
        </p>
        <p>
          Controlador: Flux Farma — contato para privacidade:{' '}
          <a className="text-blue-700 underline" href="mailto:atendimento@fluxfarma.com.br">
            atendimento@fluxfarma.com.br
          </a>
        </p>
      </section>

      <section className="mb-8 space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">2. Dados que coletamos</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>Número de telefone WhatsApp e identificadores de mensagem (Meta).</li>
          <li>Nome de exibição fornecido pelo WhatsApp, quando disponível.</li>
          <li>Conteúdo das mensagens trocadas no canal de atendimento (texto, mídia, respostas a menus).</li>
          <li>Dados cadastrais informados voluntariamente (nome, CPF/CNPJ, e-mail, farmácia, cidade etc.).</li>
          <li>Metadados operacionais (data/hora, status de entrega/leitura, canal utilizado).</li>
        </ul>
      </section>

      <section className="mb-8 space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">3. Finalidades</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>Prestar atendimento, suporte e comunicações relacionadas aos serviços da Flux Farma.</li>
          <li>Identificar contatos, histórico de conversas e demandas operacionais/comerciais.</li>
          <li>Cumprir obrigações legais e exercer direitos em processos administrativos ou judiciais.</li>
          <li>Melhorar qualidade do atendimento (incluindo recursos opcionais de IA, quando habilitados).</li>
        </ul>
      </section>

      <section className="mb-8 space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">4. Compartilhamento</h2>
        <p>Podemos compartilhar dados com:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Meta / WhatsApp</strong> — infraestrutura de mensagens (conforme termos da Meta).
          </li>
          <li>
            <strong>Provedores de nuvem</strong> (ex.: Google Cloud, Supabase) — hospedagem e banco de dados.
          </li>
          <li>
            <strong>Prestadores de IA</strong> — apenas trechos necessários, quando funcionalidades de IA estiverem
            ativas.
          </li>
        </ul>
        <p>Não vendemos dados pessoais.</p>
      </section>

      <section className="mb-8 space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">5. Retenção e segurança</h2>
        <p>
          Os dados são mantidos pelo tempo necessário à prestação do serviço, obrigações legais e resolução de
          disputas. Aplicamos controles técnicos e organizacionais razoáveis (acesso restrito, criptografia em
          trânsito, segregação por workspace).
        </p>
      </section>

      <section className="mb-8 space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">6. Seus direitos (LGPD)</h2>
        <p>Você pode solicitar:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>confirmação de tratamento e acesso aos dados;</li>
          <li>correção de dados incompletos ou desatualizados;</li>
          <li>anonimização, bloqueio ou eliminação de dados desnecessários;</li>
          <li>informações sobre compartilhamentos e revogação de consentimento, quando aplicável.</li>
        </ul>
        <p>
          Envie pedidos para{' '}
          <a className="text-blue-700 underline" href="mailto:atendimento@fluxfarma.com.br">
            atendimento@fluxfarma.com.br
          </a>
          . Responderemos em prazo razoável conforme a LGPD.
        </p>
      </section>

      <section className="mb-8 space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">7. Exclusão de dados</h2>
        <p>
          Para solicitar exclusão de dados vinculados ao seu número WhatsApp, envie e-mail para{' '}
          <a className="text-blue-700 underline" href="mailto:atendimento@fluxfarma.com.br">
            atendimento@fluxfarma.com.br
          </a>{' '}
          com o número utilizado no atendimento. Avaliaremos pedidos observando obrigações legais e registros
          mínimos necessários.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">8. Alterações</h2>
        <p>
          Esta política pode ser atualizada. A data da última revisão será indicada no topo desta página.
        </p>
      </section>
    </main>
  );
}
