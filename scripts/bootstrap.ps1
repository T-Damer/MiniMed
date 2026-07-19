$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path (Join-Path $PSScriptRoot ".."))

foreach ($command in @("node", "corepack", "uv")) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
    throw "$command is required and was not found in PATH."
  }
}

corepack enable
pnpm install --frozen-lockfile
uv sync --project tools/ingest --all-groups --locked
pnpm verify

Write-Host "LocalMed Search is ready. Run: pnpm dev"
