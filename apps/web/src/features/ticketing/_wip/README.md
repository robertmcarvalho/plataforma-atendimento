# Ticketing (WIP — pausado)

Feature **intencionalmente pausada**. O código em `_wip/` permanece no repositório para retomada futura; não é dead code a remover.

## Estado

- UI e painéis laterais do inbox (sidecar, acordeões de contexto operacional/financeiro) estão em desenvolvimento.
- Ativação controlada pela flag `ticketingPanel` em `apps/web/src/lib/features.ts` (local: `false`, produção: conforme deploy).

## Retomada

1. Revisar integração com `opsAnalyticsApi` e rotas de tickets na API.
2. Mover componentes de `_wip/` para `features/ticketing/` quando estáveis.
3. Habilitar `ticketingPanel` nos ambientes desejados.
