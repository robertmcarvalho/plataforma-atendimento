# Documentação — Plataforma Atendimento (Aethera)

Índice por persona. Produção: Supabase **plataforma_atendimento** (`omhlbavfsttwcnybzvcd`), [aetheraai.com.br](https://www.aetheraai.com.br), GCP `rh-coopmob-bot`.

## Operações e produção

| Documento | Público |
|-----------|---------|
| [OPERATIONS_RUNBOOK.md](./OPERATIONS_RUNBOOK.md) | cutover, migração, sanitize, senhas |
| [STAGING_PROD_DATABASE_MAP.md](./STAGING_PROD_DATABASE_MAP.md) | mapa `omhlb` prod vs `ojzzx` legado |
| [PRODUCTION_BOOTSTRAP.md](./PRODUCTION_BOOTSTRAP.md) | bootstrap, flip, migração inicial |
| [DEPLOY_CLOUD_RUN.md](./DEPLOY_CLOUD_RUN.md) | deploy GCP / Cloud Run |
| [CLOUD_RUN_SCALING.md](./CLOUD_RUN_SCALING.md) | scaling piloto, pós-deploy, rollback |
| [GCP_SERVICES_DECOMMISSION_PLAN.md](./GCP_SERVICES_DECOMMISSION_PLAN.md) | inativação serviços legados GCP |
| [GO_LIVE_CHECKLIST.md](./GO_LIVE_CHECKLIST.md) | checklist release |
| [scripts/README.md](../scripts/README.md) | scripts por categoria (`npm run …`) |
| [scripts/gcp/README.md](../scripts/gcp/README.md) | scripts GCP |

## Domínio e governança

| Documento | Público |
|-----------|---------|
| [GOVERNANCE_ENTERPRISE.md](./GOVERNANCE_ENTERPRISE.md) | governança de automações |
| [AUTOMATION_GOVERNANCE.md](./AUTOMATION_GOVERNANCE.md) | classificação de automações |
| [GOVERNANCE_EXTERNAL_INVENTORY.md](./GOVERNANCE_EXTERNAL_INVENTORY.md) | inventário GCP externo |
| [MULTITENANT_ISOLATION_RLS_PLAN.md](./MULTITENANT_ISOLATION_RLS_PLAN.md) | RLS e isolamento tenant |
| [PHARMACY_DELIVERY_SCHEDULE.md](./PHARMACY_DELIVERY_SCHEDULE.md) | farmácias, horários, delivery |
| [access-matrix-by-role.md](./access-matrix-by-role.md) | permissões por perfil |
| [LEADER_PORTAL_SECURITY_AUDIT.md](./LEADER_PORTAL_SECURITY_AUDIT.md) | portal do líder |
| [LEADER_WHATSAPP_INTAKE.md](./LEADER_WHATSAPP_INTAKE.md) | triagem WhatsApp líder |
| [META_LEADER_OTP_TEMPLATE.md](./META_LEADER_OTP_TEMPLATE.md) | template OTP Meta |
| [AUTENTIQUE_SIGNATURE_SYNC.md](./AUTENTIQUE_SIGNATURE_SYNC.md) | assinaturas Autentique |
| [FLUX_DELIVERY_INTEGRATION.md](./FLUX_DELIVERY_INTEGRATION.md) | integração Flux Delivery |
| [DRIVER_DOCUMENT_ALERTS.md](./DRIVER_DOCUMENT_ALERTS.md) | alertas documentos entregador |
| [FINANCIAL_CYCLES.md](./FINANCIAL_CYCLES.md) | ciclos financeiros |
| [BILLING_MODULE_ROADMAP.md](./BILLING_MODULE_ROADMAP.md) | roadmap módulo faturamento (`/billing`) |
| [SETORES_FILAS_PRESET.md](./SETORES_FILAS_PRESET.md) | preset setores/filas |

## Comercial

| Documento | Público |
|-----------|---------|
| [COMMERCIAL_PROPOSAL_DOCX_PDF_PLAN.md](./COMMERCIAL_PROPOSAL_DOCX_PDF_PLAN.md) | proposta DOCX/PDF (fonte atual) |

Planos anteriores (handoff, viabilidade, ops): [archive/plans/](./archive/plans/).

## UI / produto

| Documento | Público |
|-----------|---------|
| [REVIVE_DESIGN_SYSTEM.md](./REVIVE_DESIGN_SYSTEM.md) | design system Aethera |
| [VISUAL_STANDARDIZATION_CHECKLIST.md](./VISUAL_STANDARDIZATION_CHECKLIST.md) | checklist padronização UI |
| [FLOW_EDITOR_AND_POLICIES_PLAN.md](./FLOW_EDITOR_AND_POLICIES_PLAN.md) | editor de fluxos conversacionais |

## Staging / QA

| Documento | Público |
|-----------|---------|
| [STAGING_QA_RUNBOOK.md](./STAGING_QA_RUNBOOK.md) | QA em ambiente isolado |
| [CHAOS_STAGING_RUNBOOK.md](./CHAOS_STAGING_RUNBOOK.md) | testes de carga/chaos |

## Copilot

| Documento | Público |
|-----------|---------|
| [copilot/ARCHITECTURE.md](./copilot/ARCHITECTURE.md) | arquitetura |
| [copilot/RUNBOOK.md](./copilot/RUNBOOK.md) | operação |
| [copilot/PROMPTS.md](./copilot/PROMPTS.md) | prompts |

## Arquivo (planos e relatórios históricos)

Não usar como runbook primário. Ver [archive/plans/README.md](./archive/plans/README.md).

## Outros

- [OBSERVABILITY_AND_LOGGING.md](./OBSERVABILITY_AND_LOGGING.md)
- [AI_USAGE_PRIVACY.md](./AI_USAGE_PRIVACY.md)
- [INTERSERVICE_CONTRACTS.md](./INTERSERVICE_CONTRACTS.md)
- [DESIGN.md](../DESIGN.md) — visão técnica do monorepo
- [AGENTS.md](../AGENTS.md) — instruções para agentes
