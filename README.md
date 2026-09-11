# 100 дней спорта

Telegram Mini App для фитнес-клуба Андрея — трекер 100-дневного спортивного челленджа: анкета участника, ежедневные отчёты с фото/видео, рейтинг, призовой фонд и админ-панель.

Репозиторий состоит из двух частей:

- **`backend/`** — Node.js + Express + SQLite API (анкеты, прогресс, рейтинг, платежи, админка).
- **`frontend/`** — React + Vite мини-приложение для Telegram (тёмная тема, неоновый акцент).

Подробная пошаговая инструкция по запуску, настройке бота, оплаты и деплою — в файле **[INSTRUCTIONS.md](./INSTRUCTIONS.md)**.

## Быстрый старт (локально)

```bash
# Backend
cd backend
cp .env.example .env   # заполните BOT_TOKEN и остальные переменные
npm install
npm run dev             # http://localhost:4000

# Frontend (в другом терминале)
cd frontend
npm install
npm run dev              # http://localhost:5173
```

Откройте `http://localhost:5173` в браузере — появится экран входа с кнопкой «Войти как тестовый пользователь» (работает только в DEV_MODE, вне Telegram). Внутри Telegram приложение авторизуется автоматически по вашим данным профиля.

Админ-панель: `http://localhost:5173/admin/login` (логин/пароль из `ADMIN_LOGIN`/`ADMIN_PASSWORD` в `.env`).
