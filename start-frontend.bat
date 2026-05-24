@echo off
cd /d "%~dp0frontend"

if not exist "node_modules" (
    echo Installing frontend dependencies...
    npm install
)

echo.
echo  SingKey frontend running at http://localhost:5174
echo  Press Ctrl+C to stop.
echo.

npm run dev
pause
