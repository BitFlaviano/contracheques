-- Estrutura necessária para os recursos administrativos e de usuário.
-- Execute no SQL Editor do Supabase do projeto.

create table if not exists public.solicitacoes_contracheques (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  nome_usuario text,
  referencia text,
  motivo text,
  status text not null default 'pendente'
    check (status in ('pendente', 'aprovado', 'rejeitado')),
  aprovado_por_id uuid,
  aprovado_por_nome text,
  aprovado_em timestamptz,
  valido_ate timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_solicitacoes_contracheques_user_id
  on public.solicitacoes_contracheques (user_id);

create index if not exists idx_solicitacoes_contracheques_status
  on public.solicitacoes_contracheques (status);

create table if not exists public.atestados (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  nome_usuario text,
  email_usuario text,
  arquivo text not null,
  nome_arquivo text,
  email_financeiro text not null default 'financeiro@kidverte.com',
  status_email text not null default 'smtp_nao_configurado',
  created_at timestamptz not null default now()
);

create index if not exists idx_atestados_user_id
  on public.atestados (user_id);

create table if not exists public.confirmacoes_ponto (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  nome_usuario text,
  arquivo text not null,
  confirmado boolean not null default true,
  criado_em timestamptz not null default now()
);

create index if not exists idx_confirmacoes_ponto_user_id
  on public.confirmacoes_ponto (user_id);

create index if not exists idx_confirmacoes_ponto_arquivo
  on public.confirmacoes_ponto (arquivo);

insert into storage.buckets (id, name, public)
values
  ('folhas-ponto', 'folhas-ponto', false),
  ('atestados', 'atestados', false)
on conflict (id) do nothing;
