-- ============================================================
--  BOSS — Schéma Postgres (Supabase)
--  Modèle : approche JSONB alignée sur engine.js mergeStates()
--           1 profile = 1 business, stocké entier en JSONB pour
--           conserver la sémantique atomique du client offline.
-- ============================================================

-- Extension pour gen_random_uuid()
create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
--  organizations
--  1 organisation = 1 patron (peut avoir plusieurs businesses)
-- ------------------------------------------------------------
create table if not exists public.organizations (
  id             uuid primary key default gen_random_uuid(),
  nom            text not null check (length(nom) between 1 and 120),
  owner_user_id  uuid not null references auth.users(id) on delete cascade,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists organizations_owner_idx on public.organizations(owner_user_id);

-- ------------------------------------------------------------
--  memberships
--  Lien user ↔ organisation avec rôle et permissions
-- ------------------------------------------------------------
create table if not exists public.memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            text not null default 'collaborateur'
                  check (role in ('proprietaire','manager','collaborateur','comptable','commercial')),
  permissions     text[] not null default array[]::text[],
  nom             text,
  created_at      timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index if not exists memberships_user_idx on public.memberships(user_id);

-- ------------------------------------------------------------
--  profiles
--  1 profile = 1 business (avec ses revenus, charges, caisse…
--  stockés dans data JSONB : structure identique à celle
--  produite par blankProfile() côté client)
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id              text primary key,               -- format uid() de engine.js
  organization_id uuid not null references public.organizations(id) on delete cascade,
  data            jsonb not null,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id) on delete set null,
  deleted_at      timestamptz
);
create index if not exists profiles_org_idx on public.profiles(organization_id);
create index if not exists profiles_updated_idx on public.profiles(updated_at desc);
create index if not exists profiles_name_idx on public.profiles ((data->>'name'));

-- ------------------------------------------------------------
--  invitations
--  Invitations par email vers une organisation
-- ------------------------------------------------------------
create table if not exists public.invitations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email           text not null,
  role            text not null default 'collaborateur'
                  check (role in ('proprietaire','manager','collaborateur','comptable','commercial')),
  token           text unique not null default replace(gen_random_uuid()::text, '-', ''),
  invited_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  accepted_at     timestamptz,
  accepted_by     uuid references auth.users(id) on delete set null,
  unique (organization_id, email)
);
create index if not exists invitations_email_idx on public.invitations(email);
create index if not exists invitations_token_idx on public.invitations(token);

-- ------------------------------------------------------------
--  license_state
--  État de licence par organisation (essai, paidUntil, prix…)
-- ------------------------------------------------------------
create table if not exists public.license_state (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  data            jsonb not null default '{}'::jsonb,
  updated_at      timestamptz not null default now()
);

-- ------------------------------------------------------------
--  Triggers updated_at
-- ------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
  language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists organizations_touch on public.organizations;
create trigger organizations_touch before update on public.organizations
  for each row execute function public.touch_updated_at();

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists license_touch on public.license_state;
create trigger license_touch before update on public.license_state
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
--  Fonction is_member (SECURITY DEFINER pour éviter la récursion RLS)
-- ------------------------------------------------------------
create or replace function public.is_member(org uuid) returns boolean
  language sql stable security definer
  set search_path = public
  as $$
    select exists (
      select 1 from public.memberships
      where organization_id = org and user_id = auth.uid()
    );
  $$;

create or replace function public.has_role(org uuid, roles text[]) returns boolean
  language sql stable security definer
  set search_path = public
  as $$
    select exists (
      select 1 from public.memberships
      where organization_id = org
        and user_id = auth.uid()
        and role = any(roles)
    );
  $$;

grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.has_role(uuid, text[]) to authenticated;

-- ------------------------------------------------------------
--  RLS : verrouillage par organisation
-- ------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.memberships   enable row level security;
alter table public.profiles      enable row level security;
alter table public.invitations   enable row level security;
alter table public.license_state enable row level security;

-- Organizations
drop policy if exists org_read on public.organizations;
create policy org_read on public.organizations
  for select using (public.is_member(id));

drop policy if exists org_insert on public.organizations;
create policy org_insert on public.organizations
  for insert with check (owner_user_id = auth.uid());

drop policy if exists org_update on public.organizations;
create policy org_update on public.organizations
  for update using (public.has_role(id, array['proprietaire','manager']));

drop policy if exists org_delete on public.organizations;
create policy org_delete on public.organizations
  for delete using (owner_user_id = auth.uid());

-- Memberships
drop policy if exists mem_read on public.memberships;
create policy mem_read on public.memberships
  for select using (
    user_id = auth.uid() or public.is_member(organization_id)
  );

drop policy if exists mem_self_insert on public.memberships;
create policy mem_self_insert on public.memberships
  for insert with check (
    -- Soit c'est vous-même qui rejoignez (auto-insertion à la création d'org),
    -- soit c'est un proprietaire/manager qui invite dans une org où il est
    user_id = auth.uid() or public.has_role(organization_id, array['proprietaire','manager'])
  );

drop policy if exists mem_update on public.memberships;
create policy mem_update on public.memberships
  for update using (public.has_role(organization_id, array['proprietaire','manager']));

drop policy if exists mem_delete on public.memberships;
create policy mem_delete on public.memberships
  for delete using (
    user_id = auth.uid() or public.has_role(organization_id, array['proprietaire','manager'])
  );

-- Profiles (business data)
drop policy if exists prof_read on public.profiles;
create policy prof_read on public.profiles
  for select using (public.is_member(organization_id));

drop policy if exists prof_insert on public.profiles;
create policy prof_insert on public.profiles
  for insert with check (public.is_member(organization_id));

drop policy if exists prof_update on public.profiles;
create policy prof_update on public.profiles
  for update using (public.is_member(organization_id));

drop policy if exists prof_delete on public.profiles;
create policy prof_delete on public.profiles
  for delete using (public.has_role(organization_id, array['proprietaire','manager']));

-- Invitations
drop policy if exists inv_read on public.invitations;
create policy inv_read on public.invitations
  for select using (
    public.is_member(organization_id)
    or lower(email) = lower(coalesce(auth.jwt()->>'email',''))
  );

drop policy if exists inv_insert on public.invitations;
create policy inv_insert on public.invitations
  for insert with check (public.has_role(organization_id, array['proprietaire','manager']));

drop policy if exists inv_update on public.invitations;
create policy inv_update on public.invitations
  for update using (
    public.has_role(organization_id, array['proprietaire','manager'])
    or lower(email) = lower(coalesce(auth.jwt()->>'email',''))
  );

drop policy if exists inv_delete on public.invitations;
create policy inv_delete on public.invitations
  for delete using (public.has_role(organization_id, array['proprietaire','manager']));

-- License state
drop policy if exists lic_read on public.license_state;
create policy lic_read on public.license_state
  for select using (public.is_member(organization_id));

drop policy if exists lic_upsert on public.license_state;
create policy lic_upsert on public.license_state
  for insert with check (public.has_role(organization_id, array['proprietaire','manager']));

drop policy if exists lic_update on public.license_state;
create policy lic_update on public.license_state
  for update using (public.has_role(organization_id, array['proprietaire','manager']));

-- ------------------------------------------------------------
--  Realtime : activer la réplication sur les tables de synchro
-- ------------------------------------------------------------
alter publication supabase_realtime add table public.profiles;
alter publication supabase_realtime add table public.memberships;
alter publication supabase_realtime add table public.license_state;

-- ------------------------------------------------------------
--  Fonction RPC : accept_invitation(token)
--  Convertit une invitation en membership pour l'utilisateur courant
-- ------------------------------------------------------------
create or replace function public.accept_invitation(inv_token text)
  returns public.memberships
  language plpgsql security definer
  set search_path = public
  as $$
declare
  inv public.invitations;
  mem public.memberships;
  user_email text;
begin
  user_email := lower(coalesce(auth.jwt()->>'email',''));
  select * into inv from public.invitations
    where token = inv_token and accepted_at is null
    limit 1;
  if not found then
    raise exception 'Invitation introuvable ou déjà utilisée';
  end if;
  if lower(inv.email) <> user_email then
    raise exception 'Cette invitation est destinée à %', inv.email;
  end if;

  insert into public.memberships (organization_id, user_id, role, permissions, nom)
    values (inv.organization_id, auth.uid(), inv.role, array[]::text[],
            split_part(user_email,'@',1))
    on conflict (organization_id, user_id) do update
      set role = excluded.role
    returning * into mem;

  update public.invitations
    set accepted_at = now(), accepted_by = auth.uid()
    where id = inv.id;

  return mem;
end $$;

grant execute on function public.accept_invitation(text) to authenticated;

-- ------------------------------------------------------------
--  Fonction RPC : create_organization(nom text)
--  Crée l'org + le membership proprietaire en une transaction
-- ------------------------------------------------------------
create or replace function public.create_organization(org_nom text)
  returns public.organizations
  language plpgsql security definer
  set search_path = public
  as $$
declare
  org public.organizations;
begin
  if org_nom is null or length(trim(org_nom)) = 0 then
    raise exception 'Le nom de l''organisation est obligatoire';
  end if;
  insert into public.organizations(nom, owner_user_id)
    values (trim(org_nom), auth.uid())
    returning * into org;
  insert into public.memberships(organization_id, user_id, role, nom)
    values (org.id, auth.uid(), 'proprietaire',
            coalesce(auth.jwt()->>'email','Patron'));
  return org;
end $$;

grant execute on function public.create_organization(text) to authenticated;
