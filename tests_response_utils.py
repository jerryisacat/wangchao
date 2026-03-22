from response_utils import parse_json_response


def test_parse_prefers_last_valid_json_object():
    text = '''
I should return JSON.
{
  "AI_Algorithms": [],
  "Aerospace_HardTech": [],
  "Major_Industry_Moves": []
}
Final output:
{"AI_Algorithms": [{"id": 1, "title": "A", "score": 90, "context": null}], "Aerospace_HardTech": [], "Major_Industry_Moves": []}
'''
    parsed, cleaned = parse_json_response(text)
    assert isinstance(parsed, dict)
    assert parsed["AI_Algorithms"][0]["id"] == 1


def test_parse_single_valid_json_still_works():
    text = '{"AI_Algorithms": [], "Aerospace_HardTech": [], "Major_Industry_Moves": []}'
    parsed, cleaned = parse_json_response(text)
    assert isinstance(parsed, dict)
    assert parsed["AI_Algorithms"] == []


def test_strip_thinking_tags_before_parsing():
    text = '''
<thinking>
{"AI_Algorithms": [], "Aerospace_HardTech": [], "Major_Industry_Moves": []}
</thinking>
{"AI_Algorithms": [{"id": 2, "title": "B", "score": 88, "context": null}], "Aerospace_HardTech": [], "Major_Industry_Moves": []}
'''
    parsed, cleaned = parse_json_response(text)
    assert isinstance(parsed, dict)
    assert parsed["AI_Algorithms"][0]["id"] == 2


if __name__ == "__main__":
    test_parse_prefers_last_valid_json_object()
    test_parse_single_valid_json_still_works()
    test_strip_thinking_tags_before_parsing()
    print("tests ok")
