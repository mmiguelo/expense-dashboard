import type { Lang } from '../i18n';

// The Terms of Use and the Privacy Policy, in every language of the app. Shown by
// terms.html and privacy.html (see src/legal/page.ts).
//
// In the text, {email} becomes a link to CONTACT_EMAIL, {terms} and {privacy} links to the
// other page. Change UPDATED whenever the content changes in substance.

export const CONTROLLER = 'Marco Miguelote';
export const CONTACT_EMAIL = 'expensedashboard.mail@gmail.com';
export const UPDATED = '2026-11-17';

export type Block = { h: string } | { p: string } | { ul: string[] };
export interface LegalDoc {
  title: string;
  blocks: Block[];
}
export type DocName = 'terms' | 'privacy';

interface LegalTexts {
  updated: string;
  back: string;
  terms: LegalDoc;
  privacy: LegalDoc;
}

const pt: LegalTexts = {
  updated: 'Última atualização: {date}',
  back: 'Voltar ao painel',
  terms: {
    title: 'Termos de Utilização',
    blocks: [
      { h: '1. O serviço' },
      { p: `O Painel de despesas é uma ferramenta para registar e analisar as suas finanças pessoais: despesas, receitas, transferências entre contas, orçamentos e movimentos fixos. É gerido por ${CONTROLLER} ({email}). Ao criar uma conta, aceita estes termos e a {privacy}.` },
      { h: '2. O que o serviço não é' },
      { p: 'Não é um banco nem uma instituição de pagamento: não movimenta dinheiro e não se liga às suas contas bancárias. Os saldos e totais que mostra resultam apenas do que regista e podem não coincidir com os do seu banco. Não presta aconselhamento financeiro, fiscal nem de investimento.' },
      { h: '3. A sua conta' },
      { ul: [
        'Tem de ter pelo menos 16 anos.',
        'Use um email que seja seu e mantenha a palavra-passe em segredo: é responsável pelo que for feito com a sua conta.',
        'Cada conta é pessoal e não deve ser partilhada.',
      ] },
      { h: '4. Utilização aceitável' },
      { p: 'Não pode:' },
      { ul: [
        'tentar aceder a dados de outros utilizadores ou contornar as regras de segurança;',
        'sobrecarregar o serviço, por exemplo com pedidos automáticos em massa;',
        'usar o serviço para atividades ilegais ou para guardar conteúdo ilegal.',
      ] },
      { h: '5. Os seus dados' },
      { p: 'Os dados que regista são seus. Dá-nos apenas a autorização necessária para os guardar, processar e mostrar a si, para lhe prestar o serviço. Pode exportá-los e apagá-los a qualquer momento. Recomendamos que exporte regularmente uma cópia de segurança.' },
      { h: '6. Preço e disponibilidade' },
      { p: 'O serviço é gratuito. Fazemos o possível para que funcione bem, mas é prestado tal como está: pode ter interrupções, erros ou mudanças, e não garantimos que esteja sempre disponível nem que os cálculos estejam isentos de erros. Podemos alterar, limitar ou terminar o serviço. Se o terminarmos, avisamos com pelo menos 30 dias de antecedência, para que possa exportar os seus dados.' },
      { h: '7. Responsabilidade' },
      { p: 'Na medida permitida por lei, não somos responsáveis por perdas indiretas nem por decisões tomadas com base no que o painel mostra. Nada nestes termos limita a responsabilidade por dolo ou negligência grave, nem os direitos que a lei lhe garante como consumidor.' },
      { h: '8. Suspensão e fim da conta' },
      { p: 'Pode apagar a sua conta a qualquer momento, em A minha conta. Podemos desativar uma conta que viole estes termos. Se isso acontecer, pode pedir por email uma cópia dos seus dados ou que sejam apagados.' },
      { h: '9. Alterações' },
      { p: 'Se mudarmos estes termos de forma importante, avisamos no painel ou por email antes de as alterações entrarem em vigor. Se não concordar, pode deixar de usar o serviço e apagar a conta.' },
      { h: '10. Lei aplicável' },
      { p: 'Estes termos regem-se pela lei portuguesa, sem prejuízo das normas de proteção do consumidor do país onde reside.' },
      { h: '11. Contacto' },
      { p: 'Para qualquer questão, escreva para {email}.' },
    ],
  },
  privacy: {
    title: 'Política de Privacidade',
    blocks: [
      { h: '1. Quem é responsável pelos seus dados' },
      { p: `O Painel de despesas é gerido por ${CONTROLLER}, responsável pelo tratamento dos seus dados pessoais. Para qualquer questão sobre privacidade, ou para exercer os seus direitos, escreva para {email}.` },
      { h: '2. Que dados guardamos' },
      { ul: [
        'Dados da conta: o seu email, a palavra-passe (guardada apenas em forma cifrada, que ninguém consegue ler), o nome que escolher e a moeda.',
        'O que regista no painel: movimentos (datas, valores, descrições, categorias, etiquetas), contas e os nomes e instituições que lhes dá, categorias, regras, orçamentos e movimentos fixos.',
        'Dados técnicos: quando usa o serviço, os fornecedores de alojamento registam o endereço IP e dados do pedido, como o navegador, por razões de segurança e funcionamento.',
      ] },
      { p: 'O painel não se liga ao seu banco e não pedimos dados bancários, de cartões nem documentos de identificação. Recomendamos que não escreva esse tipo de dados nas descrições.' },
      { h: '3. Para que os usamos' },
      { ul: [
        'Para lhe prestar o serviço: guardar os seus dados, mostrá-los em qualquer dispositivo e calcular totais e gráficos. Base legal: execução do contrato, isto é, dos {terms} (artigo 6.º, n.º 1, alínea b) do RGPD).',
        'Para manter o serviço seguro e a funcionar: impedir abusos, limitar pedidos e corrigir erros. Base legal: interesse legítimo (alínea f).',
        'Para lhe enviar os emails necessários: confirmação da conta e recuperação da palavra-passe.',
      ] },
      { p: 'Não vendemos os seus dados, não os usamos para publicidade, não fazemos perfis e não usamos ferramentas de análise nem de rastreio.' },
      { h: '4. Quem vê os seus dados' },
      { p: 'Os seus movimentos e definições só são visíveis para si. Os administradores do serviço veem apenas os dados da conta (email, nome, perfil, estado e data de criação), para a poderem gerir, e nunca os seus movimentos.' },
      { p: 'Usamos estes subcontratantes, que tratam os dados apenas por nossa conta:' },
      { ul: [
        'Supabase Inc.: base de dados, contas e envio de emails. Os dados ficam guardados num centro de dados em Londres (Reino Unido), país com decisão de adequação da Comissão Europeia.',
        'GitHub Inc.: alojamento das páginas do site; recebe o endereço IP de quem as visita.',
      ] },
      { p: 'Ambas são empresas dos Estados Unidos. Quando algum dado é transferido para fora do Espaço Económico Europeu, fica protegido pelo Quadro de Privacidade de Dados UE-EUA ou por cláusulas contratuais-tipo aprovadas pela Comissão Europeia. Os tipos de letra são servidos pelo próprio site, por isso nada é enviado ao Google.' },
      { h: '5. O que fica no seu navegador' },
      { p: 'O painel guarda no seu navegador (armazenamento local) apenas o necessário para funcionar: a sessão iniciada, o idioma, as secções que fechou e a última conta usada. Não usamos cookies de publicidade nem de rastreio.' },
      { h: '6. Quanto tempo guardamos os dados' },
      { p: 'Guardamos os seus dados enquanto tiver conta.' },
      { ul: [
        'Quando apaga um movimento ou uma conta no painel, deixam de aparecer e de contar nos totais, mas ficam guardados na base de dados. Desaparecem de vez quando usa "Apagar todos os meus dados" ou "Apagar a minha conta".',
        '"Apagar todos os meus dados" apaga de imediato e para sempre todos os movimentos, contas, categorias, regras, orçamentos e movimentos fixos. Continua a poder iniciar sessão.',
        '"Apagar a minha conta" apaga de imediato e para sempre a conta e todos os dados.',
      ] },
      { p: 'As cópias de segurança do fornecedor de alojamento podem conter os dados durante um período limitado, até serem substituídas. Os registos técnicos são guardados pelos fornecedores durante pouco tempo.' },
      { h: '7. Os seus direitos' },
      { p: 'Ao abrigo do Regulamento Geral sobre a Proteção de Dados (RGPD), tem direito a:' },
      { ul: [
        'aceder aos seus dados e obter uma cópia: em Definições → Cópia de segurança pode exportá-los em JSON ou CSV a qualquer momento;',
        'corrigi-los: pode editar tudo no painel;',
        'apagá-los: em A minha conta → Apagar os meus dados;',
        'levá-los para outro serviço (portabilidade): a exportação em JSON ou CSV serve para isso;',
        'opor-se ao tratamento ou pedir a sua limitação.',
      ] },
      { p: 'Para qualquer pedido que não consiga fazer no painel, por exemplo se a sua conta estiver desativada, escreva para {email}. Respondemos no prazo de um mês.' },
      { p: 'Tem também o direito de apresentar queixa à Comissão Nacional de Proteção de Dados (CNPD, www.cnpd.pt).' },
      { h: '8. Segurança' },
      { p: 'Usamos ligações cifradas (HTTPS), guardamos as palavras-passe cifradas, a base de dados impede cada utilizador de aceder aos dados de outros e o número de pedidos é limitado. Nenhum sistema é totalmente seguro: use uma palavra-passe que não use noutros sites e avise-nos se suspeitar de um acesso indevido.' },
      { h: '9. Idade' },
      { p: 'O serviço destina-se a pessoas com pelo menos 16 anos.' },
      { h: '10. Alterações' },
      { p: 'Se esta política mudar de forma importante, avisamos no painel ou por email antes de a alteração entrar em vigor. A data no topo indica a última atualização.' },
    ],
  },
};

const en: LegalTexts = {
  updated: 'Last updated: {date}',
  back: 'Back to the dashboard',
  terms: {
    title: 'Terms of Use',
    blocks: [
      { h: '1. The service' },
      { p: `The Expense dashboard is a tool to record and analyse your personal finances: expenses, income, transfers between accounts, budgets and recurring entries. It is run by ${CONTROLLER} ({email}). By creating an account, you accept these terms and the {privacy}.` },
      { h: '2. What the service is not' },
      { p: "It is not a bank or a payment institution: it doesn't move money and doesn't connect to your bank accounts. The balances and totals it shows come only from what you record and may not match your bank's. It doesn't give financial, tax or investment advice." },
      { h: '3. Your account' },
      { ul: [
        'You must be at least 16 years old.',
        'Use an email address of your own and keep your password secret: you are responsible for what is done with your account.',
        'Each account is personal and should not be shared.',
      ] },
      { h: '4. Acceptable use' },
      { p: 'You must not:' },
      { ul: [
        "try to access other users' data or get around the security rules;",
        'overload the service, for example with automated requests in bulk;',
        'use the service for illegal activities or to store illegal content.',
      ] },
      { h: '5. Your data' },
      { p: 'The data you record is yours. You give us only the permission needed to store it, process it and show it to you, to provide the service. You can export and delete it at any time. We recommend exporting a backup regularly.' },
      { h: '6. Price and availability' },
      { p: "The service is free. We do our best for it to work well, but it is provided as is: it may have interruptions, errors or changes, and we don't guarantee that it is always available or that its calculations are free of errors. We may change, limit or end the service. If we end it, we will give at least 30 days' notice so you can export your data." },
      { h: '7. Liability' },
      { p: 'To the extent permitted by law, we are not liable for indirect losses or for decisions made based on what the dashboard shows. Nothing in these terms limits liability for intent or gross negligence, or the rights the law gives you as a consumer.' },
      { h: '8. Suspension and closing your account' },
      { p: 'You can delete your account at any time, in My account. We may deactivate an account that breaks these terms. If that happens, you can ask by email for a copy of your data or for it to be deleted.' },
      { h: '9. Changes' },
      { p: "If we change these terms in an important way, we will tell you in the dashboard or by email before the changes take effect. If you don't agree, you can stop using the service and delete your account." },
      { h: '10. Governing law' },
      { p: 'These terms are governed by Portuguese law, without prejudice to the consumer protection rules of the country where you live.' },
      { h: '11. Contact' },
      { p: 'For any question, write to {email}.' },
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    blocks: [
      { h: '1. Who is responsible for your data' },
      { p: `The Expense dashboard is run by ${CONTROLLER}, the controller of your personal data. For any privacy question, or to exercise your rights, write to {email}.` },
      { h: '2. What data we keep' },
      { ul: [
        'Account data: your email address, your password (stored only in encrypted form that nobody can read), the name you choose and your currency.',
        'What you record in the dashboard: entries (dates, amounts, descriptions, categories, tags), accounts and the names and institutions you give them, categories, rules, budgets and recurring entries.',
        'Technical data: when you use the service, the hosting providers log your IP address and request details, such as your browser, for security and operation.',
      ] },
      { p: "The dashboard doesn't connect to your bank and we don't ask for bank or card details or identity documents. We recommend not typing that kind of data into descriptions." },
      { h: '3. What we use it for' },
      { ul: [
        'To provide the service: storing your data, showing it on any device and calculating totals and charts. Legal basis: performance of the contract, that is, the {terms} (GDPR Article 6(1)(b)).',
        'To keep the service secure and working: preventing abuse, limiting requests and fixing errors. Legal basis: legitimate interest (Article 6(1)(f)).',
        'To send you the emails needed: account confirmation and password recovery.',
      ] },
      { p: "We don't sell your data, don't use it for advertising, don't profile you and don't use analytics or tracking tools." },
      { h: '4. Who sees your data' },
      { p: 'Your entries and settings are visible only to you. The service administrators see only account data (email, name, role, status and creation date), to manage accounts, and never your entries.' },
      { p: 'We use these processors, which handle data only on our behalf:' },
      { ul: [
        'Supabase Inc.: database, accounts and sending emails. The data is stored in a data centre in London (United Kingdom), a country with an adequacy decision from the European Commission.',
        'GitHub Inc.: hosting the site pages; it receives the IP address of visitors.',
      ] },
      { p: 'Both are United States companies. When any data is transferred outside the European Economic Area, it is protected by the EU-US Data Privacy Framework or by standard contractual clauses approved by the European Commission. The fonts are served by the site itself, so nothing is sent to Google.' },
      { h: '5. What stays in your browser' },
      { p: "The dashboard stores in your browser (local storage) only what it needs to work: your session, your language, the sections you collapsed and the last account you used. We don't use advertising or tracking cookies." },
      { h: '6. How long we keep data' },
      { p: 'We keep your data while you have an account.' },
      { ul: [
        'When you delete an entry or an account in the dashboard, it stops appearing and counting in totals, but it stays stored in the database. It is gone for good when you use "Delete all my data" or "Delete my account".',
        '"Delete all my data" immediately and permanently deletes all entries, accounts, categories, rules, budgets and recurring entries. You can still sign in.',
        '"Delete my account" immediately and permanently deletes the account and all its data.',
      ] },
      { p: "The hosting provider's backups may contain the data for a limited period, until they are overwritten. Technical logs are kept by the providers for a short time." },
      { h: '7. Your rights' },
      { p: 'Under the General Data Protection Regulation (GDPR), you have the right to:' },
      { ul: [
        'access your data and get a copy: in Settings → Backup you can export it as JSON or CSV at any time;',
        'correct it: you can edit everything in the dashboard;',
        'erase it: in My account → Delete my data;',
        'take it to another service (portability): the JSON or CSV export is for that;',
        'object to processing or ask for it to be restricted.',
      ] },
      { p: "For any request you can't make in the dashboard, for example if your account is deactivated, write to {email}. We reply within one month." },
      { p: 'You also have the right to complain to a data protection authority, such as the Portuguese CNPD (www.cnpd.pt).' },
      { h: '8. Security' },
      { p: "We use encrypted connections (HTTPS), store passwords encrypted, the database stops each user from accessing other users' data and the number of requests is limited. No system is completely secure: use a password you don't use on other sites and tell us if you suspect unauthorised access." },
      { h: '9. Age' },
      { p: 'The service is meant for people aged 16 or over.' },
      { h: '10. Changes' },
      { p: 'If this policy changes in an important way, we will tell you in the dashboard or by email before the change takes effect. The date at the top shows the last update.' },
    ],
  },
};

const es: LegalTexts = {
  updated: 'Última actualización: {date}',
  back: 'Volver al panel',
  terms: {
    title: 'Términos de Uso',
    blocks: [
      { h: '1. El servicio' },
      { p: `El Panel de gastos es una herramienta para registrar y analizar sus finanzas personales: gastos, ingresos, transferencias entre cuentas, presupuestos y movimientos fijos. Lo gestiona ${CONTROLLER} ({email}). Al crear una cuenta, acepta estos términos y la {privacy}.` },
      { h: '2. Lo que el servicio no es' },
      { p: 'No es un banco ni una entidad de pago: no mueve dinero y no se conecta a sus cuentas bancarias. Los saldos y totales que muestra provienen solo de lo que registra y pueden no coincidir con los de su banco. No ofrece asesoramiento financiero, fiscal ni de inversión.' },
      { h: '3. Su cuenta' },
      { ul: [
        'Debe tener al menos 16 años.',
        'Use un email propio y mantenga su contraseña en secreto: es responsable de lo que se haga con su cuenta.',
        'Cada cuenta es personal y no debe compartirse.',
      ] },
      { h: '4. Uso aceptable' },
      { p: 'No puede:' },
      { ul: [
        'intentar acceder a datos de otros usuarios ni eludir las reglas de seguridad;',
        'sobrecargar el servicio, por ejemplo con peticiones automáticas masivas;',
        'usar el servicio para actividades ilegales ni para guardar contenido ilegal.',
      ] },
      { h: '5. Sus datos' },
      { p: 'Los datos que registra son suyos. Solo nos da el permiso necesario para guardarlos, procesarlos y mostrárselos, para prestarle el servicio. Puede exportarlos y borrarlos en cualquier momento. Le recomendamos exportar una copia de seguridad con regularidad.' },
      { h: '6. Precio y disponibilidad' },
      { p: 'El servicio es gratuito. Hacemos lo posible para que funcione bien, pero se presta tal cual: puede tener interrupciones, errores o cambios, y no garantizamos que esté siempre disponible ni que los cálculos estén libres de errores. Podemos cambiar, limitar o cerrar el servicio. Si lo cerramos, avisaremos con al menos 30 días de antelación para que pueda exportar sus datos.' },
      { h: '7. Responsabilidad' },
      { p: 'En la medida permitida por la ley, no somos responsables de pérdidas indirectas ni de decisiones tomadas a partir de lo que muestra el panel. Nada en estos términos limita la responsabilidad por dolo o negligencia grave, ni los derechos que la ley le reconoce como consumidor.' },
      { h: '8. Suspensión y cierre de la cuenta' },
      { p: 'Puede borrar su cuenta en cualquier momento, en Mi cuenta. Podemos desactivar una cuenta que incumpla estos términos. Si eso ocurre, puede pedir por email una copia de sus datos o que se borren.' },
      { h: '9. Cambios' },
      { p: 'Si cambiamos estos términos de forma importante, le avisaremos en el panel o por email antes de que los cambios entren en vigor. Si no está de acuerdo, puede dejar de usar el servicio y borrar su cuenta.' },
      { h: '10. Ley aplicable' },
      { p: 'Estos términos se rigen por la ley portuguesa, sin perjuicio de las normas de protección del consumidor del país donde reside.' },
      { h: '11. Contacto' },
      { p: 'Para cualquier pregunta, escriba a {email}.' },
    ],
  },
  privacy: {
    title: 'Política de Privacidad',
    blocks: [
      { h: '1. Quién es responsable de sus datos' },
      { p: `El Panel de gastos lo gestiona ${CONTROLLER}, responsable del tratamiento de sus datos personales. Para cualquier cuestión sobre privacidad, o para ejercer sus derechos, escriba a {email}.` },
      { h: '2. Qué datos guardamos' },
      { ul: [
        'Datos de la cuenta: su email, su contraseña (guardada solo en forma cifrada, que nadie puede leer), el nombre que elija y su moneda.',
        'Lo que registra en el panel: movimientos (fechas, importes, descripciones, categorías, etiquetas), cuentas y los nombres e instituciones que les da, categorías, reglas, presupuestos y movimientos fijos.',
        'Datos técnicos: cuando usa el servicio, los proveedores de alojamiento registran su dirección IP y datos de la petición, como el navegador, por motivos de seguridad y funcionamiento.',
      ] },
      { p: 'El panel no se conecta a su banco y no pedimos datos bancarios, de tarjetas ni documentos de identidad. Le recomendamos no escribir ese tipo de datos en las descripciones.' },
      { h: '3. Para qué los usamos' },
      { ul: [
        'Para prestarle el servicio: guardar sus datos, mostrarlos en cualquier dispositivo y calcular totales y gráficos. Base legal: ejecución del contrato, es decir, de los {terms} (artículo 6.1.b del RGPD).',
        'Para mantener el servicio seguro y en funcionamiento: impedir abusos, limitar peticiones y corregir errores. Base legal: interés legítimo (artículo 6.1.f).',
        'Para enviarle los emails necesarios: confirmación de la cuenta y recuperación de la contraseña.',
      ] },
      { p: 'No vendemos sus datos, no los usamos para publicidad, no creamos perfiles y no usamos herramientas de análisis ni de seguimiento.' },
      { h: '4. Quién ve sus datos' },
      { p: 'Sus movimientos y ajustes solo los ve usted. Los administradores del servicio solo ven los datos de la cuenta (email, nombre, perfil, estado y fecha de creación), para gestionarla, y nunca sus movimientos.' },
      { p: 'Usamos estos encargados del tratamiento, que tratan los datos solo por cuenta nuestra:' },
      { ul: [
        'Supabase Inc.: base de datos, cuentas y envío de emails. Los datos se guardan en un centro de datos en Londres (Reino Unido), país con decisión de adecuación de la Comisión Europea.',
        'GitHub Inc.: alojamiento de las páginas del sitio; recibe la dirección IP de quien las visita.',
      ] },
      { p: 'Ambas son empresas de Estados Unidos. Cuando algún dato se transfiere fuera del Espacio Económico Europeo, queda protegido por el Marco de Privacidad de Datos UE-EE. UU. o por cláusulas contractuales tipo aprobadas por la Comisión Europea. Las fuentes las sirve el propio sitio, así que no se envía nada a Google.' },
      { h: '5. Lo que queda en su navegador' },
      { p: 'El panel guarda en su navegador (almacenamiento local) solo lo necesario para funcionar: la sesión iniciada, el idioma, las secciones que cerró y la última cuenta usada. No usamos cookies de publicidad ni de seguimiento.' },
      { h: '6. Cuánto tiempo guardamos los datos' },
      { p: 'Guardamos sus datos mientras tenga cuenta.' },
      { ul: [
        'Cuando borra un movimiento o una cuenta en el panel, deja de aparecer y de contar en los totales, pero queda guardado en la base de datos. Desaparece del todo cuando usa "Borrar todos mis datos" o "Borrar mi cuenta".',
        '"Borrar todos mis datos" borra de inmediato y para siempre todos los movimientos, cuentas, categorías, reglas, presupuestos y movimientos fijos. Puede seguir iniciando sesión.',
        '"Borrar mi cuenta" borra de inmediato y para siempre la cuenta y todos sus datos.',
      ] },
      { p: 'Las copias de seguridad del proveedor de alojamiento pueden contener los datos durante un periodo limitado, hasta que se sustituyen. Los registros técnicos los guardan los proveedores durante poco tiempo.' },
      { h: '7. Sus derechos' },
      { p: 'Según el Reglamento General de Protección de Datos (RGPD), tiene derecho a:' },
      { ul: [
        'acceder a sus datos y obtener una copia: en Ajustes → Copia de seguridad puede exportarlos en JSON o CSV en cualquier momento;',
        'corregirlos: puede editarlo todo en el panel;',
        'borrarlos: en Mi cuenta → Borrar mis datos;',
        'llevarlos a otro servicio (portabilidad): la exportación en JSON o CSV sirve para eso;',
        'oponerse al tratamiento o pedir su limitación.',
      ] },
      { p: 'Para cualquier petición que no pueda hacer en el panel, por ejemplo si su cuenta está desactivada, escriba a {email}. Respondemos en el plazo de un mes.' },
      { p: 'También tiene derecho a reclamar ante una autoridad de protección de datos, como la CNPD portuguesa (www.cnpd.pt).' },
      { h: '8. Seguridad' },
      { p: 'Usamos conexiones cifradas (HTTPS), guardamos las contraseñas cifradas, la base de datos impide que cada usuario acceda a los datos de otros y el número de peticiones está limitado. Ningún sistema es totalmente seguro: use una contraseña que no use en otros sitios y avísenos si sospecha de un acceso indebido.' },
      { h: '9. Edad' },
      { p: 'El servicio está dirigido a personas de 16 años o más.' },
      { h: '10. Cambios' },
      { p: 'Si esta política cambia de forma importante, le avisaremos en el panel o por email antes de que el cambio entre en vigor. La fecha de arriba indica la última actualización.' },
    ],
  },
};

export const LEGAL: Record<Lang, LegalTexts> = { pt, en, es };
