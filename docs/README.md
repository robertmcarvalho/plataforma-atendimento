# Documentação — Plataforma Atendimento (Aethera)

Índice por persona. Produção atual: Supabase **plataforma_atendimento** (`omhlbavfsttwcnybzvcd`), site [aetheraai.online](https://www.aetheraai.online), GCP `rh-coopmob-bot`.

## Operações e produção

| Documento | Público |
|-----------|---------|
| [OPERATIONS_RUNBOOK.md](./OPERATIONS_RUNBOOK.md) | cutover, migração, sanitize, senhas |
| [STAGING_PROD_DATABASE_MAP.md](./STAGING_PROD_DATABASE_MAP.md) | mapa `omhlb` prod vs `ojzzx` legado |
| [PRODUCTION_BOOTSTRAP.md](./PRODUCTION_BOOTSTRAP.md) | bootstrap, flip, migração inicial |
| [DEPLOY_CLOUD_RUN.md](./DEPLOY_CLOUD_RUN.md) | deploy GCP / Cloud Run |
| [GO_LIVE_CHECKLIST.md](./GO_LIVE_CHECKLIST.md) | checklist release |
| [scripts/README.md](../scripts/README.md) | scripts por categoria (`npm run …`) |

## Domínio e governança

| Documento | Público |
|-----------|---------|
| [GOVERNANCE_ENTERPRISE.md](./GOVERNANCE_ENTERPRISE.md) | governança de automações |
| [PHARMACY_DELIVERY_SCHEDULE.md](./PHARMACY_DELIVERY_SCHEDULE.md) | farmácias, horários, delivery |
| [access-matrix-by-role.md](./access-matrix-by-role.md) | permissões por perfil |
| [LEADER_PORTAL_SECURITY_AUDIT.md](./LEADER_PORTAL_SECURITY_AUDIT.md) | portal do líder |

## Staging / QA

| Documento | Público |
|-----------|---------|
| [STAGING_QA_RUNBOOK.md](./STAGING_QA_RUNBOOK.md) | QA em ambiente isolado |
| [CHAOS_STAGING_RUNBOOK.md](./CHAOS_STAGING_RUNBOOK.md) | testes de carga/chaos |

## Arquivo / histórico (não é runbook primário)

| Documento | Nota |
|-----------|------|
| [archive/IMPLEMENTATION_REDESIGN_PLAN.md](./archive/IMPLEMENTATION_REDESIGN_PLAN.md) | plano de redesign (histórico) |
| [ENTERPRISE_STABILIZATION_EXECUTION.md](./ENTERPRISE_STABILIZATION_EXECUTION.md) | execução estabilização |
| [FINAL_DEBUG_OPERATIONAL_REPORT.md](./FINAL_DEBUG_OPERATIONAL_REPORT.md) | relatório debug |
| [FLOW_EDITOR_AND_POLICIES_PLAN.md](./FLOW_EDITOR_AND_POLICIES_PLAN.md) | editor de fluxos (planejamento) |

## Outros

- [OBSERVABILITY_AND_LOGGING.md](./OBSERVABILITY_AND_LOGGING.md)
- [AI_USAGE_PRIVACY.md](./AI_USAGE_PRIVACY.md)
- [INTERSERVICE_CONTRACTS.md](./INTERSERVICE_CONTRACTS.md)
