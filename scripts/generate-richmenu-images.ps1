# 產生 LINE Rich Menu 用的兩張圖：assets/richmenu/menu-zh.png、menu-vi.png
# 一次性工具腳本，不進 runtime。執行方式（開發機一次）：
#   powershell -ExecutionPolicy Bypass -File scripts/generate-richmenu-images.ps1
#
# 規格見 docs/loop/vi-rich-menu/DESIGN.md §3.2：
# - 畫布 2500x1686，背景 #F5F6FA
# - 六格版位＝點擊區格線：colX=(0,833,1666) colW=(833,833,834) rowY=(0,843) rowH=(843,843)
# - 每格內縮 24px 畫圓角矩形（圓角半徑 40）當色塊；文字置中
# - 色盤（依格序 1-6）：#2F6FED #12B76A #F79009 #9E77ED #F04438 #475467
# - 字：白色粗體 120px；zh 用 Microsoft JhengHei，vi 用 Segoe UI；不放 emoji

Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $repoRoot 'assets\richmenu'
if (-not (Test-Path $outDir)) {
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
}

$colX = @(0, 833, 1666)
$colW = @(833, 833, 834)
$rowY = @(0, 843)
$rowH = @(843, 843)

$colors = @(
    [System.Drawing.Color]::FromArgb(0x2F, 0x6F, 0xED),
    [System.Drawing.Color]::FromArgb(0x12, 0xB7, 0x6A),
    [System.Drawing.Color]::FromArgb(0xF7, 0x90, 0x09),
    [System.Drawing.Color]::FromArgb(0x9E, 0x77, 0xED),
    [System.Drawing.Color]::FromArgb(0xF0, 0x44, 0x38),
    [System.Drawing.Color]::FromArgb(0x47, 0x54, 0x67)
)

# 圓角矩形路徑
function New-RoundedRectPath {
    param(
        [float]$X, [float]$Y, [float]$Width, [float]$Height, [float]$Radius
    )
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $Radius * 2
    $path.AddArc($X, $Y, $d, $d, 180, 90)
    $path.AddArc($X + $Width - $d, $Y, $d, $d, 270, 90)
    $path.AddArc($X + $Width - $d, $Y + $Height - $d, $d, $d, 0, 90)
    $path.AddArc($X, $Y + $Height - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

function New-RichMenuImage {
    param(
        [string]$OutPath,
        [string]$FontFamily,
        [string[]]$Labels # 6 個標籤，依格序 1-6（左上→右上→...→右下，逐列）
    )

    $bmp = New-Object System.Drawing.Bitmap(2500, 1686)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias

    $bg = [System.Drawing.Color]::FromArgb(0xF5, 0xF6, 0xFA)
    $g.Clear($bg)

    $font = New-Object System.Drawing.Font($FontFamily, 120, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center

    $inset = 24
    $radius = 40

    $idx = 0
    for ($row = 0; $row -lt 2; $row++) {
        for ($col = 0; $col -lt 3; $col++) {
            $x = $colX[$col] + $inset
            $y = $rowY[$row] + $inset
            $w = $colW[$col] - (2 * $inset)
            $h = $rowH[$row] - (2 * $inset)

            $path = New-RoundedRectPath -X $x -Y $y -Width $w -Height $h -Radius $radius
            $brush = New-Object System.Drawing.SolidBrush($colors[$idx])
            $g.FillPath($brush, $path)
            $brush.Dispose()
            $path.Dispose()

            $rect = New-Object System.Drawing.RectangleF($x, $y, $w, $h)
            $g.DrawString($Labels[$idx], $font, $whiteBrush, $rect, $sf)

            $idx++
        }
    }

    $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)

    $g.Dispose()
    $bmp.Dispose()
    $font.Dispose()
    $whiteBrush.Dispose()
    $sf.Dispose()
}

$zhLabels = @('台鐵查詢', '加油站', '油價', '今天吃什麼', '天氣', '選單')
$viLabels = @('Giờ tàu', 'Trạm xăng', 'Tỷ giá', 'Giá xăng', 'Thời tiết', 'Trợ giúp')

$zhOut = Join-Path $outDir 'menu-zh.png'
$viOut = Join-Path $outDir 'menu-vi.png'

Write-Host "產生 $zhOut ..."
New-RichMenuImage -OutPath $zhOut -FontFamily 'Microsoft JhengHei' -Labels $zhLabels

Write-Host "產生 $viOut ..."
New-RichMenuImage -OutPath $viOut -FontFamily 'Segoe UI' -Labels $viLabels

# ── 自我驗證：PNG signature、IHDR 尺寸（[int] 乘法讀法，避免 -shl 對 byte 截斷的坑）、bytes < 1MB ──
function Test-RichMenuPng {
    param([string]$Path)

    if (-not (Test-Path $Path)) {
        Write-Error "找不到檔案：$Path"
        return $false
    }

    $bytes = [IO.File]::ReadAllBytes($Path)
    $sig = @(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
    for ($i = 0; $i -lt 8; $i++) {
        if ($bytes[$i] -ne $sig[$i]) {
            Write-Error "$Path PNG signature 不符於 byte $i"
            return $false
        }
    }

    $width = [int]$bytes[16] * 16777216 + [int]$bytes[17] * 65536 + [int]$bytes[18] * 256 + [int]$bytes[19]
    $height = [int]$bytes[20] * 16777216 + [int]$bytes[21] * 65536 + [int]$bytes[22] * 256 + [int]$bytes[23]

    if ($width -ne 2500 -or $height -ne 1686) {
        Write-Error "$Path 尺寸不符：$width x $height（預期 2500 x 1686）"
        return $false
    }

    if ($bytes.Length -ge 1048576) {
        Write-Error "$Path 檔案過大：$($bytes.Length) bytes（上限 1048576）"
        return $false
    }

    Write-Host "驗證通過：$Path ($($bytes.Length) bytes, $width x $height)"
    return $true
}

$ok1 = Test-RichMenuPng -Path $zhOut
$ok2 = Test-RichMenuPng -Path $viOut

if (-not ($ok1 -and $ok2)) {
    exit 1
}

Write-Host "全部完成 ✅"
