-- The admins' to-do list for the app (features decided but not built yet). Only active
-- admins can read or change it; members never see it.

create table public.roadmap_items (
  id bigint generated always as identity primary key,
  text text not null check (length(btrim(text)) between 1 and 500),
  done boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.roadmap_items enable row level security;

create policy "Admins can read the roadmap" on public.roadmap_items
  for select to authenticated using ((select public.is_admin()));
create policy "Admins can add to the roadmap" on public.roadmap_items
  for insert to authenticated with check ((select public.is_admin()));
create policy "Admins can change the roadmap" on public.roadmap_items
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "Admins can delete from the roadmap" on public.roadmap_items
  for delete to authenticated using ((select public.is_admin()));

grant select, insert, update, delete on public.roadmap_items to authenticated;

insert into public.roadmap_items (text) values
  ('Objetivos de poupança: um valor e uma data-alvo opcionais numa conta de poupança, com o progresso no painel.'),
  ('Várias moedas (fase 2): moeda por conta, câmbios diários do BCE, transferências com o valor enviado e o recebido, totais convertidos para a moeda do utilizador.'),
  ('Importar extratos bancários (CSV), reconhecendo as transferências entre contas próprias.'),
  ('Contas de dinheiro físico (carteira), se fizer falta registar compras pagas em numerário.'),
  ('Valor de mercado dos investimentos (hoje o saldo de uma corretora é só o que lá se pôs).');
