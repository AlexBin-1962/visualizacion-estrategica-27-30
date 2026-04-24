param(
  [string]$Root = "estrategico",
  [switch]$UseGitHead,
  [string[]]$IncludeNames
)

$ErrorActionPreference = "Stop"

function Fix-RelativeRefs {
  param(
    [string]$Text,
    [string[]]$HtmlNames
  )

  if ([string]::IsNullOrEmpty($Text)) {
    return $Text
  }

  $options = [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
  $prefixPattern = '(?<=(\"|''|\(|=))(?!(?:\.\./|https?:|//|#|data:|mailto:|tel:))(?<path>(?:assets|data|src|config|scripts)/)'
  $Text = [regex]::Replace($Text, $prefixPattern, { param($m) "../$($m.Groups['path'].Value)" }, $options)
  $rootPrefixPattern = '(?<=(\"|''|\(|=))/?estrategico/(?<path>(?:assets|data|src|config|scripts)/)'
  $Text = [regex]::Replace($Text, $rootPrefixPattern, { param($m) "../$($m.Groups['path'].Value)" }, $options)

  foreach ($name in $HtmlNames) {
    $Text = $Text.Replace("'$name'", "'../$name'")
    $Text = $Text.Replace('"' + $name + '"', '"../' + $name + '"')
    $Text = $Text.Replace("'estrategico/$name'", "'../$name'")
    $Text = $Text.Replace('"' + "estrategico/$name" + '"', '"../' + $name + '"')
    $Text = $Text.Replace("'/estrategico/$name'", "'../$name'")
    $Text = $Text.Replace('"' + "/estrategico/$name" + '"', '"../' + $name + '"')
  }

  return $Text
}

$files = Get-ChildItem $Root -File *.html
if ($IncludeNames -and $IncludeNames.Count -gt 0) {
  $includeSet = @{}
  foreach ($name in $IncludeNames) {
    $includeSet[$name] = $true
  }
  $files = @($files | Where-Object { $includeSet.ContainsKey($_.Name) })
}
$htmlNames = $files.Name
$regexOptions = [System.Text.RegularExpressions.RegexOptions]::IgnoreCase

foreach ($file in $files) {
  $base = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
  $destDir = Join-Path $file.DirectoryName $base
  New-Item -ItemType Directory -Path $destDir -Force | Out-Null

  if ($UseGitHead) {
    $cwd = (Get-Location).Path
    $relativePath = $file.FullName.Substring($cwd.Length + 1).Replace('\', '/')
    $raw = (git show ("HEAD:{0}" -f $relativePath)) -join "`n"
  } else {
    $raw = Get-Content $file.FullName -Raw
  }
  $styleMatches = [regex]::Matches($raw, '<style\b[^>]*>([\s\S]*?)</style>', $regexOptions)
  $scriptMatches = [regex]::Matches($raw, '<script\b(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)</script>', $regexOptions)

  $cssContent = ($styleMatches | ForEach-Object { $_.Groups[1].Value.Trim("`r", "`n") }) -join "`r`n`r`n"
  $jsContent = ($scriptMatches | ForEach-Object { $_.Groups[1].Value.Trim("`r", "`n") }) -join "`r`n`r`n// ---- inline block separator ----`r`n`r`n"

  $styleIndex = 0
  $newHtml = [regex]::Replace(
    $raw,
    '<style\b[^>]*>[\s\S]*?</style>',
    {
      param($m)
      $script:styleIndex++
      if ($script:styleIndex -eq 1) {
        return ('  <link rel="stylesheet" href="{0}.css"/>' -f $base)
      }
      return ''
    },
    $regexOptions
  )

  $scriptIndex = 0
  $newHtml = [regex]::Replace(
    $newHtml,
    '<script\b(?![^>]*\bsrc\b)[^>]*>[\s\S]*?</script>',
    {
      param($m)
      $script:scriptIndex++
      if ($script:scriptIndex -eq 1) {
        return ('<script src="{0}.js"></script>' -f $base)
      }
      return ''
    },
    $regexOptions
  )

  $newHtml = Fix-RelativeRefs -Text $newHtml -HtmlNames $htmlNames
  $cssContent = Fix-RelativeRefs -Text $cssContent -HtmlNames $htmlNames
  $jsContent = Fix-RelativeRefs -Text $jsContent -HtmlNames $htmlNames

  Set-Content -Path (Join-Path $destDir $file.Name) -Value $newHtml -Encoding utf8
  Set-Content -Path (Join-Path $destDir ($base + ".css")) -Value $cssContent -Encoding utf8
  Set-Content -Path (Join-Path $destDir ($base + ".js")) -Value $jsContent -Encoding utf8

  $wrapper = @"
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Redirigiendo…</title>
  <meta http-equiv="refresh" content="0; url=$base/$($file.Name)" />
  <meta name="robots" content="noindex" />
  <script>
    (function () {
      var target = '$base/$($file.Name)' + location.search + location.hash;
      location.replace(target);
    })();
  </script>
</head>
<body>
  <noscript>
    <p>Redirigiendo a <a href="$base/$($file.Name)">$base/$($file.Name)</a>…</p>
  </noscript>
</body>
</html>
"@

  Set-Content -Path $file.FullName -Value $wrapper -Encoding utf8
}
