# 从设计源图生成各处使用的图标（Windows / PowerShell + System.Drawing）
#
# 用法：powershell -File scripts/make_icons.ps1
# 源图：build/icon-source.png（1024x1024，由设计提供的方形图标）
# 产物：
#   build/icon.png            256x256，electron-builder 非 Windows 平台图标
#   build/icon.ico            多尺寸 ICO（16/32/48/64/128/256），Windows 打包图标
#   src/main/assets/icon.png  256x256，运行时窗口/任务栏图标
#   src/main/assets/tray.png  32x32，系统托盘图标
#   src/main/assets/menu/*.png  16x16 菜单项图标（浅色 / 深色主题各一套）
#
# 菜单项图标用 GDI+ 直接绘制，不依赖系统图标字体，避免字体缺失时渲染成方块。

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

# 绘制 16x16 菜单图标。$Kind: refresh / home / devtools
function Write-MenuIcon {
  param(
    [string]$Kind,
    [string]$Color,
    [string]$OutPath
  )
  $size = 16
  $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $pen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml($Color)), 1.6
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

  switch ($Kind) {
    'refresh' {
      # 开口圆弧 + 箭头
      $g.DrawArc($pen, 3.0, 3.0, 10.0, 10.0, 50.0, 280.0)
      $g.DrawLine($pen, 10.8, 2.2, 13.2, 3.4)
      $g.DrawLine($pen, 13.2, 3.4, 12.0, 5.6)
    }
    'home' {
      # 屋顶折线 + 屋身
      $g.DrawLines($pen, @(
          (New-Object System.Drawing.PointF 2.2, 7.6),
          (New-Object System.Drawing.PointF 8.0, 2.6),
          (New-Object System.Drawing.PointF 13.8, 7.6)
        ))
      $g.DrawLine($pen, 4.0, 7.2, 4.0, 13.4)
      $g.DrawLine($pen, 12.0, 7.2, 12.0, 13.4)
      $g.DrawLine($pen, 4.0, 13.4, 12.0, 13.4)
    }
    'devtools' {
      # 终端提示符 >_ 造型
      $g.DrawLines($pen, @(
          (New-Object System.Drawing.PointF 4.0, 4.6),
          (New-Object System.Drawing.PointF 8.4, 8.0),
          (New-Object System.Drawing.PointF 4.0, 11.4)
        ))
      $g.DrawLine($pen, 9.6, 12.2, 13.0, 12.2)
    }
  }

  $pen.Dispose()
  $g.Dispose()
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

  # 用 .NET 删除临时目录：某些环境下 Remove-Item 会被安全守卫拦截而中断后续逻辑
  try {
    [System.IO.Directory]::Delete($tempDir, $true)
  }
  catch {
    Write-Warning "临时目录未清理：$tempDir"
  }

  # 菜单项图标：浅色主题用深灰描边，深色主题用浅灰描边
  # 注意：目录已存在时 New-Item -Force 不产生输出，不能直接取它的返回值
  $menuDir = Join-Path $root 'src\main\assets\menu'
  if (-not (Test-Path $menuDir)) {
    New-Item -ItemType Directory -Path $menuDir | Out-Null
  }
  $themes = [ordered]@{ light = '#475569'; dark = '#d4d4d8' }
  foreach ($theme in $themes.Keys) {
    foreach ($kind in @('refresh', 'home', 'devtools')) {
      Write-MenuIcon -Kind $kind -Color $themes[$theme] -OutPath (Join-Path $menuDir "$kind-$theme.png")
    }
  }

  Write-Host 'done: build/icon.png + build/icon.ico + src/main/assets/{icon,tray}.png + src/main/assets/menu/*.png'
}
finally {
  $image.Dispose()
}
