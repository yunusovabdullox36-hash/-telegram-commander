# Telegram Bridge v1.0 - Bot <-> Obsidian <-> AI
# This script bridges Telegram bot (on Render) with local Obsidian vault

param(
    [string]$BotUrl = "https://multer-38vj.onrender.com",
    [string]$VaultPath = "",
    [int]$PollInterval = 5,
    [switch]$Once
)

if (-not $VaultPath) {
    $VaultPath = [Environment]::GetFolderPath("MyDocuments") + "\Obsidian Vault"
}

$AgentTownDir = $VaultPath + "\_Miya\AgentTown\tasks"
$InboxDir = $VaultPath + "\_Miya\Telegram\inbox"
$DailyDir = $VaultPath + "\_Miya\Daily"
$LogFile = $VaultPath + "\_Miya\Telegram\bridge.log"
$SeenFile = $VaultPath + "\_Miya\Telegram\seen_messages.json"

# Ensure directories exist
foreach ($d in @($AgentTownDir, $InboxDir, $DailyDir)) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}
$logDir = Split-Path $LogFile -Parent
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

function Log-Message {
    param([string]$Msg)
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts] $Msg"
    Write-Host $line
    try { Add-Content -Path $LogFile -Value $line } catch {}
}

function Get-BotMessages {
    try {
        $r = Invoke-RestMethod -Uri "$BotUrl/api/messages" -TimeoutSec 10 -ErrorAction Stop
        return $r.messages
    } catch {
        return @()
    }
}

function Acknowledge-Messages {
    param([int[]]$Ids)
    if ($Ids.Length -eq 0) { return }
    try {
        $body = "{""msgIds"":[" + ($Ids -join ",") + "]}"
        Invoke-RestMethod -Uri "$BotUrl/api/messages/ack" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 10 | Out-Null
        Log-Message "Acknowledged: $Ids"
    } catch {
        Log-Message "ACK error: $($_.Exception.Message)"
    }
}

function Write-ToObsidian {
    param([string]$Text, [int]$MsgId, [string]$Ts)

    $date = $Ts.Substring(0, 10)
    $safeName = $Text -replace '[^a-zA-Z0-9\s]', ''
    if ($safeName.Length -gt 30) { $safeName = $safeName.Substring(0, 30) }
    if (-not $safeName) { $safeName = "message" }

    # Task file
    $taskFile = "$AgentTownDir\$date-$safeName-$MsgId.md"
    $taskBody = @"
---
date: $Ts
type: telegram-message
from: rey
msg_id: $MsgId
status: received
---

## Xabar
$Text

## Processing
_(AI tomonidan qayta ishlanishi kutilmoqda...)_

"@
    if (-not (Test-Path $taskFile)) {
        Set-Content -Path $taskFile -Value $taskBody -Encoding UTF8
        Log-Message "Task created: $((Split-Path $taskFile -Leaf))"
    }

    # Inbox
    $tsSafe = $Ts -replace '[:.]', '-'
    $inboxFile = "$InboxDir\$date-$tsSafe-$MsgId.md"
    $inboxBody = "---`nfrom: rey`nmsg_id: $MsgId`nts: $Ts`n---`n`n$Text`n"
    Set-Content -Path $inboxFile -Value $inboxBody -Encoding UTF8

    # Daily note
    $dailyFile = "$DailyDir\$date.md"
    $dailyEntry = "`n## Telegram - $Ts`n> $Text`n"
    try { Add-Content -Path $dailyFile -Value $dailyEntry } catch {}
}

# Load seen messages into a simple hashtable
$seen = @{}
if (Test-Path $SeenFile) {
    try {
        $content = Get-Content $SeenFile -Raw -ErrorAction Stop
        if ($content -and $content.Length -gt 2) {
            $parsed = ConvertFrom-Json $content -ErrorAction Stop
            if ($parsed -is [System.Management.Automation.PSCustomObject]) {
                $parsed.PSObject.Properties | ForEach-Object { $seen[$_.Name] = $true }
            }
        }
    } catch {
        Log-Message "Seen file read error (will start fresh): $($_.Exception.Message)"
        $seen = @{}
    }
}

function Save-Seen {
    try {
        $pairs = @()
        $seen.Keys | ForEach-Object { $pairs += """$_"":true" }
        $json = "{" + ($pairs -join ",") + "}"
        Set-Content -Path $SeenFile -Value $json -Force -ErrorAction Stop
    } catch {
        Log-Message "Save seen error: $($_.Exception.Message)"
    }
}

Log-Message "================================"
Log-Message "Telegram Bridge v1.0 started"
Log-Message "Bot: $BotUrl"
Log-Message "Vault: $VaultPath"
Log-Message "================================"

if ($Once) {
    $msgs = Get-BotMessages
    Write-Host "Messages in queue: $($msgs.Length)"
    foreach ($m in $msgs) {
        Write-Host "  #$($m.msgId): $($m.text) [$($m.ts)]"
    }
    exit
}

# Main loop
$cycles = 0
$lastHeartbeat = Get-Date
while ($true) {
    try {
        $messages = Get-BotMessages
        if ($messages.Length -gt 0) {
            $newIds = @()
            foreach ($m in $messages) {
                $key = [string]$m.msgId
                if (-not $seen.ContainsKey($key)) {
                    $seen[$key] = $true
                    $newIds += $m.msgId
                    Log-Message "New message #$($m.msgId): $($m.text)"
                    Write-ToObsidian -Text $m.text -MsgId $m.msgId -Ts $m.ts
                }
            }
            if ($newIds.Length -gt 0) {
                Acknowledge-Messages -Ids $newIds
                Save-Seen
            }
        }

        $cycles++
        $now = Get-Date
        if (($now - $lastHeartbeat).TotalSeconds -ge 120) {
            Log-Message "Heartbeat: $cycles cycles, seen messages: $($seen.Count)"
            $lastHeartbeat = $now
        }
    } catch {
        Log-Message "Error: $($_.Exception.Message)"
    }
    Start-Sleep -Seconds $PollInterval
}
