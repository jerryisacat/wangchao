import { toUserActionError } from "../src/app/actions/_shared.ts";

function expect(label, actual, expectedSubstring) {
  if (!actual.includes(expectedSubstring)) {
    throw new Error(
      `${label}: expected "${actual}" to include "${expectedSubstring}".`,
    );
  }
}

expect(
  "topic quota",
  toUserActionError(new Error("Topic limit reached (1/1).")),
  "已达当前套餐的主题数量上限（1/1）",
);
expect(
  "source quota",
  toUserActionError(new Error("Source limit reached (3/3).")),
  "已达当前套餐的信源数量上限（3/3）",
);
expect(
  "generic quota",
  toUserActionError(new Error("Topic limit reached.")),
  "已达当前套餐的使用上限",
);
expect(
  "unauthorized",
  toUserActionError(new Error("User is not authorized for this organization.")),
  "当前账号无权执行此操作",
);
expect(
  "not found",
  toUserActionError(new Error("Topic not found in this workspace.")),
  "操作的对象不存在或已不属于当前工作区",
);
expect(
  "unauthenticated",
  toUserActionError(new Error("UNAUTHENTICATED")),
  "登录状态已失效",
);
expect(
  "database connection not misread as required",
  toUserActionError(new Error("Database connection is required to create topics.")),
  "数据库连接未就绪",
);
expect(
  "required field",
  toUserActionError(new Error("topicName is required.")),
  "请补全必填内容后再提交。",
);
const uniqueError = new Error(
  "Unique constraint failed on the fields: (organizationId, name)",
);
uniqueError.code = "P2002";
expect(
  "unique constraint",
  toUserActionError(uniqueError),
  "该名称或地址已存在",
);
expect(
  "fallback keeps detail",
  toUserActionError(new Error("SomeUnexpectedFailureModeOccurred")),
  "SomeUnexpectedFailureModeOccurred",
);
expect(
  "fallback points to logs",
  toUserActionError(new Error("SomeUnexpectedFailureModeOccurred")),
  "查看服务器日志",
);
