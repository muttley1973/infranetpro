@echo off
title InfraNet Pro
cd /d "%~dp0"

echo.
echo  ================================================
echo    InfraNet Pro - Avvio in corso...
echo  ================================================
echo.

:: Individua node.exe: prima nel PATH, poi nei percorsi standard di installazione
set NODE_EXE=
set NPM_CMD=

where node >nul 2>&1
if %ERRORLEVEL% equ 0 (
    set NODE_EXE=node
    set NPM_CMD=npm
    goto :found_node
)

:: Fallback percorsi standard Windows
for %%P in (
    "%ProgramFiles%\nodejs\node.exe"
    "%ProgramFiles(x86)%\nodejs\node.exe"
    "%LOCALAPPDATA%\Programs\nodejs\node.exe"
) do (
    if exist %%P (
        set NODE_EXE=%%~P
        set NPM_CMD=%%~dPnpm.cmd
        goto :found_node
    )
)

echo  [ERRORE] Node.js non trovato.
echo.
echo  Scaricalo da:  https://nodejs.org   (versione LTS)
echo  Dopo l'installazione riavvia questo file.
echo.
pause
exit /b 1

:found_node
:: Installa le dipendenze npm al primo avvio (o se node_modules manca)
if not exist "%~dp0node_modules" (
    echo  Prima installazione delle dipendenze npm...
    echo.
    call "%NPM_CMD%" install
    if %ERRORLEVEL% neq 0 (
        echo.
        echo  [ERRORE] npm install fallito. Verifica la connessione internet.
        pause
        exit /b 1
    )
    echo.
)

:: Apre il browser dopo 2 secondi (il server ha tempo di partire)
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:8421"

:: Avvia il server Node.js
"%NODE_EXE%" server.js

:: Se Node esce con errore
if %ERRORLEVEL% neq 0 (
    echo.
    echo  [ERRORE] Il server si e' chiuso inaspettatamente (codice %ERRORLEVEL%).
    pause
)
