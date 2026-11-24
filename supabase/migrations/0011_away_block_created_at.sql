-- When an away block was added (D74): a habit learned from weeks of history may override an away block that disagrees
-- only if the block is older than that history; a block added since is newer information (a new class this week).
-- Existing blocks get the migration time, so for the next 8 weeks they count as new and keep winning: conservative.
alter table public.away_blocks add column created_at timestamptz not null default now();
