import axios from "axios";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import readline from "readline";

const require = createRequire(import.meta.url);
const generate = require("epub-gen");

// Конфигурация
const CONFIG = {
  baseUrl: "https://api.cdnlibs.org/api/manga",
  delayMin: 3000, // 3 секунды
  delayMax: 3000, // 3 секунды
  outputDir: "./output",
};

/**
 * Случайная задержка между запросами
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Получить случайную задержку в диапазоне
 */
function getRandomDelay() {
  return (
    Math.floor(Math.random() * (CONFIG.delayMax - CONFIG.delayMin + 1)) +
    CONFIG.delayMin
  );
}

/**
 * Проверка, запущен ли скрипт в CI окружении (GitHub Actions, GitLab CI и т.д.)
 */
function isCI() {
  return (
    process.env.CI === "true" ||
    process.env.GITHUB_ACTIONS === "true" ||
    process.env.GITLAB_CI === "true" ||
    process.env.CIRCLECI === "true" ||
    process.env.TRAVIS === "true"
  );
}

/**
 * Отображение прелоадера во время паузы
 */
async function showLoader(duration, message = "Ожидание...") {
  // В CI окружении просто ждем без анимации
  if (isCI()) {
    console.log(message);
    await delay(duration);
    return;
  }

  // В обычном режиме показываем анимацию
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const interval = 100; // Обновление каждые 100мс
  let currentFrame = 0;

  return new Promise((resolve) => {
    const startTime = Date.now();

    const timer = setInterval(() => {
      process.stdout.write(`\r${frames[currentFrame]} ${message} `);
      currentFrame = (currentFrame + 1) % frames.length;

      if (Date.now() - startTime >= duration) {
        clearInterval(timer);
        process.stdout.write("\r" + " ".repeat(message.length + 10) + "\r"); // Очистка строки
        resolve();
      }
    }, interval);
  });
}

/**
 * Очистка имени файла от недопустимых символов
 */
function sanitizeFilename(filename) {
  if (!filename) return filename;

  // Убираем недопустимые символы: " : < > | * ? \r \n
  // Также убираем слеши и обратные слеши
  let sanitized = filename
    .replace(/["<>|*?:\\\/\r\n]/g, "") // Убираем недопустимые символы
    .replace(/\s+/g, "-") // Заменяем пробелы на дефисы
    .replace(/\.{2,}/g, ".") // Убираем множественные точки
    .replace(/^\.+|\.+$/g, "") // Убираем точки в начале и конце
    .trim();

  // Если после очистки строка пустая, возвращаем дефолтное значение
  if (!sanitized) {
    return "book";
  }

  return sanitized;
}

/**
 * Очистка HTML контента для EPUB
 */
function cleanHtmlContent(html) {
  if (!html) return "";

  // Извлекаем текст из параграфов, сохраняя структуру
  // Убираем атрибуты data-paragraph-index и другие
  let cleaned = html
    .replace(/<p[^>]*>/g, "<p>") // Убираем атрибуты из тегов <p>
    .replace(/<\/p>\s*<p>/g, "</p>\n<p>") // Сохраняем переносы между параграфами
    .replace(/\s+/g, " ") // Нормализуем множественные пробелы внутри параграфов
    .replace(/(<\/p>)\s*(<p>)/g, "$1\n$2") // Переносы между параграфами
    .trim();

  // Если нет параграфов, возвращаем как есть
  if (!cleaned.includes("<p>")) {
    cleaned = `<p>${cleaned.replace(/<[^>]+>/g, "").trim()}</p>`;
  }

  return cleaned;
}

/**
 * Получить и скачать обложку книги
 */
async function fetchCover(mangaId, mangaSlug) {
  try {
    const url = `${CONFIG.baseUrl}/${mangaId}/covers`;
    const response = await axios.get(url);

    if (response.data && response.data.data && response.data.data.length > 0) {
      const coverData = response.data.data[0];
      if (coverData.cover && coverData.cover.default) {
        const coverUrl = coverData.cover.default;

        // Скачиваем обложку с заголовками для избежания 403
        const coverResponse = await axios.get(coverUrl, {
          responseType: "arraybuffer",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Referer: "https://ranobelib.me/",
            Accept: "image/webp,image/apng,image/*,*/*;q=0.8",
          },
        });

        // Определяем расширение файла из URL
        const urlParts = coverUrl.split(".");
        const extension = urlParts[urlParts.length - 1].split("?")[0] || "jpg";

        // Сохраняем обложку в папку output
        // Убеждаемся, что папка существует
        if (!fs.existsSync(CONFIG.outputDir)) {
          fs.mkdirSync(CONFIG.outputDir, { recursive: true });
        }

        const sanitizedSlug = sanitizeFilename(mangaSlug || mangaId);
        const coverFilename = `cover_${sanitizedSlug}.${extension}`;
        const coverPath = path.join(CONFIG.outputDir, coverFilename);

        fs.writeFileSync(coverPath, Buffer.from(coverResponse.data));
        console.log(`✓ Обложка сохранена: ${coverPath}`);

        return coverPath; // Возвращаем путь к локальному файлу
      }
    }
    return null;
  } catch (error) {
    console.warn(`Не удалось получить обложку: ${error.message}`);
    return null;
  }
}

/**
 * Получить главу по API
 */
async function fetchChapter(mangaId, volume, number) {
  try {
    const url = `${CONFIG.baseUrl}/${mangaId}/chapter?number=${number}&volume=${volume}`;

    const response = await axios.get(url);

    if (response.data && response.data.data) {
      const chapter = response.data.data;
      return {
        title: chapter.name || `Глава ${number}`,
        content: cleanHtmlContent(chapter.content || ""),
        volume: chapter.volume,
        number: chapter.number,
      };
    }

    throw new Error("Неверный формат ответа API");
  } catch (error) {
    console.error(
      `Ошибка при получении главы volume=${volume}, number=${number}:`,
      error.message
    );
    throw error;
  }
}

/**
 * Скачать все главы книги
 */
async function downloadBook(
  mangaId,
  mangaSlug,
  startVolume = 1,
  startChapter = 1,
  endVolume = null,
  endChapter = null
) {
  console.log(`Начало скачивания книги: ${mangaId}`);
  console.log(
    `Диапазон: volume ${startVolume}-${
      endVolume || startVolume
    }, chapters ${startChapter}-${endChapter || "до конца"}`
  );

  const chapters = [];
  let currentVolume = startVolume;
  let currentChapter = startChapter;
  let hasMore = true;

  // Создаем директорию для вывода
  if (!fs.existsSync(CONFIG.outputDir)) {
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
  }

  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 2; // Останавливаемся после 2 ошибок подряд

  while (hasMore) {
    // Проверяем, достигли ли мы конца указанного диапазона
    if (endVolume && endChapter) {
      if (
        currentVolume > endVolume ||
        (currentVolume === endVolume && currentChapter > endChapter)
      ) {
        console.log("Достигнут конец указанного диапазона");
        hasMore = false;
        break;
      }
    }

    try {
      // Получаем главу
      const chapter = await fetchChapter(
        mangaId,
        currentVolume,
        currentChapter
      );

      // Сбрасываем счетчик ошибок при успехе
      consecutiveErrors = 0;

      // Первая глава должна быть перед оглавлением
      const isFirstChapter = chapters.length === 0;

      chapters.push({
        title: chapter.title,
        data: chapter.content,
        beforeToc: isFirstChapter,
      });

      console.log(`✓ Скачана: ${chapter.title}`);

      // Переход к следующей главе
      currentChapter++;

      // Пауза между запросами
      if (hasMore) {
        const delayTime = getRandomDelay();
        const nextChapterInfo = `Скачивание главы: том ${currentVolume}, глава ${currentChapter}`;
        await showLoader(delayTime, nextChapterInfo);
      }
    } catch (error) {
      consecutiveErrors++;

      // Если не указан конец диапазона и получили ошибку - возможно достигли конца книги
      if (!endVolume || !endChapter) {
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          console.log(
            `Получено ${consecutiveErrors} ошибок подряд. Предполагаем, что достигнут конец книги.`
          );
          hasMore = false;
          break;
        }
      } else {
        // Если указан диапазон, просто пропускаем и продолжаем
        console.warn(
          `Пропуск главы volume=${currentVolume}, number=${currentChapter}`
        );
      }

      currentChapter++;

      // Небольшая пауза даже при ошибке
      await delay(2000);
    }
  }

  if (chapters.length === 0) {
    console.error("Не удалось скачать ни одной главы!");
    return;
  }

  console.log(`\nВсего скачано глав: ${chapters.length}`);
  console.log("Получение обложки...");

  // Получаем и скачиваем обложку
  const coverPath = await fetchCover(mangaId, mangaSlug);
  if (!coverPath) {
    console.log("⚠ Обложка не найдена");
  }

  console.log("Создание EPUB файла...");

  // Убираем beforeToc у всех глав, чтобы они шли после автоматического оглавления
  const contentForEpub = chapters.map((ch) => ({ ...ch, beforeToc: false }));

  // Создаем EPUB
  const epubOptions = {
    title: mangaSlug || `Книга ${mangaId}`,
    author: "Unknown",
    content: contentForEpub,
    tocTitle: "Оглавление",
    cover: coverPath || undefined, // Добавляем обложку, если она есть
  };

  const sanitizedSlug = sanitizeFilename(mangaSlug || mangaId);
  const outputPath = path.join(CONFIG.outputDir, `${sanitizedSlug}.epub`);

  try {
    await new Promise((resolve, reject) => {
      const epub = new generate(epubOptions, outputPath);
      epub.promise
        .then(() => {
          console.log(`✓ EPUB файл создан: ${outputPath}`);
          resolve();
        })
        .catch(reject);
    });

    // Удаляем обложку после успешного создания EPUB
    if (coverPath && fs.existsSync(coverPath)) {
      try {
        fs.unlinkSync(coverPath);
        console.log(`✓ Обложка удалена: ${coverPath}`);
      } catch (deleteError) {
        console.warn(`⚠ Не удалось удалить обложку: ${deleteError.message}`);
      }
    }
  } catch (error) {
    console.error("Ошибка при создании EPUB:", error.message);
    throw error;
  }
}

/**
 * Парсинг URL книги ranobelib.me
 */
function parseBookUrl(url) {
  try {
    // Убираем пробелы
    url = url.trim();

    // Если URL не начинается с протокола, добавляем https://
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = "https://" + url;
    }

    // Парсим URL с помощью встроенного URL API
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (urlError) {
      throw new Error("Неверный формат URL");
    }

    // Проверяем, что это ссылка на ranobelib
    const hostname = parsedUrl.hostname.toLowerCase();
    if (
      !hostname.includes("ranobelib.me") &&
      !hostname.includes("ranobelib.ru")
    ) {
      throw new Error(
        "Неверный формат ссылки. Ожидается ссылка на ranobelib.me или ranobelib.ru"
      );
    }

    // Извлекаем путь без query параметров
    const pathname = parsedUrl.pathname;

    // Извлекаем ID и slug из пути
    // Формат: /ru/book/28369--the-rebirth-of-the-malicious-empress-of-military-lineage
    // или: /book/28369--the-rebirth-of-the-malicious-empress-of-military-lineage
    const match = pathname.match(/\/book\/(\d+)(?:--(.+))?/);

    if (!match) {
      throw new Error("Не удалось извлечь ID книги из ссылки");
    }

    const mangaId = match[1];
    // Если slug есть, берем его, иначе используем ID
    let mangaSlug = match[2] || `book-${mangaId}`;

    // Убираем возможные слеши в конце slug
    mangaSlug = mangaSlug.replace(/\/+$/, "");

    // Очищаем slug от недопустимых символов для имени файла
    mangaSlug = sanitizeFilename(mangaSlug);

    return { mangaId, mangaSlug };
  } catch (error) {
    throw new Error(`Ошибка парсинга URL: ${error.message}`);
  }
}

/**
 * Запрос ввода у пользователя
 */
function askQuestion(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

/**
 * Парсинг диапазона глав
 */
function parseChapterRange(rangeStr) {
  // Обрабатываем пустую строку или строку с пробелами
  if (!rangeStr || !rangeStr.trim()) {
    return {
      startVolume: 1,
      startChapter: 1,
      endVolume: null,
      endChapter: null,
    };
  }

  rangeStr = rangeStr.trim();

  // Проверяем, содержит ли строка двоеточие (старый формат с томом)
  const hasColon = rangeStr.includes(":");

  if (!hasColon) {
    // Новый упрощенный формат: "1" или "1-150" (только номера глав, том 1 по умолчанию)
    const parts = rangeStr.split("-");

    if (parts.length === 1) {
      // Только одна глава: "1"
      const chapterNum = parseInt(parts[0].trim());
      return {
        startVolume: 1,
        startChapter: chapterNum || 1,
        endVolume: null,
        endChapter: null,
      };
    } else {
      // Диапазон глав: "1-150"
      const startChapter = parseInt(parts[0].trim()) || 1;
      const endChapter = parseInt(parts[1].trim());
      return {
        startVolume: 1,
        startChapter: startChapter,
        endVolume: 1,
        endChapter: endChapter,
      };
    }
  } else {
    // Старый формат: "1:1" или "1:1-1:5" или "1:1-5" (том:глава или том:глава-том:глава)
    const parts = rangeStr.split("-");

    if (parts.length === 1) {
      // Только начальная глава: "1:1"
      const startParts = parts[0].split(":").map((s) => parseInt(s.trim()));
      return {
        startVolume: startParts[0] || 1,
        startChapter: startParts[1] || 1,
        endVolume: null,
        endChapter: null,
      };
    } else {
      // Диапазон: "1:1-1:5" или "1:1-5"
      const startParts = parts[0].split(":").map((s) => parseInt(s.trim()));
      const endParts = parts[1].split(":").map((s) => parseInt(s.trim()));

      // Если в конце только одно число, это номер главы в том же томе
      if (endParts.length === 1) {
        return {
          startVolume: startParts[0] || 1,
          startChapter: startParts[1] || 1,
          endVolume: startParts[0] || 1,
          endChapter: endParts[0],
        };
      } else {
        // Полный формат: том:глава-том:глава
        return {
          startVolume: startParts[0] || 1,
          startChapter: startParts[1] || 1,
          endVolume: endParts[0] || startParts[0] || 1,
          endChapter: endParts[1],
        };
      }
    }
  }
}

// Основная функция
async function main() {
  // Проверяем неинтерактивный режим (для GitHub Actions)
  const isNonInteractive =
    process.argv.includes("--non-interactive") || process.env.BOOK_URL;
  const bookUrlFromEnv = process.env.BOOK_URL;
  // Сначала проверяем переменную окружения, потом аргументы командной строки
  // Игнорируем process.argv[2] если это флаг --non-interactive
  const rangeFromEnv =
    process.env.CHAPTER_RANGE ||
    (process.argv[2] && !process.argv[2].startsWith("--")
      ? process.argv[2]
      : "") ||
    "";

  let bookUrl, rangeStr;

  if (isNonInteractive && bookUrlFromEnv) {
    // Неинтерактивный режим
    bookUrl = bookUrlFromEnv;
    rangeStr = rangeFromEnv.trim();
    console.log("═══════════════════════════════════════════════════════");
    console.log("  Скачивание книги с ranobelib.me в формате EPUB");
    console.log("═══════════════════════════════════════════════════════\n");
    console.log(`Ссылка на книгу: ${bookUrl}`);
    if (rangeStr) {
      console.log(`Диапазон глав: "${rangeStr}"`);
    } else {
      console.log(`Диапазон глав: не указан (будут скачаны все главы)`);
    }
    console.log();
  } else {
    // Интерактивный режим
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      console.log("═══════════════════════════════════════════════════════");
      console.log("  Скачивание книги с ranobelib.me в формате EPUB");
      console.log("═══════════════════════════════════════════════════════\n");

      // Запрашиваем ссылку на книгу
      bookUrl = await askQuestion(
        rl,
        "Введите ссылку на книгу (например: https://ranobelib.me/ru/book/40218--the-devious-first-daughter): "
      );

      if (!bookUrl) {
        console.error("\n✗ Ссылка не может быть пустой!");
        process.exit(1);
      }

      // Запрашиваем диапазон глав
      console.log("Формат диапазона глав:");
      console.log('  - "1-150" - главы 1-150 первого тома (упрощенный формат)');
      console.log('  - "1" - только первая глава первого тома');
      console.log(
        '  - "1:1-1:5" - главы 1-5 первого тома (полный формат с томом)'
      );
      console.log('  - "1:1-5" - главы 1-5 первого тома (короткий формат)');
      console.log("  - (пусто) - все главы с первой\n");

      rangeStr = await askQuestion(
        rl,
        "Введите диапазон глав (Enter для всех глав с первой): "
      );

      rl.close();
    } catch (error) {
      rl.close();
      console.error("\n✗ Ошибка:", error.message);
      process.exit(1);
    }
  }

  // Парсим URL
  let mangaId, mangaSlug;
  try {
    const parsed = parseBookUrl(bookUrl);
    mangaId = parsed.mangaId;
    mangaSlug = parsed.mangaSlug;
    console.log(`✓ Найдена книга: ID=${mangaId}, Slug=${mangaSlug}\n`);
  } catch (error) {
    console.error(`\n✗ ${error.message}`);
    process.exit(1);
  }

  const range = parseChapterRange(rangeStr);

  // Дополнительное логирование для отладки в неинтерактивном режиме
  if (isNonInteractive) {
    console.log(`[DEBUG] rangeStr: "${rangeStr}"`);
    console.log(
      `[DEBUG] Парсинг диапазона: startVolume=${range.startVolume}, startChapter=${range.startChapter}, endVolume=${range.endVolume}, endChapter=${range.endChapter}`
    );
  }

  console.log(`\nПараметры скачивания:`);
  console.log(
    `  Том: ${range.startVolume}${
      range.endVolume ? `-${range.endVolume}` : " (до конца)"
    }`
  );
  console.log(
    `  Главы: ${range.startChapter}${
      range.endChapter ? `-${range.endChapter}` : " (до конца)"
    }`
  );

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  Начинаем скачивание...");
  console.log("═══════════════════════════════════════════════════════\n");

  try {
    await downloadBook(
      mangaId,
      mangaSlug,
      range.startVolume,
      range.startChapter,
      range.endVolume,
      range.endChapter
    );

    console.log("\n✓ Скачивание завершено успешно!");
  } catch (error) {
    console.error("\n✗ Ошибка при скачивании:", error.message);
    process.exit(1);
  }
}

// Запуск
main();
