import { createContext, useContext } from "react";

export const TransitionContext = createContext<{ go: (path: string) => void }>({
  go: () => {},
});

export function useTransition() {
  return useContext(TransitionContext);
}
