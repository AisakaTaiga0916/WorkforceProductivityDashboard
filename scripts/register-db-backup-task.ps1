# Registers a daily Windows Scheduled Task for PostgreSQL backups.
# Run from an elevated PowerShell if Register-ScheduledTask requires it.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/register-db-backup-task.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/register-db-backup-task.ps1 -Time "06:00"
#   powershell -ExecutionPolicy Bypass -File scripts/register-db-backup-task.ps1 -Unregister

param(
  [string]$Time = "06:00",
  [switch]$Unregister
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$taskName = "TicketSystemV3-DatabaseBackup"
$runScript = Join-Path $root "scripts\run-db-backup.ps1"

if ($Unregister) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Removed scheduled task: $taskName"
  exit 0
}

if (-not (Test-Path $runScript)) {
  throw "Backup runner not found: $runScript"
}

$action = New-ScheduledTaskAction `
  -Execute "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runScript`"" `
  -WorkingDirectory $root

$trigger = New-ScheduledTaskTrigger -Daily -At $Time

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Daily PostgreSQL backup (primary + auth) for ticket_system_v3." `
  -Force | Out-Null

Write-Host "Registered scheduled task: $taskName"
Write-Host "  Runs daily at: $Time"
Write-Host "  Command    : powershell -File `"$runScript`""
Write-Host ""
Write-Host "Test now with: npm run db:backup"
Write-Host "List backups : npm run db:backup:list"
Write-Host "Remove task  : powershell -ExecutionPolicy Bypass -File scripts/register-db-backup-task.ps1 -Unregister"
