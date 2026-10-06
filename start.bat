@echo off
rem ===================================================================
rem  GACHAGO 启动器 —— 要双击的就是这个文件
rem
rem  文件夹里其它东西都不要双击：
rem    index.html / *.md / *.js / *.mjs 双击只会打开编辑器或记事本，
rem    那不是这个程序。
rem ===================================================================
setlocal
cd /d "%~dp0"
title GACHAGO

set "GO_BIN="
where go >nul 2>nul && set "GO_BIN=go"
if not defined GO_BIN if exist "D:\Program Files (x86)\go\bin\go.exe" set "GO_BIN=D:\Program Files (x86)\go\bin\go.exe"
if not defined GO_BIN if exist "C:\Program Files\Go\bin\go.exe" set "GO_BIN=C:\Program Files\Go\bin\go.exe"
if not defined GO_BIN if exist "C:\Go\bin\go.exe" set "GO_BIN=C:\Go\bin\go.exe"
if not defined GO_BIN if exist "D:\Program Files\Go\bin\go.exe" set "GO_BIN=D:\Program Files\Go\bin\go.exe"
if not defined GO_BIN goto NONODE

rem 8787 上是不是已经有服务在跑？跑的是不是 GACHAGO？
rem   0  = 端口空着，正常启动
rem   10 = 已经是我们自己在跑，直接开页面
rem   20 = 被别的程序占用了（比如另一个项目也用了 8787）
powershell -NoProfile -Command "try { $c=New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1',8787); $c.Close(); $busy=$true } catch { $busy=$false }; if (-not $busy) { exit 0 }; $ours=$false; try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:8787/js/store.js'; if ($r.Content -match 'gachago\.state\.v1') { $ours=$true } } catch {}; if ($ours) { Start-Process 'http://127.0.0.1:8787'; exit 10 }; exit 20"
if errorlevel 20 goto TAKEN
if errorlevel 10 goto RUNNING

set PORT=8787
goto START

:TAKEN
rem 端口被别的程序占了。GACHAGO 不需要和它抢，换个端口就是了。
set PORT=8788
echo.
echo   注意：8787 端口被别的程序占用了（不是 GACHAGO），
echo         我改用 http://127.0.0.1:8788 启动，两边互不影响。
goto START

:START
set URL=http://127.0.0.1:%PORT%
echo.
echo   ==========================================================
echo    GACHAGO 启动中
echo.
echo    下面这个黑色窗口就是服务器本身，别关它
echo    页面地址：%URL%
echo    浏览器会自动打开；没自动打开就把这个地址复制进浏览器
echo.
echo    关掉黑窗口就等于关掉服务，页面就用不了了
echo   ==========================================================
echo.

rem 先等端口真的起来，再开浏览器。
rem 延迟用 ping 而不是 timeout：timeout 需要交互式控制台。
start "" powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 40;$i++){ try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1',%PORT%); $c.Close(); break } catch { Start-Sleep -Milliseconds 300 } }; Start-Process '%URL%'"

echo   使用题目原版 Go 转发服务：server\
set "GOPROXY=https://goproxy.cn,direct"
pushd server
"%GO_BIN%" run . -addr 127.0.0.1:%PORT% -web ../web
popd

echo.
echo   服务已停止。
pause
exit /b 0

:RUNNING
echo.
echo   GACHAGO 已经在 http://127.0.0.1:8787 上跑着了，直接帮你打开页面。
echo   浏览器没反应就手动复制这个地址。
echo.
exit /b 0

:NONODE
echo.
echo   [X] 没找到 Go
echo       去 https://golang.google.cn/dl/ 安装 Go 1.25 或更高版本，
echo       装完之后重新双击本文件。
echo.
pause
exit /b 1
