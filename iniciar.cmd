@echo off
setlocal
cd /d "%~dp0"
if not exist node_modules (
  call npm.cmd install
  if errorlevel 1 goto :failed
)
if not exist .local\runtime\ai-memory\ai-memory.exe (
  call npm.cmd run memory:install
  if errorlevel 1 goto :failed
)
call npm.cmd run build
if errorlevel 1 goto :failed
echo.
echo Abra http://127.0.0.1:4317 no navegador.
echo Mantenha esta janela aberta enquanto usa os terminais.
echo.
call npm.cmd start
goto :eof
:failed
echo.
echo Nao foi possivel iniciar. Consulte a mensagem acima.
pause
