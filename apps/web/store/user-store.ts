import { create } from "zustand";
import { persist } from "zustand/middleware";

type StateType = {
  slippageTolerance: number;
  txDeadline: number;
};

const useUserStore = create<StateType>()(
  persist(
    () => ({
      slippageTolerance: 0.5,
      txDeadline: 20,
    }),
    { name: "user" }
  )
);

export default useUserStore;
