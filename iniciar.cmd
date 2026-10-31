@echo off
setlocal
cd /d "%~dp0"
if not defined PORT set "PORT=4317"
call npm.cmd run setup
if errorlevel 1 goto :failed
echo.
echo Abra http://127.0.0.1:%PORT% no navegador.
echo Mantenha esta janela aberta enquanto usa os terminais.
echo.
call npm.cmd start
goto :eof
:failed
echo.
echo Nao foi possivel iniciar. Consulte a mensagem acima.
pause
