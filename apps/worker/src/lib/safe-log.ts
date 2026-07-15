const URL_CREDENTIALS_PATTERN = /:\/\/[^/\s]+@/g;
const ABSOLUTE_PATH_PATTERN = /(?:\/[\w.-]+)+\/?/g;

export function sanitizeErrorMessage(message: string): string {
  return message
    .replace(URL_CREDENTIALS_PATTERN, "://***@")
    .replace(ABSOLUTE_PATH_PATTERN, (match) => {
      if (match.startsWith("/node_modules/")) return "[node_modules]/";
      return "[path]";
    });
}

export function formatSafeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const result: Record<string, unknown> = {
      name: error.name,
      message: sanitizeErrorMessage(error.message),
    };

    if (error !== null && typeof error === "object" && "code" in error) {
      const code = (error as { code: unknown }).code;
      if (typeof code === "string") {
        result.code = code;
      }
    }

    return result;
  }

  return {
    name: "UnknownError",
    message: sanitizeErrorMessage(String(error)),
  };
}
