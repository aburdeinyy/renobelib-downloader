import fs from "fs";
import path from "path";
import { createRequire } from "module";
import readline from "readline";
import { CONFIG } from "./config.js";
import {
  delay,
  getRandomDelay,
  showLoader,
  sanitizeFilename,
} from "./utils.js";
import { parseChapterNumber, compareChapterNumbers } from "./chapterUtils.js";
import { fetchChapter, fetchChaptersList, fetchCover } from "./api.js";
import { parseBookUrl, parseChapterRange } from "./parser.js";

const require = createRequire(import.meta.url);
const generate = require("epub-gen");

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
  const startChapterDisplay = Number.isInteger(startChapter)
    ? startChapter.toString()
    : startChapter.toFixed(1);
  const endChapterDisplay = endChapter
    ? Number.isInteger(endChapter)
      ? endChapter.toString()
      : endChapter.toFixed(1)
    : "до конца";
  console.log(
    `Диапазон: volume ${startVolume}-${
      endVolume || startVolume
    }, chapters ${startChapterDisplay}-${endChapterDisplay}`
  );

  console.log("Получение списка глав книги...");
  // Получаем список всех глав книги
  const allChapters = await fetchChaptersList(mangaId, mangaSlug);

  if (!allChapters.length) {
    console.error("Не удалось получить список глав книги!");
    return;
  }

  console.log(`Всего глав в книге (по API): ${allChapters.length}`);

  // Сортируем главы по тому и номеру
  const sortedChapters = [...allChapters].sort((a, b) => {
    if (a.volume !== b.volume) {
      return a.volume - b.volume;
    }

    const numA = parseChapterNumber(a.number);
    const numB = parseChapterNumber(b.number);
    return numA - numB;
  });

  // Фильтруем по диапазону
  const chaptersToDownload = sortedChapters.filter((chapter) => {
    const vol = chapter.volume;
    const num = parseChapterNumber(chapter.number);

    // Фильтрация по началу диапазона
    if (vol < startVolume) {
      return false;
    }
    if (vol === startVolume && compareChapterNumbers(num, startChapter) < 0) {
      return false;
    }

    // Если конец диапазона не задан — берём все главы до конца
    if (!endVolume || !endChapter) {
      return true;
    }

    // Фильтрация по концу диапазона
    if (vol > endVolume) {
      return false;
    }
    if (vol === endVolume && compareChapterNumbers(num, endChapter) > 0) {
      return false;
    }

    return true;
  });

  if (!chaptersToDownload.length) {
    console.error("По заданному диапазону не найдено ни одной главы!");
    return;
  }

  console.log(`Глав для скачивания по диапазону: ${chaptersToDownload.length}`);

  const chapters = [];

  // Создаем директорию для вывода
  if (!fs.existsSync(CONFIG.outputDir)) {
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
  }

  for (const chapterMeta of chaptersToDownload) {
    try {
      const chapter = await fetchChapter(
        mangaId,
        chapterMeta.volume,
        chapterMeta.number
      );

      const isFirstChapter = chapters.length === 0;

      chapters.push({
        title: chapter.title,
        data: chapter.content,
        beforeToc: isFirstChapter,
      });

      console.log(
        `✓ Скачана: том ${chapterMeta.volume}, глава ${chapterMeta.number} – ${chapter.title}`
      );

      const delayTime = getRandomDelay();
      const chapterDisplay = Number.isInteger(chapterMeta.number)
        ? chapterMeta.number.toString()
        : parseChapterNumber(chapterMeta.number).toString();
      const nextChapterInfo = `Скачивание следующей главы... (том ${chapterMeta.volume}, глава ${chapterDisplay})`;
      await showLoader(delayTime, nextChapterInfo);
    } catch (error) {
      console.warn(
        `⚠ Не удалось скачать главу том ${chapterMeta.volume}, номер ${chapterMeta.number}: ${error.message}`
      );
      // Небольшая пауза даже при ошибке, чтобы не спамить API
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

  console.log(`\nПараметры скачивания:`);
  console.log(
    `  Том: ${range.startVolume}${
      range.endVolume ? `-${range.endVolume}` : " (до конца)"
    }`
  );
  const startChapterDisplay = Number.isInteger(range.startChapter)
    ? range.startChapter.toString()
    : range.startChapter.toFixed(1);
  const endChapterDisplay = range.endChapter
    ? Number.isInteger(range.endChapter)
      ? range.endChapter.toString()
      : range.endChapter.toFixed(1)
    : " (до конца)";
  console.log(
    `  Главы: ${startChapterDisplay}${
      range.endChapter ? `-${endChapterDisplay}` : " (до конца)"
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
