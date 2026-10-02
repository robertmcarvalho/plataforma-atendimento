/** Status de cadastro (entregador, farmácia, líder) → cor do indicador. */
export function cadastroStatusDot(status?: string | null): 'active' | 'inactive' {
  return status === 'active' ? 'active' : 'inactive';
}
