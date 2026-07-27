cmd /c chcp 65001> nul 
chcp 932 > nul

REM 指示された MINGW_PATH を設定

REM set MINGW_PATH=F:\777\borland_c\mingw-w64-48
set MINGW_PATH=F:\337\mingw32

REM 環境変数を設定
set PATH=%PATH%;%MINGW_PATH%\bin
set LIBRARY_PATH=%MINGW_PATH%\lib;%LIBRARY_PATH%
set C_INCLUDE_PATH=%MINGW_PATH%\include;%C_INCLUDE_PATH%
set CPLUS_INCLUDE_PATH=%MINGW_PATH%\include;%CPLUS_INCLUDE_PATH%

REM SET PATH=F:\Portable2\VSCode;%PATH%
set PATH=%PATH%;F:\777\FreeBASIC10
set PATH=%PATH%;F:\777\borland_c\borland_c_5.5\Bin
set PATH=%PATH%;F:\0font\nkf\;%PATH%
REM SET PATH=F:\OBS\BouyomiChan\assistantseika20220130u\aquestalkplayer_20250403\;%PATH%
REM SET PATH=F:\777\gnucobol-3.1.2\bin_x86;%PATH%

set FRAMEWORK_DIR="%SystemRoot%\Microsoft.NET\Framework\v4.0.30319"
SET PATH=%SystemRoot%\Microsoft.NET\Framework\v4.0.30319;%PATH%
REM SET PATH=C:\Windows\Microsoft.NET\Framework\v4.0.30319;%PATH%

REM SET PATH=F:\333\node-v24.0.0-win-x64;%PATH%
REM SET PATH=%PATH%;F:\336\rust\bin
REM SET PATH=%PATH%;F:\0font\gnupack_basic-12.00-2014.12.29\app\cygwin\cygwin\bin
REM SET PATH=%PATH%;C:\771\miniconda3\envs\p307\Library\mingw64\bin\
REM SET PATH=%PATH%;C:\888\code2\node-v24.0.0-win-x64

rem set PATH=%PATH%;"C:\Python35-32\Scripts\";"C:\Python35-32\"
rem SET PATH=F:\Portable2\VSCode;F:\obs2\PortableGit\bin;F:\337\mingw64\bin;%PATH%
rem SET PATH=F:\333\Python310\Scripts;F:\333\Python310;%PATH%

set PATH=%PATH%;F:\0font\04WebServer186\php5
set PATH=%PATH%;F:\obs2\shotcut-win32-191231
set Path=%Path%;C:\Users\win\.local\bin;
set PATH=%PATH%;F:\336\miniconda3w\Library\bin;F:\336\miniconda3w\Scripts;F:\336\miniconda3w
SET PATH=%PATH%;F:\obs2\PortableGit\bin
SET PATH=%PATH%;F:\obs2\PortableGit\usr\bin
rem SET PATH=%PATH%;F:\333\node-v20.0.0-win-x64
SET PATH=%PATH%;F:\333\node-v24.0.0-win-x64
set NODE_SKIP_PLATFORM_CHECK=1

rem call conda info --envs
rem call conda activate p310
rem python --version


rem call conda activate p310
rem cd /d C:\Users\win\Desktop\TextEditorApp
rem rmdir /q /s venv
rem python -m venv venv
rem call venv\Scripts\activate.bat

rem call conda activate p310


rem cd /d C:\888\code2\cmd21
rem python -m venv venv
rem call venv\Scripts\activate.bat
python --version

cd /d C:\888\code2\222hermes
call venv\Scripts\activate
python --version

set CLAUDE_CODE_USE_OPENAI=1
set OPENAI_API_KEY=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
set OPENAI_BASE_URL=https://integrate.api.nvidia.com/v1
set OPENAI_MODEL=nvidia/nemotron-3-ultra-550b-a55b

:server_start
cd /d C:\888\code2\222hermes

for /f "delims=" %%K in ('bash -c "grep -v '^$' NVIDIA_api.txt | shuf -n 1"') do (
    set "OPENAI_API_KEY=%%K"
)

cd /d C:\888\gemini\app\PULSED
chcp 932 > nul

call npx cc-haha "C:\888\gemini\app\PULSED ディレクトリに移動して作業してください。日本語で考えて行動してください。20task2.txtの内容を自動で実行して下さい。 実行エラーが報告された場合は、最適な方法で自動で修正し、成功するまで対応を続けてください。" --dangerously-skip-permissions --tui --auto

goto server_start

call npx openclaude --version

cmd

z-ai/glm-5.2
nvidia/nemotron-3-super-120b-a12b
nvidia/ising-calibration-1-35b-a3b
nvidia/nemotron-3-nano-30b-a3b
nvidia/nemotron-3-ultra-550b-a55b
google/gemma-4-31b-it
openai/gpt-oss-120b
deepseek-ai/deepseek-v4-pro
minimaxai/minimax-m3
minimaxai/minimax-m2.7
moonshotai/kimi-k2.6
qwen/qwen3-next-80b-a3b-instruct
stepfun-ai/step-3.5-flash
stepfun-ai/step-3.7-flash
deepseek-ai/deepseek-v4-flash
qwen/qwen3.5-397b-a17b
qwen/qwen3.5-122b-a10b
openai/gpt-oss-20b
meta/llama-4-maverick-17b-128e-instruct
nvidia/nemotron-3-nano-omni-30b-a3b-reasoning
z-ai/glm4.7

call npx cc-haha --prompt "Hello" --dangerously-skip-permissions --tui --auto

call npx cline-cli2 --prompt "Hello" --yolo --tui --print

call npm install -g @quantum-ai/cc-haha

call npm config delete prefix

call npm config get prefix

cmd

cmd

call npx openclaude "C:\888\gemini\app\PULSED ディレクトリに移動して作業してください。日本語で考えて行動してください。20task2.txtの内容を自動で実行して下さい。 実行エラーが報告された場合は、最適な方法で自動で修正し、成功するまで対応を続けてください。" --dangerously-skip-permissions --print

call npx cc-haha --help
cmd

call npx openclaude --dangerously-skip-permissions

call npm install -g @quantum-ai/openclaude@0.2.0

call npm install -g @quantum-ai/openclaude@0.1.8

node dist/cli.mjs "ディレクトリC:\888\code2\openclaude-main\codex-main\openclaude4に移動して作業してください。日本語で考えて行動してください。task2.txtの内容を自動で実行して下さい。 実行エラーが報告された場合は、最適な方法で自動で修正し、成功するまで対応を続けてください。" --dangerously-skip-permissions

cmd

npm install -g @quantum-ai/openclaude
call npx openclaude --dangerously-skip-permissions

call npx openclaude mcp list

chrome-devtools-mcpを使って、https://www.yahoo.co.jp/のタイトルを取得してください。

call npx openclaude mcp remove chrome-devtools --scope user

call npx openclaude mcp add chrome-devtools --scope user -- npx -y chrome-devtools-mcp --executable-path "C:\Users\win\.agent-browser\browsers\chrome-148.0.7778.97\chrome.exe" --user-data-dir="E:\bombcrypto\supermium_132_1\Supermium\USER_DATA2w10mcp"

npm install -g chrome-devtools-mcp
npx chrome-devtools-mcp --version
cmd

call npx openclaude "hello" --dangerously-skip-permissions

npm install -g easy-llm-cli
npm install -g @qwen-code/qwen-code
npm install -g @quantum-ai/nextclaw
npm install -g @quantum-ai/openclaude
call npm uninstall -g @quantum-ai/nextclaw
call qwen --version

set CLAUDE_CODE_USE_OPENAI=1
set OPENAI_API_KEY=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
set OPENAI_BASE_URL=https://integrate.api.nvidia.com/v1
set OPENAI_MODEL=nvidia/nemotron-3-nano-30b-a3b

npx openclaude "hello" --dangerously-skip-permissions

npx openclaude --help

npx freeclaude --help

npx openclaude

set OPENAI_API_KEY=csk-jhjv6m8kyyme4ycc3hh58frwkn9k6mdt32e45k346ek48hhx
set OPENAI_BASE_URL=https://api.cerebras.ai/v1
set OPENAI_MODEL=gpt-oss-120b
qwen --version
qwen "現在のディレクトリにあるコードのバグを修正して"
call qwen -p "現在のディレクトリにあるコードのバグを修正して"

call npm install -g @yaegaki/cline-cli
call npx -y @yaegaki/cline-cli init
cline-cli --help
cline version
