# GitHub Setup

This guide walks you through connecting moou to GitHub so you can search, link, and publish outcomes as GitHub issues. If you're a developer adding a new backend integration, see [INTEGRATIONS.md](INTEGRATIONS.md) instead.

## What you'll get

Once connected, moou can:

- **Connect** an outcome to an existing GitHub issue (or pull request) — search by query, click to link, see the issue's title, status, labels, assignee, and milestone inline on the outcome
- **Publish** a draft outcome as a brand-new GitHub issue, with the outcome's title and description carried over verbatim
- **Refresh** cached issue details every 15 minutes (or on demand via the refresh button), using ETag conditional requests so you don't burn through GitHub's rate limit
- **Track child progress** for issues that have sub-issues (where supported by your repo)
- **Sign in with GitHub OAuth** so every audit log entry is attributed to a real GitHub account

The boundary stays clean: moou keeps owning the **why** (motivations, scoring, milestone scheduling) and GitHub keeps owning the **how** (assignees, sprints, code).

## Prerequisites

- A GitHub account
- A GitHub repository you have admin access to (for creating the OAuth App and for publishing issues into it)
- moou running locally or on a server you control
- PostgreSQL up and reachable (for the user account that gets upserted on first sign-in)

## Step 1: Create a GitHub OAuth App

1. Go to **https://github.com/settings/developers** and click **OAuth Apps**, then **New OAuth App**.
2. Fill in the form:

   | Field | Value |
   |---|---|
   | **Application name** | `moou` (or whatever you like — it's shown to you on the consent screen) |
   | **Homepage URL** | `http://localhost:3000` for local dev, or your real domain in production |
   | **Application description** | optional |
   | **Authorization callback URL** | `http://localhost:3000/auth/callback` for local dev (must match `GITHUB_CALLBACK_URL` in your env exactly) |

3. Click **Register application**.
4. On the next screen, copy the **Client ID** — you'll need it in a moment.
5. Click **Generate a new client secret**, then immediately copy the secret. GitHub only shows it once. If you lose it, you can generate a new one — old secrets are revoked.

> **Note on private repos**: OAuth Apps with the `repo` scope can read and write private repositories the user grants access to. If your repo is private, this is the right kind of credential. If everything is public, the same setup still works but the broader scope isn't strictly necessary.

## Step 2: Configure environment variables

Add the following to your `.env` (or set them in whatever environment your deployment uses):

```bash
EXTERNAL_PROVIDER=github

GITHUB_CLIENT_ID=Iv1.xxxxxxxxxxxxxxxx                  # from step 1
GITHUB_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GITHUB_CALLBACK_URL=http://localhost:3000/auth/callback # must match the OAuth App
GITHUB_REPO=your-org/your-repo                          # owner/repo format

SESSION_SECRET=<at least 32 random characters>          # generate with: openssl rand -hex 32
```

The session secret encrypts the iron-session cookie. It must be at least 32 characters and should never be checked into version control. If you change it, every existing session is invalidated and users will need to sign in again.

`GITHUB_REPO` scopes the integration to a single repository. moou's search and create operations target this repo. For multi-repo deployments, run multiple instances or wait for v2 (which will support a per-outcome repo override).

`CORS_ORIGINS` should also include the origin your browser loads moou from — typically `http://localhost:5173,http://localhost:5174` for local Vite, or your production domain for deploys.

## Step 3: Restart and sign in

1. Restart the API server so it picks up the new env vars. With docker-compose:
   ```bash
   docker compose up app -d --force-recreate
   ```
   Or if you're running the API directly:
   ```bash
   npm --prefix api run dev
   ```
2. Open the moou frontend.
3. Click **Sign in with GitHub** in the top-right corner. You'll be redirected to GitHub, asked to authorise the app, and bounced back to moou.
4. Your GitHub username and avatar should now appear in the top bar. The first sign-in upserts a user row with `id = github:<your-github-numeric-id>` and attributes all subsequent edits to that user.

If you don't see the sign-in button — moou is still in mock-user mode. Double-check `EXTERNAL_PROVIDER=github` is set in the env the API server actually loaded. Restart the server after editing `.env` (it doesn't auto-reload env vars).

## Step 4: Connect an outcome to an existing issue

1. Open any outcome in moou. In the **Linked Items** section, click **Connect to Issue**.
2. The Connect dialog opens. Type a search query — title fragments, label names, anything that would work in GitHub's normal issue search.
3. Results stream in after a 300ms debounce, showing issue number, title, state badge (open / closed / merged / draft), labels, and assignee.
4. Click a result to link it. The dialog closes and a rich card appears in the Linked Items section showing the issue title, current status, labels, assignee avatar, milestone (if any), and a "Updated X min ago" freshness timestamp.

The connected card stays in sync via two paths: the **manual refresh button** (the ↻ icon on each link) and the **automatic background refresh** that runs every 5 minutes for items older than 15. Both use ETag conditional requests so refreshes are free against your GitHub rate limit if nothing has changed.

If the issue has sub-issues, a progress bar appears showing how many are closed (e.g. "3/7 done"). Sub-issue support depends on your repo's plan; the bar simply doesn't render for repos that don't expose them.

## Step 5: Publish a draft outcome as a new issue

This works for outcomes that **don't yet have any external links** (the implicit "Draft" state).

1. Open a draft outcome. In the Linked Items section, click **Publish as GitHub**.
2. If you have multiple creatable entity types, an entity-type picker appears. (For GitHub, only "Issue" is creatable — pull requests need head/base branches and can't be made from a title alone, so they're filtered out.)
3. Click **Publish to GitHub**. You'll get a confirmation dialog: "This will create a new GitHub issue. Continue?"
4. moou calls the GitHub API to create the issue with the outcome's title and description, fetches the new issue's full details, and links the outcome to it. The card appears immediately with a **Published** badge (vs the **Connected** badge you see for pre-existing items).

Once an outcome is connected or published, the **Publish** button disappears — you can still link more items via Connect, but Publish is reserved for the first canonical "this outcome corresponds to this backend item" relationship.

## Troubleshooting

### "Sign in with GitHub" doesn't appear

- `EXTERNAL_PROVIDER` isn't set to `github` in the API server's environment
- The API server hasn't been restarted since you edited `.env`
- Check `curl http://localhost:3000/api/provider` — it should return `{"name":"github",…}`. If it returns `valueedge`, the env isn't loaded

### OAuth callback returns "Invalid state parameter (CSRF check failed)"

- Your iron-session cookie was lost between the redirect to GitHub and the bounce back. Common causes:
  - You restarted the API server mid-flow (the in-memory state is fine, but if `SESSION_SECRET` changed, all cookies are invalidated)
  - Browser is blocking third-party cookies and you're loading moou from a different origin than `GITHUB_CALLBACK_URL`
  - You opened the OAuth flow in one tab and clicked the callback in another browser
- Fix: clear the `moou_session` cookie for `localhost:3000` (or whatever origin) and try again from a fresh tab

### "GitHub OAuth error: bad_verification_code"

- The `code` in the callback URL was already exchanged or has expired (codes are single-use and expire after ~10 minutes)
- You may have refreshed the callback URL in the browser, which re-submits the same code. Restart the flow from `/auth/github`

### Connect dialog returns no results for queries you know match issues

- The configured `GITHUB_REPO` doesn't match the repo your issues actually live in. Check the `owner/repo` exactly
- Your GitHub OAuth token doesn't have access to the repo. Re-authorise the app and grant access to the right org if needed
- GitHub search has indexing lag — newly-created issues can take a minute or two to appear in search

### Publish returns `502 BACKEND_ERROR` with "Cannot create pull requests"

- Expected. PRs need a head and base branch and can't be created from `title + body` alone. Pick **Issue** in the entity-type picker (or just use the default — the picker filters PRs out for Publish but not for Connect)

### "Server returned non-JSON for /api/backend/entity-types (status 404)"

- The API server is running stale code that doesn't have the GitHub adapter routes. Restart it and make sure you're running the latest build. The toast message specifically mentions this case because it tripped me up at least once

### Toast: "Could not reach the server. Is the API running?"

- The frontend can't reach the API origin. Check that `localhost:3000` is up, that `CORS_ORIGINS` includes your frontend's origin, and that you don't have a firewall or VPN blocking it

### Rate limited on the refresh job

- GitHub allows 5,000 authenticated requests per hour. ETag conditional requests (304 responses) don't count against this. If you're hitting limits despite ETags, lower the refresh frequency by editing the cron interval in `api/src/index.ts`, or raise the stale threshold in `refreshStaleLinks()`

## Production deployment notes

- Set `GITHUB_CALLBACK_URL` to your production HTTPS URL (e.g. `https://moou.example.com/auth/callback`) and update the OAuth App's authorization callback URL to match
- Set `NODE_ENV=production` so iron-session marks the cookie `Secure` (only sent over HTTPS)
- `SESSION_SECRET` must be unique per environment and stored in your secret manager — never commit it
- For docker-compose deployments, add the GitHub vars to `docker-compose.yml` under the `app` service's `environment:` block
- If you run multiple replicas behind a load balancer, set up sticky sessions or migrate to a server-side session store (iron-session is stateless cookie-based, so this is mostly fine — just don't change the secret without coordinating)

## Switching back to mock-user mode

For local development without GitHub:

```bash
EXTERNAL_PROVIDER=valueedge   # or any other non-github value
```

Restart the API server. The mock user dropdown returns and you can switch between Sarah, James, Dev, and Anna. GitHub-related features are hidden but everything else still works against the same database.
