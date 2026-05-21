# Horário de delivery da farmácia

JSON em `pharmacies.delivery_schedule` (formato canônico + campos extras).

## Campos extras

| Campo | Descrição |
|-------|-----------|
| `deliver_on_holidays` | `true` = entrega em feriados nacionais com horário em `holiday_delivery` |
| `holiday_delivery` | `{ is_open, intervals: [{ start, end }] }` — usado só em feriados nacionais |

## Runtime

- `delivery_open_now` usa `isPharmacyDeliveryOpen` (API): exceções por data em `holidays[]` (prefixo `EXC:`), depois feriados BR, depois grade `weekly`.
- Feriados nacionais: calendário em `apps/api-service/src/lib/brPublicHolidays.ts`.

## UI

Cadastro em **Farmácias** → `PharmacyDeliveryScheduleEditor` (toggle + horário condicional; sem lista manual de feriados).
