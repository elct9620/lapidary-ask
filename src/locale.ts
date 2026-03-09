type MessageKey =
  | "invalidFeedback"
  | "onlyAskerCanRate"
  | "llmProcessingFailed"
  | "postResponseFailed";

const messages: Record<string, Partial<Record<MessageKey, string>>> = {
  "zh-TW": {
    invalidFeedback: "無效的回饋操作。",
    onlyAskerCanRate: "只有提問者可以評分。",
    llmProcessingFailed: "LLM 處理失敗，請稍後再試。",
    postResponseFailed: "回覆發送失敗，請稍後再試。",
  },
  "zh-CN": {
    invalidFeedback: "无效的反馈操作。",
    onlyAskerCanRate: "只有提问者可以评分。",
    llmProcessingFailed: "LLM 处理失败，请稍后再试。",
    postResponseFailed: "回复发送失败，请稍后再试。",
  },
  ja: {
    invalidFeedback: "無効なフィードバック操作です。",
    onlyAskerCanRate: "質問者のみ評価できます。",
    llmProcessingFailed:
      "LLM の処理に失敗しました。後でもう一度お試しください。",
    postResponseFailed:
      "応答の送信に失敗しました。後でもう一度お試しください。",
  },
  en: {
    invalidFeedback: "Invalid feedback action.",
    onlyAskerCanRate: "Only the asker can rate.",
    llmProcessingFailed: "LLM processing failed. Please try again later.",
    postResponseFailed: "Failed to post response. Please try again later.",
  },
};

const DEFAULT_LOCALE = "zh-TW";

function resolveLocale(locale: string): string {
  if (locale in messages) return locale;
  if (locale.startsWith("zh")) return "zh-TW";
  if (locale.startsWith("ja")) return "ja";
  if (locale.startsWith("en")) return "en";
  return DEFAULT_LOCALE;
}

export function t(key: MessageKey, locale: string): string {
  const resolved = resolveLocale(locale);
  return messages[resolved]?.[key] ?? messages[DEFAULT_LOCALE]![key]!;
}
