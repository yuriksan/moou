---
date: 2026-04-06
topic: github-integration
---

# GitHub Integration — OAuth Auth + Read-Only Issue Sync

## Problem Frame

moou currently uses mock auth (X-User-Id header) and stores external links as dumb URLs. Users linking GitHub issues get no feedback on whether the issue exists, its current status, or who's assigned. They must context-switch to GitHub to see delivery state. For moou to be a real prioritisation dashboard, it needs to show linked issue details inline and authenticate users via their existing GitHub identity.

## Requirements

- R1. **GitHub OAuth login** — Users authenticate via GitHub OAuth. On first visit, moou redirects to GitHub. After approval, a signed cookie stores the session. The user's GitHub profile (username, display name, avatar) becomes their moou identity.
- R2. **Provider-agnostic user identity** — User records store `provider` + `providerId` (e.g. `github:andyjeffries`). Auto-created on first login. The existing mock auth continues to work for dev mode (`provider: mock`). Each provider auth module implements: redirect, token exchange, profile fetch.
- R3. **Signed cookie session** — OAuth access token and user info stored in an encrypted/signed cookie. No server-side session table. Cookie expires with the token.
- R4. **Container-level config** — GitHub connection configured via env vars at deploy time, not through UI:
  - `EXTERNAL_PROVIDER=github`
  - `GITHUB_REPO=org/repo`
  - `GITHUB_CLIENT_ID=xxx`
  - `GITHUB_CLIENT_SECRET=xxx`
  - `GITHUB_CALLBACK_URL=http://localhost:3000/auth/callback`
- R5. **Link validation** — When creating an external link to a GitHub issue/PR, moou validates it exists via the GitHub API. If not found (or user lacks access), the link is rejected with a clear error.
- R6. **Inline issue details** — Linked GitHub issues/PRs display inline in the outcome detail panel: title, status (open/closed/merged), labels, assignee, and a direct link. No need to leave moou.
- R7. **Periodic status refresh** — Linked issue details are cached and refreshed periodically (e.g. every 15 minutes or on page load if stale). Status changes in GitHub (issue closed, PR merged) reflect in moou without manual action.
- R8. **Developer integration docs** — Documentation for developers on how to build a new provider integration by implementing the auth and API modules. Covers: auth flow, profile mapping, link validation, entity detail fetching, refresh strategy. Developers contribute to core code (fork + PR), not a plugin system.
- R9. **User documentation** — Documentation for end users on how to activate the GitHub integration: env vars to set, GitHub OAuth app setup, what to expect after login.

## Success Criteria

- A user can sign in to moou via GitHub and see their name/avatar in the topbar
- Linking a GitHub issue validates it exists and shows its title + status inline
- A closed GitHub issue shows as "closed" in moou without manual refresh
- A developer can read the docs and understand how to add a Jira or Linear integration
- Mock auth still works for local development without GitHub config

## Scope Boundaries

- **No write operations** — moou does not create, update, or close GitHub issues (v2)
- **No webhooks** — Status refresh is poll-based, not webhook-driven (v2)
- **Single repo per deployment** — configured via env var, not multi-repo
- **No GitHub App** — uses OAuth App (simpler, no installation flow)
- **No role-based access** — all authenticated users have the same permissions (existing v1 constraint)
- **No issue search/browse within moou** — user pastes the issue number or URL to link

## Key Decisions

- **GitHub OAuth over PAT**: Per-user tokens mean audit trail is accurate (who linked what) and access scoping is automatic (users can only link issues they can see)
- **Signed cookie over server-side session**: No session table, no cleanup cron, simpler deployment. Acceptable for a small team tool.
- **Container config over UI settings**: Keeps deployment simple, matches existing EXTERNAL_PROVIDER pattern, no settings page to build
- **Provider-agnostic user model**: `provider` + `providerId` on user records. Future Jira/Linear integrations follow the same pattern without schema changes.
- **Auto-create users on first login**: No admin provisioning step. If you can authenticate via the configured provider, you're a moou user.
- **Read-only first**: Validation + display + refresh. No write operations. Establishes the integration pattern cleanly before adding mutations.

## Dependencies / Assumptions

- GitHub OAuth App must be created in the target org/account (user does this manually, documented in R9)
- The configured repo must be accessible to all users who will log in
- GitHub API rate limits (5000 req/hr for authenticated users) are sufficient for a small team

## Outstanding Questions

### Deferred to Planning

- [Affects R3][Technical] What cookie encryption library to use (e.g. `iron-session`, `cookie-signature`, or manual `crypto.createCipheriv`)
- [Affects R7][Needs research] GitHub API best practices for polling issue status — ETag/conditional requests to avoid rate limit waste
- [Affects R6][Technical] How to store cached issue details — in the external_links table as a JSONB column, or a separate cache table
- [Affects R2][Technical] How the auth middleware switches between mock mode and OAuth mode based on EXTERNAL_PROVIDER config

## Next Steps

→ `/ce:plan` for structured implementation planning
