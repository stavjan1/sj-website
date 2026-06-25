# PowerShell Script to parse Stern Price List HTML into JSON (ASCII Only to avoid encoding issues)

$htmlPath = "C:\Users\stavj\.gemini\antigravity-ide\brain\89746617-ca30-4272-85ed-99c966320f29\.system_generated\steps\70\content.md"
if (-not (Test-Path $htmlPath)) {
    Write-Error "HTML content file not found at $htmlPath"
    Exit
}

Write-Host "Reading content file..."
$content = Get-Content $htmlPath -Raw -Encoding UTF8

# Extract tbody content
if ($content -match "<tbody>([\s\S]*?)</tbody>") {
    $tbody = $Matches[1]
} else {
    $tbody = $content
}

# Regex to find all tr elements
$trRegex = [regex]'<tr>([\s\S]*?)</tr>'
$tdRegex = [regex]'<td>([\s\S]*?)</td>'

$items = @()

Write-Host "Parsing HTML rows..."
$trMatches = $trRegex.Matches($tbody)
$rowIndex = 0

foreach ($trMatch in $trMatches) {
    $trContent = $trMatch.Groups[1].Value
    $tdMatches = $tdRegex.Matches($trContent)
    
    if ($tdMatches.Count -ge 2) {
        $desc = $tdMatches[0].Groups[1].Value
        
        # Decode basic HTML entities (ASCII only)
        $desc = $desc.Replace("&quot;", '"').Replace("&amp;", '&').Replace("&nbsp;", ' ').Replace("&#8230;", '...').Replace("&middot;", '*').Replace("&#039;", "'")
        $desc = $desc -replace '\s+', ' '
        $desc = $desc.Trim()
        
        # Skip headers: first row (index 0) or empty descriptions or rows containing table headers
        if ($rowIndex -eq 0 -or $desc.Length -eq 0 -or $desc.Contains("th") -or $desc.Contains("class=")) {
            $rowIndex++
            continue
        }
        
        # Get price (last column)
        $priceStr = $tdMatches[$tdMatches.Count - 1].Groups[1].Value
        # Find numeric part (e.g. 300.00 or 1,250.00)
        if ($priceStr -match '([0-9,]+(\.[0-9]+)?)') {
            $priceVal = $Matches[1].Replace(",", "")
            $price = [double]$priceVal
        } else {
            $price = 0.0
        }
        
        # Get unit/details (second column if 3 or more exist)
        $unit = ""
        if ($tdMatches.Count -ge 3) {
            $unit = $tdMatches[1].Groups[1].Value
            $unit = $unit.Replace("&quot;", '"').Replace("&amp;", '&').Replace("&nbsp;", ' ').Replace("&#8230;", '...').Replace("&#039;", "'")
            $unit = $unit -replace '\s+', ' '
            $unit = $unit.Trim()
        }
        
        # Skip row if it looks like a header (e.g. first row of section)
        if ($price -eq 0.0 -and $unit -eq "") {
            $rowIndex++
            continue
        }
        
        $item = [PSCustomObject]@{
            description = $desc
            unit = $unit
            price = $price
        }
        $items += $item
    }
    $rowIndex++
}

$jsonPath = "C:\Users\stavj\.gemini\antigravity-ide\scratch\quote-generator\stern-pricing.json"
# Write JSON output
$jsonOutput = $items | ConvertTo-Json -Depth 4
[IO.File]::WriteAllText($jsonPath, $jsonOutput, [System.Text.Encoding]::UTF8)

Write-Host "Successfully parsed $($items.Count) items and saved to $jsonPath"
