import { useEffect, RefObject } from "react";

export const useScrollToBottom = (
  ref: RefObject<HTMLDivElement | null>,
  dependency: unknown,
): void => {
  useEffect(() => {
    requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ behavior: "auto", block: "end" });
    });
  }, [ref, dependency]);
};
