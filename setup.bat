@echo off
cd /d "%~dp0"
set "DIR=%~dp0"
set "DIR=%DIR:\=/%"
set "URL=file:///%DIR%src/tab_groups_list_page.html"
(echo {"LIST_PAGE_URL": "%URL%"})> local-config.json
echo Setup complete.
type local-config.json
