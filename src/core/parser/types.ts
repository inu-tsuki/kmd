// 一个 Token 代表一段具有相同属性的文字
// 例如 "{Hello}" 就是一个 Token，后面的 "World" 是另一个
export interface KMDToken {
  content: string; // 文字内容，如 "Hello"
  effects: string[]; // 应用的特效列表，如 ["shake", "red"]
  commands: string[]; // 句级指令，如 ["@right", "@wait(2)"]
  params: Record<string, any>; // 特效的具体参数，如 { strength: 10 }
}

// 一整段话就是 Token 的列表
export type KMDLine = KMDToken[];
export interface KMDLineData {
  tokens: KMDLine;
  globalEffects: string[]; // 作用于整行的全局特效，如 [ "wave" ]
}
