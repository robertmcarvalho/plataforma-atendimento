export function whatsAppContractDataSnippet(args: {
  contactName: string;
  tradeName: string;
  link: string;
}): string {
  const contact = args.contactName.trim() || 'olá';
  const trade = args.tradeName.trim() || 'sua farmácia';
  return `Olá ${contact}, para formalizarmos o contrato da ${trade}, preencha o formulário com os dados da farmácia: ${args.link}`;
}
