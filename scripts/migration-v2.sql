-- Consumer Truth v2 Migration
-- Run this in the Supabase SQL Editor
-- All operations are additive (IF NOT EXISTS) - safe to re-run

-- 1. Feedback table
create table if not exists feedback (
  id uuid primary key default uuid_generate_v4(),
  scan_id uuid references scans(id),
  rating text not null check (rating in ('up', 'down')),
  comment text,
  created_at timestamptz default now()
);
create index if not exists idx_feedback_scan_id on feedback(scan_id);

-- 2. Share tracking (additive column on scans)
alter table scans add column if not exists share_count integer default 0;

-- 3. Conversations table (for follow-up Q&A history)
create table if not exists conversations (
  id uuid primary key default uuid_generate_v4(),
  scan_id uuid references scans(id),
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz default now()
);
create index if not exists idx_conversations_scan_id on conversations(scan_id);

-- 4. Performance indexes for trending queries
create index if not exists idx_products_scanned_count on products(scanned_count desc);
create index if not exists idx_ingredients_analyzed_count on ingredients(analyzed_count desc);

-- 5. RPC for atomic share count increment
create or replace function increment_share_count(scan_uuid uuid)
returns void as $$
begin
  update scans set share_count = coalesce(share_count, 0) + 1 where id = scan_uuid;
end;
$$ language plpgsql;
