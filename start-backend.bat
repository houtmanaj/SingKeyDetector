@echo off
cd /d "%~dp0backend"

if not exist ".venv\Scripts\activate.bat" (
    echo Creating virtual environment...
    py -3 -m venv .venv
    if errorlevel 1 (
        echo ERROR: Python 3 not found. Install it from https://python.org
        pause
        exit /b 1
    )
)

call .venv\Scripts\activate.bat

echo Installing / verifying dependencies...
pip install -r requirements.txt -q

echo.
echo  SingKey backend running at http://localhost:8001
echo  Press Ctrl+C to stop.
echo.

uvicorn main:app --host 0.0.0.0 --port 8001
pause
