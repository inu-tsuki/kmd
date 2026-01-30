// 测试用例：时间轴编排
// 需求：文字先弹出来，然后开始慢慢震动，2秒后突然被重击一下
const textTime = new KineticText("{时间之主} @ f.red");
textTime.x = 400;
textTime.y = 500;
readerApp.pixiApp.stage.addChild(textTime);

// 1. 进场 (PopIn)
// 我们手动调用 API 来模拟 parser 解析后的行为
// 假设 parser 解析到了 f.popIn
textTime.tokens[0].chars.forEach((char, i) => {
  // 给每个字加点延迟，像波浪一样弹出来
  effectManager.apply(char, "popIn", { delay: i * 0.5 });
});

// 2. 循环 (Shake) - 延迟 1秒后开始震动
setTimeout(() => {
  textTime.tokens[0].chars.forEach((char) => {
    effectManager.apply(char, "fadeShake", { fadeIn: 2.0 });
  });
}, 1000);

// 3. 动作 (Punch) - 延迟 3秒后重击
setTimeout(() => {
  textTime.tokens[0].chars.forEach((char, i) => {
    effectManager.apply(char, "punch", { delay: i * 0.05 });
  });
}, 3000);
