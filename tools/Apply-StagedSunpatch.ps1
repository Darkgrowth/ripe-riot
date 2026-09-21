param([switch]$Apply)
$ErrorActionPreference = 'Stop'
$stageRoot = 'J:\RIPE-RIOT-staging\sunpatch-alive'
$liveRoot = 'J:\RIPE RIOT'
$manifest = Get-Content -LiteralPath (Join-Path $stageRoot 'handoff\manifest.json') -Raw | ConvertFrom-Json
if (-not $Apply) {
  Write-Output "$($manifest.files.Count) reviewed files are staged. The live project has not been changed."
  Write-Output 'Only run with -Apply when the active play session has ended: copying source can trigger Vite reload.'
  $manifest.files | Select-Object path
  return
}
# Validate every source and destination before writing anything. A later edit
# to either tree must be reviewed instead of overwritten by an old handoff.
foreach ($item in $manifest.files) {
  $sourcePath = [IO.Path]::GetFullPath((Join-Path $stageRoot $item.path))
  $targetPath = [IO.Path]::GetFullPath((Join-Path $liveRoot $item.path))
  if (-not $sourcePath.StartsWith($stageRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or
      -not $targetPath.StartsWith($liveRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Manifest path escapes project.' }
  if ((Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash -ne $item.stagedHash) { throw "Staged file changed: $($item.path)" }
  $present = Test-Path -LiteralPath $targetPath
  if ($item.liveHash) {
    if (-not $present -or (Get-FileHash -LiteralPath $targetPath -Algorithm SHA256).Hash -ne $item.liveHash) { throw "Live file changed: $($item.path)" }
  } elseif ($present) { throw "New file now exists in live project: $($item.path)" }
}
$backupRoot = Join-Path $stageRoot ('handoff\backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
foreach ($item in $manifest.files) {
  $sourcePath = Join-Path $stageRoot $item.path
  $targetPath = Join-Path $liveRoot $item.path
  if (Test-Path -LiteralPath $targetPath) {
    $backupPath = Join-Path $backupRoot $item.path
    New-Item -ItemType Directory -Path (Split-Path -Parent $backupPath) -Force | Out-Null
    Copy-Item -LiteralPath $targetPath -Destination $backupPath
  }
  New-Item -ItemType Directory -Path (Split-Path -Parent $targetPath) -Force | Out-Null
  Copy-Item -LiteralPath $sourcePath -Destination $targetPath -Force
}
Write-Output "Applied $($manifest.files.Count) files. Backup: $backupRoot"
Write-Output 'No browser, server process, save data, or game window was controlled by this script.'
