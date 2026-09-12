-- =========================================================
-- CPA Lecturer — Supabase schema
-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query)
-- =========================================================

-- ---------------------------------------------------------
-- 1. PROFILES
-- Mirrors auth.users so we can join on a plain table and
-- store display info without touching the auth schema.
-- ---------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  review_batch text,          -- e.g. "CPALE October 2026" — optional context tag
  created_at timestamptz not null default now()
);

-- Auto-create a profile row whenever a new auth user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------
-- 2. LECTURES (video uploads)
-- ---------------------------------------------------------
create table if not exists public.lectures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'Untitled lecture',
  subject text,                       -- e.g. Taxation, Auditing, FAR
  storage_path text not null,         -- path inside the 'lecture-videos' bucket
  file_name text not null,
  file_size bigint,
  duration_seconds numeric,
  thumbnail_path text,
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lectures_user_id_idx on public.lectures (user_id);

-- ---------------------------------------------------------
-- 3. DOCUMENTS (PDF / text / markdown uploads)
-- ---------------------------------------------------------
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'Untitled document',
  subject text,
  storage_path text not null,         -- path inside the 'lecture-documents' bucket
  file_name text not null,
  file_type text not null,            -- 'pdf' | 'txt' | 'md'
  file_size bigint,
  page_count int,
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists documents_user_id_idx on public.documents (user_id);

-- ---------------------------------------------------------
-- 4. HIGHLIGHTS (text selections inside a document)
-- ---------------------------------------------------------
create table if not exists public.highlights (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  page_number int not null default 1,   -- 1 for plain-text/markdown documents
  color text not null default 'amber',  -- amber | mint | sky | brick
  selected_text text not null,
  anchor jsonb not null,                -- serialized position: rects for PDF, {start,end} for text
  note text,                            -- optional margin note attached to the highlight
  created_at timestamptz not null default now()
);

create index if not exists highlights_document_id_idx on public.highlights (document_id);
create index if not exists highlights_user_id_idx on public.highlights (user_id);

-- ---------------------------------------------------------
-- 5. NOTES (freeform reviewer notes)
-- ---------------------------------------------------------
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'Untitled note',
  subject text,
  content_delta jsonb not null default '{}'::jsonb,  -- Quill.js delta (rich text)
  content_html text,                                  -- rendered HTML snapshot for quick preview
  linked_lecture_id uuid references public.lectures (id) on delete set null,
  linked_document_id uuid references public.documents (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notes_user_id_idx on public.notes (user_id);

-- ---------------------------------------------------------
-- 6. updated_at auto-touch trigger (shared)
-- ---------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_lectures on public.lectures;
create trigger touch_lectures before update on public.lectures
  for each row execute procedure public.touch_updated_at();

drop trigger if exists touch_documents on public.documents;
create trigger touch_documents before update on public.documents
  for each row execute procedure public.touch_updated_at();

drop trigger if exists touch_notes on public.notes;
create trigger touch_notes before update on public.notes
  for each row execute procedure public.touch_updated_at();

-- =========================================================
-- ROW LEVEL SECURITY
-- Every table is private to its owner (user_id = auth.uid()).
-- =========================================================
alter table public.profiles   enable row level security;
alter table public.lectures   enable row level security;
alter table public.documents  enable row level security;
alter table public.highlights enable row level security;
alter table public.notes      enable row level security;

-- Profiles: a user can read/update only their own row
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- Lectures
create policy "lectures_select_own" on public.lectures
  for select using (auth.uid() = user_id);
create policy "lectures_insert_own" on public.lectures
  for insert with check (auth.uid() = user_id);
create policy "lectures_update_own" on public.lectures
  for update using (auth.uid() = user_id);
create policy "lectures_delete_own" on public.lectures
  for delete using (auth.uid() = user_id);

-- Documents
create policy "documents_select_own" on public.documents
  for select using (auth.uid() = user_id);
create policy "documents_insert_own" on public.documents
  for insert with check (auth.uid() = user_id);
create policy "documents_update_own" on public.documents
  for update using (auth.uid() = user_id);
create policy "documents_delete_own" on public.documents
  for delete using (auth.uid() = user_id);

-- Highlights
create policy "highlights_select_own" on public.highlights
  for select using (auth.uid() = user_id);
create policy "highlights_insert_own" on public.highlights
  for insert with check (auth.uid() = user_id);
create policy "highlights_update_own" on public.highlights
  for update using (auth.uid() = user_id);
create policy "highlights_delete_own" on public.highlights
  for delete using (auth.uid() = user_id);

-- Notes
create policy "notes_select_own" on public.notes
  for select using (auth.uid() = user_id);
create policy "notes_insert_own" on public.notes
  for insert with check (auth.uid() = user_id);
create policy "notes_update_own" on public.notes
  for update using (auth.uid() = user_id);
create policy "notes_delete_own" on public.notes
  for delete using (auth.uid() = user_id);

-- =========================================================
-- STORAGE BUCKETS
-- Creates two private buckets. Files are stored under a
-- per-user folder: {user_id}/{filename}, which the policies
-- below enforce.
-- =========================================================
insert into storage.buckets (id, name, public)
values ('lecture-videos', 'lecture-videos', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('lecture-documents', 'lecture-documents', false)
on conflict (id) do nothing;

-- Storage policies: a user may only read/write inside a folder
-- named after their own uid, e.g. lecture-videos/<uid>/file.mp4
create policy "videos_read_own_folder" on storage.objects
  for select using (
    bucket_id = 'lecture-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "videos_write_own_folder" on storage.objects
  for insert with check (
    bucket_id = 'lecture-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "videos_update_own_folder" on storage.objects
  for update using (
    bucket_id = 'lecture-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "videos_delete_own_folder" on storage.objects
  for delete using (
    bucket_id = 'lecture-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "docs_read_own_folder" on storage.objects
  for select using (
    bucket_id = 'lecture-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "docs_write_own_folder" on storage.objects
  for insert with check (
    bucket_id = 'lecture-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "docs_update_own_folder" on storage.objects
  for update using (
    bucket_id = 'lecture-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "docs_delete_own_folder" on storage.objects
  for delete using (
    bucket_id = 'lecture-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- =========================================================
-- Done. Next steps:
-- 1. Project Settings → API → copy the Project URL and anon key
--    into js/config.js
-- 2. Authentication → Providers → make sure Email is enabled
-- 3. (Optional) Authentication → URL Configuration → add your
--    Vercel domain to the Redirect URLs list
-- =========================================================
