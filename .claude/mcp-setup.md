# MCP Server Setup for Alternate Clouds App

This guide explains how to configure Model Context Protocol (MCP) servers for Linear and GitHub integration with Claude Code.

## Prerequisites

1. Create a `.env` file from `.env.example`:
   ```bash
   cp .env.example .env
   ```

2. Fill in your API keys and credentials in `.env`

## MCP Configuration

MCP servers are configured in Claude Code's settings file, typically located at:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

### Linear MCP Server

Add Linear MCP server to your config:

```json
{
  "mcpServers": {
    "linear": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-linear"
      ],
      "env": {
        "LINEAR_API_KEY": "your_linear_api_key"
      }
    }
  }
}
```

**Getting Linear API Key:**
1. Go to Linear Settings → API
2. Create a new Personal API Key
3. Copy the key to your `.env` file and MCP config

**Linear MCP Capabilities:**
- Create/update/query Linear issues
- Search issues by status, assignee, labels
- Update issue status and assignees
- Link commits and PRs to issues
- Query team members for assignment

### GitHub MCP Server

Add GitHub MCP server to your config:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-github"
      ],
      "env": {
        "GITHUB_TOKEN": "your_github_personal_access_token"
      }
    }
  }
}
```

**Getting GitHub Token:**
1. Go to GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Generate new token with scopes:
   - `repo` (full control of private repositories)
   - `workflow` (update GitHub Action workflows)
   - `read:org` (read org and team membership)
3. Copy the token to your `.env` file and MCP config

**GitHub MCP Capabilities:**
- Create/update pull requests
- Review PR status and checks
- Create/manage branches
- Search issues and PRs
- Get repository information
- Manage GitHub Actions

## Complete MCP Config Example

Here's a complete example with both MCP servers:

```json
{
  "mcpServers": {
    "linear": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-linear"],
      "env": {
        "LINEAR_API_KEY": "lin_api_xxxxxxxxxxxxx"
      }
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "ghp_xxxxxxxxxxxxx"
      }
    }
  }
}
```

## Testing MCP Servers

After configuring MCP servers:

1. **Restart Claude Code** to load the new configuration

2. **Test Linear Integration:**
   ```
   Ask Claude: "What are the open issues in Linear for ALT project?"
   ```

3. **Test GitHub Integration:**
   ```
   Ask Claude: "Show me open pull requests in the altfutures-app repo"
   ```

## Usage in Workflows

### Creating Linear Issues
```
Claude: "Create a Linear issue for adding dark mode to the billing page.
         Assign it to @wonderwomancode and label it as 'enhancement' and 'ui'"
```

### Creating GitHub PR
```
Claude: "Create a PR for the feat/alt-25-billing branch with title
         'feat: Add billing dashboard (ALT-25)'"
```

## Troubleshooting

### MCP Server Not Loading
- Check Claude Code console for errors
- Verify API keys are correct
- Ensure `npx` is available in PATH
- Try restarting Claude Code

### Permission Errors
- Verify API token scopes/permissions
- Check organization access for GitHub

### Connection Issues
- Check internet connectivity
- Verify service status (Linear, GitHub)
- Try recreating API tokens

## Security Notes

1. **Never commit `.env` file** - It's in `.gitignore`
2. **Rotate tokens regularly** - Especially after team member changes
3. **Use minimal scopes** - Only grant permissions needed
4. **Store tokens securely** - Use password manager or secret vault
5. **Revoke unused tokens** - Clean up old/test tokens

## Additional Resources

- [MCP Documentation](https://modelcontextprotocol.io/)
- [Linear API Docs](https://developers.linear.app/)
- [GitHub API Docs](https://docs.github.com/en/rest)
