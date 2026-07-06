from response_utils import parse_json_response


def test_l1_flat_items_shape():
    text = '{"items": [{"id": 1, "category": "模型发布", "score": 91, "context": null}]}'
    parsed, _ = parse_json_response(text)
    assert isinstance(parsed, dict)
    assert isinstance(parsed.get("items"), list)
    assert parsed["items"][0]["category"] == "模型发布"


def test_l2_flat_feed_new_field_names():
    text = '{"feed": [{"id": 123, "merged_ids": [124], "category": "infra", "title": "K8s 发布新版本", "score": 87, "summary": "修复调度边界条件。", "url": "https://example.com"}]}'
    parsed, _ = parse_json_response(text)
    assert isinstance(parsed, dict)
    assert parsed["feed"][0]["title"] == "K8s 发布新版本"
    assert parsed["feed"][0]["summary"] == "修复调度边界条件。"


if __name__ == "__main__":
    test_l1_flat_items_shape()
    test_l2_flat_feed_new_field_names()
    print("schema tests ok")
