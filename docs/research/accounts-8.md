# Fuobe research #8: Accounts, teams, enterprise and the platform, in three modes

_As of 2026-10-29. Machine-readable twin: [`accounts-8.json`](accounts-8.json) (`modes`, `tables`, `routes`, `settingsSplit`, `plans`, `ledger`, `libraries`, `decisions`, `reviews`, `packages`, `risks`, `sources`). Every screen is specified in [`accounts-8-screens.md`](accounts-8-screens.md). It builds on [`liner-ui.md`](liner-ui.md) (the design language), [`parity-delta-4.md`](parity-delta-4.md) (the parity studio's plans and credits) and [`ux-audit-4.md`](ux-audit-4.md) (the first-run guide and phone rules)._

**What was asked.** Fuobe has one optional install-wide password and no accounts. The owner said: "we also don't have authentication, register flow either", then "Own library each as well as teams features to share within the same team if users join a team - enterprise level features as well". The owner then decided that Fuobe runs in **three modes**, chosen in the first-run setup, all "done and crafted well":

1. **Personal**: one person who sets up everything (today's Fuobe; "Just me on this computer" is this mode with no sign-in).
2. **In-house studio**: a company hosts Fuobe for its people, with accounts, a private library each, teams that share inside the team, and enterprise features.
3. **Platform**: a public service like the parity studio, with open sign-up, plans, credits, payments and an admin panel.

One codebase, one core; the mode decides what is on, and the mode can change later without losing data. The owner's answers are in `/home/user/ext/owner-decisions.json` (`accounts`, read again on 2026-10-29 before writing; §6).

**How this was produced.** Read-only. Fuobe at `claude/fuobe-parity-4` (`545ebb5`), read with `git show` and `git grep` in a worktree; line numbers below are at that commit unless marked `76ecd89` (the audit snapshot, same files). Two code audits (data and entry points), a product study of the parity studio and eight peers, a study of self-hosted apps, auth libraries and standards, and a platform study were combined into one integrated design. Four adversarial reviews (security, engineering, money and operations, UX) then challenged it; every must-fix is applied and every should-fix is applied or rejected with a reason (§14). External pages were read as data, never run. Library tarballs (better-auth 1.7.14 and its plugins, `@boxyhq/saml-jackson` 26.2.0), ComfyUI v0.43.1, OWASP ASVS 5.0 and the OWASP cheat sheets were unpacked under `/home/user/ext/` and read, never installed. Versions and advisories were re-checked on the npm registry and OSV on 2026-10-29 (§5.2). Guesses are marked "guess".

## 1. The short version

- **Fuobe has no identity today.** One scrypt password in `data/auth.json`, a 30-day signed cookie with no user in it (`auth.ts` L107–125), install-wide API tokens, and a proxy that answers "signed in or not" (`proxy.ts` L35). None of the 43 tables has an owner, so every list, file, live event and setting is shared by whoever is signed in (§3).
- **One core, three modes.** Authentication runs on better-auth (exact pin, behind Fuobe's own seams). Fuobe owns everything else: people, workspaces, roles, grants, tokens, the data-access layer, audit, keys, the meter, entitlements and the mode switch (§7). The mode only turns features on or off; it never changes how data is stored, so switching modes moves no data (§7.9).
- **Everything belongs to a workspace.** Each person has a private personal workspace; a team is a workspace people join; sharing is a deliberate Move, Share or Duplicate. Rows nobody may see answer 404 everywhere. Four fail-closed layers stop a missed check: SQLite triggers, an actor-less DAL that throws, a route-sweep test and an IDOR matrix over path, query and body ids (§7.4–7.6).
- **The first screen is the owner's choice.** A fresh install opens on "Just me on this computer" or "Create your account" (the owner's `localUse` answer). Create your account then asks what Fuobe is for (Personal, Studio or Platform) and walks a short wizard with sensible defaults; a setup code printed in the terminal is asked for only when the owner commits (§7.9, screens §S1).
- **Who can sign up follows the owner: open.** Platform and Studio preselect "Anyone can create an account", with email checks required; Studio prefills "Only these email domains" with the owner's work domain. Approval, invite-only and closed are one click away. Domain trust only ever applies to addresses Fuobe has checked (§6, §9.1).
- **Who pays follows the owner: both, configurable.** Studio setup asks "Who pays for runs?": the studio's keys with a monthly limit per person (default $25), people's own keys, or both (own first). Personal pays with the owner's keys. Platform sells credits (§7.12).
- **One meter for every spend point.** Cloud jobs, open-engine GPU time, AI-Toolkit trainings and every Claude call reserve before they start and settle exactly once from the provider's real answer, so Cancel on a running job is charged for what ran. Budgets are dollars in Personal and Studio, credits in Platform (§7.12).
- **Studio gets the enterprise set.** Team directory and policies, a fair GPU queue, a GPU server pool, approvals, reports, enforced two-step and session policies, verified domains, company sign-in (OIDC and SAML), SCIM, an audit viewer, export, deletion, retention, legal hold and seats (§9).
- **Platform is a public service.** An append-only credit ledger, versioned plans, Stripe (direct or Managed Payments), a public site, abuse controls, an admin panel, trust and safety that blocks by default, C2PA on every output, and worker roles. Platform can only be opened to the public once its launch checklist passes (§10).
- **57 packages, one dependency order.** 17 core, 6 Personal, 13 Studio and 21 Platform. Each leaves Fuobe working in every mode with its tests; none breaks demo-mode e2e, API tokens, MCP, share links, `FUOBE_PASSWORD` or "Just me on this computer" (§16).

## 2. The three modes at a glance

| | Personal | In-house studio | Platform |
|---|---|---|---|
| Who it's for | One creator on their own machine, home server or rented GPU | A studio or company of 5–500 people on its own server | An operator selling a creative-AI service to the public |
| First screen | "Just me on this computer" (no sign-in) or "Create your account" | "Create your account" → "My studio or team" | "Create your account" → "A public service" |
| Sign-in | Off (Just me), or one password field plus passkeys and optional two-step | Email and password, Google, GitHub, any OIDC; company sign-in (OIDC, SAML); passkeys; two-step required for admins | Email and password with a code, Google, GitHub; passkeys; two-step optional for customers, required for staff |
| Who can join | Nobody else | Open, limited to the owner's work domain (preselected); approval, invite or closed | Open with abuse controls (preselected); waitlist while in Preview |
| Libraries | One library | A private library each, plus team libraries | A private library each, plus team libraries |
| Teams | No | Yes: directory, roles (Owner, Admin, Editor, Viewer), policies | Yes: team plans with pooled credits; sharing-only teams |
| Who pays | The owner's provider keys | Studio keys with a monthly limit per person, own keys, or both | Credits from plans, top-ups and codes; own keys only if the plan allows |
| Money shown as | "Spent ≈ $12.40 this month" | "≈ $12.40 of $25 this month" | "1,240 credits" |
| GPU queue | First come, first served (today) | Fair share by team weight | Fair share by plan tier; Free shares one pool |
| Admin | Settings, as today | `/admin`: people, teams, usage, GPU, approvals, security, SSO, SCIM, domains, seats, audit, data | `/admin`: plus plans, credit prices, codes, payments, moderation, bans, announcements, analytics, health |
| Safety | Provider defaults | Provider defaults, team policies | Prompt and output checks that block by default, CSAM hash matching (recommended), reports, takedowns, C2PA, AI labels |
| Data rights | Backup and move | Export, deletion with 30-day grace, retention, legal hold, view-as off by default | The same engine with Platform defaults (self-delete on) |
| Switching | Just me ↔ sign-in in Settings → Access; to Studio or Platform with a snapshot first | To Platform (asks about plans) or Personal (others go dormant) | To Studio (asks about public accounts) or Personal; refused while subscriptions are active |

## 3. What Fuobe has today

### 3.1 Sign-in and the perimeter

- **State lives in `data/auth.json`, not SQLite** (`auth.ts` L16–17): an optional scrypt password (`salt:hash`, 16-byte salt, 32-byte key, Node defaults N=16384 r=8 p=1; L80–93), an HMAC secret and API tokens. The file is written with mode 0600 through a temp file and rename (L54–60).
- **Protection is off until a password is set** (Settings → Security or `FUOBE_PASSWORD`; L1–9, L66). `FUOBE_PASSWORD` is compared by SHA-256 and `timingSafeEqual` (L87–89) and can't be changed from the UI (L98).
- **Sessions are stateless.** Cookie `fuobe_session` (L19) = `<expiry>.<HMAC(secret, expiry)>`, valid 30 days (L20, L107–125). There is no user id, no session table and no per-session revocation. Logout only deletes the cookie (`src/app/api/auth/logout/route.ts` L4–7). Changing the password rotates the secret and signs every browser out (L97–102).
- **Login throttle** (`LoginGuard`, L214–265): per client only behind `FUOBE_TRUST_PROXY=1`; otherwise every client shares one "direct" key (one try per 4 s, never locked), plus a global 20 a minute. It throttles but never lets anyone lock the owner out.
- **API tokens** are `fuobe_` + 24 random bytes; only the SHA-256 and a 12-character prefix are stored (L270–278). They have no owner, scope or expiry, and are created only from a signed-in browser (`src/app/api/auth/tokens/route.ts` L5–9).
- **The proxy** (`src/proxy.ts`, Node runtime by default per `proxy.md` L253–255): (a) a DNS-rebinding host check only when no password is set (L88–94, `hostAllowed` L190–200, which accepts `*`, L198); (b) a cross-site write block (`crossSite` L152–166); (c) public share links `/s/<token>` for GET and HEAD (L49–75), where any signed-in session counts as "the owner" (L50); (d) everything open without a password (L103); (e) `OPEN = {"/login", "/api/auth/login"}` (L10); (f) signed in = a valid cookie or bearer token (L35). It also 404s unknown record ids through `recordExists` (L21–28), a primary-key lookup.
- **No route handler checks anything itself.** All 192 `route.ts` files trust the proxy. There are no Server Actions (`git grep "use server"` finds none). The bundled Next 16 guide says the proxy is for optimistic checks only (`authentication.md` L1121) and route handlers are public endpoints (L1507).

### 3.2 Data: 43 tables, none owned

`MIGRATIONS` in `src/server/db.ts` is an append-only array of 23 SQL scripts (indexes 0–22), each applied in its own transaction and recorded in `_migrations` (L573–590). There are no foreign keys. Migrations are SQL only, so importing `auth.json` needs a JS bootstrap step.

| Group | Tables | Scope they need | Notes |
|---|---|---|---|
| The library | `generations`, `assets`, `folders`, `folder_items`, `generation_trash`, `generation_runs` | per workspace, children follow | `folder_items.generation_id` is the primary key, so a result sits in one folder (db.ts L123–128). Trash is emptied install-wide (`library.ts` L160). |
| Studio records | `cinema_*`, `canvases`, `layer_*`, `shorts_*`, `brand_kits`, `products`, `ad_*`, `marketing_runs`, `palettes`, `moodboards`, `photodump_packs`, `faceless_*`, `dub_sessions`, `katana_jobs`, `content_series`, `swap_projects` | per workspace | `palettes` mixes 50 built-ins (install catalog) with user rows. `products` and `faceless_episodes` follow their parent or own themselves. |
| Characters | `characters`, `trainings` | per workspace | @handles are unique across the install (`elements.ts` L42–48) and mentions resolve against everyone's elements (`generations.ts` L528 at 76ecd89). Deleting an element removes only the row (`elements.ts` L102–104). |
| Assist | `assist_threads`, `assist_thread_state`, `assist_projects`, `assist_project_sources`, `assist_memory`, `assist_schedules`, `assist_connectors`, `skills`, `skill_toggles` | per user (chats, memory, schedules, connectors) or per workspace (projects, skills) | `skills.name` and `skill_toggles.name` are primary keys; `assist_connectors.slug` is UNIQUE; every connector and its token goes into every chat (`connectors.ts` L96). |
| Sharing | `shares` | per user on workspace content | Creating a share checks only that the target exists (`shares.ts` L319–327). |
| Install | `settings`, `lora_mirrors`, `_migrations` | install | `settings.key` is the primary key. `lora_mirrors.hosted_url` lives on whichever provider account mirrored it. |

### 3.3 Files

- `data/files/{outputs,uploads}/<day>/<id>.<ext>`, one `assets` row each (`storage.ts` L141–167). `/api/files/[...path]` serves any path under `data/files` to anyone signed in, with `private, max-age=31536000, immutable` (`file-response.ts` L14–22, L38).
- `readRef` and `localHead` accept any asset id or `/api/files` URL (`storage.ts` L231–279), so a request body can pull another person's file into a job. Eight more call sites in seven modules read files directly with `absolutePath()` (`git grep absolutePath( -- src/server`, outside `storage.ts` and `file-response.ts`: `audio-tools.ts`, `katana.ts`, `canvas.ts`, `dub.ts`, `assist/studio-routes.ts`, `recipes.ts`, `library.ts`).
- Trained LoRAs go to `data/loras/fuobe/<handle>-<6>.safetensors` and the ComfyUI LoRA folder; AI-Toolkit datasets to `data/datasets/` (never cleaned). `attachLora` accepts any file name in those folders (`training.ts` L563–599).
- ComfyUI keeps every input (`fuobe_<nanoid8>.<ext>`) and every output (`fuobe/<workflow>_NNNNN_`, e.g. `bg-remove-birefnet.json` L18) readable to anyone who can reach it.

### 3.4 Settings

The `settings` table holds provider keys (fal, Replicate, Anthropic, civitai; `openai.key` and `google.key` are accepted but nothing reads them, `settings.ts` L26–27), ComfyUI, AI-Toolkit and Ollama addresses (server-side fetch targets), server paths (`comfyui.lorasDir`, `aitk.datasetDir`), `engine.mode`, `demo.mode`, `models.access` and `onboarding.done`, which `GET /api/status` writes during a GET (`src/app/api/status/route.ts` L24–27). `PUT /api/settings`, `PUT /api/settings/models`, `POST /api/providers/test` and `POST /api/loras` have no role check; `/api/providers/test` makes the server fetch any candidate URL. Browser state (theme, engine toggle, `fuobe.shareLinks` holding full share tokens, `fuobe:first-name`, drafts) is in unprefixed localStorage.

### 3.5 Money

- Each job stores `cost_usd`, an estimate from `estimateCost` written at creation (`generations.ts` L720 at 76ecd89) and re-priced for dependents and upscale tiers; the provider's bill is never read back. The open engine is priced at $0 (`plan.ts` L648).
- Caps already exist: Cinema `cost_cap_usd` (`cinema-generate.ts` L125–130) and Assist schedule caps (`withinCap`, `assist-schedule.ts` L270, which waits when a price is unknown).
- Unmetered Claude calls: `viaClaude` (`enhance.ts` L37) used by about a dozen call sites, the Assist stream (`agent.ts` L623–642) and Faceless `askLlm` (`faceless.ts` L215).
- The one choke points: `createGenerations` (`generations.ts` L691) and `recordLocalGeneration` (L1700) are the only inserts into `generations`; `submit` is launched with `void submit(...)` at L777 and L1117, and training at `training.ts` L221.

### 3.6 Background work

The generation runner (`ensureRunner`; 1.5 s tick, 0.5 s fast lane, 45-min run and 4-h queue timeouts), `advanceDependents` (L1028), `dropUnused` (L977), `sweepInterrupted` (L1323, 2-minute stale submit), the training poll, the Faceless sweep, the Assist schedule sweeper, Swap Studio's sweep, Content Factory's prune and the daily Trash purge all start from `src/instrumentation.ts` and act for everyone with install keys and no actor. Terminal writes are unconditional: `update()` is `UPDATE generations SET … WHERE id = ?` (L149), and `cancelGeneration` (L1641) writes `canceled` whatever the provider answers.

### 3.7 Machine clients

- **CLI** (`bin/fuobe.mjs`): REST with `Authorization: Bearer`, token from `--token`, `FUOBE_TOKEN` or `~/.config/fuobe/config.json` (0600; `bin/lib/config.mjs` L1–37).
- **MCP** (`/api/mcp`, POST only): refuses a foreign Origin (route L7–13); `handleMcp` builds `ctx() = { engine }` with no user (`mcp.ts` L40) and exposes every Assist tool.
- **Assist** calls server modules in-process with `ToolContext = { engine, thread }` (`agent.ts` L1110–1124).
- **Eval harness** reuses the CLI token and relies on `GET /api/elements/eval-price/trainings` answering for an unknown id (`scripts/eval/lib/run.mjs` L179, errors swallowed).
- No inbound webhooks exist; Fuobe polls fal, Replicate, ComfyUI and AI-Toolkit.

### 3.8 Server state that would leak between people

The live stream sends every generation change to every open stream (`live.ts` L60–82, L85–98 TEMP triggers) and the client inserts them into feeds (`generation-stream.ts` L52–57). `once(scope, id)` dedupe is keyed without the user (`shorts-schemas.ts` L97–118). Faceless voice previews reuse anyone's row (`faceless.ts` L1343–1357). The brand link-read lock is keyed by URL (`brand.ts` L1367). `assetUses` names other people's records in a 409 (`src/app/api/assets/[id]/route.ts` L8–25). React Query keys carry no user or workspace (`providers.tsx` L10–12) and Sign out is a soft navigation (`security-settings.tsx` L215–216).

### 3.9 Provider payloads

`params.extra` is accepted as `z.record(z.string(), z.unknown())` (`src/server/request-schema.ts` L100) and sent as given: the ComfyUI provider writes every extra key over the canonical bindings (`comfyui.ts` L1171) and binds non-media strings raw (L807–811); the cloud payload applies `extra` after the priced fields (`payload.ts` L422–426). ComfyUI resolves a name ending in `[output]` from its output folder (`folder_paths.py` L266–270 in ComfyUI v0.43.1). Request `loras[].file` accepts any file present in the LoRA folders (`request-schema.ts` L109–133).

### 3.10 UI we build on

The sidebar footer holds the connection status, theme and GitHub link (`app-sidebar.tsx` L386–428); `PhoneBar` holds the logo and search (`phone-bar.tsx` L21–30). Settings use a two-column `Section` (`settings-form.tsx` L22–48) and a sticky connection `StatusStrip` (L155, L241). The Library has one tab strip: All, Images, Videos, Audio, Text, 3D, Favorites, Uploads, Shared, Trash (`library-view.tsx` L49–62). The first-run guide asks for a fal.ai key and a ComfyUI address (`get-started.tsx` L114–159). `ui/sheet.tsx` has no max height or safe-area padding for bottom sheets (L65). `components/ui/avatar.tsx` exists but is unused. Cache Components is on (`next.config.ts` L5).

### 3.11 Tests that assume one owner

171 Vitest files; 39 call route handlers with a bare `Request` and about 100 call server modules directly, each with a fresh password-less data dir (`vitest.config.ts` has no setup file). `auth.test.ts`, `runtime-auth.test.ts`, `share-links.test.ts` (L255, L430, L487–583), `mcp.test.ts`, `cli*.test.ts`, `assist-schedules.test.ts`, `cinema-fixes.test.ts` and `eval-*.test.ts` encode one owner. `library.test.ts` L741–746 requires every `_json`/`_url`/`url`/`_file` column to be classified in `ASSET_REFS` or `ASSET_FREE`. The 28 e2e scripts expect a running server in demo mode with no password and call the API with plain `fetch` (README "Browser checks"); `canvas-open-dub` and `marketing-originals` change install settings.
## 4. What the parity studio and peers do

The parity studio's help centre (HC = `{studio-site}/creator-hub/help-center/`, 85 articles, read 2026-10-29), its marketing and team pages, its public Clerk configuration (`{studio-service}/v1/environment`, which its sign-in page loads) and its client bundle (read as text, never run) were studied for parity of product and UI only. Fuobe uses no parity-studio model or API (the owner's standing decision).

### 4.1 The parity studio: sign-up and recovery

- **Methods:** Google, Apple, Microsoft or email (HC `getting-started/create-an-account-and-sign-in`). The Clerk config also enables GitHub, which no article mentions (guess: hidden or used for developer flows). Email sign-up = email, password, then "a 6-digit verification code".
- **Abuse checks** in the Clerk config: Cloudflare Turnstile "smart" captcha, disposable domains blocked, `+tag` sub-addresses blocked, a blocklist; breached passwords checked (HIBP) at sign-in. The client has `VpnDetectedError`, `IpCheckRateLimitError` and "business domain verification required" errors.
- **Lockout:** 20 failed attempts lock an account for 60 minutes. Enumeration protection is off. No second factor is configured (`second_factor.required` false).
- **No consent step:** `legal_consent_enabled` false, terms URL null. Accounts are 18+ (HC sign-in article).
- **Recovery:** forgot password with a 6-digit code (email accounts only); social accounts recover at the provider; the account email can never change; Support can sign out all sessions.
- **After sign-up:** a welcome quiz path, an `/onboarding` route and timed, personalised offers with countdowns (client bundle; HC `plans/what-are-exclusive-offers`). Free has no credits, one Character generation, a watermark and no commercial use per its pricing table (blog "studio-pricing-explained", 24 Oct 2026).

### 4.2 The parity studio: account, teams and enterprise

- **Account menu:** username, plan, credits, then Credits, Top-up, Boost speed, Unlimited models, View profile, Manage Account, Increase Concurrent, Join Community, Sign Out (HC `whats-in-my-studio-account`). Manage Account has Profile, Gifts, Subscription, Usage, Promocode; Usage lists every deduction with model, refunds, and MCP/CLI runs tagged.
- **Deletion:** a checklist of what is lost, Delete Account, a 30-day restore by signing back in, then permanent (HC `how-do-i-permanently-delete-my-account`). Data export is by email for GDPR and UK users only.
- **Workspaces:** types `private` and `shared`, roles owner, admin, member (client enum). Characters can be shared to the team workspace or moved. "Other members can't see your assets, but workspace owners and admins can"; Enterprise adds a "View member assets" permission. When a member leaves, their shared assets stay (HC `team-and-business-studio`).
- **Team and Scale:** per-seat, each seat's credits pool into one balance; admins invite, assign roles, pause a member's credit use (Scale and Enterprise) and see usage by member. Seats can't be reduced mid-cycle without Support; only the Owner cancels.
- **Enterprise:** custom seats and credit volume, role-based permissions and user groups with per-group limits, per-user credit caps, CSV member import and usage export, SSO/SAML, "centralized user provisioning", SOC 2, no training on customer data, invoice or PO billing (HC; `{studio-site}/enterprise`). Its Clerk config has `enterprise_sso` with self-serve SSO and directory sync.

### 4.3 The parity studio: plans and credits

- **Plans** (official blog, Oct 2026): Free $0 / 0 credits; Starter $15 / 200; Plus $49 / 1,000; Ultra $129 / 3,000; Team $79 a seat / 1,000 a seat (2–9); Scale $215 a seat / 2,500 a seat (5–15); Enterprise by contact. A second price track ($19/270, $59/1,200) is live at the same time (third-party snapshots and both variants in the client bundle; guess: A/B or cohort pricing).
- **Concurrency by plan:** Free 1, Starter 2–4, Plus 6–8, Ultra 8; Team 16 on the standard queue, Scale 32 on the priority queue. Unlimited models run on the standard queue, only on the web, for "personal, human use only".
- **Credit types and order:** subscription credits reset each cycle and don't roll over; packs, auto-refill and boost credits last 90 days; subscription credits are spent first, then whatever expires soonest (HC `credits/how-credits-work`). Failed generations refund automatically.
- **Billing:** Stripe Checkout only, taxes added at checkout, invoices for every payment, VAT IDs in the Stripe portal. Upgrades are immediate and prorated, "unused credits and unused annual months are valued and deducted", and the billing date resets; downgrades apply next cycle (HC `plans/how-do-i-upgrade-or-downgrade-my-plan`). Refunds only within 7 days of an initial purchase with zero credits used, minus up to 6%; EEA and UK buyers get 14 days. Failed renewals go past due and cancel after about 14 days.
- **Credit prices:** the exact cost shows on the Generate button; e.g. Seedance 2.0 5 s at 1080p = 60 credits; about $0.049 a credit on Plus.

### 4.4 Peers

| Product | Sign-up | Teams and enterprise | Plans and credits | Source |
|---|---|---|---|---|
| Krea | Google or email (third-party) | Owner, Admin, Member; one team per user; orgs with private, joinable or auto-join workspaces, DNS-verified domains, SAML enforcement, per-member limits where 0 blocks | Free 100 units a day; Basic $9; Pro $35; Max $105; Business $200 with per-member spend limits and model access control; packs last 90 days | krea.ai/pricing, docs teams.md, organization-management.md |
| Runway | Email code, Google, Apple; SSO on Enterprise forces domain users | Admin, Editor, Billing Admin, Viewer; viewers and billing admins take no seat | Free 125 once; Standard $15; Team $69 a seat pooled with one month of rollover; bought credits never expire | runway.com/pricing, /team-plan |
| Magnific (formerly Freepik) | Email, Google, Apple; 3 devices | Owner, Admin, Member; per-user credit limits; SSO on Enterprise | Credits valid one year | magnific.com/pricing (search snippets; 403 to fetchers) |
| Leonardo | Apple, Google, Microsoft, email; a questionnaire (third-party) | Team feed and personal feed; private generations "planned" | Team $24 or $48 a seat | intercom.help/leonardo-ai teams FAQ |
| Kling | Email, Google | Team Space: Owner, Administrators allocate credits; assets private until moved to Shared Assets | Bought credits last 2 years; failed generations refunded | kling.ai/docs/point-policy |
| Midjourney | Discord or Google | None found | Basic $10 to Mega $120; Relax unlimited from Standard | docs.midjourney.com/docs/plans |
| Canva | Apple, Facebook, Google, email | Org admin, brand designer, team owner, admin, member; SCIM, SSO and audit logs on Enterprise; approvals | Business US$250 a year per person; AI allowances per person | canva.com/help |
| Figma | Google or email with a link | Can view / can edit at file, folder, team and plan level; "Ask to edit"; SAML, SCIM, activity logs, domain capture, idle timeout, seat approval | Full seats $16/$55/$90; viewers free | figma.com/pricing, help.figma.com |
| Liner (UI reference) | 7 methods with a "Last used" badge; email code ("You can receive a one-time code in 30 seconds"); date of birth once; "Agree to all" with required and optional rows | Team $26.99 a seat; invites expire in 72 hours; "You're signed in with a different email"; Transfer ownership; an owner can't delete their account | "My credits" shows subscription credits and packs; "Credits are used in this order"; auto-recharge copy; cancel and delete flows | liner.com i18n strings; `liner-ui.md` L320–335, L579–612 |

### 4.5 What Fuobe takes and what it doesn't

- **Takes:** email code verification, Google and GitHub, a "Last used" badge, a private library by default with deliberate sharing (Kling, the parity studio), owner/admin/editor/viewer with free viewers (Runway, Figma), per-member limits where 0 blocks (Krea), pooled team credits, credits spent soonest-expiring first, refunds on failure, the price on the Generate button, Stripe Checkout and the customer portal, a 30-day restore after deletion, Liner's invite and ownership microcopy.
- **Improves on:** two-step sign-in for everyone (the parity studio has none), self-service data export in every mode (the parity studio's is by email and GDPR-only), visible Downgrade and Cancel (the parity studio hides Downgrade below the cards), admins can't see members' private work unless a policy allows it and the person is told (the parity studio's admins can).
- **Leaves out:** countdown offers and "evergreen" timers (they fight "fast and friendly"), a hidden second price track, phone or date-of-birth questions at sign-up (Platform asks one age line), and any community feed, which the owner did not ask for (open question, §15).

## 5. How self-hosted apps do it

### 5.1 Products

| Product | First run | Sign-up and roles | Recovery without email | SSO and provisioning | Lesson for Fuobe |
|---|---|---|---|---|---|
| Open WebUI | First account becomes admin; sign-up then closes automatically | admin, user, pending (pending refused everywhere); additive groups that also act as sharing targets | Admin sets a new password; lost admin = SQL update | OIDC with role and group sync, trusted header, LDAP, SCIM with one static token; `ENABLE_MFA` | Pending state; keep permission groups apart from sharing groups |
| Immich | "The first user to register will be the admin" | Admin creates users; per-user library and quota | `immich-admin reset-admin-password` in the container | OIDC only (auto register, role and quota claims) | A per-person library, a 7-day soft delete, a CLI that reopens a locked install |
| n8n | Owner sign-up screen; owner from env since 2.17 | Invite only; projects with Admin, Editor, Viewer | Copy invite links without SMTP; `user-management:reset` wipes users | SAML, OIDC, LDAP and log streaming on paid plans | Works without email; Fuobe ships SSO in the open |
| Gitea / Forgejo | Web installer locked by `INSTALL_LOCK` | `DISABLE_REGISTRATION`, email confirm, manual confirm, domain allow and block lists, captcha | `admin user change-password`, `must-change-password` | OAuth2/OIDC auto-discovery, LDAP; `TWO_FACTOR_AUTH=enforced` | The best reference for sign-up switches |
| Jellyfin | Setup wizard | Admin-created users | "Forgot password" works only from the local network and writes a PIN file to the config folder, valid 30 minutes | Plugins | Proof of server access replaces email: Fuobe's `fuobe recover` file |
| Nextcloud | Installer or `occ maintenance:install` | Groups, sub-admins, team folders | `occ user:resetpassword` | `user_saml`, `user_oidc`, LDAP; `occ twofactorauth:enforce --group` | Enforced 2FA per group with exclusions |
| ComfyUI `--multi-user` | No accounts | The user is chosen by an unauthenticated `comfy-user` header (`app/user_manager.py` L61–62) | — | — | Outputs and the queue are shared (`server.py` L613): ComfyUI stays a backend only Fuobe talks to |

Sources: docs.openwebui.com (roles, groups, hardening, SSO, SCIM, password reset); docs.immich.app (post-install, user management, server commands, OAuth); docs.n8n.io (user management, RBAC, CLI, SAML, OIDC, LDAP, log streaming); docs.gitea.com and forgejo.org config cheat sheets and CLI; jellyfin.org/docs and `UserController.cs`, `DefaultPasswordResetProvider.cs`; docs.nextcloud.com `occ_users`; ComfyUI v0.43.1 source.

### 5.2 Libraries

**Chosen: better-auth for authentication only.** MIT (still MIT after Vercel's acquisition, announced 2026-07-07), peers `next ^16` and `react ^19`, runs on better-sqlite3 through Kysely and emits SQL Fuobe freezes into `MIGRATIONS`, has fail-closed hooks (`validateUserInfo`, `databaseHooks`, `hooks.before/after`) and a custom password hasher. Fuobe never loads its `organization`, `admin`, `api-key`, `magic-link`, `oauth-proxy`, `one-tap`, `anonymous`, `device-authorization`, `jwt`, `bearer`, `multi-session` or `username` plugins: Fuobe's DAL needs synchronous membership reads, and several of those plugins carried 2026 advisories.

Its advisory list is long (OSV, 26 entries on 2026-10-29; critical ones include GHSA-965c-763c-88jm OAuth state used as a magic link, GHSA-rjg6-39jm-rgg4 SCIM provider collision, GHSA-5rr4-8452-hf4v SSO SSRF and GHSA-xg6x-h9c9-2m83 a 2FA bypass with the cookie cache). Conditions: every `@better-auth/*` package at the same exact version, an OSV watch that blocks releases, a router-only endpoint allowlist (§7.1), `cookieCache` off, its own database connection and a schema-guard test.

**Version rule (applied when each package starts, not today):** pin the newest release that is at least 14 days old and OSV-clean; if every release that old has an open advisory, pin the oldest release that fixes all of them. Re-checked on 2026-10-29:

| Package | Newest | Rule today | Notes |
|---|---|---|---|
| better-auth (+ `@better-auth/passkey`, `@better-auth/sso`) | 1.7.14 (2026-10-26) | 1.7.8 (2026-10-14) | Every OSV advisory is fixed at or below 1.7.7. This research read the 1.7.14 files; from 2026-11-09 the rule gives 1.7.14. A package that starts earlier pins 1.7.8 and re-runs the behaviour-pin tests. |
| nodemailer | 10.3.1 (2026-10-29) | 10.1.4 (2026-10-18) | Every release at least 14 days old is affected by GHSA-85x2-q946-cp5h, -8c8m-p3m8-cjg8 and -m943-m63m-w62w (fixed 10.1.4). |
| stripe | 23.0.1 (2026-10-22) | 23.0.0 (2026-10-01) | No OSV entries. |
| @simplewebauthn/browser | 14.0.0 | 13.3.0 | The passkey plugin requires `^13.3.0`. |
| uqr | 0.1.3 | 0.1.3 | QR codes. |
| sharp | 0.35.5 | 0.35.5 | Already installed transitively; becomes direct (Apache-2.0). |
| @contentauth/c2pa-node | 0.9.11 (2026-10-27) | 0.9.9 (2026-09-30) | Needs Node ≥22 (this machine runs 22.22) and downloads a native binary. |
| @aws-sdk/client-s3, s3-request-presigner | 3.1159.0 | 3.1152.0 (2026-10-14) | |
| @vercel/otel | 2.1.4 (2026-10-29) | 2.1.3 (2026-06-11) | Plus its `@opentelemetry` peers. |

Unchanged: next 16.4.2, react 19.3.0, better-sqlite3 ^13.0.3, zod ^4.6.7, nanoid ^6.0.2 (`package.json` L38–57).

**Rejected:** extending `auth.ts` (single-password design that fails ASVS 7.4.1/7.4.2 once there are several people, and would mean hand-rolling SAML); Auth.js (v5 still `5.0.0-beta.32`, no sign-up, reset, 2FA, orgs or SAML; its maintainers now point new projects to Better Auth); Lucia (deprecated March 2025); Arctic and most of Oslo (deprecated 2026-07-29); embedding Ory Polis (about 267 packages and 161 MB, pins better-sqlite3 12.8.0 against Fuobe's 13.x, `dist/db/sql/sql.js` L78; documented as an optional sidecar instead); iron-session (stateless cookies can't be revoked); Better Auth's SCIM plugin (it can't write Fuobe's tables, so Fuobe owns `/api/scim/v2`) and its Stripe plugin (no event dedupe, no `invoice.paid`, and GHSA-h3rm-78g3-j7cp).

### 5.3 Standards that set the rules

- **OWASP ASVS 5.0** (`/home/user/ext/owasp-asvs`, `9ccce0e`): passwords of 8+ characters with 64+ allowed and no composition rules (6.2.1, 6.2.5, 6.2.9), a blocklist of at least the top 3,000 passwords (6.2.4), every authentication path equally strong (6.3.4), reset must not bypass MFA (6.4.3), admins initiate a reset but never know the password (6.4.6), lookup codes single-use (6.5.1), accounts keyed by issuer and subject (6.8.1); sessions revoked on the backend at logout, disable and delete (7.4.1, 7.4.2), people see and end their sessions (7.5.2); data-specific authorization against IDOR (8.2.2), authorization on the originating user (8.3.3), cross-tenant controls (8.4.1); every authentication attempt and failed authorization logged without secrets (16.3.1, 16.3.2, 16.2.5); scrypt N ≥ 2^17 with r=8 p=1, or the OWASP table's N=2^15 r=8 p=3 (Appendix C).
- **NIST SP 800-63B-4** (final, 31 July 2025): 15+ characters for single-factor passwords or 8+ with MFA, no composition rules, a blocklist, no periodic changes, paste allowed, at most 100 consecutive failures per account; synced passkeys acceptable at AAL2 when user verification is set.
- **OWASP cheat sheets** (Forgot Password, Session Management, Authorization, IDOR, Credential Stuffing, MFA, SAML): uniform answers and timing, hashed single-use reset tokens built from a configured base URL, `__Host-` cookies, deny by default, scoped lookups, and never hand-rolled SAML.
- **WebAuthn Level 3** (W3C Recommendation, 25 August 2026): passkey autofill with `autocomplete="username webauthn"` and conditional mediation; the RP ID must be a real domain, so passkeys need an https site address or localhost.

### 5.4 Next 16 rules (bundled docs at `node_modules/next/dist/docs/`)

- Proxy runs on the Node.js runtime and can't be configured otherwise (`proxy.md` L253–255); it is for optimistic checks, "not … your only line of defense" (`authentication.md` L1121). Route handlers are public endpoints and must authorize themselves (L1507). Fuobe keeps the proxy optimistic and authorizes in every handler.
- `cookies()` is async and can set cookies only in a Route Handler or Server Function (`cookies.md` L74).
- With `cacheComponents` on, a session read can't sit inside plain `'use cache'` (`authentication-with-cache-components.md` L309–313). Account data is read client-side or under Suspense.
- A webhook reads its raw body with `await request.text()` (`route.md` L566–590).
- `updateTag` is Server-Action-only; a route handler revalidates with `revalidateTag` (`revalidateTag.md` L142).
- `next start` binds `0.0.0.0` by default (`cli/next.md` L123), and `Host` and `X-Forwarded-For` are client-controlled. That is why setup needs a code (§7.9).

## 6. The owner's decisions

### 6.1 What the owner decided (binding, `owner-decisions.json` → `accounts`, answered 2026-10-29)

| Topic | The owner's answer | Where the plan applies it |
|---|---|---|
| Deployment modes | Three modes chosen in first-run setup, all crafted well; one codebase, one core; the mode can change later without losing data | §2, §7.9, §8–§10 |
| Sign-up | **Open public sign-up** (email check, Google sign-in), as a first-class path with verification, abuse controls and per-person limits; invite-only, owner-approved and closed stay as settings | §6.3, §9.1, §10.1 |
| Libraries | Own library each **and** teams; people may join several teams and share inside them, on purpose or by creating in the team space, on top of sharing with a person or a public link | §7.4–§7.5, §9.3 |
| Local use | The first screen offers "Create your account" or "Just me on this computer" (no sign-in, local addresses only, as today); switchable later in Settings | §7.9, screens §S1.1 |
| Paid keys | Both, configurable from setup: the owner's keys with a per-person monthly limit and spend shown to the owner, people's own keys, or both (own first, then the owner's within the limit) | §7.12, screens §S1.7 |
| Enterprise | Roles and permissions, admin console, SSO (OIDC and SAML), SCIM, verified domains and auto-join, enforced 2FA and session policies, audit log, per-team and per-member limits and reports, team keys, seats, export, deletion, retention; core first, enterprise after | §9.5, §16 order |
| Setup | After "Create your account" the wizard asks who can sign up, email verification and transport, sign-in methods with client ids, allowed or blocked domains, whether people may create teams, the paid-keys mode and default limit, and the public site address; sensible defaults; all changeable later; "Just me" skips it | §7.9, screens §S1 |
| Standing | No parity-studio models or API; licences are information, not gates | §4, §10.3 |

### 6.2 Decisions this plan assumed (the owner can change any of them)

| Decision | Choice | Why |
|---|---|---|
| Identity library | better-auth for authentication only, behind Fuobe's seams | §5.2 |
| Teams | Fuobe-owned workspaces and members; several teams per person | Synchronous DAL reads; owner wants "a team (or several)" |
| Team role names | Stored `owner/admin/member/viewer`; a team `member` is shown as **Editor** everywhere | Avoids a clash with the install role "Member" |
| Studio join default | **Anyone can create an account**, with "Only these email domains" prefilled with the owner's work domain (empty for webmail); needs email checks or Google/OIDC; without either, setup falls back to "I approve new accounts" and says why | The owner's "open", made safe for company keys (§9.1) |
| Default member limit | $25 a month on the studio's keys, in the install time zone | Bounded company money; open question §15 |
| Sessions and passwords | 30 days rolling; 8–128 characters; a top-10,000 blocklist; scrypt N=2^15 r=8 p=3 | ASVS 6.2, OWASP table |
| Two-step | TOTP with 10 backup codes and passkeys (user-verified) for every account; required for owner, admins, auditors and Platform staff in Studio and Platform, with 7 days of grace | ASVS 6.3.3 |
| Recovery | One mechanism: `fuobe recover` (or `FUOBE_RECOVER`) writes a code to the data folder | Works without email (Jellyfin's idea) |
| Setup protection | An 8-digit setup code, asked only when the owner commits; the printed link carries it in the URL fragment | `next start` binds `0.0.0.0` |
| Platform money | 1 credit = $0.01, 50% markup over provider cost, rounded up | Guess; open question |
| Platform plans | Free 50 credits a month; Starter $10 / 1,000; Pro $30 / 3,300; Ultra $100 / 12,000; Team $25 a seat / 3,000 a seat pooled; Enterprise by contact | The parity studio's shape; amounts are guesses |
| Platform teams without a Team plan | Allowed for sharing only; runs in them are paid from the runner's own credits | Simple and fair |
| Payments | Stripe direct, or Stripe Managed Payments as a switch, or none (codes and admin grants); a fake provider only for tests | §10.4 |
| Safety | Sexual content always blocked; 18+ by default (16 allowed; likeness features always 18+); prompt and output checks required before Platform opens; failed or unavailable checks withhold the result | §10.8 |
| Database | SQLite on one host with WAL, snapshots and Litestream; Postgres deferred with explicit triggers | §10.10 |
| Community feed | Not in this plan | Not asked for; open question |

### 6.3 Where this plan departs from the integrated design because of the owner's answers

- **Sign-up default.** The integrated design preselected "I approve new accounts" for Studio and left it as an open question. The owner's answer is open, so Studio now preselects open with the owner's work domain filled in (§9.1). Platform was already open.
- **First screen.** The design opened on a setup-code gate, then a three-card mode page. The owner's `localUse` answer says the first screen offers "Create your account" or "Just me on this computer", so that is the first screen now, and the code is asked for only when the owner commits (§7.9).
## 7. The shared core

Everything in this section exists in every mode. The mode only switches features on (§7.9).

### 7.1 Identity

**Who answers what.** Better Auth answers "who is this". Fuobe answers "what may they do, and with whose money". Fuobe code touches Better Auth's tables in three places only: `principal.ts` (through `auth.api.getSession`), people lists (a read-only join for name, email and image) and `src/server/identity/admin-ops.ts`, which writes through `(await auth.$context).internalAdapter` (`setPasswordFor`, `revokeAllSessions`, `revokeSessionById`, `setEmail`, `updateName`, `deleteAuthUser`; two-step adds `resetTwoFactor` and `removePasskeys`). Every call is audited. A test pins that `$context.internalAdapter` is reachable in the pinned version (guess until that test runs).

**Better Auth configuration** (`src/server/identity/auth.ts`):

- Mounted at `/api/identity/[...all]` with `toNextJsHandler`. Fuobe's `/api/auth/login`, `logout`, `password` and `tokens` stay as Fuobe shims, so the CLI and today's UI keep their paths.
- Its own better-sqlite3 connection to `data/fuobe.db` (WAL, `busy_timeout` 5000), cached on `globalThis.__fuobeAuthDb`. Tables are named `auth_*` (`modelName`); no `additionalFields`. `telemetry.enabled: false`.
- `secret = HKDF-SHA256(rootSecret, "fuobe", "better-auth/v1")`, where the root secret is `FUOBE_SECRET` or `data/secret.key` (32 bytes, 0600). `baseURL` = `install.site_url`, else the request origin.
- `trustedOrigins` is a registry function: `install.site_url`, `access.allowed_hosts`, `FUOBE_ALLOWED_ORIGINS`, and the request origin when `hostAllowed()` is true **in Personal only**. SSO issuer origins are never added (the SSO plugin already skips origin checks on SAML paths, `@better-auth/sso` `dist/index.mjs` L4540–4542; trusted origins also govern `callbackURL` redirects).
- **Client IP.** The proxy deletes any incoming `x-fuobe-client-ip` and writes one only when a trusted proxy is configured (§7.2); `advanced.ipAddressHeaders: ["x-fuobe-client-ip"]`. With no trusted proxy the header is absent and `advanced.ipAddress.disableIpTracking: true`, so Better Auth's limiter has no key and skips its IP rules (`dist/api/rate-limiter/index.mjs` L243). The integrated design wrote `0.0.0.0`, which makes Better Auth's rules (3 tries per 10 s on `/sign-in*` and `/sign-up*`, L305–318) one install-wide bucket that any client can fill (reviews 1 and 2).
- **Cookies.** Prefix `fuobe`. On an https site address the session cookie is `__Host-fuobe.session_token`: `advanced.useSecureCookies: false` plus `advanced.cookies.session_token = { name: "__Host-fuobe.session_token", attributes: { secure: true, path: "/" } }`, with no `Domain` (Better Auth otherwise prepends `__Secure-` to any name, `dist/cookies/index.mjs` L23–31). The same is done for every Better Auth cookie and for Fuobe's `fuobe_setup` and `fuobe_recover`. On plain http (LAN, localhost) the names have no prefix and `Secure` is off. A core test pins the names and attributes.
- **Sessions:** `expiresIn` 2,592,000 s (30 days), `updateAge` 86,400 s, `deferSessionRefresh: true` (refresh only on POST), `freshAge` 600 s, `cookieCache` off.
- **Email and password:** hash and verify from `password.ts` (§7.2); `revokeSessionsOnPasswordReset: true`. **Email OTP:** 6 digits, 600 s, 3 attempts, `storeOTP: "hashed"`, `disableSignUp: true`. `verification.storeIdentifier: "hashed"`.
- **Social and OIDC:** Google and GitHub through `socialProviders`, other OpenID providers through `genericOAuth` (PKCE on), secrets stored `enc:v1:` (§7.12). `accountLinking: { trustedProviders: [], allowDifferentEmails: false }`; Better Auth's own `requireLocalEmailVerified` defaults to true (`dist/oauth2/link-account.mjs` L140–141) and stays so. `genericOAuth` is for consumer-style buttons; company identity providers with domains, provisioning and groups go only through company sign-in (§9.5 E2), and in Studio the "Another provider" row offers to move into it once E2 ships.
- **Hooks.** `validateUserInfo` runs the sign-up policy (§9.1). `user.create.before` refuses every create whose intent is not "claim-owner", the bootstrap import, an invite, SSO, SCIM or an admin create, **unless** the install flag `accounts.multi_user` is `1`; that flag is set only by the migration of the meter package (acc-8), after isolation and limits exist. `user.create.after` links or creates the Fuobe person. `session.create.before` is a registry of `(userRow, session, path)` checks returning `{code, message, restricted?}` (core codes `ACCOUNT_PENDING`, `ACCOUNT_DISABLED`, `ACCOUNT_DORMANT`; packages add theirs). `session.create.after` is a registry too (audit, alerts, two-step marks).
- **Endpoint allowlist** in `hooks.before`, built from the loaded plugins and applied only when `ctx.request` exists (router traffic), so Fuobe's own `auth.api` calls pass. `/sign-up/*`, `/sign-in/social` and `/sign-in/oauth2/*` are **not** on the list until the sign-in package (acc-11) adds them together with the policy. Always blocked: `/delete-user`, `/update-session`, `/get-access-token`, `/refresh-token`, `/account-info`, `/change-email`, `/send-verification-email`, `/sign-in/email-otp`, `/list-sessions`, `/revoke-session`, `/revoke-sessions`, `/two-factor/send-otp`, `/two-factor/verify-otp` and the SSO provider-management routes. `/update-user` is allowed with `image` stripped (Fuobe's avatar upload is the only way to set a picture) and `name` limited to 80 characters.
- **Rate limiter** on with `storage: "database"`; IP rules apply only when a trusted proxy exists (above).
- `getAuth()` is memoised by `identity.config_version`, bumped whenever sign-in settings change.

**Fuobe's identity tables** (migration 23; Better Auth's frozen SQL is migration 24):

| Table | Columns that matter |
|---|---|
| `users` | `id` (`u_owner` or `u_` + nanoid(12)), `auth_user_id` UNIQUE, `role` (checked against the role registry; UNIQUE where `role='owner'`), `status` active, pending, disabled, deleted; `pending_reason`, `dormant`, `personal_workspace_id`, `source` legacy, env, setup, signup, invite, admin, sso, scim, unknown; `external_id`, `provisioned_email` (UNIQUE lower where no `auth_user_id`), `provisioned_name`, `invited_by`, `approved_by`, `avatar_asset_id`, times in ms |
| `workspaces` | `kind` personal, team, install; `name`, `slug` UNIQUE, `color`, `created_by`, `archived_at`, `delete_after` |
| `workspace_members` | `workspace_id`, `user_id`, `role` owner, admin, member, viewer; `source` manual, invite, join, domain, sso, scim; `added_by` |
| `invites` | token `fuobe_inv_` + 24 bytes, SHA-256 stored, 72 h, single use, `role`, `workspace_id`, `inviter_id`, `email` |
| `grants` | `resource_kind`, `resource_id`, `grantee_kind` user, workspace, email (pending); `grantee_id`, `level` view, edit; `granted_by` |
| `item_marks` | per viewer: `user_id`, `item_kind`, `item_id`, `favorite`, `pinned_at` |
| `api_tokens` | `user_id`, `workspace_id` pin, `name`, `prefix`, `hash`, `scopes` full, read, generate, admin; `expires_at`, `last_used_at`, `revoked_at`, `legacy` |
| `audit_log` | append-only (§7.14) |
| `user_settings`, `workspace_settings`, `session_step_up` | key/value per scope; step-up marks with expiry |

Seeds: `w_owner` (personal), `w_install` (install catalog), `u_owner` (unclaimed) and its membership. Better Auth plugin tables (`auth_two_factor` and `auth_passkey` in acc-19, `auth_sso_provider` in acc-32) are appended as frozen SQL by the package that loads the plugin (`scripts/auth-schema.mjs`). A schema-guard test asserts that `getMigrations(auth.options)` has nothing to create or add with the full plugin set, so a library upgrade that needs schema changes fails CI instead of changing the database at run time.

**The principal.** `resolvePrincipal(request) → Actor { userId, role, via: session|token|local|system|runner|scim, sessionId, tokenId, scopes, workspacePin, restricted?, impersonatorId? }`, memoised per request:

1. `Authorization: Bearer fuobe_…` → `api_tokens`. An invalid bearer is 401, except in Just me, where it is ignored. `fuobe_scim_…` tokens are never API tokens.
2. Session cookie → `getSession` → `users`. A missing link is created idempotently **as pending**, with no memberships and `source: unknown`, and audited; it is never created active (review 1). Inactive or dormant people get null plus the registry code.
3. Just me (Personal, sign-in off, `hostAllowed`, §8) → `u_owner` via `local`.
4. Otherwise null.

Seams: `substituteActor(actor, request)` (used by view-as, §9.5 E5b) and a registry of restricted session kinds, each with its own route allowlist: `enroll-2fa`, `verify-2fa`, `view-as`, `restore-account`, `accept-terms`.

### 7.2 Sessions, passwords and throttles

- **Passwords:** 8–128 characters, no composition rules, a vendored top-10,000 blocklist ("That password is too common. Try a longer phrase."), paste allowed. Hash: scrypt N=2^15, r=8, p=3, 64-byte key, stored `scrypt$v2$N$r$p$salt$hash`; the legacy `salt:hash` from `auth.json` (N=2^14, r=8, p=1, 32 bytes) verifies and is upgraded in place on the next sign-in. Platform adds the breached-password check (§10.1).
- **Per-account throttle** keyed by SHA-256 of the lower-cased submitted email (so unknown emails behave like known ones): 5 failures in 15 minutes → one try per 60 s. 100 consecutive failures lock **the password only** (423 `PASSWORD_LOCKED`): passkeys, recovery and an email reset still work. The lock lifts after 24 hours (the throttle stays), on a passkey sign-in, a second-factor proof or a completed reset. The answer is the same whether or not the account exists.
- **Global soft throttle:** above 60 failed sign-ins a minute install-wide, each sign-in request waits 1 s before it is answered. It never refuses (today's `LoginGuard` principle, `auth.ts` L205–213).
- **Trusted proxies.** `FUOBE_TRUSTED_PROXIES` (or Settings → Access → Behind a proxy) is a hop count (`1`, `2`) or a list of CIDRs. The client IP is the first `X-Forwarded-For` entry counting from the right past the trusted hops, or past the trusted CIDRs. `FUOBE_TRUST_PROXY=1` keeps meaning one hop. The Access page shows the IP it detects for the current request ("Fuobe sees you as 203.0.113.7").
- **Step-up:** sensitive actions (passwords, two-step, passkeys, tokens, keys, roles, mode, backups, SSO, SCIM, deletion) need a session confirmed in the last 10 minutes ("Confirm it's you", screens §S3.5). For people who sign in only with a provider, step-up re-runs the provider sign-in; the pending action (route and a non-secret draft of the form) is kept in sessionStorage under a step-up id and the dialog reopens filled after the redirect (`?stepup=<id>`).

### 7.3 Roles and permissions

**Install roles** come from a registry: `owner` (exactly one), `admin` and `member` in core; `auditor` added by the audit viewer; `billing`, `moderator` and `support` added by the Platform admin package. **Team roles:** `owner`, `admin`, `member` (shown as **Editor**), `viewer`. `effectiveTeamRole(actor, workspace)` is the only function that answers a team role: it clamps view-only seats to Viewer (§9.5 E6) and makes view-as read-only.

**Permissions** (registry; each route declares what it needs): `install.settings`, `install.mode`, `people.view`, `people.manage`, `people.roles` (owner), `usage.view_all`, `limits.manage`, `keys.install`, `teams.create`, `teams.manage_all`, `audit.view`, `data.manage`, `gpu.manage`, `approvals.decide`, `billing.*`, `moderation.*`, `support.view_as`, `credits.adjust`.

**Who may act on whom.** No admin action may target the owner. Actions on admins, auditors and Platform staff need the owner. The target always gets an Inbox notice and, when mail works, an email ("Your password was reset by {admin} on {date}.").

| Action | On a member | On an admin, auditor or staff | On the owner |
|---|---|---|---|
| Send a reset email (mail works) | admin | owner | no one |
| Create a reset link (no mail; Studio only) | admin | owner | no one (`fuobe recover`) |
| Reset two-step or remove passkeys | owner | owner | no one (`fuobe recover`) |
| Sign out everywhere | admin | owner | the owner, for themselves |
| Turn off, delete | admin | owner | no one |
| Set a monthly limit | admin | owner | — |
| Change install role | owner | owner | transfer only |
| Open a personal library (view-as, §9.5 E5b) | per policy | owner | no one |

Admin reset links and reset emails never clear two-step or passkeys (ASVS 6.4.3). Platform staff never get a reset link, only "Send a reset email". Invites may grant only roles the inviter may assign directly, and an invite for an admin role needs the invited email to be checked before it can be accepted.

### 7.4 Data scoping, table by table

Every row belongs to one workspace. A row is **visible** to an actor when any of these holds: the actor is a member of its workspace; a grant names the row or its container for the actor, for one of the actor's teams, or for the workspace the row is being used in; its workspace is `w_install`; or a live share serves it (§7.13). Otherwise the answer is 404, never 403, and the denial is audited as `denied.hidden` (at most one entry per actor and route a minute). Writes need the team role the action requires (§7.5).

Migration 25 adds `workspace_id` and `created_by` (no defaults), backfills them to `w_owner`/`u_owner`, adds triggers that refuse a NULL `workspace_id` on insert and update, and indexes `(workspace_id, created_at DESC)` and `assets(rel_path)`. Migration 26 rebuilds the tables whose keys assume one owner.

| Table | Scope | Rule | Changes |
|---|---|---|---|
| `generations` | workspace | Members and grantees see it. `created_by` and `paid_by` are always the acting person (§7.5). Chain, batch and helper steps take the root's workspace only when the actor holds Editor or more there. `favorite` and `pinned_at` move to `item_marks`; review status stays on the row. | +`workspace_id`, `created_by`, `paid_by`, `hold_id`, `dispatch_*` (Studio), `moderation_state` (Platform) |
| `assets` | workspace | Uploads and derived renders belong to the uploader in the workspace they were uploaded to; outputs follow their generation. `/api/files` authorizes through `rel_path` (§7.6). | +`workspace_id`, `created_by`; index `rel_path` |
| `folders`, `folder_items` | workspace, child | A folder, its subfolders and their results share one workspace. `folder_items` stays keyed by `generation_id`: filing an item into a folder of another workspace opens Move; grantees can't file granted items (they Duplicate). | +`workspace_id`, `created_by` on folders |
| `generation_trash` | child | Trash is per workspace; trashing a team item puts it in the team's Trash; emptying is per workspace. | +`trashed_by` |
| `generation_runs` | child | Internal. Deleted with its generation. | +`claimed_by`, `claimed_at`, `heartbeat_at` (Platform scale) |
| `characters` | workspace | @handles unique per workspace; mentions resolve per §7.5. Face elements carry their consent record. | +`workspace_id`, `created_by`; UNIQUE(`workspace_id`, `handle`) |
| `trainings` | child (element) | Follow the element; charged to `started_by`. | +`started_by`, `paid_by` |
| `cinema_projects`, `cinema_folders`, `cinema_items` | workspace, children | Co-edited by Editors. Takes made by anyone are created in the project's workspace. "My Generations" lists only visible projects (`cinema.ts` L448–461 at 76ecd89). | +`workspace_id`, `created_by` |
| `canvases` | workspace | Co-edited (last write wins, as today). Duplicate creates the copy in the chosen workspace. | +`workspace_id`, `created_by`, `edited_by` |
| `layer_projects`, `layer_versions` | workspace, child | | +`workspace_id`, `created_by`; versions +`created_by` |
| `shorts_sessions`, `shorts_presets` | workspace | Presets can be a team's house looks. | +`workspace_id`, `created_by` |
| `brand_kits`, `products`, `ad_batches`, `ad_creatives`, `marketing_runs` | workspace, children | Products follow their brand kit; loose products and runs own themselves. A team policy decides who edits brand kits (Admins only, or Editors). | +`workspace_id`, `created_by` (batches +`created_by`) |
| `palettes` | workspace; built-ins in `w_install` | Built-ins are read by all and written by no one. | +`workspace_id`, `created_by` |
| `moodboards`, `photodump_packs` | workspace | A moodboard's Recraft style id is tied to the key that made it (`style_key_ref`). | +`workspace_id`, `created_by`, `style_key_ref` |
| `faceless_channels`, `faceless_episodes`, `content_series` | workspace, children | Episodes follow their channel; Explainers and draft series own themselves. Voice samples need consent to move. | +`workspace_id`, `created_by` |
| `dub_sessions`, `katana_jobs`, `swap_projects` | workspace | Swap's `revision` already detects concurrent saves. | +`workspace_id`, `created_by` |
| `skills` | workspace | Rebuilt with PK (`workspace_id`, `name`). Resolution: personal, then the active team, then built-in. `/api/assist/skills/[name]/*` (including `run`, `verify`, `estimate`, `recipe`, `download`, `duplicate`) take `?workspace=`; `taken()` and `renameSkillRefs` (`skills.ts` L191–256) work per workspace. | rebuilt |
| `skill_toggles` | user | Rebuilt with PK (`user_id`, `name`). | rebuilt |
| `assist_threads`, `assist_thread_state` | user, child | Only the author sees a chat. A chat inside a team project stays the author's. | +`user_id`, `workspace_id` |
| `assist_projects`, `assist_project_sources` | workspace, child | Team projects share instructions and sources. `use_personal_memory` means each member's own memory, never the creator's. | +`workspace_id`, `created_by` |
| `assist_memory` | user (personal rows), project (project rows) | Personal rows are only ever the owner's (`listMemories`, `memory.ts` L48–67, is filtered by `user_id`); project rows follow the project's workspace. | +`user_id` |
| `assist_schedules` | user | Run as their owner (§7.11); paused when the owner is off. | +`user_id`, `workspace_id` |
| `assist_connectors` | user, or team (Studio) | Rebuilt with UNIQUE(`owner_id`, `slug`). A chat gets only its author's connectors, plus team connectors when the chat is in that team (§7.10). | rebuilt; +`workspace_id` |
| `shares` | user on workspace content | §7.13 | +`created_by`, `workspace_id` |
| `lora_mirrors` | install cache | Library LoRAs stay install-wide; rows for trained LoRAs carry the key that hosted them. | +`key_ref` |
| `settings` | install | Install defaults and admin policy (§7.8). | — |
| `_migrations` | install | | — |
| New core tables | identity, money | `users` … `session_step_up` (§7.1), `notifications`, `consents`, `request_keys`, `mail_outbox`, `provider_keys`, `spend_limits`, `meter_holds`, `meter_entries`, `limit_requests` | new |

| File area | Scope | Rule |
|---|---|---|
| `data/files/**` | workspace through `assets` | `/api/files` ACL; Move re-homes output assets and gives inputs a new asset row; files are refcounted by `rel_path` |
| `data/loras/fuobe/**`, copies in each ComfyUI LoRA folder | follows the element | `attachLora` and request `loras[]` accept only visible elements' files and catalog LoRAs (§7.7); deletion follows the element (§9.5 E5b manifest) |
| `data/datasets/**`, `aitk.datasetDir` | follows the element | Deleted with the element |
| `data/fuobe.db`, `auth.json`, `secret.key`, `setup-code`, `recovery.json`, `backups/` | install | Never served |

A table-classification test fails when a table or file area is not in this list. Every new `_json`/`_url` column goes into `ASSET_REFS` (tables that reference files: `export_jobs`, `quarantine`, `moderation_items`, `announcements`, `legal_docs`, `csam_reports`) or `ASSET_FREE` with a reason (`library.test.ts` L741–746).

### 7.5 Sharing rules

- **Create.** New things land in the **active workspace** (Editor or more). `created_by` and `paid_by` are always the acting person for any row a request starts, including retries, "Run again", storyboard films, Cinema retries, Katana retries, canvas runs and Mixed Media retries. A request that starts rows from an existing root uses the root's workspace only if the actor holds Editor or more there; otherwise it answers 403, or, for derived outputs a viewer may make (a download, a zip), uses the actor's active workspace. Only runner continuations of rows that already exist (waiting chain steps) keep their stored creator. The audit entry names both the actor and the root.
- **Active workspace.** Each tab sends `X-Fuobe-Workspace`. A new tab starts in the person's last-used workspace (`fuobe:u:<id>:space` in localStorage, checked by the server); links from the Inbox, email and team pages carry `?space=<slug>`. Once a person has any team, the "Saving to" chip is always visible (screens §S5.4).
- **Move** (`POST /api/move`): the creator or a source-workspace admin may move into a workspace where the actor is Editor or more. Moving **out of a team** into a personal library needs a team admin. Derived rows and output assets move too; input assets get a new asset row in the target. Face elements and cloned voices ask for consent again. An item that other team rows reference is copied instead of moved. Undo for 8 s.
- **Share** (`POST /api/grants`): only the creator or a workspace admin creates or revokes grants, and only with Editor on the item. The level granted can't exceed the granter's own; viewers and grantees can't re-share. Studio offers a picker of people who share a team with the actor (the full directory needs Editor or more). Platform asks for an exact email and always answers "If {email} has an account, they can see it now. Otherwise, they'll see it after they sign up with this email." (a pending grant by email, attached at sign-up).
- **Duplicate** (`POST /api/duplicate`): new rows and new asset rows pointing at the same files. Copying team content into a personal library follows the team policy "Members may copy team content to their personal library" (off by default in Studio, on in Platform).
- **Cross-workspace inputs.** A job in workspace W may use inputs and elements only from W, `w_install` or grants to W. Using a personal item in a team job needs an explicit confirmation: the request answers 409 `CROSS_SPACE_INPUT` listing the items ("These come from your personal library. Using them copies them into Brand team."), and the asset rows are created only after the person confirms. It is never allowed for runner continuations, schedules, approvals, Assist and MCP tool calls, or runs of a document last edited by someone else.
- **Mentions.** In a personal job `@handle` resolves personal, then grants. In a team job it resolves W, then grants to W, then `w_install`; never the runner's personal elements. Ambiguity is refused with the list. To use a personal character in a team, the person moves or duplicates it there (with consent).
- **Edit grants on projects.** Takes made by a grantee land in the project's workspace with `created_by` = the grantee, paid by the grantee's payer chain.
- **Leaving a team.** The person's work stays with the team; their schedules there pause; their queued jobs in the team are cancelled and released; their share links to team content stop serving (§7.13).
- **Deleting a team.** The team owner chooses "Move everything to another team" (a picker of teams where they are admin) or "Archive for 30 days, then delete". In both cases likeness and voice elements go back to their creators' personal libraries, every member gets an Inbox notice, and the archive can be exported by the owner.

### 7.6 Files and leak closures

- **`/api/files`** authorizes when a visible `assets` row has that `rel_path`. Cache headers: Personal keeps `immutable`; Studio and Platform send `private, no-cache` with an ETag, so revoked access isn't served from cache.
- **Every file read is checked.** `readRef`, `localHead` and a new `readChecked()` (replacing the eight direct `absolutePath()` reads) call `assertReadable(actor, ref)` first. A grep test fails on `absolutePath(` outside `storage.ts` and `file-response.ts`.
- **Every id is declared.** Each route's zod schema marks id fields with `ref(kind)` (path, query, body and nested, e.g. `targetId`, `items[]`, `cover.generationId`, `ids[]`, `folderId`, `projectId`, `brandId`, `items[].productId`, `packId`, `elementId`, `dependsOn`, `existing`, palette-lock `signature`, canvas graph refs, `?brand=`, `?id=`). A sweep test fails on any schema field matching `/(^id$|Id$|ids$|Ref$|url$|urls$)/` that isn't declared. The IDOR matrix runs every declared field as person B against person A's records and expects 404.
- **Live stream.** Each event is checked against the subscriber's current memberships and grants, cached by a version counter that bumps on any membership, grant, role or status change. Delete events carry the workspace. The session is re-validated at least every 60 s and at once on revoke events, then the stream closes. Payloads carry the subscriber's own `favorite` and `pinned_at`. `EventSource` can't send headers, so the stream and GET downloads accept `?workspace=`. The client's `FeedFilter` gains `space` and `matchesFilter` checks it (`generation-stream.ts`); job notifications fire only for rows with `created_by = me`.
- **Other leaks:** `once()` and the brand link-read lock are keyed by user; voice previews and the demo voice live in `w_install` (the requester is `created_by` and pays; reuse is free for others); `assetUses` counts only visible uses ("This file is still used in 3 places you can't see."); `recordVisible` replaces `recordExists`.
- **Browser state.** Sign-in and sign-out are full page loads. React Query keys for workspace data include the workspace id; per-user and install queries stay; `queryClient.clear()` runs only on sign-in and sign-out. localStorage keys go through `src/lib/local-store.ts` with the prefix `fuobe:u:<id>:`; `fuobe.shareLinks` and `fuobe:first-name` are cleared on sign-out.
- **Avatars** are `w_install` assets served at `/api/users/[id]/avatar` to anyone who shares a workspace with that person (404 otherwise).

### 7.7 Provider payload guard

Review 1 found that untrusted `params.extra` and `loras[]` reach the providers unchanged (§3.9): on a shared ComfyUI a request could name `fuobe/bg-remove-birefnet_00042_.png [output]` and read another person's output, attach someone else's trained face LoRA, or on cloud models raise `num_images` or `duration` after the price was computed and, in Platform, switch off safety flags. The guard, in every mode:

- **An allowlist of `params.extra` per model.** Each catalog route gains `extra: { key: { type, min?, max?, enum? } }`. Keys not listed are refused (400 "This setting isn't available for {model}."). Keys that name a media, file, LoRA, model or checkpoint binding are never allowed, nor any string containing `[output]`, `[input]`, `[temp]`, `/` or `\`. The canvas schema's free-form `extra` (`canvas.ts` L121) and `/api/generations/local` follow the same allowlist.
- **`loras[]`** accepts catalog LoRAs and the trained files of elements the actor can see (the `attachLora` rule). In Platform only admin-approved LoRA URLs are downloaded.
- **Price the final payload.** After the provider payload is built, `estimateCost` runs again on the final values (outputs, duration, resolution, steps). If it is higher than the priced request, the request is refused ("This would cost more than shown. Refresh the price and try again."). Safety and pricing fields are written after `extra`, so `extra` can't override them.
- **ComfyUI.** In Studio and Platform each job gets a random `filename_prefix` (`fuobe/<16 random base32 chars>/<workflow>_`), so output names can't be guessed. After outputs are saved, Fuobe deletes the job's `/history` entry (`POST /history {"delete":[id]}`, ComfyUI `server.py` L1305–1316). ComfyUI has no core route to delete input or output files (guess, from reading `server.py`); when the GPU server record has local input and output folders configured (admin-only paths), Fuobe deletes the files; otherwise `/admin/gpu` shows "Files from runs stay on this server. Restrict who can reach it." (§9.4).

### 7.8 Settings split

Resolution order: user, then workspace, then install, then environment, then default. Admin-only keys are never read from user or team settings.

| Key | Scope | Who writes | Why |
|---|---|---|---|
| `install.mode`, `install.signin`, `setup.state`, `setup.draft` | install | owner; env locks them | |
| `install.name`, `install.site_url`, `install.timezone`, `install.contact` | install | owner, admins | Links, cookies, passkeys, the spend month; the contact shown on public sign-in pages (default "the {install name} admin") |
| `signup.*`, `signin.*`, `email.*` | install | admins | Who joins and how |
| `teams.create`, `keys.mode`, `limits.member_default_usd`, `limits.unknown_price` | install | admins | Money policy |
| `spend_limits` (workspace, member in team) | team | team admins | |
| `spend_limits` (user_self) | user | the person | A personal cap |
| fal, Replicate, Anthropic keys | install, team, user | admins, team admins, the person | Resolved by `keys.mode` (§7.12); install keys encrypted in Studio and Platform |
| `civitai.key` | install | admins | Downloads land in shared LoRA folders. Members see "Some LoRAs need the admin to add a civitai key." |
| `comfyui.*`, `aitk.*`, `ollama.url`, `demo.mode`, `models.access`, `engine.mode`, `access.*`, `backup.*` | install | admins (backup: owner) | Server-side fetch targets and server paths |
| `ollama.model`, `enhance.provider`, `cloud.provider`, `theme`, `notify.email` | install default + user | admins, the person | Preferences |
| `shares.public` | install; a team may narrow | admins, team admins | anyone, signed-in only, nobody |
| `guide.dismissed` | user | the person | The first-run guide, per person (replaces the install-wide `onboarding.done` write in `GET /api/status`) |
| `openai.key`, `google.key` | removed | — | Nothing reads them (`settings.ts` L26–27); removed from the UI and API |
| Browser keys | user, per browser | — | Prefixed and cleared on sign-out (§7.6) |

`PUT /api/settings`, `PUT /api/settings/models`, `POST /api/providers/test` and `POST /api/loras` need `install.settings`. Members get `POST /api/me/keys/test`, which accepts only fal, Replicate or Anthropic key values (never URLs), 10 a minute. Members see install settings as "Managed by your admin" with connected flags only.

**Server-side fetch targets.** Link-local and metadata addresses (169.254.0.0/16, fe80::/10, `fd00:ec2::254`, `metadata.google.internal`) are always refused for every target. GPU servers, AI-Toolkit and Ollama may be private addresses (that is their purpose) and are admin-only. OIDC discovery, SAML metadata and classifier URLs at private addresses need the owner. `FUOBE_ALLOW_PRIVATE_URLS` is refused in Platform.
### 7.9 Modes, the setup wizard and the mode switch

**Features, not mode strings.** `src/server/mode.ts` holds a `features()` registry. Each package registers flags as functions of `(mode, signin, settings)`; UI and API gates read flags, never the mode string. Core flags: `signInRequired`, `signUp`, `teams`, `invites`, `admin`, `limits`, `ownKeys`, `teamKeys`, `credits`, `enterprise`. Flags added by mode packages: `passkeys`, `twoStep`, `backups` (Personal packages); `teamsDirectory`, `teamPolicies`, `gpuFairShare`, `gpuPool`, `approvals`, `usageReports`, `sessionPolicies`, `sso`, `scim`, `domains`, `auditViewer`, `dataLifecycle`, `seats` (Studio); `plans`, `payments`, `publicSite`, `launch`, `moderation`, `provenance`, `staffRoles`, `platformAvailable` (Platform).

**Fresh installs before the setup package lands.** From acc-1 until acc-14, a fresh data folder boots as `mode=personal`, `signin=off`, `setup.state=done` (today's behaviour), and the proxy's setup gate stays inert. That keeps the 28 e2e scripts working on every intermediate build.

**The first screen** (owner's `localUse`; screens §S1.1). On a fresh install every page redirects to `/setup`, which shows two choices:

- **Just me on this computer** — "No sign-in. Anyone who can open this address can use Fuobe, so keep it on your own computer or home network."
- **Create your account** — "Sign in with a password from any device. Next, choose whether Fuobe is just for you, for your studio, or a public service."

Choosing Create your account leads to `/setup/start` ("What will this Fuobe be?": Just me, with sign-in / My studio or team / A public service), then the wizard for that mode. Choosing Just me finishes setup.

**The setup code.** `next start` binds every address by default and `Host` is client-controlled, so whoever reaches a fresh install first could claim it. At start the server writes an 8-digit code to `data/setup-code` (0600) and prints, right after Next's banner:

```
Fuobe isn't set up yet. Open this link to set it up:
  http://localhost:3000/setup#code=4821-0937
Only you on this computer? Restart with: pnpm start -H 127.0.0.1
```

The code travels in the URL **fragment**, so it never reaches server or proxy logs; the page moves it into memory and removes it with `history.replaceState`. It is asked for only when the owner commits (the Just me button, or the account form): a person who arrived through the link never sees a field; anyone else sees one inline field under the chosen action ("Enter the setup code from the terminal to finish."). Wrong codes are throttled (after 5 misses, one try per 5 s) and the code is never rotated on failures, so nobody on the network can invalidate the owner's printed code; it rotates only on restart or after setup finishes, when the file is deleted. The integrated design's "rotate after 10 failures" and `?code=` query string were dropped (review 1). Skipping the code when the server binds to loopback only was considered and rejected: a route handler can't reliably see which address the server bound to (guess), and the cost of the code is one paste.

**Wizard steps** come from a step registry, so packages insert their own. Core steps (screens §S1): account → address (Personal) or studio/service details → who can join → email → sign-in methods → teams → who pays (`/setup/keys`, Studio) or free allowance (Platform core) → invite (Studio) → review. Packages insert: restore (Personal backup), sso (company sign-in), security (two-step policy), credits, plans, payments, safety, storage (Platform). "Use recommended settings" fills every remaining step. Each Continue saves `PUT /api/setup/draft`; "Finish setup" writes the mode and `setup.state=done`, deletes `data/setup-code`, audits `install.setup_finished` and does a full page load.

**Headless setup.** `FUOBE_MODE` completes setup at boot from environment variables, or stops with one line naming what is missing ("FUOBE_MODE=studio needs FUOBE_OWNER_EMAIL."). `FUOBE_MODE=personal` with no `FUOBE_SIGNIN` means Just me. The e2e harness and the README's "Browser checks" start the server with `FUOBE_MODE=personal FUOBE_DEMO_MODE=on`, so every existing script keeps working; signed-in suites use their own harness (§13).

**Platform availability.** Until the Platform launch package (acc-57) lands, the "A public service" card is disabled ("Not ready in this version yet") and `FUOBE_MODE=platform` stops the server, unless `FUOBE_DEV_PLATFORM=1` is set for development and tests. That flag forces Preview (sign-up closed except invites) and shows a red banner: "Development build: the public service isn't finished. Don't open it to the public." This stops an operator from running a half-built public service (review 2).

**Switching modes** (Settings → Access → Change mode; owner only, fresh session):

- `snapshotDatabase({ kind: "before-<mode>" })` writes `data/backups/fuobe-<UTC>-before-<mode>.{db,secret.key,json}` first (session rows stripped, §7.16), then the audit row `install.mode_changed`.
- `canLeave(mode)` and `onEnter(mode, from, answers)` registries let packages refuse or ask:
  - **Personal → Studio or Platform** needs a real owner email (checked with a code when mail works) and a site address that isn't loopback.
  - **Studio → Platform** asks which plan existing people get (default Free) and whether Studio limits become credit caps.
  - **Platform → Studio** asks "What happens to the {n} people who signed up here?" with "Turn them off" (default; they become dormant) or "Keep them with a $0 monthly limit"; maps staff roles (billing, moderator, support → member, each confirmed); lists the teams that become Studio teams. It is refused while subscriptions are active ("End the {n} active subscriptions first, or let them run out on {date}.").
  - **Studio or Platform → Personal** makes every non-owner **dormant**: sessions deleted, tokens rejected, schedules paused, queued jobs cancelled and released. Their libraries and teams are kept. The owner keeps full access to every team workspace, listed as "Spaces" in the switcher. Switching back clears dormancy.
  - **Leaving Studio** suspends SSO, SCIM, approvals and seats and keeps their settings.
- `FUOBE_MODE` and `FUOBE_SIGNIN` lock the switch ("Set by the server").

### 7.10 Tokens, MCP, CLI and agents in shared spaces

- **API tokens** are created only from a browser session or the local actor, never from a token. Scopes: Full, Generate only, Read only, Admin; expiry 30, 90 or 365 days or Never (default 365); an optional workspace pin. Each person lists their own; admins can see and revoke anyone's on the person page. `auth.json` tokens are imported as `legacy` Full tokens owned by `u_owner`, keeping their hashes and prefixes, so today's CLI and MCP keep working.
- **A pinned token** sees only the pinned workspace plus grants to it. An `X-Fuobe-Workspace` header that differs from the pin answers 403; MCP `tools/list`, CLI listings and `?space=all` all honour the pin.
- **MCP:** `handleMcp(body, actor)`; tools filtered by scope (Read only gets the read tools, `mcp.ts` L42); prompts are the actor's enabled skills.
- **CLI:** the protocol is unchanged. `--workspace` sends the header; `fuobe status` names the person and workspace. `fuobe login` gains a browser approval flow (§8). The eval harness moves to `GET /api/trainings/targets` (unknown element ids will answer 404) and runs with a scoped token.
- **Agents in shared spaces** (review 1). Assist, MCP and scheduled tasks act as the person who owns the chat, token or task (ASVS 8.3.3), and in a team thread or team project they are **narrowed to that workspace**: tools list and read only W, `w_install` and grants to W; they write only into W; cross-workspace inputs are refused (§7.5); personal memory is used only for the chat's own author. Team connectors (Studio) are offered only in chats inside that team; personal connectors only in the author's chats. Instructions, sources and skills written by teammates are data in the model's context, never authority: every tool call that spends money still goes through the meter, approvals and the person's limits, and Assist shows the plan before running unless the author turned on auto-approve for that chat. A scheduled task in a team project runs as its owner, narrowed to the team, within `min(task cap, remaining limit)`.

### 7.11 Background jobs

- Runners wrap each row's work in `runAs(row owner)` and `withKey(paid_by)`: generations and chains, training polls, the Faceless sweep, Content Factory, the Swap sweep, brand research, ads and Assist turns continued with `after()`. The nine routes that use `after()` today (assist, its messages and approval, schedule run, brands, research, chat confirm, ads batches, Cinema director) keep it, with the actor captured explicitly through `runAs`; with worker roles (§10.10) the continuation runs in the web process that received the request, and its spend still goes through the meter. Long new work runs on instrumentation timers.
- A row whose owner is disabled or dormant fails with "Paused: the account that started this is off."
- **Housekeeping registry** in `instrumentation.ts` (led by the leader lease once worker roles exist): `request_keys` 24 h, `totp_seen` 90 s, `cli_connect_requests` 10 min, expired `auth_verification` and `auth_session`, `auth_rate_limit`, `session_step_up`, `session_activity`, expired invites and join requests, sent `mail_outbox` after 30 days, `notifications` after 90 days, `live_events`, `rate_limits`.

### 7.12 Keys, the one meter, settlement and entitlements

**Who pays.** `keys.mode` (Studio setup "Who pays for runs?"): `install` (team key, else the studio's key), `own` (the person's key; team key first for team jobs; no studio fallback) or `both` (own, then team, then studio within the limit). Personal pays with install keys; Platform with install keys unless the plan allows own keys. The payer is written to `paid_by` at submit and `withKey(paid_by)` is used for every poll, cancel and download of that job (adapters read keys at call time, `fal.ts` L20, `replicate.ts` L18). Install keys stay in `settings` in Personal and are encrypted (AES-256-GCM under HKDF(root, "keys/v1")) in Studio and Platform; team and own keys are in `provider_keys`, always encrypted, never returned.

**Payer-aware readiness** (review 2). `keys.ts` exports `payerFor(actor, provider, workspace)` and `readyFor(actor, route)`. `chooseRoute` and `routeReady` (`generations.ts` L420–441), `isConfigured`, `llmBackends`, training blockers (`training.ts` L149), the Assist and enhance backend choice (`agent.ts` L385, L393, L441, L611; `enhance.ts` L38, L88), `llm.ts` (L107, L131, L467, L482), `cinema-generate.ts` L28 and `loras.ts` L108 all call them. Demo "auto" is decided per payer, so a member with their own fal key and no studio key runs for real. Refusal for `own` mode without a key: "Runs on paid models use your own key here. Add your fal.ai key to start." with "Add key" (screens §S4.7).

**Meter tables** (migration 27): `meter_holds` (`id`, `generation_id` or `kind`, payer, workspace, `budget` usd or credit, `est`, `final`, `gpu_ms`, `status` held, captured, released, `settled_at`), `meter_entries` (append-only), `spend_limits` (install, workspace, member, user_self), `limit_requests`.

**The Budget interface:** `{ admit, reserve, capture, release, adjust, unknownPrice(model) → allow | refuse, mode: charge | record }`. `UsdBudget` serves Personal and Studio; `CreditBudget` serves Platform (§10.2). `record` mode is for Platform staff (capped, §10.2).

**Admission.** Inside `db().transaction().immediate()`: `Budget.admit(ctx)` (entitlements, §below), limits (`LimitReached` → 402 with the refusal line), then the hold. SQLite has one writer, so two requests can't both pass the check.

**Every spend point** reserves first: `createGenerations` (`generations.ts` L691), `recordLocalGeneration` (L1700), dependents at launch (L1028), `startTraining` (`training.ts` L176) including **AI-Toolkit trainings on the open engine** (§10.5), `meter.llm` around `viaClaude` (`enhance.ts` L37), the Assist stream (`agent.ts` L623) and `askLlm` (`faceless.ts` L215). Skills recipes go through `createPipeline`, `createGenerations` and `llmText`, so they are covered. The open engine is metered too: payer `open`, held from the workflow's run statistics and captured from measured GPU time (`PollResult` gains `gpuMs`, from ComfyUI's `execution_start` and `execution_success` timestamps).

**Hold sizes.** Cloud: the price of the final payload (§7.7). LLM: input token estimate × input price + `max_tokens` × output price, captured from `usage`; if a hold is refused mid-turn, the Assist turn ends with the refusal line. Open engine: 1.5 × p75 of `gpu_run_stats` for the workflow; with fewer than 5 samples, the manifest's default seconds or an admin-set maximum per workflow; with neither, a fixed per-run price from the price book, else refused in Platform.

**Settlement: exactly once, from the provider's answer** (review 3):

- Every terminal transition is a compare-and-set inside the same `BEGIN IMMEDIATE` as its ledger entry: `UPDATE generations SET status=? WHERE id=? AND status IN ('queued','running','canceling') RETURNING id`. Only the winner settles. `meter_holds` moves `held → captured | released` once, guarded by the unique key `settle:<hold_id>`.
- **Cancel** releases only when the job provably never ran: no `external_id` and `adapter.submit` not reached; fal answered 200 (removed from the queue); Replicate status `aborted`; ComfyUI removed the prompt from `/queue` before `execution_start`. Otherwise the row becomes `canceling` and keeps polling: if the job completes (or fal answers `ALREADY_COMPLETED`), outputs are kept and captured; if it was stopped after starting, the elapsed cost is captured (Replicate `metrics.predict_time` × rate for time-billed models; the full hold for fal per-output models, since fal may still complete it — fal queue docs: an in-progress cancel returns `CANCELLATION_REQUESTED` and "the request may still complete"; measured `gpuMs` up to `execution_interrupted` for ComfyUI). The same rules apply to the 45-minute and 4-hour timeouts and to cancel-on-arrival in `submit`.
- **Fuobe-side failures after a provider success** (persist, mosaic, post-processing) capture; an operator can refund them as an `adjust` entry with a reason, so margin reports show the cost.
- **Cancel UI:** on a queued job "Cancel"; on a running job "Stop · it has started, so ≈ $0.42 (or ≈ 12 credits) is still charged"; once a row is saving results, cancel answers 409 "Already finishing. This run will be charged."
- **Provider out of funds:** an "insufficient balance" error from fal or Replicate pauses that provider's routes install-wide, alerts admins ("fal.ai says the account is out of funds. Paid fal runs are paused.") and fails the job with a release.
- **Orphans:** if a row is no longer queued or running when `adapter.submit` returns (swept, cancelled), Fuobe cancels at the provider and writes an `orphan` meter entry (operator cost, reason, external id) instead of attaching silently.

**Holds over time and re-pricing** (reviews 3 and 4):

- Holds on non-terminal rows never expire by age (a pipeline behind the GPU queue can wait hours). Only holds whose row is terminal (settled at once) or that have no row (LLM holds: max stream time + 5 minutes, then the reserved maximum is captured) expire.
- When a waiting step launches (`launchStored`), it asserts an active hold. If the re-priced cost is higher, the difference is reserved in the same transaction; if that fails, the step does not fail: it moves to **stopped** (`dispatch_state = 'stopped'`, message "Needs 40 more credits" or "You reached this month's limit"). Finished steps are untouched. The chain card shows "Stopped at step 3 of 5" with "Add credits" (or "Ask for more") and "Continue", which re-runs admission for the stopped steps only. Stopped steps keep 7 days, then cancel and release. Assist shows "I stopped before step 3: not enough credits." with the same buttons; a scheduled task pauses with an Inbox notice. A re-price that crosses an approval threshold re-runs the approval gate (§9.4).
- At capture, a final cost above the hold is never a reason to discard a finished, paid output. Studio records the overage (limits are hard at admission, soft at capture). Platform captures the overage as account **debt** (one step's overage at most), and new paid runs are refused until a top-up or the next grant clears it ("Your last run cost 6 credits more than estimated. Add credits to keep going.").
- Each hold stores its budget kind, so a later mode switch settles it with the budget that created it.

**Request idempotency.** The browser and CLI send an `Idempotency-Key` (a UUID per click) on generation, studio create and retry routes; MCP derives one from the session and tool-call id. `request_keys(user_id, key, route, body_sha256, state, response_json)` is inserted as `pending` in the same `BEGIN IMMEDIATE` as the reserve. A second request with the same key while pending gets 409 `IN_PROGRESS` (clients retry after 1 s); after completion the stored response is replayed; a different body answers 422; a pending key older than 10 minutes is released. Kept 24 hours.

**Entitlements** (`src/server/entitlements.ts`), one module:

- `offered(actor, workspace)` → allowed routes and engines: install switches (`model-access.ts` `requireOffered` L143), then registered narrowers in order: plan (Platform), then team policy (Studio). Used by `prepare()` (replacing `offeredFor`, `generations.ts` L517), listings, pickers, MCP `tools/list`, Assist and the CLI.
- `admit(ctx)` runs inside the reserve for every spend point: re-checks `offered()`, then registered checks (plan caps, storage, unlimited caps, member caps, concurrency). Refusals: 403 `PLAN_REQUIRED`, `STORAGE_FULL`, `VIEW_ONLY`; 402 `NOT_ENOUGH_CREDITS`, `MEMBER_CAP`.
- `gate(kind, actor)` for non-spend actions: token creation, share creation, uploads, team creation, own keys.
- `summary(actor)` feeds `GET /api/me/entitlements` for UI badges.

**Display.** One formatter, `src/lib/price-display.ts` (`formatPrice({usd, credits, modelId, op, engine, payer})`), replaces `costLabel` (`composer.ts` L971), `formatCost`, `formatUsd` and the Faceless `usd()`, and the 51 inline `$${…toFixed}` and `≈ $` sites in components; server strings (`assist-schedule.ts` L275, `assist/context.ts` L54, `assist/tools.ts` L59–65 prices told to Claude and MCP, `cinema-generate.ts` L130) use it too. USD estimates always carry `≈`; credits are exact ("12 credits") or "Up to 18 credits" for open-engine holds. Payer labels: Personal "Your GPU", "fal.ai key"; Studio "Studio GPU", "Studio key", "Team key", "Your key"; Platform shows credits, not payers. Cinema cost caps, Assist auto-run caps and schedule caps are shown and stored in credits in Platform. A sweep test fails any other money formatting.

### 7.13 Share links

- **Creating** a link needs Editor on every item it shows, plus the item workspace's `shares.public` policy (install `anyone`, `signed-in only` or `nobody`, narrowed by teams; Personal offers anyone or nobody). Viewers and grantees can't create links.
- **Serving** re-checks every time: the creator is active (not disabled, dormant or banned), the creator can still view every item, and each item's current workspace still allows public links. Moving an item, leaving a team, revoking a grant or tightening a policy disables affected links and lists them to team admins ("3 links stopped working because Brand team turned off public links.").
- **Proxy:** `/s/<token>` passes without a session only when the share's policy is `anyone`; `signed-in only` requires a session and a person who can view it. "Owner" (no view counted, guard skipped) means the share's creator or an admin of the target workspace, computed only when credentials are present (today any signed-in session counts, `proxy.ts` L50). Unavailable links show the existing "gone" page.
- **Limits:** link creation is rate-limited per person (Platform Free: 20 a day; others 200 a day).

### 7.14 Audit log and notices to the person

- `audit(action, target, meta)` takes actor, IP and user agent from the request scope and never records secrets (ASVS 16.2.5). Core events: `auth.*`, `token.*`, `people.*`, `team.*`, `install.*`, `keys.*` (setting names and masked prefixes only), `limits.*`, `content.share|move|grant`, `denied` (every 403) and `denied.hidden` (rate-limited 404s for invisible records).
- **Tamper evidence:** each row stores `prev_hash` and `hash = SHA-256(prev_hash ‖ row)`; the viewer verifies the chain and shows "Records verified up to {time}" or "The record changed after {time}". Deletes happen only inside the retention purge, which writes its own entry.
- **Notices to the person** when an admin acts on their account: reset email or link, two-step reset, role change, sessions revoked, limit change, view-as, SSO link added. Inbox always; email when mail works.

### 7.15 Recovery, incidents and secret rotation

- **Recovery (one mechanism).** `fuobe recover [--email <address>]` is a local command that opens `data/fuobe.db` directly (never the server), and `FUOBE_RECOVER=<email|owner>` at boot does the same. Both write `data/recovery.json` atomically with mode 0600: the SHA-256 of a 12-character Crockford code (60 bits), valid 30 minutes, 5 attempts. The command prints "Wrote a recovery code for the Fuobe data in {path}: 7KQF-2M9X-HD4P" and refuses to run where it finds no `fuobe.db`. The person redeems it at `/recover#CODE` (screens §S2.6): `POST /api/recover/verify` sets `fuobe_recover` (15 minutes, SameSite=Strict, HMAC under HKDF(root, "recover/v1")) and deletes the file; `POST /api/recover/finish` sets a new password, optionally turns off two-step and removes passkeys, revokes every session, audits and mails. Copy names the exact command for the install: `node bin/fuobe.mjs recover` in the Fuobe folder, or `docker exec <container> node bin/fuobe.mjs recover`.
- **Incident: "Revoke everything"** (owner, `/admin/security`): deletes every session, revokes every API, SCIM and pending CLI token, rotates the trusted-device secret (so "remember this device" cookies stop working), and audits. Copy: "Everyone, including you, signs in again. Scripts and the command line need new tokens."
- **Root secret rotation** (`fuobe secret rotate`, server stopped): generates a new `secret.key`, re-encrypts `provider_keys`, install keys, OIDC and SCIM secrets, TOTP secrets and backup codes, deletes all sessions and recovery cookies (they were signed with the old secret), updates `identity.secret_check`, and keeps the old key as `secret.key.old-<UTC>` until the owner deletes it. The server refuses to start when `identity.secret_check` doesn't match the key it finds, unless `FUOBE_ACCEPT_NEW_SECRET=1`.

### 7.16 Migrating existing installs

First boot of the new build:

1. `wal_checkpoint`, then `snapshotDatabase({ kind: "pre-accounts" })` → `data/backups/fuobe-<UTC>-pre-accounts.{db,secret.key,json}`.
2. Migrations 23–27: identity tables, Better Auth's frozen tables, scoping columns backfilled to `w_owner`/`u_owner` (never by a column default, so a forgotten owner on a new insert fails instead of silently belonging to the owner), the key rebuilds of `skills`, `skill_toggles` and `assist_connectors`, and the meter.
3. A bootstrap awaited in `register()`: root secret and fingerprint; `setup.state`; the legacy password hash imported into `auth_account` for `u_owner`; `auth.json` tokens imported as legacy tokens; `FUOBE_PASSWORD` synced at every boot (it stays the owner's break-glass password).
4. An install with a password becomes Personal with sign-in on; one without becomes Just me. Everyone signs in once more (old cookies are not accepted); tokens keep working.
5. `auth.json` stays in place, unread, for one release as a rollback aid. Files don't move.

**Snapshots and archives never carry live credentials.** `auth_session`, `auth_verification`, `session_step_up`, `cli_connect_requests` and `request_keys` rows are removed from every snapshot copy and archive; restoring signs everyone out. A Litestream replica holds live sessions: the docs say to treat its bucket as credentials (restricted access, server-side encryption). Whether Litestream v0.5 encrypts replicas itself is unverified (guess).

### 7.17 Environment variables

Core: `FUOBE_MODE`, `FUOBE_SIGNIN`, `FUOBE_SITE_URL`, `FUOBE_INSTALL_NAME`, `FUOBE_TIMEZONE`, `FUOBE_SECRET`, `FUOBE_ACCEPT_NEW_SECRET`, `FUOBE_OWNER_EMAIL`, `FUOBE_OWNER_NAME`, `FUOBE_OWNER_PASSWORD` (`FUOBE_PASSWORD` is an alias), `FUOBE_SIGNUP` and `FUOBE_SIGNUP_ALLOWED_DOMAINS` / `_BLOCKED_DOMAINS` / `_AUTO_APPROVE_DOMAINS`, `FUOBE_EMAIL_VERIFY`, `FUOBE_SMTP_URL`, `FUOBE_MAIL_FROM`, `FUOBE_MAIL=log`, `FUOBE_GOOGLE_*`, `FUOBE_GITHUB_*`, `FUOBE_OIDC_*`, `FUOBE_TEAMS_CREATE`, `FUOBE_KEYS_MODE`, `FUOBE_MEMBER_LIMIT_USD`, `FUOBE_SHARES_PUBLIC`, `FUOBE_RECOVER`, `FUOBE_DEMO_PRICED` (honoured only with `FUOBE_DEMO_MODE=on`: demo holds carry the catalog estimate), `FUOBE_TRUSTED_PROXIES`, `FUOBE_DEV_PLATFORM`.

Mode packages add: `FUOBE_BACKUP_*`, `FUOBE_REQUIRE_2FA`, `FUOBE_SSO_*`, `FUOBE_SCIM_TOKEN_SHA256`, `FUOBE_SEATS`, `FUOBE_GPU_FAIRNESS`, `FUOBE_PAYMENTS`, `STRIPE_*`, `FUOBE_TURNSTILE_*`, `FUOBE_CAPTCHA`, `FUOBE_CREDIT_VALUE_USD`, `FUOBE_MARKUP_PCT`, `FUOBE_PLANS_TEMPLATE`, `FUOBE_LAUNCH`, `FUOBE_ROLE`, `FUOBE_WORKER_INDEX`, `FUOBE_WORKER_COUNT`, `FUOBE_TEST_HOOKS`.

Existing variables keep their meaning (`FUOBE_PASSWORD`, `FUOBE_ALLOWED_ORIGINS`, `FUOBE_TRUST_PROXY`, `FUOBE_DATA_DIR`, `FUOBE_DEMO_MODE`, `FUOBE_ENGINE_MODE` and the provider keys). Values set by the environment show as "Set by the server". A missing required value stops the server with one line naming it.

### 7.18 Runner seams and Next 16 rules

- **Launch.** `launch(id, args)` replaces every `void submit(...)` (`generations.ts` L777, L1117; `training.ts` L221). `launchStored(row)` is the re-planning half of `advanceDependents`. A launch-gate registry runs in order (approvals, then the queue hold); the default submits now. `handler()` opens a per-request launch collector for POST/PUT/PATCH and flushes after the handler; with no gate claiming launches, behaviour is identical to today.
- **Post-process.** `postProcess(row, outputs) → { outputs, blocked[] }` runs between saving outputs and the `succeeded` write and capture (`generations.ts` L1481); the row stays `running` with a message. The default is a no-op; Platform adds safety checks, the badge, metadata cleaning and C2PA there.
- **Live source** is pluggable (SQLite TEMP triggers by default; a `live_events` tail with worker roles), with typed events: generation, credits, inbox.
- **Next 16:** authorization re-checked in every route handler; no Server Actions; cookies set only by route handlers; no user data inside `'use cache'`; public cached pages revalidated with `revalidateTag(tag, { expire: 0 })` from route handlers; the proxy stays optimistic.
## 8. Mode 1: Personal

**Who it's for.** One creator, freelancer or developer on their own machine, home server or rented GPU, paying providers with their own keys or running ComfyUI, who wants every setting in their own hands. A second person is Studio.

**Two sub-modes, switchable in Settings → Access:**

- **Just me on this computer** (sign-in off). Anyone who reaches an allowed host is the owner through the `local` actor, exactly as today. Allowed hosts: today's `hostAllowed` (IP literals, localhost, single-label and `.local`/`.lan`/`.home.arpa`/`.internal`/`.localdomain` names, this machine's hostname, `FUOBE_ALLOWED_ORIGINS`) plus "Other addresses" from Settings. `*`, wildcards, IP ranges and public-suffix entries are refused in the UI and API; only `FUOBE_ALLOWED_ORIGINS` may hold `*`. Tunnels that rewrite `Host` (ngrok `--host-header=rewrite`, Codespaces, cloudflared `httpHostHeader`) would make internet visitors look local, so in Just me a request carrying `Forwarded`, `X-Forwarded-For`, `X-Real-IP` or `CF-Connecting-IP` with a non-private address is refused unless a trusted proxy is configured and the host is allowed: "This request came through a tunnel. Turn on sign-in to use Fuobe remotely." Private here means RFC 1918, loopback, link-local, 100.64.0.0/10 (Tailscale's range) and fc00::/7. `/api/identity/*` is unmounted except `sign-in-options`; `/login` redirects to `/`; an invalid bearer token is ignored, a valid one names `u_owner`.
- **Personal with sign-in.** The login card has one password field and never asks for an email (`POST /api/auth/login` shim). A password is always required; passkeys and two-step are extras. Devices, alerts and recovery come from the core and the Personal packages.

**What Personal adds** (6 packages):

1. **Access and remote use** (acc-18): `access.ts` (`allowedHosts()`, `trustProxy()`), read by `crossSite`, `hostAllowed`, `trustedOrigins`, the throttles and the client IP. Settings → Access: site-address checks with plain warnings ("Over plain http, your password can be read on the network. Use https if you open Fuobe from the internet."; "Passkeys work only at an https address or localhost."; quick tunnels refused), Other addresses, Behind a proxy (with the detected IP), and a remote guide: same Wi-Fi with LAN addresses and a QR code, Tailscale Serve (recommended: `tailscale serve --bg 3000`), Cloudflare Tunnel and Caddy (both only with sign-in on), and "Keep the plain port private" (`pnpm start -H 127.0.0.1`). A banner when Just me is used from another device: "You're using Fuobe from another device without sign-in. Anyone who can open {host} can use it and your keys."
2. **Two-step sign-in and passkeys for every account** (acc-19, all signed-in modes): TOTP (6 digits, 30 s, issuer = install name) with 10 single-use backup codes (stored encrypted), a replay guard (`totp_seen` for 90 s), trusted devices for 30 days, passkeys through `@better-auth/passkey` with `rpID` and `origin` set from the site address and `residentKey` and `userVerification` "required" (so a passkey sign-in counts as two steps), at most 10 passkeys, freshness on removing a passkey, turning off two-step or making new codes. After an OAuth or SSO sign-in by someone with two-step on, the session is a restricted `verify-2fa` session until the code is entered (`/two-step`).
3. **New-sign-in alerts** (acc-20): a banner on Home and Settings when another session is newer than this browser last saw ("New sign-in: Safari on iPhone, 12 min ago. Was this you?"), and an email for a device label not seen in 90 days.
4. **Backup and move** (acc-21; owner in every mode): weekly database snapshots (keep 4; Platform daily, keep 7), "Back up now", full `.tar` archives on demand (database snapshot, `secret.key`, `auth.json`, files, trained LoRAs, optional datasets; never `tmp`, backups, mail, setup code, recovery file, the library LoRA cache or `-wal`), `fuobe backup` and `fuobe restore` (server stopped; refuses a live `server.pid` or a non-empty folder; extracts to `.restoring-<UTC>`, checks the SHA-256, then renames), `/setup/restore`. In Studio and Platform a full archive needs a reason, is audited and notifies admins. Archives are not encrypted in v1 (open question).
5. **Browser-approved CLI login** (acc-22): `fuobe login` opens `/settings/account/connect-cli`, which shows the code, the requesting IP and user agent and the time; the default scope is "Generate only"; approval needs a fresh session; requests live 10 minutes; start and poll are rate-limited (10 a minute per client, 30 overall). Tokens near expiry carry `X-Fuobe-Token-Expires` and the CLI warns once a day.
6. **First minute and everyday spend** (acc-23): the terminal lines (§7.9), autofocus in the Get started guide, a footer row "Spent ≈ $12.40 this month" when the engine mode isn't open-only, a personal cap ("Stop paid runs when this month passes $50"), and an e2e check that the first result arrives within 60 s in demo mode.

**Recovery in Personal:** a passkey or backup code; an email code when an owner email is checked and mail works (`/login?forgot=1`); `fuobe recover`; or `FUOBE_PASSWORD`. Without email the forgot-password card shows the exact command to run.

**Personal settings:** `install.signin` (off after Just me, on after Create an account or `FUOBE_PASSWORD`), `install.site_url`, `access.allowed_hosts`, `access.trust_proxy`, `security.sign_in_alerts` (on), `security.trust_device_days` (30), `backup.schedule` / `keep` / `dir` (weekly, 4, `data/backups`), `shares.public` (anyone or nobody).

**Personal threats and answers:** Just me reached by others (honest copy, the banner, the bind hint, the tunnel refusal); password guessing (throttles, the password-only lock, passkeys, recovery); passkey origin confusion (explicit origin and RP ID); two-step bypass (no cookie cache, restricted sessions after OAuth, email resets keep two-step); a lost root secret (fingerprint check, key carried in snapshots); recovery abuse (60-bit code, 5 tries, fragment only, Strict cookie); backup leakage (step-up, single-use download tickets, no sessions inside); CLI phishing (code, IP and user agent shown, fresh session, 10 minutes).

## 9. Mode 2: In-house studio

**Who it's for.** Studios and in-house creative teams of 5–500 people on their own server and GPUs: an owner, admins, auditors, team leads, editors, viewers and clients.

### 9.1 Accounts and joining

- **Sign-up policy** (`policy.ts`): `open`, `approval`, `invite`, `closed`; allowed, blocked and auto-approve domain lists; a vendored disposable-domain list (CC0, `disposable-email-domains`) and a webmail list (`src/lib/webmail-domains.ts`).
- **The Studio default follows the owner: open.** `/setup/join` preselects "Anyone can create an account" with "Only these email domains" prefilled with the owner's work domain (empty when the owner's email is webmail, with the line "Anyone who can reach {site} can join and spend up to the monthly limit on the studio's keys."). Open requires checked addresses: an email code (needs a working mail transport) or Google/OIDC as the only methods. Without either, Open is disabled with "Open sign-up needs email or Google sign-in so we can check addresses. Until then, you approve each person." and the step preselects "I approve new accounts". The server enforces the same rule.
- **Domain trust applies only to checked addresses** (reviews 1 and 4). Domain auto-approve, domain capture and team auto-join apply only to emails Fuobe verified with a code, or asserted (with `email_verified`) by the company sign-in connection bound to that domain. Without a mail transport, "People at these domains join without approval" is disabled, and "Use recommended settings" never turns it on.
- **Approval:** waiting people see "Your account is waiting for approval. We'll email you when it's ready." (without email: "Ask {contact} to approve it."); admins approve in `/admin/people` → Waiting.
- **Invites:** by email (with mail) or as copyable links ("Expires in 72 hours"); single use; a resend invalidates the old link; a resend within 5 minutes is refused ("You sent an invite in the last 5 minutes. Try again soon."); daily limits per inviter (200; Platform Free 20). Invites bypass the policy except blocked domains.
- **Without email:** invites are links; "Forgot password?" says "Ask {contact} for a reset link."; admins create single-use reset links (60 minutes, shown once, audited, the person's other devices signed out, two-step kept).

### 9.2 Own libraries

Every person has a personal workspace created at activation. Everything they make lands there unless they choose a team in the "Saving to" chip. Nobody else sees it — not teammates, not admins — unless the person shares, moves or duplicates it, or the owner turns on the view-as policy (off by default; reason required; the person is told; read-only; 30 minutes; audited; §9.5 E5b). Favorites and pins are per viewer. The Library opens on the active space (screens §S5.6).

### 9.3 Teams and sharing

- **Teams** are workspaces. A person can be in several. Roles: Owner, Admin ("manages people, keys and limits"), Editor ("creates and shares in the team"), Viewer ("sees and downloads, uses no budget"). The last owner can't leave or be demoted; "Transfer ownership" makes the old owner an admin.
- **Who creates teams:** admins only by default in Studio (`teams.create`), everyone in Platform.
- **Directory** (acc-24): `/teams` lists "Your teams" and "Other teams". Visibility per team: Private (only members know it exists; 404 to others), Listed (others see it and "Ask to join", with an optional note; requests expire after 30 days), Open (others "Join" at once as the team's join role, default Editor). New teams start Listed. `/teams/[slug]` is the team home: recent work, folders, projects, characters and styles, brand kits and products, presets, palettes and skills, with "Work in Brand team".
- **Sharing inside a team:** make it there (the chip), Move it there, or Share it (grants to the team or a person, view or edit). The rules are §7.5. Team folders are the team library. Brand kits are editable by Admins only or by Editors (a team policy).
- **Team keys and limits:** team admins add team keys ("Team runs use these keys before the studio's.") and set a team limit and a per-member limit; spend by member is listed.

### 9.4 Team policies, the fair queue, the GPU pool, approvals and reports

- **Team policies** (acc-25) narrow and never widen the install: models and engines (a team narrower in `offered()`), public links, who edits brand kits, team Assist connectors ("Everyone in the team can use these in Assist. Nobody sees the token."), two-step (§9.5 E1), retention (§9.5 E5b) and pinned GPU servers. `resolvePolicy` returns the narrower of the install and team values.
- **One fair queue** (acc-26; Studio and Platform). Rows wait in `generations.dispatch_state` (`queue`, `approval`, `stopped`) with `dispatch_since`, `dispatch_priority`, `lane` (`cloud` or `gpu:<pool>`) and `gpu_server`. The launch gate holds every ComfyUI row when fair share is on, and cloud rows only when an account reaches a concurrency policy (Platform). Nothing is uploaded before dispatch. Pick, on every tick and completion: move-to-front rows first; then the group with the least `GPU-seconds in the last 60 minutes ÷ weight` (Studio: the workspace, weights Low 1 / Normal 2 / High 4 / Highest 8, default Normal; Platform: §10.3); within the group, the person with the least service, and nobody holds two slots on a pool while others wait; then oldest first (chain steps keep their pipeline's age). "First come, first served" skips the fair steps. At most 50 waiting per person (429 "You have 50 runs waiting. Wait for some to finish."); maximum wait 240 minutes (Platform 120), then the row fails and its hold is released. AI-Toolkit trainings count in group service with their measured job time, and each person runs at most one open-engine training per pool at a time. Cards show "Waiting for a GPU · 3 ahead" (refreshed every 10 s) and offer "Run on cloud instead" with the price and payer. Personal submits directly.
- **GPU server pool** (acc-27): `comfy_servers` (label, address, encrypted token, pool `main`/`isolated`/named, `max_outstanding` 2, enabled, draining, pinned teams, LoRA folder, local input and output folders, status, GPU label, VRAM, capabilities). An empty table means `comfyui.url` and `comfyui.isolatedUrl` as today. Probes: `/system_stats` every 30 s; `/object_info` and model lists every 10 minutes; a workflow is runnable on a server when every node class and manifest model is present. Routing: teams with pins use only their servers; otherwise the least loaded unpinned server, preferring one with the models warm. Every call for a job (upload, poll, history, cancel) goes to the server recorded on the row. A server that answers `/system_stats` without a token is flagged: "Anyone who can reach this server can see every run. Add a token or keep it on a private network." AI-Toolkit servers are registered in the same table with pool `trainer`.
- **Approvals** (acc-28; off by default): per team ("Runs over $[ ] need an admin's OK") and for personal spaces on studio keys. Per request the launch collector groups holds by workspace; over the threshold, an `approval_requests` row holds the launches (`dispatch_state = approval`) and the response carries `X-Fuobe-Approval`. Approvers: team admins, or the owner and admins for personal spaces; with no approver the request is automatic. Approve launches; decline and withdraw cancel and release; a second decision answers 409; requests expire after 72 hours. Admins and own-key payers are exempt. Personal-space requests don't show the prompt to approvers ("Private run: details stay with Dana.").
- **Usage reports and alerts** (acc-29): reports by person, team, model, feature, engine, day and payer from `meter_holds`, GPU hours from `generation_runs`, average wait; CSV with a byte-order mark and a formula-injection guard; an SVG day chart with a table behind "Show as table"; 50/80/100% Inbox alerts deduplicated through `notice_sends`; a monthly report email on the 1st at 09:00 (install time zone); "Pause paid runs" for a person (limit 0, previous value kept in the audit entry).

### 9.5 Enterprise

**E1 · Two-step enforcement and session policies** (acc-30). Required for: Off / Owner, admins and auditors (default) / Everyone, with grace Right away / 3 / 7 (default) / 14 days, and per team. After the deadline a person without a second factor gets a restricted `enroll-2fa` session (`/two-step/setup`), and their tokens are refused with `TWO_STEP_REQUIRED`. Sessions: absolute length 8 h / 1 d / 7 d / 30 d (default), idle timeout Never (default) / 30 min / 1 h / 8 h / 24 h tracked in `session_activity` (written at most once a minute), a device cap per person, allowed networks (CIDRs, needs a trusted proxy, refuses a list that excludes your own address), a maximum token lifetime. Two minutes before an idle sign-out a dialog warns "You'll be signed out in 2 min because you've been away." with "Stay signed in"; composer and editor drafts are kept in namespaced localStorage and restored after sign-in ("Restored your draft"). "Sign out everyone" and the owner's "Revoke everything" (§7.15). Platform registers billing, moderator and support under the same requirement.

**E4 · Verified domains and auto-join** (acc-31). Add a domain → a DNS TXT record `_fuobe-challenge.<domain>` with `fuobe-domain-verification=<token>`, checked on demand and daily at 03:00 (resolver timeout 5,000 ms, 2 tries), lapsed after 3 daily misses. The owner may mark a domain verified without DNS (air-gapped installs) with a reason. A verified domain enables domain capture (people with a checked address at that domain can sign up without an invite) and team auto-join (default role Viewer). Each verified domain is bound to at most one company sign-in connection.

**E2 · Company sign-in, OIDC and SAML** (acc-32). `@better-auth/sso` fed from Fuobe's `sso_connections` through `defaultSSO` (`providersLimit: 0`, so nobody registers providers through the API), with InResponseTo checks on, IdP-initiated SAML off, timestamps required, 120 s clock skew, deprecated algorithms rejected and signed assertions required. Rules from review 1:

- A connection may assert identities only in its own bound domains. Creating or editing a connection or a domain binding needs the owner (or the owner's approval from the Inbox), a fresh session and a passing test ("It works. Fuobe received dana@studio.com · Dana Ruiz · groups: Design. No account was created."). "Require company sign-in for studio.com" needs a test passed in the last 24 hours, and keeps a break-glass list (the owner plus up to 2 admins) who may still use passwords.
- `resolveUser` keys accounts by issuer and subject. It links an IdP identity automatically only to an account that has no other credential (provisioned by SCIM or an admin and never signed in) at a bound domain, never to an owner, admin or auditor account. Accounts with a password or passkey link only by the person's own action in Settings → Account ("Connect company sign-in"); otherwise the answer is `account_exists` ("Sign in with your password, then connect company sign-in in Settings → Account."). New people are created just in time at bound domains (on by default), into a default team and role.
- **SAML login CSRF:** at SSO start Fuobe sets a `SameSite=None; Secure; HttpOnly` cookie holding the AuthnRequest id, and the ACS refuses posts without a matching cookie (the plugin parses RelayState with `skipStateCookieCheck: true`, `@better-auth/sso` `dist/index.mjs` L2690). After company sign-in the toast says "Signed in as {email}".
- The ACS path `^/api/identity/sso/saml2/sp/acs/sso-[a-z0-9-]{1,48}$` is the only cross-site POST the proxy exempts. Group claims sync memberships that came from SSO only. `trust MFA` per connection (on by default) skips Fuobe's two-step for that connection's sign-ins.

**E3 · SCIM 2.0** (acc-33). Fuobe's own `/api/scim/v2` (Better Auth's plugin can't write Fuobe's tables): `ServiceProviderConfig`, `ResourceTypes`, `Schemas`, `Users` and `Groups` with `eq` filters and PATCH, mapping `userName`, `emails[primary]`, `name.givenName`/`familyName`, `externalId`, `active`, `groups`; errors in the SCIM error format. Up to 3 tokens (`fuobe_scim_…`, shown once, SHA-256 stored), 600 requests a minute each, 503 outside Studio. **Scope (review 1):** SCIM reads and modifies only people it provisioned (`source = scim` with that connection's `external_id`), never holders of install roles, and never the owner. SCIM-managed accounts sign in only with company sign-in: password sign-in and password reset are off for them, so changing their email can't open a reset path. Groups map to teams with Viewer, Editor or Admin. Delete turns the account off (or deletes after 30 days, a setting). A safety brake stops provisioning when more than 20% of people or 10 accounts an hour would be turned off; the owner resumes it.

**E5a · Audit viewer** (acc-34). The Auditor role (read-only access to audit, usage and people). `/admin/audit`: search; chips Who / What / When / Address; plain sentences ("Dana changed Lee's role to Admin"); a details sheet; chain verification (§7.14); CSV or JSONL export streamed; retention 90 days to 7 years (default 365); an optional HTTPS sink that receives JSONL batches every 60 s. Team Activity shows the team's events without IP addresses.

**E5b · Data lifecycle** (acc-35). Export (zip parts of at most 2 GiB or 20,000 entries with a manifest; scope: the person's personal workspace, plus items they created in teams only with a team admin's consent; optional trained LoRA files), deletion with a 30-day grace and restore (self-delete off by default in Studio: "To delete your account, ask an admin."), purge, retention (per install or team: "Delete results older than N days", previewed, the first run 7 days out with notices, through Trash), legal hold (423 on deletes while on), privacy holds that override purges (CSAM evidence, §10.8), and **view-as** (`access_grants`: Studio policy, off by default, scope = the person's personal library, reason required, person told, read-only, 30 minutes, audited). The **purge manifest** lists what deleting a person, a workspace or an element removes, and a coverage test fails when a table or file area isn't classified:

| Area | On person deletion | On workspace deletion | On element deletion |
|---|---|---|---|
| Rows in workspace tables | personal workspace's rows | all rows | the element and its trainings |
| `assets` and `data/files` | files no longer referenced by visible rows elsewhere (refcount) | same | reference photos not used elsewhere |
| `data/loras/fuobe/*`, each GPU server's LoRA folder copy | the person's elements' files | the workspace's | the element's files |
| `data/datasets/*`, `aitk.datasetDir` | same | same | same |
| Provider copies (`lora_mirrors.hosted_url`, Recraft style ids, uploads to fal/Replicate storage) | deleted where the provider API allows; otherwise listed in the deletion receipt | same | same |
| ComfyUI `/history`, input and output files | history entries deleted; files deleted where folders are configured | same | — |
| `generation_runs`, `item_marks`, `grants`, `notifications`, sessions, tokens | deleted | deleted for that workspace | grants on the element |
| `consents`, `audit_log`, `meter_entries`, Platform ledger and invoices | kept, pseudonymised (accounting and evidence) | kept | kept |

**E6 · Seats** (acc-36). Full seats (make things, spend) and free view-only accounts. "18 of 25 full seats used". Overflow becomes view-only ("Your account is view-only. Ask for a full seat."), with a request queue. `seats.assign` runs inside `BEGIN IMMEDIATE` on every activation path; `effectiveTeamRole` clamps view-only seats to Viewer ("Editor · view-only seat").

**Studio threats and answers:** SSO takeover by email (bound domains, issuer and subject, no auto-link to accounts with credentials or privileged roles); SAML parser bugs (pinned libraries, strict options); cross-site ACS (one exact pattern, RelayState cookie); a rogue connection (owner-only, test before enforce, audit, Inbox); SCIM token theft (scope to SCIM-provisioned people, brake); two-step bypass via OAuth (restricted session); approval splitting (limits stay the hard cap); queue starvation (weights, slot rule, caps); shared ComfyUI exposure (pins, token warning, history cleanup, random prefixes); inspection abuse (view-as off by default, reason, notice, audit); retention mistakes (preview, 7-day notice, Trash, legal hold).
## 10. Mode 3: Platform

**Who it's for.** An operator selling a creative-AI service to the public, with staff (owner, admin, billing, moderator, support) and customers on Free, paid and team plans. Platform reuses the core and the Studio pieces that are mode-neutral (fair queue, GPU pool, audit viewer, data lifecycle, view-as, Inbox, two-step).

**Launch states.** A new Platform starts in **Preview**: `/` shows "Coming soon" with a waitlist; only staff and listed testers (Settings → Launch → Preview access: emails or invite links) can sign in, with a banner "Preview · only staff and testers can sign in · Open to the public". "Open to the public" unlocks only when the launch checklist's required items pass (§10.7). Until acc-57 lands, Platform is a development mode only (§7.9).

**Demo mode in Platform** (review 3): `demo.mode` is forced off unless `FUOBE_DEMO_MODE=on`; the request field `demo: true` is ignored except for staff and server-made skill dry runs. A model whose route isn't ready answers 503 "This model is unavailable right now." and reserves nothing, instead of silently returning placeholder results.

### 10.1 Sign-up and abuse

- **Open by default** (the owner's answer), with: email verification before any free credits; Cloudflare Turnstile through Better Auth's `captcha` plugin on `/sign-up/email`, `/sign-in/email` and `/request-password-reset` (server-side `siteverify`, tokens single-use and 300 s, hostname and action checked; fails closed after a 10 s timeout); disposable domains blocked; emails normalised before checking free-grant uniqueness (lower case, Gmail dots and `+tags`); the `haveibeenpwned` check ("That password has appeared in a data breach. Choose another one."), with an offline top-N list as the fallback when the API is unreachable.
- **Free-credit farming:** one free grant per normalised email; at most 2 grants per device per 30 days and 5 per network per 24 hours, where a network is an IPv4 /24 or an IPv6 /64 (Better Auth had an IPv6 rate-limit bypass, GHSA-p6v2-xcpg-h6xw); a velocity cap of 5,000 credits a day for accounts younger than 72 hours; free runs on the Free pool and cheaper models; per-IP rules only when a trusted proxy is detected (otherwise they are off rather than install-wide, §7.2), and Platform can't open to the public without one.
- **Signals without consent banners** (review 3): the default signals are server-side (IP, card fingerprint, verified email). A device cookie is an option that is consent-gated for visitors from the EU and UK (ePrivacy 2002/58/EC Art. 5(3)); the privacy template states the legal basis for counsel to review.
- **Card testing:** Stripe Checkout only (Stripe's own limiters and Radar); a signed-in account is required to start Checkout; at most 5 Checkout sessions an hour per account and 20 per network; never retry cards from accounts frozen for fraud.
- **Trials and $0 invoices** (a 100%-off first invoice) grant a trial allowance or nothing, never a full plan allowance; promotion codes are limited to first-time transactions and one per card fingerprint.
- **Limits on public endpoints:** `/report` and `/takedown` 10 an hour per network, the waitlist and sales forms 5 an hour, CLI-connect start 10 a minute, invites 20 a day on Free (§9.1), share links 20 a day on Free (§7.13). Counters live in `rate_limits` (SQLite; Postgres or Redis with several hosts).
- **Age:** 18 or older by default (a declared line at sign-up); 16 may be chosen, but likeness, face-swap and training features stay 18+. 13 is not offered (UK Online Safety Act children's duties, the UK Children's Code and DSA Art. 28 apply to under-18s; review 3).

### 10.2 Plans and the credits ledger

**Units.** Integer milli-credits (1 credit = 1,000 units); 1 credit = $0.01 of list price by default (`credits.value_usd`). No floats in the ledger.

**Tables** (acc-37): `credit_accounts` (person or team, plan, frozen, `debt_mc`), `credit_buckets` (`source` plan, topup, promo, admin, refund, trial; `granted`, `remaining` CHECK ≥ 0, `expires_at`, `ref`, `status` active, refund_pending, expired), `credit_ledger` (append-only through triggers; `kind` grant, hold, capture, release, expire, clawback, adjust, debt; signed amount; `bucket_id`, `hold_id`, `generation_id`, `price_version`, `provider_cost_usd`, `actor_id`, `reason`, `idem_key` UNIQUE), `credit_holds` keyed by meter hold.

**Lifecycle** (inside the core admission transaction, §7.12):

- **Reserve** debits buckets in the spending order: the credits that expire soonest first (the plan's monthly credits usually expire first; packs with no expiry last), then the oldest. Short → 402 `NOT_ENOUGH_CREDITS` ("This needs 60 credits. You have 24.").
- **Capture** `min(hold, final)` and return the rest to the same buckets, or to a 7-day refund bucket if those expired. A final above the hold becomes debt (§7.12). **Release** on every core release path.
- **Idempotency keys:** `grant:sub:<subscription>:<period_start>`, `topup:cs:<checkout_session>`, `capture:<hold>`, `release:<hold>`, `clawback:<refund_id>`, `expire:<bucket>:<date>`, `admin:<uuid>`, `code:<redemption>`.
- **Sweeps:** expiry every 10 minutes; a nightly invariant check (sum of buckets = sum of ledger per account; no hold without a row) that alerts on drift.
- **Payer:** the team plan pool for runs in a team with a Team plan; otherwise the runner's own credits ("Paid from your credits" in team workspaces without a Team plan). Staff use `record` mode with a $50-a-day cap per staff account (audited, alert above it).

**Plans** (acc-39; versioned and grandfathered; amounts are guesses):

| Plan | Price | Credits | Concurrency (cloud / GPU) | Queue | Notable |
|---|---|---|---|---|---|
| Free | $0 | 50 a month, after verification | 1 / 1 | Free pool | Badge on results; cheaper models; Unlimited off |
| Starter | $10 a month | 1,000 | 2 / 1 | Normal (2) | |
| Pro | $30 | 3,300 | 4 / 2 | High (4) | Unlimited relaxed on selected models |
| Ultra | $100 | 12,000 | 8 / 4 | Highest (8) | |
| Team | $25 a seat | 3,000 a seat, pooled | 4 a seat, up to 32 | High (4) × seats, capped at 32 | Member caps, seats, team billing |
| Enterprise | By contact | Custom | Custom | Custom | Invoice billing |

Yearly billing is 20% off ("Save 20%" is computed from the prices) with 12 monthly grants. Rollover: none (default) or one month, per plan. Credit packs: 500 credits for $5, 1,200 for $10 and 3,000 for $24 (guesses); no expiry by default (or at least 12 months, an operator setting with a legal note); `topups.require_plan` off. A monthly export of outstanding paid credits supports deferred-revenue accounting.

**Unlimited relaxed** (review 3): only on paid plans and preferably on the open engine; 0 credits, one at a time, a daily cap, a shared low-weight pool, and a per-plan ceiling on the operator's monthly cost, after which the model shows its credit price again. Margin reports include unlimited runs.

### 10.3 Entitlements

The plan narrower and admit checks are registered in the core module (§7.12). Fields, each checked against the request after planning: models (allow and deny by id, family, kind, engine, provider; a price multiplier), features (studios, custom LoRAs, own keys, training, API, MCP, CLI, public links), concurrency (cloud and GPU), queue weight, caps (resolution tier, seconds, outputs and batch, upscale target, training photos and steps, prompt length), storage quota (over quota blocks new runs and offers cleanup; nothing is deleted automatically), optional retention for Free, the badge, API tokens and requests a minute, monthly credits, rollover, top-ups, seats. The owner's rule stands: licences are information, not gates; the plan matrix in `/admin/models` shows non-commercial licence chips prominently, because selling outputs of non-commercial weights is the operator's legal exposure.

**Queue weights in Platform** (review 3): all Free accounts form **one** "Free pool" group (weight 1), and Unlimited relaxed runs form another low-weight pool; inside a pool fairness is per person. Paid accounts keep their own groups (Starter 2, Pro 4, Ultra 8). A Team plan's weight is the plan weight × active seats, capped at 32. While paid work waits, the Free pool may hold at most 25% of GPU slots (shown on `/admin/gpu` → Shares). A test runs 1,000 Free accounts against one Ultra account.

### 10.4 Payments

`PaymentProvider` (`createCheckout`, `createPortal`, `verifyWebhook`, `mapEvent`, `refund`, `changePlan`) with four implementations:

- **None:** credit codes, admin grants and plan requests ("Request this plan" → "Requested · waiting for {service}").
- **Stripe direct** (`stripe` 23.0.x): Checkout `mode=subscription` per plan and interval (prices found by `lookup_key`), `mode=payment` for packs; Stripe Tax on (`automatic_tax`), products with the AIaaS tax codes `txcd_10105001` (personal) and `txcd_10105002` (business); the Customer Portal for payment methods, tax IDs, invoices and cancel-at-period-end only (plan switching happens in Fuobe); `consent_collection` with custom text for the EU 14-day withdrawal waiver.
- **Stripe Managed Payments** (Stripe as merchant of record, 3.5% on top): the same Checkout code with `managed_payments[enabled]=true` and no tax parameters; subscriptions are created only through Checkout and plan changes take effect at the end of the period through the portal (immediate upgrades are not offered; guess about the API limits, checked when the package starts).
- **Fake:** only with `FUOBE_TEST_HOOKS=1` and `FUOBE_DEMO_MODE=on`, never with `launch=public`, and always with a red banner.

**Webhooks** (review 3): `/api/billing/<provider>/webhook` is registered in the proxy's OPEN and cross-site-exempt registries and exempt from the setup gate, Preview rewrites, dormancy, captcha and per-IP limits. The handler reads the raw body (`await request.text()`), verifies the signature (1 MB limit), inserts the event into `payment_events` (deduplicated on `event.id` **and** on `(data.object.id, type)`, because Stripe can send two Event objects for one change) and answers 2xx at once; a worker processes it from the table, re-fetching the canonical object. A **reconciliation sweep** every 15 minutes and at boot lists `/v1/events` since the last cursor (Stripe resends for up to 30 days) and each active subscription's latest invoice, through the same idempotent handler. Health alerts when subscriptions are active and no event arrived in 24 hours. Grants happen only for `invoice.paid` with `billing_reason` `subscription_create`, `subscription_cycle` or a cycle-resetting `subscription_update`.

**Plan changes** (review 3; the parity studio's rule, which values unused credits rather than unused time):

- **Upgrade:** the new period starts now (`billing_cycle_anchor: "now"`, `proration_behavior: "none"`); the customer pays the new plan's full price minus the value of their unused plan credits (credits left × old price ÷ old plan credits, capped at the old price), applied as a one-off credit on that invoice (mechanism checked against Stripe's docs when the package starts; guess: a customer balance transaction). The old plan bucket expires and the new allowance is granted from the paid invoice. Copy: "You pay $26.40 today ($30 minus $3.60 for your 360 unused Starter credits). You get 3,300 credits now, and your plan renews on Nov 29."
- **Downgrade and cancel:** at the end of the period ("Switches to Starter on Dec 1"; "Cancel auto-renewal? You keep Pro until Dec 1."). Downgrade and Cancel are always visible.
- **Seats:** adding seats charges the prorated amount now and grants seat credits × the remaining fraction of the period; removing seats takes effect at period end, and pooled credits are never refunded.
- **Unpaid invoice:** plan and seat changes are refused while the latest invoice is unpaid or past due ("Pay the open invoice first."). Past due: a top banner with "Update payment"; paid runs continue within remaining credits for 7 days; then the subscription cancels at Stripe's retry end.
- **Refund** (self-serve within 14 days of an initial purchase with nothing spent from that purchase's bucket): in one transaction the bucket becomes `refund_pending` (excluded from available credits), then `stripe.refunds.create` with idempotency key `refund:<bucket>`; success expires the bucket and cancels the plan, failure unfreezes it. **Disputes** freeze the account ("Paid runs are paused while a payment is reviewed.") and claw back credits; a refund of spent credits becomes debt and admin review.
- **Auto-recharge** (Stripe direct only): one charge in flight per account (`UNIQUE(account) WHERE status='pending'`), idempotency key `recharge:<account>:<seq>`, at most 3 a day, turned off after any failure or `authentication_required` with an Inbox notice.
- **Tax display** (review 3): consumer plans show prices including tax by default (Stripe Tax inclusive, estimated by locale; EU UCPD Art. 7(4)(c) and Directive 98/6/EC); Team and Enterprise show "plus tax". Setup warns: "Stripe calculates zero tax where you haven't registered."

### 10.5 Credit prices

`creditsFor` in `src/lib/credits.ts`, shared by client and server: a fixed rule if set, else `usd × (1 + markup) ÷ value`; then a minimum; then rounding up (to 0.1 below 10 credits, else whole). Defaults: markup 50%, GPU $2.16 an hour ($0.0006 a second). Examples: FLUX.2 [pro] 1 MP at $0.03 → 4.5 credits; Kling 3.0 5 s 1080p at $0.62 → 93 credits; 60 s of GPU → 5.4 credits. Open-engine holds and captures follow §7.12 (with no statistics, a fixed per-run price or refusal). AI-Toolkit trainings on the open engine are priced per target (fixed) or from the measured job time × the GPU rate, and need the `training.open` entitlement. Claude calls (enhance, Assist, Faceless writing) are charged by tokens. Unknown prices are refused unless an admin sets a fixed price. A nightly sync reads fal's pricing API (`GET https://api.fal.ai/v1/models/pricing?endpoint_id=`) and flags changes for admin approval ("Price changed at fal: Kling 3.0 now costs $0.70. You charge 93 credits ($0.93); your margin falls to 33%."). Rules below cost show "Below cost: you lose ≈ $0.04 per run".

**Reconciliation and the spend guard** (review 3): store provider-reported cost when available (Replicate `metrics.predict_time` × the hardware rate; fal per-output units); compare each provider's monthly invoice total with the summed `provider_cost_usd` and alert above 5% drift; an operator "maximum provider spend per hour and per day" pauses paid cloud routes and alerts; the launch checklist asks the operator to set provider-side spend caps too.

### 10.6 Account and billing pages

`/settings/billing` (plan, credits by bucket, auto-recharge, payment method, invoices, refund when eligible), the change-plan sheet with the exact charge before confirming, top-up, `/billing/success` (polls every 2 s for up to 60 s, then "This is taking longer than usual. Your payment went through; your plan will switch in a few minutes. We'll tell you in your Inbox."), cancel → `/pricing?checkout=cancelled` ("Payment cancelled. You're still on Free."), `/redeem`, the credits pill, composer credit states, `/settings/usage` in credits, the welcome card, and after email verification with a plan picked on `/pricing`, straight to Checkout ("Email confirmed. Taking you to payment…"). Specs: screens §S8.

### 10.7 Admin panel

`/admin` with Platform sections (screens §S9): Overview (launch checklist, revenue, paying people, credits, margin, "Needs you"), People (with Credits, Billing and Safety tabs; adjust credits with role caps; support access by consent), Teams, Plans (versioned editor), Credit prices, Codes, Payments (payments, subscriptions, disputes, webhooks with Retry), Models & features (plan matrix with licence chips), Moderation, Bans, Announcements (banner and RFC 8058 email), Analytics, Audit (the shared viewer), Settings (Launch, Service & legal, Payments, Credits, Safety, Abuse, Storage & backups, Email & DNS) and Health. Staff roles: billing (payments, refunds, codes), moderator (moderation, bans), support (people, view-as by consent), each with caps on credit adjustments (support 500 credits per action, billing 10,000, admin unlimited).

**Launch checklist** (required items gate "Open to the public"; "{n} of 12 required steps done"):

| Required | Optional |
|---|---|
| Payments connected, or "No payments" chosen | C2PA signing certificate (otherwise self-signed) |
| Legal pages set (Terms, Privacy, AUP) | Hash matching (PhotoDNA or Safer), with the NCMEC registration status recorded |
| Email transport passing a test | DMCA agent registered |
| Captcha keys passing a test | Litestream or another off-host backup |
| Site address on https | Announcements email stream |
| A trusted proxy detected | |
| Prompt checker chosen and passing | |
| Output checker for every engine that is on | |
| Two-step on for every staff account | |
| Every GPU server has a token or is private | |
| A provider spend cap set (Fuobe and provider side) | |
| A backup taken in the last 24 hours | |

### 10.8 Trust and safety

**Blocks by default; a check that can't run withholds** (review 3):

- **Inputs:** a normalised word list in `admit` (minors combined with sexual terms; known abuse phrases); a prompt classifier before submit (Llama Guard 3 on Ollama, or an HTTP endpoint; 3 s; a timeout or error **blocks** with "We couldn't check this prompt. Try again."); image inputs (uploads, references, training photos) pass the image classifier before submit.
- **Provider flags:** `enable_safety_checker: true`, `safety_tolerance: 2` (written after `extra`, §7.7), never `disable_safety_checker`; `has_nsfw_concepts` kept in meta instead of being dropped (`payload.ts` L449 at 76ecd89).
- **Outputs** in the `postProcess` stage, required for every engine that is on: fal `x-ailab/nsfw` ($0.001 an image) or a local classifier on the operator's GPU (ShieldGemma 2 or the Falconsai ViT behind an HTTP worker), so open-engine-only operators aren't forced onto fal; video: 5 frames. Without an output checker for an engine, that engine's custom LoRAs, face swap and training stay off. A result whose check failed or didn't run is **withheld** ("Being checked · usually a few minutes"), not shown to the requester. Blocked: "This result was blocked by the safety check. 12 credits refunded." with "Appeal".
- **Refunding blocked results:** `charge_blocked` is off (blocked results are refunded), but after 5 blocked results in 24 hours refunds stop and generation pauses pending review.
- **Sexual content** is always blocked in Platform. **Likeness and voices:** a consent dialog before any real-face or voice feature ("This is me, or I have written permission from this person, and they're 18 or older."), recorded in `consents` with the asset ids.
- **CSAM:** a hash-matching hook (PhotoDNA or Thorn Safer; recommended, not required, with the owner's choice and NCMEC status recorded); on a match: block, quarantine to restricted storage, suspend, draft a report record with the fields NCMEC needs, keep for 1 year through `privacy_holds` overriding deletion (18 U.S.C. §2258A; Pub. L. 118-59).
- **Reports and takedowns:** a Report button on share pages, posts and team items; `/report` (categories) and `/takedown` (NCII, 48-hour removal under the TAKE IT DOWN Act from 2026-05-19, with perceptual-hash blocks of copies); a DMCA notice and counter-notice flow with a repeat-infringer policy; strikes; statements of reasons (DSA Art. 17) and appeals for 6 months; a moderation queue with SLA timers.
- **Provenance:** a C2PA manifest on every image and video output (`@contentauth/c2pa-node`; self-signed until the operator uploads a certificate; signed last), the provider watermark kept, a visible "AI-generated" chip on share pages, a small badge on Free results; share-file cleaning keeps APP11 C2PA segments in every mode.

### 10.9 Legal (templates, not legal advice)

Fuobe ships editable templates under `/legal/*` (Terms, Privacy, Acceptable Use, Cookies) with placeholders from settings, versioned, with re-acceptance when they change (a restricted `accept-terms` session). The operator's checklist (Settings → Service & legal) lists, with a short plain explanation each: tax registrations or a merchant of record; NCMEC registration and hash-service applications; a DMCA agent ($6, renewed every 3 years); DSA points of contact (Art. 11 and 12) and an EU legal representative for non-EU operators (Art. 13); a GDPR Art. 27 representative, Art. 28 processing agreements and a public sub-processor list (fal, Replicate, Anthropic, Stripe, Cloudflare, the storage host) and Art. 30 records; UK Online Safety Act illegal-content and children's-access risk assessments; an Illinois BIPA written release and a public retention schedule for face training data; the EU AI Act Art. 50 marking (from 2 August 2026, with a grace period to 2 December 2026 for systems already on the market); the EU 14-day withdrawal waiver at checkout. Each template says at the top: "This is a starting point, not legal advice. Have a lawyer review it."

### 10.10 Scale

- **One host by default:** SQLite with WAL, short synchronous transactions, `.immediate()` for admission, daily snapshots (keep 7) and a Litestream guide. Postgres is deferred until 2 hosts are needed, p95 write wait passes 50 ms, or the database passes 200 GB.
- **Worker roles** (acc-54): `FUOBE_ROLE` all, web or worker; `FUOBE_WORKER_INDEX` and `COUNT`. A leader lease runs the dispatcher and the housekeeping sweeps. **Submit and launch claims live in SQLite** (review 3): `generation_runs.claimed_by`, `claimed_at`, `heartbeat_at` joined to `worker_heartbeats`; `READY_DEPENDENTS` and `launchStored` claim a row with a compare-and-set before any upload; `sweepInterrupted` fails only rows whose claim heartbeat is stale; `once()` and `request_keys` are in SQLite. Polling is partitioned by `hash(id) mod FUOBE_WORKER_COUNT` and ordered by `last_polled_at` (today the tick polls the 50 oldest rows, `generations.ts`, so new jobs can starve behind long videos). Live events go through a `live_events` table tail.
- **Object storage:** a storage driver (local, or S3/R2/MinIO); private reads redirect to presigned GET URLs valid 300 s after the ACL check; share files are streamed through Fuobe.
- **Restore runbook:** restore the snapshot or Litestream copy, start in maintenance, replay Stripe events from the snapshot time through the idempotent handler, reconcile holds against provider jobs, then open.
- **Observability:** OpenTelemetry through `@vercel/otel`, `/api/admin/metrics` (Prometheus format), structured logs with generation, account and provider request ids. `scripts/capacity.mjs` targets 500 active jobs with a p95 collection delay under 10 s.
## 11. Every screen as a spec

The screen specs are long, so they live in [`accounts-8-screens.md`](accounts-8-screens.md). Every screen there has its route, who sees it, layout at 1440 px and 390 px, the copy, empty, loading and error states, what each action does, and keyboard and screen-reader behaviour; light and dark use only the existing tokens. Index:

| § | Screens |
|---|---|
| S0 | Conventions: layout and look, phone rules and the `ResponsiveDialog` primitive, the visibility matrix (who sees which Settings section, menu item and admin page in each mode), forms, states, accessibility, terms |
| S1 | Setup: the first screen, mode choice, account, address, studio or service details, who can join, who pays, email, sign-in methods, teams and invites, review, restore |
| S2 | Sign-in and recovery: `/login` in every variant, the two-step step and `/two-step`, `/register`, `/verify`, `/reset`, `/invite/[token]`, `/recover`, the copy for every sign-in refusal code |
| S3 | Shell: account menu and phone sheet, Inbox bell, workspace switcher, banners, Confirm it's you, the member welcome card |
| S4 | Settings: sub-nav, Account, Passkeys and Two-step, Usage, Access, Backup, Connect the command line, composer refusal lines and payer hint, Data & privacy and restore, generation and chain card states |
| S5 | Teams and sharing: Create team, team settings, leave, transfer and delete, the Saving-to chip, Share, Move, Duplicate and the cross-space confirm, Library spaces |
| S6 | Admin core: shell and nav, Overview, People and the person page, Teams, Usage & limits |
| S7 | Studio: team directory and home, approvals, security and two-step setup, company sign-in, provisioning, domains, seats, audit and data, GPU |
| S8 | Platform for customers: welcome and pricing, Coming soon and legal, register and welcome card, billing and credits, redeem, safety screens |
| S9 | Platform admin: Overview and launch checklist, plans, people tabs, credit prices and models, codes, moderation, analytics, bans, payments and health, announcements, settings |
| S10 | Platform setup steps: credits, plans, payments, safety, storage |
| S11 | Routes added to the layout checks |
| S12 | Email templates: subject and body for each |

## 12. Threat model

| Threat | How it is handled | § |
|---|---|---|
| IDOR on about 120 id-taking routes (path, query, body) | DAL `scope.get`, uniform 404, declared `ref(kind)` ids, route sweep, IDOR matrix over every declared field | 7.4, 7.6 |
| A missed check in new code | Four fail-closed layers: NULL-workspace triggers, actor-less DAL throws, route sweep, IDOR matrix; table and file-area classification test | 7.4 |
| Reading another person's files (`/api/files`, `readRef`, direct `absolutePath`) | ACL by `rel_path`, `assertReadable` on every read, grep test | 7.6 |
| Reading other people's ComfyUI outputs or using their LoRA through `params.extra` | Per-model allowlist, refused annotations and paths, `loras[]` rule, random prefixes, history deletion | 7.7 |
| Running more than was priced (extra outputs, longer duration) | Final payload priced again; safety and price fields written after `extra` | 7.7 |
| Live stream leaks and stale access after revocation | Per-event visibility with a version counter, session re-check every 60 s, close on revoke | 7.6 |
| Existence oracles (record pages, handles, `assetUses`) | `recordVisible`, per-workspace handles, scoped uses, `denied.hidden` audit | 7.4, 7.6 |
| Publishing someone else's work; stale links | Editor plus policy at creation; re-check at every serve; links stop on move, leave, revoke | 7.13 |
| Re-sharing beyond one's level; viewers sharing | Grants need Editor, can't exceed the granter's level; only creator or admin grants | 7.5 |
| Personal data entering team spaces (inputs, mentions, agents) | 409 `CROSS_SPACE_INPUT`; team mentions never resolve personal elements; agents narrowed to the thread's workspace | 7.5, 7.10 |
| Wrong person billed or audited | `created_by` and `paid_by` always the actor; jobs polled with the key that submitted them | 7.5, 7.12 |
| Spend races and double charges | `BEGIN IMMEDIATE` admission; one settlement per hold (CAS); pending idempotency keys | 7.12 |
| Free compute by cancelling a running job | Settlement from the provider's answer; `canceling` keeps polling | 7.12 |
| Second accounts before isolation exists | Sign-up off the allowlist and `user.create.before` refusing until the meter package | 7.1 |
| Setup takeover on a fresh, exposed install | Setup code asked at commit, carried in the fragment, throttled, never rotated by failures | 7.9 |
| Just me reached from the internet | Honest copy, bind hint, other-device banner, tunnel refusal, no `*` in Other addresses | 8 |
| Session theft and fixation | Server sessions, no cookie cache, `__Host-` cookies on https, tokens never in page scripts, revocation, step-up | 7.1, 7.2 |
| Install-wide sign-in lockout through the limiter | No IP rules without a trusted proxy; per-account throttle by email hash; soft global throttle | 7.1, 7.2 |
| Password guessing | Per-account throttle, password-only lock that lifts, blocklist, breached-password check (Platform), passkeys | 7.2, 10.1 |
| Account enumeration | Uniform answers and timing for sign-up, reset, sharing by email; picker limited to shared teams | 7.2, 7.5 |
| OAuth or SSO account takeover | No trusted providers; Better Auth's local-verification rule; bound domains; auto-link only to credential-less, non-privileged accounts; issuer and subject keys | 7.1, 9.5 |
| Domain squatting (registering ceo@studio.com unchecked) | Domain trust only for checked addresses; disabled without mail | 9.1 |
| SAML parser and signature bugs; SAML login CSRF | Pinned versions, strict options, signed assertions, InResponseTo, RelayState cookie, exact ACS exemption | 9.5 |
| SCIM token theft | Tokens hashed and scoped to SCIM-provisioned people; no install roles; company sign-in only; brake | 9.5 |
| Admin abuse (taking over the owner, silent impersonation) | Target-role matrix; reset never clears two-step; view-as off by default, reasoned, notified, audited; notices to the person | 7.3, 7.14 |
| Better Auth plugin bugs | Minimal plugins, router-only allowlist, exact pins, OSV watch, behaviour-pin tests | 5.2, 7.1 |
| SSRF through settings or connections | Admin-only targets; metadata and link-local always refused; private OIDC/SAML/classifier targets need the owner | 7.8 |
| Secrets at rest and in backups | AES-GCM for new and (Studio, Platform) install keys; no sessions in snapshots or archives; fingerprint check; rotation procedure | 7.12, 7.15, 7.16 |
| Lost or stolen recovery codes | 60-bit code, 0600 file, 5 tries, 30 minutes, fragment only, Strict cookie, mailed notice | 7.15 |
| Audit tampering | Hash chain, purge writes its own entry, export | 7.14 |
| Payment replays, forged or lost webhooks | Signature on raw body, event and object dedupe, reconciliation sweep, restore replay | 10.4, 10.10 |
| Credit gaming (upgrade timing, seats, refunds racing spends, auto-recharge loops) | Unused-credit valuation, seat rules, refund freeze first, single-flight recharge | 10.4 |
| Credit farming and card testing | Verification, captcha, normalisation, device and network limits, velocity cap, Checkout throttles, Radar | 10.1 |
| Selling below cost; runaway provider spend | Price sync, margin alerts, reconciliation, spend guard, provider out-of-funds pause | 10.5, 7.12 |
| CSAM, NCII, likeness abuse | Layered checks that withhold on failure, hash matching, quarantine and holds, consent, 48-hour takedowns | 10.8 |
| Staff abuse | Role caps, consent-based view-as, record-mode cap, two-step required, audit | 10.7, 9.5 |
| Multi-process double launches | SQLite claims with heartbeats, CAS before upload | 10.10 |
| Browser leaks on shared computers | Full reloads on sign-in and out, namespaced storage, no-cache files in Studio and Platform | 7.6 |

## 13. Tests

**Harness.** `tests/setup/actor.ts` (Vitest `setupFiles`) runs each test as the local owner unless it calls `asNobody()`, and the default `FUOBE_MODE` in tests is `personal`, so the 171 existing files keep passing (acc-2). `tests/helpers/actors.ts` seeds people, teams and roles and wraps a `Request` with a session cookie or bearer token. Suites that encode one owner are rewritten in the package that changes the behaviour: `auth.test.ts` and `runtime-auth.test.ts` (acc-1), `share-links.test.ts` L255, L430, L487–583, L534 (acc-6), `mcp.test.ts` (acc-5), `cli*.test.ts` (acc-1, acc-22), `assist-schedules.test.ts` (acc-5), `cinema-fixes.test.ts` "My Generations" (acc-4), `eval-api.test.ts` and `eval-harness.test.ts` (acc-4, the new targets route), and the `ASSET_REFS`/`ASSET_FREE` coverage in `library.test.ts` (every package adding columns).

**Sweeps that stop forgetting:** route sweep (every `route.ts` through `handler()`); table and file-area classification; `ref(kind)` declaration sweep; the IDOR matrix driven from declarations; the `absolutePath(` grep; the price-display sweep; the `extra` allowlist enumeration; the schema guard; the purge-manifest coverage.

**Money and settlement:** every spend point reserves; 20 concurrent creates against a $1 limit; every release path; per-provider cancel states (queued, in progress, already completed, aborted, interrupted); cancel racing success with injected delays (exactly one settlement); re-price above budget stops and Continue resumes; LLM hold expiry; open-engine `gpuMs`; idempotency pending, replay and 422; Platform ledger with two processes; payment changes (upgrade on the last day, seats added then removed, change while past due, partial refunds, dispute won and lost, duplicate Event objects, an event missing for 4 days then reconciled, a portal change, a $0 invoice); refund racing a spend; auto-recharge with 20 parallel reserves (one charge).

**Multi-process (acc-54):** two workers with 50 ready dependents give 50 submissions; a web upload longer than 2 minutes isn't swept; crash mid-submit and mid-persist; web plus leader.

**Security:** proxy matrix (mode × path × credential × host, setup gate, public registry, tunnel refusal, headers); live stream after revocation; cross-space 409; agent narrowing; role × action matrix; SSO (mock OIDC IdP, samlify test IdP with signature-wrapping cases, login CSRF refused); SCIM scope and brake; payload guard cases; limiter without a trusted proxy (10 different emails in 10 s all succeed; failures for one account never cause a 429 for another).

**End to end.** Existing scripts run unchanged against `FUOBE_MODE=personal FUOBE_DEMO_MODE=on` (Just me). New suites: `setup-wizard`, `personal-setup` (first result under 60 s), `personal-signin` (CDP virtual authenticator, TOTP), `personal-recovery`, `personal-backup`, `personal-access`, `personal-cli`, `accounts`, `studio-teams`, `studio-approvals`, `studio-security`, `studio-sso`, `studio-scim`, `studio-admin`, `platform-signup`, `platform-billing` (fake payments, `FUOBE_DEV_PLATFORM=1` until acc-57), `platform-admin`, `platform-safety`. **Layout matrix:** `no-horizontal-scroll` runs for six seeded roles — Just me, Studio owner, Studio member, Platform signed out, Platform customer, Platform admin — each with a saved Playwright `storageState`, at 1440 and 390 px in light and dark, with route lists from the registries (screens §S11), including the account menu with 10 teams and the two-step setup sheet at 390 px.

## 14. How the four reviews changed the plan

All must-fixes are applied. Should-fixes are applied unless the last column says otherwise.

### 14.1 Security review

| Finding | What changed | § / package |
|---|---|---|
| **Must:** `params.extra` and `loras[]` reach providers unchanged | Payload guard: allowlists, LoRA rule, final-payload pricing, prefixes, cleanup | 7.7 / acc-7 |
| **Must:** domain trust on unchecked emails | Only checked addresses; disabled without mail | 9.1, 9.5 E4 / acc-11, acc-14, acc-31 |
| **Must:** SSO and SCIM can take over accounts | Bound domains, owner-only connections, no auto-link to credentialed or privileged accounts, SCIM scope, SCIM accounts company-sign-in only | 9.5 E2, E3 / acc-32, acc-33 |
| **Must:** admin actions have no target rule | Target-role matrix; resets keep two-step; notices | 7.3, 7.14 / acc-12 |
| **Must:** constant client IP makes one limiter bucket | No IP rules without a trusted proxy; per-account throttle | 7.1, 7.2 / acc-1 |
| **Must:** `created_by` inherited from roots | Always the actor; root workspace only with Editor | 7.5 / acc-3, acc-4 |
| **Must:** sharing rules missing | Editor to share, level cap, no re-share, serve-time re-checks | 7.5, 7.13 / acc-6, acc-17 |
| **Must:** personal data enters teams via inputs, mentions, agents | 409 confirm, mention rule, agent narrowing | 7.5, 7.10 / acc-5, acc-6 |
| **Must:** token pin overridable | Pin limits reads and writes; header mismatch 403 | 7.10 / acc-3, acc-5 |
| **Must:** open SSE streams ignore revocation | Per-event checks, 60 s re-validation, close on revoke | 7.6 / acc-6 |
| **Must:** second accounts before isolation | Sign-up off the allowlist; create hook until the meter package | 7.1 / acc-1, acc-8 |
| Setup code rotates on failures, travels in the query | Throttle, never rotate; fragment | 7.9 / acc-14 |
| Permanent 423 lock | Lifts after 24 h and on passkey, second factor or reset; keyed by email hash | 7.2 / acc-11 |
| Backups carry live sessions | Sessions stripped; restore signs out; Litestream bucket treated as credentials | 7.16 / acc-1, acc-21 |
| `*` in Other addresses; identity routes in Just me | Refused; unmounted | 8 / acc-18 |
| Host-rewriting tunnels expose Just me | Forwarded non-private requests refused | 8 / acc-18 |
| SAML login CSRF | RelayState cookie | 9.5 E2 / acc-32 |
| SSO issuer origins in `trustedOrigins` | Dropped; request origin only in Personal | 7.1 / acc-1 |
| `/update-user` image and names | Image stripped; names limited and escaped | 7.1 / acc-1, acc-11 |
| No `__Host-` cookies | `__Host-` on https (mechanism pinned by a test) | 7.1 / acc-1 |
| Owner email marked verified without a code | Checked with a code once mail works; until then reset only via `fuobe recover` | 7.9, S1.3 / acc-14 |
| Invites grant privileged roles too freely | Inviter's own assignable roles; admin invites need a checked email; daily limits | 7.3, 9.1 / acc-12 |
| Enumeration through sharing and the picker | Uniform email answer; picker limited | 7.5 / acc-17 |
| Server-side fetch targets set by admins | Metadata and link-local always refused; private OIDC, SAML and classifier targets need the owner; `FUOBE_ALLOW_PRIVATE_URLS` refused in Platform. **Partly rejected:** GPU servers, AI-Toolkit and Ollama stay settable by admins at private addresses, because that is what they are for | 7.8 / acc-2, acc-27 |
| ComfyUI keeps everyone's files and history | Token warning, history deletion, random prefixes, folder cleanup where configured | 7.7, 9.4 / acc-7, acc-27 |
| No audit tamper evidence; 404s unlogged | Hash chain, purge entry, `denied.hidden`; **partly rejected:** log streaming is one HTTPS JSONL sink, not syslog (one format covers common log tools; guess) | 7.14, 9.5 E5a / acc-2, acc-34 |
| Lazily created links fail open | Created pending | 7.1 / acc-1 |
| IDOR matrix misses body and query ids | `ref(kind)` declarations and sweep | 7.6 / acc-6 |
| Creators can move team work out | Moving out needs a team admin; copying out is a team policy | 7.5 / acc-17 |
| Deleting a team re-homes others' likeness | Archive or move; likeness and voice back to creators | 7.5 / acc-17 |
| Install keys in plain text | Encrypted in Studio and Platform. **Partly rejected for Personal:** the owner's keys stay as today, because the root secret would sit on the same disk; Personal gains nothing but complexity | 7.12 / acc-8 |
| CLI device flow phishing | IP, user agent and time shown; Generate-only default; rate limits | 8 / acc-22 |
| Last-hop client IP wrong behind CDN + nginx | Configurable hops or CIDRs; detected IP shown | 7.2 / acc-1, acc-18 |
| Inbox links and notes user-influenced | Links stored as validated relative paths; bodies rendered as text | S3.2 / acc-11, acc-13 |
| Missing: agent authorization in shared spaces; admin-action notices; revoke everything; secret rotation; public endpoint limits; ComfyUI and AI-Toolkit hardening; body-id and stream tests | All added | 7.10, 7.14, 7.15, 10.1, 9.4, 13 |

### 14.2 Engineering review

| Finding | What changed | § / package |
|---|---|---|
| **Must:** sign-up open from core-1 to core-7 | Hard close in acc-1 | 7.1 / acc-1 |
| **Must:** fresh installs and e2e break between packages | Fresh dirs boot as Just me until acc-14; e2e with `FUOBE_MODE=personal` | 7.9 / acc-1, acc-14 |
| **Must:** actor-less DAL breaks ~100 suites | Default-actor setup file; list of suites to rewrite | 13 / acc-2 |
| **Must:** readiness and demo read install keys | `payerFor` and `readyFor` everywhere; demo auto per payer; own-key refusal copy | 7.12 / acc-8 |
| **Must:** limiter shares one bucket | Same as the security finding | 7.1 / acc-1 |
| **Must:** Platform selectable before its safety and money exist | Disabled until acc-57; `FUOBE_DEV_PLATFORM` forces Preview | 7.9 / acc-14, acc-57 |
| **Must:** Platform → Studio has no step for public accounts | `onEnter(studio, from=platform)` with dormancy default and staff mapping | 7.9 / acc-57 |
| **Must:** AI-Toolkit trainings not priced, metered or queued | Held and captured; priced in Platform; counted in fair share; one per person per pool | 7.12, 9.4, 10.5 / acc-8, acc-26, acc-38 |
| **Must:** IDOR only on path ids; direct `absolutePath` reads | Declarations, sweep, `readChecked`, grep test | 7.6 / acc-6 |
| **Must:** E5b doesn't list what is deleted or exported | Purge manifest and export scope; coverage test | 9.5 E5b / acc-35 |
| **Must:** Studio default departs from the owner's answer | Open preselected with the owner's work domain; approval only as a fallback without checked addresses | 6.3, 9.1 / acc-14 |
| **Must:** admin and Platform screens too thin | Full specs | screens S6–S10 |
| Packages too big | core-3 → acc-3/4/5; core-7 → acc-11/12/13; core-8 → acc-14/15/16; pl-03 → acc-39/40; pl-06 → acc-43/44 | 16 |
| Platform staff not required to use two-step; Platform could ship without E1 | Staff registered under E1; acc-57 depends on acc-30 | 9.5 E1 / acc-30, acc-57 |
| `civitai.key` scope | Install, admin only, member copy | 7.8 |
| Members hit the install first-run guide | Member welcome card; per-person `guide.dismissed`; footer status for admins only | S3.6, 7.8 / acc-13 |
| Members can't test own keys | `POST /api/me/keys/test` (keys only) | 7.8 / acc-8 |
| Live feed and notifications per workspace | `FeedFilter.space`, per-viewer marks, own-job notifications, `?workspace=` | 7.6 / acc-6 |
| Folder semantics with grants | Move dialog across workspaces; grantees duplicate | 7.4 |
| Grant authority and enumeration | Creator or admin; level cap; uniform email answer | 7.5 |
| Skill name resolution | Personal, active team, built-in; `?workspace=` | 7.4 / acc-5 |
| `assist_memory` project rows | Follow the project; personal memory only the author's | 7.4 / acc-5 |
| Avatars | `w_install` assets with a shared-workspace ACL | 7.6 / acc-6, acc-13 |
| `ASSET_REFS`/`ASSET_FREE` | Rule per package | 7.4 |
| No housekeeping for TTL tables | Registry | 7.11 / acc-10 |
| Eval harness relies on unknown-id answers | `GET /api/trainings/targets` | 7.10 / acc-4 |
| USD outside the formatter in Platform | Server strings and caps converted; sweep extended to inline formatting | 7.12 / acc-10 |
| Hold sizes for Claude and cold GPU stats | Defined | 7.12 / acc-8 |
| `after()` contradiction | Kept with explicit `runAs` in every package of this plan; with worker roles it runs in the receiving web process | 7.11 |
| Owner loses team content in Personal | Owner keeps team spaces | 7.9 / acc-15 |
| Full archive bypasses privacy | Reason, audit, admin notice in Studio and Platform | 8 / acc-21 |
| Thin briefs (SCIM mapping, Stripe events, partition rule, `dispatch_state` timing) | Written; holds on live rows never expire, so no package depends on `dispatch_state` for expiry | 9.5 E3, 10.4, 10.10, 7.12 |
| Pins break the 14-day rule | Rule re-checked; table of what it gives today | 5.2 |
| Two OIDC mechanisms | `genericOAuth` for buttons; company IdPs only through E2 | 7.1 |
| "Signed-in only" share policy not in the proxy | Proxy rule | 7.13 / acc-6 |
| Voice previews payer | Requester pays; reuse free | 7.6 |
| Hidden-row denials not audited | `denied.hidden` | 7.4 |
| Smaller gaps (`/login` in Just me; Platform team without a plan; docs) | `/login` → `/`; runner's credits pay; each package updates `docs/STATUS.md`, README and ARCHITECTURE where behaviour changes | 8, 10.2, 16 |

### 14.3 Money and operations review

| Finding | What changed | § / package |
|---|---|---|
| **Must:** cancel and timeout release after the provider started | Settle from the provider's answer; `canceling`; Stop copy | 7.12 / acc-9 |
| **Must:** unconditional terminal writes | CAS in the ledger transaction; one settlement per hold | 7.12 / acc-9 |
| **Must:** worker roles keep in-memory guards | SQLite claims with heartbeats; orphan entries | 10.10, 7.12 / acc-54, acc-9 |
| **Must:** plan and seat changes can be gamed | Unused-credit valuation, seat rules, no changes while unpaid, portal limited | 10.4 / acc-45, acc-46 |
| **Must:** lost, late, duplicated events | Store-then-process, double dedupe, reconciliation, exemptions, grant keys by period start, refund keys | 10.4 / acc-43 |
| **Must:** refund and auto-recharge races | Freeze first; single-flight recharge | 10.4 / acc-45, acc-46 |
| **Must:** holds expire or settle at the wrong time | No age expiry on live rows; launch re-reserve; LLM hold rule; budget kind on holds | 7.12 / acc-9 |
| **Must:** idempotency misses in-flight duplicates | Pending state and 409 | 7.12 / acc-10 |
| **Must:** Platform fair share can be gamed | Free pool, Unlimited pool, team weight × seats, 25% cap | 10.3 / acc-39 |
| **Must:** safety depends on add-ons; failures undefined | Required per engine; withhold on failure; launch checklist | 10.8, 10.7 / acc-49, acc-50, acc-57 |
| Demo mode in Platform | Forced off; `demo: true` ignored; 503 for missing routes | 10 / acc-49 |
| Open-engine holds without statistics | Manifest default, admin maximum or fixed price | 7.12 / acc-8, acc-38 |
| Reconciliation and a spend kill switch | Provider cost capture, invoice reconciliation, spend guard | 10.5 / acc-56 |
| Tax-exclusive consumer prices | Inclusive for consumers, exclusive for B2B | 10.4 / acc-46 |
| Farming gaps (IPv6, normalisation, $0 invoices) | Fixed | 10.1 / acc-48 |
| Fake payments in production | Test hooks and demo only; never public; banner | 10.4 / acc-43 |
| Unlimited relaxed costs real money | Paid plans, open engine preferred, cost ceiling | 10.2 / acc-39 |
| Blocked results refunded forever | Stop refunds and pause after 5 in 24 h | 10.8 / acc-50 |
| Runner throughput | `last_polled_at` polling, partitioning, capacity targets | 10.10 / acc-54 |
| Device cookie needs consent in the EU | Server-side signals by default; cookie consent-gated | 10.1 / acc-48 |
| Minimum age 13 | 18 default, 16 allowed, likeness 18+ | 10.1 / acc-48 |
| Staff record mode unbounded | $50 a day cap | 10.2 / acc-37 |
| Pack expiry and breakage | No expiry by default; deferred-revenue export | 10.2 / acc-37 |
| Missing: provider spend kill switch and balance exhaustion; restore runbook; orphan report; legal checklist; portal configuration; payment-change and multi-process tests | All added. Managed Payments plan changes happen at period end only (immediate upgrades not offered; a limitation, not a rejection) | 7.12, 10.4, 10.5, 10.9, 10.10, 13 |

### 14.4 UX review

| Finding | What changed | § / package |
|---|---|---|
| **Must:** first screen is a code gate | Owner's two-choice first screen; code at commit | 7.9, S1.1 / acc-14. **Rejected part:** skipping the code on loopback-bound servers (a route handler can't reliably see the bind address; guess) |
| **Must:** auto-approve without email | Disabled without mail; preset falls back | 9.1 / acc-14 |
| **Must:** Inbox has no trigger | Bell with a badge in the sidebar header and PhoneBar; "Needs you" chip on Home for approvers. **Partly rejected:** Inbox stays in the account menu as a second entry | S3.2 / acc-13 |
| **Must:** Library IA undefined | One space control above the kind tabs; Shared renamed Links; Favorites, Trash and Uploads per space; "Made by me" filter | S5.6 / acc-17 |
| **Must:** new tabs fall back to Personal | Last-used space; `?space=` links; chip always shown | 7.5 / acc-17 |
| **Must:** members see admin and setup surfaces | Visibility matrix; member welcome card | S0.3, S3.6 / acc-13, acc-15 |
| **Must:** own-keys path not designed | Refusal line with Add key; "Use my own key"; welcome chip | 7.12, S4.7 / acc-8 |
| **Must:** out of money mid-chain | Stopped steps, Continue, debt instead of discarding | 7.12, S4.9 / acc-9 |
| **Must:** checkout states | Cancel page, success timeout, post-verify routing, request state | 10.6, S8.4 / acc-44 |
| **Must:** moderation from the person's side | Sign-in copy, appeals, card states, notices, ban effects | S8.6, S2.7 / acc-51 |
| **Must:** Platform admin as one-liners | Full specs and the enumerated checklist | S9, 10.7 / acc-40, acc-41, acc-57 |
| **Must:** no Create team screen; Platform team payer unclear | Dialog; teams without a plan pay from the runner's credits; seat-charge copy | S5.1, 10.2 / acc-17, acc-45 |
| **Must:** deletion and export dialogs | Specified incl. Studio "ask an admin" | S4.8 / acc-35 |
| **Must:** bottom sheets break at 390 px | `ResponsiveDialog` with max height, scroll, safe area; AlertDialog kept for destructive confirms | S0.2 / acc-13 |
| **Must:** missing copy | Written (setup bullets, refusal codes, invite states, banners, Transfer ownership, email templates) | S1.2, S2.5, S2.7, S3.4, S5.3, S12 |
| **Must:** empty states | Written for every list | S6–S9 |
| Settings rows stacking | Sub-nav not sticky; StatusStrip on General for admins | S4.0 |
| Switching clears every query | Workspace in keys; `clear()` only on sign-in and out | 7.6 |
| Many teams in the menu | 5 recent, search from 8, All teams | S3.3 |
| Terminology drift | Personal and Teams; "space" only as umbrella | S0.5 |
| Owner's name on public pages; `.invalid` placeholder | `install.contact`; placeholder never shown | 7.8 |
| Recovery command copy | Exact command per install | 7.15 |
| Step-up for SSO-only people loses the form | Pending action restored | 7.2 |
| Team deletion removes others' access | Move or archive, notices | 7.5 |
| Idle timeouts lose work | Warning and draft restore | 9.5 E1 |
| Buttons nested in radio cards | Actions below the group | S1.2 |
| `/verify` wrong address | "Use a different email" | S2.4 |
| Share by email copy | Written, uniform | 7.5 |
| Pricing details | Calculator, FAQ, Enterprise form, lower-plan CTAs | S8.1 |
| Price label conflicts | `≈` for USD only; payer labels per mode | 7.12 |
| Preview testers | Preview access list and staff banner | 10 |
| Saving-to chip on phone | Own 32 px row | S5.4 |
| Layout e2e can't reach new screens | Six-role matrix with saved sessions | 13 |
| Token rows thin | Name field, expired rows, admin revoke | S4.1, S6.3 |
| Dark-mode status colours | Mapped to existing tokens; contrast checked | S0.1 |

## 15. Risks and unknowns

**Risks**

- **Better Auth's advisory cadence.** An urgent fix may need a reviewed migration (the schema guard forces it) and re-running the behaviour pins. Several behaviours this plan relies on were read from the 1.7.14 files, not run: `$context.internalAdapter`, cookie overrides, `disableIpTracking`, hook order and request scope inside hooks (guesses until acc-1's pin tests pass).
- **SQLite with two connections and many timers.** Better Auth's connection and Fuobe's share one writer; busy waits are possible during long writes. acc-1 has a stress test; the fallback is `transaction: false` on Better Auth's adapter. Platform past one host needs Postgres (§10.10).
- **Converting about 40 modules and 192 routes.** The sweeps make forgetting fail CI, but the IDOR fixtures must keep pace with new routes and tool paths.
- **Estimates drive limits in Personal and Studio.** `cost_usd` is the list price, not the provider's bill; the copy says "≈" and "Amounts are estimates from each model's list price, not your provider's bill."
- **Guessed money defaults:** the $25 member limit, the 50% markup, plan prices and credits, pack prices, the $2.16 GPU hour.
- **SAML's history** (ruby-saml, samlify, node-saml and xml-crypto bypasses) and `defaultSSO` being documented for testing in Better Auth.
- **Unencrypted backup archives** and plain install keys in Personal.
- **Operator legal exposure** in Platform (CSAM reporting, TAKE IT DOWN, DSA, AI Act, GDPR, tax). The templates are not legal advice.
- **Classifier error rates** (ShieldGemma 2's numbers are from an internal benchmark; Llama Guard is text-first) and processor eligibility for face and likeness tools.
- **`@contentauth/c2pa-node`** downloads a native binary and needs Node 22 or newer.
- **Same-day npm releases:** pins are re-resolved by the §5.2 rule when each package starts.

**Unknowns (guesses to confirm when building)**

- Whether ComfyUI has any core route to delete input and output files (none found in `server.py` v0.43.1).
- Whether Stripe Managed Payments allows immediate plan changes through the API, and the exact mechanism for crediting unused plan credits on an upgrade.
- Whether Litestream v0.5 encrypts replicas itself.
- Whether a route handler can see the bound address (for a loopback setup shortcut).
- Whether fal and Replicate bill failed jobs in every case (the plan follows fal's "you pay only for successful outputs" and Replicate's lifecycle page).
- Whether `lora_mirrors` copies hosted on one provider account can be used by another account's key.

**Open questions for the owner**

1. Default member limit $25 a month, Platform markup 50%, and the plan prices in §10.2?
2. Studio sign-up: open limited to the owner's work domain (assumed), or open to anyone with an email check?
3. Should admins see each person's own-key spend totals (assumed yes, totals only)?
4. Encrypt full backup archives with a passphrase?
5. Free tier: 50 monthly credits (assumed), daily credits, or none?
6. View-only seats free (assumed yes)?
7. A community feed: in scope for Platform?
## 16. Build plan

All 57 packages in one dependency order. Keys run `acc-1` to `acc-57`; each title starts with the mode it serves or "Core". The core lands first (accounts, own libraries, teams, sharing), then Personal, then the Studio enterprise set, then Platform, as the owner asked.

**Rules for every package.**

- **Leaves Fuobe working in every mode.** Mode packages are inert in other modes (their `features()` flags are off). Until acc-14, fresh installs boot as Just me; until acc-57, Platform is a development mode only (`FUOBE_DEV_PLATFORM=1`, forced Preview).
- **Never breaks** demo-mode e2e (the server started with `FUOBE_MODE=personal FUOBE_DEMO_MODE=on`), API tokens (legacy imported tokens and new scoped ones), MCP (`/api/mcp` with a bearer token and its Origin check), share links (`/s/<token>` and `/s/<token>/f/…`), `FUOBE_PASSWORD` (break-glass owner password, synced every boot) and "Just me on this computer". Each brief names what else it must not break.
- **Checks:** `pnpm typecheck`, `pnpm lint`, the targeted tests, the full Vitest run, the e2e scripts the package touches, and a browser check at 1440 and 390 px in light and dark with no horizontal scroll for every new screen (screens §S11 lists the routes).
- **Versions:** each new dependency is pinned by the §5.2 rule on the day the package starts.
- **Docs:** each package updates `docs/STATUS.md`, `README.md` and `docs/ARCHITECTURE.md` where it changes behaviour; acc-17 changes STATUS's "Accounts" row from not done to partly done.
- **Owner decisions** in §6 are not reopened by a package; a package that finds one impossible stops and asks.

| # | Package | Depends on | Effort |
|---|---|---|---|
| acc-1 | Core: identity base (Better Auth behind Fuobe, identity tables, bootstrap, principal, proxy registries, snapshots, security headers) | — | large |
| acc-2 | Core: actor context on every route, role and permission registries, audit writer, runners carry an actor | acc-1 | large |
| acc-3 | Core: scoping columns and the data-access layer for the library, files and records | acc-2 | large |
| acc-4 | Core: scoping in every studio module (Cinema, Canvas, Layers, Shorts, brands and ads, Faceless, Content Factory, Dub, Katana, Swap, elements and training) | acc-3 | large |
| acc-5 | Core: scoping in Assist, skills, recipes and MCP; agents narrowed in shared spaces | acc-3 | large |
| acc-6 | Core: leak closures (files ACL, checked reads, declared ids, live-stream isolation, share rules, browser state) | acc-4, acc-5 | large |
| acc-7 | Core: provider payload guard (params.extra allowlist, LoRA rule, final-payload pricing, ComfyUI prefixes and cleanup) | acc-6 | medium |
| acc-8 | Core: paid keys, the one meter and the entitlements module, with the usage page | acc-7 | large |
| acc-9 | Core: exact settlement (compare-and-set terminal writes, cancel from the provider's answer, stopped steps, debt-free capture) | acc-8 | large |
| acc-10 | Core: runner seams (launch collector, postProcess, live source, idempotency, one price formatter, housekeeping) | acc-9 | large |
| acc-11 | Core: sign-in pages, sign-up policy, mailer, consents and the notifications store | acc-10 | large |
| acc-12 | Core: install invites, approval queue and admin actions on people (with the target-role matrix and notices) | acc-11 | medium |
| acc-13 | Core: recovery, Inbox, account menu, Confirm it's you, the account page and the member welcome | acc-12 | large |
| acc-14 | Core: first-run setup (owner's first screen, setup code at commit, wizard registry) and headless setup | acc-13 | large |
| acc-15 | Core: mode switch, Settings → Access and the settings visibility matrix | acc-14 | medium |
| acc-16 | Core: admin console core (/admin shell, Overview, People and the person page, Usage & limits) | acc-15 | medium |
| acc-17 | Core: teams and sharing (team workspaces, switcher, Saving-to chip, Move, Share, Duplicate, Library spaces, team keys and limits) | acc-16 | large |
| acc-18 | Personal: access and remote use (address checks, other addresses, trusted proxy, remote guide, Just me honesty) | acc-15 | medium |
| acc-19 | Personal: two-step sign-in and passkeys for every account in every signed-in mode | acc-13, acc-18 | large |
| acc-20 | Personal: new-sign-in alerts | acc-13 | small |
| acc-21 | Personal: backup and move (snapshots, full archives, fuobe backup and restore) | acc-15 | large |
| acc-22 | Personal: browser-approved fuobe login and token expiry warnings | acc-13 | medium |
| acc-23 | Personal: the first minute and everyday spend | acc-15 | small |
| acc-24 | Studio: team directory, team home, visibility and join requests | acc-17 | large |
| acc-25 | Studio: narrow-only team policies and team Assist connectors | acc-24 | medium |
| acc-26 | Studio: one fair queue for Studio and Platform | acc-17, acc-10 | large |
| acc-27 | Studio: GPU server registry (pools, team pins, probes, sticky routing, drain) | acc-26 | large |
| acc-28 | Studio: approvals for runs over a threshold | acc-25, acc-26 | large |
| acc-29 | Studio: usage reports, budget alerts, monthly report, pause paid runs | acc-24, acc-26 | medium |
| acc-30 | Studio: two-step enforcement and session, device, network and token policies (E1) | acc-19, acc-25 | large |
| acc-31 | Studio: verified domains, domain capture and team auto-join (E4) | acc-24 | medium |
| acc-32 | Studio: company sign-in with OIDC and SAML (E2) | acc-30, acc-31 | large |
| acc-33 | Studio: SCIM 2.0 provisioning owned by Fuobe (E3) | acc-32 | large |
| acc-34 | Studio: audit viewer, export, retention and the Auditor role (E5a, shared by Platform) | acc-24 | medium |
| acc-35 | Studio: data lifecycle (export, deletion and restore, purge manifest, retention, legal hold, privacy holds, view-as) (E5b) | acc-34, acc-25 | large |
| acc-36 | Studio: full seats and free view-only accounts (E6) | acc-33 | medium |
| acc-37 | Platform: credit ledger and CreditBudget | acc-17 | large |
| acc-38 | Platform: credit price book (per-model rules, GPU-second and AI-Toolkit pricing, credit display) | acc-37 | large |
| acc-39 | Platform: plans and entitlements engine (versions, narrower, admit checks, pools, concurrency, team pools) | acc-38, acc-26 | large |
| acc-40 | Platform: plan editor, model matrix, user locks and /setup/plans | acc-39, acc-16 | medium |
| acc-41 | Platform: admin people with credits, staff roles and the Platform overview | acc-40, acc-34 | large |
| acc-42 | Platform: credit codes and redeem, plan requests, bans, consent-based support access | acc-41, acc-35 | medium |
| acc-43 | Platform: payment core (PaymentProvider, fake provider, webhook route, event store, reconciliation, grants) | acc-41 | large |
| acc-44 | Platform: checkout and billing pages (Checkout, success and cancel, /settings/billing, top-ups, redeem, plan requests) | acc-43 | large |
| acc-45 | Platform: plan changes, seats, dunning, refunds and disputes | acc-44 | large |
| acc-46 | Platform: Stripe adapter (direct and Managed Payments), tax, portal, promotion codes, auto-recharge | acc-45 | large |
| acc-47 | Platform: public site, legal documents, re-acceptance, Coming soon and Preview access | acc-44 | large |
| acc-48 | Platform: abuse controls (captcha, breached passwords, signals, free-grant guards, throttles, rate limits) | acc-44 | medium |
| acc-49 | Platform: input safety (word list, prompt classifier, image inputs, provider flags, likeness consent) | acc-37 | medium |
| acc-50 | Platform: output safety via postProcess, withheld results, quarantine, refunds and the CSAM workflow | acc-49, acc-35 | large |
| acc-51 | Platform: moderation queue, reports, NCII takedowns, DMCA, strikes, statements of reasons and appeals | acc-50, acc-42 | large |
| acc-52 | Platform: provenance (C2PA signing, certificate, C2PA-safe share cleaning in all modes, badge, AI labels) | acc-50 | medium |
| acc-53 | Platform: privacy defaults on the E5b engine | acc-45, acc-51 | small |
| acc-54 | Platform: worker roles, leader lease, SQLite claims, partitioned polling and cross-process live events | acc-39, acc-27 | large |
| acc-55 | Platform: object storage with presigned reads, daily snapshots and the Litestream guide | acc-21 | medium |
| acc-56 | Platform: analytics, price sync, reconciliation, spend guard and observability | acc-46, acc-54, acc-29 | large |
| acc-57 | Platform: launch checklist, announcements, Studio and Platform switch hooks, headless Platform and full E2E | acc-30, acc-46, acc-47, acc-48, acc-51, acc-52, acc-53, acc-55, acc-56 | medium |

### 16.1 Core

#### acc-1 · Core: identity base (Better Auth behind Fuobe, identity tables, bootstrap, principal, proxy registries, snapshots, security headers)

_Effort: large. Depends on: none._

- **Sections:** §7.1, §7.2 (password format), §7.9 (fresh installs), §7.15 (secret fingerprint), §7.16, §5.2 (version rule).
- **Files:** package.json (better-auth exact, per §5.2 rule); new src/server/identity/{auth.ts, password.ts, principal.ts, bootstrap.ts, admin-ops.ts, refusals.ts}; src/server/mode.ts (features registry); src/server/backup/snapshot.ts; scripts/auth-schema.mjs; src/server/db.ts (migration 23 identity tables, 24 frozen Better Auth SQL); src/app/api/identity/[...all]/route.ts; shims src/app/api/auth/{login,logout,password,tokens}/route.ts; src/proxy.ts; src/instrumentation.ts (awaited bootstrap); next.config.ts headers().
- **Behaviour:** Better Auth configured exactly as §7.1: own better-sqlite3 connection, auth_* table names, HKDF secret from FUOBE_SECRET or data/secret.key, __Host- cookies on https via useSecureCookies:false plus per-cookie names, ipAddressHeaders x-fuobe-client-ip written by the proxy only when a trusted proxy is configured, disableIpTracking otherwise, cookieCache off, telemetry off. The router-only endpoint allowlist excludes /sign-up/*, /sign-in/social and /sign-in/oauth2/*; user.create.before refuses any create other than claim-owner and the bootstrap import unless accounts.multi_user=1 (not set by this package). Bootstrap: wal_checkpoint and a pre-accounts snapshot with session rows stripped; root secret and identity.secret_check (refuse to start on mismatch unless FUOBE_ACCEPT_NEW_SECRET=1); import the auth.json password as u_owner's (legacy salt:hash verifies, upgraded to scrypt$v2 N=2^15 r=8 p=3 on sign-in) and tokens as legacy Full tokens; sync FUOBE_PASSWORD every boot. A fresh data dir boots as personal, sign-in off, setup.state=done; a password install becomes Personal with sign-in. The proxy resolves bearer tokens from api_tokens and the Better Auth cookie, keeps DNS-rebinding, crossSite and share logic, and gains OPEN and CROSS_SITE_EXEMPT registries. The login shim signs u_owner in with one password field and answers with a full reload. Security headers: X-Frame-Options DENY and frame-ancestors 'none' except /s/:path*, no-store on auth pages.
- **Tests:** identity-bootstrap matrix (no password, password, FUOBE_PASSWORD, tokens, fresh dir); schema guard (getMigrations finds nothing to create or add); allowlist (router-only; auth.api passes; POST /api/identity/sign-up/email answers 403 and creates no auth_user row); password formats and upgrade; proxy matrix (Just me, password install, bearer, cookie, share link); security headers; snapshot has no auth_session rows; fingerprint mismatch refuses start; admin-ops reachability pin; Better Auth behaviour pins (cookie names and attributes on http and https, disableIpTracking skips IP rules, request scope inside hooks, returnHeaders); 50 sign-ins during runner writes with busy waits under 1 s.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; every existing Vitest suite (FUOBE_MODE=personal default); the eval harness; the only visible change is one re-sign-in on password installs.


#### acc-2 · Core: actor context on every route, role and permission registries, audit writer, runners carry an actor

_Effort: large. Depends on: acc-1._

- **Sections:** §7.1 (principal, restricted kinds), §7.3, §7.11, §7.14 (audit chain), §13 (test harness).
- **Files:** new src/server/access/{actor.ts (ALS RequestScope, currentActor throws, runAs, asSystem), route.ts (handler({access, scopes}) with the restricted-kind registry and the substituteActor seam), permissions.ts (role and permission registries, effectiveTeamRole), gates.ts (no-op), audit.ts (append-only, prev_hash chain)}; every src/app/**/route.ts (192 at 545ebb5, including the skills recipe run, verify, estimate and recipe routes); src/server/mcp.ts (handleMcp(body, actor)); runner entry points in generations.ts, training.ts, faceless.ts, swap-studio.ts, content-factory.ts, assist/schedules.ts, assist/agent.ts, brand.ts, ads.ts; vitest.config.ts setupFiles += tests/setup/actor.ts; new tests/helpers/actors.ts.
- **Behaviour:** Every handler resolves an actor through handler(); install-config routes (PUT /api/settings, PUT /api/settings/models, POST /api/providers/test, POST /api/loras) need install.settings (the Personal owner and the local actor pass); typed errors map to 404, 403, 401, 402 and 403 REAUTH; every 403 is audited; runners and after() continuations run inside runAs(row owner) or asSystem. No scoping change yet. tests/setup/actor.ts wraps each test in runAs(local u_owner) unless the test calls asNobody(), so the 101 suites that call server modules directly keep working.
- **Tests:** route-sweep (every route.ts goes through handler(); fails on a new unwrapped route); settings-roles; audit append-only triggers and chain verification; runners carry an actor; mcp receives the actor.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; the MCP route's Origin check; every existing suite unchanged in behaviour.


#### acc-3 · Core: scoping columns and the data-access layer for the library, files and records

_Effort: large. Depends on: acc-2._

- **Sections:** §7.4 (rule, migration 25 and 26, library rows), §7.5 (create rule, created_by and paid_by = actor), §7.6 (recordVisible, denied.hidden).
- **Files:** src/server/db.ts (migration 25: workspace_id, created_by, paid_by on every top-level table, backfill to w_owner/u_owner, triggers refusing NULL workspace_id, indexes, w_install rows for built-in palettes, the demo voice and voice previews; migration 26: rebuild skills, skill_toggles, assist_connectors; item_marks with favorites and pins copied); new src/server/access/scope.ts (list({space}), get(kind, id, need), stamp, assertReadable); src/server/generations.ts (createGenerations L691 and recordLocalGeneration L1700 stamp; listGenerations scoped; root-workspace rule), src/server/library.ts (Trash, restore, empty Trash, folders, facets and zips per workspace), src/server/storage.ts, src/server/records.ts (recordVisible), src/proxy.ts; routes under src/app/api/generations/**, folders/**, assets/**.
- **Behaviour:** Rows are visible per the §7.4 rule and otherwise answer 404 with a rate-limited denied.hidden audit entry; created_by and paid_by are the acting person for any row a request starts; a request that starts rows from a root uses the root's workspace only with Editor or more there; favorites and pins come from item_marks; Trash is per workspace; a token pinned to a workspace sees only that workspace plus grants to it, and an X-Fuobe-Workspace header that differs from the pin answers 403. Personal sees no difference (one workspace).
- **Tests:** table-classification (every table and file area in §7.4, fails on a new one); idor.test.ts ROUTE_FIXTURES for the library, folder, asset and generation routes; favorites per viewer; Trash per workspace; pinned token cannot read or write outside its pin; retry and Run again stamp the actor; ASSET_REFS/ASSET_FREE entries for new columns.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; Library, folders and Trash e2e (library-flows); the SSE feed for the owner.


#### acc-4 · Core: scoping in every studio module (Cinema, Canvas, Layers, Shorts, brands and ads, Faceless, Content Factory, Dub, Katana, Swap, elements and training)

_Effort: large. Depends on: acc-3._

- **Sections:** §7.4 (studio rows, characters, trainings), §7.5 (mentions, cross-workspace inputs are added in acc-6), §3.2.
- **Files:** src/server/{cinema.ts, cinema-generate.ts, cinema-director.ts, canvas.ts, layers.ts, shorts.ts, brand.ts, ads.ts, marketing.ts, palettes.ts, moodboards.ts, photodump.ts, faceless.ts, content-factory.ts, dub.ts, katana.ts, swap-studio.ts, elements.ts, training.ts, storyboard.ts, mixed-media.ts, chains.ts, influencer.ts, genjutsu.ts, evolution.ts, remove-object.ts, audio-tools.ts} and their routes under src/app/api/**; src/server/records.ts.
- **Behaviour:** Every list and get goes through scope.list/get; children follow parents; @handles are unique per workspace and mentions resolve per §7.5; trainings record started_by and paid_by; attachLora accepts only visible elements' files and catalog LoRAs; Cinema My Generations lists only visible projects; storyboard films and retries use the actor; sweeps and runners act as each row's owner.
- **Tests:** IDOR fixtures for every studio dynamic route; handles per workspace; mention resolution order and ambiguity refusal; retries stamp the actor; existing studio suites green.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; every studio e2e (cinema-*, canvas-*, layers, character-swap-studio, mixed-shorts-original).


#### acc-5 · Core: scoping in Assist, skills, recipes and MCP; agents narrowed in shared spaces

_Effort: large. Depends on: acc-3._

- **Sections:** §7.4 (Assist rows, skills resolution, assist_memory), §7.10 (MCP, agents in shared spaces), §7.11.
- **Files:** src/server/assist/{agent.ts, tools.ts, studio-tools.ts, studio-routes.ts, context.ts, context-tools.ts, memory.ts, projects.ts, schedules.ts, connectors.ts}, src/server/skills.ts, src/server/recipes.ts, src/server/mcp.ts; routes under src/app/api/assist/** and src/app/api/mcp.
- **Behaviour:** Threads, memory, schedules and connectors belong to their user; projects and skills to workspaces; skills resolve personal, then active team, then built-in, and the skills routes accept ?workspace=; taken() and renameSkillRefs work per workspace; listMemories returns only the actor's personal rows; use_personal_memory means the chat author's memory; activeConnectors returns only the author's connectors; ToolContext carries the actor and, in a team thread, narrows reads and writes to that workspace; schedules run as their owner; recipes run under runAs; MCP tools/list is filtered by token scope.
- **Tests:** memory isolation, connector isolation, skill resolution with ?workspace=, MCP tools/list per scope, schedule runs as owner, agent narrowing in a team thread, IDOR fixtures for every Assist route including skills run/verify/estimate/recipe.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; assist-* suites, the CLI skills commands, the Work2Skill recipe routes.


#### acc-6 · Core: leak closures (files ACL, checked reads, declared ids, live-stream isolation, share rules, browser state)

_Effort: large. Depends on: acc-4, acc-5._

- **Sections:** §7.6, §7.5 (cross-workspace inputs, move, share and duplicate server rules), §7.13 (creation and serve-time checks), §3.3, §3.8.
- **Files:** src/app/api/files/[...path]/route.ts and src/server/file-response.ts (ACL by assets.rel_path, cache headers per mode); src/server/storage.ts (readChecked, assertReadable) and the eight absolutePath call sites (audio-tools.ts, katana.ts, canvas.ts, dub.ts, assist/studio-routes.ts, recipes.ts, library.ts); src/server/request-schema.ts and every route zod schema (ref(kind) annotations); src/server/live.ts and src/app/api/generations/stream/route.ts; src/lib/generation-stream.ts (FeedFilter space), the job notifications component; src/server/shorts-schemas.ts (once by user); brand.ts lock; faceless.ts voice previews in w_install; src/app/api/assets/[id]/route.ts; src/server/shares.ts, share-access.ts, src/proxy.ts (owner rule, signed-in-only policy); new src/lib/local-store.ts; src/app/providers.tsx and src/lib/api.ts (workspace in query keys); src/components/security-settings.tsx (sign-out full reload); new /api/users/[id]/avatar.
- **Behaviour:** Every file read is checked; every id field in path, query and body is declared and checked; cross-workspace inputs answer 409 CROSS_SPACE_INPUT until confirmed (never for continuations, schedules, approvals, Assist or MCP); the live stream checks each event against current memberships and grants (version counter), re-validates the session every 60 s and closes on revoke; payloads carry per-viewer marks; ?workspace= on the stream and GET downloads; share links need Editor and the policy at creation and are re-checked at every serve; once() and locks per user; storage keys prefixed and cleared on sign-out.
- **Tests:** files-acl; ref-annotation sweep (fails on an undeclared id-like field); IDOR matrix over every declared path, query and body field; absolutePath grep test; live-stream isolation and revocation (removed member gets nothing new and the stream closes within 60 s); leaks (once, brand lock, voice preview, assetUses copy); shares-policy (viewer can't share; serve-time re-check after move, leave and policy change).
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; live updates for the owner's own feed; downloads and zips; the share page and share files route.


#### acc-7 · Core: provider payload guard (params.extra allowlist, LoRA rule, final-payload pricing, ComfyUI prefixes and cleanup)

_Effort: medium. Depends on: acc-6._

- **Sections:** §7.7, §3.9.
- **Files:** src/lib/catalog/types.ts (route extra allowlist), scripts/gen-cloud-models.py (emit allowlists from the research field lists) and the open ModelDefs in src/lib/catalog/models.ts; src/server/request-schema.ts L100 and L109-133; src/server/canvas.ts L121; src/app/api/generations/local/route.ts; src/lib/catalog/payload.ts L418-426 (extra before priced and safety fields); src/server/providers/comfyui.ts L807-811 and L1171; src/server/generations.ts prepare() (final-payload estimate); comfy history delete and per-job prefix.
- **Behaviour:** Unknown extra keys answer 400 'This setting isn't available for {model}.'; keys naming media, file, LoRA, model or checkpoint bindings and strings with [output], [input], [temp], / or backslash are refused; loras[] accepts catalog LoRAs and visible elements' trained files; the final payload is priced again and a higher price refuses the request ('This would cost more than shown. Refresh the price and try again.'); safety and pricing fields are written after extra; in Studio and Platform each ComfyUI job gets a random filename_prefix and its /history entry is deleted after outputs are saved (files too when the server record has local folders).
- **Tests:** extra.image naming an [output] file refused; unknown extra key refused; another person's trained LoRA refused; extra.num_images above the priced count refused; payload snapshots show safety fields after extra; history delete called; random prefix in Studio; an enumeration test that every extra key used by presets, studios, Canvas and eval cases is on its model's allowlist.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; every payload snapshot test, the eval cases that pass params.extra, the Canvas Table node.


#### acc-8 · Core: paid keys, the one meter and the entitlements module, with the usage page

_Effort: large. Depends on: acc-7._

- **Sections:** §7.12 (who pays, payer-aware readiness, meter tables, Budget, spend points, hold sizes, entitlements), §7.8 (keys, member key test), screens §S4.3 and §S4.7.
- **Files:** src/server/db.ts migration 27 (provider_keys, spend_limits, meter_holds, meter_entries, limit_requests, lora_mirrors.key_ref, moodboards.style_key_ref; sets accounts.multi_user=1); new src/server/keys.ts (payerFor, readyFor, withKey, AES-256-GCM); src/server/providers/{fal.ts, replicate.ts, llm.ts, types.ts (PollResult.gpuMs), comfyui.ts (execution timestamps)}; src/server/enhance.ts; src/server/assist/agent.ts; src/server/faceless.ts askLlm; src/server/training.ts (cloud and AI-Toolkit holds); src/server/loras.ts; src/server/cinema-generate.ts; src/server/generations.ts (chooseRoute and routeReady per payer; reserve at L691, L1700 and dependents); new src/server/meter/{meter.ts, usd-budget.ts}; new src/server/entitlements.ts; routes /api/me/usage, /api/me/entitlements, /api/me/keys, /api/me/keys/test, /api/me/limit-requests; page /settings/usage; composer payer hint and refusal lines.
- **Behaviour:** keys.mode install, own or both resolves the payer, written to paid_by and used for every poll, cancel and download; readiness and demo auto are decided per payer; every spend point reserves inside BEGIN IMMEDIATE (cloud, open engine with gpuMs capture, AI-Toolkit trainings, Claude calls via meter.llm); UsdBudget with limits for install, team, member and personal cap; offered(), admit(), gate() and summary() in one module; GET /api/me/usage works for the local actor. Settlement stays as today until acc-9.
- **Tests:** meter (every spend point reserves; 20 concurrent creates against a $1 limit give the right refusals; open-engine gpuMs capture; AI-Toolkit hold; FUOBE_DEMO_PRICED demo holds; record mode); keys binding (poll uses paid_by's key); payer-aware readiness (own mode, no install key, member key: real run, not demo); entitlements offered/admit/gate; member key test endpoint accepts only key values.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; Personal runs with install keys exactly as today; demo holds are 0 unless FUOBE_DEMO_PRICED=1.


#### acc-9 · Core: exact settlement (compare-and-set terminal writes, cancel from the provider's answer, stopped steps, debt-free capture)

_Effort: large. Depends on: acc-8._

- **Sections:** §7.12 (settlement, holds over time, re-pricing, provider out of funds, orphans), screens §S4.9.
- **Files:** src/server/generations.ts (update() L149 CAS for terminal transitions; cancelGeneration L1641; overdue and timeout branches; submit cancel-on-arrival; launchStored re-reserve; 'canceling' status; 'stopped' dispatch state; orphan entries); src/server/providers/{fal.ts, replicate.ts, comfyui.ts} (cancel returns removed, requested, completed or aborted; insufficient-funds detection); src/server/meter/meter.ts (hold state machine, settle:<hold> key, LLM hold expiry); src/lib/types (status canceling); generation card and chain card components (Stop copy, stopped state with Add credits or Ask for more and Continue); Assist stop message; schedules pause.
- **Behaviour:** Exactly one settlement per hold; release only when the job provably never ran; otherwise keep polling and capture what ran; Fuobe-side failures after provider success capture; fal or Replicate out of funds pauses that provider and alerts admins; holds on live rows never expire by age; a higher re-price at launch reserves the difference or stops the step (never fails it); Continue re-runs admission for stopped steps only; stopped steps cancel after 7 days.
- **Tests:** per-provider cancel states (queued, in progress, already completed, aborted, interrupted); cancel against success with injected delays in persist and postProcess gives exactly one settle entry and a matching status; re-price above budget stops the step and Continue resumes it; LLM hold expiry captures the maximum; insufficient funds pauses the route; Stop copy on running jobs.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; cancel and retry flows in library-flows and cinema e2e; Personal USD caps.


#### acc-10 · Core: runner seams (launch collector, postProcess, live source, idempotency, one price formatter, housekeeping)

_Effort: large. Depends on: acc-9._

- **Sections:** §7.18, §7.12 (request idempotency, display), §7.11 (housekeeping registry).
- **Files:** src/server/generations.ts (launch() replacing void submit at L777 and L1117; launchStored; postProcess before L1481), src/server/training.ts L221; src/server/access/route.ts (per-request launch collector); src/server/live.ts (pluggable source, typed events); db migration for request_keys; src/lib/api.ts and bin/lib/client.mjs (Idempotency-Key per click); src/server/mcp.ts (key from session and tool-call id); new src/lib/price-display.ts replacing costLabel (composer.ts L971), formatCost (format.ts), formatUsd (cinema/money.ts), the Faceless usd() and the 51 inline sites, plus server strings (assist-schedule.ts L275, assist/context.ts L54, assist/tools.ts L59-65, cinema-generate.ts L130); src/instrumentation.ts housekeeping registry.
- **Behaviour:** With no gate claiming launches the order and timing are identical to today; postProcess is a no-op by default; request_keys inserted pending in the reserve transaction (409 IN_PROGRESS while pending, replay after, 422 for a different body, 24 h); one formatter for every price label; housekeeping deletes per §7.11.
- **Tests:** collector parity; launchStored equals advanceDependents; postProcess no-op timing; idempotency replay, 409 and 422; price-display sweep with byte-identical USD labels in Personal and Studio; housekeeping retention.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; composer-flows e2e price labels; Assist and MCP price text.


#### acc-11 · Core: sign-in pages, sign-up policy, mailer, consents and the notifications store

_Effort: large. Depends on: acc-10._

- **Sections:** §7.1 (allowlist adds sign-up with the policy), §7.2 (throttles, 423 rules), §9.1 (policy, domain trust only for checked addresses), §7.14 (notices), screens §S2 and §S12.
- **Files:** package.json (nodemailer per §5.2 rule); new src/server/identity/policy.ts, src/lib/webmail-domains.ts, vendored disposable list and password blocklist; new src/server/mail/{mailer.ts, outbox.ts, templates/*}; db migration for consents, notifications, mail_outbox; src/server/identity/auth.ts (emailOTP, socialProviders, genericOAuth from settings); pages src/app/login, /register, /verify, /reset, /reset/[token]; new src/components/auth/*; /api/public/sign-in-options; /api/auth/forgot*; src/proxy.ts OPEN additions; new src/server/inbox.ts (notify(), no UI yet).
- **Behaviour:** open, approval, invite and closed policies with domain lists; open needs email checks or Google/OIDC only; domain auto-approve only for checked addresses; uniform answers for existing emails; per-account throttle keyed by email hash; password-only 423 with the 24 h and passkey/second-factor/reset lifts; global soft throttle; SMTP, log or none transports with an outbox and retries at 1, 5 and 30 minutes; consents append-only through recordConsent; inbox.notify() writes notifications and email copies for requests, decisions, exports, deadlines and alerts.
- **Tests:** signup-policy matrix; open-without-email refusal; unverified domain address stays pending; uniform sign-up answer; throttle by email hash and 423 lifts; OTP stored hashed; consents append-only; outbox retries; e2e sign-in pages at 390 and 1440 px, light and dark, keyboard and role=alert.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; the Personal one-field login; /login redirects to / in Just me.


#### acc-12 · Core: install invites, approval queue and admin actions on people (with the target-role matrix and notices)

_Effort: medium. Depends on: acc-11._

- **Sections:** §7.3 (who may act on whom), §9.1 (invites, approval, no-email reset links), §7.14 (notices to the person), screens §S2.5 and §S6.3.
- **Files:** invites table usage and /api/invites/*; page /invite/[token]; approval queue API; /api/admin/people/[id]/* (approve, disable, enable, reset email or link, sign out everywhere, role, transfer ownership); src/server/identity/admin-ops.ts (target matrix enforced in one place).
- **Behaviour:** Invites by email or copyable link, 72 h, single use, resend invalidates, 5-minute resend guard, daily limits, roles limited to what the inviter may assign, admin-role invites need a checked email; approvals; admin actions follow the matrix (nothing targets the owner; admins and staff need the owner); reset emails and links never clear two-step or passkeys; Platform staff never get links; the target always gets an Inbox notice and an email when mail works.
- **Tests:** invite lifecycle (expiry, resend, wrong account, used, revoked, unknown); role x action matrix; reset keeps two-step; notices written; audit entries.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; the owner's own sign-in; FUOBE_PASSWORD break-glass.


#### acc-13 · Core: recovery, Inbox, account menu, Confirm it's you, the account page and the member welcome

_Effort: large. Depends on: acc-12._

- **Sections:** §7.15 (recovery), §7.2 (step-up), §7.10 (tokens), screens §S2.6, §S3 and §S4.1.
- **Files:** bin/fuobe.mjs and bin/lib (local recover mode reading FUOBE_DATA_DIR), FUOBE_RECOVER at boot; /api/recover/{verify,finish}; page /recover; Inbox bell in the sidebar header and PhoneBar (src/components/app-sidebar.tsx, phone-bar.tsx), /api/me/inbox and /api/me/inbox/read; account menu in the sidebar footer (L386-428) and the phone avatar sheet; new src/components/ui/responsive-dialog.tsx; Confirm it's you dialog with session_step_up; /settings/account (profile, avatar upload, email change, sign-in, devices via /api/me/sessions, tokens with name, scope, expiry and pin, your keys, notifications, appearance) including the Just me variant; Home member welcome card replacing GetStarted for non-admins.
- **Behaviour:** Recovery file 0600 with a 60-bit code, 30 minutes, 5 tries, printed path; redeem at /recover#CODE with a Strict cookie; the Inbox is reachable from a bell with an unread badge; devices never expose session tokens; tokens are created only from a browser session or the local actor; the welcome card per §S3.6.
- **Tests:** recovery (file mode, tries, expiry, no server call from the CLI); inbox read and mark all; devices list contains no tokens; token scopes and pin; ResponsiveDialog layout at 390 px; keyboard and screen-reader checks.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; Settings → Security token list and MCP snippet (reused); fuobe login with a pasted token.


#### acc-14 · Core: first-run setup (owner's first screen, setup code at commit, wizard registry) and headless setup

_Effort: large. Depends on: acc-13._

- **Sections:** §7.9 (first screen, setup code, steps, headless, Platform availability), §6.3, screens §S1.
- **Files:** src/app/setup/** pages; /api/setup/{code,account,draft,finish}; setup code writer and terminal lines in src/instrumentation.ts; step registry; headless env in bootstrap; src/proxy.ts setup gate activated for fresh installs; tests/e2e/_server.mjs, tests/e2e/_routes.mjs (AUTH_ROUTES), README browser-checks section (FUOBE_MODE=personal FUOBE_DEMO_MODE=on).
- **Behaviour:** Fresh installs open on Just me or Create your account; the code travels in the fragment, is asked only at commit, is throttled after 5 misses and never rotated on failures; the Platform card is disabled until acc-57 (FUOBE_DEV_PLATFORM for development); Studio recommended settings preselect open with the owner's work domain, falling back to approval without mail or Google; Finish deletes the code file and does a full load.
- **Tests:** setup-code throttle and no rotation; fragment carried and removed; Just me finishes in one click from the link; Create account for Personal and Studio; Platform card disabled; recommended settings with and without mail; headless matrix and its one-line errors; e2e setup-wizard at 390 and 1440 px light and dark.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; existing installs (setup.state=done); the e2e harness on a fresh data dir.


#### acc-15 · Core: mode switch, Settings → Access and the settings visibility matrix

_Effort: medium. Depends on: acc-14._

- **Sections:** §7.9 (switching), §7.8, screens §S0.3 and §S4.4.
- **Files:** new src/server/mode-switch.ts (canLeave and onEnter registries, dormancy, snapshot first); /api/access/*; /settings/access core sections (mode card, Require sign-in, who can join, sign-in methods, email, site address, time zone, share links); the settings sub-nav registry driven by the visibility matrix; src/components/settings-form.tsx (StatusStrip only on General for admins; members see Managed by your admin).
- **Behaviour:** Owner-only switching with a fresh session and a snapshot; Personal to Studio or Platform needs a checked owner email and a non-loopback address; Studio or Platform to Personal makes others dormant and keeps the owner's access to every team space; Require sign-in on and off in Personal with honest copy; env locks show Set by the server.
- **Tests:** mode-switch round trip with snapshots and dormancy; Require sign-in on and off; visibility matrix per mode and role; e2e access page at 390 px.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; Just me after turning sign-in off again; the owner's library after a round trip.


#### acc-16 · Core: admin console core (/admin shell, Overview, People and the person page, Usage & limits)

_Effort: medium. Depends on: acc-15._

- **Sections:** §7.3, §9.1, screens §S6.
- **Files:** src/app/admin/** (layout with the nav registry and Select under 768 px, Overview registry, People list with tabs Active, Waiting, Invited, Turned off, /admin/people/[id] with Overview, Usage, Devices and Tokens tabs, Teams read-only list, Usage & limits with CSV, default limit, unknown-price switch and limit requests); ⌘K entries in src/components/command-palette.tsx.
- **Behaviour:** Admins see people, spend and requests; members get 404; every action uses acc-12's actions; CSV has a byte-order mark and a formula-injection guard.
- **Tests:** admin permissions (404 for members and auditors where not allowed); CSV injection guard; limit request approve and decline; e2e admin pages at 390 and 1440 px.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; Settings pages for the Personal owner.


#### acc-17 · Core: teams and sharing (team workspaces, switcher, Saving-to chip, Move, Share, Duplicate, Library spaces, team keys and limits)

_Effort: large. Depends on: acc-16._

- **Sections:** §7.5 (all rules), §9.3, §7.13 (link re-checks on move and leave), screens §S5.
- **Files:** /api/workspaces/* (create, members, invites with the beforeJoin seam, leave, transfer, delete or archive); Create team dialog; /teams/[slug]/settings (Members, Keys & limits, General); full /admin/teams; the switcher in the account menu and ⌘K; the Saving-to chip in src/components/studio composers; /api/move, /api/grants, /api/duplicate; the share dialog section; src/components/library-view.tsx (space control above the tab strip; Shared renamed Links); team keys and limits in the meter; team policies for links, brand kits and copying out; the Editor label.
- **Behaviour:** Several teams per person; roles with the last-owner guard; Move out of a team needs a team admin; grants need Editor and can't exceed the granter's level; Studio people picker limited to people who share a team; deleting a team moves or archives and returns likeness and voice elements; links re-checked on move and leave; new tabs start in the last-used space.
- **Tests:** teams.test.ts (semantics, last owner, transfer, leave, delete); IDOR with roles; cross-space 409; move-out rule; grant level cap; e2e accounts (invite, isolation, share, team move, limit line, sign-out cache, new tab keeps the space).
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; the Library tabs for a person with no team (no space control shown).


### 16.2 Personal

#### acc-18 · Personal: access and remote use (address checks, other addresses, trusted proxy, remote guide, Just me honesty)

_Effort: medium. Depends on: acc-15._

- **Sections:** §8 (Just me rules, Access and remote use), §7.2 (trusted proxies), screens §S4.4.
- **Files:** new src/server/access.ts (allowedHosts, trustProxy) read by src/server/auth.ts crossSite and hostAllowed, trustedOrigins, the throttles and the client IP; new src/server/net-info.ts; /api/access, /api/access/diagnostics, /api/access/sign-in; src/lib/site-address.ts; /settings/access Personal sections and the remote guide; the other-device banner; uqr 0.1.3; docs/remote-access.md.
- **Behaviour:** Other addresses refuse *, wildcards, ranges and public suffixes; Just me refuses forwarded requests from non-private addresses unless a trusted proxy is set; /api/identity/* unmounted in Just me except sign-in-options; the detected client IP shown; quick tunnels refused in Just me; Cloudflare Tunnel and Caddy recipes only with sign-in on.
- **Tests:** access-settings; runtime-auth extension (tunnel refusal, private ranges incl. 100.64.0.0/10); e2e personal-access.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; hosts that pass today's hostAllowed; FUOBE_ALLOWED_ORIGINS wins; /s/ framing.


#### acc-19 · Personal: two-step sign-in and passkeys for every account in every signed-in mode

_Effort: large. Depends on: acc-13, acc-18._

- **Sections:** §8 (two-step and passkeys), §7.2 (step-up), §7.15 (recovery checkboxes), screens §S2.2, §S2.6 and §S4.2.
- **Files:** package.json (@better-auth/passkey matching better-auth, @simplewebauthn/browser 13.3.0); src/server/identity/auth.ts (twoFactor and passkey plugins, allowlist entries, freshness hooks, 10-passkey limit); db (frozen auth_two_factor, auth_passkey; totp_seen; session_mfa); verify-2fa restricted kind; the login shim forwards twoStep; admin-ops resetTwoFactor and removePasskeys; /login code step and passkey button; /two-step?mode=session; Account sections Passkeys and Two-step with the setup dialog; passkey option in Confirm it's you; /recover checkboxes.
- **Behaviour:** TOTP with replay guard, backup codes, trusted devices 30 days; passkeys with rpID and origin from the site address and user verification required; restricted verify-2fa after OAuth or SSO; recovery may turn off two-step and remove passkeys.
- **Tests:** passkeys-two-step (CDP virtual authenticator); replay guard; verify-2fa after OAuth; recovery checkboxes; e2e personal-signin.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; password-only sign-in for people without two-step.


#### acc-20 · Personal: new-sign-in alerts

_Effort: small. Depends on: acc-13._

- **Sections:** §8 (alerts), screens §S3.4.
- **Files:** session.create.after alert rule (90-day label memory, security.sign_in_alerts); new-sign-in mail template; banner component in the studio layout; Devices switch and IP display.
- **Behaviour:** Banner when another session is newer than this browser saw; email only for a label unseen in 90 days and only with a checked email and mail.
- **Tests:** alert decisions; e2e second browser context sees the banner.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; sign-in speed (the rule runs after the session is created).


#### acc-21 · Personal: backup and move (snapshots, full archives, fuobe backup and restore)

_Effort: large. Depends on: acc-15._

- **Sections:** §8 (backup and move), §7.16 (no live credentials in copies), screens §S4.5.
- **Files:** new src/server/backup/{schedule.ts, tar.ts, archive.ts}; /api/backups and /api/backup/* (owner); data/server.pid written in register(); /settings/backup and the General summary; /setup/restore; bin/lib/tar.mjs; fuobe backup and fuobe restore commands; docs/moving.md.
- **Behaviour:** Weekly snapshots keep 4 (Platform daily keep 7, set by acc-55); full archives on demand with single-use 60-second download tickets; in Studio and Platform a full archive needs a reason, is audited and notifies admins; restore only with the server stopped, into .restoring-<UTC>, checksum verified; session and verification rows never included.
- **Tests:** backup schedule and pruning; tar safety (no absolute paths, no links, allowlisted prefixes); checksum; fingerprint carried; restore signs everyone out; e2e personal-backup (TOTP survives the move).
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; the core snapshot names; zip downloads.


#### acc-22 · Personal: browser-approved fuobe login and token expiry warnings

_Effort: medium. Depends on: acc-13._

- **Sections:** §8 (CLI login), §7.10, screens §S4.6.
- **Files:** db cli_connect_requests; /api/cli/connect, /api/cli/connect/poll (public, rate-limited), /api/cli/connect/[code], approve and deny (session only); /settings/account/connect-cli; bin/fuobe.mjs login (--no-browser, --paste); X-Fuobe-Token-Expires header.
- **Behaviour:** The page shows the code, the requesting IP and user agent and the time; default scope Generate only; approval needs a fresh session; 10-minute requests; tokens delivered once and wiped.
- **Tests:** cli-connect (expiry, single delivery, rate limits, session-only approval); cli login; e2e personal-cli.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; fuobe login with --token and FUOBE_TOKEN.


#### acc-23 · Personal: the first minute and everyday spend

_Effort: small. Depends on: acc-15._

- **Sections:** §8 (first minute and spend), §7.12 (display), screens §S1.1 and §S4.3.
- **Files:** terminal setup lines; Personal copy on /setup steps; src/components/get-started.tsx autofocus and toast; the footer spend row in app-sidebar.tsx; Personal usage labels and usage.csv; the 402 copy for the personal cap; tests/e2e/_server.mjs timing helper.
- **Behaviour:** A first demo result in under 60 s from a fresh install; 'Spent ≈ $12.40 this month' in the footer when paid engines are on; the personal cap line with Change limit.
- **Tests:** personal-first-run; e2e personal-setup with the 60 s budget.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; the Get started guide for admins.


### 16.3 In-house studio

#### acc-24 · Studio: team directory, team home, visibility and join requests

_Effort: large. Depends on: acc-17._

- **Sections:** §9.3 (directory, visibility), screens §S7.1 and §S7.2.
- **Files:** db team_join_requests, notice_sends; new src/server/teams/directory.ts; /api/teams/directory, join, join-requests, summary; ?space on list routes; /teams and /teams/[slug]; team settings join and visibility; /admin/teams Team rules; Studio Inbox kinds.
- **Behaviour:** Private teams answer 404 to non-members; Listed teams take requests that expire after 30 days; Open teams join at once with the join role; the team home shows sections with empty-state copy for a new team.
- **Tests:** teams-directory; space filter; e2e studio-teams.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; Personal (inert); core teams.


#### acc-25 · Studio: narrow-only team policies and team Assist connectors

_Effort: medium. Depends on: acc-24._

- **Sections:** §9.4 (team policies), §7.10 (team connectors only in team chats).
- **Files:** new src/server/teams/policies.ts (resolvePolicy); the team narrower registered in src/server/entitlements.ts; assist_connectors.workspace_id; team policies route; the Policies tab.
- **Behaviour:** Models, engines, public links, brand-kit editors, connectors, two-step and retention per team, always the narrower of install and team; prepare(), MCP and Assist read offered().
- **Tests:** team-policies (narrowing never widens); connectors offered only in team chats.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; install model switches.


#### acc-26 · Studio: one fair queue for Studio and Platform

_Effort: large. Depends on: acc-17, acc-10._

- **Sections:** §9.4 (fair queue), §10.3 (Platform pools, added by acc-39), §7.12 (holds never expire on waiting rows), screens §S7.8 and §S4.9.
- **Files:** generations dispatch columns; new src/lib/gpu-fair.ts (pure pick and positions); src/server/gpu/service.ts; src/server/queue/dispatcher.ts as a launch gate; policy hooks for weight and concurrency; /admin/gpu Waiting, Shares and Settings; card lines and Run on cloud instead.
- **Behaviour:** Weighted fair share over GPU-seconds in 60 minutes by group then person then age; slot rule; 50 waiting per person; max wait; cancel of held rows makes no provider call; AI-Toolkit trainings counted; Personal submits directly.
- **Tests:** gpu-fair (pure); gpu-dispatcher; one open training per person per pool.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; Personal submit timing; ComfyUI binding tests.


#### acc-27 · Studio: GPU server registry (pools, team pins, probes, sticky routing, drain)

_Effort: large. Depends on: acc-26._

- **Sections:** §9.4 (GPU pool), §7.7 (prefix and cleanup per server), screens §S7.8.
- **Files:** db comfy_servers; src/server/providers/comfyui.ts takes the server id for upload, poll, history and cancel; LoRA folders per server; probes and capability matching; /admin/gpu Servers section; team Policies read-only row.
- **Behaviour:** An empty table means today's comfyui.url and isolatedUrl; least-loaded and warm routing; pins; drain; token warning; removed server fails its rows with a run-again message.
- **Tests:** gpu-pool; existing comfyui binding tests unchanged.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; the isolated worker routing.


#### acc-28 · Studio: approvals for runs over a threshold

_Effort: large. Depends on: acc-25, acc-26._

- **Sections:** §9.4 (approvals), §7.12 (re-price re-runs approval), screens §S7.3.
- **Files:** db approval_requests; src/server/approvals.ts as a launch gate using collector hold ids; /api/approvals and the admin settings route; /approvals; requester toast and card states; menu row; mail templates.
- **Behaviour:** Off by default; thresholds per team and for personal spaces on studio keys; admins and own-key payers exempt; 72 h expiry; second decision 409; private runs hide the prompt.
- **Tests:** approvals (FUOBE_DEMO_PRICED); e2e studio-approvals.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; runs below the threshold launch exactly as before.


#### acc-29 · Studio: usage reports, budget alerts, monthly report, pause paid runs

_Effort: medium. Depends on: acc-24, acc-26._

- **Sections:** §9.4 (reports and alerts), screens §S6.5.
- **Files:** new src/server/meter/{reports.ts, alerts.ts, monthly-report.ts}; report routes with CSV streaming; pause-spend route; /admin/usage tabs; /teams/[slug]/usage; SVG day chart with Show as table.
- **Behaviour:** Reports by person, team, model, feature, engine, day and payer; alerts at 50, 80 and 100% deduplicated; monthly email on the 1st at 09:00; pausing keeps the previous limit in the audit entry.
- **Tests:** usage-reports; budget-alerts; CSV injection guard.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; core /settings/usage.


#### acc-30 · Studio: two-step enforcement and session, device, network and token policies (E1)

_Effort: large. Depends on: acc-19, acc-25._

- **Sections:** §9.5 E1, §7.15 (Revoke everything), screens §S7.4.
- **Files:** new src/server/identity/two-step.ts (required, deadline) with the enroll-2fa kind; /two-step/setup; session_activity; absolute and idle checks; device cap; networks through trustProxy(); tokens.max_days; Sign out everyone and Revoke everything; admin reset two-step (owner); /admin/security; /setup/security; the team two-step row; the idle warning dialog and draft restore.
- **Behaviour:** Required for owner, admins and auditors by default with 7 days of grace; tokens refused with TWO_STEP_REQUIRED after the deadline; Platform staff registered under the same rule; networks refuse a list without your own address.
- **Tests:** two-step enforcement; session-policies (absolute, idle, device cap, networks); Revoke everything; e2e studio-security.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; people without a policy requirement.


#### acc-31 · Studio: verified domains, domain capture and team auto-join (E4)

_Effort: medium. Depends on: acc-24._

- **Sections:** §9.5 E4, §9.1 (checked addresses only).
- **Files:** db domains, team_auto_join; src/server/identity/domains.ts with an injected resolver and the daily recheck; autoJoin on every activation path; /admin/domains; Auto-join card; capture switch.
- **Behaviour:** TXT verification, lapse after 3 misses, owner manual verification with a reason; capture and auto-join only for checked addresses; each domain bound to at most one connection.
- **Tests:** domains; auto-join (unverified address never joins).
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; invites and approval.


#### acc-32 · Studio: company sign-in with OIDC and SAML (E2)

_Effort: large. Depends on: acc-30, acc-31._

- **Sections:** §9.5 E2, §7.1 (cross-site exemption, no issuer origins), screens §S7.5.
- **Files:** package.json @better-auth/sso (same version as better-auth); db sso_connections and frozen auth_sso_provider; src/server/identity/sso.ts (defaultSSO, resolveUser, after-hooks, group sync, enforcement, RelayState cookie); CROSS_SITE_EXEMPT registration; /admin/sso and the editor; /login/sso; /api/public/sso-route; /setup/sso; env connection.
- **Behaviour:** Owner-only connection changes with a test; bound domains; auto-link only to credential-less accounts and never to privileged ones; issuer and subject keys; SAML only with a matching RelayState cookie; require-company-sign-in with break-glass.
- **Tests:** sso-oidc (mock IdP); sso-saml (samlify test IdP, signature wrapping cases); login CSRF refused; proxy cross-site exemption exact; e2e studio-sso.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; password sign-in for break-glass people.


#### acc-33 · Studio: SCIM 2.0 provisioning owned by Fuobe (E3)

_Effort: large. Depends on: acc-32._

- **Sections:** §9.5 E3.
- **Files:** db scim_tokens, scim_groups, scim_group_members; new src/server/scim/*; /api/scim/v2/{ServiceProviderConfig,ResourceTypes,Schemas,Users,Groups} with access 'scim'; proxy OPEN and bearer skip for fuobe_scim_ tokens; admin routes; /admin/provisioning; Okta and Entra fixtures.
- **Behaviour:** SCIM touches only people it provisioned and never install roles or the owner; SCIM-managed accounts use company sign-in only; groups map to teams and roles; delete turns off; the safety brake.
- **Tests:** scim-users, scim-groups (filters, PATCH quirks, error format); scope refusals; brake; e2e studio-scim.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; people created by invite or sign-up.


#### acc-34 · Studio: audit viewer, export, retention and the Auditor role (E5a, shared by Platform)

_Effort: medium. Depends on: acc-24._

- **Sections:** §9.5 E5a, §7.14 (chain), screens §S7.7.
- **Files:** audit indexes; the auditor role registered; src/server/audit-query.ts; audit labels with a group registry; streamed CSV and JSONL export; retention sweep; optional HTTPS sink; /admin/audit; team Activity; person Activity tab.
- **Behaviour:** Plain sentences, chips, details sheet, chain verification banner, retention 90 days to 7 years, team Activity without IP addresses.
- **Tests:** audit-viewer (filters, export, chain, retention entry).
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; core audit writes.


#### acc-35 · Studio: data lifecycle (export, deletion and restore, purge manifest, retention, legal hold, privacy holds, view-as) (E5b)

_Effort: large. Depends on: acc-34, acc-25._

- **Sections:** §9.5 E5b (purge manifest table), §7.3 (view-as rules), screens §S4.8 and §S7.7.
- **Files:** db export_jobs, access_grants, privacy_holds; src/server/data/{exports.ts, deletion.ts, retention.ts, legal-hold.ts, view-as.ts}; restore-account and view-as kinds; files read under an active grant; /settings/privacy; /account/restore; /admin/data; person Delete and Open library.
- **Behaviour:** Exports in parts with a manifest; deletion with 30-day grace and restore; the purge manifest including LoRA files, datasets, GPU server copies, provider copies and ComfyUI history; retention previewed with a 7-day first run; legal hold 423; privacy holds override purges; view-as read-only, reasoned, notified, 30 minutes.
- **Tests:** exports; deletion and restore; purge-manifest coverage (fails on an unclassified table or file area); retention; view-as.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; Trash purge timing in Personal.


#### acc-36 · Studio: full seats and free view-only accounts (E6)

_Effort: medium. Depends on: acc-33._

- **Sections:** §9.5 E6, screens §S7.6.
- **Files:** users.seat, seat_requests; seats.assign in BEGIN IMMEDIATE on every activation path; the view clamp in effectiveTeamRole; /admin/seats; view-only states; FUOBE_SEATS.
- **Behaviour:** No limit by default; overflow becomes view-only; requests; 'Editor · view-only seat'.
- **Tests:** seats including a 10-way activation race.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; people when no seat limit is set.


### 16.4 Platform

#### acc-37 · Platform: credit ledger and CreditBudget

_Effort: large. Depends on: acc-17._

- **Sections:** §10.2 (units, tables, lifecycle, keys, sweeps, payer, staff record cap), §7.12 (Budget, debt), screens §S8.4.
- **Files:** db credit_accounts, credit_buckets, credit_ledger (append-only triggers), credit_holds; src/server/credits/{accounts.ts, buckets.ts, ledger.ts, budget.ts, sweeps.ts}; features().credits; interim credits.free_monthly; /api/me/credits; admin adjust; the credits live event; /setup/credits (value and markup); the credits pill.
- **Behaviour:** Reserve by debit in spending order; capture min(hold, final) and debt for overage; release on every core path; idempotency keys; expiry sweep; nightly invariants; staff record mode capped at $50 a day.
- **Tests:** credits-ledger (including two-process concurrency); credit-budget-paths across every release path; debt clears on top-up.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; Studio and Personal UsdBudget.


#### acc-38 · Platform: credit price book (per-model rules, GPU-second and AI-Toolkit pricing, credit display)

_Effort: large. Depends on: acc-37._

- **Sections:** §10.5, §7.12 (hold sizes, display).
- **Files:** db price_rules, gpu_run_stats; src/lib/credits.ts creditsFor; /api/public/price-book (versioned); the Platform branch of formatPrice; credits in previews; /admin/credits; enhance and Assist credit lines; AI-Toolkit target prices.
- **Behaviour:** Fixed rules or usd x (1 + markup) / value with minimum and rounding; open-engine holds per §7.12; unknown prices refused unless fixed; below-cost flags.
- **Tests:** credits-price (examples in §10.5); credit labels; unknown price refused.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; USD labels in Personal and Studio.


#### acc-39 · Platform: plans and entitlements engine (versions, narrower, admit checks, pools, concurrency, team pools)

_Effort: large. Depends on: acc-38, acc-26._

- **Sections:** §10.2 (plans), §10.3 (fields, queue pools), §7.12 (entitlements module).
- **Files:** db plans, plan_versions, account_plans, entitlement_overrides, credit_limits; the plan narrower and admit checks registered in src/server/entitlements.ts; dispatcher weight and concurrency policies (Free pool, Unlimited pool, team weight x seats capped at 32, Free pool at most 25% of slots); staff plan in record mode; team pools and member caps; unlimited relaxed rules with the operator-cost ceiling; teams without a Team plan pay from the runner's credits.
- **Behaviour:** Plans versioned and grandfathered; every spend entry point checks entitlements after planning; queue weights per §10.3.
- **Tests:** entitlement sweep across every spend entry point; 1,000 Free accounts against one Ultra; unlimited ceiling.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; Studio team weights (same algorithm).


#### acc-40 · Platform: plan editor, model matrix, user locks and /setup/plans

_Effort: medium. Depends on: acc-39, acc-16._

- **Sections:** §10.3, screens §S9.2 and §S9.4.
- **Files:** /admin/plans (list and versioned editor with the publish dialog), /admin/models (plan matrix with licence chips), lock badges in pickers and studios, /setup/plans.
- **Behaviour:** Publishing a version keeps existing subscribers unless moved; margin check before publish; locked items show the plan they need.
- **Tests:** plan editor validation; publish keeps subscribers; e2e admin plans at 390 px.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; model-access switches.


#### acc-41 · Platform: admin people with credits, staff roles and the Platform overview

_Effort: large. Depends on: acc-40, acc-34._

- **Sections:** §10.7 (staff roles and caps), screens §S9.1 and §S9.3.
- **Files:** billing, moderator and support roles registered; Platform nav groups and Overview tiles; person Credits tab and Adjust credits with role caps; audit groups added to E5a; SVG charts.
- **Behaviour:** Caps per role (support 500, billing 10,000 credits per action); every adjustment audited with a reason and notified to the customer.
- **Tests:** permissions matrix per staff role; adjustment caps.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; Studio admin console.


#### acc-42 · Platform: credit codes and redeem, plan requests, bans, consent-based support access

_Effort: medium. Depends on: acc-41, acc-35._

- **Sections:** §10.1 (code limits), §10.7, §7.3 (view-as by consent), screens §S8.5, §S9.5 and §S9.8.
- **Files:** db credit_codes, credit_code_redemptions, plan_requests, user_bans; /redeem; /admin/codes credit tab; /admin/bans; ban refusal codes; support access as an access_grants consent mode with an owner emergency path.
- **Behaviour:** Codes shown once; first-time and per-card limits; ban effects (sessions, links, subscription and credits per setting); support view-as only after the customer allows.
- **Tests:** codes; ban effects; view-as consent and emergency audit.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; Studio view-as policy.


#### acc-43 · Platform: payment core (PaymentProvider, fake provider, webhook route, event store, reconciliation, grants)

_Effort: large. Depends on: acc-41._

- **Sections:** §10.4 (webhooks, grant rules, keys), §10.2 (idempotency keys).
- **Files:** db customers, subscriptions, payments, payment_events, checkout_sessions, credit_packs; src/server/billing/{provider.ts, fake.ts, fulfill.ts, grants.ts, webhook.ts, reconcile.ts}; /api/billing/[provider]/webhook registered in the proxy's OPEN and cross-site-exempt registries and exempt from setup gate, Preview, dormancy, captcha and IP limits; Health event-gap alert.
- **Behaviour:** Raw body, signature, store then 2xx, process from the table, dedupe on event id and on object id plus type, re-fetch the canonical object; grants only for the listed billing reasons keyed by period start; reconciliation every 15 minutes and at boot; fake only with test hooks and demo mode.
- **Tests:** billing-fake; webhook-route (raw body, duplicate events, out-of-order, missing for 4 days then reconciled); grant keys.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; no payments mode (codes and admin grants).


#### acc-44 · Platform: checkout and billing pages (Checkout, success and cancel, /settings/billing, top-ups, redeem, plan requests)

_Effort: large. Depends on: acc-43._

- **Sections:** §10.6, screens §S8.
- **Files:** /api/billing/checkout, /billing/success, /pricing?checkout=cancelled, /settings/billing, top-up sheet, post-verification redirect to Checkout, the Request this plan flow, /setup/payments (none and fake).
- **Behaviour:** Success polls every 2 s for 60 s then the delayed copy; cancel returns to pricing with the note; no-payments installs show Redeem a code and Request this plan.
- **Tests:** billing pages states; e2e platform-billing at 390 px light and dark.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; core /settings/usage.


#### acc-45 · Platform: plan changes, seats, dunning, refunds and disputes

_Effort: large. Depends on: acc-44._

- **Sections:** §10.4 (plan changes, seats, unpaid invoice, refunds, disputes).
- **Files:** src/server/billing/{changes.ts, seats.ts, refunds.ts, disputes.ts}; the change-plan sheet; team billing tab; freeze state; transactional emails; move subscribers.
- **Behaviour:** Upgrades start a new period and credit unused plan credits; downgrades and cancels at period end; seat adds prorated with prorated seat credits, removals at period end with no credit refund; changes refused while unpaid; refunds freeze the bucket first; disputes freeze and claw back.
- **Tests:** upgrade on the last day; 10 seats added then removed; change while past due; partial refunds; dispute won and lost; refund racing a spend.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; plan grants from acc-43.


#### acc-46 · Platform: Stripe adapter (direct and Managed Payments), tax, portal, promotion codes, auto-recharge

_Effort: large. Depends on: acc-45._

- **Sections:** §10.4 (Stripe direct, Managed Payments, portal, tax display, auto-recharge), §10.1 (card testing).
- **Files:** package.json stripe (per §5.2 rule); src/server/billing/stripe.ts (catalog sync by lookup key with AIaaS tax codes, webhook endpoint creation, portal configuration per option, tax inclusive for consumer plans, invoices, promotion codes with first-time and card limits, auto-recharge single-flight); setup and settings UI.
- **Behaviour:** Every PaymentProvider method; Managed Payments changes at period end only; auto-recharge at most 3 a day and off after a failure.
- **Tests:** billing-stripe against an HTTP double (all event types, idempotency keys, portal changes, $0 invoices).
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; the fake provider for e2e.


#### acc-47 · Platform: public site, legal documents, re-acceptance, Coming soon and Preview access

_Effort: large. Depends on: acc-44._

- **Sections:** §10 (launch states), §10.9, screens §S8.1 and §S8.2.
- **Files:** cached public pages (/welcome as '/' when signed out, /pricing, /coming-soon, /legal/[slug]); registry rewrites; robots and sitemap; db legal_docs, sales_leads; templates with placeholders; the legal editor and operator checklist; accept-terms kind; OAuth consent step; waitlist; Preview access list.
- **Behaviour:** Pages use 'use cache' with tags and no user data; revalidateTag from route handlers; re-acceptance on new versions.
- **Tests:** public-route matrix; legal versioning; no-horizontal-scroll for public pages.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; the signed-in app shell.


#### acc-48 · Platform: abuse controls (captcha, breached passwords, signals, free-grant guards, throttles, rate limits)

_Effort: medium. Depends on: acc-44._

- **Sections:** §10.1.
- **Files:** captcha and haveibeenpwned plugins in Platform (fake captcha for tests); db account_signals, rate_limits; /api/public/device (consent-gated); free-grant guards with email normalisation and IPv4 /24 or IPv6 /64 networks; checkout throttles; new-account velocity cap; limits on public endpoints; Abuse settings.
- **Behaviour:** Per-IP rules only with a trusted proxy; server-side signals by default; trials and $0 invoices never grant full allowances.
- **Tests:** abuse (farming, IPv6 networks, normalisation, trusted-proxy off).
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; sign-in for Studio and Personal (plugins load only in Platform).


#### acc-49 · Platform: input safety (word list, prompt classifier, image inputs, provider flags, likeness consent)

_Effort: medium. Depends on: acc-37._

- **Sections:** §10.8 (inputs, provider flags, consent), §7.7 (flags after extra).
- **Files:** src/server/safety/{words.ts, prompt-check.ts, image-input-check.ts}; db moderation_checks; the admit word list; the pre-submit classifier as a launch gate; upload checks; generator safety map; payload flags; consent dialog and CONSENT_REQUIRED; /setup/safety prompt row.
- **Behaviour:** A check that times out or errors blocks; sexual content always blocked; likeness consent recorded in consents.
- **Tests:** safety inputs; payload snapshot (flags after extra); classifier timeout blocks.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; Studio and Personal payloads (flags only in Platform).


#### acc-50 · Platform: output safety via postProcess, withheld results, quarantine, refunds and the CSAM workflow

_Effort: large. Depends on: acc-49, acc-35._

- **Sections:** §10.8 (outputs, withheld, CSAM, refund rule).
- **Files:** output checkers (fal x-ailab/nsfw, local HTTP classifier) and frame sampling; db quarantine, csam_reports; holds via privacy_holds; partial re-pricing; re-check sweep; auto pause after 5 blocked in 24 h; generation card states held and blocked.
- **Behaviour:** Required for every engine that is on; failed or missing checks withhold; blocked results refunded until the pause rule.
- **Tests:** safety outputs; withheld on checker error; csam-flow (quarantine, suspend, hold for 1 year).
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; postProcess no-op in other modes.


#### acc-51 · Platform: moderation queue, reports, NCII takedowns, DMCA, strikes, statements of reasons and appeals

_Effort: large. Depends on: acc-50, acc-42._

- **Sections:** §10.8 (reports and takedowns), screens §S9.6 and §S8.6.
- **Files:** db moderation_items, moderation_actions, strikes, content_hash_blocks; pHash blocks; /admin/moderation queue; /report; /takedown; notices and appeals in /settings/privacy; banned and suspended sign-in copy.
- **Behaviour:** 48-hour NCII timers; repeat-infringer rule; statements of reasons; appeals for 6 months; keyboard shortcuts scoped to the queue.
- **Tests:** moderation; e2e platform-safety.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; share pages for unaffected content.


#### acc-52 · Platform: provenance (C2PA signing, certificate, C2PA-safe share cleaning in all modes, badge, AI labels)

_Effort: medium. Depends on: acc-50._

- **Sections:** §10.8 (provenance).
- **Files:** package.json @contentauth/c2pa-node and sharp (per §5.2 rule); src/server/provenance/{sign.ts, cert.ts, badge.ts} in postProcess; keepC2pa in media-clean (all modes); AI-generated chip on share pages; settings rows; ffmpeg gate.
- **Behaviour:** Sign last; self-signed until a certificate is uploaded; badge only on Free.
- **Tests:** provenance (manifest present, survives share cleaning).
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; share-file cleaning in Personal and Studio.


#### acc-53 · Platform: privacy defaults on the E5b engine

_Effort: small. Depends on: acc-45, acc-51._

- **Sections:** §9.5 E5b, §10.2 (accounting kept), screens §S4.8.
- **Files:** Platform defaults: self-delete on, one export a day, subscription cancelled on delete; export extras (credits.csv, consents, notices); consent purge.
- **Behaviour:** Deleting cancels the subscription per the operator's refund rule; the ledger and invoices are kept pseudonymised.
- **Tests:** privacy-platform.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; Studio defaults.


#### acc-54 · Platform: worker roles, leader lease, SQLite claims, partitioned polling and cross-process live events

_Effort: large. Depends on: acc-39, acc-27._

- **Sections:** §10.10 (worker roles, claims, polling).
- **Files:** db leases, worker_heartbeats, live_events; generation_runs.claimed_by/claimed_at/heartbeat_at; generations.last_polled_at; FUOBE_ROLE in src/instrumentation.ts; once() and request_keys in SQLite; the live_events source; Health Queues and Workers; docs/PLATFORM.md; scripts/capacity.mjs.
- **Behaviour:** CAS claims before any upload; sweepInterrupted only on stale heartbeats; polling partitioned by hash(id) mod COUNT and ordered by last_polled_at.
- **Tests:** 2 workers x 50 ready dependents give exactly 50 submissions; a web upload longer than 2 minutes is not swept; crash mid-submit and mid-persist; capacity targets.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; single-process installs (FUOBE_ROLE=all default).


#### acc-55 · Platform: object storage with presigned reads, daily snapshots and the Litestream guide

_Effort: medium. Depends on: acc-21._

- **Sections:** §10.10 (storage, backups, restore runbook), §7.16.
- **Files:** package.json @aws-sdk/client-s3 and s3-request-presigner (per §5.2 rule); src/server/storage-driver.ts (local, s3); ensureLocal conversions; presigned 300 s redirects after the ACL; /setup/storage; backup defaults daily keep 7; archive note for bucket files; restore runbook in docs.
- **Behaviour:** Private reads always pass the ACL first; share files streamed through Fuobe.
- **Tests:** storage-s3 against a local double; presigned expiry.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; the local driver everywhere else.


#### acc-56 · Platform: analytics, price sync, reconciliation, spend guard and observability

_Effort: large. Depends on: acc-46, acc-54, acc-29._

- **Sections:** §10.5 (price sync, reconciliation, spend guard), §10.10 (observability), screens §S9.7 and §S9.9.
- **Files:** package.json @vercel/otel and peers (per §5.2 rule); rollups on acc-29 reports; fal price sync with admin approval; provider cost capture; monthly invoice reconciliation; max provider spend per hour and day; /admin/analytics; /admin/health; /api/admin/metrics; alerts.
- **Behaviour:** Margin per model including unlimited and blocked runs; drift alert above 5%; spend guard pauses paid cloud routes.
- **Tests:** rollups; price sync; spend guard pause; Prometheus format.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; Studio reports.


#### acc-57 · Platform: launch checklist, announcements, Studio and Platform switch hooks, headless Platform and full E2E

_Effort: medium. Depends on: acc-30, acc-46, acc-47, acc-48, acc-51, acc-52, acc-53, acc-55, acc-56._

- **Sections:** §10.7 (launch checklist), §7.9 (Platform availability, switching), §13 (e2e matrix).
- **Files:** launch checklist and Open to the public; db announcements, announcement_dismissals; banner and RFC 8058 email; onEnter hooks Studio to Platform and Platform to Studio; headless env (FUOBE_PAYMENTS, STRIPE_*, FUOBE_TURNSTILE_*, FUOBE_CREDIT_VALUE_USD, FUOBE_MARKUP_PCT, FUOBE_PLANS_TEMPLATE, FUOBE_LAUNCH); Email & DNS checks; platformAvailable flag on (the setup card and FUOBE_MODE=platform enabled); e2e suites and docs.
- **Behaviour:** Open to the public only when the 12 required items pass; Platform to Studio asks about public accounts and staff roles and is refused while subscriptions are active.
- **Tests:** launch gating; mode-switch Platform cases; e2e platform-signup, platform-billing, platform-admin, platform-safety; the full per-role layout matrix.
- **Must not break:** demo-mode e2e (FUOBE_MODE=personal FUOBE_DEMO_MODE=on), API tokens (legacy and new), MCP, share links (/s/<token> and its files), FUOBE_PASSWORD, and Just me on this computer; Studio and Personal setup; FUOBE_DEV_PLATFORM still works for development.


## Sources (read 2026-10-29)

**Fuobe** at `claude/fuobe-parity-4` (`545ebb5`; the audits also cite `76ecd89` for the same files): `src/server/auth.ts` L1–300; `src/proxy.ts` L10–118; `src/app/api/auth/{login,logout,password,tokens}/route.ts`; `src/server/db.ts` L6–595 (23 migrations, 43 tables); `src/server/generations.ts` L149, L420–441, L517, L540, L691, L777, L977, L1028, L1117, L1323, L1481, L1641, L1700; `src/server/training.ts` L149, L176, L221, L563–599, catalog targets in `src/lib/catalog/training.ts` L261–372; `src/server/enhance.ts` L37; `src/server/assist/agent.ts` L385–643, L1110–1124; `src/server/faceless.ts` L215, L1343–1357; `src/server/storage.ts` L141–279; `src/server/file-response.ts` L14–38; `src/server/live.ts` L36–153; `src/server/shares.ts` L319–327; `src/server/share-access.ts` L64–182; `src/server/settings.ts` L19–75; `src/server/model-access.ts` L135–153; `src/server/request-schema.ts` L100, L109–133; `src/lib/catalog/payload.ts` L418–426; `src/server/providers/comfyui.ts` L96–112, L807–811, L1171; `src/server/canvas.ts` L121; `src/server/elements.ts` L30–104; `src/server/shorts-schemas.ts` L94–118; `src/app/api/status/route.ts` L24–34; `src/components/{app-sidebar.tsx L386–428, phone-bar.tsx L11–30, settings-form.tsx L22–48 L155 L241, get-started.tsx L114–159, library-view.tsx L49–62, ui/sheet.tsx L60–70, security-settings.tsx}`; `next.config.ts` L5; `package.json` L38–62; `bin/lib/config.mjs`; `scripts/eval/lib/run.mjs` L179; `workflows/comfyui/bg-remove-birefnet.json` L18; `tests/library.test.ts` L741–746; `vitest.config.ts`; `README.md` (browser checks); `docs/STATUS.md` L192, L289; `docs/research/liner-ui.md` L320–335, L579–612. Counts: 192 `route.ts` files; 171 Vitest files (39 import route handlers, 101 import server modules); 28 e2e scripts; no `"use server"`.

**Next 16** (bundled at `node_modules/next/dist/docs/01-app/`): `02-guides/authentication.md` L25, L519–528, L1011–1033, L1121–1137, L1507; `02-guides/authentication-with-cache-components.md` L47–60, L309–313; `02-guides/data-security.md` L56–75, L279–299, L603–611; `03-api-reference/03-file-conventions/proxy.md` L11, L19, L236–255; `01-getting-started/16-proxy.md`; `03-api-reference/04-functions/cookies.md` L6, L74; `03-api-reference/03-file-conventions/route.md` L559–590; `03-api-reference/04-functions/revalidateTag.md` L142; `03-api-reference/06-cli/next.md` L71, L123; `02-guides/self-hosting.md` L155–177.

**Libraries** (tarballs unpacked under `/home/user/ext/`, read, never run): better-auth 1.7.14 `dist/cookies/index.mjs` L20–45, `dist/api/rate-limiter/index.mjs` L190, L236–262, L305–318, `dist/oauth2/link-account.mjs` L140–141, `dist/db/internal-adapter.mjs` L285, `dist/context/create-context.mjs` L170–176, `dist/plugins/captcha/constants.mjs`, `dist/plugins/admin/*`; `@better-auth/utils` `password.node.mjs` L3–30; `@better-auth/sso` 1.7.14 `dist/index.mjs` L2690, L4540–4542; `@better-auth/stripe` 1.7.14 `dist/index.mjs` L1551–1600; `@boxyhq/saml-jackson` 26.2.0 `dist/db/sql/sql.js` L78. ComfyUI v0.43.1: `server.py` L600–615, L1170–1177, L1305–1316; `folder_paths.py` L262–272; `app/user_manager.py` L36–70; `comfy/cli_args.py` L225; `execution.py` L680–686, L1306–1330. npm registry (`https://registry.npmjs.org/<package>`, publish dates) and OSV (`https://api.osv.dev/v1/query`) for better-auth, `@better-auth/*`, nodemailer, stripe, `@simplewebauthn/*`, uqr, sharp, `@contentauth/c2pa-node`, `@aws-sdk/client-s3`, `@vercel/otel`, next-auth, `@auth/core`, lucia, arctic, oslo, otplib, openid-client, jose, `@node-saml/node-saml`, samlify, scimmy, ldapts, argon2, iron-session, resend, postmark, bullmq, pg-boss, graphile-worker; `https://www.better-auth.com/docs/` (sqlite adapter, database, CLI, Next integration, security, organization, admin, 2fa, sso, scim); `https://vercel.com/blog/vercel-acquires-better-auth`; `https://www.better-auth.com/blog/authjs-joins-better-auth`; `https://lucia-auth.com/`; `https://pilcrowonpaper.com/blog/18`; `https://github.com/ory/polis`.

**Standards:** OWASP ASVS 5.0 (`OWASP/ASVS` at `9ccce0e`: `0x15-V6-Authentication.md`, `0x16-V7-Session-Management.md`, `0x17-V8-Authorization.md`, `0x25-V16-Security-Logging-and-Error-Handling.md`, `0x92-Appendix-C_Cryptography.md`, `0x12-V3-Web-Frontend-Security.md`); OWASP Cheat Sheets (Password Storage, Forgot Password, Session Management, Authorization, IDOR Prevention, Credential Stuffing, Multifactor Authentication, SAML Security); NIST SP 800-63B-4 (`https://pages.nist.gov/800-63-4/sp800-63b/authenticators/`, `/syncable/`, `https://csrc.nist.gov/pubs/sp/800/63/b/4/final`); W3C WebAuthn Level 3 (`https://www.w3.org/TR/webauthn-3/`); `https://passkeys.dev/docs/use-cases/bootstrapping/`; SQLite `https://www.sqlite.org/lang_altertable.html`, `https://www.sqlite.org/wal.html`.

**The parity studio** (product and UI parity only): help centre `{studio-site}/creator-hub/help-center/` (getting-started/create-an-account-and-sign-in, getting-started/whats-in-my-studio-account, account/how-do-i-recover-access-to-my-account, account/how-do-i-permanently-delete-my-account, account/how-do-i-submit-a-gdpr-ccpa-or-privacy-request, account/who-owns-my-generations-and-can-i-use-them-commercially, business/team-and-business-studio, plans/*, credits/*, refunds/*, billing/*, community/*, troubleshooting/*, integrations/what-is-the-studio-api); `{studio-site}/enterprise`; `{studio-site}/team-plan`; `{studio-site}/creator-hub/changelog`; `{studio-site}/blog/{studio}-pricing-explained`; `{studio-site}/blog/ai-video-team-plans-compared`; `{studio-service}/v1/environment`; client bundle files under `{studio-assets}/tanstack/assets/` (`01bd19df-ij0FP3MXG0GkVG4Z.js`, `-yMDX0zfZICQ9H7Zy.js`, `-3LcKjRnXWlxEkBJA.js`, `-IPfz1JFFFl3cZkaM.js`, `-jeilZTqCBqXiuAZ9.js`, `-5n2JXIZLGM4DCryM.js`), read as text; third-party snapshots `https://www.krea.ai/blog/{studio}-pricing-explained-2026-unlimited-credits-and-real-monthly-costs`, `https://www.krea.ai/blog/what-is-studio-ai-pricing-free-plan-and-alternatives-in-2026`, `https://www.blotato.com/blog/{studio}-pricing`, `https://krater.ai/blog/{studio}-pricing`.

**Peers:** `https://www.krea.ai/pricing`, Krea docs `features/teams.md`, `help-and-support/organization-management.md`, `login-and-account.md`; `https://runway.com/pricing`, `https://runway.com/team-plan`, `https://help.runwayml.com/hc/en-us/articles/24297557468563-Creating-a-Runway-Account`, `https://docs.runway.com/guides/sharing/sso`; `https://www.magnific.com/pricing`, `/business`, `/ai/docs/business-and-enterprise`; `https://intercom.help/leonardo-ai/en/articles/9393396-teams-faq`, `https://eesel.ai/blog/leonardo-ai-pricing`; `https://kling.ai/docs/point-policy`, `https://eesel.ai/blog/kling-ai-pricing`; `https://docs.midjourney.com/docs/plans`, `/your-midjourney-account`; `https://www.canva.com/help/roles-and-permissions/`, `/sign-up-log-in/`, `/enterprise-manage-teams-organization-structure/`, `https://www.canva.com/pricing/`; `https://www.figma.com/pricing/`, `https://help.figma.com/hc/en-us/articles/1500007609322-Guide-to-sharing-and-permissions`; `https://liner.com/pricing`, `https://liner.com/` (UI strings in the page JSON), `https://pricingsaas.com/companies/liner`.

**Self-hosted apps:** `https://docs.openwebui.com/` (rbac/roles, rbac/groups, hardening, auth/sso, auth/scim, troubleshooting/password-reset); `https://docs.immich.app/` (post-install, user-management, server-commands, oauth, sharing, partner-sharing); `https://docs.n8n.io/` (user-management-self-hosted, rbac, cli-commands, saml, oidc, ldap, log-streaming); `https://docs.gitea.com/administration/config-cheat-sheet`, `/command-line`; `https://forgejo.org/docs/latest/admin/config-cheat-sheet/`, `/command-line/`; `https://jellyfin.org/docs/general/server/users/` and `Jellyfin.Api/Controllers/UserController.cs`, `DefaultPasswordResetProvider.cs`; `https://docs.nextcloud.com/server/latest/admin_manual/occ_users.html`, `https://github.com/nextcloud/user_oidc`, `/user_saml`; `https://docs.gitlab.com/user/permissions/`; `https://grafana.com/docs/grafana/latest/administration/roles-and-permissions/`; `https://docs.mattermost.com/administration-guide/onboard/sso-saml.html`; `https://develop.sentry.dev/self-hosted/sso/`; `https://github.com/liusida/ComfyUI-Login`.

**Platform money and operations:** `https://docs.stripe.com/webhooks`, `/checkout/fulfillment`, `/billing/subscriptions/prorations`, `/billing/subscriptions/usage-based/billing-credits`, `/billing/subscriptions/usage-based/recording-usage-api`, `/billing/entitlements`, `/customer-management`, `/tax/set-up`, `/api/idempotent_requests`, `/disputes/prevention/card-testing`, `/payments/managed-payments`, `/payments/managed-payments/eligibility`; `https://stripe.com/pricing`; `https://www.paddle.com/pricing`, `https://developer.paddle.com/webhooks/respond-to-webhooks`; `https://polar.sh/docs/merchant-of-record/fees`, `/features/usage-based-billing/introduction`; `https://fal.ai/docs/documentation/model-apis/pricing.md`, `https://fal.ai/docs/model-apis/model-endpoints/queue`, `https://fal.ai/models/fal-ai/x-ailab/nsfw/llms.txt`; `https://replicate.com/docs/topics/predictions/lifecycle.md`, `/safety-checking.md`; LibreChat (`8d3da9bb`: `packages/data-schemas/src/schema/balance.ts`, `methods/transaction.ts` L242–300, L470–590), Dify (`fd5c3696`: `api/services/quota_service.py` L14–130, `feature_service.py` L26), new-api (`e449cc70`: `service/billing_session.go`, `model/redemption.go`, `setting/ratio_setting/group_ratio.go`); `https://www.librechat.ai/docs/configuration/token_usage`; `https://litestream.io/how-it-works/`; `https://developers.cloudflare.com/r2/api/s3/presigned-urls/`; `https://developers.cloudflare.com/turnstile/get-started/server-side-validation/`; `https://github.com/disposable-email-domains/disposable-email-domains`; `https://support.google.com/a/answer/81126`; `https://resend.com/pricing`; `https://postmarkapp.com/pricing`.

**Trust, safety and law:** `https://huggingface.co/meta-llama/Llama-Guard-4-12B`; `https://huggingface.co/google/shieldgemma-2-4b-it`; `https://huggingface.co/Falconsai/nsfw_image_detection`; `https://www.law.cornell.edu/uscode/text/18/2258A`; `https://www.microsoft.com/en-us/photodna`; `https://developers.cloudflare.com/cache/reference/csam-scanning/`; Thorn Safer Predict press release; `https://wilmerhale.com/en/insights/client-alerts/20260615-the-take-it-down-act-goes-live`; `https://www.insideprivacy.com/united-states/federal-trade-commission/the-take-it-down-acts-notice-and-removal-requirements-enter-into-effect/`; `https://www.copyright.gov/dmca-directory/faq.html`; `https://www.addleshawgoddard.com/en/insights/insights-briefings/2026/technology/eu-ai-act-code-practice-marking-labelling-ai-generated-content/`; `https://www.reedsmith.com/our-insights/blogs/viewpoints/102nbz0/transparency-obligations-for-ai-generated-content-the-code-of-practice-adequacy/`; C2PA specification 2.3 (`https://spec.c2pa.org/specifications/specifications/2.3/specs/_attachments/C2PA_Specification.pdf`); `https://www.ofcom.org.uk/online-safety/protecting-children/letter-to-part-3-services-that-allow-pornography-outlining-heaa-requirements`; `https://gdpr-info.eu/art-12-gdpr/`; `https://interface-eu.org/storage/pdf/dsa_article_overview.pdf`; `https://www.legislation.gov.uk/eudr/2005/29/article/7` (UCPD Art. 7); Directive 98/6/EC; Directive 2002/58/EC Art. 5(3).

**Owner:** `/home/user/ext/owner-decisions.json` (`accounts`, answered 2026-10-29: `signUp`, `libraries`, `localUse`, `paidKeys`, `enterprise`, `setup`, `deploymentModes`).
