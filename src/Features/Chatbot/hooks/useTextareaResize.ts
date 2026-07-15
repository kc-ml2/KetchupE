import { useEffect, RefObject } from "react";

export const useTextareaResize = (
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  value: string,
): void => {
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [value, textareaRef]);
};
