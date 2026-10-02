# Web app architecture

Padrão adotado após refatoração da Fase C (cleanup).

## Data fetching

- Chamadas HTTP passam por módulos em `src/lib/**` (ex.: `commercialApi.ts`, `opsAnalyticsApi.ts`, `api.ts`).
- Páginas e componentes de rota **não** importam `api.get` / `api.post` diretamente — usam hooks ou funções de `lib/`.
- Estado de servidor: **React Query** (`useQuery`, `useMutation`, `useQueryClient`).
- Erros de API: `apiErrorMessage` / `onApiError` em `@/lib/apiErrorMessage`.

## Páginas (`app/`)

- Arquivo `page.tsx` é **composição** (~7–50 LOC): chama um controller/hook e renderiza um `*PageContent`.
- Lógica de estado, efeitos e mutations ficam em `lib/<domínio>/use*PageController.ts` ou hooks dedicados.
- Sem regra de negócio pesada dentro do JSX.

## Componentes

- UI compartilhada: `components/ui/`, `components/form/`.
- Domínio: `components/<domínio>/` (inbox, commercial, operacao, settings, …).
- Componentes recebem dados prontos via props; fetching fica nos hooks.

## Feature flags (`lib/features.ts`)

- Flags `NEXT_PUBLIC_*`: default **false** em `features.ts` (dev local sem `.env`).
- Produção/staging: `true` explícito nos build-args (`Dockerfile`, `deploy/cloudbuild-flux-farma-web.yaml`).

## O que evitar

- God files em `page.tsx` (>200 LOC).
- Duplicar parsing de erro Axios (`response?.data?.error`) — usar `apiErrorMessage`.
- Novos mocks em `lib/` — CRM e operação usam API real.

## Cleanup (estado 2026-06)

- Inbox: `page.tsx` + `InboxPageContent` finos; colunas em `InboxPageColumns.tsx`.
- Constantes financeiras/ocorrência: `@plataforma/operational-notes` (`FinancialEntryStatus`, `OccurrenceKind`).
- Assinatura Autentique: core em `operational-notes/signatureSyncCore.ts`; API vs scheduler só no callback pós-update.
- Ticketing WIP: `features/ticketing/_wip/` (feature pausada, flag `ticketingPanel`).
- Verificação: `npm run cleanup:verify`.
