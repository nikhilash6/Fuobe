// `fuobe worker install` (Windows): a Task Scheduler task "Fuobe worker" that starts the worker when you sign in and
// starts it again if it stops, and two desktop shortcuts with hotkeys: "Pause Fuobe worker" (Ctrl+Alt+P) and "Resume
// Fuobe worker". It prints the PowerShell first; it runs it only with --yes.

const q = (s) => `'${String(s).replaceAll("'", "''")}'`;

export function installScript({ node, bin, home }) {
  const text = `# Fuobe worker: start at sign-in (restarted if it stops), and pause / resume shortcuts.
$ErrorActionPreference = "Stop"
$action = New-ScheduledTaskAction -Execute ${q(node)} -Argument ${q(`"${bin}" worker run`)} -WorkingDirectory ${q(home)}
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries
Register-ScheduledTask -TaskName "Fuobe worker" -Action $action -Trigger $trigger -Settings $settings -RunLevel Limited -Force | Out-Null
$shell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath("Desktop")
foreach ($s in @(@("Pause Fuobe worker", "worker pause", "CTRL+ALT+P"), @("Resume Fuobe worker", "worker resume", ""))) {
  $lnk = $shell.CreateShortcut((Join-Path $desktop ($s[0] + ".lnk")))
  $lnk.TargetPath = ${q(node)}
  $lnk.Arguments = '"${bin.replaceAll("'", "''")}" ' + $s[1]
  $lnk.WindowStyle = 7
  if ($s[2]) { $lnk.Hotkey = $s[2] }
  $lnk.Save()
}
Write-Host "Done: the worker starts when you sign in. Ctrl+Alt+P pauses it."
`;
  return { text };
}
