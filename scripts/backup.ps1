param([Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference = 'Stop'
if (-not $env:DATABASE_URL) { throw 'DATABASE_URL is required' }
pg_dump --dbname=$env:DATABASE_URL --format=custom --no-owner --no-acl --file=$Output
Write-Host "Backup created: $Output"
