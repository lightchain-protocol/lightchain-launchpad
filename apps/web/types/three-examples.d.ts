declare module "three/examples/jsm/postprocessing/UnrealBloomPass.js" {
  import { Vector2 } from "three";
  import { Pass } from "three/examples/jsm/postprocessing/Pass.js";

  export class UnrealBloomPass extends Pass {
    constructor(resolution: Vector2, strength?: number, radius?: number, threshold?: number);
    strength: number;
    radius: number;
    threshold: number;
    setSize(width: number, height: number): void;
  }
}
