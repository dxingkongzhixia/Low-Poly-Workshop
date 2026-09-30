@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

REM ================= 改这两行就行 =================
set REPO=Low-Poly-Workshop
set VIS=--public
REM ===============================================

echo.
echo   低模工坊 · 发布到 GitHub
echo   ----------------------------------------
echo   仓库名 : %REPO%
echo   可见性 : %VIS%
echo.

where git >nul 2>nul
if errorlevel 1 goto :nogit

where gh >nul 2>nul
if errorlevel 1 goto :noghh

REM ---- 还没初始化就初始化 ----
if exist ".git" goto :staged
echo   [1/4] 初始化仓库（main 分支）...
git init -b main
git add -A
git commit -q -m "低模工坊 · 首个版本"
echo         完成。

:staged
REM ---- 有未提交的改动就提交 ----
echo   [2/4] 检查有没有未提交的改动...
git add -A
git diff --cached --quiet
if errorlevel 1 goto :docommit
echo         工作区干净，跳过。

:aftercommit
REM ---- 登录 ----
echo   [3/4] 检查 GitHub 登录状态...
gh auth status >nul 2>nul
if errorlevel 1 goto :dologin
echo         已登录。

:push
REM ---- 建仓库 / 推送 ----
echo   [4/4] 推送...
git remote get-url origin >nul 2>nul
if errorlevel 1 goto :createrepo
echo         已有 origin，直接推。
git push -u origin main
if errorlevel 1 goto :pushfail
goto :done

:createrepo
echo         还没有远程仓库，尝试用 gh 创建 %REPO% 并推送...
gh repo create %REPO% %VIS% --source=. --remote=origin --push
if errorlevel 1 goto :repoexists
goto :done

:repoexists
REM 仓库已经存在（多半是你先在网页上建过了）——改成手动关联再推，
REM 并且把远程已有的提交合进来，否则 push 会被拒（non-fast-forward）。
echo.
echo         创建失败 —— 多半是 %REPO% 已经在你账号里了。
echo         改成「手动关联 + 合并远程已有内容 + 推送」...
for /f "usebackq delims=" %%i in (`gh api user -q .login`) do set GHUSER=%%i
if "%GHUSER%"=="" goto :pushfail
git remote remove origin >nul 2>nul
git remote add origin https://github.com/%GHUSER%/%REPO%.git
echo         拉取远程已有的提交...
git fetch origin
git fetch origin main >nul 2>nul
git merge origin/main --allow-unrelated-histories -X ours -m "merge remote placeholder commit"
if errorlevel 1 goto :mergefail
echo         推送...
git push -u origin main
if errorlevel 1 goto :pushfail
goto :done

:mergefail
echo.
echo   [X] 合并远程内容时冲突了，脚本不会替你乱选。
echo       手动处理：
echo         git status              看哪些文件冲突
echo         改完 git add -A 然后 git commit
echo         最后 git push -u origin main
echo.
pause
exit /b 1

:pushfail
echo.
echo   [X] 推送失败。常见的两个原因：
echo       1) 网络/代理 —— 到 github.com 的连接被重置或超时
echo       2) 仓库非空而且历史对不上 —— 需要先 git fetch + git merge
echo       把上面的报错发我。
echo.
pause
exit /b 1

:docommit
echo         有改动，提交中...
git commit -q -m "更新（由 发布到GitHub.bat 自动提交）"
goto :aftercommit

:dologin
echo         还没登录。接下来会显示一个 8 位验证码并打开浏览器，
echo         把验证码粘进去、点 Authorize 就行。
echo.
gh auth login --hostname github.com --git-protocol https --web
if errorlevel 1 goto :loginfail
goto :push

:done
echo.
echo   ============================================
echo    完成！仓库地址：
echo   ============================================
gh repo view --json url -q .url 2>nul
echo.
echo   以后改了东西，再跑一次本脚本就会自动提交 + 推送。
echo.
pause
exit /b 0

:nogit
echo   [X] 没找到 git。
echo.
echo       装一下（任选一个）：
echo         winget install --id Git.Git -e
echo         或去 https://git-scm.com/download/win 下安装包
echo.
echo       装完记得**新开一个终端**再跑本脚本。
echo.
pause
exit /b 1

:noghh
echo   [X] 没找到 GitHub CLI (gh)。
echo.
echo       装一下：
echo         winget install --id GitHub.cli -e
echo.
echo       装完记得**新开一个终端**再跑本脚本。
echo.
echo       （不想装 gh 也行：去 https://github.com/new 手动建一个空仓库，
echo         然后 git remote add origin 你的仓库地址
echo         再跑 git push -u origin main
echo.
pause
exit /b 1

:loginfail
echo.
echo   [X] 登录失败或取消了。再跑一次本脚本重试。
echo.
pause
exit /b 1
