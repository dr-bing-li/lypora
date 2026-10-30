@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel%==0 (
  node app.cjs
  goto :end
)

if exist "%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-6\node.exe" (
  "%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-6\node.exe" app.cjs
  goto :end
)

echo.
echo  [Lypora] 未找到 Node.js。
echo  请安装 Node 18 或更高版本后重试：https://nodejs.org/
echo.
pause

:end
endlocal
