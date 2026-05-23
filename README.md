# Прайсы

Веб-приложение для загрузки прайсов поставщиков, просмотра товарных предложений и подготовки закупки.

## Что нужно для запуска

- Node.js 20+
- PostgreSQL 14+
- npm

## Быстрый старт

1. Установить зависимости:

```bash
npm install
```

2. Создать локальный `.env` на основе примера:

```bash
copy .env.example .env
```

3. Заполнить в `.env` минимум эти переменные:

- `DATABASE_URL` — строка подключения к PostgreSQL для Prisma
- `APP_LOGIN` — логин администратора
- `APP_PASSWORD_HASH` — bcrypt-хэш пароля
- `APP_SESSION_SECRET` — длинный случайный секрет для cookie-сессии

4. Сгенерировать Prisma client и применить миграции:

```bash
npm run prisma:generate
npx prisma migrate deploy
```

5. Запустить проект:

```bash
npm run dev
```

6. Открыть [http://localhost:3000](http://localhost:3000)

## Проверка DATABASE_URL

Если `DATABASE_URL` не настроен, авторизация пройдет, но dashboard покажет понятную страницу setup вместо падения Prisma.

Проверить подключение можно так:

```bash
npx prisma db pull
```

Если команда падает, строка подключения к базе сломана или база недоступна.

## AI для умного заказа

По умолчанию проект умеет работать без AI и делает локальную подсказку.

Если хотите подключить внешний AI, используйте один из вариантов:

- `POLZA_AI_API_KEY` + `POLZA_AI_MODEL`
- `OPENROUTER_API_KEY` + `OPENROUTER_MODEL`

`Polza AI` проверяется первым, `OpenRouter` — запасной вариант.

## Инициализация новой товарной модели

Заполнить базовые единицы измерения:

```bash
npm run catalog:seed-units
```

Перенести текущие строки `Product` в новые таблицы `ProductMaster / SupplierOffer / PriceSnapshot / ProductMapping`:

```bash
npm run catalog:backfill
```

Скрипт backfill ничего не удаляет из старой модели `Product` и может запускаться повторно.

## Генерация секретов

Сгенерировать bcrypt-хэш пароля:

```bash
node -e "require('bcrypt').hash('change-me', 10).then(console.log)"
```

Сгенерировать `APP_SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Что уже есть в проекте

- Логин по одному админ-аккаунту
- Dashboard-каркас
- Поставщики
- Загрузка и парсинг прайсов
- Товары из прайсов
- Черновики заказов
- Черновик умного заказа

## Ограничения текущей версии

- Без рабочей PostgreSQL базы проект нормально не работает
- Текущая модель `Product` пока завязана на строку прайса поставщика
- Категории, отчеты, настройки и интеграция с iiko пока не реализованы
