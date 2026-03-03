import json
import os
from config import config
from database import db
from ai_service import ai_service
from ranking import calculate_gravity_score

class L2Scorer:
    def __init__(self):
        self.prompt_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'prompts', 'l2.md')
        self.model = config.AI_MODEL_L2

    def _load_prompt(self) -> str:
        with open(self.prompt_path, 'r', encoding='utf-8') as f:
            return f.read()

    def process_l1_passed(self):
        # Items that passed L1 but pending L2
        items = db.get_high_score_pending_l2(limit=config.L2_BATCH_SIZE)
        if not items:
            return 0

        print(f"L2: Processing {len(items)} items...")
        
        # Prepare Top 20 context for deduplication
        recent_processed = db.get_recent_processed_news(hours=config.RANKING_WINDOW_HOURS)
        ranked_context = []
        for rp in recent_processed:
            g_score = calculate_gravity_score(rp['l2_score'], rp['published_at'], config.GRAVITY)
            ranked_context.append((rp, g_score))
        
        ranked_context.sort(key=lambda x: x[1], reverse=True)
        top_20_context = [x[0] for x in ranked_context[:20]]
        
        context_str = ""
        for idx, item in enumerate(top_20_context):
            title = item.get('l2_title_zh') or item.get('title')
            score = item.get('l2_score', 0)
            context_str += f"{idx+1}. [{score}] \"{title}\" - {item['url']}\n"
            if item.get('l2_summary'):
                context_str += f"   Summary: {item['l2_summary']}\n"
        
        if not context_str:
            context_str = "None\n"

        # Prepare new items input
        news_list_str = ""
        for idx, item in enumerate(items):
            # Include URL so AI can return it in the JSON
            news_list_str += f"{idx+1}. \"{item['title']}\" ({item['source_name']}) - {item['url']}\n"

        system_prompt = self._load_prompt()
        user_prompt = f"Current Top News (For Deduplication):\n{context_str}\n\nNew Items to Process:\n{news_list_str}\n\nPlease generate the output JSON feed for the 'New Items to Process'."

        response_text = ai_service.chat_completion(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            model=self.model,
            response_format={"type": "json_object"}
        )

        if not response_text:
            print("L2: No response.")
            return

        try:
            clean_json = response_text.replace("```json", "").replace("```", "").strip()
            data = json.loads(clean_json)
            
            feed_items = data.get('feed', [])
            
            # Map back strategy: match by Title or URL. URL is safest.
            processed_urls = set()
            
            for feed_item in feed_items:
                optimized_title = feed_item.get('title_optimized')
                score = feed_item.get('score', 0)
                summary = feed_item.get('technical_summary')
                category = feed_item.get('category')
                
                # We need to find which original item this corresponds to.
                # The AI might have merged items (Deduplication).
                # "Group multiple articles about the same event."
                # If it merged, we might lose track of which specific ID it was.
                # But typically we want to update the DB record.
                # If it merges, we should pick one "representative" ID to update and mark others as "merged_out" or similar?
                # For simplicity, let's assume it picks one.
                
                # We'll try to match by similarity or just loop and see if url matches.
                # The AI output includes "url".
                out_url = feed_item.get('url')
                
                matched_id = None
                if out_url:
                    for item in items:
                        if item['url'] == out_url:
                            matched_id = item['id']
                            processed_urls.add(out_url)
                            break
                
                # If ID found
                if matched_id:
                    db.update_l2_result(matched_id, score, summary, optimized_title, category)
                    print(f"  - L2 Done {matched_id}: {optimized_title}")
                else:
                    print(f"  - Warning: Could not match L2 output to DB: {optimized_title} (URL: {out_url})")

            # Mark omitted items as processed (score 0) so they don't get stuck in l1_done status
            for item in items:
                if item['url'] not in processed_urls:
                    print(f"  - L2 Deduplicated/Dropped {item['id']}: {item['title']}")
                    db.update_l2_result(item['id'], 0, "Duplicate or Filtered", "", "")

        except Exception as e:
            print(f"L2 Error: {e}")
            
        return len(items)

l2_scorer = L2Scorer()

