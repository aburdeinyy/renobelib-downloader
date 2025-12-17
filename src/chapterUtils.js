/**
 * Преобразовать номер главы в число (поддержка дробных: 63.1 -> 63.1)
 */
export function parseChapterNumber(chapter) {
  if (typeof chapter === "number") return chapter;
  if (typeof chapter === "string") {
    const parsed = parseFloat(chapter);
    return isNaN(parsed) ? 1 : parsed;
  }
  return 1;
}

/**
 * Получить следующую целую главу
 */
export function getNextWholeChapter(currentChapter) {
  const num = parseChapterNumber(currentChapter);
  const wholePart = Number.isInteger(num) ? num : Math.floor(num);
  return wholePart + 1;
}

/**
 * Получить первую подглаву для целой главы
 */
export function getFirstSubChapter(wholeChapter) {
  const num = parseChapterNumber(wholeChapter);
  const wholePart = Number.isInteger(num) ? num : Math.floor(num);
  return parseFloat((wholePart + 0.1).toFixed(1));
}

/**
 * Получить следующую подглаву
 */
export function getNextSubChapter(currentSubChapter) {
  const num = parseChapterNumber(currentSubChapter);
  const wholePart = Math.floor(num);
  const decimalStr = num.toFixed(1).split(".")[1];
  const decimalPart = parseInt(decimalStr, 10);

  // Следующая подглава (3.2, 3.3...)
  const nextDecimal = decimalPart + 1;

  // Если следующая подглава >= 10, значит подглавы закончились
  if (nextDecimal >= 10) {
    return null; // Возвращаем null, чтобы показать, что подглавы закончились
  }

  return parseFloat((wholePart + nextDecimal / 10).toFixed(1));
}

/**
 * Сравнить номера глав (для проверки достижения конца диапазона)
 */
export function compareChapterNumbers(chapter1, chapter2) {
  const num1 = parseChapterNumber(chapter1);
  const num2 = parseChapterNumber(chapter2);
  return num1 - num2;
}
