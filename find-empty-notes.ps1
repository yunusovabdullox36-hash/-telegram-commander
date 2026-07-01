# ============================================================
# find-empty-notes.ps1 — Obsidian Vault bo'sh notelarni topish
# ============================================================
# Foydalanish:
#   .\find-empty-notes.ps1
#   .\find-empty-notes.ps1 -MinWords 100  (default: 50)
#   .\find-empty-notes.ps1 -Output "C:\path\to\output.txt"
# ============================================================

param(
    [int]$MinWords = 50,
    [string]$OutputFile = "",
    [string]$VaultPath = ""
)

if (-not $VaultPath) {
    $VaultPath = "C:\Users\user\OneDrive\Документы\Obsidian Vault"
}

if (-not $OutputFile) {
    $OutputFile = Join-Path $PSScriptRoot "empty_notes.txt"
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Obsidian Vault — Bo'sh Note Finder" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Vault: $VaultPath"
Write-Host "Threshold: < $MinWords words"
Write-Host "Output: $OutputFile"
Write-Host ""

$results = @()
$totalFiles = 0

Get-ChildItem -Path $VaultPath -Filter "*.md" -Recurse -File -ErrorAction SilentlyContinue | 
    Where-Object { $_.FullName -notmatch 'node_modules|\.git' } |
    ForEach-Object {
        $totalFiles++
        $content = Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue
        if (-not $content) { return }
        
        # Content minus frontmatter, minus headings, minus wikilinks
        $textOnly = $content -replace '^---[\s\S]*?---\n*', '' `
                             -replace '#+\s*', '' `
                             -replace '\[\[.*?\]\]', '' `
                             -replace '\s+', ' '
        $wordCount = ($textOnly -split '\s+' | Where-Object { $_ -ne '' }).Count
        
        if ($wordCount -lt $MinWords) {
            $relPath = $_.FullName.Substring($VaultPath.Length + 1)
            # Check if it has frontmatter tags
            $tags = if ($content -match '^---\ntags:\s*\[(.*?)\]') { $matches[1] } else { "" }
            $results += [PSCustomObject]@{
                Words = $wordCount
                Path = $relPath
                Tags = $tags
                FullName = $_.FullName
            }
        }
    }

# Sort by word count (descending)
$results = $results | Sort-Object Words -Descending

# Save to file
$results | ForEach-Object { "$($_.Words) | $($_.Path)" } | 
    Set-Content -Path $OutputFile -Encoding utf8

# Summary
Write-Host "Total .md files scanned: $totalFiles" -ForegroundColor Gray
Write-Host "Empty/skeleton notes found: $($results.Count)" -ForegroundColor Yellow
Write-Host ""
Write-Host "Top 10 emptiest:" -ForegroundColor Green
$results | Select-Object -First 10 | ForEach-Object {
    $icon = if ($_.Words -eq 0) { "⬜" } elseif ($_.Words -lt 20) { "📄" } else { "📝" }
    Write-Host "  $icon $($_.Words)w | $($_.Path)" -ForegroundColor White
}
Write-Host ""
Write-Host "✅ Saved to: $OutputFile" -ForegroundColor Green
