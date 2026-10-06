param([Parameter(Mandatory=$true)][string]$Backup,[Parameter(Mandatory=$true)][string]$TargetUrl)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Backup)) { throw 'Backup file not found' }
pg_restore --dbname=$TargetUrl --clean --if-exists --no-owner --no-acl $Backup
Write-Host 'Restore completed. Run npm run db:migrate before serving traffic.'
