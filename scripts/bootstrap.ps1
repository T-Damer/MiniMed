$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path (Join-Path $PSScriptRoot ".."))

foreach ($command in @("node", "bun", "uv")) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
    throw "$command is required and was not found in PATH."
  }
}

bun install --frozen-lockfile
uv sync --project tools/ingest --all-groups --locked
bun run verify

Write-Host "LocalMed Search is ready. Run: bun run dev"
