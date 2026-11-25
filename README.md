# AgentDock

Run several isolated [OpenCode](https://opencode.ai) coding agents in Docker, point them at your real project folders, and control everything from one web dashboard. When one account hits its usage limit, AgentDock can continue the task in another container with its own login.

> **Use only accounts and API keys you legitimately hold, and only where the provider's terms allow this kind of switching.** Docker does not give you extra provider entitlements.

---

## Features

- **Real project access:** containers bind-mount your host folder, so edits appear directly in your project (no copying).
- **Isolated instances:** each container has its own config volume (login, settings, sessions).
- **Dashboard:** instances, workspaces, command console, task manager, live logs, resource stats and an in-browser terminal.
- **Task execution:** submit an instruction, stream output live, cancel it, and keep a recoverable history.
- **Quota-aware recovery:** on a usage-limit error AgentDock saves a checkpoint, then continues on another instance or on a newly created container logged in with the next credential profile.
- **Hardened containers:** non-root user, all Linux capabilities dropped, `no-new-privileges`, CPU / memory / PID limits.

## How it works

```
Browser (React dashboard, :5173)
   |  REST + WebSocket (Bearer token)
   v
AgentDock backend (Fastify + TypeScript, 127.0.0.1:8080)  -- SQLite (instances, workspaces, tasks, checkpoints, events)
   |  Docker Engine API
   v
OpenCode containers (one per instance)
   |- /workspace  -> bind mount of your project (shared, read/write)
   '- /config     -> per-instance volume or credential profile (isolated)
```

The backend is the only component that talks to Docker. Only one task runs per workspace at a time, and an instance switch only happens after the previous process has exited, so two agents never write to the same project at once.

## Requirements

| Tool | Version |
|------|---------|
| Docker Desktop (WSL 2 backend on Windows) | running |
| Node.js | **22.13 or newer** (the backend uses Node's built-in SQLite, so no C++ build tools are needed) |
| npm | comes with Node |

## Quick start

Run from the project root (the folder containing `backend`, `frontend`, `docker`).

### 1. Setup

```bash
cp -n docker/.env.example docker/.env
cp -n backend/.env.example backend/.env
docker build -t agentdock:latest docker/opencode
(cd backend && npm install)
(cd frontend && npm install)
```

PowerShell users can run `.\scripts\setup.ps1` instead. Start Docker Desktop first and wait for "Engine running" (`docker ps` should work).

### 2. Configure `backend/.env`

```
API_TOKEN=choose-any-random-string-of-16-or-more-characters
ALLOWED_WORKSPACE_ROOTS=E:/Projects
OPENCODE_IMAGE=agentdock:latest
AUTO_SWITCH=true
```

- Keep values unquoted, on one line, with no spaces around `=`.
- Use forward slashes in paths when you load the file from bash (`E:/Projects`).
- `ALLOWED_WORKSPACE_ROOTS` is the parent folder of the projects you want agents to edit. Separate several roots with `;`.

### 3. Start

**Bash** (two terminals):

```bash
# terminal 1: backend
cd backend && set -a && source .env && set +a && npm run dev

# terminal 2: dashboard
cd frontend && npm run dev
```

**PowerShell** (one command; it loads `backend/.env` for you):

```powershell
.\scripts\dev.ps1
```

From bash you can run it with `powershell.exe -ExecutionPolicy Bypass -File ./scripts/dev.ps1`.

The backend is ready when it logs `Server listening at http://127.0.0.1:8080`.

### 4. Use the dashboard

Open <http://localhost:5173> and sign in with your `API_TOKEN`.

1. **Workspaces:** add a project (name + full path, e.g. `E:\Projects\my-app`).
2. **Instances:** enter a name such as `acct-a`, choose the workspace, click **Create**.
3. Open the instance's **Terminal** and run `opencode auth login` to sign that instance in.
4. **Console:** choose the workspace, type an instruction, click **Run**. Output streams live and files change in your real project.

## Automatic switching when a quota runs out

With `AUTO_SWITCH=true`, when a task fails with a usage-limit error AgentDock:

1. waits for the process to exit (the workspace is now idle),
2. saves a **checkpoint** (git ref via `git stash create`, `git status`, diff stat, last output),
3. puts the exhausted instance on cooldown (`QUOTA_COOLDOWN_MIN`),
4. uses another healthy instance for the same workspace, or **creates a new container** from the next free credential profile,
5. runs the task there with your original instruction, the checkpoint and the last output as context.

OpenCode sessions do not transfer between accounts, so the new instance gets the context as a prompt rather than a restored conversation. With `AUTO_SWITCH=false` the task is marked `blocked` and you press **Resume** on the Tasks tab.

### Credential profiles (logins for new containers)

A new container needs its own login. Create one folder per account in `data/profiles/` (name: lowercase letters, digits and dashes, max 25 characters):

```
data/profiles/acct-b/profile.env                  # ANTHROPIC_API_KEY=sk-...   (any provider key variable, one KEY=VALUE per line)
data/profiles/acct-c/data/opencode/auth.json      # or: the auth.json from an account you ran `opencode auth login` on
```

Each profile folder is mounted as that container's `/config` and is used by at most one container. Restart the backend after adding profiles. When no profile is free, or `MAX_INSTANCES` is reached, the task becomes `blocked`. Quota detection looks for phrases such as "rate limit", "quota", "usage limit", "too many requests" and "429" in OpenCode's output; if your provider words it differently, add the phrase to `QUOTA` in `backend/src/tasks.ts`.

## Configuration reference (`backend/.env`)

| Variable | Default | Purpose |
|----------|---------|---------|
| `API_TOKEN` | required (16+ chars) | Password for the AgentDock API and dashboard |
| `PORT` | `8080` | Backend port (binds to 127.0.0.1 only) |
| `ALLOWED_WORKSPACE_ROOTS` | required | Folders that may be registered as workspaces, `;`-separated |
| `OPENCODE_IMAGE` | `agentdock:latest` | Docker image for instances |
| `INSTANCE_MEMORY_MB` | `2048` | Memory limit per container |
| `INSTANCE_CPUS` | `2` | CPU limit per container |
| `QUOTA_COOLDOWN_MIN` | `60` | How long an exhausted instance is skipped |
| `AUTO_SWITCH` | `false` | Continue on another/new instance after a quota error |
| `PROFILES_DIR` | `../data/profiles` | Credential profile folders |
| `MAX_INSTANCES` | `6` | Cap on total instances (including auto-spawned) |
| `DB_PATH` | `../data/runtime.db` | SQLite file |

## Docker only (no dashboard)

```bash
cd docker
cp .env.example .env        # set WORKSPACE_PATH to your project
docker compose up -d --build
docker compose exec opencode-a opencode auth login
docker compose exec opencode-a opencode run "create hello.txt"
```

This starts two isolated containers (`oc-a`, `oc-b`) sharing one project.

## API overview

All routes except `/health` need `Authorization: Bearer <API_TOKEN>` (WebSockets use `?token=`).

| Route | Purpose |
|-------|---------|
| `GET /api/runtime` | Docker version, instance and task counts |
| `GET/POST /api/workspaces`, `DELETE /api/workspaces/:id` | Register and remove workspaces |
| `GET/POST /api/instances`, `POST /api/instances/:id/{start,stop,restart}`, `DELETE /api/instances/:id` | Manage containers |
| `GET /api/instances/:id/stats`, `GET /api/instances/:id/logs` | Resource use and container logs |
| `GET/POST /api/tasks`, `GET /api/tasks/:id`, `POST /api/tasks/:id/{cancel,resume}` | Run, inspect, cancel and resume tasks |
| `GET /api/profiles` | Profile names and usage (never secrets) |
| `GET /api/events` | Activity log |
| `WS /ws/events`, `WS /ws/terminal/:instanceId` | Live events and interactive terminal |

## Project layout

```
agentdock/
|- docker/        image (Dockerfile, entrypoint) and docker-compose.yml
|- backend/src/   server, config, db, docker, workspaces, instances, profiles, tasks
|- frontend/src/  React + Tailwind dashboard (App, Terminal, ui, api)
|- scripts/       setup.ps1, dev.ps1
'- data/          SQLite database and credential profiles (git-ignored)
```

## Security notes

- The API listens on `127.0.0.1` only, requires the token on every route and checks it in constant time.
- Workspaces must sit under `ALLOWED_WORKSPACE_ROOTS`; symlinks are resolved and re-checked.
- Containers run as a non-root user with no extra capabilities, no privilege escalation, and CPU / memory / PID limits.
- Provider keys in `profile.env` are passed as container environment variables and are visible to anyone who can run `docker inspect`. Keep `data/` private.
- The dashboard's live-update WebSocket sends the token in the URL, so it can appear in local backend logs. Don't share those logs.
- The Docker socket gives full control of your Docker host. Don't expose the backend beyond localhost.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `failed to connect to the docker API ... dockerDesktopLinuxEngine` | Docker Desktop isn't running. Start it and wait for "Engine running". |
| `No such image: agentdock:latest` | Build it: `docker build -t agentdock:latest docker/opencode`. |
| Build fails with `Release file ... is not valid yet` | Docker VM clock is behind. Retry, or run `wsl --shutdown`, restart Docker Desktop, rebuild. |
| Dashboard requests return 401 | Token mismatch. Make sure `API_TOKEN` in `backend/.env` is 16+ chars, restart the backend, click **Sign out** in the dashboard and sign in again. |
| `Unknown workspace` | Register the project on the **Workspaces** tab and select it in the dropdown before creating an instance. |
| `Path is outside ALLOWED_WORKSPACE_ROOTS` | Put the project under the configured root or widen the root in `backend/.env`, then restart. |
| `npm install` fails on `better-sqlite3` | Old version of the project. Current versions use built-in `node:sqlite`; use the latest download and Node 22.13+. |
| `ExperimentalWarning: SQLite` | Harmless. |
| Task becomes `blocked` after a quota error | No other healthy instance or free profile. Add a profile, restart the backend, press **Resume**. |
| Files can't be written on Linux | The container user may lack permission on the project folder; adjust ownership or permissions. |

## Limitations

- Account logins can't be created automatically (OpenCode's browser login needs a person); provide keys or an `auth.json` per profile.
- Task recovery replays instructions and a checkpoint; it does not restore the original OpenCode conversation.
- Active tasks are marked `interrupted` if the backend restarts; use **Resume** to continue them.
- On Windows, large repositories are faster when the project lives inside WSL 2 rather than on `C:\` or `E:\`.