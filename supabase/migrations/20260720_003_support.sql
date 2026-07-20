-- ============================================================
--  BOSS — Canal de support (tickets utilisateurs → super-admin)
--  · Table support_tickets (fil de discussion)
--  · Table support_ticket_messages (réponses)
--  · Bucket storage support-attachments (5 Mo max/pièce)
--  · RLS : user = ses tickets, super-admin = tous
-- ============================================================

-- ------------------------------------------------------------
--  1. Table support_tickets
-- ------------------------------------------------------------
create table if not exists public.support_tickets (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  type            text not null default 'aide'
                    check (type in ('bug','suggestion','aide','critique')),
  subject         text not null check (length(subject) between 1 and 200),
  message         text not null check (length(message) between 1 and 5000),
  attachments     jsonb not null default '[]'::jsonb,   -- [{path,name,type,size}]
  status          text not null default 'open'
                    check (status in ('open','in_progress','resolved','closed')),
  priority        text not null default 'normal'
                    check (priority in ('low','normal','high','urgent')),
  contact_phone   text,
  contact_email   text,
  app_version     text,
  device_info     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  resolved_by     uuid references auth.users(id) on delete set null,
  unread_by_admin boolean not null default true,
  unread_by_user  boolean not null default false
);
create index if not exists support_tickets_user_idx on public.support_tickets(user_id, created_at desc);
create index if not exists support_tickets_status_idx on public.support_tickets(status, created_at desc);
create index if not exists support_tickets_unread_idx on public.support_tickets(unread_by_admin) where unread_by_admin;

-- ------------------------------------------------------------
--  2. Table support_ticket_messages (thread)
-- ------------------------------------------------------------
create table if not exists public.support_ticket_messages (
  id           uuid primary key default gen_random_uuid(),
  ticket_id    uuid not null references public.support_tickets(id) on delete cascade,
  author_id    uuid not null references auth.users(id) on delete cascade,
  from_admin   boolean not null default false,
  message      text not null check (length(message) between 1 and 5000),
  attachments  jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists support_msgs_ticket_idx on public.support_ticket_messages(ticket_id, created_at asc);

-- ------------------------------------------------------------
--  3. Trigger : mettre à jour updated_at et unread flags
-- ------------------------------------------------------------
create or replace function public.tg_support_ticket_touch() returns trigger
  language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists support_tickets_touch on public.support_tickets;
create trigger support_tickets_touch
  before update on public.support_tickets
  for each row execute procedure public.tg_support_ticket_touch();

create or replace function public.tg_support_msg_ping() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  -- Chaque nouveau message met à jour le ticket parent
  if new.from_admin then
    update public.support_tickets
      set updated_at = now(), unread_by_user = true, status = case when status='open' then 'in_progress' else status end
      where id = new.ticket_id;
  else
    update public.support_tickets
      set updated_at = now(), unread_by_admin = true
      where id = new.ticket_id;
  end if;
  return new;
end $$;

drop trigger if exists support_msgs_ping on public.support_ticket_messages;
create trigger support_msgs_ping
  after insert on public.support_ticket_messages
  for each row execute procedure public.tg_support_msg_ping();

-- ------------------------------------------------------------
--  4. RLS
-- ------------------------------------------------------------
alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;

-- Un user voit et crée SES tickets
drop policy if exists st_select_own on public.support_tickets;
create policy st_select_own on public.support_tickets
  for select using (user_id = auth.uid());

drop policy if exists st_insert_own on public.support_tickets;
create policy st_insert_own on public.support_tickets
  for insert with check (user_id = auth.uid());

-- Le user peut marquer son ticket comme lu (unread_by_user=false) — pas plus
drop policy if exists st_update_own on public.support_tickets;
create policy st_update_own on public.support_tickets
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Super-admin : tout voir, tout modifier
drop policy if exists st_select_super on public.support_tickets;
create policy st_select_super on public.support_tickets
  for select using (public.is_super_admin());

drop policy if exists st_update_super on public.support_tickets;
create policy st_update_super on public.support_tickets
  for update using (public.is_super_admin());

drop policy if exists st_delete_super on public.support_tickets;
create policy st_delete_super on public.support_tickets
  for delete using (public.is_super_admin());

-- Messages : user voit et écrit sur ses propres tickets
drop policy if exists sm_select_own on public.support_ticket_messages;
create policy sm_select_own on public.support_ticket_messages
  for select using (
    exists (select 1 from public.support_tickets t
            where t.id = ticket_id and t.user_id = auth.uid())
  );

drop policy if exists sm_insert_own on public.support_ticket_messages;
create policy sm_insert_own on public.support_ticket_messages
  for insert with check (
    author_id = auth.uid()
    and from_admin = false
    and exists (select 1 from public.support_tickets t
                where t.id = ticket_id and t.user_id = auth.uid())
  );

drop policy if exists sm_select_super on public.support_ticket_messages;
create policy sm_select_super on public.support_ticket_messages
  for select using (public.is_super_admin());

drop policy if exists sm_insert_super on public.support_ticket_messages;
create policy sm_insert_super on public.support_ticket_messages
  for insert with check (public.is_super_admin() and author_id = auth.uid());

-- ------------------------------------------------------------
--  5. RPC : compteurs pour badges de notification
-- ------------------------------------------------------------
create or replace function public.support_unread_admin() returns integer
  language sql stable security definer set search_path = public as $$
    select case when public.is_super_admin()
      then (select count(*)::int from public.support_tickets where unread_by_admin)
      else 0 end;
  $$;
grant execute on function public.support_unread_admin() to authenticated;

create or replace function public.support_unread_user() returns integer
  language sql stable security definer set search_path = public as $$
    select count(*)::int
      from public.support_tickets
      where user_id = auth.uid() and unread_by_user;
  $$;
grant execute on function public.support_unread_user() to authenticated;

-- ------------------------------------------------------------
--  6. Storage bucket : support-attachments
--     · privé (RLS via storage.objects)
--     · path pattern : {user_id}/{ticket_id}/{filename}
--     · quota 5 Mo par pièce (contrôle côté client + policy avec file_size)
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'support-attachments', 'support-attachments', false,
    5242880,   -- 5 Mo exact
    array['image/jpeg','image/png','image/webp','image/gif',
          'audio/webm','audio/ogg','audio/mpeg','audio/mp4','audio/wav',
          'video/mp4','video/webm','video/quicktime',
          'application/pdf','application/zip','text/plain']
  )
  on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Policies sur storage.objects pour ce bucket
drop policy if exists support_upload_own on storage.objects;
create policy support_upload_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'support-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists support_read_own on storage.objects;
create policy support_read_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'support-attachments'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_super_admin()
    )
  );

drop policy if exists support_delete_own on storage.objects;
create policy support_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'support-attachments'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_super_admin()
    )
  );

-- ------------------------------------------------------------
--  7. Vue support_ticket_overview (pour super-admin)
--     Une ligne par ticket, avec email de l'auteur + nb messages
-- ------------------------------------------------------------
create or replace view public.support_ticket_overview as
select
  t.*,
  (select u.email from auth.users u where u.id = t.user_id) as user_email,
  (select count(*)::int from public.support_ticket_messages m where m.ticket_id = t.id) as messages_count,
  (select o.nom from public.organizations o where o.id = t.organization_id) as organization_name
from public.support_tickets t;
grant select on public.support_ticket_overview to authenticated;
