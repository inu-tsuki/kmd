import { KineticText } from "../core/KineticText";
import { Application } from "pixi.js";

// 初始化 Pixi 应用
const app = new Application();
await app.init({ width: 800, height: 600, backgroundColor: 0x1099bb });
document.body.appendChild(app.canvas);

// 测试用例：
// 期望： "World" 应该覆盖在 "Hello" 上面 (goto=start)
// 现状预测： "World" 会跟在 "Hello" 后面，然后光标才移回去（如果不报错的话）
const kmd = `
{Hello} {World} @ mark=start goto=start
`;

const text = new KineticText(kmd, {
    fontSize: 48,
    align: "left"
});

text.x = 50;
text.y = 50;

app.stage.addChild(text);

// 模拟播放
text.play();

// 打印一下内部的 stream 结构（如果能在控制台看到的话）
// 由于我们是在 node 环境还是浏览器环境？
// 如果是 dev 模式，浏览器控制台会打印 LayoutStreamBuilder 的日志
