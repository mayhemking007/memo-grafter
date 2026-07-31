import { runSmokeTests } from "../helpers/runner.js";
import { basicChatSmoke } from "./basic-chat.js";

await runSmokeTests([basicChatSmoke]);
