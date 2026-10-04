import type { ComponentType } from "react";
import { Step1, Step2, Step3 } from "./Frame";
import { Step4, Step5, Step6, Step7 } from "./Gather";
import { Step8, Step9, Step10, Step11, Step12 } from "./Conclude";

export const STEP_VIEWS: Record<number, { View: ComponentType }> = {
  1: { View: Step1 }, 2: { View: Step2 }, 3: { View: Step3 }, 4: { View: Step4 }, 5: { View: Step5 }, 6: { View: Step6 },
  7: { View: Step7 }, 8: { View: Step8 }, 9: { View: Step9 }, 10: { View: Step10 }, 11: { View: Step11 }, 12: { View: Step12 },
};
