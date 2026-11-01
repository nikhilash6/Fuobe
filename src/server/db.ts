import "server-only";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.FUOBE_DATA_DIR ?? path.join(process.cwd(), "data"));

/** Run in order, once each: a migration is known by its place in this list (append only, never reorder). */
export const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS generations (
    id TEXT PRIMARY KEY,
    batch_id TEXT,
    feature TEXT NOT NULL,
    preset_id TEXT,
    model_id TEXT NOT NULL,
    engine TEXT NOT NULL,
    provider TEXT NOT NULL,
    op TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    progress REAL,
    message TEXT,
    prompt TEXT,
    request_json TEXT NOT NULL,
    provider_input_json TEXT,
    external_id TEXT,
    external_meta_json TEXT,
    outputs_json TEXT NOT NULL DEFAULT '[]',
    error TEXT,
    cost_usd REAL,
    favorite INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS generations_created ON generations(created_at DESC);
  CREATE INDEX IF NOT EXISTS generations_status ON generations(status);
  CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT,
    rel_path TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    source TEXT NOT NULL,
    generation_id TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS assets_created ON assets(created_at DESC);
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS characters (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    reference_asset_ids_json TEXT NOT NULL DEFAULT '[]',
    trigger_word TEXT,
    lora_file TEXT,
    status TEXT NOT NULL DEFAULT 'ready',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );`,
  // Characters become Elements (characters, locations, props, styles) with @handles and trained LoRAs.
  `ALTER TABLE characters ADD COLUMN kind TEXT NOT NULL DEFAULT 'character';
  ALTER TABLE characters ADD COLUMN handle TEXT;
  ALTER TABLE characters ADD COLUMN loras_json TEXT;`,
  // Identity training jobs (Soul ID, fal LoRA trainers, AI-Toolkit).
  `CREATE TABLE IF NOT EXISTS trainings (
    id TEXT PRIMARY KEY,
    element_id TEXT NOT NULL,
    target TEXT NOT NULL,
    provider TEXT NOT NULL,
    status TEXT NOT NULL,
    progress REAL,
    message TEXT,
    external_id TEXT,
    meta_json TEXT,
    trigger_word TEXT,
    error TEXT,
    cost_usd REAL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS trainings_element ON trainings(element_id);`,
  // Chained jobs (storyboard frames wait for the previous frame).
  `ALTER TABLE generations ADD COLUMN depends_on TEXT;`,
  // Assist chats: the model's message history, the transcript shown in the UI and a pending approval.
  `CREATE TABLE IF NOT EXISTS assist_threads (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    agent TEXT NOT NULL,
    engine TEXT NOT NULL,
    auto_approve INTEGER NOT NULL DEFAULT 0,
    messages_json TEXT NOT NULL DEFAULT '[]',
    items_json TEXT NOT NULL DEFAULT '[]',
    pending_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS assist_threads_updated ON assist_threads(updated_at DESC);`,
  // When each generation reached its provider (and when the provider started it): timeouts run from here, not from creation.
  `CREATE TABLE IF NOT EXISTS generation_runs (
    id TEXT PRIMARY KEY,
    submitted_at INTEGER NOT NULL,
    started_at INTEGER
  );`,
  // Library: Trash (soft delete, purged after 30 days) and folders (one folder per generation).
  `CREATE TABLE IF NOT EXISTS generation_trash (
    generation_id TEXT PRIMARY KEY,
    deleted_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS generation_trash_deleted ON generation_trash(deleted_at);
  CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS folder_items (
    generation_id TEXT PRIMARY KEY,
    folder_id TEXT NOT NULL,
    added_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS folder_items_folder ON folder_items(folder_id);`,
  // Cinema Studio: projects (Director settings, brief, AI Director chat), folders = scenes, and the generations in them.
  `CREATE TABLE IF NOT EXISTS cinema_projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    cover_url TEXT,
    cost_cap_usd REAL,
    director_json TEXT NOT NULL DEFAULT '{}',
    palettes_json TEXT NOT NULL DEFAULT '[]',
    brief_title TEXT NOT NULL DEFAULT '',
    brief_body TEXT NOT NULL DEFAULT '',
    chat_json TEXT NOT NULL DEFAULT '[]',
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS cinema_folders (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    parent_id TEXT,
    name TEXT NOT NULL,
    color TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS cinema_folders_project ON cinema_folders(project_id);
  CREATE TABLE IF NOT EXISTS cinema_items (
    project_id TEXT NOT NULL,
    generation_id TEXT NOT NULL,
    folder_id TEXT,
    meta_json TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (project_id, generation_id)
  );
  CREATE INDEX IF NOT EXISTS cinema_items_generation ON cinema_items(generation_id);`,
  // Canvas boards: the node graph (edited by the user) and each generator node's last run (written by the server).
  `CREATE TABLE IF NOT EXISTS canvases (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    graph_json TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
    runs_json TEXT NOT NULL DEFAULT '{}',
    template_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    edited_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS canvases_updated ON canvases(updated_at DESC);`,
  // Layers projects: one source image, saved versions of its layer document, and the AI jobs its tools started.
  `CREATE TABLE IF NOT EXISTS layer_projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source_url TEXT NOT NULL,
    cover_url TEXT,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    head_version_id TEXT,
    jobs_json TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS layer_projects_updated ON layer_projects(updated_at DESC);
  CREATE TABLE IF NOT EXISTS layer_versions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    label TEXT NOT NULL,
    doc_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS layer_versions_project ON layer_versions(project_id, created_at DESC);`,
  // Shorts Studio: sessions (a clip cut into segments, each with its takes and the chosen one, plus the stitches) and custom presets.
  `CREATE TABLE IF NOT EXISTS shorts_sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    engine TEXT NOT NULL,
    batch_id TEXT NOT NULL,
    look_json TEXT NOT NULL,
    source_json TEXT NOT NULL,
    range_json TEXT NOT NULL,
    settings_json TEXT NOT NULL,
    segments_json TEXT NOT NULL DEFAULT '[]',
    stitches_json TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS shorts_sessions_updated ON shorts_sessions(updated_at DESC);
  CREATE TABLE IF NOT EXISTS shorts_presets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    references_json TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );`,
  // Marketing: brand kits (researched or manual), products (shared by every marketing flow), Ads Studio runs and their
  // creatives, and Marketing Studio / Click to Ad / Ad Multiplier runs (a batch of chained generations plus what made it).
  `CREATE TABLE IF NOT EXISTS brand_kits (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    website TEXT,
    status TEXT NOT NULL DEFAULT 'ready',
    progress_json TEXT,
    kit_json TEXT NOT NULL DEFAULT '{}',
    chat_json TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS brand_kits_updated ON brand_kits(updated_at DESC);
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    brand_id TEXT,
    name TEXT NOT NULL,
    description TEXT,
    price REAL,
    currency TEXT,
    audience TEXT,
    selling_points_json TEXT NOT NULL DEFAULT '[]',
    url TEXT,
    images_json TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS products_brand ON products(brand_id, created_at);
  CREATE TABLE IF NOT EXISTS ad_batches (
    id TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL,
    engine TEXT NOT NULL,
    route TEXT NOT NULL,
    model_id TEXT NOT NULL,
    direction TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ad_batches_brand ON ad_batches(brand_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS ad_creatives (
    id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL,
    brand_id TEXT NOT NULL,
    product_id TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    angle TEXT,
    headline TEXT,
    body TEXT,
    cta TEXT,
    visual TEXT,
    generation_id TEXT,
    layout TEXT,
    meta_json TEXT,
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ad_creatives_brand ON ad_creatives(brand_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS ad_creatives_batch ON ad_creatives(batch_id);
  CREATE INDEX IF NOT EXISTS ad_creatives_generation ON ad_creatives(generation_id);
  CREATE TABLE IF NOT EXISTS marketing_runs (
    id TEXT PRIMARY KEY,
    feature TEXT NOT NULL,
    batch_id TEXT NOT NULL,
    final_ids_json TEXT NOT NULL DEFAULT '[]',
    engine TEXT NOT NULL,
    title TEXT NOT NULL,
    meta_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS marketing_runs_feature ON marketing_runs(feature, created_at DESC);`,
  // Image studios: colour signatures (Soul HEX; the 50 Cinema Studio palettes are seeded on first use), moodboards
  // (reference sets with their cover job, Recraft style id and optional style LoRA element) and Instadump user packs.
  `CREATE TABLE IF NOT EXISTS palettes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    colors_json TEXT NOT NULL,
    background TEXT,
    slug TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    thumb_url TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS palettes_source ON palettes(source, created_at DESC);
  CREATE TABLE IF NOT EXISTS moodboards (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    images_json TEXT NOT NULL,
    collages_json TEXT NOT NULL DEFAULT '[]',
    engine TEXT NOT NULL,
    generation_id TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    cover_url TEXT,
    style_id TEXT,
    element_id TEXT,
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS moodboards_created ON moodboards(created_at DESC);
  CREATE TABLE IF NOT EXISTS photodump_packs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    refs_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );`,
  // Faceless Studio channels (genre, saved style / voice / aspect / subtitles, the avatar being drawn) and episodes (Faceless and Explainer: script, render plan).
  `CREATE TABLE IF NOT EXISTS faceless_channels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    idea TEXT NOT NULL,
    genre TEXT NOT NULL,
    avatar_url TEXT,
    avatar_job TEXT,
    reference_json TEXT,
    settings_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS faceless_channels_updated ON faceless_channels(updated_at DESC);
  CREATE TABLE IF NOT EXISTS faceless_episodes (
    id TEXT PRIMARY KEY,
    channel_id TEXT,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    topic TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    settings_json TEXT NOT NULL,
    script_json TEXT NOT NULL,
    plan_json TEXT,
    sources_json TEXT,
    favorite INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS faceless_episodes_channel ON faceless_episodes(channel_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS faceless_episodes_kind ON faceless_episodes(kind, created_at DESC);`,
  // Translate & dub sessions and Katana jobs (av-tools): what the person asked for and the generation ids of each step.
  `CREATE TABLE IF NOT EXISTS dub_sessions (
    id TEXT PRIMARY KEY,
    data_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS dub_sessions_updated ON dub_sessions(updated_at DESC);
  CREATE TABLE IF NOT EXISTS katana_jobs (
    id TEXT PRIMARY KEY,
    data_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS katana_jobs_updated ON katana_jobs(updated_at DESC);`,
  // Assist (assist-skills): user skills and built-in toggles, projects with their sources, typed
  // memories, and per-chat state (project, mode, loaded skills, the context the model was given).
  `CREATE TABLE IF NOT EXISTS skills (
    name TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    when_to_use TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    meta_json TEXT NOT NULL DEFAULT '{}',
    files_json TEXT NOT NULL DEFAULT '[]',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS skill_toggles (name TEXT PRIMARY KEY, enabled INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS assist_projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT 'iris',
    instructions TEXT NOT NULL DEFAULT '',
    skills_json TEXT NOT NULL DEFAULT '[]',
    use_personal_memory INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS assist_project_sources (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT,
    element_id TEXT,
    content TEXT,
    status TEXT NOT NULL DEFAULT 'ready',
    error TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS assist_project_sources_project ON assist_project_sources(project_id, created_at);
  CREATE TABLE IF NOT EXISTS assist_memory (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL DEFAULT 'personal',
    project_id TEXT,
    category TEXT NOT NULL,
    text TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'user',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS assist_memory_scope ON assist_memory(scope, project_id, updated_at DESC);
  CREATE TABLE IF NOT EXISTS assist_thread_state (
    thread_id TEXT PRIMARY KEY,
    project_id TEXT,
    mode TEXT,
    model TEXT,
    effort TEXT,
    skills_json TEXT NOT NULL DEFAULT '[]',
    context TEXT,
    sent_json TEXT
  );
  CREATE INDEX IF NOT EXISTS assist_thread_state_project ON assist_thread_state(project_id);`,
  // round 4 (r4/library-plus): nested library folders (a parent), pins on folders and results, and a review status on results.
  `ALTER TABLE folders ADD COLUMN parent_id TEXT;
  ALTER TABLE folders ADD COLUMN pinned_at INTEGER;
  CREATE INDEX IF NOT EXISTS folders_parent ON folders(parent_id);
  ALTER TABLE generations ADD COLUMN pinned_at INTEGER;
  ALTER TABLE generations ADD COLUMN review TEXT;
  CREATE INDEX IF NOT EXISTS generations_pinned ON generations(pinned_at) WHERE pinned_at IS NOT NULL;`,
  // originals (o/lora-plumbing): every LoRA copy Fuobe made — a download into ComfyUI's loras folder or a mirror on
  // fal / Replicate storage — with its pinned source, hash, size and the licence / civitai permissions it was made under.
  `CREATE TABLE IF NOT EXISTS lora_mirrors (
    file TEXT NOT NULL,
    target TEXT NOT NULL,
    source_url TEXT NOT NULL,
    version TEXT,
    hosted_url TEXT,
    sha256 TEXT,
    size_bytes INTEGER,
    licence_json TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (file, target)
  );`,
  // round 4 (r4/content-factory): Content Factory series — the reference clip, its style brief, the planned
  // episodes and the settings; the episodes themselves are Faceless episodes in the series' channel.
  `CREATE TABLE IF NOT EXISTS content_series (
    id TEXT PRIMARY KEY,
    channel_id TEXT,
    data_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS content_series_updated ON content_series(updated_at DESC);`,
  // round 4 (r4/share-links): read-only share links and published pages. `id` is the token's first 12 characters
  // (the lookup key); only the SHA-256 of the whole token is kept. A share names generations, folders or projects,
  // never files: its page shows what still exists.
  `CREATE TABLE IF NOT EXISTS shares (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL,
    kind TEXT NOT NULL,
    target_id TEXT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    tags_json TEXT NOT NULL DEFAULT '[]',
    layout TEXT NOT NULL DEFAULT 'grid',
    items_json TEXT NOT NULL DEFAULT '[]',
    cover_id TEXT,
    cover_index INTEGER NOT NULL DEFAULT 0,
    show_prompts INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER,
    views INTEGER NOT NULL DEFAULT 0,
    last_viewed_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS shares_target ON shares(kind, target_id);`,
  // round 4 (r4/assist-connectors): Assist's scheduled tasks (a prompt, its rule and time zone, ask-first or
  // auto-run within a cost cap, whether its runs may use connectors, and how the last run went), custom MCP
  // connectors (name, URL, token — a secret, masked before it reaches the browser — and the tools they're
  // limited to), and on each chat the task that started it, what that run has spent on its own, and whether
  // it uses connectors.
  `CREATE TABLE IF NOT EXISTS assist_schedules (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    prompt TEXT NOT NULL,
    attachments_json TEXT NOT NULL DEFAULT '[]',
    project_id TEXT,
    rule_json TEXT NOT NULL,
    tz TEXT NOT NULL,
    approval TEXT NOT NULL DEFAULT 'ask',
    cap_usd REAL,
    connectors INTEGER NOT NULL DEFAULT 0,
    engine TEXT NOT NULL DEFAULT 'cloud',
    mode_json TEXT,
    paused INTEGER NOT NULL DEFAULT 0,
    next_run_at INTEGER,
    last_run_at INTEGER,
    last_thread_id TEXT,
    last_status TEXT,
    last_text TEXT,
    runs INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS assist_schedules_due ON assist_schedules(paused, next_run_at);
  CREATE INDEX IF NOT EXISTS assist_schedules_project ON assist_schedules(project_id);
  CREATE TABLE IF NOT EXISTS assist_connectors (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    url TEXT NOT NULL,
    token TEXT,
    tools_json TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  ALTER TABLE assist_thread_state ADD COLUMN schedule_id TEXT;
  ALTER TABLE assist_thread_state ADD COLUMN cap_usd REAL;
  ALTER TABLE assist_thread_state ADD COLUMN spent_usd REAL NOT NULL DEFAULT 0;
  ALTER TABLE assist_thread_state ADD COLUMN connectors INTEGER NOT NULL DEFAULT 1;
  CREATE INDEX IF NOT EXISTS assist_thread_state_schedule ON assist_thread_state(schedule_id);`,
  // originals (o/h3-studio): Character Swap Studio projects — the character (picture and description), the clips with
  // their 24 fps copies, cuts and shots, transcripts and voices, masks and anchors, segments with their takes, review
  // decisions and assemblies, as one document (data_json; revision counts saves, so an open page knows it changed).
  // Every job is an ordinary generation the document names by id. `waiting`: takes queued behind the segments they
  // continue from, which the studio's sweep launches once those are made.
  `CREATE TABLE IF NOT EXISTS swap_projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    engine TEXT NOT NULL,
    data_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    waiting INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS swap_projects_updated ON swap_projects(updated_at DESC);
  CREATE INDEX IF NOT EXISTS swap_projects_waiting ON swap_projects(waiting) WHERE waiting > 0;`,
  // originals (o/no-higgsfield): Fuobe no longer calls Higgsfield's API (build plan O7). Its saved key is deleted (a
  // secret nothing reads any more), a "Higgsfield first" cloud provider becomes Automatic, and the ads its Ads Studio
  // drew whole are marked baked, which is all the Ads Studio needs to show them as they are. Jobs and trainings still
  // waiting on it fail on their next poll with a way forward (src/server/providers/index.ts, src/server/training.ts).
  `DELETE FROM settings WHERE key = 'higgsfield.key';
  UPDATE settings SET value = 'auto' WHERE key = 'cloud.provider' AND value = 'higgsfield';
  UPDATE ad_batches SET route = 'baked' WHERE route = 'higgsfield';
  UPDATE ad_creatives SET meta_json = json_set(meta_json, '$.route', 'baked')
    WHERE json_valid(meta_json) AND json_extract(meta_json, '$.route') = 'higgsfield';`,
  // GPU pre-flight (src/server/gpu): what a viewer's ComfyUI had at its last check, per target ('install', or
  // 'acct:<id>' for an account's own GPU) and per way it was read (a browser's facts never stand in for a server
  // check), only the facts the requirement index asks about; and an audit of every check. `fix_json` on a failed
  // run: what it was missing ({code, workflowId, items}), so its tile offers "Fix it".
  `CREATE TABLE IF NOT EXISTS gpu_snapshots (
    target_key TEXT NOT NULL,
    via TEXT NOT NULL,
    url_hash TEXT NOT NULL,
    checked_at INTEGER NOT NULL,
    index_hash TEXT NOT NULL,
    inventory_json TEXT NOT NULL,
    report_json TEXT,
    stale INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (target_key, via)
  );
  CREATE TABLE IF NOT EXISTS gpu_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    actor TEXT NOT NULL,
    target_key TEXT NOT NULL,
    host TEXT NOT NULL,
    action TEXT NOT NULL,
    item TEXT,
    job_id TEXT,
    result TEXT NOT NULL,
    detail TEXT
  );
  CREATE INDEX IF NOT EXISTS gpu_audit_target ON gpu_audit(target_key, at DESC);
  ALTER TABLE generations ADD COLUMN fix_json TEXT;`,
  // Public sign-up ("Your GPU"): who owns a stored file. An account's uploads and the files of its runs carry its id; the
  // owner's stay NULL. Files made before this go by the run that made them. Keep this entry last when rebasing: a
  // migration is known by its place in this list.
  `ALTER TABLE assets ADD COLUMN account_id TEXT;
  UPDATE assets SET account_id = (
    SELECT json_extract(g.request_json, '$.account') FROM generations g
    WHERE g.id = assets.generation_id AND json_valid(g.request_json)
  ) WHERE generation_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS assets_account ON assets(account_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS assets_rel ON assets(rel_path);
  CREATE INDEX IF NOT EXISTS assets_generation ON assets(generation_id);`,
];

/**
 * "Use the ComfyUI on this computer" (src/server/computer/tasks.ts). relay_runners: each principal's computer (the one
 * that runs its waiting jobs, until its lease lapses) and what its tab said about its ComfyUI. relay_tasks: one per
 * ComfyUI job of a run on someone's computer, with the graph as the server built it and where the job is. relay_inputs:
 * the files staged for a job, under the names ComfyUI gets. Safe to run on every start.
 */
export const RELAY_TABLES = `CREATE TABLE IF NOT EXISTS relay_runners (
    principal TEXT PRIMARY KEY,
    device TEXT NOT NULL,
    lease_until INTEGER NOT NULL,
    seen_at INTEGER NOT NULL,
    port INTEGER,
    facts_json TEXT,
    comfy TEXT NOT NULL DEFAULT 'ok'
  );
  CREATE TABLE IF NOT EXISTS relay_tasks (
    id TEXT PRIMARY KEY,
    principal TEXT NOT NULL,
    generation_id TEXT NOT NULL,
    state TEXT NOT NULL,
    device TEXT,
    lease_hash TEXT,
    graph_json TEXT,
    prompt_id TEXT NOT NULL,
    prefix TEXT,
    meta_batch INTEGER NOT NULL DEFAULT 0,
    preview INTEGER NOT NULL DEFAULT 0,
    workflow_id TEXT,
    extra_json TEXT,
    wanted_json TEXT,
    received_json TEXT,
    result_json TEXT,
    error TEXT,
    refusal_json TEXT,
    stop INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    down_at INTEGER,
    down_why TEXT,
    note TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    claimed_at INTEGER,
    sent_at INTEGER,
    started_at INTEGER,
    finished_at INTEGER,
    device_seen_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS relay_tasks_principal ON relay_tasks(principal, state, created_at);
  CREATE INDEX IF NOT EXISTS relay_tasks_generation ON relay_tasks(generation_id);
  CREATE TABLE IF NOT EXISTS relay_inputs (
    name TEXT PRIMARY KEY,
    principal TEXT NOT NULL,
    task_id TEXT,
    n INTEGER,
    content_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    reads INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS relay_inputs_task ON relay_inputs(task_id);
  CREATE TABLE IF NOT EXISTS relay_workers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'pool',
    principal TEXT,
    pool TEXT NOT NULL DEFAULT 'pool',
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    revoked_at INTEGER,
    last_used_at INTEGER,
    last_country TEXT,
    device TEXT,
    protocol INTEGER,
    version TEXT,
    facts_json TEXT,
    inventory_json TEXT,
    inventory_hash TEXT,
    lanes_json TEXT,
    bench_json TEXT,
    warm_lane TEXT,
    paused_server INTEGER NOT NULL DEFAULT 1,
    paused_local INTEGER NOT NULL DEFAULT 1,
    local_why TEXT,
    local_until INTEGER,
    drain INTEGER NOT NULL DEFAULT 0,
    stop_now INTEGER NOT NULL DEFAULT 0,
    hours_json TEXT,
    allow_json TEXT,
    claim_after_ms INTEGER NOT NULL DEFAULT 0,
    switch_after_ms INTEGER NOT NULL DEFAULT 1800000,
    state TEXT NOT NULL DEFAULT 'new',
    seen_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS relay_workers_principal ON relay_workers(principal);
  CREATE TABLE IF NOT EXISTS relay_pairings (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    secret_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    facts_json TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'waiting',
    principal TEXT,
    worker_id TEXT
  );`;

/**
 * The optional external services' tables (billing.ts, moderation.ts). billing_outbox: every settle, refund and release
 * the billing service must get, kept until it takes it (billing-outbox.ts). output_checks: each output of a run whose
 * outputs the moderation service sees first, and where its check is. reports_inbox: "Report this result" when no
 * moderation service is set, for the owner. Made here rather than as numbered migrations (other branches add those at
 * the same time). Safe to run on every start; empty and unread while no service is set.
 */
export const HOOK_TABLES = `CREATE TABLE IF NOT EXISTS billing_outbox (
    key TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    hold_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    tries INTEGER NOT NULL DEFAULT 0,
    next_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    done_at INTEGER,
    gave_up INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
  );
  CREATE INDEX IF NOT EXISTS billing_outbox_due ON billing_outbox(done_at, next_at);
  CREATE TABLE IF NOT EXISTS output_checks (
    asset_id TEXT PRIMARY KEY,
    generation_id TEXT NOT NULL,
    state TEXT NOT NULL,
    asked_at INTEGER NOT NULL,
    tries INTEGER NOT NULL DEFAULT 0,
    next_at INTEGER,
    decided_at INTEGER,
    text TEXT
  );
  CREATE INDEX IF NOT EXISTS output_checks_generation ON output_checks(generation_id);
  CREATE INDEX IF NOT EXISTS output_checks_due ON output_checks(state, next_at);
  CREATE TABLE IF NOT EXISTS reports_inbox (
    id TEXT PRIMARY KEY,
    target_json TEXT NOT NULL,
    category TEXT NOT NULL,
    text TEXT,
    reporter TEXT,
    created_at INTEGER NOT NULL,
    done_at INTEGER
  );`;

/** Columns the optional services added to existing tables: [table, column, type]. */
const HOOK_COLUMNS: [string, string, string][] = [
  // 1: never served to the account (its output check hasn't said "show").
  ["assets", "held", "INTEGER NOT NULL DEFAULT 0"],
  // NULL, or "checking" (the tile says "Checking").
  ["generations", "stage", "TEXT"],
];

/** Columns of the relay tables that came later: [table, column, type]. */
const RELAY_COLUMNS: [string, string, string][] = [
  ["relay_runners", "comfy", "TEXT NOT NULL DEFAULT 'ok'"],
  ["relay_tasks", "down_why", "TEXT"],
  // Workers (src/server/computer/workers.ts): all NULL for a browser computer's tasks, which work as before.
  ["relay_tasks", "account", "TEXT"],
  ["relay_tasks", "pools", "TEXT"],
  ["relay_tasks", "rank_at", "INTEGER"],
  ["relay_tasks", "lane", "TEXT"],
  ["relay_tasks", "needs_json", "TEXT"],
  ["relay_tasks", "est_ms", "INTEGER"],
  ["relay_tasks", "tried_json", "TEXT"],
  ["relay_tasks", "requeues", "INTEGER NOT NULL DEFAULT 0"],
  ["relay_tasks", "not_after", "INTEGER"],
  ["relay_tasks", "only_worker", "TEXT"],
  ["relay_tasks", "worker_id", "TEXT"],
];

declare global {
  var __fuobeDb: Database.Database | undefined;
}

/**
 * A data folder that ran PR #15's branch before the owner dropped the old accounts packages on 10-30
 * (`claude/fuobe-parity-4` up to f7c6d8e, `claude/fuobe-r5-batch-7` up to c9cd489) has places 23 and 24 marked done for
 * that branch's own migrations: acc-1's identity tables and acc-2's audit-log trigger. In this list those places are
 * the GPU pre-flight's tables and `assets.account_id`, so such a folder would skip both without a word. A place is
 * forgotten when this list's work is missing and the dropped package's is there, so the loop below runs it. The dropped
 * tables stay: nothing reads them, and nothing anyone made is deleted.
 */
function forgetDroppedBranchMigrations(db: Database.Database): void {
  const done = (id: number) => !!db.prepare("SELECT 1 FROM _migrations WHERE id = ?").get(id);
  const has = (type: "table" | "trigger", name: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?").get(type, name);
  const hasColumn = (table: string, column: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column);
  const forget = (id: number) => db.prepare("DELETE FROM _migrations WHERE id = ?").run(id);
  if (done(23) && !has("table", "gpu_snapshots") && hasColumn("users", "auth_user_id")) forget(23);
  if (done(24) && !hasColumn("assets", "account_id") && has("trigger", "audit_log_no_delete")) forget(24);
}

function open(): Database.Database {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(path.join(DATA_DIR, "fuobe.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY)`);
  forgetDroppedBranchMigrations(db);
  const done = new Set(
    (db.prepare("SELECT id FROM _migrations").all() as { id: number }[]).map((r) => r.id),
  );
  MIGRATIONS.forEach((sql, i) => {
    if (done.has(i)) return;
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations (id) VALUES (?)").run(i);
    })();
  });
  // Placeholder results are opt-in (settings.ts, demoMode): a saved "auto", which made a placeholder whenever the model
  // wasn't connected, is cleared, so the install runs with the default "off". A saved "on" stays. Safe on every start.
  db.exec("DELETE FROM settings WHERE key = 'demo.mode' AND value NOT IN ('on', 'off')");
  // Assist on hosted LLM providers (src/lib/catalog/llm-providers.ts): the provider of a chat's model ("openai",
  // "openrouter"…); chats from before read agent "claude" as Anthropic. Added when it's missing rather than as a
  // numbered migration, so branches that add migrations never clash over its place in the list.
  if (!(db.prepare("PRAGMA table_info(assist_thread_state)").all() as { name: string }[]).some((c) => c.name === "provider")) {
    db.exec("ALTER TABLE assist_thread_state ADD COLUMN provider TEXT");
  }
  // "Use the ComfyUI on this computer" (src/server/computer): its tables, made here rather than as a numbered migration,
  // since other branches add migrations at the same time and a migration is known by its place in the list.
  db.exec(RELAY_TABLES);
  // Columns added after the tables were first made (a data folder that ran an earlier build of this feature).
  for (const [table, column, type] of RELAY_COLUMNS) {
    const has = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column);
    if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
  // The optional billing and moderation services (billing.ts, moderation.ts): their tables and columns.
  db.exec(HOOK_TABLES);
  for (const [table, column, type] of HOOK_COLUMNS) {
    const has = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column);
    if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
  // A billing hold's rows are found through this index (only rows that have one are in it).
  try {
    db.exec("CREATE INDEX IF NOT EXISTS generations_hold ON generations(json_extract(request_json, '$.hold')) WHERE json_extract(request_json, '$.hold') IS NOT NULL");
  } catch (e) {
    console.warn(`[fuobe] Couldn't index runs by hold: ${(e as Error).message}`);
  }
  // An account's own runs (its list, its active runs) are found through this index, not by reading every run. Not a
  // numbered migration, so branches that add migrations never clash over it; a failure only leaves lists slower.
  try {
    db.exec("CREATE INDEX IF NOT EXISTS generations_account ON generations(json_extract(request_json, '$.account'), created_at DESC)");
  } catch (e) {
    console.warn(`[fuobe] Couldn't index runs by account: ${(e as Error).message}`);
  }
  return db;
}

export function db(): Database.Database {
  globalThis.__fuobeDb ??= open();
  return globalThis.__fuobeDb;
}
