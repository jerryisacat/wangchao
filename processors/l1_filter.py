import os
from config import config
from database import db
from ai_service import ai_service
from response_utils import best_title_match, parse_json_response, sanitize_text

class L1Filter:
    def __init__(self):
        self.profile_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'prompts', 'user_profile.md')
        self.rules_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'prompts', 'l1_rules.md')
        self.model = config.AI_MODEL_L1

    def _load_prompt(self) -> str:
        with open(self.profile_path, 'r', encoding='utf-8') as f1:
            profile = f1.read()
        with open(self.rules_path, 'r', encoding='utf-8') as f2:
            rules = f2.read()
        return f"{profile}\n\n{rules}"

    def process_pending(self, batch_size: int = config.L1_BATCH_SIZE) -> int:
        items = db.get_pending_news(limit=batch_size)
        if not items:
            return 0

        print(f"L1: Processing {len(items)} items...")
        
        # Prepare input for AI
        news_list_str = ""
        id_map = {} # Map temporary ID to DB ID
        
        import time # Ensure time is imported
        
        for idx, item in enumerate(items):
            temp_id = idx + 1
            id_map[temp_id] = item['id']
            
            # Calculate readable time
            pub_time = item.get('published_at', time.time())
            diff_seconds = int(time.time() - pub_time)
            hours = diff_seconds // 3600
            minutes = (diff_seconds % 3600) // 60
            time_str = f"{hours} hours {minutes} minutes ago" if hours > 0 else f"{minutes} minutes ago"
            
            # Trim summary to save tokens (e.g., max 500 chars)
            summary_snippet = (item.get('summary') or '')[:500]
            if len(item.get('summary') or '') > 500:
                summary_snippet += "..."
                
            news_list_str += f"{temp_id}. {item['title']} ({item['source_name']}) - Published: {time_str}\n"
            if summary_snippet:
                # Remove newlines to keep it compact
                summary_snippet = " ".join(summary_snippet.split())
                news_list_str += f"   Snippet: {summary_snippet}\n"

        # Construct Prompt
        system_prompt = self._load_prompt()
        user_prompt = f"Here is the list of news items to filter:\n\n{news_list_str}\n\nPlease output the JSON object as specified."

        # Call AI
        response_text = ai_service.chat_completion(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            model=self.model,
            response_format={"type": "json_object"}
        )

        if not response_text:
            print("L1: No response from AI.")
            return

        try:
            data, clean_json = parse_json_response(response_text)
            if not isinstance(data, dict):
                print(f"L1: Failed to parse JSON: {response_text}")
                return len(items)

            processed_titles = set()

            def update_item(item_data, category):
                if not isinstance(item_data, dict):
                    return

                title = sanitize_text(item_data.get('title'))
                raw_score = item_data.get('score', 0)
                context = sanitize_text(item_data.get('context'))

                try:
                    score = int(raw_score)
                except (TypeError, ValueError):
                    score = 0

                matched_item, match_score = best_title_match(title, items)
                if not matched_item:
                    print(f"  - Skip unmatched L1 item: {title!r}")
                    return

                matched_id = matched_item['id']
                processed_titles.add(matched_id)
                status = 'l1_done' if score >= 70 else 'filtered'
                reason = f"Category: {category}. Context: {context or 'N/A'}"
                db.update_l1_result(matched_id, score, reason, status)
                print(f"  - Update {matched_id}: Score {score} ({status}) [match={match_score:.2f}]")

            for category in ["AI_Algorithms", "Aerospace_HardTech", "Major_Industry_Moves"]:
                category_items = data.get(category, [])
                if isinstance(category_items, list):
                    for item_data in category_items:
                        update_item(item_data, category)

            for item in items:
                if item['id'] not in processed_titles:
                    db.update_l1_result(item['id'], 0, "Implicitly filtered by AI (Low Score)", "filtered")

        except Exception as e:
            print(f"L1: Processing Error: {e}")
            
        return len(items)

l1_filter = L1Filter()
