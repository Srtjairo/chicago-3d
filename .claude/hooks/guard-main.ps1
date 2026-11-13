<#
  Sandbox guard (PreToolUse hook). Keeps work off `main` - the live model (GitHub Pages serves main/docs).

  Blocks, unless .claude/ship-approved exists (created by /ship after the user says "ship it"):
    - git commit / merge / rebase / reset / cherry-pick / revert while on main
    - ANY git push (the sandbox is local-only; the only push ever is /ship pushing main)
    - editing site files while the main branch is checked out
  Ticket files and .claude/ are always editable.
  Exit 2 = block (message on stderr goes back to Claude). Fails open on errors.
#>
try {
  $root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
  $git = "C:\Program Files\Git\cmd\git.exe"
  if (Test-Path (Join-Path $root ".claude\ship-approved")) { exit 0 }

  $data = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $branch = (& $git -C $root rev-parse --abbrev-ref HEAD 2>$null | Out-String).Trim()
  $onMain = $branch -eq "main"
  $tool = [string]$data.tool_name

  if ($tool -in @("Bash", "PowerShell")) {
    $cmd = [string]$data.tool_input.command
    # Look only at real git invocations: `git ...`, `git.exe" ...`, or a variable holding git (`& $git ...`, `"$G" ...`),
    # one command segment at a time, so prose that mentions "push" or "main" doesn't trip it.
    $gitCall = '(?:\bgit(?:\.exe)?|\$\{?\w+\}?)[''"]?\s+(?:[^|;&\r\n]*?\s)?'
    foreach ($seg in ($cmd -split '[|;&\r\n]+')) {
      # Exception: deleting a remote branch other than main removes content, it doesn't publish any.
      $isDelete = $seg -match ($gitCall + 'push\b.*\s(--delete|-d)\s') -and $seg -notmatch '(\s|:|/)main\b'
      if ($seg -match ($gitCall + 'push\b') -and -not $isDelete) {
        [Console]::Error.WriteLine("SANDBOX GUARD: the sandbox is local-only - nothing gets pushed (no dev branch online, and pushing main publishes the live site). Only /ship may push, after the user says 'ship it'.")
        exit 2
      }
      if ($onMain -and $seg -match ($gitCall + '(commit|merge|rebase|reset|cherry-pick|revert)\b')) {
        [Console]::Error.WriteLine("SANDBOX GUARD: main is checked out. Switch to dev first (git switch dev). Only /ship changes main.")
        exit 2
      }
    }
    exit 0
  }

  if ($onMain -and $tool -in @("Write", "Edit", "MultiEdit", "NotebookEdit")) {
    $path = ([string]$data.tool_input.file_path) -replace '/', '\'
    if ($path -match '[\\/](tickets|\.claude)[\\/]') { exit 0 }
    if ($path -like "$root*" -or $path -notmatch '^[A-Za-z]:') {
      [Console]::Error.WriteLine("SANDBOX GUARD: main (the live site) is checked out. Run 'git switch dev' before editing site files.")
      exit 2
    }
  }
} catch { }
exit 0
