$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot

try {
    Get-Content -Raw (Join-Path $root 'package.json') | ConvertFrom-Json | Out-Null
} catch {
    throw "package.json must be valid JSON: $($_.Exception.Message)"
}

$scene = Get-Content -Raw (Join-Path $root 'assets/Main.scene') | ConvertFrom-Json
$types = @($scene | ForEach-Object { $_.__type__ })

foreach ($requiredType in 'cc.Canvas', 'cc.Camera', 'GameManager', 'GameEntry', 'PlayerController', 'cc.Label') {
    if ($types -notcontains $requiredType) {
        throw "Main.scene is missing required runtime component: $requiredType"
    }
}

Write-Host 'Runtime scene configuration is present.'
