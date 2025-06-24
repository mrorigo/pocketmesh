import { Flow, BaseNode, SharedState, Params, ActionResult } from "../index";

// Define shared state for QA flow
export interface QASharedState extends SharedState {
  question?: string;
  answer?: string;
}

// Node: GetQuestionNode
export class GetQuestionNode extends BaseNode<QASharedState> {
  async prepare(_shared: QASharedState, _params: Params): Promise<void> {
    // No preparation needed for this node
    return;
  }
  async execute(
    _prep: void,
    _shared: SharedState,
    _runtimeParams: Params,
    _attemptIndex?: number,
  ): Promise<string> {
    // For demo, just return a fixed question
    const userQuestion = "What is TypeScript PocketMesh?";
    console.log(`Node: GetQuestion - Input: "${userQuestion}"`);
    return userQuestion;
  }
  async finalize(
    shared: QASharedState,
    _prep: void,
    execResult: string,
    _runtimeParams: Params,
  ): Promise<ActionResult> {
    shared.question = execResult;
    return null;
  }
}

// Node: AnswerNode (mocked for demo)
export class AnswerNode extends BaseNode<
  QASharedState,
  Params,
  string,
  string
> {
  async prepare(
    shared: QASharedState,
    _runtimeParams: Params,
  ): Promise<string> {
    const question = shared.question ?? "No question provided";
    console.log(`Node: Answer - Prepare received question: "${question}"`);
    return question;
  }
  async execute(
    question: string,
    _shared: SharedState,
    _runtimeParams: Params,
    attemptIndex?: number,
  ): Promise<string> {
    // For demo, just return a canned answer
    console.log(
      `Node: Answer - Executing (Attempt ${attemptIndex! + 1}) for: "${question}"`,
    );
    return `PocketMesh is a TypeScript framework for agentic workflows. (Demo answer)`;
  }
  async finalize(
    shared: QASharedState,
    _prep: string,
    execResult: string,
    _runtimeParams: Params,
  ): Promise<ActionResult> {
    console.log(
      `Node: Answer - Finalize received answer: "${execResult.substring(0, 50)}..."`,
    );
    shared.answer = execResult;
    return null;
  }
}

// Flow factory
export function createQaFlow(): Flow<QASharedState, Params, GetQuestionNode> {
  const getQuestion = new GetQuestionNode();
  const answer = new AnswerNode();

  getQuestion.connectTo(answer);

  return new Flow(getQuestion);
}
