$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$entryPath = Join-Path $root 'assets/scripts/core/GameEntry.ts'
$migrationPath = Join-Path $root 'assets/migrate-canvas.ts'
$tsPath = 'D:\coscos\cocos\editors\Creator\3.8.0\resources\app.asar.unpacked\node_modules\typescript'

if (-not (Test-Path $tsPath)) {
    throw "Cannot find Creator's bundled TypeScript compiler: $tsPath"
}

$entry = Get-Content -Raw $entryPath
$typescript = "const ts=require(process.argv[1]);const fs=require('fs');const p=process.argv[2];const r=ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,experimentalDecorators:true},reportDiagnostics:true,fileName:p});const d=(r.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error);if(d.length){for(const x of d){console.error(ts.flattenDiagnosticMessageText(x.messageText,'\\n'));}process.exit(1);}" 
node -e $typescript $tsPath $entryPath

if ((Get-Content -Raw $migrationPath) -match '\bBaseNode\b') {
    throw 'migrate-canvas.ts still imports or uses deprecated BaseNode.'
}

if ($entry -match "log\('[^']*\?\);") {
    throw 'GameEntry contains an unterminated log string.'
}

if ($entry -notmatch "EventBus\.emit\('GAME_ENTRY_READY'\);") {
    throw 'GameEntry must emit GAME_ENTRY_READY after startup.'
}

Write-Host 'Cocos import regression checks passed.'
