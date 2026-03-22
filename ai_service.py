import time

from openai import OpenAI
from config import config
from response_utils import extract_text_response


class AIService:
    def __init__(self):
        self.client = OpenAI(
            base_url=config.AI_BASE_URL,
            api_key=config.AI_API_KEY,
            timeout=config.AI_TIMEOUT_SECONDS,
        )

    def _request_once(self, messages, model, response_format=None):
        kwargs = {
            "model": model,
            "messages": messages,
        }
        if response_format:
            # Support for JSON mode if API supports it, or just prompt.
            # Some OpenAI-compatible APIs/models silently ignore it or return
            # non-standard envelopes, so extraction must stay defensive.
            kwargs["response_format"] = response_format

        response = self.client.chat.completions.create(**kwargs)
        text = extract_text_response(response)
        if not text:
            print(f"AI Service Warning: Empty/unsupported response shape: {type(response).__name__}")
        return text

    def chat_completion(self, messages, model, response_format=None):
        attempts = max(1, config.AI_MAX_RETRIES)
        last_error = None

        for attempt in range(1, attempts + 1):
            try:
                text = self._request_once(messages=messages, model=model, response_format=response_format)
                if text:
                    if attempt > 1:
                        print(f"AI Service: succeeded on retry {attempt}/{attempts}")
                    return text
                last_error = "empty response"
            except Exception as e:
                last_error = str(e)
                print(f"AI Service Error (attempt {attempt}/{attempts}): {e}")

            if attempt < attempts:
                time.sleep(config.AI_RETRY_DELAY_SECONDS)

        print(f"AI Service Error: exhausted retries ({last_error})")
        return None


ai_service = AIService()
