/** 仅 server 引用：把可灵 / 豆包登记进适配器表。网页不要 import 这个文件。 */
import { registerAdapter } from "./index";
import { doubaoSeedance, kling } from "./video";

registerAdapter(kling);
registerAdapter(doubaoSeedance);
