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
        new_items = db.get_high_score_pending_l2(limit=config.L2_BATCH_SIZE)
        if not new_items:
            return 0

        print(f"L2: Processing {len(new_items)} new items...")
        
        # Prepare Top 20 context for deduplication
        recent_processed = db.get_recent_processed_news(hours=config.RANKING_WINDOW_HOURS)
        ranked_context = []
        for rp in recent_processed:
            g_score = calculate_gravity_score(rp['l2_score'], rp['published_at'], config.GRAVITY)
            ranked_context.append((rp, g_score))
        
        ranked_context.sort(key=lambda x: x[1], reverse=True)
        top_20_old_items = [x[0] for x in ranked_context[:20]]
        
        # Combine items
        all_batch_items = top_20_old_items + new_items
        
        # Prepare input with IDs and Tags
        news_list_str = ""
        for idx, item in enumerate(all_batch_items):
            is_new = "NEW" if item in new_items else f"OLD, Score: {item.get('l2_score', 0)}"
            news_list_str += f"- [ID: {item['id']}] [{is_new}] \"{item['title']}\" ({item['source_name']}) - {item['url']}\n"
            if item.get('l2_summary'):
                news_list_str += f"  Existing Summary: {item['l2_summary']}\n"

        system_prompt = self._load_prompt()
        user_prompt = f"News Items to Process:\n{news_list_str}\n\nPlease generate the output JSON feed."

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
            
            # Map back strategy: match by explicit ID
            processed_primary_ids = set()
            processed_merged_ids = set()
            
            for feed_item in feed_items:
                primary_id = feed_item.get('id')
                if not primary_id:
                    continue
                    
                optimized_title = feed_item.get('title_optimized')
                score = feed_item.get('score', 0)
                summary = feed_item.get('technical_summary')
                category = feed_item.get('category')
                
                merged_ids = feed_item.get('merged_ids', [])
                if isinstance(merged_ids, int):
                    merged_ids = [merged_ids]
                
                # Update the primary ID
                db.update_l2_result(primary_id, score, summary, optimized_title, category)
                processed_primary_ids.add(primary_id)
                print(f"  - L2 Primary {primary_id}: {optimized_title}")
                
                # Update any merged duplicates to score 0 (demoted/deleted)
                for mid in merged_ids:
                    if mid != primary_id:
                        db.update_l2_result(mid, 0, "Deduplicated/Merged", "", "")
                        processed_merged_ids.add(mid)
                        print(f"  - L2 Merged {mid} -> {primary_id}")

            # Mark any ignored NEW items as dropped so they don't loop
            for item in new_items:
                iid = item['id']
                if iid not in processed_primary_ids and iid not in processed_merged_ids:
                    print(f"  - L2 Dropped NEW {iid}: {item['title']}")
                    db.update_l2_result(iid, 0, "Dropped by AI", "", "")
                    
            # OLD items that are not primary and not merged are left alone!
            # They will naturally decay over time unless the AI decides they are completely invalid.

        except Exception as e:
            print(f"L2 Error: {e}")
            
        return len(new_items)

l2_scorer = L2Scorer()

