import axios from "axios";
import fs from "fs";
import path from "path";
import { CONFIG } from "./config.js";
import { sanitizeFilename, cleanHtmlContent } from "./utils.js";

/**
 * Получить список глав книги по API
 */
export async function fetchChaptersList(mangaId, mangaSlug) {
  try {
    const slugPart = mangaSlug ? `--${mangaSlug}` : "";
    const url = `${CONFIG.baseUrl}/${mangaId}${slugPart}/chapters`;

    const response = await axios.get(url);

    if (!response.data || !Array.isArray(response.data.data)) {
      throw new Error("Неверный формат ответа API списка глав");
    }

    return response.data.data.map((item) => {
      const volumeNum = parseInt(item.volume, 10);

      return {
        id: item.id,
        index: item.index ?? item.item_number ?? 0,
        volume: Number.isNaN(volumeNum) ? 1 : volumeNum,
        number: item.number,
        title: item.name || `Том ${item.volume}, глава ${item.number}`,
      };
    });
  } catch (error) {
    console.error(
      `Ошибка при получении списка глав манги ${mangaId}:`,
      error.message
    );
    throw error;
  }
}

/**
 * Получить главу по API
 */
export async function fetchChapter(mangaId, volume, number) {
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
 * Получить и скачать обложку книги
 */
export async function fetchCover(mangaId, mangaSlug) {
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
