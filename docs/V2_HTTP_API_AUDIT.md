# Navi HTTP API audit checklist

**Source:** `packages/sdk/openapi.json` (generated from `packages/protocol/src/api.ts`;
copies at `packages/sdk/js/openapi.json`, `packages/docs/openapi.json`)
**Current surface:** 110 paths / 128 operations
**Last regenerated:** 2026-10-14
**Upstream reference:** `V2_HTTP_API_AUDIT.md` at repo root of `V:\pankaj\opencode`
(139 endpoints, all reviewed). Navi's surface has diverged from upstream: most
routes are v1-style root paths, plus a small `/api/session` v2 subset.

## How to use this checklist

Review endpoints in document order. For each endpoint, select one disposition and capture rationale or follow-up work in Notes. Mark **Reviewed** only after the disposition is agreed.

### Review criteria

- Resource and operation naming
- HTTP method and idempotency
- Request parameters and location scope
- Response shape and error taxonomy
- Authentication and authorization
- Current production consumers
- Stability level: public, experimental, or internal
- Whether the generated client API is intuitive

### Disposition legend

- **Keep:** ship unchanged as a supported API
- **Change:** retain after a defined contract change
- **Remove:** exclude from the official API
- **Experimental-only:** retain outside the stable API commitment

## Progress

- [ ] Group 1: Global foundation and instance (7)
- [ ] Group 2: Config, providers, agents, skills, commands (10)
- [ ] Group 3: Auth and MCP (10)
- [ ] Group 4: Session lifecycle incl. v2 subset (33)
- [ ] Group 5: Permissions and questions (5)
- [ ] Group 6: Filesystem, find, VCS (12)
- [ ] Group 7: PTY, LSP, formatter (10)
- [ ] Group 8: Project, worktree, workspace (15)
- [ ] Group 9: TUI remote control (13)
- [ ] Group 10: Sync (4)
- [ ] Group 11: Experimental and misc (9)

## Group 1: Global foundation and instance

**Endpoints:** 7

| Done | Method | Path | Operation ID | Decision | Notes |
|---|---|---|---|---|---|
| [ ] | `GET` | `/global/health` | `global.health` | | |
| [ ] | `GET` | `/global/event` | `global.event` | | |
| [ ] | `GET` | `/global/config` | `global.config.get` | | |
| [ ] | `PATCH` | `/global/config` | `global.config.update` | | |
| [ ] | `POST` | `/global/dispose` | `global.dispose` | | |
| [ ] | `POST` | `/global/upgrade` | `global.upgrade` | | |
| [ ] | `POST` | `/instance/dispose` | `instance.dispose` | | |

## Group 2: Config, providers, agents, skills, commands

**Endpoints:** 10

| Done | Method | Path | Operation ID | Decision | Notes |
|---|---|---|---|---|---|
| [ ] | `GET` | `/config` | `config.get` | | |
| [ ] | `PATCH` | `/config` | `config.update` | | |
| [ ] | `GET` | `/config/providers` | `config.providers` | | |
| [ ] | `GET` | `/provider` | `provider.list` | | |
| [ ] | `GET` | `/provider/auth` | `provider.auth` | | |
| [ ] | `POST` | `/provider/{providerID}/oauth/authorize` | `provider.oauth.authorize` | | |
| [ ] | `POST` | `/provider/{providerID}/oauth/callback` | `provider.oauth.callback` | | |
| [ ] | `GET` | `/agent` | `app.agents` | | |
| [ ] | `GET` | `/skill` | `app.skills` | | |
| [ ] | `GET` | `/command` | `command.list` | | |

## Group 3: Auth and MCP

**Endpoints:** 10

| Done | Method | Path | Operation ID | Decision | Notes |
|---|---|---|---|---|---|
| [ ] | `PUT` | `/auth/{providerID}` | `auth.set` | | |
| [ ] | `DELETE` | `/auth/{providerID}` | `auth.remove` | | |
| [ ] | `GET` | `/mcp` | `mcp.status` | | |
| [ ] | `POST` | `/mcp` | `mcp.add` | | |
| [ ] | `POST` | `/mcp/{name}/connect` | `mcp.connect` | | |
| [ ] | `POST` | `/mcp/{name}/disconnect` | `mcp.disconnect` | | |
| [ ] | `POST` | `/mcp/{name}/auth` | `mcp.auth.start` | | |
| [ ] | `POST` | `/mcp/{name}/auth/authenticate` | `mcp.auth.authenticate` | | |
| [ ] | `POST` | `/mcp/{name}/auth/callback` | `mcp.auth.callback` | | |
| [ ] | `DELETE` | `/mcp/{name}/auth` | `mcp.auth.remove` | | |

## Group 4: Session lifecycle incl. v2 subset

**Endpoints:** 33

| Done | Method | Path | Operation ID | Decision | Notes |
|---|---|---|---|---|---|
| [ ] | `GET` | `/session` | `session.list` | | |
| [ ] | `POST` | `/session` | `session.create` | | |
| [ ] | `GET` | `/session/status` | `session.status` | | |
| [ ] | `GET` | `/session/{sessionID}` | `session.get` | | |
| [ ] | `PATCH` | `/session/{sessionID}` | `session.update` | | |
| [ ] | `DELETE` | `/session/{sessionID}` | `session.delete` | | |
| [ ] | `POST` | `/session/{sessionID}/abort` | `session.abort` | | |
| [ ] | `GET` | `/session/{sessionID}/children` | `session.children` | | |
| [ ] | `POST` | `/session/{sessionID}/command` | `session.command` | | |
| [ ] | `GET` | `/session/{sessionID}/diff` | `session.diff` | | |
| [ ] | `POST` | `/session/{sessionID}/fork` | `session.fork` | | |
| [ ] | `POST` | `/session/{sessionID}/init` | `session.init` | | |
| [ ] | `GET` | `/session/{sessionID}/message` | `session.messages` | | |
| [ ] | `POST` | `/session/{sessionID}/message` | `session.prompt` | | |
| [ ] | `GET` | `/session/{sessionID}/message/{messageID}` | `session.message` | | |
| [ ] | `DELETE` | `/session/{sessionID}/message/{messageID}` | `session.deleteMessage` | | |
| [ ] | `PATCH` | `/session/{sessionID}/message/{messageID}/part/{partID}` | `part.update` | | |
| [ ] | `DELETE` | `/session/{sessionID}/message/{messageID}/part/{partID}` | `part.delete` | | |
| [ ] | `POST` | `/session/{sessionID}/permissions/{permissionID}` | `permission.respond` | | |
| [ ] | `POST` | `/session/{sessionID}/prompt_async` | `session.prompt_async` | | |
| [ ] | `POST` | `/session/{sessionID}/revert` | `session.revert` | | |
| [ ] | `POST` | `/session/{sessionID}/unrevert` | `session.unrevert` | | |
| [ ] | `POST` | `/session/{sessionID}/share` | `session.share` | | |
| [ ] | `DELETE` | `/session/{sessionID}/share` | `session.unshare` | | |
| [ ] | `POST` | `/session/{sessionID}/shell` | `session.shell` | | |
| [ ] | `POST` | `/session/{sessionID}/summarize` | `session.summarize` | | |
| [ ] | `GET` | `/session/{sessionID}/todo` | `session.todo` | | |
| [ ] | `GET` | `/api/session` | `v2.session.list` | | |
| [ ] | `POST` | `/api/session/{sessionID}/prompt` | `v2.session.prompt` | | |
| [ ] | `POST` | `/api/session/{sessionID}/wait` | `v2.session.wait` | | |
| [ ] | `POST` | `/api/session/{sessionID}/compact` | `v2.session.compact` | | |
| [ ] | `GET` | `/api/session/{sessionID}/context` | `v2.session.context` | | |
| [ ] | `GET` | `/api/session/{sessionID}/message` | `v2.session.messages` | | |

## Group 5: Permissions and questions

**Endpoints:** 5

| Done | Method | Path | Operation ID | Decision | Notes |
|---|---|---|---|---|---|
| [ ] | `GET` | `/permission` | `permission.list` | | |
| [ ] | `POST` | `/permission/{requestID}/reply` | `permission.reply` | | |
| [ ] | `GET` | `/question` | `question.list` | | |
| [ ] | `POST` | `/question/{requestID}/reply` | `question.reply` | | |
| [ ] | `POST` | `/question/{requestID}/reject` | `question.reject` | | |

## Group 6: Filesystem, find, VCS

**Endpoints:** 12

| Done | Method | Path | Operation ID | Decision | Notes |
|---|---|---|---|---|---|
| [ ] | `GET` | `/file` | `file.list` | | |
| [ ] | `GET` | `/file/content` | `file.read` | | |
| [ ] | `GET` | `/file/status` | `file.status` | | |
| [ ] | `GET` | `/find` | `find.text` | | |
| [ ] | `GET` | `/find/file` | `find.files` | | |
| [ ] | `GET` | `/find/symbol` | `find.symbols` | | |
| [ ] | `GET` | `/path` | `path.get` | | |
| [ ] | `GET` | `/vcs` | `vcs.get` | | |
| [ ] | `GET` | `/vcs/status` | `vcs.status` | | |
| [ ] | `GET` | `/vcs/diff` | `vcs.diff` | | |
| [ ] | `GET` | `/vcs/diff/raw` | `vcs.diff.raw` | | |
| [ ] | `POST` | `/vcs/apply` | `vcs.apply` | | |

## Group 7: PTY, LSP, formatter

**Endpoints:** 10

| Done | Method | Path | Operation ID | Decision | Notes |
|---|---|---|---|---|---|
| [ ] | `GET` | `/pty` | `pty.list` | | |
| [ ] | `POST` | `/pty` | `pty.create` | | |
| [ ] | `GET` | `/pty/shells` | `pty.shells` | | |
| [ ] | `GET` | `/pty/{ptyID}` | `pty.get` | | |
| [ ] | `PUT` | `/pty/{ptyID}` | `pty.update` | | |
| [ ] | `DELETE` | `/pty/{ptyID}` | `pty.remove` | | |
| [ ] | `GET` | `/pty/{ptyID}/connect` | `pty.connect` | | |
| [ ] | `POST` | `/pty/{ptyID}/connect-token` | `pty.connectToken` | | |
| [ ] | `GET` | `/lsp` | `lsp.status` | | |
| [ ] | `GET` | `/formatter` | `formatter.status` | | |

## Group 8: Project, worktree, workspace

**Endpoints:** 15

| Done | Method | Path | Operation ID | Decision | Notes |
|---|---|---|---|---|---|
| [ ] | `GET` | `/project` | `project.list` | | |
| [ ] | `GET` | `/project/current` | `project.current` | | |
| [ ] | `PATCH` | `/project/{projectID}` | `project.update` | | |
| [ ] | `POST` | `/project/git/init` | `project.initGit` | | |
| [ ] | `GET` | `/experimental/worktree` | `worktree.list` | | |
| [ ] | `POST` | `/experimental/worktree` | `worktree.create` | | |
| [ ] | `DELETE` | `/experimental/worktree` | `worktree.remove` | | |
| [ ] | `POST` | `/experimental/worktree/reset` | `worktree.reset` | | |
| [ ] | `GET` | `/experimental/workspace` | `experimental.workspace.list` | | |
| [ ] | `POST` | `/experimental/workspace` | `experimental.workspace.create` | | |
| [ ] | `DELETE` | `/experimental/workspace/{id}` | `experimental.workspace.remove` | | |
| [ ] | `GET` | `/experimental/workspace/adapter` | `experimental.workspace.adapter.list` | | |
| [ ] | `GET` | `/experimental/workspace/status` | `experimental.workspace.status` | | |
| [ ] | `POST` | `/experimental/workspace/sync-list` | `experimental.workspace.syncList` | | |
| [ ] | `POST` | `/experimental/workspace/warp` | `experimental.workspace.warp` | | |

## Group 9: TUI remote control

**Endpoints:** 13

| Done | Method | Path | Operation ID | Decision | Notes |
|---|---|---|---|---|---|
| [ ] | `POST` | `/tui/submit-prompt` | `tui.submitPrompt` | | |
| [ ] | `POST` | `/tui/append-prompt` | `tui.appendPrompt` | | |
| [ ] | `POST` | `/tui/clear-prompt` | `tui.clearPrompt` | | |
| [ ] | `GET` | `/tui/control/next` | `tui.control.next` | | |
| [ ] | `POST` | `/tui/control/response` | `tui.control.response` | | |
| [ ] | `POST` | `/tui/execute-command` | `tui.executeCommand` | | |
| [ ] | `POST` | `/tui/open-help` | `tui.openHelp` | | |
| [ ] | `POST` | `/tui/open-models` | `tui.openModels` | | |
| [ ] | `POST` | `/tui/open-sessions` | `tui.openSessions` | | |
| [ ] | `POST` | `/tui/open-themes` | `tui.openThemes` | | |
| [ ] | `POST` | `/tui/publish` | `tui.publish` | | |
| [ ] | `POST` | `/tui/select-session` | `tui.selectSession` | | |
| [ ] | `POST` | `/tui/show-toast` | `tui.showToast` | | |

## Group 10: Sync

**Endpoints:** 4

| Done | Method | Path | Operation ID | Decision | Notes |
|---|---|---|---|---|---|
| [ ] | `POST` | `/sync/start` | `sync.start` | | |
| [ ] | `POST` | `/sync/history` | `sync.history.list` | | |
| [ ] | `POST` | `/sync/replay` | `sync.replay` | | |
| [ ] | `POST` | `/sync/steal` | `sync.steal` | | |

## Group 11: Experimental and misc

**Endpoints:** 9

| Done | Method | Path | Operation ID | Decision | Notes |
|---|---|---|---|---|---|
| [ ] | `GET` | `/event` | `event.subscribe` | | |
| [ ] | `POST` | `/log` | `app.log` | | |
| [ ] | `GET` | `/experimental/session` | `experimental.session.list` | | |
| [ ] | `GET` | `/experimental/tool` | `tool.list` | | |
| [ ] | `GET` | `/experimental/tool/ids` | `tool.ids` | | |
| [ ] | `GET` | `/experimental/resource` | `experimental.resource.list` | | |
| [ ] | `GET` | `/experimental/console` | `experimental.console.get` | | |
| [ ] | `GET` | `/experimental/console/orgs` | `experimental.console.listOrgs` | | |
| [ ] | `POST` | `/experimental/console/switch` | `experimental.console.switchOrg` | | |
