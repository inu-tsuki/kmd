import { Container, Text, TextStyle } from "pixi.js";
import { effectManager } from "./effects/EffectManager"; // 引入管理器

export class KineticText extends Container {
  public chars: Text[] = [];

  constructor(content: string) {
    super();
    this.parseAndBuild(content);
  }

  private parseAndBuild(content: string) {
    // ... (之前实现的简单的拆字逻辑) ...
    // 为了演示，我们假设 chars 已经 populate 好了
    let currentX = 0;
    const style = new TextStyle({
      fontFamily: "Arial",
      fontSize: 36,
      fill: "#ffffff",
    });

    for (let i = 0; i < content.length; i++) {
      const char = new Text({ text: content[i], style });
      char.x = currentX;
      char.anchor.set(0.5); // 锚点居中对特效很重要
      // 修正居中带来的位置偏移（因为锚点变了，显示位置会偏左上，需要补回半径）
      char.x += char.width / 2;
      char.y += char.height / 2;

      this.addChild(char);
      this.chars.push(char);
      currentX += char.width;
    }
  }

  // 新增：对外暴露的特效接口
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
  }
}
