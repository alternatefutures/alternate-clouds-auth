# Deploy Auth Service to Akash Network

## Overview

The auth service runs on Akash Network with automated CI/CD via GitHub Actions. There are two deployment workflows:

| Workflow | When to use | What happens |
|----------|-------------|--------------|
| `deploy-akash.yml` | Resource changes (CPU/RAM/storage), fresh start | Creates a **new** deployment with a new DSEQ. Requires updating `update-manifest.yml` with the new DSEQ/provider. |
| `update-manifest.yml` | Code changes (new image) | Updates the **existing** deployment in-place. Runs automatically after Docker image build, or manually. No DNS changes needed. |

## Current deployment state (source of truth)

This guide explains **how** to deploy/update `service-auth`.

For the **current** production DSEQ/provider/IP/endpoints, see:

- `DEPLOYMENTS.md` (repo root)
- `.github/DEPLOYMENTS.md` (repo root)

## How CI/CD Works

```
Push to main
    │
    ▼
docker-build.yml  (builds + pushes image to GHCR)
    │
    ▼
update-manifest.yml  (auto-triggered on build success)
    │
    ├── 1. Install akash CLI + provider-services (latest versions)
    ├── 2. Setup wallet from AKASH_MNEMONIC secret
    ├── 3. Generate + publish fresh certificate
    ├── 4. Generate SDL with new image tag (main-<sha>)
    ├── 5. akash tx deployment update (sync on-chain version hash)
    └── 6. provider-services send-manifest (deliver to provider)
```

The container restarts with the new image. Same DSEQ, same ingress URL, no DNS changes.

## Automated Updates (update-manifest.yml)

This workflow runs automatically after every successful Docker image build on `main`. It can also be triggered manually from the Actions tab.

**Key details:**
- DSEQ and provider are hardcoded in the workflow file (lines 26-27)
- Uses `akash tx deployment update` to sync the on-chain version hash before sending the manifest
- Generates a fresh Akash certificate each run (avoids stale cert issues)
- Installs latest `akash` CLI and `provider-services` to ensure compatibility

### After a full redeploy, update these values:

In `.github/workflows/update-manifest.yml`:
```yaml
env:
  AUTH_DSEQ: "<see repo-root .github/DEPLOYMENTS.md>"        # ← Update with new DSEQ
  AUTH_PROVIDER: "<see repo-root .github/DEPLOYMENTS.md>"    # ← Update with new provider
```

## Full Redeploy (deploy-akash.yml)

Use this when you need to change compute resources (CPU, RAM, storage) or start completely fresh. **This creates a new DSEQ.**

### Steps:

1. **Close the old deployment** from Akash Console to stop spending AKT
2. **Trigger the workflow**: Actions tab → "Deploy to Akash" → Run workflow (check the confirmation box)
3. **Wait ~3 minutes** for deployment to complete
4. **Note the new DSEQ and provider** from the workflow summary
5. **Update `update-manifest.yml`** with the new DSEQ and provider values
6. **Commit and push** the updated workflow file
7. **Update `DEPLOYMENTS.md`** at the repo root with the new info

### Required GitHub Secrets:

| Secret | Description |
|--------|-------------|
| `AKASH_MNEMONIC` | Wallet mnemonic for `akash1degudmhf24auhfnqtn99mkja3xt7clt9um77tn` |
| `GHCR_PAT` | GitHub Container Registry personal access token |
| `INFISICAL_CLIENT_ID` | Infisical machine identity client ID |
| `INFISICAL_CLIENT_SECRET` | Infisical machine identity client secret |
| `INFISICAL_PROJECT_ID` | Infisical project ID for service-auth |
| `INFISICAL_GLOBAL_PROJECT_ID` | Infisical global project ID |

> **Note:** Database credentials, JWT secrets, Resend API key, and OAuth secrets are fetched from Infisical at runtime — they do NOT need to be in GitHub Secrets.

## Environment Variables

The auth service supports **two** secrets modes:

1) **Infisical runtime secrets (recommended)**: services fetch secrets at startup via `INFISICAL_*`.
2) **Direct SDL env injection**: used by `akash-mcp/scripts/redeploy-all.ts` when Infisical is intentionally skipped (e.g. recovery / simplified deployment).

The following are set in the Akash SDL:

### Set in SDL (non-sensitive):
- `NODE_ENV=production`
- `PORT=3000`
- `DOMAIN=alternatefutures.ai`
- `APP_URL=https://auth.alternatefutures.ai`
- `FRONTEND_URL=https://app.alternatefutures.ai`
- `CORS_ORIGIN=https://app.alternatefutures.ai`
- OAuth redirect URIs
- Infisical credentials (from GitHub Secrets)

### Fetched from Infisical at runtime:
- `DATABASE_URL` (PostgreSQL connection string)
- `JWT_SECRET` / `JWT_REFRESH_SECRET`
- `RESEND_API_KEY`
- OAuth client IDs and secrets (Google, GitHub, Twitter, Discord)

## SSL Architecture

```
User → auth.alternatefutures.ai
     → Cloudflare (DNS proxy)
     → (SSL proxy on Akash, Pingap; see repo-root deployment tracker for current IP)
     → Akash provider ingress (service-auth container)
```

The SSL proxy handles TLS termination using a Cloudflare Origin Certificate. Akash providers cannot provision SSL for custom domains (they use DNS-01 challenges for their own wildcard certs only).

## Monitoring

### Health check:
```bash
curl https://auth.alternatefutures.ai/health
```

### View logs (via Akash Console):
```
https://deploy.cloudmos.io/deployment/akash1degudmhf24auhfnqtn99mkja3xt7clt9um77tn/<DSEQ>
```

### View deployment status:
```bash
# Using akash-mcp scripts
cd akash-mcp && npx tsx scripts/get-service-urls.ts
```

## Troubleshooting

### Manifest version validation failed
The SDL sent by `update-manifest.yml` must match the on-chain deployment spec. The workflow handles this by running `akash tx deployment update` before `send-manifest`. If you still get this error, ensure both workflows use the same SDL structure (compute resources, placement, pricing).

### Certificate errors (UnmarshalBinaryLengthPrefixed)
Version mismatch between `akash` and `provider-services`. Both workflows install the latest versions to avoid this.

### 522 Cloudflare timeout
The SSL proxy is down or misconfigured. Check the `infrastructure-proxy` deployment (see repo-root deployment tracker for current DSEQ/IP).

### Container not starting
Check logs in Akash Console. Common causes:
- Missing Infisical credentials (check GitHub Secrets)
- Database not reachable (check Infisical `DATABASE_URL`)
- Image not found (check GHCR for the expected tag)

## Cost

- ~$1.93/month for 1 CPU, 1Gi RAM, 1Gi storage
- Paid in AKT from wallet `akash1degudmhf24auhfnqtn99mkja3xt7clt9um77tn`

---

*Last updated: 2026-02-06*
