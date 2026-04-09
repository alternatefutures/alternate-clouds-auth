# Alternate Clouds App - Claude Code Initialization

This file contains **mandatory** workflow rules and checklists for working on the Alternate Clouds App. These are not suggestions - they are requirements that MUST be followed.

---

## 🚀 SESSION START CHECKLIST

Execute these tasks at the beginning of EVERY session:

### ✅ 1. Load Environment Variables
```bash
# Verify .env file exists and is loaded
cat .env | grep -E "(LINEAR_API_KEY|GITHUB_TOKEN)"
```

**Required environment variables:**
- `LINEAR_API_KEY` - For Linear MCP integration
- `GITHUB_TOKEN` - For GitHub MCP integration
- Database credentials
- Service endpoints
- Feature flags

**Action if missing:** Copy from `.env.example` and fill in credentials

---

### ✅ 2. Pull Tasks from Linear (via Linear MCP)
```
Use Linear MCP to query current tasks:
- Get all tasks in "In Progress" state
- Get all tasks assigned to current user
- Get next highest priority task in "Todo" state
```

**Required actions:**
- Identify which task(s) are currently being worked on
- Check for any blocked tasks that need attention
- Note the next priority task for after current work completes

---

### ✅ 3. Check Git Status
```bash
git status
git branch --show-current
git log --oneline -5
```

**Verify:**
- Current branch name follows convention: `feat/alt-{number}-description`
- No uncommitted changes from previous session (should have been committed on exit)
- Branch is synced with remote

**If on `main` branch:**
- Create or switch to a feature branch immediately
- Never work directly on `main`

---

### ✅ 4. Identify Current Linear Issue
From the current branch name (e.g., `feat/alt-25-billing`), identify the related Linear issue:
- Extract issue number (e.g., `ALT-25`)
- Use Linear MCP to fetch issue details
- Verify issue status matches current work state

---

### ✅ 5. Review Recent Activity
```bash
# Check recent commits
git log --oneline -10

# Check recent PRs (via GitHub MCP)
gh pr list --limit 5
```

**Understand:**
- What was completed in last session
- What's currently in review
- Any feedback or comments on PRs

---

## 💻 DURING SESSION - MANDATORY RULES

### 🔴 RULE #1: No Commits Without a Linear Issue

**Before ANY commit:**
1. ✅ Verify a Linear issue exists for the work
2. ✅ If no issue exists → CREATE ONE FIRST using Linear MCP
3. ✅ Assign the issue to the appropriate person (REQUIRED)
4. ✅ Set proper labels and priority

**Never skip this step. Ever.**

---

### 🔴 RULE #2: Branch Naming Convention

**Required format:**
```
{type}/alt-{issue-number}-{short-description}
```

**Types:**
- `feat/` - New feature (e.g., `feat/alt-25-billing-dashboard`)
- `fix/` - Bug fix (e.g., `fix/alt-30-auth-error`)
- `enhance/` - Enhancement (e.g., `enhance/alt-42-ui-polish`)
- `refactor/` - Code refactoring (e.g., `refactor/alt-15-cleanup-stores`)
- `docs/` - Documentation (e.g., `docs/alt-18-api-docs`)
- `test/` - Tests (e.g., `test/alt-22-agent-tests`)

**Examples:**
- ✅ `feat/alt-25-encoded-message`
- ✅ `fix/alt-30-auth-error`
- ❌ `feature-billing` (no issue number)
- ❌ `alt-25` (no type prefix)

---

### 🔴 RULE #3: Commit Message Format

**Required format:**
```
{Short description of change}

{Optional detailed explanation}

{Linear reference - REQUIRED}

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

**Linear reference options:**
- `Refs ALT-{number}` - General reference
- `Relates to ALT-{number}` - Related work
- `Closes ALT-{number}` - Completes the issue (use in final commit)
- `Fixes ALT-{number}` - Fixes a bug issue

**Example:**
```
Add user authentication with JWT

Implemented JWT-based authentication:
- Login endpoint with email/password
- Token generation and validation
- Refresh token flow
- Session management

Refs ALT-25

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

---

### 🔴 RULE #4: Pull Request Format

**PR Title Format (REQUIRED):**
```
{type}: {Short description} (ALT-{number})
```

**Examples:**
- `feat: Add billing dashboard (ALT-12)`
- `fix: Resolve authentication error (ALT-30)`
- `enhance: Improve UI responsiveness (ALT-42)`

**PR Description Format (REQUIRED):**
```markdown
Closes ALT-{number}

## Summary
- Bullet point 1
- Bullet point 2
- Bullet point 3

## Changes Made
- Detailed change 1
- Detailed change 2

## Test Plan
- How to test change 1
- How to test change 2

## Screenshots (if UI changes)
[Add screenshots here]

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

**Linear reference options in PR:**
- `Closes ALT-{number}` - Completes and closes the issue
- `Fixes ALT-{number}` - Fixes a bug issue
- `Resolves ALT-{number}` - Resolves the issue

---

### 🔴 RULE #5: Linear Task Assignment

**When creating Linear issues via MCP:**
- ✅ **ALWAYS** assign to a person (REQUIRED)
- ✅ Set appropriate labels (bug, feature, enhancement, etc.)
- ✅ Set priority (urgent, high, medium, low)
- ✅ Add to proper project/team
- ✅ Link to related issues if applicable

**Never create unassigned issues.**

---

### 🔴 RULE #6: Never Ask "Want to do something else?"

**After completing a task, ALWAYS:**
1. ✅ Use Linear MCP to query next highest priority task
2. ✅ Present the task details to user
3. ✅ Ask if ready to start on THAT SPECIFIC task

**Example response:**
```
✅ Completed ALT-25: Add billing dashboard

I've pushed the changes and updated Linear.

Next task from Linear:
📋 ALT-26: Implement real deployment backend (Priority: High)
Status: Todo
Assigned to: @wonderwomancode
Description: Build backend services for IPFS, Filecoin, and Arweave deployments

Ready to start on ALT-26?
```

**NEVER say:**
❌ "What would you like to work on next?"
❌ "Do you want to do something else?"
❌ "Anything else I can help with?"

---

## 🏁 SESSION EXIT CHECKLIST

Execute these tasks at the end of EVERY session:

### ✅ 1. Commit ALL Work in Progress to GitHub

**NEVER leave uncommitted work. EVER.**

```bash
# Check for uncommitted changes
git status

# If changes exist:
git add .
git commit -m "WIP: [description]

Work in progress on [feature/fix].

Refs ALT-{number}

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"

# Push to remote
git push origin {branch-name}
```

**Verification:**
- ✅ `git status` shows no uncommitted changes
- ✅ `git push` has completed successfully
- ✅ Branch exists on remote (visible in GitHub)

---

### ✅ 2. Update ALL Linear Tasks

**For each task worked on during session:**

Use Linear MCP to update:
- ✅ Status (In Progress, Done, Blocked, etc.)
- ✅ Add comment with progress summary
- ✅ Link related commits (via commit URL)
- ✅ Link related PRs (if created)
- ✅ Update estimate/time spent (if tracked)

**Example Linear comment:**
```
Progress update:
- Implemented billing dashboard UI
- Connected to mock data stores
- Added usage charts and transaction history
- Next: Connect to real backend API

Commits:
- https://github.com/alternatefutures/altfutures-app/commit/abc123

Status: In Progress → 80% complete
```

---

### ✅ 3. Create PR if Feature Complete

**If the feature/fix is complete:**

Use GitHub MCP to create PR:
- ✅ Title follows format: `{type}: {description} (ALT-{number})`
- ✅ Description includes Linear reference (Closes/Fixes/Resolves)
- ✅ Description includes summary, changes, and test plan
- ✅ Assign reviewers (if applicable)
- ✅ Add labels
- ✅ Link PR to Linear issue

---

### ✅ 4. Session Summary

Provide a session summary:
```
## Session Summary

### Completed:
- ✅ Task 1 (ALT-X)
- ✅ Task 2 (ALT-Y)

### In Progress:
- 🔄 Task 3 (ALT-Z) - 60% complete

### Next Session:
- 📋 Task 4 (ALT-A) - Next priority

### Git Status:
- ✅ All changes committed and pushed
- ✅ Branch: feat/alt-z-description
- ✅ PR created: #123

### Linear Status:
- ✅ All tasks updated
- ✅ Comments added
- ✅ PRs linked
```

---

## 🔌 MCP Integrations

This project uses the following MCP servers (see `.claude/mcp-setup.md` for configuration):

### Linear MCP
- Create/update/query Linear issues
- Sync task status
- Link commits and PRs to issues
- Assign tasks to team members
- Query next priority tasks

### GitHub MCP
- Create/update PRs
- Review PR status
- Manage branches
- Check CI/CD status
- Link PRs to Linear issues

**Setup:** See `.claude/mcp-setup.md` for detailed MCP server configuration instructions.

---

## Code Standards

### TypeScript
- Use strict type checking
- Prefer interfaces over types for objects
- Document complex types

### Svelte
- Follow Svelte 5 runes syntax
- Use stores for global state
- Keep components focused and reusable

### Testing
- Write unit tests for business logic
- Add E2E tests for critical flows
- Maintain >80% coverage

### Documentation
- Update README for major features
- Document API endpoints
- Keep Linear issues updated with implementation notes

## Project Structure

```
.
├── .claude/              # Claude Code configuration
├── .env                  # Environment variables (gitignored)
├── src/
│   ├── lib/
│   │   ├── components/   # Reusable Svelte components
│   │   ├── stores/       # Svelte stores for state
│   │   └── utils/        # Helper functions
│   └── routes/           # SvelteKit routes
├── LINEAR_ISSUES.md      # Linear issues documentation
└── README.md             # Project documentation
```

## Deployment

### Development
```bash
pnpm dev --host
```

### Production Build
```bash
pnpm build
```

### Arweave Deployment
See `DEPLOY_ARWEAVE.md` for deployment to Arweave using Turbo CLI.

## References

- **Task**: ALT-32 - Build Custom Authentication System
- **Repo**: github.com/alternatefutures/alternatefutures-auth
- **Stack**: Hono, TypeScript, Alternate Clouds Functions
