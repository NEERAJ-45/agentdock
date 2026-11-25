Get-Content backend\.env | ForEach-Object { if ($_ -match '^\s*([^#=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim()) } }
Start-Process powershell -ArgumentList '-NoExit','-Command','cd frontend; npm run dev'
Push-Location backend; npm run dev
