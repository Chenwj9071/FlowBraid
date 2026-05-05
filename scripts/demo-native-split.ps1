$ErrorActionPreference = 'Stop'

[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

try {
  chcp 65001 > $null
} catch {
  # Best effort only. Continue even if code page switching is unavailable.
}

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$workflow = if ($args.Length -gt 0 -and $args[0]) { $args[0] } else { 'examples/codex-native-split-demo.workflow.yaml' }

npx tsx src/cli.ts run $workflow --interactive --native-split-terminals
exit $LASTEXITCODE
