Add-Type -AssemblyName System.Drawing
$base = $PSScriptRoot
$out = Join-Path $base 'dist/store-assets-0.20.46'
New-Item -ItemType Directory -Force -Path $out | Out-Null
function Brush($hex) { return [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($hex)) }
function Text($g,$s,$x,$y,$size,$color,$bold=$false) {
 $style = if($bold){[System.Drawing.FontStyle]::Bold}else{[System.Drawing.FontStyle]::Regular}
 $f=[System.Drawing.Font]::new('Microsoft YaHei',$size,$style,[System.Drawing.GraphicsUnit]::Pixel)
 $b=Brush $color; $g.DrawString($s,$f,$b,[single]$x,[single]$y); $f.Dispose();$b.Dispose()
}
function Fit($g,$path,$x,$y,$w,$h) {
 $im=[System.Drawing.Image]::FromFile($path)
 $scale=[Math]::Min($w/$im.Width,$h/$im.Height)
 $dw=[int]($im.Width*$scale);$dh=[int]($im.Height*$scale)
 $g.DrawImage($im,[int]($x+($w-$dw)/2),[int]($y+($h-$dh)/2),$dw,$dh);$im.Dispose()
}
function Canvas($w,$h) {
 $bmp=[System.Drawing.Bitmap]::new($w,$h)
 $g=[System.Drawing.Graphics]::FromImage($bmp)
 $g.SmoothingMode='AntiAlias';$g.InterpolationMode='HighQualityBicubic';$g.TextRenderingHint='AntiAliasGridFit'
 $g.Clear([System.Drawing.ColorTranslator]::FromHtml('#FFF8EE'))
 return @($bmp,$g)
}
function Save($bmp,$g,$name) { $bmp.Save((Join-Path $out $name),[System.Drawing.Imaging.ImageFormat]::Png);$g.Dispose();$bmp.Dispose() }
$items=@(
 @('01-main.png','warm-main-preview.png','课程学习，一处搞定','同步字幕 · PPT 讲解','本机缓存 · 随时提问','打开课堂，即刻开始学习'),
 @('02-calibration.png','guide-calibration-preview.png','字幕跟上课堂节奏','字幕时间同步','语音智能校准','听不清时，试试校准功能'),
 @('03-knowledge-card.png','knowledge-card-blue-preview.png','把理解，变成知识卡','保存问题与 AI 讲解','导出卡片，方便复习','学习重点，随手整理'),
 @('04-account.png','quota-preview.png','学习账号与额度','查看功能权限','查看 AI 与语音剩余额度','服务账号由管理员开通')
)
foreach($item in $items){
 $c=Canvas 1280 800;$bmp=$c[0];$g=$c[1]
 Fit $g (Join-Path $base 'dist/extension/icon128.png') 52 48 64 64
 Text $g '浙大上课爽' 132 56 32 '#263A50' $true
 Text $g $item[2] 52 194 38 '#263A50' $true
 Text $g $item[3] 56 288 25 '#C6501D'
 Text $g $item[4] 56 338 25 '#C6501D'
 Text $g $item[5] 56 424 20 '#75685C'
 Text $g '网课不硬扛，浙大上课爽！' 56 630 21 '#75685C'
 Text $g '功能界面展示' 56 727 16 '#918276'
 Fit $g (Join-Path $base $item[1]) 505 56 735 675
 Save $bmp $g $item[0]
}
$c=Canvas 1280 800;$bmp=$c[0];$g=$c[1]
Text $g '浙大上课爽 · 课堂全屏学习' 32 14 30 '#263A50' $true
Text $g 'PPT、老师视频与双语字幕，同屏查看' 34 61 19 '#75685C'
Fit $g 'C:/Users/hufei/AppData/Local/Temp/codex-clipboard-bd5612df-1d64-4326-bcd2-a2c28e6c8c72.png' 0 103 1280 697
Save $bmp $g '05-classroom.png'
$c=Canvas 440 280;$bmp=$c[0];$g=$c[1]
Fit $g (Join-Path $base 'dist/extension/icon128.png') 28 29 68 68
Text $g '浙大上课爽' 109 41 34 '#263A50' $true
Text $g '网课不硬扛，浙大上课爽！' 28 121 25 '#C6501D' $true
Text $g '同步字幕 / PPT 讲解 / AI 提问' 28 173 20 '#263A50'
Text $g '重点随地摘，学习更轻松' 28 222 19 '#75685C'
Save $bmp $g 'promotional-small-440x280.png'
$c=Canvas 1400 560;$bmp=$c[0];$g=$c[1]
Fit $g (Join-Path $base 'dist/extension/icon128.png') 64 56 84 84
Text $g '浙大上课爽' 172 69 43 '#263A50' $true
Text $g '网课不硬扛，' 64 204 52 '#C6501D' $true
Text $g '浙大上课爽！' 64 272 52 '#C6501D' $true
Text $g '同步字幕 · PPT 讲解 · AI 随时问' 68 378 27 '#263A50'
Text $g '重点随地摘，课后轻松复习' 68 435 23 '#75685C'
Fit $g (Join-Path $base 'warm-main-preview.png') 848 44 478 468
Save $bmp $g 'promotional-large-1400x560.png'
$c=Canvas 300 300;$bmp=$c[0];$g=$c[1];$g.Clear([System.Drawing.Color]::White)
Fit $g (Join-Path $base 'assets/brand-logo.png') 0 0 300 300
Save $bmp $g 'extension-logo-300x300.png'
foreach($file in Get-ChildItem -LiteralPath $out -Filter '*.png'){
 $im=[System.Drawing.Image]::FromFile($file.FullName)
 Write-Output "$($file.Name): $($im.Width)x$($im.Height), $($file.Length) bytes"
 $im.Dispose()
}
Compress-Archive -Path (Join-Path $out '*.png') -DestinationPath (Join-Path $base 'dist/store-assets-0.20.46.zip') -Force
