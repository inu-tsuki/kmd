import { Container, Text, TextStyle } from "pixi.js";
import { effectManager } from "./effects/EffectManager"; // 引入管理器
import { parser } from "./parser/Parser"; // 引入解析器
import { styleManager } from "./effects/StyleManager";
import { TokenWrapper } from "./TokenWrapper"; // 引入新类

export class KineticText extends Container {
  public tokens: TokenWrapper[] = []; // 存储 Token 列表
  public globalEffects: string[] = []; // 存储全局特效

  constructor(kmdString: string) {
    super();
    this.build(kmdString);
  }

  private build(kmdString: string) {
    console.log(" [KineticText] Parsing KMD string:", kmdString);
    const { tokens: parsedTokens, globalEffects } = parser.parse(kmdString);
    console.log(
      " [KineticText] Parsed tokens:",
      parsedTokens,
      "Global effects:",
      globalEffects,
    );

    // 排版光标：从 0 开始
    let cursorX = 0;

    // 基础样式
    const baseStyle = new TextStyle({
      fontFamily: "Arial",
      fontSize: 36,
      fill: "#ffffff",
    });

    parsedTokens.forEach((tokenData) => {
      // --- 1. 准备样式 ---
      const tokenStyle = baseStyle.clone();
      const allEffects = [...globalEffects, ...tokenData.effects];

      allEffects.forEach((name) => {
        if (styleManager.has(name)) {
          styleManager.apply(tokenStyle, name);
          console.log(
            " [KineticText] for " + tokenData.content + " Applied style:",
            name,
          );
        }
      });

      // --- 2. 创建 TokenWrapper ---
      const tokenWrapper = new TokenWrapper();

      // --- 3. 创建字符并添加到 Wrapper ---
      const charObjects: Text[] = [];
      for (let i = 0; i < tokenData.content.length; i++) {
        const charObj = new Text({
          text: tokenData.content[i],
          style: tokenStyle,
        });
        charObjects.push(charObj);
      }
      tokenWrapper.addChars(charObjects);

      // --- 4. 排版 TokenWrapper ---
      const tokenWidth = tokenWrapper.width; // 此时 scale 为 1

      tokenWrapper.x = cursorX + tokenWidth / 2;
      tokenWrapper.y = /* tokenWrapper.height / 2; // 垂直居中 */ 0;

      this.addChild(tokenWrapper);
      this.tokens.push(tokenWrapper);
      cursorX += tokenWidth;

      // --- 5. 分发特效 (核心逻辑) ---
      // 我们需要决定特效给谁：给 Wrapper 还是给 Chars？

      allEffects.forEach((effectName) => {
        if (styleManager.has(effectName)) return; // 跳过静态样式

        // 【策略】
        // 我们可以维护一个列表，或者根据命名约定。
        // 这里做一个简单的硬编码判断：如果是 "border", "bg" 这种，给 Wrapper
        // 其他默认给 Chars (保持原有 shake, wave 的细腻感)

        if (["border", "bg", "blurIn"].includes(effectName)) {
          // 给组应用
          effectManager.apply(tokenWrapper, effectName);
          console.log(
            " [KineticText] for " + tokenData.content + " Applied effect:",
            effectName,
            "to TokenWrapper",
          );
        } else {
          // 给每个字应用 (Per-char animation)
          // 这里的逻辑可以优化：也可以把 applyEffectToAll 移入 TokenWrapper
          tokenWrapper.chars.forEach((char, index) => {
            effectManager.apply(char, effectName, { delay: index * 0.05 });
            console.log(
              " [KineticText] for " + tokenData.content + " Applied effect:",
              effectName,
              "to char:",
              char.text,
            );
          });
        }
      });
    });

    // --- 整行居中逻辑 ---
    // 此时 cursorX 就是整行的总宽度
    // 我们把 KineticText 的 pivot 设为中心
    this.pivot.x = cursorX / 2;
    // 高度取大概值，或者遍历算最大高度，这里简单取第一个 token 的高度
    this.pivot.y = /* this.tokens.length > 0 ? this.tokens[0].height / 2 : 0 */ 0;
  }

  /*   // 新增：对外暴露的特效接口
  // 例如：text.applyEffectToAll('wave')
  public applyEffectToAll(effectName: string, params?: any) {
    this.chars.forEach((char, index) => {
      // 可以根据 index 稍微修改 params，实现交错效果
      const finalParams = { ...params, delay: index * 0.05 };
      effectManager.apply(char, effectName, finalParams);
    });
  }

  // 例如：text.applyEffectToRange(0, 2, 'shake') -> 前两个字震动
  public applyEffectToRange(
    startIndex: number,
    endIndex: number,
    effectName: string,
    params?: any,
  ) {
    for (let i = startIndex; i < endIndex; i++) {
      const char = this.chars[i];
      if (!char) continue;

      effectManager.apply(char, effectName, params);
    }
  } */
}
