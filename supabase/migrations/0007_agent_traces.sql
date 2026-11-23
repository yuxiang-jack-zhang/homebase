-- Traces of the ask pipeline (D62): one run per ask that reached the model, one row per model call.
-- Token counts, latency and outcomes only: no question text, prompts or model output.
-- Service-role only; no client grants or policies, so signed-in users can't read them.

create table agent_runs (
  id uuid primary key default gen_random_uuid(),
  question_id uuid references questions on delete cascade, -- null when the run failed before the question was written
  ok boolean not null,
  latency_ms integer not null check (latency_ms >= 0),
  core_version text not null,
  created_at timestamptz not null default now()
);
create index agent_runs_created_at on agent_runs (created_at);

create table agent_calls (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references agent_runs on delete cascade,
  target_user_id uuid references profiles on delete set null, -- null for the shared parse step
  step text not null check (step in ('parse', 'answer', 'draft', 'other')),
  model text not null,
  ok boolean not null, -- the call produced usable output
  stop_reason text,
  error text,          -- error type when the call threw (e.g. overloaded_error)
  input_tokens integer not null check (input_tokens >= 0),
  output_tokens integer not null check (output_tokens >= 0),
  latency_ms integer not null check (latency_ms >= 0),
  created_at timestamptz not null default now()
);
create index agent_calls_run_id on agent_calls (run_id);

alter table agent_runs enable row level security;
alter table agent_calls enable row level security;

grant select, insert, delete on agent_runs, agent_calls to service_role;
