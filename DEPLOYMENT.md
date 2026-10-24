# Put SlothDesk online

This guide deploys one public HTTPS Node service. It serves both the built React frontend and API, uses MongoDB Atlas for records, and a private persistent disk for temporary file bytes. Do not deploy this version as a static-only Vercel/Netlify site: it needs a running backend and upload storage.

## 1. Prepare your code

1. Extract the ZIP.
2. Open the inner `slothdesk` folder.
3. Upload **its contents** to your GitHub repository. package.json and render.yaml should be at repository root, not buried inside another slothdesk folder.
4. Do not commit `.env`, node_modules, client/dist or storage. The included .gitignore handles these paths. The public code no longer uses API_TOKEN or WORKSPACE_ROOT.

If you upload to GitHub through its website, include server/src, client/src, their package files, root package-lock.json, vite config, index.html and the deployment files.

## 2. Prepare MongoDB Atlas

1. Keep your cluster running.
2. Create a database user with read/write access to a separate database such as slothdesk_public. This is a database user, not your Atlas website login.
3. Copy Connect → Drivers connection URI. Include the database name and URL-encode special characters in its password.
4. Add the hosting service's outbound IP ranges to Atlas Network Access. Render displays outbound IP information for the service in its dashboard. Avoid opening the database to all IPs when specific ranges are available.

Example only:

```text
mongodb+srv://USER:ENCODED_PASSWORD@cluster0.84lxv2f.mongodb.net/slothdesk_public?retryWrites=true&w=majority
```

Keep this URI secret and set it in the provider's environment settings, not frontend code.

## 3. Create a Render web service

The manual path makes the cost and configuration visible before provisioning:

1. Sign in at https://render.com and choose New → Web Service.
2. Connect the GitHub repository containing this project.
3. Select Node runtime and a region near your audience/database.
4. Choose a compute option that supports a persistent disk. This layout requires paid compute/storage; review current prices in the dashboard before creating it.
5. Configure:

| Setting | Value |
| --- | --- |
| Root directory | Leave blank if package.json is at repository root |
| Build command | `npm ci --include=dev && npm run build` |
| Start command | `npm start` |
| Health check path | `/api/health` |
| Instances/processes | One |

Add a persistent disk mounted at `/var/data/slothdesk`, size 10 GB for the supplied storage caps. Uploads must not live on the default ephemeral filesystem if you want them to survive restarts/redeploys. Render's persistent disks are single-instance and are unavailable during build, which is why storage setup happens at application startup.

Set these environment variables:

| Variable | Value |
| --- | --- |
| NODE_ENV | `production` |
| NODE_VERSION | `22` |
| MONGODB_URI | Your private Atlas URI |
| STORAGE_DIR | `/var/data/slothdesk` |
| TRUST_PROXY | `1` (one Render reverse-proxy hop) |
| OLLAMA_MODEL | Leave unset for working rule-based suggestions |
| DNS_SERVERS | Leave unset unless the host has DNS trouble |

Render supplies PORT and RENDER_EXTERNAL_URL. The code binds `0.0.0.0` in production, uses the supplied PORT, and uses RENDER_EXTERNAL_URL as the default allowed origin. You do not need to guess the public hostname. If APP_ORIGIN is set, it overrides that value and must exactly match the URL visitors use, without a trailing slash.

Click Create Web Service / Deploy after reviewing cost. Watch the deployment logs. When ready, open the provided HTTPS URL. The app is accessible publicly; users still need accounts to access private uploads.

Alternative: use New → Blueprint with the included render.yaml. It configures the same service and disk and prompts for MONGODB_URI. Review the resources and price before confirming. It does not create your Atlas database.

## 4. Verify the public URL

1. Open `/api/health`. Expected response: `{ "ok": true }`.
2. Register a test account with a 12+ character password.
3. Upload two small identical text files with different filenames.
4. Check the exact duplicate group; exclude one copy and save the review.
5. Download the ZIP and verify its filenames and contents.
6. Use a different browser/private window to register a second account. It should show no uploads from the first account.
7. Delete the first upload and confirm it disappears.
8. Log out, log in again, and check that no API token is requested.

The included automated tests exercise the corresponding backend behavior, but the deployed origin, Atlas network rules, disk permissions and HTTPS cookies must also be checked on your host.

## 5. Custom domain

Add a custom domain using the host's domain settings and follow its DNS instructions. After HTTPS is active, set APP_ORIGIN to the exact canonical origin, for example `https://slothdesk.example.com`, then redeploy. Use one canonical hostname and redirect alternatives to it. Logging in through a different origin will fail the same-origin check by design. Do not use wildcard CORS to work around a mismatched APP_ORIGIN.

## Docker / VPS alternative

The supplied Dockerfile builds the frontend and serves it through Node. Example:

```sh
docker build -t slothdesk .
docker run -d --name slothdesk --restart unless-stopped -p 127.0.0.1:4100:4100 --env-file server/.env -v slothdesk-uploads:/app/server/storage slothdesk
```

Before running, set NODE_ENV=production, APP_ORIGIN to your public HTTPS domain, STORAGE_DIR=/app/server/storage and TRUST_PROXY=1 if exactly one trusted reverse proxy is in front. Place an HTTPS reverse proxy (such as Caddy or Nginx with TLS) on that same host. Forward requests to 127.0.0.1:4100 and allow request bodies slightly above 50 MiB to accommodate multipart overhead. Don't expose port 4100 directly to untrusted clients when trusting proxy headers. Use one container/process and private storage. For an ordinary local HTTP preview, use the npm commands in README.md; this production container setup expects HTTPS through the reverse proxy.

## AI on a public host

Your laptop's Ollama is not available at a deployed server's `127.0.0.1`. Leave OLLAMA_MODEL empty unless you have a separately managed inference service reachable by the backend. Do not expose an unauthenticated Ollama port publicly. Metadata-only inference is optional; all upload, review and ZIP features work without it.

## Operating limits

- Run one service instance. In-memory locks and rate limits are not distributed; persistent storage belongs to that instance. Scaling requires object storage, shared locks, shared rate-limit state and a job queue.
- Temporary file access ends at 24 hours. Disk deletion runs on startup and every minute while the service is running. Hosting downtime delays physical deletion. MongoDB TTL deletion of sessions/digests is asynchronous.
- Budget for hosting, database, bandwidth and optional inference. Check actual provider pricing; no free-forever claim is made.
- Keep storage private and backups aligned with your privacy policy. The app does not execute or malware-scan uploaded files.
- This first version has no email verification or password-reset email. Account password recovery is not self-service. If you require these for launch, add a verified email delivery integration before inviting that audience.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| MongoDB querySrv timeout | Host DNS; optionally set DNS_SERVERS=1.1.1.1,1.0.0.1 only if that lookup works on the host |
| MongoDB server selection / authentication error | Atlas database credentials, password encoding and outbound IP allowlist |
| Request origin is not allowed | APP_ORIGIN matches the exact URL, scheme and hostname; no trailing slash |
| Login succeeds but session disappears | HTTPS, NODE_ENV, secure cookie and same-origin frontend/API |
| Frontend build missing | Build command ran with dev dependencies installed |
| Download data unavailable | Persistent disk mounted correctly; upload may have been lost on ephemeral storage |
| Storage full / five-upload limit | Delete old uploads or wait for expiry; keep disk capacity consistent with configured caps |
| Service unhealthy | `/api/health` requires a connected database; inspect logs and Atlas access |

Official deployment references checked while preparing this package:

- https://render.com/docs/deploy-node-express-app
- https://render.com/docs/disks
- https://render.com/docs/health-checks
- https://render.com/docs/blueprint-spec
