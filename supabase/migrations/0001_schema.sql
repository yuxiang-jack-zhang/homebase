-- Homebase schema. RLS is enabled on every table; policies and RPC bodies arrive in 0002.

create type answer_mode as enum ('ask_me', 'auto_when_confident', 'always_auto');
create type member_role as enum ('owner', 'member');
create type presence_kind as enum ('enter', 'exit');
create type question_kind as enum ('now', 'at_time', 'until_when', 'unclear');
-- The 10-minute timeout is computed by the app from created_at; it has no status.
create type target_status as enum ('answered', 'awaiting_reply', 'replied', 'unknown');
create type response_source as enum ('agent', 'human');
create type response_visibility as enum ('draft', 'sent');
create type feedback_kind as enum ('approved', 'edited', 'rejected');
create type confidence_level as enum ('high', 'medium', 'low');
create type outcome_kind as enum ('correct', 'incorrect', 'unscored');

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  created_at timestamptz not null default now()
);

create function handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data->>'display_name');
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

create table households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text unique not null,
  home_lat float8 not null,
  home_lng float8 not null,
  home_radius_m int not null default 100 check (home_radius_m between 50 and 500),
  timezone text not null,
  created_by uuid not null references profiles,
  created_at timestamptz not null default now()
);

create table household_members (
  household_id uuid not null references households on delete cascade,
  user_id uuid not null references profiles on delete cascade,
  role member_role not null default 'member',
  visibility bool not null default true,
  answer_mode answer_mode not null default 'ask_me',
  home_confirmed_at timestamptz,
  joined_at timestamptz default now(),
  primary key (household_id, user_id)
);

create table presence_events (
  id bigint generated always as identity primary key,
  household_id uuid not null,
  user_id uuid not null,
  kind presence_kind not null,
  at timestamptz not null default now(),
  foreign key (household_id, user_id) references household_members on delete cascade,
  check (at <= now() + interval '1 minute')
);
create index presence_events_user_at on presence_events (user_id, at desc);

-- 0 = Sunday; end_local < start_local means the block crosses midnight.
create table away_blocks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  user_id uuid not null,
  days_of_week smallint[] not null
    check (days_of_week <@ '{0,1,2,3,4,5,6}'::smallint[] and cardinality(days_of_week) > 0),
  start_local time not null,
  end_local time not null check (end_local <> start_local),
  label text check (char_length(label) <= 40),
  foreign key (household_id, user_id) references household_members on delete cascade
);

create table questions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households,
  asker_id uuid not null references profiles,
  text text not null check (char_length(text) between 1 and 280),
  kind question_kind,
  about_time timestamptz,
  created_at timestamptz not null default now()
);

create table question_targets (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions on delete cascade,
  user_id uuid not null references profiles,
  status target_status not null,
  fallback_guess text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (question_id, user_id)
);

create table responses (
  id uuid primary key default gen_random_uuid(),
  question_target_id uuid not null references question_targets on delete cascade,
  source response_source not null,
  visibility response_visibility not null,
  text text not null,
  draft_claim jsonb,
  feedback feedback_kind,
  created_at timestamptz not null default now()
);

create table predictions (
  id uuid primary key default gen_random_uuid(),
  question_target_id uuid not null unique references question_targets on delete cascade,
  user_id uuid not null references profiles,
  kind question_kind not null check (kind in ('at_time', 'until_when')),
  about_time timestamptz,
  predicted_state text check (predicted_state in ('home', 'away')),
  predicted_time timestamptz,
  confidence confidence_level not null,
  source text not null check (source in ('agent_auto', 'agent_approved')),
  outcome outcome_kind,
  scored_at timestamptz,
  created_at timestamptz not null default now()
);

create view current_presence with (security_invoker = true) as
select distinct on (household_id, user_id) household_id, user_id, kind, at
from presence_events
order by household_id, user_id, at desc;

alter table profiles enable row level security;
alter table households enable row level security;
alter table household_members enable row level security;
alter table presence_events enable row level security;
alter table away_blocks enable row level security;
alter table questions enable row level security;
alter table question_targets enable row level security;
alter table responses enable row level security;
alter table predictions enable row level security;

alter publication supabase_realtime add table question_targets, responses;
