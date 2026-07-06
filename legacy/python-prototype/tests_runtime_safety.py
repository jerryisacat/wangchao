import os
import tempfile
from pathlib import Path


def test_database_creates_parent_directory_from_config():
    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "nested" / "news.db"
        os.environ["DB_PATH"] = str(db_path)

        from config import AppConfig
        from database import Database

        assert AppConfig().DB_PATH == str(db_path)
        Database(str(db_path))
        assert db_path.exists()


def test_run_bounded_batches_stops_at_configured_loop_limit():
    from main import run_bounded_batches

    calls = []

    def process_batch():
        calls.append("called")
        return 3

    processed = run_bounded_batches("Test", process_batch, max_loops=2)

    assert processed == 6
    assert len(calls) == 2


def test_run_bounded_batches_stops_when_no_work_remains():
    from main import run_bounded_batches

    results = [2, 0, 99]

    def process_batch():
        return results.pop(0)

    processed = run_bounded_batches("Test", process_batch, max_loops=5)

    assert processed == 2
    assert results == [99]


def test_recent_processed_news_excludes_zero_score_merged_items():
    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "news.db"

        from database import Database

        db = Database(str(db_path))
        assert db.add_news("https://example.com/primary", "Primary", "Test", 4102444800, "")
        assert db.add_news("https://example.com/merged", "Merged", "Test", 4102444800, "")
        db.update_l2_result(1, 91, "Important", "重要新闻", "AI")
        db.update_l2_result(2, 0, "Deduplicated/Merged", "", "")

        items = db.get_recent_processed_news(hours=24 * 365 * 20)

        assert [item["url"] for item in items] == ["https://example.com/primary"]


def test_frontend_escapes_dynamic_news_fields():
    html = Path("index.html").read_text(encoding="utf-8")

    assert "function escapeHtml" in html
    assert "escapeHtml(item.l2_title_zh || item.title)" in html
    assert "escapeHtml(item.l2_summary || item.l1_reason)" in html
    assert "escapeHtml(categoryDisplay)" in html
    assert "escapeHtml(item.source_name)" in html


if __name__ == "__main__":
    test_database_creates_parent_directory_from_config()
    test_run_bounded_batches_stops_at_configured_loop_limit()
    test_run_bounded_batches_stops_when_no_work_remains()
    test_recent_processed_news_excludes_zero_score_merged_items()
    test_frontend_escapes_dynamic_news_fields()
    print("runtime safety tests ok")
