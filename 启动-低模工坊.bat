@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   低模工坊 · 企鹅物流
echo   ----------------------------------------
echo   正在启动本地服务器...
start "lowpoly-workshop-server" cmd /c "node tools\_serve.js"
timeout /t 1 >nul
echo   打开启动页: http://localhost:8765/
start "" "http://localhost:8765/"
echo.
echo   已打开浏览器。
echo   关闭本窗口不会停止服务器；要停止请关掉那个 server 窗口。
echo.
timeout /t 3 >nul
