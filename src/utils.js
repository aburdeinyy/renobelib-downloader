import { CONFIG } from "./config.js";

/**
 * Случайная задержка между запросами
 */
export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Получить случайную задержку в диапазоне
 */
export function getRandomDelay() {
  // Для GitLab CI используем увеличенную задержку от 3 до 7 секунд
  if (process.env.GITLAB_CI === "true") {
    const gitlabDelayMin = 3000; // 3 секунды
    const gitlabDelayMax = 7000; // 7 секунд
    return (
      Math.floor(Math.random() * (gitlabDelayMax - gitlabDelayMin + 1)) +
      gitlabDelayMin
    );
  }

  // Для остальных случаев используем стандартную задержку
  return (
    Math.floor(Math.random() * (CONFIG.delayMax - CONFIG.delayMin + 1)) +
    CONFIG.delayMin
  );
}

/**
 * Проверка, запущен ли скрипт в CI окружении (GitHub Actions, GitLab CI и т.д.)
 */
export function isCI() {
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
export async function showLoader(duration, message = "Ожидание...") {
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
export function sanitizeFilename(filename) {
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
export function cleanHtmlContent(html) {
  if (!html) return "";

  // Некоторые главы могут приходить не строкой, а объектом/массивом
  let htmlStr;

  if (typeof html === "string") {
    htmlStr = html;
  } else if (Array.isArray(html)) {
    // Пытаемся собрать строку из массива блоков
    htmlStr = html
      .map((item) => {
        if (!item) return "";
        if (typeof item === "string") return item;
        if (typeof item.text === "string") return item.text;
        if (typeof item.content === "string") return item.content;
        return "";
      })
      .join("\n");
  } else if (typeof html === "object") {
    // Возможный формат: { content: "<p>...</p>" } или { text: "..." }
    if (typeof html.content === "string") {
      htmlStr = html.content;
    } else if (typeof html.text === "string") {
      htmlStr = html.text;
    } else {
      htmlStr = "";
    }
  } else {
    htmlStr = "";
  }

  if (!htmlStr) return "";

  // Извлекаем текст из параграфов, сохраняя структуру
  // Убираем атрибуты data-paragraph-index и другие
  let cleaned = htmlStr
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
