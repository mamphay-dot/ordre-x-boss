-- ============================================================
--  BOSS — Durcissement sécurité (audit log, expiration
--  invitations, anti-élévation privilèges, contraintes RLS)
-- ============================================================

-- ------------------------------------------------------------
--  1. Expiration des invitations (défense contre tokens volés)
-- ------------------------------------------------------------
alter table public.invitations
  add column if not exists expires_at timestamptz not null default (now() + interval '7 days');

create index if not exists invitations_expires_idx on public.invitations(expires_at)
  where accepted_at is null;

-- Purge automatique des invitations expirées (7 jours après expiration)
create or replace function public.purge_expired_invitations() returns void
  language sql security definer
  set search_path = public
  as $$
    delete from public.invitations
    where accepted_at is null and expires_at < now() - interval '7 days';
  $$;

-- ------------------------------------------------------------
--  2. Table audit_log (journal INSERT-only)
-- ------------------------------------------------------------
create table if not exists public.audit_log (
  id              bigserial primary key,
  organization_id uuid references public.organizations(id) on delete cascade,
  actor_user_id   uuid references auth.users(id) on delete set null,
  actor_email     text,
  action          text not null,     -- ex. 'create_org','invite','accept_invite','update_profile','delete_profile','role_change','signin'
  target_id       text,               -- id de la ressource touchée (uuid ou uid)
  target_email    text,               -- si l'action porte sur un email
  meta            jsonb,              -- payload libre (données avant/après)
  ip              inet,
  user_agent      text,
  created_at      timestamptz not null default now()
);
create index if not exists audit_log_org_idx on public.audit_log(organization_id, created_at desc);
create index if not exists audit_log_action_idx on public.audit_log(action, created_at desc);

alter table public.audit_log enable row level security;

-- Lecture : seuls les membres d'une org peuvent lire son audit
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log
  for select using (public.is_member(organization_id));

-- Insertion : les fonctions SECURITY DEFINER de log peuvent écrire,
-- pas les utilisateurs authenticated directement.
drop policy if exists audit_insert on public.audit_log;
create policy audit_insert on public.audit_log
  for insert with check (false);

-- Fonction de log (bypasse RLS via SECURITY DEFINER)
create or replace function public.log_audit(
  p_org uuid, p_action text, p_target_id text default null,
  p_target_email text default null, p_meta jsonb default null
) returns void
  language plpgsql security definer
  set search_path = public
  as $$
declare
  actor_uid uuid;
  actor_email text;
begin
  actor_uid := auth.uid();
  actor_email := lower(coalesce(auth.jwt()->>'email',''));
  insert into public.audit_log (organization_id, actor_user_id, actor_email, action, target_id, target_email, meta)
    values (p_org, actor_uid, actor_email, p_action, p_target_id, p_target_email, p_meta);
end $$;

grant execute on function public.log_audit(uuid, text, text, text, jsonb) to authenticated;

-- ------------------------------------------------------------
--  3. Anti-élévation de privilèges sur memberships
--     Un collaborateur ne doit PAS pouvoir se promouvoir
--     lui-même en manager/proprietaire.
-- ------------------------------------------------------------
create or replace function public.prevent_self_privilege_escalation() returns trigger
  language plpgsql security definer
  set search_path = public
  as $$
declare
  self_uid uuid;
  ROLE_RANK constant jsonb := '{"collaborateur":1,"commercial":1,"comptable":1,"secretaire":1,"chef_projet":1,"bu_manager":2,"manager":2,"recouvrement":2,"proprietaire":3}'::jsonb;
  old_rank int;
  new_rank int;
begin
  self_uid := auth.uid();
  -- Si l'utilisateur tente de modifier sa propre membership (rôle),
  -- il ne peut jamais s'AUGMENTER le rôle.
  if new.user_id = self_uid then
    old_rank := coalesce((ROLE_RANK ->> old.role)::int, 1);
    new_rank := coalesce((ROLE_RANK ->> new.role)::int, 1);
    if new_rank > old_rank then
      raise exception 'Refusé : impossible de se promouvoir soi-même (% -> %)', old.role, new.role;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists memberships_no_self_escalate on public.memberships;
create trigger memberships_no_self_escalate before update on public.memberships
  for each row execute function public.prevent_self_privilege_escalation();

-- ------------------------------------------------------------
--  4. Toujours conserver au moins UN proprietaire par org
--     Empêche la suppression du dernier proprietaire.
-- ------------------------------------------------------------
create or replace function public.protect_last_owner() returns trigger
  language plpgsql security definer
  set search_path = public
  as $$
declare
  owners_left int;
  target_org uuid;
begin
  target_org := coalesce(old.organization_id, new.organization_id);
  if tg_op = 'DELETE' then
    if old.role = 'proprietaire' then
      select count(*) into owners_left from public.memberships
        where organization_id = target_org and role = 'proprietaire' and user_id <> old.user_id;
      if owners_left = 0 then
        raise exception 'Refusé : impossible de retirer le dernier propriétaire de l''organisation';
      end if;
    end if;
  elsif tg_op = 'UPDATE' then
    if old.role = 'proprietaire' and new.role <> 'proprietaire' then
      select count(*) into owners_left from public.memberships
        where organization_id = target_org and role = 'proprietaire' and user_id <> old.user_id;
      if owners_left = 0 then
        raise exception 'Refusé : impossible de rétrograder le dernier propriétaire';
      end if;
    end if;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists memberships_protect_last_owner_upd on public.memberships;
create trigger memberships_protect_last_owner_upd before update on public.memberships
  for each row execute function public.protect_last_owner();

drop trigger if exists memberships_protect_last_owner_del on public.memberships;
create trigger memberships_protect_last_owner_del before delete on public.memberships
  for each row execute function public.protect_last_owner();

-- ------------------------------------------------------------
--  5. Rate-limit invitations (max 20/heure par organisation)
-- ------------------------------------------------------------
create or replace function public.check_invitation_rate() returns trigger
  language plpgsql security definer
  set search_path = public
  as $$
declare
  recent_count int;
begin
  select count(*) into recent_count from public.invitations
    where organization_id = new.organization_id
      and created_at > now() - interval '1 hour';
  if recent_count >= 20 then
    raise exception 'Limite : maximum 20 invitations par heure et par organisation';
  end if;
  return new;
end $$;

drop trigger if exists invitations_rate_limit on public.invitations;
create trigger invitations_rate_limit before insert on public.invitations
  for each row execute function public.check_invitation_rate();

-- ------------------------------------------------------------
--  6. accept_invitation : refuser les invitations expirées et
--     journaliser l'action
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
  if inv.expires_at < now() then
    raise exception 'Cette invitation a expiré (%). Demande-en une nouvelle.', inv.expires_at::date;
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

  perform public.log_audit(inv.organization_id, 'accept_invitation', inv.id::text, user_email,
    jsonb_build_object('role', inv.role));

  return mem;
end $$;

-- ------------------------------------------------------------
--  7. create_organization : journaliser
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
  if length(org_nom) > 120 then
    raise exception 'Le nom est trop long (max 120 caractères)';
  end if;
  insert into public.organizations(nom, owner_user_id)
    values (trim(org_nom), auth.uid())
    returning * into org;
  insert into public.memberships(organization_id, user_id, role, nom)
    values (org.id, auth.uid(), 'proprietaire',
            coalesce(auth.jwt()->>'email','Patron'));

  perform public.log_audit(org.id, 'create_organization', org.id::text, null,
    jsonb_build_object('nom', org.nom));

  return org;
end $$;

-- ------------------------------------------------------------
--  8. Contraintes de longueur sur les profils (anti-DoS)
-- ------------------------------------------------------------
alter table public.profiles
  drop constraint if exists profiles_data_size;
alter table public.profiles
  add constraint profiles_data_size check (pg_column_size(data) < 5 * 1024 * 1024); -- max 5 MB par profile
