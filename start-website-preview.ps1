$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
python -m backend.public_preview --demo --port 8765
