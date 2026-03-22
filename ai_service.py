import time
from typing import Any

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

    def _preview(self, value: Any, limit: int = 200) -> str:
        if value is None:
            return "None"
        text = str(value)
        text = text.replace("\n", "\\n")
        return text[:limit] + ("..." if len(text) > limit else "")

    def _describe_response_shape(self, response: Any) -> str:
        parts = [f"type={type(response).__name__}"]
        choices = getattr(response, "choices", None)
        if not choices and isinstance(response, dict):
            choices = response.get("choices")

        if choices:
            parts.append(f"choices={len(choices)}")
            choice = choices[0]
            message = getattr(choice, "message", None)
            if message is None and isinstance(choice, dict):
                message = choice.get("message")

            content = None
            reasoning = None
            refusal = None
            if message is not None:
                content = getattr(message, "content", None)
                reasoning = getattr(message, "reasoning_content", None)
                refusal = getattr(message, "refusal", None)
                if isinstance(message, dict):
                    content = message.get("content")
                    reasoning = message.get("reasoning_content")
                    refusal = message.get("refusal")

            choice_text = getattr(choice, "text", None)
            if choice_text is None and isinstance(choice, dict):
                choice_text = choice.get("text")

            parts.append(f"message.content.type={type(content).__name__}")
            parts.append(f"message.content.preview={self._preview(content)}")
            if isinstance(content, list):
                for idx, part in enumerate(content[:3]):
                    parts.append(f"message.content[{idx}].type={type(part).__name__}")
                    parts.append(f"message.content[{idx}].preview={self._preview(part)}")

            parts.append(f"message.reasoning_content.type={type(reasoning).__name__}")
            parts.append(f"message.reasoning_content.preview={self._preview(reasoning)}")
            parts.append(f"message.refusal.preview={self._preview(refusal)}")
            parts.append(f"choice.text.preview={self._preview(choice_text)}")

        output_text = getattr(response, "output_text", None)
        if output_text is None and isinstance(response, dict):
            output_text = response.get("output_text")
        parts.append(f"response.output_text.preview={self._preview(output_text)}")
        return " | ".join(parts)

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
            print("AI Service Warning: Empty/unsupported response shape")
            print(f"AI Service Debug: {self._describe_response_shape(response)}")
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
