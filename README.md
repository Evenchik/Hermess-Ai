# Hermess Ai

## Запуск в 1 клик (без команд)
**Windows:** двойной клик по `start.bat` или `run.py`
**Linux / Mac:** двойной клик по `start.sh` или `run.py` (или `./run.py`)

Скрипт сам проверит Node.js 18+, npm, .env, поставит `npm install` и запустит `http://localhost:3000`

## Запуск командой
```bash
python run.py          # dev
python run.py --prod   # prod (build + start)
python run.py --port 4000
```

## Модели (бесплатно без карты)
- DeepSeek V4 Flash (0731)
- DeepSeek V3 (0324)
- DeepSeek R1 (0528) — reasoning
- GPT-OSS 20B
- GPT-OSS 120B

Все работают через llm7 + Pollinations с авто-фолбеком.

## Переменные окружения (.env)
```
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/app_db"
OPENAI_API_KEY=""  # опционально, для GPT-4o и т.д.
GROQ_API_KEY=""
ANTHROPIC_API_KEY=""
```
