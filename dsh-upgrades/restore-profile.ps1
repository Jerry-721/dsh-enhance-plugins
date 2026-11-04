# 还原 desktop profile 的 package.json 与 cordis.patch.yml
# 用法（DSH 关闭时执行）：powershell -ExecutionPolicy Bypass -File .\restore-profile.ps1
#
# 背景：DSH 启动时若发现无法解析的 bundle 依赖，会走 profile 恢复流程，
# 把 bundles 重置为模板值（base + web-app）并重写 cordis.patch.yml。
# 这两份备份是当前已知可正常启动的版本（bundles=25，保留 agnes provider /
# pet / better-sidebar / market 配置）。

$ErrorActionPreference = 'Stop'

$src = Join-Path $PSScriptRoot 'profile-backup'
$dst = Join-Path $env:USERPROFILE '.dsh\profiles\desktop'

foreach ($file in @('package.json', 'cordis.patch.yml')) {
  $from = Join-Path $src $file
  $to = Join-Path $dst $file
  if (-not (Test-Path $from)) { throw "备份缺失: $from" }
  Copy-Item $from $to -Force
  Write-Host "已还原 $to"
}

Write-Host ''
Write-Host '完成。启动 DSH 后可用以下命令自检：'
Write-Host '  node dsh-upgrades\verify-plugins.mjs'
