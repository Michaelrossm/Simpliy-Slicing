param(
    [string]$Model = '',
    [int]$ExpectedCount = 6181
)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
if (-not $Model) {
    $testDir = Get-ChildItem -LiteralPath $project -Directory -Filter 'S*teststl' | Select-Object -First 1
    if (-not $testDir) { throw 'Testmodellordner fehlt; -Model angeben' }
    $Model = (Get-ChildItem -LiteralPath $testDir.FullName -File -Filter '*gedreht.stl' | Select-Object -First 1).FullName
}
$env:SIMPLIY_BENCH_STL = (Resolve-Path -LiteralPath $Model).Path
$env:SIMPLIY_BENCH_COUNT = "$ExpectedCount"
$env:SIMPLIY_PROFILE = Join-Path $env:TEMP ("simpliy-profile-{0}.log" -f [guid]::NewGuid())
$output = Join-Path $env:TEMP ("simpliy-benchmark-{0}.log" -f [guid]::NewGuid())
Push-Location (Join-Path $project 'src-tauri')
try {
    cargo test --release --offline --lib --no-run
    if ($LASTEXITCODE -ne 0) { throw 'Benchmark-Build fehlgeschlagen' }
    $exe = Get-ChildItem -LiteralPath 'target\release\deps' -Filter 'simpliy_slicing_lib-*.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $exe) { throw 'Benchmark-Testprogramm fehlt' }
    $process = Start-Process -FilePath $exe.FullName -ArgumentList 'support_performance_scene','--ignored','--nocapture' -WindowStyle Hidden -PassThru -RedirectStandardOutput $output
    $null = $process.Handle # Handle offen halten, damit Windows den Exitcode nach Prozessende liefert.
    [long]$peak = 0
    while (-not $process.HasExited) {
        $process.Refresh()
        $peak = [Math]::Max([long]$peak, [long]$process.PeakWorkingSet64)
        Start-Sleep -Milliseconds 100
    }
    $process.WaitForExit()
    Get-Content -LiteralPath $output -Encoding UTF8
    "Peak Working Set: $([Math]::Round($peak / 1GB, 3)) GiB"
    if (Test-Path -LiteralPath $env:SIMPLIY_PROFILE) { Get-Content -LiteralPath $env:SIMPLIY_PROFILE -Encoding UTF8 }
    if ($process.ExitCode -ne 0) { throw "Benchmark fehlgeschlagen: $($process.ExitCode)" }
} finally {
    Pop-Location
}
