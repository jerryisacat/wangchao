from openai import OpenAI
from config import config
from response_utils import extract_text_response


class AIService:
    def __init__(self):
        self.client = OpenAI(
            base_url=config.AI_BASE_URL,
            api_key=config.AI_API_KEY
        )

    def chat_completion(self, messages, model, response_format=None):
        try:
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
        except Exception as e:
            print(f"AI Service Error: {e}")
            return None


ai_service = AIService()
