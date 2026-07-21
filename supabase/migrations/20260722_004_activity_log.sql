-- Migration 004 : Activity log (traçage consultations + actions clés)
-- Objectif : super-admin peut voir l'engagement de chaque utilisateur
-- (dernière connexion, pages consultées, actions clés).
-- Les données sont écrites côté client via SyncQueue → drainées en arrière-plan.

CREATE TABLE IF NOT EXISTS public.activity_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_type      text NOT NULL,           -- 'view', 'action', 'login', 'error'
  event_name      text NOT NULL,           -- 'dashboard', 'add_product', etc.
  meta            jsonb DEFAULT '{}'::jsonb, -- {device, plan, count, ...}
  session_id      text,                    -- id de session client (rotate à chaque login)
  device_kind     text,                    -- 'iphone', 'android', 'desktop'
  ts              timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_log_user_ts_idx    ON public.activity_log(user_id, ts DESC);
CREATE INDEX IF NOT EXISTS activity_log_org_ts_idx     ON public.activity_log(organization_id, ts DESC);
CREATE INDEX IF NOT EXISTS activity_log_event_ts_idx   ON public.activity_log(event_type, event_name, ts DESC);
CREATE INDEX IF NOT EXISTS activity_log_session_idx    ON public.activity_log(session_id);

-- RLS
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

-- Chaque user peut insérer ses propres logs
DROP POLICY IF EXISTS activity_insert_own ON public.activity_log;
CREATE POLICY activity_insert_own ON public.activity_log
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Chaque user peut lire ses propres logs
DROP POLICY IF EXISTS activity_read_own ON public.activity_log;
CREATE POLICY activity_read_own ON public.activity_log
  FOR SELECT USING (user_id = auth.uid());

-- Super-admin peut TOUT lire (utilise la fonction is_super_admin de la migration 002)
DROP POLICY IF EXISTS activity_read_admin ON public.activity_log;
CREATE POLICY activity_read_admin ON public.activity_log
  FOR SELECT USING (public.is_super_admin());

-- Aucune modification/suppression permise côté user (audit tamper-proof)
-- Le super-admin peut purger via une fonction dédiée si besoin.

-- Vue agrégée pour le dashboard super-admin : sessions par jour + engagement
CREATE OR REPLACE VIEW public.activity_daily AS
SELECT
  user_id,
  organization_id,
  date_trunc('day', ts)::date AS day,
  COUNT(DISTINCT session_id) AS sessions,
  COUNT(*) FILTER (WHERE event_type = 'view') AS views,
  COUNT(*) FILTER (WHERE event_type = 'action') AS actions,
  COUNT(*) FILTER (WHERE event_type = 'error') AS errors,
  MAX(ts) AS last_seen_at,
  MIN(ts) AS first_seen_at
FROM public.activity_log
GROUP BY user_id, organization_id, day;

ALTER VIEW public.activity_daily SET (security_invoker = on);

-- Fonction pour super-admin : liste des utilisateurs actifs récents
CREATE OR REPLACE FUNCTION public.recent_active_users(days_back int DEFAULT 7)
RETURNS TABLE (
  user_id uuid,
  email text,
  last_seen_at timestamptz,
  total_sessions bigint,
  total_actions bigint,
  organization_id uuid,
  org_name text
) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    a.user_id,
    u.email,
    MAX(a.ts) AS last_seen_at,
    COUNT(DISTINCT a.session_id) AS total_sessions,
    COUNT(*) FILTER (WHERE a.event_type = 'action') AS total_actions,
    a.organization_id,
    o.nom AS org_name
  FROM public.activity_log a
  LEFT JOIN auth.users u ON u.id = a.user_id
  LEFT JOIN public.organizations o ON o.id = a.organization_id
  WHERE a.ts >= now() - (days_back || ' days')::interval
    AND public.is_super_admin()
  GROUP BY a.user_id, u.email, a.organization_id, o.nom
  ORDER BY last_seen_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.recent_active_users(int) TO authenticated;

-- Purge automatique après 90 jours (opt-in via cron pg si activé)
-- Décommenter et ajuster avec le schedule Supabase Cron si besoin :
-- SELECT cron.schedule('purge-activity-log', '0 3 * * *',
--   $$DELETE FROM public.activity_log WHERE ts < now() - interval '90 days'$$);
