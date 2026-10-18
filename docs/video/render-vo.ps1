# Renders docs/video/narration.txt to docs/video/vo/vo-NN.wav with Windows' built-in offline voice (no network).
# powershell -ExecutionPolicy Bypass -File docs/video/render-vo.ps1 [-Voice "Microsoft David Desktop"] [-Rate 0]
param([string]$Voice = "Microsoft David Desktop", [int]$Rate = 0)
Add-Type -AssemblyName System.Speech
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$out = Join-Path $here "vo"
New-Item -ItemType Directory -Force $out | Out-Null
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice($Voice); $s.Rate = $Rate
foreach ($line in Get-Content (Join-Path $here "narration.txt") -Encoding UTF8) {
  if ($line -match '^\s*#' -or $line -notmatch '\|') { continue }
  $id, $text = $line -split '\|', 2
  $id = $id.Trim(); $text = $text.Trim()
  if ($text -match '[A-Z]+_LINE') { Write-Output "skip $id (not written yet)"; continue }
  $s.SetOutputToWaveFile((Join-Path $out "$id.wav")); $s.Speak($text); $s.SetOutputToNull()
  Write-Output "wrote $id.wav"
}
