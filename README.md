# SlothDesk Public Edition 🦥

A full-stack upload → review → organized ZIP application. React + Vite, Express + Node.js, MongoDB, and optional Ollama. This is the public-site conversion of the supplied local SlothDesk project.

## What changed

- Email/password accounts replace the shared API token. Passwords use salted scrypt hashes. Sessions live in MongoDB; only a random HttpOnly, SameSite=Strict cookie reaches the browser. Production cookies require HTTPS.
- Each user has a private set of uploads. Every upload, plan, download, summary and delete query is scoped to the authenticated owner. Server folders are never browsable through the API.
- Visitors upload files or a folder, review suggestions and duplicate groups, and download an organized ZIP. Original device files are never moved or deleted.
- Review choices control inclusion and whether each file uses its suggested path or its uploaded relative path. No arbitrary server move destinations or public file URLs exist.
- Temporary files expire 24 hours after upload and are removed by a one-minute cleanup loop while the server is running. A startup sweep catches expired files after downtime. Access is rejected immediately after expiry even before cleanup finishes.
- Daily digests cover active uploaded copies only. A browser website cannot silently scan a visitor's local folders.

## Quick start — Windows

Requires Node.js 22 LTS or newer and MongoDB Server or Atlas. Extract the ZIP, open the inner `slothdesk` folder containing package.json, then:

```powershell
npm ci
Copy-Item server/.env.example server/.env
```

Edit `server/.env`:

```dotenv
MONGODB_URI=mongodb+srv://YOUR_USER:YOUR_ENCODED_PASSWORD@cluster0.84lxv2f.mongodb.net/slothdesk_public?retryWrites=true&w=majority
PORT=4100
NODE_ENV=development
APP_ORIGIN=http://localhost:5173
STORAGE_DIR=
TRUST_PROXY=0
DNS_SERVERS=1.1.1.1,1.0.0.1
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=
```

Use your real database user and URL-encoded password. Add your current computer IP to Atlas Network Access. The DNS_SERVERS line preserves the successful DNS fix tested in your earlier version; on networks with working default DNS, leave it empty. Keep credentials out of Git and shared ZIPs.

```powershell
npm run dev
```

Open **http://localhost:5173** exactly. Click Create account, use a password with at least 12 characters, and choose files or a folder. The frontend proxies `/api` to port 4100. Use `localhost`, not `127.0.0.1`, unless you also change APP_ORIGIN accordingly. Exact-origin checks prevent cross-site mutations. No API_TOKEN or WORKSPACE_ROOT is used in this edition.

On macOS/Linux use `cp server/.env.example server/.env`. All other npm commands match Windows.

For a production-style local preview: `npm run build`, set APP_ORIGIN=http://127.0.0.1:4100 with NODE_ENV=development, then `npm start`. Open that exact URL. NODE_ENV=production is for HTTPS deployments; secure cookies won't work on plain HTTP.

## Public hosting

Follow [DEPLOYMENT.md](DEPLOYMENT.md). The easiest layout is one Node web service serving the built React frontend and API, plus MongoDB Atlas and a private persistent disk. The package includes render.yaml and a Dockerfile. Nothing has been deployed or charged automatically.

## Limits and storage

| Limit | Default |
| --- | --- |
| Files per upload | 50 |
| Maximum file size | 10 MiB |
| Total file bytes per upload | 50 MiB |
| Active uploads per account | 5 |
| Active uploads across service | 100 |
| Simultaneous upload requests | 2 |
| File retention | 24 hours from upload |
| Session lifetime | 7 days |
| Digest history | 30 days |

Limits are defined in server/src/storage.js. Byte counting happens during streaming writes, so total limits apply to chunked requests too. Storage is bounded to about 5 GiB of uploaded contents plus operational overhead; use a 10 GB persistent disk with these defaults. Rate limits and quota accounting assume **one Node process and one attached storage volume**. Do not run cluster mode or multiple replicas against the same database. Startup reconciles quota counters against retained jobs.

File bytes are stored only under STORAGE_DIR in random upload-ID directories with random filenames. MongoDB stores users, hashed sessions, relative filenames, hashes, review plans and digests. This is not end-to-end encryption: the server operator and infrastructure can access uploaded bytes and metadata. Use storage encryption and a private MongoDB account appropriate to your deployment.

## Suggestions and duplicates

Classification derives from extension; normalized filenames provide organization suggestions. Exact duplicate groups require equal SHA-256 hashes. Similar groups share normalized filenames with differing contents; these need manual review. Duplicate detection is within each upload. Estimates assume one copy per exact group and do not account for storage-level compression/deduplication.

Optional Ollama: install/pull a model on infrastructure reachable by the backend, set OLLAMA_MODEL (for example llama3.2:3b), and set OLLAMA_URL. Only filenames/categories from up to 80 files are sent, never document bodies. Leave the model empty for rules. Failed inference falls back to rules with a visible warning. File contents are not semantically analyzed; summaries are generated from statistics, not an LLM.

Uploads are not extracted or executed. A ZIP uploaded as input is treated as an ordinary file, not unpacked. Output names are sanitized and collision-safe, including case-insensitive and file-versus-directory conflicts. ZIP contents are streamed on download and do not overwrite local files. The app does not provide malware scanning or document preview; people should open only files they trust.

## Daily digests and deletion

New uploads refresh today's digest. A one-minute maintenance loop creates a digest once per UTC date for opted-in accounts with active uploads. It runs only while the backend is running. Digests describe uploaded copies and may outlive those copies; each digest expires after 30 days. Preferences can disable scheduled digests; manual refresh and upload-triggered refresh remain available. Early deletion removes the chosen upload's metadata and bytes; historical aggregate digests and the account remain. Backups, if enabled by the operator, follow the operator's separate retention policy.

## API

Same-origin cookie sessions are used. After register/login, `/api/auth/me` restores the current user and CSRF token. Send `X-CSRF-Token` plus the matching `Origin` for authenticated mutations. Never put tokens in URLs or localStorage. No CORS configuration is required in the supplied single-origin layout.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | /api/health | Public database readiness, no private details |
| POST | /api/auth/register | `{name,email,password}` |
| POST | /api/auth/login | `{email,password}` |
| GET | /api/auth/me | Current user, CSRF token, limits |
| POST | /api/auth/logout | Revoke current session |
| PUT | /api/settings | `{dailyDigest:boolean}` |
| GET | /api/jobs | Current user's unexpired uploads |
| POST | /api/jobs | Multipart: name, paths JSON array, files[] under repeated `files` field |
| PUT | /api/jobs/:id/plan | `{choices:[{id,include,organize}]}` with one entry per file |
| GET | /api/jobs/:id/download | Stream ZIP for saved choices |
| DELETE | /api/jobs/:id | Delete private upload and bytes |
| GET | /api/summaries | Current user's last 30 digests |
| POST | /api/summaries | Refresh today's digest |

Paths manifest entries correspond to files in their multipart order. Browser directory uploads use webkitRelativePath for relative layout; browsers without folder selection can upload multiple files. Windows paths and absolute paths are not accepted. Path components are never used to locate storage on the server.

## Testing

```sh
npm test
npm run build
npm audit --omit=dev
```

Tests use a fresh temporary MongoDB process via mongodb-memory-server; its first run downloads an OS-specific MongoDB binary. They never connect to MONGODB_URI or production data. Restricted environments may not permit the MongoDB subprocess. Unit tests can be run separately with `npm run test:unit -w server`. API integration tests cover cookie login/logout, CSRF/origin rejection, cross-user isolation, multipart upload, ZIP review, expiry, quotas, deletion and error cleanup. See VALIDATION.md for checks actually completed for this delivery.

## Project layout

- client/src/main.jsx — account screens, uploads, review plan, duplicates, digests, settings.
- client/src/style.css — responsive dashboard.
- server/src/app.js — protected API and built frontend hosting.
- server/src/auth.js — password hashing and server-side sessions.
- server/src/models.js — MongoDB schemas and indexes.
- server/src/organizer.js — safe names, classification, hashing, duplicate grouping and ZIP paths.
- server/src/storage.js — upload storage, byte limits, quotas, expiry and digests.
- server/src/ai.js — optional Ollama naming.
- server/src/index.js — environment config, MongoDB, startup and maintenance.

The old local folder API and shared-token login have been intentionally removed. Legacy MongoDB collections are not migrated or exposed; public records use separate Public* model collections. Prefer a separate database (`slothdesk_public`) for this edition.

## Scope

This is a deployable first public version with user isolation and upload/download behavior, not an unrestricted file-hosting service. Password recovery, email verification, CAPTCHA, account deletion, admin moderation and billing are not included. There is no claim of independent security certification. Add recovery and anti-abuse controls for your intended audience before growing beyond a small launch, and review provider logs/quotas. The operator must supply appropriate privacy/contact information. Public hosting and optional model inference can incur costs.
