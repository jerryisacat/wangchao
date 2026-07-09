import { parseSemanticDedupResponse } from "./semantic-dedup.js";

export function runSemanticDedupFixtures(): void {
  fixtureSameEventDuplicate();
  fixtureDifferentEventsNotDuplicate();
  fixtureMalformedJsonThrows();
  fixtureMissingIsDuplicateThrows();
}

function fixtureSameEventDuplicate(): void {
  const content = JSON.stringify({
    isDuplicate: true,
    duplicateEventId: "evt_abc123",
    confidence: 0.92,
    reason: "两篇报道描述同一发布事件",
  });

  const result = parseSemanticDedupResponse(content);

  if (result.duplicateEventId !== "evt_abc123") {
    throw new Error("Should detect duplicate.");
  }
  if (result.confidence !== 0.92) {
    throw new Error("Confidence should match.");
  }
}

function fixtureDifferentEventsNotDuplicate(): void {
  const content = JSON.stringify({
    isDuplicate: false,
    duplicateEventId: "",
    confidence: 0.1,
    reason: "标题相似但描述不同事件",
  });

  const result = parseSemanticDedupResponse(content);

  if (result.duplicateEventId !== null) {
    throw new Error("Should not detect duplicate.");
  }
}

function fixtureMalformedJsonThrows(): void {
  try {
    parseSemanticDedupResponse("not json");
    throw new Error("Malformed JSON should throw.");
  } catch {
    // expected
  }
}

function fixtureMissingIsDuplicateThrows(): void {
  try {
    parseSemanticDedupResponse(JSON.stringify({ confidence: 0.5 }));
    throw new Error("Missing isDuplicate should throw.");
  } catch {
    // expected
  }
}
