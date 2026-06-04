-- Social features migration
-- Run in Supabase SQL editor on top of the existing schema

-- ─── Profile extensions ───────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS username     text UNIQUE,
  ADD COLUMN IF NOT EXISTS bio          text,
  ADD COLUMN IF NOT EXISTS is_public    boolean NOT NULL DEFAULT false;

-- Username format: 3-20 chars, lowercase letters, digits, underscores.
-- Stored normalised; UI lowercases before saving.
DO $$ BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_username_format
    CHECK (username IS NULL OR username ~ '^[a-z0-9_]{3,20}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Bio length cap
DO $$ BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_bio_length
    CHECK (bio IS NULL OR length(bio) <= 160);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Back-fill display_name from auth metadata for existing users
UPDATE public.profiles p
SET display_name = (
  SELECT raw_user_meta_data->>'display_name'
  FROM auth.users u
  WHERE u.id = p.id
)
WHERE display_name IS NULL;

-- Update the new-user trigger to also capture display_name
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (
    new.id,
    new.email,
    new.raw_user_meta_data->>'display_name'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

-- ─── Updated profiles RLS (allow reading public profiles) ────────────────────

DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT USING (
    auth.uid() = id
    OR public.is_admin()
    OR is_public = true
  );

-- Allow users to update their own full profile row (username, bio, is_public, display_name)
DROP POLICY IF EXISTS "profiles_self_update" ON public.profiles;
CREATE POLICY "profiles_self_update" ON public.profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- ─── Updated records RLS (allow reading records of public profiles) ───────────

DROP POLICY IF EXISTS "records_select" ON public.records;
CREATE POLICY "records_select" ON public.records
  FOR SELECT USING (
    auth.uid() = user_id
    OR public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = records.user_id AND is_public = true
    )
  );

-- ─── Follows ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.follows (
  follower_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  following_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)
);

ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "follows_select" ON public.follows FOR SELECT USING (true);
CREATE POLICY "follows_insert" ON public.follows FOR INSERT WITH CHECK (auth.uid() = follower_id);
CREATE POLICY "follows_delete" ON public.follows FOR DELETE USING (auth.uid() = follower_id);

-- ─── Record reactions ─────────────────────────────────────────────────────────
-- owner_user_id + record_local_id identifies a specific record in someone's collection.
-- record_local_id is the UUID stored in the record's data.id field.

CREATE TABLE IF NOT EXISTS public.record_reactions (
  id              uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_user_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  record_local_id text NOT NULL,
  reactor_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  emoji           text NOT NULL CHECK (length(emoji) <= 10),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, record_local_id, reactor_user_id, emoji)
);

ALTER TABLE public.record_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reactions_select" ON public.record_reactions FOR SELECT USING (true);
CREATE POLICY "reactions_insert" ON public.record_reactions FOR INSERT WITH CHECK (auth.uid() = reactor_user_id);
CREATE POLICY "reactions_delete" ON public.record_reactions FOR DELETE USING (auth.uid() = reactor_user_id);

-- ─── Record comments ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.record_comments (
  id              uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_user_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  record_local_id text NOT NULL,
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body            text NOT NULL CHECK (length(body) BETWEEN 1 AND 300),
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.record_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comments_select" ON public.record_comments FOR SELECT USING (true);
CREATE POLICY "comments_insert" ON public.record_comments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "comments_delete" ON public.record_comments FOR DELETE USING (auth.uid() = user_id);

-- ─── Helper: set own profile fields (bypasses UPDATE RLS edge cases) ──────────

CREATE OR REPLACE FUNCTION public.update_own_profile(
  p_display_name text DEFAULT NULL,
  p_username     text DEFAULT NULL,
  p_bio          text DEFAULT NULL,
  p_is_public    boolean DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.profiles
  SET
    display_name = COALESCE(p_display_name, display_name),
    username     = COALESCE(p_username,     username),
    bio          = COALESCE(p_bio,          bio),
    is_public    = COALESCE(p_is_public,    is_public)
  WHERE id = auth.uid();
END;
$$;

-- ─── Feed helper RPC ──────────────────────────────────────────────────────────
-- Returns recent records from users the current user follows.

CREATE OR REPLACE FUNCTION public.get_social_feed(p_limit int DEFAULT 40)
RETURNS TABLE(
  record_db_id  uuid,
  record_data   jsonb,
  added_at      timestamptz,
  owner_id      uuid,
  owner_name    text,
  owner_username text,
  owner_avatar  text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    r.id,
    r.data,
    r.created_at,
    p.id,
    p.display_name,
    p.username,
    p.avatar_url
  FROM public.records r
  JOIN public.follows f  ON r.user_id = f.following_id
  JOIN public.profiles p ON r.user_id = p.id
  WHERE f.follower_id = auth.uid()
    AND p.is_public = true
  ORDER BY r.created_at DESC
  LIMIT p_limit;
$$;
