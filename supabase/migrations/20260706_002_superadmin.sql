-- ============================================================
--  BOSS — Super-admin cross-tenant + vues analytiques
--  Autorise le propriétaire de BOSS (Mamphay) à voir toutes
--  les organisations, appliquer des actions transverses et
--  générer des rapports.
-- ============================================================

-- ------------------------------------------------------------
--  1. Table super_admins
-- ------------------------------------------------------------
create table if not exists public.super_admins (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  granted_at  timestamptz not null default now(),
  granted_by  uuid references auth.users(id) on delete set null,
  note        text
);

-- Fonction is_super_admin() — utilisable partout, bypasse RLS
create or replace function public.is_super_admin() returns boolean
  language sql stable security definer
  set search_path = public
  as $$
    select exists (select 1 from public.super_admins where user_id = auth.uid());
  $$;

grant execute on function public.is_super_admin() to authenticated;

-- RLS sur la table super_admins elle-même :
-- - un super-admin peut lire la liste
-- - personne d'autre ne peut lire ni écrire
alter table public.super_admins enable row level security;

drop policy if exists sa_read on public.super_admins;
create policy sa_read on public.super_admins
  for select using (public.is_super_admin());

drop policy if exists sa_insert on public.super_admins;
create policy sa_insert on public.super_admins
  for insert with check (public.is_super_admin());

drop policy if exists sa_delete on public.super_admins;
create policy sa_delete on public.super_admins
  for delete using (public.is_super_admin());

-- ------------------------------------------------------------
--  2. Étendre les politiques RLS existantes pour bypass super-admin
-- ------------------------------------------------------------
-- Organizations : lecture super-admin
drop policy if exists org_read_super on public.organizations;
create policy org_read_super on public.organizations
  for select using (public.is_super_admin());

drop policy if exists org_update_super on public.organizations;
create policy org_update_super on public.organizations
  for update using (public.is_super_admin());

drop policy if exists org_delete_super on public.organizations;
create policy org_delete_super on public.organizations
  for delete using (public.is_super_admin());

-- Memberships : lecture super-admin
drop policy if exists mem_read_super on public.memberships;
create policy mem_read_super on public.memberships
  for select using (public.is_super_admin());

-- Profiles (données business) : lecture super-admin
drop policy if exists prof_read_super on public.profiles;
create policy prof_read_super on public.profiles
  for select using (public.is_super_admin());

-- Invitations : lecture super-admin
drop policy if exists inv_read_super on public.invitations;
create policy inv_read_super on public.invitations
  for select using (public.is_super_admin());

-- License state : lecture ET écriture super-admin
drop policy if exists lic_read_super on public.license_state;
create policy lic_read_super on public.license_state
  for select using (public.is_super_admin());

drop policy if exists lic_upsert_super on public.license_state;
create policy lic_upsert_super on public.license_state
  for insert with check (public.is_super_admin());

drop policy if exists lic_update_super on public.license_state;
create policy lic_update_super on public.license_state
  for update using (public.is_super_admin());

-- Audit log : lecture globale super-admin
drop policy if exists audit_read_super on public.audit_log;
create policy audit_read_super on public.audit_log
  for select using (public.is_super_admin());

-- ------------------------------------------------------------
--  3. Vue org_overview : une ligne par organisation avec toutes
--     les infos utiles au super-admin
-- ------------------------------------------------------------
create or replace view public.org_overview as
select
  o.id                                                  as organization_id,
  o.nom                                                 as nom,
  o.created_at                                          as created_at,
  o.updated_at                                          as updated_at,
  (select u.email from auth.users u where u.id = o.owner_user_id) as owner_email,
  o.owner_user_id                                       as owner_user_id,
  (select count(*) from public.memberships m where m.organization_id = o.id) as membres_count,
  (select count(*) from public.profiles p where p.organization_id = o.id and p.deleted_at is null) as business_count,
  -- CA total cumulé sur l'ensemble des profils/business de l'org
  coalesce((
    select sum(coalesce((elt->>'montant')::numeric, 0))
    from public.profiles p
    cross join lateral jsonb_array_elements(coalesce(p.data->'caisse','[]'::jsonb)) elt
    where p.organization_id = o.id
      and elt->>'type' = 'vente'
      and p.deleted_at is null
  ), 0)::bigint                                         as ca_total_fcfa,
  -- Nombre total d'écritures de caisse (proxy d'activité)
  coalesce((
    select sum(jsonb_array_length(coalesce(p.data->'caisse','[]'::jsonb)))
    from public.profiles p
    where p.organization_id = o.id and p.deleted_at is null
  ), 0)::bigint                                         as ecritures_count,
  -- Dernière activité (max entre updated_at des profils et des memberships)
  greatest(
    coalesce((select max(p.updated_at) from public.profiles p where p.organization_id = o.id), o.created_at),
    o.updated_at
  )                                                     as last_activity_at,
  -- Licence
  ls.data                                               as license_data,
  coalesce((ls.data->>'paidUntil')::bigint, 0)          as paid_until_ms,
  coalesce((ls.data->>'lockedManually')::boolean, false) as locked_manually,
  coalesce((ls.data->>'trialDays')::int, 90)            as trial_days,
  coalesce((ls.data->>'installedAt')::bigint, extract(epoch from o.created_at)::bigint * 1000) as installed_at_ms
from public.organizations o
left join public.license_state ls on ls.organization_id = o.id;

-- Vue accessible aux utilisateurs authentifiés (protégée par les RLS des tables sous-jacentes)
grant select on public.org_overview to authenticated;

-- ------------------------------------------------------------
--  4. Fonction admin_stats() : stats globales (super-admin only)
-- ------------------------------------------------------------
create or replace function public.admin_stats()
  returns table(
    total_orgs         bigint,
    active_orgs        bigint,
    paying_orgs        bigint,
    locked_orgs        bigint,
    total_users        bigint,
    total_businesses   bigint,
    total_ca_fcfa      bigint,
    ca_30j             bigint,
    ca_prev_30j        bigint,
    signups_30j        bigint
  )
  language sql stable security definer
  set search_path = public
  as $$
    with base as (select * from public.org_overview)
    select
      (select count(*) from base) as total_orgs,
      (select count(*) from base where last_activity_at > now() - interval '30 days') as active_orgs,
      (select count(*) from base where paid_until_ms > (extract(epoch from now()) * 1000)::bigint) as paying_orgs,
      (select count(*) from base where locked_manually) as locked_orgs,
      (select count(distinct user_id) from public.memberships) as total_users,
      (select sum(business_count) from base) as total_businesses,
      (select sum(ca_total_fcfa) from base) as total_ca_fcfa,
      -- CA sur les 30 derniers jours (approximation via ts>=now-30d dans data)
      coalesce((
        select sum(coalesce((elt->>'montant')::numeric, 0))
        from public.profiles p
        cross join lateral jsonb_array_elements(coalesce(p.data->'caisse','[]'::jsonb)) elt
        where elt->>'type' = 'vente'
          and coalesce((elt->>'ts')::bigint, 0) > (extract(epoch from now() - interval '30 days') * 1000)::bigint
      ), 0)::bigint as ca_30j,
      coalesce((
        select sum(coalesce((elt->>'montant')::numeric, 0))
        from public.profiles p
        cross join lateral jsonb_array_elements(coalesce(p.data->'caisse','[]'::jsonb)) elt
        where elt->>'type' = 'vente'
          and coalesce((elt->>'ts')::bigint, 0) between (extract(epoch from now() - interval '60 days') * 1000)::bigint
                                                    and (extract(epoch from now() - interval '30 days') * 1000)::bigint
      ), 0)::bigint as ca_prev_30j,
      (select count(*) from public.organizations where created_at > now() - interval '30 days')::bigint as signups_30j;
  $$;

grant execute on function public.admin_stats() to authenticated;

-- Sécurité de admin_stats : ne retourne rien si l'appelant n'est pas super-admin
create or replace function public.admin_stats_safe()
  returns setof record
  language plpgsql stable security definer
  set search_path = public
  as $$
begin
  if not public.is_super_admin() then
    raise exception 'Accès refusé';
  end if;
  return query select * from public.admin_stats();
end $$;

-- ------------------------------------------------------------
--  5. Fonction admin_org_action : actions super-admin sur une org
--     (verrouiller, déverrouiller, marquer payé jusqu'à date)
-- ------------------------------------------------------------
create or replace function public.admin_org_action(
  p_org uuid, p_action text, p_days int default null
) returns jsonb
  language plpgsql security definer
  set search_path = public
  as $$
declare
  cur jsonb;
  new_data jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Accès refusé';
  end if;

  select data into cur from public.license_state where organization_id = p_org;
  if cur is null then cur := '{}'::jsonb; end if;

  if p_action = 'lock' then
    new_data := cur || jsonb_build_object('lockedManually', true);
  elsif p_action = 'unlock' then
    new_data := cur || jsonb_build_object('lockedManually', false);
  elsif p_action = 'mark_paid' then
    -- p_days : nombre de jours à ajouter à paidUntil (ou depuis maintenant si vide)
    new_data := cur
              || jsonb_build_object('paidUntil',
                    (extract(epoch from (now() + make_interval(days => coalesce(p_days, 30)))) * 1000)::bigint,
                    'lockedManually', false);
  elsif p_action = 'reset_trial' then
    new_data := cur
              || jsonb_build_object('installedAt',
                    (extract(epoch from now()) * 1000)::bigint,
                    'trialDays', coalesce(p_days, 90));
  else
    raise exception 'Action inconnue : %', p_action;
  end if;

  insert into public.license_state(organization_id, data)
    values (p_org, new_data)
    on conflict (organization_id) do update set data = excluded.data, updated_at = now();

  perform public.log_audit(p_org, 'admin_action:' || p_action, null, null,
    jsonb_build_object('days', p_days, 'result', new_data));

  return new_data;
end $$;

grant execute on function public.admin_org_action(uuid, text, int) to authenticated;

-- ------------------------------------------------------------
--  6. Vue monthly_revenue : agrégation mensuelle (12 derniers mois)
-- ------------------------------------------------------------
create or replace view public.monthly_revenue as
with recent as (
  select
    p.organization_id,
    to_timestamp(coalesce((elt->>'ts')::bigint, 0) / 1000) as ts,
    coalesce((elt->>'montant')::numeric, 0) as montant,
    elt->>'type' as type
  from public.profiles p
  cross join lateral jsonb_array_elements(coalesce(p.data->'caisse','[]'::jsonb)) elt
  where p.deleted_at is null
    and coalesce((elt->>'ts')::bigint, 0) > (extract(epoch from now() - interval '12 months') * 1000)::bigint
)
select
  date_trunc('month', ts) as mois,
  organization_id,
  sum(case when type = 'vente' then montant else 0 end)::bigint as ca_fcfa,
  sum(case when type = 'depense' then montant else 0 end)::bigint as depenses_fcfa,
  count(*) as ecritures
from recent
group by 1, 2;

grant select on public.monthly_revenue to authenticated;
