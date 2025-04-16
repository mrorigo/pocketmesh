import { createQaFlow } from "./flow";
import { FlowStepper } from "../stepper";
import { SharedState } from "../index";

interface QASharedState extends SharedState {
  question?: string;
  answer?: string;
}

async function main() {
  // Start a new run
  const shared: QASharedState = {};
  const stepper = new FlowStepper(
    {
      flowName: "qa-demo",
      flowFactory: createQaFlow,
    },
    shared,
    { model: "gpt-4o-mini" },
  );

  let done = false;
  while (!done) {
    const { nodeName, action, done: isDone } = await stepper.step();
    console.log(
      `Stepped node: ${nodeName}, action: ${action}, done: ${isDone}`,
    );
    console.log("Current shared state:", stepper.getSharedState());
    done = isDone;
  }

  console.log("Flow completed. Run ID:", stepper.getRunId());
}

main().catch((err) => {
  console.error("Stepper demo error:", err);
  process.exit(1);
});
