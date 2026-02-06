# Quick Deploy Guide — service-auth on Akash

## Code Update (Most Common)

Push to `main` and it deploys automatically:

```bash
git push origin main
# docker-build.yml builds image → update-manifest.yml sends to Akash
```

Or trigger manually: **Actions** → **Update Auth Manifest (No Redeploy)** → **Run workflow**

## Full Redeploy (New DSEQ)

Only needed when changing compute resources (CPU/RAM/storage) or starting fresh.

### 1. Close the old deployment
From [Akash Console](https://deploy.cloudmos.io/addresses/akash1degudmhf24auhfnqtn99mkja3xt7clt9um77tn), close the old DSEQ.

### 2. Run the deploy workflow
**Actions** → **Deploy to Akash** → Check "I understand this creates a new DSEQ" → **Run workflow**

### 3. Update the manifest workflow
From the deploy summary, get the new DSEQ and provider. Update `.github/workflows/update-manifest.yml`:

```yaml
env:
  AUTH_DSEQ: "<new-dseq>"
  AUTH_PROVIDER: "<new-provider>"
```

### 4. Commit and push
```bash
git add .github/workflows/update-manifest.yml
git commit -m "update: set AUTH_DSEQ to <new-dseq>"
git push origin main
```

### 5. Update docs
Update `DEPLOYMENTS.md` (root) and `.github/DEPLOYMENTS.md` with the new DSEQ.

## Required GitHub Secrets

| Secret | Where to get it |
|--------|-----------------|
| `AKASH_MNEMONIC` | Wallet recovery phrase |
| `GHCR_PAT` | GitHub → Settings → Developer settings → Personal access tokens |
| `INFISICAL_CLIENT_ID` | Infisical → Machine Identities |
| `INFISICAL_CLIENT_SECRET` | Infisical → Machine Identities |
| `INFISICAL_PROJECT_ID` | Infisical → Project Settings |
| `INFISICAL_GLOBAL_PROJECT_ID` | Infisical → Global Project Settings |

## Current Deployment

| Field | Value |
|-------|-------|
| **DSEQ** | 25412621 |
| **Provider** | akash1xmjzu9dczlg9fa4v3pfvwzn7ty89r003laj4ac |
| **URL** | https://auth.alternatefutures.ai |
| **Console** | [View on Cloudmos](https://deploy.cloudmos.io/deployment/akash1degudmhf24auhfnqtn99mkja3xt7clt9um77tn/25412621) |

## Verify Deployment

```bash
curl https://auth.alternatefutures.ai/health
```

---

*Last updated: 2026-02-06*
