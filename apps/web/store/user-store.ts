import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  clampDeadline,
  clampSlippage,
  DEADLINE_DEFAULT,
  SLIPPAGE_DEFAULT,
} from "@/lib/utils";

type StateType = {
  slippageTolerance: number;
  txDeadline: number;
  setSlippageTolerance: (value: number) => void;
  setTxDeadline: (value: number) => void;
};

const useUserStore = create<StateType>()(
  persist(
    (set) => ({
      slippageTolerance: SLIPPAGE_DEFAULT,
      txDeadline: DEADLINE_DEFAULT,
      setSlippageTolerance: (value) => set({ slippageTolerance: clampSlippage(value) }),
      setTxDeadline: (value) => set({ txDeadline: clampDeadline(value) }),
    }),
    {
      name: "user",
      // Values persisted before these clamps existed — or hand-edited — must not
      // reach the BigInt math in `applySlippage` / `deadlineFromNow`. Re-clamp on
      // every rehydrate; the setters only guard new writes.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<StateType>;
        return {
          ...current,
          slippageTolerance: clampSlippage(p.slippageTolerance),
          txDeadline: clampDeadline(p.txDeadline),
        };
      },
    }
  )
);

export default useUserStore;
