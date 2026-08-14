# @devdigest/mcp-server

MCP (Model Context Protocol) server for DevDigest. Exposes DevDigest's PR review
capabilities as tools that Claude Code and other MCP clients can call directly.

The server is a stdio process that translates MCP tool calls into HTTP requests against
the DevDigest API running on `:3001`. It has no database — all state lives in the API.

## Build

```sh
cd mcp-server
npm install
npm run build        # emits to dist/
```

## Development

```sh
npm run dev          # runs src/index.ts directly via tsx (no build step)
```

## Registering with Claude Code

Add to `.claude/settings.json` in your project root (or `~/.claude/settings.json` for
all projects):

```json
{
  "mcpServers": {
    "devdigest": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server/dist/index.js"],
      "env": {
        "DEVDIGEST_API_URL": "http://localhost:3001"
      }
    }
  }
}
```

Replace `/absolute/path/to/mcp-server` with the actual path on your machine.

The DevDigest API must be running (`./scripts/dev.sh`) before using the tools.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DEVDIGEST_API_URL` | `http://localhost:3001` | Base URL of the DevDigest API |

## Available Tools

### `list_agents`

List all configured review agents.

**Parameters:** none

**Returns:** Array of agents with `id`, `name`, `description`, `provider`, `model`, `enabled`.

---

### `run_agent_on_pr`

Run a review agent on a pull request. Blocks until the review completes (up to 5 minutes).

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `pr_id` | string | Pull request ID (numeric string) |
| `agent_id` | string | Agent ID from `list_agents` |

**Returns:** Array of review objects from this run only (filtered by `run_id`), with verdict, score, summary, and findings.

---

### `get_findings`

Get findings from all completed reviews for a pull request. Returns the top 20 findings
sorted by severity (critical first).

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `pr_id` | string | Pull request ID |

**Returns:** Array of up to 20 findings with `severity`, `category`, `title`, `file`,
`start_line`, `end_line`, `rationale`.

---

### `get_conventions`

Get the repository's inferred coding conventions.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `repo_id` | string | Repository ID |

**Returns:** Array of convention candidates with `rule`, `evidence_path`, `confidence`,
`accepted`.

---

### `get_blast_radius`

Get a PR's influence map — changed symbols, their callers, and potentially affected endpoints.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `pr_id` | string | Pull request ID |

**Returns:** Human-readable report listing changed symbols, grouped callers, and impacted endpoints.
May include a degraded-mode note if PR files aren't loaded or the index is incomplete.

## Tests

```sh
npm test
```

Unit tests only — no Docker, no running API required.
