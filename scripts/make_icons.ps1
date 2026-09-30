# 从设计源图生成各处使用的图标（Windows / PowerShell + System.Drawing）
#
# 用法：powershell -File scripts/make_icons.ps1
# 源图：build/icon-source.png（1024x1024，由设计提供的方形图标）
# 产物：
#   build/icon.png            256x256，electron-builder 非 Windows 平台图标
#   build/icon.ico            多尺寸 ICO（16/32/48/64/128/256），Windows 打包图标
#   src/main/assets/icon.png  256x256，运行时窗口/任务栏图标
#   src/main/assets/tray.png  32x32，系统托盘图标

param(
  [string]$Source = (Join-Path $PSScriptRoot '..\build\icon-source.png')
)

Add-Type -AssemblyName System.Drawing

function Resize-Png {
  param(
    [System.Drawing.Image]$Image,
    [int]$Size,
    [string]$OutPath
  )
  $bmp = New-Object System.Drawing.Bitmap $Size, $Size
  $graphics = [System.Drawing.Graphics]::FromImage($bmp)
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.DrawImage($Image, 0, 0, $Size, $Size)
  $graphics.Dispose()
  $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

$sourcePath = (Resolve-Path $Source).Path
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

Write-Host "source: $sourcePath"
$image = [System.Drawing.Image]::FromFile($sourcePath)
Write-Host ("source size: {0}x{1}" -f $image.Width, $image.Height)

try {
  # 运行时用到的图标（由 vite 作为资源打包）
  Resize-Png -Image $image -Size 256 -OutPath (Join-Path $root 'src\main\assets\icon.png')
  Resize-Png -Image $image -Size 32 -OutPath (Join-Path $root 'src\main\assets\tray.png')

  # 打包图标
  Resize-Png -Image $image -Size 256 -OutPath (Join-Path $root 'build\icon.png')

  # 多尺寸 ICO：各尺寸以 PNG 载荷写入（Vista 及以上支持）
  $sizes = @(16, 32, 48, 64, 128, 256)
  $tempDir = Join-Path $env:TEMP ('shell-icons-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tempDir | Out-Null

  $payloads = New-Object System.Collections.ArrayList
  foreach ($size in $sizes) {
    $file = Join-Path $tempDir "icon-$size.png"
    Resize-Png -Image $image -Size $size -OutPath $file
    [void]$payloads.Add(@{ Size = $size; Bytes = [System.IO.File]::ReadAllBytes($file) })
  }

  $icoPath = Join-Path $root 'build\icon.ico'
  $stream = [System.IO.File]::Create($icoPath)
  $writer = New-Object System.IO.BinaryWriter($stream)
  try {
    $writer.Write([UInt16]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]$payloads.Count)

    $offset = 6 + 16 * $payloads.Count
    foreach ($item in $payloads) {
      # 256 尺寸在 ICO 目录项里记 0
      $dimension = if ($item.Size -ge 256) { 0 } else { $item.Size }
      $writer.Write([Byte]$dimension)
      $writer.Write([Byte]$dimension)
      $writer.Write([Byte]0)
      $writer.Write([Byte]0)
      $writer.Write([UInt16]1)
      $writer.Write([UInt16]32)
      $writer.Write([UInt32]$item.Bytes.Length)
      $writer.Write([UInt32]$offset)
      $offset += $item.Bytes.Length
    }
    foreach ($item in $payloads) {
      $writer.Write($item.Bytes)
    }
  }
  finally {
    $writer.Dispose()
    $stream.Dispose()
  }

  Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host 'done: build/icon.png + build/icon.ico + src/main/assets/{icon,tray}.png'
}
finally {
  $image.Dispose()
}
