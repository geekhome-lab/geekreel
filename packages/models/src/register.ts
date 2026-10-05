/** 仅 server 引用：把可灵 / 豆包 / ComfyUI 登记进适配器表。网页不要 import 这个文件。 */
import { registerAdapter } from "./index";
import { comfyui } from "./comfyui";
import { doubaoSeedance, kling } from "./video";

registerAdapter(kling);
registerAdapter(doubaoSeedance);
registerAdapter(comfyui);
