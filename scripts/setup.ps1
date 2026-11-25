# Run from repo root in PowerShell
Copy-Item -n docker\.env.example docker\.env
Copy-Item -n backend\.env.example backend\.env
docker compose -f docker\docker-compose.yml build
Push-Location backend; npm install; Pop-Location
Push-Location frontend; npm install; Pop-Location
Write-Host "Edit docker\.env and backend\.env (API_TOKEN, ALLOWED_WORKSPACE_ROOTS), then run scripts\dev.ps1"
