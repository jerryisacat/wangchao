"use client";

import { Trash2 } from "lucide-react";
import { useTransition } from "react";
import { deleteTopicAction } from "@/app/actions";
import { Button } from "@/components/ui/button";

interface DeleteTopicButtonProps {
  topicId: string;
  topicName: string;
}

export function DeleteTopicButton({ topicId, topicName }: DeleteTopicButtonProps) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      size="sm"
      variant="danger"
      disabled={pending}
      onClick={() => {
        if (
          confirm(
            `确定要删除主题「${topicName}」吗？所有关联的信源、情报、简报和偏好将被永久删除。`,
          )
        ) {
          startTransition(() => {
            const formData = new FormData();
            formData.set("topicId", topicId);
            deleteTopicAction(formData);
          });
        }
      }}
    >
      <Trash2 aria-hidden="true" size={14} />
      <span>删除</span>
    </Button>
  );
}
