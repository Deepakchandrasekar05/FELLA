@echo off
set FELLA_HOME=%~dp0..
node --import tsx "%~dp0fella.js" %*
