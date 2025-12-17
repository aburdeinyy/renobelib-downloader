import { sanitizeFilename } from "./utils.js";
import { parseChapterNumber } from "./chapterUtils.js";

/**
 * Парсинг URL книги ranobelib.me
 */
export function parseBookUrl(url) {
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
 * Парсинг диапазона глав
 */
export function parseChapterRange(rangeStr) {
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
    // Новый упрощенный формат: "1" или "1-150" или "63.1-63.5" (только номера глав, том 1 по умолчанию)
    const parts = rangeStr.split("-");

    if (parts.length === 1) {
      // Только одна глава: "1" или "63.1"
      const chapterNum = parseChapterNumber(parts[0].trim());
      return {
        startVolume: 1,
        startChapter: chapterNum,
        endVolume: null,
        endChapter: null,
      };
    } else {
      // Диапазон глав: "1-150" или "63.1-63.5"
      const startChapter = parseChapterNumber(parts[0].trim());
      const endChapter = parseChapterNumber(parts[1].trim());
      return {
        startVolume: 1,
        startChapter: startChapter,
        endVolume: 1,
        endChapter: endChapter,
      };
    }
  } else {
    // Старый формат: "1:1" или "1:1-1:5" или "1:1-5" или "1:63.1-1:63.5" (том:глава или том:глава-том:глава)
    const parts = rangeStr.split("-");

    if (parts.length === 1) {
      // Только начальная глава: "1:1" или "1:63.1"
      const startParts = parts[0].split(":");
      const startVolume = parseInt(startParts[0].trim()) || 1;
      const startChapter = parseChapterNumber(startParts[1]?.trim() || "1");
      return {
        startVolume: startVolume,
        startChapter: startChapter,
        endVolume: null,
        endChapter: null,
      };
    } else {
      // Диапазон: "1:1-1:5" или "1:1-5" или "1:63.1-1:63.5"
      const startParts = parts[0].split(":");
      const endParts = parts[1].split(":");

      const startVolume = parseInt(startParts[0].trim()) || 1;
      const startChapter = parseChapterNumber(startParts[1]?.trim() || "1");

      // Если в конце только одно число, это номер главы в том же томе
      if (endParts.length === 1) {
        const endChapter = parseChapterNumber(endParts[0].trim());
        return {
          startVolume: startVolume,
          startChapter: startChapter,
          endVolume: startVolume,
          endChapter: endChapter,
        };
      } else {
        // Полный формат: том:глава-том:глава
        const endVolume = parseInt(endParts[0].trim()) || startVolume;
        const endChapter = parseChapterNumber(endParts[1]?.trim() || "1");
        return {
          startVolume: startVolume,
          startChapter: startChapter,
          endVolume: endVolume,
          endChapter: endChapter,
        };
      }
    }
  }
}
