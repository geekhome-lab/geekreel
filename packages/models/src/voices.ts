export type VoiceTag = "青年女声" | "青年男声" | "少女" | "儿童" | "讲解" | "长辈" | "方言" | "角色" | "外语";

export interface TtsVoice {
  id: string;
  name: string;
  tag: VoiceTag;
  note: string;
}

export type VoiceFamily = "qwen" | "openai" | "minimax" | "doubao" | "generic";

export function voiceFamilyOf(config: { baseUrl?: string; model?: string }): VoiceFamily {
  const base = config.baseUrl ?? "";
  const model = config.model ?? "";
  if (/dashscope|qwen/i.test(base) || /qwen|cosyvoice/i.test(model)) return "qwen";
  if (/minimax/i.test(base) || /speech-|hailuo/i.test(model)) return "minimax";
  if (/volces|volcengine|ark\./i.test(base) || /doubao|seed-tts|openspeech/i.test(model)) return "doubao";
  if (/openai\.com/i.test(base) || /^tts-|^gpt-4o.*tts|gpt-4o-mini-tts/i.test(model)) return "openai";
  return "generic";
}

function v(id: string, name: string, tag: VoiceTag, note: string): TtsVoice {
  return { id, name, tag, note };
}

export const QWEN_VOICES: TtsVoice[] = [
  v("Cherry", "芊悦", "青年女声", "阳光亲切的小姐姐"),
  v("Serena", "苏瑶", "青年女声", "温柔小姐姐"),
  v("Ethan", "晨煦", "青年男声", "阳光朝气，略带北方口音"),
  v("Chelsie", "千雪", "少女", "二次元虚拟女友"),
  v("Momo", "茉兔", "少女", "撒娇搞怪"),
  v("Vivian", "十三", "少女", "拽拽的小暴躁"),
  v("Moon", "月白", "青年男声", "率性帅气"),
  v("Maia", "四月", "青年女声", "知性温柔"),
  v("Kai", "凯", "青年男声", "低沉舒服"),
  v("Nofish", "不吃鱼", "青年男声", "不会翘舌音的设计师"),
  v("Bella", "萌宝", "儿童", "小萝莉"),
  v("Jennifer", "詹妮弗", "外语", "电影质感美语女声"),
  v("Ryan", "甜茶", "青年男声", "戏感强"),
  v("Katerina", "卡捷琳娜", "青年女声", "御姐"),
  v("Aiden", "艾登", "外语", "美语大男孩"),
  v("Eldric Sage", "沧明子", "长辈", "沉稳睿智的老者"),
  v("Mia", "乖小妹", "少女", "温顺乖巧"),
  v("Mochi", "沙小弥", "儿童", "聪明伶俐的小大人"),
  v("Bellona", "燕铮莺", "讲解", "字正腔圆，热血说书"),
  v("Vincent", "田叔", "长辈", "沙哑烟嗓"),
  v("Bunny", "萌小姬", "儿童", "萌属性小萝莉"),
  v("Neil", "阿闻", "讲解", "新闻主持人"),
  v("Elias", "墨讲师", "讲解", "把知识讲清楚"),
  v("Arthur", "徐大爷", "长辈", "村里讲古"),
  v("Nini", "邻家妹妹", "少女", "软糯甜妹"),
  v("Seren", "小婉", "青年女声", "助眠柔声"),
  v("Pip", "顽皮小孩", "儿童", "调皮童真"),
  v("Stella", "少女阿月", "少女", "迷糊少女音"),
  v("Bodega", "博德加", "外语", "热情西班牙大叔"),
  v("Sonrisa", "索尼莎", "外语", "开朗拉美大姐"),
  v("Alek", "阿列克", "外语", "战斗民族男声"),
  v("Dolce", "多尔切", "外语", "慵懒意大利大叔"),
  v("Sohee", "素熙", "外语", "韩国欧尼"),
  v("Ono Anna", "小野杏", "外语", "青梅竹马"),
  v("Lenn", "莱恩", "外语", "德国青年"),
  v("Emilien", "埃米尔安", "外语", "法国大哥哥"),
  v("Andre", "安德雷", "青年男声", "磁性沉稳"),
  v("Radio Gol", "拉迪奥·戈尔", "外语", "足球解说"),
  v("Jada", "上海-阿珍", "方言", "沪上阿姐"),
  v("Dylan", "北京-晓东", "方言", "胡同少年"),
  v("Li", "南京-老李", "方言", "耐心瑜伽老师"),
  v("Marcus", "陕西-秦川", "方言", "老陕"),
  v("Roy", "闽南-阿杰", "方言", "台湾哥仔"),
  v("Peter", "天津-李彼得", "方言", "相声捧哏"),
  v("Sunny", "四川-晴儿", "方言", "川妹子"),
  v("Eric", "四川-程川", "方言", "成都男子"),
  v("Rocky", "粤语-阿强", "方言", "幽默阿强"),
  v("Kiki", "粤语-阿清", "方言", "甜美港妹"),
];

export const OPENAI_VOICES: TtsVoice[] = [
  v("alloy", "Alloy", "青年女声", "中性清晰"),
  v("ash", "Ash", "青年男声", "沉稳"),
  v("ballad", "Ballad", "青年男声", "叙事感"),
  v("coral", "Coral", "青年女声", "温暖"),
  v("echo", "Echo", "青年男声", "干净男声"),
  v("fable", "Fable", "讲解", "讲故事"),
  v("nova", "Nova", "青年女声", "明亮"),
  v("onyx", "Onyx", "青年男声", "低沉有力"),
  v("sage", "Sage", "讲解", "冷静旁白"),
  v("shimmer", "Shimmer", "少女", "轻快"),
  v("verse", "Verse", "青年男声", "表现力强"),
];

export const MINIMAX_VOICES: TtsVoice[] = [
  v("male-qn-qingse", "青涩青年", "青年男声", "青涩青年音色"),
  v("male-qn-jingying", "精英青年", "青年男声", "精英青年音色"),
  v("male-qn-badao", "霸道青年", "青年男声", "霸道青年音色"),
  v("male-qn-daxuesheng", "青年大学生", "青年男声", "大学生"),
  v("female-shaonv", "少女", "少女", "少女音色"),
  v("female-yujie", "御姐", "青年女声", "御姐音色"),
  v("female-chengshu", "成熟女性", "青年女声", "成熟女声"),
  v("female-tianmei", "甜美女性", "青年女声", "甜美女声"),
  v("presenter_male", "男主持人", "讲解", "男性主持人"),
  v("presenter_female", "女主持人", "讲解", "女性主持人"),
  v("audiobook_male_1", "有声书男1", "讲解", "男性有声书"),
  v("audiobook_male_2", "有声书男2", "讲解", "男性有声书"),
  v("audiobook_female_1", "有声书女1", "讲解", "女性有声书"),
  v("audiobook_female_2", "有声书女2", "讲解", "女性有声书"),
  v("clever_boy", "聪明男童", "儿童", "聪明男童"),
  v("cute_boy", "可爱男童", "儿童", "可爱男童"),
  v("lovely_girl", "萌萌女童", "儿童", "萌萌女童"),
  v("cartoon_pig", "猪小琪", "角色", "卡通猪小琪"),
  v("bingjiao_didi", "病娇弟弟", "角色", "病娇弟弟"),
  v("junlang_nanyou", "俊朗男友", "青年男声", "俊朗男友"),
  v("chunzhen_xuedi", "纯真学弟", "青年男声", "纯真学弟"),
  v("lengdan_xiongzhang", "冷淡学长", "青年男声", "冷淡学长"),
  v("badao_shaoye", "霸道少爷", "青年男声", "霸道少爷"),
  v("tianxin_xiaoling", "甜心小玲", "少女", "甜心小玲"),
  v("qiaopi_mengmei", "俏皮萌妹", "少女", "俏皮萌妹"),
  v("wumei_yujie", "妩媚御姐", "青年女声", "妩媚御姐"),
  v("diadia_xuemei", "嗲嗲学妹", "少女", "嗲嗲学妹"),
  v("danya_xuejie", "淡雅学姐", "青年女声", "淡雅学姐"),
  v("Chinese (Mandarin)_Reliable_Executive", "沉稳高管", "讲解", "沉稳高管"),
  v("Chinese (Mandarin)_News_Anchor", "新闻女声", "讲解", "新闻女声"),
  v("Chinese (Mandarin)_Mature_Woman", "傲娇御姐", "青年女声", "傲娇御姐"),
  v("Chinese (Mandarin)_Unrestrained_Young_Man", "不羁青年", "青年男声", "不羁青年"),
  v("Arrogant_Miss", "嚣张小姐", "青年女声", "嚣张小姐"),
  v("Chinese (Mandarin)_Kind-hearted_Antie", "热心大婶", "长辈", "热心大婶"),
  v("Chinese (Mandarin)_HK_Flight_Attendant", "港普空姐", "方言", "港普空姐"),
  v("Chinese (Mandarin)_Humorous_Elder", "搞笑大爷", "长辈", "搞笑大爷"),
  v("Chinese (Mandarin)_Gentleman", "温润男声", "青年男声", "温润男声"),
  v("Chinese (Mandarin)_Warm_Bestie", "温暖闺蜜", "青年女声", "温暖闺蜜"),
  v("Chinese (Mandarin)_Male_Announcer", "播报男声", "讲解", "播报男声"),
  v("Chinese (Mandarin)_Sweet_Lady", "甜美女声", "青年女声", "甜美女声"),
  v("Chinese (Mandarin)_Southern_Young_Man", "南方小哥", "方言", "南方小哥"),
  v("Chinese (Mandarin)_Wise_Women", "阅历姐姐", "青年女声", "阅历姐姐"),
  v("Chinese (Mandarin)_Gentle_Youth", "温润青年", "青年男声", "温润青年"),
  v("Chinese (Mandarin)_Warm_Girl", "温暖少女", "少女", "温暖少女"),
  v("Chinese (Mandarin)_Kind-hearted_Elder", "花甲奶奶", "长辈", "花甲奶奶"),
  v("Chinese (Mandarin)_Radio_Host", "电台男主播", "讲解", "电台男主播"),
  v("Chinese (Mandarin)_Lyrical_Voice", "抒情男声", "讲解", "抒情男声"),
  v("Chinese (Mandarin)_Crisp_Girl", "清脆少女", "少女", "清脆少女"),
  v("Cantonese_ProfessionalHost（F)", "粤语女主持", "方言", "专业女主持"),
  v("Cantonese_GentleLady", "粤语温柔女声", "方言", "温柔女声"),
  v("Cantonese_ProfessionalHost（M)", "粤语男主持", "方言", "专业男主持"),
  v("Cantonese_PlayfulMan", "粤语活泼男声", "方言", "活泼男声"),
  v("Cantonese_CuteGirl", "粤语可爱女孩", "方言", "可爱女孩"),
];

export const DOUBAO_VOICES: TtsVoice[] = [
  v("zh_female_shuangkuaisisi_moon_bigtts", "爽快思思", "青年女声", "干净利落"),
  v("zh_male_chunhou_moon_bigtts", "醇厚男声", "青年男声", "厚实稳重"),
  v("zh_female_wanqudashu_moon_bigtts", "湾区大叔", "方言", "粤普男声"),
  v("zh_male_shaonianzixin_moon_bigtts", "少年自信", "青年男声", "自信少年"),
  v("zh_female_tianmeixiaoyuan_moon_bigtts", "甜美小源", "少女", "校园甜妹"),
  v("zh_female_qingxinnvsheng_uranus_bigtts", "清新女声", "青年女声", "清新自然"),
  v("zh_male_yunzhou_uranus_bigtts", "云舟", "讲解", "沉稳旁白"),
  v("zh_female_linjianvhai_uranus_bigtts", "邻家女孩", "少女", "邻家女孩"),
  v("zh_male_beijingxiaoye_moon_bigtts", "北京小爷", "方言", "北京腔"),
  v("zh_female_sichuan_uranus_bigtts", "四川女声", "方言", "川妹子"),
  v("zh_male_ruyaqingnian_uranus_bigtts", "儒雅青年", "青年男声", "儒雅"),
  v("zh_female_gaolengyujie_uranus_bigtts", "高冷御姐", "青年女声", "高冷御姐"),
  v("BV001_streaming", "通用女声", "青年女声", "豆包通用女声"),
  v("BV002_streaming", "通用男声", "青年男声", "豆包通用男声"),
  v("BV700_streaming", "擎苍", "讲解", "浑厚旁白"),
  v("BV102_streaming", "奶气萌娃", "儿童", "童声"),
  v("BV113_streaming", "灿灿", "少女", "明亮少女"),
  v("BV119_streaming", "清新女声", "青年女声", "清新"),
];

const FAMILY_VOICES: Record<VoiceFamily, TtsVoice[]> = {
  qwen: QWEN_VOICES,
  openai: OPENAI_VOICES,
  minimax: MINIMAX_VOICES,
  doubao: DOUBAO_VOICES,
  generic: [...OPENAI_VOICES, ...QWEN_VOICES.slice(0, 8)],
};

export const VOICE_FAMILIES: Array<{ id: Exclude<VoiceFamily, "generic">; name: string }> = [
  { id: "qwen", name: "通义" },
  { id: "openai", name: "OpenAI" },
  { id: "minimax", name: "MiniMax" },
  { id: "doubao", name: "豆包" },
];

export const FAMILY_LABELS: Record<VoiceFamily, string> = {
  qwen: "通义",
  openai: "OpenAI",
  minimax: "MiniMax",
  doubao: "豆包",
  generic: "其他",
};

export const VOICE_TAGS: VoiceTag[] = ["青年女声", "青年男声", "少女", "儿童", "讲解", "长辈", "方言", "角色", "外语"];

export function voicesForFamily(family: VoiceFamily): TtsVoice[] {
  return FAMILY_VOICES[family];
}

export function voicesForConfig(config: { baseUrl?: string; model?: string }): TtsVoice[] {
  return FAMILY_VOICES[voiceFamilyOf(config)];
}

export const PREVIEW_LINE = "今儿这故事，就从这儿说起。";
