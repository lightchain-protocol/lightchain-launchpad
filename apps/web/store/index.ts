import { create } from "zustand";

type StateType = {
  nativePrice: number;
};

const useStore = create<StateType>(() => ({
  nativePrice: 2,
}));

export default useStore;
